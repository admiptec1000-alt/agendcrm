"""Iteration 73 — Regras de transferencia, ticket anterior, 1-ticket-por-conexao,
ordem cronologica (created_at = ts do WhatsApp), contador de nao lidas e
guarda anti-duplicidade do bot.

Roda contra o backend vivo (REACT_APP_BACKEND_URL) + Mongo local.
"""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
_fe_env = {}
with open(os.path.join(os.path.dirname(__file__), "..", "..", "frontend", ".env")) as fh:
    for line in fh:
        if "=" in line:
            k, v = line.strip().split("=", 1)
            _fe_env[k] = v

BASE_URL = _fe_env["REACT_APP_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
CRM_EMAIL, CRM_PASSWORD = "crm@test.com", "crm123"
TAG = "TEST_it73"
WEBHOOK = f"{BASE_URL}/api/channels/webhook/message"


def _mongo():
    return AsyncIOMotorClient(MONGO_URL)[DB_NAME]


def _run(coro):
    return asyncio.run(coro)


def _login():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": CRM_EMAIL, "password": CRM_PASSWORD}, timeout=30)
    r.raise_for_status()
    b = r.json()
    return b["access_token"], b["user"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def _new_phone():
    return "5562" + str(uuid.uuid4().int)[:9]


def _payload(conn_id, phone, message="oi", from_me=False, ts=None):
    return {
        "instance_id": conn_id, "phone": phone, "name": f"{TAG}_cliente", "message": message,
        "message_id": "WAMID_" + TAG + "_" + uuid.uuid4().hex[:12], "from_me": from_me,
        "timestamp": ts if ts is not None else int(datetime.now(timezone.utc).timestamp()),
    }


@pytest.fixture(scope="module")
def env():
    tok, user = _login()
    company_id = user["company_id"]
    conn_id = f"{TAG}_conn_" + uuid.uuid4().hex[:8]
    conn_flow_id = f"{TAG}_connF_" + uuid.uuid4().hex[:8]
    flow_id = f"{TAG}_flow_" + uuid.uuid4().hex[:8]
    queue_id = f"{TAG}_queue_" + uuid.uuid4().hex[:8]

    async def _seed():
        db = _mongo()
        for cid, dflow in ((conn_id, None), (conn_flow_id, flow_id)):
            await db.channel_connections.insert_one({
                "id": cid, "company_id": company_id, "type": "whatsapp", "provider": "baileys",
                "status": "connected", "name": cid, "queue_ids": [], "default_flow_id": dflow,
                "connected_name": f"{TAG} Operador", "connected_at": datetime.now(timezone.utc).isoformat(),
            })
        await db.flow_builders.insert_one({
            "id": flow_id, "company_id": company_id, "name": f"{TAG} flow",
            "nodes": [
                {"id": "start", "type": "flow", "data": {"nodeType": "start"}},
                {"id": "welcome", "type": "flow", "data": {"nodeType": "message", "config": {"text": f"{TAG} Bem-vindo!"}}},
            ],
            "edges": [{"id": "e1", "source": "start", "target": "welcome"}],
        })
        await db.queues.insert_one({"id": queue_id, "company_id": company_id, "name": f"{TAG} Fila"})
    _run(_seed())

    other_users = requests.get(f"{BASE_URL}/api/scheduling/company-users", headers=_h(tok), timeout=30).json()
    target_user = next((u for u in other_users if u["id"] != user["id"]), None)
    assert target_user, "precisa de um segundo usuario na empresa CRM Test"

    yield {"tok": tok, "user": user, "company_id": company_id, "conn_id": conn_id,
           "conn_flow_id": conn_flow_id, "flow_id": flow_id, "queue_id": queue_id, "target_user": target_user}

    async def _clean():
        db = _mongo()
        tks = await db.tickets.find(
            {"company_id": company_id, "$or": [
                {"connection_id": {"$in": [conn_id, conn_flow_id]}},
                {"customer_name": {"$regex": f"^{TAG}"}}]},
            {"_id": 0, "id": 1}).to_list(500)
        tids = [t["id"] for t in tks]
        await db.flow_send_log.delete_many({"ticket_id": {"$in": tids}})
        await db.tickets.delete_many({"id": {"$in": tids}})
        await db.channel_connections.delete_many({"id": {"$in": [conn_id, conn_flow_id]}})
        await db.flow_builders.delete_many({"id": flow_id})
        await db.queues.delete_many({"id": queue_id})
        await db.clients.delete_many({"company_id": company_id, "name": {"$regex": f"^{TAG}"}})
        await db.webhook_dedup.delete_many({"_id": {"$regex": TAG}})
    _run(_clean())


def _get(db_tid):
    async def _q():
        return await _mongo().tickets.find_one({"id": db_tid}, {"_id": 0})
    return _run(_q())


def _create_ticket(env, phone, name=None):
    r = requests.post(f"{BASE_URL}/api/crm/tickets", headers=_h(env["tok"]), timeout=30, json={
        "customer_name": name or f"{TAG}_cliente", "customer_phone": phone,
        "channel": "whatsapp", "connection_id": env["conn_id"]})
    assert r.status_code == 200, r.text
    return r.json()


# ── Fase 1: transferencia ────────────────────────────────────────────────
class TestTransfer:
    def test_transfer_to_user_closes_and_opens_new(self, env):
        t = _create_ticket(env, _new_phone())
        requests.post(f"{BASE_URL}/api/crm/tickets/{t['id']}/messages", headers=_h(env["tok"]), timeout=60,
                      json={"content": "msg antes da transferencia", "sender_type": "agent", "with_signature": False})
        r = requests.post(f"{BASE_URL}/api/crm/tickets/{t['id']}/transfer", headers=_h(env["tok"]), timeout=30,
                          json={"target_type": "user", "target_id": env["target_user"]["id"]})
        assert r.status_code == 200, r.text
        body = r.json()
        nt = body["new_ticket"]
        assert body["transferred"] is True
        assert nt["assigned_to"] == env["target_user"]["id"]
        assert nt["previous_ticket_id"] == t["id"]
        assert nt["origin"] == "transfer"
        assert nt["bot_paused"] is True and nt["bot_paused_reason"] == "transfer"
        assert nt["connection_id"] == t["connection_id"]
        assert nt["customer_phone"] == t["customer_phone"]
        # historico NAO copiado: so a nota de sistema
        assert len(nt["messages"]) == 1
        assert nt["messages"][0]["sender_type"] == "system"
        assert f"#{t['ticket_number']}" in nt["messages"][0]["content"]
        assert env["target_user"]["name"] in nt["messages"][0]["content"]
        old = _get(t["id"])
        assert old["status"] == "fechado"
        assert old["closed_reason"] == "transferido"
        assert old["transferred_to_ticket_id"] == nt["id"]
        assert len(old["messages"]) == 1  # mensagem original ficou no antigo

    def test_transfer_to_queue(self, env):
        t = _create_ticket(env, _new_phone())
        r = requests.post(f"{BASE_URL}/api/crm/tickets/{t['id']}/transfer", headers=_h(env["tok"]), timeout=30,
                          json={"target_type": "queue", "target_id": env["queue_id"]})
        assert r.status_code == 200, r.text
        nt = r.json()["new_ticket"]
        assert nt["queue_id"] == env["queue_id"]
        assert nt["assigned_to"] is None
        assert "fila" in nt["messages"][0]["content"].lower()
        assert _get(t["id"])["status"] == "fechado"

    def test_transfer_closed_ticket_rejected(self, env):
        t = _create_ticket(env, _new_phone())
        requests.post(f"{BASE_URL}/api/crm/tickets/{t['id']}/transfer", headers=_h(env["tok"]), timeout=30,
                      json={"target_type": "queue", "target_id": env["queue_id"]})
        r = requests.post(f"{BASE_URL}/api/crm/tickets/{t['id']}/transfer", headers=_h(env["tok"]), timeout=30,
                          json={"target_type": "queue", "target_id": env["queue_id"]})
        assert r.status_code == 400

    def test_transfer_invalid_target(self, env):
        t = _create_ticket(env, _new_phone())
        r = requests.post(f"{BASE_URL}/api/crm/tickets/{t['id']}/transfer", headers=_h(env["tok"]), timeout=30,
                          json={"target_type": "user", "target_id": "nao-existe"})
        assert r.status_code == 404
        r = requests.post(f"{BASE_URL}/api/crm/tickets/{t['id']}/transfer", headers=_h(env["tok"]), timeout=30,
                          json={"target_type": "banana", "target_id": "x"})
        assert r.status_code == 400
        assert _get(t["id"])["status"] != "fechado"


# ── Fase 1.6: 1 ticket aberto por conexao ────────────────────────────────
class TestOneOpenTicketPerConnection:
    def test_post_tickets_reuses_open(self, env):
        phone = _new_phone()
        a = _create_ticket(env, phone)
        assert not a.get("reused")
        b = _create_ticket(env, phone[2:])  # sem DDI -> mesmo ticket
        assert b.get("reused") is True
        assert b["id"] == a["id"]

    def test_post_tickets_after_close_creates_new(self, env):
        phone = _new_phone()
        a = _create_ticket(env, phone)
        requests.put(f"{BASE_URL}/api/crm/tickets/{a['id']}", headers=_h(env["tok"]), timeout=30, json={"status": "fechado"})
        b = _create_ticket(env, phone)
        assert not b.get("reused")
        assert b["id"] != a["id"]

    def test_open_for_client_reuses(self, env):
        phone = _new_phone()
        a = _create_ticket(env, phone)
        r = requests.post(f"{BASE_URL}/api/crm/tickets/open-for-client", headers=_h(env["tok"]), timeout=30,
                          json={"phone": phone, "name": f"{TAG}_cliente", "connection_id": env["conn_id"]})
        assert r.status_code == 200
        assert r.json()["id"] == a["id"] and r.json().get("reused") is True


# ── Fase 2: ticket anterior ──────────────────────────────────────────────
class TestPreviousTicket:
    def test_previous_chain_lazy(self, env):
        t1 = _create_ticket(env, _new_phone())
        r = requests.post(f"{BASE_URL}/api/crm/tickets/{t1['id']}/transfer", headers=_h(env["tok"]), timeout=30,
                          json={"target_type": "queue", "target_id": env["queue_id"]})
        t2 = r.json()["new_ticket"]
        r = requests.post(f"{BASE_URL}/api/crm/tickets/{t2['id']}/transfer", headers=_h(env["tok"]), timeout=30,
                          json={"target_type": "user", "target_id": env["target_user"]["id"]})
        t3 = r.json()["new_ticket"]

        p = requests.get(f"{BASE_URL}/api/crm/tickets/{t3['id']}/previous", headers=_h(env["tok"]), timeout=30).json()["previous"]
        assert p["id"] == t2["id"] and p["ticket_number"] == t2["ticket_number"]
        assert p["can_view"] is True  # admin
        assert p["has_older"] is True
        assert p["closed_reason"] == "transferido"
        assert isinstance(p["messages"], list) and len(p["messages"]) == 1

        p2 = requests.get(f"{BASE_URL}/api/crm/tickets/{t2['id']}/previous", headers=_h(env["tok"]), timeout=30).json()["previous"]
        assert p2["id"] == t1["id"]
        assert p2["has_older"] is False

        p1 = requests.get(f"{BASE_URL}/api/crm/tickets/{t1['id']}/previous", headers=_h(env["tok"]), timeout=30).json()
        assert p1["previous"] is None

    def test_previous_fallback_same_phone_connection(self, env):
        phone = _new_phone()
        a = _create_ticket(env, phone)
        requests.put(f"{BASE_URL}/api/crm/tickets/{a['id']}", headers=_h(env["tok"]), timeout=30, json={"status": "fechado"})
        b = _create_ticket(env, phone)
        p = requests.get(f"{BASE_URL}/api/crm/tickets/{b['id']}/previous", headers=_h(env["tok"]), timeout=30).json()["previous"]
        assert p and p["id"] == a["id"]


# ── Fase 4: ordem cronologica ────────────────────────────────────────────
class TestChronology:
    def test_webhook_uses_wa_timestamp(self, env):
        phone = _new_phone()
        old_ts = int((datetime.now(timezone.utc) - timedelta(hours=2)).timestamp())
        r = requests.post(WEBHOOK, json=_payload(env["conn_id"], phone, "mensagem atrasada", ts=old_ts), timeout=90)
        assert r.status_code == 200, r.text

        async def _q():
            return await _mongo().tickets.find_one({"company_id": env["company_id"], "connection_id": env["conn_id"], "customer_phone": {"$in": [phone, phone[2:]]}}, {"_id": 0})
        t = _run(_q())
        assert t, "ticket nao criado pelo webhook"
        m = t["messages"][-1]
        created = datetime.fromisoformat(m["created_at"])
        assert abs((created - datetime.fromtimestamp(old_ts, tz=timezone.utc)).total_seconds()) < 2
        assert m.get("received_at")
        assert datetime.fromisoformat(m["received_at"]) > created + timedelta(hours=1, minutes=59)


# ── Fase 3: contador de nao lidas ────────────────────────────────────────
class TestUnreadCounter:
    def test_unread_increments_and_resets(self, env):
        phone = _new_phone()
        t = _create_ticket(env, phone)
        requests.post(f"{BASE_URL}/api/crm/tickets/{t['id']}/claim", headers=_h(env["tok"]), timeout=30)
        # zera leitura agora
        requests.get(f"{BASE_URL}/api/crm/tickets/{t['id']}", headers=_h(env["tok"]), timeout=30)
        base = requests.get(f"{BASE_URL}/api/crm/tickets/counts", headers=_h(env["tok"]), timeout=30).json()
        assert "unread_atendendo" in base and "unread_tickets" in base
        import time; time.sleep(1.1)
        for txt in ("cliente 1", "cliente 2"):
            r = requests.post(WEBHOOK, json=_payload(env["conn_id"], phone, txt), timeout=90)
            assert r.status_code == 200
        after = requests.get(f"{BASE_URL}/api/crm/tickets/counts", headers=_h(env["tok"]), timeout=30).json()
        assert after["unread_atendendo"] >= base["unread_atendendo"] + 2
        assert after["unread_tickets"] >= base["unread_tickets"] + 1
        # abrir o ticket zera
        requests.get(f"{BASE_URL}/api/crm/tickets/{t['id']}", headers=_h(env["tok"]), timeout=30)
        reset = requests.get(f"{BASE_URL}/api/crm/tickets/counts", headers=_h(env["tok"]), timeout=30).json()
        assert reset["unread_atendendo"] <= base["unread_atendendo"]


# ── Fase 5: guarda do bot ────────────────────────────────────────────────
class TestBotGuard:
    def _logs(self, tid):
        async def _q():
            return await _mongo().flow_send_log.find({"ticket_id": tid}, {"_id": 0}).to_list(50)
        return _run(_q())

    def _ticket_by_phone(self, env, phone, conn):
        async def _q():
            return await _mongo().tickets.find_one({"company_id": env["company_id"], "connection_id": conn, "customer_phone": {"$in": [phone, phone[2:]]}}, {"_id": 0})
        return _run(_q())

    def test_no_bot_on_from_me_ticket(self, env):
        phone = _new_phone()
        r = requests.post(WEBHOOK, json=_payload(env["conn_flow_id"], phone, "oi do celular", from_me=True), timeout=90)
        assert r.status_code == 200
        t = self._ticket_by_phone(env, phone, env["conn_flow_id"])
        assert t is not None
        assert self._logs(t["id"]) == []
        assert not any((m.get("auto_flow_id") for m in t["messages"]))

    def test_bot_fires_on_inbound_once(self, env):
        phone = _new_phone()
        r = requests.post(WEBHOOK, json=_payload(env["conn_flow_id"], phone, "oi"), timeout=90)
        assert r.status_code == 200
        t = self._ticket_by_phone(env, phone, env["conn_flow_id"])
        logs = self._logs(t["id"])
        assert any(l.get("phase") in ("pre_send", "complete") for l in logs), logs
        bot_msgs = [m for m in t["messages"] if m.get("auto_flow_id")]
        assert len(bot_msgs) == 1

    def test_guard_helper_blocks_duplicate_without_reply(self, env):
        from flow_engine import _bot_already_sent_without_reply
        tid = str(uuid.uuid4())
        text = f"{TAG} Bem-vindo!"

        async def _seed_and_check():
            db = _mongo()
            now = datetime.now(timezone.utc).isoformat()
            await db.tickets.insert_one({
                "id": tid, "company_id": env["company_id"], "connection_id": env["conn_flow_id"],
                "customer_name": f"{TAG}_guard", "customer_phone": _new_phone(), "status": "aberto", "channel": "whatsapp",
                "messages": [
                    {"id": "a", "content": "oi", "sender_type": "user", "created_at": now},
                    {"id": "b", "content": text, "sender_type": "agent", "auto_flow_id": env["flow_id"], "created_at": now},
                ], "created_at": now, "updated_at": now,
            })
            blocked = await _bot_already_sent_without_reply(db, tid, text)
            other = await _bot_already_sent_without_reply(db, tid, "outro texto")
            await db.tickets.update_one({"id": tid}, {"$push": {"messages": {"id": "c", "content": "1", "sender_type": "user", "created_at": now}}})
            after_reply = await _bot_already_sent_without_reply(db, tid, text)
            # race: pre_send em andamento
            await db.flow_send_log.insert_one({"id": str(uuid.uuid4()), "ticket_id": tid, "text_preview": text[:120], "phase": "pre_send", "created_at": now})
            race = await _bot_already_sent_without_reply(db, tid, text)
            return blocked, other, after_reply, race
        blocked, other, after_reply, race = _run(_seed_and_check())
        assert blocked is True
        assert other is False
        assert after_reply is False
        assert race is True
