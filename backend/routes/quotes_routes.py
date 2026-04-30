"""Quotes (Orçamentos) — module routes.

Stores and renders sales proposals with reusable services, freights and a
customizable HTML template per company. Quote totals are computed server-side
and persisted on save so reports can aggregate without recomputing.

Collections:
  - quote_services       reusable line items (description, unit, default_price)
  - quote_freights       reusable freight rows (description, default_km, default_price_per_km)
  - quote_templates      HTML templates with placeholders, one is_default per tenant
  - quotes               generated proposals (header data, items[], freights[], totals)
"""
from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timezone
import uuid
import re

from database import get_database
from auth import get_current_user
from counters import next_sequence

router = APIRouter(prefix="/quotes", tags=["quotes"])


# ─── MODELS ──────────────────────────────────────────────────────────────────
class QuoteServiceCreate(BaseModel):
    description: str
    unit: Optional[str] = "un"          # kg, ton, l, un, m³, etc
    default_price: Optional[float] = 0.0
    notes: Optional[str] = None


class QuoteServiceUpdate(BaseModel):
    description: Optional[str] = None
    unit: Optional[str] = None
    default_price: Optional[float] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class QuoteFreightCreate(BaseModel):
    description: str
    default_km: Optional[float] = 0.0
    default_price_per_km: Optional[float] = 0.0


class QuoteFreightUpdate(BaseModel):
    description: Optional[str] = None
    default_km: Optional[float] = None
    default_price_per_km: Optional[float] = None
    is_active: Optional[bool] = None


class QuoteTemplateCreate(BaseModel):
    name: str
    content: str        # HTML/markdown with {{placeholders}}
    is_default: bool = False


class QuoteTemplateUpdate(BaseModel):
    name: Optional[str] = None
    content: Optional[str] = None
    is_default: Optional[bool] = None


class QuoteItemIn(BaseModel):
    description: str
    unit: Optional[str] = "un"
    quantity: float = 1.0
    unit_price: float = 0.0
    quote_service_id: Optional[str] = None  # reference, kept for analytics


class QuoteFreightIn(BaseModel):
    description: str
    km_total: float = 0.0
    price_per_km: float = 0.0
    quote_freight_id: Optional[str] = None


class QuoteCreate(BaseModel):
    template_id: Optional[str] = None
    client_id: Optional[str] = None
    ticket_id: Optional[str] = None
    items: List[QuoteItemIn] = []
    freights: List[QuoteFreightIn] = []
    minimum_billing_kg: Optional[str] = None
    payment_terms: Optional[str] = None     # ex: "30"
    payment_method: Optional[str] = None    # ex: "Boleto"
    seller_name: Optional[str] = None
    seller_contact: Optional[str] = None
    validity_days: int = 15
    notes: Optional[str] = None


class QuoteUpdate(BaseModel):
    items: Optional[List[QuoteItemIn]] = None
    freights: Optional[List[QuoteFreightIn]] = None
    minimum_billing_kg: Optional[str] = None
    payment_terms: Optional[str] = None
    payment_method: Optional[str] = None
    seller_name: Optional[str] = None
    seller_contact: Optional[str] = None
    validity_days: Optional[int] = None
    notes: Optional[str] = None
    status: Optional[str] = None  # rascunho | enviado | aceito | recusado


# ─── HELPERS ─────────────────────────────────────────────────────────────────
def _compute_totals(items, freights):
    items_out = []
    items_total = 0.0
    for it in items:
        total = (it.get("quantity") or 0) * (it.get("unit_price") or 0)
        items_out.append({**it, "total": total})
        items_total += total
    freights_out = []
    freights_total = 0.0
    for f in freights:
        total = (f.get("km_total") or 0) * (f.get("price_per_km") or 0)
        freights_out.append({**f, "total": total})
        freights_total += total
    return items_out, freights_out, items_total + freights_total


def _format_brl(v):
    try:
        return f"R$ {float(v):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    except Exception:
        return "R$ 0,00"


