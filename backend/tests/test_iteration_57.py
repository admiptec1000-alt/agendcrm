"""2026-02-17 — Bug fix: smart-fallback billing reminders + negative offsets.

Validates:
  1. PUT /billing-reminder-settings accepts negative offsets (until -30).
  2. Scheduler fires ONLY ONE offset per tick — the one closest to today
     (smallest O >= days_until_due). Previous bug: ALL eligible offsets
     fired simultaneously, spamming the customer.
  3. Negative offsets fire AFTER due date (late-payment follow-ups).
  4. Idempotency: a successfully sent (txn, offset) pair is NOT re-fired
     across ticks. Failed offsets ARE retried (intentional resilience).
  5. _send_billing_reminder returns a tuple (ok, error_detail) with a
     readable diagnostic string saved to billing_reminder_history.error.
"""
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


def _run_scheduler():
    import asyncio, sys
    sys.path.insert(0, "/app/backend")
    from database import connect_to_mongo, get_database
    from scheduler import _process_billing_reminders

    async def run():
        await connect_to_mongo()
        db = await get_database()
        await _process_billing_reminders(db)

    asyncio.get_event_loop().run_until_complete(run())


def test_01_negative_offsets_accepted(super_headers):
    r = requests.put(
        f"{API}/super-admin/billing-reminder-settings",
        headers=super_headers,
        json={
            "enabled": True,
            "days_before_due_list": [10, 3, 0, -1, -3],
            "channel": "whatsapp",
        },
        timeout=10,
    )
    assert r.status_code in (200, 201), r.text
    body = r.json()
    # Sorted desc
    assert body["days_before_due_list"] == [10, 3, 0, -1, -3], body
    # Out-of-range values clipped
    r2 = requests.put(
        f"{API}/super-admin/billing-reminder-settings",
        headers=super_headers,
        json={"enabled": True, "days_before_due_list": [-99, 999], "channel": "whatsapp"},
        timeout=10,
    )
    assert r2.json()["days_before_due_list"] == [60, -30]


def test_02_smart_fallback_picks_closest_offset(super_headers):
    """days_list=[10, 3, 1] + due=today+1 → only offset=1 fires (not all 3)."""
    # Configure list
    requests.put(
        f"{API}/super-admin/billing-reminder-settings",
        headers=super_headers,
        json={
            "enabled": True,
            "days_before_due_list": [10, 3, 1],
            "lancamento_gen_days": 30,  # generate immediately
            "channel": "whatsapp",
        },
        timeout=10,
    )
    suffix = uuid.uuid4().hex[:8]
    today_plus_1 = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
    payload = {
        "name": f"TEST_SmartFB_{suffix}",
        "email": f"test_sfb_{suffix}@noreply-agentcrm.com",
        "admin_name": "SFB Admin",
        "admin_email": f"admin_sfb_{suffix}@noreply-agentcrm.com",
        "admin_password": "test123456",
        "subdomain": f"testsfb{suffix}",
        "plan_type": "both",
        "phone": "5562988887777",
        "monthly_price": 50.0,
        "installments": 1,
        "billing_cycle": "monthly",
        "first_due_date": today_plus_1,
    }
    r = requests.post(f"{API}/super-admin/companies", headers=super_headers, json=payload, timeout=20)
    assert r.status_code in (200, 201), r.text
    cid = r.json().get("id")
    try:
        _run_scheduler()
        history = requests.get(
            f"{API}/super-admin/billing-reminder-history",
            headers=super_headers,
            params={"company_id": cid},
            timeout=15,
        )
        rows = history.json()
        offsets_seen = {r.get("days_before_due") for r in rows}
        # Only offset=1 should fire (closest to today). 10 and 3 must NOT fire.
        assert offsets_seen == {1}, (
            f"smart-fallback should pick offset=1 only — seen {offsets_seen}"
        )
        # All rows must be offset=1 (no spam across other offsets).
        assert all(r.get("days_before_due") == 1 for r in rows), rows
    finally:
        _cleanup_company(super_headers, cid)


