"""Iteration 64 — Anti-block send-gate for automatic non-bot sends.

Covers:
  * services.send_gate: acquire_send_slot / record_send unit tests
  * scheduler._process_billing_reminders integration with gate
  * scheduler._process_reminders integration with gate
  * scheduler._process_surveys integration with gate
  * regression: GET/PUT /api/crm/campaign-settings
"""
import os
import sys
import asyncio
import uuid
import pytest
import pytest_asyncio
import requests
from datetime import datetime, timezone, timedelta
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import dotenv_values

# Make backend/ importable
sys.path.insert(0, "/app/backend")

from services import send_gate  # noqa: E402
import scheduler  # noqa: E402


MONGO_URL = os.environ.get("MONGO_URL") or dotenv_values("/app/backend/.env").get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME") or dotenv_values("/app/backend/.env").get("DB_NAME")
BASE_URL = (dotenv_values("/app/frontend/.env").get("REACT_APP_BACKEND_URL") or "").rstrip("/")

TEST_TAG = "TEST_iter64_"


@pytest_asyncio.fixture
async def db():
    client = AsyncIOMotorClient(MONGO_URL, serverSelectionTimeoutMS=5000)
    d = client[DB_NAME]
    yield d
    # cleanup
    for coll in ["campaign_settings", "send_gate_stats", "companies",
                 "super_admin_transactions", "billing_reminder_history",
                 "channel_connections", "appointments", "notification_settings",
                 "system_settings", "tickets"]:
        await d[coll].delete_many({"$or": [
            {"company_id": {"$regex": f"^{TEST_TAG}"}},
            {"id": {"$regex": f"^{TEST_TAG}"}},
        ]})
    await d.system_settings.delete_many({"key": {"$regex": f"^{TEST_TAG}"}})
    client.close()


@pytest.fixture
def cid():
    return f"{TEST_TAG}co_{uuid.uuid4().hex[:8]}"


# ============================================================
# SECTION 1 — send_gate unit tests
# ============================================================
@pytest.mark.asyncio
async def test_disabled_returns_true_and_no_stats_written(db, cid):
    await db.campaign_settings.insert_one({
        "company_id": cid, "anti_block": {"enabled": False}
    })
    ok, why = await send_gate.acquire_send_slot(db, cid)
    assert ok is True
    assert why == "disabled"
    # record_send is NOT called by caller, so stats stay empty
    stats = await db.send_gate_stats.find_one({"company_id": cid})
    assert stats is None


@pytest.mark.asyncio
async def test_hourly_limit_blocks(db, cid):
    await db.campaign_settings.insert_one({
        "company_id": cid,
        "anti_block": {"enabled": True, "hourly_limit": 2, "daily_limit": 100,
                       "interval_min_seconds": 0, "interval_max_seconds": 0,
                       "burst_size": 0, "burst_pause_seconds": 0,
                       "escalate_after": 0, "escalate_factor": 1.0}
    })
    now = datetime.now(timezone.utc)
    hour_start = now.replace(minute=0, second=0, microsecond=0)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    await db.send_gate_stats.insert_one({
        "company_id": cid, "channel": "whatsapp",
        "hour_count": 2, "day_count": 2,
        "hour_marker": hour_start.isoformat(),
        "day_marker": day_start.isoformat(),
    })
    ok, why = await send_gate.acquire_send_slot(db, cid)
    assert ok is False
    assert "hourly_limit_reached" in why


@pytest.mark.asyncio
async def test_daily_limit_blocks(db, cid):
    await db.campaign_settings.insert_one({
        "company_id": cid,
        "anti_block": {"enabled": True, "hourly_limit": 100, "daily_limit": 5,
                       "interval_min_seconds": 0, "interval_max_seconds": 0,
                       "burst_size": 0, "burst_pause_seconds": 0}
    })
    now = datetime.now(timezone.utc)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    hour_start = now.replace(minute=0, second=0, microsecond=0)
    await db.send_gate_stats.insert_one({
        "company_id": cid, "channel": "whatsapp",
        "hour_count": 0, "day_count": 5,
        "hour_marker": hour_start.isoformat(),
        "day_marker": day_start.isoformat(),
    })
    ok, why = await send_gate.acquire_send_slot(db, cid)
    assert ok is False
    assert "daily_limit_reached" in why


