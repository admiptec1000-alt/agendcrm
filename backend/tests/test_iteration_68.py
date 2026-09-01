"""Iteration 68 — Idempotencia do webhook /api/channels/webhook/message.

Bug de producao: "Bem vindo... Selecione [1][2][9]" enviado 5-7x no mesmo
timestamp. Causa: N webhooks pro MESMO message_id -> N tickets -> N triggers
de flow. Fix: indice unique (connection_id, message_id) em message_log +
insert-first como lock, retornando {"ok": True, "duplicate": True,
"reason": "message_id_seen"}.

Cobertura:
  A) 3 webhooks sequenciais mesmo msg_id -> 1 ticket, 1 msg, dup nas 2 ultimas
  B) 5 webhooks paralelos mesmo msg_id -> 1 ticket, 1 message_log
  C) msg_ids diferentes mesmo phone -> mensagens acumuladas no mesmo ticket
  D) mesmo msg_id / phones diferentes na mesma conexao -> 2o eh duplicate
  E) payload SEM message_id -> continua funcionando (partial filter)
  F) flow trigger executa apenas 1x (flow_send_log)
"""
import os
import sys
import uuid
import asyncio
from datetime import datetime, timezone

import pytest
import requests
from dotenv import load_dotenv, dotenv_values

load_dotenv("/app/backend/.env")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

_fe = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _fe.get("REACT_APP_BACKEND_URL")).rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

CRM_EMAIL = "crm@test.com"
CRM_PASSWORD = "crm123"

TAG = "TEST_it68"
WEBHOOK = f"{BASE_URL}/api/channels/webhook/message"


def _mongo():
    return AsyncIOMotorClient(MONGO_URL)[DB_NAME]


def _run(coro):
    return asyncio.run(coro)


def _login():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": CRM_EMAIL, "password": CRM_PASSWORD},
        timeout=30,
    )
    assert r.status_code == 200, f"login failed {r.status_code} {r.text[:300]}"
    b = r.json()
    return b["access_token"], b["user"]


@pytest.fixture(scope="module")
def user():
    _, u = _login()
    return u


