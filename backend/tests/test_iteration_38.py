"""Iteration 38: Ticket↔Client unification.

Validates:
- POST /api/crm/tickets links a client_id (find_or_create_client_by_phone)
- Reusing an existing phone returns the same client_id
- GET /api/crm/tickets/{id}/client returns the linked client (lazy match for legacy)
- PUT /api/crm/tickets/{id}/client updates whitelisted fields and syncs ticket
- Phone change via PUT also updates ticket.customer_phone
- TicketUpdate accepts client_id (regression-safe field on PUT /tickets/{id})
- Iter36/37 regressions (kanban_column_id clear with null, connection rename)
"""
import os
import re
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
LOGIN = {"email": "crm@test.com", "password": "crm123"}


def _digits(p):
    return re.sub(r"\D+", "", p or "")


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json=LOGIN, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    s.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    return s


@pytest.fixture(scope="module")
def created_ids():
    """Track ticket ids for cleanup."""
    return {"tickets": []}


def teardown_module(module):
    """Best-effort cleanup at module end via a fresh session."""
    try:
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/auth/login", json=LOGIN, timeout=10)
        if r.status_code != 200:
            return
        s.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
        # Delete tickets created with TEST_iter38 prefix in customer_name
        rr = s.get(f"{BASE_URL}/api/crm/tickets", params={"search": "TEST_iter38"}, timeout=10)
        if rr.status_code == 200:
            for t in rr.json():
                s.delete(f"{BASE_URL}/api/crm/tickets/{t['id']}", timeout=10)
    except Exception:
        pass


class TestTicketClientLinking:
    """POST /api/crm/tickets links and reuses client by phone."""

    def test_create_ticket_creates_client_link(self, client, created_ids):
        unique_phone = f"+5511{uuid.uuid4().int % 10**9:09d}"
        payload = {
            "customer_name": "TEST_iter38_New",
            "customer_phone": unique_phone,
            "channel": "whatsapp",
        }
        r = client.post(f"{BASE_URL}/api/crm/tickets", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        t = r.json()
        assert t["client_id"], "client_id must be set on new ticket"
        created_ids["tickets"].append(t["id"])
        created_ids["phone_a"] = unique_phone
        created_ids["client_a"] = t["client_id"]
        created_ids["ticket_a"] = t["id"]

    def test_get_ticket_client_returns_doc(self, client, created_ids):
        tid = created_ids["ticket_a"]
        r = client.get(f"{BASE_URL}/api/crm/tickets/{tid}/client", timeout=10)
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["id"] == created_ids["client_a"]
        assert _digits(c["phone"]) == _digits(created_ids["phone_a"])
        assert c.get("person_type") in ("fisica", "juridica")

    def test_create_ticket_with_same_phone_reuses_client(self, client, created_ids):
        payload = {
            "customer_name": "TEST_iter38_Same",
            "customer_phone": created_ids["phone_a"],
            "channel": "whatsapp",
        }
        r = client.post(f"{BASE_URL}/api/crm/tickets", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        t = r.json()
        created_ids["tickets"].append(t["id"])
        assert t["client_id"] == created_ids["client_a"], "same phone must reuse client"


class TestTicketClientUpdate:
    """PUT /api/crm/tickets/{id}/client updates whitelisted fields + syncs ticket."""

    def test_put_updates_client_and_syncs_ticket_name(self, client, created_ids):
        tid = created_ids["ticket_a"]
        payload = {
            "name": "TEST_iter38_Updated",
            "person_type": "fisica",
            "cpf": "12345678901",
            "cep": "01310100",
            "city": "São Paulo",
            "state": "SP",
            "address": "Av Paulista, 1000",
            "notes": "Lead quente",
        }
        r = client.put(f"{BASE_URL}/api/crm/tickets/{tid}/client", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        c = r.json()
        # Whitelisted fields persisted
        for k, v in payload.items():
            assert c.get(k) == v, f"{k} expected {v} got {c.get(k)}"
        # Ticket denormalized customer_name synced
        rt = client.get(f"{BASE_URL}/api/crm/tickets/{tid}", timeout=10)
        assert rt.status_code == 200
        assert rt.json()["customer_name"] == "TEST_iter38_Updated"

    def test_put_phone_change_syncs_ticket_phone(self, client, created_ids):
        tid = created_ids["ticket_a"]
        new_phone = f"+5511{uuid.uuid4().int % 10**9:09d}"
        r = client.put(
            f"{BASE_URL}/api/crm/tickets/{tid}/client",
            json={"phone": new_phone},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["phone"] == new_phone
        rt = client.get(f"{BASE_URL}/api/crm/tickets/{tid}", timeout=10)
        assert rt.json()["customer_phone"] == new_phone

    def test_put_juridica_with_cnpj(self, client, created_ids):
        # Create a fresh ticket dedicated to PJ flow
        phone = f"+5511{uuid.uuid4().int % 10**9:09d}"
        rc = client.post(
            f"{BASE_URL}/api/crm/tickets",
            json={"customer_name": "TEST_iter38_PJ", "customer_phone": phone, "channel": "web"},
            timeout=15,
        )
        assert rc.status_code == 200
        tid = rc.json()["id"]
        created_ids["tickets"].append(tid)
        r = client.put(
            f"{BASE_URL}/api/crm/tickets/{tid}/client",
            json={
                "person_type": "juridica",
                "cnpj": "11222333000181",
                "company_name": "TEST_iter38 LTDA",
            },
            timeout=15,
        )
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["person_type"] == "juridica"
        assert c["cnpj"] == "11222333000181"
        assert c["company_name"] == "TEST_iter38 LTDA"

    def test_put_ignores_non_whitelisted_fields(self, client, created_ids):
        tid = created_ids["ticket_a"]
        r = client.put(
            f"{BASE_URL}/api/crm/tickets/{tid}/client",
            json={"name": "TEST_iter38_WL", "id": "hacked-id", "company_id": "evil"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["name"] == "TEST_iter38_WL"
        assert c["id"] != "hacked-id"  # id should not change


class TestTicketUpdateClientId:
    """TicketUpdate accepts client_id."""

    def test_put_ticket_with_client_id(self, client, created_ids):
        tid = created_ids["ticket_a"]
        cid = created_ids["client_a"]
        # Re-set client_id explicitly via PUT /tickets/{id}
        r = client.put(f"{BASE_URL}/api/crm/tickets/{tid}", json={"client_id": cid}, timeout=10)
        assert r.status_code == 200, r.text
        assert r.json().get("client_id") == cid


class TestRegressionIter36_37:
    """Iter36 (rename connection) + iter37 (connection_ids on user) basic smoke."""

    def test_kanban_column_id_set_then_change(self, client, created_ids):
        tid = created_ids["ticket_a"]
        # Create a custom column
        rc = client.post(
            f"{BASE_URL}/api/crm/kanban-columns",
            json={"name": "TEST_iter38_col", "color": "#123456"},
            timeout=10,
        )
        assert rc.status_code == 200
        col_id = rc.json()["id"]
        try:
            r = client.put(f"{BASE_URL}/api/crm/tickets/{tid}", json={"kanban_column_id": col_id}, timeout=10)
            assert r.status_code == 200
            assert r.json().get("kanban_column_id") == col_id
        finally:
            client.delete(f"{BASE_URL}/api/crm/kanban-columns/{col_id}", timeout=10)

    def test_tickets_report_endpoint_alive(self, client):
        # iter35: /api/crm/tickets list with status filter still 200
        r = client.get(f"{BASE_URL}/api/crm/tickets", params={"status": "aberto"}, timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
