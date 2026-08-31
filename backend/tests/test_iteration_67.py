"""Iteration 67 — Ponto 5: mesmo cliente pode ter MULTIPLOS tickets abertos
simultaneamente em conexoes DIFERENTES (per-(company, phone, connection)).

Cobertura:
  A) Webhook POST /api/channels/webhook/message
     - inbound P na conexao A -> ticket T_A (connection_id=A)
     - inbound P na conexao B -> ticket T_B separado (connection_id=B)
     - 2o inbound P na conexao A -> cai no T_A existente (nao cria 3o)
     - from_me=true na conexao C -> ticket novo em C com bot_paused=true
  B) LID fallback (channels_routes ~1323)
     - ticket manual SEM connection_id + outgoing recente -> @lid inbound merge
     - ticket com connection_id=A -> @lid inbound na conexao B NAO faz merge
  C) Grupos (whatsapp_group) chaveados por group_jid (sem regressao)
  D) POST /api/crm/tickets guard de duplicidade ciente de conexao
"""
import os
import sys
import uuid
import asyncio
from datetime import datetime, timezone, timedelta

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

TAG = "TEST_it67"
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
def session_user():
    token, user = _login()
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s, user


@pytest.fixture(scope="module")
def conns(session_user):
    """Seed 3 connected WhatsApp connections for the CRM tenant."""
    _, user = session_user
    company_id = user["company_id"]
    ids = {}

    async def _seed():
        db = _mongo()
        for label in ("A", "B", "C"):
            cid = f"{TAG}_conn_{label}_" + uuid.uuid4().hex[:8]
            await db.channel_connections.insert_one({
                "id": cid,
                "company_id": company_id,
                "type": "whatsapp",
                "provider": "baileys",
                "status": "connected",
                "name": f"{TAG}_{label}",
                "queue_ids": [],
                "connected_at": datetime.now(timezone.utc).isoformat(),
            })
            ids[label] = cid
    _run(_seed())
    yield ids

    async def _clean():
        db = _mongo()
        await db.channel_connections.delete_many({"id": {"$in": list(ids.values())}})
        await db.tickets.delete_many({"company_id": company_id, "connection_id": {"$in": list(ids.values())}})
        await db.tickets.delete_many({"company_id": company_id, "customer_name": {"$regex": f"^{TAG}"}})
        await db.clients.delete_many({"company_id": company_id, "name": {"$regex": f"^{TAG}"}})
        await db.message_log.delete_many({"connection_id": {"$in": list(ids.values())}})
    _run(_clean())


def _post_webhook(instance_id, phone, name, message, **extra):
    payload = {
        "instance_id": instance_id,
        "phone": phone,
        "name": name,
        "message": message,
        "message_id": "WAMID_" + uuid.uuid4().hex[:16],
        "from_me": False,
        "timestamp": int(datetime.now(timezone.utc).timestamp()),
    }
    payload.update(extra)
    r = requests.post(WEBHOOK, json=payload, timeout=60)
    return r


def _tickets_for(company_id, phone):
    async def _f():
        db = _mongo()
        return await db.tickets.find(
            {"company_id": company_id, "customer_phone": phone}, {"_id": 0}
        ).to_list(50)
    return _run(_f())


def _ticket_by_id(tid):
    async def _f():
        return await _mongo().tickets.find_one({"id": tid}, {"_id": 0})
    return _run(_f())


def _new_phone():
    return "5511" + str(uuid.uuid4().int)[:9]