@pytest.fixture(scope="module")
def env(user):
    """Conexao conectada + flow default (start -> message) pro tenant CRM."""
    company_id = user["company_id"]
    conn_id = f"{TAG}_conn_" + uuid.uuid4().hex[:8]
    flow_id = f"{TAG}_flow_" + uuid.uuid4().hex[:8]

    async def _seed():
        db = _mongo()
        await db.flow_builders.insert_one({
            "id": flow_id,
            "company_id": company_id,
            "name": f"{TAG}_flow",
            "active": True,
            "nodes": [
                {"id": "start", "type": "flow", "data": {"nodeType": "start"}},
                {"id": "m1", "type": "flow", "data": {"nodeType": "message", "config": {
                    "text": f"{TAG} Bem vindo, selecione [1][2][9]"
                }}},
            ],
            "edges": [{"id": "e1", "source": "start", "target": "m1"}],
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        await db.channel_connections.insert_one({
            "id": conn_id,
            "company_id": company_id,
            "type": "whatsapp",
            "provider": "baileys",
            "status": "connected",
            "name": f"{TAG}_conn",
            "queue_ids": [],
            "default_flow_id": flow_id,
            "connected_at": datetime.now(timezone.utc).isoformat(),
        })
    _run(_seed())

    yield {"company_id": company_id, "conn_id": conn_id, "flow_id": flow_id}

    async def _clean():
        db = _mongo()
        tks = await db.tickets.find({"company_id": company_id,
                                     "customer_name": {"$regex": f"^{TAG}"}},
                                    {"_id": 0, "id": 1}).to_list(200)
        tids = [t["id"] for t in tks]
        await db.flow_send_log.delete_many({"ticket_id": {"$in": tids}})
        await db.tickets.delete_many({"id": {"$in": tids}})
        await db.tickets.delete_many({"connection_id": conn_id})
        await db.channel_connections.delete_one({"id": conn_id})
        await db.flow_builders.delete_one({"id": flow_id})
        await db.message_log.delete_many({"connection_id": conn_id})
        await db.clients.delete_many({"company_id": company_id, "name": {"$regex": f"^{TAG}"}})
    _run(_clean())


def _payload(conn_id, phone, msg_id, message="Oi", name=None, **extra):
    p = {
        "instance_id": conn_id,
        "phone": phone,
        "name": name or f"{TAG}_{phone[-4:]}",
        "message": message,
        "message_id": msg_id,
        "from_me": False,
        "timestamp": int(datetime.now(timezone.utc).timestamp()),
    }
    p.update(extra)
    return p


def _post(payload):
    return requests.post(WEBHOOK, json=payload, timeout=90)


def _tickets(company_id, phone, conn_id):
    async def _q():
        db = _mongo()
        return await db.tickets.find(
            {"company_id": company_id, "customer_phone": phone, "connection_id": conn_id},
            {"_id": 0},
        ).to_list(50)
    return _run(_q())


def _msglog(conn_id, msg_id):
    async def _q():
        db = _mongo()
        return await db.message_log.find(
            {"connection_id": conn_id, "message_id": msg_id}, {"_id": 0}
        ).to_list(50)
    return _run(_q())


def _flow_logs(ticket_id):
    async def _q():
        db = _mongo()
        return await db.flow_send_log.find({"ticket_id": ticket_id}, {"_id": 0}).to_list(100)
    return _run(_q())


# ── A) Idempotencia sequencial ────────────────────────────────────────
class TestSequentialIdempotence:
    def test_three_identical_webhooks_create_one_ticket_and_one_flow_trigger(self, env):
        phone = "5511" + uuid.uuid4().hex[:9].translate(str.maketrans("abcdef", "123456"))
        msg_id = "WAMID_" + TAG + uuid.uuid4().hex[:12]
        pl = _payload(env["conn_id"], phone, msg_id, message="oi quero atendimento")

        r1 = _post(pl)
        assert r1.status_code == 200, r1.text[:300]
        b1 = r1.json()
        assert b1.get("ok") is True
        assert not b1.get("duplicate"), f"1st call should not be duplicate: {b1}"

        r2 = _post(pl)
        r3 = _post(pl)
        for idx, r in ((2, r2), (3, r3)):
            assert r.status_code == 200, f"call {idx}: {r.status_code} {r.text[:200]}"
            b = r.json()
            assert b.get("ok") is True, f"call {idx}: {b}"
            assert b.get("duplicate") is True, f"call {idx} not flagged duplicate: {b}"
            assert b.get("reason") == "message_id_seen", f"call {idx}: {b}"

        tks = _tickets(env["company_id"], phone, env["conn_id"])
        assert len(tks) == 1, f"expected exactly 1 ticket, got {len(tks)}"
        t = tks[0]

        # exatamente 1 mensagem do cliente no ticket
        inbound = [m for m in (t.get("messages") or []) if m.get("sender_type") == "user"]
        assert len(inbound) == 1, f"expected 1 inbound msg, got {len(inbound)}: {inbound}"

        # message_log com 1 unica entrada pro msg_id
        logs = _msglog(env["conn_id"], msg_id)
        assert len(logs) == 1, f"expected 1 message_log row, got {len(logs)}"

        # flow disparado 1x -> 1 texto emitido
        fl = _flow_logs(t["id"])
        assert len(fl) == 1, (
            f"flow triggered {len(fl)}x (expected 1): "
            f"{[x.get('text_preview') for x in fl]}"
        )


# ── B) Concorrencia ──────────────────────────────────────────────────
class TestConcurrentIdempotence:
    def test_five_parallel_webhooks_same_msg_id(self, env):
        phone = "5521" + uuid.uuid4().hex[:9].translate(str.maketrans("abcdef", "123456"))
        msg_id = "WAMID_" + TAG + uuid.uuid4().hex[:12]
        pl = _payload(env["conn_id"], phone, msg_id, message="teste paralelo")

        async def _fire():
            import httpx
            async with httpx.AsyncClient(timeout=90.0) as cli:
                return await asyncio.gather(*[
                    cli.post(WEBHOOK, json=pl) for _ in range(5)
                ])
        results = _run(_fire())
        codes = [r.status_code for r in results]
        assert all(c == 200 for c in codes), f"non-200 in parallel burst: {codes}"
        bodies = [r.json() for r in results]
        dups = [b for b in bodies if b.get("duplicate")]
        assert len(dups) == 4, f"expected 4 duplicates out of 5, got {len(dups)}: {bodies}"

        tks = _tickets(env["company_id"], phone, env["conn_id"])
        assert len(tks) == 1, f"expected 1 ticket after parallel burst, got {len(tks)}"
        logs = _msglog(env["conn_id"], msg_id)
        assert len(logs) == 1, f"expected 1 message_log row, got {len(logs)}"
        inbound = [m for m in (tks[0].get("messages") or []) if m.get("sender_type") == "user"]
        assert len(inbound) == 1, f"expected 1 inbound msg, got {len(inbound)}"
        fl = _flow_logs(tks[0]["id"])
        assert len(fl) == 1, f"flow triggered {len(fl)}x (expected 1)"


# ── C) msg_ids distintos ─────────────────────────────────────────────
class TestDistinctMessageIds:
    def test_different_msg_ids_append_to_same_ticket(self, env):
        phone = "5531" + uuid.uuid4().hex[:9].translate(str.maketrans("abcdef", "123456"))
        for i in range(3):
            mid = "WAMID_" + TAG + uuid.uuid4().hex[:12]
            r = _post(_payload(env["conn_id"], phone, mid, message=f"msg {i}"))
            assert r.status_code == 200, r.text[:200]
            assert not r.json().get("duplicate"), f"msg {i} wrongly flagged duplicate"

        tks = _tickets(env["company_id"], phone, env["conn_id"])
        assert len(tks) == 1, f"expected 1 ticket, got {len(tks)}"
        inbound = [m for m in (tks[0].get("messages") or []) if m.get("sender_type") == "user"]
        assert len(inbound) == 3, f"expected 3 inbound msgs, got {len(inbound)}"
        fl = _flow_logs(tks[0]["id"])
        assert len(fl) >= 1, "flow never triggered"


# ── D) Mesmo msg_id, phones diferentes na mesma conexao ──────────────
class TestSameMsgIdDifferentPhones:
    def test_index_is_scoped_to_connection_and_msg_id(self, env):
        msg_id = "WAMID_" + TAG + uuid.uuid4().hex[:12]
        p1 = "5541" + uuid.uuid4().hex[:9].translate(str.maketrans("abcdef", "123456"))
        p2 = "5551" + uuid.uuid4().hex[:9].translate(str.maketrans("abcdef", "123456"))

        r1 = _post(_payload(env["conn_id"], p1, msg_id))
        assert r1.status_code == 200
        assert not r1.json().get("duplicate")

        r2 = _post(_payload(env["conn_id"], p2, msg_id))
        assert r2.status_code == 200, r2.text[:200]
        b2 = r2.json()
        # Indice eh (connection_id, message_id) -> colide, deve virar duplicate
        assert b2.get("duplicate") is True, (
            f"same (connection_id, message_id) for a different phone was NOT "
            f"deduped: {b2}"
        )
        assert len(_tickets(env["company_id"], p2, env["conn_id"])) == 0, \
            "duplicate call still created a ticket for the 2nd phone"


# ── E) Sem message_id (backwards-compat) ─────────────────────────────
class TestMissingMessageId:
    def test_webhook_without_message_id_still_works_twice(self, env):
        phone = "5561" + uuid.uuid4().hex[:9].translate(str.maketrans("abcdef", "123456"))
        pl = _payload(env["conn_id"], phone, None, message="sem mid 1")
        pl.pop("message_id")
        r1 = _post(pl)
        assert r1.status_code == 200, r1.text[:300]
        assert not r1.json().get("duplicate"), r1.json()

        pl2 = _payload(env["conn_id"], phone, None, message="sem mid 2")
        pl2.pop("message_id")
        r2 = _post(pl2)
        assert r2.status_code == 200, r2.text[:300]
        assert not r2.json().get("duplicate"), (
            f"payload without message_id was wrongly deduped: {r2.json()}"
        )

        tks = _tickets(env["company_id"], phone, env["conn_id"])
        assert len(tks) == 1, f"expected 1 ticket, got {len(tks)}"
        inbound = [m for m in (tks[0].get("messages") or []) if m.get("sender_type") == "user"]
        assert len(inbound) == 2, f"expected 2 inbound msgs, got {len(inbound)}"


# ── F) Indice existe com o nome esperado ─────────────────────────────
class TestIndexPresence:
    def test_unique_index_exists(self, env):
        # dispara 1 webhook pra garantir que o create_index rodou
        phone = "5571" + uuid.uuid4().hex[:9].translate(str.maketrans("abcdef", "123456"))
        _post(_payload(env["conn_id"], phone, "WAMID_" + TAG + uuid.uuid4().hex[:12]))

        async def _q():
            db = _mongo()
            return await db.message_log.index_information()
        info = _run(_q())
        assert "uniq_conn_msgid" in info, f"unique index missing: {list(info)}"
        idx = info["uniq_conn_msgid"]
        assert idx.get("unique") is True, idx
        assert [k for k, _ in idx["key"]] == ["connection_id", "message_id"], idx
