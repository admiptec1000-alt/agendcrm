"""Iteration 44 — Phase 4 (LID fallback + ticket merge + ticket-bound quotes).

Covers:
- POST /api/quotes without ticket_id → 400
- POST /api/quotes with ticket_id → quote_number == ticket.ticket_number
- POST /api/quotes second time on same ticket → versioned "{N}.2"
- POST /api/quotes with ticket of OTHER tenant → 404
- POST /api/crm/tickets/{src}/merge-into/{dst}
    * merges messages (dedupe by wa_message_id), tags (unique), deletes src,
      returns merged:true with ticket_number/messages_added/tags_added
    * re-points quotes from src to dst
    * cross-tenant returns 404
    * src == dst returns 400
- POST /api/channels/webhook/message with @lid-shaped phone merges into
  existing recent ticket of same name+connection (no new ticket created)
"""

import os
import time
import asyncio
import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "agentcrm_db")

CRM = {"email": "crm@test.com", "password": "crm123"}
BOSS = {"email": "admin@boss.com.br", "password": "boss123"}


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
def crm_connection_id():
    """Locate a channel_connection for the CRM tenant (used by webhook)."""
    async def _find():
        c = AsyncIOMotorClient(MONGO_URL)
        db = c[DB_NAME]
        co = await db.companies.find_one({"subdomain": "crmtest"})
        if not co:
            return None
        conn = await db.channel_connections.find_one({"company_id": co["id"]})
        c.close()
        return conn["id"] if conn else None
    return asyncio.get_event_loop().run_until_complete(_find())


# ─── Quotes must come from a ticket ──────────────────────────────────────────
class TestQuotesRequireTicket:
    def test_quote_without_ticket_id_400(self, crm_headers):
        r = requests.post(f"{API}/quotes", headers=crm_headers, json={
            "items": [{"description": "x", "quantity": 1, "unit_price": 1}],
            "freights": [],
        }, timeout=20)
        assert r.status_code == 400, r.text
        # Friendly Portuguese error mentions "atendimento"
        assert "atendimento" in r.text.lower()

    def test_quote_with_ticket_id_uses_ticket_number(self, crm_headers):
        # Provision a fresh ticket
        t = requests.post(f"{API}/crm/tickets", headers=crm_headers, json={
            "customer_name": "TEST_iter44 Tk1", "customer_phone": "5562988880011",
        }, timeout=20).json()
        tid, tnum = t["id"], t["ticket_number"]
        try:
            q = requests.post(f"{API}/quotes", headers=crm_headers, json={
                "ticket_id": tid,
                "items": [{"description": "Item A", "quantity": 2, "unit_price": 50}],
                "freights": [],
            }, timeout=20)
            assert q.status_code == 200, q.text
            d = q.json()
            assert d["quote_number"] == tnum
            assert d["ticket_id"] == tid
            assert d["total_value"] == 100

            # Second quote on SAME ticket → versioned "{N}.2"
            q2 = requests.post(f"{API}/quotes", headers=crm_headers, json={
                "ticket_id": tid,
                "items": [{"description": "Item B", "quantity": 1, "unit_price": 10}],
                "freights": [],
            }, timeout=20)
            assert q2.status_code == 200, q2.text
            d2 = q2.json()
            assert str(d2["quote_number"]).startswith(f"{tnum}.")
            assert "." in str(d2["quote_number"])

            # GET to verify persistence
            getr = requests.get(f"{API}/quotes/{d['id']}", headers=crm_headers, timeout=20)
            assert getr.status_code == 200
            assert getr.json()["quote_number"] == tnum

            # cleanup quotes
            requests.delete(f"{API}/quotes/{d['id']}", headers=crm_headers, timeout=20)
            requests.delete(f"{API}/quotes/{d2['id']}", headers=crm_headers, timeout=20)
        finally:
            requests.delete(f"{API}/crm/tickets/{tid}", headers=crm_headers, timeout=20)

    def test_quote_with_other_tenant_ticket_404(self, crm_headers, boss_headers):
        # Create ticket on BOSS tenant
        t_boss = requests.post(f"{API}/crm/tickets", headers=boss_headers, json={
            "customer_name": "TEST_iter44 Other", "customer_phone": "5562988880099",
        }, timeout=20).json()
        try:
            r = requests.post(f"{API}/quotes", headers=crm_headers, json={
                "ticket_id": t_boss["id"],
                "items": [{"description": "x", "quantity": 1, "unit_price": 1}],
                "freights": [],
            }, timeout=20)
            assert r.status_code == 404, r.text
        finally:
            requests.delete(f"{API}/crm/tickets/{t_boss['id']}", headers=boss_headers, timeout=20)


