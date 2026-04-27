"""
Iteration 27 — Epic Campanhas + Atendimento + Kanban + WhatsApp

Covers:
- Queues CRUD (/api/crm/queues)
- Contact Lists CRUD (/api/crm/contact-lists)
- Campaigns with new fields + preview-audience (all modes) + run
- Retry message endpoint (404/400/502 paths)
- Webhook connected saves connected_at; message older than connected_at ignored
- WA contacts / import-contacts graceful 502 when microservice offline
- TicketUpdate accepts queue_id and connection_id
"""
import os
import uuid
import pytest
import requests
from datetime import datetime, timedelta, timezone

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "https://agentcrm-book.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
CRM_EMAIL = "crm@test.com"
CRM_PASS = "crm123"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def crm_token():
    return _login(CRM_EMAIL, CRM_PASS)


@pytest.fixture
def H(crm_token):
    return {"Authorization": f"Bearer {crm_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def connection(crm_token):
    """Reuse or create a whatsapp connection."""
    h = {"Authorization": f"Bearer {crm_token}", "Content-Type": "application/json"}
    r = requests.get(f"{API}/channels/connections", headers=h, timeout=15)
    if r.status_code == 200:
        for c in r.json():
            if c.get("type") == "whatsapp":
                return c
    r = requests.post(f"{API}/channels/connections", json={"name": "TEST_27_Conn", "type": "whatsapp"},
                      headers=h, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


# ===================== QUEUES CRUD =====================
class TestQueuesCrud:
    def test_queue_full_crud(self, H):
        r = requests.post(f"{API}/crm/queues", json={
            "name": "TEST_Fila_Vendas", "color": "#FF0000", "description": "Time vendas",
            "welcome_message": "Ola!",
        }, headers=H, timeout=15)
        assert r.status_code == 200, r.text
        q = r.json()
        assert q["name"] == "TEST_Fila_Vendas"
        assert q["color"] == "#FF0000"
        qid = q["id"]

        r = requests.get(f"{API}/crm/queues", headers=H, timeout=15)
        assert r.status_code == 200
        assert any(x["id"] == qid for x in r.json())

        r = requests.put(f"{API}/crm/queues/{qid}", json={"name": "TEST_Fila_Renamed", "color": "#00FF00"},
                         headers=H, timeout=15)
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Fila_Renamed"
        assert r.json()["color"] == "#00FF00"

        r = requests.delete(f"{API}/crm/queues/{qid}", headers=H, timeout=10)
        assert r.status_code == 200

        r = requests.put(f"{API}/crm/queues/{qid}", json={"name": "x"}, headers=H, timeout=10)
        assert r.status_code == 404


# ===================== CONTACT LISTS CRUD =====================
class TestContactLists:
    def test_contact_list_full_crud(self, H):
        payload = {
            "name": "TEST_Lista_A",
            "description": "teste",
            "contacts": [
                {"name": "Joao", "phone": "+5511988880001"},
                {"name": "Maria", "phone": "+5511988880002"},
            ],
        }
        r = requests.post(f"{API}/crm/contact-lists", json=payload, headers=H, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["name"] == "TEST_Lista_A"
        assert len(d["contacts"]) == 2
        lid = d["id"]

        r = requests.get(f"{API}/crm/contact-lists", headers=H, timeout=15)
        assert r.status_code == 200
        found = next((x for x in r.json() if x["id"] == lid), None)
        assert found and found["count"] == 2

        r = requests.put(f"{API}/crm/contact-lists/{lid}",
                         json={"contacts": [{"name": "Z", "phone": "+5511988880003"}]},
                         headers=H, timeout=15)
        assert r.status_code == 200
        assert len(r.json()["contacts"]) == 1

        r = requests.delete(f"{API}/crm/contact-lists/{lid}", headers=H, timeout=10)
        assert r.status_code == 200


# ===================== CAMPAIGNS (novos campos + preview + run) =====================
class TestCampaigns:
    @pytest.fixture
    def tag(self, H):
        r = requests.post(f"{API}/crm/tags", json={"name": f"TEST_T_{uuid.uuid4().hex[:4]}"},
                          headers=H, timeout=15)
        assert r.status_code == 200, r.text
        t = r.json()
        yield t
        requests.delete(f"{API}/crm/tags/{t['id']}", headers=H, timeout=10)

    @pytest.fixture
    def client_with_tag(self, H, tag):
        r = requests.post(f"{API}/scheduling/clients", json={
            "name": "TEST_ClientTag", "phone": "+5511900700001", "tags": [tag["name"]],
        }, headers=H, timeout=15)
        assert r.status_code == 200, r.text
        c = r.json()
        yield c
        requests.delete(f"{API}/scheduling/clients/{c['id']}", headers=H, timeout=10)

    @pytest.fixture
    def client_no_tag(self, H):
        r = requests.post(f"{API}/scheduling/clients", json={
            "name": "TEST_NoTag", "phone": "+5511900700002", "tags": [],
        }, headers=H, timeout=15)
        assert r.status_code == 200, r.text
        c = r.json()
        yield c
        requests.delete(f"{API}/scheduling/clients/{c['id']}", headers=H, timeout=10)

    @pytest.fixture
    def contact_list(self, H):
        r = requests.post(f"{API}/crm/contact-lists", json={
            "name": "TEST_CampList",
            "contacts": [{"name": "A", "phone": "+5511900700010"}, {"name": "B", "phone": "+5511900700011"}]
        }, headers=H, timeout=15)
        assert r.status_code == 200
        d = r.json()
        yield d
        requests.delete(f"{API}/crm/contact-lists/{d['id']}", headers=H, timeout=10)

    def _mk_campaign(self, H, **kw):
        payload = {
            "name": f"TEST_Camp_{uuid.uuid4().hex[:5]}",
            "type": "whatsapp",
            "audience_mode": "tags",
            "messages": ["Oi {nome}"],
            "confirmation_enabled": False,
            "open_ticket": False,
            "ticket_status": "fechado",
        }
        payload.update(kw)
        r = requests.post(f"{API}/crm/campaigns", json=payload, headers=H, timeout=15)
        assert r.status_code == 200, r.text
        return r.json()

    def test_create_campaign_with_new_fields(self, H, connection):
        camp = self._mk_campaign(H, audience_mode="all", connection_id=connection["id"],
                                 scheduled_at=(datetime.now(timezone.utc)+timedelta(hours=2)).isoformat(),
                                 messages=["M1", "M2", "M3", "M4", "M5"], attachment_url="http://x/y.png")
        assert camp["audience_mode"] == "all"
        assert camp["connection_id"] == connection["id"]
        assert camp["attachment_url"] == "http://x/y.png"
        assert camp["status"] == "programada"
        assert len(camp["messages"]) == 5
        requests.delete(f"{API}/crm/campaigns/{camp['id']}", headers=H, timeout=10)

    def test_list_campaigns_enriched(self, H, connection, contact_list):
        camp = self._mk_campaign(H, audience_mode="list", connection_id=connection["id"],
                                 contact_list_id=contact_list["id"])
        r = requests.get(f"{API}/crm/campaigns", headers=H, timeout=15)
        assert r.status_code == 200
        found = next((c for c in r.json() if c["id"] == camp["id"]), None)
        assert found is not None
        assert "connection_name" in found
        assert "contact_list_name" in found
        assert found["contact_list_name"] == contact_list["name"]
        requests.delete(f"{API}/crm/campaigns/{camp['id']}", headers=H, timeout=10)

    def test_update_delete_campaign(self, H):
        camp = self._mk_campaign(H)
        r = requests.put(f"{API}/crm/campaigns/{camp['id']}", json={"name": "TEST_Renamed"},
                         headers=H, timeout=15)
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Renamed"
        r = requests.delete(f"{API}/crm/campaigns/{camp['id']}", headers=H, timeout=10)
        assert r.status_code == 200
        r = requests.delete(f"{API}/crm/campaigns/{camp['id']}", headers=H, timeout=10)
        assert r.status_code == 404

    def test_preview_audience_all(self, H, client_with_tag):
        camp = self._mk_campaign(H, audience_mode="all")
        try:
            r = requests.post(f"{API}/crm/campaigns/{camp['id']}/preview-audience", headers=H, timeout=20)
            assert r.status_code == 200, r.text
            body = r.json()
            assert "count" in body and "preview" in body
            assert body["count"] >= 1
        finally:
            requests.delete(f"{API}/crm/campaigns/{camp['id']}", headers=H, timeout=10)

    def test_preview_audience_no_tag(self, H, client_no_tag):
        camp = self._mk_campaign(H, audience_mode="no_tag")
        try:
            r = requests.post(f"{API}/crm/campaigns/{camp['id']}/preview-audience", headers=H, timeout=20)
            assert r.status_code == 200, r.text
            body = r.json()
            phones = [p["phone"] for p in body["preview"]]
            # client_no_tag has no tags -> must appear
            assert client_no_tag["phone"] in phones
        finally:
            requests.delete(f"{API}/crm/campaigns/{camp['id']}", headers=H, timeout=10)

    def test_preview_audience_tags(self, H, tag):
        # Use tickets path (resolver queries tickets with tags too)
        r = requests.post(f"{API}/crm/tickets", json={
            "customer_name": "TEST_TagTicket", "customer_phone": "+5511900700050",
            "channel": "whatsapp", "tags": [tag["name"]],
        }, headers=H, timeout=15)
        tid = r.json()["id"]
        camp = self._mk_campaign(H, audience_mode="tags", tag_ids=[tag["id"]])
        try:
            r = requests.post(f"{API}/crm/campaigns/{camp['id']}/preview-audience", headers=H, timeout=20)
            assert r.status_code == 200, r.text
            body = r.json()
            phones = [p["phone"] for p in body["preview"]]
            assert "+5511900700050" in phones
        finally:
            requests.delete(f"{API}/crm/campaigns/{camp['id']}", headers=H, timeout=10)
            requests.delete(f"{API}/crm/tickets/{tid}", headers=H, timeout=10)

    def test_preview_audience_list(self, H, contact_list):
        camp = self._mk_campaign(H, audience_mode="list", contact_list_id=contact_list["id"])
        try:
            r = requests.post(f"{API}/crm/campaigns/{camp['id']}/preview-audience", headers=H, timeout=20)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["count"] == 2
        finally:
            requests.delete(f"{API}/crm/campaigns/{camp['id']}", headers=H, timeout=10)

    def test_run_empty_audience_returns_400(self, H):
        # tags mode without tag_ids -> empty
        camp = self._mk_campaign(H, audience_mode="tags", tag_ids=[])
        try:
            r = requests.post(f"{API}/crm/campaigns/{camp['id']}/run", headers=H, timeout=30)
            assert r.status_code == 400, r.text
            assert "Audiencia" in r.json().get("detail", "") or "vazia" in r.json().get("detail", "").lower()
        finally:
            requests.delete(f"{API}/crm/campaigns/{camp['id']}", headers=H, timeout=10)

    def test_run_no_messages_returns_400(self, H, client_with_tag, tag, connection):
        camp = self._mk_campaign(H, audience_mode="tags", tag_ids=[tag["id"]],
                                 connection_id=connection["id"], messages=["   ", ""])
        try:
            r = requests.post(f"{API}/crm/campaigns/{camp['id']}/run", headers=H, timeout=30)
            assert r.status_code == 400, r.text
        finally:
            requests.delete(f"{API}/crm/campaigns/{camp['id']}", headers=H, timeout=10)


# ===================== RETRY MESSAGE =====================
class TestRetryMessage:
    def test_retry_ticket_not_found(self, H):
        r = requests.post(f"{API}/crm/tickets/{uuid.uuid4()}/messages/{uuid.uuid4()}/retry",
                          headers=H, timeout=15)
        assert r.status_code == 404

    def test_retry_user_message_returns_400(self, H):
        # create ticket and inject user msg via direct POST (sender_type user)
        r = requests.post(f"{API}/crm/tickets", json={
            "customer_name": "TEST_Retry_User", "customer_phone": "+5511922220001",
            "channel": "whatsapp",
        }, headers=H, timeout=15)
        tid = r.json()["id"]
        try:
            r = requests.post(f"{API}/crm/tickets/{tid}/messages",
                              json={"content": "user msg", "sender_type": "user"},
                              headers=H, timeout=20)
            assert r.status_code == 200
            mid = r.json()["id"]
            r = requests.post(f"{API}/crm/tickets/{tid}/messages/{mid}/retry", headers=H, timeout=15)
            assert r.status_code == 400, r.text
        finally:
            requests.delete(f"{API}/crm/tickets/{tid}", headers=H, timeout=10)

    def test_retry_agent_message_no_connection_400(self, H):
        # No active connection => 400 "Nenhuma conexao WhatsApp ativa"
        r = requests.post(f"{API}/crm/tickets", json={
            "customer_name": "TEST_Retry_Agent", "customer_phone": "+5511922220002",
            "channel": "whatsapp",
        }, headers=H, timeout=15)
        tid = r.json()["id"]
        try:
            r = requests.post(f"{API}/crm/tickets/{tid}/messages",
                              json={"content": "agent msg", "sender_type": "agent"},
                              headers=H, timeout=30)
            assert r.status_code == 200
            mid = r.json()["id"]
            r = requests.post(f"{API}/crm/tickets/{tid}/messages/{mid}/retry", headers=H, timeout=30)
            # Either 400 (no active conn) or 502 (microservice offline if fallback found a conn)
            assert r.status_code in (400, 502), f"unexpected {r.status_code}: {r.text}"
        finally:
            requests.delete(f"{API}/crm/tickets/{tid}", headers=H, timeout=10)


# ===================== WA CONTACTS / IMPORT =====================
class TestWaContactsImport:
    def test_wa_contacts_graceful(self, H, connection):
        r = requests.get(f"{API}/channels/connections/{connection['id']}/wa-contacts",
                         headers=H, timeout=25)
        # Must NOT 500; returns {contacts: [], ...}
        assert r.status_code == 200, r.text
        body = r.json()
        assert "contacts" in body
        assert isinstance(body["contacts"], list)

    def test_import_contacts_modes(self, H, connection):
        for mode in ("all", "with_name", "without_name"):
            r = requests.post(f"{API}/channels/connections/{connection['id']}/import-contacts",
                              json={"mode": mode}, headers=H, timeout=40)
            # 200 with payload OR 502 microservico indisponivel. Never 500.
            assert r.status_code in (200, 502), f"mode={mode} status={r.status_code} body={r.text}"
            if r.status_code == 200:
                body = r.json()
                assert "imported" in body and "new_clients" in body


# ===================== WEBHOOKS (connected + message filter) =====================
class TestWebhookConnectedAndFilter:
    def test_webhook_connected_sets_connected_at(self, connection, H):
        r = requests.post(f"{API}/channels/webhook/connected",
                          json={"instance_id": connection["id"], "phone": "5511000", "name": "TEST"},
                          timeout=15)
        assert r.status_code == 200
        # Verify persisted
        r = requests.get(f"{API}/channels/connections", headers=H, timeout=15)
        got = next((c for c in r.json() if c["id"] == connection["id"]), None)
        assert got and got.get("connected_at"), f"connected_at missing: {got}"

    def test_webhook_message_older_than_connected_at_ignored(self, connection, H):
        # Ensure connected_at is now
        requests.post(f"{API}/channels/webhook/connected",
                      json={"instance_id": connection["id"], "phone": "5511000"}, timeout=15)
        # Send a msg with timestamp in the past
        old_ts = int((datetime.now(timezone.utc) - timedelta(days=2)).timestamp())
        phone = f"+5511{uuid.uuid4().hex[:8]}"
        r = requests.post(f"{API}/channels/webhook/message", json={
            "instance_id": connection["id"],
            "phone": phone, "name": "TEST_OldMsg",
            "message": "msg antiga",
            "message_id": f"wamid_{uuid.uuid4().hex[:10]}",
            "timestamp": old_ts,
        }, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body.get("ignored") == "older_than_connected_at", body

        # No ticket should have been created
        tickets = requests.get(f"{API}/crm/tickets", headers=H, timeout=15).json()
        assert not any(t.get("customer_phone") == phone for t in tickets)


# ===================== TICKET UPDATE with queue_id + connection_id =====================
class TestTicketUpdateQueueConnection:
    def test_put_ticket_queue_and_connection(self, H, connection):
        # create queue
        r = requests.post(f"{API}/crm/queues", json={"name": "TEST_QueueAttach"}, headers=H, timeout=15)
        qid = r.json()["id"]
        # create ticket
        r = requests.post(f"{API}/crm/tickets", json={
            "customer_name": "TEST_QConn", "customer_phone": "+5511955559999", "channel": "whatsapp",
        }, headers=H, timeout=15)
        tid = r.json()["id"]
        try:
            r = requests.put(f"{API}/crm/tickets/{tid}",
                             json={"queue_id": qid, "connection_id": connection["id"]},
                             headers=H, timeout=15)
            assert r.status_code == 200, r.text
            t = r.json()
            assert t.get("queue_id") == qid
            assert t.get("connection_id") == connection["id"]
            # Verify persistence
            r2 = requests.get(f"{API}/crm/tickets/{tid}", headers=H, timeout=15)
            assert r2.json().get("queue_id") == qid
            assert r2.json().get("connection_id") == connection["id"]
        finally:
            requests.delete(f"{API}/crm/tickets/{tid}", headers=H, timeout=10)
            requests.delete(f"{API}/crm/queues/{qid}", headers=H, timeout=10)
