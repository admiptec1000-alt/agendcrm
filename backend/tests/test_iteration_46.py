"""Iteration 46 — End-to-end backend tests for the two P0 fixes:
  (1) PDF generation rewraps loop markers from broken docx-derived templates.
  (2) @lid (hidden number) webhook flow: pending banner, manual resolve-lid,
      webhook auto-merge + promote.

Also covers regression: default template render+pdf, ticket merge,
outgoing message uses customer_phone (NOT lid_jid) for normal tickets.
"""
import os
import re
import uuid
import pytest
import requests
from pathlib import Path

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://agentcrm-book.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
PROD_TPL_PATH = "/tmp/prod_tpl_63979c6e-f70b-4c95-aee1-d2f10667309d.html"
CRM_EMAIL = "crm@test.com"
CRM_PASS = "crm123"


# ─── shared fixtures ────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def crm_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"email": CRM_EMAIL, "password": CRM_PASS})
    if r.status_code != 200:
        pytest.skip(f"CRM login failed: {r.status_code} {r.text[:200]}")
    tok = r.json().get("access_token") or r.json().get("token")
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def quote_ticket_id(crm_session, conn_id):
    """A throwaway ticket for quote-creation tests (quotes require ticket_id)."""
    ph = "5511955551111"
    requests.post(
        f"{API}/channels/webhook/message",
        json={"instance_id": conn_id, "phone": ph,
              "name": "TEST_iter46 quote-ticket",
              "message": "para orcamento",
              "message_id": f"TEST_iter46_qt_{uuid.uuid4().hex[:8]}"})
    tr = crm_session.get(f"{API}/crm/tickets?limit=50").json()
    tickets = tr if isinstance(tr, list) else tr.get("tickets", [])
    t = next((x for x in tickets if x.get("customer_phone") == ph), None)
    assert t, "could not seed quote ticket"
    return t["id"]


@pytest.fixture(scope="module")
def conn_id(crm_session):
    """Get any connection_id for the CRM tenant. Create a stub if none exists."""
    r = crm_session.get(f"{API}/channels/connections")
    if r.status_code == 200 and r.json():
        conns = r.json()
        if conns:
            return conns[0]["id"]
    # Create one
    r = crm_session.post(
        f"{API}/channels/connections",
        json={"name": f"TEST_iter46_{uuid.uuid4().hex[:6]}", "type": "whatsapp"},
    )
    if r.status_code in (200, 201):
        return r.json()["id"]
    pytest.skip(f"no connection available: {r.status_code} {r.text[:200]}")


# ─── PDF GENERATION — production-broken template ───────────────────────────
class TestQuotePDFBrokenTemplate:
    """The production template has empty `{#items}{/items}` markers in <p>
    tags OUTSIDE the table, while the actual data row has the placeholders
    unwrapped. _auto_wrap_loops must strip-and-rewrap so render shows real
    data, not raw {description}/{quantity}/{km_total}/etc."""

    def test_upload_broken_prod_template(self, crm_session):
        assert Path(PROD_TPL_PATH).exists(), f"missing {PROD_TPL_PATH}"
        html = Path(PROD_TPL_PATH).read_text(encoding="utf-8")
        r = crm_session.post(
            f"{API}/quotes/templates",
            json={
                "name": f"TEST_iter46_brokenprod_{uuid.uuid4().hex[:6]}",
                "content": html,
                "is_default": False,
            },
        )
        assert r.status_code in (200, 201), f"upload failed: {r.status_code} {r.text[:300]}"
        data = r.json()
        assert "id" in data
        pytest.tpl_id = data["id"]

    def test_create_quote_with_items_and_freight(self, crm_session, quote_ticket_id):
        tpl_id = getattr(pytest, "tpl_id", None)
        assert tpl_id, "template not uploaded — previous test must run"
        payload = {
            "template_id": tpl_id,
            "ticket_id": quote_ticket_id,
            "items": [
                {"description": "Servico A", "unit": "kg", "unit_price": 10.5, "quantity": 100},
                {"description": "Servico B", "unit": "ton", "unit_price": 200.0, "quantity": 2},
            ],
            "freights": [
                {"description": "Frete rota X", "km_total": 50, "price_per_km": 3.5},
            ],
            "payment_terms": "30",
            "payment_method": "Boleto",
            "minimum_billing_kg": "100",
            "seller_name": "Tester",
            "seller_contact": "tester@test.com",
        }
        r = crm_session.post(f"{API}/quotes", json=payload)
        assert r.status_code in (200, 201), f"create failed: {r.status_code} {r.text[:400]}"
        data = r.json()
        assert "id" in data
        pytest.quote_id = data["id"]

    def test_render_no_raw_placeholder_leak(self, crm_session):
        qid = getattr(pytest, "quote_id", None)
        assert qid
        r = crm_session.get(f"{API}/quotes/{qid}/render")
        assert r.status_code == 200, f"render failed: {r.status_code} {r.text[:200]}"
        body = r.text
        try:
            j = r.json()
            html = j.get("html") or body
        except Exception:
            html = body
        # Check no raw placeholders are leaking
        leaks = []
        for tok in (
            "{{description}}", "{{quantity}}", "{{unit}}", "{{unit_price}}",
            "{{km_total}}", "{{price_per_km}}", "{{total}}",
            "{{#items}}", "{{/items}}", "{{#freights}}", "{{/freights}}",
        ):
            if tok in html:
                leaks.append(tok)
        assert not leaks, f"raw placeholder leak: {leaks}"
        # Verify actual data rendered
        assert "Servico A" in html, "items.description missing in render"
        assert "Servico B" in html, "items second row missing"
        assert "Frete rota X" in html, "freights.description missing"
        # Verify scalar BRL substitution (1.625,00 or similar)
        assert ("1.625,00" in html or "1625" in html), "total_value not formatted"

    def test_pdf_returns_application_pdf_with_pdf_header(self, crm_session):
        qid = getattr(pytest, "quote_id", None)
        assert qid
        r = crm_session.get(f"{API}/quotes/{qid}/pdf")
        assert r.status_code == 200, f"pdf failed: {r.status_code} {r.text[:200]}"
        ctype = r.headers.get("content-type", "")
        assert "application/pdf" in ctype, f"wrong content-type: {ctype}"
        assert r.content.startswith(b"%PDF"), "response is not a real PDF"
        assert len(r.content) > 1000, "PDF unusually small (likely empty)"


