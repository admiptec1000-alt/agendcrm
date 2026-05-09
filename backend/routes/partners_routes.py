"""Partner / Referral system.

Workflow:
 - SuperAdmin marks a company as `is_partner=true` and sets a custom
   `partner_commission_pct` (e.g. 20%). The company is given a stable
   `referral_code` (8-char base32, deterministic from id, immutable).
 - The partner shares a public URL `https://<host>/r/<code>` which lands on
   the marketing site / register form with the code stored in localStorage.
 - When a new company signs up, the registration endpoint reads the cookie
   and writes `referred_by` (the partner's referral_code) on the new company.
 - Whenever an invoice of a referred company is marked PAID, a commission
   transaction is created on the partner's "wallet" (collection
   `partner_commissions`) — recurring per the chosen plan.
 - Partner views: total active referrals, paid referrals this month,
   accrued commission, ready-to-copy referral link.

This file owns the public landing endpoint, the partner-facing endpoints
(consumed by the partner's company panel) and the SuperAdmin toggle.
"""
import string
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel

from auth import get_current_user, require_super_admin
from database import get_database

router = APIRouter()


# ── Helpers ──────────────────────────────────────────────────────────────

def _generate_code(seed: str) -> str:
    """Deterministic, 8-char alphanumeric code derived from a UUID. Stable so
    even if we lose the field we can re-derive it."""
    alphabet = string.ascii_uppercase + string.digits
    s = seed.replace("-", "")
    out = []
    for i in range(0, 16, 2):
        out.append(alphabet[int(s[i:i + 2], 16) % len(alphabet)])
    return "".join(out)


async def _ensure_referral_code(db, company: dict) -> str:
    code = company.get("referral_code")
    if code:
        return code
    code = _generate_code(company["id"])
    # Collision guard (extremely unlikely with 32^8 = 1T)
    if await db.companies.find_one({"referral_code": code}):
        code = _generate_code(str(uuid.uuid4()))
    await db.companies.update_one({"id": company["id"]}, {"$set": {"referral_code": code}})
    return code


# ── SuperAdmin: toggle partner & set commission ────────────────────────

class PartnerConfigIn(BaseModel):
    is_partner: bool
    partner_commission_pct: Optional[float] = None  # 0..100
    partner_recurring: Optional[bool] = True
    partner_notes: Optional[str] = None


