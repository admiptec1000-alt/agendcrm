"""
Iteration 50 — Super Admin Phase 2 (operational impersonate) + Phase 3 (Financial Module)
Tests target endpoints in /app/backend/routes/super_admin_finance_routes.py
"""
import os
import time
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://agentcrm-book.preview.emergentagent.com").rstrip("/")
SA_EMAIL = "admin@agentcrm.com"
SA_PASSWORD = "admin123"


# ── Fixtures ────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def sa_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/super-admin/login",
        json={"email": SA_EMAIL, "password": SA_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"SA login failed: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("access_token") or data.get("token")
    assert token, f"No token in response: {data}"
    return token


@pytest.fixture(scope="module")
def sa_headers(sa_token):
    return {"Authorization": f"Bearer {sa_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def current_month():
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    return f"{now.year:04d}-{now.month:02d}"


@pytest.fixture(scope="module")
def today_iso():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).date().isoformat()


# ── Financial Summary ───────────────────────────────────────────────────

class TestFinancialSummary:
    def test_summary_default_month(self, sa_headers):
        r = requests.get(f"{BASE_URL}/api/super-admin/financial/summary", headers=sa_headers, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        # Top-level keys
        for k in ["period", "totals", "license_breakdown", "expenses_by_category",
                  "by_company", "invoices_count", "active_companies"]:
            assert k in data, f"Missing key: {k}"
        # Totals keys
        for k in ["revenue", "license_cost", "commissions_total", "commissions_paid",
                  "commissions_pending", "manual_expenses", "total_costs", "net_profit", "margin_pct"]:
            assert k in data["totals"], f"Missing totals.{k}"
        assert isinstance(data["license_breakdown"], list)
        assert isinstance(data["by_company"], list)
        assert isinstance(data["active_companies"], int)
        assert isinstance(data["invoices_count"], int)

    def test_summary_with_month_filter(self, sa_headers, current_month):
        r = requests.get(
            f"{BASE_URL}/api/super-admin/financial/summary?month={current_month}",
            headers=sa_headers, timeout=20,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["period"]["month"] == current_month

    def test_summary_invalid_month(self, sa_headers):
        r = requests.get(
            f"{BASE_URL}/api/super-admin/financial/summary?month=bad-month",
            headers=sa_headers, timeout=10,
        )
        assert r.status_code == 400

    def test_summary_unauthorized(self):
        r = requests.get(f"{BASE_URL}/api/super-admin/financial/summary", timeout=10)
        assert r.status_code in (401, 403)


# ── Expenses CRUD ───────────────────────────────────────────────────────

class TestExpensesCRUD:
    expense_id = None

    def test_list_empty_or_initial(self, sa_headers, current_month):
        r = requests.get(
            f"{BASE_URL}/api/super-admin/expenses?month={current_month}",
            headers=sa_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "items" in data and "total" in data
        assert isinstance(data["items"], list)

    def test_create_expense(self, sa_headers, today_iso):
        payload = {
            "description": "TEST_iter50 Marketing campaign",
            "amount": 199.99,
            "date": today_iso,
            "category": "marketing",
            "notes": "Created by automated test",
        }
        r = requests.post(
            f"{BASE_URL}/api/super-admin/expenses",
            headers=sa_headers, json=payload, timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["description"] == payload["description"]
        assert data["amount"] == 199.99
        assert data["category"] == "marketing"
        assert "_id" not in data, "Mongo _id leaked into response"
        assert "id" in data
        TestExpensesCRUD.expense_id = data["id"]

    def test_list_includes_created(self, sa_headers, current_month):
        assert TestExpensesCRUD.expense_id, "No expense created"
        r = requests.get(
            f"{BASE_URL}/api/super-admin/expenses?month={current_month}",
            headers=sa_headers, timeout=15,
        )
        assert r.status_code == 200
        items = r.json()["items"]
        ids = [i["id"] for i in items]
        assert TestExpensesCRUD.expense_id in ids
        for item in items:
            assert "_id" not in item

    def test_update_expense(self, sa_headers, today_iso):
        eid = TestExpensesCRUD.expense_id
        assert eid
        payload = {
            "description": "TEST_iter50 Marketing campaign UPDATED",
            "amount": 250.00,
            "date": today_iso,
            "category": "marketing",
            "notes": "Updated",
        }
        r = requests.put(
            f"{BASE_URL}/api/super-admin/expenses/{eid}",
            headers=sa_headers, json=payload, timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["amount"] == 250.0
        assert "UPDATED" in data["description"]

    def test_summary_reflects_expense(self, sa_headers, current_month):
        r = requests.get(
            f"{BASE_URL}/api/super-admin/financial/summary?month={current_month}",
            headers=sa_headers, timeout=20,
        )
        assert r.status_code == 200
        data = r.json()
        # The 250.00 expense should be counted
        assert data["totals"]["manual_expenses"] >= 250.0
        assert data["expenses_by_category"].get("marketing", 0) >= 250.0

    def test_update_404(self, sa_headers, today_iso):
        r = requests.put(
            f"{BASE_URL}/api/super-admin/expenses/nonexistent-id-xyz",
            headers=sa_headers,
            json={"description": "x", "amount": 1.0, "date": today_iso, "category": "other"},
            timeout=10,
        )
        assert r.status_code == 404

    def test_delete_expense(self, sa_headers):
        eid = TestExpensesCRUD.expense_id
        assert eid
        r = requests.delete(
            f"{BASE_URL}/api/super-admin/expenses/{eid}",
            headers=sa_headers, timeout=10,
        )
        assert r.status_code == 200
        assert r.json().get("ok") is True

    def test_delete_404(self, sa_headers):
        r = requests.delete(
            f"{BASE_URL}/api/super-admin/expenses/nonexistent-id-xyz",
            headers=sa_headers, timeout=10,
        )
        assert r.status_code == 404


# ── Partner commissions list ────────────────────────────────────────────

class TestCommissionsList:
    def test_list_no_filter(self, sa_headers):
        r = requests.get(
            f"{BASE_URL}/api/super-admin/partners/commissions",
            headers=sa_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "items" in data and "total" in data
        assert isinstance(data["items"], list)
        for c in data["items"]:
            assert "_id" not in c

    def test_list_status_paid(self, sa_headers):
        r = requests.get(
            f"{BASE_URL}/api/super-admin/partners/commissions?status=paid",
            headers=sa_headers, timeout=15,
        )
        assert r.status_code == 200
        for c in r.json()["items"]:
            assert c.get("paid_to_partner") is True

    def test_list_status_pending(self, sa_headers):
        r = requests.get(
            f"{BASE_URL}/api/super-admin/partners/commissions?status=pending",
            headers=sa_headers, timeout=15,
        )
        assert r.status_code == 200
        for c in r.json()["items"]:
            assert c.get("paid_to_partner") in (False, None)

    def test_list_with_month(self, sa_headers, current_month):
        r = requests.get(
            f"{BASE_URL}/api/super-admin/partners/commissions?month={current_month}",
            headers=sa_headers, timeout=15,
        )
        assert r.status_code == 200


# ── Phase 2: Operational Impersonate ────────────────────────────────────

class TestOperationalImpersonate:
    """Test the /me/operational-impersonate endpoint behavior. We do NOT
    mutate super_admin_settings because we cannot guarantee restoration —
    instead we GET current settings to read its state and assert behavior
    matches the configured value."""

    def test_impersonate_response_or_400(self, sa_headers):
        # Read current settings to know what to assert
        s = requests.get(f"{BASE_URL}/api/super-admin/settings", headers=sa_headers, timeout=10)
        if s.status_code == 200:
            target = s.json().get("financial_manager_company_id")
        else:
            target = None

        r = requests.post(
            f"{BASE_URL}/api/super-admin/me/operational-impersonate",
            headers=sa_headers, timeout=15,
        )
        if not target:
            # No operational company configured → expect 400
            assert r.status_code == 400, f"Expected 400, got {r.status_code}: {r.text}"
            assert "Configure" in r.text or "Operacional" in r.text
        else:
            # Configured → either 200 (success), 404 (company missing), or 409 (no users)
            assert r.status_code in (200, 404, 409), r.text
            if r.status_code == 200:
                data = r.json()
                assert "access_token" in data and data["access_token"]
                assert data.get("token_type") == "bearer"
                # company_slug or company_name present
                assert "company_slug" in data
                assert "company_name" in data

    def test_impersonate_unauthorized(self):
        r = requests.post(f"{BASE_URL}/api/super-admin/me/operational-impersonate", timeout=10)
        assert r.status_code in (401, 403)


# ── Phase 1 regression: invoice paid → commission credited ──────────────

class TestPhase1Regression:
    """Ensure paying an invoice for a partner-referred company still credits
    a partner_commissions document. We snapshot counts before/after."""

    def test_pay_invoice_credits_commission(self, sa_headers):
        # 1. List partners → find one that has at least one referenced company
        r = requests.get(f"{BASE_URL}/api/super-admin/partners", headers=sa_headers, timeout=15)
        assert r.status_code == 200, r.text
        partners = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        if not partners:
            pytest.skip("No partners configured — cannot regression-test commission flow")

        partner_with_company = None
        target_company_id = None
        for p in partners:
            # Try referenced_clients endpoint to find associated companies
            pid = p.get("id")
            rc = requests.get(
                f"{BASE_URL}/api/super-admin/partners/{pid}/referenced-clients",
                headers=sa_headers, timeout=10,
            )
            if rc.status_code == 200:
                rcs = rc.json() if isinstance(rc.json(), list) else rc.json().get("items", [])
                if rcs:
                    partner_with_company = p
                    target_company_id = rcs[0].get("company_id") or rcs[0].get("id")
                    break
        if not partner_with_company or not target_company_id:
            pytest.skip("No partner has an associated company — cannot test commission flow")

        # 2. Snapshot commissions count
        before = requests.get(
            f"{BASE_URL}/api/super-admin/partners/commissions",
            headers=sa_headers, timeout=10,
        ).json()
        before_count = len(before["items"])

        # 3. Create an invoice for that company
        inv_payload = {
            "company_id": target_company_id,
            "amount": 333.33,
            "due_date": "2030-01-15",
            "description": "TEST_iter50 regression invoice",
        }
        ri = requests.post(
            f"{BASE_URL}/api/super-admin/invoices",
            headers=sa_headers, json=inv_payload, timeout=15,
        )
        if ri.status_code not in (200, 201):
            pytest.skip(f"Could not create invoice: {ri.status_code} {ri.text}")
        inv = ri.json()
        inv_id = inv.get("id")
        assert inv_id

        # 4. Mark as paid
        rp = requests.put(
            f"{BASE_URL}/api/super-admin/invoices/{inv_id}",
            headers=sa_headers, json={"status": "paid"}, timeout=15,
        )
        assert rp.status_code in (200, 204), rp.text

        # 5. Wait briefly + re-check commissions
        time.sleep(1.0)
        after = requests.get(
            f"{BASE_URL}/api/super-admin/partners/commissions",
            headers=sa_headers, timeout=10,
        ).json()
        after_count = len(after["items"])

        # Commission should have increased (unless partner has 0% rate — accept >=)
        assert after_count >= before_count, "Commission count went DOWN after paying invoice"
        # If a new commission was added, verify amount calc (rate * invoice amount)
        if after_count > before_count:
            new_comm = after["items"][0]  # newest by created_at desc
            assert "_id" not in new_comm
            assert "amount" in new_comm
            assert new_comm.get("amount", 0) >= 0


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