@pytest.mark.asyncio
async def test_cadence_blocks_then_allows(db, cid):
    await db.campaign_settings.insert_one({
        "company_id": cid,
        "anti_block": {"enabled": True, "hourly_limit": 100, "daily_limit": 100,
                       "interval_min_seconds": 60, "interval_max_seconds": 120,
                       "burst_size": 0, "burst_pause_seconds": 0,
                       "escalate_after": 0}
    })
    now = datetime.now(timezone.utc)
    # last send 5s ago -> blocked
    await db.send_gate_stats.insert_one({
        "company_id": cid, "channel": "whatsapp",
        "hour_count": 1, "day_count": 1,
        "hour_marker": now.replace(minute=0, second=0, microsecond=0).isoformat(),
        "day_marker": now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat(),
        "last_send_at": (now - timedelta(seconds=5)).isoformat(),
    })
    ok, why = await send_gate.acquire_send_slot(db, cid)
    assert ok is False
    assert why.startswith("cadence")

    # last send 200s ago -> allowed
    await db.send_gate_stats.update_one(
        {"company_id": cid, "channel": "whatsapp"},
        {"$set": {"last_send_at": (now - timedelta(seconds=200)).isoformat()}}
    )
    ok, why = await send_gate.acquire_send_slot(db, cid)
    assert ok is True
    assert why == "ok"


@pytest.mark.asyncio
async def test_burst_pause(db, cid):
    await db.campaign_settings.insert_one({
        "company_id": cid,
        "anti_block": {"enabled": True, "hourly_limit": 500, "daily_limit": 500,
                       "interval_min_seconds": 1, "interval_max_seconds": 2,
                       "burst_size": 5, "burst_pause_seconds": 300,
                       "escalate_after": 0}
    })
    now = datetime.now(timezone.utc)
    # day_count multiple of burst_size (5), last send 10s ago (>min but <burst_pause)
    await db.send_gate_stats.insert_one({
        "company_id": cid, "channel": "whatsapp",
        "hour_count": 5, "day_count": 5,
        "hour_marker": now.replace(minute=0, second=0, microsecond=0).isoformat(),
        "day_marker": now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat(),
        "last_send_at": (now - timedelta(seconds=10)).isoformat(),
    })
    ok, why = await send_gate.acquire_send_slot(db, cid)
    assert ok is False
    assert "burst_pause" in why


@pytest.mark.asyncio
async def test_escalation_multiplies_interval(db, cid):
    await db.campaign_settings.insert_one({
        "company_id": cid,
        "anti_block": {"enabled": True, "hourly_limit": 500, "daily_limit": 500,
                       "interval_min_seconds": 10, "interval_max_seconds": 20,
                       "burst_size": 0, "burst_pause_seconds": 0,
                       "escalate_after": 10, "escalate_factor": 3.0}
    })
    now = datetime.now(timezone.utc)
    # day_count >= escalate_after -> min interval becomes 10*3=30
    await db.send_gate_stats.insert_one({
        "company_id": cid, "channel": "whatsapp",
        "hour_count": 10, "day_count": 10,
        "hour_marker": now.replace(minute=0, second=0, microsecond=0).isoformat(),
        "day_marker": now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat(),
        "last_send_at": (now - timedelta(seconds=15)).isoformat(),
    })
    ok, why = await send_gate.acquire_send_slot(db, cid)
    # 15s < 30s (escalated) -> should block on cadence
    assert ok is False
    assert why.startswith("cadence")
    # verify the min shown is 30 (10 * 3)
    assert "min=30s" in why


