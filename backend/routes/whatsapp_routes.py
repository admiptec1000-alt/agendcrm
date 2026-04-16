from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase
from database import get_database
from auth import get_current_user
from pydantic import BaseModel
from typing import Optional
import uuid
from datetime import datetime, timezone

router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])

class ConnectionCreate(BaseModel):
    name: str
    phone: Optional[str] = None

class ConnectionUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None

@router.get("/connections")
async def list_connections(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    connections = await db.whatsapp_connections.find(
        {"company_id": user["company_id"]},
        {"_id": 0}
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
        "phone": data.phone,
        "status": "disconnected",
        "qr_code": None,
        "last_connected": None,
        "messages_today": 0,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.whatsapp_connections.insert_one(conn)
    return {k: v for k, v in conn.items() if k != "_id"}

@router.put("/connections/{conn_id}")
async def update_connection(
    conn_id: str,
    data: ConnectionUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    conn = await db.whatsapp_connections.find_one({"id": conn_id, "company_id": user["company_id"]})
    if not conn:
        raise HTTPException(status_code=404, detail="Conexao nao encontrada")
    
    update_data = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if update_data:
        if update_data.get("status") == "connected":
            update_data["last_connected"] = datetime.now(timezone.utc).isoformat()
        await db.whatsapp_connections.update_one({"id": conn_id}, {"$set": update_data})
    
    updated = await db.whatsapp_connections.find_one({"id": conn_id}, {"_id": 0})
    return updated

@router.post("/connections/{conn_id}/connect")
async def connect_whatsapp(
    conn_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    conn = await db.whatsapp_connections.find_one({"id": conn_id, "company_id": user["company_id"]})
    if not conn:
        raise HTTPException(status_code=404, detail="Conexao nao encontrada")
    
    # Simulate QR code generation
    qr_data = f"whatsapp-connect-{conn_id}-{uuid.uuid4().hex[:8]}"
    await db.whatsapp_connections.update_one(
        {"id": conn_id},
        {"$set": {"status": "connecting", "qr_code": qr_data}}
    )
    updated = await db.whatsapp_connections.find_one({"id": conn_id}, {"_id": 0})
    return updated

@router.post("/connections/{conn_id}/disconnect")
async def disconnect_whatsapp(
    conn_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    await db.whatsapp_connections.update_one(
        {"id": conn_id, "company_id": user["company_id"]},
        {"$set": {"status": "disconnected", "qr_code": None}}
    )
    updated = await db.whatsapp_connections.find_one({"id": conn_id}, {"_id": 0})
    return updated

@router.post("/connections/{conn_id}/simulate-connected")
async def simulate_connected(
    conn_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    """Simulate that the QR was scanned and connection is established"""
    await db.whatsapp_connections.update_one(
        {"id": conn_id, "company_id": user["company_id"]},
        {"$set": {
            "status": "connected",
            "qr_code": None,
            "last_connected": datetime.now(timezone.utc).isoformat(),
            "phone": f"+55 (11) 9{uuid.uuid4().hex[:4]}-{uuid.uuid4().hex[:4]}"
        }}
    )
    updated = await db.whatsapp_connections.find_one({"id": conn_id}, {"_id": 0})
    return updated

@router.delete("/connections/{conn_id}")
async def delete_connection(
    conn_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    result = await db.whatsapp_connections.delete_one({"id": conn_id, "company_id": user["company_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Conexao nao encontrada")
    return {"message": "Conexao deletada"}

@router.get("/connections/stats")
async def get_connection_stats(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    total = await db.whatsapp_connections.count_documents({"company_id": user["company_id"]})
    connected = await db.whatsapp_connections.count_documents({"company_id": user["company_id"], "status": "connected"})
    disconnected = await db.whatsapp_connections.count_documents({"company_id": user["company_id"], "status": "disconnected"})
    return {"total": total, "connected": connected, "disconnected": disconnected}
