"""
Iteration 26 — Atendimento (omnichannel) epic backend tests:
- POST/GET /crm/tickets with new fields (value, tags, etc)
- GET /crm/tickets/{id} single fetch
- POST /crm/tickets/{id}/tags/add and /remove (idempotent)
- PUT /crm/tickets/{id} extended fields (customer_*, value, channel, tags)
- POST /crm/tickets/{id}/messages — agent on whatsapp without active connection -> delivery_status='failed'
- GET /crm/kanban-v2 returns totals_by_column
- POST /channels/webhook/message: auto-create ticket / push / idempotency
- POST /channels/scheduled-messages
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://agentcrm-book.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

CRM_EMAIL = "crm@test.com"
CRM_PASS = "crm123"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"Login failed {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def crm_token():
    return _login(CRM_EMAIL, CRM_PASS)


@pytest.fixture
def crm_headers(crm_token):
    return {"Authorization": f"Bearer {crm_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def crm_company_info(crm_token):
    """Get company_id and a connection_id for webhook tests"""
    headers = {"Authorization": f"Bearer {crm_token}"}
    me = requests.get(f"{API}/auth/me", headers=headers, timeout=15)
    assert me.status_code == 200
    return me.json()


# ===================== TICKET CRUD with new fields =====================
class TestTicketWithValueAndTags:
    def test_create_ticket_with_value_and_tags(self, crm_headers):
        payload = {
            "customer_name": "TEST_Cliente_Valor",
            "customer_phone": "+5511955550001",
            "customer_email": "test@example.com",
            "subject": "TEST_value_tags",
            "channel": "whatsapp",
            "value": 1500.50,
            "tags": ["TEST_VIP", "TEST_Quente"],
        }
        r = requests.post(f"{API}/crm/tickets", json=payload, headers=crm_headers, timeout=15)
        assert r.status_code == 200, r.text
        t = r.json()
        assert t["value"] == 1500.50
        assert "TEST_VIP" in t["tags"]
        assert "TEST_Quente" in t["tags"]
        assert t["customer_name"] == "TEST_Cliente_Valor"
        tid = t["id"]
        # Cleanup
        requests.delete(f"{API}/crm/tickets/{tid}", headers=crm_headers, timeout=10)

    def test_get_single_ticket(self, crm_headers):
        # Create
        r = requests.post(f"{API}/crm/tickets", json={
            "customer_name": "TEST_GetOne",
            "customer_phone": "+5511955550002",
            "channel": "whatsapp",
            "value": 99.99,
            "tags": ["TEST_X"]
        }, headers=crm_headers, timeout=15)
        assert r.status_code == 200
        tid = r.json()["id"]
        try:
            r = requests.get(f"{API}/crm/tickets/{tid}", headers=crm_headers, timeout=15)
            assert r.status_code == 200, r.text
            data = r.json()
            assert data["id"] == tid
            assert data["value"] == 99.99
            assert "TEST_X" in data["tags"]
        finally:
            requests.delete(f"{API}/crm/tickets/{tid}", headers=crm_headers, timeout=10)

    def test_get_single_ticket_not_found(self, crm_headers):
        r = requests.get(f"{API}/crm/tickets/{uuid.uuid4()}", headers=crm_headers, timeout=15)
        assert r.status_code == 404

    def test_add_remove_tag_idempotent(self, crm_headers):
        r = requests.post(f"{API}/crm/tickets", json={
            "customer_name": "TEST_Tags",
            "customer_phone": "+5511955550003",
            "channel": "whatsapp",
        }, headers=crm_headers, timeout=15)
        tid = r.json()["id"]
        try:
            # Add
            r = requests.post(f"{API}/crm/tickets/{tid}/tags/add", json={"tag": "TEST_Hot"}, headers=crm_headers, timeout=15)
            assert r.status_code == 200
            assert "TEST_Hot" in r.json()["tags"]
            # Add same again - idempotent ($addToSet)
            r = requests.post(f"{API}/crm/tickets/{tid}/tags/add", json={"tag": "TEST_Hot"}, headers=crm_headers, timeout=15)
            assert r.status_code == 200
            tags = r.json()["tags"]
            assert tags.count("TEST_Hot") == 1
            # Add different
            r = requests.post(f"{API}/crm/tickets/{tid}/tags/add", json={"tag": "TEST_Cold"}, headers=crm_headers, timeout=15)
            assert r.status_code == 200
            assert "TEST_Cold" in r.json()["tags"]
            # Remove
            r = requests.post(f"{API}/crm/tickets/{tid}/tags/remove", json={"tag": "TEST_Hot"}, headers=crm_headers, timeout=15)
            assert r.status_code == 200
            assert "TEST_Hot" not in r.json()["tags"]
            assert "TEST_Cold" in r.json()["tags"]
            # Remove non-existing tag - should still 200
            r = requests.post(f"{API}/crm/tickets/{tid}/tags/remove", json={"tag": "TEST_Nope"}, headers=crm_headers, timeout=15)
            assert r.status_code == 200
        finally:
            requests.delete(f"{API}/crm/tickets/{tid}", headers=crm_headers, timeout=10)

    def test_add_tag_404_for_unknown_ticket(self, crm_headers):
        r = requests.post(f"{API}/crm/tickets/{uuid.uuid4()}/tags/add", json={"tag": "X"}, headers=crm_headers, timeout=15)
        assert r.status_code == 404

    def test_put_ticket_extended_fields(self, crm_headers):
        r = requests.post(f"{API}/crm/tickets", json={
            "customer_name": "TEST_OldName",
            "customer_phone": "+5511900000900",
            "channel": "whatsapp",
            "value": 100.0,
        }, headers=crm_headers, timeout=15)
        tid = r.json()["id"]
        try:
            update = {
                "customer_name": "TEST_NewName",
                "customer_phone": "+5511999999999",
                "customer_email": "new@example.com",
                "value": 2500.75,
                "channel": "instagram",
                "tags": ["TEST_AAA", "TEST_BBB"],
            }
            r = requests.put(f"{API}/crm/tickets/{tid}", json=update, headers=crm_headers, timeout=15)
            assert r.status_code == 200, r.text
            t = r.json()
            assert t["customer_name"] == "TEST_NewName"
            assert t["customer_phone"] == "+5511999999999"
            assert t["customer_email"] == "new@example.com"
            assert t["value"] == 2500.75
            assert t["channel"] == "instagram"
            assert set(t["tags"]) == {"TEST_AAA", "TEST_BBB"}
            # Verify persistence
            r2 = requests.get(f"{API}/crm/tickets/{tid}", headers=crm_headers, timeout=15)
            assert r2.json()["customer_name"] == "TEST_NewName"
            assert r2.json()["value"] == 2500.75
        finally:
            requests.delete(f"{API}/crm/tickets/{tid}", headers=crm_headers, timeout=10)


# ===================== Send Message - WhatsApp without connection =====================
class TestSendMessageWhatsApp:
    def test_agent_message_whatsapp_no_active_connection(self, crm_headers):
        """When no WA connection is active, should NOT 500. Should return delivery_status='failed'."""
        r = requests.post(f"{API}/crm/tickets", json={
            "customer_name": "TEST_NoConn",
            "customer_phone": "+5511966660001",
            "channel": "whatsapp",
        }, headers=crm_headers, timeout=15)
        tid = r.json()["id"]
        try:
            # Send message as agent
            r = requests.post(
                f"{API}/crm/tickets/{tid}/messages",
                json={"content": "TEST mensagem teste", "sender_type": "agent"},
                headers=crm_headers, timeout=30
            )
            # Must NOT be 500
            assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
            msg = r.json()
            # Either failed (no conn) or sent (if conn happens to be live)
            assert msg["delivery_status"] in ("failed", "sent", "pending"), msg
            if msg["delivery_status"] == "failed":
                assert "delivery_error" in msg
                assert msg["delivery_error"]
        finally:
            requests.delete(f"{API}/crm/tickets/{tid}", headers=crm_headers, timeout=10)


# ===================== Kanban v2 totals_by_column =====================
class TestKanbanV2Totals:
    def test_kanban_v2_includes_totals_by_column(self, crm_headers):
        # Create ticket with value
        r = requests.post(f"{API}/crm/tickets", json={
            "customer_name": "TEST_KanbanTotal",
            "customer_phone": "+5511944440001",
            "channel": "whatsapp",
            "value": 777.77,
        }, headers=crm_headers, timeout=15)
        tid = r.json()["id"]
        try:
            r = requests.get(f"{API}/crm/kanban-v2", headers=crm_headers, timeout=15)
            assert r.status_code == 200, r.text
            data = r.json()
            assert "columns" in data
            assert "tickets_by_column" in data
            assert "totals_by_column" in data, "totals_by_column missing"
            # Native column should contain at least our 777.77
            native_total = data["totals_by_column"].get("native:atendimentos", 0)
            assert native_total >= 777.77, f"native_total={native_total} < 777.77"
            # Every column id present in totals
            for col in data["columns"]:
                assert col["id"] in data["totals_by_column"]
        finally:
            requests.delete(f"{API}/crm/tickets/{tid}", headers=crm_headers, timeout=10)


# ===================== Webhook auto-create ticket =====================
class TestWebhookAutoCreateTicket:
    @pytest.fixture(scope="class")
    def connection(self, crm_token):
        """Create a fake whatsapp connection so webhook can resolve company."""
        headers = {"Authorization": f"Bearer {crm_token}", "Content-Type": "application/json"}
        # List existing
        r = requests.get(f"{API}/channels/connections", headers=headers, timeout=15)
        if r.status_code == 200:
            for c in r.json():
                if c.get("type") == "whatsapp":
                    return c
        # Create
        r = requests.post(f"{API}/channels/connections", json={
            "name": "TEST_Webhook_Conn", "type": "whatsapp"
        }, headers=headers, timeout=15)
        if r.status_code == 200:
            return r.json()
        pytest.skip(f"Cannot create connection: {r.status_code} {r.text}")

    def test_webhook_creates_ticket_for_new_phone(self, connection, crm_headers):
        phone = f"+5511700{uuid.uuid4().hex[:7]}"
        msg_id = f"wamid_{uuid.uuid4().hex[:10]}"
        # Webhook is unauthenticated (called from microservice)
        r = requests.post(f"{API}/channels/webhook/message", json={
            "instance_id": connection["id"],
            "phone": phone,
            "name": "TEST_Cliente_Webhook",
            "message": "Ola, primeira mensagem",
            "message_id": msg_id,
        }, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True

        # Find the auto-created ticket via API
        tickets = requests.get(f"{API}/crm/tickets", headers=crm_headers, timeout=15).json()
        match = [t for t in tickets if t.get("customer_phone") == phone]
        assert len(match) == 1, f"Expected 1 ticket for {phone}, found {len(match)}"
        ticket = match[0]
        assert ticket["channel"] == "whatsapp"
        assert ticket["status"] == "aberto"
        assert any(m.get("content") == "Ola, primeira mensagem" for m in ticket.get("messages", []))

        # Idempotency: duplicate message_id
        r2 = requests.post(f"{API}/channels/webhook/message", json={
            "instance_id": connection["id"],
            "phone": phone,
            "name": "TEST_Cliente_Webhook",
            "message": "Ola, primeira mensagem",
            "message_id": msg_id,  # same id
        }, timeout=15)
        assert r2.status_code == 200
        assert r2.json().get("duplicate") is True

        # Push: new message with different message_id appends
        new_msg_id = f"wamid_{uuid.uuid4().hex[:10]}"
        r3 = requests.post(f"{API}/channels/webhook/message", json={
            "instance_id": connection["id"],
            "phone": phone,
            "name": "TEST_Cliente_Webhook",
            "message": "Segunda mensagem",
            "message_id": new_msg_id,
        }, timeout=15)
        assert r3.status_code == 200
        # Re-fetch
        r4 = requests.get(f"{API}/crm/tickets/{ticket['id']}", headers=crm_headers, timeout=15)
        msgs = r4.json().get("messages", [])
        assert any(m.get("content") == "Segunda mensagem" for m in msgs)
        assert len(msgs) >= 2

        # Cleanup
        requests.delete(f"{API}/crm/tickets/{ticket['id']}", headers=crm_headers, timeout=10)


# ===================== Scheduled messages =====================
class TestScheduledMessages:
    def test_create_scheduled_message(self, crm_headers):
        from datetime import datetime, timedelta, timezone
        future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        payload = {
            "recipient": "+5511955550099",
            "channel": "whatsapp",
            "message": "TEST_lembrete agendado",
            "scheduled_at": future,
        }
        r = requests.post(f"{API}/channels/scheduled-messages", json=payload, headers=crm_headers, timeout=15)
        assert r.status_code == 200, r.text
        msg = r.json()
        assert msg["recipient"] == "+5511955550099"
        assert msg["message"] == "TEST_lembrete agendado"
        assert msg["status"] == "pendente"
        mid = msg["id"]
        # List
        r = requests.get(f"{API}/channels/scheduled-messages", headers=crm_headers, timeout=15)
        assert r.status_code == 200
        assert any(x["id"] == mid for x in r.json())
        # Cleanup
        requests.delete(f"{API}/channels/scheduled-messages/{mid}", headers=crm_headers, timeout=10)
