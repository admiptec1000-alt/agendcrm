"""
Iteration 23 backend tests
- Subscription plans CRUD with items (service_id, credits_per_use)
- Subscriptions create with end_date + credits_remaining
- Public subscription lookup GET /api/public/booking/boss/subscription?phone=X
- Public booking with use_subscription consumes credits and sets price=0
- Admin appointment create endpoint does not crash when no WhatsApp connected
- Regression: auth admin + permissions + core endpoints
"""
import os
import uuid
from datetime import datetime, timedelta

import pytest
import requests

def _load_backend_url():
    url = os.environ.get("REACT_APP_BACKEND_URL")
    if not url:
        try:
            with open("/app/frontend/.env") as f:
                for line in f:
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        url = line.split("=", 1)[1].strip()
                        break
        except Exception:
            pass
    if not url:
        raise RuntimeError("REACT_APP_BACKEND_URL not set")
    return url.rstrip("/")


BASE_URL = _load_backend_url()
SLUG = "boss"


@pytest.fixture(scope="session")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def admin_token(api_client):
    r = api_client.post(f"{BASE_URL}/api/auth/login", json={
        "email": "admin@boss.com.br", "password": "boss123"
    })
    assert r.status_code == 200, f"login failed {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def auth(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def service_ids(api_client, auth):
    r = api_client.get(f"{BASE_URL}/api/scheduling/services", headers=auth)
    assert r.status_code == 200
    svcs = r.json()
    assert len(svcs) >= 1, "Need at least one service in Boss"
    return [s["id"] for s in svcs][:2]


# ============ Regression ============
class TestRegression:
    def test_login_admin(self, admin_token):
        assert isinstance(admin_token, str) and len(admin_token) > 10

    def test_permissions(self, api_client, auth):
        r = api_client.get(f"{BASE_URL}/api/auth/me", headers=auth)
        assert r.status_code == 200
        data = r.json()
        assert "permissions" in data
        assert data["permissions"] == ["*"]

    def test_list_services(self, api_client, auth):
        r = api_client.get(f"{BASE_URL}/api/scheduling/services", headers=auth)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ============ Plans CRUD ============
class TestPlansCRUD:
    created_ids = []

    def test_create_plan_with_items(self, api_client, auth, service_ids):
        payload = {
            "name": f"TEST_iter23_plan_{uuid.uuid4().hex[:6]}",
            "price": 199.90,
            "cycle_days": 30,
            "total_credits": 10,
            "items": [
                {"service_id": service_ids[0], "credits_per_use": 2},
            ],
        }
        if len(service_ids) > 1:
            payload["items"].append({"service_id": service_ids[1], "credits_per_use": 1})
        r = api_client.post(f"{BASE_URL}/api/scheduling/subscription-plans", json=payload, headers=auth)
        assert r.status_code == 200, r.text
        plan = r.json()
        assert plan["name"] == payload["name"]
        assert plan["price"] == 199.90
        assert plan["cycle_days"] == 30
        assert plan["total_credits"] == 10
        assert isinstance(plan.get("items"), list) and len(plan["items"]) == len(payload["items"])
        assert plan["items"][0]["service_id"] == service_ids[0]
        assert plan["items"][0]["credits_per_use"] == 2
        TestPlansCRUD.created_ids.append(plan["id"])

    def test_list_plan_persisted(self, api_client, auth):
        assert TestPlansCRUD.created_ids
        pid = TestPlansCRUD.created_ids[0]
        r = api_client.get(f"{BASE_URL}/api/scheduling/subscription-plans", headers=auth)
        assert r.status_code == 200
        ids = [p["id"] for p in r.json()]
        assert pid in ids

    def test_update_plan(self, api_client, auth, service_ids):
        pid = TestPlansCRUD.created_ids[0]
        r = api_client.put(
            f"{BASE_URL}/api/scheduling/subscription-plans/{pid}",
            json={
                "price": 249.90,
                "cycle_days": 45,
                "total_credits": 15,
                "items": [{"service_id": service_ids[0], "credits_per_use": 3}],
            },
            headers=auth,
        )
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["price"] == 249.90
        assert p["cycle_days"] == 45
        assert p["total_credits"] == 15
        assert p["items"][0]["credits_per_use"] == 3

    def test_delete_plan(self, api_client, auth):
        pid = TestPlansCRUD.created_ids[0]
        r = api_client.delete(f"{BASE_URL}/api/scheduling/subscription-plans/{pid}", headers=auth)
        assert r.status_code == 200
        # Verify not in list
        r2 = api_client.get(f"{BASE_URL}/api/scheduling/subscription-plans", headers=auth)
        assert pid not in [p["id"] for p in r2.json()]


