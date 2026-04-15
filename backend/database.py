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
    client = AsyncIOMotorClient(mongo_url)
    database = client[db_name]
    print(f"Connected to MongoDB: {db_name}")

async def close_mongo_connection():
    global client
    if client:
        client.close()
        print("Closed MongoDB connection")

async def get_database() -> AsyncIOMotorDatabase:
    return database
