"""Iteration 42 — Quotes Phase 2: PDF download + send WhatsApp.

Covers:
- GET /quotes/{id}/pdf returns application/pdf with %PDF magic + size > 5KB
- Auth required for /pdf, 404 on bad id
- POST /quotes/{id}/send-whatsapp:
    * resolves phone via data.phone, quote.client_id, ticket.customer_phone
    * 400 when phone cannot be resolved
    * 404 when connection_id doesn't belong to tenant
    * 502 (not 500) on microservice failure with detailed error
    * logs ticket message type=document attachment_kind=quote_pdf even on failure
    * quote.last_sent_at/last_sent_phone written; status stays 'rascunho' on failure
- Multi-tenant: company A using company B's connection -> 404
- Local microservice on :3002 /send-media accepts payload + returns 400 'Not connected'
"""
import os
import re
import requests
import pytest

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


@pytest.fixture(scope="module")
def crm_connection_id(crm_headers):
    """Pick any whatsapp connection in CRM tenant."""
    r = requests.get(f"{API}/channels/connections", headers=crm_headers, timeout=20)
    assert r.status_code == 200, r.text
    conns = r.json()
    assert conns, "CRM tenant must have at least one channel connection"
    return conns[0]["id"]


@pytest.fixture(scope="module")
def boss_connection_id(boss_headers):
    r = requests.get(f"{API}/channels/connections", headers=boss_headers, timeout=20)
    if r.status_code != 200 or not r.json():
        pytest.skip("Boss tenant has no connection")
    return r.json()[0]["id"]


@pytest.fixture(scope="module")
def sample_quote(crm_headers):
    """Create a temp quote (status=rascunho) for tests, cleanup at module teardown."""
    payload = {
        "items": [{"description": "TEST_iter42 PDF Item", "unit": "un", "quantity": 2, "unit_price": 50.0}],
        "freights": [{"description": "TEST_iter42 Frete", "km_total": 10, "price_per_km": 4.0}],
        "minimum_billing_kg": "10kg",
        "payment_terms": "30",
        "payment_method": "Boleto",
        "validity_days": 15,
        "notes": "TEST iter42 phase2",
    }
    r = requests.post(f"{API}/quotes", headers=crm_headers, json=payload, timeout=30)
    assert r.status_code == 200, r.text
    q = r.json()
    yield q
    requests.delete(f"{API}/quotes/{q['id']}", headers=crm_headers, timeout=20)


# ─── 1. GET /pdf ─────────────────────────────────────────────────────────────
class TestPdfDownload:
    def test_pdf_returns_application_pdf(self, crm_headers, sample_quote):
        r = requests.get(f"{API}/quotes/{sample_quote['id']}/pdf", headers=crm_headers, timeout=60)
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("application/pdf")
        body = r.content
        assert body[:5] == b"%PDF-", f"PDF magic missing, got: {body[:20]}"
        assert len(body) > 5 * 1024, f"PDF too small: {len(body)} bytes"
        cd = r.headers.get("content-disposition", "")
        assert "orcamento" in cd.lower() and ".pdf" in cd.lower()

    def test_pdf_requires_auth(self, sample_quote):
        r = requests.get(f"{API}/quotes/{sample_quote['id']}/pdf", timeout=20)
        assert r.status_code in (401, 403), f"Expected 401/403, got {r.status_code}"

    def test_pdf_404(self, crm_headers):
        r = requests.get(f"{API}/quotes/does-not-exist-uuid/pdf", headers=crm_headers, timeout=20)
        assert r.status_code == 404