# ---------------------------------------------------------------------------
# A) Webhook — per-connection ticket isolation
# ---------------------------------------------------------------------------
class TestWebhookPerConnectionTickets:
    def test_same_phone_two_connections_two_tickets(self, session_user, conns):
        _, user = session_user
        company_id = user["company_id"]
        phone = _new_phone()

        r1 = _post_webhook(conns["A"], phone, f"{TAG}_cliA", "oi comercial")
        assert r1.status_code == 200, r1.text[:300]
        assert r1.json().get("ok") is True, r1.text[:300]

        r2 = _post_webhook(conns["B"], phone, f"{TAG}_cliB", "oi financeiro")
        assert r2.status_code == 200, r2.text[:300]
        assert r2.json().get("ok") is True, r2.text[:300]

        tks = _tickets_for(company_id, phone)
        assert len(tks) == 2, f"expected 2 independent tickets, got {len(tks)}: {[t.get('connection_id') for t in tks]}"
        by_conn = {t["connection_id"]: t for t in tks}
        assert set(by_conn) == {conns["A"], conns["B"]}
        for t in tks:
            assert t["status"] not in ("fechado",), t["status"]
            assert len(t["messages"]) >= 1
        assert by_conn[conns["A"]]["id"] != by_conn[conns["B"]]["id"]
        assert by_conn[conns["A"]]["ticket_number"] != by_conn[conns["B"]]["ticket_number"]
        # message content isolation
        assert any("comercial" in (m.get("content") or "") for m in by_conn[conns["A"]]["messages"])
        assert any("financeiro" in (m.get("content") or "") for m in by_conn[conns["B"]]["messages"])

    def test_second_inbound_same_connection_reuses_ticket(self, session_user, conns):
        _, user = session_user
        company_id = user["company_id"]
        phone = _new_phone()

        assert _post_webhook(conns["A"], phone, f"{TAG}_reuse", "msg 1").status_code == 200
        assert _post_webhook(conns["B"], phone, f"{TAG}_reuse", "msg B1").status_code == 200
        before = _tickets_for(company_id, phone)
        assert len(before) == 2
        t_a = next(t for t in before if t["connection_id"] == conns["A"])
        t_b = next(t for t in before if t["connection_id"] == conns["B"])
        b_msgs_before = len(t_b["messages"])

        assert _post_webhook(conns["A"], phone, f"{TAG}_reuse", "msg 2").status_code == 200
        after = _tickets_for(company_id, phone)
        assert len(after) == 2, f"3rd ticket created: {len(after)}"
        t_a2 = _ticket_by_id(t_a["id"])
        t_b2 = _ticket_by_id(t_b["id"])
        assert len(t_a2["messages"]) == len(t_a["messages"]) + 1, "2nd inbound did not land in existing T_A"
        assert any("msg 2" in (m.get("content") or "") for m in t_a2["messages"])
        assert len(t_b2["messages"]) == b_msgs_before, "T_B was modified by inbound on connection A"

    def test_from_me_creates_paused_ticket_on_own_connection(self, session_user, conns):
        _, user = session_user
        company_id = user["company_id"]
        phone = _new_phone()

        # existing open ticket on connection A for the same phone
        assert _post_webhook(conns["A"], phone, f"{TAG}_fromme", "cliente falou com A").status_code == 200
        # operator writes from linked phone on connection C
        r = _post_webhook(conns["C"], phone, f"{TAG}_fromme", "oi, aqui eh o operador", from_me=True)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert body.get("created_paused") is True, f"expected new paused ticket, got {body}"

        tks = _tickets_for(company_id, phone)
        assert len(tks) == 2, f"expected 2 tickets (A + C), got {len(tks)}"
        t_c = next((t for t in tks if t["connection_id"] == conns["C"]), None)
        assert t_c is not None, "from_me ticket not bound to connection C"
        assert t_c["bot_paused"] is True
        assert t_c["bot_paused_reason"] == "operator_initiated_from_phone"
        assert t_c["initiated_by_agent"] is True
        t_a = next(t for t in tks if t["connection_id"] == conns["A"])
        assert not t_a.get("bot_paused"), "from_me on C wrongly paused ticket on A"


