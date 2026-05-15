"""Regression tests for the "pause bot on human intervention" feature
(see /app/backend/bot_pause.py and the integration in flow_engine).

Verifies:
  - flow_engine.advance_flow short-circuits when ticket has bot_paused=True
  - is_flow_active returns False for paused tickets
  - bot_pause.pause_bot_on_ticket_if_enabled respects the per-company setting
  - The pause flag survives the operator+customer ping-pong (until the
    ticket is closed)
"""
import sys
import os
import asyncio
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import flow_engine  # noqa: E402
import bot_pause as bp  # noqa: E402


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


class _FakeColl:
    def __init__(self):
        self.docs = {}

    async def find_one(self, q, _proj=None):
        # Support both `{"id": X}` and `{"id": X, "company_id": Y}` queries.
        for d in self.docs.values():
            if all(d.get(k) == v for k, v in q.items()):
                return dict(d)
        return None

    async def update_one(self, q, ops):
        for d in self.docs.values():
            if all(d.get(k) == v for k, v in q.items()):
                if "$set" in ops:
                    d.update(ops["$set"])

                class _R:
                    matched_count = 1
                    modified_count = 1
                return _R()

        class _R:
            matched_count = 0
            modified_count = 0
        return _R()

    async def insert_one(self, doc):
        self.docs[doc.get("id")] = dict(doc)


class _FakeDB:
    def __init__(self):
        self.tickets = _FakeColl()
        self.companies = _FakeColl()
        self.flow_builders = _FakeColl()


def _seed_company(db, company_id, *, pause_enabled=True):
    _run(db.companies.insert_one({
        "id": company_id,
        "name": "Test Co",
        "pause_bot_on_human_intervention": pause_enabled,
    }))


def _seed_ticket(db, ticket_id="t1", *, with_flow=True, bot_paused=False):
    t = {
        "id": ticket_id,
        "company_id": "co-1",
        "customer_phone": "+551199999",
        "status": "aberto",
        "messages": [],
    }
    if with_flow:
        t["active_flow_id"] = "flow-1"
        t["active_flow_node_id"] = "menu-node"
    if bot_paused:
        t["bot_paused"] = True
    _run(db.tickets.insert_one(t))
    return t


def test_pause_bot_on_ticket_when_enabled():
    db = _FakeDB()
    _seed_company(db, "co-1", pause_enabled=True)
    ticket = _seed_ticket(db, with_flow=True)
    paused = _run(bp.pause_bot_on_ticket_if_enabled(db, ticket, reason="agent_message"))
    assert paused is True
    # In-memory mutation
    assert ticket["bot_paused"] is True
    assert ticket["active_flow_node_id"] is None
    # Persisted
    saved = _run(db.tickets.find_one({"id": "t1"}))
    assert saved["bot_paused"] is True
    assert saved["bot_paused_reason"] == "agent_message"
    assert saved["active_flow_node_id"] is None


def test_pause_bot_no_op_when_company_disabled():
    db = _FakeDB()
    _seed_company(db, "co-1", pause_enabled=False)
    ticket = _seed_ticket(db, with_flow=True)
    paused = _run(bp.pause_bot_on_ticket_if_enabled(db, ticket))
    assert paused is False
    saved = _run(db.tickets.find_one({"id": "t1"}))
    assert not saved.get("bot_paused")
    # Flow state intact
    assert saved["active_flow_node_id"] == "menu-node"


def test_pause_bot_no_op_when_ticket_not_in_flow():
    """Pausing a ticket that isn't running the bot is harmless but
    intentionally skipped to avoid bot_paused noise on manual tickets."""
    db = _FakeDB()
    _seed_company(db, "co-1", pause_enabled=True)
    ticket = _seed_ticket(db, with_flow=False)
    paused = _run(bp.pause_bot_on_ticket_if_enabled(db, ticket))
    assert paused is False


def test_pause_setting_default_is_on_when_field_missing():
    """Companies created BEFORE the feature shipped don't have the field
    set. The default must be ON so the rollout is safe."""
    db = _FakeDB()
    _run(db.companies.insert_one({"id": "co-x", "name": "Legacy"}))
    enabled = _run(bp.is_pause_setting_enabled(db, "co-x"))
    assert enabled is True


def test_pause_setting_default_when_projection_returns_empty_dict():
    """REGRESSION: motor's find_one with projection returns `{}` (NOT None)
    when the projected field is missing. The old guard `if not comp` would
    falsy-evaluate `{}` and wrongly return False. The fix compares against
    `comp is None` so the default ON path is taken when the field doesn't
    yet exist on the document."""

    # Simulate motor's projection behavior precisely.
    class _ProjFakeColl:
        async def find_one(self, q, _proj=None):
            # Field missing → empty dict (not None) when projected.
            return {}

    class _ProjFakeDB:
        companies = _ProjFakeColl()

    enabled = _run(bp.is_pause_setting_enabled(_ProjFakeDB(), "co-anything"))
    assert enabled is True


def test_is_flow_active_false_when_bot_paused():
    """A paused ticket must report flow inactive so the webhook stops
    invoking advance_flow on subsequent customer messages."""
    ticket = {
        "id": "t1",
        "active_flow_id": "f1",
        "active_flow_node_id": "n1",
        "bot_paused": True,
    }
    assert _run(flow_engine.is_flow_active(ticket)) is False
    # Same ticket without the pause flag -> still active.
    ticket["bot_paused"] = False
    assert _run(flow_engine.is_flow_active(ticket)) is True


def test_advance_flow_short_circuits_when_bot_paused():
    """advance_flow returns immediately with NO outgoing messages when the
    ticket is paused. This is the runtime kill-switch — even if the webhook
    wrongly calls advance, no message goes out."""
    db = _FakeDB()
    ticket = {
        "id": "t1",
        "company_id": "co-1",
        "customer_phone": "+551199999",
        "active_flow_id": "f1",
        "active_flow_node_id": "n1",
        "bot_paused": True,
    }
    flow = {
        "id": "f1",
        "nodes": [{"id": "n1", "type": "start", "data": {"nodeType": "start"}}],
        "edges": [],
    }
    out = _run(flow_engine.advance_flow(
        db, ticket, flow, incoming_text="oi", is_initial=False, dry_run=True
    ))
    assert out == []


def test_resume_bot_clears_flags():
    """After the operator closes/reopens the ticket, resume_bot_on_ticket
    clears the pause flags so a fresh flow can fire on the next inbound."""
    db = _FakeDB()
    _seed_company(db, "co-1", pause_enabled=True)
    ticket = _seed_ticket(db, with_flow=True, bot_paused=True)
    _run(bp.resume_bot_on_ticket(db, ticket["id"]))
    saved = _run(db.tickets.find_one({"id": ticket["id"]}))
    assert saved["bot_paused"] is False
    assert saved["bot_paused_at"] is None