def _render_template(template_html: str, ctx: dict) -> str:
    """Substitutes {{placeholders}} in the template with ctx values.

    Supports two list-aware blocks:
        {{#items}}...{{description}}...{{total}}...{{/items}}
        {{#freights}}...{{description}}...{{total}}...{{/freights}}
    """
    html = template_html or ""

    def _expand_loop(block_name: str, rows: list, body: str) -> str:
        out = []
        for i, r in enumerate(rows, start=1):
            row_html = body
            row_ctx = {**r, "index": i}
            for k, v in row_ctx.items():
                if k in ("total", "unit_price", "price_per_km"):
                    v = _format_brl(v)
                row_html = row_html.replace("{{" + k + "}}", str(v if v is not None else ""))
            out.append(row_html)
        return "".join(out)

    for block in ("items", "freights"):
        pattern = re.compile(r"\{\{#" + block + r"\}\}(.*?)\{\{/" + block + r"\}\}", re.DOTALL)
        rows = ctx.get(block) or []
        html = pattern.sub(lambda m: _expand_loop(block, rows, m.group(1)), html)

    # Scalar placeholders
    for k, v in ctx.items():
        if isinstance(v, list):
            continue
        if k in ("items_total", "freights_total", "total_value"):
            v = _format_brl(v)
        html = html.replace("{{" + k + "}}", "" if v is None else str(v))

    return html


# ─── QUOTE SERVICES (catalog) ────────────────────────────────────────────────
@router.post("/services")
async def create_quote_service(data: QuoteServiceCreate, user=Depends(get_current_user), db: AsyncIOMotorDatabase = Depends(get_database)):
    doc = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "description": data.description,
        "unit": data.unit or "un",
        "default_price": data.default_price or 0.0,
        "notes": data.notes,
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.quote_services.insert_one(doc)
    return await db.quote_services.find_one({"id": doc["id"]}, {"_id": 0})


@router.get("/services")
async def list_quote_services(user=Depends(get_current_user), db: AsyncIOMotorDatabase = Depends(get_database)):
    return await db.quote_services.find({"company_id": user["company_id"]}, {"_id": 0}).sort("description", 1).to_list(1000)


@router.put("/services/{sid}")
async def update_quote_service(sid: str, data: QuoteServiceUpdate, user=Depends(get_current_user), db: AsyncIOMotorDatabase = Depends(get_database)):
    update = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    r = await db.quote_services.update_one({"id": sid, "company_id": user["company_id"]}, {"$set": update})
    if r.matched_count == 0:
        raise HTTPException(404, "Servico nao encontrado")
    return await db.quote_services.find_one({"id": sid}, {"_id": 0})


@router.delete("/services/{sid}")
async def delete_quote_service(sid: str, user=Depends(get_current_user), db: AsyncIOMotorDatabase = Depends(get_database)):
    r = await db.quote_services.delete_one({"id": sid, "company_id": user["company_id"]})
    if r.deleted_count == 0:
        raise HTTPException(404, "Servico nao encontrado")
    return {"deleted": True}


# ─── QUOTE FREIGHTS ──────────────────────────────────────────────────────────
@router.post("/freights")
async def create_quote_freight(data: QuoteFreightCreate, user=Depends(get_current_user), db: AsyncIOMotorDatabase = Depends(get_database)):
    doc = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "description": data.description,
        "default_km": data.default_km or 0.0,
        "default_price_per_km": data.default_price_per_km or 0.0,
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.quote_freights.insert_one(doc)
    return await db.quote_freights.find_one({"id": doc["id"]}, {"_id": 0})


@router.get("/freights")
async def list_quote_freights(user=Depends(get_current_user), db: AsyncIOMotorDatabase = Depends(get_database)):
    return await db.quote_freights.find({"company_id": user["company_id"]}, {"_id": 0}).sort("description", 1).to_list(1000)


@router.put("/freights/{fid}")
async def update_quote_freight(fid: str, data: QuoteFreightUpdate, user=Depends(get_current_user), db: AsyncIOMotorDatabase = Depends(get_database)):
    update = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    r = await db.quote_freights.update_one({"id": fid, "company_id": user["company_id"]}, {"$set": update})
    if r.matched_count == 0:
        raise HTTPException(404, "Frete nao encontrado")
    return await db.quote_freights.find_one({"id": fid}, {"_id": 0})


@router.delete("/freights/{fid}")
async def delete_quote_freight(fid: str, user=Depends(get_current_user), db: AsyncIOMotorDatabase = Depends(get_database)):
    r = await db.quote_freights.delete_one({"id": fid, "company_id": user["company_id"]})
    if r.deleted_count == 0:
        raise HTTPException(404, "Frete nao encontrado")
    return {"deleted": True}


# ─── QUOTE TEMPLATES ─────────────────────────────────────────────────────────
@router.post("/templates")
async def create_quote_template(data: QuoteTemplateCreate, user=Depends(get_current_user), db: AsyncIOMotorDatabase = Depends(get_database)):
    if data.is_default:
        await db.quote_templates.update_many({"company_id": user["company_id"]}, {"$set": {"is_default": False}})
    doc = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "name": data.name,
        "content": data.content,
        "is_default": data.is_default,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.quote_templates.insert_one(doc)
    return await db.quote_templates.find_one({"id": doc["id"]}, {"_id": 0})


