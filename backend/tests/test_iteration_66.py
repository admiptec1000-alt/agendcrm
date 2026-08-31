"""Iteration 66 — Point 4 (manual bot pause/resume toggle) + Point 2 (transient
retry on manual message send).

Part A (HTTP against preview BASE_URL):
  - POST /api/crm/tickets/{id}/bot-pause {paused: true} -> bot_paused true,
    reason manual_toggle, active_flow_node_id cleared
  - POST ... {paused: false} -> flags cleared
  - GET /api/crm/tickets/{id} reflects updated state (refetch)
  - 404 for unknown ticket

Part B (in-process unit tests of routes.crm_routes.add_message_to_ticket with
httpx.AsyncClient monkeypatched):
  - transient "Not connected" on attempt 1 -> retried, sent on attempt 2,
    single message persisted, wa_message_id from res.message_id
  - non-transient error -> NO retry (1 call), delivery_status failed
  - healthy connection -> 1 call, sent (regression)
"""
import os
import sys
import uuid
import asyncio
from datetime import datetime, timezone

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx  # noqa: E402
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

from dotenv import dotenv_values  # noqa: E402

_fe = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _fe.get("REACT_APP_BACKEND_URL")).rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

CRM_EMAIL = "crm@test.com"
CRM_PASSWORD = "crm123"


def _login():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": CRM_EMAIL, "password": CRM_PASSWORD},
        timeout=20,
    )
    assert r.status_code == 200, f"login failed {r.status_code} {r.text[:300]}"
    b = r.json()
    return b["access_token"], b["user"]


@pytest.fixture(scope="module")
def session_user():
    token, user = _login()
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s, user


def _mongo():
    return AsyncIOMotorClient(MONGO_URL)[DB_NAME]


def _seed_ticket(company_id, **extra):
    """Insert a whatsapp ticket directly (bypasses duplicate guards)."""
    tid = str(uuid.uuid4())
    doc = {
        "id": tid,
        "company_id": company_id,
        "customer_name": "TEST_it66",
        "customer_phone": "5511900" + str(uuid.uuid4().int)[:6],
        "channel": "whatsapp",
        "status": "aberto",
        "priority": "media",
        "messages": [],
        "active_flow_id": "flow-test",
        "active_flow_node_id": "node-1",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    doc.update(extra)

    async def _ins():
        await _mongo().tickets.insert_one(doc)
    asyncio.get_event_loop().run_until_complete(_ins()) if False else asyncio.run(_ins())
    return tid


def _get_ticket_doc(tid):
    async def _f():
        return await _mongo().tickets.find_one({"id": tid}, {"_id": 0})
    return asyncio.run(_f())


def _cleanup(tid):
    async def _f():
        await _mongo().tickets.delete_one({"id": tid})
    asyncio.run(_f())


# ---------------------------------------------------------------------------
# Part A — bot-pause endpoint
# ---------------------------------------------------------------------------
class TestBotPauseEndpoint:
    def test_pause_then_resume(self, session_user):
        s, user = session_user
        tid = _seed_ticket(user["company_id"])
        try:
            r = s.post(f"{BASE_URL}/api/crm/tickets/{tid}/bot-pause", json={"paused": True}, timeout=20)
            assert r.status_code == 200, r.text[:300]
            body = r.json()
            assert body["bot_paused"] is True
            assert body.get("bot_paused_at")

            doc = _get_ticket_doc(tid)
            assert doc["bot_paused"] is True
            assert doc["bot_paused_reason"] == "manual_toggle"
            assert doc.get("active_flow_node_id") is None

            # refetch via API reflects state
            g = s.get(f"{BASE_URL}/api/crm/tickets/{tid}", timeout=20)
            assert g.status_code == 200
            assert g.json().get("bot_paused") is True

            r2 = s.post(f"{BASE_URL}/api/crm/tickets/{tid}/bot-pause", json={"paused": False}, timeout=20)
            assert r2.status_code == 200, r2.text[:300]
            assert r2.json()["bot_paused"] is False
            doc2 = _get_ticket_doc(tid)
            assert not doc2.get("bot_paused")
            assert not doc2.get("bot_paused_at")
            assert not doc2.get("bot_paused_reason")

            g2 = s.get(f"{BASE_URL}/api/crm/tickets/{tid}", timeout=20)
            assert not g2.json().get("bot_paused")
        finally:
            _cleanup(tid)

    def test_unknown_ticket_404(self, session_user):
        s, _ = session_user
        r = s.post(f"{BASE_URL}/api/crm/tickets/{uuid.uuid4()}/bot-pause", json={"paused": True}, timeout=20)
        assert r.status_code == 404

    def test_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/crm/tickets/{uuid.uuid4()}/bot-pause", json={"paused": True}, timeout=20)
        assert r.status_code in (401, 403), r.status_code


# ---------------------------------------------------------------------------
# Part B — transient retry in add_message_to_ticket
# ---------------------------------------------------------------------------
class _FakeResp:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload
        self.text = str(payload)

    def json(self):
        return self._payload


class _FakeClient:
    """Replaces httpx.AsyncClient. `script` is a list of _FakeResp/Exception."""

    calls = []
    script = []

    def __init__(self, *a, **kw):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, json=None, **kw):
        _FakeClient.calls.append((url, json))
        idx = len(_FakeClient.calls) - 1
        item = _FakeClient.script[min(idx, len(_FakeClient.script) - 1)]
        if isinstance(item, Exception):
            raise item
        return item


