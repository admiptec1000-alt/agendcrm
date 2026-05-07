"""Regression tests for /app/backend/flow_engine.py — the WhatsApp flowbuilder
runtime that walks the flow graph, sends node messages and persists state on
the ticket so subsequent customer replies advance the flow.

These tests use an in-memory FakeDB to avoid Mongo dependency.
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


class _FakeColl:
    def __init__(self):
        self.docs = {}

    async def find_one(self, q, _proj=None):
        return self.docs.get(q.get("id"))

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
        self.sgp_configs = _FakeColl()
        self.flow_builders = _FakeColl()


def _flow_with_menu():
    return {
        "id": "flow-A",
        "company_id": "co1",
        "nodes": [
            {"id": "start", "type": "flow", "data": {"nodeType": "start", "label": "Inicio"}},
            {"id": "welcome", "type": "flow", "data": {"nodeType": "message", "config": {"text": "Olá {{nome}}!"}}},
            {"id": "menu", "type": "flow", "data": {"nodeType": "menu", "config": {
                "text": "Escolha:",
                "options": [{"label": "Ver planos", "key": "1"}, {"label": "Suporte", "key": "2"}],
            }}},
            {"id": "planos", "type": "flow", "data": {"nodeType": "message", "config": {"text": "Plano A"}}},
            {"id": "support", "type": "flow", "data": {"nodeType": "ticket", "config": {"queue": "Suporte"}}},
        ],
        "edges": [
            {"id": "e1", "source": "start", "target": "welcome"},
            {"id": "e2", "source": "welcome", "target": "menu"},
            {"id": "e3", "source": "menu", "target": "planos", "sourceHandle": "option-0"},
            {"id": "e4", "source": "menu", "target": "support", "sourceHandle": "option-1"},
        ],
    }


def _ticket():
    return {
        "id": "t1",
        "company_id": "co1",
        "customer_name": "Joao",
        "customer_phone": "5511990000000",
        "messages": [],
    }


@pytest.fixture(autouse=True)
def _patch_send():
    async def _noop(*a, **kw): pass
    flow_engine._send_whatsapp = _noop
    yield


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_initial_trigger_sends_welcome_and_menu_then_waits():
    """Bug repro: previously the OLD `_trigger_flow_for_ticket` mock used
    `data.label` as fallback text, sending only "Inicio" and stopping. The
    new engine must skip the start node, send welcome + menu, and persist
    `active_flow_node_id=menu`."""
    db = _FakeDB()
    flow = _flow_with_menu()
    ticket = _ticket()
    db.tickets.docs["t1"] = ticket

    sent = _run(flow_engine.advance_flow(db, ticket, flow, is_initial=True))
    saved = db.tickets.docs["t1"]
    msgs = [m["content"] for m in saved.get("messages", [])]

    assert len(sent) == 2, f"expected 2 outgoing messages, got {sent}"
    assert "Olá Joao!" in msgs[0]
    assert "Escolha:" in msgs[1] and "1. Ver planos" in msgs[1]
    assert saved["active_flow_id"] == "flow-A"
    assert saved["active_flow_node_id"] == "menu"
    # The label "Inicio" must NEVER be sent
    assert not any("Inicio" in m for m in msgs)


def test_menu_reply_advances_to_branch_and_ends_flow():
    db = _FakeDB()
    flow = _flow_with_menu()
    ticket = _ticket()
    db.tickets.docs["t1"] = ticket
    _run(flow_engine.advance_flow(db, ticket, flow, is_initial=True))

    snap = dict(db.tickets.docs["t1"])
    sent = _run(flow_engine.advance_flow(db, snap, flow, incoming_text="1", is_initial=False))
    saved = db.tickets.docs["t1"]

    assert sent == ["Plano A"]
    assert saved["active_flow_id"] is None
    assert saved["active_flow_node_id"] is None


def test_menu_invalid_reply_reprompts_without_advancing():
    db = _FakeDB()
    flow = _flow_with_menu()
    ticket = _ticket()
    db.tickets.docs["t1"] = ticket
    _run(flow_engine.advance_flow(db, ticket, flow, is_initial=True))

    snap = dict(db.tickets.docs["t1"])
    sent = _run(flow_engine.advance_flow(db, snap, flow, incoming_text="banana", is_initial=False))
    saved = db.tickets.docs["t1"]

    assert len(sent) == 1 and "Escolha" in sent[0]
    # Still pending on the menu
    assert saved["active_flow_node_id"] == "menu"


def test_ticket_node_clears_flow_state():
    db = _FakeDB()
    flow = _flow_with_menu()
    ticket = _ticket()
    db.tickets.docs["t1"] = ticket
    _run(flow_engine.advance_flow(db, ticket, flow, is_initial=True))

    snap = dict(db.tickets.docs["t1"])
    _run(flow_engine.advance_flow(db, snap, flow, incoming_text="2", is_initial=False))
    saved = db.tickets.docs["t1"]
    assert saved["active_flow_id"] is None
    assert saved.get("queue") == "Suporte"


def test_dry_run_does_not_persist():
    db = _FakeDB()
    flow = _flow_with_menu()
    ticket = _ticket()
    db.tickets.docs["t1"] = ticket
    sent = _run(flow_engine.advance_flow(db, ticket, flow, is_initial=True, dry_run=True))
    saved = db.tickets.docs["t1"]
    # Messages predicted but no agent message persisted
    assert len(sent) == 2
    assert saved.get("messages") == []
    assert "active_flow_node_id" not in saved


def test_orphan_active_node_clears_state_safely():
    """If the saved active_flow_node_id no longer exists in the flow (e.g.
    user edited the flow and removed that node), engine must NOT crash and
    must clear the stale state."""
    db = _FakeDB()
    flow = _flow_with_menu()
    ticket = _ticket()
    ticket["active_flow_id"] = "flow-A"
    ticket["active_flow_node_id"] = "ghost"
    db.tickets.docs["t1"] = ticket
    sent = _run(flow_engine.advance_flow(db, ticket, flow, incoming_text="1", is_initial=False))
    saved = db.tickets.docs["t1"]
    assert sent == []
    assert saved["active_flow_id"] is None
    assert saved["active_flow_node_id"] is None


def test_start_node_with_text_data_is_still_skipped():
    """Defensive: even if a buggy flow has TEXT inside the start node's
    config, the engine must NOT emit it — start is a passthrough."""
    db = _FakeDB()
    flow = _flow_with_menu()
    flow["nodes"][0]["data"]["config"] = {"text": "INICIO TEXT"}
    ticket = _ticket()
    db.tickets.docs["t1"] = ticket
    sent = _run(flow_engine.advance_flow(db, ticket, flow, is_initial=True))
    assert "INICIO TEXT" not in "|".join(sent)
    assert "Olá Joao!" in sent[0]


def _flow_with_capture_and_sgp():
    """Mimics the WEB Internet 100% Fibra flow: ask CPF (message + capture_var)
    → SGP HTTP → menu using {{nome_cliente}}.
    The engine must PAUSE on `ask_cpf` waiting for the customer reply, not
    rush through to the SGP call with an empty CPF."""
    return {
        "id": "flow-cap",
        "company_id": "co1",
        "nodes": [
            {"id": "start", "data": {"nodeType": "start"}},
            {"id": "ask_cpf", "data": {"nodeType": "message", "config": {
                "text": "Informe o CPF do titular do plano:",
                "capture_var": "cpf_cliente",
            }}},
            {"id": "sgp_consulta", "data": {"nodeType": "http", "config": {
                "url": "{{API_URL}}/api/sgp/consultacliente",
                "body": {"params": {"cpfcnpj": "{{cpf_cliente}}"}},
            }}},
            {"id": "found_menu", "data": {"nodeType": "menu", "config": {
                "text": "Pronto, {{nome_cliente}}! Como posso ajudar?",
                "options": [{"label": "Boleto", "key": "1"}],
            }}},
        ],
        "edges": [
            {"id": "e1", "source": "start", "target": "ask_cpf"},
            {"id": "e2", "source": "ask_cpf", "target": "sgp_consulta"},
            {"id": "e3", "source": "sgp_consulta", "target": "found_menu"},
        ],
    }


def test_message_with_capture_var_pauses_for_input(monkeypatch):
    """Bug repro from production (WEB Internet 100% Fibra):
    The engine was sending the 'Informe o CPF' prompt and then IMMEDIATELY
    calling the SGP API with an empty {{cpf_cliente}} placeholder, getting
    `{"contratos":[]}` back, and then sending 'Cliente não encontrado'
    BEFORE the customer had a chance to type the CPF. Fix: nodes of type
    `message` with `capture_var` must pause execution like menu nodes do."""
    db = _FakeDB()
    flow = _flow_with_capture_and_sgp()
    ticket = _ticket()
    db.tickets.docs["t1"] = ticket

    # If the engine wrongly advances past `ask_cpf` it would call SGP, so
    # patch _execute_http_node to flag any unexpected call.
    called = {"sgp": 0}

    async def _fake_http(node, vars_, company_id):
        called["sgp"] += 1
        return {"cliente_encontrado": False}
    monkeypatch.setattr(flow_engine, "_execute_http_node", _fake_http)

    sent = _run(flow_engine.advance_flow(db, ticket, flow, is_initial=True))

    saved = db.tickets.docs["t1"]
    # SGP must NOT have been called
    assert called["sgp"] == 0, "SGP was called before customer input — engine didn't pause!"
    # Only the 'ask CPF' message should have been emitted
    assert sent == ["Informe o CPF do titular do plano:"]
    # State must be paused on `ask_cpf`
    assert saved["active_flow_node_id"] == "ask_cpf"
    assert saved["active_flow_id"] == "flow-cap"


def test_capture_var_then_resume_continues_to_sgp(monkeypatch):
    """After customer replies with CPF, engine resumes, captures the value,
    and runs the SGP call + downstream menu with the resolved name."""
    db = _FakeDB()
    flow = _flow_with_capture_and_sgp()
    ticket = _ticket()
    db.tickets.docs["t1"] = ticket
    _run(flow_engine.advance_flow(db, ticket, flow, is_initial=True))

    sgp_seen = {"cpf": None}

    async def _fake_http(node, vars_, company_id):
        sgp_seen["cpf"] = vars_.get("cpf_cliente")
        return {"cliente_encontrado": True, "nome_cliente": "JOSE DA SILVA"}
    monkeypatch.setattr(flow_engine, "_execute_http_node", _fake_http)

    snap = dict(db.tickets.docs["t1"])
    sent = _run(flow_engine.advance_flow(db, snap, flow, incoming_text="016.570.219-20", is_initial=False))
    saved = db.tickets.docs["t1"]

    # CPF was captured into vars (raw — sanitization happens inside HTTP node)
    assert sgp_seen["cpf"] == "016.570.219-20"
    # Menu was emitted with resolved name
    assert any("Pronto, JOSE DA SILVA!" in m for m in sent)
    assert saved["active_flow_node_id"] == "found_menu"


def test_critical_placeholder_missing_emits_friendly_fallback():
    """If a downstream message node references {{nome_cliente}} but the var
    is empty (SGP returned no match), the engine must NOT send the broken
    'Pronto, !' message — it must emit the user-facing fallback instead."""
    db = _FakeDB()
    flow = _flow_with_capture_and_sgp()
    ticket = _ticket()
    ticket["active_flow_id"] = "flow-cap"
    ticket["active_flow_node_id"] = "ask_cpf"
    db.tickets.docs["t1"] = ticket

    async def _fake_http(node, vars_, company_id):
        # SGP returned no match
        return {"cliente_encontrado": False, "nome_cliente": ""}
    flow_engine._execute_http_node = _fake_http

    sent = _run(flow_engine.advance_flow(db, ticket, flow, incoming_text="00000000000", is_initial=False))
    assert any("nao encontrado" in m.lower() or "verifique" in m.lower() for m in sent), sent
    saved = db.tickets.docs["t1"]
    assert saved["active_flow_id"] is None  # flow ended