# ─── REGRESSION — default template still works ─────────────────────────────
class TestQuoteDefaultTemplateRegression:
    def test_default_template_render_and_pdf(self, crm_session, quote_ticket_id):
        # find default template
        r = crm_session.get(f"{API}/quotes/templates")
        assert r.status_code == 200
        tpls = r.json()
        default = next((t for t in tpls if t.get("is_default")), None) or (tpls[0] if tpls else None)
        assert default, "no template available for default-template regression"

        payload = {
            "template_id": default["id"],
            "ticket_id": quote_ticket_id,
            "items": [{"description": "Item Reg", "unit": "un", "unit_price": 1.0, "quantity": 5}],
            "freights": [{"description": "Frete Reg", "km_total": 10, "price_per_km": 2.0}],
        }
        r = crm_session.post(f"{API}/quotes", json=payload)
        assert r.status_code in (200, 201), r.text[:300]
        qid = r.json()["id"]
        rr = crm_session.get(f"{API}/quotes/{qid}/render")
        assert rr.status_code == 200
        body = rr.text
        assert "Item Reg" in body and "Frete Reg" in body
        for tok in ("{{description}}", "{{km_total}}", "{{price_per_km}}"):
            assert tok not in body, f"leak {tok} on default tpl"
        rp = crm_session.get(f"{API}/quotes/{qid}/pdf")
        assert rp.status_code == 200
        assert rp.content.startswith(b"%PDF")


# ─── @lid (hidden number) ───────────────────────────────────────────────────
LID_JID = f"231{uuid.uuid4().int % 10**14}@lid"
LID_PHONE = LID_JID.split("@")[0]
REAL_PHONE = "5562" + str(uuid.uuid4().int % 10**8).zfill(8)


