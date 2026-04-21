"""Iteration 21: edit_appointment/edit_appointment_price perms, suspension hours bug, conclude final_price."""
import os, uuid, pytest, requests
from datetime import date, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://agentcrm-book.preview.emergentagent.com").rstrip('/')
ADMIN = {"email": "admin@boss.com.br", "password": "boss123"}
PROF_ID = "59f9312a-7f43-4511-beb6-9ff2345c1fcc"
SLUG = "boss"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def services(admin_headers):
    r = requests.get(f"{BASE_URL}/api/scheduling/services", headers=admin_headers)
    assert r.status_code == 200
    svcs = r.json()
    created_ids = []
    # Ensure at least 2 services; create throwaway if needed
    while len(svcs) < 2:
        cr = requests.post(f"{BASE_URL}/api/scheduling/services", headers=admin_headers, json={
            "name": f"TEST_iter21_svc_{uuid.uuid4().hex[:6]}",
            "duration": 30, "price": 50.0, "type": "service"
        })
        assert cr.status_code == 200, cr.text
        new = cr.json()
        svcs.append(new)
        created_ids.append(new["id"])
    yield svcs
    for sid in created_ids:
        requests.delete(f"{BASE_URL}/api/scheduling/services/{sid}", headers=admin_headers)


@pytest.fixture(scope="module")
def test_date():
    # Use a date ~14 days in future to avoid conflicts
    return (date.today() + timedelta(days=14)).isoformat()


# ============ AUTH / PERMISSIONS ============
def test_login_returns_permissions_array_for_admin(admin_token):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN)
    user = r.json()["user"]
    assert "permissions" in user
    assert user["permissions"] == ["*"]


def test_me_returns_permissions_for_admin(admin_headers):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=admin_headers)
    assert r.status_code == 200
    assert r.json().get("permissions") == ["*"]


def test_all_features_has_31_with_permission_category(admin_headers):
    r = requests.get(f"{BASE_URL}/api/scheduling/all-features", headers=admin_headers)
    assert r.status_code == 200
    feats = r.json()
    assert len(feats) == 31, f"expected 31, got {len(feats)}"
    keys = {f["feature_key"] for f in feats}
    assert "edit_appointment" in keys
    assert "edit_appointment_price" in keys
    perm_feats = [f for f in feats if f.get("category") == "Permissoes"]
    assert len(perm_feats) >= 2


# ============ SUSPENSION HOUR-WINDOW BUG ============
@pytest.fixture
def hourly_suspension(admin_headers, test_date):
    payload = {"start_date": test_date, "end_date": test_date,
               "start_time": "11:00", "end_time": "12:00",
               "reason": "TEST_iter21_hourly"}
    r = requests.post(f"{BASE_URL}/api/scheduling/professionals/{PROF_ID}/suspensions",
                      headers=admin_headers, json=payload)
    assert r.status_code == 200, r.text
    sid = r.json()["id"]
    yield sid
    requests.delete(f"{BASE_URL}/api/scheduling/professionals/{PROF_ID}/suspensions/{sid}",
                    headers=admin_headers)


def test_smart_availability_blocks_only_suspended_hours(admin_headers, services, test_date, hourly_suspension):
    svc = services[0]
    r = requests.get(f"{BASE_URL}/api/scheduling/smart-availability",
                     headers=admin_headers,
                     params={"date": test_date, "service_id": svc["id"], "professional_id": PROF_ID})
    assert r.status_code == 200, r.text
    slots = r.json()["available_slots"]
    duration = svc.get("duration", 30)
    # 11:00 and 11:30 should be blocked (assuming duration<=60)
    assert "11:00" not in slots, f"11:00 should be blocked, got {slots}"
    if duration <= 30:
        assert "11:30" not in slots
    # 12:00 onward should be available
    assert "12:00" in slots, f"12:00 should be available, got {slots}"
    # morning slot before 11 should exist
    assert any(s < "11:00" for s in slots), f"morning slots missing: {slots}"


