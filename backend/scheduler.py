"""
Background scheduler:
  - Sends appointment reminders X minutes before scheduled time (per company `reminder_minutes_before`)
  - Sends post-attendance satisfaction surveys X minutes after `concluded_at`
  - Sends scheduled bulk/campaign messages (collection: scheduled_messages, status=pendente)

Runs every 60 seconds.
"""
import asyncio
import logging
import os
from datetime import datetime, timezone, timedelta

import httpx

from database import get_database

logger = logging.getLogger(__name__)
SCHEDULER_INTERVAL = int(os.environ.get("SCHEDULER_INTERVAL_SECONDS", "60"))
WA_SERVICE_URL = os.environ.get("WA_SERVICE_URL", "http://localhost:3002")


async def _settings_for(db, company_id: str) -> dict:
    s = await db.notification_settings.find_one({"company_id": company_id}, {"_id": 0}) or {}
    s.setdefault("booking_reminder_24h", True)
    s.setdefault("reminder_minutes_before", 1440)
    s.setdefault("survey_enabled", False)
    s.setdefault("survey_minutes_after", 120)
    return s


async def _process_reminders(db, base_url: str):
    """Find appointments needing a reminder and send them."""
    from notifications import notify_appointment_reminder
    now = datetime.now(timezone.utc)
    # Group companies that have notifications enabled
    company_ids = await db.companies.distinct("id")
    for cid in company_ids:
        s = await _settings_for(db, cid)
        if not s.get("booking_reminder_24h"):
            continue
        minutes_before = int(s.get("reminder_minutes_before") or 1440)
        # Window: send if scheduled time is within [now+minutes_before-1m ; now+minutes_before+1m]
        target_dt = now + timedelta(minutes=minutes_before)
        date_str = target_dt.strftime("%Y-%m-%d")
        time_low = (target_dt - timedelta(minutes=1)).strftime("%H:%M")
        time_high = (target_dt + timedelta(minutes=1)).strftime("%H:%M")
        cursor = db.appointments.find({
            "company_id": cid,
            "status": {"$in": ["pendente", "confirmado"]},
            "date": date_str,
            "time": {"$gte": time_low, "$lte": time_high},
            "reminder_sent_at": {"$exists": False},
        }, {"_id": 0})
        async for apt in cursor:
            try:
                await notify_appointment_reminder(db, cid, apt, base_url)
            except Exception as e:
                logger.warning(f"[scheduler] reminder failed for {apt.get('id')}: {e}")


async def _process_surveys(db, base_url: str):
    """Send satisfaction survey X minutes after appointment was concluded."""
    from notifications import notify_satisfaction_survey
    now = datetime.now(timezone.utc)
    company_ids = await db.companies.distinct("id")
    for cid in company_ids:
        s = await _settings_for(db, cid)
        if not s.get("survey_enabled"):
            continue
        minutes_after = int(s.get("survey_minutes_after") or 120)
        # Find appointments concluded between [now-minutes_after-2m ; now-minutes_after+2m]
        target_dt = now - timedelta(minutes=minutes_after)
        low = (target_dt - timedelta(minutes=2)).isoformat()
        high = (target_dt + timedelta(minutes=2)).isoformat()
        cursor = db.appointments.find({
            "company_id": cid,
            "status": "concluido",
            "concluded_at": {"$gte": low, "$lte": high},
            "survey_sent_at": {"$exists": False},
        }, {"_id": 0})
        async for apt in cursor:
            try:
                await notify_satisfaction_survey(db, cid, apt, base_url)
            except Exception as e:
                logger.warning(f"[scheduler] survey failed for {apt.get('id')}: {e}")


async def _process_scheduled_bulk(db):
    """Send scheduled bulk messages whose scheduled_at is now or in the past."""
    from notifications import _get_active_whatsapp_conn, _send_via_baileys
    now_iso = datetime.now(timezone.utc).isoformat()
    cursor = db.scheduled_messages.find({
        "status": "pendente",
        "channel": "whatsapp",
        "scheduled_at": {"$lte": now_iso},
    }, {"_id": 0})
    async for msg in cursor:
        try:
            conn = await _get_active_whatsapp_conn(db, msg["company_id"])
            if not conn:
                # Skip; will retry next tick
                continue
            ok = await _send_via_baileys(conn["id"], msg["recipient"], msg["message"])
            await db.scheduled_messages.update_one(
                {"id": msg["id"]},
                {"$set": {
                    "status": "enviada" if ok else "falhou",
                    "sent_at": datetime.now(timezone.utc).isoformat(),
                }}
            )
        except Exception as e:
            logger.warning(f"[scheduler] bulk message {msg.get('id')} failed: {e}")


async def tick():
    db = await get_database()
    base_url = os.environ.get("FRONTEND_PUBLIC_URL", "")
    try:
        await _process_reminders(db, base_url)
    except Exception as e:
        logger.error(f"[scheduler] reminders error: {e}")
    try:
        await _process_surveys(db, base_url)
    except Exception as e:
        logger.error(f"[scheduler] surveys error: {e}")
    try:
        await _process_scheduled_bulk(db)
    except Exception as e:
        logger.error(f"[scheduler] bulk error: {e}")


async def start_scheduler_loop():
    await asyncio.sleep(20)
    logger.info(f"[scheduler] started, interval={SCHEDULER_INTERVAL}s")
    while True:
        try:
            await tick()
        except Exception as e:
            logger.error(f"[scheduler] tick error: {e}")
        await asyncio.sleep(SCHEDULER_INTERVAL)
