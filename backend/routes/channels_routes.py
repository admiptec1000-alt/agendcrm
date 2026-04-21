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
from datetime import datetime, timezone

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
@router.post("/webhook/connected")
async def webhook_connected(request: Request, db: AsyncIOMotorDatabase = Depends(get_database)):
    data = await request.json()
    instance_id = data.get("instance_id")
    phone = data.get("phone", "")
    name = data.get("name", "")
    await db.channel_connections.update_one(
        {"id": instance_id},
        {"$set": {"status": "connected", "phone": phone, "connected_name": name, "last_connected": datetime.now(timezone.utc).isoformat()}}
    )
    return {"ok": True}


@router.post("/webhook/message")
async def webhook_message(request: Request, db: AsyncIOMotorDatabase = Depends(get_database)):
    data = await request.json()
    instance_id = data.get("instance_id")
    conn = await db.channel_connections.find_one({"id": instance_id})
    if not conn:
        return {"ok": False}

    # Log incoming message
    await db.message_log.insert_one({
        "id": str(uuid.uuid4()), "company_id": conn["company_id"], "connection_id": instance_id,
        "direction": "incoming", "phone": data.get("phone"), "sender_name": data.get("name"),
        "message": data.get("message"), "message_id": data.get("message_id"),
        "created_at": datetime.now(timezone.utc).isoformat()
    })
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