async def _seed_conn_and_ticket(db, company_id):
    conn_id = "TEST_it66_conn_" + uuid.uuid4().hex[:8]
    await db.channel_connections.insert_one({
        "id": conn_id, "company_id": company_id, "type": "whatsapp",
        "status": "connected", "name": "TEST_it66",
    })
    tid = str(uuid.uuid4())
    await db.tickets.insert_one({
        "id": tid, "company_id": company_id, "customer_name": "TEST_it66",
        "customer_phone": "5511988877766", "channel": "whatsapp", "status": "aberto",
        "connection_id": conn_id, "messages": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    return conn_id, tid


async def _run_send(script, company_id, monkeypatch_target):
    from routes import crm_routes
    from models import MessageCreate
    db = _mongo()
    conn_id, tid = await _seed_conn_and_ticket(db, company_id)
    _FakeClient.calls = []
    _FakeClient.script = script
    orig = httpx.AsyncClient
    httpx.AsyncClient = _FakeClient
    try:
        user = {"id": "TEST_it66_user", "name": "QA Bot", "company_id": company_id, "role": "company_admin"}
        result = await crm_routes.add_message_to_ticket(
            tid, MessageCreate(content="mensagem de teste it66", sender_type="agent", with_signature=False),
            user=user, db=db,
        )
        doc = await db.tickets.find_one({"id": tid}, {"_id": 0})
        return result, doc, len(_FakeClient.calls)
    finally:
        httpx.AsyncClient = orig
        await db.tickets.delete_one({"id": tid})
        await db.channel_connections.delete_one({"id": conn_id})


class TestTransientRetry:
    def test_transient_then_success_retries_once(self, session_user):
        _, user = session_user
        ok = _FakeResp(200, {"success": True, "message_id": "WAMID_it66_ok", "jid": "551199@s.whatsapp.net"})
        fail = _FakeResp(200, {"success": False, "error": "Connection Closed / Not connected"})
        _res, doc, ncalls = asyncio.run(_run_send([fail, ok], user["company_id"], None))
        assert ncalls == 2, f"expected 1 retry, got {ncalls} calls"
        msgs = doc["messages"]
        assert len(msgs) == 1, f"duplicate messages persisted: {len(msgs)}"
        assert msgs[0]["delivery_status"] == "sent", msgs[0]
        assert msgs[0]["wa_message_id"] == "WAMID_it66_ok"
        assert "delivery_error" not in msgs[0]

    def test_transient_all_three_attempts_fail(self, session_user):
        _, user = session_user
        fail = _FakeResp(200, {"success": False, "error": "Socket closed"})
        _res, doc, ncalls = asyncio.run(_run_send([fail, fail, fail], user["company_id"], None))
        assert ncalls == 3, f"expected 3 attempts, got {ncalls}"
        assert len(doc["messages"]) == 1
        assert doc["messages"][0]["delivery_status"] == "failed"
        assert doc["messages"][0].get("delivery_error")

    def test_non_transient_does_not_retry(self, session_user):
        _, user = session_user
        fail = _FakeResp(200, {"success": False, "error": "phone number is not on whatsapp"})
        _res, doc, ncalls = asyncio.run(_run_send([fail], user["company_id"], None))
        assert ncalls == 1, f"non-transient must fail fast, got {ncalls} calls"
        assert doc["messages"][0]["delivery_status"] == "failed"

    def test_healthy_first_attempt(self, session_user):
        _, user = session_user
        ok = _FakeResp(200, {"success": True, "message_id": "WAMID_it66_first"})
        _res, doc, ncalls = asyncio.run(_run_send([ok], user["company_id"], None))
        assert ncalls == 1
        assert len(doc["messages"]) == 1
        assert doc["messages"][0]["delivery_status"] == "sent"
        assert doc["messages"][0]["wa_message_id"] == "WAMID_it66_first"

    def test_httpx_timeout_exception_retries(self, session_user):
        _, user = session_user
        ok = _FakeResp(200, {"success": True, "message_id": "WAMID_it66_tmo"})
        _res, doc, ncalls = asyncio.run(
            _run_send([httpx.ConnectError("connection refused"), ok], user["company_id"], None)
        )
        assert ncalls == 2, f"expected retry after ConnectError, got {ncalls}"
        assert doc["messages"][0]["delivery_status"] == "sent"
        assert len(doc["messages"]) == 1
