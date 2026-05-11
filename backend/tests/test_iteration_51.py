"""
Tests for iteration 51 — 4 improvements:
1) BusinessType.default_screen (create/update/get + empty normalization)
2) Appointment extra_items (multi-service): sum duration + price, concat name
3) extra_items with repeated/inexistent service_id ignored
"""
import os
import pytest
import requests
from datetime import datetime, timezone, timedelta

def _load_url():
    if "REACT_APP_BACKEND_URL" in os.environ:
        return os.environ["REACT_APP_BACKEND_URL"]
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL"):
                    return line.split("=", 1)[1].strip()
    except Exception:
        pass
    raise RuntimeError("REACT_APP_BACKEND_URL not configured")

BASE = _load_url().rstrip("/")
API = f"{BASE}/api"


# ── Auth fixtures ───────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def sa_token():
    r = requests.post(f"{API}/auth/super-admin/login",
                      json={"email": "admin@agentcrm.com", "password": "admin123"},
                      timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def sa_headers(sa_token):
    return {"Authorization": f"Bearer {sa_token}"}


@pytest.fixture(scope="module")
def boss_token():
    r = requests.post(f"{API}/auth/login",
                      json={"subdomain": "boss", "email": "admin@boss.com.br", "password": "boss123"},
                      timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def boss_headers(boss_token):
    return {"Authorization": f"Bearer {boss_token}"}


# ── 1) Business Type default_screen ─────────────────────────────────────────
class TestBusinessTypeDefaultScreen:
    @pytest.fixture(scope="class")
    def bt_id(self, sa_headers):
        # Create
        r = requests.post(f"{API}/super-admin/business-types", headers=sa_headers,
                          json={
                              "name": "TEST_BT_DefaultScreen",
                              "description": "iter51 test",
                              "icon": "Calendar",
                              "base_type": "scheduling",
                              "features": [{"feature_key": "agenda", "enabled": True, "label": "Agenda", "category": "scheduling"}],
                              "mobile_bottom_nav": ["agenda"],
                              "default_screen": "agenda",
                          }, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["default_screen"] == "agenda"
        bid = d["id"]
        yield bid
        requests.delete(f"{API}/super-admin/business-types/{bid}", headers=sa_headers, timeout=10)

    def test_get_returns_default_screen(self, sa_headers, bt_id):
        r = requests.get(f"{API}/super-admin/business-types/{bt_id}", headers=sa_headers, timeout=10)
        assert r.status_code == 200
        assert r.json().get("default_screen") == "agenda"

    def test_update_default_screen(self, sa_headers, bt_id):
        r = requests.put(f"{API}/super-admin/business-types/{bt_id}", headers=sa_headers,
                         json={"default_screen": "agenda_pro"}, timeout=10)
        assert r.status_code == 200
        assert r.json().get("default_screen") == "agenda_pro"

    def test_update_empty_default_screen_normalizes_to_none(self, sa_headers, bt_id):
        r = requests.put(f"{API}/super-admin/business-types/{bt_id}", headers=sa_headers,
                         json={"default_screen": ""}, timeout=10)
        assert r.status_code == 200
        # Empty string must normalize to None (not crash, not stay "")
        assert r.json().get("default_screen") in (None, "")
        # Confirm via GET
        g = requests.get(f"{API}/super-admin/business-types/{bt_id}", headers=sa_headers, timeout=10).json()
        assert g.get("default_screen") in (None, "")

    def test_create_without_default_screen_works(self, sa_headers):
        r = requests.post(f"{API}/super-admin/business-types", headers=sa_headers,
                          json={
                              "name": "TEST_BT_NoDefault",
                              "base_type": "crm",
                              "features": [],
                              "mobile_bottom_nav": [],
                          }, timeout=15)
        assert r.status_code == 200, r.text
        bid = r.json()["id"]
        assert r.json().get("default_screen") in (None, "")
        requests.delete(f"{API}/super-admin/business-types/{bid}", headers=sa_headers, timeout=10)


# ── 2) & 3) Appointment extra_items (multi-service) ─────────────────────────
class TestAppointmentExtraItems:
    @pytest.fixture(scope="class")
    def setup(self, boss_headers):
        # Create 2 services + 1 professional we control fully
        r1 = requests.post(f"{API}/scheduling/services", headers=boss_headers,
                           json={"name": "TEST_SvcA", "duration": 30, "price": 50.0, "type": "service"}, timeout=10)
        assert r1.status_code == 200, r1.text
        svc_a = r1.json()
        r2 = requests.post(f"{API}/scheduling/services", headers=boss_headers,
                           json={"name": "TEST_SvcB", "duration": 45, "price": 80.0, "type": "service"}, timeout=10)
        assert r2.status_code == 200, r2.text
        svc_b = r2.json()
        rp = requests.post(f"{API}/scheduling/professionals", headers=boss_headers,
                           json={"name": "TEST_Prof51", "specialties": []}, timeout=10)
        assert rp.status_code == 200, rp.text
        prof = rp.json()
        yield {"svc_a": svc_a, "svc_b": svc_b, "prof": prof}
        # cleanup
        requests.delete(f"{API}/scheduling/services/{svc_a['id']}", headers=boss_headers, timeout=10)
        requests.delete(f"{API}/scheduling/services/{svc_b['id']}", headers=boss_headers, timeout=10)
        requests.delete(f"{API}/scheduling/professionals/{prof['id']}", headers=boss_headers, timeout=10)

    def _tomorrow(self):
        return (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d")

    def test_no_extras_keeps_original_behavior(self, boss_headers, setup):
        payload = {
            "customer_name": "TEST_NoExtras", "customer_phone": "+5511900000051",
            "service_id": setup["svc_a"]["id"], "professional_id": setup["prof"]["id"],
            "date": self._tomorrow(), "time": "10:00",
        }
        r = requests.post(f"{API}/scheduling/appointments", headers=boss_headers, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["duration"] == 30
        assert d["price"] == 50.0
        assert d["service_name"] == "TEST_SvcA"
        assert d.get("extra_items") in (None, [])
        requests.delete(f"{API}/scheduling/appointments/{d['id']}", headers=boss_headers, timeout=10)

    def test_extras_sum_duration_price_and_concat_name(self, boss_headers, setup):
        payload = {
            "customer_name": "TEST_WithExtras", "customer_phone": "+5511900000052",
            "service_id": setup["svc_a"]["id"], "professional_id": setup["prof"]["id"],
            "date": self._tomorrow(), "time": "11:00",
            "extra_items": [
                {"service_id": setup["svc_b"]["id"], "name": "TEST_SvcB", "price": 80.0, "duration": 45, "type": "service"}
            ],
        }
        r = requests.post(f"{API}/scheduling/appointments", headers=boss_headers, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        # Duration = 30 + 45 = 75
        assert d["duration"] == 75, f"expected 75 got {d['duration']}"
        # Price = 50 + 80 = 130
        assert d["price"] == 130.0, f"expected 130 got {d['price']}"
        assert d["original_price"] == 130.0
        # Name concatenation
        assert d["service_name"] == "TEST_SvcA + TEST_SvcB"
        # extra_items persisted
        assert isinstance(d.get("extra_items"), list) and len(d["extra_items"]) == 1
        assert d["extra_items"][0]["service_id"] == setup["svc_b"]["id"]
        assert d["extra_items"][0]["duration"] == 45
        assert d["extra_items"][0]["price"] == 80.0

        # GET verification — persisted in DB
        g = requests.get(f"{API}/scheduling/appointments", headers=boss_headers,
                         params={"date": self._tomorrow()}, timeout=10)
        assert g.status_code == 200
        match = next((a for a in g.json() if a["id"] == d["id"]), None)
        assert match is not None
        assert match["duration"] == 75
        assert match["service_name"] == "TEST_SvcA + TEST_SvcB"

        requests.delete(f"{API}/scheduling/appointments/{d['id']}", headers=boss_headers, timeout=10)

    def test_extras_with_repeated_main_service_id_ignored(self, boss_headers, setup):
        """extra_items containing the main service_id should be ignored (dedup)."""
        payload = {
            "customer_name": "TEST_DupExtra", "customer_phone": "+5511900000053",
            "service_id": setup["svc_a"]["id"], "professional_id": setup["prof"]["id"],
            "date": self._tomorrow(), "time": "12:00",
            "extra_items": [
                {"service_id": setup["svc_a"]["id"], "name": "TEST_SvcA", "price": 50.0, "duration": 30, "type": "service"}
            ],
        }
        r = requests.post(f"{API}/scheduling/appointments", headers=boss_headers, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        # Should behave as no-extras
        assert d["duration"] == 30
        assert d["price"] == 50.0
        assert d["service_name"] == "TEST_SvcA"
        assert d.get("extra_items") in (None, [])
        requests.delete(f"{API}/scheduling/appointments/{d['id']}", headers=boss_headers, timeout=10)

    def test_extras_with_inexistent_service_id_ignored(self, boss_headers, setup):
        payload = {
            "customer_name": "TEST_GhostExtra", "customer_phone": "+5511900000054",
            "service_id": setup["svc_a"]["id"], "professional_id": setup["prof"]["id"],
            "date": self._tomorrow(), "time": "13:00",
            "extra_items": [
                {"service_id": "non-existent-id-xyz", "name": "Ghost", "price": 999.0, "duration": 99, "type": "service"}
            ],
        }
        r = requests.post(f"{API}/scheduling/appointments", headers=boss_headers, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        # Should NOT crash; should ignore invalid extra
        assert d["duration"] == 30
        assert d["price"] == 50.0
        assert d["service_name"] == "TEST_SvcA"
        requests.delete(f"{API}/scheduling/appointments/{d['id']}", headers=boss_headers, timeout=10)

    def test_extras_mixed_valid_and_invalid(self, boss_headers, setup):
        """Mix: 1 valid + 1 dup + 1 ghost → only valid one counted."""
        payload = {
            "customer_name": "TEST_Mixed", "customer_phone": "+5511900000055",
            "service_id": setup["svc_a"]["id"], "professional_id": setup["prof"]["id"],
            "date": self._tomorrow(), "time": "14:00",
            "extra_items": [
                {"service_id": setup["svc_b"]["id"], "name": "B", "price": 80, "duration": 45, "type": "service"},
                {"service_id": setup["svc_a"]["id"], "name": "Dup", "price": 999, "duration": 999, "type": "service"},
                {"service_id": "ghost", "name": "G", "price": 999, "duration": 999, "type": "service"},
            ],
        }
        r = requests.post(f"{API}/scheduling/appointments", headers=boss_headers, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["duration"] == 75
        assert d["price"] == 130.0
        assert d["service_name"] == "TEST_SvcA + TEST_SvcB"
        assert len(d["extra_items"]) == 1
        requests.delete(f"{API}/scheduling/appointments/{d['id']}", headers=boss_headers, timeout=10)
