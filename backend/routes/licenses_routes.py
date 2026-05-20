"""
Licenses catalog — Super Admin scope.

A License is a sellable bundle that grants a Company a fixed number of
connections (`connections_qty`) and/or users (`users_qty`). Companies
reference licenses through `company.licenses: [{license_id, qty, custom_sale_price?}]`,
and the company's `max_connections` / `max_users` are computed as
sum(license.connections_qty * cl.qty) and sum(license.users_qty * cl.qty).

This module exposes a thin CRUD + a helper for downstream code that needs
to recompute totals.
"""
from typing import Optional
from datetime import datetime, timezone
import uuid

from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase

from auth import require_super_admin
from database import get_database
from models import LicenseCreate, LicenseUpdate

router = APIRouter(prefix="/super-admin/licenses", tags=["super-admin-licenses"])


@router.get("")
async def list_licenses(
    include_inactive: bool = False,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    q = {} if include_inactive else {"is_active": {"$ne": False}}
    rows = await db.licenses.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return rows


@router.post("")
async def create_license(
    data: LicenseCreate,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    if data.connections_qty < 0 or data.users_qty < 0:
        raise HTTPException(400, "Quantidades nao podem ser negativas")
    if data.connections_qty == 0 and data.users_qty == 0:
        raise HTTPException(400, "A licenca precisa conceder ao menos 1 conexao ou 1 usuario")
    doc = {
        "id": str(uuid.uuid4()),
        "name": data.name,
        "description": data.description,
        "connections_qty": int(data.connections_qty),
        "users_qty": int(data.users_qty),
        "cost": float(data.cost or 0),
        "sale_price": float(data.sale_price or 0),
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.licenses.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@router.put("/{license_id}")
async def update_license(
    license_id: str,
    data: LicenseUpdate,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    existing = await db.licenses.find_one({"id": license_id})
    if not existing:
        raise HTTPException(404, "Licenca nao encontrada")
    patch = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if patch:
        await db.licenses.update_one({"id": license_id}, {"$set": patch})
    updated = await db.licenses.find_one({"id": license_id}, {"_id": 0})
    return updated


@router.delete("/{license_id}")
async def delete_license(
    license_id: str,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    # Refuse hard-delete if any company references it — preserves
    # historical sale prices for the financial trail. Soft-deactivate instead.
    referenced = await db.companies.find_one(
        {"licenses.license_id": license_id},
        {"_id": 0, "id": 1},
    )
    if referenced:
        await db.licenses.update_one({"id": license_id}, {"$set": {"is_active": False}})
        return {"soft_deleted": True, "reason": "Licenca em uso por uma ou mais empresas — desativada"}
    res = await db.licenses.delete_one({"id": license_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Licenca nao encontrada")
    return {"deleted": True}


# ── Helpers used elsewhere ──────────────────────────────────────────────

async def compute_company_limits(
    db: AsyncIOMotorDatabase,
    company_licenses: list,
) -> tuple[int, int, float, float]:
    """Given a company's licenses list (CompanyLicense dicts), returns
    (max_connections, max_users, total_cost, total_sale_price).

    Per-license breakdown:
      - max_connections += license.connections_qty * cl.qty
      - max_users       += license.users_qty       * cl.qty
      - total_cost      += license.cost            * cl.qty
      - total_sale_price+= cl.custom_sale_price OR (license.sale_price * cl.qty)
    """
    if not company_licenses:
        return 0, 0, 0.0, 0.0
    ids = list({cl.get("license_id") for cl in company_licenses if cl.get("license_id")})
    if not ids:
        return 0, 0, 0.0, 0.0
    license_rows = await db.licenses.find({"id": {"$in": ids}}, {"_id": 0}).to_list(1000)
    license_by_id = {row["id"]: row for row in license_rows}

    max_conn = 0
    max_usr = 0
    total_cost = 0.0
    total_sale = 0.0
    for cl in company_licenses:
        lic = license_by_id.get(cl.get("license_id"))
        if not lic:
            continue
        qty = max(int(cl.get("qty") or 1), 1)
        max_conn += int(lic.get("connections_qty") or 0) * qty
        max_usr += int(lic.get("users_qty") or 0) * qty
        total_cost += float(lic.get("cost") or 0) * qty
        custom = cl.get("custom_sale_price")
        if custom is not None:
            total_sale += float(custom)
        else:
            total_sale += float(lic.get("sale_price") or 0) * qty
    return max_conn, max_usr, round(total_cost, 2), round(total_sale, 2)


async def compute_company_usage(
    db: AsyncIOMotorDatabase,
    company_id: str,
) -> tuple[int, int]:
    """Returns (used_connections, used_users) for a company.
    - used_connections: number of WhatsApp/Instagram connections currently
      provisioned for the company (any status). Stored in `channel_connections`.
    - used_users:       number of company_users (excluding soft-deleted).
    """
    used_conn = await db.channel_connections.count_documents({"company_id": company_id})
    used_usr = await db.company_users.count_documents({"company_id": company_id})
    return used_conn, used_usr


async def enforce_company_limit(
    db: AsyncIOMotorDatabase,
    company_id: str,
    resource: str,  # 'connection' | 'user'
) -> None:
    """Raises HTTPException(403) if creating one more `resource` for this
    company would exceed its license-derived limit. Reads `max_connections`/
    `max_users` straight from the company doc — those are kept in sync by
    `compute_company_limits` whenever licenses are saved. Companies created
    BEFORE this feature shipped have no limit (max=None) and pass through.
    """
    from fastapi import HTTPException
    company = await db.companies.find_one(
        {"id": company_id},
        {"_id": 0, "max_connections": 1, "max_users": 1},
    )
    if not company:
        return  # let the caller fail with its own 404
    used_conn, used_usr = await compute_company_usage(db, company_id)
    if resource == "connection":
        cap = company.get("max_connections")
        if cap is not None and used_conn >= int(cap):
            raise HTTPException(
                status_code=403,
                detail=f"Limite de conexoes atingido ({used_conn}/{cap}). Entre em contato com o suporte da 8iP.",
            )
    elif resource == "user":
        cap = company.get("max_users")
        if cap is not None and used_usr >= int(cap):
            raise HTTPException(
                status_code=403,
                detail=f"Limite de usuarios atingido ({used_usr}/{cap}). Entre em contato com o suporte da 8iP.",
            )


@router.get("/usage/{company_id}", tags=["super-admin-licenses"])
async def company_usage(
    company_id: str,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    """Returns current consumption vs limit for a company. Used by the
    Empresa modal and Lancamento form to render "X usadas / Y permitidas"
    inline counters."""
    company = await db.companies.find_one(
        {"id": company_id},
        {"_id": 0, "licenses": 1, "max_connections": 1, "max_users": 1},
    )
    if not company:
        raise HTTPException(404, "Empresa nao encontrada")
    max_conn, max_usr, total_cost, total_sale = await compute_company_limits(
        db, company.get("licenses") or []
    )
    # Allow manual override stored on company doc (operator may grant +/- on
    # top of the license-derived totals — useful for one-off concessions).
    if company.get("max_connections") is not None:
        max_conn = int(company["max_connections"])
    if company.get("max_users") is not None:
        max_usr = int(company["max_users"])
    used_conn, used_usr = await compute_company_usage(db, company_id)
    return {
        "company_id": company_id,
        "max_connections": max_conn,
        "max_users": max_usr,
        "used_connections": used_conn,
        "used_users": used_usr,
        "total_cost": total_cost,
        "total_sale_price": total_sale,
    }
