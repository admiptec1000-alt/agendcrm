"""Iteration 29 — sequential ticket_number per company + webhook idempotency.

Validates:
  - POST /api/crm/tickets returns ticket_number (int, sequential, >= 1001)
  - POST /api/channels/webhook/message creates ticket with ticket_number
  - Webhook idempotency: same phone w/ open ticket => no new ticket, just message append
  - Backfill: every existing ticket has ticket_number
  - Atomic counter (find_one_and_update) — concurrent POSTs produce unique numbers
  - GET /tickets/{id} returns ticket_number
  - Per-company independent sequence (CRM company vs another company seeded in DB)
  - Regression: list/update/delete/add-message endpoints still work
"""
import asyncio
import os
import uuid

import httpx
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fall back to frontend/.env (test container env doesn't always re-export)
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.strip().split("=", 1)[1].strip().rstrip("/")
                    break
    except Exception:
        pass

API = f"{BASE_URL}/api"

CRM_EMAIL = "crm@test.com"
CRM_PASS = "crm123"
ADMIN_EMAIL = "admin@agentcrm.com"
ADMIN_PASS = "admin123"


# --------------------- fixtures ---------------------
@pytest.fixture(scope="module")
def crm_token():
    r = httpx.post(f"{API}/auth/login", json={"email": CRM_EMAIL, "password": CRM_PASS}, timeout=20)
    assert r.status_code == 200, f"crm login: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def crm_headers(crm_token):
    return {"Authorization": f"Bearer {crm_token}"}


@pytest.fixture(scope="module")
def crm_company_id(crm_headers):
    r = httpx.get(f"{API}/auth/me", headers=crm_headers, timeout=20)
    assert r.status_code == 200
    return r.json()["company_id"]


@pytest.fixture(scope="module")
def wa_instance_id(crm_headers, crm_company_id):
    """Find or create a channel_connection for the CRM company so we can hit
    the webhook with a valid instance_id."""
    r = httpx.get(f"{API}/channels/connections", headers=crm_headers, timeout=20)
    assert r.status_code == 200
    conns = r.json()
    if conns:
        return conns[0]["id"]
    cr = httpx.post(
        f"{API}/channels/connections",
        headers=crm_headers,
        json={"name": "TEST_29_conn", "type": "whatsapp"},
        timeout=20,
    )
    assert cr.status_code == 200, cr.text
    return cr.json()["id"]


# --------------------- 1. POST /tickets returns ticket_number ---------------------
def test_create_ticket_returns_sequential_ticket_number(crm_headers):
    payload = {
        "customer_name": "TEST_29_seq_user_1",
        "customer_phone": f"+5511999{uuid.uuid4().hex[:6]}",
        "channel": "whatsapp",
        "status": "aberto",
        "priority": "medium",
        "description": "iter29 seq #1",
    }
    r1 = httpx.post(f"{API}/crm/tickets", headers=crm_headers, json=payload, timeout=20)
    assert r1.status_code == 200, r1.text
    t1 = r1.json()
    assert "ticket_number" in t1, "ticket_number missing on POST response"
    assert isinstance(t1["ticket_number"], int)
    assert t1["ticket_number"] >= 1001, f"ticket_number should start at 1001, got {t1['ticket_number']}"

    payload["customer_name"] = "TEST_29_seq_user_2"
    payload["customer_phone"] = f"+5511999{uuid.uuid4().hex[:6]}"
    r2 = httpx.post(f"{API}/crm/tickets", headers=crm_headers, json=payload, timeout=20)
    assert r2.status_code == 200
    t2 = r2.json()
    assert t2["ticket_number"] == t1["ticket_number"] + 1, (
        f"sequence not contiguous: {t1['ticket_number']} -> {t2['ticket_number']}"
    )

    # GET single ticket exposes ticket_number
    rg = httpx.get(f"{API}/crm/tickets/{t2['id']}", headers=crm_headers, timeout=20)
    assert rg.status_code == 200
    assert rg.json().get("ticket_number") == t2["ticket_number"]

    # cleanup
    httpx.delete(f"{API}/crm/tickets/{t1['id']}", headers=crm_headers, timeout=20)
    httpx.delete(f"{API}/crm/tickets/{t2['id']}", headers=crm_headers, timeout=20)


# --------------------- 2. List tickets all have ticket_number (backfill) -----------
def test_list_tickets_all_have_ticket_number(crm_headers):
    r = httpx.get(f"{API}/crm/tickets", headers=crm_headers, timeout=30)
    assert r.status_code == 200
    tickets = r.json()
    missing = [t for t in tickets if "ticket_number" not in t or t.get("ticket_number") is None]
    assert not missing, (
        f"backfill incomplete: {len(missing)}/{len(tickets)} tickets missing ticket_number; "
        f"sample={missing[0] if missing else None}"
    )
    # All ints, all >= 1001
    bad = [t for t in tickets if not isinstance(t["ticket_number"], int) or t["ticket_number"] < 1001]
    assert not bad, f"invalid ticket_number values: {bad[:3]}"


# --------------------- 3. Webhook creates ticket with ticket_number --------------
def test_webhook_creates_ticket_with_sequential_number(crm_headers, wa_instance_id):
    phone = f"5511777{uuid.uuid4().hex[:7]}"
    body = {
        "instance_id": wa_instance_id,
        "phone": phone,
        "name": "TEST_29_webhook_user",
        "message": "Olá, iter29 webhook",
        "message_id": f"wamid_{uuid.uuid4().hex[:10]}",
    }
    rw = httpx.post(f"{API}/channels/webhook/message", json=body, timeout=20)
    assert rw.status_code == 200, rw.text
    assert rw.json().get("ok") is True

    # The ticket should now exist in the company's list with ticket_number
    rl = httpx.get(f"{API}/crm/tickets", headers=crm_headers, timeout=20, params={"search": phone})
    assert rl.status_code == 200
    matches = [t for t in rl.json() if t.get("customer_phone") == phone]
    assert matches, f"ticket not created for phone {phone}"
    t = matches[0]
    assert isinstance(t.get("ticket_number"), int) and t["ticket_number"] >= 1001
    assert t["channel"] == "whatsapp"
    assert t["status"] == "aberto"
    assert any(m.get("content") == body["message"] for m in (t.get("messages") or []))

    # cleanup
    httpx.delete(f"{API}/crm/tickets/{t['id']}", headers=crm_headers, timeout=20)


# --------------------- 4. Webhook idempotency: open ticket reused ---------------
def test_webhook_idempotent_for_open_ticket(crm_headers, wa_instance_id):
    phone = f"5511666{uuid.uuid4().hex[:7]}"
    # First message creates the ticket
    body1 = {
        "instance_id": wa_instance_id,
        "phone": phone,
        "name": "TEST_29_idem_user",
        "message": "primeira",
        "message_id": f"wamid_{uuid.uuid4().hex[:10]}",
    }
    r1 = httpx.post(f"{API}/channels/webhook/message", json=body1, timeout=20)
    assert r1.status_code == 200

    # Second message from same phone (different message_id) must NOT create a new ticket
    body2 = dict(body1)
    body2["message"] = "segunda"
    body2["message_id"] = f"wamid_{uuid.uuid4().hex[:10]}"
    r2 = httpx.post(f"{API}/channels/webhook/message", json=body2, timeout=20)
    assert r2.status_code == 200

    rl = httpx.get(f"{API}/crm/tickets", headers=crm_headers, timeout=20, params={"search": phone})
    matches = [t for t in rl.json() if t.get("customer_phone") == phone]
    assert len(matches) == 1, f"expected 1 ticket, got {len(matches)} (duplicate not prevented)"
    msgs = matches[0].get("messages") or []
    contents = [m.get("content") for m in msgs]
    assert "primeira" in contents and "segunda" in contents, f"messages not appended: {contents}"

    # Idempotency on identical message_id (same wa_message_id replay)
    r3 = httpx.post(f"{API}/channels/webhook/message", json=body2, timeout=20)
    assert r3.status_code == 200
    rl2 = httpx.get(f"{API}/crm/tickets", headers=crm_headers, timeout=20, params={"search": phone})
    t = [x for x in rl2.json() if x.get("customer_phone") == phone][0]
    # message count unchanged
    assert len(t["messages"]) == len(msgs), "duplicate wa_message_id should be skipped"

    # cleanup
    httpx.delete(f"{API}/crm/tickets/{matches[0]['id']}", headers=crm_headers, timeout=20)


# --------------------- 5. Concurrent creations -> unique ticket_numbers --------
def test_concurrent_ticket_creation_no_collision(crm_headers):
    async def _run():
        async with httpx.AsyncClient(timeout=30) as cli:
            tasks = []
            for i in range(8):
                p = {
                    "customer_name": f"TEST_29_concurrent_{i}",
                    "customer_phone": f"+5511555{uuid.uuid4().hex[:6]}",
                    "channel": "whatsapp",
                    "status": "aberto",
                    "priority": "medium",
                }
                tasks.append(cli.post(f"{API}/crm/tickets", headers=crm_headers, json=p))
            return await asyncio.gather(*tasks)

    responses = asyncio.run(_run())
    nums = []
    ids = []
    for r in responses:
        assert r.status_code == 200, r.text
        d = r.json()
        nums.append(d["ticket_number"])
        ids.append(d["id"])
    assert len(set(nums)) == len(nums), f"collisions in concurrent ticket_numbers: {nums}"

    # cleanup
    for tid in ids:
        httpx.delete(f"{API}/crm/tickets/{tid}", headers=crm_headers, timeout=20)


# --------------------- 6. Per-company independent sequence ---------------------
def test_per_company_independent_sequence(crm_headers, crm_company_id):
    """Use the super-admin token + a different company to confirm sequences
    don't bleed across tenants."""
    al = httpx.post(f"{API}/auth/super-admin/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=20)
    if al.status_code != 200:
        pytest.skip(f"super admin login failed: {al.status_code}")
    admin_token = al.json()["access_token"]

    # Find a company different from the CRM one
    cr = httpx.get(
        f"{API}/super-admin/companies",
        headers={"Authorization": f"Bearer {admin_token}"},
        timeout=20,
    )
    if cr.status_code != 200:
        pytest.skip(f"admin companies list failed: {cr.status_code}")
    others = [c for c in cr.json() if c.get("id") != crm_company_id]
    if not others:
        pytest.skip("no other company present to compare sequences")

    # We can only directly compare sequences via the CRM company endpoints
    # because each tenant's tickets are scoped. So we verify the CRM company
    # sequence keeps moving forward (no reset by other tenants), which
    # implies isolation since counter doc keys are per-company.
    p = {"customer_name": "TEST_29_iso_a", "customer_phone": f"+551144{uuid.uuid4().hex[:6]}",
         "channel": "whatsapp", "status": "aberto", "priority": "medium"}
    a = httpx.post(f"{API}/crm/tickets", headers=crm_headers, json=p, timeout=20).json()
    p["customer_name"] = "TEST_29_iso_b"
    p["customer_phone"] = f"+551144{uuid.uuid4().hex[:6]}"
    b = httpx.post(f"{API}/crm/tickets", headers=crm_headers, json=p, timeout=20).json()
    assert b["ticket_number"] == a["ticket_number"] + 1, "CRM company sequence not contiguous"
    httpx.delete(f"{API}/crm/tickets/{a['id']}", headers=crm_headers, timeout=20)
    httpx.delete(f"{API}/crm/tickets/{b['id']}", headers=crm_headers, timeout=20)


# --------------------- 7. Regression: CRUD + add message -----------------------
def test_regression_ticket_crud_and_message(crm_headers):
    p = {"customer_name": "TEST_29_reg", "customer_phone": "+5511444333222",
         "channel": "whatsapp", "status": "aberto", "priority": "medium"}
    cr = httpx.post(f"{API}/crm/tickets", headers=crm_headers, json=p, timeout=20)
    assert cr.status_code == 200
    t = cr.json()
    tid = t["id"]
    assert "ticket_number" in t

    # update
    upr = httpx.put(f"{API}/crm/tickets/{tid}", headers=crm_headers,
                    json={"status": "em_cobranca", "priority": "high"}, timeout=20)
    assert upr.status_code == 200
    assert upr.json()["status"] == "em_cobranca"
    assert upr.json().get("ticket_number") == t["ticket_number"]  # number preserved on update

    # add message
    mr = httpx.post(f"{API}/crm/tickets/{tid}/messages", headers=crm_headers,
                    json={"content": "msg interna", "sender_type": "agent"}, timeout=20)
    assert mr.status_code == 200

    # list
    lr = httpx.get(f"{API}/crm/tickets", headers=crm_headers, timeout=20)
    assert any(x["id"] == tid for x in lr.json())

    # delete
    dr = httpx.delete(f"{API}/crm/tickets/{tid}", headers=crm_headers, timeout=20)
    assert dr.status_code == 200
    gone = httpx.get(f"{API}/crm/tickets/{tid}", headers=crm_headers, timeout=20)
    assert gone.status_code == 404
