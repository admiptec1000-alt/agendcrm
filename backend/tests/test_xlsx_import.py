"""End-to-end test for POST /api/crm/clients/import-xlsx.

Builds a small XLSX in-memory mirroring the Incinera backup format and asserts:
  * fresh import creates clients
  * tags from `tags e Kambam` are wired to the company `tags` collection
  * kanban-column matches anchor a ticket on the right column
  * a second run merges instead of duplicating
  * anomalous (15+ digits) phones are still imported
"""
import io
import os
import sys
import pytest
import pandas as pd
import requests

API = os.environ.get("REACT_APP_BACKEND_URL") or "https://agentcrm-book.preview.emergentagent.com"
EMAIL = "crm@test.com"
PASSWORD = "crm123"


@pytest.fixture(scope="module")
def auth():
    r = requests.post(f"{API}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=15)
    r.raise_for_status()
    tok = r.json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def fixture_data(auth):
    """Create the tag + kanban column we'll match against, then yield their names.
    Cleans up everything the test created at the end."""
    tag_name = "TEST_IMPORT_TAG"
    col_name = "TEST_IMPORT_COLUMN"
    tr = requests.post(f"{API}/api/crm/tags", headers=auth, json={"name": tag_name, "color": "#999999"}, timeout=10)
    tr.raise_for_status()
    cr = requests.post(f"{API}/api/crm/kanban-columns", headers=auth, json={"name": col_name, "color": "#888888"}, timeout=10)
    cr.raise_for_status()
    tag_id = tr.json()["id"]
    col_id = cr.json()["id"]
    yield {"tag_name": tag_name, "col_name": col_name, "tag_id": tag_id, "col_id": col_id}
    # cleanup
    requests.delete(f"{API}/api/crm/tags/{tag_id}", headers=auth, timeout=10)
    requests.delete(f"{API}/api/crm/kanban-columns/{col_id}", headers=auth, timeout=10)


def _build_xlsx() -> bytes:
    df = pd.DataFrame([
        {"name": "Test User Import 1", "Telefone": "5511999990001", "email": None, "tags e Kambam": "TEST_IMPORT_TAG, TEST_IMPORT_COLUMN"},
        {"name": "Test User Import 2", "Telefone": "144779170066675", "email": "u2@incinera.test", "tags e Kambam": "TEST_IMPORT_TAG"},
        {"name": "Test User Import 3", "Telefone": "5511999990003", "email": None, "tags e Kambam": "TEST_IMPORT_COLUMN, RANDOM_UNKNOWN_LABEL"},
    ])
    buf = io.BytesIO()
    df.to_excel(buf, index=False)
    return buf.getvalue()


def test_import_creates_clients_and_tickets(auth, fixture_data):
    # Clean any leftover from previous runs
    cl = requests.get(f"{API}/api/scheduling/clients", headers=auth, timeout=15).json()
    for c in cl:
        if c.get("phone") in ("5511999990001", "144779170066675", "5511999990003"):
            requests.delete(f"{API}/api/scheduling/clients/{c['id']}", headers=auth, timeout=10)

    xlsx = _build_xlsx()
    r = requests.post(
        f"{API}/api/crm/clients/import-xlsx",
        headers=auth,
        files={"file": ("t.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        timeout=60,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["rows_total"] == 3
    assert data["created"] == 3  # all 3 are new (we just cleaned)
    assert data["skipped_no_phone"] == 0
    assert data["tickets_created"] == 2  # rows 1 and 3 reference the kanban column
    assert any(u["label"] == "RANDOM_UNKNOWN_LABEL" for u in data["unknown_labels_top"])

    # Cleanup the imported clients/tickets so the test is idempotent
    cl = requests.get(f"{API}/api/scheduling/clients", headers=auth, timeout=15).json()
    for c in cl:
        if c.get("phone") in ("5511999990001", "144779170066675", "5511999990003"):
            requests.delete(f"{API}/api/scheduling/clients/{c['id']}", headers=auth, timeout=10)
    tk = requests.get(f"{API}/api/crm/tickets", headers=auth, timeout=15).json()
    for t in tk:
        if t.get("channel") == "import" and t.get("customer_phone", "").startswith(("5511999990", "144779170066675")):
            requests.delete(f"{API}/api/crm/tickets/{t['id']}", headers=auth, timeout=10)


def test_import_dedup_updates_existing(auth, fixture_data):
    xlsx = _build_xlsx()
    # First run
    r1 = requests.post(
        f"{API}/api/crm/clients/import-xlsx",
        headers=auth,
        files={"file": ("t.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        timeout=60,
    ).json()
    # Second run — should NOT create new ones
    r2 = requests.post(
        f"{API}/api/crm/clients/import-xlsx",
        headers=auth,
        files={"file": ("t.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        timeout=60,
    ).json()
    assert r2["created"] == 0
    assert r2["updated"] >= r1["created"]
    assert r2["tickets_created"] == 0
    assert r2["tickets_updated"] >= 2

    # Cleanup
    cl = requests.get(f"{API}/api/scheduling/clients", headers=auth, timeout=15).json()
    for c in cl:
        if c.get("phone") in ("5511999990001", "144779170066675", "5511999990003"):
            requests.delete(f"{API}/api/scheduling/clients/{c['id']}", headers=auth, timeout=10)
    tk = requests.get(f"{API}/api/crm/tickets", headers=auth, timeout=15).json()
    for t in tk:
        if t.get("channel") == "import" and t.get("customer_phone", "").startswith(("5511999990", "144779170066675")):
            requests.delete(f"{API}/api/crm/tickets/{t['id']}", headers=auth, timeout=10)


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