DEFAULT_TEMPLATE_HTML = """<div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 24px; color: #111;">
  <header style="border-bottom: 3px solid #0a4a6f; padding-bottom: 16px; margin-bottom: 24px;">
    <h1 style="margin: 0; color: #0a4a6f; font-size: 22px;">PROPOSTA COMERCIAL N.&ordm; {{quote_number}}</h1>
    <p style="margin: 4px 0 0; color: #666; font-size: 13px;">Emitida em {{data_emissao}} &middot; V&aacute;lida por {{validity_days}} dias</p>
  </header>

  <section style="margin-bottom: 20px;">
    <h2 style="background: #0a4a6f; color: #fff; padding: 6px 10px; font-size: 14px; margin: 0 0 8px;">DADOS DO CLIENTE</h2>
    <table style="width: 100%; font-size: 13px; border-collapse: collapse;">
      <tr><td style="padding: 4px 8px; width: 30%; color: #555;">Raz&atilde;o social / Fantasia</td><td style="padding: 4px 8px;"><strong>{{razao_social}}</strong></td></tr>
      <tr><td style="padding: 4px 8px; color: #555;">CNPJ / CPF</td><td style="padding: 4px 8px;">{{cnpj_cpf}}</td></tr>
      <tr><td style="padding: 4px 8px; color: #555;">Solicitante</td><td style="padding: 4px 8px;">{{nome}}</td></tr>
      <tr><td style="padding: 4px 8px; color: #555;">Telefone</td><td style="padding: 4px 8px;">{{telefone}}</td></tr>
      <tr><td style="padding: 4px 8px; color: #555;">E-mail</td><td style="padding: 4px 8px;">{{email}}</td></tr>
      <tr><td style="padding: 4px 8px; color: #555;">Endere&ccedil;o</td><td style="padding: 4px 8px;">{{endereco}} &mdash; {{cidade}}/{{estado}} &mdash; CEP {{cep}}</td></tr>
    </table>
  </section>

  <section style="margin-bottom: 20px;">
    <h2 style="background: #0a4a6f; color: #fff; padding: 6px 10px; font-size: 14px; margin: 0 0 8px;">CUSTOS DOS SERVI&Ccedil;OS</h2>
    <table style="width: 100%; font-size: 12px; border-collapse: collapse; border: 1px solid #ddd;">
      <thead style="background: #f3f4f6;">
        <tr>
          <th style="padding: 6px; text-align: left; border: 1px solid #ddd;">Item</th>
          <th style="padding: 6px; text-align: left; border: 1px solid #ddd;">Descri&ccedil;&atilde;o</th>
          <th style="padding: 6px; text-align: center; border: 1px solid #ddd;">Unid.</th>
          <th style="padding: 6px; text-align: right; border: 1px solid #ddd;">Valor Unit.</th>
          <th style="padding: 6px; text-align: right; border: 1px solid #ddd;">Qtde.</th>
          <th style="padding: 6px; text-align: right; border: 1px solid #ddd;">Total</th>
        </tr>
      </thead>
      <tbody>
        {{#items}}
        <tr>
          <td style="padding: 6px; border: 1px solid #ddd;">{{index}}</td>
          <td style="padding: 6px; border: 1px solid #ddd;">{{description}}</td>
          <td style="padding: 6px; text-align: center; border: 1px solid #ddd;">{{unit}}</td>
          <td style="padding: 6px; text-align: right; border: 1px solid #ddd;">{{unit_price}}</td>
          <td style="padding: 6px; text-align: right; border: 1px solid #ddd;">{{quantity}}</td>
          <td style="padding: 6px; text-align: right; border: 1px solid #ddd;"><strong>{{total}}</strong></td>
        </tr>
        {{/items}}
      </tbody>
    </table>
    <p style="font-size: 12px; color: #555; margin: 8px 0 0;">Faturamento m&iacute;nimo: <strong>{{minimum_billing_kg}}</strong></p>
  </section>

  <section style="margin-bottom: 20px;">
    <h2 style="background: #0a4a6f; color: #fff; padding: 6px 10px; font-size: 14px; margin: 0 0 8px;">FRETE / DESLOCAMENTO</h2>
    <table style="width: 100%; font-size: 12px; border-collapse: collapse; border: 1px solid #ddd;">
      <thead style="background: #f3f4f6;">
        <tr>
          <th style="padding: 6px; text-align: left; border: 1px solid #ddd;">Item</th>
          <th style="padding: 6px; text-align: left; border: 1px solid #ddd;">Descri&ccedil;&atilde;o do Frete</th>
          <th style="padding: 6px; text-align: right; border: 1px solid #ddd;">Km Total</th>
          <th style="padding: 6px; text-align: right; border: 1px solid #ddd;">Valor/Km</th>
          <th style="padding: 6px; text-align: right; border: 1px solid #ddd;">Total</th>
        </tr>
      </thead>
      <tbody>
        {{#freights}}
        <tr>
          <td style="padding: 6px; border: 1px solid #ddd;">{{index}}</td>
          <td style="padding: 6px; border: 1px solid #ddd;">{{description}}</td>
          <td style="padding: 6px; text-align: right; border: 1px solid #ddd;">{{km_total}}</td>
          <td style="padding: 6px; text-align: right; border: 1px solid #ddd;">{{price_per_km}}</td>
          <td style="padding: 6px; text-align: right; border: 1px solid #ddd;"><strong>{{total}}</strong></td>
        </tr>
        {{/freights}}
      </tbody>
    </table>
  </section>

  <section style="margin-bottom: 20px; background: #f9fafb; padding: 12px; border-left: 4px solid #0a4a6f;">
    <table style="width: 100%; font-size: 13px;">
      <tr><td>Subtotal Servi&ccedil;os</td><td style="text-align: right;">{{items_total}}</td></tr>
      <tr><td>Subtotal Frete</td><td style="text-align: right;">{{freights_total}}</td></tr>
      <tr><td style="font-size: 16px; padding-top: 8px;"><strong>VALOR TOTAL DO OR&Ccedil;AMENTO</strong></td><td style="text-align: right; font-size: 16px; padding-top: 8px; color: #0a4a6f;"><strong>{{total_value}}</strong></td></tr>
    </table>
  </section>

  <section style="margin-bottom: 20px; font-size: 13px;">
    <p><strong>Prazo p/ pagamento NFS-e:</strong> {{payment_terms}} dias</p>
    <p><strong>Forma de pagamento:</strong> {{payment_method}}</p>
  </section>

  <section style="margin-bottom: 20px; font-size: 12px; color: #444;">
    <h3 style="font-size: 13px; color: #0a4a6f;">OBSERVA&Ccedil;&Otilde;ES</h3>
    <p style="white-space: pre-wrap;">{{notes}}</p>
  </section>

  <footer style="border-top: 2px solid #0a4a6f; padding-top: 16px; margin-top: 32px; font-size: 12px;">
    <p style="text-align: center; color: #555;">Proposta v&aacute;lida por {{validity_days}} dias.</p>
    <table style="width: 100%; margin-top: 32px;">
      <tr>
        <td style="text-align: center; width: 50%;">
          <div style="border-top: 1px solid #333; margin: 0 16px; padding-top: 4px;">
            <strong>{{razao_social}}</strong><br/>
            <span style="color: #666;">{{cnpj_cpf}}</span>
          </div>
        </td>
        <td style="text-align: center; width: 50%;">
          <div style="border-top: 1px solid #333; margin: 0 16px; padding-top: 4px;">
            <strong>{{seller_name}}</strong><br/>
            <span style="color: #666;">{{seller_contact}}</span>
          </div>
        </td>
      </tr>
    </table>
  </footer>
</div>"""


