"""Regression test: webhook /messages/upsert with `from_me=true` echo of a
bot-sent message must NOT duplicate the message in the ticket NOR pause
the bot. Reproduces the production bug fixed on 2026-02-18.

We call `webhook_message` directly with a stub Request that returns the
desired JSON body, against an in-memory fake mongo.
"""
import asyncio
from datetime import datetime, timedelta, timezone
import importlib
import sys

import pytest


sys.path.insert(0, "/app/backend")


class _UpdateResult:
    def __init__(self, matched=1):
        self.matched_count = matched
        self.modified_count = matched


class FakeColl:
    def __init__(self, name):
        self.name = name
        self.docs = []

    def _match(self, doc, q):
        for k, v in q.items():
            if k == "messages.id":
                msgs = doc.get("messages") or []
                if not any(m.get("id") == v for m in msgs):
                    return False
                continue
            if isinstance(v, dict):
                # support {"$ne": x} and {"$nin": [...]}
                if "$ne" in v and doc.get(k) == v["$ne"]:
                    return False
                if "$nin" in v and doc.get(k) in v["$nin"]:
                    return False
                if "$in" in v and doc.get(k) not in v["$in"]:
                    return False
                continue
            if doc.get(k) != v:
                return False
        return True

    async def find_one(self, q, proj=None):
        for d in self.docs:
            if self._match(d, q):
                return {k: v for k, v in d.items()}
        return None

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    async def update_one(self, q, update):
        for d in self.docs:
            if self._match(d, q):
                if "$set" in update:
                    for k, v in update["$set"].items():
                        if k.startswith("messages.$."):
                            field = k.split(".", 2)[2]
                            msg_id = q.get("messages.id")
                            for m in d.get("messages") or []:
                                if m.get("id") == msg_id:
                                    m[field] = v
                        else:
                            d[k] = v
                if "$push" in update:
                    for k, v in update["$push"].items():
                        d.setdefault(k, []).append(v)
                if "$inc" in update:
                    for k, v in update["$inc"].items():
                        d[k] = d.get(k, 0) + v
                return _UpdateResult(1)
        return _UpdateResult(0)

    async def update_many(self, q, update):
        return await self.update_one(q, update)

    def find(self, q=None, proj=None):
        results = [d for d in self.docs if not q or self._match(d, q)]

        class _Cursor:
            def __init__(self, items):
                self.items = items

            async def to_list(self, n):
                return self.items[:n]

            def sort(self, *args, **kwargs):
                return self

            def limit(self, n):
                self.items = self.items[:n]
                return self
        return _Cursor(results)

    async def count_documents(self, q):
        return len([d for d in self.docs if self._match(d, q)])

    async def find_one_and_update(self, q, update, **kw):
        for d in self.docs:
            if self._match(d, q):
                if "$set" in update:
                    d.update(update["$set"])
                if "$inc" in update:
                    for k, v in update["$inc"].items():
                        d[k] = d.get(k, 0) + v
                return {k: v for k, v in d.items()}
        return None


class FakeDB:
    def __init__(self):
        self.tickets = FakeColl("tickets")
        self.companies = FakeColl("companies")
        self.channel_connections = FakeColl("channel_connections")
        self.flow_builders = FakeColl("flow_builders")
        self.flow_send_log = FakeColl("flow_send_log")
        self.message_log = FakeColl("message_log")
        self.clients = FakeColl("clients")
        self.counters = FakeColl("counters")
        self.files = FakeColl("files")
        self.fs_files = FakeColl("fs.files")
        self.fs_chunks = FakeColl("fs.chunks")
        self.flow_inflight = FakeColl("flow_inflight")

    def __getattr__(self, name):
        coll = FakeColl(name)
        setattr(self, name, coll)
        return coll


class _FakeRequest:
    def __init__(self, body):
        self._body = body

    async def json(self):
        return self._body


async def _seed(db, *, with_bot_msg_age_seconds=0, bot_msg_wa_id=None):
    company_id = "company-test"
    ticket_id = "ticket-test"
    instance_id = "inst-test"
    bot_msg_text = (
        "Escolha uma opção:\n\n[ 1 ] - Já sou cliente\n[ 2 ] - Não sou cliente"
    )
    await db.companies.insert_one({
        "id": company_id, "pause_bot_on_human_intervention": True,
    })
    await db.channel_connections.insert_one({
        "id": instance_id,
        "company_id": company_id,
        "type": "whatsapp",
        "status": "connected",
        "connected_name": "8ip Tecnologia",
        "connected_at": (
            datetime.now(timezone.utc) - timedelta(days=1)
        ).isoformat(),
    })
    bot_ts = datetime.now(timezone.utc) - timedelta(seconds=with_bot_msg_age_seconds)
    await db.tickets.insert_one({
        "id": ticket_id,
        "company_id": company_id,
        "connection_id": instance_id,
        "customer_phone": "5562999998888",
        "status": "aberto",
        "channel": "whatsapp",
        "active_flow_id": "flow-1",
        "active_flow_node_id": "main_menu",
        "messages": [{
            "id": "msg-bot-1",
            "content": bot_msg_text,
            "sender_type": "agent",
            "sender_name": "Bot (Flow)",
            "wa_message_id": bot_msg_wa_id,  # None reproduces the prod bug
            "created_at": bot_ts.isoformat(),
        }],
    })
    return company_id, ticket_id, instance_id, bot_msg_text


@pytest.mark.asyncio
async def test_from_me_echo_of_bot_message_is_deduped():
    db = FakeDB()
    _, ticket_id, instance_id, bot_msg_text = await _seed(
        db, with_bot_msg_age_seconds=2, bot_msg_wa_id=None,
    )

    import routes.channels_routes as ch
    importlib.reload(ch)

    payload = {
        "instance_id": instance_id,
        "phone": "5562999998888",
        "message": bot_msg_text,
        "from_me": True,
        "message_id": "WA-ECHO-REAL-ID-9999",
    }
    req = _FakeRequest(payload)
    res = await ch.webhook_message(request=req, db=db)

    assert res.get("self_echo") is True or res.get("duplicate") is True, (
        f"Expected self-echo dedup, got {res!r}"
    )
    t = await db.tickets.find_one({"id": ticket_id})
    assert len(t.get("messages") or []) == 1, (
        f"Self-echo was inserted as a new message; "
        f"messages_count={len(t.get('messages') or [])}"
    )
    assert not t.get("bot_paused"), "Bot was incorrectly paused by a self-echo"
    assert t["messages"][0].get("wa_message_id") == "WA-ECHO-REAL-ID-9999", (
        "wa_message_id should have been backfilled from the echo for "
        "future-fast-path dedup"
    )


@pytest.mark.asyncio
async def test_from_me_real_operator_message_still_pauses_bot():
    """Sanity: a real operator-typed message (different content) MUST still
    pause the bot when the company opted in."""
    db = FakeDB()
    _, ticket_id, instance_id, _ = await _seed(
        db, with_bot_msg_age_seconds=2, bot_msg_wa_id=None,
    )

    import routes.channels_routes as ch
    importlib.reload(ch)

    payload = {
        "instance_id": instance_id,
        "phone": "5562999998888",
        "message": "Oi, aqui é o operador, em que posso ajudar?",
        "from_me": True,
        "message_id": "WA-REAL-OPERATOR-ID",
    }
    req = _FakeRequest(payload)
    await ch.webhook_message(request=req, db=db)

    t = await db.tickets.find_one({"id": ticket_id})
    assert len(t.get("messages") or []) == 2
    assert t.get("bot_paused") is True, "Real operator message must pause bot"