@pytest.mark.asyncio
async def test_record_send_increments_and_resets(db, cid):
    now = datetime.now(timezone.utc)
    await send_gate.record_send(db, cid)
    stats = await db.send_gate_stats.find_one({"company_id": cid}, {"_id": 0})
    assert stats["hour_count"] == 1
    assert stats["day_count"] == 1
    assert stats["last_send_at"] is not None

    await send_gate.record_send(db, cid)
    stats = await db.send_gate_stats.find_one({"company_id": cid}, {"_id": 0})
    assert stats["hour_count"] == 2
    assert stats["day_count"] == 2

    # Simulate previous hour marker -> hour_count should reset to 1
    old_hour = (now - timedelta(hours=2)).replace(minute=0, second=0, microsecond=0)
    await db.send_gate_stats.update_one(
        {"company_id": cid, "channel": "whatsapp"},
        {"$set": {"hour_marker": old_hour.isoformat(), "hour_count": 42}}
    )
    await send_gate.record_send(db, cid)
    stats = await db.send_gate_stats.find_one({"company_id": cid}, {"_id": 0})
    assert stats["hour_count"] == 1  # reset because marker changed


# ============================================================
# SECTION 2 — scheduler integration with gate
# ============================================================
@pytest.mark.asyncio
async def test_billing_reminders_gate_limits_to_one(db, cid, monkeypatch):
    """With hourly_limit=1, only ONE parcela should send even if 3 are eligible."""
    # Config: enabled, days_list covers 60d, gen_days 70d
    await db.system_settings.update_one(
        {"key": "billing_reminder"},
        {"$set": {"key": "billing_reminder",
                  "enabled": True,
                  "days_before_due_list": [60],
                  "lancamento_gen_days": 70,
                  "default_message": "Cobranca {{parcela}}",
                  "channel": "whatsapp"}},
        upsert=True,
    )
    # SA system connection
    await db.channel_connections.insert_one({
        "id": f"{TEST_TAG}saconn",
        "company_id": "_super_admin_system_",
        "status": "connected",
    })
    # Company
    first_due = datetime.now(timezone.utc).date().isoformat()
    await db.companies.insert_one({
        "id": cid, "name": "TESTCO", "phone": "5511999999999",
        "monthly_price": 100.0, "installments": 3, "billing_cycle": "monthly",
        "first_due_date": first_due, "status": "active",
    })
    # Anti-block for THIS company: hourly_limit=1
    await db.campaign_settings.insert_one({
        "company_id": cid,
        "anti_block": {"enabled": True, "hourly_limit": 1, "daily_limit": 100,
                       "interval_min_seconds": 0, "interval_max_seconds": 0,
                       "burst_size": 0, "burst_pause_seconds": 0}
    })

    call_count = {"n": 0}

    async def fake_send(conn_id, phone, text):
        call_count["n"] += 1
        return True, None

    async def fake_record_in_ticket(*args, **kwargs):
        return None

    monkeypatch.setattr(scheduler, "_send_billing_reminder", fake_send)
    monkeypatch.setattr(scheduler, "_record_billing_reminder_in_ticket", fake_record_in_ticket)

    await scheduler._process_billing_reminders(db)

    # 3 parcelas eligible, gate should allow only 1
    assert call_count["n"] == 1, f"Expected 1 send, got {call_count['n']}"
    stats = await db.send_gate_stats.find_one({"company_id": cid}, {"_id": 0})
    assert stats is not None
    assert stats["hour_count"] == 1


