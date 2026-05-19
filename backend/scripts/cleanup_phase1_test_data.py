"""One-off cleanup of test data created during Phase 1 license-feature testing."""
import asyncio
import os
from pathlib import Path
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


async def main():
    cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = cli[os.environ["DB_NAME"]]
    r1 = await db.channel_connections.delete_one({"id": "ff798eff-685a-4e91-9475-bff3a09f25f0"})
    r2 = await db.company_users.delete_one({"email": "legacypass@x.com"})
    r3 = await db.licenses.delete_many({})  # remove both test licenses
    print(f"deleted test conn: {r1.deleted_count}, test user: {r2.deleted_count}, test licenses: {r3.deleted_count}")


asyncio.run(main())
