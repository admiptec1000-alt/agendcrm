"""Iteration 58 — Validate 3 backend fixes:
1. PUT /api/crm/tickets/{id} accepts status='atendendo'/'aguardando' (no 422)
2. Quick Responses full CRUD (PUT update preserves attachment when omitted)
3. GET /api/scheduling/company-users returns users for CRM-type company
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://agentcrm-book.preview.emergentagent.com").rstrip("/")
LOGIN_EMAIL = "crm@test.com"
LOGIN_PASSWORD = "crm123"
SUBDOMAIN = "crmtest"


@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": LOGIN_EMAIL, "password": LOGIN_PASSWORD, "subdomain": SUBDOMAIN},
        timeout=20,
    )
    if r.status_code != 200:
        # Fallback without subdomain
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": LOGIN_EMAIL, "password": LOGIN_PASSWORD},
            timeout=20,
        )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ----------- 1) Ticket status enum: atendendo / aguardando -----------
class TestTicketStatusEnum:
    def test_create_then_put_status_atendendo_with_assigned(self, headers):
        # Create a TEST ticket
        cr = requests.post(
            f"{BASE_URL}/api/crm/tickets",
            headers=headers,
            json={
                "customer_name": "TEST_iter58_status",
                "customer_phone": "+5511990000058",
                "channel": "web",
                "status": "aberto",
                "force_create": True,
            },
            timeout=20,
        )
        assert cr.status_code == 200, cr.text[:300]
        tid = cr.json()["id"]

        # Get a 2nd user from company-users to be assignee
        ur = requests.get(f"{BASE_URL}/api/scheduling/company-users", headers=headers, timeout=20)
        assert ur.status_code == 200, ur.text[:300]
        users = ur.json()
        assert isinstance(users, list) and len(users) >= 1
        assignee_id = users[0].get("id")
        assert assignee_id

        # PUT with status='atendendo' + assigned_to — used to be 422
        pr = requests.put(
            f"{BASE_URL}/api/crm/tickets/{tid}",
            headers=headers,
            json={"status": "atendendo", "assigned_to": assignee_id},
            timeout=20,
        )
        assert pr.status_code == 200, f"PUT atendendo failed: {pr.status_code} {pr.text[:300]}"
        data = pr.json()
        assert data["status"] == "atendendo"
        assert data["assigned_to"] == assignee_id

        # Verify via GET
        gr = requests.get(f"{BASE_URL}/api/crm/tickets/{tid}", headers=headers, timeout=20)
        assert gr.status_code == 200
        assert gr.json()["status"] == "atendendo"
        assert gr.json()["assigned_to"] == assignee_id

        # PUT status='aguardando'
        pr2 = requests.put(
            f"{BASE_URL}/api/crm/tickets/{tid}",
            headers=headers,
            json={"status": "aguardando"},
            timeout=20,
        )
        assert pr2.status_code == 200, f"PUT aguardando failed: {pr2.status_code} {pr2.text[:300]}"
        assert pr2.json()["status"] == "aguardando"

        # Cleanup
        requests.delete(f"{BASE_URL}/api/crm/tickets/{tid}", headers=headers, timeout=20)


# ----------- 2) Quick Responses CRUD -----------
class TestQuickResponseCRUD:
    def test_full_crud(self, headers):
        # Create
        payload = {
            "title": "TEST_iter58_qr",
            "content": "Olá, tudo bem?",
            "shortcut": "/oi58",
            "attachment_filename": "hello.txt",
            "attachment_mimetype": "text/plain",
            "attachment_data_b64": "aGVsbG8=",  # 'hello'
        }
        cr = requests.post(f"{BASE_URL}/api/crm/quick-responses", headers=headers, json=payload, timeout=20)
        assert cr.status_code == 200, cr.text[:300]
        qr = cr.json()
        qid = qr["id"]
        assert qr["title"] == payload["title"]
        assert qr["attachment_filename"] == "hello.txt"

        # GET list contains
        lr = requests.get(f"{BASE_URL}/api/crm/quick-responses", headers=headers, timeout=20)
        assert lr.status_code == 200
        assert any(x["id"] == qid for x in lr.json())

        # PUT update title/content/shortcut WITHOUT touching attachment
        ur = requests.put(
            f"{BASE_URL}/api/crm/quick-responses/{qid}",
            headers=headers,
            json={"title": "TEST_iter58_qr_edit", "content": "Editado!", "shortcut": "/oi58e"},
            timeout=20,
        )
        assert ur.status_code == 200, ur.text[:300]
        updated = ur.json()
        assert updated["title"] == "TEST_iter58_qr_edit"
        assert updated["content"] == "Editado!"
        assert updated["shortcut"] == "/oi58e"
        # Attachment must still be preserved
        assert updated.get("attachment_filename") == "hello.txt", "Attachment was lost on PUT!"
        assert updated.get("attachment_data_b64") == "aGVsbG8="

        # DELETE
        dr = requests.delete(f"{BASE_URL}/api/crm/quick-responses/{qid}", headers=headers, timeout=20)
        assert dr.status_code == 200

        # Verify gone
        lr2 = requests.get(f"{BASE_URL}/api/crm/quick-responses", headers=headers, timeout=20)
        assert not any(x["id"] == qid for x in lr2.json())


# ----------- 3) Scheduling company-users -----------
class TestCompanyUsers:
    def test_get_company_users(self, headers):
        r = requests.get(f"{BASE_URL}/api/scheduling/company-users", headers=headers, timeout=20)
        assert r.status_code == 200, r.text[:300]
        users = r.json()
        assert isinstance(users, list)
        assert len(users) >= 1
        first = users[0]
        # Validate basic shape
        assert "id" in first
        # name or email expected
        assert any(k in first for k in ("name", "email"))