@router.put("/super-admin/companies/{company_id}/partner")
async def set_partner_config(
    company_id: str,
    data: PartnerConfigIn,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _admin: dict = Depends(require_super_admin),
):
    company = await db.companies.find_one({"id": company_id}, {"_id": 0})
    if not company:
        raise HTTPException(404, "Empresa nao encontrada")
    patch: dict = {
        "is_partner": bool(data.is_partner),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if data.partner_commission_pct is not None:
        pct = max(0.0, min(100.0, float(data.partner_commission_pct)))
        patch["partner_commission_pct"] = pct
    if data.partner_recurring is not None:
        patch["partner_recurring"] = bool(data.partner_recurring)
    if data.partner_notes is not None:
        patch["partner_notes"] = data.partner_notes.strip()
    if data.is_partner and not company.get("referral_code"):
        patch["referral_code"] = await _ensure_referral_code(db, company)
    await db.companies.update_one({"id": company_id}, {"$set": patch})
    fresh = await db.companies.find_one({"id": company_id}, {"_id": 0})
    return fresh


@router.get("/super-admin/partners")
async def list_partners(
    db: AsyncIOMotorDatabase = Depends(get_database),
    _admin: dict = Depends(require_super_admin),
):
    """Lists all partner companies with aggregate referral stats so SuperAdmin
    can see who is bringing in revenue at a glance."""
    partners = await db.companies.find({"is_partner": True}, {"_id": 0}).to_list(500)
    out = []
    for p in partners:
        # Count active referred companies
        referred_count = await db.companies.count_documents({"referred_by": p.get("referral_code")})
        active_referred = await db.companies.count_documents({"referred_by": p.get("referral_code"), "status": "active"})
        # Total commission generated
        agg = await db.partner_commissions.aggregate([
            {"$match": {"partner_company_id": p["id"]}},
            {"$group": {"_id": None, "total": {"$sum": "$amount"}, "count": {"$sum": 1}}},
        ]).to_list(1)
        commission_total = (agg[0]["total"] if agg else 0)
        commission_count = (agg[0]["count"] if agg else 0)
        out.append({
            **p,
            "referred_count": referred_count,
            "active_referred_count": active_referred,
            "commission_total": commission_total,
            "commission_count": commission_count,
        })
    return out


# ── Partner-facing dashboard (called from inside a partner's panel) ────

@router.get("/partner/dashboard")
async def partner_dashboard(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Returns the partner's stats + referral link. Only callable by a user
    whose company is flagged `is_partner=true`."""
    company = await db.companies.find_one({"id": user["company_id"]}, {"_id": 0})
    if not company or not company.get("is_partner"):
        raise HTTPException(403, "Sua empresa nao e um parceiro. Solicite ao admin da plataforma.")
    code = await _ensure_referral_code(db, company)

    referred = await db.companies.find(
        {"referred_by": code},
        {"_id": 0, "id": 1, "name": 1, "email": 1, "status": 1, "created_at": 1, "plan_id": 1},
    ).sort("created_at", -1).to_list(500)

    # Aggregate commissions by month for the chart
    commissions = await db.partner_commissions.find(
        {"partner_company_id": company["id"]},
        {"_id": 0},
    ).sort("created_at", -1).to_list(1000)

    total_received = sum(c.get("amount", 0) for c in commissions if c.get("paid_to_partner"))
    total_pending = sum(c.get("amount", 0) for c in commissions if not c.get("paid_to_partner"))
    by_month: dict = {}
    for c in commissions:
        ym = (c.get("created_at") or "")[:7]
        by_month[ym] = by_month.get(ym, 0) + c.get("amount", 0)

    settings = await db.platform_settings.find_one({}, {"_id": 0}) or {}
    base_url = (settings.get("public_base_url") or "").rstrip("/")
    referral_link = f"{base_url}/r/{code}" if base_url else f"/r/{code}"

    return {
        "company": {"id": company["id"], "name": company.get("name")},
        "referral_code": code,
        "referral_link": referral_link,
        "commission_pct": company.get("partner_commission_pct", 0),
        "commission_recurring": company.get("partner_recurring", True),
        "stats": {
            "total_referrals": len(referred),
            "active_referrals": sum(1 for r in referred if r.get("status") == "active"),
            "total_received": total_received,
            "total_pending": total_pending,
            "by_month": by_month,
        },
        "referrals": referred,
        "commissions": commissions,
    }


# ── Public landing: /r/<code> ────────────────────────────────────────────

@router.get("/r/{code}")
async def landing_referral(
    code: str,
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Public referral landing. Validates the code and bounces the visitor to
    the registration page with the code as a query string. The frontend then
    persists it in localStorage before the visitor finishes signup.
    """
    company = await db.companies.find_one({"referral_code": code, "is_partner": True}, {"_id": 0, "id": 1, "name": 1})
    if not company:
        # Don't leak whether codes exist — generic redirect to homepage
        return RedirectResponse(url="/", status_code=302)
    # Track click
    await db.referral_clicks.insert_one({
        "id": str(uuid.uuid4()),
        "code": code,
        "partner_company_id": company["id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return RedirectResponse(url=f"/registrar?ref={code}", status_code=302)


# ── Helper exported for the invoices flow ──────────────────────────────

async def credit_commission_for_invoice(db, invoice: dict):
    """Called from the invoice-paid hook. If the invoice belongs to a company
    that was referred by an active partner, credits the configured commission
    to `partner_commissions` and decides whether future invoices will keep
    crediting (recurring) or only the first one (one-shot).
    """
    company = await db.companies.find_one({"id": invoice["company_id"]}, {"_id": 0})
    if not company or not company.get("referred_by"):
        return None
    partner = await db.companies.find_one(
        {"referral_code": company["referred_by"], "is_partner": True},
        {"_id": 0},
    )
    if not partner:
        return None
    pct = float(partner.get("partner_commission_pct") or 0)
    recurring = bool(partner.get("partner_recurring", True))
    if pct <= 0:
        return None
    # If non-recurring, only credit the first paid invoice
    if not recurring:
        existing = await db.partner_commissions.find_one({
            "partner_company_id": partner["id"],
            "referred_company_id": company["id"],
        })
        if existing:
            return None
    invoice_amount = float(invoice.get("amount") or invoice.get("value") or 0)
    commission_amount = round(invoice_amount * pct / 100.0, 2)
    doc = {
        "id": str(uuid.uuid4()),
        "partner_company_id": partner["id"],
        "partner_company_name": partner.get("name"),
        "referred_company_id": company["id"],
        "referred_company_name": company.get("name"),
        "invoice_id": invoice.get("id"),
        "invoice_amount": invoice_amount,
        "commission_pct": pct,
        "amount": commission_amount,
        "paid_to_partner": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.partner_commissions.insert_one(doc)
    return doc


# ── Manual settle endpoint for SuperAdmin ──────────────────────────────

class SettleIn(BaseModel):
    commission_ids: list[str]


@router.post("/super-admin/partners/settle")
async def settle_commissions(
    data: SettleIn,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _admin: dict = Depends(require_super_admin),
):
    """Marks selected commissions as paid out. The accompanying disbursement
    will be recorded as a Despesa in Financeiro Admin (Phase 2)."""
    if not data.commission_ids:
        raise HTTPException(400, "Selecione ao menos uma comissao")
    res = await db.partner_commissions.update_many(
        {"id": {"$in": data.commission_ids}, "paid_to_partner": False},
        {"$set": {
            "paid_to_partner": True,
            "paid_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    return {"ok": True, "settled": res.modified_count}
