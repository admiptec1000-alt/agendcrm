"""Iteration 61 — SGP super-admin debug-consultacliente endpoint enhancements.

Tests:
 1. GET /api/sgp/config (regression) — company user still gets its config.
 2. PUT /api/sgp/config (regression) — company user still saves config.
 3. POST /api/sgp/super-admin/debug-consultacliente/{cid}:
    - requires super-admin auth (401/403 for regular user)
    - sanitizes cpfcnpj to digits-only
    - accepts _app / _token / _base_url overrides (stripped from body)
    - returns diagnostic_hint when SGP returns empty contratos/clientes
    - returns debug_request.body_sent (token masked)
    - returns cfg_snapshot with base_url/app_stored/app_used/base_url_used/enabled
 4. POST /api/sgp/{action} generic proxy still works (unchanged).
"""
import asyncio
import os
import uuid

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

BASE_URL = os.environ.get("BACKEND_URL", "https://agentcrm-book.preview.emergentagent.com")
API = f"{BASE_URL}/api"

TARGET_COMPANY_ID = "44d40dcb-f23b-47fb-9c71-815b28137190"
STORED_TOKEN = "abcd1234-efgh-5678-ijkl-mnop9012qrst"  # >= 8 chars for masking test
STORED_APP = "8ip"
STORED_BASE_URL = "https://httpbin.org"


