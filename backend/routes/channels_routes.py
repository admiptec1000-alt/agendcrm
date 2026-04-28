from fastapi import APIRouter, Depends, HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorDatabase
from database import get_database
from auth import get_current_user
from pydantic import BaseModel
from typing import Optional, List
import uuid
import httpx
import os
import logging
from datetime import datetime, timezone, timedelta
from counters import next_ticket_number

router = APIRouter(prefix="/channels", tags=["channels"])
logger = logging.getLogger(__name__)

WA_SERVICE_URL = os.environ.get("WA_SERVICE_URL", "http://localhost:3002")


@router.get("/service-health")
async def service_health(user: dict = Depends(get_current_user)):
    """Check if the WhatsApp microservice (Baileys) is reachable."""
    import time
    start = time.time()
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(f"{WA_SERVICE_URL}/health")
            data = resp.json()
            elapsed_ms = int((time.time() - start) * 1000)
            return {
                "online": True,
                "instances": data.get("instances", 0),
                "latency_ms": elapsed_ms,
                "url": WA_SERVICE_URL,
            }
    except Exception as e:
        elapsed_ms = int((time.time() - start) * 1000)
        logger.warning(f"WA service unreachable: {e}")
        return {
            "online": False,
            "instances": 0,
            "latency_ms": elapsed_ms,
            "error": str(e)[:100],
            "url": WA_SERVICE_URL,
        }


@router.get("/service-version-check")
async def service_version_check(user: dict = Depends(get_current_user)):
    """Probe the WA microservice to confirm the latest patches are deployed.
    Used by the 'Verificar Deploy' button after the user redeploys on Render.
    """
    checks = {
        "online": False,
        "version": None,
        "features": {},
        "url": WA_SERVICE_URL,
        "details": [],
    }
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(f"{WA_SERVICE_URL}/health")
            if r.status_code == 200:
                checks["online"] = True
                checks["details"].append("✓ Microservico online")
            else:
                checks["details"].append(f"✗ Health retornou HTTP {r.status_code}")

            # Query new /version endpoint — only exists in v2.1.0+
            v = await client.get(f"{WA_SERVICE_URL}/version")
            if v.status_code == 200:
                data = v.json()
                checks["version"] = data.get("version")
                checks["features"] = data.get("features") or {}
                checks["fastapi_url_on_render"] = data.get("fastapi_url")
                checks["details"].append(f"✓ Versao: {data.get('version')} (build {data.get('built_at')})")
                # Check if FASTAPI_URL points to a public host (not localhost)
                fu = data.get("fastapi_url") or ""
                if "localhost" in fu or "127.0.0.1" in fu:
                    checks["details"].append("⚠ FASTAPI_URL aponta para localhost — mensagens recebidas NAO chegam ao backend!")
                else:
                    checks["details"].append(f"✓ FASTAPI_URL: {fu}")
            else:
                checks["details"].append("✗ Endpoint /version ausente — REDEPLOY PENDENTE (versao antiga)")
    except Exception as e:
        checks["details"].append(f"✗ Erro: {str(e)[:120]}")
    checks["redeploy_done"] = bool(checks["online"] and checks.get("version"))
    return checks


# === MODELS ===
class ConnectionCreate(BaseModel):
    name: str
    type: str = "whatsapp"  # whatsapp, instagram
    phone: Optional[str] = None

class ConnectionUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None

class TemplateCreate(BaseModel):
    process_key: str
    label: str
    description: Optional[str] = None
    message: str
    active: bool = True

class TemplateUpdate(BaseModel):
    message: Optional[str] = None
    active: Optional[bool] = None

class ScheduledMessageCreate(BaseModel):
    recipient: str
    channel: str = "whatsapp"
    message: str
    scheduled_at: str
    template_key: Optional[str] = None

class ScheduledMessageUpdate(BaseModel):
    status: Optional[str] = None