# ---------------------------------------------------------------------------
# B) LID fallback regression
# ---------------------------------------------------------------------------
class TestLidFallback:
    def _seed_ticket(self, company_id, **extra):
        tid = str(uuid.uuid4())
        doc = {
            "id": tid,
            "ticket_number": 900000 + int(uuid.uuid4().int % 90000),
            "company_id": company_id,
            "customer_name": f"{TAG}_lid_manual",
            "customer_phone": _new_phone(),
            "channel": "whatsapp",
            "status": "aberto",
            "messages": [],
            "last_outgoing_at": datetime.now(timezone.utc).isoformat(),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        doc.update(extra)

        async def _f():
            await _mongo().tickets.insert_one(doc)
        _run(_f())
        return doc

    def test_manual_ticket_without_connection_still_matched_by_lid(self, session_user, conns):
        _, user = session_user
        company_id = user["company_id"]
        # manual ticket: NO connection_id at all, recent outgoing
        t = self._seed_ticket(company_id)
        lid_phone = "2506157373727" + str(uuid.uuid4().int)[:3]  # 16 digits -> LID
        r = _post_webhook(conns["A"], lid_phone, f"{TAG}_lid_manual", "responde via lid",
                          lid_jid=f"{lid_phone}@lid", is_lid=True)
        assert r.status_code == 200, r.text[:300]

        merged = _ticket_by_id(t["id"])
        assert len(merged["messages"]) == 1, (
            "manually-created ticket (no connection_id) was NOT matched by @lid inbound"
        )
        assert "responde via lid" in merged["messages"][0]["content"]
        # and no duplicate ticket was created for the LID phone
        dups = _tickets_for(company_id, lid_phone)
        assert dups == [], f"duplicate LID ticket created: {len(dups)}"

    def test_lid_does_not_cross_connections(self, session_user, conns):
        _, user = session_user
        company_id = user["company_id"]

        # Remove tickets seeded by the previous test (manual, no connection_id,
        # recent outgoing) so they cannot absorb the LID inbound — otherwise we
        # would be testing the no-connection branch again.
        async def _clear_prev():
            await _mongo().tickets.delete_many({
                "company_id": company_id,
                "customer_name": f"{TAG}_lid_manual",
            })
        _run(_clear_prev())

        # ticket owned by connection A, recent outgoing
        t = self._seed_ticket(company_id, connection_id=conns["A"],
                              customer_name=f"{TAG}_lid_ownedA")
        lid_phone = "2506157373728" + str(uuid.uuid4().int)[:3]
        r = _post_webhook(conns["B"], lid_phone, f"{TAG}_lid_ownedA", "lid na conexao B",
                          lid_jid=f"{lid_phone}@lid", is_lid=True)
        assert r.status_code == 200, r.text[:300]

        owned = _ticket_by_id(t["id"])
        assert len(owned["messages"]) == 0, (
            "@lid inbound on connection B leaked into ticket owned by connection A"
        )
        newt = _tickets_for(company_id, lid_phone)
        assert len(newt) == 1, f"expected a fresh ticket on connection B, got {len(newt)}"
        assert newt[0]["connection_id"] == conns["B"]


# ---------------------------------------------------------------------------
# C) Group tickets keyed by group_jid (no regression)
# ---------------------------------------------------------------------------
class TestGroupTickets:
    def test_group_ticket_keyed_by_group_jid(self, session_user, conns):
        _, user = session_user
        company_id = user["company_id"]
        group_jid = f"1203630{uuid.uuid4().int % 10**10}@g.us"
        p1, p2 = _new_phone(), _new_phone()

        r1 = _post_webhook(conns["A"], p1, f"{TAG}_grp_m1", "msg grupo 1",
                           is_group=True, group_jid=group_jid, group_subject=f"{TAG}_grupo")
        assert r1.status_code == 200, r1.text[:300]
        r2 = _post_webhook(conns["A"], p2, f"{TAG}_grp_m2", "msg grupo 2",
                           is_group=True, group_jid=group_jid, group_subject=f"{TAG}_grupo")
        assert r2.status_code == 200, r2.text[:300]

        async def _f():
            return await _mongo().tickets.find(
                {"company_id": company_id, "group_jid": group_jid}, {"_id": 0}
            ).to_list(10)
        tks = _run(_f())
        assert len(tks) == 1, f"group must own a single ticket, got {len(tks)}"
        assert tks[0]["channel"] == "whatsapp_group"
        assert tks[0]["connection_id"] == conns["A"]
        assert len(tks[0]["messages"]) == 2, f"group msgs: {len(tks[0]['messages'])}"

        # webhook from a non-owner connection is dropped
        r3 = _post_webhook(conns["B"], p1, f"{TAG}_grp_m1", "msg grupo dup",
                           is_group=True, group_jid=group_jid, group_subject=f"{TAG}_grupo")
        assert r3.status_code == 200
        assert r3.json().get("ignored") == "group_owned_by_other_connection", r3.text[:300]
        tks2 = _run(_f())
        assert len(tks2) == 1
        assert len(tks2[0]["messages"]) == 2, "non-owner connection appended to group ticket"


# ---------------------------------------------------------------------------
# D) POST /api/crm/tickets duplicate guard
# ---------------------------------------------------------------------------
class TestCrmCreateTicketDuplicateGuard:
    def test_duplicate_guard_is_connection_scoped(self, session_user, conns):
        s, user = session_user
        phone = _new_phone()
        base = {
            "customer_name": f"{TAG}_crm_dup",
            "customer_phone": phone,
            "channel": "whatsapp",
            "description": "it67 dup guard",
        }

        r1 = s.post(f"{BASE_URL}/api/crm/tickets", json={**base, "connection_id": conns["A"]}, timeout=30)
        assert r1.status_code in (200, 201), f"1st create failed {r1.status_code} {r1.text[:300]}"
        t1 = r1.json()
        assert t1["connection_id"] == conns["A"]
        assert "_id" not in t1

        r2 = s.post(f"{BASE_URL}/api/crm/tickets", json={**base, "connection_id": conns["A"]}, timeout=30)
        assert r2.status_code == 409, f"2nd identical create should 409, got {r2.status_code} {r2.text[:300]}"
        det = r2.json()["detail"]
        assert det["code"] == "duplicate_open_ticket", det
        assert det["existing_ticket"]["id"] == t1["id"]

        r3 = s.post(f"{BASE_URL}/api/crm/tickets", json={**base, "connection_id": conns["B"]}, timeout=30)
        assert r3.status_code in (200, 201), f"create on other connection should pass, got {r3.status_code} {r3.text[:300]}"
        t3 = r3.json()
        assert t3["connection_id"] == conns["B"]
        assert t3["id"] != t1["id"]

        # legacy payload (no connection_id) -> still blocks across connections
        r4 = s.post(f"{BASE_URL}/api/crm/tickets", json=base, timeout=30)
        assert r4.status_code == 409, f"legacy create should 409, got {r4.status_code} {r4.text[:300]}"
        assert r4.json()["detail"]["code"] == "duplicate_open_ticket"

        # force_create bypasses the guard
        r5 = s.post(f"{BASE_URL}/api/crm/tickets",
                    json={**base, "connection_id": conns["A"], "force_create": True}, timeout=30)
        assert r5.status_code in (200, 201), r5.text[:300]

    def test_unknown_connection_404(self, session_user):
        s, _ = session_user
        r = s.post(f"{BASE_URL}/api/crm/tickets", json={
            "customer_name": f"{TAG}_crm_badconn",
            "customer_phone": _new_phone(),
            "channel": "whatsapp",
            "connection_id": str(uuid.uuid4()),
        }, timeout=30)
        assert r.status_code == 404, f"{r.status_code} {r.text[:300]}"

    def test_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/crm/tickets", json={
            "customer_name": f"{TAG}_noauth", "customer_phone": _new_phone(),
        }, timeout=30)
        assert r.status_code in (401, 403), r.status_code