async def _ensure_default_template(db, company_id: str):
    """Idempotently ensures the company has 1 default template available.

    - If zero templates exist, seeds the canonical "Padrao Comercial".
    - If templates exist but none is_default=True, promotes the seeded one
      (or the oldest) to default so render() always finds something.
    """
    count = await db.quote_templates.count_documents({"company_id": company_id})
    if count == 0:
        await db.quote_templates.insert_one({
            "id": str(uuid.uuid4()),
            "company_id": company_id,
            "name": "Padrao Comercial",
            "content": DEFAULT_TEMPLATE_HTML,
            "is_default": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        return
    has_default = await db.quote_templates.find_one(
        {"company_id": company_id, "is_default": True}, {"_id": 0, "id": 1}
    )
    if has_default:
        return
    # Promote the canonical one (or the oldest) to default
    canonical = await db.quote_templates.find_one(
        {"company_id": company_id, "name": "Padrao Comercial"}, {"_id": 0, "id": 1}
    )
    target = canonical or await db.quote_templates.find_one(
        {"company_id": company_id}, {"_id": 0, "id": 1}, sort=[("created_at", 1)]
    )
    if target:
        await db.quote_templates.update_one({"id": target["id"]}, {"$set": {"is_default": True}})


@router.get("/templates")
async def list_quote_templates(user=Depends(get_current_user), db: AsyncIOMotorDatabase = Depends(get_database)):
    await _ensure_default_template(db, user["company_id"])
    return await db.quote_templates.find({"company_id": user["company_id"]}, {"_id": 0}).sort("created_at", -1).to_list(1000)


@router.get("/templates/{tid}")
async def get_quote_template(tid: str, user=Depends(get_current_user), db: AsyncIOMotorDatabase = Depends(get_database)):
    t = await db.quote_templates.find_one({"id": tid, "company_id": user["company_id"]}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Template nao encontrado")
    return t


@router.put("/templates/{tid}")
async def update_quote_template(tid: str, data: QuoteTemplateUpdate, user=Depends(get_current_user), db: AsyncIOMotorDatabase = Depends(get_database)):
    update = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if update.get("is_default"):
        await db.quote_templates.update_many({"company_id": user["company_id"]}, {"$set": {"is_default": False}})
    r = await db.quote_templates.update_one({"id": tid, "company_id": user["company_id"]}, {"$set": update})
    if r.matched_count == 0:
        raise HTTPException(404, "Template nao encontrado")
    return await db.quote_templates.find_one({"id": tid}, {"_id": 0})


@router.delete("/templates/{tid}")
async def delete_quote_template(tid: str, user=Depends(get_current_user), db: AsyncIOMotorDatabase = Depends(get_database)):
    r = await db.quote_templates.delete_one({"id": tid, "company_id": user["company_id"]})
    if r.deleted_count == 0:
        raise HTTPException(404, "Template nao encontrado")
    return {"deleted": True}


# ─── QUOTES (proposals) ──────────────────────────────────────────────────────
async def _build_client_ctx(db, company_id, client_id):
    if not client_id:
        return {}
    c = await db.clients.find_one({"id": client_id, "company_id": company_id}, {"_id": 0}) or {}
    return {
        "razao_social": c.get("company_name") or c.get("name") or "",
        "cnpj_cpf": c.get("cnpj") or c.get("cpf") or "",
        "nome": c.get("name") or "",
        "telefone": c.get("phone") or "",
        "email": c.get("email") or "",
        "endereco": c.get("address") or "",
        "cidade": c.get("city") or "",
        "estado": c.get("state") or "",
        "cep": c.get("cep") or "",
    }


@router.post("")
async def create_quote(data: QuoteCreate, user=Depends(get_current_user), db: AsyncIOMotorDatabase = Depends(get_database)):
    company_id = user["company_id"]
    items = [i.model_dump() for i in data.items]
    freights = [f.model_dump() for f in data.freights]
    items_out, freights_out, total = _compute_totals(items, freights)

    quote_number = await next_sequence(db, company_id, "quotes", start=0)
    doc = {
        "id": str(uuid.uuid4()),
        "company_id": company_id,
        "quote_number": quote_number,
        "template_id": data.template_id,
        "client_id": data.client_id,
        "ticket_id": data.ticket_id,
        "items": items_out,
        "freights": freights_out,
        "items_total": sum(i["total"] for i in items_out),
        "freights_total": sum(f["total"] for f in freights_out),
        "total_value": total,
        "minimum_billing_kg": data.minimum_billing_kg,
        "payment_terms": data.payment_terms,
        "payment_method": data.payment_method,
        "seller_name": data.seller_name or user.get("name"),
        "seller_contact": data.seller_contact,
        "validity_days": data.validity_days or 15,
        "notes": data.notes,
        "status": "rascunho",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": user["id"],
    }
    await db.quotes.insert_one(doc)
    return await db.quotes.find_one({"id": doc["id"]}, {"_id": 0})


@router.get("")
async def list_quotes(
    user=Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
    client_id: Optional[str] = None,
    ticket_id: Optional[str] = None,
    status: Optional[str] = None,
):
    q = {"company_id": user["company_id"]}
    if client_id: q["client_id"] = client_id
    if ticket_id: q["ticket_id"] = ticket_id
    if status: q["status"] = status
    quotes = await db.quotes.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    # Hydrate client_name for the list view (avoids N+1 by bulk fetching)
    client_ids = list({qu.get("client_id") for qu in quotes if qu.get("client_id")})
    if client_ids:
        clients = await db.clients.find(
            {"id": {"$in": client_ids}, "company_id": user["company_id"]},
            {"_id": 0, "id": 1, "name": 1, "company_name": 1}
        ).to_list(len(client_ids))
        cmap = {c["id"]: (c.get("company_name") or c.get("name") or "") for c in clients}
        for qu in quotes:
            qu["client_name"] = cmap.get(qu.get("client_id"), "")
    return quotes


@router.get("/{qid}")
async def get_quote(qid: str, user=Depends(get_current_user), db: AsyncIOMotorDatabase = Depends(get_database)):
    quote = await db.quotes.find_one({"id": qid, "company_id": user["company_id"]}, {"_id": 0})
    if not quote:
        raise HTTPException(404, "Orcamento nao encontrado")
    return quote


@router.put("/{qid}")
async def update_quote(qid: str, data: QuoteUpdate, user=Depends(get_current_user), db: AsyncIOMotorDatabase = Depends(get_database)):
    quote = await db.quotes.find_one({"id": qid, "company_id": user["company_id"]})
    if not quote:
        raise HTTPException(404, "Orcamento nao encontrado")
    update = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if "items" in update or "freights" in update:
        items = update.get("items", quote.get("items", []))
        freights = update.get("freights", quote.get("freights", []))
        # Pydantic models when present in `update`
        if items and hasattr(items[0], "model_dump"):
            items = [i.model_dump() for i in items]
        if freights and hasattr(freights[0], "model_dump"):
            freights = [f.model_dump() for f in freights]
        items_out, freights_out, total = _compute_totals(items, freights)
        update["items"] = items_out
        update["freights"] = freights_out
        update["items_total"] = sum(i["total"] for i in items_out)
        update["freights_total"] = sum(f["total"] for f in freights_out)
        update["total_value"] = total
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.quotes.update_one({"id": qid}, {"$set": update})
    return await db.quotes.find_one({"id": qid}, {"_id": 0})


@router.delete("/{qid}")
async def delete_quote(qid: str, user=Depends(get_current_user), db: AsyncIOMotorDatabase = Depends(get_database)):
    r = await db.quotes.delete_one({"id": qid, "company_id": user["company_id"]})
    if r.deleted_count == 0:
        raise HTTPException(404, "Orcamento nao encontrado")
    return {"deleted": True}


@router.get("/{qid}/render")
async def render_quote(qid: str, user=Depends(get_current_user), db: AsyncIOMotorDatabase = Depends(get_database)):
    """Returns rendered HTML for printing/saving as PDF via the browser.

    Combines the quote data with the linked template (or the default template
    when none was specified at creation time).
    """
    quote = await db.quotes.find_one({"id": qid, "company_id": user["company_id"]}, {"_id": 0})
    if not quote:
        raise HTTPException(404, "Orcamento nao encontrado")

    # Ensure at least the default template exists (idempotent)
    await _ensure_default_template(db, user["company_id"])

    template = None
    if quote.get("template_id"):
        template = await db.quote_templates.find_one({"id": quote["template_id"], "company_id": user["company_id"]}, {"_id": 0})
    if not template:
        template = await db.quote_templates.find_one({"company_id": user["company_id"], "is_default": True}, {"_id": 0})
    if not template:
        # Fallback: minimal generic template
        template = {"content": "<h1>Orcamento #{{quote_number}}</h1><pre>{{notes}}</pre>"}

    client_ctx = await _build_client_ctx(db, user["company_id"], quote.get("client_id"))
    ctx = {
        **client_ctx,
        "quote_number": quote.get("quote_number"),
        "items": quote.get("items", []),
        "freights": quote.get("freights", []),
        "items_total": quote.get("items_total", 0),
        "freights_total": quote.get("freights_total", 0),
        "total_value": quote.get("total_value", 0),
        "minimum_billing_kg": quote.get("minimum_billing_kg") or "",
        "payment_terms": quote.get("payment_terms") or "",
        "payment_method": quote.get("payment_method") or "",
        "seller_name": quote.get("seller_name") or "",
        "seller_contact": quote.get("seller_contact") or "",
        "validity_days": quote.get("validity_days") or 15,
        "notes": quote.get("notes") or "",
        "data_emissao": datetime.fromisoformat(quote["created_at"].replace("Z", "+00:00")).strftime("%d/%m/%Y") if quote.get("created_at") else "",
    }
    return {"html": _render_template(template["content"], ctx), "quote": quote}