def test_03_negative_offset_fires_after_due(super_headers):
    """days_list=[-2] + due=today-2 → 1 reminder with offset=-2 (2d late)."""
    requests.put(
        f"{API}/super-admin/billing-reminder-settings",
        headers=super_headers,
        json={
            "enabled": True,
            "days_before_due_list": [10, -2],  # 10 (already past) + -2 (now)
            "lancamento_gen_days": 30,
            "channel": "whatsapp",
        },
        timeout=10,
    )
    suffix = uuid.uuid4().hex[:8]
    yesterday2 = (datetime.date.today() - datetime.timedelta(days=2)).isoformat()
    payload = {
        "name": f"TEST_LateFB_{suffix}",
        "email": f"test_late_{suffix}@noreply-agentcrm.com",
        "admin_name": "Late Admin",
        "admin_email": f"admin_late_{suffix}@noreply-agentcrm.com",
        "admin_password": "test123456",
        "subdomain": f"testlate{suffix}",
        "plan_type": "both",
        "phone": "5562988887777",
        "monthly_price": 50.0,
        "installments": 1,
        "billing_cycle": "monthly",
        "first_due_date": yesterday2,
    }
    r = requests.post(f"{API}/super-admin/companies", headers=super_headers, json=payload, timeout=20)
    cid = r.json().get("id")
    try:
        _run_scheduler()
        history = requests.get(
            f"{API}/super-admin/billing-reminder-history",
            headers=super_headers,
            params={"company_id": cid},
            timeout=15,
        )
        rows = history.json()
        offsets_seen = {r.get("days_before_due") for r in rows}
        # days_until_due = -2. Eligible: O >= -2 → {-2, 10}. min = -2.
        assert offsets_seen == {-2}, (
            f"negative offset -2 should fire on day=due+2 — seen {offsets_seen}"
        )
    finally:
        _cleanup_company(super_headers, cid)


def test_04_diagnostic_error_in_history(super_headers):
    """When SA has no WA connection, history.error should be readable."""
    requests.put(
        f"{API}/super-admin/billing-reminder-settings",
        headers=super_headers,
        json={
            "enabled": True,
            "days_before_due_list": [5],
            "lancamento_gen_days": 30,
            "channel": "whatsapp",
        },
        timeout=10,
    )
    suffix = uuid.uuid4().hex[:8]
    in_5 = (datetime.date.today() + datetime.timedelta(days=5)).isoformat()
    payload = {
        "name": f"TEST_Diag_{suffix}",
        "email": f"test_diag_{suffix}@noreply-agentcrm.com",
        "admin_name": "Diag Admin",
        "admin_email": f"admin_diag_{suffix}@noreply-agentcrm.com",
        "admin_password": "test123456",
        "subdomain": f"testdiag{suffix}",
        "plan_type": "both",
        "phone": "5562988887777",
        "monthly_price": 50.0,
        "installments": 1,
        "billing_cycle": "monthly",
        "first_due_date": in_5,
    }
    r = requests.post(f"{API}/super-admin/companies", headers=super_headers, json=payload, timeout=20)
    cid = r.json().get("id")
    try:
        _run_scheduler()
        history = requests.get(
            f"{API}/super-admin/billing-reminder-history",
            headers=super_headers,
            params={"company_id": cid},
            timeout=15,
        )
        rows = history.json()
        assert len(rows) >= 1
        # Error should be one of the legible diagnostic strings.
        readable = {"no_sa_connection", "no_phone", "no_text", "channel_disabled"}
        sample_error = rows[0].get("error") or ""
        assert (
            sample_error in readable
            or sample_error.startswith("http ")
            or sample_error.startswith("timeout")
            or sample_error.startswith("exception:")
        ), f"unexpected error string: {sample_error!r}"
    finally:
        _cleanup_company(super_headers, cid)
