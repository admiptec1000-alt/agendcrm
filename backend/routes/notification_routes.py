from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase
from database import get_database
from auth import get_current_user
from pydantic import BaseModel
from typing import Optional, Dict, Any
import uuid
from datetime import datetime, timezone

router = APIRouter(prefix="/notifications", tags=["notifications"])

class NotificationSettingsUpdate(BaseModel):
    booking_confirmation: Optional[bool] = None
    booking_reminder_24h: Optional[bool] = None
    reminder_minutes_before: Optional[int] = None
    booking_cancelled: Optional[bool] = None
    new_client: Optional[bool] = None
    daily_summary: Optional[bool] = None
    survey_enabled: Optional[bool] = None
    survey_minutes_after: Optional[int] = None
    return_reminder_enabled: Optional[bool] = None
    return_reminder_days: Optional[int] = None
    channel: Optional[str] = None  # whatsapp, email, both

@router.get("/settings")
async def get_notification_settings(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    settings = await db.notification_settings.find_one(
        {"company_id": user["company_id"]},
        {"_id": 0}
    )
    if not settings:
        # Return defaults
        settings = {
            "company_id": user["company_id"],
            "booking_confirmation": True,
            "booking_reminder_24h": True,
            "reminder_minutes_before": 1440,
            "booking_cancelled": True,
            "new_client": False,
            "daily_summary": False,
            "survey_enabled": False,
            "survey_minutes_after": 120,
            "return_reminder_enabled": False,
            "return_reminder_days": 30,
            "channel": "whatsapp"
        }
    else:
        # Backfill default for older records
        settings.setdefault("reminder_minutes_before", 1440)
        settings.setdefault("survey_enabled", False)
        settings.setdefault("survey_minutes_after", 120)
        settings.setdefault("return_reminder_enabled", False)
        settings.setdefault("return_reminder_days", 30)
    return settings

@router.put("/settings")
async def update_notification_settings(
    data: NotificationSettingsUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    company_id = user["company_id"]
    existing = await db.notification_settings.find_one({"company_id": company_id})

    update_data = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}

    if existing:
        await db.notification_settings.update_one({"company_id": company_id}, {"$set": update_data})
    else:
        doc = {
            "id": str(uuid.uuid4()),
            "company_id": company_id,
            "booking_confirmation": True,
            "booking_reminder_24h": True,
            "reminder_minutes_before": 1440,
            "booking_cancelled": True,
            "new_client": False,
            "daily_summary": False,
            "survey_enabled": False,
            "survey_minutes_after": 120,
            "return_reminder_enabled": False,
            "return_reminder_days": 30,
            "channel": "whatsapp",
            **update_data
        }
        await db.notification_settings.insert_one(doc)

    updated = await db.notification_settings.find_one({"company_id": company_id}, {"_id": 0})
    if updated:
        updated.setdefault("reminder_minutes_before", 1440)
        updated.setdefault("survey_enabled", False)
        updated.setdefault("survey_minutes_after", 120)
        updated.setdefault("return_reminder_enabled", False)
        updated.setdefault("return_reminder_days", 30)
    return updated

@router.get("/history")
async def get_notification_history(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    notifications = await db.notification_history.find(
        {"company_id": user["company_id"]},
        {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return notifications

@router.post("/send-test")
async def send_test_notification(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    """Send a test notification (simulated)"""
    notif = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "type": "test",
        "title": "Notificacao de Teste",
        "message": "Esta e uma notificacao de teste do AgentCRM",
        "channel": "whatsapp",
        "status": "sent",
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.notification_history.insert_one(notif)
    return {k: v for k, v in notif.items() if k != "_id"}
