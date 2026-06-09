"""Regression tests for the multi-analista ticket node menu (2026-02-28).

When the operator configures the Ticket node with >= 2 options (multiple
analysts and/or an "include any" queue fallback), the bot must:
  1. Emit a numbered menu and pause on the ticket node
  2. On valid digit reply -> attribute the ticket to the chosen user
     (or to the queue when "any" was picked) and END the flow
  3. On invalid reply -> attribute the ticket to the default queue
     (status=aguardando) and END the flow (per user requirement, NO
     re-prompt)

When configured with <= 1 option, the legacy behavior is preserved:
direct routing without a menu.
"""
import sys
import asyncio
import os
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import flow_engine  # noqa: E402


class _FakeUpdateResult:
    matched_count = 1
    modified_count = 1


class _FakeCursor:
    def __init__(self, items):
        self._items = list(items)

    def __aiter__(self):
        async def _gen():
            for it in self._items:
                yield it
        return _gen()


class _FakeColl:
    def __init__(self):
        self.docs = {}

    async def find_one(self, q, _proj=None):
        return self.docs.get(q.get("id"))

    def find(self, q, _proj=None):
        # Minimal filter support: id $in + company_id eq
        ids_filter = (q.get("id") or {}).get("$in") if isinstance(q.get("id"), dict) else None
        company_id = q.get("company_id")
        items = []
        for d in self.docs.values():
            if ids_filter is not None and d.get("id") not in ids_filter:
                continue
            if company_id is not None and d.get("company_id") != company_id:
                continue
            items.append(d)
        return _FakeCursor(items)

    async def update_one(self, q, ops):
        tid = q.get("id")
        doc = self.docs.setdefault(tid, {"id": tid, "messages": []})
        if "$push" in ops:
            for k, v in ops["$push"].items():
                doc.setdefault(k, []).append(v)
        if "$set" in ops:
            doc.update(ops["$set"])
        return _FakeUpdateResult()


class _FakeDB:
    def __init__(self):
        self.tickets = _FakeColl()
        self.users = _FakeColl()
        self.sgp_configs = _FakeColl()
        self.flow_builders = _FakeColl()


@pytest.fixture(autouse=True)
def _patch_send():
    async def _noop(*a, **kw):
        return None
    flow_engine._send_whatsapp = _noop
    yield


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _seed_users(db, company_id="co1"):
    db.users.docs["u-fernando"] = {
        "id": "u-fernando", "company_id": company_id, "full_name": "Fernando Moraes",
    }
    db.users.docs["u-joao"] = {
        "id": "u-joao", "company_id": company_id, "full_name": "Joao Silva",
    }
    db.users.docs["u-maria"] = {
        "id": "u-maria", "company_id": company_id, "full_name": "Maria Costa",
    }


def _flow_with_ticket(cfg: dict):
    return {
        "id": "flow-T",
        "company_id": "co1",
        "nodes": [
            {"id": "start", "type": "flow", "data": {"nodeType": "start"}},
            {"id": "ticket", "type": "flow", "data": {"nodeType": "ticket", "config": cfg}},
        ],
        "edges": [
            {"id": "e1", "source": "start", "target": "ticket"},
        ],
    }


def _ticket():
    return {
        "id": "t1",
        "company_id": "co1",
        "customer_name": "Cliente Teste",
        "customer_phone": "5511990000000",
        "messages": [],
    }


# ── Direct routing (legacy behavior, <= 1 option) ─────────────────────────

def test_ticket_node_single_analyst_routes_direct_without_menu():
    """1 analista selecionado, sem include_any -> ticket vai direto pro user."""
    db = _FakeDB()
    _seed_users(db)
    flow = _flow_with_ticket({
        "queue_id": "q1",
        "queue_name": "GERAL",
        "assigned_user_ids": ["u-fernando"],
    })
    ticket = _ticket()
    db.tickets.docs["t1"] = ticket
    _run(flow_engine.advance_flow(db, ticket, flow, is_initial=True))
    saved = db.tickets.docs["t1"]
    assert saved["assigned_to"] == "u-fernando"
    assert saved["status"] == "atendendo"
    assert saved["queue_id"] == "q1"
    assert saved["active_flow_node_id"] is None, "flow must END (no menu paused)"


def test_ticket_node_legacy_assigned_user_id_single_still_works():
    """Retrocompat: configs antigas com `assigned_user_id` (singular)."""
    db = _FakeDB()
    _seed_users(db)
    flow = _flow_with_ticket({
        "queue_id": "q1",
        "queue_name": "GERAL",
        "assigned_user_id": "u-fernando",  # campo antigo
    })
    ticket = _ticket()
    db.tickets.docs["t1"] = ticket
    _run(flow_engine.advance_flow(db, ticket, flow, is_initial=True))
    saved = db.tickets.docs["t1"]
    assert saved["assigned_to"] == "u-fernando"
    assert saved["status"] == "atendendo"


