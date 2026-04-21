"""
Background task that keeps the WhatsApp Baileys microservice awake on Render free tier.
- Pings WA_SERVICE_URL/health every 10 minutes
- If the service responds with fewer instances than expected (DB has X "connected"
  connections but Node reports 0), it re-triggers connect for those instances
  so Baileys can restore the session from disk.
"""
import asyncio
import logging
import os
from typing import Optional

import httpx

from database import get_database

logger = logging.getLogger(__name__)

WA_SERVICE_URL = os.environ.get("WA_SERVICE_URL", "http://localhost:3002")
KEEPALIVE_INTERVAL_SECONDS = int(os.environ.get("WA_KEEPALIVE_INTERVAL", "600"))  # 10 min default


async def ping_and_heal():
    """Ping the WhatsApp service and heal stale sessions."""
    db = await get_database()
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            # 1) Health check (wakes Render free tier)
            resp = await client.get(f"{WA_SERVICE_URL}/health")
            data = resp.json()
            node_instances = data.get("instances", 0)

            # 2) Find all "connected" or "waiting_qr" sessions in our DB
            active_sessions = await db.channel_connections.find(
                {"type": "whatsapp", "status": {"$in": ["connected", "waiting_qr", "connecting"]}},
                {"_id": 0, "id": 1, "status": 1}
            ).to_list(200)

            # 3) If DB has more active than Node knows, re-trigger connect
            #    (this happens after Render wakes from sleep)
            if len(active_sessions) > node_instances:
                logger.warning(
                    f"[WA-keepalive] DB has {len(active_sessions)} active sessions "
                    f"but Node has {node_instances}. Rehydrating..."
                )
                for s in active_sessions:
                    try:
                        await client.post(f"{WA_SERVICE_URL}/instances/{s['id']}/connect")
                    except Exception as e:
                        logger.warning(f"[WA-keepalive] Failed to reconnect {s['id']}: {e}")
    except Exception as e:
        logger.warning(f"[WA-keepalive] Ping failed: {e}")


async def start_keepalive_loop():
    """Background loop — runs forever."""
    # Wait a bit before first ping to allow services to start
    await asyncio.sleep(30)
    logger.info(f"[WA-keepalive] Loop started, interval={KEEPALIVE_INTERVAL_SECONDS}s, target={WA_SERVICE_URL}")
    while True:
        try:
            await ping_and_heal()
        except Exception as e:
            logger.error(f"[WA-keepalive] Unexpected error: {e}")
        await asyncio.sleep(KEEPALIVE_INTERVAL_SECONDS)
