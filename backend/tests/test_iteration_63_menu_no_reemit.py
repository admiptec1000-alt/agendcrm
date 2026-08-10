"""Iteration 63 — WhatsApp bot must NOT re-emit menu on invalid reply.

Root cause (2026-08-06): WhatsApp Business auto-away replies on the customer
side were triggering our invalid-input handler on menu nodes, which
RE-EMITTED the menu text. Combined with the auto-replier this produced an
infinite loop of the same "Escolha uma opcao" menu being sent every ~20min.

New rule: on invalid menu reply we STAY SILENT — no menu re-emit. We still
count reprompts and pause the bot after 3 consecutive invalid replies
(safeguard against endless auto-repliers).

The capture_format re-prompt path (real customer input like CPF) is
INTENTIONALLY unchanged since that's a legitimate active interaction.

Tests exercise flow_engine.advance_flow directly using an in-memory fake DB
(same pattern as test_flow_engine_ticket_menu.py). _send_whatsapp is patched
to a no-op so we do not hit WhatsApp.
"""
import sys
import os
import asyncio
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import flow_engine  # noqa: E402


# ── Fake persistence layer (identical shape to prod) ─────────────────
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

    async def insert_one(self, doc):
        self.docs[doc.get("id") or f"auto_{len(self.docs)}"] = doc
        return _FakeUpdateResult()

    async def update_many(self, q, ops):
        return _FakeUpdateResult()


class _FakeDB:
    def __init__(self):
        self.tickets = _FakeColl()
        self.flow_send_log = _FakeColl()


@pytest.fixture(autouse=True)
def _patch_send(monkeypatch):
    async def _noop(*a, **kw):
        return None
    monkeypatch.setattr(flow_engine, "_send_whatsapp", _noop)


def _run(coro):
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            raise RuntimeError
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


# ── Flow / ticket builders ───────────────────────────────────────────
def _static_menu_flow():
    """start -> menu(opts=1,2) -> next(message)."""
    return {
        "id": "flow-static",
        "company_id": "co1",
        "nodes": [
            {"id": "start", "type": "flow", "data": {"nodeType": "start"}},
            {"id": "menu1", "type": "flow", "data": {"nodeType": "menu", "config": {
                "text": "Escolha uma opcao:",
                "options": [
                    {"key": "1", "label": "Suporte"},
                    {"key": "2", "label": "Financeiro"},
                ],
                "no_back": True,
            }}},
            {"id": "n_after", "type": "flow", "data": {"nodeType": "message", "config": {
                "text": "Voce escolheu opcao 1"
            }}},
        ],
        "edges": [
            {"id": "e1", "source": "start", "target": "menu1"},
            {"id": "e2", "source": "menu1", "sourceHandle": "option-0", "target": "n_after"},
        ],
    }


def _dynamic_menu_flow():
    """menu with dynamic_source=contracts. Items pre-populated in flow_vars."""
    return {
        "id": "flow-dyn",
        "company_id": "co1",
        "nodes": [
            {"id": "start", "type": "flow", "data": {"nodeType": "start"}},
            {"id": "menuD", "type": "flow", "data": {"nodeType": "menu", "config": {
                "text": "Selecione o contrato:",
                "dynamic_source": "contracts",
                "capture_var": "contrato_id",
                "no_back": True,
            }}},
            {"id": "n_ok", "type": "flow", "data": {"nodeType": "message", "config": {
                "text": "Contrato selecionado"
            }}},
        ],
        "edges": [
            {"id": "e1", "source": "start", "target": "menuD"},
            {"id": "e2", "source": "menuD", "sourceHandle": "option-default", "target": "n_ok"},
        ],
    }


def _capture_flow():
    """message node asking for CPF (capture_format='cpf')."""
    return {
        "id": "flow-cap",
        "company_id": "co1",
        "nodes": [
            {"id": "start", "type": "flow", "data": {"nodeType": "start"}},
            {"id": "askcpf", "type": "flow", "data": {"nodeType": "message", "config": {
                "text": "Envie seu CPF por favor.",
                "capture_var": "cpf",
                "capture_format": "cpf",
                "capture_invalid_message": "CPF invalido, tente novamente.",
            }}},
            {"id": "done", "type": "flow", "data": {"nodeType": "message", "config": {
                "text": "Obrigado"
            }}},
        ],
        "edges": [
            {"id": "e1", "source": "start", "target": "askcpf"},
            {"id": "e2", "source": "askcpf", "target": "done"},
        ],
    }


def _paused_ticket(db, node_id, flow_id, extra_vars=None):
    tid = "t1"
    doc = {
        "id": tid,
        "company_id": "co1",
        "customer_name": "Cliente Teste",
        "customer_phone": "5511990000001",
        "active_flow_id": flow_id,
        "active_flow_node_id": node_id,
        "flow_vars": dict(extra_vars or {}),
        "messages": [],
        "tags": [],
    }
    db.tickets.docs[tid] = doc
    return doc


# ── Static menu tests ────────────────────────────────────────────────
def test_static_menu_invalid_reply_does_not_reemit():
    db = _FakeDB()
    flow = _static_menu_flow()
    ticket = _paused_ticket(db, "menu1", flow["id"])

    sent = _run(flow_engine.advance_flow(
        db, ticket, flow, incoming_text="estou fora agora", is_initial=False
    ))

    # (a) No new outbound
    assert sent == [], f"Expected no re-emit, but got: {sent!r}"

    saved = db.tickets.docs["t1"]
    fv = saved.get("flow_vars") or {}
    # (b) counter=1
    assert fv.get("_reprompt_count__menu1") == 1
    # (c) still paused at same node
    assert saved.get("active_flow_node_id") == "menu1"
    # (d) bot_paused stays False
    assert not saved.get("bot_paused")
    # (e) no bot messages appended (only the counter update)
    assert saved.get("messages", []) == []


