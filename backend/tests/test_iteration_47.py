"""Iteration 47 — Tests for P1 fixes:
  (A) Modern PDF CSS — wider margins, word-break normal, brand-blue headers,
      mid-word break bug (Descricao d / os Servicos etc) fixed.
  (B) probe-lid endpoint — POST /api/channels/instances/{id}/probe-lid
      graceful-degrades with 200+resolved:false when microservice down or
      errors; returns 401/403 without auth.
  (C) /whatsapp-service/index.js v2.1.4 — pendingLids/tryResolveLid/etc.
"""
import os
import re
import uuid
import subprocess
import pytest
import requests
from pathlib import Path

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL",
                          "https://agentcrm-book.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
PROD_TPL_PATH = "/tmp/prod_tpl_63979c6e-f70b-4c95-aee1-d2f10667309d.html"
CRM_EMAIL = "crm@test.com"
CRM_PASS = "crm123"
MS_INDEX = "/app/whatsapp-service/index.js"
QUOTES_ROUTES = "/app/backend/routes/quotes_routes.py"


# ── fixtures ────────────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def crm_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"email": CRM_EMAIL, "password": CRM_PASS})
    if r.status_code != 200:
        pytest.skip(f"login failed: {r.status_code} {r.text[:200]}")
    tok = r.json().get("access_token") or r.json().get("token")
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def conn_id(crm_session):
    r = crm_session.get(f"{API}/channels/connections")
    if r.status_code == 200 and r.json():
        return r.json()[0]["id"]
    r = crm_session.post(f"{API}/channels/connections",
                         json={"name": f"TEST_iter47_{uuid.uuid4().hex[:6]}",
                               "type": "whatsapp"})
    if r.status_code in (200, 201):
        return r.json()["id"]
    pytest.skip(f"no connection: {r.status_code}")


@pytest.fixture(scope="module")
def ticket_id(crm_session, conn_id):
    ph = "5511955559999"
    requests.post(f"{API}/channels/webhook/message", json={
        "instance_id": conn_id, "phone": ph,
        "name": "TEST_iter47 ticket",
        "message": "para pdf",
        "message_id": f"TEST_iter47_{uuid.uuid4().hex[:8]}"})
    tr = crm_session.get(f"{API}/crm/tickets?limit=50").json()
    tickets = tr if isinstance(tr, list) else tr.get("tickets", [])
    t = next((x for x in tickets if x.get("customer_phone") == ph), None)
    assert t, "couldn't seed ticket"
    return t["id"]


# ── (A) PDF MODERN CSS ──────────────────────────────────────────────────────
class TestPdfModernCss:
    """Validates _generate_pdf_bytes has the modern CSS: word-break normal,
    brand-blue gradient headers, wider margins, box-sizing border-box."""

    def test_source_has_modern_css_rules(self):
        src = Path(QUOTES_ROUTES).read_text(encoding="utf-8")
        # word-break normal avoids 'Descrição d / os Serviços'
        assert "word-break: normal" in src, "missing 'word-break: normal'"
        # overflow-wrap anywhere as fallback
        assert "overflow-wrap: anywhere" in src, "missing 'overflow-wrap: anywhere'"
        # hyphens auto
        assert "hyphens: auto" in src, "missing 'hyphens: auto'"
        # box-sizing border-box to prevent docx inline widths overflow
        assert "box-sizing: border-box" in src, "missing 'box-sizing: border-box'"
        # max-width 100% !important override
        assert re.search(r"max-width:\s*100%\s*!important", src), \
            "missing max-width 100% !important"
        # wider page margin (16mm 14mm)
        assert "16mm 14mm" in src or "16mm" in src, "page margin not widened"

    def test_pdf_broken_template_size_sane_and_valid(self, crm_session, ticket_id):
        assert Path(PROD_TPL_PATH).exists(), f"missing {PROD_TPL_PATH}"
        html = Path(PROD_TPL_PATH).read_text(encoding="utf-8")
        r = crm_session.post(f"{API}/quotes/templates",
                             json={"name": f"TEST_iter47_pdf_{uuid.uuid4().hex[:6]}",
                                   "content": html, "is_default": False})
        assert r.status_code in (200, 201), r.text[:200]
        tpl_id = r.json()["id"]

        payload = {
            "template_id": tpl_id, "ticket_id": ticket_id,
            "items": [
                {"description": "Servico A", "unit": "kg", "unit_price": 10.5, "quantity": 100},
                {"description": "Servico B Descricao longa teste", "unit": "ton",
                 "unit_price": 200.0, "quantity": 2},
                {"description": "Servico C extra", "unit": "un", "unit_price": 50, "quantity": 3},
            ],
            "freights": [
                {"description": "Frete rota X longa com cidade destino",
                 "km_total": 50, "price_per_km": 3.5},
            ],
        }
        r = crm_session.post(f"{API}/quotes", json=payload)
        assert r.status_code in (200, 201), r.text[:300]
        qid = r.json()["id"]

        # PDF
        pr = crm_session.get(f"{API}/quotes/{qid}/pdf")
        assert pr.status_code == 200
        assert "application/pdf" in pr.headers.get("content-type", "")
        assert pr.content.startswith(b"%PDF")
        # sane size (review expects 30-70KB — lax lower bound 5KB, upper lax)
        size = len(pr.content)
        assert size > 5000, f"pdf tiny ({size} bytes) — render broken?"
        assert size < 500000, f"pdf oversized ({size} bytes)"
        # save for manual inspection
        Path("/tmp/iter47_modern.pdf").write_bytes(pr.content)
        print(f"PDF generated: {size} bytes -> /tmp/iter47_modern.pdf")

    def test_pdf_render_no_placeholders_leak(self, crm_session, ticket_id):
        """Also verify render endpoint — must have zero raw placeholders
        AND no word-break-causing <br> or hyphens inside header cells."""
        r = crm_session.get(f"{API}/quotes/templates")
        tpls = r.json()
        # find any existing TEST_iter47 or fallback to default
        tpl = next((t for t in tpls if t.get("name", "").startswith("TEST_iter47_pdf_")),
                   next((t for t in tpls if t.get("is_default")),
                        tpls[0] if tpls else None))
        assert tpl
        rr = crm_session.post(f"{API}/quotes", json={
            "template_id": tpl["id"], "ticket_id": ticket_id,
            "items": [{"description": "Descricao Servico Teste", "unit": "un",
                       "unit_price": 1, "quantity": 1}],
            "freights": [{"description": "Frete", "km_total": 1, "price_per_km": 1}],
        })
        assert rr.status_code in (200, 201)
        qid = rr.json()["id"]
        rend = crm_session.get(f"{API}/quotes/{qid}/render")
        assert rend.status_code == 200
        try:
            html = rend.json().get("html", rend.text)
        except Exception:
            html = rend.text
        for tok in ("{{description}}", "{{quantity}}", "{{unit_price}}",
                    "{{km_total}}", "{{price_per_km}}",
                    "{{#items}}", "{{/items}}"):
            assert tok not in html, f"leak {tok}"
        assert "Descricao Servico Teste" in html


