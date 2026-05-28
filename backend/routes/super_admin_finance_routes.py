"""
Super Admin Financial Module — Phase 3.

Aggregates the SaaS owner's view of the business:
  • Receita: paid invoices in the period (from `invoices`)
  • Custos: license_cost x active referenced clients (from `subscription_plans` x `companies`)
            + commissions credited to partners (from `partner_commissions`)
            + manual expenses logged by the SuperAdmin (`super_admin_expenses`)
  • Lucro Liquido = Receita − Custos

Also exposes:
  • CRUD for manual expenses
  • List of partner commissions with paid / pending filter
  • Operational impersonation: opens a company panel as the SuperAdmin's own
    "operational company" so they can use modules (Kanban, Integrations, etc.)
"""
from datetime import datetime, timezone, timedelta, date
from typing import List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, Field

from auth import require_super_admin, create_access_token
from database import get_database

router = APIRouter(prefix="/super-admin", tags=["super-admin-finance"])


# ── Helpers ─────────────────────────────────────────────────────────────

def _month_bounds(month: Optional[str]) -> tuple[str, str]:
    """Returns (start_iso, end_iso) for a YYYY-MM month. Defaults to current
    month. End is the first day of the next month (exclusive)."""
    if month:
        try:
            y, m = month.split("-")
            base = datetime(int(y), int(m), 1, tzinfo=timezone.utc)
        except Exception:
            raise HTTPException(400, "month deve ser YYYY-MM")
    else:
        now = datetime.now(timezone.utc)
        base = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    next_month = (base.replace(day=28) + timedelta(days=4)).replace(day=1)
    return base.date().isoformat(), next_month.date().isoformat()


# ── Manual Expenses CRUD ────────────────────────────────────────────────

class ExpenseIn(BaseModel):
    description: str = Field(..., min_length=1)
    amount: float
    date: str  # YYYY-MM-DD
    category: Optional[str] = None  # infra, marketing, salaries, taxes, other
    notes: Optional[str] = None