# ─── 2. POST /send-whatsapp ──────────────────────────────────────────────────
class TestSendWhatsapp:
    def test_phone_required_when_no_client_no_ticket(self, crm_headers, crm_connection_id, sample_quote):
        # quote has no client_id, no ticket_id, send without phone -> 400
        r = requests.post(
            f"{API}/quotes/{sample_quote['id']}/send-whatsapp",
            headers=crm_headers,
            json={"connection_id": crm_connection_id},
            timeout=30,
        )
        assert r.status_code == 400, r.text
        assert "elefone" in r.json().get("detail", "").lower() or "phone" in r.json().get("detail", "").lower()

    def test_invalid_connection_returns_404(self, crm_headers, sample_quote):
        r = requests.post(
            f"{API}/quotes/{sample_quote['id']}/send-whatsapp",
            headers=crm_headers,
            json={"connection_id": "nonexistent-conn-id", "phone": "5511999999999"},
            timeout=30,
        )
        assert r.status_code == 404, r.text

    def test_microservice_failure_returns_502_not_500(self, crm_headers, crm_connection_id, sample_quote):
        """In dev, prod microservice doesn't have /send-media -> 404 on upstream -> 502 from backend."""
        r = requests.post(
            f"{API}/quotes/{sample_quote['id']}/send-whatsapp",
            headers=crm_headers,
            json={
                "connection_id": crm_connection_id,
                "phone": "5511988887777",
                "caption": "TEST_iter42 caption",
            },
            timeout=120,
        )
        assert r.status_code == 502, f"Expected 502, got {r.status_code}: {r.text}"
        detail = r.json().get("detail", "")
        # Must contain a useful message — either HTTP NNN or Falha de rede
        assert ("HTTP" in detail or "Falha" in detail or "send-media" in detail.lower()), detail

    def test_ticket_logs_message_even_on_failure(self, crm_headers, crm_connection_id, sample_quote):
        # 1) Create a ticket
        # First find/create a client to attach if needed - we'll try creating a ticket directly
        ticket_payload = {
            "customer_name": "TEST_iter42 Customer",
            "customer_phone": "5511977776666",
            "subject": "TEST_iter42 ticket",
            "channel": "whatsapp",
        }
        rt = requests.post(f"{API}/crm/tickets", headers=crm_headers, json=ticket_payload, timeout=20)
        if rt.status_code not in (200, 201):
            pytest.skip(f"Cannot create ticket: {rt.status_code} {rt.text}")
        ticket = rt.json()
        ticket_id = ticket.get("id")

        try:
            # 2) Send (will fail because microservice doesn't have /send-media)
            r = requests.post(
                f"{API}/quotes/{sample_quote['id']}/send-whatsapp",
                headers=crm_headers,
                json={
                    "connection_id": crm_connection_id,
                    "phone": "5511977776666",
                    "ticket_id": ticket_id,
                    "caption": "TEST_iter42 ticket-attached caption",
                },
                timeout=120,
            )
            assert r.status_code == 502, f"Expected 502, got {r.status_code}"

            # 3) Re-fetch ticket and verify message was appended despite failure
            rt2 = requests.get(f"{API}/crm/tickets/{ticket_id}", headers=crm_headers, timeout=20)
            assert rt2.status_code == 200
            t2 = rt2.json()
            messages = t2.get("messages", [])
            doc_msgs = [m for m in messages if m.get("type") == "document" and m.get("attachment_kind") == "quote_pdf"]
            assert len(doc_msgs) >= 1, f"Document message not logged: {messages}"
            m = doc_msgs[-1]
            assert m.get("quote_id") == sample_quote["id"]
            assert m.get("attachment_filename", "").endswith(".pdf")
            assert m.get("delivery_status") == "failed"
            assert m.get("delivery_error")  # populated

            # 4) Quote status must NOT have flipped to 'enviado' on failure
            rq = requests.get(f"{API}/quotes/{sample_quote['id']}", headers=crm_headers, timeout=20)
            q = rq.json()
            assert q.get("status") == "rascunho", f"Quote status should remain rascunho on failure, got {q.get('status')}"
            assert q.get("last_sent_at"), "last_sent_at must be recorded even on failure"
            assert q.get("last_sent_phone") == "5511977776666"
            assert q.get("last_sent_status") == "failed"
        finally:
            requests.delete(f"{API}/crm/tickets/{ticket_id}", headers=crm_headers, timeout=20)


# ─── 3. Multi-tenant isolation on send-whatsapp ──────────────────────────────
class TestMultiTenantSend:
    def test_cross_tenant_connection_returns_404(self, crm_headers, boss_headers, sample_quote):
        # Get boss's connection id, then try to send CRM's quote via boss conn -> 404
        rb = requests.get(f"{API}/channels/connections", headers=boss_headers, timeout=20)
        if rb.status_code != 200 or not rb.json():
            pytest.skip("Boss tenant has no connection to test cross-tenant")
        boss_conn = rb.json()[0]["id"]
        r = requests.post(
            f"{API}/quotes/{sample_quote['id']}/send-whatsapp",
            headers=crm_headers,
            json={"connection_id": boss_conn, "phone": "5511999999999"},
            timeout=30,
        )
        assert r.status_code == 404, f"Expected 404 cross-tenant leak prevention, got {r.status_code}: {r.text}"


# ─── 4. Direct microservice :3002 /send-media probe ──────────────────────────
class TestMicroserviceEndpoint:
    def test_send_media_endpoint_exists_and_validates(self):
        """Probe local microservice — /send-media must accept payload shape and return 'Not connected'."""
        try:
            r = requests.post(
                "http://localhost:3002/instances/test/send-media",
                json={
                    "phone": "5511999999999",
                    "filename": "a.pdf",
                    "mimetype": "application/pdf",
                    "data_base64": "AA==",
                    "caption": "x",
                },
                timeout=10,
            )
        except requests.exceptions.RequestException as e:
            pytest.skip(f"Local microservice :3002 not reachable: {e}")
        # Endpoint must exist (not 404) — may return 400 for not-connected which is fine
        assert r.status_code != 404, f"Endpoint /send-media missing: {r.status_code} {r.text}"
        body = r.json()
        assert "success" in body
        assert body["success"] is False  # because instance 'test' not connected
        assert "Not connected" in body.get("error", "") or r.status_code == 400
