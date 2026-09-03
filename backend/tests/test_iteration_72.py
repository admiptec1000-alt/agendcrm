"""Iteration 72 — Bug prod #10333: phone normalization mismatch no match do ticket.

Fix testado: em routes/channels_routes.py (~1462-1490) o lookup do ticket
existente monta um $or com variantes do telefone (raw, digits-only,
digits sem DDI 55, digits com DDI 55).

Cobertura:
  A) ticket com DDI ('5562988887777') + webhook sem DDI ('62988887777') -> mesmo ticket
  B) ticket sem DDI + webhook com DDI -> mesmo ticket
  C) webhook formatado '+55 (62) 98888-7777' -> casa ticket '5562988887777'
  D) idempotencia (mesmo msg_id 2x -> duplicate:true) continua
  E) telefone realmente diferente -> NAO colapsa no ticket existente
  F) Ponto 5 (scoping por conexao) preservado: variante de phone em OUTRA
     conexao nao casa o ticket
  G) from_me=True (operador pelo celular) tambem casa a variante
"""
import os
import sys
import uuid
import asyncio
from datetime import datetime, timezone

import pytest
import requests
from dotenv import load_dotenv, dotenv_values

load_dotenv("/app/backend/.env")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

_fe = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _fe.get("REACT_APP_BACKEND_URL")).rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

CRM_EMAIL = "crm@test.com"
CRM_PASSWORD = "crm123"

TAG = "TEST_it72"
WEBHOOK = f"{BASE_URL}/api/channels/webhook/message"


def _mongo():
    return AsyncIOMotorClient(MONGO_URL)[DB_NAME]


def _run(coro):
    return asyncio.run(coro)


def _login():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": CRM_EMAIL, "password": CRM_PASSWORD},
        timeout=30,
    )
    assert r.status_code == 200, f"login failed {r.status_code} {r.text[:300]}"
    b = r.json()
    return b["access_token"], b["user"]


@pytest.fixture(scope="module")
def env():
    _, user = _login()
    company_id = user["company_id"]
    conn_id = f"{TAG}_conn_" + uuid.uuid4().hex[:8]
    conn_id_b = f"{TAG}_connB_" + uuid.uuid4().hex[:8]

    async def _seed():
        db = _mongo()
        for cid, nm in ((conn_id, f"{TAG}_conn"), (conn_id_b, f"{TAG}_connB")):
            await db.channel_connections.insert_one({
                "id": cid,
                "company_id": company_id,
                "type": "whatsapp",
                "provider": "baileys",
                "status": "connected",
                "name": nm,
                "queue_ids": [],
                "connected_name": f"{TAG} Operador",
                "connected_at": datetime.now(timezone.utc).isoformat(),
            })
    _run(_seed())

    yield {"company_id": company_id, "conn_id": conn_id, "conn_id_b": conn_id_b}

    async def _clean():
        db = _mongo()
        tks = await db.tickets.find(
            {"company_id": company_id,
             "$or": [{"connection_id": {"$in": [conn_id, conn_id_b]}},
                     {"customer_name": {"$regex": f"^{TAG}"}}]},
            {"_id": 0, "id": 1},
        ).to_list(500)
        tids = [t["id"] for t in tks]
        await db.flow_send_log.delete_many({"ticket_id": {"$in": tids}})
        await db.tickets.delete_many({"id": {"$in": tids}})
        await db.channel_connections.delete_many({"id": {"$in": [conn_id, conn_id_b]}})
        await db.message_log.delete_many({"connection_id": {"$in": [conn_id, conn_id_b]}})
        await db.clients.delete_many({"company_id": company_id, "name": {"$regex": f"^{TAG}"}})
        await db.webhook_dedup.delete_many({"connection_id": {"$regex": f"^{TAG}"}})
        await db.webhook_dedup.delete_many({"_id": {"$regex": f"^{TAG}"}})
    _run(_clean())