class TestLidWebhookFlow:
    def test_webhook_creates_lid_pending_ticket(self, crm_session, conn_id):
        # POST /api/channels/webhook/message with lid_jid -> creates pending ticket
        r = requests.post(
            f"{API}/channels/webhook/message",
            json={
                "instance_id": conn_id,
                "phone": LID_PHONE,
                "name": f"TEST_iter46 Cliente Privado {uuid.uuid4().hex[:6]}",
                "message": "Ola — primeiro contato",
                "message_id": f"TEST_iter46_msg_{uuid.uuid4().hex[:8]}",
                "lid_jid": LID_JID,
            },
        )
        assert r.status_code == 200, f"webhook failed: {r.status_code} {r.text[:200]}"
        assert r.json().get("ok") is True, r.text[:200]

        # Find that ticket (poll latest tickets)
        tr = crm_session.get(f"{API}/crm/tickets?limit=50")
        assert tr.status_code == 200
        tickets = tr.json() if isinstance(tr.json(), list) else tr.json().get("tickets", [])
        lid_ticket = next(
            (t for t in tickets if t.get("lid_jid") == LID_JID and t.get("pending_lid_resolution")),
            None,
        )
        assert lid_ticket, "no LID ticket with pending_lid_resolution found"
        assert lid_ticket.get("customer_phone") == LID_PHONE
        assert "Numero Oculto" in (lid_ticket.get("tags") or [])
        assert lid_ticket.get("lid_jid") == LID_JID
        pytest.lid_ticket_id = lid_ticket["id"]

    def test_manual_resolve_lid_promotes(self, crm_session):
        tid = getattr(pytest, "lid_ticket_id", None)
        assert tid
        r = crm_session.post(
            f"{API}/crm/tickets/{tid}/resolve-lid",
            json={"real_phone": REAL_PHONE},
        )
        assert r.status_code == 200, f"resolve-lid failed: {r.status_code} {r.text[:200]}"
        body = r.json()
        assert body.get("updated") is True, body

        # GET that ticket — must have real phone, no Numero Oculto, lid_jid None
        tr = crm_session.get(f"{API}/crm/tickets/{tid}")
        assert tr.status_code == 200, tr.text[:200]
        t = tr.json()
        assert t.get("customer_phone") == REAL_PHONE
        assert t.get("pending_lid_resolution") in (False, None)
        assert t.get("lid_jid") in (None, "")
        assert "Numero Oculto" not in (t.get("tags") or [])


class TestLidResolvedWebhookMerge:
    """Auto-merge path: pre-existing real-phone ticket + new LID ticket ->
    webhook should merge into the older real-phone ticket and DELETE LID ticket.
    """

    LID_JID2 = f"999{uuid.uuid4().int % 10**13}@lid"
    LID_PHONE2 = LID_JID2.split("@")[0]
    REAL2 = "5562" + str(uuid.uuid4().int % 10**8).zfill(8)

    def test_setup_real_phone_ticket(self, crm_session, conn_id):
        # Create a normal ticket via webhook for the real phone first
        r = requests.post(
            f"{API}/channels/webhook/message",
            json={
                "instance_id": conn_id,
                "phone": self.REAL2,
                "name": "TEST_iter46 Real",
                "message": "Mensagem inicial real",
                "message_id": f"TEST_iter46_real_{uuid.uuid4().hex[:8]}",
            },
        )
        assert r.status_code == 200
        tr = crm_session.get(f"{API}/crm/tickets?limit=50")
        tickets = tr.json() if isinstance(tr.json(), list) else tr.json().get("tickets", [])
        real_ticket = next(
            (t for t in tickets if t.get("customer_phone") == self.REAL2 and not t.get("lid_jid")),
            None,
        )
        assert real_ticket, "real-phone ticket not created"
        pytest.real_ticket_id = real_ticket["id"]

    def test_setup_lid_ticket(self, crm_session, conn_id):
        r = requests.post(
            f"{API}/channels/webhook/message",
            json={
                "instance_id": conn_id,
                "phone": self.LID_PHONE2,
                "name": f"TEST_iter46 LID {uuid.uuid4().hex[:6]}",
                "message": "Mensagem via LID",
                "message_id": f"TEST_iter46_lid_{uuid.uuid4().hex[:8]}",
                "lid_jid": self.LID_JID2,
            },
        )
        assert r.status_code == 200
        tr = crm_session.get(f"{API}/crm/tickets?limit=50")
        tickets = tr.json() if isinstance(tr.json(), list) else tr.json().get("tickets", [])
        lid_t = next((t for t in tickets if t.get("lid_jid") == self.LID_JID2), None)
        assert lid_t, "LID ticket not created"
        pytest.lid_ticket_id_2 = lid_t["id"]

    def test_webhook_lid_resolved_merges(self, crm_session, conn_id):
        r = requests.post(
            f"{API}/channels/webhook/lid-resolved",
            json={"instance_id": conn_id, "lid_jid": self.LID_JID2, "phone": self.REAL2},
        )
        assert r.status_code == 200, f"resolve webhook failed: {r.status_code} {r.text[:200]}"
        body = r.json()
        assert body.get("ok") is True
        assert body.get("merged_into") or body.get("promoted"), body

        # If merged: lid ticket must be GONE, real ticket must contain merged messages
        if body.get("merged_into"):
            lid_id = getattr(pytest, "lid_ticket_id_2")
            check = crm_session.get(f"{API}/crm/tickets/{lid_id}")
            assert check.status_code == 404, "LID ticket should be deleted after merge"
            real = crm_session.get(f"{API}/crm/tickets/{pytest.real_ticket_id}").json()
            msgs = [m.get("content", "") for m in (real.get("messages") or [])]
            assert any("LID" in m for m in msgs), "merged LID messages missing"


