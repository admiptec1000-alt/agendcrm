"""Iteration 34 — own_appointments_only restriction across professionals/appointments/commissions.

Covers:
  * /scheduling/all-features exposes own_appointments_only (category Permissoes)
  * GET /scheduling/professionals: restricted user sees only own; non-restricted sees all
  * GET /scheduling/appointments: restricted user sees only own; fail-closed when no link
  * GET /reports/commissions: restricted user sees only own; client-supplied
    professional_id pointing to another professional is force-overridden
  * GET /reports/commissions: restricted user without linked professional => empty/zero
  * Admins (company_admin) NEVER restricted (regression)
  * Non-restricted company_user (no own_appointments_only) sees full company data
  * Regression iter33: total_cost / total_profit still in summary
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


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    return r


def _hdr(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def boss_token():
    r = _login(**BOSS)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def boss_h(boss_token):
    return _hdr(boss_token)


# ---------- all-features catalog ----------
class TestAllFeatures:
    def test_own_appointments_only_in_catalog(self, boss_h):
        r = requests.get(f"{API}/scheduling/all-features", headers=boss_h, timeout=20)
        assert r.status_code == 200, r.text
        feats = r.json()
        match = [f for f in feats if f["feature_key"] == "own_appointments_only"]
        assert len(match) == 1
        assert match[0]["category"] == "Permissoes"
        assert "proprios" in match[0]["label"].lower()


# ---------- main isolation suite ----------
class TestOwnAppointmentsOnly:
    @pytest.fixture(scope="class")
    def seed(self, boss_h):
        suf = uuid.uuid4().hex[:6]
        emailA = f"TEST_profA_{suf}@example.com"
        emailUnlinked = f"TEST_profU_{suf}@example.com"  # intentionally NO matching professional
        emailFull = f"TEST_profF_{suf}@example.com"
        password = "TestPwd123"

        # Two professionals — only A is linked (matching email)
        profA = requests.post(
            f"{API}/scheduling/professionals", headers=boss_h,
            json={"name": f"TEST_ProfA_{suf}", "email": emailA, "specialties": []},
            timeout=20,
        ).json()
        requests.put(
            f"{API}/scheduling/professionals/{profA['id']}", headers=boss_h,
            json={"commission_percent": 30.0, "email": emailA}, timeout=20,
        )
        profB = requests.post(
            f"{API}/scheduling/professionals", headers=boss_h,
            json={"name": f"TEST_ProfB_{suf}", "specialties": []},
            timeout=20,
        ).json()
        requests.put(
            f"{API}/scheduling/professionals/{profB['id']}", headers=boss_h,
            json={"commission_percent": 30.0}, timeout=20,
        )

        # Permission profiles
        prof_restricted = requests.post(
            f"{API}/scheduling/permission-profiles", headers=boss_h,
            json={"name": f"TEST_restricted_{suf}",
                  "permissions": ["own_appointments_only", "agenda", "dashboard",
                                  "comissoes", "profissionais"]},
            timeout=20,
        ).json()
        prof_full = requests.post(
            f"{API}/scheduling/permission-profiles", headers=boss_h,
            json={"name": f"TEST_full_{suf}",
                  "permissions": ["agenda", "dashboard", "comissoes", "profissionais"]},
            timeout=20,
        ).json()

        # Company users
        userA = requests.post(
            f"{API}/scheduling/company-users", headers=boss_h,
            json={"name": "TEST UserA", "email": emailA, "password": password,
                  "permission_profile_id": prof_restricted["id"],
                  "professional_id": profA["id"]},
            timeout=20,
        ).json()
        userU = requests.post(
            f"{API}/scheduling/company-users", headers=boss_h,
            json={"name": "TEST UserU", "email": emailUnlinked, "password": password,
                  "permission_profile_id": prof_restricted["id"]},
            timeout=20,
        ).json()
        userF = requests.post(
            f"{API}/scheduling/company-users", headers=boss_h,
            json={"name": "TEST UserF", "email": emailFull, "password": password,
                  "permission_profile_id": prof_full["id"]},
            timeout=20,
        ).json()

        # Service + completed appointments for both profA and profB
        svc = requests.post(
            f"{API}/scheduling/services", headers=boss_h,
            json={"name": f"TEST_svc_{suf}", "duration": 30, "price": 100.0,
                  "type": "service"},
            timeout=20,
        ).json()
        date_str = "2026-08-15"

        def mk_appt(prof_id, time):
            ap = requests.post(
                f"{API}/scheduling/appointments", headers=boss_h,
                json={"customer_name": "TEST_cust", "customer_phone": "11999999999",
                      "service_id": svc["id"], "professional_id": prof_id,
                      "date": date_str, "time": time},
                timeout=20,
            )
            assert ap.status_code == 200, ap.text
            aid = ap.json()["id"]
            requests.put(
                f"{API}/scheduling/appointments/{aid}", headers=boss_h,
                json={"status": "concluido", "price": 100.0}, timeout=20,
            )
            return aid

        appt_A1 = mk_appt(profA["id"], "10:00")
        appt_A2 = mk_appt(profA["id"], "11:00")
        appt_B1 = mk_appt(profB["id"], "12:00")
        appt_B2 = mk_appt(profB["id"], "13:00")
        appt_B3 = mk_appt(profB["id"], "14:00")

        # Login the three users
        tA = _login(emailA, password)
        assert tA.status_code == 200, tA.text
        tU = _login(emailUnlinked, password)
        assert tU.status_code == 200, tU.text
        tF = _login(emailFull, password)
        assert tF.status_code == 200, tF.text

        ctx = {
            "profA": profA, "profB": profB,
            "prof_restricted_id": prof_restricted["id"],
            "prof_full_id": prof_full["id"],
            "userA_id": userA["id"], "userU_id": userU["id"], "userF_id": userF["id"],
            "svc_id": svc["id"],
            "appts_A": [appt_A1, appt_A2], "appts_B": [appt_B1, appt_B2, appt_B3],
            "date": date_str,
            "tokenA": tA.json()["access_token"],
            "tokenU": tU.json()["access_token"],
            "tokenF": tF.json()["access_token"],
            "userA_resp": tA.json().get("user", {}),
        }
        yield ctx

        # --- cleanup ---
        for aid in ctx["appts_A"] + ctx["appts_B"]:
            requests.delete(f"{API}/scheduling/appointments/{aid}", headers=boss_h, timeout=20)
        requests.delete(f"{API}/scheduling/services/{svc['id']}", headers=boss_h, timeout=20)
        for uid in (userA["id"], userU["id"], userF["id"]):
            requests.delete(f"{API}/scheduling/company-users/{uid}", headers=boss_h, timeout=20)
        for pid in (prof_restricted["id"], prof_full["id"]):
            requests.delete(f"{API}/scheduling/permission-profiles/{pid}", headers=boss_h, timeout=20)
        for pid in (profA["id"], profB["id"]):
            requests.delete(f"{API}/scheduling/professionals/{pid}", headers=boss_h, timeout=20)

    # --- login bundle assertion ---
    def test_login_attaches_perms_to_restricted_user(self, seed):
        u = seed["userA_resp"]
        perms = u.get("permissions") or []
        assert "own_appointments_only" in perms
        assert u.get("role") == "user"

    # --- /scheduling/professionals ---
    def test_professionals_restricted_user_sees_only_self(self, seed):
        r = requests.get(f"{API}/scheduling/professionals", headers=_hdr(seed["tokenA"]), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        ids = [p["id"] for p in data]
        assert ids == [seed["profA"]["id"]], f"Expected only profA, got {ids}"

    def test_professionals_unlinked_restricted_user_sees_empty(self, seed):
        r = requests.get(f"{API}/scheduling/professionals", headers=_hdr(seed["tokenU"]), timeout=20)
        assert r.status_code == 200
        assert r.json() == []

    def test_professionals_full_user_sees_all(self, seed):
        r = requests.get(f"{API}/scheduling/professionals", headers=_hdr(seed["tokenF"]), timeout=20)
        assert r.status_code == 200
        ids = {p["id"] for p in r.json()}
        assert seed["profA"]["id"] in ids
        assert seed["profB"]["id"] in ids

    def test_professionals_admin_sees_all(self, seed, boss_h):
        r = requests.get(f"{API}/scheduling/professionals", headers=boss_h, timeout=20)
        assert r.status_code == 200
        ids = {p["id"] for p in r.json()}
        assert seed["profA"]["id"] in ids and seed["profB"]["id"] in ids

    # --- /scheduling/appointments ---
    def test_appointments_restricted_user_sees_only_own(self, seed):
        r = requests.get(f"{API}/scheduling/appointments",
                         headers=_hdr(seed["tokenA"]), params={"date": seed["date"]}, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert all(a["professional_id"] == seed["profA"]["id"] for a in data)
        assert len(data) == 2

    def test_appointments_restricted_user_cannot_query_other(self, seed):
        # Try to bypass by passing professional_id of profB
        r = requests.get(
            f"{API}/scheduling/appointments", headers=_hdr(seed["tokenA"]),
            params={"date": seed["date"], "professional_id": seed["profB"]["id"]}, timeout=20,
        )
        assert r.status_code == 200
        # server force-overrides: result must be empty (none of profA's appts match profB filter)
        # Implementation overrides query["professional_id"] = my_prof_id, so any
        # other id passed by the client is ignored entirely.
        data = r.json()
        assert all(a["professional_id"] == seed["profA"]["id"] for a in data)

    def test_appointments_unlinked_restricted_user_empty(self, seed):
        r = requests.get(f"{API}/scheduling/appointments",
                         headers=_hdr(seed["tokenU"]), timeout=20)
        assert r.status_code == 200
        assert r.json() == []

    def test_appointments_full_user_sees_all(self, seed):
        r = requests.get(f"{API}/scheduling/appointments",
                         headers=_hdr(seed["tokenF"]), params={"date": seed["date"]}, timeout=20)
        assert r.status_code == 200
        data = r.json()
        ids = {a["professional_id"] for a in data}
        assert seed["profA"]["id"] in ids
        assert seed["profB"]["id"] in ids

    def test_appointments_admin_sees_all(self, seed, boss_h):
        r = requests.get(f"{API}/scheduling/appointments", headers=boss_h,
                         params={"date": seed["date"]}, timeout=20)
        assert r.status_code == 200
        data = r.json()
        prof_ids = {a["professional_id"] for a in data}
        assert seed["profA"]["id"] in prof_ids and seed["profB"]["id"] in prof_ids

    # --- /reports/commissions ---
    def _commissions(self, token, **params):
        params.setdefault("start_date", "2026-01-01")
        params.setdefault("end_date", "2026-12-31")
        return requests.get(f"{API}/reports/commissions",
                            headers=_hdr(token), params=params, timeout=20)

    def test_commissions_restricted_user_sees_only_own(self, seed):
        r = self._commissions(seed["tokenA"])
        assert r.status_code == 200, r.text
        body = r.json()
        # only profA's 2 appts at 100 each
        assert body["summary"]["total_appointments"] == 2
        assert abs(body["summary"]["total_revenue"] - 200.0) < 0.01
        assert abs(body["summary"]["total_commission"] - 60.0) < 0.01  # 200*30%
        assert len(body["report"]) == 1
        assert body["report"][0]["professional_id"] == seed["profA"]["id"]

    def test_commissions_force_override_other_professional_id(self, seed):
        # Client passes profB id — server must override with profA
        r = self._commissions(seed["tokenA"], professional_id=seed["profB"]["id"])
        assert r.status_code == 200
        body = r.json()
        assert body["summary"]["total_appointments"] == 2  # still profA's data
        assert abs(body["summary"]["total_revenue"] - 200.0) < 0.01
        if body["report"]:
            assert body["report"][0]["professional_id"] == seed["profA"]["id"]

    def test_commissions_unlinked_restricted_user_fail_closed(self, seed):
        r = self._commissions(seed["tokenU"])
        assert r.status_code == 200
        body = r.json()
        assert body["report"] == []
        assert body["breakdown"] == []
        s = body["summary"]
        assert s["total_revenue"] == 0
        assert s["total_commission"] == 0
        assert s["total_appointments"] == 0
        # iter33 regression: total_cost / total_profit still present
        assert "total_cost" in s
        assert "total_profit" in s
        assert s["total_cost"] == 0
        assert s["total_profit"] == 0

    def test_commissions_full_user_sees_all(self, seed):
        # Filter by seed service_id to isolate from other company data
        r = self._commissions(seed["tokenF"], service_id=seed["svc_id"])
        assert r.status_code == 200
        body = r.json()
        # both A (2 appts) and B (3 appts) included = 5 appts total revenue 500
        assert body["summary"]["total_appointments"] == 5
        assert abs(body["summary"]["total_revenue"] - 500.0) < 0.01
        prof_ids = {row["professional_id"] for row in body["report"]}
        assert seed["profA"]["id"] in prof_ids
        assert seed["profB"]["id"] in prof_ids

    def test_commissions_admin_sees_all(self, seed, boss_h):
        r = requests.get(f"{API}/reports/commissions", headers=boss_h,
                         params={"start_date": "2026-01-01", "end_date": "2026-12-31"}, timeout=20)
        assert r.status_code == 200
        body = r.json()
        prof_ids = {row["professional_id"] for row in body["report"]}
        assert seed["profA"]["id"] in prof_ids
        assert seed["profB"]["id"] in prof_ids

    def test_commissions_admin_with_explicit_profA_filter_works(self, seed, boss_h):
        # Admins are NOT force-overridden — explicit filter must work
        r = requests.get(f"{API}/reports/commissions", headers=boss_h,
                         params={"start_date": "2026-01-01", "end_date": "2026-12-31",
                                 "professional_id": seed["profA"]["id"]}, timeout=20)
        assert r.status_code == 200
        body = r.json()
        if body["report"]:
            for row in body["report"]:
                assert row["professional_id"] == seed["profA"]["id"]

    # --- iter33 regression on summary keys ---
    def test_iter33_summary_keys_preserved(self, seed):
        r = self._commissions(seed["tokenF"])
        body = r.json()
        s = body["summary"]
        for k in ("total_revenue", "total_cost", "total_profit",
                  "total_commission", "total_appointments"):
            assert k in s, f"missing summary key: {k}"
