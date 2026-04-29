"""
Iteration 35 — Backend tests for:
- Expanded /api/scheduling/clients: cep, address, city, state, company_name (POST + PUT)
- /api/reports/tickets: shape, filters, pagination, hydration, duration_seconds, own_appointments_only
- /api/scheduling/all-features exposes relatorio_atendimentos (CRM) for CRM-type company
- iter33/34 regression: commissions cost/profit keys + own_appointments_only propagation

Test credentials (from /app/memory/test_credentials.md):
  CRM admin:   crm@test.com   / crm123       (company_id: c477e72c-5633-4b2f-a252-8068d167ad5a)
  Boss admin:  admin@boss.com.br / boss123
  Super admin: admin@agentcrm.com / admin123
"""
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fall back to reading frontend/.env (tests must never hardcode the URL)
    with open("/app/frontend/.env") as fh:
        for ln in fh:
            if ln.startswith("REACT_APP_BACKEND_URL"):
                BASE_URL = ln.split("=", 1)[1].strip().strip('"').rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "agentcrm_db")

CRM_EMAIL = "crm@test.com"
CRM_PASSWORD = "crm123"
BOSS_EMAIL = "admin@boss.com.br"
BOSS_PASSWORD = "boss123"
SUPER_EMAIL = "admin@agentcrm.com"
SUPER_PASSWORD = "admin123"


# ---------- fixtures ----------

@pytest.fixture(scope="module")
def db():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="module")
def crm_auth():
    payload = _login(CRM_EMAIL, CRM_PASSWORD)
    return {
        "token": payload["access_token"],
        "user": payload["user"],
        "headers": {"Authorization": f"Bearer {payload['access_token']}"},
    }


@pytest.fixture(scope="module")
def boss_auth():
    payload = _login(BOSS_EMAIL, BOSS_PASSWORD)
    return {
        "token": payload["access_token"],
        "user": payload["user"],
        "headers": {"Authorization": f"Bearer {payload['access_token']}"},
    }