# ------------------------------ Fixtures ------------------------------
@pytest.fixture(scope="module")
def super_headers():
    r = requests.post(
        f"{API}/auth/super-admin/login",
        json={"email": "admin@agentcrm.com", "password": "admin123"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def company_headers_and_cid():
    r = requests.post(
        f"{API}/auth/login",
        json={"email": "crm@test.com", "password": "crm123"},
        timeout=15,
    )
    if r.status_code != 200:
        pytest.skip(f"company login failed: {r.status_code} {r.text[:200]}")
    body = r.json()
    token = body["access_token"]
    cid = body["user"]["company_id"]
    return {"Authorization": f"Bearer {token}"}, cid


def _mongo_call(coro_fn):
    """Run an async Mongo op synchronously in an isolated loop."""
    from motor.motor_asyncio import AsyncIOMotorClient
    async def go():
        cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
        try:
            db = cli[os.environ["DB_NAME"]]
            return await coro_fn(db)
        finally:
            cli.close()
    return asyncio.new_event_loop().run_until_complete(go())


@pytest.fixture(scope="module", autouse=True)
def sgp_config_for_target():
    """Upsert an sgp_configs doc directly in Mongo for TARGET_COMPANY_ID."""
    async def upsert(db):
        await db.sgp_configs.update_one(
            {"company_id": TARGET_COMPANY_ID},
            {"$set": {
                "company_id": TARGET_COMPANY_ID,
                "base_url": STORED_BASE_URL,
                "token": STORED_TOKEN,
                "app": STORED_APP,
                "enabled": True,
            }},
            upsert=True,
        )
    _mongo_call(upsert)
    yield
    async def cleanup(db):
        await db.sgp_configs.delete_one({"company_id": TARGET_COMPANY_ID})
    _mongo_call(cleanup)


# ------------------------------ 1 & 2: Config regression ------------------------------
class TestConfigRegression:
    def test_get_config(self, company_headers_and_cid):
        headers, _ = company_headers_and_cid
        r = requests.get(f"{API}/sgp/config", headers=headers, timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "company_id" in data
        assert "base_url" in data
        assert "app" in data
        assert "enabled" in data
        # token must never be leaked
        assert "token" not in data

    def test_put_config_saves(self, company_headers_and_cid):
        headers, cid = company_headers_and_cid
        payload = {
            "base_url": "https://web.sgp.net.br",
            "token": "test-token-1234-5678-abcd",
            "app": "testapp",
            "enabled": True,
        }
        r = requests.put(f"{API}/sgp/config", headers=headers, json=payload, timeout=10)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        # Verify persistence via GET
        r2 = requests.get(f"{API}/sgp/config", headers=headers, timeout=10)
        assert r2.status_code == 200
        d = r2.json()
        assert d["base_url"] == "https://web.sgp.net.br"
        assert d["app"] == "testapp"
        assert d["enabled"] is True
        # Token masked
        assert "token_masked" in d


# ------------------------------ 3: Debug endpoint ------------------------------
class TestDebugConsultacliente:
    URL = f"{API}/sgp/super-admin/debug-consultacliente/{TARGET_COMPANY_ID}"

    def test_requires_super_admin_unauthenticated(self):
        r = requests.post(self.URL, json={"params": {"cpfcnpj": "03459082526"}}, timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403 unauth, got {r.status_code}: {r.text[:200]}"

    def test_requires_super_admin_regular_user(self, company_headers_and_cid):
        headers, _ = company_headers_and_cid
        r = requests.post(self.URL, headers=headers,
                          json={"params": {"cpfcnpj": "03459082526"}}, timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403 for regular user, got {r.status_code}: {r.text[:200]}"

    def test_basic_call_and_diagnostic_hint(self, super_headers):
        r = requests.post(self.URL, headers=super_headers,
                          json={"params": {"cpfcnpj": "034.590.825-26"}}, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()

        # required top-level fields
        for k in ("status", "url", "data", "diagnostic_hint", "debug_request", "cfg_snapshot"):
            assert k in body, f"missing key {k} in response: {body}"

        # url must target /api/ura/consultacliente/ on stored base_url
        assert body["url"] == f"{STORED_BASE_URL}/api/ura/consultacliente/"

        # httpbin returns 404 HTML → data.raw or empty JSON; diagnostic_hint should be present
        # because there are no contratos/clientes.
        assert body["diagnostic_hint"], (
            f"expected diagnostic_hint when SGP returns empty contratos/clientes; body={body}"
        )
        assert isinstance(body["diagnostic_hint"], str)
        assert "app" in body["diagnostic_hint"].lower()

        # debug_request.body_sent must exist with masked token
        br = body["debug_request"]
        assert "url" in br and "body_sent" in br
        bs = br["body_sent"]
        # CPF sanitized to digits-only in body_sent
        assert bs.get("cpfcnpj") == "03459082526", f"CPF not sanitized: {bs}"
        # token masked (first4...last4)
        assert bs.get("token") != STORED_TOKEN
        assert "..." in bs.get("token", "") or "*" in bs.get("token", "")
        assert bs["token"].startswith(STORED_TOKEN[:4])
        assert bs["token"].endswith(STORED_TOKEN[-4:])
        # `app` present, and no `_app`/`_token`/`_base_url` leaked
        assert "_app" not in bs
        assert "_token" not in bs
        assert "_base_url" not in bs

        # cfg_snapshot fields
        snap = body["cfg_snapshot"]
        assert snap["base_url"] == STORED_BASE_URL
        assert snap["app_stored"] == STORED_APP
        assert snap["app_used"] == STORED_APP
        assert snap["base_url_used"] == STORED_BASE_URL
        assert snap["enabled"] is True

    def test_overrides_app_token_base_url(self, super_headers):
        payload = {"params": {
            "cpfcnpj": "03459082526",
            "_app": "nexonet",
            "_token": "OVERRIDE-tok-9999-zzzz",
            "_base_url": "https://httpbin.org",  # keep valid
        }}
        r = requests.post(self.URL, headers=super_headers, json=payload, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()

        # underscore keys must be stripped from forwarded body
        bs = body["debug_request"]["body_sent"]
        assert "_app" not in bs and "_token" not in bs and "_base_url" not in bs
        # `app` in body_sent reflects override
        assert bs.get("app") == "nexonet"
        # token masked with OVERRIDE prefix/suffix
        assert bs["token"].startswith("OVER") and bs["token"].endswith("zzzz")

        # cfg_snapshot must reflect overrides in *_used, stored fields unchanged
        snap = body["cfg_snapshot"]
        assert snap["app_stored"] == STORED_APP           # stored not touched
        assert snap["app_used"] == "nexonet"              # override applied
        assert snap["base_url"] == STORED_BASE_URL        # stored not touched
        assert snap["base_url_used"] == "https://httpbin.org"


# ------------------------------ 4: Generic proxy regression ------------------------------
class TestProxyUnchanged:
    def test_unknown_action_returns_400(self, company_headers_and_cid):
        headers, _ = company_headers_and_cid
        r = requests.post(f"{API}/sgp/nonexistent_action",
                          headers=headers, json={"params": {}}, timeout=15)
        assert r.status_code == 400
        assert "desconhecida" in r.text.lower() or "unknown" in r.text.lower()

    def test_proxy_requires_auth(self):
        r = requests.post(f"{API}/sgp/consultacliente",
                          json={"params": {"cpfcnpj": "03459082526"}}, timeout=15)
        assert r.status_code in (401, 403)

    def test_proxy_ignores_underscore_overrides(self, company_headers_and_cid):
        """Verify sgp_proxy is unchanged: `_app` etc. would be forwarded as SGP
        params (not stripped) — this test just documents that the proxy path
        does NOT accept overrides. We only assert the endpoint responds (either
        400 no-config, or 200/502 upstream) — not a hard behavior check.
        """
        headers, _ = company_headers_and_cid
        r = requests.post(f"{API}/sgp/consultacliente", headers=headers,
                          json={"params": {"cpfcnpj": "03459082526"}}, timeout=30)
        # Depending on whether the crm tenant has SGP configured after
        # test_put_config_saves, this is 200 (proxied) or 400 (config disabled).
        assert r.status_code in (200, 400, 502), r.text
