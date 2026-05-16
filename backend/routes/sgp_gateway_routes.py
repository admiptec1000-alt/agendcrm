"""
SGP Outbound Gateway
====================

Lets the SGP (or any external system that follows the "HTTP Generico" SMS
gateway contract) push WhatsApp messages out through AgentCRM. Each AgentCRM
company creates one or more `sgp_gateways` rows; each row holds:

  - A long random `token` that goes into the URL path. The token is the only
    secret needed to call the public endpoint, so it doubles as both
    authentication AND tenant routing — no JWT/header needed.
  - A `connection_id` (which Baileys-backed WhatsApp connection should send
    the message). This is required by design (Q2 = c): every token targets
    one specific connection.
  - A `label` so the operator can keep multiple gateways apart in the UI
    (e.g. "SGP Cobrança", "SGP Avisos").

When the external system hits the public endpoint:
  1. Resolve the gateway by token (404 if unknown / disabled).
  2. Resolve the connection (404 if missing) — must belong to the same
     company. Reject if not connected (so we don't silently drop messages).
  3. Normalize the phone (E.164 BR by default; client may pass cc_code as
     prefix like the SGP HTTP Genérico does).
  4. Find-or-create the contact and OPEN ticket (channel="whatsapp"). If the
     contact already has an open ticket we reuse it (so the operator sees a
     single thread per number, like a normal inbound flow).
  5. Append the message (direction="outgoing", from_me=true, source="sgp")
     to the ticket and trigger the Baileys send.
  6. Touch `last_called_at`/`calls_count` for observability in the UI.

Endpoints
---------
Authenticated (operator UI):
  GET    /api/sgp/gateways                — list gateways for current tenant
  POST   /api/sgp/gateways                — create gateway (auto generates token)
  PUT    /api/sgp/gateways/{id}           — update label / connection_id / active
  POST   /api/sgp/gateways/{id}/regenerate-token
  DELETE /api/sgp/gateways/{id}

Public (called by SGP / any HTTP gateway):
  GET  /api/sgp/gateway/send/{token}      — query: celular=..., message=...
  POST /api/sgp/gateway/send/{token}      — same params as query/form/json
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
import uuid
import secrets
import re
import logging
import os
import httpx

from database import get_database
from auth import get_current_user
from counters import next_ticket_number
from clients_link import find_or_create_client_by_phone

logger = logging.getLogger("sgp_gateway")
router = APIRouter(prefix="/sgp", tags=["sgp-gateway"])

WA_SERVICE_URL = os.environ.get("WA_SERVICE_URL", "http://localhost:3002")


# In-memory ring of recent gateway calls. Keyed by token (the public path
# segment) — operator looks this up from the gateway list UI. We only keep
# the LAST 20 calls per token so memory stays bounded (~10KB per token max).
# Reset on process restart. Used by /api/sgp/gateways/{id}/recent-calls.
_RECENT_CALLS: dict = {}
_RECENT_CALLS_MAX = 20

# Dedup cache for SGP retries: maps sha1(gateway_id|phone|message) -> last
# timestamp this combo was processed. SGP frequently retries the same
# payload (their outbound queue is impatient on timeouts) — without this,
# the customer receives the same Pix link 2-3 times in rapid succession.
# Single-process state; if we ever shard the backend we'll need Redis.
_DEDUP_CACHE: dict = {}
_DEDUP_WINDOW_SECONDS = 30


def _record_gateway_call(token: str, entry: dict) -> None:
    arr = _RECENT_CALLS.setdefault(token, [])
    arr.append(entry)
    if len(arr) > _RECENT_CALLS_MAX:
        del arr[: len(arr) - _RECENT_CALLS_MAX]


# ─── helpers ────────────────────────────────────────────────────────────────

def _gen_token() -> str:
    """48-char URL-safe random token. ~282 bits of entropy — collision proof
    forever, and short enough to fit cleanly in a URL the operator pastes
    into SGP."""
    return secrets.token_urlsafe(36)


def _normalize_phone(raw: str, cc_code: str = "55") -> str:
    """SGP usually sends just `999990000` (without country code). We always
    prefix `cc_code` (default 55) if the digits don't already start with it.
    Returns digits-only (Baileys expects `5562...@s.whatsapp.net`).
    """
    digits = re.sub(r"\D+", "", raw or "")
    if not digits:
        return ""
    if digits.startswith(cc_code):
        return digits
    return f"{cc_code}{digits}"


def _public_view(g: dict) -> dict:
    """Strip the token from list responses; the token is only ever shown
    explicitly via the "show URL" UI affordance (or right after create)."""
    return {
        "id": g["id"],
        "company_id": g["company_id"],
        "label": g.get("label"),
        "connection_id": g.get("connection_id"),
        "active": g.get("active", True),
        "auto_close_ticket": bool(g.get("auto_close_ticket", False)),
        "calls_count": g.get("calls_count", 0),
        "last_called_at": g.get("last_called_at"),
        "created_at": g.get("created_at"),
        # Token IS included in the GET responses — operators copy it from
        # the listing to paste in SGP. There's no point hiding it: anyone
        # with read access to the page can already use any other UI hook
        # to send a message. (Token rotation is one click away.)
        "token": g.get("token"),
    }


# ─── models ────────────────────────────────────────────────────────────────

class GatewayCreate(BaseModel):
    label: str
    connection_id: str
    # Per-gateway opt-in for the "send and immediately close the ticket"
    # behavior. Tenants typically have ONE gateway for one-shot SGP
    # notifications (Pix/cobranca) where this is desirable, and possibly
    # another for actual two-way conversations where it'd be wrong. So we
    # keep this as a per-gateway flag rather than a per-company setting.
    auto_close_ticket: Optional[bool] = False


class GatewayUpdate(BaseModel):
    label: Optional[str] = None
    connection_id: Optional[str] = None
    active: Optional[bool] = None
    auto_close_ticket: Optional[bool] = None


# ─── admin endpoints (authenticated) ────────────────────────────────────────

@router.get("/gateways")
async def list_gateways(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    items = await db.sgp_gateways.find(
        {"company_id": user["company_id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    return [_public_view(g) for g in items]


@router.post("/gateways")
async def create_gateway(
    data: GatewayCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    # Validate the connection belongs to the same company.
    conn = await db.channel_connections.find_one(
        {"id": data.connection_id, "company_id": user["company_id"]}
    )
    if not conn:
        raise HTTPException(404, "Conexao WhatsApp nao encontrada")
    doc = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "label": data.label.strip(),
        "connection_id": data.connection_id,
        "token": _gen_token(),
        "active": True,
        "auto_close_ticket": bool(data.auto_close_ticket),
        "calls_count": 0,
        "last_called_at": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.sgp_gateways.insert_one(doc)
    return _public_view(doc)


@router.put("/gateways/{gid}")
async def update_gateway(
    gid: str,
    data: GatewayUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    update = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if "label" in update:
        update["label"] = update["label"].strip()
    if "auto_close_ticket" in update:
        update["auto_close_ticket"] = bool(update["auto_close_ticket"])
    if "connection_id" in update:
        conn = await db.channel_connections.find_one(
            {"id": update["connection_id"], "company_id": user["company_id"]}
        )
        if not conn:
            raise HTTPException(404, "Conexao WhatsApp nao encontrada")
    if not update:
        raise HTTPException(400, "Nada para atualizar")
    r = await db.sgp_gateways.update_one(
        {"id": gid, "company_id": user["company_id"]}, {"$set": update}
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Gateway nao encontrado")
    doc = await db.sgp_gateways.find_one({"id": gid}, {"_id": 0})
    return _public_view(doc)


@router.post("/gateways/{gid}/regenerate-token")
async def regenerate_token(
    gid: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    new_token = _gen_token()
    r = await db.sgp_gateways.update_one(
        {"id": gid, "company_id": user["company_id"]},
        {"$set": {"token": new_token}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Gateway nao encontrado")
    doc = await db.sgp_gateways.find_one({"id": gid}, {"_id": 0})
    return _public_view(doc)


@router.delete("/gateways/{gid}")
async def delete_gateway(
    gid: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    r = await db.sgp_gateways.delete_one(
        {"id": gid, "company_id": user["company_id"]}
    )
    if r.deleted_count == 0:
        raise HTTPException(404, "Gateway nao encontrado")
    return {"deleted": True}


@router.get("/gateways/{gid}/recent-calls")
async def get_recent_calls(
    gid: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Returns the last 20 calls that hit this gateway's public endpoint
    (in-memory ring, resets on deploy). Each entry contains the parsed
    keys, message length, and a 200-char preview of the body — enough to
    diagnose "the message arrived but customer sees Aguardando" issues.
    Token never appears in the response; lookup is by gateway id."""
    gw = await db.sgp_gateways.find_one(
        {"id": gid, "company_id": user["company_id"]},
        {"_id": 0, "token": 1, "label": 1, "calls_count": 1, "last_called_at": 1},
    )
    if not gw:
        raise HTTPException(404, "Gateway nao encontrado")
    calls = _RECENT_CALLS.get(gw["token"], [])
    return {
        "gateway_id": gid,
        "label": gw.get("label"),
        "calls_count_total": gw.get("calls_count", 0),
        "last_called_at": gw.get("last_called_at"),
        "recent_calls": list(reversed(calls)),  # newest first
        "note": "Ring em memoria — reinicia a cada deploy. Mantem so as ultimas 20.",
    }