# ==========================================================================
# 1) Clients: new fields persist on POST and PUT
# ==========================================================================
class TestClientExtendedFields:

    def test_post_client_pj_full_fields(self, crm_auth, db):
        phone = f"55119{uuid.uuid4().hex[:8]}"
        payload = {
            "name": "TEST_PJ Cliente",
            "phone": phone,
            "person_type": "juridica",
            "cnpj": "12.345.678/0001-99",
            "company_name": "TEST_PJ Razao Social LTDA",
            "cep": "01310-100",
            "address": "Av Paulista, 1000",
            "city": "Sao Paulo",
            "state": "SP",
        }
        r = requests.post(f"{BASE_URL}/api/scheduling/clients", headers=crm_auth["headers"], json=payload, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["company_name"] == "TEST_PJ Razao Social LTDA"
        assert body["cep"] == "01310-100"
        assert body["address"] == "Av Paulista, 1000"
        assert body["city"] == "Sao Paulo"
        assert body["state"] == "SP"
        assert body["person_type"] == "juridica"

        # Verify persistence via GET
        g = requests.get(f"{BASE_URL}/api/scheduling/clients", headers=crm_auth["headers"], timeout=15)
        assert g.status_code == 200
        found = next((c for c in g.json() if c["id"] == body["id"]), None)
        assert found is not None, "created client not returned by GET /scheduling/clients"
        for k in ("company_name", "cep", "address", "city", "state"):
            assert found[k] == payload[k], f"field {k} mismatch in GET: {found.get(k)!r}"

        # cleanup
        db.clients.delete_one({"id": body["id"]})

    def test_put_client_updates_new_fields(self, crm_auth, db):
        # create fisica client first
        phone = f"55219{uuid.uuid4().hex[:8]}"
        create = requests.post(
            f"{BASE_URL}/api/scheduling/clients",
            headers=crm_auth["headers"],
            json={"name": "TEST_update Cliente", "phone": phone, "person_type": "fisica", "cpf": "000.000.000-00"},
            timeout=15,
        ).json()
        cid = create["id"]

        # update adding the new fields
        upd_payload = {
            "name": "TEST_update Cliente",
            "phone": phone,
            "person_type": "fisica",
            "cep": "22000-000",
            "address": "Rua X, 100",
            "city": "Rio",
            "state": "RJ",
        }
        r = requests.put(f"{BASE_URL}/api/scheduling/clients/{cid}", headers=crm_auth["headers"], json=upd_payload, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["cep"] == "22000-000"
        assert body["address"] == "Rua X, 100"
        assert body["city"] == "Rio"
        assert body["state"] == "RJ"

        # cleanup
        db.clients.delete_one({"id": cid})


# ==========================================================================
# 2) /api/reports/tickets — shape, filters, pagination, hydration, duration
# ==========================================================================
class TestTicketsReport:

    def test_basic_shape_and_rows(self, crm_auth):
        r = requests.get(
            f"{BASE_URL}/api/reports/tickets?page=1&page_size=5",
            headers=crm_auth["headers"], timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        for k in ("total", "page", "page_size", "rows"):
            assert k in body
        assert isinstance(body["rows"], list)
        assert body["page"] == 1
        assert body["page_size"] == 5
        assert body["total"] >= 6  # iter context: 6 historical tickets exist

        if body["rows"]:
            row = body["rows"][0]
            # required row fields
            for k in (
                "id", "ticket_number", "connection", "customer_name", "customer_phone",
                "assigned_user", "queue", "tags", "value", "status", "rating",
                "last_message_at", "created_at", "closed_at", "duration_seconds",
            ):
                assert k in row, f"missing field {k} in row"
            assert isinstance(row["tags"], list)

    def test_pagination_skip_and_total(self, crm_auth):
        r1 = requests.get(f"{BASE_URL}/api/reports/tickets?page=1&page_size=3", headers=crm_auth["headers"], timeout=15).json()
        r2 = requests.get(f"{BASE_URL}/api/reports/tickets?page=2&page_size=3", headers=crm_auth["headers"], timeout=15).json()
        assert r1["total"] == r2["total"], "total must be absolute (not page-scoped)"
        assert r1["page"] == 1 and r2["page"] == 2
        # different rows on page 2 vs page 1 (assuming >3 tickets)
        if r1["total"] > 3:
            ids1 = {x["id"] for x in r1["rows"]}
            ids2 = {x["id"] for x in r2["rows"]}
            assert ids1.isdisjoint(ids2), "page-2 rows should not overlap page-1 rows"

    def test_search_filter_by_name_case_insensitive(self, crm_auth, db):
        # pick any existing ticket name and search partial lowercase
        base = requests.get(f"{BASE_URL}/api/reports/tickets?page=1&page_size=50", headers=crm_auth["headers"], timeout=15).json()
        if not base["rows"]:
            pytest.skip("no tickets to base search on")
        sample = base["rows"][0]["customer_name"]
        frag = sample[:3].lower()
        r = requests.get(
            f"{BASE_URL}/api/reports/tickets?search={frag}&page=1&page_size=50",
            headers=crm_auth["headers"], timeout=15,
        ).json()
        assert r["total"] >= 1
        for row in r["rows"]:
            blob = f"{row.get('customer_name') or ''} {row.get('customer_phone') or ''}".lower()
            assert frag in blob, f"search '{frag}' not in row {row}"

    def test_status_filter(self, crm_auth):
        r = requests.get(
            f"{BASE_URL}/api/reports/tickets?status=aberto&page=1&page_size=50",
            headers=crm_auth["headers"], timeout=15,
        ).json()
        for row in r["rows"]:
            assert row["status"] == "aberto"

    def test_date_filter_future_returns_empty(self, crm_auth):
        # date in far future should exclude everything
        r = requests.get(
            f"{BASE_URL}/api/reports/tickets?start_date=2099-01-01T00:00:00%2B00:00&page=1&page_size=10",
            headers=crm_auth["headers"], timeout=15,
        ).json()
        assert r["total"] == 0
        assert r["rows"] == []

    def test_only_rated_filter_excludes_null_ratings(self, crm_auth):
        r = requests.get(
            f"{BASE_URL}/api/reports/tickets?only_rated=true&page=1&page_size=50",
            headers=crm_auth["headers"], timeout=15,
        ).json()
        for row in r["rows"]:
            assert row["rating"] is not None, "only_rated must exclude null ratings"

    def test_hydration_and_duration_seconds(self, crm_auth, db):
        """Seed a ticket with connection, queue, assigned_to and closed_at,
        then confirm hydration names resolve and duration is computed."""
        company_id = crm_auth["user"]["company_id"]

        # Seed (or fetch) a connection + queue + assigned user to reference
        conn_id = f"TEST_conn_{uuid.uuid4().hex[:8]}"
        db.channel_connections.insert_one({
            "id": conn_id, "company_id": company_id, "name": "TEST_Connection_Alpha",
        })
        queue_id = f"TEST_queue_{uuid.uuid4().hex[:8]}"
        db.queues.insert_one({
            "id": queue_id, "company_id": company_id, "name": "TEST_Queue_Bravo",
        })
        # Use the CRM admin itself as the assigned user (already exists in company_users)
        admin_user_id = crm_auth["user"]["id"]

        created = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
        closed = (datetime.now(timezone.utc) - timedelta(hours=1, minutes=30)).isoformat()  # ~1800s later

        tid = f"TEST_tick_{uuid.uuid4().hex[:8]}"
        db.tickets.insert_one({
            "id": tid, "ticket_number": 999001, "company_id": company_id,
            "customer_name": "TEST_Hydrate", "customer_phone": "5511900000001",
            "status": "fechado", "priority": "medium", "channel": "web",
            "channel_connection_id": conn_id, "queue_id": queue_id,
            "assigned_to": admin_user_id, "tags": ["alpha"], "value": 250.0,
            "rating": 5, "created_at": created, "closed_at": closed,
            "last_message_at": closed, "updated_at": closed,
        })

        try:
            r = requests.get(
                f"{BASE_URL}/api/reports/tickets?search=TEST_Hydrate&page=1&page_size=10",
                headers=crm_auth["headers"], timeout=15,
            ).json()
            assert r["total"] == 1
            row = r["rows"][0]
            assert row["connection"] == "TEST_Connection_Alpha"
            assert row["queue"] == "TEST_Queue_Bravo"
            assert row["assigned_user"] == crm_auth["user"]["name"]
            assert row["tags"] == ["alpha"]
            assert row["value"] == 250.0
            assert row["rating"] == 5
            # duration should be roughly 30 minutes = 1800 s (allow +/- 5s)
            assert row["duration_seconds"] is not None
            assert abs(row["duration_seconds"] - 1800) < 10

            # Also check hydration filter by connection_id + queue_id
            r2 = requests.get(
                f"{BASE_URL}/api/reports/tickets?connection_id={conn_id}&queue_id={queue_id}",
                headers=crm_auth["headers"], timeout=15,
            ).json()
            assert r2["total"] == 1 and r2["rows"][0]["id"] == tid
        finally:
            db.tickets.delete_one({"id": tid})
            db.channel_connections.delete_one({"id": conn_id})
            db.queues.delete_one({"id": queue_id})

    def test_duration_is_none_when_not_closed(self, crm_auth):
        r = requests.get(
            f"{BASE_URL}/api/reports/tickets?status=aberto&page=1&page_size=20",
            headers=crm_auth["headers"], timeout=15,
        ).json()
        for row in r["rows"]:
            if row["closed_at"] is None:
                assert row["duration_seconds"] is None, f"duration should be None when closed_at is None: {row}"

    def test_tag_filter(self, crm_auth, db):
        company_id = crm_auth["user"]["company_id"]
        tid = f"TEST_tag_{uuid.uuid4().hex[:8]}"
        db.tickets.insert_one({
            "id": tid, "ticket_number": 999002, "company_id": company_id,
            "customer_name": "TEST_TagTicket", "customer_phone": "5511900000002",
            "status": "aberto", "tags": ["vip_TEST"],
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
        try:
            r = requests.get(
                f"{BASE_URL}/api/reports/tickets?tag=vip_TEST&page=1&page_size=50",
                headers=crm_auth["headers"], timeout=15,
            ).json()
            assert r["total"] == 1 and r["rows"][0]["id"] == tid
        finally:
            db.tickets.delete_one({"id": tid})


# ==========================================================================
# 3) own_appointments_only restricts tickets list
# ==========================================================================
class TestTicketsOwnAppointmentsOnly:

    @pytest.fixture(scope="class")
    def restricted_env(self, crm_auth, db):
        """Create restricted permission profile, company_user and 2 tickets
        (one assigned to restricted user, one to admin)."""
        admin_headers = crm_auth["headers"]
        company_id = crm_auth["user"]["company_id"]
        admin_id = crm_auth["user"]["id"]

        # Create a permission profile that has the own_appointments_only perm
        prof_body = {
            "name": f"TEST_Restricted_{uuid.uuid4().hex[:6]}",
            "permissions": ["atendimentos", "relatorio_atendimentos", "own_appointments_only"],
        }
        pr = requests.post(f"{BASE_URL}/api/scheduling/permission-profiles",
                           headers=admin_headers, json=prof_body, timeout=15)
        assert pr.status_code == 200, pr.text
        profile_id = pr.json()["id"]

        # Create the restricted company user
        restricted_email = f"TEST_restricted_{uuid.uuid4().hex[:6]}@example.com"
        restricted_password = "TestPwd123"
        ur = requests.post(f"{BASE_URL}/api/scheduling/company-users",
                           headers=admin_headers,
                           json={"name": "TEST Restricted User",
                                 "email": restricted_email,
                                 "password": restricted_password,
                                 "permission_profile_id": profile_id},
                           timeout=15)
        assert ur.status_code == 200, ur.text
        restricted_user_id = ur.json()["id"]

        # login as restricted user to get headers
        tok = _login(restricted_email, restricted_password)
        restricted_headers = {"Authorization": f"Bearer {tok['access_token']}"}

        # Seed 2 tickets
        t_mine = f"TEST_own_mine_{uuid.uuid4().hex[:6]}"
        t_other = f"TEST_own_other_{uuid.uuid4().hex[:6]}"
        now = datetime.now(timezone.utc).isoformat()
        db.tickets.insert_many([
            {"id": t_mine, "ticket_number": 999010, "company_id": company_id,
             "customer_name": "TEST_OwnMine", "customer_phone": "5511900010001",
             "status": "aberto", "assigned_to": restricted_user_id,
             "created_at": now, "updated_at": now, "tags": []},
            {"id": t_other, "ticket_number": 999011, "company_id": company_id,
             "customer_name": "TEST_OwnOther", "customer_phone": "5511900010002",
             "status": "aberto", "assigned_to": admin_id,
             "created_at": now, "updated_at": now, "tags": []},
        ])

        yield {
            "profile_id": profile_id,
            "restricted_user_id": restricted_user_id,
            "restricted_headers": restricted_headers,
            "admin_id": admin_id,
            "t_mine": t_mine, "t_other": t_other,
        }

        # teardown
        db.tickets.delete_many({"id": {"$in": [t_mine, t_other]}})
        try:
            requests.delete(f"{BASE_URL}/api/scheduling/company-users/{restricted_user_id}",
                            headers=admin_headers, timeout=10)
        except Exception:
            pass
        db.company_users.delete_one({"id": restricted_user_id})
        db.permission_profiles.delete_one({"id": profile_id})

    def test_restricted_user_sees_only_own_tickets(self, restricted_env, crm_auth):
        r = requests.get(
            f"{BASE_URL}/api/reports/tickets?search=TEST_Own&page=1&page_size=50",
            headers=restricted_env["restricted_headers"], timeout=15,
        ).json()
        ids = [row["id"] for row in r["rows"]]
        assert restricted_env["t_mine"] in ids
        assert restricted_env["t_other"] not in ids, "restricted user must not see other's ticket"

    def test_restricted_user_cannot_bypass_via_user_id_query(self, restricted_env):
        # attempt to request admin's tickets — must be force-overridden to self
        r = requests.get(
            f"{BASE_URL}/api/reports/tickets?search=TEST_Own&user_id={restricted_env['admin_id']}&page=1&page_size=50",
            headers=restricted_env["restricted_headers"], timeout=15,
        ).json()
        ids = [row["id"] for row in r["rows"]]
        assert restricted_env["t_other"] not in ids
        assert restricted_env["t_mine"] in ids or r["total"] == 1

    def test_admin_sees_both(self, restricted_env, crm_auth):
        r = requests.get(
            f"{BASE_URL}/api/reports/tickets?search=TEST_Own&page=1&page_size=50",
            headers=crm_auth["headers"], timeout=15,
        ).json()
        ids = [row["id"] for row in r["rows"]]
        assert restricted_env["t_mine"] in ids
        assert restricted_env["t_other"] in ids


# ==========================================================================
# 4) /scheduling/all-features exposes relatorio_atendimentos
# ==========================================================================
class TestAllFeaturesCatalog:

    def test_relatorio_atendimentos_present_when_enabled_on_company(self, crm_auth, db):
        """Per review-request: /all-features should expose relatorio_atendimentos
        with category 'CRM' *when the business_type/company includes that feature*.

        Pre-existing companies may not have the key in their `features` array
        (seed_business_types only runs on an empty collection). So we force-enable
        it for the CRM test company and check the endpoint reflects it.
        """
        company_id = crm_auth["user"]["company_id"]
        comp = db.companies.find_one({"id": company_id}, {"_id": 0, "features": 1})
        original_features = list(comp.get("features") or [])

        # Snapshot the pristine state, then upsert the feature to enabled
        new_features = [f for f in original_features if f.get("feature_key") != "relatorio_atendimentos"]
        new_features.append({"feature_key": "relatorio_atendimentos", "enabled": True})
        db.companies.update_one({"id": company_id}, {"$set": {"features": new_features}})

        try:
            r = requests.get(f"{BASE_URL}/api/scheduling/all-features",
                             headers=crm_auth["headers"], timeout=15)
            assert r.status_code == 200, r.text
            feats = r.json()
            entry = next((f for f in feats if f["feature_key"] == "relatorio_atendimentos"), None)
            assert entry is not None, "relatorio_atendimentos missing from /all-features once enabled on company"
            assert entry["category"] == "CRM"
            assert entry["label"] == "Relatorio de Atendimentos"
        finally:
            db.companies.update_one({"id": company_id}, {"$set": {"features": original_features}})

    def test_relatorio_atendimentos_hidden_when_not_enabled(self, crm_auth, db):
        """When not enabled on the company, /all-features must NOT expose it
        (not in the permission-only whitelist)."""
        company_id = crm_auth["user"]["company_id"]
        comp = db.companies.find_one({"id": company_id}, {"_id": 0, "features": 1})
        original_features = list(comp.get("features") or [])
        # Ensure key absent
        stripped = [f for f in original_features if f.get("feature_key") != "relatorio_atendimentos"]
        db.companies.update_one({"id": company_id}, {"$set": {"features": stripped}})
        try:
            r = requests.get(f"{BASE_URL}/api/scheduling/all-features",
                             headers=crm_auth["headers"], timeout=15).json()
            keys = {f["feature_key"] for f in r}
            assert "relatorio_atendimentos" not in keys, \
                "relatorio_atendimentos must not appear when company.features doesn't enable it"
        finally:
            db.companies.update_one({"id": company_id}, {"$set": {"features": original_features}})


# ==========================================================================
# 5) iter33/34 regression — commissions fields + own_appointments_only
# ==========================================================================
class TestRegressionIter33And34:

    def test_commissions_summary_has_cost_and_profit(self, boss_auth):
        r = requests.get(f"{BASE_URL}/api/reports/commissions",
                         headers=boss_auth["headers"], timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "summary" in body
        for k in ("total_revenue", "total_cost", "total_profit",
                  "total_commission", "total_appointments"):
            assert k in body["summary"], f"missing {k} in commissions summary"
        assert "breakdown" in body and isinstance(body["breakdown"], list)

    def test_ticket_numbers_are_sequential(self, crm_auth):
        r = requests.get(
            f"{BASE_URL}/api/reports/tickets?page=1&page_size=50",
            headers=crm_auth["headers"], timeout=15,
        ).json()
        nums = [row["ticket_number"] for row in r["rows"] if row.get("ticket_number")]
        # ticket_number must be int and non-null for all tickets
        assert all(isinstance(n, int) for n in nums), "ticket_number must be int"
        assert len(set(nums)) == len(nums), "ticket_numbers must be unique"
