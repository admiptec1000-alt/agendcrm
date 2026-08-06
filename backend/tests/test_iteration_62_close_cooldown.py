"""Iteration 62 — close_message_cooldown_days for ticket lifecycle.

Backend-only tests covering:
 1. GET /api/crm/company/ticket-settings returns close_message_cooldown_days (default 0).
 2. PUT /api/crm/company/ticket-settings persists the field and rejects <0 / >365 with 400.
 3. Manual close cooldown path (PUT /api/crm/tickets/{id} status=fechado):
    - cooldown_days=30 with prior recent system=manual_close msg for same phone in
      same company => new ticket closes SILENTLY (no new manual_close msg pushed).
    - cooldown_days=0 => message push branch executes (msg appended).
    - cooldown expired (prior msg older than cooldown window) => msg appended again.
    - Cooldown is company-scoped (prior msg in another company doesn't block).
    - send_close_message_on_manual=False => close silent regardless of cooldown.

WhatsApp: WA_SERVICE_URL returns 400 on unknown instance; httpx doesn't raise on
4xx, so the push_to_messages step still executes when the code reaches it.
"""
import os
import uuid
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv("/app/backend/.env")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or "https://agentcrm-book.preview.emergentagent.com"
API = f"{BASE_URL.rstrip('/')}/api"

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

OTHER_COMPANY_ID = f"TEST_other_co_{uuid.uuid4().hex[:6]}"
CREATED_PHONES: list = []


def _new_phone():
    p = f"55119{uuid.uuid4().hex[:8]}"
    CREATED_PHONES.append(p)
    return p


# ------------------------------ Fixtures ------------------------------
@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="module")
def db(event_loop):
    client = AsyncIOMotorClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture(scope="module")
def headers():
    r = requests.post(
        f"{API}/auth/login",
        json={"email": "crm@test.com", "password": "crm123"},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:300]}"
    body = r.json()
    token = body.get("access_token") or body.get("token")
    assert token, f"no token in login response: {body}"
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def company_id(headers, db, event_loop):
    r = requests.get(f"{API}/auth/me", headers=headers, timeout=10)
    assert r.status_code == 200, r.text
    cid = r.json().get("company_id")
    assert cid
    return cid


@pytest.fixture(scope="module", autouse=True)
def cleanup(event_loop, db, company_id):
    """Track & remove all tickets/messages we created + reset settings."""
    yield
    async def _clean():
        if CREATED_PHONES:
            await db.tickets.delete_many({"customer_phone": {"$in": CREATED_PHONES}})
        await db.tickets.delete_many({"company_id": OTHER_COMPANY_ID})
        # Reset company settings to safe defaults
        await db.companies.update_one(
            {"id": company_id},
            {"$set": {
                "close_message_cooldown_days": 0,
                "send_close_message_on_manual": False,
            }},
        )
    event_loop.run_until_complete(_clean())