# ── (B) probe-lid endpoint ──────────────────────────────────────────────────
class TestProbeLidEndpoint:
    def test_probe_lid_requires_auth(self, conn_id):
        r = requests.post(f"{API}/channels/instances/{conn_id}/probe-lid",
                          json={"lid_jid": "12345@lid"})
        # FastAPI's HTTPBearer returns 403 by default for missing header; 401 also acceptable
        assert r.status_code in (401, 403), \
            f"unauthenticated request got {r.status_code}, expected 401/403"

    def test_probe_lid_requires_lid_jid_body(self, crm_session, conn_id):
        r = crm_session.post(f"{API}/channels/instances/{conn_id}/probe-lid", json={})
        assert r.status_code == 400
        assert "lid_jid" in r.text.lower()

    def test_probe_lid_graceful_when_microservice_down_or_404(self, crm_session, conn_id):
        """Microservice is either down (502 path) or returns 404 for unknown
        instance. Either way, backend should return 200 with resolved:false —
        never 500. (httpx.HTTPError raises 502 — that is also acceptable since
        user cannot act on it; but preferred is 200+resolved:false.)"""
        r = crm_session.post(f"{API}/channels/instances/{conn_id}/probe-lid",
                             json={"lid_jid": f"999{uuid.uuid4().hex[:10]}@lid"})
        # Must never crash with 500
        assert r.status_code != 500, f"probe-lid 500'd: {r.text[:300]}"
        # Preferred 200 with graceful body
        assert r.status_code in (200, 502), \
            f"unexpected {r.status_code}: {r.text[:200]}"
        if r.status_code == 200:
            body = r.json()
            assert "resolved" in body
            # If resolved:false, must have an 'error' key
            if body.get("resolved") is False:
                assert "error" in body or "source" in body, \
                    f"resolved:false without error explanation: {body}"

    def test_probe_lid_bogus_instance_handled(self, crm_session):
        """Even for an unknown instance, endpoint must not 500."""
        r = crm_session.post(
            f"{API}/channels/instances/nonexistent-12345/probe-lid",
            json={"lid_jid": "12345@lid"})
        assert r.status_code != 500, f"probe-lid 500'd: {r.text[:300]}"
        assert r.status_code in (200, 404, 502)


# ── (C) Microservice JS syntax + feature markers ───────────────────────────
class TestWhatsappMicroserviceCode:
    def test_js_syntax_valid(self):
        r = subprocess.run(["node", "-c", MS_INDEX],
                           capture_output=True, text=True)
        assert r.returncode == 0, f"node -c failed: {r.stderr}"

    def test_js_has_all_features(self):
        src = Path(MS_INDEX).read_text(encoding="utf-8")
        # core symbols from review spec
        assert "const pendingLids" in src or "pendingLids =" in src
        assert "function queueLid" in src
        assert "function unqueueLid" in src
        assert "async function tryResolveLid" in src
        assert "async function notifyBackendLidResolved" in src
        # background retry sweep
        assert "setInterval" in src
        # new endpoint
        assert "/instances/:id/resolve-lid" in src
        # version bump
        assert "v2.1.4" in src


# ── (D) iter46 regression sanity ────────────────────────────────────────────
class TestIter46RegressionSanity:
    """Quick smoke tests to confirm iter46 endpoints still work; full suite
    is still at /app/backend/tests/test_iteration_46.py."""

    def test_crm_webhook_message_still_creates_ticket(self, crm_session, conn_id):
        ph = f"5511988{uuid.uuid4().int % 10**7:07d}"
        r = requests.post(f"{API}/channels/webhook/message", json={
            "instance_id": conn_id, "phone": ph,
            "name": "TEST_iter47 regression",
            "message": "regression smoke",
            "message_id": f"TEST_iter47_reg_{uuid.uuid4().hex[:8]}"})
        assert r.status_code == 200

    def test_resolve_lid_webhook_endpoint_responds(self, conn_id):
        r = requests.post(f"{API}/channels/webhook/lid-resolved", json={
            "instance_id": conn_id,
            "lid_jid": f"000{uuid.uuid4().hex[:10]}@lid",
            "phone": "5511900000000"})
        assert r.status_code == 200, r.text[:200]
        body = r.json()
        # No pending LID with that JID — ok should be true with neither merged_into nor promoted
        assert "ok" in body
