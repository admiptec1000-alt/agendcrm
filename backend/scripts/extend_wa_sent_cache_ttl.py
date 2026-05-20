"""Extends the expires_at of existing wa_sent_cache documents from 24h to 7d
(after the TTL bump in 2026-02-15 (G2)).

Without this, entries that were created under the 24h policy keep their
old expiry date and disappear at the original cut-off — even though the
TTL index will RESPECT whatever value is in expires_at, not the constant
in code. Documents created AFTER this script + the deploy will already
honor the new 7d TTL via routes/internal_routes.py.
"""
import asyncio
import os
from pathlib import Path
from datetime import datetime, timezone, timedelta
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


async def main():
    cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = cli[os.environ["DB_NAME"]]
    cutoff = datetime.now(timezone.utc) + timedelta(hours=24 * 7)
    res = await db.wa_sent_cache.update_many(
        {"expires_at": {"$lt": cutoff}},
        {"$set": {"expires_at": cutoff}},
    )
    print(f"Extended TTL on {res.modified_count} wa_sent_cache documents (new expiry: {cutoff.isoformat()})")


asyncio.run(main())
