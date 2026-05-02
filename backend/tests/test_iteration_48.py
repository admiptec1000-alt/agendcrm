"""Iteration 48 — Tests for F1..F5:
  F1 — Quote template header_html / footer_html persisted + repeated on PDF.
  F2 — GET /quotes/{qid}/preview-pdf-html returns matching HTML for iframe.
  F3 — Connection default_flow_id (set / clear) + webhook auto-trigger flow
       welcome message; PUT /api/crm/flows/{id} renames flow.
  F4 — POST /api/crm/kanban-columns/reorder persists order; GET /kanban-v2
       returns columns in new order.
  F5 — Visibility & claim/release: non-admin user sees only own + unassigned
       pool; claim returns 200 (idempotent); 2nd non-admin gets 409; release
       returns to pool.
"""
import os
import re
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL",
                          "https://agentcrm-book.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
CRM_EMAIL = "crm@test.com"
CRM_PASS = "crm123"


def _login(email, pwd):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pwd})
    if r.status_code != 200:
        return None
    tok = r.json().get("access_token") or r.json().get("token")
    return tok


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    tok = _login(CRM_EMAIL, CRM_PASS)
    if not tok:
        pytest.skip("admin login failed")
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def user_a(admin):
    """Create a non-admin company user A."""
    email = f"TEST_iter48_a_{uuid.uuid4().hex[:6]}@t.com"
    r = admin.post(f"{API}/scheduling/company-users",
                   json={"name": "TEST iter48 A", "email": email, "password": "p123456"})
    assert r.status_code in (200, 201), r.text[:200]
    tok = _login(email, "p123456")
    assert tok, "user_a login failed"
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json",
                      "Authorization": f"Bearer {tok}"})
    s.user_email = email
    me = s.get(f"{API}/auth/me")
    s.user_id = me.json().get("id") if me.status_code == 200 else None
    return s


@pytest.fixture(scope="module")
def user_b(admin):
    email = f"TEST_iter48_b_{uuid.uuid4().hex[:6]}@t.com"
    r = admin.post(f"{API}/scheduling/company-users",
                   json={"name": "TEST iter48 B", "email": email, "password": "p123456"})
    assert r.status_code in (200, 201), r.text[:200]
    tok = _login(email, "p123456")
    assert tok, "user_b login failed"
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json",
                      "Authorization": f"Bearer {tok}"})
    me = s.get(f"{API}/auth/me")
    s.user_id = me.json().get("id") if me.status_code == 200 else None
    return s


@pytest.fixture(scope="module")
def conn_id(admin):
    r = admin.get(f"{API}/channels/connections")
    if r.status_code == 200 and r.json():
        return r.json()[0]["id"]
    r = admin.post(f"{API}/channels/connections",
                   json={"name": f"TEST_iter48_{uuid.uuid4().hex[:6]}", "type": "whatsapp"})
    assert r.status_code in (200, 201), r.text[:200]
    return r.json()["id"]


@pytest.fixture(scope="module")
def admin_ticket(admin, conn_id):
    """Create a ticket via webhook (assigned_to=null, status=aberto)."""
    import time
    ph = f"5511{9}{uuid.uuid4().int % 10**8:08d}"
    r = requests.post(f"{API}/channels/webhook/message", json={
        "instance_id": conn_id, "phone": ph,
        "name": "TEST_iter48 ticket",
        "message": "para visibility test",
        "message_id": f"TEST_iter48_{uuid.uuid4().hex[:8]}"})
    assert r.status_code == 200, f"webhook failed: {r.status_code} {r.text[:200]}"
    print(f"[admin_ticket] webhook ok phone={ph} conn={conn_id}")
    # Retry: the ticket listing is sorted by updated_at; new ticket should
    # be at the very top. Try unfiltered listing first.
    t = None
    for attempt in range(5):
        listing = admin.get(f"{API}/crm/tickets").json()
        tickets = listing if isinstance(listing, list) else listing.get("tickets", [])
        t = next((x for x in tickets if x.get("customer_phone") == ph), None)
        print(f"[admin_ticket] attempt {attempt} listing_count={len(tickets)} match={bool(t)}")
        if t:
            break
        time.sleep(1.0)
    assert t, f"ticket not found for phone {ph} (conn={conn_id})"
    return t


