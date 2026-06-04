"""Meta WhatsApp Cloud API routes.

Endpoints:
  Per-company credentials CRUD:
    GET    /api/meta/credentials            -> read company token (masked)
    PUT    /api/meta/credentials            -> upsert token / waba / app_secret
    DELETE /api/meta/credentials            -> remove credentials

  Phone numbers + templates (read from Meta Graph, scoped per-company):
    GET    /api/meta/phone-numbers          -> list WABA phone numbers
    GET    /api/meta/templates              -> list templates (synced)
    POST   /api/meta/templates              -> create template (Meta /message_templates)
    DELETE /api/meta/templates/{name}       -> delete template by name
    POST   /api/meta/templates/sync         -> pull from Meta and upsert in DB
    GET    /api/meta/categories             -> static catalog (rules + examples)

  Send (called by dispatcher; also exposed for tests):
    POST   /api/meta/send-text              -> {phone_number_id, to, body}
    POST   /api/meta/send-template          -> {phone_number_id, to, name, language, components}

  Super Admin per-company controls:
    GET  /api/super-admin/meta/companies/{company_id}/categories
    PUT  /api/super-admin/meta/companies/{company_id}/categories

  Webhook (Meta -> us, public):
    GET  /api/webhooks/meta                 -> handshake (hub.challenge)
    POST /api/webhooks/meta                 -> events (messages/statuses)

2026-02-28 — Fase 3 inicial. Model A: cliente tem propria conta Meta.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel

from database import get_database
from auth import get_current_user, require_super_admin
from services.meta_cloud import (
    META_CATEGORIES,
    MetaApiError,
    MetaCloudClient,
    get_company_meta_client,
    verify_webhook_signature,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["meta"])


# ═══════════════════════════════════════════════════════════════════════
# Models
# ═══════════════════════════════════════════════════════════════════════
class MetaCredentialsUpdate(BaseModel):
    app_id: Optional[str] = None
    app_secret: Optional[str] = None
    system_user_token: Optional[str] = None
    waba_id: Optional[str] = None
    api_version: Optional[str] = "v20.0"
    webhook_verify_token: Optional[str] = None  # cliente escolhe a string


class TemplateCreate(BaseModel):
    name: str
    language: str = "pt_BR"
    category: str  # MARKETING | UTILITY | AUTHENTICATION | SERVICE
    components: list[dict]  # [{type:"BODY", text:"..."}, ...]


class SendTextBody(BaseModel):
    phone_number_id: str
    to: str
    body: str


class SendTemplateBody(BaseModel):
    phone_number_id: str
    to: str
    name: str
    language: str = "pt_BR"
    components: Optional[list[dict]] = None


class CategoriesUpdate(BaseModel):
    """Super Admin lock: only these categories are allowed for the company."""
    allowed_categories: list[str]  # subset of META_CATEGORIES keys


# ═══════════════════════════════════════════════════════════════════════
# Per-company credentials
# ═══════════════════════════════════════════════════════════════════════
def _mask(token: Optional[str]) -> str:
    if not token:
        return ""
    if len(token) <= 12:
        return "***"
    return f"{token[:6]}...{token[-4:]}"


@router.get("/meta/credentials")
async def get_meta_credentials(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    comp = await db.companies.find_one(
        {"id": user["company_id"]},
        {"_id": 0, "meta_credentials": 1, "meta_allowed_categories": 1},
    )
    creds = (comp or {}).get("meta_credentials") or {}
    return {
        "configured": bool(creds.get("system_user_token") and creds.get("waba_id")),
        "app_id": creds.get("app_id") or "",
        "waba_id": creds.get("waba_id") or "",
        "api_version": creds.get("api_version") or "v20.0",
        "webhook_verify_token": creds.get("webhook_verify_token") or "",
        "system_user_token_masked": _mask(creds.get("system_user_token")),
        "app_secret_masked": _mask(creds.get("app_secret")),
        # Allowed categories defaults to ALL when Super Admin nao restringiu.
        "allowed_categories": (comp or {}).get("meta_allowed_categories") or [c["key"] for c in META_CATEGORIES],
    }


@router.put("/meta/credentials")
async def update_meta_credentials(
    data: MetaCredentialsUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    payload = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    # Apenas admin da empresa pode editar token (mesmo SA pode via mesmo endpoint).
    role = (user.get("role") or "").lower()
    if role not in ("company_admin", "owner", "admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Apenas admin pode configurar credenciais Meta")
    update_set = {}
    for k, v in payload.items():
        update_set[f"meta_credentials.{k}"] = v
    update_set["meta_credentials.updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.companies.update_one({"id": user["company_id"]}, {"$set": update_set})
    return await get_meta_credentials(user=user, db=db)


@router.delete("/meta/credentials")
async def delete_meta_credentials(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    role = (user.get("role") or "").lower()
    if role not in ("company_admin", "owner", "admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Apenas admin pode remover credenciais Meta")
    await db.companies.update_one(
        {"id": user["company_id"]},
        {"$unset": {"meta_credentials": ""}},
    )
    return {"removed": True}


# ═══════════════════════════════════════════════════════════════════════
# Static catalog (no Meta call)
# ═══════════════════════════════════════════════════════════════════════
@router.get("/meta/categories")
async def list_categories(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Return Meta category catalog + which are allowed for this company.

    Super Admin can restrict a company to a subset of categories via the
    super-admin endpoint below. By default, ALL categories are allowed.
    """
    comp = await db.companies.find_one({"id": user["company_id"]}, {"_id": 0, "meta_allowed_categories": 1})
    allowed = (comp or {}).get("meta_allowed_categories") or [c["key"] for c in META_CATEGORIES]
    return {
        "categories": [{**c, "allowed": c["key"] in allowed} for c in META_CATEGORIES],
        "allowed_keys": allowed,
    }


