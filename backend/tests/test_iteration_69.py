"""Iteration 69 — Idempotencia do webhook V2 (coleção dedicada `webhook_dedup`).

Fix V2: `webhook_dedup` com _id = "conn_id:msg_id" + TTL 7d em `expires_at`.
message_log volta a ser puro audit trail (sem unique index).

Cobertura:
  A) 3 webhooks sequenciais mesmo msg_id -> 1 ticket, 1 msg, 1 flow trigger
  B) 5 webhooks PARALELOS mesmo msg_id -> 1 vence, 4 duplicate
  C) webhook_dedup: 1 row por (conn,msg_id), expires_at ~ +7d, TTL index
  D) message_log sem unique index (sem E11000 em dados legados)
  E) msg_ids diferentes mesmo phone -> mesmas ticket, msgs acumuladas
  F) payload SEM message_id -> nao cria chave de dedup, processa normal
"""
import os
import sys
import uuid
import asyncio
from datetime import datetime, timezone, timedelta

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

TAG = "TEST_it69"
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
        # dedup keys: _id = "<conn_id>:<msg_id>" -> conn_id comeca com TEST_it69
        await db.webhook_dedup.delete_many({"connection_id": {"$regex": f"^{TAG}"}})
        await db.webhook_dedup.delete_many({"_id": {"$regex": f"^{TAG}"}})
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


def _dedup_rows(conn_id, msg_id=None):
    async def _q():
        db = _mongo()
        q = {"connection_id": conn_id}
        if msg_id:
            q["message_id"] = msg_id
        return await db.webhook_dedup.find(q).to_list(100)
    return _run(_q())


def _flow_logs(ticket_id):
    async def _q():
        db = _mongo()
        return await db.flow_send_log.find({"ticket_id": ticket_id}, {"_id": 0}).to_list(100)
    return _run(_q())


def _new_phone(prefix):
    return prefix + uuid.uuid4().hex[:9].translate(str.maketrans("abcdef", "123456"))


def _new_mid():
    return "WAMID_" + TAG + "_" + uuid.uuid4().hex[:12]


# ── A) Idempotencia sequencial ────────────────────────────────────────
class TestSequentialIdempotence:
    def test_three_identical_webhooks_one_ticket_one_flow(self, env):
        phone = _new_phone("5511")
        msg_id = _new_mid()
        pl = _payload(env["conn_id"], phone, msg_id, message="oi quero atendimento")

        r1 = _post(pl)
        assert r1.status_code == 200, r1.text[:300]
        b1 = r1.json()
        assert b1.get("ok") is True
        assert not b1.get("duplicate"), f"1st call should not be duplicate: {b1}"

        for idx in (2, 3):
            r = _post(pl)
            assert r.status_code == 200, f"call {idx}: {r.status_code} {r.text[:200]}"
            b = r.json()
            assert b.get("ok") is True, f"call {idx}: {b}"
            assert b.get("duplicate") is True, f"call {idx} not flagged duplicate: {b}"
            assert b.get("reason") == "message_id_seen", f"call {idx}: {b}"

        tks = _tickets(env["company_id"], phone, env["conn_id"])
        assert len(tks) == 1, f"expected exactly 1 ticket, got {len(tks)}"
        t = tks[0]

        inbound = [m for m in (t.get("messages") or []) if m.get("sender_type") == "user"]
        assert len(inbound) == 1, f"expected 1 inbound msg, got {len(inbound)}"

        logs = _msglog(env["conn_id"], msg_id)
        assert len(logs) == 1, f"expected 1 message_log row (audit), got {len(logs)}"

        fl = _flow_logs(t["id"])
        assert len(fl) == 1, (
            f"flow triggered {len(fl)}x (expected 1): "
            f"{[x.get('text_preview') for x in fl]}"
        )

        dd = _dedup_rows(env["conn_id"], msg_id)
        assert len(dd) == 1, f"expected 1 webhook_dedup row, got {len(dd)}"
        assert dd[0]["_id"] == f"{env['conn_id']}:{msg_id}", dd[0]


# ── B) Concorrencia real ─────────────────────────────────────────────
class TestConcurrentIdempotence:
    def test_five_parallel_webhooks_same_msg_id(self, env):
        phone = _new_phone("5521")
        msg_id = _new_mid()
        pl = _payload(env["conn_id"], phone, msg_id, message="teste paralelo")

        async def _fire():
            import httpx
            async with httpx.AsyncClient(timeout=90.0) as cli:
                return await asyncio.gather(*[cli.post(WEBHOOK, json=pl) for _ in range(5)])
        results = _run(_fire())
        codes = [r.status_code for r in results]
        assert all(c == 200 for c in codes), f"non-200 in parallel burst: {codes}"
        bodies = [r.json() for r in results]
        dups = [b for b in bodies if b.get("duplicate")]
        assert len(dups) == 4, f"expected 4 duplicates out of 5, got {len(dups)}: {bodies}"
        for b in dups:
            assert b.get("reason") == "message_id_seen", b

        tks = _tickets(env["company_id"], phone, env["conn_id"])
        assert len(tks) == 1, f"expected 1 ticket after parallel burst, got {len(tks)}"
        logs = _msglog(env["conn_id"], msg_id)
        assert len(logs) == 1, f"expected 1 message_log row, got {len(logs)}"
        inbound = [m for m in (tks[0].get("messages") or []) if m.get("sender_type") == "user"]
        assert len(inbound) == 1, f"expected 1 inbound msg, got {len(inbound)}"
        fl = _flow_logs(tks[0]["id"])
        assert len(fl) == 1, f"flow triggered {len(fl)}x (expected 1)"
        dd = _dedup_rows(env["conn_id"], msg_id)
        assert len(dd) == 1, f"expected 1 webhook_dedup row, got {len(dd)}"


