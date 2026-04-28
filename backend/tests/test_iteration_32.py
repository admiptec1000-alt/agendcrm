"""Iteration 32 — Service-level commission_percent + commissions report filters.

Covers:
  * Service model accepts optional `commission_percent`
  * POST/PUT/GET /api/scheduling/services persists the field
  * GET /api/reports/commissions returns {report, breakdown, summary}
  * Filters: start_date/end_date, professional_id, service_type, service_id
  * Calculation precedence: service.commission_percent overrides professional
  * breakdown fields and ordering by revenue desc
  * Regression: ticket_number sequential, mobile_bottom_nav resync
"""
import os
import uuid
import pytest
import requests

def _resolve_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    # fallback: parse frontend/.env (file is the source of truth in this repo)
    env_path = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", ".env")
    with open(env_path) as fh:
        for line in fh:
            if line.startswith("REACT_APP_BACKEND_URL"):
                return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not configured")


BASE_URL = _resolve_backend_url()
API = f"{BASE_URL}/api"

BOSS = {"email": "admin@boss.com.br", "password": "boss123"}
CRM = {"email": "crm@test.com", "password": "crm123"}
SUPER = {"email": "admin@agentcrm.com", "password": "admin123"}


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def boss_token():
    r = requests.post(f"{API}/auth/login", json=BOSS, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def boss_headers(boss_token):
    return {"Authorization": f"Bearer {boss_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def crm_token():
    r = requests.post(f"{API}/auth/login", json=CRM, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def crm_headers(crm_token):
    return {"Authorization": f"Bearer {crm_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def super_token():
    r = requests.post(f"{API}/auth/super-admin/login", json=SUPER, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def super_headers(super_token):
    return {"Authorization": f"Bearer {super_token}", "Content-Type": "application/json"}


# ---------- service.commission_percent persistence ----------
class TestServiceCommissionPercent:
    def test_create_service_with_commission(self, boss_headers):
        payload = {
            "name": f"TEST_svc_{uuid.uuid4().hex[:6]}",
            "duration": 30,
            "price": 100.0,
            "type": "service",
            "commission_percent": 50.0,
        }
        r = requests.post(f"{API}/scheduling/services", headers=boss_headers, json=payload, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["commission_percent"] == 50.0
        assert data["name"] == payload["name"]
        # GET back
        g = requests.get(f"{API}/scheduling/services", headers=boss_headers, timeout=20)
        assert g.status_code == 200
        match = next((s for s in g.json() if s["id"] == data["id"]), None)
        assert match is not None
        assert match["commission_percent"] == 50.0
        # cleanup
        requests.delete(f"{API}/scheduling/services/{data['id']}", headers=boss_headers, timeout=20)

    def test_create_service_without_commission_is_none(self, boss_headers):
        payload = {
            "name": f"TEST_svc_{uuid.uuid4().hex[:6]}",
            "duration": 30,
            "price": 80.0,
            "type": "service",
        }
        r = requests.post(f"{API}/scheduling/services", headers=boss_headers, json=payload, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("commission_percent") is None
        requests.delete(f"{API}/scheduling/services/{data['id']}", headers=boss_headers, timeout=20)

    def test_update_service_commission(self, boss_headers):
        payload = {"name": f"TEST_svc_{uuid.uuid4().hex[:6]}", "duration": 30, "price": 100.0, "type": "service"}
        r = requests.post(f"{API}/scheduling/services", headers=boss_headers, json=payload, timeout=20)
        assert r.status_code == 200
        sid = r.json()["id"]
        u = requests.put(
            f"{API}/scheduling/services/{sid}",
            headers=boss_headers,
            json={"commission_percent": 25.5},
            timeout=20,
        )
        assert u.status_code == 200, u.text
        assert u.json()["commission_percent"] == 25.5
        # GET to verify persistence
        g = requests.get(f"{API}/scheduling/services", headers=boss_headers, timeout=20)
        match = next(s for s in g.json() if s["id"] == sid)
        assert match["commission_percent"] == 25.5
        requests.delete(f"{API}/scheduling/services/{sid}", headers=boss_headers, timeout=20)


# ---------- commissions report filters & calculation ----------
class TestCommissionsReport:
    """End-to-end: create prof + service + completed appointment, then assert report."""

    @pytest.fixture(scope="class")
    def seed(self, boss_headers):
        # professional with 30%
        prof_payload = {
            "name": f"TEST_prof_{uuid.uuid4().hex[:6]}",
            "specialties": [],
        }
        r = requests.post(f"{API}/scheduling/professionals", headers=boss_headers, json=prof_payload, timeout=20)
        assert r.status_code == 200, r.text
        prof = r.json()
        # set commission to 30%
        u = requests.put(
            f"{API}/scheduling/professionals/{prof['id']}",
            headers=boss_headers,
            json={"commission_percent": 30.0},
            timeout=20,
        )
        assert u.status_code == 200

        # Service A with own 50% commission, R$100
        svcA = requests.post(
            f"{API}/scheduling/services",
            headers=boss_headers,
            json={"name": f"TEST_svcA_{uuid.uuid4().hex[:6]}", "duration": 30, "price": 100.0,
                  "type": "service", "commission_percent": 50.0},
            timeout=20,
        ).json()
        # Service B without commission_percent (should fallback to professional 30%), R$100
        svcB = requests.post(
            f"{API}/scheduling/services",
            headers=boss_headers,
            json={"name": f"TEST_svcB_{uuid.uuid4().hex[:6]}", "duration": 30, "price": 100.0,
                  "type": "service"},
            timeout=20,
        ).json()
        # Product with own commission 10%, R$50, type=product
        prod = requests.post(
            f"{API}/scheduling/services",
            headers=boss_headers,
            json={"name": f"TEST_prod_{uuid.uuid4().hex[:6]}", "duration": 0, "price": 50.0,
                  "type": "product", "commission_percent": 10.0},
            timeout=20,
        ).json()

        date_str = "2026-06-15"

        def mk_appt(svc_id, price):
            ap = requests.post(
                f"{API}/scheduling/appointments",
                headers=boss_headers,
                json={
                    "customer_name": "TEST_customer",
                    "customer_phone": "11999999999",
                    "service_id": svc_id,
                    "professional_id": prof["id"],
                    "date": date_str,
                    "time": "10:00",
                },
                timeout=20,
            )
            assert ap.status_code == 200, ap.text
            aid = ap.json()["id"]
            up = requests.put(
                f"{API}/scheduling/appointments/{aid}",
                headers=boss_headers,
                json={"status": "concluido", "price": price},
                timeout=20,
            )
            assert up.status_code == 200, up.text
            return aid

        a_id = mk_appt(svcA["id"], 100.0)
        b_id = mk_appt(svcB["id"], 100.0)
        p_id = mk_appt(prod["id"], 50.0)

        yield {
            "prof": prof, "svcA": svcA, "svcB": svcB, "prod": prod,
            "appt_a": a_id, "appt_b": b_id, "appt_p": p_id, "date": date_str,
        }

        # Cleanup
        for aid in (a_id, b_id, p_id):
            requests.delete(f"{API}/scheduling/appointments/{aid}", headers=boss_headers, timeout=20)
        for s in (svcA, svcB, prod):
            requests.delete(f"{API}/scheduling/services/{s['id']}", headers=boss_headers, timeout=20)
        requests.delete(f"{API}/scheduling/professionals/{prof['id']}", headers=boss_headers, timeout=20)

    def test_report_no_filters_shape(self, boss_headers, seed):
        r = requests.get(f"{API}/reports/commissions", headers=boss_headers, timeout=20)
        assert r.status_code == 200
        body = r.json()
        assert set(body.keys()) >= {"report", "breakdown", "summary"}
        assert isinstance(body["report"], list)
        assert isinstance(body["breakdown"], list)
        assert isinstance(body["summary"], dict)
        for k in ("total_revenue", "total_commission", "total_appointments", "avg_ticket"):
            assert k in body["summary"]

    def test_report_period_filter(self, boss_headers, seed):
        r = requests.get(
            f"{API}/reports/commissions",
            headers=boss_headers,
            params={"start_date": "2026-01-01", "end_date": "2026-12-31"},
            timeout=20,
        )
        assert r.status_code == 200
        body = r.json()
        # our 3 seed appointments are inside the range
        assert body["summary"]["total_appointments"] >= 3

        r2 = requests.get(
            f"{API}/reports/commissions",
            headers=boss_headers,
            params={"start_date": "2030-01-01", "end_date": "2030-12-31"},
            timeout=20,
        )
        assert r2.status_code == 200
        assert r2.json()["summary"]["total_appointments"] == 0

    def test_report_professional_filter(self, boss_headers, seed):
        prof_id = seed["prof"]["id"]
        r = requests.get(
            f"{API}/reports/commissions",
            headers=boss_headers,
            params={"professional_id": prof_id, "start_date": "2026-01-01", "end_date": "2026-12-31"},
            timeout=20,
        )
        assert r.status_code == 200
        body = r.json()
        assert len(body["report"]) == 1
        assert body["report"][0]["professional_id"] == prof_id
        assert body["report"][0]["appointments_count"] == 3

    def test_report_service_type_filter(self, boss_headers, seed):
        r = requests.get(
            f"{API}/reports/commissions",
            headers=boss_headers,
            params={"service_type": "product", "start_date": "2026-01-01", "end_date": "2026-12-31",
                    "professional_id": seed["prof"]["id"]},
            timeout=20,
        )
        assert r.status_code == 200
        body = r.json()
        # Only 1 product appointment R$50 with 10% = R$5
        assert body["summary"]["total_appointments"] == 1
        assert body["summary"]["total_revenue"] == 50.0
        assert abs(body["summary"]["total_commission"] - 5.0) < 0.01
        assert all(b["service_type"] == "product" for b in body["breakdown"] if b.get("service_id"))

    def test_report_service_id_filter(self, boss_headers, seed):
        sid = seed["svcA"]["id"]
        r = requests.get(
            f"{API}/reports/commissions",
            headers=boss_headers,
            params={"service_id": sid, "start_date": "2026-01-01", "end_date": "2026-12-31",
                    "professional_id": seed["prof"]["id"]},
            timeout=20,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["summary"]["total_appointments"] == 1
        assert body["summary"]["total_revenue"] == 100.0
        # svcA has its own 50% -> R$50
        assert abs(body["summary"]["total_commission"] - 50.0) < 0.01

    def test_report_calculation_service_overrides_professional(self, boss_headers, seed):
        """svcA: prof=30%, service=50%, R$100 -> R$50 commission."""
        r = requests.get(
            f"{API}/reports/commissions",
            headers=boss_headers,
            params={"service_id": seed["svcA"]["id"], "professional_id": seed["prof"]["id"],
                    "start_date": "2026-01-01", "end_date": "2026-12-31"},
            timeout=20,
        )
        assert r.status_code == 200
        body = r.json()
        assert abs(body["summary"]["total_commission"] - 50.0) < 0.01

    def test_report_calculation_falls_back_to_professional(self, boss_headers, seed):
        """svcB: prof=30%, service=None, R$100 -> R$30 commission."""
        r = requests.get(
            f"{API}/reports/commissions",
            headers=boss_headers,
            params={"service_id": seed["svcB"]["id"], "professional_id": seed["prof"]["id"],
                    "start_date": "2026-01-01", "end_date": "2026-12-31"},
            timeout=20,
        )
        assert r.status_code == 200
        body = r.json()
        assert abs(body["summary"]["total_commission"] - 30.0) < 0.01

    def test_breakdown_fields_and_order(self, boss_headers, seed):
        r = requests.get(
            f"{API}/reports/commissions",
            headers=boss_headers,
            params={"professional_id": seed["prof"]["id"],
                    "start_date": "2026-01-01", "end_date": "2026-12-31"},
            timeout=20,
        )
        assert r.status_code == 200
        bd = r.json()["breakdown"]
        assert len(bd) >= 3
        required = {"service_id", "service_name", "service_type", "quantity",
                    "revenue", "commission", "commission_percent"}
        for entry in bd:
            assert required.issubset(entry.keys())
        revenues = [e["revenue"] for e in bd]
        assert revenues == sorted(revenues, reverse=True)


# ---------- regression iter29/30/31 ----------
class TestRegression:
    def test_ticket_number_sequential(self, crm_headers):
        nums = []
        ids = []
        for _ in range(2):
            r = requests.post(
                f"{API}/crm/tickets",
                headers=crm_headers,
                json={"customer_name": "TEST_reg", "customer_phone": "11999999999"},
                timeout=20,
            )
            assert r.status_code in (200, 201), r.text
            data = r.json()
            assert "ticket_number" in data
            nums.append(data["ticket_number"])
            ids.append(data["id"])
        assert nums[1] > nums[0]
        for tid in ids:
            requests.delete(f"{API}/crm/tickets/{tid}", headers=crm_headers, timeout=20)

    def test_mobile_bottom_nav_present_on_company(self, super_headers):
        r = requests.get(f"{API}/super-admin/companies", headers=super_headers, timeout=20)
        assert r.status_code == 200
        companies = r.json()
        assert isinstance(companies, list) and companies
        # At least one company should expose mobile_bottom_nav (may be empty list)
        assert any("mobile_bottom_nav" in c for c in companies)

    def test_resync_features_endpoint_alive(self, super_headers):
        r = requests.get(f"{API}/super-admin/companies", headers=super_headers, timeout=20)
        assert r.status_code == 200
        cid = r.json()[0]["id"]
        rr = requests.post(
            f"{API}/super-admin/companies/{cid}/resync-features",
            headers=super_headers,
            timeout=20,
        )
        assert rr.status_code in (200, 201, 204), rr.text