# ── F1 — template header/footer ────────────────────────────────────────────
class TestF1TemplateHeaderFooter:
    def test_create_template_persists_header_footer(self, admin):
        header = "<div>HDR_TEST_iter48_xyz</div>"
        footer = "<div>FTR_TEST_iter48_xyz</div>"
        r = admin.post(f"{API}/quotes/templates", json={
            "name": f"TEST_iter48_hf_{uuid.uuid4().hex[:6]}",
            "content": "<p>{{customer_name}}</p>",
            "header_html": header,
            "footer_html": footer,
            "is_default": False,
        })
        assert r.status_code in (200, 201), r.text[:200]
        tpl_id = r.json()["id"]

        # GET back
        g = admin.get(f"{API}/quotes/templates")
        assert g.status_code == 200
        t = next((x for x in g.json() if x["id"] == tpl_id), None)
        assert t, "template not found in list"
        assert t.get("header_html") == header
        assert t.get("footer_html") == footer

        # PUT update
        new_h = "<div>HDR_UPDATED</div>"
        r2 = admin.put(f"{API}/quotes/templates/{tpl_id}",
                       json={"header_html": new_h})
        assert r2.status_code in (200, 201), r2.text[:200]
        g2 = admin.get(f"{API}/quotes/templates")
        t2 = next((x for x in g2.json() if x["id"] == tpl_id), None)
        assert t2.get("header_html") == new_h
        # footer untouched
        assert t2.get("footer_html") == footer

    def test_pdf_contains_header_footer_text(self, admin, admin_ticket):
        header = "<div>HDR_MARKER_iter48</div>"
        footer = "<div>FTR_MARKER_iter48</div>"
        r = admin.post(f"{API}/quotes/templates", json={
            "name": f"TEST_iter48_pdfhf_{uuid.uuid4().hex[:6]}",
            "content": "<p>Cliente: {{customer_name}}</p>",
            "header_html": header,
            "footer_html": footer,
        })
        assert r.status_code in (200, 201)
        tpl_id = r.json()["id"]

        q = admin.post(f"{API}/quotes", json={
            "template_id": tpl_id,
            "ticket_id": admin_ticket["id"],
            "items": [{"description": "X", "unit": "un",
                       "unit_price": 10, "quantity": 2}],
            "freights": [],
        })
        assert q.status_code in (200, 201), q.text[:200]
        qid = q.json()["id"]

        # PDF
        pdf = admin.get(f"{API}/quotes/{qid}/pdf")
        assert pdf.status_code == 200
        assert pdf.content.startswith(b"%PDF")
        # Best-effort text extraction via pdftotext
        try:
            import subprocess, tempfile
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
                f.write(pdf.content)
                pf = f.name
            txt = subprocess.run(["pdftotext", "-layout", pf, "-"],
                                 capture_output=True, text=True).stdout
            assert "HDR_MARKER_iter48" in txt, f"header text missing in PDF (excerpt: {txt[:300]})"
            assert "FTR_MARKER_iter48" in txt, f"footer text missing in PDF (excerpt: {txt[:300]})"
        except FileNotFoundError:
            # pdftotext not installed: validate via render endpoint as proxy
            r2 = admin.get(f"{API}/quotes/{qid}/render")
            j = r2.json()
            assert j.get("header_html") and "HDR_MARKER_iter48" in j["header_html"]
            assert j.get("footer_html") and "FTR_MARKER_iter48" in j["footer_html"]


