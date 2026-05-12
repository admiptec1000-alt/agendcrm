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
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timezone
import uuid
import re
import os
import base64
import logging

import httpx
import mammoth
from weasyprint import HTML
from bs4 import BeautifulSoup, NavigableString
import io

from database import get_database


def _maybe_convert_pdf_layout_to_png(b64: Optional[str], mimetype: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """If the operator uploads a PDF as letterhead, convert the FIRST page to
    a high-res PNG (CSS `background: url(data:image/pdf;…)` isn't supported
    by WeasyPrint). Returns the original (b64, mime) when input isn't a PDF
    or conversion fails.
    """
    if not b64 or not mimetype:
        return b64, mimetype
    if "pdf" not in (mimetype or "").lower():
        return b64, mimetype
    try:
        import pypdfium2 as pdfium
        raw = base64.b64decode(b64)
        pdf = pdfium.PdfDocument(io.BytesIO(raw))
        if len(pdf) == 0:
            return b64, mimetype
        # Render the first page at A4 ≈ 2480×3508 px (300 dpi) to keep
        # the letterhead crisp on print. 200 dpi is a reasonable balance
        # for inline base64 size (≈400-800kb png vs multi-MB at 300dpi).
        page = pdf[0]
        bitmap = page.render(scale=200 / 72.0)
        pil = bitmap.to_pil()
        buf = io.BytesIO()
        pil.save(buf, format="PNG", optimize=True)
        new_b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        return new_b64, "image/png"
    except Exception as e:
        logging.getLogger("quotes").warning(f"PDF→PNG layout conversion failed: {e}")
        return b64, mimetype
from auth import get_current_user
from counters import next_sequence

router = APIRouter(prefix="/quotes", tags=["quotes"])
logger = logging.getLogger(__name__)


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
    header_html: Optional[str] = None  # repeats on every page (top)
    footer_html: Optional[str] = None  # repeats on every page (bottom; supports {{page_number}}/{{total_pages}})
    header_height_mm: Optional[int] = None  # override default 22mm
    footer_height_mm: Optional[int] = None  # override default 18mm
    # G2 — full-page layout background (PNG/JPG of the printed letterhead).
    # When set, header/footer are ignored and the body is rendered on top of
    # the letterhead image, with configurable padding to avoid colliding with
    # the pre-printed graphics.
    layout_image_b64: Optional[str] = None
    layout_image_mimetype: Optional[str] = None
    layout_padding_top_mm: Optional[int] = None     # default 40
    layout_padding_bottom_mm: Optional[int] = None  # default 30
    layout_padding_x_mm: Optional[int] = None       # default 18


class QuoteTemplateUpdate(BaseModel):
    name: Optional[str] = None
    content: Optional[str] = None
    is_default: Optional[bool] = None
    header_html: Optional[str] = None
    footer_html: Optional[str] = None
    header_height_mm: Optional[int] = None
    footer_height_mm: Optional[int] = None
    layout_image_b64: Optional[str] = None
    layout_image_mimetype: Optional[str] = None
    layout_padding_top_mm: Optional[int] = None
    layout_padding_bottom_mm: Optional[int] = None
    layout_padding_x_mm: Optional[int] = None


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


def _auto_wrap_loops(html: str) -> str:
    """Robust loop-wrapper using a real HTML parser (BeautifulSoup).

    Strategy is intentionally STRIP-AND-REWRAP rather than additive:
      1. Strip every existing `{{#items}}/{{/items}}/{{#freights}}/{{/freights}}`
         marker from the document. This is necessary because `.docx` -> HTML
         conversions (and operators editing in Quill) frequently end up with
         empty marker pairs sitting OUTSIDE the table (`<p>{{#items}}{{/items}}</p>`)
         while the actual `<tr>` with placeholders sits unwrapped further down.
         Trying to "respect" the existing markers leaves the engine looping over
         empty bodies and the real placeholders leak into the PDF.
      2. Re-detect the loop body by locating the first `<tr>` that contains a
         marker placeholder (`{{description}}` for items, `{{km_total}}` /
         `{{price_per_km}}` for freights) and inject markers IMMEDIATELY before
         and after that `<tr>`. Markers are injected as text siblings of the
         `<tr>` so the regex `{{#items}}(.*?){{/items}}` in `_render_template`
         captures the entire row HTML.
      3. Drop sibling `<tr>` elements right after the wrapped one if they also
         contain the same placeholders — they were duplicate "second rows" the
         operator left in the Word document.

    Resilient to:
      - Markers nested inside `<p>` tags (Quill artifact)
      - Inline tags inside table cells (`<strong>`, `<em>`, `<span>`)
      - Word's `<td data-row="..">` annotations
      - Empty marker pairs (`{{#items}}{{/items}}`)
      - Multiple tables in the same template (only the FIRST matching <tr>
        per loop is wrapped)
    """
    if not html:
        return html

    # 1. Always strip existing markers — we re-detect the correct positions.
    for marker in ("{{#items}}", "{{/items}}", "{{#freights}}", "{{/freights}}"):
        html = html.replace(marker, "")

    soup = BeautifulSoup(html, "html.parser")

    def _wrap(label_tokens, sibling_tokens, open_m, close_m):
        target_tr = None
        for tr in soup.find_all("tr"):
            tr_html = tr.decode()
            if any(tok in tr_html for tok in label_tokens):
                target_tr = tr
                break
        if target_tr is None:
            return
        # Drop duplicate sibling rows that also contain the placeholders
        siblings_to_remove = []
        nxt = target_tr.find_next_sibling("tr")
        while nxt is not None:
            nxt_html = nxt.decode()
            if any(tok in nxt_html for tok in sibling_tokens):
                siblings_to_remove.append(nxt)
                nxt = nxt.find_next_sibling("tr")
            else:
                break
        for s in siblings_to_remove:
            s.decompose()
        target_tr.insert_before(NavigableString(open_m))
        target_tr.insert_after(NavigableString(close_m))

    _wrap(
        label_tokens=("{{description}}",),
        sibling_tokens=("{{description}}", "{{quantity}}", "{{unit_price}}", "{{unit}}"),
        open_m="{{#items}}",
        close_m="{{/items}}",
    )
    _wrap(
        label_tokens=("{{km_total}}", "{{price_per_km}}"),
        sibling_tokens=("{{km_total}}", "{{price_per_km}}"),
        open_m="{{#freights}}",
        close_m="{{/freights}}",
    )
    return str(soup)


def _render_template(template_html: str, ctx: dict) -> str:
    """Substitutes {{placeholders}} in the template with ctx values.

    Supports two list-aware blocks:
        {{#items}}...{{description}}...{{total}}...{{/items}}
        {{#freights}}...{{description}}...{{total}}...{{/freights}}

    Legacy templates (without loop wrappers) are auto-wrapped via
    _auto_wrap_loops BEFORE substitution, so {{description}} etc always
    iterate the correct collection.
    """
    html = _auto_wrap_loops(template_html or "")

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
    layout_b64, layout_mime = _maybe_convert_pdf_layout_to_png(data.layout_image_b64, data.layout_image_mimetype)
    doc = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "name": data.name,
        "content": data.content,
        "is_default": data.is_default,
        "header_html": data.header_html or None,
        "footer_html": data.footer_html or None,
        "header_height_mm": data.header_height_mm or 22,
        "footer_height_mm": data.footer_height_mm or 18,
        "layout_image_b64": layout_b64 or None,
        "layout_image_mimetype": layout_mime or None,
        "layout_padding_top_mm": data.layout_padding_top_mm or 40,
        "layout_padding_bottom_mm": data.layout_padding_bottom_mm or 30,
        "layout_padding_x_mm": data.layout_padding_x_mm or 18,
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
    # If the operator uploaded a PDF as layout, convert to PNG before
    # persisting so WeasyPrint can use it as @page background.
    if update.get("layout_image_b64") and update.get("layout_image_mimetype"):
        b64, mime = _maybe_convert_pdf_layout_to_png(update["layout_image_b64"], update["layout_image_mimetype"])
        update["layout_image_b64"] = b64
        update["layout_image_mimetype"] = mime
    r = await db.quote_templates.update_one({"id": tid, "company_id": user["company_id"]}, {"$set": update})
    if r.matched_count == 0:
        raise HTTPException(404, "Template nao encontrado")
    return await db.quote_templates.find_one({"id": tid}, {"_id": 0})


@router.post("/templates/{tid}/reconvert-placeholders")
async def reconvert_template_placeholders(
    tid: str,
    user=Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Re-runs the placeholder normalizer over an existing template.

    Used when an operator uploaded a .docx BEFORE the loop-folding logic was
    deployed — the stored HTML has {{description}}/{{quantity}} inside a
    <tr> but without a wrapping {{#items}}...{{/items}}, so _render_template
    cannot iterate and the raw tokens leak into the PDF. Running this
    endpoint repairs the template in place without re-uploading the .docx.
    """
    tpl = await db.quote_templates.find_one({"id": tid, "company_id": user["company_id"]}, {"_id": 0})
    if not tpl:
        raise HTTPException(404, "Template nao encontrado")
    new_html = _normalize_docx_placeholders(tpl.get("content") or "")
    await db.quote_templates.update_one(
        {"id": tid, "company_id": user["company_id"]},
        {"$set": {"content": new_html, "last_normalized_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"updated": True, "had_loops": "{{#items}}" in new_html or "{{#freights}}" in new_html}


@router.delete("/templates/{tid}")
async def delete_quote_template(tid: str, user=Depends(get_current_user), db: AsyncIOMotorDatabase = Depends(get_database)):
    r = await db.quote_templates.delete_one({"id": tid, "company_id": user["company_id"]})
    if r.deleted_count == 0:
        raise HTTPException(404, "Template nao encontrado")
    return {"deleted": True}


def _normalize_docx_placeholders(html: str) -> str:
    """Word splits placeholder text across runs and may add spaces. Convert
    user-friendly Word tokens like { ITEM_1 } or {{NOME}} into the canonical
    {{placeholder}} format the renderer understands.

    The converter is aware of common Brazilian quote templates (INCINERA
    style) and can fold numbered tokens (ITEM_1..ITEM_N + QTDE_N +
    VALOR_UNI_N + VALOR_TOTAL_N_SOMA) inside the FIRST TR that references
    them into a single {{#items}}...{{/items}} loop, and the equivalent
    freight tokens into {{#freights}}...{{/freights}}. The resulting
    template renders correctly regardless of how many items the operator
    later adds to the quote.
    """
    # Word frequently splits a placeholder across runs, producing HTML like
    # "{<strong>Token</strong>}" or "{<em>Token}</em>". Collapse that pattern
    # by temporarily stripping inline tags inside any { ... } region so the
    # placeholder regex below can catch it, then restoring.
    def _flatten_inline_brace_tags(s: str) -> str:
        # Replace patterns like "{<...>WORD<...>}" or "{WORD}<...>" with the
        # clean "{WORD}". This is safe because legitimate templates should
        # not contain HTML tags INSIDE placeholder tokens.
        brace_re = re.compile(r"\{(?!\{)([^{}]{0,120})\}")
        def _clean(match):
            inner = re.sub(r"<[^>]+>", "", match.group(1))
            return "{" + inner + "}"
        return brace_re.sub(_clean, s)
    html = _flatten_inline_brace_tags(html)

    # First convert "{ X }" single-brace to "{{X}}" (Word artifact)
    html = re.sub(r"\{\s*([A-Za-z0-9_\u00C0-\u017F /\-]+?)\s*\}", lambda m: "{{" + m.group(1).strip().replace(" ", "_") + "}}", html)
    # Trim inside double braces
    html = re.sub(r"\{\{\s*([^{}]+?)\s*\}\}", lambda m: "{{" + m.group(1).strip() + "}}", html)

    # Map verbose Incinera tokens to canonical names used by /render context
    token_map = {
        "RAZAO_SOCIAL_/_FANTASIA": "razao_social",
        "RAZAO_SOCIAL/FANTASIA": "razao_social",
        "RAZAO_SOCIAL": "razao_social",
        "CNPJ/CPF": "cnpj_cpf",
        "CNPJ_CPF": "cnpj_cpf",
        "NOME": "nome",
        "NUMERO": "telefone",
        "TELEFONE": "telefone",
        "EMAIL": "email",
        "E-MAIL": "email",
        "ENDERECO": "endereco",
        "ENDEREÇO": "endereco",
        "CIDADE": "cidade",
        "ESTADO": "estado",
        "CEP": "cep",
        "SOMA_TOTAL_ITENS": "total_value",
        "VALOR_TOTAL_DO_ORCAMENTO": "total_value",
        "FATURAMENTO_MINIMO_EM_KG": "minimum_billing_kg",
        "PRAZO_DE_PAGAMENTO": "payment_terms",
        "FORMA_DE_PAGAMENTO": "payment_method",
    }
    def _replace(match):
        token = match.group(1).strip()
        import unicodedata
        upper = unicodedata.normalize("NFKD", token).encode("ASCII", "ignore").decode("ASCII")
        upper = upper.upper().replace(" ", "_")
        canonical = token_map.get(upper)
        if canonical:
            return "{{" + canonical + "}}"
        return match.group(0)
    html = re.sub(r"\{\{([^{}]+?)\}\}", _replace, html)

    # ─── Fold numbered item/freight tokens into loops ───────────────────
    # Heuristic: for each <tr> containing ITEM_1 + QTDE_1 (or VALOR_UNI_1),
    # replace the NUMBERED tokens inside with their loop equivalents
    # (description/quantity/unit_price/total) and wrap the <tr> with
    # {{#items}}...{{/items}}. Delete any sibling <tr>s that reference
    # ITEM_2..N (they were duplicates of the first row in the Word doc).
    def _fold_rows(html_in: str, idx_label: str, canonical: dict, wrap_open: str, wrap_close: str) -> str:
        # Find every <tr>...</tr> that contains the FIRST-row marker.
        # First-row marker can be either the unsuffixed token ({{ITEM_FRETE}})
        # or the explicitly numbered ({{ITEM_1}}); operators frequently use
        # the former in Word.
        tr_re = re.compile(r"<tr[\s\S]*?</tr>", re.IGNORECASE)
        trs = list(tr_re.finditer(html_in))
        if not trs:
            return html_in
        first_markers = ["{{" + idx_label + "}}", "{{" + idx_label + "_1}}"]
        dup_marker_re = re.compile(r"\{\{" + re.escape(idx_label) + r"_([2-9]|1[0-9])\}\}")
        first_idx = None
        rows_to_remove = []
        for i, m in enumerate(trs):
            content = m.group(0)
            if any(mk in content for mk in first_markers) and first_idx is None:
                first_idx = i
            elif first_idx is not None and dup_marker_re.search(content):
                rows_to_remove.append(i)
        if first_idx is None:
            return html_in
        first_tr = trs[first_idx].group(0)
        replaced_tr = first_tr
        for num_token, loop_token in canonical.items():
            replaced_tr = re.sub(r"\{\{" + re.escape(num_token) + r"\}\}", "{{" + loop_token + "}}", replaced_tr)
        wrapped = wrap_open + replaced_tr + wrap_close

        # Stitch back: keep everything else, replace the first row with the
        # wrapped loop, and DROP rows_to_remove. Operate right-to-left on
        # positions so indices stay valid.
        pieces = []
        last_end = 0
        for i, m in enumerate(trs):
            if i < first_idx:
                continue  # leave original
            if i == first_idx:
                pieces.append((m.start(), m.end(), wrapped))
            elif i in rows_to_remove:
                pieces.append((m.start(), m.end(), ""))
            else:
                # keep as-is
                pass
        out = list(html_in)
        for start, end, new in sorted(pieces, key=lambda x: -x[0]):
            out[start:end] = list(new)
        return "".join(out)

    html = _fold_rows(
        html, "ITEM", {
            "ITEM_1": "description",
            "UNIDADE_1": "unit",
            "QTDE_1": "quantity",
            "VALOR_UNI_1": "unit_price",
            "VALOR_TOTAL_1_SOMA": "total",
        },
        "{{#items}}", "{{/items}}",
    )
    html = _fold_rows(
        html, "ITEM_FRETE", {
            "ITEM_FRETE_1": "description",
            "ITEM_FRETE": "description",
            "QTDE_FRETE_1": "km_total",
            "QTDE_FRETE": "km_total",
            "VALOR_UNI_FRETE_1": "price_per_km",
            "VALOR_UNI_FRETE": "price_per_km",
            "VALOR_TOTAL_FRETE_1": "total",
            "VALOR_TOTAL_FRETE": "total",
        },
        "{{#freights}}", "{{/freights}}",
    )

    return html


@router.post("/templates/upload-docx")
async def upload_docx_template(
    file: UploadFile = File(...),
    name: str = Form(...),
    is_default: bool = Form(False),
    user=Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Convert an uploaded .docx into a quote template (HTML) via Mammoth.

    Preserves headings, tables, bold/italic, lists. Converts user-friendly
    placeholders ({ NOME }, { ITEM_1 }, etc) to the canonical {{placeholder}}
    format expected by /render. The resulting HTML is editable later in the
    rich-text editor.
    """
    if not file.filename or not file.filename.lower().endswith(".docx"):
        raise HTTPException(400, "Envie um arquivo .docx")
    raw = await file.read()
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(400, "Arquivo muito grande (limite 10MB)")
    try:
        from io import BytesIO
        # Inline image handler: convert each embedded image to a data URI so
        # WeasyPrint can render it without any external fetch. Keeps the
        # template self-contained (great for letterhead logos/headers).
        def _image_handler(image):
            with image.open() as src:
                data = src.read()
            b64 = base64.b64encode(data).decode("ascii")
            return {"src": f"data:{image.content_type or 'image/png'};base64,{b64}"}
        result = mammoth.convert_to_html(
            BytesIO(raw),
            convert_image=mammoth.images.img_element(_image_handler),
        )
        html = result.value or ""
    except Exception as e:
        logger.warning("mammoth failed for %s: %s", file.filename, e)
        raise HTTPException(400, f"Falha ao converter .docx: {e}")
    html = _normalize_docx_placeholders(html)

    if is_default:
        await db.quote_templates.update_many({"company_id": user["company_id"]}, {"$set": {"is_default": False}})
    doc = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "name": name,
        "content": html,
        "is_default": bool(is_default),
        "source_filename": file.filename,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.quote_templates.insert_one(doc)
    return await db.quote_templates.find_one({"id": doc["id"]}, {"_id": 0})


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

    # Business rule: quotes MUST be generated from an existing open ticket.
    # This keeps quote numbers aligned with ticket numbers (same sequence)
    # which the user requested for simpler reference across the CRM.
    if not data.ticket_id:
        raise HTTPException(400, "Orcamento so pode ser gerado a partir de um atendimento (ticket). Abra o chat do cliente e use o atalho 'Novo Orcamento'.")
    ticket = await db.tickets.find_one(
        {"id": data.ticket_id, "company_id": company_id},
        {"_id": 0, "ticket_number": 1, "client_id": 1, "customer_phone": 1, "customer_name": 1}
    )
    if not ticket:
        raise HTTPException(404, "Atendimento (ticket) nao encontrado")

    # Quote number = ticket number. One quote per ticket-number: if the user
    # already has one for this ticket, append a version suffix (e.g. 1007.2).
    base_number = ticket.get("ticket_number")
    existing_count = await db.quotes.count_documents({"company_id": company_id, "ticket_id": data.ticket_id})
    quote_number = base_number if existing_count == 0 else f"{base_number}.{existing_count + 1}"

    # Auto-link client from ticket if not explicitly sent
    client_id = data.client_id or ticket.get("client_id")

    items = [i.model_dump() for i in data.items]
    freights = [f.model_dump() for f in data.freights]
    items_out, freights_out, total = _compute_totals(items, freights)

    doc = {
        "id": str(uuid.uuid4()),
        "company_id": company_id,
        "quote_number": quote_number,
        "template_id": data.template_id,
        "client_id": client_id,
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


@router.get("/by-document/{doc}")
async def find_quotes_by_document(
    doc: str,
    user=Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Return whether the given CPF/CNPJ (digits only) has any quote in this
    tenant. Used by the contact-edit UI to show a "com orcamento" badge.

    The lookup is two-step because quotes hold `client_id` only:
      1. find clients matching the digits (any of `cpf`, `cnpj`, `document`)
      2. find quotes whose `client_id` is in that set
    """
    digits = re.sub(r"\D", "", doc or "")
    if len(digits) < 11:
        return {"has_quote": False, "count": 0}
    matches = await db.clients.find(
        {
            "company_id": user["company_id"],
            "$or": [
                {"cpf": digits}, {"cpf": doc},
                {"cnpj": digits}, {"cnpj": doc},
                {"document": digits}, {"document": doc},
            ],
        },
        {"_id": 0, "id": 1},
    ).to_list(100)
    if not matches:
        return {"has_quote": False, "count": 0}
    cids = [c["id"] for c in matches]
    cnt = await db.quotes.count_documents({
        "company_id": user["company_id"],
        "client_id": {"$in": cids},
    })
    return {"has_quote": cnt > 0, "count": cnt, "client_ids": cids}


@router.get("")
async def list_quotes(
    user=Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
    client_id: Optional[str] = None,
    ticket_id: Optional[str] = None,
    status: Optional[str] = None,
    document: Optional[str] = None,
    customer: Optional[str] = None,
    user_id: Optional[str] = None,
):
    q = {"company_id": user["company_id"]}
    if client_id: q["client_id"] = client_id
    if ticket_id: q["ticket_id"] = ticket_id
    if status: q["status"] = status

    # M5 — permission gating. Admins (company_admin/super_admin) see all
    # quotes. Other users see only their own UNLESS their permission profile
    # grants `quotes.view_all`.
    is_admin = user.get("role") in ("company_admin", "super_admin")
    can_view_all = is_admin
    if not is_admin and user.get("permission_profile_id"):
        pp = await db.permission_profiles.find_one(
            {"id": user["permission_profile_id"], "company_id": user["company_id"]},
            {"_id": 0, "permissions": 1},
        )
        if pp and ("quotes.view_all" in (pp.get("permissions") or []) or "*" in (pp.get("permissions") or [])):
            can_view_all = True
    if not can_view_all:
        q["created_by"] = user["id"]
    # Explicit override for admins/all-viewers filtering by user
    if user_id and can_view_all:
        q["created_by"] = user_id

    # M6 — filters by CPF/CNPJ / customer name. Both resolve to client_ids first.
    if document or customer:
        cfilter = {"company_id": user["company_id"]}
        if document:
            digits = re.sub(r"\D", "", document)
            cfilter["$or"] = [
                {"cpf": digits}, {"cpf": document},
                {"cnpj": digits}, {"cnpj": document},
                {"document": digits}, {"document": document},
            ]
        if customer:
            ored = cfilter.pop("$or", [])
            cfilter["$and"] = [
                *([{"$or": ored}] if ored else []),
                {"$or": [
                    {"name": {"$regex": customer, "$options": "i"}},
                    {"company_name": {"$regex": customer, "$options": "i"}},
                ]},
            ]
        matched = await db.clients.find(cfilter, {"_id": 0, "id": 1}).to_list(2000)
        ids = [c["id"] for c in matched]
        if not ids:
            return []
        q["client_id"] = {"$in": ids}

    quotes = await db.quotes.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    # Hydrate client_name + customer document + author name for the list view
    client_ids = list({qu.get("client_id") for qu in quotes if qu.get("client_id")})
    if client_ids:
        clients = await db.clients.find(
            {"id": {"$in": client_ids}, "company_id": user["company_id"]},
            {"_id": 0, "id": 1, "name": 1, "company_name": 1, "cpf": 1, "cnpj": 1, "document": 1},
        ).to_list(len(client_ids))
        cmap = {c["id"]: c for c in clients}
        for qu in quotes:
            c = cmap.get(qu.get("client_id"), {})
            qu["client_name"] = (c.get("company_name") or c.get("name") or "")
            qu["client_document"] = c.get("cnpj") or c.get("cpf") or c.get("document") or ""
    # Author name (M6: 'Usuario' column)
    user_ids = list({qu.get("created_by") for qu in quotes if qu.get("created_by")})
    if user_ids:
        users = await db.company_users.find(
            {"id": {"$in": user_ids}, "company_id": user["company_id"]},
            {"_id": 0, "id": 1, "name": 1, "email": 1},
        ).to_list(len(user_ids))
        umap = {u["id"]: (u.get("name") or u.get("email") or "") for u in users}
        for qu in quotes:
            qu["created_by_name"] = umap.get(qu.get("created_by"), "")
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
    """Returns rendered HTML for printing/saving as PDF via the browser."""
    html, quote = await _build_quote_html(qid, user, db)
    return {
        "html": html,
        "quote": quote,
        "header_html": quote.get("__header_html"),
        "footer_html": quote.get("__footer_html"),
    }


@router.get("/{qid}/preview-pdf-html")
async def preview_pdf_html(qid: str, user=Depends(get_current_user), db: AsyncIOMotorDatabase = Depends(get_database)):
    """Returns the SAME HTML that is fed to WeasyPrint (CSS-styled, with
    header/footer chrome composed into the document) — minus the
    `position: running()` rules that only WeasyPrint understands. Allows
    the frontend to render an iframe preview that visually matches the
    final PDF byte-for-byte (modulo paper-page chrome). Used by the
    'visualizar orçamento' button on both the Orçamentos page AND the
    chat ticket header to fix the long-standing mismatch between the
    on-screen preview and the downloaded PDF."""
    body_html, quote = await _build_quote_html(qid, user, db)
    header_html = quote.get("__header_html")
    footer_html = quote.get("__footer_html")
    composed = _build_browser_preview_html(
        body_html, header_html, footer_html,
        header_height_mm=quote.get("__header_height_mm") or 22,
        footer_height_mm=quote.get("__footer_height_mm") or 18,
    )
    return {"html": composed, "quote_number": quote.get("quote_number")}


class _TemplatePreviewRequest(BaseModel):
    content: Optional[str] = ""
    header_html: Optional[str] = ""
    footer_html: Optional[str] = ""
    header_height_mm: Optional[int] = 22
    footer_height_mm: Optional[int] = 18


@router.post("/templates/preview-html")
async def preview_template_html(
    body: _TemplatePreviewRequest,
    user=Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Render an unsaved template (the Quill-edited HTML) in the same A4-
    framed wrapper used by `/preview-pdf-html`. Lets the operator see —
    LIVE inside the template editor — how header / body / footer line up
    on a real A4 sheet, BEFORE saving anything to the database. No real
    quote required; uses the company logo and a single placeholder so the
    layout is realistic."""
    company = await db.companies.find_one({"id": user["company_id"]}, {"_id": 0}) or {}
    fake_quote_ctx = {
        "quote_number": "0001 (preview)",
        "items": [{"description": "Servico exemplo", "quantity": 1, "unit_price": 100.0, "total": 100.0, "unit": "un"}],
        "freights": [],
        "items_total": 100.0,
        "freights_total": 0.0,
        "total_value": 100.0,
        "minimum_billing_kg": "",
        "payment_terms": "30 dias apos emissao",
        "validity_days": 15,
        "notes": "Este e um preview do template — nada foi salvo.",
        "client_name": "Cliente Exemplo LTDA",
        "client_phone": "5511999990000",
        "client_email": "cliente@exemplo.com",
        "client_address": "Rua Exemplo, 123",
        "client_cnpj": "12.345.678/0001-90",
        "company_name": company.get("name", ""),
        "company_phone": company.get("phone", ""),
        "company_email": company.get("email", ""),
        "company_address": company.get("address", ""),
        "company_logo": company.get("logo_url") or company.get("logo", ""),
    }
    body_html = _render_template((body.content or ""), fake_quote_ctx)
    composed = _build_browser_preview_html(
        body_html,
        body.header_html or None,
        body.footer_html or None,
        header_height_mm=body.header_height_mm or 22,
        footer_height_mm=body.footer_height_mm or 18,
    )
    return {"html": composed}



async def _build_quote_html(qid: str, user, db) -> tuple:
    """Shared helper: returns (html, quote_dict). Raises 404 if not found.

    Used by /render (preview), /pdf (download), and /send-whatsapp (attach).
    """
    quote = await db.quotes.find_one({"id": qid, "company_id": user["company_id"]}, {"_id": 0})
    if not quote:
        raise HTTPException(404, "Orcamento nao encontrado")

    await _ensure_default_template(db, user["company_id"])

    template = None
    if quote.get("template_id"):
        template = await db.quote_templates.find_one({"id": quote["template_id"], "company_id": user["company_id"]}, {"_id": 0})
    if not template:
        template = await db.quote_templates.find_one({"company_id": user["company_id"], "is_default": True}, {"_id": 0})
    if not template:
        template = {"content": "<h1>Orcamento #{{quote_number}}</h1><pre>{{notes}}</pre>"}

    # G2 fallback — when the quote's template doesn't have a layout image but
    # the company's DEFAULT template does, inherit it. Lets the operator turn
    # an existing quote into a letterhead-rendered PDF without having to
    # regenerate the quote with a new template_id.
    if not template.get("layout_image_b64"):
        default_tpl = await db.quote_templates.find_one(
            {"company_id": user["company_id"], "is_default": True, "layout_image_b64": {"$ne": None}},
            {"_id": 0},
        )
        if default_tpl and default_tpl.get("id") != template.get("id") and default_tpl.get("layout_image_b64"):
            template["layout_image_b64"] = default_tpl["layout_image_b64"]
            template["layout_image_mimetype"] = default_tpl.get("layout_image_mimetype")
            template["layout_padding_top_mm"] = default_tpl.get("layout_padding_top_mm") or template.get("layout_padding_top_mm")
            template["layout_padding_bottom_mm"] = default_tpl.get("layout_padding_bottom_mm") or template.get("layout_padding_bottom_mm")
            template["layout_padding_x_mm"] = default_tpl.get("layout_padding_x_mm") or template.get("layout_padding_x_mm")

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
    body_html = _render_template(template["content"], ctx)
    # Header/footer are OPTIONAL on the template (added in the v5 editor).
    # Render them with the same context so placeholders work in them too.
    header_html = _render_template(template.get("header_html") or "", ctx) or None
    footer_html = _render_template(template.get("footer_html") or "", ctx) or None
    quote_with_chrome = dict(quote)
    quote_with_chrome["__header_html"] = header_html
    quote_with_chrome["__footer_html"] = footer_html
    quote_with_chrome["__header_height_mm"] = template.get("header_height_mm") or 22
    quote_with_chrome["__footer_height_mm"] = template.get("footer_height_mm") or 18
    # G2 — full-page letterhead background. When set, the body floats above
    # the image and header/footer chromes are skipped to honor the layout.
    quote_with_chrome["__layout_image_b64"] = template.get("layout_image_b64") or None
    quote_with_chrome["__layout_image_mimetype"] = template.get("layout_image_mimetype") or None
    quote_with_chrome["__layout_padding_top_mm"] = template.get("layout_padding_top_mm") or 40
    quote_with_chrome["__layout_padding_bottom_mm"] = template.get("layout_padding_bottom_mm") or 30
    quote_with_chrome["__layout_padding_x_mm"] = template.get("layout_padding_x_mm") or 18
    return body_html, quote_with_chrome


# ─── PRINTABLE STYLESHEET ────────────────────────────────────────────────────
# Single source of truth for the visual identity of generated quotes. Used by:
#   - `_generate_pdf_bytes` (server-side WeasyPrint -> PDF)
#   - `_build_browser_preview_html` (frontend iframe preview, identical look)
# Keep this string in sync — the whole point of feature #2 is preview == PDF.
_QUOTE_STYLESHEET = (
    "* { box-sizing: border-box; }\n"
    "html, body {\n"
    "  margin: 0; padding: 0;\n"
    "  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;\n"
    "  font-size: 9.8pt; line-height: 1.5; color: #0f172a; background: #fff;\n"
    "}\n"
    "table, p, div, section, header, footer, ul, ol, blockquote, img { max-width: 100% !important; }\n"
    ".ql-align-center { text-align: center !important; }\n"
    ".ql-align-right  { text-align: right !important; }\n"
    ".ql-align-justify { text-align: justify !important; }\n"
    ".ql-align-left   { text-align: left !important; }\n"
    "h1 { font-size: 17pt; font-weight: 700; letter-spacing: -0.01em; margin: 0 0 8pt; color: #0a4a6f; }\n"
    "h2 { font-size: 11.5pt; font-weight: 700; margin: 14pt 0 6pt; color: #0a4a6f;\n"
    "     text-transform: uppercase; letter-spacing: 0.04em; padding: 6pt 8pt;\n"
    "     background: linear-gradient(90deg, #e0f2fe 0%, #f0f9ff 100%); border-left: 3pt solid #0a4a6f; }\n"
    "h3 { font-size: 10.5pt; font-weight: 600; margin: 8pt 0 3pt; color: #0f172a; }\n"
    "p { margin: 3pt 0; }\n"
    "strong { color: #0a4a6f; font-weight: 600; }\n"
    "table { width: 100%; border-collapse: collapse; table-layout: auto;\n"
    "        margin: 4pt 0 8pt; border: 0.5pt solid #cbd5e1; }\n"
    "td, th { padding: 6pt 7pt; vertical-align: middle; text-align: left;\n"
    "         word-break: normal; overflow-wrap: break-word; hyphens: auto;\n"
    "         border: 0.5pt solid #e2e8f0; font-size: 9.5pt; }\n"
    "th { background: #0a4a6f; font-weight: 600; color: #fff; font-size: 8.5pt;\n"
    "     text-transform: uppercase; letter-spacing: 0.02em;\n"
    "     border-color: #0a4a6f; white-space: normal; line-height: 1.2; }\n"
    "table > tbody > tr:first-child > td,\n"
    "table > tr:first-child > td {\n"
    "  background: #0a4a6f !important; color: #fff !important; font-weight: 700 !important;\n"
    "  text-transform: uppercase; letter-spacing: 0.02em;\n"
    "  font-size: 8.5pt; padding: 5pt 6pt; line-height: 1.2;\n"
    "  border-color: #0a4a6f !important; text-align: center !important;\n"
    "}\n"
    "table > tbody > tr:first-child > td *,\n"
    "table > tr:first-child > td * { color: #fff !important; }\n"
    "tbody > tr:not(:first-child) > td.ql-align-justify { text-align: left !important; }\n"
    "tbody tr:nth-child(even):not(:first-child) td { background: #f8fafc; }\n"
    "tbody tr td { line-height: 1.4; }\n"
    "img { max-width: 100% !important; height: auto !important; }\n"
    "td[data-align=\"right\"], th[data-align=\"right\"] { text-align: right; }\n"
    "tr { page-break-inside: avoid; }\n"
    "h2 + table { margin-top: 6pt; }\n"
    "#__quote_header, #__quote_footer { font-size: 8.5pt; color: #475569; line-height: 1.3; }\n"
    "#__quote_header img, #__quote_footer img { max-height: 18mm; max-width: 100%; }\n"
    "#__quote_footer { border-top: 0.4pt solid #cbd5e1; padding-top: 3pt; }\n"
    "#__quote_header { border-bottom: 0.4pt solid #cbd5e1; padding-bottom: 3pt; }\n"
)


def _build_browser_preview_html(
    body_html: str,
    header_html: Optional[str] = None,
    footer_html: Optional[str] = None,
    header_height_mm: int = 22,
    footer_height_mm: int = 18,
) -> str:
    """Wraps the rendered body in an A4-shaped page mockup using the SAME
    stylesheet WeasyPrint uses, so the iframe preview visually matches the
    downloaded PDF. The "page" is a fixed 210mm wide white sheet with
    ~18mm padding; if header/footer are provided they sit at the top and
    bottom of the sheet with thin separators (mirroring the PDF chrome).
    `header_height_mm`/`footer_height_mm` come from the template config —
    operator can adjust them in the editor (default 22/18)."""
    nbsp_clean = (body_html or "").replace("\u00a0", " ")
    cleaned_header = (header_html or "").replace("\u00a0", " ")
    cleaned_footer = (footer_html or "").replace("\u00a0", " ")
    chrome_top = (
        f'<div id="__quote_header" style="margin-bottom:8mm;">{cleaned_header}</div>'
        if cleaned_header.strip() else ""
    )
    chrome_bottom = (
        f'<div id="__quote_footer" style="margin-top:8mm;">{cleaned_footer}</div>'
        if cleaned_footer.strip() else ""
    )
    h = max(8, min(80, int(header_height_mm or 22)))
    f = max(8, min(80, int(footer_height_mm or 18)))
    return (
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><style>\n"
        + _QUOTE_STYLESHEET
        + "/* On-screen-only chrome: emulate a real A4 sheet inside the iframe. */\n"
        + "body { background: #f1f5f9; padding: 16px; }\n"
        + ".__a4_page { width: 210mm; min-height: 297mm; max-width: 100%;\n"
        + "             margin: 0 auto 16px; padding: 18mm 16mm;\n"
        + "             background: #fff; box-shadow: 0 2px 12px rgba(15,23,42,0.08);\n"
        + "             border-radius: 4px; }\n"
        # Match the constraints applied to the actual PDF chrome so the
        # iframe preview is visually the same as the downloaded PDF.
        + "#__quote_header, #__quote_footer { width: 100%; box-sizing: border-box;\n"
        + "  text-align: center; line-height: 1.15; font-size: 9pt; }\n"
        + f"#__quote_header {{ height: {h}mm; max-height: {h}mm; overflow: hidden; }}\n"
        + f"#__quote_footer {{ height: {f}mm; max-height: {f}mm; overflow: hidden; }}\n"
        + "#__quote_header img, #__quote_footer img { max-width: 100%; width: 100%;\n"
        + "  height: auto; display: block; margin: 0 auto; object-fit: contain; }\n"
        + f"#__quote_header img {{ max-height: {h}mm; }}\n"
        + f"#__quote_footer img {{ max-height: {f}mm; }}\n"
        + "#__quote_header p, #__quote_footer p { margin: 0; }\n"
        + "</style></head><body>"
        + '<div class="__a4_page">'
        + chrome_top
        + nbsp_clean
        + chrome_bottom
        + "</div></body></html>"
    )


def _generate_pdf_bytes(
    html_content: str,
    header_html: Optional[str] = None,
    footer_html: Optional[str] = None,
    header_height_mm: int = 22,
    footer_height_mm: int = 18,
    layout_image_b64: Optional[str] = None,
    layout_image_mimetype: Optional[str] = None,
    layout_padding_top_mm: int = 40,
    layout_padding_bottom_mm: int = 30,
    layout_padding_x_mm: int = 18,
) -> bytes:
    """Convert HTML string to PDF bytes via WeasyPrint (sync, ~100-500ms).

    Three known landmines this function defuses BEFORE WeasyPrint sees them:

      1. Quill exports `class="ql-align-center"` (and right/justify/left) on
         every aligned paragraph — but Quill's stylesheet is NOT bundled in
         the rendered HTML, so without explicit CSS rules WeasyPrint silently
         ignores them and aligns everything left. We add the rules below.

      2. Quill replaces inline whitespace inside cells/paragraphs with
         non-breaking spaces (\xa0). With `word-break: normal` the whole
         "Descrição\xa0dos\xa0Serviços" string becomes a single unbreakable
         word, and `overflow-wrap: anywhere` then chops it at character
         boundaries (= "DESCRIÇÃO DOS SERVIÇO" with the final S cut off the
         right margin). We replace \xa0 with regular spaces so the text can
         break at word boundaries normally.

      3. Some `.docx` exports hard-code table widths that exceed the print
         area. `box-sizing: border-box` + `max-width: 100% !important` on
         table/p/div neutralises this.
    """
    base_url = os.environ.get("PUBLIC_BACKEND_URL") or os.environ.get("FASTAPI_URL") or None

    # Pre-processing #2: NBSP -> regular space inside table headers and body
    # paragraphs. We don't want to nuke ALL NBSPs blindly because some are
    # intentional (e.g. "R$ 1.200,00" between currency symbol and digits),
    # so we only collapse runs of NBSP between alphanumeric/punctuation
    # characters that include at least one alphabetic char.
    cleaned_html = (html_content or "").replace("\u00a0", " ")
    cleaned_header = (header_html or "").replace("\u00a0", " ")
    cleaned_footer = (footer_html or "").replace("\u00a0", " ")

    # G2 — When a full-page layout image is supplied, it overrides the
    # header/footer chrome: the body floats above the letterhead image with
    # configurable padding so it doesn't collide with pre-printed graphics.
    use_layout = bool(layout_image_b64)
    if use_layout:
        cleaned_header = ""
        cleaned_footer = ""

    has_header = bool(cleaned_header.strip())
    has_footer = bool(cleaned_footer.strip())

    # WeasyPrint supports CSS running elements: an arbitrary HTML block can
    # be hoisted into @page { @top-center }/@bottom-center via
    # `position: running(name)`. The block lives once in the document but
    # WeasyPrint repeats it on every page. This is the cleanest way to
    # implement "cabeçalho / rodapé que repete em todas as páginas". We
    # also expose `string(page-counter)` and `counter(pages)` so footer
    # templates can include "Página X de Y" if the operator wants.
    page_chrome_css = ""
    if has_header:
        page_chrome_css += "\n@page { @top-center { content: element(quote_header); width: 100%; } }\n"
        page_chrome_css += "#__quote_header { position: running(quote_header); width: 100%; }\n"
    if has_footer:
        page_chrome_css += "\n@page { @bottom-center { content: element(quote_footer); width: 100%; } }\n"
        page_chrome_css += "#__quote_footer { position: running(quote_footer); width: 100%; }\n"

    # Constrain header/footer dimensions so user-provided images don't blow
    # past the @page margin (which would crash into the body content and
    # shrink the printable area to "half the page" — exact bug reported by
    # Incinera 02/05/2026). Force images to fill the full text-width and
    # cap the chrome height to the (configurable) reserved margin. The
    # height comes from the template — operator can adjust it in the editor
    # (default 22/18mm; tested up to ~80mm without breakage).
    h = max(8, min(80, int(header_height_mm or 22)))
    f = max(8, min(80, int(footer_height_mm or 18)))
    chrome_constraints_css = (
        "#__quote_header, #__quote_footer { width: 100%; box-sizing: border-box; "
        "text-align: center; line-height: 1.15; font-size: 9pt; }\n"
        f"#__quote_header {{ height: {h}mm; max-height: {h}mm; overflow: hidden; }}\n"
        f"#__quote_footer {{ height: {f}mm; max-height: {f}mm; overflow: hidden; }}\n"
        "#__quote_header img, #__quote_footer img { "
        "  max-width: 100%; width: 100%; height: auto; display: block; margin: 0 auto; "
        "  object-fit: contain; "
        "}\n"
        f"#__quote_header img {{ max-height: {h}mm; }}\n"
        f"#__quote_footer img {{ max-height: {f}mm; }}\n"
        "#__quote_header p, #__quote_footer p { margin: 0; }\n"
    )

    # Reserve the @page top/bottom margin so the body content doesn't
    # collide with the header/footer area. Add 4mm safety so paragraphs
    # don't graze the chrome.
    top_margin = f"{h + 4}mm" if has_header else "18mm"
    bottom_margin = f"{f + 4}mm" if has_footer else "18mm"

    layout_css = ""
    if use_layout:
        # Use the letterhead image as @page background. WeasyPrint supports
        # background-image on @page; the image scales to fill A4. The body
        # margin matches the operator-defined paddings so quote content sits
        # in the "safe area" of the letterhead.
        mime = layout_image_mimetype or "image/png"
        top_margin = f"{max(8, min(120, int(layout_padding_top_mm or 40)))}mm"
        bottom_margin = f"{max(8, min(120, int(layout_padding_bottom_mm or 30)))}mm"
        px = max(0, min(50, int(layout_padding_x_mm or 18)))
        layout_css = (
            f"@page {{ background: url('data:{mime};base64,{layout_image_b64}') "
            "no-repeat center center; background-size: 100% 100%; }\n"
        )
        # X margin from layout_padding_x
        page_margin_x = f"{px}mm"
    else:
        page_margin_x = "16mm"

    css_prefix = (
        "<style>\n"
        "@page {\n"
        "  size: A4;\n"
        f"  margin: {top_margin} {page_margin_x} {bottom_margin} {page_margin_x};\n"
        "}\n"
        + layout_css
        + page_chrome_css
        + chrome_constraints_css
        + _QUOTE_STYLESHEET
        + "</style>\n"
    )
    # Wrap header/footer in id'd divs so the CSS `position: running()` rules above
    # can hoist them into the @page slots. They MUST live in the document body
    # (not display:none) for WeasyPrint to pick them up.
    chrome_blocks = ""
    if has_header:
        chrome_blocks += '<div id="__quote_header">' + cleaned_header + '</div>'
    if has_footer:
        chrome_blocks += '<div id="__quote_footer">' + cleaned_footer + '</div>'
    html_with_css = css_prefix + chrome_blocks + cleaned_html
    return HTML(string=html_with_css, base_url=base_url).write_pdf()


@router.get("/{qid}/pdf")
async def download_quote_pdf(qid: str, user=Depends(get_current_user), db: AsyncIOMotorDatabase = Depends(get_database)):
    """Streams the quote as a printable PDF (Content-Type: application/pdf)."""
    html, quote = await _build_quote_html(qid, user, db)
    pdf_bytes = _generate_pdf_bytes(
        html,
        header_html=quote.get("__header_html"),
        footer_html=quote.get("__footer_html"),
        header_height_mm=quote.get("__header_height_mm") or 22,
        footer_height_mm=quote.get("__footer_height_mm") or 18,
        layout_image_b64=quote.get("__layout_image_b64"),
        layout_image_mimetype=quote.get("__layout_image_mimetype"),
        layout_padding_top_mm=quote.get("__layout_padding_top_mm") or 40,
        layout_padding_bottom_mm=quote.get("__layout_padding_bottom_mm") or 30,
        layout_padding_x_mm=quote.get("__layout_padding_x_mm") or 18,
    )
    filename = f"orcamento-{quote.get('quote_number', qid)}.pdf"
    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


class SendQuoteRequest(BaseModel):
    connection_id: str
    phone: Optional[str] = None      # if absent, taken from quote.client.phone
    caption: Optional[str] = None    # text accompanying the document
    ticket_id: Optional[str] = None  # if set, message is logged on the ticket


WA_SERVICE_URL = os.environ.get("WA_SERVICE_URL", "http://localhost:3001")


@router.post("/{qid}/send-whatsapp")
async def send_quote_whatsapp(
    qid: str,
    data: SendQuoteRequest,
    user=Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Generates the PDF and forwards it as a WhatsApp document to the client.

    Resolves the destination phone in this order: explicit data.phone -> client
    record (via quote.client_id) -> ticket.customer_phone. Logs the outbound
    message on the ticket when ticket_id is provided so it appears in the chat
    timeline alongside text messages.
    """
    html, quote = await _build_quote_html(qid, user, db)

    # Resolve phone
    target_phone = data.phone
    if not target_phone and quote.get("client_id"):
        c = await db.clients.find_one({"id": quote["client_id"], "company_id": user["company_id"]}, {"_id": 0, "phone": 1})
        if c: target_phone = c.get("phone")
    if not target_phone and data.ticket_id:
        t = await db.tickets.find_one({"id": data.ticket_id, "company_id": user["company_id"]}, {"_id": 0, "customer_phone": 1})
        if t: target_phone = t.get("customer_phone")
    if not target_phone:
        raise HTTPException(400, "Telefone do destinatario nao informado e nao pode ser resolvido pelo cliente/ticket")

    # Verify connection belongs to tenant
    conn = await db.channel_connections.find_one(
        {"id": data.connection_id, "company_id": user["company_id"]}, {"_id": 0, "status": 1}
    )
    if not conn:
        raise HTTPException(404, "Conexao WhatsApp nao encontrada")

    pdf_bytes = _generate_pdf_bytes(
        html,
        header_html=quote.get("__header_html"),
        footer_html=quote.get("__footer_html"),
        header_height_mm=quote.get("__header_height_mm") or 22,
        footer_height_mm=quote.get("__footer_height_mm") or 18,
        layout_image_b64=quote.get("__layout_image_b64"),
        layout_image_mimetype=quote.get("__layout_image_mimetype"),
        layout_padding_top_mm=quote.get("__layout_padding_top_mm") or 40,
        layout_padding_bottom_mm=quote.get("__layout_padding_bottom_mm") or 30,
        layout_padding_x_mm=quote.get("__layout_padding_x_mm") or 18,
    )
    pdf_b64 = base64.b64encode(pdf_bytes).decode("utf-8")
    filename = f"orcamento-{quote.get('quote_number', qid)}.pdf"
    caption = data.caption or f"Segue orcamento #{quote.get('quote_number')} no valor de {_format_brl(quote.get('total_value', 0))}"

    # Forward to the WhatsApp microservice (/sendMedia endpoint)
    payload = {
        "phone": target_phone,
        "filename": filename,
        "mimetype": "application/pdf",
        "data_base64": pdf_b64,
        "caption": caption,
    }
    delivery_status = "pending"
    delivery_error = None
    wa_message_id = None
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(f"{WA_SERVICE_URL}/instances/{data.connection_id}/send-media", json=payload)
            if r.status_code == 200:
                rj = r.json()
                if rj.get("success"):
                    delivery_status = "sent"
                    wa_message_id = rj.get("message_id")
                else:
                    delivery_status = "failed"
                    delivery_error = rj.get("error") or "Microservico retornou success=false"
            else:
                delivery_status = "failed"
                delivery_error = f"HTTP {r.status_code}: {r.text[:300]}"
    except httpx.HTTPError as e:
        delivery_status = "failed"
        delivery_error = f"Falha de rede: {str(e)[:300]}"
        logger.warning("WA send-media failed for quote %s: %s", qid, delivery_error)

    # Log on ticket timeline (always, even on failure -> user can retry)
    if data.ticket_id:
        msg = {
            "id": str(uuid.uuid4()),
            "sender_type": "agent",
            "sender_id": user["id"],
            "content": caption,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "type": "document",
            "attachment_filename": filename,
            "attachment_kind": "quote_pdf",
            "quote_id": qid,
            "delivery_status": delivery_status,
            "delivery_error": delivery_error,
            "wa_message_id": wa_message_id,
        }
        await db.tickets.update_one(
            {"id": data.ticket_id, "company_id": user["company_id"]},
            {"$push": {"messages": msg}, "$set": {"updated_at": msg["created_at"]}},
        )

    # Update quote: status -> 'enviado' if it was draft, attach last sent metadata
    quote_update = {
        "last_sent_at": datetime.now(timezone.utc).isoformat(),
        "last_sent_phone": target_phone,
        "last_sent_status": delivery_status,
    }
    if quote.get("status") == "rascunho" and delivery_status == "sent":
        quote_update["status"] = "enviado"
    await db.quotes.update_one({"id": qid}, {"$set": quote_update})

    if delivery_status == "failed":
        # Avoid leaking raw stack/internal IPs to the client; full error stays
        # logged on the ticket and in our backend logger above.
        public_msg = "Microservico WhatsApp indisponivel ou nao conectado"
        if delivery_error and "Not connected" in delivery_error:
            public_msg = "Conexao WhatsApp nao esta conectada — escaneie o QR e tente novamente"
        elif delivery_error and "404" in delivery_error and "send-media" in delivery_error:
            public_msg = "Microservico WhatsApp ainda nao foi atualizado (redeploy pendente)"
        raise HTTPException(502, f"Falha ao enviar via WhatsApp: {public_msg}")
    return {"success": True, "delivery_status": delivery_status, "wa_message_id": wa_message_id, "filename": filename}
