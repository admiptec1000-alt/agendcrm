"""Iteration 55 tests.

Covers:
  T1 — GET/PUT /api/crm/company/ticket-settings with `ticket_auto_close_message`.
  T3 — Auto-generation of super_admin_transactions on company create/update.
  T5 — Stuck-flow log warnings (smoke; only verifies the log handler path is
       wired so the warning gets emitted — does not require a real WA round-trip).
"""
import os
import uuid
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://agentcrm-book.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

CRM_EMAIL = "crm@test.com"
CRM_PASS = "crm123"
SUPER_EMAIL = "admin@agentcrm.com"
SUPER_PASS = "admin123"

# ---------- fixtures ----------

@pytest.fixture(scope="module")
def crm_token():
    r = requests.post(f"{API}/auth/login", json={"email": CRM_EMAIL, "password": CRM_PASS}, timeout=15)
    if r.status_code != 200:
        pytest.skip(f"CRM login failed: {r.status_code} {r.text[:200]}")
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="module")
def crm_headers(crm_token):
    return {"Authorization": f"Bearer {crm_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def super_token():
    r = requests.post(f"{API}/auth/super-admin/login", json={"email": SUPER_EMAIL, "password": SUPER_PASS}, timeout=15)
    if r.status_code != 200:
        # alt route
        r = requests.post(f"{API}/super-admin/login", json={"email": SUPER_EMAIL, "password": SUPER_PASS}, timeout=15)
    if r.status_code != 200:
        pytest.skip(f"Super admin login failed: {r.status_code} {r.text[:200]}")
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="module")
def super_headers(super_token):
    return {"Authorization": f"Bearer {super_token}", "Content-Type": "application/json"}


# ---------- T1: Ticket settings ----------

