from fastapi import FastAPI, APIRouter
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List
import uuid
from datetime import datetime, timezone

# Import database connection functions
from database import connect_to_mongo, close_mongo_connection, get_database

# Import routes
from routes.auth_routes import router as auth_router
from routes.super_admin_routes import router as super_admin_router
from routes.crm_routes import router as crm_router
from routes.scheduling_routes import router as scheduling_router
from routes.upload_routes import router as upload_router
from routes.public_routes import router as public_router

# Import auth functions
from auth import get_password_hash

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Create the main app
app = FastAPI(title="AgentCRM & Booking System")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Health check
@api_router.get("/")
async def root():
    return {"message": "AgentCRM & Booking System API", "status": "running"}

# Include all routers
api_router.include_router(auth_router)
api_router.include_router(super_admin_router)
api_router.include_router(crm_router)
api_router.include_router(scheduling_router)
api_router.include_router(upload_router)
api_router.include_router(public_router)

# Include the API router in the main app
app.include_router(api_router)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("startup")
async def startup_event():
    logger.info("Starting AgentCRM & Booking System...")
    await connect_to_mongo()
    
    # Create super admin if not exists
    db = await get_database()
    super_admin = await db.super_admins.find_one({"email": "admin@agentcrm.com"})
    
    if not super_admin:
        logger.info("Creating default super admin...")
        super_admin_data = {
            "id": str(uuid.uuid4()),
            "name": "Super Admin",
            "email": "admin@agentcrm.com",
            "password": get_password_hash("admin123"),
            "role": "super_admin",
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await db.super_admins.insert_one(super_admin_data)
        logger.info("Super admin created: admin@agentcrm.com / admin123")
    
    # Initialize storage
    try:
        from routes.upload_routes import init_storage
        init_storage()
        logger.info("Object storage initialized")
    except Exception as e:
        logger.warning(f"Failed to initialize storage: {e}")
    
    logger.info("Startup complete!")

@app.on_event("shutdown")
async def shutdown_event():
    await close_mongo_connection()
    logger.info("Shutdown complete!")
