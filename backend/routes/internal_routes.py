"""Internal-only endpoints used by sibling services (whatsapp-service /
Baileys microservice). Protected by a shared header token so they can't
be hit from the public preview/production URL even though they live under
/api like everything else (the cluster ingress doesn't distinguish).

Currently exposes:
- WA sent-message cache (POST + GET) used by getMessage() in Baileys to
  reply to retry requests without dropping the original payload. Without
  this the recipient sees "Aguardando mensagem" forever after a deploy
  restarts the WhatsApp service in-flight.
"""
import os
import logging
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Header, Query
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel
from typing import Optional, Any, Dict

from database import get_database

logger = logging.getLogger("internal_routes")
router = APIRouter(prefix="/internal", tags=["internal"])

INTERNAL_TOKEN = os.environ.get("INTERNAL_TOKEN", "agentcrm-internal")
# Plaintext cache for outbound messages — used by Baileys' `getMessage`
# callback when a recipient asks for a retry decrypt. Pre-2026-02-15 (G2)
# this was 24h, which left messages older than a day unrecoverable when
# the recipient's WhatsApp opens days later asking for the original
# plaintext (very common pattern: customer ignores message Friday, opens
# Tuesday, phone requests retry, Baileys cache MISS → "Aguardando
# mensagem" placeholder displayed forever). Bumped to 7 days covering the
# vast majority of late-open windows. Storage cost is negligible — text
# payloads only, MongoDB TTL evicts automatically.
SENT_CACHE_TTL_HOURS = 24 * 7  # 7 days


def _require_internal_token(x_internal_token: Optional[str] = Header(default=None)) -> None:
    if x_internal_token != INTERNAL_TOKEN:
        raise HTTPException(403, "Internal endpoint")


class WaCacheStoreIn(BaseModel):
    jid: Optional[str] = None
    msg_id: str
    message: Dict[str, Any]


@router.post("/wa-cache/sent", dependencies=[Depends(_require_internal_token)])
async def store_sent_message(
    payload: WaCacheStoreIn,
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Upsert by msg_id (Baileys-generated). We also store a composite
    `jid_msg_id` so retrieval by (jid, msg_id) is O(1)."""
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(hours=SENT_CACHE_TTL_HOURS)
    doc = {
        "msg_id": payload.msg_id,
        "jid": payload.jid,
        "jid_msg_id": f"{payload.jid or ''}:{payload.msg_id}",
        "message": payload.message,
        "created_at": now.isoformat(),
        # Mongo TTL index uses an ISODate field, so store it native.
        "expires_at": expires_at,
    }
    await db.wa_sent_cache.update_one(
        {"msg_id": payload.msg_id},
        {"$set": doc},
        upsert=True,
    )
    return {"ok": True}


@router.get("/wa-cache/sent", dependencies=[Depends(_require_internal_token)])
async def get_sent_message(
    jid: Optional[str] = Query(default=None),
    msg_id: str = Query(...),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Look up by (jid, msg_id) first (more specific) then by msg_id
    alone — mirrors the recallSent priority in node."""
    if jid:
        doc = await db.wa_sent_cache.find_one(
            {"jid_msg_id": f"{jid}:{msg_id}"}, {"_id": 0, "message": 1}
        )
        if doc:
            return {"message": doc.get("message")}
    doc = await db.wa_sent_cache.find_one({"msg_id": msg_id}, {"_id": 0, "message": 1})
    return {"message": doc.get("message") if doc else None}


async def ensure_wa_cache_indexes(db: AsyncIOMotorDatabase) -> None:
    """Idempotent index creation for the wa_sent_cache collection. Called
    from server startup. Uses a TTL index on `expires_at` so MongoDB auto-
    deletes entries older than SENT_CACHE_TTL_HOURS without us needing a
    cleanup cron."""
    try:
        await db.wa_sent_cache.create_index("msg_id", unique=True)
        await db.wa_sent_cache.create_index("jid_msg_id")
        # TTL: documents expire when their `expires_at` becomes "now". The
        # `expireAfterSeconds=0` flag tells Mongo to use the field value as
        # the absolute expiry timestamp.
        await db.wa_sent_cache.create_index("expires_at", expireAfterSeconds=0)
    except Exception as e:
        logger.warning(f"[wa_sent_cache] index init failed: {e}")
