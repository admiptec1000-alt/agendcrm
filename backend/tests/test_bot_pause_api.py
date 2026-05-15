"""End-to-end backend tests for the "Pause bot on human intervention" feature.

Covers:
- GET /api/crm/company/bot-settings default ON when field unset
- PUT /api/crm/company/bot-settings persists value
- POST /api/crm/tickets/{id}/bot-pause manual toggle (paused=true / false)
- POST /api/crm/tickets/{id}/bot-pause 404 for unknown ticket
- POST /api/crm/tickets/{id}/messages with sender_type=agent auto-pauses bot
  when company opted-in AND ticket has an active flow
- PUT /api/crm/tickets/{id} {status: 'fechado'} clears bot_paused
- PUT /api/crm/company/bot-settings non-admin returns 403

Uses direct MongoDB access (motor) to seed active_flow_id on tickets and to
unset the company toggle for the default-ON assertion, since no public
endpoint allows that.
"""
import os
import sys
import uuid
import asyncio
import pytest
import requests
from dotenv import load_dotenv

# Load backend .env for MONGO_URL / DB_NAME
load_dotenv("/app/backend/.env")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get(
    "REACT_APP_BACKEND_URL"
) else "https://agentcrm-book.preview.emergentagent.com"

ADMIN_EMAIL = "admin@boss.com.br"
ADMIN_PASSWORD = "boss123"

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    body = r.json()
    return body["access_token"], body["user"]["company_id"]


@pytest.fixture(scope="module")
def auth_headers(admin_token):
    token, _ = admin_token
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def company_id(admin_token):
    return admin_token[1]


@pytest.fixture(scope="module")
def mongo():
    # Returned as a sentinel; we instantiate a fresh motor client per
    # async helper invocation because each test runs in a brand-new event
    # loop (see `_run_db`).
    return True


def _run_db(coro_factory):
    """Run a one-off motor operation inside its own loop.

    `coro_factory(db)` -> coroutine. The client is created and closed
    inside this loop so its connection pool binds to the right loop.
    """
    loop = asyncio.new_event_loop()
    try:
        async def _inner():
            client = AsyncIOMotorClient(MONGO_URL)
            try:
                db = client[DB_NAME]
                return await coro_factory(db)
            finally:
                client.close()
        return loop.run_until_complete(_inner())
    finally:
        loop.close()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _unset_company_pause_field(mongo, cid):
    _run_db(lambda db: db.companies.update_one(
        {"id": cid},
        {"$unset": {"pause_bot_on_human_intervention": ""}},
    ))


def _create_ticket(headers, *, name="TEST_BotPause", phone=None):
    phone = phone or f"+55119{uuid.uuid4().hex[:8]}"
    payload = {
        "customer_name": name,
        "customer_phone": phone,
        "channel": "whatsapp",
        "force_create": True,
    }
    r = requests.post(f"{BASE_URL}/api/crm/tickets", json=payload, headers=headers, timeout=15)
    assert r.status_code == 200, f"create_ticket: {r.status_code} {r.text}"
    return r.json()


def _set_active_flow_on_ticket(mongo, ticket_id, flow_id="test-flow", node_id="n1"):
    _run_db(lambda db: db.tickets.update_one(
        {"id": ticket_id},
        {"$set": {"active_flow_id": flow_id, "active_flow_node_id": node_id}},
    ))


def _delete_ticket(mongo, ticket_id):
    _run_db(lambda db: db.tickets.delete_one({"id": ticket_id}))