# ═══════════════════════════════════════════════════════════════════════
# Phone numbers + templates
# ═══════════════════════════════════════════════════════════════════════
@router.get("/meta/phone-numbers")
async def list_phone_numbers(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    cli = await get_company_meta_client(db, user["company_id"])
    try:
        nums = await cli.list_phone_numbers()
    except MetaApiError as e:
        raise HTTPException(status_code=400, detail=f"Meta: {e.message}")
    # Upsert cache so dispatcher can pick from DB without re-call.
    now = datetime.now(timezone.utc).isoformat()
    for n in nums:
        await db.meta_phone_numbers.update_one(
            {"company_id": user["company_id"], "phone_number_id": n.get("id")},
            {"$set": {
                "company_id": user["company_id"],
                "phone_number_id": n.get("id"),
                "display_phone_number": n.get("display_phone_number"),
                "verified_name": n.get("verified_name"),
                "quality_rating": n.get("quality_rating"),
                "status": n.get("code_verification_status") or n.get("status"),
                "synced_at": now,
            }},
            upsert=True,
        )
    return {"numbers": nums, "synced_at": now}


@router.get("/meta/templates")
async def list_templates_endpoint(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Return templates from local cache (db). Use POST /sync to refresh from Meta."""
    docs = await db.meta_templates.find(
        {"company_id": user["company_id"]}, {"_id": 0}
    ).sort("name", 1).to_list(500)
    return docs


@router.post("/meta/templates/sync")
async def sync_templates(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    cli = await get_company_meta_client(db, user["company_id"])
    try:
        tpls = await cli.list_templates()
    except MetaApiError as e:
        raise HTTPException(status_code=400, detail=f"Meta: {e.message}")
    now = datetime.now(timezone.utc).isoformat()
    for t in tpls:
        await db.meta_templates.update_one(
            {"company_id": user["company_id"], "name": t.get("name"), "language": (t.get("language") or "")},
            {"$set": {
                "company_id": user["company_id"],
                "name": t.get("name"),
                "language": t.get("language") or "pt_BR",
                "category": t.get("category"),
                "status": t.get("status"),
                "components": t.get("components") or [],
                "synced_at": now,
            }},
            upsert=True,
        )
    return {"synced": len(tpls), "synced_at": now}


@router.post("/meta/templates")
async def create_template_endpoint(
    data: TemplateCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    # Validar categoria contra o whitelist da empresa (Super Admin lock).
    comp = await db.companies.find_one(
        {"id": user["company_id"]},
        {"_id": 0, "meta_allowed_categories": 1},
    )
    allowed = (comp or {}).get("meta_allowed_categories") or [c["key"] for c in META_CATEGORIES]
    if data.category not in allowed:
        raise HTTPException(
            status_code=403,
            detail=f"Categoria '{data.category}' nao liberada para esta empresa. Contate o Super Admin.",
        )
    cli = await get_company_meta_client(db, user["company_id"])
    payload = {
        "name": data.name,
        "language": data.language,
        "category": data.category,
        "components": data.components,
    }
    try:
        res = await cli.create_template(payload)
    except MetaApiError as e:
        raise HTTPException(status_code=400, detail=f"Meta: {e.message}")
    # Persist locally with PENDING status (Meta vai aprovar em 1-24h).
    await db.meta_templates.update_one(
        {"company_id": user["company_id"], "name": data.name, "language": data.language},
        {"$set": {
            "company_id": user["company_id"],
            "name": data.name,
            "language": data.language,
            "category": data.category,
            "components": data.components,
            "status": res.get("status") or "PENDING",
            "meta_id": res.get("id"),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    return res


@router.delete("/meta/templates/{name}")
async def delete_template_endpoint(
    name: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    cli = await get_company_meta_client(db, user["company_id"])
    try:
        res = await cli.delete_template(name)
    except MetaApiError as e:
        raise HTTPException(status_code=400, detail=f"Meta: {e.message}")
    await db.meta_templates.delete_many({"company_id": user["company_id"], "name": name})
    return res


# ═══════════════════════════════════════════════════════════════════════
# Send (used by tests + dispatcher; production envio passa pelo bulk
# dispatcher que ja sabe rotear baileys vs meta_cloud).
# ═══════════════════════════════════════════════════════════════════════
@router.post("/meta/send-text")
async def send_text_endpoint(
    data: SendTextBody,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    cli = await get_company_meta_client(db, user["company_id"])
    try:
        return await cli.send_text(data.phone_number_id, data.to, data.body)
    except MetaApiError as e:
        raise HTTPException(status_code=400, detail=f"Meta: {e.message}")


@router.post("/meta/send-template")
async def send_template_endpoint(
    data: SendTemplateBody,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    cli = await get_company_meta_client(db, user["company_id"])
    try:
        return await cli.send_template(data.phone_number_id, data.to, data.name, data.language, data.components)
    except MetaApiError as e:
        raise HTTPException(status_code=400, detail=f"Meta: {e.message}")


# ═══════════════════════════════════════════════════════════════════════
# Super Admin per-company category lock
# ═══════════════════════════════════════════════════════════════════════
@router.get("/super-admin/meta/companies/{company_id}/categories")
async def sa_get_company_categories(
    company_id: str,
    _admin: dict = Depends(require_super_admin),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    comp = await db.companies.find_one(
        {"id": company_id},
        {"_id": 0, "meta_allowed_categories": 1, "name": 1},
    )
    if not comp:
        raise HTTPException(status_code=404, detail="Empresa nao encontrada")
    allowed = comp.get("meta_allowed_categories") or [c["key"] for c in META_CATEGORIES]
    return {
        "company_id": company_id,
        "company_name": comp.get("name"),
        "allowed_categories": allowed,
        "all_categories": META_CATEGORIES,
    }


@router.put("/super-admin/meta/companies/{company_id}/categories")
async def sa_update_company_categories(
    company_id: str,
    data: CategoriesUpdate,
    _admin: dict = Depends(require_super_admin),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    valid_keys = {c["key"] for c in META_CATEGORIES}
    bad = [k for k in data.allowed_categories if k not in valid_keys]
    if bad:
        raise HTTPException(status_code=400, detail=f"Categorias invalidas: {bad}")
    await db.companies.update_one(
        {"id": company_id},
        {"$set": {"meta_allowed_categories": data.allowed_categories,
                  "meta_allowed_categories_updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"company_id": company_id, "allowed_categories": data.allowed_categories}


# ═══════════════════════════════════════════════════════════════════════
# Webhook (Meta -> us). Public endpoint, no auth.
# Routing: each company configures its OWN `webhook_verify_token` in
# Meta App Dashboard. POST body contains entry[].id (=WABA ID) which we
# use to resolve company.
# ═══════════════════════════════════════════════════════════════════════
@router.get("/webhooks/meta")
async def meta_webhook_verify(
    request: Request,
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    params = request.query_params
    mode = params.get("hub.mode")
    challenge = params.get("hub.challenge")
    token = params.get("hub.verify_token")
    if not (mode == "subscribe" and token and challenge):
        raise HTTPException(status_code=400, detail="Bad verify request")
    # Resolve any company whose webhook_verify_token matches. This allows
    # the same /webhooks/meta endpoint to serve all tenants — each cliente
    # cadastra seu proprio token na Meta App config.
    comp = await db.companies.find_one(
        {"meta_credentials.webhook_verify_token": token},
        {"_id": 0, "id": 1},
    )
    if not comp:
        logger.warning("[meta-webhook] verify failed: unknown token")
        raise HTTPException(status_code=403, detail="Verify token mismatch")
    return PlainTextResponse(content=challenge)


@router.post("/webhooks/meta")
async def meta_webhook_receive(
    request: Request,
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    raw = await request.body()
    sig = request.headers.get("X-Hub-Signature-256")

    # Routing: `entry[0].id` is the WABA ID. Find which company owns it.
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    waba_id = None
    try:
        waba_id = (payload.get("entry") or [{}])[0].get("id")
    except Exception:
        pass
    if not waba_id:
        # Could be a non-WABA event; ack silently to avoid Meta retries.
        return {"ok": True}

    comp = await db.companies.find_one(
        {"meta_credentials.waba_id": waba_id},
        {"_id": 0, "id": 1, "meta_credentials": 1},
    )
    if not comp:
        logger.warning("[meta-webhook] unknown WABA id=%s", waba_id)
        return {"ok": True}  # Ack to stop retries; nothing to do.

    app_secret = (comp.get("meta_credentials") or {}).get("app_secret") or ""
    if not verify_webhook_signature(app_secret, raw, sig):
        logger.warning("[meta-webhook] invalid signature waba=%s", waba_id)
        raise HTTPException(status_code=401, detail="Invalid signature")

    # Persist raw event for audit / replay.
    await db.meta_webhook_events.insert_one({
        "company_id": comp["id"],
        "waba_id": waba_id,
        "payload": payload,
        "received_at": datetime.now(timezone.utc).isoformat(),
    })

    # Best-effort processing: messages (inbound) + statuses (delivery).
    try:
        await _process_meta_events(db, comp["id"], payload)
    except Exception as e:
        logger.exception("[meta-webhook] processing failed: %s", e)

    return {"ok": True}


async def _process_meta_events(db: AsyncIOMotorDatabase, company_id: str, payload: dict):
    for entry in (payload.get("entry") or []):
        for change in (entry.get("changes") or []):
            value = change.get("value") or {}
            # Inbound messages: store last inbound timestamp per contact to
            # respect the 24h window when later sending free-form text.
            for msg in (value.get("messages") or []):
                wa_id = (value.get("contacts") or [{}])[0].get("wa_id")
                if wa_id:
                    await db.meta_contact_state.update_one(
                        {"company_id": company_id, "wa_id": wa_id},
                        {"$set": {"last_inbound_at": datetime.now(timezone.utc).isoformat(),
                                  "company_id": company_id, "wa_id": wa_id}},
                        upsert=True,
                    )
                await db.meta_messages.insert_one({
                    "company_id": company_id,
                    "direction": "inbound",
                    "wa_id": wa_id,
                    "message_id": msg.get("id"),
                    "type": msg.get("type"),
                    "payload": msg,
                    "received_at": datetime.now(timezone.utc).isoformat(),
                })
            # Status updates: mark sent/delivered/read/failed.
            for status in (value.get("statuses") or []):
                await db.meta_messages.update_one(
                    {"company_id": company_id, "message_id": status.get("id")},
                    {"$set": {"delivery_status": status.get("status"),
                              "status_payload": status,
                              "status_at": datetime.now(timezone.utc).isoformat()}},
                    upsert=True,
                )