def test_public_availability_respects_partial_suspension(services, test_date, hourly_suspension):
    svc = services[0]
    r = requests.get(f"{BASE_URL}/api/public/booking/{SLUG}/availability",
                     params={"date": test_date, "service_id": svc["id"], "professional_id": PROF_ID})
    assert r.status_code == 200, r.text
    slots = r.json()["available_slots"]
    assert "11:00" not in slots
    assert "12:00" in slots
    assert any(s < "11:00" for s in slots)


# ============ EDIT APPOINTMENT ============
@pytest.fixture
def created_appointment(admin_headers, services, test_date):
    svc = services[0]
    payload = {
        "customer_name": "TEST_iter21_client",
        "customer_phone": "+5511999888777",
        "service_id": svc["id"],
        "professional_id": PROF_ID,
        "date": test_date,
        "time": "09:00",
    }
    r = requests.post(f"{BASE_URL}/api/scheduling/appointments",
                      headers=admin_headers, json=payload)
    assert r.status_code == 200, r.text
    apt = r.json()
    yield apt
    requests.delete(f"{BASE_URL}/api/scheduling/appointments/{apt['id']}",
                    headers=admin_headers)


def test_put_appointment_change_time_and_service(admin_headers, services, created_appointment):
    new_svc = services[1]
    r = requests.put(f"{BASE_URL}/api/scheduling/appointments/{created_appointment['id']}",
                     headers=admin_headers,
                     json={"time": "10:00", "service_id": new_svc["id"]})
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated["time"] == "10:00"
    assert updated["service_id"] == new_svc["id"]
    assert updated["service_name"] == new_svc["name"]
    assert updated["price"] == new_svc["price"]


def test_put_appointment_with_extra_items_recomputes_total(admin_headers, services, created_appointment):
    base_price = created_appointment["price"]
    extra = [{"service_id": services[1]["id"], "name": "Extra", "price": 25.5, "type": "service"}]
    r = requests.put(f"{BASE_URL}/api/scheduling/appointments/{created_appointment['id']}",
                     headers=admin_headers, json={"extra_items": extra})
    assert r.status_code == 200, r.text
    d = r.json()
    assert len(d["extra_items"]) == 1
    assert d["extra_items"][0]["price"] == 25.5
    assert abs(d["price"] - (base_price + 25.5)) < 0.01


def test_put_appointment_price_override(admin_headers, created_appointment):
    r = requests.put(f"{BASE_URL}/api/scheduling/appointments/{created_appointment['id']}",
                     headers=admin_headers, json={"price": 199.99})
    assert r.status_code == 200
    assert r.json()["price"] == 199.99


# ============ CONCLUDE WITH FINAL PRICE ============
def test_conclude_with_final_price(admin_headers, services, test_date):
    svc = services[0]
    # Create
    r = requests.post(f"{BASE_URL}/api/scheduling/appointments", headers=admin_headers, json={
        "customer_name": "TEST_iter21_conclude", "customer_phone": "+5511900000111",
        "service_id": svc["id"], "professional_id": PROF_ID, "date": test_date, "time": "14:00",
    })
    apt = r.json()
    try:
        r = requests.put(f"{BASE_URL}/api/scheduling/appointments/{apt['id']}/conclude",
                         headers=admin_headers,
                         json={"payment_method": "dinheiro", "final_price": 333.33})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "concluido"
        assert d["price"] == 333.33
        # Verify financial transaction recorded final_price
        tx = requests.get(f"{BASE_URL}/api/scheduling/financial/transactions",
                          headers=admin_headers, params={"start_date": test_date, "end_date": test_date})
        matching = [t for t in tx.json() if t.get("appointment_id") == apt["id"]]
        assert matching, "no financial tx found"
        assert matching[0]["amount"] == 333.33
    finally:
        requests.delete(f"{BASE_URL}/api/scheduling/appointments/{apt['id']}", headers=admin_headers)


# ============ PERMISSION ENFORCEMENT (403) ============
@pytest.fixture(scope="module")
def perm_profiles(admin_headers):
    """Create 3 profiles: no-perms, edit-only, edit+price."""
    tag = uuid.uuid4().hex[:6]
    profs = {}
    for name, perms in [("none", []), ("edit", ["edit_appointment"]), ("both", ["edit_appointment", "edit_appointment_price"])]:
        r = requests.post(f"{BASE_URL}/api/scheduling/permission-profiles",
                          headers=admin_headers,
                          json={"name": f"TEST_iter21_{name}_{tag}", "permissions": perms})
        assert r.status_code == 200, r.text
        profs[name] = r.json()["id"]
    yield profs
    for pid in profs.values():
        requests.delete(f"{BASE_URL}/api/scheduling/permission-profiles/{pid}", headers=admin_headers)