# ---------------------------------------------------------------------------
# Tests — Company-level settings
# ---------------------------------------------------------------------------
class TestBotSettingsAPI:
    def test_default_on_when_field_missing(self, auth_headers, mongo, company_id):
        # Unset the field to simulate a legacy tenant.
        _unset_company_pause_field(mongo, company_id)
        r = requests.get(
            f"{BASE_URL}/api/crm/company/bot-settings", headers=auth_headers, timeout=15
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "pause_bot_on_human_intervention" in data
        assert data["pause_bot_on_human_intervention"] is True

    def test_put_persists_false(self, auth_headers):
        r = requests.put(
            f"{BASE_URL}/api/crm/company/bot-settings",
            json={"pause_bot_on_human_intervention": False},
            headers=auth_headers,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["pause_bot_on_human_intervention"] is False

        # Subsequent GET reflects the persisted value.
        r2 = requests.get(
            f"{BASE_URL}/api/crm/company/bot-settings", headers=auth_headers, timeout=15
        )
        assert r2.status_code == 200
        assert r2.json()["pause_bot_on_human_intervention"] is False

    def test_put_persists_true_again(self, auth_headers):
        # Restore to True so subsequent tests using the auto-pause path work.
        r = requests.put(
            f"{BASE_URL}/api/crm/company/bot-settings",
            json={"pause_bot_on_human_intervention": True},
            headers=auth_headers,
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["pause_bot_on_human_intervention"] is True


# ---------------------------------------------------------------------------
# Tests — Manual per-ticket pause endpoint
# ---------------------------------------------------------------------------
class TestManualBotPause:
    def test_manual_pause_true_sets_flags(self, auth_headers, mongo):
        ticket = _create_ticket(auth_headers, name="TEST_ManualPause")
        ticket_id = ticket["id"]
        # Seed an active flow so the clear-active-flow-node-id side effect
        # is observable.
        _set_active_flow_on_ticket(mongo, ticket_id, "flow-X", "node-X")
        try:
            r = requests.post(
                f"{BASE_URL}/api/crm/tickets/{ticket_id}/bot-pause",
                json={"paused": True},
                headers=auth_headers,
                timeout=15,
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["bot_paused"] is True
            assert body.get("bot_paused_at")
            assert body.get("bot_paused_reason") == "manual_toggle"

            # Verify via GET
            g = requests.get(
                f"{BASE_URL}/api/crm/tickets/{ticket_id}",
                headers=auth_headers,
                timeout=15,
            )
            assert g.status_code == 200
            t = g.json()
            assert t.get("bot_paused") is True
            assert t.get("active_flow_node_id") in (None, "")
        finally:
            _delete_ticket(mongo, ticket_id)

    def test_manual_pause_false_clears_flags(self, auth_headers, mongo):
        ticket = _create_ticket(auth_headers, name="TEST_ManualResume")
        ticket_id = ticket["id"]
        # First pause via API then resume.
        requests.post(
            f"{BASE_URL}/api/crm/tickets/{ticket_id}/bot-pause",
            json={"paused": True}, headers=auth_headers, timeout=15,
        )
        try:
            r = requests.post(
                f"{BASE_URL}/api/crm/tickets/{ticket_id}/bot-pause",
                json={"paused": False},
                headers=auth_headers,
                timeout=15,
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["bot_paused"] is False
            assert body.get("bot_paused_at") in (None, "")
            assert body.get("bot_paused_reason") in (None, "")
        finally:
            _delete_ticket(mongo, ticket_id)

    def test_manual_pause_404_for_unknown_ticket(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/crm/tickets/non-existent-{uuid.uuid4().hex}/bot-pause",
            json={"paused": True},
            headers=auth_headers,
            timeout=15,
        )
        assert r.status_code == 404, r.text


# ---------------------------------------------------------------------------
# Tests — Auto-pause via operator message
# ---------------------------------------------------------------------------
class TestAutoPauseOnAgentMessage:
    def test_agent_message_pauses_bot_when_company_enabled(
        self, auth_headers, mongo, company_id
    ):
        # Ensure company toggle is ON.
        requests.put(
            f"{BASE_URL}/api/crm/company/bot-settings",
            json={"pause_bot_on_human_intervention": True},
            headers=auth_headers, timeout=15,
        )

        ticket = _create_ticket(auth_headers, name="TEST_AutoPause")
        ticket_id = ticket["id"]
        # Seed active flow so the pause helper considers this ticket bot-driven.
        _set_active_flow_on_ticket(mongo, ticket_id, "flow-A", "node-A")
        try:
            r = requests.post(
                f"{BASE_URL}/api/crm/tickets/{ticket_id}/messages",
                json={"content": "Olá, sou o atendente humano", "sender_type": "agent"},
                headers=auth_headers,
                timeout=20,
            )
            # The send may fail at the WhatsApp delivery layer (no live
            # connection) but the persistence + pause path should still run.
            # Accept 200 (persisted) — we just need a non-error path.
            assert r.status_code in (200, 201), r.text

            g = requests.get(
                f"{BASE_URL}/api/crm/tickets/{ticket_id}",
                headers=auth_headers, timeout=15,
            )
            assert g.status_code == 200
            t = g.json()
            assert t.get("bot_paused") is True, (
                f"expected bot_paused=True after agent msg, got {t.get('bot_paused')}"
            )
            assert t.get("active_flow_node_id") in (None, "")
            assert t.get("bot_paused_reason") == "agent_message_platform"
        finally:
            _delete_ticket(mongo, ticket_id)

    def test_agent_message_does_not_pause_when_company_disabled(
        self, auth_headers, mongo
    ):
        # Turn off the toggle, send an agent message, expect no pause.
        requests.put(
            f"{BASE_URL}/api/crm/company/bot-settings",
            json={"pause_bot_on_human_intervention": False},
            headers=auth_headers, timeout=15,
        )
        try:
            ticket = _create_ticket(auth_headers, name="TEST_NoAutoPause")
            ticket_id = ticket["id"]
            _set_active_flow_on_ticket(mongo, ticket_id, "flow-B", "node-B")
            try:
                r = requests.post(
                    f"{BASE_URL}/api/crm/tickets/{ticket_id}/messages",
                    json={"content": "msg de operador", "sender_type": "agent"},
                    headers=auth_headers, timeout=20,
                )
                assert r.status_code in (200, 201), r.text

                g = requests.get(
                    f"{BASE_URL}/api/crm/tickets/{ticket_id}",
                    headers=auth_headers, timeout=15,
                )
                t = g.json()
                assert not t.get("bot_paused"), (
                    f"expected bot_paused False when toggle off, got {t.get('bot_paused')}"
                )
                # active_flow_node_id should still be present.
                assert t.get("active_flow_node_id") == "node-B"
            finally:
                _delete_ticket(mongo, ticket_id)
        finally:
            # restore toggle
            requests.put(
                f"{BASE_URL}/api/crm/company/bot-settings",
                json={"pause_bot_on_human_intervention": True},
                headers=auth_headers, timeout=15,
            )


# ---------------------------------------------------------------------------
# Tests — Auto-resume when ticket is closed
# ---------------------------------------------------------------------------
class TestAutoResumeOnClose:
    def test_close_ticket_clears_bot_paused(self, auth_headers, mongo):
        ticket = _create_ticket(auth_headers, name="TEST_ResumeOnClose")
        ticket_id = ticket["id"]
        # Pause the ticket via the manual endpoint.
        requests.post(
            f"{BASE_URL}/api/crm/tickets/{ticket_id}/bot-pause",
            json={"paused": True}, headers=auth_headers, timeout=15,
        )
        # Confirm pause
        g0 = requests.get(
            f"{BASE_URL}/api/crm/tickets/{ticket_id}",
            headers=auth_headers, timeout=15,
        ).json()
        assert g0.get("bot_paused") is True

        try:
            # Now close the ticket.
            r = requests.put(
                f"{BASE_URL}/api/crm/tickets/{ticket_id}",
                json={"status": "fechado"},
                headers=auth_headers, timeout=15,
            )
            assert r.status_code == 200, r.text

            g = requests.get(
                f"{BASE_URL}/api/crm/tickets/{ticket_id}",
                headers=auth_headers, timeout=15,
            )
            t = g.json()
            assert t.get("status") == "fechado"
            assert not t.get("bot_paused"), (
                f"expected bot_paused False after close, got {t.get('bot_paused')}"
            )
        finally:
            _delete_ticket(mongo, ticket_id)


# ---------------------------------------------------------------------------
# Tests — Non-admin user cannot toggle company setting
# ---------------------------------------------------------------------------
class TestNonAdminPutForbidden:
    def test_non_admin_put_bot_settings_returns_403(self, auth_headers, mongo, company_id):
        # Create a non-admin company user (role="user").
        email = f"TEST_botpause_{uuid.uuid4().hex[:8]}@example.com"
        password = "Test12345!"
        cu_payload = {
            "name": "TEST BotPause NonAdmin",
            "email": email,
            "password": password,
        }
        r = requests.post(
            f"{BASE_URL}/api/scheduling/company-users",
            json=cu_payload,
            headers=auth_headers,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        user_id = r.json()["id"]
        assert r.json()["role"] == "user"

        try:
            # Login as the non-admin
            lr = requests.post(
                f"{BASE_URL}/api/auth/login",
                json={"email": email, "password": password},
                timeout=15,
            )
            assert lr.status_code == 200, lr.text
            non_admin_token = lr.json()["access_token"]
            non_admin_headers = {
                "Authorization": f"Bearer {non_admin_token}",
                "Content-Type": "application/json",
            }

            # Attempt to PUT bot-settings
            put = requests.put(
                f"{BASE_URL}/api/crm/company/bot-settings",
                json={"pause_bot_on_human_intervention": False},
                headers=non_admin_headers,
                timeout=15,
            )
            assert put.status_code == 403, (
                f"expected 403 for non-admin PUT, got {put.status_code} {put.text}"
            )

            # GET should still work for non-admin (read-only)
            get = requests.get(
                f"{BASE_URL}/api/crm/company/bot-settings",
                headers=non_admin_headers,
                timeout=15,
            )
            assert get.status_code == 200, get.text
            assert "pause_bot_on_human_intervention" in get.json()
        finally:
            # Clean up: delete the test user via DB to bypass admin checks.
            _run_db(lambda db: db.company_users.delete_one({"id": user_id}))