# ─── Ticket merge ────────────────────────────────────────────────────────────
class TestMergeTickets:
    def test_merge_messages_tags_quotes(self, crm_headers):
        # SOURCE ticket with 1 message + 1 tag
        src = requests.post(f"{API}/crm/tickets", headers=crm_headers, json={
            "customer_name": "TEST_iter44 Src", "customer_phone": "5562900000011",
        }, timeout=20).json()
        # DESTINATION ticket
        dst = requests.post(f"{API}/crm/tickets", headers=crm_headers, json={
            "customer_name": "TEST_iter44 Dst", "customer_phone": "5562900000022",
        }, timeout=20).json()

        # Inject messages + tags directly via mongo to simulate real conversation
        async def _inject():
            c = AsyncIOMotorClient(MONGO_URL)
            db = c[DB_NAME]
            await db.tickets.update_one({"id": src["id"]}, {"$set": {
                "messages": [
                    {"id": "m1", "content": "hi", "sender_type": "user", "wa_message_id": "WA-DUP-1"},
                    {"id": "m2", "content": "older", "sender_type": "user", "wa_message_id": "WA-SRC-2"},
                ],
                "tags": [{"id": "t-shared", "name": "shared"}, {"id": "t-only-src", "name": "only-src"}],
            }})
            await db.tickets.update_one({"id": dst["id"]}, {"$set": {
                "messages": [
                    {"id": "d1", "content": "from dst", "sender_type": "user", "wa_message_id": "WA-DUP-1"},
                ],
                "tags": [{"id": "t-shared", "name": "shared"}],
            }})
            c.close()
        asyncio.get_event_loop().run_until_complete(_inject())

        # Create a quote attached to SRC; after merge should re-point to DST
        q_src = requests.post(f"{API}/quotes", headers=crm_headers, json={
            "ticket_id": src["id"],
            "items": [{"description": "via src", "quantity": 1, "unit_price": 7}],
            "freights": [],
        }, timeout=20).json()

        try:
            r = requests.post(
                f"{API}/crm/tickets/{src['id']}/merge-into/{dst['id']}",
                headers=crm_headers, timeout=20)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["merged"] is True
            assert body["into_ticket_number"] == dst["ticket_number"]
            # Only WA-SRC-2 is new (WA-DUP-1 already in dst)
            assert body["messages_added"] == 1
            # Only "only-src" tag is new (shared already in dst)
            assert body["tags_added"] == 1

            # Verify SRC deleted, DST updated, quote re-pointed
            assert requests.get(f"{API}/crm/tickets/{src['id']}",
                                headers=crm_headers, timeout=20).status_code == 404
            dst_now = requests.get(f"{API}/crm/tickets/{dst['id']}",
                                   headers=crm_headers, timeout=20).json()
            wa_ids = {m.get("wa_message_id") for m in (dst_now.get("messages") or [])}
            assert {"WA-DUP-1", "WA-SRC-2"} <= wa_ids
            tag_names = {(t.get("name") or t.get("id")) for t in (dst_now.get("tags") or [])}
            assert {"shared", "only-src"} <= tag_names

            q_after = requests.get(f"{API}/quotes/{q_src['id']}", headers=crm_headers, timeout=20).json()
            assert q_after["ticket_id"] == dst["id"]
        finally:
            requests.delete(f"{API}/quotes/{q_src['id']}", headers=crm_headers, timeout=20)
            requests.delete(f"{API}/crm/tickets/{dst['id']}", headers=crm_headers, timeout=20)

    def test_merge_src_equals_dst_400(self, crm_headers):
        t = requests.post(f"{API}/crm/tickets", headers=crm_headers, json={
            "customer_name": "TEST_iter44 Same", "customer_phone": "5562900000033",
        }, timeout=20).json()
        try:
            r = requests.post(f"{API}/crm/tickets/{t['id']}/merge-into/{t['id']}",
                              headers=crm_headers, timeout=20)
            assert r.status_code == 400, r.text
        finally:
            requests.delete(f"{API}/crm/tickets/{t['id']}", headers=crm_headers, timeout=20)

    def test_merge_cross_tenant_404(self, crm_headers, boss_headers):
        a = requests.post(f"{API}/crm/tickets", headers=crm_headers, json={
            "customer_name": "TEST_iter44 A", "customer_phone": "5562900000055",
        }, timeout=20).json()
        b = requests.post(f"{API}/crm/tickets", headers=boss_headers, json={
            "customer_name": "TEST_iter44 B", "customer_phone": "5562900000066",
        }, timeout=20).json()
        try:
            # Caller is CRM but dst is from BOSS → 404
            r = requests.post(f"{API}/crm/tickets/{a['id']}/merge-into/{b['id']}",
                              headers=crm_headers, timeout=20)
            assert r.status_code == 404, r.text
        finally:
            requests.delete(f"{API}/crm/tickets/{a['id']}", headers=crm_headers, timeout=20)
            requests.delete(f"{API}/crm/tickets/{b['id']}", headers=boss_headers, timeout=20)


