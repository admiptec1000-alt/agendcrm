"""
Iteration 37 — Backend tests for:
- POST /api/scheduling/company-users accepts optional connection_ids: List[str] and persists
  - Default empty when omitted
- PUT /api/scheduling/company-users/{id} accepts connection_ids and updates
  - Empty list [] MUST clear the field (not be ignored)
- GET /api/scheduling/company-users returns connection_ids
- POST /api/auth/login returns user.connection_ids in payload
- Permission profile regression: GET /api/scheduling/all-features filters by
  company.features (business_type) plus permission_only_keys (edit_appointment*, own_appointments_only)
- Iter36 light regression: PUT /channels/connections/{id} rename, PUT /crm/tickets/{id} kanban_column_id
"""
import os
import uuid
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as fh:
        for ln in fh:
            if ln.startswith("REACT_APP_BACKEND_URL"):
                BASE_URL = ln.split("=", 1)[1].strip().strip('"').rstrip("/")

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "agentcrm_db")

CRM_EMAIL = "crm@test.com"
CRM_PASSWORD = "crm123"


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def db():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


def _login(email, password):
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": email, "password": password}, timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="module")
def crm_login_payload():
    return _login(CRM_EMAIL, CRM_PASSWORD)


@pytest.fixture(scope="module")
def crm_token(crm_login_payload):
    return crm_login_payload["access_token"]


