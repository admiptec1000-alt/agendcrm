from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
import os
from dotenv import load_dotenv

load_dotenv()

mongo_url = os.environ['MONGO_URL']
db_name = os.environ['DB_NAME']

client: AsyncIOMotorClient = None
database: AsyncIOMotorDatabase = None

async def connect_to_mongo():
    global client, database
    # 2026-02-28 — Critical fix: produção travava a cada ~20h porque o
    # Motor pool sem keepalive deixava conexoes idle morrerem (default
    # MongoDB 30min idle) e nao detectava ate o proximo query, que
    # entao pendurava por serverSelectionTimeoutMS (default 30s).
    # Como o scheduler chama process_bulk_tick e _send_whatsapp serial,
    # 1 query pendurada congelava o tick inteiro -> atendimento + flow
    # paravam simultaneamente. Fix: pool config explicito + maxIdleTimeMS
    # menor que o timeout do server + fail-fast.
    client = AsyncIOMotorClient(
        mongo_url,
        maxPoolSize=50,
        minPoolSize=10,
        serverSelectionTimeoutMS=5000,
        socketTimeoutMS=20000,
        connectTimeoutMS=10000,
        maxIdleTimeMS=45000,
        retryWrites=True,
    )
    database = client[db_name]
    print(f"Connected to MongoDB: {db_name}")

async def close_mongo_connection():
    global client
    if client:
        client.close()
        print("Closed MongoDB connection")

async def get_database() -> AsyncIOMotorDatabase:
    return database
