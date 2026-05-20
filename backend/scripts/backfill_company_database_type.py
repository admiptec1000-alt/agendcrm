"""Backfill `database_type` field on all existing companies.
Companies created before 2026-02-15 (F) don't have the field; they are all
native to the AgentCRM platform, so default to "Padrao"."""
import asyncio
import os
from pathlib import Path
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


async def main():
    cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = cli[os.environ["DB_NAME"]]
    res = await db.companies.update_many(
        {"$or": [{"database_type": {"$exists": False}}, {"database_type": None}]},
        {"$set": {"database_type": "Padrao"}},
    )
    print(f"Backfilled database_type=Padrao on {res.modified_count} companies")


asyncio.run(main())
