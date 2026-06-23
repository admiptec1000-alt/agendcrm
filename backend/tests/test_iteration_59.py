"""
Iteration 59 — Validates 3 server-side changes:
  1) GET /api/crm/tickets/counts respects same filters as GET /api/crm/tickets
     (channel, search, connection_id, queue_id, assigned_to, tag) and matches
     per-tab list counts.
  2) Filters with no matches yield 0 across all tabs in /counts and
     0 items in /tickets.
  3) POST /api/super-admin/restore-auto-closed-tickets still returns
     {restored_count:int, company_id, company_name, since_iso}.
"""
import os
import pytest
import requests
from pathlib import Path


def _load_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    env_path = Path("/app/frontend/.env")
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not set")


BASE_URL = _load_backend_url()
API = f"{BASE_URL}/api"


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def crm_token():
    r = requests.post(f"{API}/auth/login",
                      json={"email": "crm@test.com", "password": "crm123"},
                      timeout=20)
    assert r.status_code == 200, f"CRM login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def crm_headers(crm_token):
    return {"Authorization": f"Bearer {crm_token}"}


@pytest.fixture(scope="module")
def super_admin_token():
    r = requests.post(f"{API}/auth/super-admin/login",
                      json={"email": "admin@agentcrm.com", "password": "admin123"},
                      timeout=20)
    assert r.status_code == 200, f"Super admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def super_headers(super_admin_token):
    return {"Authorization": f"Bearer {super_admin_token}"}


# ---------- 1) Counts parity with listing ----------
class TestCountsParityWithListing:
    """Counts (no filters) must equal the number of tickets returned by
    /tickets?tab=<tab> with the same visibility, for all 4 tabs."""

    @staticmethod
    def _count_list(headers, tab):
        r = requests.get(f"{API}/crm/tickets", headers=headers,
                         params={"tab": tab, "limit": 5000}, timeout=30)
        assert r.status_code == 200, f"/tickets?tab={tab} -> {r.status_code} {r.text}"
        return len(r.json())

    def test_counts_match_list_no_filters(self, crm_headers):
        r = requests.get(f"{API}/crm/tickets/counts", headers=crm_headers, timeout=20)
        assert r.status_code == 200, r.text
        counts = r.json()
        for key in ("atendendo", "aguardando", "grupos", "encerrados"):
            assert key in counts, f"Missing key {key} in counts: {counts}"
            assert isinstance(counts[key], int)

        # Validate per-tab parity. Allow exact match because both queries
        # use the same MongoDB filters.
        for tab in ("atendendo", "aguardando", "grupos", "encerrados"):
            list_n = self._count_list(crm_headers, tab)
            assert counts[tab] == list_n, (
                f"Count mismatch for {tab}: counts={counts[tab]} list={list_n}"
            )

    def test_counts_match_list_with_channel_filter(self, crm_headers):
        params = {"channel": "whatsapp"}
        r = requests.get(f"{API}/crm/tickets/counts",
                         headers=crm_headers, params=params, timeout=20)
        assert r.status_code == 200, r.text
        counts = r.json()
        for tab in ("atendendo", "aguardando", "encerrados"):
            list_r = requests.get(f"{API}/crm/tickets", headers=crm_headers,
                                  params={**params, "tab": tab, "limit": 5000},
                                  timeout=30)
            assert list_r.status_code == 200, list_r.text
            assert counts[tab] == len(list_r.json()), (
                f"channel=whatsapp tab={tab}: counts={counts[tab]} "
                f"list={len(list_r.json())}"
            )

    def test_counts_match_list_with_search_filter(self, crm_headers):
        # Pick a search string that should match nothing — both endpoints
        # must agree (likely on zero, but parity is what matters).
        params = {"search": "TEST_iter59_no_such_customer_xyz"}
        r = requests.get(f"{API}/crm/tickets/counts",
                         headers=crm_headers, params=params, timeout=20)
        assert r.status_code == 200, r.text
        counts = r.json()
        for tab in ("atendendo", "aguardando", "encerrados"):
            list_r = requests.get(f"{API}/crm/tickets", headers=crm_headers,
                                  params={**params, "tab": tab, "limit": 5000},
                                  timeout=30)
            assert list_r.status_code == 200, list_r.text
            assert counts[tab] == len(list_r.json()), (
                f"search filter tab={tab}: counts={counts[tab]} "
                f"list={len(list_r.json())}"
            )


