"""WhatsApp humanization helper — single source of truth for converting a
channel_connection's `humanization` config into the `humanize_*` kwargs the
WA microservice (`/instances/{id}/send`) understands.

Used by:
  - flow_engine._send_whatsapp (bot replies during flow runtime)
  - routes/crm_routes.py (campaigns, manual ticket-close message)
  - scheduler.py (auto-close goodbye messages, billing reminders)

The microservice always honors `humanize_typing_ms`. If the connection has
humanization disabled (or no config), returns {} — preserving the original
zero-delay behavior to avoid breaking any working flow.

2026-02-28 — Created as part of the bulk-message humanization work.
"""
from __future__ import annotations

import random
from typing import Any, Optional


async def humanize_kwargs(db, connection_id: Optional[str]) -> dict:
    """Read `channel_connections[id].humanization` and return a dict suitable
    for splatting into the JSON body of `/instances/{id}/send`. Returns {}
    when disabled / not configured / connection unknown."""
    if not connection_id:
        return {}
    try:
        conn = await db.channel_connections.find_one(
            {"id": connection_id},
            {"_id": 0, "humanization": 1},
        )
    except Exception:
        return {}
    cfg = (conn or {}).get("humanization") or {}
    if not cfg.get("enabled"):
        return {}
    tmin = max(0, int(cfg.get("typing_min_ms", 800) or 0))
    tmax = max(tmin, int(cfg.get("typing_max_ms", 2500) or 0))
    typing_ms = random.randint(tmin, tmax) if tmax > 0 else 0
    out: dict[str, Any] = {}
    if typing_ms > 0:
        out["humanize_typing_ms"] = typing_ms
    if cfg.get("presence_online"):
        out["humanize_presence"] = "available"
    return out