def test_static_menu_pauses_after_three_invalid_replies_without_reemit():
    db = _FakeDB()
    flow = _static_menu_flow()
    ticket = _paused_ticket(db, "menu1", flow["id"])

    for attempt in range(1, 4):
        # Refresh doc from db (mirroring how the webhook re-reads the ticket)
        current = db.tickets.docs["t1"]
        sent = _run(flow_engine.advance_flow(
            db, current, flow, incoming_text=f"junk {attempt}", is_initial=False
        ))
        assert sent == [], f"Attempt {attempt}: unexpected re-emit {sent!r}"

    saved = db.tickets.docs["t1"]
    assert saved.get("bot_paused") is True, "bot should be paused after 3 invalid replies"
    assert saved.get("bot_paused_reason") == "auto_replier_loop"
    assert "auto-resposta-detectada" in (saved.get("tags") or [])
    # No bot messages EVER pushed (no re-emit even on the pausing attempt)
    assert saved.get("messages", []) == []


def test_static_menu_valid_reply_advances_without_reemit():
    db = _FakeDB()
    flow = _static_menu_flow()
    ticket = _paused_ticket(db, "menu1", flow["id"])

    sent = _run(flow_engine.advance_flow(
        db, ticket, flow, incoming_text="1", is_initial=False
    ))

    # Should advance to n_after and emit its text ONCE — never re-emit menu prompt
    joined = " || ".join(sent)
    assert "Voce escolheu opcao 1" in joined, f"Expected advance emission; got {sent!r}"
    assert "Escolha uma opcao" not in joined, "Menu prompt must NOT be re-emitted on valid reply"

    saved = db.tickets.docs["t1"]
    fv = saved.get("flow_vars") or {}
    # reprompt counter cleared on success
    assert "_reprompt_count__menu1" not in fv


# ── Dynamic menu tests ───────────────────────────────────────────────
def test_dynamic_menu_invalid_reply_does_not_reemit():
    db = _FakeDB()
    flow = _dynamic_menu_flow()
    dyn = [
        {"value": "C1", "label": "Contrato 1"},
        {"value": "C2", "label": "Contrato 2"},
    ]
    ticket = _paused_ticket(db, "menuD", flow["id"], extra_vars={"contracts": dyn})

    sent = _run(flow_engine.advance_flow(
        db, ticket, flow, incoming_text="mensagem automatica", is_initial=False
    ))
    assert sent == [], f"Expected no re-emit, got {sent!r}"

    saved = db.tickets.docs["t1"]
    fv = saved.get("flow_vars") or {}
    assert fv.get("_reprompt_count__menuD") == 1
    assert saved.get("active_flow_node_id") == "menuD"
    assert not saved.get("bot_paused")


def test_dynamic_menu_pauses_after_three_invalid_replies():
    db = _FakeDB()
    flow = _dynamic_menu_flow()
    dyn = [
        {"value": "C1", "label": "Contrato 1"},
        {"value": "C2", "label": "Contrato 2"},
    ]
    ticket = _paused_ticket(db, "menuD", flow["id"], extra_vars={"contracts": dyn})

    for i in range(3):
        current = db.tickets.docs["t1"]
        sent = _run(flow_engine.advance_flow(
            db, current, flow, incoming_text=f"junk {i}", is_initial=False
        ))
        assert sent == []

    saved = db.tickets.docs["t1"]
    assert saved.get("bot_paused") is True
    assert "auto-resposta-detectada" in (saved.get("tags") or [])


def test_dynamic_menu_valid_reply_advances():
    db = _FakeDB()
    flow = _dynamic_menu_flow()
    dyn = [
        {"value": "C1", "label": "Contrato 1"},
        {"value": "C2", "label": "Contrato 2"},
    ]
    ticket = _paused_ticket(db, "menuD", flow["id"], extra_vars={"contracts": dyn})

    # Client types "1" (1-based) — should pick C1 and advance
    sent = _run(flow_engine.advance_flow(
        db, ticket, flow, incoming_text="1", is_initial=False
    ))
    joined = " || ".join(sent)
    assert "Contrato selecionado" in joined, f"Expected advance emission; got {sent!r}"
    assert "Selecione o contrato" not in joined, "Dynamic menu prompt must NOT be re-emitted"

    saved = db.tickets.docs["t1"]
    fv = saved.get("flow_vars") or {}
    assert fv.get("contrato_id") == "C1"


# ── capture_format re-prompt path MUST remain unchanged ──────────────
def test_capture_format_invalid_still_reemits_prompt_and_error():
    """CPF validator has its own re-prompt cycle — DO NOT regress it."""
    db = _FakeDB()
    flow = _capture_flow()
    ticket = _paused_ticket(db, "askcpf", flow["id"])

    sent = _run(flow_engine.advance_flow(
        db, ticket, flow, incoming_text="oi", is_initial=False
    ))

    joined = " || ".join(sent)
    # Both: error message AND prompt re-emit
    assert "CPF invalido" in joined, f"Expected invalid-CPF error emission; got {sent!r}"
    assert "Envie seu CPF" in joined, f"Expected prompt re-emit; got {sent!r}"

    saved = db.tickets.docs["t1"]
    # Stays at same node; capture_var NOT set
    assert saved.get("active_flow_node_id") == "askcpf"
    fv = saved.get("flow_vars") or {}
    assert "cpf" not in fv
