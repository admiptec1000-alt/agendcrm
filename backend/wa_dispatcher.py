"""Unified WhatsApp dispatcher — single entrypoint that routes a send to the
right provider (Baileys microservice OR Meta Cloud API) based on the
`channel_connections[id].provider` field.

Used by:
  - flow_engine._send_whatsapp  (bot replies)
  - crm_routes.run_campaign_now (campaigns)
  - scheduler.py auto-close / billing reminders (future)

Return shape (success):
    {"success": True, "message_id": "wamid.xxx", "provider": "baileys"|"whatsapp_cloud"}

Return shape (failure):
    {"success": False, "error": "...", "provider": "..."}

2026-02-28 — Created as part of Fase 3 (Meta Cloud API).
"""
from __future__ import annotations

import os
import logging
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


async def dispatch_send_text(db, connection_id: str, to_phone: str, message: str) -> dict:
    """Send a text message via the configured provider for this connection.

    Looks up `channel_connections[connection_id]` to decide. Falls back to
    Baileys for legacy connections without `provider` field.
    """
    if not (connection_id and to_phone and message):
        return {"success": False, "error": "missing connection_id/to/message", "provider": "unknown"}
    conn = await db.channel_connections.find_one(
        {"id": connection_id},
        {"_id": 0, "provider": 1, "phone_number_id": 1, "company_id": 1, "humanization": 1},
    )
    if not conn:
        return {"success": False, "error": "connection not found", "provider": "unknown"}

    provider = (conn.get("provider") or "baileys").lower()

    if provider == "whatsapp_cloud":
        return await _send_via_meta(db, conn, to_phone, message)
    return await _send_via_baileys(db, connection_id, to_phone, message)


async def _send_via_baileys(db, connection_id: str, to_phone: str, message: str) -> dict:
    wa_url = os.environ.get("WA_SERVICE_URL", "http://localhost:3002")
    # Humanization (typing/presence)
    try:
        from wa_humanize import humanize_kwargs
        hum = await humanize_kwargs(db, connection_id)
    except Exception:
        hum = {}
    try:
        async with httpx.AsyncClient(timeout=25.0) as cli:
            r = await cli.post(
                f"{wa_url}/instances/{connection_id}/send",
                json={"phone": to_phone, "message": message, **hum},
            )
            if r.status_code != 200:
                return {"success": False, "error": f"baileys http {r.status_code}: {r.text[:120]}", "provider": "baileys"}
            body = r.json() if r.content else {}
            if not body.get("success"):
                return {"success": False, "error": body.get("error") or "baileys returned success=false", "provider": "baileys"}
            return {"success": True, "message_id": body.get("message_id"), "provider": "baileys"}
    except Exception as e:
        return {"success": False, "error": f"baileys exc: {str(e)[:120]}", "provider": "baileys"}


async def _send_via_meta(db, conn: dict, to_phone: str, message: str) -> dict:
    """Send via Meta Cloud API. Only works inside the 24h customer service
    window for free-form text. Outside the window the caller MUST use a
    template instead (separate code path).
    """
    from services.meta_cloud import get_company_meta_client, MetaApiError
    phone_number_id = conn.get("phone_number_id")
    company_id = conn.get("company_id")
    if not phone_number_id:
        return {"success": False, "error": "Meta connection sem phone_number_id", "provider": "whatsapp_cloud"}
    try:
        cli = await get_company_meta_client(db, company_id)
        res = await cli.send_text(phone_number_id, _normalize_e164(to_phone), message)
        # Meta returns {messages: [{id: "wamid..."}]}
        msg_id: Optional[str] = None
        try:
            msg_id = (res.get("messages") or [{}])[0].get("id")
        except Exception:
            pass
        return {"success": True, "message_id": msg_id, "provider": "whatsapp_cloud"}
    except MetaApiError as e:
        # Common: 470 = outside 24h window; need template instead.
        return {"success": False, "error": f"meta {e.http}: {e.message}", "provider": "whatsapp_cloud", "meta_code": e.code}
    except Exception as e:
        return {"success": False, "error": f"meta exc: {str(e)[:120]}", "provider": "whatsapp_cloud"}


def _normalize_e164(phone: str) -> str:
    """Strip non-digits. Meta accepts plain digits without '+'."""
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    return digits