# ---------- 2) Empty filters return zero everywhere ----------
class TestEmptyFiltersReturnZero:

    def test_nonexistent_connection_id_returns_zero(self, crm_headers):
        params = {"connection_id": "nonexistent-connection-id-xyz-123"}
        r = requests.get(f"{API}/crm/tickets/counts",
                         headers=crm_headers, params=params, timeout=20)
        assert r.status_code == 200, r.text
        counts = r.json()
        assert counts["atendendo"] == 0
        assert counts["aguardando"] == 0
        assert counts["grupos"] == 0
        assert counts["encerrados"] == 0

        # And the list must also return [] (or zero items) for each tab
        for tab in ("atendendo", "aguardando", "grupos", "encerrados"):
            lr = requests.get(f"{API}/crm/tickets", headers=crm_headers,
                              params={**params, "tab": tab, "limit": 5000},
                              timeout=30)
            assert lr.status_code == 200, lr.text
            assert len(lr.json()) == 0, f"Expected 0 tickets for tab={tab}"

    def test_nonexistent_queue_id_returns_zero(self, crm_headers):
        params = {"queue_id": "no-such-queue-iter59"}
        r = requests.get(f"{API}/crm/tickets/counts",
                         headers=crm_headers, params=params, timeout=20)
        assert r.status_code == 200, r.text
        counts = r.json()
        assert counts["atendendo"] == 0
        assert counts["aguardando"] == 0
        assert counts["grupos"] == 0
        assert counts["encerrados"] == 0

    def test_nonexistent_assigned_to_returns_zero(self, crm_headers):
        params = {"assigned_to": "ghost-user-iter59"}
        r = requests.get(f"{API}/crm/tickets/counts",
                         headers=crm_headers, params=params, timeout=20)
        assert r.status_code == 200, r.text
        counts = r.json()
        assert counts["atendendo"] == 0
        assert counts["aguardando"] == 0
        assert counts["grupos"] == 0
        assert counts["encerrados"] == 0

    def test_nonexistent_tag_returns_zero(self, crm_headers):
        params = {"tag": "TAG_DOES_NOT_EXIST_iter59"}
        r = requests.get(f"{API}/crm/tickets/counts",
                         headers=crm_headers, params=params, timeout=20)
        assert r.status_code == 200, r.text
        counts = r.json()
        assert counts["atendendo"] == 0
        assert counts["aguardando"] == 0
        assert counts["grupos"] == 0
        assert counts["encerrados"] == 0


# ---------- 3) restore-auto-closed-tickets endpoint ----------
class TestRestoreAutoClosedTickets:
    """Validates the existing super-admin recovery endpoint still works after
    the new "Ferramentas" UI was added on the Companies tab."""

    def test_restore_endpoint_returns_expected_shape(self, super_headers):
        # Pick the CRM Test company.
        cr = requests.get(f"{API}/super-admin/companies",
                          headers=super_headers, timeout=20)
        assert cr.status_code == 200, cr.text
        companies = cr.json()
        # Some deployments wrap in {companies: []}; handle both.
        if isinstance(companies, dict) and "companies" in companies:
            companies = companies["companies"]
        assert isinstance(companies, list) and companies, "No companies returned"
        # Prefer the CRM test company; else first.
        target = next((c for c in companies if "crm" in (c.get("name") or "").lower()
                       or (c.get("subdomain") or "") == "crmtest"), companies[0])
        company_id = target["id"]

        # Use an `since_iso` far in the future so we don't actually restore
        # anything from real data — restored_count should be 0.
        body = {
            "company_id": company_id,
            "since_iso": "2099-01-01T00:00:00+00:00",
        }
        r = requests.post(f"{API}/super-admin/restore-auto-closed-tickets",
                          headers=super_headers, json=body, timeout=20)
        assert r.status_code == 200, f"restore failed: {r.status_code} {r.text}"
        data = r.json()
        # Validate response shape
        assert set(["restored_count", "company_id", "company_name", "since_iso"]).issubset(data.keys()), \
            f"Missing keys in response: {data}"
        assert isinstance(data["restored_count"], int)
        assert data["restored_count"] == 0  # safe sentinel since_iso=2099
        assert data["company_id"] == company_id
        assert data["since_iso"] == body["since_iso"]
        assert isinstance(data["company_name"], str) and data["company_name"]

    def test_restore_endpoint_validates_required_body(self, super_headers):
        r = requests.post(f"{API}/super-admin/restore-auto-closed-tickets",
                          headers=super_headers, json={}, timeout=20)
        assert r.status_code == 400, f"Expected 400, got {r.status_code} {r.text}"

    def test_restore_endpoint_requires_super_admin(self, crm_headers):
        # CRM admin token should NOT be allowed.
        r = requests.post(f"{API}/super-admin/restore-auto-closed-tickets",
                          headers=crm_headers,
                          json={"company_id": "abc",
                                "since_iso": "2099-01-01T00:00:00+00:00"},
                          timeout=20)
        assert r.status_code in (401, 403), \
            f"Expected 401/403, got {r.status_code} {r.text}"
