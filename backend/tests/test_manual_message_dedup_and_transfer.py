"""Regression tests for the "manual message duplicating on client" and
"transferred ticket history blank" bugs (2026-08-14).

Bug 1 — Duplicate manual messages:
  crm_routes.add_message_to_ticket used to (a) $push the message ONLY
  AFTER awaiting Baileys and (b) store `wa_message_id = res.get("jid")`
  (which was the recipient JID, NOT the real WA message id). The
  combined effect was:
    - A race where the `messages.upsert` fromMe=true echo webhook
      arrived BEFORE the operator message was persisted → the webhook's
      self-echo dedup did not find a matching message → a DUPLICATE
      message was appended AND the customer saw the "Reenviar" button
      (delivery_status stayed at initial because /webhook/message-status
      could never match the stored wa_message_id).
  Fix: persist the message BEFORE the send, then $set delivery_status /
  wa_message_id after. Store the real `message_id` from Baileys.

Bug 2 — Blank history on ticket transfer:
  Several code paths (flow_engine transfer_message, scheduler auto_close,
  crm_routes manual_close) persisted system messages using a legacy
  schema `{from, text, timestamp, system, reason}` — no `id`, no
  `content`, no `sender_type`, no `created_at`. In the CRM UI this
  produced empty bubbles AND multiple React children with the same
  undefined key. When a transferred ticket had several of these,
  the receiving agent's screen looked totally blank.
  Fix: use the standard schema `{id, content, sender_type, created_at,
  source, system}` in all three paths. Frontend also normalizes legacy
  messages for backward compat.
"""
import asyncio
import os
import sys
import pytest
from unittest.mock import AsyncMock, patch

# Ensure backend package importable
sys.path.insert(0, "/app/backend")


@pytest.mark.asyncio
async def test_flow_engine_transfer_message_uses_standard_schema():
    """When the ticket-menu resolves to a specific analyst and a
    transfer_message is configured, the persisted message must use the
    standard schema so the frontend renders content correctly."""
    from motor.motor_asyncio import AsyncIOMotorClient
    cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = cli[os.environ["DB_NAME"]]

    # Seed a test company + user + ticket
    company_id = "test_transfer_schema_co"
    user_id = "test_transfer_schema_user"
    ticket_id = "test_transfer_schema_tk"

    await db.tickets.delete_many({"id": ticket_id})
    await db.tickets.insert_one({
        "id": ticket_id,
        "company_id": company_id,
        "customer_phone": "5599999999999",
        "customer_name": "Test Client",
        "connection_id": "test-conn-id",
        "status": "aberto",
        "messages": [],
        "active_flow_id": "test-flow-id",
        "active_flow_node_id": "ticket-node-1",
        "flow_vars": {
            "__ticket_menu_options": [
                {"kind": "user", "user_id": user_id, "label": "Ana"},
                {"kind": "queue", "queue_id": None, "label": "Fila"},
            ],
        },
    })

    # Minimal flow with a ticket node containing a transfer_message
    flow = {
        "id": "test-flow-id",
        "company_id": company_id,
        "nodes": [
            {"id": "ticket-node-1", "type": "ticket", "data": {
                "config": {
                    "assigned_user_ids": [user_id],
                    "queue_id": None,
                    "transfer_message": "Ola {{nome}}, voce foi transferido para Ana.",
                }
            }},
        ],
        "edges": [],
    }

    ticket_doc = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})

    from flow_engine import advance_flow
    # Patch _send_whatsapp so we don't need the microservice — return a fake wa_message_id.
    with patch("flow_engine._send_whatsapp", new=AsyncMock(return_value="fake-wa-mid-42")):
        await advance_flow(db, ticket_doc, flow, incoming_text="1", is_initial=False)

    updated = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    msgs = updated.get("messages") or []
    assert len(msgs) == 1, f"expected 1 transfer message, got {len(msgs)}"
    m = msgs[0]
    # Must have the standard fields (bug fix invariant)
    assert m.get("id"), f"transfer message missing id: {m}"
    assert m.get("content"), f"transfer message missing content: {m}"
    assert m.get("sender_type") == "agent", f"expected sender_type=agent: {m}"
    assert m.get("created_at"), f"transfer message missing created_at: {m}"
    assert m.get("wa_message_id") == "fake-wa-mid-42"
    assert m.get("system") is True
    assert m.get("source") == "transfer"
    # And must NOT ONLY have the legacy fields
    assert "from" not in m or m.get("sender_type") == "agent", "legacy 'from' key must not be the only marker"

    await db.tickets.delete_many({"id": ticket_id})
    cli.close()


@pytest.mark.asyncio
async def test_cooldown_query_supports_both_schemas():
    """The auto_close/manual_close cooldown check must find prior messages
    stored under BOTH the legacy {reason, timestamp} schema AND the new
    {source, created_at} schema."""
    from motor.motor_asyncio import AsyncIOMotorClient
    from datetime import datetime, timezone, timedelta
    cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = cli[os.environ["DB_NAME"]]

    company_id = "test_cooldown_schema_co"
    phone = "5599888887777"

    await db.tickets.delete_many({"company_id": company_id})

    now = datetime.now(timezone.utc)
    recent_iso = now.isoformat()
    cutoff_iso = (now - timedelta(days=3)).isoformat()

    # Insert one ticket with legacy schema, another with new schema
    await db.tickets.insert_one({
        "id": "legacy-ticket",
        "company_id": company_id,
        "customer_phone": phone,
        "status": "fechado",
        "messages": [{
            "from": "bot",
            "text": "Encerramento legado",
            "type": "text",
            "timestamp": recent_iso,
            "system": True,
            "reason": "auto_close",
        }],
    })
    await db.tickets.insert_one({
        "id": "new-ticket",
        "company_id": company_id,
        "customer_phone": phone + "1",  # different phone to test the new schema alone
        "status": "fechado",
        "messages": [{
            "id": "m1",
            "content": "Encerramento novo",
            "sender_type": "agent",
            "created_at": recent_iso,
            "system": True,
            "source": "manual_close",
        }],
    })

    # Query mirrors the one in scheduler._process_ticket_auto_close.
    q_legacy = {
        "company_id": company_id,
        "customer_phone": phone,
        "$or": [
            {"messages": {"$elemMatch": {
                "system": True,
                "reason": {"$in": ["auto_close", "manual_close"]},
                "timestamp": {"$gte": cutoff_iso},
            }}},
            {"messages": {"$elemMatch": {
                "system": True,
                "source": {"$in": ["auto_close", "manual_close"]},
                "created_at": {"$gte": cutoff_iso},
            }}},
        ],
    }
    hit_legacy = await db.tickets.find_one(q_legacy, {"_id": 0, "id": 1})
    assert hit_legacy and hit_legacy["id"] == "legacy-ticket"

    q_new = dict(q_legacy)
    q_new["customer_phone"] = phone + "1"
    hit_new = await db.tickets.find_one(q_new, {"_id": 0, "id": 1})
    assert hit_new and hit_new["id"] == "new-ticket"

    await db.tickets.delete_many({"company_id": company_id})
    cli.close()


if __name__ == "__main__":
    asyncio.run(test_flow_engine_transfer_message_uses_standard_schema())
    asyncio.run(test_cooldown_query_supports_both_schemas())
    print("OK")
