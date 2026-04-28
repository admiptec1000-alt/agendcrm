"""Atomic per-company counters for sequential IDs (tickets, invoices, etc.).

Uses MongoDB `find_one_and_update` with `$inc` and `upsert=True` so the
sequence is race-safe even under concurrent webhook bursts.
"""
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ReturnDocument


# Start tickets at 1000 so the first one is #1001 — reads better than #1.
TICKET_NUMBER_START = 1000


async def next_sequence(
    db: AsyncIOMotorDatabase,
    company_id: str,
    name: str,
    start: int = 0,
) -> int:
    """Atomically increment and return the next value in a sequence."""
    key = f"{company_id}:{name}"
    doc = await db.counters.find_one_and_update(
        {"_id": key},
        {"$inc": {"seq": 1}, "$setOnInsert": {"company_id": company_id, "name": name}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    seq = doc.get("seq", 1)
    # First call on a brand-new counter returns 1. Offset by `start` so the
    # first human-facing id is start + 1 (e.g. 1001 when start=1000).
    return start + seq


async def next_ticket_number(db: AsyncIOMotorDatabase, company_id: str) -> int:
    return await next_sequence(db, company_id, "tickets", start=TICKET_NUMBER_START)