# ─── Webhook @lid fallback ───────────────────────────────────────────────────
class TestWebhookLidFallback:
    def test_lid_phone_merges_into_existing_ticket(self, crm_headers, crm_connection_id):
        if not crm_connection_id:
            pytest.skip("No CRM channel_connection available — skipping webhook fallback test")

        # 1. Pre-create OPEN ticket with a REAL Brazilian phone for the same name
        real_phone = "5562999990044"
        push_name = "João LID Test"
        t = requests.post(f"{API}/crm/tickets", headers=crm_headers, json={
            "customer_name": push_name, "customer_phone": real_phone,
        }, timeout=20).json()
        tid = t["id"]

        # Patch ticket to bind connection_id and recent updated_at (so cutoff matches)
        async def _bind():
            c = AsyncIOMotorClient(MONGO_URL)
            db = c[DB_NAME]
            from datetime import datetime, timezone
            await db.tickets.update_one({"id": tid}, {"$set": {
                "connection_id": crm_connection_id,
                "status": "aberto",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }})
            c.close()
        asyncio.get_event_loop().run_until_complete(_bind())

        try:
            # 2. POST a webhook with a LID-shaped phone (>=14 digits, non-BR)
            lid_phone = "250615737372785"  # 15 digits, doesn't start with 55
            payload = {
                "instance_id": crm_connection_id,
                "phone": lid_phone,
                "name": push_name,
                "message": "Mensagem via @lid",
                "message_id": f"WA-LID-{int(time.time())}",
                "timestamp": int(time.time()),
            }
            r = requests.post(f"{API}/channels/webhook/message", json=payload, timeout=20)
            assert r.status_code == 200, r.text

            # 3. Verify NO new ticket was created with the LID phone
            tickets = requests.get(f"{API}/crm/tickets", headers=crm_headers, timeout=20).json()
            lid_tickets = [t for t in tickets if t.get("customer_phone") == lid_phone]
            assert lid_tickets == [], f"LID created duplicate: {lid_tickets}"

            # 4. Verify the original ticket received the new message
            updated = requests.get(f"{API}/crm/tickets/{tid}", headers=crm_headers, timeout=20).json()
            contents = [m.get("content") for m in (updated.get("messages") or [])]
            assert "Mensagem via @lid" in contents

            # 5. Real phone is preserved (not overwritten)
            assert updated["customer_phone"] == real_phone
        finally:
            requests.delete(f"{API}/crm/tickets/{tid}", headers=crm_headers, timeout=20)

    def test_normal_brazilian_phone_creates_or_uses_phone_match(self, crm_headers, crm_connection_id):
        """Sanity: a normal BR phone does NOT trigger LID fallback path."""
        if not crm_connection_id:
            pytest.skip("No CRM channel_connection available")
        phone = "5562988887766"
        payload = {
            "instance_id": crm_connection_id,
            "phone": phone,
            "name": "TEST_iter44 Normal",
            "message": "Oi normal",
            "message_id": f"WA-NORM-{int(time.time())}",
            "timestamp": int(time.time()),
        }
        r = requests.post(f"{API}/channels/webhook/message", json=payload, timeout=20)
        assert r.status_code == 200, r.text
        # The phone-keyed ticket should now exist
        tickets = requests.get(f"{API}/crm/tickets", headers=crm_headers, timeout=20).json()
        match = [t for t in tickets if t.get("customer_phone") == phone]
        assert len(match) >= 1
        # cleanup
        for m in match:
            requests.delete(f"{API}/crm/tickets/{m['id']}", headers=crm_headers, timeout=20)


    def test_lid_fallback_works_even_without_ticket_connection_id(self, crm_headers, crm_connection_id):
        """Reproducao FIEL ao caso #1014/#1015 do user:
        Ticket #1014 ('Teste Suporte') foi criado MANUALMENTE — sem
        connection_id. Agente envia outgoing via /messages (que agora seta
        connection_id automaticamente). Cliente responde com phone LID e
        push_name diferente. O fallback deve achar o ticket pelo
        last_outgoing_at sem depender de connection_id ser igual.
        """
        if not crm_connection_id:
            pytest.skip("No CRM channel_connection available")

        real_phone = "5562991700099"

        # Manual ticket creation: NO connection_id
        t = requests.post(f"{API}/crm/tickets", headers=crm_headers, json={
            "customer_name": "Teste Suporte Manual",
            "customer_phone": real_phone,
            "channel": "whatsapp",
        }, timeout=20).json()
        tid = t["id"]
        assert t.get("connection_id") in (None, "")  # sanity

        # Force last_outgoing_at via DB (simulates a successful outgoing).
        # Connection_id stays empty to mirror the user's real production case.
        async def _seed_outgoing():
            c = AsyncIOMotorClient(MONGO_URL)
            db = c[DB_NAME]
            from datetime import datetime, timezone
            await db.tickets.update_one({"id": tid}, {"$set": {
                "status": "aberto",
                "last_outgoing_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }})
            c.close()
        asyncio.get_event_loop().run_until_complete(_seed_outgoing())

        try:
            lid_phone = "250615888777666"
            payload = {
                "instance_id": crm_connection_id,
                "phone": lid_phone,
                "name": "Nome Diferente Real",
                "message": "Resposta vinda como LID",
                "message_id": f"WA-LIDM-{int(time.time())}",
                "timestamp": int(time.time()),
            }
            r = requests.post(f"{API}/channels/webhook/message", json=payload, timeout=20)
            assert r.status_code == 200, r.text

            tickets = requests.get(f"{API}/crm/tickets", headers=crm_headers, timeout=20).json()
            assert [x for x in tickets if x.get("customer_phone") == lid_phone] == [], \
                "LID created duplicate even after fallback dropped connection_id filter"
            updated = requests.get(f"{API}/crm/tickets/{tid}", headers=crm_headers, timeout=20).json()
            assert "Resposta vinda como LID" in [m.get("content") for m in (updated.get("messages") or [])]
        finally:
            requests.delete(f"{API}/crm/tickets/{tid}", headers=crm_headers, timeout=20)


    def test_lid_fallback_via_last_outgoing(self, crm_headers, crm_connection_id):
        """Reproducao do caso real do user (#1011/#1012):
        operador edita o nome do contato no CRM ('Izaque Ferreira'); WhatsApp
        passa pushName diferente ('Izaque Carriço'). Quando chega resposta com
        phone LID, o match por nome NAO funciona — mas como o operador acabou
        de mandar mensagem (last_outgoing_at), o fallback acha o ticket certo.
        """
        if not crm_connection_id:
            pytest.skip("No CRM channel_connection available")

        real_phone = "5562999991100"
        ticket_custom_name = "TEST_iter44 Nome Editado"  # nome editado pelo operador
        wa_push_name = "TEST_iter44 Nome Original"        # nome no profile do WhatsApp (diferente)

        t = requests.post(f"{API}/crm/tickets", headers=crm_headers, json={
            "customer_name": ticket_custom_name, "customer_phone": real_phone,
        }, timeout=20).json()
        tid = t["id"]

        # Marcar last_outgoing_at agora (simula operador acabou de enviar) +
        # connection_id + status aberto.
        async def _bind():
            c = AsyncIOMotorClient(MONGO_URL)
            db = c[DB_NAME]
            from datetime import datetime, timezone
            await db.tickets.update_one({"id": tid}, {"$set": {
                "connection_id": crm_connection_id,
                "status": "aberto",
                "last_outgoing_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }})
            c.close()
        asyncio.get_event_loop().run_until_complete(_bind())

        try:
            # Webhook com phone LID + pushName DIFERENTE do customer_name
            lid_phone = "250615999999111"
            payload = {
                "instance_id": crm_connection_id,
                "phone": lid_phone,
                "name": wa_push_name,  # NAO bate com customer_name do ticket
                "message": "Resposta LID com nome diferente",
                "message_id": f"WA-LIDOUT-{int(time.time())}",
                "timestamp": int(time.time()),
            }
            r = requests.post(f"{API}/channels/webhook/message", json=payload, timeout=20)
            assert r.status_code == 200, r.text

            # NENHUM ticket novo com o LID
            tickets = requests.get(f"{API}/crm/tickets", headers=crm_headers, timeout=20).json()
            lid_tickets = [x for x in tickets if x.get("customer_phone") == lid_phone]
            assert lid_tickets == [], f"LID created duplicate: {lid_tickets}"

            # Mensagem agregou no ticket original (matched via last_outgoing_at)
            updated = requests.get(f"{API}/crm/tickets/{tid}", headers=crm_headers, timeout=20).json()
            contents = [m.get("content") for m in (updated.get("messages") or [])]
            assert "Resposta LID com nome diferente" in contents
            assert updated["customer_phone"] == real_phone
        finally:
            requests.delete(f"{API}/crm/tickets/{tid}", headers=crm_headers, timeout=20)