@pytest.mark.asyncio
async def test_reminders_gate_limits_to_one(db, cid, monkeypatch):
    """Two appointments in the reminder window, hourly_limit=1 -> only 1 sent."""
    await db.companies.insert_one({"id": cid, "name": "TESTCO2", "status": "active"})
    await db.notification_settings.insert_one({
        "company_id": cid, "booking_reminder_24h": True,
        "reminder_minutes_before": 60,
    })
    await db.campaign_settings.insert_one({
        "company_id": cid,
        "anti_block": {"enabled": True, "hourly_limit": 1, "daily_limit": 100,
                       "interval_min_seconds": 0, "interval_max_seconds": 0,
                       "burst_size": 0, "burst_pause_seconds": 0}
    })
    target = datetime.now(timezone.utc) + timedelta(minutes=60)
    date_str = target.strftime("%Y-%m-%d")
    time_str = target.strftime("%H:%M")
    for i in range(2):
        await db.appointments.insert_one({
            "id": f"{TEST_TAG}apt{i}",
            "company_id": cid,
            "status": "confirmado",
            "date": date_str,
            "time": time_str,
        })

    call_count = {"n": 0}

    async def fake_notify(*args, **kwargs):
        call_count["n"] += 1

    import notifications
    monkeypatch.setattr(notifications, "notify_appointment_reminder", fake_notify)

    await scheduler._process_reminders(db, "http://test")
    assert call_count["n"] == 1, f"Expected 1 reminder send, got {call_count['n']}"


@pytest.mark.asyncio
async def test_surveys_gate_limits_to_one(db, cid, monkeypatch):
    """Two concluded appointments in survey window, hourly_limit=1 -> only 1."""
    await db.companies.insert_one({"id": cid, "name": "TESTCO3", "status": "active"})
    await db.notification_settings.insert_one({
        "company_id": cid, "survey_enabled": True,
        "survey_minutes_after": 120,
    })
    await db.campaign_settings.insert_one({
        "company_id": cid,
        "anti_block": {"enabled": True, "hourly_limit": 1, "daily_limit": 100,
                       "interval_min_seconds": 0, "interval_max_seconds": 0,
                       "burst_size": 0, "burst_pause_seconds": 0}
    })
    concluded_at = (datetime.now(timezone.utc) - timedelta(minutes=120)).isoformat()
    for i in range(2):
        await db.appointments.insert_one({
            "id": f"{TEST_TAG}apt_s{i}",
            "company_id": cid,
            "status": "concluido",
            "concluded_at": concluded_at,
        })

    call_count = {"n": 0}

    async def fake_notify(*args, **kwargs):
        call_count["n"] += 1

    import notifications
    monkeypatch.setattr(notifications, "notify_satisfaction_survey", fake_notify)

    await scheduler._process_surveys(db, "http://test")
    assert call_count["n"] == 1, f"Expected 1 survey send, got {call_count['n']}"


# ============================================================
# SECTION 3 — regression: /api/crm/campaign-settings
# ============================================================
class TestCampaignSettingsAPI:
    def _login(self):
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": "crm@test.com", "password": "crm123"},
                          timeout=15)
        assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
        return r.json()["access_token"]

    def test_get_campaign_settings(self):
        token = self._login()
        r = requests.get(f"{BASE_URL}/api/crm/campaign-settings",
                         headers={"Authorization": f"Bearer {token}"}, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "anti_block" in data
        assert isinstance(data["anti_block"], dict)

    def test_put_campaign_settings_persists(self):
        token = self._login()
        payload = {"anti_block": {"enabled": True, "hourly_limit": 42,
                                  "daily_limit": 999,
                                  "interval_min_seconds": 15,
                                  "interval_max_seconds": 45,
                                  "burst_size": 10, "burst_pause_seconds": 120,
                                  "escalate_after": 50, "escalate_factor": 2.0}}
        r = requests.put(f"{BASE_URL}/api/crm/campaign-settings",
                         headers={"Authorization": f"Bearer {token}"},
                         json=payload, timeout=15)
        assert r.status_code == 200
        # Re-fetch and verify
        r2 = requests.get(f"{BASE_URL}/api/crm/campaign-settings",
                          headers={"Authorization": f"Bearer {token}"}, timeout=15)
        assert r2.status_code == 200
        got = r2.json()
        assert got["anti_block"]["hourly_limit"] == 42
        assert got["anti_block"]["daily_limit"] == 999