# ── F2 — preview-pdf-html ──────────────────────────────────────────────────
class TestF2PreviewPdfHtml:
    def test_preview_pdf_html_returns_html_with_chrome_and_items(self, admin, admin_ticket):
        header = "<div>HDR_PVW_iter48</div>"
        footer = "<div>FTR_PVW_iter48</div>"
        # Template includes an items loop so the rendered HTML must contain
        # the item description (no raw {{description}} placeholders).
        content = (
            "<h2>Itens</h2>"
            "<table><tbody>"
            "{{#items}}<tr><td>{{description}}</td><td>{{quantity}}</td><td>{{total}}</td></tr>{{/items}}"
            "</tbody></table>"
        )
        r = admin.post(f"{API}/quotes/templates", json={
            "name": f"TEST_iter48_pvw_{uuid.uuid4().hex[:6]}",
            "content": content,
            "header_html": header,
            "footer_html": footer,
        })
        tpl_id = r.json()["id"]
        q = admin.post(f"{API}/quotes", json={
            "template_id": tpl_id,
            "ticket_id": admin_ticket["id"],
            "items": [{"description": "ItemUnique_iter48", "unit": "un",
                       "unit_price": 99, "quantity": 1}],
            "freights": [],
        })
        qid = q.json()["id"]

        rp = admin.get(f"{API}/quotes/{qid}/preview-pdf-html")
        assert rp.status_code == 200, rp.text[:200]
        body = rp.json()
        assert "html" in body
        assert "quote_number" in body
        html = body["html"]
        assert "__a4_page" in html, "a4 wrapper missing"
        assert "ItemUnique_iter48" in html, "item not rendered"
        # No raw item-loop placeholders remain in output.
        assert "{{description}}" not in html
        assert "{{#items}}" not in html and "{{/items}}" not in html
        assert "HDR_PVW_iter48" in html
        assert "FTR_PVW_iter48" in html


# ── F3 — Connection default_flow_id + flow rename ─────────────────────────
class TestF3ConnectionFlowId:
    def test_connection_create_with_default_flow_id_preserved(self, admin):
        # Create a flow
        flow = admin.post(f"{API}/crm/flows", json={
            "name": f"TEST_iter48_flow_{uuid.uuid4().hex[:6]}",
            "description": "auto",
            "nodes": [{"id": "n1", "type": "message",
                       "data": {"message": "Bem-vindo TEST_iter48 {{nome}}"}}],
            "edges": [],
        })
        assert flow.status_code in (200, 201), flow.text[:200]
        flow_id = flow.json()["id"]

        # Create connection with default_flow_id
        r = admin.post(f"{API}/channels/connections", json={
            "name": f"TEST_iter48_conn_{uuid.uuid4().hex[:6]}",
            "type": "whatsapp",
            "default_flow_id": flow_id,
        })
        assert r.status_code in (200, 201), r.text[:200]
        conn = r.json()
        assert conn.get("default_flow_id") == flow_id
        cid = conn["id"]

        # PUT clear with empty string
        r2 = admin.put(f"{API}/channels/connections/{cid}",
                       json={"default_flow_id": ""})
        assert r2.status_code in (200, 201), r2.text[:200]
        # GET back
        g = admin.get(f"{API}/channels/connections")
        c2 = next((x for x in g.json() if x["id"] == cid), None)
        assert c2 is not None
        assert c2.get("default_flow_id") in (None, ""), \
            f"default_flow_id should be cleared, got {c2.get('default_flow_id')}"

        # Re-attach
        r3 = admin.put(f"{API}/channels/connections/{cid}",
                       json={"default_flow_id": flow_id})
        assert r3.status_code in (200, 201)
        return flow_id, cid

    def test_webhook_triggers_flow_welcome_message(self, admin):
        # Setup flow + connection with default_flow_id
        flow = admin.post(f"{API}/crm/flows", json={
            "name": f"TEST_iter48_trigflow_{uuid.uuid4().hex[:6]}",
            "description": "trig",
            "nodes": [{"id": "n1", "type": "message",
                       "data": {"message": "WELCOME_iter48_{{nome}}"}}],
            "edges": [],
        })
        flow_id = flow.json()["id"]
        conn = admin.post(f"{API}/channels/connections", json={
            "name": f"TEST_iter48_trigconn_{uuid.uuid4().hex[:6]}",
            "type": "whatsapp",
            "default_flow_id": flow_id,
        })
        cid = conn.json()["id"]

        ph = f"5511{9}{uuid.uuid4().int % 10**8:08d}"
        wh = requests.post(f"{API}/channels/webhook/message", json={
            "instance_id": cid, "phone": ph,
            "name": "JoaoTrigger",
            "message": "oi quero atendimento",
            "message_id": f"TEST_iter48_trig_{uuid.uuid4().hex[:8]}",
        })
        assert wh.status_code == 200, wh.text[:200]

        # Find the ticket
        listing = admin.get(f"{API}/crm/tickets?limit=200").json()
        tickets = listing if isinstance(listing, list) else listing.get("tickets", [])
        t = next((x for x in tickets if x.get("customer_phone") == ph), None)
        assert t, "ticket not created"
        full = admin.get(f"{API}/crm/tickets/{t['id']}").json()
        assert full.get("active_flow_id") == flow_id, \
            f"active_flow_id mismatch: {full.get('active_flow_id')}"
        # Welcome message must be persisted in messages array (auto_flow_id set)
        msgs = full.get("messages") or []
        auto = [m for m in msgs if m.get("auto_flow_id") == flow_id]
        assert auto, f"no auto-flow message persisted, msgs={[m.get('content') for m in msgs]}"
        assert "WELCOME_iter48_JoaoTrigger" in auto[0]["content"], \
            f"placeholder not rendered: {auto[0]['content']}"

    def test_rename_flow(self, admin):
        f = admin.post(f"{API}/crm/flows", json={
            "name": f"TEST_iter48_rn_old_{uuid.uuid4().hex[:6]}",
            "description": "rn", "nodes": [], "edges": [],
        })
        flow_id = f.json()["id"]
        new_name = f"TEST_iter48_rn_new_{uuid.uuid4().hex[:6]}"
        r = admin.put(f"{API}/crm/flows/{flow_id}", json={"name": new_name})
        assert r.status_code == 200, r.text[:200]
        g = admin.get(f"{API}/crm/flows")
        rec = next((x for x in g.json() if x["id"] == flow_id), None)
        assert rec and rec.get("name") == new_name


