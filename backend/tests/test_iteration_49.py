"""
Iteration 49 - SuperAdmin Plan→BusinessType unification + External Clients + Auto-Invoicing
Tests:
  * BusinessType new billing fields (monthly_price/billing_cycle/installments/grace_days/max_*)
  * Company auto-invoice generation from BT and from legacy plan_id
  * External-clients CRUD
  * Manual invoices (company OR external_client mutually exclusive)
  * /migrate-plans-to-business-types idempotency
  * run-suspension-check using BT grace_days fallback
  * Public /api/auth/business-types exposes new monthly_price + billing_cycle
"""
import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://agentcrm-book.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
SA_EMAIL = "admin@agentcrm.com"
SA_PASS = "admin123"


# ---------- fixtures ----------------------------------------------------------
@pytest.fixture(scope="session")
def sa_token():
    r = requests.post(f"{API}/auth/super-admin/login",
                      json={"email": SA_EMAIL, "password": SA_PASS}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def sa_client(sa_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {sa_token}",
                      "Content-Type": "application/json"})
    return s


@pytest.fixture
def cleanup():
    """Track ids to delete at teardown."""
    bag = {"bt": [], "company": [], "ext": [], "invoice": [], "plan": []}
    yield bag
    token = requests.post(f"{API}/auth/super-admin/login",
                          json={"email": SA_EMAIL, "password": SA_PASS}, timeout=30).json()["access_token"]
    H = {"Authorization": f"Bearer {token}"}
    for cid in bag["company"]:
        requests.delete(f"{API}/super-admin/companies/{cid}", headers=H, timeout=30)
    for iid in bag["invoice"]:
        requests.delete(f"{API}/super-admin/invoices/{iid}", headers=H, timeout=30)
    for eid in bag["ext"]:
        requests.delete(f"{API}/super-admin/external-clients/{eid}", headers=H, timeout=30)
    for bt in bag["bt"]:
        requests.delete(f"{API}/super-admin/business-types/{bt}", headers=H, timeout=30)
    for pid in bag["plan"]:
        requests.delete(f"{API}/super-admin/plans/{pid}", headers=H, timeout=30)


