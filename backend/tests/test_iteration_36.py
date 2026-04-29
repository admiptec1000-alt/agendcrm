"""
Iteration 36 — Backend tests for:
- PUT /api/channels/connections/{id} (inline rename + status)
  - 200 happy path persists name; 404 for unknown id; 400 when payload is empty
- PUT /api/crm/tickets/{id} accepts kanban_column_id and persists
  - Set value, change value, clear with null
- TicketUpdate model includes kanban_column_id Optional[str]
- GET /api/crm/tickets returns connection_id, queue_id, assigned_to, kanban_column_id
- Light regression: iter35 reports/tickets shape
Test creds (from /app/memory/test_credentials.md):
  CRM admin: crm@test.com / crm123
  Boss admin: admin@boss.com.br / boss123
"""
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as fh:
        for ln in fh:
            if ln.startswith("REACT_APP_BACKEND_URL"):
                BASE_URL = ln.split("=", 1)[1].strip().strip('"').rstrip("/")

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "agentcrm_db")

CRM_EMAIL = "crm@test.com"
CRM_PASSWORD = "crm123"
BOSS_EMAIL = "admin@boss.com.br"
BOSS_PASSWORD = "boss123"


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def db():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


def _login(email, password):
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": email, "password": password}, timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="module")
def crm_auth():
    p = _login(CRM_EMAIL, CRM_PASSWORD)
    return {"token": p["access_token"], "user": p["user"],
            "headers": {"Authorization": f"Bearer {p['access_token']}"}}