# === CONNECTIONS ===
@router.get("/connections")
async def list_connections(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    connections = await db.channel_connections.find(
        {"company_id": user["company_id"]}, {"_id": 0}
    ).to_list(100)
    return connections


@router.post("/connections")
async def create_connection(
    data: ConnectionCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    conn = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "name": data.name,
        "type": data.type,
        "phone": data.phone,
        "status": "disconnected",
        "qr_code": None,
        "last_connected": None,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.channel_connections.insert_one(conn)
    return {k: v for k, v in conn.items() if k != "_id"}


@router.post("/connections/{conn_id}/connect")
async def connect_channel(
    conn_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    conn = await db.channel_connections.find_one({"id": conn_id, "company_id": user["company_id"]})
    if not conn:
        raise HTTPException(status_code=404, detail="Conexao nao encontrada")

    if conn["type"] == "whatsapp":
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(f"{WA_SERVICE_URL}/instances/{conn_id}/connect")
                resp.json()  # validate response
            await db.channel_connections.update_one({"id": conn_id}, {"$set": {"status": "connecting"}})
        except Exception as e:
            logger.error(f"WhatsApp connect error: {e}")
            await db.channel_connections.update_one({"id": conn_id}, {"$set": {"status": "waiting_qr"}})
    else:
        await db.channel_connections.update_one({"id": conn_id}, {"$set": {"status": "waiting_qr"}})

    return await db.channel_connections.find_one({"id": conn_id}, {"_id": 0})


@router.get("/connections/{conn_id}/qr")
async def get_connection_qr(
    conn_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    conn = await db.channel_connections.find_one({"id": conn_id, "company_id": user["company_id"]})
    if not conn:
        raise HTTPException(status_code=404, detail="Conexao nao encontrada")

    if conn["type"] == "whatsapp":
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(f"{WA_SERVICE_URL}/instances/{conn_id}/qr")
                data = resp.json()
                node_status = data.get("status", "disconnected")

                # Self-heal: if DB thinks connection is waiting_qr/connecting but Node has no instance,
                # trigger a new connect so Baileys re-emits the QR.
                if (
                    conn.get("status") in ("waiting_qr", "connecting")
                    and node_status in ("not_found", "disconnected")
                    and not data.get("qr_base64")
                ):
                    try:
                        await client.post(f"{WA_SERVICE_URL}/instances/{conn_id}/connect")
                    except Exception as e:
                        logger.warning(f"Self-heal connect failed for {conn_id}: {e}")

            return {"qr": data.get("qr"), "qr_base64": data.get("qr_base64"), "status": node_status}
        except Exception as e:
            logger.error(f"WhatsApp QR proxy error: {e}")
            return {"qr": None, "qr_base64": None, "status": "error"}
    return {"qr": None, "qr_base64": None, "status": conn.get("status")}


@router.post("/connections/{conn_id}/sync")
async def sync_connection_with_remote(
    conn_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    """Reconcile DB connection with actual Baileys state on the remote service.

    Handles the case where the remote (Render) lost persistence (cold start)
    and now has a DIFFERENT instance id than what the DB expects. If the remote
    has any connected instance for this company and the DB one isn't connected,
    we adopt the remote id/status.
    """
    conn = await db.channel_connections.find_one({"id": conn_id, "company_id": user["company_id"]})
    if not conn:
        raise HTTPException(status_code=404, detail="Conexao nao encontrada")
    if conn.get("type") != "whatsapp":
        return conn

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # 1) Try our own id first
            r = await client.get(f"{WA_SERVICE_URL}/instances/{conn_id}/status")
            st = r.json() if r.status_code == 200 else {}
            if st.get("connected"):
                await db.channel_connections.update_one(
                    {"id": conn_id},
                    {"$set": {"status": "connected", "last_connected": datetime.now(timezone.utc).isoformat()}}
                )
                return await db.channel_connections.find_one({"id": conn_id}, {"_id": 0})

            # 2) Walk all remote instances to find one that's connected
            r_all = await client.get(f"{WA_SERVICE_URL}/instances")
            remote = r_all.json() if r_all.status_code == 200 else []
            # Ignore instances already bound to some other company connection
            bound_ids = set()
            async for c in db.channel_connections.find({}, {"_id": 0, "id": 1}):
                bound_ids.add(c["id"])
            candidate = None
            for inst in remote:
                if inst.get("connected") and inst.get("id") not in bound_ids:
                    candidate = inst
                    break
            if candidate:
                new_id = candidate["id"]
                # Rebind: move DB row to the new id
                await db.channel_connections.update_one(
                    {"id": conn_id},
                    {"$set": {
                        "id": new_id,
                        "status": "connected",
                        "phone": (candidate.get("user") or {}).get("id", "").split(":")[0] or conn.get("phone"),
                        "last_connected": datetime.now(timezone.utc).isoformat(),
                        "qr_code": None,
                    }}
                )
                return await db.channel_connections.find_one({"id": new_id}, {"_id": 0})

            # 3) Nothing connected out there — mark disconnected
            await db.channel_connections.update_one(
                {"id": conn_id}, {"$set": {"status": "disconnected"}}
            )
    except Exception as e:
        logger.warning(f"Sync failed for {conn_id}: {e}")
        raise HTTPException(status_code=502, detail="Erro ao sincronizar com o servico")

    return await db.channel_connections.find_one({"id": conn_id}, {"_id": 0})


@router.post("/connections/{conn_id}/disconnect")
async def disconnect_channel(
    conn_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    conn = await db.channel_connections.find_one({"id": conn_id, "company_id": user["company_id"]})
    if not conn:
        raise HTTPException(status_code=404, detail="Conexao nao encontrada")

    if conn["type"] == "whatsapp":
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                await client.post(f"{WA_SERVICE_URL}/instances/{conn_id}/disconnect")
        except Exception as e:
            logger.error(f"Disconnect error: {e}")

    await db.channel_connections.update_one(
        {"id": conn_id}, {"$set": {"status": "disconnected", "qr_code": None}}
    )
    return await db.channel_connections.find_one({"id": conn_id}, {"_id": 0})


# === WHATSAPP CONTACTS IMPORT ===
class ImportWaContactsRequest(BaseModel):
    mode: str = "all"  # all | with_name | without_name
    list_id: Optional[str] = None  # optional contact_lists doc to populate


@router.get("/connections/{conn_id}/wa-contacts")
async def get_whatsapp_contacts(
    conn_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    conn = await db.channel_connections.find_one({"id": conn_id, "company_id": user["company_id"]})
    if not conn:
        raise HTTPException(status_code=404, detail="Conexao nao encontrada")
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.get(f"{WA_SERVICE_URL}/instances/{conn_id}/contacts")
            data = r.json() if r.status_code == 200 else {"contacts": []}
        return data
    except Exception as e:
        logger.warning(f"wa-contacts fetch failed: {e}")
        return {"contacts": [], "error": str(e)[:120]}


@router.post("/connections/{conn_id}/import-contacts")
async def import_whatsapp_contacts(
    conn_id: str,
    body: ImportWaContactsRequest,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    conn = await db.channel_connections.find_one({"id": conn_id, "company_id": user["company_id"]})
    if not conn:
        raise HTTPException(status_code=404, detail="Conexao nao encontrada")
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.get(f"{WA_SERVICE_URL}/instances/{conn_id}/contacts")
            payload = r.json() if r.status_code == 200 else {"contacts": []}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Microservico indisponivel: {str(e)[:80]}")

    raw = payload.get("contacts") or []
    filtered = []
    for c in raw:
        phone = (c.get("phone") or "").strip()
        name = (c.get("name") or "").strip()
        if not phone:
            continue
        if body.mode == "with_name" and not name:
            continue
        if body.mode == "without_name" and name:
            continue
        filtered.append({"phone": phone, "name": name})

    # Insert/upsert into clients collection (lightweight)
    upserted = 0
    for it in filtered:
        existing = await db.clients.find_one({"company_id": user["company_id"], "phone": it["phone"]})
        if not existing:
            await db.clients.insert_one({
                "id": str(uuid.uuid4()),
                "company_id": user["company_id"],
                "name": it["name"] or it["phone"],
                "phone": it["phone"],
                "tags": [],
                "source": "whatsapp_import",
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            upserted += 1

    # Optionally append to a contact list
    appended = 0
    if body.list_id:
        await db.contact_lists.update_one(
            {"id": body.list_id, "company_id": user["company_id"]},
            {"$push": {"contacts": {"$each": filtered}}}
        )
        appended = len(filtered)

    return {"total_remote": len(raw), "imported": len(filtered), "new_clients": upserted, "list_appended": appended}


# === SEND MESSAGE VIA WHATSAPP ===
class SendMessageRequest(BaseModel):
    phone: str
    message: str

@router.post("/connections/{conn_id}/send")
async def send_whatsapp_message(
    conn_id: str,
    data: SendMessageRequest,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    conn = await db.channel_connections.find_one({"id": conn_id, "company_id": user["company_id"]})
    if not conn:
        raise HTTPException(status_code=404, detail="Conexao nao encontrada")
    if conn.get("status") != "connected":
        raise HTTPException(status_code=400, detail="Conexao nao ativa")

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(f"{WA_SERVICE_URL}/instances/{conn_id}/send", json={"phone": data.phone, "message": data.message})
            result = resp.json()
        if not result.get("success"):
            raise HTTPException(status_code=500, detail=result.get("error", "Erro ao enviar"))
        # Log message
        await db.message_log.insert_one({
            "id": str(uuid.uuid4()), "company_id": user["company_id"], "connection_id": conn_id,
            "direction": "outgoing", "phone": data.phone, "message": data.message,
            "created_at": datetime.now(timezone.utc).isoformat()
        })
        return {"success": True}
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=str(e))


# === WEBHOOKS FROM WHATSAPP SERVICE ===
@router.post("/webhook/presence")
async def webhook_presence(request: Request, db: AsyncIOMotorDatabase = Depends(get_database)):
    """Body: {instance_id, phone, presence: 'composing'|'paused'|'available'|'unavailable'|'recording'}"""
    data = await request.json()
    instance_id = data.get("instance_id")
    phone = (data.get("phone") or "").strip()
    presence = data.get("presence") or "available"
    conn = await db.channel_connections.find_one({"id": instance_id})
    if not conn or not phone:
        return {"ok": False}
    await db.contact_presence.update_one(
        {"company_id": conn["company_id"], "phone": phone},
        {"$set": {"presence": presence, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )
    return {"ok": True}


@router.post("/webhook/message-status")
async def webhook_message_status(request: Request, db: AsyncIOMotorDatabase = Depends(get_database)):
    """Body: {instance_id, message_id, status: 'sent'|'delivered'|'read'|'played'}
    Updates the matching outbound agent message in tickets."""
    data = await request.json()
    instance_id = data.get("instance_id")
    message_id = data.get("message_id")
    status_v = data.get("status")
    conn = await db.channel_connections.find_one({"id": instance_id})
    if not conn or not message_id or not status_v:
        return {"ok": False}
    await db.tickets.update_one(
        {"company_id": conn["company_id"], "messages.wa_message_id": message_id},
        {"$set": {"messages.$.delivery_status": status_v,
                  "messages.$.delivery_updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    return {"ok": True}


@router.get("/contact-presence")
async def list_contact_presence(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    """Recent presence updates (last 60s) for the current company. UI polls this to show typing."""
    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=60)).isoformat()
    docs = await db.contact_presence.find(
        {"company_id": user["company_id"], "updated_at": {"$gt": cutoff}},
        {"_id": 0}
    ).to_list(500)
    return docs


@router.post("/webhook/connected")
async def webhook_connected(request: Request, db: AsyncIOMotorDatabase = Depends(get_database)):
    data = await request.json()
    instance_id = data.get("instance_id")
    phone = data.get("phone", "")
    name = data.get("name", "")
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.channel_connections.update_one(
        {"id": instance_id},
        {"$set": {
            "status": "connected",
            "phone": phone,
            "connected_name": name,
            "last_connected": now_iso,
            "connected_at": now_iso,  # timestamp used to filter older WA messages
        }}
    )
    return {"ok": True}


@router.post("/webhook/message")
async def webhook_message(request: Request, db: AsyncIOMotorDatabase = Depends(get_database)):
    data = await request.json()
    instance_id = data.get("instance_id")
    conn = await db.channel_connections.find_one({"id": instance_id})
    if not conn:
        logger.warning(f"[webhook/message] instance not found: {instance_id}")
        return {"ok": False, "error": "instance_not_found"}

    company_id = conn["company_id"]
    phone = (data.get("phone") or "").strip()
    name = data.get("name") or phone or "Cliente"
    text = data.get("message") or ""
    msg_id = data.get("message_id")
    ts_raw = data.get("timestamp")
    logger.info(f"[webhook/message] {company_id[:8]} phone={phone} mid={msg_id} text='{text[:40]}'")

    # Filter out messages older than the moment this channel was connected.
    # The WA microservice forwards messageTimestamp in seconds.
    try:
        msg_ts = int(ts_raw) if ts_raw is not None else None
    except (TypeError, ValueError):
        msg_ts = None
    connected_at_iso = conn.get("connected_at")
    if msg_ts and connected_at_iso:
        try:
            connected_at_dt = datetime.fromisoformat(connected_at_iso.replace("Z", "+00:00"))
            connected_at_ts = int(connected_at_dt.timestamp())
            # Drop only messages that are clearly historical (older than 1h
            # before the connection moment). 1h grace absorbs any clock skew
            # between the Node.js microservice host and the backend.
            if msg_ts < connected_at_ts - 3600:
                logger.info(
                    f"[webhook] ignoring old WA msg (msg_ts={msg_ts} < conn_ts={connected_at_ts}) "
                    f"phone={phone} mid={msg_id}"
                )
                return {"ok": True, "ignored": "older_than_connected_at"}
        except Exception:
            pass

    # Log incoming message (raw)
    await db.message_log.insert_one({
        "id": str(uuid.uuid4()), "company_id": company_id, "connection_id": instance_id,
        "direction": "incoming", "phone": phone, "sender_name": data.get("name"),
        "message": text, "message_id": msg_id,
        "created_at": datetime.now(timezone.utc).isoformat()
    })

    # Find or create open ticket for this phone (so it appears in Atendimentos UI)
    if not phone:
        return {"ok": True}

    ticket = await db.tickets.find_one({
        "company_id": company_id,
        "customer_phone": phone,
        "status": {"$nin": ["fechado"]}
    })

    new_message = {
        "id": str(uuid.uuid4()),
        "content": text,
        "sender_type": "user",
        "sender_id": None,
        "sender_name": name,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "wa_message_id": msg_id,
    }

    if not ticket:
        ticket_id = str(uuid.uuid4())
        ticket_number = await next_ticket_number(db, company_id)
        ticket = {
            "id": ticket_id,
            "ticket_number": ticket_number,
            "company_id": company_id,
            "customer_name": name,
            "customer_phone": phone,
            "customer_email": None,
            "status": "aberto",
            "priority": "medium",
            "channel": "whatsapp",
            "description": text[:140] if text else None,
            "assigned_to": None,
            "messages": [new_message],
            "tags": [],
            "value": 0.0,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.tickets.insert_one(ticket)
    else:
        # Idempotency: skip if same wa message id already pushed
        existing_ids = [m.get("wa_message_id") for m in (ticket.get("messages") or [])]
        if msg_id and msg_id in existing_ids:
            return {"ok": True, "duplicate": True}
        await db.tickets.update_one(
            {"id": ticket["id"]},
            {"$push": {"messages": new_message},
             "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}}
        )

    return {"ok": True}


@router.delete("/connections/{conn_id}")
async def delete_connection(
    conn_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    result = await db.channel_connections.delete_one({"id": conn_id, "company_id": user["company_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Conexao nao encontrada")
    return {"message": "Conexao deletada"}


# === MESSAGE TEMPLATES ===
@router.get("/templates")
async def list_templates(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    templates = await db.message_templates.find(
        {"company_id": user["company_id"]}, {"_id": 0}
    ).to_list(100)
    return templates


@router.post("/templates")
async def create_template(
    data: TemplateCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    existing = await db.message_templates.find_one({
        "company_id": user["company_id"], "process_key": data.process_key
    })
    if existing:
        await db.message_templates.update_one(
            {"id": existing["id"]},
            {"$set": {"message": data.message, "active": data.active, "updated_at": datetime.now(timezone.utc).isoformat()}}
        )
        return await db.message_templates.find_one({"id": existing["id"]}, {"_id": 0})

    template = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "process_key": data.process_key,
        "label": data.label,
        "description": data.description,
        "message": data.message,
        "active": data.active,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.message_templates.insert_one(template)
    return {k: v for k, v in template.items() if k != "_id"}


@router.put("/templates/{template_id}")
async def update_template(
    template_id: str,
    data: TemplateUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    update_data = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.message_templates.update_one(
        {"id": template_id, "company_id": user["company_id"]}, {"$set": update_data}
    )
    return await db.message_templates.find_one({"id": template_id}, {"_id": 0})


# === SCHEDULED MESSAGES ===
@router.get("/scheduled-messages")
async def list_scheduled_messages(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
    status: str = None
):
    query = {"company_id": user["company_id"]}
    if status:
        query["status"] = status
    messages = await db.scheduled_messages.find(query, {"_id": 0}).sort("scheduled_at", 1).to_list(500)
    return messages


@router.post("/scheduled-messages")
async def create_scheduled_message(
    data: ScheduledMessageCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    msg = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "recipient": data.recipient,
        "channel": data.channel,
        "message": data.message,
        "template_key": data.template_key,
        "scheduled_at": data.scheduled_at,
        "status": "pendente",
        "created_by": user["id"],
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.scheduled_messages.insert_one(msg)
    return {k: v for k, v in msg.items() if k != "_id"}


@router.put("/scheduled-messages/{msg_id}")
async def update_scheduled_message(
    msg_id: str,
    data: ScheduledMessageUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    update_data = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    await db.scheduled_messages.update_one(
        {"id": msg_id, "company_id": user["company_id"]}, {"$set": update_data}
    )
    return await db.scheduled_messages.find_one({"id": msg_id}, {"_id": 0})


@router.delete("/scheduled-messages/{msg_id}")
async def delete_scheduled_message(
    msg_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    result = await db.scheduled_messages.delete_one({"id": msg_id, "company_id": user["company_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Mensagem nao encontrada")
    return {"message": "Mensagem deletada"}


# === REMARKETING / BULK MESSAGES ===
class RemarketingPreview(BaseModel):
    filter_type: str  # inactive_days | never_returned | birthday_month | service | all_active
    inactive_days: Optional[int] = 30
    service_id: Optional[str] = None
    month: Optional[int] = None  # 1..12 (defaults to current)


class BulkSendRequest(BaseModel):
    filter_type: str
    inactive_days: Optional[int] = 30
    service_id: Optional[str] = None
    month: Optional[int] = None
    message: str
    when: str = "now"  # now | scheduled
    scheduled_at: Optional[str] = None  # ISO datetime when when='scheduled'


async def _resolve_audience(db: AsyncIOMotorDatabase, company_id: str, body: dict) -> List[dict]:
    """Return a list of customer dicts matching the remarketing filter.
    Each item shape: {name, phone, last_appointment_date, last_service_name, days_since}
    """
    from datetime import date as _date
    from datetime import datetime as _dt
    today = _date.today()

    # Pull all clients of this company (filtered later)
    customers = await db.clients.find(
        {"company_id": company_id}, {"_id": 0}
    ).to_list(5000)
    if not customers:
        return []

    # Pull last appointment per customer (concluido takes priority, otherwise last by date)
    customer_ids = [c["id"] for c in customers if c.get("id")]
    last_apts: dict = {}
    if customer_ids:
        cursor = db.appointments.find(
            {"company_id": company_id, "customer_id": {"$in": customer_ids}, "status": "concluido"},
            {"_id": 0, "customer_id": 1, "date": 1, "service_id": 1, "service_name": 1}
        ).sort("date", -1)
        async for a in cursor:
            cid = a.get("customer_id")
            if cid and cid not in last_apts:
                last_apts[cid] = a

    filt = body.get("filter_type")
    inactive_days = int(body.get("inactive_days") or 30)
    service_id = body.get("service_id")
    month = body.get("month") or today.month

    audience: List[dict] = []
    for c in customers:
        cid = c.get("id")
        last = last_apts.get(cid)
        last_date_str = (last or {}).get("date", "")
        last_service = (last or {}).get("service_name", "")
        days_since = None
        if last_date_str:
            try:
                ly, lm, ld = last_date_str.split("-")
                days_since = (today - _date(int(ly), int(lm), int(ld))).days
            except Exception:
                days_since = None

        accept = False
        if filt == "all_active":
            accept = True
        elif filt == "inactive_days":
            accept = days_since is not None and days_since >= inactive_days
        elif filt == "never_returned":
            # Has exactly 1 concluded appointment AND that one is older than threshold
            if cid:
                count = await db.appointments.count_documents({
                    "company_id": company_id, "customer_id": cid, "status": "concluido"
                })
                accept = count == 1 and days_since is not None and days_since >= inactive_days
        elif filt == "birthday_month":
            bday = c.get("birth_date") or c.get("birthday") or ""
            try:
                # birth_date formats accepted: YYYY-MM-DD, DD/MM/YYYY, MM-DD
                bm = None
                if "-" in bday and len(bday) >= 7:
                    bm = int(bday.split("-")[1])
                elif "/" in bday and len(bday) >= 5:
                    bm = int(bday.split("/")[1])
                if bm == int(month):
                    accept = True
            except Exception:
                accept = False
        elif filt == "service":
            if service_id and last and last.get("service_id") == service_id:
                accept = True

        if not accept:
            continue
        if not c.get("phone"):
            continue

        audience.append({
            "id": cid,
            "name": c.get("name", ""),
            "phone": c.get("phone", ""),
            "birthday": c.get("birth_date") or c.get("birthday") or "",
            "last_appointment_date": last_date_str,
            "last_service_name": last_service,
            "days_since": days_since,
        })

    return audience


@router.post("/remarketing/preview")
async def remarketing_preview(
    data: RemarketingPreview,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    audience = await _resolve_audience(db, user["company_id"], data.model_dump())
    return {"count": len(audience), "audience": audience[:200]}


def _format_pt_date(iso_date: str) -> str:
    if not iso_date:
        return ""
    try:
        y, m, d = iso_date.split("-")
        return f"{d}/{m}/{y}"
    except Exception:
        return iso_date


def _substitute_personal(template: str, customer: dict, company_name: str, link_agendar: str) -> str:
    # Reuse existing render_template from notifications module
    from notifications import render_template
    variables = {
        "nome_cliente": customer.get("name", ""),
        "empresa": company_name,
        "link_agendar": link_agendar,
        "ultimo_atendimento": _format_pt_date(customer.get("last_appointment_date", "")),
        "ultimo_servico": customer.get("last_service_name", ""),
        "dias_sem_voltar": str(customer.get("days_since")) if customer.get("days_since") is not None else "",
        "aniversario": customer.get("birthday", ""),
    }
    return render_template(template, variables)


@router.post("/remarketing/bulk-send")
async def remarketing_bulk_send(
    data: BulkSendRequest,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    audience = await _resolve_audience(db, user["company_id"], data.model_dump())
    if not audience:
        raise HTTPException(status_code=400, detail="Nenhum cliente encontrado para os filtros selecionados")

    company = await db.companies.find_one({"id": user["company_id"]}, {"_id": 0, "name": 1})
    company_name = (company or {}).get("name", "")
    page = await db.booking_pages.find_one({"company_id": user["company_id"]}, {"_id": 0, "slug": 1})
    slug = (page or {}).get("slug", "")
    base_url = os.environ.get("FRONTEND_PUBLIC_URL") or os.environ.get("PUBLIC_URL") or ""
    from urllib.parse import urlencode, quote

    when = (data.when or "now").lower()
    if when == "scheduled" and not data.scheduled_at:
        raise HTTPException(status_code=400, detail="scheduled_at e obrigatorio quando when=scheduled")

    if when == "now":
        # Send immediately via baileys
        from notifications import _get_active_whatsapp_conn, _send_via_baileys
        conn = await _get_active_whatsapp_conn(db, user["company_id"])
        if not conn:
            raise HTTPException(status_code=502, detail="Nenhum WhatsApp conectado para envio")
        sent = 0
        failed = 0
        for c in audience:
            qs = ""
            if c.get("name") or c.get("phone"):
                qs = "?" + urlencode({"name": c.get("name", ""), "phone": c.get("phone", "")}, quote_via=quote)
            link_agendar = f"{base_url.rstrip('/')}/{slug}/agenda{qs}" if base_url and slug else ""
            personal_msg = _substitute_personal(data.message, c, company_name, link_agendar)
            ok = await _send_via_baileys(conn["id"], c["phone"], personal_msg)
            if ok:
                sent += 1
            else:
                failed += 1
        return {"message": f"{sent} mensagens enviadas, {failed} falhas", "sent": sent, "failed": failed, "total": len(audience)}

    # Scheduled: store one scheduled_messages doc per recipient
    inserted = 0
    for c in audience:
        qs = ""
        if c.get("name") or c.get("phone"):
            qs = "?" + urlencode({"name": c.get("name", ""), "phone": c.get("phone", "")}, quote_via=quote)
        link_agendar = f"{base_url.rstrip('/')}/{slug}/agenda{qs}" if base_url and slug else ""
        personal_msg = _substitute_personal(data.message, c, company_name, link_agendar)
        await db.scheduled_messages.insert_one({
            "id": str(uuid.uuid4()),
            "company_id": user["company_id"],
            "recipient": c["phone"],
            "recipient_name": c.get("name", ""),
            "channel": "whatsapp",
            "message": personal_msg,
            "scheduled_at": data.scheduled_at,
            "status": "pendente",
            "campaign_filter": data.filter_type,
            "created_by": user["id"],
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        inserted += 1
    return {"message": f"{inserted} mensagens agendadas", "scheduled": inserted, "total": len(audience)}


# === CHAT INTERNO ===
class ChatMessageCreate(BaseModel):
    content: str
    channel_id: Optional[str] = "general"

@router.get("/chat/messages")
async def get_chat_messages(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
    channel_id: str = "general",
    limit: int = 50
):
    messages = await db.internal_chat.find(
        {"company_id": user["company_id"], "channel_id": channel_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(limit)
    return list(reversed(messages))


@router.post("/chat/messages")
async def send_chat_message(
    data: ChatMessageCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    msg = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "channel_id": data.channel_id,
        "sender_id": user["id"],
        "sender_name": user["name"],
        "content": data.content,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.internal_chat.insert_one(msg)
    return {k: v for k, v in msg.items() if k != "_id"}


@router.get("/chat/channels")
async def get_chat_channels(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    channels = await db.chat_channels.find(
        {"company_id": user["company_id"]}, {"_id": 0}
    ).to_list(50)
    if not channels:
        default = {
            "id": "general",
            "company_id": user["company_id"],
            "name": "Geral",
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await db.chat_channels.insert_one(default)
        return [{k: v for k, v in default.items() if k != "_id"}]
    return channels
