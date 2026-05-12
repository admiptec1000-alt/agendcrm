"""Iteration 52 - Backend tests for batch A+B+C applied 2026-05-12.

Coverage:
  A. CRM tickets tab filters (`atendendo` / `aguardando`) match /counts badge.
  B. Queue-based RBAC: Connection.queue_ids + User.allowed_queue_ids persist.
  C. Flow export endpoint (`GET /api/crm/flows/{id}/export`).
  D. Webhook auto-assigns queue_id to ticket when connection has exactly 1 queue.
  E. Quote template PDF letterhead: PDF -> PNG conversion + default-template
     fallback in `_build_quote_html`.
  F. Kanban column `order` field accepts custom create + update values.

The microservice WhatsApp is NOT exercised — webhook is invoked directly with
a synthetic payload as instructed by the main agent.

Tenant: Boss (admin@boss.com.br / boss123).
"""
import base64
import io
import os
import uuid

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
BOSS_EMAIL = "admin@boss.com.br"
BOSS_PASSWORD = "boss123"


# ─── FIXTURES ────────────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def boss_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": BOSS_EMAIL, "password": BOSS_PASSWORD},
        timeout=30,
    )
    assert r.status_code == 200, f"Boss login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture
def boss_headers(boss_token):
    return {"Authorization": f"Bearer {boss_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def boss_company_id(boss_token):
    r = requests.get(
        f"{BASE_URL}/api/auth/me",
        headers={"Authorization": f"Bearer {boss_token}"},
        timeout=30,
    )
    if r.status_code == 200:
        return r.json().get("company_id") or r.json().get("user", {}).get("company_id")
    return None


def _minimal_pdf_b64() -> str:
    """Build a minimal valid 1-page PDF via WeasyPrint (already installed)."""
    from weasyprint import HTML
    pdf_bytes = HTML(
        string="<html><body><h1>TEST_LAYOUT_PDF</h1><p>Letterhead</p></body></html>"
    ).write_pdf()
    return base64.b64encode(pdf_bytes).decode("ascii")


# ─── A. TICKETS TAB FILTER vs COUNTS BADGE ───────────────────────────────────
class TestTicketsTabFilters:
    def test_atendendo_list_matches_count(self, boss_headers):
        counts_r = requests.get(f"{BASE_URL}/api/crm/tickets/counts", headers=boss_headers, timeout=30)
        assert counts_r.status_code == 200, counts_r.text
        counts = counts_r.json()

        list_r = requests.get(
            f"{BASE_URL}/api/crm/tickets?tab=atendendo&limit=5000",
            headers=boss_headers, timeout=60,
        )
        assert list_r.status_code == 200, list_r.text
        items = list_r.json()
        assert isinstance(items, list)
        # All listed items must have a non-empty assigned_to and not be closed.
        for t in items:
            assert t.get("assigned_to") not in (None, ""), f"unowned ticket in atendendo: {t.get('id')}"
            assert t.get("status") not in ("fechado", "cancelado"), t.get("id")
            assert t.get("channel") != "whatsapp_group"
        # Length must match the badge (admin sees all; visibility filter empty).
        assert len(items) == counts["atendendo"], (
            f"atendendo list ({len(items)}) != badge ({counts['atendendo']})"
        )

    def test_aguardando_list_matches_count_and_not_empty_when_badge_positive(self, boss_headers):
        counts = requests.get(f"{BASE_URL}/api/crm/tickets/counts", headers=boss_headers, timeout=30).json()

        list_r = requests.get(
            f"{BASE_URL}/api/crm/tickets?tab=aguardando&limit=5000",
            headers=boss_headers, timeout=60,
        )
        assert list_r.status_code == 200, list_r.text
        items = list_r.json()
        for t in items:
            assert t.get("assigned_to") in (None, ""), f"owned ticket in aguardando: {t.get('id')}"
            assert t.get("status") not in ("fechado", "cancelado")
            assert t.get("channel") != "whatsapp_group"
        assert len(items) == counts["aguardando"], (
            f"aguardando list ({len(items)}) != badge ({counts['aguardando']}) — regression"
        )


# ─── B. CONNECTION queue_ids + USER allowed_queue_ids ────────────────────────
class TestQueueRBAC:
    def test_connection_queue_ids_persist_create_and_clear_on_update(self, boss_headers):
        # 1. Create a queue
        qr = requests.post(
            f"{BASE_URL}/api/crm/queues",
            headers=boss_headers,
            json={"name": f"TEST_Q_{uuid.uuid4().hex[:6]}"},
            timeout=30,
        )
        assert qr.status_code == 200, qr.text
        queue = qr.json()
        qid = queue["id"]

        # 2. Create a connection with queue_ids=[qid]
        cr = requests.post(
            f"{BASE_URL}/api/channels/connections",
            headers=boss_headers,
            json={"name": f"TEST_Conn_{uuid.uuid4().hex[:6]}", "type": "whatsapp",
                  "queue_ids": [qid]},
            timeout=30,
        )
        assert cr.status_code == 200, cr.text
        conn = cr.json()
        assert conn.get("queue_ids") == [qid], conn.get("queue_ids")
        conn_id = conn["id"]

        # GET-list to verify persistence
        ll = requests.get(f"{BASE_URL}/api/channels/connections", headers=boss_headers, timeout=30).json()
        match = [c for c in ll if c["id"] == conn_id]
        assert match and match[0]["queue_ids"] == [qid]

        # 3. Update with empty list to clear binding
        up = requests.put(
            f"{BASE_URL}/api/channels/connections/{conn_id}",
            headers=boss_headers, json={"queue_ids": []}, timeout=30,
        )
        assert up.status_code == 200, up.text
        assert up.json().get("queue_ids") == [], f"queue_ids not cleared: {up.json()}"

        # cleanup
        requests.delete(f"{BASE_URL}/api/channels/connections/{conn_id}", headers=boss_headers, timeout=30)
        requests.delete(f"{BASE_URL}/api/crm/queues/{qid}", headers=boss_headers, timeout=30)

    def test_company_user_allowed_queue_ids_create_and_update(self, boss_headers):
        # Create 2 queues to test update from q1 -> q2
        q1 = requests.post(f"{BASE_URL}/api/crm/queues", headers=boss_headers,
                           json={"name": f"TEST_Q1_{uuid.uuid4().hex[:6]}"}, timeout=30).json()
        q2 = requests.post(f"{BASE_URL}/api/crm/queues", headers=boss_headers,
                           json={"name": f"TEST_Q2_{uuid.uuid4().hex[:6]}"}, timeout=30).json()
        qid1, qid2 = q1["id"], q2["id"]

        email = f"TEST_user_{uuid.uuid4().hex[:8]}@example.com"
        cr = requests.post(
            f"{BASE_URL}/api/scheduling/company-users",
            headers=boss_headers,
            json={"name": "TEST User", "email": email, "password": "test12345",
                  "allowed_queue_ids": [qid1]},
            timeout=30,
        )
        assert cr.status_code == 200, cr.text
        cu = cr.json()
        assert cu.get("allowed_queue_ids") == [qid1], cu.get("allowed_queue_ids")
        uid = cu["id"]

        up = requests.put(
            f"{BASE_URL}/api/scheduling/company-users/{uid}",
            headers=boss_headers, json={"allowed_queue_ids": [qid2]}, timeout=30,
        )
        assert up.status_code == 200, up.text
        assert up.json().get("allowed_queue_ids") == [qid2], up.json()

        # cleanup
        requests.delete(f"{BASE_URL}/api/scheduling/company-users/{uid}", headers=boss_headers, timeout=30)
        requests.delete(f"{BASE_URL}/api/crm/queues/{qid1}", headers=boss_headers, timeout=30)
        requests.delete(f"{BASE_URL}/api/crm/queues/{qid2}", headers=boss_headers, timeout=30)


# ─── C. FLOW EXPORT ENDPOINT ─────────────────────────────────────────────────
class TestFlowExport:
    def test_export_flow_returns_portable_json(self, boss_headers):
        # Create a flow
        fr = requests.post(
            f"{BASE_URL}/api/crm/flows",
            headers=boss_headers,
            json={
                "name": f"TEST_Flow_{uuid.uuid4().hex[:6]}",
                "description": "Export test",
                "trigger_type": "manual",
                "nodes": [{"id": "n1", "type": "start", "data": {}, "position": {"x": 0, "y": 0}}],
                "edges": [],
            },
            timeout=30,
        )
        assert fr.status_code == 200, fr.text
        flow = fr.json()
        fid = flow["id"]

        try:
            er = requests.get(
                f"{BASE_URL}/api/crm/flows/{fid}/export",
                headers=boss_headers, timeout=30,
            )
            assert er.status_code == 200, er.text
            out = er.json()
            # Required keys
            for k in ("name", "description", "trigger_type", "nodes", "edges",
                      "exported_at", "exported_from"):
                assert k in out, f"missing key {k} in export"
            # Tenant metadata stripped
            assert "id" not in out
            assert "company_id" not in out
            assert out["name"] == flow["name"]
            assert out["exported_from"] == "AgentCRM"
        finally:
            requests.delete(f"{BASE_URL}/api/crm/flows/{fid}", headers=boss_headers, timeout=30)

    def test_export_flow_404_for_missing(self, boss_headers):
        r = requests.get(f"{BASE_URL}/api/crm/flows/non-existent-id/export",
                         headers=boss_headers, timeout=30)
        assert r.status_code == 404


# ─── D. WEBHOOK AUTO-ASSIGNS QUEUE_ID TO TICKET ──────────────────────────────
class TestWebhookQueueAutoAssign:
    def test_inbound_webhook_assigns_queue_when_single_queue(self, boss_headers):
        # 1. Queue
        q = requests.post(f"{BASE_URL}/api/crm/queues", headers=boss_headers,
                          json={"name": f"TEST_WH_Q_{uuid.uuid4().hex[:6]}"}, timeout=30).json()
        qid = q["id"]
        # 2. Connection wired to that single queue
        conn = requests.post(
            f"{BASE_URL}/api/channels/connections", headers=boss_headers,
            json={"name": f"TEST_WH_Conn_{uuid.uuid4().hex[:6]}", "type": "whatsapp",
                  "queue_ids": [qid]}, timeout=30,
        ).json()
        conn_id = conn["id"]

        # 3. POST synthetic inbound webhook (no auth required by the webhook).
        unique_phone = f"55119{uuid.uuid4().int % 100000000:08d}"
        wr = requests.post(
            f"{BASE_URL}/api/channels/webhook/message",
            json={
                "instance_id": conn_id,
                "phone": unique_phone,
                "name": "TEST_Webhook_Customer",
                "message": "Hello from synthetic webhook",
                "message_id": f"TEST_MID_{uuid.uuid4().hex[:10]}",
                "from_me": False,
            },
            timeout=30,
        )
        assert wr.status_code == 200, wr.text

        # 4. Find the new ticket and verify queue_id.
        # Use the search filter to locate the just-created ticket.
        tlist = requests.get(
            f"{BASE_URL}/api/crm/tickets?search={unique_phone}&limit=5",
            headers=boss_headers, timeout=30,
        ).json()
        match = [t for t in tlist if t.get("customer_phone") == unique_phone]
        assert match, f"webhook did not create ticket for phone={unique_phone}"
        ticket = match[0]
        assert ticket.get("queue_id") == qid, (
            f"ticket.queue_id={ticket.get('queue_id')} != connection.queue_ids[0]={qid}"
        )

        # cleanup
        tid = ticket["id"]
        requests.delete(f"{BASE_URL}/api/crm/tickets/{tid}", headers=boss_headers, timeout=30)
        requests.delete(f"{BASE_URL}/api/channels/connections/{conn_id}", headers=boss_headers, timeout=30)
        requests.delete(f"{BASE_URL}/api/crm/queues/{qid}", headers=boss_headers, timeout=30)


# ─── E. QUOTE TEMPLATE PDF -> PNG + DEFAULT FALLBACK ─────────────────────────
class TestQuotePdfLayout:
    def test_template_post_with_pdf_layout_converts_to_png(self, boss_headers):
        pdf_b64 = _minimal_pdf_b64()
        tr = requests.post(
            f"{BASE_URL}/api/quotes/templates",
            headers=boss_headers,
            json={
                "name": f"TEST_TPL_PDF_{uuid.uuid4().hex[:6]}",
                "content": "<h1>{{quote_number}}</h1>",
                "is_default": False,
                "layout_image_b64": pdf_b64,
                "layout_image_mimetype": "application/pdf",
            },
            timeout=120,
        )
        assert tr.status_code == 200, tr.text
        tpl = tr.json()
        assert tpl.get("layout_image_mimetype") == "image/png", (
            f"PDF was not converted: mime={tpl.get('layout_image_mimetype')}"
        )
        # The stored b64 must decode to a real PNG (starts with magic 89 50 4E 47).
        decoded = base64.b64decode(tpl["layout_image_b64"])
        assert decoded[:4] == b"\x89PNG", f"converted bytes are not PNG: {decoded[:8].hex()}"

        # cleanup
        requests.delete(f"{BASE_URL}/api/quotes/templates/{tpl['id']}", headers=boss_headers, timeout=30)

    def test_pdf_fallback_uses_default_template_layout(self, boss_headers):
        """Create:
            - default_tpl  (is_default=True, with layout)
            - plain_tpl    (no layout)
            - 1 quote referencing plain_tpl
        GET /pdf must succeed and `_build_quote_html` must inherit the
        default_tpl layout (verified by the fact that disabling the default
        layout produces a DIFFERENT pdf byte stream).
        """
        pdf_b64 = _minimal_pdf_b64()

        # 1. Default template WITH layout
        default_tpl = requests.post(
            f"{BASE_URL}/api/quotes/templates", headers=boss_headers,
            json={
                "name": f"TEST_DEFAULT_LAYOUT_{uuid.uuid4().hex[:6]}",
                "content": "<h1>DEFAULT WITH LAYOUT</h1>",
                "is_default": True,
                "layout_image_b64": pdf_b64,
                "layout_image_mimetype": "application/pdf",
            },
            timeout=120,
        ).json()

        # 2. Plain template (no layout) — to be referenced by the quote
        plain_tpl = requests.post(
            f"{BASE_URL}/api/quotes/templates", headers=boss_headers,
            json={
                "name": f"TEST_PLAIN_{uuid.uuid4().hex[:6]}",
                "content": "<h1>{{quote_number}}</h1><p>{{notes}}</p>",
                "is_default": False,
            },
            timeout=30,
        ).json()

        # 3. Ticket (required to create quote)
        tk = requests.post(
            f"{BASE_URL}/api/crm/tickets", headers=boss_headers,
            json={"customer_name": "TEST PDF Cliente", "customer_phone": "5511900000000",
                  "channel": "whatsapp", "status": "aberto", "priority": "medium"},
            timeout=30,
        )
        assert tk.status_code in (200, 201), tk.text
        ticket = tk.json()
        tid = ticket["id"]

        # 4. Quote referencing the plain template
        qr = requests.post(
            f"{BASE_URL}/api/quotes", headers=boss_headers,
            json={"ticket_id": tid, "template_id": plain_tpl["id"],
                  "items": [{"description": "Item A", "quantity": 1, "unit_price": 10.0}],
                  "freights": [], "notes": "test"},
            timeout=30,
        )
        assert qr.status_code in (200, 201), qr.text
        quote = qr.json()
        qid_q = quote["id"]

        # 5. Render PDF with the default's layout active
        pdf_with = requests.get(f"{BASE_URL}/api/quotes/{qid_q}/pdf", headers=boss_headers, timeout=120)
        assert pdf_with.status_code == 200, pdf_with.text
        assert pdf_with.content[:4] == b"%PDF", "response is not a PDF"
        size_with = len(pdf_with.content)

        # 6. Now remove the default's layout and re-render — should produce a
        #    smaller PDF (no embedded background image).
        upd = requests.put(
            f"{BASE_URL}/api/quotes/templates/{default_tpl['id']}", headers=boss_headers,
            json={"layout_image_b64": "", "layout_image_mimetype": ""},
            timeout=30,
        )
        # API may accept either empty string or None — accept 200 here.
        assert upd.status_code == 200, upd.text

        pdf_without = requests.get(f"{BASE_URL}/api/quotes/{qid_q}/pdf", headers=boss_headers, timeout=120)
        assert pdf_without.status_code == 200, pdf_without.text
        size_without = len(pdf_without.content)

        # The PDF with the embedded letterhead must be substantially LARGER.
        # If the fallback is broken, both renders are equal.
        assert size_with > size_without + 1000, (
            f"PDF fallback didn't embed the default layout — "
            f"size_with={size_with} size_without={size_without}"
        )

        # cleanup
        requests.delete(f"{BASE_URL}/api/quotes/{qid_q}", headers=boss_headers, timeout=30)
        requests.delete(f"{BASE_URL}/api/crm/tickets/{tid}", headers=boss_headers, timeout=30)
        requests.delete(f"{BASE_URL}/api/quotes/templates/{plain_tpl['id']}", headers=boss_headers, timeout=30)
        requests.delete(f"{BASE_URL}/api/quotes/templates/{default_tpl['id']}", headers=boss_headers, timeout=30)


# ─── F. KANBAN COLUMN ORDER ──────────────────────────────────────────────────
class TestKanbanColumnOrder:
    def test_create_and_update_order_field(self, boss_headers):
        cr = requests.post(
            f"{BASE_URL}/api/crm/kanban-columns", headers=boss_headers,
            json={"name": f"TEST_COL_{uuid.uuid4().hex[:6]}", "order": 5},
            timeout=30,
        )
        assert cr.status_code == 200, cr.text
        col = cr.json()
        assert col["order"] == 5, col
        cid = col["id"]

        up = requests.put(
            f"{BASE_URL}/api/crm/kanban-columns/{cid}", headers=boss_headers,
            json={"order": 2}, timeout=30,
        )
        assert up.status_code == 200, up.text
        assert up.json()["order"] == 2, up.json()

        # cleanup
        requests.delete(f"{BASE_URL}/api/crm/kanban-columns/{cid}", headers=boss_headers, timeout=30)