# ==========================================================================
# 1) PUT /api/channels/connections/{id} — rename + edge cases
# ==========================================================================
class TestConnectionInlineRename:

    def test_rename_connection_persists(self, crm_auth):
        # Create a fresh test connection via API
        original = f"TEST_Conn_Original_{uuid.uuid4().hex[:6]}"
        cr = requests.post(
            f"{BASE_URL}/api/channels/connections",
            headers=crm_auth["headers"],
            json={"name": original, "type": "whatsapp"},
            timeout=15,
        )
        assert cr.status_code == 200, cr.text
        conn = cr.json()
        cid = conn["id"]
        assert conn["name"] == original

        try:
            new_name = f"TEST_Conn_Renamed_{uuid.uuid4().hex[:6]}"
            r = requests.put(
                f"{BASE_URL}/api/channels/connections/{cid}",
                headers=crm_auth["headers"],
                json={"name": new_name}, timeout=15,
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["name"] == new_name
            assert body["id"] == cid
            assert "_id" not in body  # mongo objectId must be excluded

            # Verify persistence via GET /connections
            g = requests.get(f"{BASE_URL}/api/channels/connections",
                             headers=crm_auth["headers"], timeout=15).json()
            found = next((c for c in g if c["id"] == cid), None)
            assert found is not None
            assert found["name"] == new_name
        finally:
            requests.delete(f"{BASE_URL}/api/channels/connections/{cid}",
                            headers=crm_auth["headers"], timeout=10)

    def test_rename_404_when_id_unknown(self, crm_auth):
        bogus = f"NOPE_{uuid.uuid4().hex}"
        r = requests.put(
            f"{BASE_URL}/api/channels/connections/{bogus}",
            headers=crm_auth["headers"],
            json={"name": "irrelevant"}, timeout=15,
        )
        assert r.status_code == 404, r.text

    def test_rename_400_when_empty_payload(self, crm_auth):
        # Create a fresh connection for this test
        cr = requests.post(
            f"{BASE_URL}/api/channels/connections",
            headers=crm_auth["headers"],
            json={"name": f"TEST_Conn_Empty_{uuid.uuid4().hex[:6]}", "type": "whatsapp"},
            timeout=15,
        ).json()
        cid = cr["id"]
        try:
            r = requests.put(
                f"{BASE_URL}/api/channels/connections/{cid}",
                headers=crm_auth["headers"],
                json={}, timeout=15,
            )
            assert r.status_code == 400, f"expected 400 for empty payload, got {r.status_code}: {r.text}"
        finally:
            requests.delete(f"{BASE_URL}/api/channels/connections/{cid}",
                            headers=crm_auth["headers"], timeout=10)

    def test_connection_update_status_still_works(self, crm_auth):
        """Ensure ConnectionUpdate{name,status} still accepts status (no breaking change)."""
        cr = requests.post(
            f"{BASE_URL}/api/channels/connections",
            headers=crm_auth["headers"],
            json={"name": f"TEST_Conn_Status_{uuid.uuid4().hex[:6]}", "type": "whatsapp"},
            timeout=15,
        ).json()
        cid = cr["id"]
        try:
            r = requests.put(
                f"{BASE_URL}/api/channels/connections/{cid}",
                headers=crm_auth["headers"],
                json={"status": "disconnected"}, timeout=15,
            )
            assert r.status_code == 200, r.text
            assert r.json().get("status") == "disconnected"
        finally:
            requests.delete(f"{BASE_URL}/api/channels/connections/{cid}",
                            headers=crm_auth["headers"], timeout=10)


# ==========================================================================
# 2) PUT /api/crm/tickets/{id} accepts kanban_column_id (set, change, clear)
# ==========================================================================
class TestTicketKanbanColumnUpdate:

    @pytest.fixture
    def seeded_ticket(self, crm_auth, db):
        company_id = crm_auth["user"]["company_id"]
        tid = f"TEST_kanban_tick_{uuid.uuid4().hex[:8]}"
        now = datetime.now(timezone.utc).isoformat()
        db.tickets.insert_one({
            "id": tid, "ticket_number": 999100, "company_id": company_id,
            "customer_name": "TEST_Kanban", "customer_phone": "5511910000001",
            "status": "aberto", "priority": "medium", "channel": "web",
            "tags": [], "created_at": now, "updated_at": now,
        })
        yield tid
        db.tickets.delete_one({"id": tid})

    def test_set_kanban_column_id(self, crm_auth, seeded_ticket):
        tid = seeded_ticket
        col1 = f"col_{uuid.uuid4().hex[:8]}"
        r = requests.put(
            f"{BASE_URL}/api/crm/tickets/{tid}",
            headers=crm_auth["headers"],
            json={"kanban_column_id": col1}, timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["kanban_column_id"] == col1
        assert body["id"] == tid
        assert "_id" not in body

        # Verify via GET
        g = requests.get(f"{BASE_URL}/api/crm/tickets/{tid}",
                         headers=crm_auth["headers"], timeout=15).json()
        assert g["kanban_column_id"] == col1

    def test_change_kanban_column_id(self, crm_auth, seeded_ticket):
        tid = seeded_ticket
        col1 = f"col_{uuid.uuid4().hex[:8]}"
        col2 = f"col_{uuid.uuid4().hex[:8]}"
        # set
        r1 = requests.put(f"{BASE_URL}/api/crm/tickets/{tid}",
                          headers=crm_auth["headers"],
                          json={"kanban_column_id": col1}, timeout=15)
        assert r1.status_code == 200
        # change
        r2 = requests.put(f"{BASE_URL}/api/crm/tickets/{tid}",
                          headers=crm_auth["headers"],
                          json={"kanban_column_id": col2}, timeout=15)
        assert r2.status_code == 200
        assert r2.json()["kanban_column_id"] == col2

    def test_clear_kanban_column_with_null(self, crm_auth, seeded_ticket, db):
        tid = seeded_ticket
        col1 = f"col_{uuid.uuid4().hex[:8]}"
        # First set a value
        requests.put(f"{BASE_URL}/api/crm/tickets/{tid}",
                     headers=crm_auth["headers"],
                     json={"kanban_column_id": col1}, timeout=15)
        # Confirm DB
        before = db.tickets.find_one({"id": tid}, {"_id": 0})
        assert before["kanban_column_id"] == col1

        # Now try to clear it via null
        r = requests.put(
            f"{BASE_URL}/api/crm/tickets/{tid}",
            headers=crm_auth["headers"],
            json={"kanban_column_id": None}, timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # Per review request: PUT must accept null and clear the field
        assert body.get("kanban_column_id") in (None, ""), \
            f"clear via null did not work; got kanban_column_id={body.get('kanban_column_id')!r}"

        # Verify in DB
        after = db.tickets.find_one({"id": tid}, {"_id": 0})
        assert after.get("kanban_column_id") in (None, ""), \
            f"DB still has kanban_column_id={after.get('kanban_column_id')!r}"


# ==========================================================================
# 3) TicketUpdate model — kanban_column_id is Optional[str]
# ==========================================================================
class TestTicketUpdateModel:

    def test_model_includes_kanban_column_id(self):
        from backend.models import TicketUpdate
        fields = TicketUpdate.model_fields
        assert "kanban_column_id" in fields, "TicketUpdate must declare kanban_column_id"
        # Optional means default None
        assert fields["kanban_column_id"].default is None
        # Type annotation accepts Optional[str]
        ann = fields["kanban_column_id"].annotation
        # Optional[str] in Pydantic v2 is Union[str, None]
        from typing import get_args, get_origin, Union
        origin = get_origin(ann)
        assert origin is Union or str(ann).startswith("typing.Optional"), \
            f"unexpected annotation: {ann!r}"
        args = get_args(ann)
        assert str in args and type(None) in args


# ==========================================================================
# 4) GET /api/crm/tickets returns required fields
# ==========================================================================
class TestTicketsListExposesFields:

    def test_list_includes_relevant_fields(self, crm_auth, db):
        company_id = crm_auth["user"]["company_id"]
        # Seed a fully-populated ticket
        conn_id = f"TEST_conn36_{uuid.uuid4().hex[:6]}"
        queue_id = f"TEST_queue36_{uuid.uuid4().hex[:6]}"
        col_id = f"col36_{uuid.uuid4().hex[:6]}"
        admin_id = crm_auth["user"]["id"]
        db.channel_connections.insert_one(
            {"id": conn_id, "company_id": company_id, "name": "TEST_Conn36", "type": "whatsapp"}
        )
        db.queues.insert_one(
            {"id": queue_id, "company_id": company_id, "name": "TEST_Queue36"}
        )
        tid = f"TEST_tick36_{uuid.uuid4().hex[:8]}"
        now = datetime.now(timezone.utc).isoformat()
        db.tickets.insert_one({
            "id": tid, "ticket_number": 999200, "company_id": company_id,
            "customer_name": "TEST_FieldsCheck", "customer_phone": "5511910000002",
            "status": "aberto", "priority": "medium", "channel": "web",
            "connection_id": conn_id, "queue_id": queue_id,
            "assigned_to": admin_id, "kanban_column_id": col_id,
            "tags": [], "created_at": now, "updated_at": now,
        })
        try:
            r = requests.get(f"{BASE_URL}/api/crm/tickets",
                             headers=crm_auth["headers"], timeout=15)
            assert r.status_code == 200
            rows = r.json()
            row = next((t for t in rows if t["id"] == tid), None)
            assert row is not None, "seeded ticket not returned by GET /crm/tickets"
            assert row.get("connection_id") == conn_id
            assert row.get("queue_id") == queue_id
            assert row.get("assigned_to") == admin_id
            assert row.get("kanban_column_id") == col_id
            assert "_id" not in row
        finally:
            db.tickets.delete_one({"id": tid})
            db.channel_connections.delete_one({"id": conn_id})
            db.queues.delete_one({"id": queue_id})


# ==========================================================================
# 5) Light regression — iter35 endpoint still healthy
# ==========================================================================
class TestRegressionIter35:

    def test_reports_tickets_shape(self, crm_auth):
        r = requests.get(f"{BASE_URL}/api/reports/tickets?page=1&page_size=5",
                         headers=crm_auth["headers"], timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        for k in ("total", "page", "page_size", "rows"):
            assert k in body
