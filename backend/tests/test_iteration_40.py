"""Iteration 40 — Quotes (Orçamentos) module tests.

Covers:
- Auto-seed default template per company
- CRUD: services, freights, templates, quotes
- Compute totals + sequential quote_number
- Multi-tenant isolation (CRM tenant vs Boss tenant)
- Render endpoint produces R$-formatted HTML with item/freight rows
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

CRM = {"email": "crm@test.com", "password": "crm123", "subdomain": "crmtest"}
BOSS = {"email": "admin@boss.com.br", "password": "boss123", "subdomain": "boss"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def crm_headers():
    return {"Authorization": f"Bearer {_login(CRM)}"}


@pytest.fixture(scope="module")
def boss_headers():
    return {"Authorization": f"Bearer {_login(BOSS)}"}


# ─── Templates: auto-seed + CRUD ─────────────────────────────────────────────
class TestTemplates:
    def test_auto_seed_default(self, crm_headers):
        r = requests.get(f"{API}/quotes/templates", headers=crm_headers, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list) and len(data) >= 1
        defaults = [t for t in data if t.get("is_default")]
        assert len(defaults) >= 1
        assert any("{{quote_number}}" in (t.get("content") or "") for t in defaults)

    def test_create_and_exclusive_default(self, crm_headers):
        r = requests.post(f"{API}/quotes/templates", headers=crm_headers, json={
            "name": "TEST_iter40_tmpl", "content": "<p>{{quote_number}}</p>", "is_default": True,
        }, timeout=20)
        assert r.status_code == 200, r.text
        new_id = r.json()["id"]
        # Verify only one is_default remains
        r2 = requests.get(f"{API}/quotes/templates", headers=crm_headers, timeout=20)
        defaults = [t for t in r2.json() if t.get("is_default")]
        assert len(defaults) == 1 and defaults[0]["id"] == new_id

        # Update name + content
        r3 = requests.put(f"{API}/quotes/templates/{new_id}", headers=crm_headers,
                          json={"name": "TEST_iter40_tmpl_upd"}, timeout=20)
        assert r3.status_code == 200
        assert r3.json()["name"] == "TEST_iter40_tmpl_upd"

        # Delete
        r4 = requests.delete(f"{API}/quotes/templates/{new_id}", headers=crm_headers, timeout=20)
        assert r4.status_code == 200 and r4.json().get("deleted") is True

    def test_get_template_404(self, crm_headers):
        r = requests.get(f"{API}/quotes/templates/does-not-exist", headers=crm_headers, timeout=20)
        assert r.status_code == 404


# ─── Services CRUD ───────────────────────────────────────────────────────────
class TestServices:
    sid = None

    def test_create(self, crm_headers):
        r = requests.post(f"{API}/quotes/services", headers=crm_headers, json={
            "description": "TEST_iter40 Servico A", "unit": "kg", "default_price": 12.5,
        }, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["description"] == "TEST_iter40 Servico A"
        assert d["unit"] == "kg"
        assert d["default_price"] == 12.5
        assert d["is_active"] is True
        TestServices.sid = d["id"]

    def test_list_contains(self, crm_headers):
        r = requests.get(f"{API}/quotes/services", headers=crm_headers, timeout=20)
        assert r.status_code == 200
        assert any(s["id"] == TestServices.sid for s in r.json())

    def test_update_and_persist(self, crm_headers):
        r = requests.put(f"{API}/quotes/services/{TestServices.sid}", headers=crm_headers,
                         json={"default_price": 20.0}, timeout=20)
        assert r.status_code == 200 and r.json()["default_price"] == 20.0

    def test_delete(self, crm_headers):
        r = requests.delete(f"{API}/quotes/services/{TestServices.sid}", headers=crm_headers, timeout=20)
        assert r.status_code == 200
        # 404 on second delete
        r2 = requests.delete(f"{API}/quotes/services/{TestServices.sid}", headers=crm_headers, timeout=20)
        assert r2.status_code == 404


# ─── Freights CRUD ───────────────────────────────────────────────────────────
class TestFreights:
    fid = None

    def test_create(self, crm_headers):
        r = requests.post(f"{API}/quotes/freights", headers=crm_headers, json={
            "description": "TEST_iter40 Frete SP-RJ", "default_km": 430, "default_price_per_km": 3.0,
        }, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["default_km"] == 430 and d["default_price_per_km"] == 3.0
        TestFreights.fid = d["id"]

    def test_update_and_delete(self, crm_headers):
        r = requests.put(f"{API}/quotes/freights/{TestFreights.fid}", headers=crm_headers,
                         json={"default_km": 500}, timeout=20)
        assert r.status_code == 200 and r.json()["default_km"] == 500
        r2 = requests.delete(f"{API}/quotes/freights/{TestFreights.fid}", headers=crm_headers, timeout=20)
        assert r2.status_code == 200


# ─── Quotes lifecycle + render ───────────────────────────────────────────────
class TestQuotes:
    qid = None
    qnum = None
    sid = None
    fid = None

    def test_setup_catalog(self, crm_headers):
        s = requests.post(f"{API}/quotes/services", headers=crm_headers, json={
            "description": "TEST_iter40 Coleta Residuos", "unit": "kg", "default_price": 4.5,
        }, timeout=20).json()
        f = requests.post(f"{API}/quotes/freights", headers=crm_headers, json={
            "description": "TEST_iter40 Rota X", "default_km": 100, "default_price_per_km": 2.5,
        }, timeout=20).json()
        TestQuotes.sid, TestQuotes.fid = s["id"], f["id"]

    def test_create_quote_computes_totals(self, crm_headers):
        payload = {
            "items": [
                {"description": "Coleta A", "unit": "kg", "quantity": 100, "unit_price": 5.0,
                 "quote_service_id": TestQuotes.sid},
                {"description": "Coleta B", "unit": "kg", "quantity": 50, "unit_price": 2.0},
            ],
            "freights": [
                {"description": "Frete X", "km_total": 100, "price_per_km": 3.0,
                 "quote_freight_id": TestQuotes.fid},
            ],
            "minimum_billing_kg": "100kg",
            "payment_terms": "30",
            "payment_method": "Boleto",
            "validity_days": 15,
            "notes": "TEST iter40",
        }
        r = requests.post(f"{API}/quotes", headers=crm_headers, json=payload, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "rascunho"
        assert d["items_total"] == 100 * 5.0 + 50 * 2.0  # 600
        assert d["freights_total"] == 100 * 3.0  # 300
        assert d["total_value"] == 900
        assert isinstance(d["quote_number"], int) and d["quote_number"] >= 1
        TestQuotes.qid = d["id"]
        TestQuotes.qnum = d["quote_number"]

    def test_get_quote(self, crm_headers):
        r = requests.get(f"{API}/quotes/{TestQuotes.qid}", headers=crm_headers, timeout=20)
        assert r.status_code == 200 and "_id" not in r.json()
        assert r.json()["total_value"] == 900

    def test_get_404(self, crm_headers):
        r = requests.get(f"{API}/quotes/non-existent-id", headers=crm_headers, timeout=20)
        assert r.status_code == 404

    def test_list_with_filter(self, crm_headers):
        r = requests.get(f"{API}/quotes?status=rascunho", headers=crm_headers, timeout=20)
        assert r.status_code == 200
        assert all(q["status"] == "rascunho" for q in r.json())
        assert any(q["id"] == TestQuotes.qid for q in r.json())

    def test_update_recalcs(self, crm_headers):
        r = requests.put(f"{API}/quotes/{TestQuotes.qid}", headers=crm_headers, json={
            "items": [{"description": "single", "unit": "un", "quantity": 2, "unit_price": 100}],
            "freights": [],
        }, timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d["items_total"] == 200 and d["freights_total"] == 0 and d["total_value"] == 200

    def test_render_html(self, crm_headers):
        # Restore items+freights so loops render
        requests.put(f"{API}/quotes/{TestQuotes.qid}", headers=crm_headers, json={
            "items": [{"description": "Render Item", "unit": "kg", "quantity": 10, "unit_price": 5}],
            "freights": [{"description": "Render Frete", "km_total": 10, "price_per_km": 3}],
        }, timeout=20)
        r = requests.get(f"{API}/quotes/{TestQuotes.qid}/render", headers=crm_headers, timeout=20)
        assert r.status_code == 200
        body = r.json()
        assert "html" in body and "quote" in body
        html = body["html"]
        assert "R$" in html
        assert "Render Item" in html
        assert "Render Frete" in html
        # Loop blocks should be expanded (no leftover {{#items}})
        assert "{{#items}}" not in html and "{{#freights}}" not in html

    def test_sequential_quote_number(self, crm_headers):
        r = requests.post(f"{API}/quotes", headers=crm_headers, json={
            "items": [{"description": "X", "quantity": 1, "unit_price": 1}],
            "freights": [],
        }, timeout=20)
        assert r.status_code == 200
        new_num = r.json()["quote_number"]
        assert new_num == TestQuotes.qnum + 1
        # Cleanup the second
        requests.delete(f"{API}/quotes/{r.json()['id']}", headers=crm_headers, timeout=20)

    def test_delete_quote(self, crm_headers):
        r = requests.delete(f"{API}/quotes/{TestQuotes.qid}", headers=crm_headers, timeout=20)
        assert r.status_code == 200 and r.json().get("deleted") is True
        # cleanup catalog
        requests.delete(f"{API}/quotes/services/{TestQuotes.sid}", headers=crm_headers, timeout=20)
        requests.delete(f"{API}/quotes/freights/{TestQuotes.fid}", headers=crm_headers, timeout=20)


# ─── Multi-tenant isolation ──────────────────────────────────────────────────
class TestMultiTenant:
    def test_crm_service_not_visible_to_boss(self, crm_headers, boss_headers):
        # Create in CRM
        s = requests.post(f"{API}/quotes/services", headers=crm_headers, json={
            "description": "TEST_iter40 Tenant Iso", "unit": "un", "default_price": 1,
        }, timeout=20).json()
        sid = s["id"]
        try:
            # List in Boss should not contain this id
            boss_list = requests.get(f"{API}/quotes/services", headers=boss_headers, timeout=20).json()
            assert all(x["id"] != sid for x in boss_list)
            # Update from boss → 404
            r_upd = requests.put(f"{API}/quotes/services/{sid}", headers=boss_headers,
                                 json={"default_price": 999}, timeout=20)
            assert r_upd.status_code == 404
            # Delete from boss → 404
            r_del = requests.delete(f"{API}/quotes/services/{sid}", headers=boss_headers, timeout=20)
            assert r_del.status_code == 404
        finally:
            requests.delete(f"{API}/quotes/services/{sid}", headers=crm_headers, timeout=20)

    def test_quote_not_visible_to_other_tenant(self, crm_headers, boss_headers):
        q = requests.post(f"{API}/quotes", headers=crm_headers, json={
            "items": [{"description": "iso", "quantity": 1, "unit_price": 1}],
            "freights": [],
        }, timeout=20).json()
        qid = q["id"]
        try:
            r = requests.get(f"{API}/quotes/{qid}", headers=boss_headers, timeout=20)
            assert r.status_code == 404
            r2 = requests.get(f"{API}/quotes/{qid}/render", headers=boss_headers, timeout=20)
            assert r2.status_code == 404
        finally:
            requests.delete(f"{API}/quotes/{qid}", headers=crm_headers, timeout=20)