# ── C) Estrutura da coleção webhook_dedup + TTL ───────────────────────
class TestDedupCollectionShape:
    def test_ttl_index_and_expires_at(self, env):
        phone = _new_phone("5581")
        msg_id = _new_mid()
        assert _post(_payload(env["conn_id"], phone, msg_id)).status_code == 200

        async def _q():
            db = _mongo()
            return await db.webhook_dedup.index_information()
        info = _run(_q())
        assert "ttl_expires_at" in info, f"TTL index missing: {list(info)}"
        idx = info["ttl_expires_at"]
        assert idx.get("expireAfterSeconds") == 0, idx
        assert [k for k, _ in idx["key"]] == ["expires_at"], idx

        rows = _dedup_rows(env["conn_id"], msg_id)
        assert len(rows) == 1, rows
        row = rows[0]
        exp = row["expires_at"]
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        delta = exp - datetime.now(timezone.utc)
        assert timedelta(days=6, hours=23) < delta <= timedelta(days=7, minutes=5), \
            f"expires_at not ~7d in the future: {delta}"
        assert row.get("message_id") == msg_id
        assert row.get("connection_id") == env["conn_id"]


# ── D) message_log sem unique index (dados legados nao quebram) ───────
class TestMessageLogNoUniqueConstraint:
    def test_no_unique_index_on_message_log(self):
        async def _q():
            db = _mongo()
            return await db.message_log.index_information()
        info = _run(_q())
        offenders = {n: i for n, i in info.items() if i.get("unique")}
        assert not offenders, (
            f"message_log still has unique index(es) {offenders} — legacy dup rows "
            f"can raise E11000 on the audit insert"
        )

    def test_duplicate_message_log_rows_are_allowed(self, env):
        """Simula dados legados: 2 rows com mesmo (connection_id, message_id)."""
        mid = _new_mid()

        async def _ins():
            db = _mongo()
            for _ in range(2):
                await db.message_log.insert_one({
                    "id": str(uuid.uuid4()),
                    "company_id": env["company_id"],
                    "connection_id": env["conn_id"],
                    "direction": "incoming",
                    "phone": "5599999999999",
                    "message": f"{TAG} legacy dup",
                    "message_id": mid,
                    "from_me": False,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })
        _run(_ins())
        assert len(_msglog(env["conn_id"], mid)) == 2


# ── E) msg_ids distintos, mesmo phone ────────────────────────────────
class TestDistinctMessageIds:
    def test_different_msg_ids_append_to_same_ticket(self, env):
        phone = _new_phone("5531")
        for i in range(3):
            r = _post(_payload(env["conn_id"], phone, _new_mid(), message=f"msg {i}"))
            assert r.status_code == 200, r.text[:200]
            assert not r.json().get("duplicate"), f"msg {i} wrongly flagged duplicate"

        tks = _tickets(env["company_id"], phone, env["conn_id"])
        assert len(tks) == 1, f"expected 1 ticket, got {len(tks)}"
        inbound = [m for m in (tks[0].get("messages") or []) if m.get("sender_type") == "user"]
        assert len(inbound) == 3, f"expected 3 inbound msgs, got {len(inbound)}"
        assert len(_flow_logs(tks[0]["id"])) >= 1, "flow never triggered"


# ── F) Sem message_id (backwards-compat) ─────────────────────────────
class TestMissingMessageId:
    def test_webhook_without_message_id_still_works_twice(self, env):
        phone = _new_phone("5561")
        before = len(_dedup_rows(env["conn_id"]))

        for i in (1, 2):
            pl = _payload(env["conn_id"], phone, None, message=f"sem mid {i}")
            pl.pop("message_id")
            r = _post(pl)
            assert r.status_code == 200, r.text[:300]
            assert not r.json().get("duplicate"), \
                f"payload without message_id was wrongly deduped: {r.json()}"

        after = len(_dedup_rows(env["conn_id"]))
        assert after == before, f"dedup key created for payload without msg_id ({before}->{after})"

        tks = _tickets(env["company_id"], phone, env["conn_id"])
        assert len(tks) == 1, f"expected 1 ticket, got {len(tks)}"
        inbound = [m for m in (tks[0].get("messages") or []) if m.get("sender_type") == "user"]
        assert len(inbound) == 2, f"expected 2 inbound msgs, got {len(inbound)}"
