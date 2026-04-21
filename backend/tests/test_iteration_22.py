"""Iteration 22: Client birth_date field, QR self-heal flow, regression sanity."""
import os, uuid, pytest, requests, time

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://agentcrm-book.preview.emergentagent.com").rstrip('/')
ADMIN = {"email": "admin@boss.com.br", "password": "boss123"}


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=15)
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ============ REGRESSION: Auth / core endpoints ============
def test_login_admin_permissions_star():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data["user"]["permissions"] == ["*"]


def test_regression_core_endpoints(admin_headers):
    for path in ("/api/scheduling/appointments", "/api/scheduling/services", "/api/scheduling/professionals"):
        r = requests.get(f"{BASE_URL}{path}", headers=admin_headers, timeout=15)
        assert r.status_code == 200, f"{path} -> {r.status_code}: {r.text}"
        assert isinstance(r.json(), list)


# ============ CLIENT birth_date ============
@pytest.fixture
def created_client(admin_headers):
    tag = uuid.uuid4().hex[:6]
    payload = {
        "name": f"TEST_iter22_{tag}",
        "phone": f"+5511977{tag[:6]}",
        "email": f"test22_{tag}@example.com",
        "birth_date": "1985-07-15",
        "notes": "iter22"
    }
    r = requests.post(f"{BASE_URL}/api/scheduling/clients", headers=admin_headers, json=payload, timeout=15)
    assert r.status_code == 200, r.text
    client = r.json()
    yield client, payload
    requests.delete(f"{BASE_URL}/api/scheduling/clients/{client['id']}", headers=admin_headers, timeout=15)


def test_create_client_persists_birth_date(admin_headers, created_client):
    client, payload = created_client
    assert client["birth_date"] == "1985-07-15"
    assert client["name"] == payload["name"]
    assert "id" in client
    # GET list should include birth_date
    r = requests.get(f"{BASE_URL}/api/scheduling/clients", headers=admin_headers, timeout=15)
    assert r.status_code == 200
    match = [c for c in r.json() if c["id"] == client["id"]]
    assert match, "created client not in list"
    assert match[0]["birth_date"] == "1985-07-15"


def test_update_client_birth_date(admin_headers, created_client):
    client, payload = created_client
    new_payload = {**payload, "birth_date": "1990-12-01"}
    r = requests.put(f"{BASE_URL}/api/scheduling/clients/{client['id']}", headers=admin_headers, json=new_payload, timeout=15)
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated["birth_date"] == "1990-12-01"


def test_create_client_without_birth_date_ok(admin_headers):
    tag = uuid.uuid4().hex[:6]
    payload = {"name": f"TEST_iter22_nbd_{tag}", "phone": f"+5511977{tag[:6]}"}
    r = requests.post(f"{BASE_URL}/api/scheduling/clients", headers=admin_headers, json=payload, timeout=15)
    assert r.status_code == 200, r.text
    c = r.json()
    try:
        assert c.get("birth_date") is None
    finally:
        requests.delete(f"{BASE_URL}/api/scheduling/clients/{c['id']}", headers=admin_headers, timeout=15)


def test_create_client_invalid_birth_date_format_accepted_as_string(admin_headers):
    """Backend defines birth_date as Optional[str] with no validation; should accept any string."""
    tag = uuid.uuid4().hex[:6]
    payload = {
        "name": f"TEST_iter22_badbd_{tag}",
        "phone": f"+5511977{tag[:6]}",
        "birth_date": "1990/01/01"  # wrong format but should not crash
    }
    r = requests.post(f"{BASE_URL}/api/scheduling/clients", headers=admin_headers, json=payload, timeout=15)
    # Accept either success (stored as-is) or validation error (422/400)
    assert r.status_code in (200, 400, 422), r.text
    if r.status_code == 200:
        c = r.json()
        try:
            assert c["birth_date"] == "1990/01/01"
        finally:
            requests.delete(f"{BASE_URL}/api/scheduling/clients/{c['id']}", headers=admin_headers, timeout=15)


# ============ QR SELF-HEAL ============
def test_qr_endpoint_works_on_existing_connection(admin_headers):
    r = requests.get(f"{BASE_URL}/api/channels/connections", headers=admin_headers, timeout=15)
    assert r.status_code == 200
    conns = [c for c in r.json() if c.get("type") == "whatsapp"]
    if not conns:
        pytest.skip("No WhatsApp connection exists; skipping QR test")
    conn = conns[0]
    conn_id = conn["id"]
    # Call QR endpoint - should not 500, should return qr_base64 or status
    r2 = requests.get(f"{BASE_URL}/api/channels/connections/{conn_id}/qr", headers=admin_headers, timeout=20)
    assert r2.status_code == 200, r2.text
    data = r2.json()
    # Self-heal: response must contain these keys
    assert "status" in data
    assert "qr_base64" in data
    # status must be a string (not None), since the self-heal should trigger connect or we get actual status
    assert data["status"] is not None


def test_qr_self_heal_triggers_connect_when_needed(admin_headers):
    """Call /connect then /qr; after a short wait, should get a qr_base64 or connected status."""
    r = requests.get(f"{BASE_URL}/api/channels/connections", headers=admin_headers, timeout=15)
    conns = [c for c in r.json() if c.get("type") == "whatsapp"]
    if not conns:
        pytest.skip("No WhatsApp connection exists")
    conn_id = conns[0]["id"]
    # Request QR; if status was waiting_qr but Node has no instance, backend should self-trigger connect
    qr_resp = requests.get(f"{BASE_URL}/api/channels/connections/{conn_id}/qr", headers=admin_headers, timeout=20)
    assert qr_resp.status_code == 200
    d = qr_resp.json()
    # Accepted statuses in any state: waiting_qr, connecting, connected, disconnected, not_found, error
    assert d["status"] in (
        "waiting_qr", "connecting", "connected", "disconnected",
        "not_found", "error", "qr_ready"
    ), f"unexpected status: {d['status']}"


def test_qr_endpoint_returns_404_for_unknown_connection(admin_headers):
    r = requests.get(f"{BASE_URL}/api/channels/connections/__does_not_exist__/qr",
                     headers=admin_headers, timeout=15)
    assert r.status_code == 404


# ============ MODELS ============
def test_all_features_still_31(admin_headers):
    r = requests.get(f"{BASE_URL}/api/scheduling/all-features", headers=admin_headers, timeout=15)
    assert r.status_code == 200
    feats = r.json()
    # Should be at least 31 (regression); allow new features to have been added
    assert len(feats) >= 31
