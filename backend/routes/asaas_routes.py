"""Asaas (Brazilian fintech) integration routes.

Endpoints:
- GET/PUT /api/asaas/config — per-company credentials (api_key, environment, webhook_token)
- POST   /api/asaas/config/test — quick connectivity check
- POST   /api/asaas/customers — create customer (mirrors local client into Asaas)
- POST   /api/asaas/charges — create cobrança (Pix / Boleto / Cartão)
- GET    /api/asaas/charges/{id} — fetch charge status
- POST   /api/asaas/webhook/{company_id} — receive payment events from Asaas

Asaas auth: HTTP header `access_token: <api_key>` (per official docs, NOT Bearer).
Base URLs:
  sandbox    = https://sandbox.asaas.com/api/v3
  production = https://api.asaas.com/api/v3
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone
import httpx
import uuid

from database import get_database
from auth import get_current_user

router = APIRouter(prefix="/asaas", tags=["asaas"])

ENV_URLS = {
    "sandbox":    "https://sandbox.asaas.com/api/v3",
    "production": "https://api.asaas.com/api/v3",
}


def _headers(api_key: str) -> dict:
    return {"access_token": api_key, "Content-Type": "application/json"}


# === CONFIG =================================================================
class AsaasConfigIn(BaseModel):
    api_key: str
    environment: str = "sandbox"   # sandbox | production
    webhook_token: Optional[str] = None  # token sent by Asaas in webhook header
    enabled: bool = True


@router.get("/config")
async def get_asaas_config(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    cfg = await db.asaas_configs.find_one({"company_id": user["company_id"]}, {"_id": 0})
    if not cfg:
        return {"company_id": user["company_id"], "environment": "sandbox", "enabled": False, "api_key_masked": ""}
    key = cfg.get("api_key") or ""
    cfg["api_key_masked"] = (key[:6] + "•" * 8 + key[-4:]) if len(key) >= 10 else "•" * len(key)
    cfg.pop("api_key", None)
    cfg.pop("webhook_token", None)
    return cfg


@router.put("/config")
async def update_asaas_config(
    data: AsaasConfigIn,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    if (data.environment or "").lower() not in ENV_URLS:
        raise HTTPException(400, f"environment deve ser sandbox ou production")
    if not data.api_key.strip():
        raise HTTPException(400, "api_key obrigatório")
    payload = {
        "company_id": user["company_id"],
        "api_key": data.api_key.strip(),
        "environment": data.environment.lower(),
        "webhook_token": (data.webhook_token or "").strip() or None,
        "enabled": bool(data.enabled),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.asaas_configs.update_one(
        {"company_id": user["company_id"]},
        {"$set": payload, "$setOnInsert": {"created_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"ok": True, "message": "Configuração Asaas salva"}


@router.post("/config/test")
async def test_asaas_config(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    cfg = await db.asaas_configs.find_one({"company_id": user["company_id"]}, {"_id": 0})
    if not cfg or not cfg.get("api_key"):
        raise HTTPException(400, "Configure api_key primeiro")
    base = ENV_URLS[cfg.get("environment") or "sandbox"]
    try:
        async with httpx.AsyncClient(timeout=10.0) as cli:
            r = await cli.get(f"{base}/customers", params={"limit": 1}, headers=_headers(cfg["api_key"]))
        return {"ok": r.status_code < 400, "status": r.status_code, "environment": cfg.get("environment")}
    except Exception as e:
        raise HTTPException(502, f"Falha conectando ao Asaas: {e}")


async def _get_company_cfg(db, company_id: str):
    cfg = await db.asaas_configs.find_one({"company_id": company_id}, {"_id": 0})
    if not cfg or not cfg.get("enabled") or not cfg.get("api_key"):
        raise HTTPException(400, "Integração Asaas não configurada para esta empresa")
    return cfg


# === CUSTOMERS ==============================================================
class CustomerIn(BaseModel):
    name: str
    email: str
    phone: Optional[str] = None
    cpf_cnpj: Optional[str] = None
    client_id: Optional[str] = None  # local client id to link


@router.post("/customers")
async def create_customer(
    data: CustomerIn,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    cfg = await _get_company_cfg(db, user["company_id"])
    base = ENV_URLS[cfg["environment"]]
    payload = {"name": data.name, "email": data.email}
    if data.phone: payload["phone"] = data.phone
    if data.cpf_cnpj: payload["cpfCnpj"] = data.cpf_cnpj
    async with httpx.AsyncClient(timeout=20.0) as cli:
        r = await cli.post(f"{base}/customers", json=payload, headers=_headers(cfg["api_key"]))
    if r.status_code >= 400:
        raise HTTPException(r.status_code, r.text[:500])
    asaas_data = r.json()
    # Persist mapping locally for future lookups
    if data.client_id:
        await db.asaas_customer_links.update_one(
            {"company_id": user["company_id"], "client_id": data.client_id},
            {"$set": {"asaas_customer_id": asaas_data.get("id"), "updated_at": datetime.now(timezone.utc).isoformat()}},
            upsert=True,
        )
    return asaas_data


# === CHARGES (Cobranças) ====================================================
class ChargeIn(BaseModel):
    customer: str          # Asaas customer id (from POST /customers above)
    billing_type: str      # PIX | BOLETO | CREDIT_CARD | UNDEFINED (multi)
    value: float           # decimal R$
    due_date: str          # YYYY-MM-DD
    description: Optional[str] = None
    external_reference: Optional[str] = None


@router.post("/charges")
async def create_charge(
    data: ChargeIn,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    cfg = await _get_company_cfg(db, user["company_id"])
    base = ENV_URLS[cfg["environment"]]
    payload = {
        "customer": data.customer,
        "billingType": (data.billing_type or "UNDEFINED").upper(),
        "value": float(data.value),
        "dueDate": data.due_date,
    }
    if data.description: payload["description"] = data.description
    if data.external_reference: payload["externalReference"] = data.external_reference
    async with httpx.AsyncClient(timeout=20.0) as cli:
        r = await cli.post(f"{base}/payments", json=payload, headers=_headers(cfg["api_key"]))
    if r.status_code >= 400:
        raise HTTPException(r.status_code, r.text[:500])
    payment = r.json()
    # Local log so we can correlate webhooks
    await db.asaas_charges.insert_one({
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "asaas_payment_id": payment.get("id"),
        "asaas_customer": data.customer,
        "value": data.value,
        "billing_type": data.billing_type,
        "status": payment.get("status"),
        "due_date": data.due_date,
        "external_reference": data.external_reference,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return payment


@router.get("/charges/{payment_id}")
async def get_charge(
    payment_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    cfg = await _get_company_cfg(db, user["company_id"])
    base = ENV_URLS[cfg["environment"]]
    async with httpx.AsyncClient(timeout=15.0) as cli:
        r = await cli.get(f"{base}/payments/{payment_id}", headers=_headers(cfg["api_key"]))
    if r.status_code >= 400:
        raise HTTPException(r.status_code, r.text[:500])
    return r.json()


# === WEBHOOK ================================================================
# Asaas posts payment events here. We verify the company-specific webhook_token
# (configured in /config). Idempotent: deduplicates by Asaas event id.
@router.post("/webhook/{company_id}")
async def asaas_webhook(
    company_id: str,
    request: Request,
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    cfg = await db.asaas_configs.find_one({"company_id": company_id}, {"_id": 0})
    if not cfg:
        raise HTTPException(404, "Empresa sem configuração Asaas")
    incoming_token = request.headers.get("asaas-access-token") or request.headers.get("Asaas-Access-Token")
    if cfg.get("webhook_token") and incoming_token != cfg["webhook_token"]:
        raise HTTPException(403, "Webhook token inválido")
    body = await request.json()
    event = body.get("event") or "UNKNOWN"
    payment = body.get("payment") or {}
    # Idempotency: dedupe by (event + payment.id)
    dedupe_key = f"{event}:{payment.get('id')}"
    seen = await db.asaas_webhook_events.find_one({"company_id": company_id, "dedupe_key": dedupe_key}, {"_id": 0, "id": 1})
    if seen:
        return {"ok": True, "deduped": True}
    await db.asaas_webhook_events.insert_one({
        "id": str(uuid.uuid4()),
        "company_id": company_id,
        "dedupe_key": dedupe_key,
        "event": event,
        "payload": body,
        "received_at": datetime.now(timezone.utc).isoformat(),
    })
    # Update local charge mirror
    if payment.get("id"):
        await db.asaas_charges.update_one(
            {"company_id": company_id, "asaas_payment_id": payment["id"]},
            {"$set": {
                "status": payment.get("status"),
                "paid_at": payment.get("clientPaymentDate") or payment.get("paymentDate"),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
    return {"ok": True, "event": event}
