"""Test the ticket-auto-close scheduler tick. Uses an in-memory fake DB
to verify the cutoff logic: only tickets older than the configured
window AND with status in (aberto, em_andamento) get closed."""
import sys
import os
import asyncio
from datetime import datetime, timezone, timedelta
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scheduler import _process_ticket_auto_close  # noqa: E402


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


class _FakeCursor:
    def __init__(self, docs):
        self.docs = docs

    def __aiter__(self):
        async def gen():
            for d in self.docs:
                yield d
        return gen()

    async def to_list(self, length=None):
        return list(self.docs) if length is None else list(self.docs)[:length]


class _Coll:
    def __init__(self, docs=None):
        self.docs = docs or []
        self.updates = []  # records each update_many call

    def find(self, q, proj=None):
        # Filter supporting $gt, $lt, $in operators.
        def match(d):
            for k, v in q.items():
                if isinstance(v, dict):
                    if "$gt" in v and not (d.get(k) is not None and d.get(k) > v["$gt"]):
                        return False
                    if "$lt" in v and not (d.get(k) is not None and d.get(k) < v["$lt"]):
                        return False
                    if "$in" in v and d.get(k) not in v["$in"]:
                        return False
                elif d.get(k) != v:
                    return False
            return True
        return _FakeCursor([d for d in self.docs if match(d)])

    async def update_many(self, q, ops):
        # Apply $set to all docs that match; return an object with .modified_count.
        modified = 0
        for d in self.docs:
            ok = True
            for k, v in q.items():
                if isinstance(v, dict):
                    if "$in" in v and d.get(k) not in v["$in"]:
                        ok = False
                        break
                    if "$lt" in v and not (d.get(k) and d.get(k) < v["$lt"]):
                        ok = False
                        break
                elif d.get(k) != v:
                    ok = False
                    break
            if ok:
                d.update(ops.get("$set", {}))
                modified += 1

        class _R:
            def __init__(self, m):
                self.modified_count = m
        self.updates.append({"query": q, "ops": ops, "modified": modified})
        return _R(modified)


class _DB:
    def __init__(self, companies, tickets):
        self.companies = _Coll(companies)
        self.tickets = _Coll(tickets)


def _t(status, hours_ago):
    return {
        "id": f"t-{status}-{hours_ago}h",
        "company_id": "co-1",
        "status": status,
        "updated_at": (datetime.now(timezone.utc) - timedelta(hours=hours_ago)).isoformat(),
    }


def test_auto_close_respects_per_company_threshold():
    companies = [{"id": "co-1", "ticket_auto_close_hours": 24}]
    tickets = [
        _t("aberto", 12),       # 12h ago — not stale yet
        _t("aberto", 30),       # stale, should close
        _t("em_andamento", 48), # stale, should close
        _t("fechado", 100),     # already closed — skip
    ]
    db = _DB(companies, tickets)
    asyncio.get_event_loop().run_until_complete(_process_ticket_auto_close(db))
    closed_ids = [t["id"] for t in tickets if t["status"] == "fechado"]
    assert "t-aberto-30h" in closed_ids
    assert "t-em_andamento-48h" in closed_ids
    assert "t-aberto-12h" not in closed_ids
    # The pre-existing fechado one was not touched (still fechado, no
    # closed_reason because we DON'T overwrite it)
    pre_existing = next(t for t in tickets if t["id"] == "t-fechado-100h")
    assert pre_existing.get("closed_reason") is None


def test_auto_close_skipped_when_setting_is_zero():
    """Companies with hours=0 must never have their tickets touched."""
    companies = [{"id": "co-2", "ticket_auto_close_hours": 0}]
    tickets = [_t("aberto", 9999)]  # ancient
    tickets[0]["company_id"] = "co-2"
    db = _DB(companies, tickets)
    asyncio.get_event_loop().run_until_complete(_process_ticket_auto_close(db))
    assert tickets[0]["status"] == "aberto"


def test_auto_close_resumes_bot_flag():
    """Tickets being auto-closed must also have their bot_paused flag
    cleared so a future inbound from the same contact can re-fire the
    flow on a brand-new ticket."""
    companies = [{"id": "co-1", "ticket_auto_close_hours": 24}]
    tickets = [{
        "id": "t-1",
        "company_id": "co-1",
        "status": "aberto",
        "updated_at": (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat(),
        "bot_paused": True,
        "bot_paused_at": "2024-01-01T00:00:00+00:00",
        "bot_paused_reason": "agent_message_platform",
    }]
    db = _DB(companies, tickets)
    asyncio.get_event_loop().run_until_complete(_process_ticket_auto_close(db))
    assert tickets[0]["status"] == "fechado"
    assert tickets[0]["bot_paused"] is False
    assert tickets[0]["bot_paused_at"] is None
    assert tickets[0]["bot_paused_reason"] is None
    assert tickets[0]["closed_reason"] == "auto_timeout"
