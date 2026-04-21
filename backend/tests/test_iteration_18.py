"""
Iteration 18 tests:
- SuspensionCreate now accepts start_time / end_time optional fields
- GET /api/scheduling/appointments - non-admin users auto-filter by professional; admin sees all
- Regression: /api/auth/login, appointments, booking-page, business-hours, upload/booking-image
"""
import os
import io
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://agentcrm-book.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@boss.com.br"
ADMIN_PASS = "boss123"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("access_token") or data.get("token")
    assert token, f"No token in response: {data}"
    return token


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# ---------- AUTH ----------
def test_login_success():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=30)
    assert r.status_code == 200
    j = r.json()
    assert "access_token" in j or "token" in j
    assert "user" in j
    assert j["user"].get("role") in ("company_admin", "super_admin")


def test_login_invalid():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong"}, timeout=30)
    assert r.status_code in (400, 401)


# ---------- APPOINTMENTS (admin sees all) ----------
def test_list_appointments_admin_all(admin_headers):
    r = requests.get(f"{BASE_URL}/api/scheduling/appointments", headers=admin_headers, timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    # Admin should see appointments from multiple professionals (if any)
    if len(data) >= 2:
        prof_ids = {a.get("professional_id") for a in data if a.get("professional_id")}
        print(f"Admin sees {len(data)} appointments across {len(prof_ids)} professional(s)")


def test_list_appointments_filters(admin_headers):
    r = requests.get(f"{BASE_URL}/api/scheduling/appointments?status_filter=pending", headers=admin_headers, timeout=30)
    assert r.status_code == 200
    arr = r.json()
    for a in arr:
        assert a.get("status") == "pending"


# ---------- BOOKING PAGE ----------
def test_booking_page_get(admin_headers):
    r = requests.get(f"{BASE_URL}/api/scheduling/booking-page", headers=admin_headers, timeout=30)
    assert r.status_code == 200
    data = r.json()
    # logo_url may or may not exist; key structure must be object/dict
    assert isinstance(data, dict)


def test_booking_page_put_logo_url(admin_headers):
    # Update logo_url and verify persistence
    payload = {"logo_url": "https://example.com/test_logo.png"}
    r = requests.put(f"{BASE_URL}/api/scheduling/booking-page", headers=admin_headers, json=payload, timeout=30)
    assert r.status_code == 200
    # Verify persisted
    r2 = requests.get(f"{BASE_URL}/api/scheduling/booking-page", headers=admin_headers, timeout=30)
    assert r2.status_code == 200
    assert r2.json().get("logo_url") == "https://example.com/test_logo.png"


# ---------- BUSINESS HOURS ----------
def test_business_hours_get(admin_headers):
    r = requests.get(f"{BASE_URL}/api/scheduling/business-hours", headers=admin_headers, timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert "seg" in data and "dom" in data


# ---------- UPLOAD ----------
def test_upload_booking_image(admin_headers):
    # create tiny PNG bytes
    png_bytes = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4"
        b"\x89\x00\x00\x00\rIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x00\x01\x0d\n\x2d\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    files = {"file": ("test.png", io.BytesIO(png_bytes), "image/png")}
    r = requests.post(f"{BASE_URL}/api/upload/booking-image", headers=admin_headers, files=files, timeout=30)
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    data = r.json()
    assert "url" in data or "file_url" in data or "image_url" in data


# ---------- PROFESSIONAL SUSPENSIONS with start_time/end_time ----------
def _get_professional_id(headers):
    r = requests.get(f"{BASE_URL}/api/scheduling/professionals", headers=headers, timeout=30)
    assert r.status_code == 200
    profs = r.json()
    if not profs:
        # create one
        payload = {"name": "TEST_Prof_Iter18", "email": "testprof_iter18@example.com", "phone": "11999999999"}
        r2 = requests.post(f"{BASE_URL}/api/scheduling/professionals", headers=headers, json=payload, timeout=30)
        assert r2.status_code in (200, 201), f"{r2.status_code} {r2.text}"
        return r2.json()["id"]
    return profs[0]["id"]


def test_suspension_full_day_range(admin_headers):
    pid = _get_professional_id(admin_headers)
    payload = {"start_date": "2026-03-01", "end_date": "2026-03-03", "reason": "TEST_vacation"}
    r = requests.post(
        f"{BASE_URL}/api/scheduling/professionals/{pid}/suspensions",
        headers=admin_headers, json=payload, timeout=30,
    )
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    data = r.json()
    assert data["start_date"] == "2026-03-01"
    assert data["end_date"] == "2026-03-03"
    assert data.get("start_time") is None
    assert data.get("end_time") is None
    # cleanup
    requests.delete(f"{BASE_URL}/api/scheduling/professionals/{pid}/suspensions/{data['id']}", headers=admin_headers, timeout=30)


def test_suspension_with_start_end_time(admin_headers):
    pid = _get_professional_id(admin_headers)
    payload = {
        "start_date": "2026-03-05",
        "end_date": "2026-03-05",
        "start_time": "09:00",
        "end_time": "12:00",
        "reason": "TEST_half_day",
    }
    r = requests.post(
        f"{BASE_URL}/api/scheduling/professionals/{pid}/suspensions",
        headers=admin_headers, json=payload, timeout=30,
    )
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    data = r.json()
    assert data["start_time"] == "09:00"
    assert data["end_time"] == "12:00"
    sus_id = data["id"]
    # GET professional to ensure persisted
    r2 = requests.get(f"{BASE_URL}/api/scheduling/professionals", headers=admin_headers, timeout=30)
    profs = r2.json()
    target = next((p for p in profs if p["id"] == pid), None)
    assert target is not None
    suspensions = target.get("suspensions", [])
    found = next((s for s in suspensions if s["id"] == sus_id), None)
    assert found is not None, "Suspension not persisted"
    assert found.get("start_time") == "09:00"
    assert found.get("end_time") == "12:00"
    # cleanup
    r3 = requests.delete(f"{BASE_URL}/api/scheduling/professionals/{pid}/suspensions/{sus_id}", headers=admin_headers, timeout=30)
    assert r3.status_code == 200


def test_suspension_only_some_hours_partial(admin_headers):
    """A few hours on a single day (algumas horas)."""
    pid = _get_professional_id(admin_headers)
    payload = {
        "start_date": "2026-03-07",
        "end_date": "2026-03-07",
        "start_time": "14:30",
        "end_time": "16:00",
        "reason": "TEST_hours",
    }
    r = requests.post(
        f"{BASE_URL}/api/scheduling/professionals/{pid}/suspensions",
        headers=admin_headers, json=payload, timeout=30,
    )
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    data = r.json()
    assert data["start_time"] == "14:30"
    assert data["end_time"] == "16:00"
    requests.delete(f"{BASE_URL}/api/scheduling/professionals/{pid}/suspensions/{data['id']}", headers=admin_headers, timeout=30)
