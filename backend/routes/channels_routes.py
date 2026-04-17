from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase
from database import get_database
from auth import get_current_user
from pydantic import BaseModel
from typing import Optional, List
import uuid
from datetime import datetime, timezone

router = APIRouter(prefix="/channels", tags=["channels"])


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
    qr_data = f"connect-{conn_id}-{uuid.uuid4().hex[:8]}"
    await db.channel_connections.update_one(
        {"id": conn_id}, {"$set": {"status": "waiting_qr", "qr_code": qr_data}}
    )
    return await db.channel_connections.find_one({"id": conn_id}, {"_id": 0})


@router.post("/connections/{conn_id}/disconnect")
async def disconnect_channel(
    conn_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    await db.channel_connections.update_one(
        {"id": conn_id, "company_id": user["company_id"]},
        {"$set": {"status": "disconnected", "qr_code": None}}
    )
    return await db.channel_connections.find_one({"id": conn_id}, {"_id": 0})


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