def test_ticket_node_no_analyst_falls_to_queue():
    """Sem analistas selecionados -> cai na fila (comportamento atual)."""
    db = _FakeDB()
    _seed_users(db)
    flow = _flow_with_ticket({
        "queue_id": "q1",
        "queue_name": "GERAL",
        "status": "aguardando",
    })
    ticket = _ticket()
    db.tickets.docs["t1"] = ticket
    _run(flow_engine.advance_flow(db, ticket, flow, is_initial=True))
    saved = db.tickets.docs["t1"]
    assert saved.get("assigned_to") is None
    assert saved["status"] == "aguardando"
    assert saved["queue_id"] == "q1"


# ── Menu mode (>= 2 options) ──────────────────────────────────────────────

def test_ticket_node_two_analysts_renders_menu_and_pauses():
    db = _FakeDB()
    _seed_users(db)
    flow = _flow_with_ticket({
        "queue_id": "q1",
        "queue_name": "GERAL",
        "assigned_user_ids": ["u-fernando", "u-joao"],
        "menu_message": "Com qual atendente voce quer falar?\n{{options}}",
    })
    ticket = _ticket()
    db.tickets.docs["t1"] = ticket
    _run(flow_engine.advance_flow(db, ticket, flow, is_initial=True))
    saved = db.tickets.docs["t1"]
    # Flow should be PAUSED on the ticket node waiting for reply
    assert saved["active_flow_node_id"] == "ticket"
    # Menu text persisted
    msgs = [m.get("content") or m.get("text") for m in saved.get("messages", [])]
    assert any("Fernando Moraes" in m and "Joao Silva" in m for m in msgs), \
        f"menu missing analyst labels: {msgs}"
    assert any("[ 1 ]" in m and "[ 2 ]" in m for m in msgs)
    # No assignment yet
    assert saved.get("assigned_to") is None


def test_ticket_node_one_analyst_plus_any_renders_menu():
    db = _FakeDB()
    _seed_users(db)
    flow = _flow_with_ticket({
        "queue_id": "q1",
        "queue_name": "GERAL",
        "assigned_user_ids": ["u-fernando"],
        "include_any_option": True,
        "any_option_label": "Outro atendente",
    })
    ticket = _ticket()
    db.tickets.docs["t1"] = ticket
    _run(flow_engine.advance_flow(db, ticket, flow, is_initial=True))
    saved = db.tickets.docs["t1"]
    assert saved["active_flow_node_id"] == "ticket"
    msgs = [m.get("content") or m.get("text") for m in saved.get("messages", [])]
    assert any("Fernando Moraes" in m and "Outro atendente" in m for m in msgs)


def test_ticket_node_menu_valid_reply_assigns_user():
    db = _FakeDB()
    _seed_users(db)
    flow = _flow_with_ticket({
        "queue_id": "q1",
        "queue_name": "GERAL",
        "assigned_user_ids": ["u-fernando", "u-joao", "u-maria"],
    })
    ticket = _ticket()
    db.tickets.docs["t1"] = ticket
    _run(flow_engine.advance_flow(db, ticket, flow, is_initial=True))
    snap = dict(db.tickets.docs["t1"])
    # Customer types "2" -> should pick u-joao
    _run(flow_engine.advance_flow(db, snap, flow, incoming_text="2", is_initial=False))
    saved = db.tickets.docs["t1"]
    assert saved["assigned_to"] == "u-joao"
    assert saved["status"] == "atendendo"
    assert saved["active_flow_node_id"] is None
    # __ticket_menu_options must be wiped after resolution
    assert "__ticket_menu_options" not in (saved.get("flow_vars") or {})


def test_ticket_node_menu_any_option_picked_falls_to_queue():
    db = _FakeDB()
    _seed_users(db)
    flow = _flow_with_ticket({
        "queue_id": "q1",
        "queue_name": "GERAL",
        "assigned_user_ids": ["u-fernando"],
        "include_any_option": True,
        "any_option_label": "Qualquer Analista",
    })
    ticket = _ticket()
    db.tickets.docs["t1"] = ticket
    _run(flow_engine.advance_flow(db, ticket, flow, is_initial=True))
    snap = dict(db.tickets.docs["t1"])
    # Customer types "2" -> picks the "any" option (queue)
    _run(flow_engine.advance_flow(db, snap, flow, incoming_text="2", is_initial=False))
    saved = db.tickets.docs["t1"]
    assert saved.get("assigned_to") is None
    assert saved["status"] == "aguardando"
    assert saved["queue_id"] == "q1"


def test_ticket_node_menu_invalid_reply_falls_to_default_queue():
    """Per user requirement: opcao invalida -> cai na fila padrao
    (status=aguardando, sem assigned_to). Encerra o flow."""
    db = _FakeDB()
    _seed_users(db)
    flow = _flow_with_ticket({
        "queue_id": "q1",
        "queue_name": "GERAL",
        "assigned_user_ids": ["u-fernando", "u-joao"],
    })
    ticket = _ticket()
    db.tickets.docs["t1"] = ticket
    _run(flow_engine.advance_flow(db, ticket, flow, is_initial=True))
    snap = dict(db.tickets.docs["t1"])
    # Customer types "5" -> invalid (only 2 options)
    _run(flow_engine.advance_flow(db, snap, flow, incoming_text="5", is_initial=False))
    saved = db.tickets.docs["t1"]
    assert saved.get("assigned_to") is None
    assert saved["status"] == "aguardando"
    assert saved["active_flow_node_id"] is None
    assert saved["queue_id"] == "q1"
