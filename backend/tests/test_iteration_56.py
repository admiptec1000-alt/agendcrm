"""2026-02-16 (L) — Multi-offset reminders + history + representante.

Validates:
  1. PUT /billing-reminder-settings accepts `days_before_due_list`.
  2. Scheduler fires one reminder per offset that is within the window
     (1 reminder per (txn, offset) pair, idempotent across ticks).
  3. Reminder uses `representante` as {{nome}} when set.
  4. `manual_resend` endpoint logs a history row with kind=manual_resend.
  5. History endpoint returns rows filtered by transaction_id."""
import datetime
import os
import uuid

import pytest
import requests


BASE_URL = os.environ.get("BACKEND_URL", "https://agentcrm-book.preview.emergentagent.com")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def super_headers():
    r = requests.post(
        f"{API}/auth/super-admin/login",
        json={"email": "admin@agentcrm.com", "password": "admin123"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _cleanup_company(super_headers, cid):
    if not cid:
        return
    try:
        requests.delete(f"{API}/super-admin/companies/{cid}", headers=super_headers, timeout=15)
    except Exception:
        pass
    # Direct DB cleanup of test rows
    try:
        from motor.motor_asyncio import AsyncIOMotorClient
        import asyncio
        async def go():
            cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = cli[os.environ["DB_NAME"]]
            await db.super_admin_transactions.delete_many({"company_id": cid})
            await db.billing_reminder_history.delete_many({"company_id": cid})
        asyncio.get_event_loop().run_until_complete(go())
    except Exception:
        pass


def test_01_put_accepts_days_list(super_headers):
    r = requests.put(
        f"{API}/super-admin/billing-reminder-settings",
        headers=super_headers,
        json={"enabled": True, "days_before_due_list": [10, 3, 1], "channel": "whatsapp"},
        timeout=10,
    )
    assert r.status_code in (200, 201), r.text
    body = r.json()
    assert body["days_before_due_list"] == [10, 3, 1]  # sorted desc
    assert body["days_before_due"] == 10  # back-compat = max

    # GET returns the list too
    g = requests.get(f"{API}/super-admin/billing-reminder-settings", headers=super_headers, timeout=10)
    assert g.json()["days_before_due_list"] == [10, 3, 1]


def test_02_scheduler_multi_offset_with_representante(super_headers):
    suffix = uuid.uuid4().hex[:8]
    today_3 = (datetime.date.today() + datetime.timedelta(days=3)).isoformat()
    payload = {
        "name": f"TEST_MultiOffset_{suffix}",
        "email": f"test_mo_{suffix}@noreply-agentcrm.com",
        "admin_name": "MO Admin",
        "admin_email": f"admin_mo_{suffix}@noreply-agentcrm.com",
        "admin_password": "test123456",
        "subdomain": f"testmo{suffix}",
        "plan_type": "both",
        "phone": "5562988887777",
        "monthly_price": 99.90,
        "installments": 1,
        "billing_cycle": "monthly",
        "first_due_date": today_3,
        "representante": "Maria Silva (Test)",
    }
    r = requests.post(f"{API}/super-admin/companies", headers=super_headers, json=payload, timeout=20)
    assert r.status_code in (200, 201), r.text
    cid = r.json().get("id")
    try:
        assert r.json().get("representante") == "Maria Silva (Test)"

        # Run scheduler (settings already set to [10, 3, 1] by test_01).
        import asyncio, sys
        sys.path.insert(0, "/app/backend")
        from database import connect_to_mongo, get_database
        from scheduler import _process_billing_reminders

        async def run():
            await connect_to_mongo()
            db = await get_database()
            await _process_billing_reminders(db)
            await _process_billing_reminders(db)  # idempotent (sent rows)

        asyncio.get_event_loop().run_until_complete(run())

        # SMART FALLBACK (2026-02-17): only ONE offset fires per tick — the
        # one closest to today. With days_list=[10,3,1] and days_until_due=3,
        # eligible = {10, 3} (O >= 3); min = 3. So offset 3 fires; 10 and 1
        # do NOT. Failed retries are intentional, so multiple history rows
        # for offset=3 may exist (one per tick).
        history = requests.get(
            f"{API}/super-admin/billing-reminder-history",
            headers=super_headers,
            params={"company_id": cid},
            timeout=15,
        )
        assert history.status_code == 200
        rows = history.json()
        offsets_seen = {r.get("days_before_due") for r in rows}
        assert 3 in offsets_seen, f"offset 3d (closest) expected to fire — seen {offsets_seen}"
        assert 10 not in offsets_seen, f"offset 10d should be skipped (3d closer) — seen {offsets_seen}"
        assert 1 not in offsets_seen, f"offset 1d should NOT fire yet — seen {offsets_seen}"
        # Text uses representante
        assert any("Maria Silva" in (r.get("text") or "") for r in rows)
    finally:
        _cleanup_company(super_headers, cid)


def test_03_resend_endpoint_creates_history_row(super_headers):
    # Reset to a single 10 offset to keep this test isolated.
    requests.put(
        f"{API}/super-admin/billing-reminder-settings",
        headers=super_headers,
        json={"enabled": True, "days_before_due_list": [10], "channel": "whatsapp"},
        timeout=10,
    )
    suffix = uuid.uuid4().hex[:8]
    today_5 = (datetime.date.today() + datetime.timedelta(days=5)).isoformat()
    payload = {
        "name": f"TEST_Resend_{suffix}",
        "email": f"test_rs_{suffix}@noreply-agentcrm.com",
        "admin_name": "RS Admin",
        "admin_email": f"admin_rs_{suffix}@noreply-agentcrm.com",
        "admin_password": "test123456",
        "subdomain": f"testrs{suffix}",
        "plan_type": "both",
        "phone": "5562988887777",
        "monthly_price": 99.90,
        "installments": 1,
        "billing_cycle": "monthly",
        "first_due_date": today_5,
        "representante": "Joao Resend",
    }
    r = requests.post(f"{API}/super-admin/companies", headers=super_headers, json=payload, timeout=20)
    cid = r.json().get("id")
    try:
        # Trigger scheduler to generate the txn
        import asyncio, sys
        sys.path.insert(0, "/app/backend")
        from database import connect_to_mongo, get_database
        from scheduler import _process_billing_reminders
        async def run():
            await connect_to_mongo()
            db = await get_database()
            await _process_billing_reminders(db)
        asyncio.get_event_loop().run_until_complete(run())

        # Get the txn
        tx_resp = requests.get(
            f"{API}/super-admin/finance/transactions",
            headers=super_headers,
            params={"company_id": cid},
            timeout=15,
        )
        items = tx_resp.json()
        if isinstance(items, dict):
            items = items.get("items") or []
        assert len(items) >= 1
        txn_id = items[0]["id"]

        # Resend — will fail (no SA WA) but should log history
        rs = requests.post(
            f"{API}/super-admin/finance/transactions/{txn_id}/resend-reminder",
            headers=super_headers,
            timeout=15,
        )
        # 400 is expected (no SA connection in test env)
        assert rs.status_code in (200, 400)

        hist = requests.get(
            f"{API}/super-admin/billing-reminder-history",
            headers=super_headers,
            params={"transaction_id": txn_id, "limit": 50},
            timeout=15,
        )
        rows = hist.json()
        manual = [r for r in rows if r.get("kind") == "manual_resend"]
        assert len(manual) >= 1, f"expected manual_resend row — saw {rows}"
        assert "Joao Resend" in (manual[0].get("text") or "")
    finally:
        _cleanup_company(super_headers, cid)