# ─── PUBLIC endpoint (called by SGP) ────────────────────────────────────────

async def _handle_send(
    token: str,
    celular: str,
    message: str,
    cc_code: str,
    db: AsyncIOMotorDatabase,
):
    """Shared logic for GET and POST. Kept synchronous-friendly so we can
    return the same JSON shape regardless of method."""
    gw = await db.sgp_gateways.find_one({"token": token}, {"_id": 0})
    if not gw or not gw.get("active", True):
        raise HTTPException(404, "Gateway nao encontrado ou desabilitado")

    if not celular or not message:
        raise HTTPException(400, "Parametros 'celular' e 'message' sao obrigatorios")

    conn = await db.channel_connections.find_one(
        {"id": gw["connection_id"], "company_id": gw["company_id"]}
    )
    if not conn:
        raise HTTPException(503, "Conexao WhatsApp nao configurada")
    if conn.get("status") != "connected":
        raise HTTPException(503, "Conexao WhatsApp nao esta conectada")

    phone = _normalize_phone(celular, cc_code or "55")
    if len(phone) < 10:
        raise HTTPException(400, "Numero de celular invalido")

    company_id = gw["company_id"]

    # --- Dedup: SGP frequently retries the same payload (its outbound queue
    # has internal retry on timeout) — in production we saw the SAME Pix
    # message arrive twice within seconds and BOTH be delivered to the end
    # customer. Reject the 2nd identical (phone+message hash) call inside a
    # 30s window. We store the hash on the gateway document itself with a
    # TTL field, but here we just compare timestamps from the in-memory
    # cache `_DEDUP_CACHE`. Keeps the implementation simple and per-process
    # (single-instance backend deployment).
    import hashlib as _h
    dedup_key = _h.sha1(f"{gw['id']}|{phone}|{message}".encode("utf-8")).hexdigest()
    now_ts = datetime.now(timezone.utc).timestamp()
    last_ts = _DEDUP_CACHE.get(dedup_key)
    if last_ts and (now_ts - last_ts) < _DEDUP_WINDOW_SECONDS:
        logger.info(
            f"[sgp_gateway] DEDUP hit token={gw.get('token','')[:6]}… "
            f"phone={phone[:6]}… msg_len={len(message)} age={now_ts - last_ts:.1f}s"
        )
        return {
            "success": True,
            "ticket_id": None,
            "deduplicated": True,
            "note": "Mensagem identica enviada recentemente; ignorada (dedup 30s).",
        }
    _DEDUP_CACHE[dedup_key] = now_ts
    # Best-effort GC: prune any entries older than the window to keep memory
    # bounded without a separate cron. O(n) but n stays small (few hundred).
    if len(_DEDUP_CACHE) > 500:
        cutoff = now_ts - _DEDUP_WINDOW_SECONDS
        for k in list(_DEDUP_CACHE.keys()):
            if _DEDUP_CACHE[k] < cutoff:
                _DEDUP_CACHE.pop(k, None)

    # Read auto-close setting. Priority: per-gateway > per-company.
    # The per-gateway flag is the new (current) home — moved out of the
    # company-wide /configuracoes page so operators can have different
    # behavior per gateway (e.g. one for cobranca = auto-close, another
    # for active campaigns = stays open). Per-company fallback kept for
    # backwards compat with tenants that set it in the old location.
    if "auto_close_ticket" in gw:
        auto_close = bool(gw.get("auto_close_ticket"))
    else:
        comp = await db.companies.find_one(
            {"id": company_id},
            {"_id": 0, "sgp_gateway_auto_close": 1},
        ) or {}
        auto_close = bool(comp.get("sgp_gateway_auto_close"))

    # Find an OPEN ticket for this number (same connection). Reuse to keep
    # a single conversation thread per contact.
    ticket = await db.tickets.find_one(
        {
            "company_id": company_id,
            "customer_phone": phone,
            "status": {"$nin": ["fechado", "cancelado"]},
            "channel": {"$ne": "whatsapp_group"},
        },
        {"_id": 0},
    )
    if not ticket:
        ticket_id = str(uuid.uuid4())
        ticket_number = await next_ticket_number(db, company_id)
        client_id = await find_or_create_client_by_phone(db, company_id, phone, name=None)
        ticket = {
            "id": ticket_id,
            "ticket_number": ticket_number,
            "company_id": company_id,
            "connection_id": gw["connection_id"],
            "client_id": client_id,
            "customer_name": phone,
            "customer_phone": phone,
            "customer_email": None,
            "status": "aberto",
            "priority": "medium",
            "channel": "whatsapp",
            "is_group": False,
            "group_jid": None,
            "group_subject": None,
            "description": message[:140],
            "assigned_to": None,
            "queue_id": (conn.get("queue_ids") or [None])[0]
            if len(conn.get("queue_ids") or []) == 1 else None,
            "messages": [],
            "tags": ["SGP Gateway"],
            "value": 0.0,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            # Hint downstream logic this ticket originated from SGP.
            "origin": "sgp_gateway",
        }
        await db.tickets.insert_one(ticket)

    new_msg = {
        "id": str(uuid.uuid4()),
        "direction": "outgoing",
        "from_me": True,
        "type": "text",
        "content": message,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "status": "sending",
        "source": "sgp_gateway",
    }

    # Send via Baileys microservice. We do it BEFORE persisting the message
    # so we can stamp the wa_message_id if the broker returns one.
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                f"{WA_SERVICE_URL}/instances/{gw['connection_id']}/send",
                json={"phone": phone, "message": message},
            )
            result = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {"success": False, "error": resp.text[:200]}
        logger.info(
            f"[sgp_gateway] WA send result token={gw.get('token','')[:6]}… "
            f"phone={phone[:6]}… msg_len={len(message)} success={result.get('success')} "
            f"jid={result.get('jid')} msg_id={result.get('message_id')} "
            f"error={result.get('error', '')[:120]!r}"
        )
    except Exception as e:
        logger.exception("[sgp_gateway] WA send failed")
        result = {"success": False, "error": str(e)}

    if result.get("success"):
        new_msg["status"] = "sent"
        if result.get("message_id"):
            new_msg["wa_message_id"] = result["message_id"]
    else:
        new_msg["status"] = "failed"
        new_msg["error"] = result.get("error", "Unknown error")

    # Build ticket update. When auto_close is ON and we sent successfully,
    # close the ticket right now — keeps the inbox clean from one-shot SGP
    # notifications. If the customer replies later, a NEW ticket will be
    # opened by the inbound webhook (the open-ticket lookup above filters
    # `status NOT IN ['fechado','cancelado']`).
    update_set: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if auto_close and result.get("success"):
        update_set["status"] = "fechado"
        update_set["closed_at"] = update_set["updated_at"]
        update_set["closed_reason"] = "sgp_gateway_auto_close"

    await db.tickets.update_one(
        {"id": ticket["id"]},
        {
            "$push": {"messages": new_msg},
            "$set": update_set,
        },
    )

    # Observability: bump the counter regardless of send result (so the UI
    # shows the gateway is in use even if WA is offline).
    await db.sgp_gateways.update_one(
        {"id": gw["id"]},
        {
            "$inc": {"calls_count": 1},
            "$set": {"last_called_at": datetime.now(timezone.utc).isoformat()},
        },
    )

    if not result.get("success"):
        # Keep parity with SGP's contract: 200 + success=false is the way
        # the other gateways (superwhats, oratrix) report send failures
        # without breaking the SGP retry queue.
        return {
            "success": False,
            "error": result.get("error", "Send failed"),
            "ticket_id": ticket["id"],
        }

    return {"success": True, "ticket_id": ticket["id"]}