# ── F4 — Kanban reorder ─────────────────────────────────────────────────────
class TestF4KanbanReorder:
    def test_reorder_persists_and_returns_in_kanban_v2(self, admin):
        # Create 2 columns
        c1 = admin.post(f"{API}/crm/kanban-columns",
                        json={"name": f"TEST_iter48_col1_{uuid.uuid4().hex[:4]}",
                              "color": "#abc"})
        c2 = admin.post(f"{API}/crm/kanban-columns",
                        json={"name": f"TEST_iter48_col2_{uuid.uuid4().hex[:4]}",
                              "color": "#def"})
        if c1.status_code not in (200, 201) or c2.status_code not in (200, 201):
            pytest.skip(f"kanban-columns create unsupported: {c1.status_code}/{c2.status_code}")
        id1 = c1.json()["id"]
        id2 = c2.json()["id"]

        # Reorder: id2 first
        r = admin.post(f"{API}/crm/kanban-columns/reorder",
                       json={"column_ids": [id2, id1]})
        assert r.status_code == 200, r.text[:200]
        body = r.json()
        assert body.get("reordered") == 2

        # GET kanban-v2 → native column first then id2 then id1
        kv = admin.get(f"{API}/crm/kanban-v2")
        assert kv.status_code == 200
        cols = kv.json()["columns"]
        custom_order = [c["id"] for c in cols if not c["id"].startswith("native:")]
        # Verify id2 appears before id1
        assert custom_order.index(id2) < custom_order.index(id1), \
            f"reorder not applied: {custom_order}"
        # Native column always first
        assert cols[0]["id"].startswith("native:"), \
            f"native should be left-most, got {cols[0]['id']}"

    def test_reorder_empty_returns_400(self, admin):
        r = admin.post(f"{API}/crm/kanban-columns/reorder",
                       json={"column_ids": []})
        assert r.status_code == 400