@router.get("/expenses")
async def list_expenses(
    month: Optional[str] = None,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    q: dict = {}
    if month:
        start, end = _month_bounds(month)
        q["date"] = {"$gte": start, "$lt": end}
    rows = await db.super_admin_expenses.find(q, {"_id": 0}).sort("date", -1).to_list(2000)
    total = sum(float(r.get("amount") or 0) for r in rows)
    return {"items": rows, "total": total}


@router.post("/expenses")
async def create_expense(
    data: ExpenseIn,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    doc = {
        "id": str(uuid.uuid4()),
        "description": data.description.strip(),
        "amount": max(0.0, float(data.amount or 0.0)),
        "date": data.date,
        "category": (data.category or "other").strip(),
        "notes": (data.notes or "").strip() or None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.super_admin_expenses.insert_one(doc)
    return await db.super_admin_expenses.find_one({"id": doc["id"]}, {"_id": 0})


@router.put("/expenses/{eid}")
async def update_expense(
    eid: str,
    data: ExpenseIn,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    update = {
        "description": data.description.strip(),
        "amount": max(0.0, float(data.amount or 0.0)),
        "date": data.date,
        "category": (data.category or "other").strip(),
        "notes": (data.notes or "").strip() or None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    r = await db.super_admin_expenses.update_one({"id": eid}, {"$set": update})
    if r.matched_count == 0:
        raise HTTPException(404, "Despesa nao encontrada")
    return await db.super_admin_expenses.find_one({"id": eid}, {"_id": 0})


@router.delete("/expenses/{eid}")
async def delete_expense(
    eid: str,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    r = await db.super_admin_expenses.delete_one({"id": eid})
    if r.deleted_count == 0:
        raise HTTPException(404, "Despesa nao encontrada")
    return {"ok": True}


# ── Partner commissions list (cross-partner) ────────────────────────────

@router.get("/partners/commissions")
async def list_all_commissions(
    status: Optional[str] = None,  # paid | pending
    month: Optional[str] = None,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    q: dict = {}
    if status == "paid":
        q["paid_to_partner"] = True
    elif status == "pending":
        q["paid_to_partner"] = False
    if month:
        start, end = _month_bounds(month)
        q["created_at"] = {"$gte": start, "$lt": end}
    rows = await db.partner_commissions.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)
    total = sum(float(r.get("amount") or 0) for r in rows)
    return {"items": rows, "total": total}


# ── Financial summary (the heart of Phase 3) ────────────────────────────

@router.get("/financial/summary")
async def financial_summary(
    month: Optional[str] = None,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    """Period-aware roll-up of revenue, costs and net result.

    Revenue: sum of `invoices.amount` where status='paid' and paid_at in period
             (falls back to due_date when paid_at is missing — legacy invoices).
    Costs:
      • License costs per active company in the period (subscription_plans.license_cost)
      • Partner commissions credited in the period (partner_commissions.amount)
      • Manual expenses recorded in the period (super_admin_expenses.amount)
    Per-company breakdown helps spot unprofitable customers.
    """
    start, end = _month_bounds(month)

    # ── Revenue (paid invoices) ────────────────────────────────────────
    paid_invoices = await db.invoices.find(
        {"status": "paid"},
        {"_id": 0, "amount": 1, "company_id": 1, "external_client_id": 1, "paid_at": 1, "due_date": 1, "id": 1, "description": 1},
    ).to_list(5000)
    revenue_in_period: list = []
    for inv in paid_invoices:
        ts = inv.get("paid_at") or inv.get("due_date") or ""
        if ts and start <= ts[:10] < end:
            revenue_in_period.append(inv)
    total_revenue = sum(float(i.get("amount") or 0) for i in revenue_in_period)

    # ── License costs (license_cost * active companies on each plan) ───
    plans = await db.subscription_plans.find(
        {}, {"_id": 0, "id": 1, "name": 1, "license_cost": 1, "billing_cycle": 1}
    ).to_list(500)
    plan_map = {p["id"]: p for p in plans}
    active_companies = await db.companies.find(
        {"status": {"$in": ["active", "trial"]}},
        {"_id": 0, "id": 1, "name": 1, "plan_id": 1, "business_type_id": 1, "status": 1},
    ).to_list(2000)

    license_breakdown: list = []
    total_license_cost = 0.0
    for c in active_companies:
        plan = plan_map.get(c.get("plan_id") or "")
        cost = float(plan.get("license_cost") or 0) if plan else 0.0
        if cost <= 0:
            continue
        # Yearly plans: amortize per month for fair monthly view
        cycle = (plan.get("billing_cycle") or "monthly").lower() if plan else "monthly"
        monthly = cost / 12.0 if cycle == "yearly" else cost
        total_license_cost += monthly
        license_breakdown.append({
            "company_id": c["id"],
            "company_name": c.get("name"),
            "plan_name": plan.get("name") if plan else None,
            "monthly_license_cost": round(monthly, 2),
        })
    license_breakdown.sort(key=lambda r: r["monthly_license_cost"], reverse=True)

    # ── Partner commissions credited in period ────────────────────────
    commissions = await db.partner_commissions.find(
        {"created_at": {"$gte": start, "$lt": end}},
        {"_id": 0},
    ).to_list(2000)
    total_commissions = sum(float(c.get("amount") or 0) for c in commissions)
    commissions_paid = sum(float(c.get("amount") or 0) for c in commissions if c.get("paid_to_partner"))
    commissions_pending = total_commissions - commissions_paid

    # ── Manual expenses ────────────────────────────────────────────────
    expenses = await db.super_admin_expenses.find(
        {"date": {"$gte": start, "$lt": end}},
        {"_id": 0},
    ).to_list(2000)
    total_expenses = sum(float(e.get("amount") or 0) for e in expenses)
    expenses_by_category: dict = {}
    for e in expenses:
        cat = e.get("category") or "other"
        expenses_by_category[cat] = expenses_by_category.get(cat, 0) + float(e.get("amount") or 0)

    # ── Per-company P&L breakdown ─────────────────────────────────────
    cmap = {c["id"]: c for c in active_companies}
    by_company: dict = {}
    for inv in revenue_in_period:
        cid = inv.get("company_id")
        if not cid:
            continue
        row = by_company.setdefault(cid, {
            "company_id": cid,
            "company_name": (cmap.get(cid) or {}).get("name") or "—",
            "revenue": 0.0,
            "license_cost": 0.0,
            "commission_cost": 0.0,
        })
        row["revenue"] += float(inv.get("amount") or 0)
    for lb in license_breakdown:
        cid = lb["company_id"]
        row = by_company.setdefault(cid, {
            "company_id": cid,
            "company_name": lb["company_name"] or "—",
            "revenue": 0.0,
            "license_cost": 0.0,
            "commission_cost": 0.0,
        })
        row["license_cost"] += lb["monthly_license_cost"]
    for c in commissions:
        cid = c.get("referred_company_id")
        if not cid:
            continue
        row = by_company.setdefault(cid, {
            "company_id": cid,
            "company_name": c.get("referred_company_name") or "—",
            "revenue": 0.0,
            "license_cost": 0.0,
            "commission_cost": 0.0,
        })
        row["commission_cost"] += float(c.get("amount") or 0)
    breakdown_rows = []
    for row in by_company.values():
        row["net"] = round(row["revenue"] - row["license_cost"] - row["commission_cost"], 2)
        row["revenue"] = round(row["revenue"], 2)
        row["license_cost"] = round(row["license_cost"], 2)
        row["commission_cost"] = round(row["commission_cost"], 2)
        breakdown_rows.append(row)
    breakdown_rows.sort(key=lambda r: r["net"], reverse=True)

    total_costs = round(total_license_cost + total_commissions + total_expenses, 2)
    net_profit = round(total_revenue - total_costs, 2)
    margin_pct = round((net_profit / total_revenue * 100.0), 2) if total_revenue > 0 else 0.0

    return {
        "period": {"start": start, "end": end, "month": month or start[:7]},
        "totals": {
            "revenue": round(total_revenue, 2),
            "license_cost": round(total_license_cost, 2),
            "commissions_total": round(total_commissions, 2),
            "commissions_paid": round(commissions_paid, 2),
            "commissions_pending": round(commissions_pending, 2),
            "manual_expenses": round(total_expenses, 2),
            "total_costs": total_costs,
            "net_profit": net_profit,
            "margin_pct": margin_pct,
        },
        "license_breakdown": license_breakdown,
        "expenses_by_category": expenses_by_category,
        "by_company": breakdown_rows,
        "invoices_count": len(revenue_in_period),
        "active_companies": len(active_companies),
    }


# ── Phase 2: Operational impersonation ────────────────────────────────

@router.post("/me/operational-impersonate")
async def impersonate_operational_company(
    db: AsyncIOMotorDatabase = Depends(get_database),
    sa: dict = Depends(require_super_admin),
):
    """Issues a tenant-scoped JWT for the company configured as
    `financial_manager_company_id` in super_admin_settings, so the SA can
    open it in a second tab and use the company modules (Kanban, Agenda,
    Integrations, etc.) for own management."""
    settings = await db.super_admin_settings.find_one({"_id": "singleton"}, {"_id": 0}) or {}
    target_id = settings.get("financial_manager_company_id")
    if not target_id:
        raise HTTPException(
            400,
            "Configure 'Empresa Operacional' em Configuracoes antes de acessar."
        )
    company = await db.companies.find_one({"id": target_id}, {"_id": 0})
    if not company:
        raise HTTPException(404, "Empresa operacional nao encontrada")
    # Pick a company admin; fallback to any user (mirrors the impersonate flow)
    admin = await db.company_users.find_one(
        {"company_id": target_id, "role": "company_admin"},
        {"_id": 0, "password": 0},
    ) or await db.company_users.find_one(
        {"company_id": target_id}, {"_id": 0, "password": 0}
    )
    if not admin:
        raise HTTPException(409, "A empresa operacional nao possui nenhum usuario cadastrado")
    token_data = {
        "sub": admin["id"],
        "type": "company_user",
        "role": admin["role"],
        "company_id": target_id,
        "impersonated_by": sa.get("id") or sa.get("sub"),
    }
    token = create_access_token(token_data, expires_delta=timedelta(minutes=120))
    return {
        "access_token": token,
        "token_type": "bearer",
        "company_slug": company.get("subdomain") or company.get("slug"),
        "company_name": company.get("name"),
    }



# ── Financeiro ADM: Contas a Pagar / Receber (super-admin scoped) ─────────
#
# Mirrors the company-level `/api/scheduling/financial/transactions` API but
# scoped to the SaaS operator itself: their own platform-running expenses
# (infra bills, contractors, taxes) and the receivables they emit to
# customers (mensalidades, setup fees) outside of the automated `invoices`
# stream. Stored in a SEPARATE collection so there's no cross-tenant leak.

class _RecurrenceIn(BaseModel):
    interval: str  # mensal | semanal | anual
    until: Optional[str] = None


class _LateFeeIn(BaseModel):
    enabled: bool = False
    multa_pct: float = 0.0
    juros_dia_pct: float = 0.0


class AdmTxnIn(BaseModel):
    direction: str  # 'entrada' | 'saida'
    description: str = Field(..., min_length=1)
    amount: float
    payment_method: Optional[str] = "outros"
    category: Optional[str] = "outros"
    date: str
    due_date: Optional[str] = None
    status: str = "pago"  # 'pago' | 'pendente'  (separado de `kind`)
    notes: Optional[str] = None
    recurrence: Optional[_RecurrenceIn] = None
    late_fee: Optional[_LateFeeIn] = None
    # 2026-02-18 — Desconto aplicado ao lancamento. Subtrai do `amount`
    # ao calcular `valor_devido`. Quando vem da licenca da empresa, eh
    # propagado em todos os lancamentos recorrentes daquela licenca.
    discount: Optional[float] = 0.0
    # Tipo do lancamento — 2026-02-15. 'licenca' associa o lancamento a uma
    # Empresa cadastrada (ou cliente externo); 'diversos' eh o lancamento
    # manual generico (modelo antigo). Existentes ficam sem kind = tratados
    # como diversos pelo frontend.
    kind: Optional[str] = None             # 'licenca' | 'diversos'
    company_id: Optional[str] = None       # quando kind=licenca e cliente nativo
    external_client_name: Optional[str] = None  # quando cliente externo
    # Auto-popular ao selecionar empresa nativa. Mantidos no doc pra audit
    # mesmo que a empresa mude os limites depois.
    license_connections: Optional[int] = None
    license_users: Optional[int] = None
    license_cost: Optional[float] = None
    license_sale_price: Optional[float] = None


class AdmTxnUpdate(BaseModel):
    direction: Optional[str] = None
    description: Optional[str] = None
    amount: Optional[float] = None
    payment_method: Optional[str] = None
    category: Optional[str] = None
    date: Optional[str] = None
    due_date: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    late_fee: Optional[_LateFeeIn] = None
    valor_recebido: Optional[float] = None  # 2026-02-16 (O)
    discount: Optional[float] = None  # 2026-02-18
    kind: Optional[str] = None
    company_id: Optional[str] = None
    external_client_name: Optional[str] = None
    license_connections: Optional[int] = None
    license_users: Optional[int] = None
    license_cost: Optional[float] = None
    license_sale_price: Optional[float] = None
    # 2026-05-26 — Permite editar varias parcelas em lote ("alterar todas
    # as proximas em aberto"). Valores: "this" (default, so a parcela
    # atual) ou "all" (esta + todas as pendentes da mesma serie de
    # recorrencia OU, na ausencia de recurrence_group_id, todas as
    # pendentes da mesma empresa + mesmo kind).
    scope: Optional[str] = None


@router.get("/finance/transactions")
async def adm_list_transactions(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    payment_method: Optional[str] = None,
    direction: Optional[str] = None,
    status: Optional[str] = None,
    kind: Optional[str] = None,
    company_id: Optional[str] = None,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    q: dict = {}
    if start_date:
        q["date"] = {"$gte": start_date}
    if end_date:
        q.setdefault("date", {})["$lte"] = end_date
    if payment_method:
        q["payment_method"] = payment_method
    if direction:
        q["direction"] = direction
    if status:
        q["status"] = status
    if kind:
        q["kind"] = kind
    if company_id:
        q["company_id"] = company_id
    rows = await db.super_admin_transactions.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)
    from finance_helpers import compute_late_fee_amount
    for t in rows:
        gross = float(t.get("amount") or 0)
        t.setdefault("direction", "entrada")
        t.setdefault("status", "pago")
        t["gross_amount"] = round(gross, 2)
        t["net_amount"] = round(gross, 2)
        lf = t.get("late_fee") or {}
        if t.get("status") == "pendente":
            # 2026-02-18 — Sempre computamos `late_fee_computed` quando
            # pendente (mesmo sem late_fee.enabled), para devolver
            # `valor_devido` ja descontado e habilitar UI consistente.
            t["late_fee_computed"] = compute_late_fee_amount(
                gross, t.get("due_date"),
                float(lf.get("multa_pct") or 0) if lf.get("enabled") else 0.0,
                float(lf.get("juros_dia_pct") or 0) if lf.get("enabled") else 0.0,
                discount=float(t.get("discount") or 0),
            )
    return rows


@router.post("/finance/transactions")
async def adm_create_transaction(
    data: AdmTxnIn,
    db: AsyncIOMotorDatabase = Depends(get_database),
    sa: dict = Depends(require_super_admin),
):
    if data.direction not in ("entrada", "saida"):
        raise HTTPException(400, "direction deve ser 'entrada' ou 'saida'")
    if data.status not in ("pago", "pendente"):
        raise HTTPException(400, "status deve ser 'pago' ou 'pendente'")

    from finance_helpers import generate_recurrence_dates
    dates_seq: list[str] = []
    recurrence_group: Optional[str] = None
    if data.recurrence:
        dates_seq = generate_recurrence_dates(
            data.due_date or data.date,
            data.recurrence.interval,
            data.recurrence.until,
        )
        if dates_seq:
            recurrence_group = str(uuid.uuid4())
    if not dates_seq:
        dates_seq = [data.due_date or data.date]

    inserted: list = []
    for idx, due_iso in enumerate(dates_seq):
        is_seed = (idx == 0)
        status = data.status if is_seed else "pendente"
        txn: dict = {
            "id": str(uuid.uuid4()),
            "direction": data.direction,
            "status": status,
            "amount": float(data.amount or 0),
            "payment_method": data.payment_method or "outros",
            "category": data.category or "outros",
            "description": data.description if is_seed else f"{data.description} ({idx+1}/{len(dates_seq)})",
            "date": due_iso if not is_seed else data.date,
            "due_date": due_iso,
            "notes": data.notes,
            "created_by": sa.get("id") or sa.get("sub"),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        if recurrence_group:
            txn["recurrence_group_id"] = recurrence_group
            txn["recurrence_interval"] = data.recurrence.interval
            txn["recurrence_index"] = idx
            txn["recurrence_total"] = len(dates_seq)
        if data.late_fee and data.late_fee.enabled:
            txn["late_fee"] = {
                "enabled": True,
                "multa_pct": float(data.late_fee.multa_pct or 0),
                "juros_dia_pct": float(data.late_fee.juros_dia_pct or 0),
            }
        # 2026-02-18 — Persiste discount em todas as parcelas (recorrentes
        # herdam o desconto pai).
        if data.discount is not None:
            txn["discount"] = float(data.discount or 0)
        # Lancamento Licenca metadata — 2026-02-15. Stored on EVERY recurrence
        # row so each invoice in a yearly cycle carries the same Empresa link
        # and license snapshot.
        if data.kind:
            txn["kind"] = data.kind
        if data.company_id:
            txn["company_id"] = data.company_id
        if data.external_client_name:
            txn["external_client_name"] = data.external_client_name
        for k in ("license_connections", "license_users", "license_cost", "license_sale_price"):
            v = getattr(data, k, None)
            if v is not None:
                txn[k] = v
        if status == "pago":
            txn["paid_at"] = datetime.now(timezone.utc).isoformat()
        await db.super_admin_transactions.insert_one(txn)
        inserted.append({k: v for k, v in txn.items() if k != "_id"})
    out = inserted[0]
    out["_siblings_created"] = len(inserted) - 1
    return out


@router.put("/finance/transactions/{txn_id}")
async def adm_update_transaction(
    txn_id: str,
    data: AdmTxnUpdate,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    update = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    scope = (update.pop("scope", None) or "this").lower()
    if "amount" in update:
        update["amount"] = float(update["amount"] or 0)
    if "status" in update and update["status"] == "pago":
        update["paid_at"] = datetime.now(timezone.utc).isoformat()
    if "late_fee" in update and isinstance(update["late_fee"], dict):
        update["late_fee"] = {
            "enabled": bool(update["late_fee"].get("enabled")),
            "multa_pct": float(update["late_fee"].get("multa_pct") or 0),
            "juros_dia_pct": float(update["late_fee"].get("juros_dia_pct") or 0),
        }
    r = await db.super_admin_transactions.update_one({"id": txn_id}, {"$set": update})
    if r.matched_count == 0:
        raise HTTPException(404, "Lancamento nao encontrado")
    siblings_updated = 0
    # 2026-05-26 — scope=all: replica a edicao para todas as PENDENTES da
    # mesma serie. Campos especificos de cada parcela (date, due_date,
    # status, paid_at, valor_recebido) sao removidos do payload de replica.
    if scope == "all":
        bulk_payload = {
            k: v for k, v in update.items()
            if k not in ("date", "due_date", "status", "paid_at", "valor_recebido")
        }
        if bulk_payload:
            current = await db.super_admin_transactions.find_one({"id": txn_id}, {"_id": 0})
            sibling_q: dict = {"status": "pendente", "id": {"$ne": txn_id}}
            if current and current.get("recurrence_group_id"):
                sibling_q["recurrence_group_id"] = current["recurrence_group_id"]
            elif current and current.get("company_id"):
                sibling_q["company_id"] = current["company_id"]
                if current.get("kind"):
                    sibling_q["kind"] = current["kind"]
            else:
                sibling_q = None  # sem chave segura para identificar irmaos
            if sibling_q is not None:
                br = await db.super_admin_transactions.update_many(
                    sibling_q, {"$set": bulk_payload}
                )
                siblings_updated = br.modified_count
    out = await db.super_admin_transactions.find_one({"id": txn_id}, {"_id": 0})
    if out is not None:
        out["_siblings_updated"] = siblings_updated
    return out


@router.post("/finance/transactions/{txn_id}/pay")
async def adm_mark_paid(
    txn_id: str,
    payload: dict = None,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    """Marca o lancamento como pago. Body opcional:
       - `payment_method`: Pix/Boleto/Dinheiro (atualiza junto com a baixa).
       - `valor_recebido`: valor efetivamente recebido (2026-02-16 (O)).
         Permite registrar diferenca em relacao ao valor original (multa
         cobrada parcialmente, desconto concedido, etc.). Sempre salvo
         como auditoria; quando ausente eh inferido como o `amount` do
         proprio lancamento.
    """
    update = {
        "status": "pago",
        "paid_at": datetime.now(timezone.utc).isoformat(),
    }
    if isinstance(payload, dict):
        if payload.get("payment_method"):
            update["payment_method"] = payload["payment_method"]
        if payload.get("valor_recebido") is not None:
            try:
                update["valor_recebido"] = float(payload["valor_recebido"])
            except (TypeError, ValueError):
                raise HTTPException(400, "valor_recebido invalido")
    r = await db.super_admin_transactions.update_one(
        {"id": txn_id}, {"$set": update}
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Lancamento nao encontrado")
    return await db.super_admin_transactions.find_one({"id": txn_id}, {"_id": 0})


@router.post("/finance/transactions/{txn_id}/unpay")
async def adm_mark_unpaid(
    txn_id: str,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    """Desfaz a baixa — volta ao estado 'aberto/pendente'. Usado pelo
    botao 'Desfazer' do toast (2026-02-15 (E))."""
    r = await db.super_admin_transactions.update_one(
        {"id": txn_id},
        {"$set": {"status": "pendente"}, "$unset": {"paid_at": ""}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Lancamento nao encontrado")
    return await db.super_admin_transactions.find_one({"id": txn_id}, {"_id": 0})


@router.post("/finance/transactions/{txn_id}/observation")
async def adm_add_observation(
    txn_id: str,
    payload: dict,
    db: AsyncIOMotorDatabase = Depends(get_database),
    sa: dict = Depends(require_super_admin),
):
    """2026-02-18 — Adiciona uma entrada ao historico de observacoes do
    lancamento. Cada entrada eh imutavel e carimba data/autor.
    Body: {"text": "..."}
    """
    text = (payload or {}).get("text", "").strip() if isinstance(payload, dict) else ""
    if not text:
        raise HTTPException(400, "text obrigatorio")
    entry = {
        "id": str(uuid.uuid4()),
        "text": text,
        "author_id": sa.get("id") or sa.get("sub"),
        "author_name": sa.get("name") or sa.get("email") or "Super Admin",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    r = await db.super_admin_transactions.update_one(
        {"id": txn_id},
        {"$push": {"observations": entry}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Lancamento nao encontrado")
    return await db.super_admin_transactions.find_one({"id": txn_id}, {"_id": 0})


@router.delete("/finance/transactions/{txn_id}")
async def adm_delete_transaction(
    txn_id: str,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    r = await db.super_admin_transactions.delete_one({"id": txn_id})
    if r.deleted_count == 0:
        raise HTTPException(404, "Lancamento nao encontrado")
    return {"ok": True}


@router.get("/finance/summary")
async def adm_finance_summary(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    q: dict = {}
    if start_date:
        q["date"] = {"$gte": start_date}
    if end_date:
        q.setdefault("date", {})["$lte"] = end_date
    rows = await db.super_admin_transactions.find(q, {"_id": 0}).to_list(5000)
    entradas = [t for t in rows if t.get("direction") == "entrada"]
    saidas = [t for t in rows if t.get("direction") == "saida"]
    bruto_entradas = sum(float(t.get("amount") or 0) for t in entradas if t.get("status") == "pago")
    bruto_saidas = sum(float(t.get("amount") or 0) for t in saidas if t.get("status") == "pago")
    pendentes_entrada = sum(float(t.get("amount") or 0) for t in entradas if t.get("status") == "pendente")
    pendentes_saida = sum(float(t.get("amount") or 0) for t in saidas if t.get("status") == "pendente")
    by_method: dict = {}
    for t in entradas:
        if t.get("status") != "pago":
            continue
        pm = t.get("payment_method") or "outros"
        by_method[pm] = round(by_method.get(pm, 0.0) + float(t.get("amount") or 0), 2)
    return {
        "bruto": round(bruto_entradas, 2),
        "saidas": round(bruto_saidas, 2),
        "liquido": round(bruto_entradas - bruto_saidas, 2),
        "pendente_entrada": round(pendentes_entrada, 2),
        "pendente_saida": round(pendentes_saida, 2),
        "transaction_count": len(rows),
        "ticket_medio": round(bruto_entradas / len(entradas), 2) if entradas else 0,
        "by_payment_method": by_method,
    }



# ────────────────────────────────────────────────────────────────────────
# 2026-02-18 — Resync em batch de parcelas pendentes (refletir alteracoes
# de total_sale_price/discount/licenses em todas as empresas existentes)
# ────────────────────────────────────────────────────────────────────────
@router.post("/finance/resync-pending-parcelas")
async def adm_resync_pending_parcelas(
    company_id: Optional[str] = None,
    notify: bool = False,  # 2026-05-27 — quando True, envia UMA mensagem manual apos resync
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    """Deleta parcelas pendentes auto-geradas e re-cria via scheduler com
    os valores atualizados (`total_sale_price - discount`).

    Quando `company_id` eh informado, o resync afeta SOMENTE a empresa
    referenciada — usado pelo fluxo "Editar empresa → atualizar lancamentos
    em aberto". Sem `company_id`, faz o resync global (todas as empresas).

    Parcelas com status=pago sao PRESERVADAS — somente as pendentes geradas
    automaticamente sao recriadas. Lancamentos manuais avulsos (kind=diversos)
    tambem sao preservados.
    """
    base_q: dict = {
        "status": "pendente",
        "auto_company_billing": True,
    }
    if company_id:
        base_q["company_id"] = company_id
    # Conta antes pra logging
    pre_count = await db.super_admin_transactions.count_documents(base_q)
    # Deleta pendentes auto-geradas (preservando pagas e lancamentos manuais)
    res = await db.super_admin_transactions.delete_many(base_q)
    # Recria via scheduler (send_messages=False — esta operacao NAO envia
    # mensagem aqui; o operador escolhe via `notify=True` se quer enviar 1
    # mensagem manual abaixo). suppress_auto=True marca as parcelas com
    # `auto_notify=False` para o scheduler periodico tambem nao enviar
    # (resolve o "envio duplicado" reportado em 2026-05-27).
    try:
        from scheduler import _process_billing_reminders
        await _process_billing_reminders(db, send_messages=False, suppress_auto=True)
    except Exception as e:
        raise HTTPException(500, f"Falha ao regerar parcelas: {e}")
    post_q: dict = {
        "status": "pendente",
        "auto_company_billing": True,
    }
    if company_id:
        post_q["company_id"] = company_id
    post_count = await db.super_admin_transactions.count_documents(post_q)

    # 2026-05-27 — Envio manual UNICO quando o operador marca "Notificar
    # cliente". Pega a parcela em aberto mais antiga (proxima a vencer)
    # de cada empresa afetada e envia 1 mensagem.
    notified = 0
    notify_errors = []
    if notify and (company_id or post_count > 0):
        # late import — evita ciclo com super_admin_routes
        from routes.super_admin_routes import resend_transaction_reminder
        company_filter = {"company_id": company_id} if company_id else {}
        pipeline = [
            {"$match": {
                "auto_company_billing": True,
                "status": "pendente",
                **company_filter,
            }},
            {"$sort": {"due_date": 1}},
            {"$group": {
                "_id": "$company_id",
                "txn_id": {"$first": "$id"},
            }},
        ]
        groups = await db.super_admin_transactions.aggregate(pipeline).to_list(500)
        for g in groups:
            try:
                # Chama o handler diretamente — Depends nao sao
                # resolvidos pq estamos invocando como funcao normal.
                # `_` (require_super_admin) eh ignorado no corpo.
                await resend_transaction_reminder(g["txn_id"], _=None, db=db)
                notified += 1
            except Exception as e:
                notify_errors.append(f"{g.get('_id','?')[:8]}: {e}")
    return {
        "ok": True,
        "deleted": res.deleted_count,
        "created": post_count,
        "pre_count": pre_count,
        "notified": notified,
        "notify_errors": notify_errors,
    }




# ────────────────────────────────────────────────────────────────────────
# 2026-02-18 — Relatorio Empresas (rentabilidade + status de cobranca)
# ────────────────────────────────────────────────────────────────────────
@router.get("/reports/companies")
async def adm_report_companies(
    period: str = "current_month",
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    database_type: Optional[str] = None,
    q: Optional[str] = None,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    """Relatorio Empresas. Cada linha: empresa, custo das licencas, valor de
    venda, lucro (venda - custo), proxima parcela do periodo, status (em X
    dias / atrasado Y dias / pago).
    """
    today = datetime.utcnow().date()
    if period == "current_month":
        start = today.replace(day=1)
        if start.month == 12:
            end = date(start.year + 1, 1, 1) - timedelta(days=1)
        else:
            end = date(start.year, start.month + 1, 1) - timedelta(days=1)
    elif period == "last_month":
        first_this = today.replace(day=1)
        end = first_this - timedelta(days=1)
        start = end.replace(day=1)
    elif period == "custom":
        try:
            start = datetime.strptime(date_from, "%Y-%m-%d").date() if date_from else today.replace(day=1)
            end = datetime.strptime(date_to, "%Y-%m-%d").date() if date_to else today
        except Exception:
            raise HTTPException(400, "date_from/date_to invalidos (YYYY-MM-DD)")
    else:
        raise HTTPException(400, "period invalido")
    start_iso = start.isoformat()
    end_iso = end.isoformat()

    licenses: list = []
    for coll_name in ("licenses", "super_admin_licenses", "license_catalog"):
        try:
            col = getattr(db, coll_name)
            licenses = await col.find({}, {"_id": 0}).to_list(500)
            if licenses:
                break
        except Exception:
            pass
    lic_by_id = {lic.get("id"): lic for lic in (licenses or [])}

    cq: dict = {"is_super_admin_system": {"$ne": True}}
    if database_type:
        cq["database_type"] = database_type
    if q:
        rx = {"$regex": q, "$options": "i"}
        cq["$or"] = [{"name": rx}, {"email": rx}, {"representante": rx}, {"phone": rx}]

    rows: List[dict] = []
    async for c in db.companies.find(cq, {
        "_id": 0, "id": 1, "name": 1, "representante": 1, "email": 1,
        "database_type": 1, "licenses": 1, "discount": 1,
        "total_sale_price": 1, "monthly_price": 1, "first_due_date": 1,
        "status": 1, "max_connections": 1, "max_users": 1,
    }):
        custo = 0.0
        venda = 0.0
        for a in (c.get("licenses") or []):
            lic = lic_by_id.get(a.get("license_id")) or {}
            qty = int(a.get("qty") or 1)
            custo += float(lic.get("cost") or 0) * qty
            unit_sale = (
                float(a.get("custom_sale_price"))
                if a.get("custom_sale_price") is not None
                else float(lic.get("sale_price") or 0)
            )
            venda += unit_sale * qty
        _tsp = float(c.get("total_sale_price") or 0)
        if _tsp > 0:
            venda = _tsp
        desconto = float(c.get("discount") or 0)
        valor_devido = max(0.0, venda - desconto)
        lucro = venda - custo

        parcela = await db.super_admin_transactions.find_one(
            {
                "company_id": c["id"],
                "direction": "entrada",
                "due_date": {"$gte": start_iso, "$lte": end_iso},
            },
            {"_id": 0, "status": 1, "due_date": 1, "amount": 1, "paid_at": 1},
            sort=[("due_date", 1)],
        )

        status_label = "sem_cobranca"
        days_to_due = None
        if parcela:
            due_iso = parcela.get("due_date") or ""
            if (parcela.get("status") or "").lower() == "pago":
                status_label = "pago"
            else:
                try:
                    d = datetime.strptime(due_iso, "%Y-%m-%d").date()
                    days_to_due = (d - today).days
                    if days_to_due < 0:
                        status_label = "atrasado"
                    elif days_to_due == 0:
                        status_label = "vence_hoje"
                    else:
                        status_label = "em_dia"
                except Exception:
                    pass

        rows.append({
            "company_id": c["id"],
            "company_name": c.get("name") or "",
            "representante": c.get("representante") or "",
            "database_type": c.get("database_type") or "Padrao",
            "custo": round(custo, 2),
            "venda": round(venda, 2),
            "desconto": round(desconto, 2),
            "valor_devido": round(valor_devido, 2),
            "lucro": round(lucro, 2),
            "due_date": parcela.get("due_date") if parcela else None,
            "status": status_label,
            "days_to_due": days_to_due,
            # 2026-02-18 — Totais de licenca por empresa, alimentam cards
            # "Conexoes / Empresa" e "Usuarios / Empresa" no relatorio.
            "max_connections": int(c.get("max_connections") or 0),
            "max_users": int(c.get("max_users") or 0),
        })

    rows.sort(key=lambda r: (
        {"atrasado": 0, "vence_hoje": 1, "em_dia": 2, "pago": 3, "sem_cobranca": 4}.get(r["status"], 5),
        r["days_to_due"] if r["days_to_due"] is not None else 9999,
    ))

    totals = {
        "custo_total": round(sum(r["custo"] for r in rows), 2),
        "venda_total": round(sum(r["venda"] for r in rows), 2),
        "lucro_total": round(sum(r["lucro"] for r in rows), 2),
        "atrasado_count": sum(1 for r in rows if r["status"] == "atrasado"),
        "em_dia_count": sum(1 for r in rows if r["status"] == "em_dia"),
        "pago_count": sum(1 for r in rows if r["status"] == "pago"),
        # 2026-02-18 — Totais agregados de licencas
        "company_count": len(rows),
        "connections_total": sum(r["max_connections"] for r in rows),
        "users_total": sum(r["max_users"] for r in rows),
    }
    return {
        "period": period,
        "start": start_iso,
        "end": end_iso,
        "rows": rows,
        "totals": totals,
    }
