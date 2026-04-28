"""Iteration 30 — BusinessType.mobile_bottom_nav (max 4) + propagation to companies.

Validates:
  - POST /api/super-admin/business-types accepts mobile_bottom_nav
  - PUT /api/super-admin/business-types/{id} truncates >4 items
  - PUT BT propagates mobile_bottom_nav to companies sharing business_type_id
  - POST /api/super-admin/companies copies mobile_bottom_nav from BT
  - PUT  /api/super-admin/companies/{id} (business_type_id provided) copies it
  - POST /api/super-admin/companies/{id}/resync-features also syncs mobile_bottom_nav
  - GET /api/auth/me exposes company.mobile_bottom_nav and business_type.mobile_bottom_nav
  - Regression: BT/Company CRUD without mobile_bottom_nav defaults to []
  - Regression iter29: ticket_number sequencial still works
"""
import os
import uuid
import httpx
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.strip().split("=", 1)[1].strip().rstrip("/")
                    break
    except Exception:
        pass

API = f"{BASE_URL}/api"
TIMEOUT = 30

ADMIN_EMAIL = "admin@agentcrm.com"
ADMIN_PASS = "admin123"
CRM_EMAIL = "crm@test.com"
CRM_PASS = "crm123"


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def admin_token():
    r = httpx.post(f"{API}/auth/super-admin/login",
                   json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=TIMEOUT)
    assert r.status_code == 200, f"super-admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def crm_token():
    r = httpx.post(f"{API}/auth/login",
                   json={"email": CRM_EMAIL, "password": CRM_PASS}, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def crm_headers(crm_token):
    return {"Authorization": f"Bearer {crm_token}"}


# ---------- helpers ----------
def _create_bt(headers, name, mobile=None, features=None):
    body = {
        "name": name,
        "base_type": "crm",
        "icon": "🧪",
        "color": "blue",
        "description": "iter30 BT",
        "features": features if features is not None else [
            {"key": "atendimentos", "name": "Atendimentos", "enabled": True},
            {"key": "kanban", "name": "Kanban", "enabled": True},
            {"key": "contatos", "name": "Contatos", "enabled": True},
            {"key": "campanhas", "name": "Campanhas", "enabled": True},
            {"key": "conexoes", "name": "Conexoes", "enabled": True},
        ],
    }
    if mobile is not None:
        body["mobile_bottom_nav"] = mobile
    r = httpx.post(f"{API}/super-admin/business-types", headers=headers, json=body, timeout=TIMEOUT)
    assert r.status_code == 200, f"create BT failed: {r.status_code} {r.text}"
    return r.json()


def _delete_bt(headers, bt_id):
    httpx.delete(f"{API}/super-admin/business-types/{bt_id}", headers=headers, timeout=TIMEOUT)


def _create_company(headers, business_type_id=None, **extra):
    suffix = uuid.uuid4().hex[:6]
    body = {
        "name": f"TEST_30_co_{suffix}",
        "subdomain": f"test30{suffix}",
        "email": f"test30_{suffix}@test.com",
        "plan_type": "crm",
        "admin_name": "Iter30 Admin",
        "admin_email": f"admin30_{suffix}@test.com",
        "admin_password": "test12345",
    }
    if business_type_id:
        body["business_type_id"] = business_type_id
    body.update(extra)
    r = httpx.post(f"{API}/super-admin/companies", headers=headers, json=body, timeout=TIMEOUT)
    assert r.status_code == 200, f"create company failed: {r.status_code} {r.text}"
    return r.json()


def _delete_company(headers, cid):
    httpx.delete(f"{API}/super-admin/companies/{cid}", headers=headers, timeout=TIMEOUT)


# ---------- 1. Create BT with mobile_bottom_nav ----------
def test_create_business_type_with_mobile_bottom_nav(admin_headers):
    bt = _create_bt(admin_headers, f"TEST_30_bt_{uuid.uuid4().hex[:5]}",
                    mobile=["atendimentos", "kanban", "contatos", "campanhas"])
    try:
        assert bt.get("mobile_bottom_nav") == ["atendimentos", "kanban", "contatos", "campanhas"]
    finally:
        _delete_bt(admin_headers, bt["id"])


# ---------- 2. Create BT without mobile_bottom_nav => default [] ----------
def test_create_business_type_without_mobile_defaults_empty(admin_headers):
    bt = _create_bt(admin_headers, f"TEST_30_bt_{uuid.uuid4().hex[:5]}")
    try:
        assert "mobile_bottom_nav" in bt
        assert bt["mobile_bottom_nav"] == []
    finally:
        _delete_bt(admin_headers, bt["id"])


# ---------- 3. PUT BT truncates to 4 ----------
def test_update_business_type_truncates_to_four(admin_headers):
    bt = _create_bt(admin_headers, f"TEST_30_bt_{uuid.uuid4().hex[:5]}")
    try:
        five = ["atendimentos", "kanban", "contatos", "campanhas", "conexoes"]
        r = httpx.put(f"{API}/super-admin/business-types/{bt['id']}",
                      headers=admin_headers, json={"mobile_bottom_nav": five}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        updated = r.json()
        assert len(updated["mobile_bottom_nav"]) == 4
        assert updated["mobile_bottom_nav"] == five[:4]
    finally:
        _delete_bt(admin_headers, bt["id"])


# ---------- 4. PUT BT propagates to companies ----------
def test_put_bt_propagates_mobile_to_companies(admin_headers):
    bt = _create_bt(admin_headers, f"TEST_30_bt_{uuid.uuid4().hex[:5]}",
                    mobile=["atendimentos", "kanban"])
    co = _create_company(admin_headers, business_type_id=bt["id"])
    try:
        # Initial: company should have copied BT mobile_bottom_nav
        assert co.get("mobile_bottom_nav") == ["atendimentos", "kanban"]

        # Update BT with new mobile_bottom_nav
        new_nav = ["contatos", "campanhas", "conexoes", "kanban"]
        r = httpx.put(f"{API}/super-admin/business-types/{bt['id']}",
                      headers=admin_headers, json={"mobile_bottom_nav": new_nav}, timeout=TIMEOUT)
        assert r.status_code == 200

        # Re-fetch company via list endpoint
        rc = httpx.get(f"{API}/super-admin/companies",
                       headers=admin_headers, timeout=TIMEOUT)
        assert rc.status_code == 200
        comps = [c for c in rc.json() if c.get("id") == co["id"]]
        assert comps, "company not found in list"
        comp = comps[0]
        assert comp.get("mobile_bottom_nav") == new_nav, (
            f"Propagation failed: expected {new_nav}, got {comp.get('mobile_bottom_nav')}")
    finally:
        _delete_company(admin_headers, co["id"])
        _delete_bt(admin_headers, bt["id"])


# ---------- 5. POST company without BT => empty mobile_bottom_nav ----------
def test_create_company_without_bt_default_empty(admin_headers):
    co = _create_company(admin_headers)
    try:
        assert co.get("mobile_bottom_nav", []) == []
    finally:
        _delete_company(admin_headers, co["id"])


# ---------- 6. PUT company with business_type_id copies mobile ----------
def test_update_company_business_type_copies_mobile(admin_headers):
    bt = _create_bt(admin_headers, f"TEST_30_bt_{uuid.uuid4().hex[:5]}",
                    mobile=["atendimentos", "campanhas"])
    co = _create_company(admin_headers)  # no BT initially
    try:
        assert co.get("mobile_bottom_nav", []) == []
        r = httpx.put(f"{API}/super-admin/companies/{co['id']}",
                      headers=admin_headers, json={"business_type_id": bt["id"]}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        updated = r.json()
        assert updated.get("mobile_bottom_nav") == ["atendimentos", "campanhas"]
    finally:
        _delete_company(admin_headers, co["id"])
        _delete_bt(admin_headers, bt["id"])


# ---------- 7. resync-features also syncs mobile_bottom_nav ----------
def test_resync_features_also_syncs_mobile_bottom_nav(admin_headers):
    """Force-desync via direct MongoDB write so we exclusively measure what
    /resync-features does, not what PUT BT propagation does."""
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "agentcrm_db")
    # Read .env if env vars not present
    if not os.environ.get("MONGO_URL"):
        try:
            with open("/app/backend/.env") as f:
                for line in f:
                    if line.startswith("MONGO_URL="):
                        mongo_url = line.split("=", 1)[1].strip().strip('"')
                    elif line.startswith("DB_NAME="):
                        db_name = line.split("=", 1)[1].strip().strip('"')
        except Exception:
            pass

    bt = _create_bt(admin_headers, f"TEST_30_bt_{uuid.uuid4().hex[:5]}",
                    mobile=["atendimentos", "kanban"])
    co = _create_company(admin_headers, business_type_id=bt["id"])
    try:
        new_nav = ["contatos", "campanhas", "conexoes"]
        r = httpx.put(f"{API}/super-admin/business-types/{bt['id']}",
                      headers=admin_headers, json={"mobile_bottom_nav": new_nav}, timeout=TIMEOUT)
        assert r.status_code == 200

        # Force desync directly in DB
        async def _desync():
            cli = AsyncIOMotorClient(mongo_url)
            try:
                await cli[db_name].companies.update_one(
                    {"id": co["id"]},
                    {"$set": {"mobile_bottom_nav": ["STALE_VALUE"]}}
                )
            finally:
                cli.close()
        asyncio.get_event_loop().run_until_complete(_desync()) if False else asyncio.run(_desync())

        # Now call resync — it should overwrite the stale value
        rs = httpx.post(f"{API}/super-admin/companies/{co['id']}/resync-features",
                        headers=admin_headers, timeout=TIMEOUT)
        assert rs.status_code == 200, rs.text
        body = rs.json()
        comp = body.get("company") or {}
        assert comp.get("mobile_bottom_nav") == new_nav, (
            f"resync did not sync mobile_bottom_nav: expected {new_nav}, "
            f"got {comp.get('mobile_bottom_nav')}"
        )
    finally:
        _delete_company(admin_headers, co["id"])
        _delete_bt(admin_headers, bt["id"])


# ---------- 8. GET /api/auth/me exposes company.mobile_bottom_nav and business_type.mobile_bottom_nav ----------
def test_auth_me_exposes_mobile_bottom_nav(crm_headers, admin_headers):
    # Find the CRM company id
    me_before = httpx.get(f"{API}/auth/me", headers=crm_headers, timeout=TIMEOUT).json()
    company = me_before.get("company") or {}
    company_id = company.get("id") or me_before.get("company_id")
    assert company_id, "could not resolve crm company_id"
    bt_id = company.get("business_type_id")

    if not bt_id:
        pytest.skip("CRM company has no business_type_id; cannot exercise BT propagation via /me")

    # Read existing BT to restore later
    rb = httpx.get(f"{API}/super-admin/business-types/{bt_id}",
                   headers=admin_headers, timeout=TIMEOUT)
    assert rb.status_code == 200
    original_nav = rb.json().get("mobile_bottom_nav", [])

    new_nav = ["atendimentos", "kanban", "contatos", "campanhas"]
    try:
        ru = httpx.put(f"{API}/super-admin/business-types/{bt_id}",
                       headers=admin_headers, json={"mobile_bottom_nav": new_nav}, timeout=TIMEOUT)
        assert ru.status_code == 200, ru.text

        # Now /me of CRM user should expose both fields
        me = httpx.get(f"{API}/auth/me", headers=crm_headers, timeout=TIMEOUT).json()
        comp = me.get("company") or {}
        bt = me.get("business_type") or {}
        assert comp.get("mobile_bottom_nav") == new_nav, (
            f"company.mobile_bottom_nav mismatch: {comp.get('mobile_bottom_nav')}"
        )
        assert bt.get("mobile_bottom_nav") == new_nav, (
            f"business_type.mobile_bottom_nav mismatch: {bt.get('mobile_bottom_nav')}"
        )
    finally:
        # restore original
        httpx.put(f"{API}/super-admin/business-types/{bt_id}",
                  headers=admin_headers, json={"mobile_bottom_nav": original_nav}, timeout=TIMEOUT)


# ---------- 9. CRUD regression: BT and Company list/get still work ----------
def test_regression_bt_and_company_crud(admin_headers):
    # list BTs
    r = httpx.get(f"{API}/super-admin/business-types", headers=admin_headers, timeout=TIMEOUT)
    assert r.status_code == 200
    assert isinstance(r.json(), list)
    # list companies
    r2 = httpx.get(f"{API}/super-admin/companies", headers=admin_headers, timeout=TIMEOUT)
    assert r2.status_code == 200
    assert isinstance(r2.json(), list)


# ---------- 10. Regression iter29: ticket_number still sequencial ----------
def test_regression_iter29_ticket_number(crm_headers):
    p = {
        "customer_name": "TEST_30_iter29",
        "customer_phone": f"+5511999{uuid.uuid4().hex[:6]}",
        "channel": "whatsapp",
        "status": "aberto",
        "priority": "medium",
    }
    r = httpx.post(f"{API}/crm/tickets", headers=crm_headers, json=p, timeout=TIMEOUT)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data.get("ticket_number"), int)
    assert data["ticket_number"] >= 1001
    httpx.delete(f"{API}/crm/tickets/{data['id']}", headers=crm_headers, timeout=TIMEOUT)


# ---------- 11. Regression iter29: webhook creates ticket with ticket_number ----------
def test_regression_iter29_webhook_creates_ticket(crm_headers):
    rl = httpx.get(f"{API}/channels/connections", headers=crm_headers, timeout=TIMEOUT)
    assert rl.status_code == 200
    conns = rl.json()
    if not conns:
        pytest.skip("no channel_connection available for CRM company")
    instance_id = conns[0]["id"]

    phone = f"5511888{uuid.uuid4().hex[:7]}"
    body = {
        "instance_id": instance_id,
        "phone": phone,
        "name": "TEST_30_webhook",
        "message": "iter30 regression",
        "message_id": f"wamid_{uuid.uuid4().hex[:10]}",
    }
    rw = httpx.post(f"{API}/channels/webhook/message", json=body, timeout=TIMEOUT)
    assert rw.status_code == 200
    rt = httpx.get(f"{API}/crm/tickets", headers=crm_headers, timeout=TIMEOUT,
                   params={"search": phone})
    matches = [t for t in rt.json() if t.get("customer_phone") == phone]
    assert matches, "webhook did not create ticket"
    t = matches[0]
    assert isinstance(t.get("ticket_number"), int)
    httpx.delete(f"{API}/crm/tickets/{t['id']}", headers=crm_headers, timeout=TIMEOUT)
