"""
Iteration 20 backend tests:
- Dynamic PWA manifest: GET /api/public/manifest/{slug}
- All features (requires auth): GET /api/scheduling/all-features
- Company users CRUD: GET/POST/PUT/DELETE /api/scheduling/company-users
- Newly created company_user can login via /api/auth/login
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://agentcrm-book.preview.emergentagent.com").rstrip("/")
BOSS_EMAIL = "admin@boss.com.br"
BOSS_PASS = "boss123"
BOSS_SLUG = "boss"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": BOSS_EMAIL, "password": BOSS_PASS},
        timeout=20,
    )
    assert r.status_code == 200, f"Boss admin login failed: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("access_token") or data.get("token")
    assert token, f"No token in login response: {data}"
    return token


@pytest.fixture(scope="module")
def headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


# === Dynamic PWA Manifest ===
class TestDynamicManifest:
    def test_manifest_boss(self):
        r = requests.get(f"{BASE_URL}/api/public/manifest/{BOSS_SLUG}", timeout=15)
        assert r.status_code == 200
        data = r.json()
        # Name should be company name, not generic
        assert "name" in data and isinstance(data["name"], str) and len(data["name"]) > 0
        assert data["name"] != "AgentCRM", f"Manifest name is generic: {data['name']}"
        # short_name should be first 12 chars
        assert "short_name" in data
        assert len(data["short_name"]) <= 12
        assert data["short_name"] == data["name"][:12]
        # icons must exist
        assert "icons" in data and isinstance(data["icons"], list) and len(data["icons"]) >= 2
        # start_url / scope must reference slug
        assert data["start_url"] == f"/{BOSS_SLUG}/painel"
        assert data["scope"] == f"/{BOSS_SLUG}/"
        assert data["display"] == "standalone"

    def test_manifest_unknown_slug_defaults_to_agentcrm(self):
        r = requests.get(f"{BASE_URL}/api/public/manifest/doesnotexist-{uuid.uuid4().hex[:6]}", timeout=15)
        assert r.status_code == 200
        data = r.json()
        # When page not found, falls back to AgentCRM default
        assert data["name"] == "AgentCRM"
        # icons should still be present (defaults)
        assert len(data["icons"]) >= 2


# === All features ===
class TestAllFeatures:
    def test_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/scheduling/all-features", timeout=15)
        assert r.status_code in (401, 403)

    def test_returns_grouped_features(self, headers):
        r = requests.get(f"{BASE_URL}/api/scheduling/all-features", headers=headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        assert len(data) == 29, f"Expected 29 features, got {len(data)}"
        # Structure
        for f in data:
            assert "feature_key" in f
            assert "label" in f
            assert "category" in f
        # Admin category must contain usuarios and perfis_acesso
        keys = {f["feature_key"] for f in data}
        assert "usuarios" in keys
        assert "perfis_acesso" in keys
        # Category grouping check
        categories = {f["category"] for f in data}
        assert "Administracao" in categories


# === Company Users CRUD + Login ===
class TestCompanyUsersCrud:
    created_user_id = None
    created_email = f"TEST_cu_{uuid.uuid4().hex[:8]}@boss.com.br"
    created_password = "TestPass123!"

    def test_list_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/scheduling/company-users", timeout=15)
        assert r.status_code in (401, 403)

    def test_list_no_password_field(self, headers):
        r = requests.get(f"{BASE_URL}/api/scheduling/company-users", headers=headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        for u in data:
            assert "password" not in u, "Password must not be exposed in list response"
            assert "_id" not in u
            assert "id" in u
            assert "email" in u

    def test_create_company_user(self, headers):
        payload = {
            "name": "TEST User CU",
            "email": TestCompanyUsersCrud.created_email,
            "password": TestCompanyUsersCrud.created_password,
        }
        r = requests.post(
            f"{BASE_URL}/api/scheduling/company-users",
            headers=headers, json=payload, timeout=15
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "password" not in data
        assert data["email"] == TestCompanyUsersCrud.created_email
        assert data["name"] == "TEST User CU"
        assert data["role"] == "user"
        assert "id" in data
        TestCompanyUsersCrud.created_user_id = data["id"]

        # Verify persistence via GET
        r2 = requests.get(f"{BASE_URL}/api/scheduling/company-users", headers=headers, timeout=15)
        emails = [u["email"] for u in r2.json()]
        assert TestCompanyUsersCrud.created_email in emails

    def test_create_duplicate_email_fails(self, headers):
        payload = {
            "name": "dup",
            "email": TestCompanyUsersCrud.created_email,
            "password": "whatever123",
        }
        r = requests.post(
            f"{BASE_URL}/api/scheduling/company-users",
            headers=headers, json=payload, timeout=15
        )
        assert r.status_code == 400

    def test_created_user_can_login(self):
        assert TestCompanyUsersCrud.created_user_id
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={
                "email": TestCompanyUsersCrud.created_email,
                "password": TestCompanyUsersCrud.created_password,
            },
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        token = data.get("access_token") or data.get("token")
        assert token
        # /api/auth/me
        r2 = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        assert r2.status_code == 200, r2.text
        me = r2.json()
        assert me["email"] == TestCompanyUsersCrud.created_email
        assert me.get("role") == "user"

    def test_update_name_only(self, headers):
        assert TestCompanyUsersCrud.created_user_id
        r = requests.put(
            f"{BASE_URL}/api/scheduling/company-users/{TestCompanyUsersCrud.created_user_id}",
            headers=headers,
            json={"name": "TEST User CU Updated"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["name"] == "TEST User CU Updated"
        assert "password" not in data

        # Verify old password still works (update should not have touched it)
        r2 = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={
                "email": TestCompanyUsersCrud.created_email,
                "password": TestCompanyUsersCrud.created_password,
            },
            timeout=15,
        )
        assert r2.status_code == 200, "Password should not change when not sent in PUT payload"

    def test_update_password(self, headers):
        assert TestCompanyUsersCrud.created_user_id
        new_pwd = "NewTestPass456!"
        r = requests.put(
            f"{BASE_URL}/api/scheduling/company-users/{TestCompanyUsersCrud.created_user_id}",
            headers=headers,
            json={"password": new_pwd},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        # Old password should fail
        r_old = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={
                "email": TestCompanyUsersCrud.created_email,
                "password": TestCompanyUsersCrud.created_password,
            },
            timeout=15,
        )
        assert r_old.status_code == 401
        # New should succeed
        r_new = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={
                "email": TestCompanyUsersCrud.created_email,
                "password": new_pwd,
            },
            timeout=15,
        )
        assert r_new.status_code == 200
        TestCompanyUsersCrud.created_password = new_pwd

    def test_delete_company_admin_blocked(self, headers):
        # Find the Boss admin (role=company_admin)
        r = requests.get(f"{BASE_URL}/api/scheduling/company-users", headers=headers, timeout=15)
        admins = [u for u in r.json() if u.get("role") == "company_admin"]
        assert admins, "Boss should have at least one company_admin"
        admin_id = admins[0]["id"]
        r_del = requests.delete(
            f"{BASE_URL}/api/scheduling/company-users/{admin_id}",
            headers=headers, timeout=15
        )
        assert r_del.status_code == 400, f"Expected 400 blocking admin delete, got {r_del.status_code}"

    def test_delete_created_user_cleanup(self, headers):
        assert TestCompanyUsersCrud.created_user_id
        r = requests.delete(
            f"{BASE_URL}/api/scheduling/company-users/{TestCompanyUsersCrud.created_user_id}",
            headers=headers, timeout=15
        )
        assert r.status_code == 200, r.text
        # Verify removal
        r2 = requests.get(f"{BASE_URL}/api/scheduling/company-users", headers=headers, timeout=15)
        emails = [u["email"] for u in r2.json()]
        assert TestCompanyUsersCrud.created_email not in emails