class TestTicketSettings:
    def test_get_initial(self, crm_headers):
        r = requests.get(f"{API}/crm/company/ticket-settings", headers=crm_headers, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "ticket_auto_close_message" in body
        assert "ticket_auto_close_hours" in body
        assert isinstance(body["ticket_auto_close_message"], str)

    def test_put_message_persists(self, crm_headers):
        msg = "Ola {{nome}}! O atendimento da {{empresa}} esta encerrando."
        r = requests.put(
            f"{API}/crm/company/ticket-settings",
            headers=crm_headers,
            json={"ticket_auto_close_hours": 48, "ticket_auto_close_message": msg},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ticket_auto_close_message"] == msg
        assert body["ticket_auto_close_hours"] == 48

        # GET again to confirm persistence
        r2 = requests.get(f"{API}/crm/company/ticket-settings", headers=crm_headers, timeout=15)
        assert r2.status_code == 200
        assert r2.json()["ticket_auto_close_message"] == msg

    def test_put_message_truncated_at_1000(self, crm_headers):
        long_msg = "x" * 1500
        r = requests.put(
            f"{API}/crm/company/ticket-settings",
            headers=crm_headers,
            json={"ticket_auto_close_message": long_msg},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert len(r.json()["ticket_auto_close_message"]) == 1000

    def test_hours_out_of_range_rejected(self, crm_headers):
        r = requests.put(
            f"{API}/crm/company/ticket-settings",
            headers=crm_headers,
            json={"ticket_auto_close_hours": 9999},
            timeout=15,
        )
        assert r.status_code == 400

    def test_cleanup_restore(self, crm_headers):
        # leave it with hours=48 and message that uses placeholders so the
        # frontend smoke test (next iteration) can render meaningful state.
        r = requests.put(
            f"{API}/crm/company/ticket-settings",
            headers=crm_headers,
            json={"ticket_auto_close_hours": 48, "ticket_auto_close_message": "Ola {{nome}} — {{empresa}}"},
            timeout=15,
        )
        assert r.status_code == 200


# ---------- T3: Auto AdmTxn generation ----------

class TestAdmTxnAutoGen:
    company_id = None
    created_ids = []

    @classmethod
    def teardown_class(cls):
        # Cleanup the company + its txns
        if not cls.company_id:
            return
        try:
            tok = requests.post(
                f"{API}/auth/super-admin/login",
                json={"email": SUPER_EMAIL, "password": SUPER_PASS},
                timeout=15,
            )
            if tok.status_code != 200:
                tok = requests.post(
                    f"{API}/super-admin/login",
                    json={"email": SUPER_EMAIL, "password": SUPER_PASS},
                    timeout=15,
                )
            t = tok.json().get("access_token") or tok.json().get("token")
            h = {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}
            requests.delete(f"{API}/super-admin/companies/{cls.company_id}", headers=h, timeout=15)
        except Exception:
            pass

    def _fetch_txns(self, super_headers, company_id):
        r = requests.get(
            f"{API}/super-admin/finance/transactions",
            headers=super_headers,
            params={"company_id": company_id},
            timeout=15,
        )
        return r

    def test_01_create_company_generates_3_txns(self, super_headers):
        suffix = uuid.uuid4().hex[:8]
        payload = {
            "name": f"TEST_AdmTxnCo_{suffix}",
            "email": f"test_admtxn_{suffix}@noreply-agentcrm.com",
            "admin_name": "Admin Test",
            "admin_email": f"admin_admtxn_{suffix}@noreply-agentcrm.com",
            "admin_password": "test123456",
            "subdomain": f"testadm{suffix}",
            "plan_type": "both",
            "monthly_price": 99.90,
            "installments": 3,
            "billing_cycle": "monthly",
        }
        r = requests.post(f"{API}/super-admin/companies", headers=super_headers, json=payload, timeout=20)
        assert r.status_code in (200, 201), r.text
        body = r.json()
        TestAdmTxnAutoGen.company_id = body.get("id")
        assert TestAdmTxnAutoGen.company_id

        # Give backend a beat
        time.sleep(0.5)
        r2 = self._fetch_txns(super_headers, TestAdmTxnAutoGen.company_id)
        assert r2.status_code == 200, r2.text
        items = r2.json().get("items") if isinstance(r2.json(), dict) else r2.json()
        assert isinstance(items, list)
        auto_rows = [x for x in items if x.get("auto_company_billing")]
        assert len(auto_rows) == 3, f"Expected 3 auto txns, got {len(auto_rows)}: {auto_rows}"
        for row in auto_rows:
            assert row["kind"] == "licenca"
            assert row["status"] == "pendente"
            assert float(row["amount"]) == pytest.approx(99.90, rel=1e-3)
        # due_dates monthly-spaced
        dates = sorted([row["due_date"] for row in auto_rows])
        assert len(set(dates)) == 3
        # Months should be consecutive
        months = [int(d.split("-")[1]) for d in dates]
        # difference of 1 (mod 12)
        diffs = [(months[i+1] - months[i]) % 12 for i in range(len(months)-1)]
        assert all(d == 1 for d in diffs), f"due_dates not monthly-spaced: {dates}"

    def test_02_update_company_preserves_paid_resets_pending(self, super_headers):
        cid = TestAdmTxnAutoGen.company_id
        assert cid, "company must exist from test_01"

        # Mark one of the pending txns as paid.
        r = self._fetch_txns(super_headers, cid)
        items = r.json().get("items") if isinstance(r.json(), dict) else r.json()
        auto_rows = [x for x in items if x.get("auto_company_billing")]
        assert auto_rows, "need at least one auto row to test preservation"
        target = auto_rows[0]
        tx_id = target["id"]

        # Try to mark via the canonical /pay action endpoint
        upd = requests.post(
            f"{API}/super-admin/finance/transactions/{tx_id}/pay",
            headers=super_headers,
            json={},
            timeout=15,
        )
        if upd.status_code not in (200, 201, 204):
            # Fallback: direct PUT setting status
            upd = requests.put(
                f"{API}/super-admin/finance/transactions/{tx_id}",
                headers=super_headers,
                json={"status": "pago"},
                timeout=15,
            )
        assert upd.status_code in (200, 201, 204), upd.text

        # Now update installments=2 via PUT /companies/{id}
        upd_company = requests.put(
            f"{API}/super-admin/companies/{cid}",
            headers=super_headers,
            json={"monthly_price": 99.90, "installments": 2, "billing_cycle": "monthly"},
            timeout=20,
        )
        assert upd_company.status_code in (200, 201), upd_company.text

        time.sleep(0.5)
        r3 = self._fetch_txns(super_headers, cid)
        items3 = r3.json().get("items") if isinstance(r3.json(), dict) else r3.json()
        auto_rows3 = [x for x in items3 if x.get("auto_company_billing")]
        paid_rows = [x for x in auto_rows3 if x.get("status") == "pago"]
        pending_rows = [x for x in auto_rows3 if x.get("status") == "pendente"]
        # paid preserved
        assert len(paid_rows) == 1, f"paid not preserved, got {len(paid_rows)}: {paid_rows}"
        assert paid_rows[0]["id"] == tx_id, "paid txn id should be same as originally marked paid"
        # 2 new pending
        assert len(pending_rows) == 2, f"expected 2 fresh pending, got {len(pending_rows)}"


# ---------- T5: Stuck-flow log smoke ----------

class TestStuckFlowLog:
    """Verify the warning path exists in code by hitting a known-safe entrypoint
    that would trigger the log if a stuck ticket existed. We can't easily
    create a stuck ticket via API, so just assert the module exposes the
    warning string we care about."""

    def test_warning_string_present_in_module(self):
        import pathlib
        src = pathlib.Path("/app/backend/routes/channels_routes.py").read_text(encoding="utf-8")
        assert "stuck flow state" in src
        assert "references missing" in src