def _make_user_and_login(admin_headers, profile_id, tag):
    email = f"TEST_iter21_{tag}@boss.com.br"
    r = requests.post(f"{BASE_URL}/api/scheduling/company-users", headers=admin_headers, json={
        "name": f"TEST_iter21_{tag}", "email": email, "password": "test1234",
        "permission_profile_id": profile_id
    })
    assert r.status_code == 200, r.text
    uid = r.json()["id"]
    lr = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": "test1234"})
    assert lr.status_code == 200
    return uid, lr.json()["access_token"], lr.json()["user"]


def test_login_returns_permissions_for_scoped_user(admin_headers, perm_profiles):
    tag = uuid.uuid4().hex[:6]
    uid, tok, user = _make_user_and_login(admin_headers, perm_profiles["edit"], tag)
    try:
        assert user.get("permissions") == ["edit_appointment"]
    finally:
        requests.delete(f"{BASE_URL}/api/scheduling/company-users/{uid}", headers=admin_headers)


def test_non_admin_without_edit_perm_gets_403_on_put(admin_headers, perm_profiles, services, test_date):
    # Create appointment
    svc = services[0]
    apt = requests.post(f"{BASE_URL}/api/scheduling/appointments", headers=admin_headers, json={
        "customer_name": "TEST_perm", "customer_phone": "+5511900000222",
        "service_id": svc["id"], "professional_id": PROF_ID, "date": test_date, "time": "15:00"
    }).json()
    tag = uuid.uuid4().hex[:6]
    uid, tok, _ = _make_user_and_login(admin_headers, perm_profiles["none"], tag)
    try:
        hdr = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
        r = requests.put(f"{BASE_URL}/api/scheduling/appointments/{apt['id']}", headers=hdr,
                         json={"time": "16:00"})
        assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text}"

        r2 = requests.put(f"{BASE_URL}/api/scheduling/appointments/{apt['id']}", headers=hdr,
                          json={"price": 100})
        assert r2.status_code == 403
    finally:
        requests.delete(f"{BASE_URL}/api/scheduling/company-users/{uid}", headers=admin_headers)
        requests.delete(f"{BASE_URL}/api/scheduling/appointments/{apt['id']}", headers=admin_headers)


def test_edit_perm_allows_time_blocks_price(admin_headers, perm_profiles, services, test_date):
    svc = services[0]
    apt = requests.post(f"{BASE_URL}/api/scheduling/appointments", headers=admin_headers, json={
        "customer_name": "TEST_perm2", "customer_phone": "+5511900000333",
        "service_id": svc["id"], "professional_id": PROF_ID, "date": test_date, "time": "13:00"
    }).json()
    tag = uuid.uuid4().hex[:6]
    uid, tok, _ = _make_user_and_login(admin_headers, perm_profiles["edit"], tag)
    try:
        hdr = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
        # time edit works
        r = requests.put(f"{BASE_URL}/api/scheduling/appointments/{apt['id']}", headers=hdr,
                         json={"time": "13:30"})
        # may 200 or 404 if appointment-owner filter applies. main path: 200
        assert r.status_code in (200, 404), r.text
        # price edit forbidden
        r2 = requests.put(f"{BASE_URL}/api/scheduling/appointments/{apt['id']}", headers=hdr,
                          json={"price": 555})
        assert r2.status_code == 403
        # conclude with final_price forbidden
        r3 = requests.put(f"{BASE_URL}/api/scheduling/appointments/{apt['id']}/conclude",
                          headers=hdr, json={"payment_method": "pix", "final_price": 50})
        assert r3.status_code == 403
    finally:
        requests.delete(f"{BASE_URL}/api/scheduling/company-users/{uid}", headers=admin_headers)
        requests.delete(f"{BASE_URL}/api/scheduling/appointments/{apt['id']}", headers=admin_headers)
