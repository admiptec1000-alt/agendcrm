"""
Iteration 54 — Licenses feature backend regression tests.

Coverage (per review request):
  • Licenses CRUD (POST/GET/PUT/DELETE /super-admin/licenses)
  • Validation: connections_qty=0 AND users_qty=0 -> 400
  • GET include_inactive=true returns deactivated rows
  • DELETE: hard-delete if free; soft-deactivate if referenced
  • Company create/update with licenses[] recalculates max_*/total_*/sale
  • licenses=[] in UPDATE -> max_* become null (legacy mode)
  • GET /super-admin/licenses/usage/{company_id}
  • Enforcement: connections (max=1) -> 2nd POST returns 403
  • Enforcement: users (max=1) -> 2nd POST returns 403
  • Enforcement: legacy max=None passes through
  • AdmTxn kind=licenca persists company_id + license_* snapshot
  • AdmTxn kind=diversos works without company_id
  • AdmTxn GET filters kind/company_id
"""
import os
import uuid
import pytest
import requests


def _load_url():
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL"):
                return line.split("=", 1)[1].strip()
    raise RuntimeError("REACT_APP_BACKEND_URL not configured")


BASE = _load_url().rstrip("/")
API = f"{BASE}/api"


# ── Auth ────────────────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def sa_headers():
    r = requests.post(
        f"{API}/auth/super-admin/login",
        json={"email": "admin@agentcrm.com", "password": "admin123"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# ── Helpers ────────────────────────────────────────────────────────────────
def _suffix() -> str:
    return uuid.uuid4().hex[:8]


@pytest.fixture(scope="module")
def created_resources():
    """Tracks ids of stuff created so we can clean up at the end."""
    return {"licenses": [], "companies": [], "txns": []}


@pytest.fixture(scope="module", autouse=True)
def _cleanup(sa_headers, created_resources):
    yield
    # Teardown — best-effort
    for txn_id in created_resources["txns"]:
        try:
            requests.delete(f"{API}/super-admin/finance/transactions/{txn_id}", headers=sa_headers, timeout=10)
        except Exception:
            pass
    for cid in created_resources["companies"]:
        try:
            requests.delete(f"{API}/super-admin/companies/{cid}", headers=sa_headers, timeout=10)
        except Exception:
            pass
    for lid in created_resources["licenses"]:
        try:
            requests.delete(f"{API}/super-admin/licenses/{lid}", headers=sa_headers, timeout=10)
        except Exception:
            pass


# ── 1) Licenses CRUD ────────────────────────────────────────────────────────
class TestLicensesCRUD:
    def test_create_unitary_license(self, sa_headers, created_resources):
        body = {
            "name": f"TEST_Unit_Conn_{_suffix()}",
            "description": "1 conexão",
            "connections_qty": 1,
            "users_qty": 0,
            "cost": 30.0,
            "sale_price": 99.90,
        }
        r = requests.post(f"{API}/super-admin/licenses", json=body, headers=sa_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["name"] == body["name"]
        assert data["connections_qty"] == 1
        assert data["users_qty"] == 0
        assert data["cost"] == 30.0
        assert data["sale_price"] == 99.90
        assert data["is_active"] is True
        assert "id" in data
        created_resources["licenses"].append(data["id"])

    def test_create_package_license(self, sa_headers, created_resources):
        body = {
            "name": f"TEST_Pkg_{_suffix()}",
            "connections_qty": 10,
            "users_qty": 5,
            "cost": 150.0,
            "sale_price": 499.0,
        }
        r = requests.post(f"{API}/super-admin/licenses", json=body, headers=sa_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["connections_qty"] == 10 and data["users_qty"] == 5
        created_resources["licenses"].append(data["id"])

    def test_create_zero_qty_rejected(self, sa_headers):
        body = {"name": f"TEST_Zero_{_suffix()}", "connections_qty": 0, "users_qty": 0}
        r = requests.post(f"{API}/super-admin/licenses", json=body, headers=sa_headers, timeout=15)
        assert r.status_code == 400, r.text
        assert "conexao" in r.json().get("detail", "").lower() or "usuario" in r.json().get("detail", "").lower()

    def test_list_licenses(self, sa_headers, created_resources):
        r = requests.get(f"{API}/super-admin/licenses", headers=sa_headers, timeout=15)
        assert r.status_code == 200, r.text
        rows = r.json()
        assert isinstance(rows, list)
        ids = {row["id"] for row in rows}
        for lid in created_resources["licenses"]:
            assert lid in ids

    def test_update_license(self, sa_headers, created_resources):
        lid = created_resources["licenses"][0]
        r = requests.put(
            f"{API}/super-admin/licenses/{lid}",
            json={"sale_price": 149.90, "description": "updated"},
            headers=sa_headers,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["sale_price"] == 149.90
        assert data["description"] == "updated"

    def test_delete_unused_license_hard(self, sa_headers):
        # create + delete (not referenced) -> hard
        body = {"name": f"TEST_ToDelete_{_suffix()}", "connections_qty": 1, "users_qty": 0}
        r = requests.post(f"{API}/super-admin/licenses", json=body, headers=sa_headers, timeout=15)
        lid = r.json()["id"]
        r = requests.delete(f"{API}/super-admin/licenses/{lid}", headers=sa_headers, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("deleted") is True
        # confirm not in list
        rows = requests.get(f"{API}/super-admin/licenses", headers=sa_headers, timeout=15).json()
        assert lid not in {row["id"] for row in rows}


# ── 2) Company create/update with licenses + enforcement ───────────────────
class TestCompanyLicensesIntegration:
    @pytest.fixture(scope="class")
    def lic_conn(self, sa_headers, created_resources):
        """A license granting 1 connection + 0 users, cost 30, sale 100."""
        body = {"name": f"TEST_LicConn_{_suffix()}", "connections_qty": 1, "users_qty": 0,
                "cost": 30.0, "sale_price": 100.0}
        r = requests.post(f"{API}/super-admin/licenses", json=body, headers=sa_headers, timeout=15)
        assert r.status_code == 200, r.text
        lid = r.json()["id"]
        created_resources["licenses"].append(lid)
        return lid

    @pytest.fixture(scope="class")
    def lic_user(self, sa_headers, created_resources):
        body = {"name": f"TEST_LicUsr_{_suffix()}", "connections_qty": 0, "users_qty": 1,
                "cost": 20.0, "sale_price": 50.0}
        r = requests.post(f"{API}/super-admin/licenses", json=body, headers=sa_headers, timeout=15)
        assert r.status_code == 200, r.text
        lid = r.json()["id"]
        created_resources["licenses"].append(lid)
        return lid

    def test_create_company_with_licenses_computes_limits(
        self, sa_headers, lic_conn, lic_user, created_resources
    ):
        sub = f"testco{_suffix()}"
        body = {
            "name": f"TEST_Co_{sub}",
            "email": f"{sub}@test.com",
            "phone": "11999990000",
            "plan_type": "both",
            "admin_name": "Admin",
            "admin_email": f"admin_{sub}@test.com",
            "admin_password": "passw0rd!",
            "subdomain": sub,
            "licenses": [
                {"license_id": lic_conn, "qty": 1},   # +1 conn,  cost 30,  sale 100
                {"license_id": lic_user, "qty": 1, "custom_sale_price": 80.0},  # +1 user, cost 20, sale 80
            ],
        }
        r = requests.post(f"{API}/super-admin/companies", json=body, headers=sa_headers, timeout=20)
        assert r.status_code == 200, r.text
        co = r.json()
        created_resources["companies"].append(co["id"])
        assert co["max_connections"] == 1
        assert co["max_users"] == 1
        assert co["total_cost"] == 50.0  # 30+20
        assert co["total_sale_price"] == 180.0  # 100 + 80 (custom)

    def test_company_usage_endpoint(self, sa_headers, created_resources):
        cid = created_resources["companies"][0]
        r = requests.get(f"{API}/super-admin/licenses/usage/{cid}", headers=sa_headers, timeout=15)
        assert r.status_code == 200, r.text
        u = r.json()
        for k in ("max_connections", "max_users", "used_connections", "used_users",
                  "total_cost", "total_sale_price"):
            assert k in u, f"missing {k}"
        assert u["max_connections"] == 1
        assert u["max_users"] == 1
        assert u["used_connections"] == 0
        # Newly created company has 1 auto-created admin user (admin_email).
        assert u["used_users"] == 1

    def test_update_company_clear_licenses_sets_null_limits(self, sa_headers, lic_conn, created_resources):
        # Create dedicated company for this test
        sub = f"clrco{_suffix()}"
        body = {
            "name": f"TEST_Clr_{sub}", "email": f"{sub}@t.com", "plan_type": "both",
            "admin_name": "A", "admin_email": f"adm_{sub}@t.com", "admin_password": "p@ss1234",
            "subdomain": sub,
            "licenses": [{"license_id": lic_conn, "qty": 2}],
        }
        r = requests.post(f"{API}/super-admin/companies", json=body, headers=sa_headers, timeout=20)
        assert r.status_code == 200
        cid = r.json()["id"]
        created_resources["companies"].append(cid)
        assert r.json()["max_connections"] == 2

        # Now wipe licenses
        r2 = requests.put(
            f"{API}/super-admin/companies/{cid}",
            json={"licenses": []}, headers=sa_headers, timeout=15,
        )
        assert r2.status_code == 200, r2.text
        co = r2.json()
        # legacy mode: max_* become null
        assert co.get("max_connections") is None, f"expected null, got {co.get('max_connections')}"
        assert co.get("max_users") is None
        assert co.get("total_cost") == 0.0
        assert co.get("total_sale_price") == 0.0

    def test_enforcement_connections_blocks_second(
        self, sa_headers, lic_conn, created_resources
    ):
        """Create co with max_connections=1, impersonate, create 1 conn (ok), try 2nd (403)."""
        sub = f"enfco{_suffix()}"
        body = {
            "name": f"TEST_Enf_{sub}", "email": f"{sub}@t.com", "plan_type": "both",
            "admin_name": "A", "admin_email": f"adm_{sub}@t.com", "admin_password": "p@ss1234",
            "subdomain": sub,
            "licenses": [{"license_id": lic_conn, "qty": 1}],  # max=1 conn
        }
        r = requests.post(f"{API}/super-admin/companies", json=body, headers=sa_headers, timeout=20)
        assert r.status_code == 200, r.text
        co = r.json()
        cid = co["id"]
        created_resources["companies"].append(cid)
        assert co["max_connections"] == 1

        # Impersonate
        imp = requests.post(
            f"{API}/super-admin/companies/{cid}/impersonate",
            headers=sa_headers, timeout=15,
        )
        assert imp.status_code == 200, imp.text
        co_headers = {"Authorization": f"Bearer {imp.json()['access_token']}"}

        # 1st connection — should succeed
        conn_body = {"name": "TEST_conn1", "type": "whatsapp", "phone": "5511111110001"}
        r1 = requests.post(f"{API}/channels/connections", json=conn_body, headers=co_headers, timeout=20)
        # Accept 200 or 201 — exact code depends on route; we mainly check NOT 403
        assert r1.status_code in (200, 201), f"first create failed: {r1.status_code} {r1.text}"

        # 2nd connection — should be 403 (limite)
        conn_body2 = {"name": "TEST_conn2", "type": "whatsapp", "phone": "5511111110002"}
        r2 = requests.post(f"{API}/channels/connections", json=conn_body2, headers=co_headers, timeout=20)
        assert r2.status_code == 403, f"expected 403 got {r2.status_code} {r2.text}"
        assert "limite" in r2.json().get("detail", "").lower()

    def test_enforcement_users_blocks_second(self, sa_headers, lic_user, created_resources):
        sub = f"usrco{_suffix()}"
        body = {
            "name": f"TEST_UsrEnf_{sub}", "email": f"{sub}@t.com", "plan_type": "both",
            "admin_name": "A", "admin_email": f"adm_{sub}@t.com", "admin_password": "p@ss1234",
            "subdomain": sub,
            "licenses": [{"license_id": lic_user, "qty": 1}],  # max_users=1
        }
        r = requests.post(f"{API}/super-admin/companies", json=body, headers=sa_headers, timeout=20)
        assert r.status_code == 200, r.text
        co = r.json()
        cid = co["id"]
        created_resources["companies"].append(cid)
        # The admin user counts toward used_users -> already 1/1
        # So creating another user must 403 immediately.
        imp = requests.post(
            f"{API}/super-admin/companies/{cid}/impersonate",
            headers=sa_headers, timeout=15,
        )
        assert imp.status_code == 200
        co_headers = {"Authorization": f"Bearer {imp.json()['access_token']}"}

        new_user = {"name": "TEST_2nd", "email": f"second_{sub}@t.com",
                    "password": "p@ss1234", "role": "user"}
        r2 = requests.post(f"{API}/scheduling/company-users", json=new_user, headers=co_headers, timeout=15)
        assert r2.status_code == 403, f"expected 403 got {r2.status_code} {r2.text}"
        assert "limite" in r2.json().get("detail", "").lower()

    def test_enforcement_legacy_no_limit_passes(self, sa_headers, created_resources):
        """Company without licenses + manually set max_*=None -> should NOT block.
        Strategy: create company without licenses (defaults max=1), then clear via licenses=[]
        (sets max_* to None per the route), then create a connection — should succeed.
        """
        sub = f"legco{_suffix()}"
        body = {
            "name": f"TEST_Leg_{sub}", "email": f"{sub}@t.com", "plan_type": "both",
            "admin_name": "A", "admin_email": f"adm_{sub}@t.com", "admin_password": "p@ss1234",
            "subdomain": sub,
            "licenses": [],
        }
        r = requests.post(f"{API}/super-admin/companies", json=body, headers=sa_headers, timeout=20)
        assert r.status_code == 200, r.text
        cid = r.json()["id"]
        created_resources["companies"].append(cid)

        # Force legacy: PUT licenses=[] to nullify max_*
        r2 = requests.put(f"{API}/super-admin/companies/{cid}",
                          json={"licenses": []}, headers=sa_headers, timeout=15)
        assert r2.status_code == 200, r2.text
        assert r2.json().get("max_connections") is None
        assert r2.json().get("max_users") is None

        imp = requests.post(
            f"{API}/super-admin/companies/{cid}/impersonate",
            headers=sa_headers, timeout=15,
        )
        assert imp.status_code == 200
        co_headers = {"Authorization": f"Bearer {imp.json()['access_token']}"}

        # Create 2 connections — both should pass with legacy null cap
        for i in range(2):
            cb = {"name": f"TEST_legconn_{i}", "type": "whatsapp", "phone": f"55119999{i:05d}"}
            rc = requests.post(f"{API}/channels/connections", json=cb, headers=co_headers, timeout=20)
            assert rc.status_code in (200, 201), (
                f"legacy enforcement should not block, got {rc.status_code} {rc.text}"
            )


# ── 3) AdmTxn (Super Admin Financial Transactions) ─────────────────────────
class TestAdmTxnLicensesField:
    @pytest.fixture(scope="class")
    def co_for_txn(self, sa_headers, created_resources):
        """A company we can attach licenca-kind transactions to."""
        sub = f"txnco{_suffix()}"
        body = {
            "name": f"TEST_TxnCo_{sub}", "email": f"{sub}@t.com", "plan_type": "both",
            "admin_name": "A", "admin_email": f"adm_{sub}@t.com", "admin_password": "p@ss1234",
            "subdomain": sub,
        }
        r = requests.post(f"{API}/super-admin/companies", json=body, headers=sa_headers, timeout=20)
        assert r.status_code == 200, r.text
        cid = r.json()["id"]
        created_resources["companies"].append(cid)
        return cid

    def test_create_txn_kind_licenca_with_snapshot(self, sa_headers, co_for_txn, created_resources):
        body = {
            "direction": "entrada",
            "description": "TEST_Licenca_Txn",
            "amount": 100.0,
            "date": "2026-02-01",
            "status": "pago",
            "kind": "licenca",
            "company_id": co_for_txn,
            "license_connections": 2,
            "license_users": 1,
            "license_cost": 50.0,
            "license_sale_price": 100.0,
        }
        r = requests.post(f"{API}/super-admin/finance/transactions",
                          json=body, headers=sa_headers, timeout=15)
        assert r.status_code == 200, r.text
        t = r.json()
        created_resources["txns"].append(t["id"])
        assert t["kind"] == "licenca"
        assert t["company_id"] == co_for_txn
        assert t["license_connections"] == 2
        assert t["license_users"] == 1
        assert t["license_cost"] == 50.0
        assert t["license_sale_price"] == 100.0

    def test_create_txn_kind_diversos_no_company(self, sa_headers, created_resources):
        body = {
            "direction": "saida",
            "description": "TEST_Diversos_Txn",
            "amount": 25.0,
            "date": "2026-02-01",
            "status": "pago",
            "kind": "diversos",
        }
        r = requests.post(f"{API}/super-admin/finance/transactions",
                          json=body, headers=sa_headers, timeout=15)
        assert r.status_code == 200, r.text
        t = r.json()
        created_resources["txns"].append(t["id"])
        assert t["kind"] == "diversos"
        assert t.get("company_id") in (None, "")

    def test_list_txn_filter_by_kind_and_company(self, sa_headers, co_for_txn):
        r = requests.get(
            f"{API}/super-admin/finance/transactions",
            params={"kind": "licenca", "company_id": co_for_txn},
            headers=sa_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        rows = r.json()
        assert isinstance(rows, list)
        # All returned rows must match the filter
        for t in rows:
            assert t.get("kind") == "licenca"
            assert t.get("company_id") == co_for_txn
        # We have at least the row we just created
        assert any(t.get("description") == "TEST_Licenca_Txn" for t in rows)

    def test_list_txn_filter_kind_diversos(self, sa_headers):
        r = requests.get(
            f"{API}/super-admin/finance/transactions",
            params={"kind": "diversos"},
            headers=sa_headers, timeout=15,
        )
        assert r.status_code == 200
        for t in r.json():
            assert t.get("kind") == "diversos"


# ── 4) Soft-delete when license is referenced ──────────────────────────────
class TestLicenseSoftDelete:
    def test_delete_referenced_license_is_soft(self, sa_headers, created_resources):
        # Create license + company that uses it
        body = {"name": f"TEST_RefLic_{_suffix()}", "connections_qty": 1, "users_qty": 0,
                "cost": 10.0, "sale_price": 50.0}
        rl = requests.post(f"{API}/super-admin/licenses", json=body, headers=sa_headers, timeout=15)
        assert rl.status_code == 200
        lid = rl.json()["id"]
        created_resources["licenses"].append(lid)

        sub = f"refco{_suffix()}"
        co_body = {
            "name": f"TEST_RefCo_{sub}", "email": f"{sub}@t.com", "plan_type": "both",
            "admin_name": "A", "admin_email": f"adm_{sub}@t.com", "admin_password": "p@ss1234",
            "subdomain": sub,
            "licenses": [{"license_id": lid, "qty": 1}],
        }
        rc = requests.post(f"{API}/super-admin/companies", json=co_body, headers=sa_headers, timeout=20)
        assert rc.status_code == 200, rc.text
        created_resources["companies"].append(rc.json()["id"])

        # Now attempt delete — should soft-deactivate
        rd = requests.delete(f"{API}/super-admin/licenses/{lid}", headers=sa_headers, timeout=15)
        assert rd.status_code == 200, rd.text
        body_resp = rd.json()
        assert body_resp.get("soft_deleted") is True

        # GET include_inactive=true must include the row, default GET must not
        active = requests.get(f"{API}/super-admin/licenses",
                              headers=sa_headers, timeout=15).json()
        all_rows = requests.get(f"{API}/super-admin/licenses",
                                params={"include_inactive": "true"},
                                headers=sa_headers, timeout=15).json()
        active_ids = {r["id"] for r in active}
        all_ids = {r["id"] for r in all_rows}
        assert lid not in active_ids
        assert lid in all_ids