@router.get("/gateway/send/{token}")
async def public_send_get(
    token: str,
    request: Request,
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """SGP "HTTP Generico" typically calls with `?celular=...&message=...`
    on GET. We accept both names AND fall back to common aliases (`to`,
    `phone`, `text`, `msg`) to be friendly to other systems too.
    """
    qp = request.query_params
    celular = qp.get("celular") or qp.get("to") or qp.get("phone") or ""
    message = qp.get("message") or qp.get("msg") or qp.get("text") or ""
    cc_code = qp.get("cc_code") or "55"
    short_token = (token or "")[:6] + "…"
    logger.info(
        f"[sgp_gateway/GET] token={short_token} qp_keys={list(qp.keys())} "
        f"celular={'<empty>' if not celular else celular[:6]+'…'} "
        f"message_len={len(message)} message_preview={message[:80]!r}"
    )
    try:
        _record_gateway_call(token, {
            "at": datetime.now(timezone.utc).isoformat(),
            "method": "GET",
            "ctype": "",
            "body_len": 0,
            "parsed_keys": [],
            "qp_keys": list(qp.keys()),
            "celular_preview": (celular[:6] + "…") if celular else "",
            "message_len": len(message),
            "message_preview": message[:200],
        })
    except Exception:
        pass
    return await _handle_send(token, celular, message, cc_code, db)


@router.post("/gateway/send/{token}")
async def public_send_post(
    token: str,
    request: Request,
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Accepts JSON body, urlencoded form, or query params (SGP can be
    configured for any of these)."""
    ctype = (request.headers.get("content-type") or "").lower()
    celular = message = ""
    cc_code = "55"
    data: dict = {}
    raw_body = b""
    try:
        # Read the raw body once so we can log it AND parse it. FastAPI
        # caches the body inside Request after first read, so subsequent
        # `request.json()` / `request.form()` would 400 — we parse manually.
        raw_body = await request.body()
        if "application/json" in ctype:
            import json as _json
            data = _json.loads(raw_body.decode("utf-8") or "{}")
        elif "application/x-www-form-urlencoded" in ctype or "multipart/form-data" in ctype:
            from urllib.parse import parse_qs
            parsed = parse_qs(raw_body.decode("utf-8", errors="replace"))
            data = {k: (v[0] if isinstance(v, list) and v else v) for k, v in parsed.items()}
    except Exception as e:
        logger.warning(f"[sgp_gateway] body parse failed ctype={ctype!r}: {e}")
        data = {}
    # query string overrides body only when body didn't have it
    qp = request.query_params
    celular = data.get("celular") or data.get("to") or data.get("phone") or qp.get("celular") or qp.get("to") or qp.get("phone") or ""
    message = data.get("message") or data.get("msg") or data.get("text") or qp.get("message") or qp.get("msg") or qp.get("text") or ""
    cc_code = data.get("cc_code") or qp.get("cc_code") or "55"
    # CRITICAL diagnostic: log the EXACT shape received from SGP. This is
    # invaluable when the customer reports "Aguardando mensagem" because
    # it lets us confirm whether the message body actually has content
    # before we hand it to Baileys. Token is redacted in the log.
    short_token = (token or "")[:6] + "…"
    logger.info(
        f"[sgp_gateway/POST] token={short_token} ctype={ctype!r} "
        f"body_len={len(raw_body)} qp_keys={list(qp.keys())} "
        f"parsed_keys={list(data.keys())} celular={'<empty>' if not celular else celular[:6]+'…'} "
        f"message_len={len(str(message))} message_preview={str(message)[:80]!r}"
    )
    # Record the LAST 20 calls per gateway in an in-memory ring so the
    # super-admin / operator can inspect them via a debug endpoint —
    # essential for diagnosing production issues (logs may not be easily
    # accessible). The ring stays in-process; it's a debug aid, not a
    # source of truth.
    try:
        _record_gateway_call(token, {
            "at": datetime.now(timezone.utc).isoformat(),
            "method": "POST",
            "ctype": ctype,
            "body_len": len(raw_body),
            "parsed_keys": list(data.keys()),
            "qp_keys": list(qp.keys()),
            "celular_preview": (celular[:6] + "…") if celular else "",
            "message_len": len(str(message)),
            "message_preview": str(message)[:200],
        })
    except Exception:
        pass
    return await _handle_send(token, str(celular), str(message), str(cc_code), db)