# ---------- BusinessType billing fields --------------------------------------
class TestBusinessTypeBilling:
    def test_create_returns_billing_fields(self, sa_client, cleanup):
        body = {
            "name": f"TEST_BT_{uuid.uuid4().hex[:6]}",
            "description": "test", "base_type": "scheduling",
            "features": [{"feature_key": "agenda", "enabled": True, "label": "Agenda", "category": "scheduling"}],
            "monthly_price": 199.90, "billing_cycle": "monthly",
            "installments": 3, "grace_days": 7,
            "max_connections": 4, "max_users": 8,
        }
        r = sa_client.post(f"{API}/super-admin/business-types", json=body, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        cleanup["bt"].append(d["id"])
        for k in ("monthly_price", "billing_cycle", "installments", "grace_days",
                  "max_connections", "max_users"):
            assert k in d, f"missing {k}"
        assert d["monthly_price"] == 199.90
        assert d["billing_cycle"] == "monthly"
        assert d["installments"] == 3
        assert d["grace_days"] == 7
        assert d["max_connections"] == 4
        assert d["max_users"] == 8

    def test_update_persists_billing_fields(self, sa_client, cleanup):
        c = sa_client.post(f"{API}/super-admin/business-types", json={
            "name": f"TEST_BT_U_{uuid.uuid4().hex[:6]}", "base_type": "crm",
            "features": [], "monthly_price": 10
        }, timeout=30).json()
        cleanup["bt"].append(c["id"])
        r = sa_client.put(f"{API}/super-admin/business-types/{c['id']}",
                          json={"monthly_price": 555.55, "billing_cycle": "yearly",
                                "installments": 2, "grace_days": 15,
                                "max_connections": 9, "max_users": 12}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["monthly_price"] == 555.55
        assert d["billing_cycle"] == "yearly"
        assert d["installments"] == 2
        assert d["grace_days"] == 15
        assert d["max_connections"] == 9
        assert d["max_users"] == 12
        # GET to verify persistence
        g = sa_client.get(f"{API}/super-admin/business-types/{c['id']}", timeout=30).json()
        assert g["billing_cycle"] == "yearly"
        assert g["max_users"] == 12


# ---------- Auto-invoice from BusinessType -----------------------------------
class TestCompanyAutoInvoice:
    def _make_bt(self, sa_client, cleanup, **billing):
        body = {"name": f"TEST_BT_{uuid.uuid4().hex[:6]}", "base_type": "crm",
                "features": [], **billing}
        r = sa_client.post(f"{API}/super-admin/business-types", json=body, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        cleanup["bt"].append(d["id"])
        return d

    def _make_company(self, sa_client, cleanup, **kwargs):
        slug = f"tst{uuid.uuid4().hex[:6]}"
        body = {
            "name": f"TEST_CO_{slug}", "cnpj": f"00{uuid.uuid4().int % 10**12:012d}",
            "email": f"{slug}@test.com", "phone": "11999",
            "plan_type": "crm", "subdomain": slug,
            "admin_name": "Adm", "admin_email": f"adm_{slug}@t.com",
            "admin_password": "x12345",
            **kwargs
        }
        r = sa_client.post(f"{API}/super-admin/companies", json=body, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        cleanup["company"].append(d["id"])
        return d

    def test_auto_invoice_from_bt_monthly(self, sa_client, cleanup):
        bt = self._make_bt(sa_client, cleanup, monthly_price=99.0,
                           billing_cycle="monthly", installments=3, grace_days=5)
        co = self._make_company(sa_client, cleanup, business_type_id=bt["id"])
        inv = sa_client.get(f"{API}/super-admin/invoices",
                            params={"company_id": co["id"]}, timeout=30).json()
        assert inv["total"] == 3, f"expected 3 invoices, got {inv}"
        amts = [i["amount"] for i in inv["items"]]
        assert all(a == 99.0 for a in amts)
        # Ensure due_dates spaced monthly (different months)
        dues = sorted([i["due_date"] for i in inv["items"]])
        months = {d[:7] for d in dues}
        assert len(months) == 3, f"expected 3 distinct months, got {months}"

    def test_no_invoice_when_bt_price_zero(self, sa_client, cleanup):
        bt = self._make_bt(sa_client, cleanup, monthly_price=0)
        co = self._make_company(sa_client, cleanup, business_type_id=bt["id"])
        inv = sa_client.get(f"{API}/super-admin/invoices",
                            params={"company_id": co["id"]}, timeout=30).json()
        assert inv["total"] == 0

    def test_auto_invoice_yearly_one_installment(self, sa_client, cleanup):
        bt = self._make_bt(sa_client, cleanup, monthly_price=1200,
                           billing_cycle="yearly", installments=1)
        co = self._make_company(sa_client, cleanup, business_type_id=bt["id"])
        inv = sa_client.get(f"{API}/super-admin/invoices",
                            params={"company_id": co["id"]}, timeout=30).json()
        assert inv["total"] == 1
        assert inv["items"][0]["amount"] == 1200

    def test_legacy_plan_id_still_generates(self, sa_client, cleanup):
        # Create legacy plan
        plan = sa_client.post(f"{API}/super-admin/plans", json={
            "name": f"TEST_PLAN_{uuid.uuid4().hex[:6]}",
            "monthly_price": 50.0, "plan_type": "crm",
            "max_connections": 1, "max_users": 1,
            "billing_cycle": "monthly", "installments": 2, "grace_days": 5,
        }, timeout=30).json()
        cleanup["plan"].append(plan["id"])
        co = self._make_company(sa_client, cleanup, plan_id=plan["id"])
        inv = sa_client.get(f"{API}/super-admin/invoices",
                            params={"company_id": co["id"]}, timeout=30).json()
        assert inv["total"] == 2, f"expected 2, got {inv}"
        assert all(i["amount"] == 50.0 for i in inv["items"])


# ---------- External clients CRUD --------------------------------------------
class TestExternalClients:
    def test_full_crud(self, sa_client, cleanup):
        body = {"name": f"TEST_EXT_{uuid.uuid4().hex[:6]}", "email": "x@y.com",
                "cnpj": "12.345.678/0001-90", "phone": "11999", "notes": "n"}
        r = sa_client.post(f"{API}/super-admin/external-clients", json=body, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        cleanup["ext"].append(d["id"])
        assert d["name"] == body["name"]
        assert d["email"] == "x@y.com"

        # LIST
        lst = sa_client.get(f"{API}/super-admin/external-clients", timeout=30).json()
        assert any(c["id"] == d["id"] for c in lst)

        # UPDATE
        u = sa_client.put(f"{API}/super-admin/external-clients/{d['id']}",
                          json={**body, "notes": "updated"}, timeout=30)
        assert u.status_code == 200
        assert u.json()["notes"] == "updated"

        # DELETE
        de = sa_client.delete(f"{API}/super-admin/external-clients/{d['id']}", timeout=30)
        assert de.status_code == 200
        cleanup["ext"].remove(d["id"])

    def test_delete_blocked_when_invoice_exists(self, sa_client, cleanup):
        ext = sa_client.post(f"{API}/super-admin/external-clients",
                             json={"name": f"TEST_EXT_{uuid.uuid4().hex[:6]}"},
                             timeout=30).json()
        cleanup["ext"].append(ext["id"])
        inv = sa_client.post(f"{API}/super-admin/invoices", json={
            "external_client_id": ext["id"], "amount": 10,
            "due_date": "2026-12-01", "description": "TEST"
        }, timeout=30).json()
        cleanup["invoice"].append(inv["id"])
        de = sa_client.delete(f"{API}/super-admin/external-clients/{ext['id']}", timeout=30)
        assert de.status_code == 409, de.text


# ---------- Manual invoice mutual exclusivity --------------------------------
class TestManualInvoiceMutualExclusivity:
    def test_both_ids_returns_400(self, sa_client, cleanup):
        ext = sa_client.post(f"{API}/super-admin/external-clients",
                             json={"name": f"TEST_EXT_{uuid.uuid4().hex[:6]}"},
                             timeout=30).json()
        cleanup["ext"].append(ext["id"])
        # Need a real company id. Pick first one.
        cos = sa_client.get(f"{API}/super-admin/companies", timeout=30).json()
        if not cos:
            pytest.skip("no company in DB")
        r = sa_client.post(f"{API}/super-admin/invoices", json={
            "company_id": cos[0]["id"], "external_client_id": ext["id"],
            "amount": 1, "due_date": "2026-12-01"}, timeout=30)
        assert r.status_code == 400, r.text

    def test_neither_id_returns_400(self, sa_client):
        r = sa_client.post(f"{API}/super-admin/invoices", json={
            "amount": 1, "due_date": "2026-12-01"}, timeout=30)
        assert r.status_code in (400, 422), r.text

    def test_external_invoice_resolves_client_name(self, sa_client, cleanup):
        ext = sa_client.post(f"{API}/super-admin/external-clients", json={
            "name": f"TEST_EXT_{uuid.uuid4().hex[:6]}"}, timeout=30).json()
        cleanup["ext"].append(ext["id"])
        inv = sa_client.post(f"{API}/super-admin/invoices", json={
            "external_client_id": ext["id"], "amount": 99,
            "due_date": "2026-11-15", "description": "TEST_ext"
        }, timeout=30).json()
        cleanup["invoice"].append(inv["id"])
        listing = sa_client.get(f"{API}/super-admin/invoices",
                                params={"external_client_id": ext["id"]}, timeout=30).json()
        items = listing["items"]
        assert len(items) >= 1
        match = [i for i in items if i["id"] == inv["id"]][0]
        assert match["client_kind"] == "external"
        assert match["client_name"] == ext["name"]


# ---------- migrate-plans-to-business-types idempotency ----------------------
class TestMigrationIdempotent:
    def test_second_call_zero_migrated(self, sa_client):
        first = sa_client.post(f"{API}/super-admin/migrate-plans-to-business-types", timeout=60)
        assert first.status_code == 200, first.text
        second = sa_client.post(f"{API}/super-admin/migrate-plans-to-business-types", timeout=60)
        assert second.status_code == 200
        d2 = second.json()
        # Idempotent: nothing more migrated; either no plan refs or all already-filled
        assert d2["migrated_business_types"] == 0
        assert d2["already_filled"] >= 0


# ---------- run-suspension-check uses BT fallback ----------------------------
class TestSuspensionCheck:
    def test_endpoint_returns_counts(self, sa_client):
        r = sa_client.post(f"{API}/super-admin/invoices/run-suspension-check", timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "marked_overdue" in d
        assert "companies_suspended" in d


# ---------- Public business-types endpoint -----------------------------------
class TestPublicBusinessTypes:
    def test_returns_billing_fields(self, sa_client, cleanup):
        # ensure at least one BT has billing
        bt = sa_client.post(f"{API}/super-admin/business-types", json={
            "name": f"TEST_PUB_{uuid.uuid4().hex[:6]}", "base_type": "crm",
            "features": [], "monthly_price": 77.0, "billing_cycle": "monthly"
        }, timeout=30).json()
        cleanup["bt"].append(bt["id"])
        r = requests.get(f"{API}/auth/business-types", timeout=30)
        assert r.status_code == 200, r.text
        items = r.json()
        assert isinstance(items, list)
        # find ours
        ours = [i for i in items if i["id"] == bt["id"]]
        assert ours, "newly created BT not in public list"
        my = ours[0]
        assert "monthly_price" in my, f"public BT missing monthly_price: {my}"
        assert "billing_cycle" in my, f"public BT missing billing_cycle: {my}"
        assert my["monthly_price"] == 77.0
        # features should NOT be exposed publicly
        assert "features" not in my