# ------------------------ Helpers ------------------------
async def _seed_ticket(db, company_id, phone, status="aberto", messages=None, connection_id=None):
    tid = str(uuid.uuid4())
    doc = {
        "id": tid,
        "ticket_number": int(datetime.now().timestamp() * 1000) % 10_000_000,
        "company_id": company_id,
        "customer_name": "TEST Cliente",
        "customer_phone": phone,
        "customer_email": None,
        "status": status,
        "priority": "media",
        "channel": "whatsapp",
        "connection_id": connection_id or f"TEST_conn_{uuid.uuid4().hex[:6]}",
        "description": "TEST cooldown",
        "assigned_to": None,
        "messages": messages or [],
        "tags": [],
        "value": 0.0,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.tickets.insert_one(doc)
    return tid


def _system_msg(reason="manual_close", ts=None):
    return {
        "from": "bot",
        "text": "Ola cliente",
        "type": "text",
        "timestamp": (ts or datetime.now(timezone.utc)).isoformat(),
        "system": True,
        "reason": reason,
    }


def _set_settings(headers, payload):
    r = requests.put(f"{API}/crm/company/ticket-settings", headers=headers, json=payload, timeout=15)
    return r


def _close(headers, tid):
    return requests.put(
        f"{API}/crm/tickets/{tid}",
        headers=headers,
        json={"status": "fechado"},
        timeout=20,
    )


def _get_ticket(db, event_loop, tid):
    return event_loop.run_until_complete(
        db.tickets.find_one({"id": tid}, {"_id": 0})
    )


def _manual_close_msgs(ticket):
    return [
        m for m in (ticket.get("messages") or [])
        if m.get("system") is True and m.get("reason") == "manual_close"
    ]


# ============================================================
# 1. Settings GET/PUT
# ============================================================
class TestSettingsField:
    def test_get_returns_field_default(self, headers):
        r = requests.get(f"{API}/crm/company/ticket-settings", headers=headers, timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "close_message_cooldown_days" in data
        assert isinstance(data["close_message_cooldown_days"], int)

    def test_put_persists_value(self, headers):
        r = _set_settings(headers, {"close_message_cooldown_days": 15})
        assert r.status_code == 200, r.text
        assert r.json()["close_message_cooldown_days"] == 15
        # GET-verify persistence
        g = requests.get(f"{API}/crm/company/ticket-settings", headers=headers, timeout=10)
        assert g.json()["close_message_cooldown_days"] == 15

    def test_put_rejects_negative(self, headers):
        r = _set_settings(headers, {"close_message_cooldown_days": -1})
        assert r.status_code == 400, r.text

    def test_put_rejects_over_max(self, headers):
        r = _set_settings(headers, {"close_message_cooldown_days": 366})
        assert r.status_code == 400, r.text

    def test_put_accepts_zero_and_365(self, headers):
        for v in (0, 365):
            r = _set_settings(headers, {"close_message_cooldown_days": v})
            assert r.status_code == 200, f"v={v} => {r.status_code} {r.text}"
            assert r.json()["close_message_cooldown_days"] == v


# ============================================================
# 2. Manual close cooldown behavior
# ============================================================
class TestManualCloseCooldown:
    @pytest.fixture(autouse=True)
    def _enable_manual_close(self, headers):
        # Turn manual send ON with a template
        r = _set_settings(headers, {
            "send_close_message_on_manual": True,
            "ticket_auto_close_message": "Ola {nome}, atendimento encerrado.",
        })
        assert r.status_code == 200

    def test_cooldown_hit_skips_message(self, headers, db, event_loop, company_id):
        phone = _new_phone()
        _set_settings(headers, {"close_message_cooldown_days": 30})
        # Seed ticket A already closed with a RECENT manual_close msg
        tid_a = event_loop.run_until_complete(_seed_ticket(
            db, company_id, phone, status="fechado",
            messages=[_system_msg("manual_close", datetime.now(timezone.utc) - timedelta(hours=1))],
        ))
        # Seed ticket B open (same phone, same company)
        tid_b = event_loop.run_until_complete(_seed_ticket(db, company_id, phone))
        r = _close(headers, tid_b)
        assert r.status_code == 200, r.text
        ticket_b = _get_ticket(db, event_loop, tid_b)
        assert ticket_b["status"] == "fechado", "ticket B should be closed"
        assert len(_manual_close_msgs(ticket_b)) == 0, (
            f"Expected NO manual_close msg on B (cooldown hit), got: {_manual_close_msgs(ticket_b)}"
        )
        _ = tid_a

    def test_cooldown_disabled_when_zero(self, headers, db, event_loop, company_id):
        phone = _new_phone()
        _set_settings(headers, {"close_message_cooldown_days": 0})
        event_loop.run_until_complete(_seed_ticket(
            db, company_id, phone, status="fechado",
            messages=[_system_msg("manual_close", datetime.now(timezone.utc) - timedelta(hours=1))],
        ))
        tid = event_loop.run_until_complete(_seed_ticket(db, company_id, phone))
        r = _close(headers, tid)
        assert r.status_code == 200, r.text
        ticket = _get_ticket(db, event_loop, tid)
        assert ticket["status"] == "fechado"
        msgs = _manual_close_msgs(ticket)
        assert len(msgs) == 1, f"Expected 1 manual_close msg when cooldown=0; got {len(msgs)}: {msgs}"

    def test_cooldown_expired_sends_again(self, headers, db, event_loop, company_id):
        phone = _new_phone()
        _set_settings(headers, {"close_message_cooldown_days": 5})
        # Prior msg 10 days ago — outside cooldown
        event_loop.run_until_complete(_seed_ticket(
            db, company_id, phone, status="fechado",
            messages=[_system_msg("manual_close", datetime.now(timezone.utc) - timedelta(days=10))],
        ))
        tid = event_loop.run_until_complete(_seed_ticket(db, company_id, phone))
        r = _close(headers, tid)
        assert r.status_code == 200, r.text
        ticket = _get_ticket(db, event_loop, tid)
        msgs = _manual_close_msgs(ticket)
        assert len(msgs) == 1, f"Expected new manual_close msg after cooldown expired; got {len(msgs)}"

    def test_cooldown_is_company_scoped(self, headers, db, event_loop, company_id):
        phone = _new_phone()
        _set_settings(headers, {"close_message_cooldown_days": 30})
        # Seed prior msg for SAME phone in DIFFERENT company
        event_loop.run_until_complete(_seed_ticket(
            db, OTHER_COMPANY_ID, phone, status="fechado",
            messages=[_system_msg("manual_close", datetime.now(timezone.utc) - timedelta(hours=1))],
        ))
        tid = event_loop.run_until_complete(_seed_ticket(db, company_id, phone))
        r = _close(headers, tid)
        assert r.status_code == 200, r.text
        ticket = _get_ticket(db, event_loop, tid)
        msgs = _manual_close_msgs(ticket)
        assert len(msgs) == 1, (
            f"Other-company prior msg must NOT trigger cooldown; expected 1 msg on new ticket, got {len(msgs)}"
        )

    def test_send_flag_off_no_message_no_check(self, headers, db, event_loop, company_id):
        phone = _new_phone()
        # Turn manual send OFF; cooldown irrelevant
        r0 = _set_settings(headers, {
            "send_close_message_on_manual": False,
            "close_message_cooldown_days": 30,
        })
        assert r0.status_code == 200
        tid = event_loop.run_until_complete(_seed_ticket(db, company_id, phone))
        r = _close(headers, tid)
        assert r.status_code == 200, r.text
        ticket = _get_ticket(db, event_loop, tid)
        assert ticket["status"] == "fechado"
        assert len(_manual_close_msgs(ticket)) == 0, "no msg should be pushed when send flag is OFF"