def _seed_ticket(company_id, conn_id, phone, name=None, status="aberto"):
    """Cria um ticket 'legado' direto no Mongo com o phone no formato dado."""
    tid = str(uuid.uuid4())

    async def _ins():
        db = _mongo()
        num = 900000 + int(uuid.uuid4().int % 90000)
        await db.tickets.insert_one({
            "id": tid,
            "ticket_number": num,
            "company_id": company_id,
            "connection_id": conn_id,
            "client_id": None,
            "customer_name": name or f"{TAG}_cliente",
            "customer_phone": phone,
            "customer_email": None,
            "status": status,
            "priority": "medium",
            "channel": "whatsapp",
            "is_group": False,
            "description": f"{TAG} seeded",
            "assigned_to": None,
            "queue_id": None,
            "messages": [{
                "id": str(uuid.uuid4()),
                "content": f"{TAG} mensagem antiga (seed)",
                "sender_type": "agent",
                "sender_name": "Veronica Teles",
                "created_at": datetime.now(timezone.utc).isoformat(),
            }],
            "tags": [],
            "value": 0.0,
            "bot_paused": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
    _run(_ins())
    return tid


def _get_ticket(tid):
    async def _q():
        db = _mongo()
        return await db.tickets.find_one({"id": tid}, {"_id": 0})
    return _run(_q())


def _tickets_for_conn(conn_id):
    async def _q():
        db = _mongo()
        return await db.tickets.find({"connection_id": conn_id}, {"_id": 0}).to_list(500)
    return _run(_q())


def _ticket_ids(conn_id):
    return {t["id"] for t in _tickets_for_conn(conn_id)}


def _new_tickets(conn_id, before_ids):
    """Tickets criados nessa conexao depois do snapshot `before_ids`."""
    return [t for t in _tickets_for_conn(conn_id) if t["id"] not in before_ids]


def _payload(conn_id, phone, msg_id, message="oi", from_me=False, name=None):
    return {
        "instance_id": conn_id,
        "phone": phone,
        "name": name or f"{TAG}_cliente",
        "message": message,
        "message_id": msg_id,
        "from_me": from_me,
        "timestamp": int(datetime.now(timezone.utc).timestamp()),
    }


def _post(payload):
    return requests.post(WEBHOOK, json=payload, timeout=90)


def _mid():
    return "WAMID_" + TAG + "_" + uuid.uuid4().hex[:12]


def _new_local():
    """DDD 62 + 9 + 8 digitos aleatorios -> '62 9XXXXXXXX' (11 digitos)."""
    return "629" + str(uuid.uuid4().int)[:8]


# ── A) ticket COM DDI, webhook SEM DDI ───────────────────────────────
class TestTicketWithDdiWebhookWithout:
    def test_message_lands_in_existing_ticket(self, env):
        local = _new_local()                 # 62988887777
        stored = "55" + local                # 5562988887777
        tid = _seed_ticket(env["company_id"], env["conn_id"], stored)
        before = _ticket_ids(env["conn_id"])

        r = _post(_payload(env["conn_id"], local, _mid(), message=f"{TAG} inbound sem DDI"))
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert body.get("ok") is True, body
        assert not body.get("duplicate"), body

        t = _get_ticket(tid)
        contents = [m.get("content") for m in (t.get("messages") or [])]
        assert f"{TAG} inbound sem DDI" in contents, (
            f"mensagem NAO caiu no ticket existente (bug #10333). msgs={contents}"
        )
        # nenhum ticket novo criado para essa conexao
        others = _new_tickets(env["conn_id"], before)
        assert not others, f"webhook criou ticket novo em vez de casar: {[o['customer_phone'] for o in others]}"


# ── B) ticket SEM DDI, webhook COM DDI ───────────────────────────────
class TestTicketWithoutDdiWebhookWith:
    def test_message_lands_in_existing_ticket(self, env):
        local = _new_local()
        tid = _seed_ticket(env["company_id"], env["conn_id"], local)
        before = _ticket_ids(env["conn_id"])

        r = _post(_payload(env["conn_id"], "55" + local, _mid(), message=f"{TAG} inbound com DDI"))
        assert r.status_code == 200, r.text[:300]
        assert r.json().get("ok") is True

        t = _get_ticket(tid)
        contents = [m.get("content") for m in (t.get("messages") or [])]
        assert f"{TAG} inbound com DDI" in contents, (
            f"reverso falhou — msg nao caiu no ticket sem DDI. msgs={contents}"
        )
        others = _new_tickets(env["conn_id"], before)
        assert not others, f"criou ticket novo: {[o['customer_phone'] for o in others]}"


# ── C) webhook com pontuacao ─────────────────────────────────────────
class TestFormattedPhone:
    def test_formatted_phone_matches_digits_ticket(self, env):
        local = _new_local()                      # 629XXXXXXXX
        stored = "55" + local
        tid = _seed_ticket(env["company_id"], env["conn_id"], stored)
        before = _ticket_ids(env["conn_id"])
        formatted = f"+55 ({local[:2]}) {local[2:7]}-{local[7:]}"

        r = _post(_payload(env["conn_id"], formatted, _mid(), message=f"{TAG} inbound formatado"))
        assert r.status_code == 200, r.text[:300]
        assert r.json().get("ok") is True

        t = _get_ticket(tid)
        contents = [m.get("content") for m in (t.get("messages") or [])]
        assert f"{TAG} inbound formatado" in contents, (
            f"phone formatado {formatted!r} nao casou com {stored}. msgs={contents}"
        )
        others = _new_tickets(env["conn_id"], before)
        assert not others, f"criou ticket novo: {[o['customer_phone'] for o in others]}"


# ── D) idempotencia mantida ──────────────────────────────────────────
class TestIdempotenceStillWorks:
    def test_same_msg_id_twice_is_deduped(self, env):
        local = _new_local()
        tid = _seed_ticket(env["company_id"], env["conn_id"], "55" + local)
        before = _ticket_ids(env["conn_id"])
        mid = _mid()
        pl = _payload(env["conn_id"], local, mid, message=f"{TAG} dedup")

        r1 = _post(pl)
        assert r1.status_code == 200 and not r1.json().get("duplicate"), r1.text[:300]
        r2 = _post(pl)
        assert r2.status_code == 200, r2.text[:300]
        b2 = r2.json()
        assert b2.get("duplicate") is True, f"2a entrega nao deduplicada: {b2}"
        assert b2.get("reason") == "message_id_seen", b2

        t = _get_ticket(tid)
        hits = [m for m in (t.get("messages") or []) if m.get("content") == f"{TAG} dedup"]
        assert len(hits) == 1, f"mensagem duplicada no ticket: {len(hits)}"


# ── E) phone realmente diferente ─────────────────────────────────────
class TestUnrelatedPhoneDoesNotCollapse:
    def test_unrelated_phone_creates_own_ticket(self, env):
        local = _new_local()
        tid = _seed_ticket(env["company_id"], env["conn_id"], "55" + local)
        before = _ticket_ids(env["conn_id"])
        unrelated = "5511" + str(uuid.uuid4().int)[:9]

        r = _post(_payload(env["conn_id"], unrelated, _mid(),
                           message=f"{TAG} outro cliente",
                           name=f"{TAG}_outro"))
        assert r.status_code == 200, r.text[:300]

        t = _get_ticket(tid)
        contents = [m.get("content") for m in (t.get("messages") or [])]
        assert f"{TAG} outro cliente" not in contents, (
            "telefone nao relacionado colapsou no ticket existente!"
        )
        others = _new_tickets(env["conn_id"], before)
        assert len(others) == 1, f"esperado 1 ticket novo, got {len(others)}"
        assert others[0]["customer_phone"] == unrelated


# ── F) Ponto 5: scoping por conexao preservado ───────────────────────
class TestPerConnectionScopingPreserved:
    def test_variant_phone_other_connection_does_not_match(self, env):
        local = _new_local()
        # ticket aberto na conexao B com o phone COM DDI
        tid_b = _seed_ticket(env["company_id"], env["conn_id_b"], "55" + local)
        before_a = _ticket_ids(env["conn_id"])

        # webhook chega na conexao A com variante sem DDI
        r = _post(_payload(env["conn_id"], local, _mid(), message=f"{TAG} conexao A"))
        assert r.status_code == 200, r.text[:300]

        tb = _get_ticket(tid_b)
        contents_b = [m.get("content") for m in (tb.get("messages") or [])]
        assert f"{TAG} conexao A" not in contents_b, (
            "expansao do $or quebrou o scoping por conexao (Ponto 5)"
        )
        a_tickets = _new_tickets(env["conn_id"], before_a)
        assert len(a_tickets) == 1, (
            f"esperado 1 ticket NOVO na conexao A, got {len(a_tickets)}: "
            f"{[x['customer_phone'] for x in a_tickets]}"
        )
        assert a_tickets[0]["connection_id"] == env["conn_id"]
        assert a_tickets[0]["customer_phone"] == local


# ── G) from_me (operador pelo celular) tambem casa variante ──────────
class TestOutboundFromPhoneMatchesVariant:
    def test_from_me_variant_lands_in_existing_ticket(self, env):
        local = _new_local()
        tid = _seed_ticket(env["company_id"], env["conn_id"], "55" + local)
        before = _ticket_ids(env["conn_id"])

        r = _post(_payload(env["conn_id"], local, _mid(),
                           message=f"{TAG} outbound do celular", from_me=True))
        assert r.status_code == 200, r.text[:300]

        t = _get_ticket(tid)
        msgs = t.get("messages") or []
        hit = [m for m in msgs if m.get("content") == f"{TAG} outbound do celular"]
        assert hit, f"outbound from_me nao caiu no ticket existente. msgs={[m.get('content') for m in msgs]}"
        assert hit[0].get("sender_type") == "agent", hit[0]
        others = _new_tickets(env["conn_id"], before)
        assert not others, f"criou ticket novo para outbound: {[o['customer_phone'] for o in others]}"


# ── H) Mesma classe de bug em POST /api/crm/tickets/open-for-client ──
class TestCrmOpenForClientDdiDrift:
    """Entrada paralela do mesmo bug: o lookup em crm_routes.py (~400) so
    considera raw + digits-only, SEM variantes de DDI. Se o ticket antigo
    ficou com '55...' e o operador abre atendimento com o numero local
    (ou vice-versa), um ticket DUPLICADO e criado."""

    def test_open_for_client_reuses_ticket_with_ddi_drift(self, env):
        _token, _ = _login()
        local = _new_local()
        tid = _seed_ticket(env["company_id"], env["conn_id"], "55" + local)
        before = _ticket_ids(env["conn_id"])

        r = requests.post(
            f"{BASE_URL}/api/crm/tickets/open-for-client",
            headers={"Authorization": f"Bearer {_token}"},
            json={"phone": local, "name": f"{TAG}_cliente",
                  "connection_id": env["conn_id"]},
            timeout=60,
        )
        assert r.status_code in (200, 201), f"{r.status_code} {r.text[:300]}"
        returned = r.json()
        rid = (returned.get("ticket") or returned).get("id")
        created = _new_tickets(env["conn_id"], before)
        assert rid == tid and not created, (
            f"open-for-client criou ticket duplicado por drift de DDI "
            f"(existente={tid} phone=55{local}, retornado={rid}, "
            f"novos={[c['customer_phone'] for c in created]})"
        )
