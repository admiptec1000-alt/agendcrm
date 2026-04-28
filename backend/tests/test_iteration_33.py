"""Iteration 33 — Service `cost` field + commission on profit (price - cost).

Covers:
  * Service model accepts optional `cost` (POST/PUT/GET persistence)
  * GET /api/reports/commissions: commission = max(price-cost, 0) * pct / 100
  * cost None or 0 => fallback to old behaviour (commission on revenue)
  * cost > price => profit=0 => commission=0 (never negative)
  * Summary exposes total_cost / total_profit
  * report has cost/profit per professional; breakdown has cost/profit/unit_cost
  * service-level commission_percent override still wins
  * Filters (start_date, end_date, professional_id, service_type, service_id) preserved
  * Regression iter32 + iter29 (ticket_number sequential)
"""
import os
import uuid
import pytest
import requests


def _resolve_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
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


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def boss_headers():
    r = requests.post(f"{API}/auth/login", json=BOSS, timeout=20)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def crm_headers():
    r = requests.post(f"{API}/auth/login", json=CRM, timeout=20)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}", "Content-Type": "application/json"}


# ---------- Service.cost persistence ----------
class TestServiceCostPersistence:
    def test_create_service_with_cost(self, boss_headers):
        payload = {
            "name": f"TEST_svc_{uuid.uuid4().hex[:6]}",
            "duration": 30,
            "price": 100.0,
            "cost": 40.0,
            "type": "service",
            "commission_percent": 50.0,
        }
        r = requests.post(f"{API}/scheduling/services", headers=boss_headers, json=payload, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["cost"] == 40.0
        assert data["price"] == 100.0
        sid = data["id"]
        # GET back
        g = requests.get(f"{API}/scheduling/services", headers=boss_headers, timeout=20)
        match = next((s for s in g.json() if s["id"] == sid), None)
        assert match is not None
        assert match["cost"] == 40.0
        # cleanup
        requests.delete(f"{API}/scheduling/services/{sid}", headers=boss_headers, timeout=20)

    def test_create_service_without_cost_is_none(self, boss_headers):
        payload = {
            "name": f"TEST_svc_{uuid.uuid4().hex[:6]}",
            "duration": 30,
            "price": 80.0,
            "type": "service",
        }
        r = requests.post(f"{API}/scheduling/services", headers=boss_headers, json=payload, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("cost") is None
        requests.delete(f"{API}/scheduling/services/{data['id']}", headers=boss_headers, timeout=20)

    def test_update_service_cost(self, boss_headers):
        payload = {"name": f"TEST_svc_{uuid.uuid4().hex[:6]}", "duration": 30, "price": 100.0, "type": "service"}
        r = requests.post(f"{API}/scheduling/services", headers=boss_headers, json=payload, timeout=20)
        sid = r.json()["id"]
        u = requests.put(
            f"{API}/scheduling/services/{sid}",
            headers=boss_headers,
            json={"cost": 25.0},
            timeout=20,
        )
        assert u.status_code == 200, u.text
        assert u.json()["cost"] == 25.0
        # verify persistence
        g = requests.get(f"{API}/scheduling/services", headers=boss_headers, timeout=20)
        match = next(s for s in g.json() if s["id"] == sid)
        assert match["cost"] == 25.0
        requests.delete(f"{API}/scheduling/services/{sid}", headers=boss_headers, timeout=20)


# ---------- Commission-on-profit calculation ----------
class TestCommissionOnProfit:
    """Seed: 1 prof @30%, multiple services with different cost / pct combos.

    Scenarios verified via service_id filter to isolate each appointment:
      A: price=100, cost=50, svc_pct=40 -> profit=50, commission=20
      B: price=100, cost=0  (None), svc_pct=None, prof=30% -> commission=30 (revenue)
      C: price=100, cost=120, svc_pct=50 -> profit=0, commission=0
      D: price=200, cost=50, svc_pct=60, prof=30% -> profit=150, commission=90 (override)
      E: price=80, cost=0 (explicit zero), prof=30% -> commission=24 (revenue, not profit)
    """

    @pytest.fixture(scope="class")
    def seed(self, boss_headers):
        prof = requests.post(
            f"{API}/scheduling/professionals",
            headers=boss_headers,
            json={"name": f"TEST_prof_{uuid.uuid4().hex[:6]}", "specialties": []},
            timeout=20,
        ).json()
        requests.put(
            f"{API}/scheduling/professionals/{prof['id']}",
            headers=boss_headers,
            json={"commission_percent": 30.0},
            timeout=20,
        )

        def mk_svc(price, cost, pct, type_="service"):
            body = {"name": f"TEST_svc_{uuid.uuid4().hex[:6]}", "duration": 30,
                    "price": price, "type": type_}
            if cost is not None:
                body["cost"] = cost
            if pct is not None:
                body["commission_percent"] = pct
            r = requests.post(f"{API}/scheduling/services", headers=boss_headers, json=body, timeout=20)
            assert r.status_code == 200, r.text
            return r.json()

        svcA = mk_svc(100.0, 50.0, 40.0)
        svcB = mk_svc(100.0, None, None)
        svcC = mk_svc(100.0, 120.0, 50.0)
        svcD = mk_svc(200.0, 50.0, 60.0)
        svcE = mk_svc(80.0, 0.0, None)

        date_str = "2026-07-15"

        def mk_appt(svc, price):
            ap = requests.post(
                f"{API}/scheduling/appointments",
                headers=boss_headers,
                json={"customer_name": "TEST_customer", "customer_phone": "11999999999",
                      "service_id": svc["id"], "professional_id": prof["id"],
                      "date": date_str, "time": "10:00"},
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
            assert up.status_code == 200
            return aid

        appts = {
            "A": mk_appt(svcA, 100.0),
            "B": mk_appt(svcB, 100.0),
            "C": mk_appt(svcC, 100.0),
            "D": mk_appt(svcD, 200.0),
            "E": mk_appt(svcE, 80.0),
        }
        yield {"prof": prof, "svcA": svcA, "svcB": svcB, "svcC": svcC,
               "svcD": svcD, "svcE": svcE, "appts": appts, "date": date_str}
        for aid in appts.values():
            requests.delete(f"{API}/scheduling/appointments/{aid}", headers=boss_headers, timeout=20)
        for s in (svcA, svcB, svcC, svcD, svcE):
            requests.delete(f"{API}/scheduling/services/{s['id']}", headers=boss_headers, timeout=20)
        requests.delete(f"{API}/scheduling/professionals/{prof['id']}", headers=boss_headers, timeout=20)

    def _query(self, headers, **params):
        params.setdefault("start_date", "2026-01-01")
        params.setdefault("end_date", "2026-12-31")
        r = requests.get(f"{API}/reports/commissions", headers=headers, params=params, timeout=20)
        assert r.status_code == 200, r.text
        return r.json()

    # --- summary new fields ---
    def test_summary_has_total_cost_and_profit(self, boss_headers, seed):
        body = self._query(boss_headers, professional_id=seed["prof"]["id"])
        s = body["summary"]
        assert "total_cost" in s
        assert "total_profit" in s
        assert "total_revenue" in s and "total_commission" in s
        # total_cost = 50+0+120+50+0 = 220
        assert abs(s["total_cost"] - 220.0) < 0.01
        # total_revenue = 100+100+100+200+80 = 580
        assert abs(s["total_revenue"] - 580.0) < 0.01
        # total_profit = max(price-cost,0) per appt = 50+100+0+150+80 = 380
        assert abs(s["total_profit"] - 380.0) < 0.01
        # total_commission = 20+30+0+90+24 = 164
        assert abs(s["total_commission"] - 164.0) < 0.01

    # --- per-scenario assertions via service_id filter ---
    def test_scenario_A_profit_basis(self, boss_headers, seed):
        body = self._query(boss_headers, professional_id=seed["prof"]["id"], service_id=seed["svcA"]["id"])
        s = body["summary"]
        assert abs(s["total_revenue"] - 100.0) < 0.01
        assert abs(s["total_cost"] - 50.0) < 0.01
        assert abs(s["total_profit"] - 50.0) < 0.01
        assert abs(s["total_commission"] - 20.0) < 0.01  # 50 * 0.40

    def test_scenario_B_cost_none_uses_revenue(self, boss_headers, seed):
        body = self._query(boss_headers, professional_id=seed["prof"]["id"], service_id=seed["svcB"]["id"])
        s = body["summary"]
        # cost=None => profit = price - 0 = 100; commission = 100 * 0.30 = 30
        assert abs(s["total_cost"] - 0.0) < 0.01
        assert abs(s["total_profit"] - 100.0) < 0.01
        assert abs(s["total_commission"] - 30.0) < 0.01

    def test_scenario_C_cost_gt_price_zero_commission(self, boss_headers, seed):
        body = self._query(boss_headers, professional_id=seed["prof"]["id"], service_id=seed["svcC"]["id"])
        s = body["summary"]
        # profit clamped to 0
        assert abs(s["total_profit"] - 0.0) < 0.01
        assert abs(s["total_commission"] - 0.0) < 0.01

    def test_scenario_D_service_pct_overrides_professional(self, boss_headers, seed):
        body = self._query(boss_headers, professional_id=seed["prof"]["id"], service_id=seed["svcD"]["id"])
        s = body["summary"]
        # profit = 200-50 = 150 ; svc pct 60 -> 90
        assert abs(s["total_profit"] - 150.0) < 0.01
        assert abs(s["total_commission"] - 90.0) < 0.01

    def test_scenario_E_cost_zero_uses_revenue(self, boss_headers, seed):
        body = self._query(boss_headers, professional_id=seed["prof"]["id"], service_id=seed["svcE"]["id"])
        s = body["summary"]
        # cost=0 fallback => commission on revenue 80 * 0.30 = 24
        assert abs(s["total_commission"] - 24.0) < 0.01

    # --- report (per professional) and breakdown shapes ---
    def test_report_has_cost_and_profit_per_professional(self, boss_headers, seed):
        body = self._query(boss_headers, professional_id=seed["prof"]["id"])
        assert len(body["report"]) == 1
        row = body["report"][0]
        assert "cost" in row and "profit" in row
        assert abs(row["cost"] - 220.0) < 0.01
        assert abs(row["profit"] - 380.0) < 0.01
        assert abs(row["commission_value"] - 164.0) < 0.01

    def test_breakdown_has_cost_profit_unit_cost(self, boss_headers, seed):
        body = self._query(boss_headers, professional_id=seed["prof"]["id"])
        bd = body["breakdown"]
        assert len(bd) >= 5
        required = {"service_id", "service_name", "service_type", "quantity",
                    "revenue", "commission", "cost", "profit", "unit_cost"}
        for entry in bd:
            assert required.issubset(entry.keys()), f"missing keys in {entry}"
        # find svcA breakdown row
        a = next(b for b in bd if b["service_id"] == seed["svcA"]["id"])
        assert abs(a["cost"] - 50.0) < 0.01
        assert abs(a["profit"] - 50.0) < 0.01
        assert abs(a["unit_cost"] - 50.0) < 0.01
        assert abs(a["commission"] - 20.0) < 0.01
        # ordering by revenue desc
        revenues = [e["revenue"] for e in bd]
        assert revenues == sorted(revenues, reverse=True)

    # --- filters preserved ---
    def test_filter_period(self, boss_headers, seed):
        body = self._query(boss_headers, professional_id=seed["prof"]["id"],
                           start_date="2030-01-01", end_date="2030-12-31")
        assert body["summary"]["total_appointments"] == 0

    def test_filter_service_type_service(self, boss_headers, seed):
        body = self._query(boss_headers, professional_id=seed["prof"]["id"], service_type="service")
        # All seed items are services -> 5
        assert body["summary"]["total_appointments"] == 5

    def test_filter_service_type_product_empty(self, boss_headers, seed):
        body = self._query(boss_headers, professional_id=seed["prof"]["id"], service_type="product")
        assert body["summary"]["total_appointments"] == 0


# ---------- Regression iter29 ----------
class TestRegression:
    def test_ticket_number_sequential(self, crm_headers):
        nums, ids = [], []
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

    def test_iter32_service_commission_persists(self, boss_headers):
        payload = {"name": f"TEST_svc_{uuid.uuid4().hex[:6]}", "duration": 30,
                   "price": 100.0, "type": "service", "commission_percent": 50.0,
                   "cost": 30.0}
        r = requests.post(f"{API}/scheduling/services", headers=boss_headers, json=payload, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert data["commission_percent"] == 50.0
        assert data["cost"] == 30.0
        requests.delete(f"{API}/scheduling/services/{data['id']}", headers=boss_headers, timeout=20)