# ── F5 — Visibility + claim/release ────────────────────────────────────────
class TestF5Visibility:
    def test_non_admin_sees_unassigned_pool_then_loses_after_other_claims(
            self, admin, user_a, user_b, admin_ticket):
        tid = admin_ticket["id"]
        assert admin_ticket.get("assigned_to") in (None, "")

        # User A sees it
        la = user_a.get(f"{API}/crm/tickets").json()
        a_ids = {t["id"] for t in (la if isinstance(la, list) else la.get("tickets", []))}
        assert tid in a_ids, "user A should see unassigned ticket"

        # User B sees it
        lb = user_b.get(f"{API}/crm/tickets").json()
        b_ids = {t["id"] for t in (lb if isinstance(lb, list) else lb.get("tickets", []))}
        assert tid in b_ids, "user B should see unassigned ticket"

        # User A claims
        c = user_a.post(f"{API}/crm/tickets/{tid}/claim")
        assert c.status_code == 200, c.text[:200]
        body = c.json()
        assert body.get("assigned_to") == user_a.user_id

        # Idempotent re-claim by A
        c2 = user_a.post(f"{API}/crm/tickets/{tid}/claim")
        assert c2.status_code == 200

        # B no longer sees it
        lb2 = user_b.get(f"{API}/crm/tickets").json()
        b_ids2 = {t["id"] for t in (lb2 if isinstance(lb2, list) else lb2.get("tickets", []))}
        assert tid not in b_ids2, "user B should NOT see ticket claimed by A"

        # Admin still sees it
        la_adm = admin.get(f"{API}/crm/tickets").json()
        adm_ids = {t["id"] for t in (la_adm if isinstance(la_adm, list) else la_adm.get("tickets", []))}
        assert tid in adm_ids

        # B claim attempt → 409
        cb = user_b.post(f"{API}/crm/tickets/{tid}/claim")
        assert cb.status_code == 409, f"expected 409, got {cb.status_code}: {cb.text[:200]}"

        # Release by A
        rel = user_a.post(f"{API}/crm/tickets/{tid}/release")
        assert rel.status_code == 200, rel.text[:200]
        assert rel.json().get("assigned_to") in (None, "")

        # B sees it again
        lb3 = user_b.get(f"{API}/crm/tickets").json()
        b_ids3 = {t["id"] for t in (lb3 if isinstance(lb3, list) else lb3.get("tickets", []))}
        assert tid in b_ids3, "user B should see ticket again after release"

    def test_kanban_v2_respects_visibility(self, admin, user_a, conn_id):
        # Create a fresh ticket assigned to admin (so user_a can't see it)
        import time
        ph = f"5511{9}{uuid.uuid4().int % 10**8:08d}"
        requests.post(f"{API}/channels/webhook/message", json={
            "instance_id": conn_id, "phone": ph, "name": "InvisibleAdminTicket",
            "message": "x", "message_id": f"TEST_iter48_inv_{uuid.uuid4().hex[:8]}"})
        t = None
        for _ in range(3):
            listing = admin.get(f"{API}/crm/tickets?search={ph}").json()
            tickets = listing if isinstance(listing, list) else listing.get("tickets", [])
            t = next((x for x in tickets if x.get("customer_phone") == ph), None)
            if t:
                break
            time.sleep(0.5)
        assert t
        # Admin claims it (assigns to admin)
        admin_id = admin.get(f"{API}/auth/me").json().get("id")
        # Use raw mongo update via admin claim endpoint (admin can claim anything)
        admin.post(f"{API}/crm/tickets/{t['id']}/claim")

        # user_a /kanban-v2 should not contain admin-owned ticket
        kv = user_a.get(f"{API}/crm/kanban-v2")
        assert kv.status_code == 200
        all_ids = []
        for col_id, items in kv.json()["tickets_by_column"].items():
            all_ids.extend(x["id"] for x in items)
        assert t["id"] not in all_ids, \
            "user_a should NOT see admin-claimed ticket via kanban-v2"