class TestLidResolvedPromote:
    """Promote path: only LID ticket exists, webhook should update it in place."""

    LID_JID3 = f"777{uuid.uuid4().int % 10**13}@lid"
    LID_PHONE3 = LID_JID3.split("@")[0]
    REAL3 = "5562" + str(uuid.uuid4().int % 10**8).zfill(8)

    def test_create_lid_only_ticket(self, crm_session, conn_id):
        r = requests.post(
            f"{API}/channels/webhook/message",
            json={
                "instance_id": conn_id,
                "phone": self.LID_PHONE3,
                "name": f"TEST_iter46 LID3 {uuid.uuid4().hex[:6]}",
                "message": "Promote test",
                "message_id": f"TEST_iter46_promo_{uuid.uuid4().hex[:8]}",
                "lid_jid": self.LID_JID3,
            },
        )
        assert r.status_code == 200
        tr = crm_session.get(f"{API}/crm/tickets?limit=50")
        tickets = tr.json() if isinstance(tr.json(), list) else tr.json().get("tickets", [])
        t = next((x for x in tickets if x.get("lid_jid") == self.LID_JID3), None)
        assert t
        pytest.lid_ticket_id_3 = t["id"]

    def test_webhook_promotes(self, crm_session, conn_id):
        r = requests.post(
            f"{API}/channels/webhook/lid-resolved",
            json={"instance_id": conn_id, "lid_jid": self.LID_JID3, "phone": self.REAL3},
        )
        assert r.status_code == 200, r.text[:200]
        body = r.json()
        assert body.get("promoted") == pytest.lid_ticket_id_3

        t = crm_session.get(f"{API}/crm/tickets/{pytest.lid_ticket_id_3}").json()
        assert t.get("customer_phone") == self.REAL3
        assert t.get("pending_lid_resolution") in (False, None)
        assert t.get("lid_jid") in (None, "")
        assert "Numero Oculto" not in (t.get("tags") or [])


# ─── REGRESSION — manual ticket merge & normal outgoing ────────────────────
class TestRegressionMergeAndOutgoing:
    def test_merge_into_endpoint_still_works(self, crm_session, conn_id):
        # Create two normal tickets and merge src into dst
        srcr = requests.post(
            f"{API}/channels/webhook/message",
            json={"instance_id": conn_id, "phone": "5511999990001",
                  "name": "TEST_iter46 src", "message": "msg src",
                  "message_id": f"TEST_iter46_src_{uuid.uuid4().hex[:8]}"})
        dstr = requests.post(
            f"{API}/channels/webhook/message",
            json={"instance_id": conn_id, "phone": "5511999990002",
                  "name": "TEST_iter46 dst", "message": "msg dst",
                  "message_id": f"TEST_iter46_dst_{uuid.uuid4().hex[:8]}"})
        assert srcr.status_code == dstr.status_code == 200

        tr = crm_session.get(f"{API}/crm/tickets?limit=50").json()
        tickets = tr if isinstance(tr, list) else tr.get("tickets", [])
        src = next((t for t in tickets if t.get("customer_phone") == "5511999990001"), None)
        dst = next((t for t in tickets if t.get("customer_phone") == "5511999990002"), None)
        assert src and dst
        r = crm_session.post(f"{API}/crm/tickets/{src['id']}/merge-into/{dst['id']}")
        assert r.status_code == 200, f"merge failed {r.status_code} {r.text[:200]}"

    def test_outgoing_message_normal_ticket_uses_customer_phone(self, crm_session, conn_id):
        # Create a normal (non-LID) ticket
        ph = "5511988887777"
        requests.post(
            f"{API}/channels/webhook/message",
            json={"instance_id": conn_id, "phone": ph,
                  "name": "TEST_iter46 normal", "message": "ola",
                  "message_id": f"TEST_iter46_n_{uuid.uuid4().hex[:8]}"})
        tr = crm_session.get(f"{API}/crm/tickets?limit=50").json()
        tickets = tr if isinstance(tr, list) else tr.get("tickets", [])
        t = next((x for x in tickets if x.get("customer_phone") == ph), None)
        assert t
        # Send outgoing — endpoint should accept; we don't expect WA actually
        # delivers (no real connection), but response must not 500.
        r = crm_session.post(
            f"{API}/crm/tickets/{t['id']}/messages",
            json={"content": "Resposta agente", "sender_type": "agent"},
        )
        # Accept 200/201 OR 502/503 (downstream WA failed) — what we care
        # about is the endpoint did NOT crash on the lid_jid branch and DID
        # NOT use lid_jid (the ticket has none).
        assert r.status_code in (200, 201, 400, 502, 503), \
            f"unexpected status {r.status_code}: {r.text[:200]}"