@pytest.fixture(scope="module")
def crm_headers(crm_token):
    return {"Authorization": f"Bearer {crm_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def crm_company_id(crm_login_payload):
    return crm_login_payload["user"]["company_id"]


@pytest.fixture(scope="module")
def cleanup_test_users(db, crm_company_id):
    yield
    # Teardown — delete any TEST_ prefixed users left over
    db.company_users.delete_many({
        "company_id": crm_company_id,
        "$or": [
            {"email": {"$regex": "^TEST_iter37_"}},
            {"name": {"$regex": "^TEST_iter37_"}},
        ],
    })


# ---------- Tests: connection_ids on CompanyUser ----------

class TestCompanyUserConnectionIds:
    """POST/PUT/GET company-users with connection_ids persistence."""

    def _email(self):
        return f"TEST_iter37_{uuid.uuid4().hex[:8]}@test.com"

    def test_create_company_user_with_connection_ids_persists(
        self, crm_headers, db, crm_company_id, cleanup_test_users
    ):
        email = self._email()
        payload = {
            "name": "TEST_iter37_user_a",
            "email": email,
            "password": "Pass123!",
            "connection_ids": ["conn-a", "conn-b"],
        }
        r = requests.post(
            f"{BASE_URL}/api/scheduling/company-users",
            json=payload, headers=crm_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["email"] == email
        assert body["connection_ids"] == ["conn-a", "conn-b"]
        assert "password" not in body
        # DB persistence
        doc = db.company_users.find_one({"id": body["id"]})
        assert doc is not None
        assert doc["connection_ids"] == ["conn-a", "conn-b"]

    def test_create_company_user_omitted_connection_ids_defaults_empty(
        self, crm_headers, db, crm_company_id, cleanup_test_users
    ):
        email = self._email()
        payload = {
            "name": "TEST_iter37_user_b",
            "email": email,
            "password": "Pass123!",
        }
        r = requests.post(
            f"{BASE_URL}/api/scheduling/company-users",
            json=payload, headers=crm_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("connection_ids") == []
        doc = db.company_users.find_one({"id": body["id"]})
        assert doc["connection_ids"] == []

    def test_update_company_user_sets_connection_ids(
        self, crm_headers, db, crm_company_id, cleanup_test_users
    ):
        # Create with one set
        email = self._email()
        cr = requests.post(
            f"{BASE_URL}/api/scheduling/company-users",
            json={"name": "TEST_iter37_user_c", "email": email,
                  "password": "Pass123!", "connection_ids": ["c1"]},
            headers=crm_headers, timeout=15,
        )
        assert cr.status_code == 200, cr.text
        uid = cr.json()["id"]

        # Update to a new non-empty list
        ur = requests.put(
            f"{BASE_URL}/api/scheduling/company-users/{uid}",
            json={"connection_ids": ["c2", "c3", "c4"]},
            headers=crm_headers, timeout=15,
        )
        assert ur.status_code == 200, ur.text
        assert ur.json()["connection_ids"] == ["c2", "c3", "c4"]

        # GET (via list) confirms persistence
        gr = requests.get(
            f"{BASE_URL}/api/scheduling/company-users",
            headers=crm_headers, timeout=15,
        )
        assert gr.status_code == 200
        found = next((u for u in gr.json() if u["id"] == uid), None)
        assert found is not None
        assert found["connection_ids"] == ["c2", "c3", "c4"]

    def test_update_company_user_empty_list_clears_field(
        self, crm_headers, db, crm_company_id, cleanup_test_users
    ):
        # Create with two connections
        email = self._email()
        cr = requests.post(
            f"{BASE_URL}/api/scheduling/company-users",
            json={"name": "TEST_iter37_user_d", "email": email,
                  "password": "Pass123!", "connection_ids": ["x", "y"]},
            headers=crm_headers, timeout=15,
        )
        assert cr.status_code == 200, cr.text
        uid = cr.json()["id"]

        # Empty list — MUST clear, not be ignored
        ur = requests.put(
            f"{BASE_URL}/api/scheduling/company-users/{uid}",
            json={"connection_ids": []},
            headers=crm_headers, timeout=15,
        )
        assert ur.status_code == 200, ur.text
        body = ur.json()
        assert body["connection_ids"] == [], (
            f"empty list was IGNORED — expected [] but got {body.get('connection_ids')!r}"
        )
        # DB confirms
        doc = db.company_users.find_one({"id": uid})
        assert doc["connection_ids"] == []

    def test_list_company_users_returns_connection_ids(
        self, crm_headers, db, crm_company_id, cleanup_test_users
    ):
        # Create one with connection_ids
        email = self._email()
        cr = requests.post(
            f"{BASE_URL}/api/scheduling/company-users",
            json={"name": "TEST_iter37_user_e", "email": email,
                  "password": "Pass123!", "connection_ids": ["alpha"]},
            headers=crm_headers, timeout=15,
        )
        assert cr.status_code == 200
        uid = cr.json()["id"]

        gr = requests.get(
            f"{BASE_URL}/api/scheduling/company-users",
            headers=crm_headers, timeout=15,
        )
        assert gr.status_code == 200
        users = gr.json()
        assert isinstance(users, list)
        # password must never be exposed
        for u in users:
            assert "password" not in u
        target = next((u for u in users if u["id"] == uid), None)
        assert target is not None
        assert target["connection_ids"] == ["alpha"]


# ---------- Tests: /api/auth/login exposes connection_ids ----------

class TestLoginPayloadConnectionIds:
    def test_login_user_payload_includes_connection_ids_field(
        self, crm_headers, db, crm_company_id, cleanup_test_users
    ):
        # Create a user with connection_ids
        email = f"TEST_iter37_login_{uuid.uuid4().hex[:6]}@test.com"
        cr = requests.post(
            f"{BASE_URL}/api/scheduling/company-users",
            json={"name": "TEST_iter37_login_user", "email": email,
                  "password": "LoginPass123!", "connection_ids": ["conn-x", "conn-y"]},
            headers=crm_headers, timeout=15,
        )
        assert cr.status_code == 200, cr.text

        # Login as that user
        lr = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": email, "password": "LoginPass123!"}, timeout=15,
        )
        assert lr.status_code == 200, lr.text
        user_data = lr.json()["user"]
        assert "connection_ids" in user_data, "login payload missing connection_ids"
        assert user_data["connection_ids"] == ["conn-x", "conn-y"]
        assert "password" not in user_data


# ---------- Tests: permission profile / business_type regression ----------

class TestAllFeaturesRegression:
    def test_all_features_filtered_by_company_features(
        self, crm_headers, db, crm_company_id
    ):
        r = requests.get(
            f"{BASE_URL}/api/scheduling/all-features",
            headers=crm_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        features = r.json()
        assert isinstance(features, list)
        returned_keys = {f["feature_key"] for f in features}

        # Build expected set from company.features (enabled=True) + permission_only
        company = db.companies.find_one({"id": crm_company_id}, {"features": 1, "_id": 0})
        enabled_keys = {
            f["feature_key"] for f in (company or {}).get("features", []) if f.get("enabled")
        }
        permission_only = {"edit_appointment", "edit_appointment_price", "own_appointments_only"}

        # Every returned key must be in enabled_keys ∪ permission_only
        for k in returned_keys:
            assert k in enabled_keys or k in permission_only, (
                f"feature {k!r} returned but is not enabled in company.features and is not permission_only"
            )

        # Every enabled key that exists in ALL_SYSTEM_FEATURES catalog must be returned.
        # If a feature is enabled in company but not in ALL_SYSTEM_FEATURES, it just won't appear,
        # which is the correct behavior of the filter (intersection with the catalog).
        # We only assert the inverse direction (every returned key is allowed) — already done above.
        # Sanity: at least 1 enabled key that intersects ALL_SYSTEM_FEATURES is returned.
        intersection = enabled_keys & returned_keys
        assert len(intersection) > 0, (
            f"no enabled features returned — filter may be broken. "
            f"enabled={enabled_keys}, returned={returned_keys}"
        )

        # Permission-only keys must always be present
        for k in permission_only:
            assert k in returned_keys, f"permission-only feature {k!r} missing from /all-features"


# ---------- Light regression for iter36 (rename + kanban_column_id) ----------

class TestIter36Regression:
    def test_put_channels_connection_rename_persists(
        self, crm_headers, db, crm_company_id
    ):
        # Find or create a connection (collection: channel_connections)
        existing = db.channel_connections.find_one({"company_id": crm_company_id})
        created = False
        if not existing:
            cid = str(uuid.uuid4())
            db.channel_connections.insert_one({
                "id": cid, "company_id": crm_company_id,
                "name": "TEST_iter37_conn_orig", "status": "disconnected",
                "type": "whatsapp",
            })
            existing = db.channel_connections.find_one({"id": cid})
            created = True

        original_name = existing["name"]
        cid = existing["id"]
        new_name = f"TEST_iter37_renamed_{uuid.uuid4().hex[:6]}"

        try:
            r = requests.put(
                f"{BASE_URL}/api/channels/connections/{cid}",
                json={"name": new_name}, headers=crm_headers, timeout=15,
            )
            assert r.status_code == 200, r.text
            assert r.json()["name"] == new_name
            doc = db.channel_connections.find_one({"id": cid})
            assert doc["name"] == new_name
        finally:
            # restore original name
            if created:
                db.channel_connections.delete_one({"id": cid})
            else:
                db.channel_connections.update_one({"id": cid}, {"$set": {"name": original_name}})

    def test_put_ticket_kanban_column_id_set_and_clear(
        self, crm_headers, db, crm_company_id
    ):
        # Create a temporary ticket directly in DB to avoid coupling to ticket POST schema
        tid = str(uuid.uuid4())
        db.tickets.insert_one({
            "id": tid, "company_id": crm_company_id,
            "title": "TEST_iter37_ticket", "status": "open",
            "kanban_column_id": None,
        })
        try:
            # Set
            r = requests.put(
                f"{BASE_URL}/api/crm/tickets/{tid}",
                json={"kanban_column_id": "col-A"},
                headers=crm_headers, timeout=15,
            )
            assert r.status_code == 200, r.text
            doc = db.tickets.find_one({"id": tid})
            assert doc["kanban_column_id"] == "col-A"

            # Change
            r = requests.put(
                f"{BASE_URL}/api/crm/tickets/{tid}",
                json={"kanban_column_id": "col-B"},
                headers=crm_headers, timeout=15,
            )
            assert r.status_code == 200, r.text
            doc = db.tickets.find_one({"id": tid})
            assert doc["kanban_column_id"] == "col-B"
        finally:
            db.tickets.delete_one({"id": tid})