# ============ Subscriptions + Public booking ============
class TestSubscriptionsAndPublicBooking:
    state = {}

    def test_setup_client_plan_and_subscription(self, api_client, auth, service_ids):
        # 1) create test client
        phone = f"11999{uuid.uuid4().hex[:6]}"
        client_payload = {"name": f"TEST_iter23_cli_{phone}", "phone": phone}
        rc = api_client.post(f"{BASE_URL}/api/scheduling/clients", json=client_payload, headers=auth)
        assert rc.status_code == 200, rc.text
        self.state["client_id"] = rc.json()["id"]
        self.state["phone"] = phone

        # 2) create plan with 2 credits for service_ids[0] at 1 credit per use
        plan_payload = {
            "name": f"TEST_iter23_subplan_{uuid.uuid4().hex[:5]}",
            "price": 100.0,
            "cycle_days": 30,
            "total_credits": 2,
            "items": [{"service_id": service_ids[0], "credits_per_use": 1}],
        }
        rp = api_client.post(f"{BASE_URL}/api/scheduling/subscription-plans", json=plan_payload, headers=auth)
        assert rp.status_code == 200, rp.text
        self.state["plan_id"] = rp.json()["id"]

        # 3) create subscription
        rs = api_client.post(
            f"{BASE_URL}/api/scheduling/subscriptions",
            json={"client_phone": phone, "plan_id": self.state["plan_id"]},
            headers=auth,
        )
        assert rs.status_code == 200, rs.text
        sub = rs.json()
        assert sub["credits_total"] == 2
        assert sub["credits_remaining"] == 2
        assert sub["status"] == "active"
        assert "end_date" in sub
        # end_date ~ now + 30 days
        end_dt = datetime.fromisoformat(sub["end_date"].replace("Z", "+00:00"))
        now = datetime.utcnow()
        delta_days = (end_dt.replace(tzinfo=None) - now).days
        assert 28 <= delta_days <= 31, f"end_date delta {delta_days} not ~30 days"
        self.state["sub_id"] = sub["id"]
        self.state["service_id"] = service_ids[0]

    def test_public_subscription_lookup_active(self, api_client):
        phone = self.state["phone"]
        r = api_client.get(f"{BASE_URL}/api/public/booking/{SLUG}/subscription?phone={phone}")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["has_subscription"] is True
        assert d["status"] == "active"
        assert d["credits_remaining"] == 2
        assert d["credits_total"] == 2
        assert self.state["service_id"] in d.get("service_costs", {})

    def test_public_subscription_lookup_no_sub(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/public/booking/{SLUG}/subscription?phone=119999999999")
        assert r.status_code == 200
        assert r.json().get("has_subscription") is False

    def _get_public_page_data(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/public/booking/{SLUG}/professionals")
        assert r.status_code == 200, r.text
        return {"professionals": r.json()}

    def test_public_book_uses_subscription(self, api_client):
        page = self._get_public_page_data(api_client)
        # Pick a professional that offers this service
        prof_id = None
        profs = page.get("professionals", [])
        for p in profs:
            if not p.get("service_ids") or self.state["service_id"] in p.get("service_ids", []):
                prof_id = p["id"]
                break
        if not prof_id and profs:
            prof_id = profs[0]["id"]
        assert prof_id, "No professional in public page"
        self.state["prof_id"] = prof_id

        # Pick a date ~2 days ahead
        date = (datetime.utcnow() + timedelta(days=2)).strftime("%Y-%m-%d")
        book_payload = {
            "customer_name": f"TEST_iter23_cust_{self.state['phone']}",
            "customer_phone": self.state["phone"],
            "customer_email": "test_iter23@example.com",
            "service_id": self.state["service_id"],
            "professional_id": prof_id,
            "date": date,
            "time": "10:00",
            "use_subscription": True,
        }
        r = api_client.post(
            f"{BASE_URL}/api/public/booking/{SLUG}/book",
            json=book_payload,
        )
        assert r.status_code == 200, r.text
        apt = r.json().get("appointment", {})
        assert apt.get("subscription_applied") is True
        assert apt.get("price") == 0 or apt.get("price") == 0.0
        self.state["apt_ids"] = [apt["id"]]

        # Verify credits decreased
        r2 = api_client.get(f"{BASE_URL}/api/public/booking/{SLUG}/subscription?phone={self.state['phone']}")
        d = r2.json()
        assert d["credits_remaining"] == 1

    def test_public_book_no_subscription(self, api_client, auth):
        """use_subscription=False → price = service.price normal"""
        # Get service price
        rs = api_client.get(f"{BASE_URL}/api/scheduling/services", headers=auth)
        svc = next(s for s in rs.json() if s["id"] == self.state["service_id"])
        svc_price = svc["price"]

        date = (datetime.utcnow() + timedelta(days=3)).strftime("%Y-%m-%d")
        r = api_client.post(
            f"{BASE_URL}/api/public/booking/{SLUG}/book",
            json={
                "customer_name": f"TEST_iter23_cust_noSub",
                "customer_phone": self.state["phone"],
                "service_id": self.state["service_id"],
                "professional_id": self.state["prof_id"],
                "date": date,
                "time": "11:00",
                "use_subscription": False,
            },
        )
        assert r.status_code == 200, r.text
        apt = r.json().get("appointment", {})
        assert apt.get("subscription_applied") is False
        assert apt.get("price") == svc_price
        self.state["apt_ids"].append(apt["id"])

    def test_subscription_expires_when_credits_zero(self, api_client):
        """Consume last credit, sub should become 'expired'."""
        date = (datetime.utcnow() + timedelta(days=4)).strftime("%Y-%m-%d")
        r = api_client.post(
            f"{BASE_URL}/api/public/booking/{SLUG}/book",
            json={
                "customer_name": f"TEST_iter23_cust_last",
                "customer_phone": self.state["phone"],
                "service_id": self.state["service_id"],
                "professional_id": self.state["prof_id"],
                "date": date,
                "time": "12:00",
                "use_subscription": True,
            },
        )
        assert r.status_code == 200, r.text
        apt = r.json().get("appointment", {})
        assert apt.get("subscription_applied") is True
        self.state["apt_ids"].append(apt["id"])

        # Now credits should be 0 and status expired
        r2 = api_client.get(f"{BASE_URL}/api/public/booking/{SLUG}/subscription?phone={self.state['phone']}")
        d = r2.json()
        # has_subscription still true (we keep the record); but status should be 'expired'
        if d.get("has_subscription"):
            assert d["credits_remaining"] == 0
            assert d["status"] == "expired"

    # ======= Admin create appointment should not crash without whatsapp =======
    def test_admin_create_appointment_no_whatsapp(self, api_client, auth):
        date = (datetime.utcnow() + timedelta(days=5)).strftime("%Y-%m-%d")
        r = api_client.post(
            f"{BASE_URL}/api/scheduling/appointments",
            json={
                "customer_name": "TEST_iter23_admin_apt",
                "customer_phone": self.state["phone"],
                "service_id": self.state["service_id"],
                "professional_id": self.state["prof_id"],
                "date": date,
                "time": "14:00",
            },
            headers=auth,
        )
        assert r.status_code == 200, r.text
        apt = r.json()
        # no WA conn -> status remains pendente
        assert apt["status"] == "pendente"
        self.state["apt_ids"].append(apt["id"])

    def test_cleanup(self, api_client, auth):
        # Delete appointments
        for aid in self.state.get("apt_ids", []):
            api_client.delete(f"{BASE_URL}/api/scheduling/appointments/{aid}", headers=auth)
        # Cancel subscription
        if self.state.get("sub_id"):
            api_client.delete(f"{BASE_URL}/api/scheduling/subscriptions/{self.state['sub_id']}", headers=auth)
        # Delete plan
        if self.state.get("plan_id"):
            api_client.delete(f"{BASE_URL}/api/scheduling/subscription-plans/{self.state['plan_id']}", headers=auth)
        # Delete client
        if self.state.get("client_id"):
            api_client.delete(f"{BASE_URL}/api/scheduling/clients/{self.state['client_id']}", headers=auth)
