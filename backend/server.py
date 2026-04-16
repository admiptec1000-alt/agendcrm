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
from routes.whatsapp_routes import router as whatsapp_router
from routes.reports_routes import router as reports_router
from routes.notification_routes import router as notification_router

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
api_router.include_router(whatsapp_router)
api_router.include_router(reports_router)
api_router.include_router(notification_router)

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

    # Seed default business types if none exist
    bt_count = await db.business_types.count_documents({})
    if bt_count == 0:
        logger.info("Seeding default business types...")
        crm_features = [
            {"feature_key": "dashboard", "enabled": True},
            {"feature_key": "atendimentos", "enabled": True},
            {"feature_key": "respostas_rapidas", "enabled": True},
            {"feature_key": "kanban", "enabled": True},
            {"feature_key": "contatos", "enabled": True},
            {"feature_key": "tags", "enabled": True},
            {"feature_key": "chat_interno", "enabled": True},
            {"feature_key": "campanhas", "enabled": True},
            {"feature_key": "flowbuilder", "enabled": True},
            {"feature_key": "informativos", "enabled": True},
            {"feature_key": "api", "enabled": True},
            {"feature_key": "usuarios", "enabled": True},
            {"feature_key": "filas_chatbot", "enabled": True},
            {"feature_key": "conexoes", "enabled": True},
            {"feature_key": "agente_ia", "enabled": True},
            {"feature_key": "configuracoes", "enabled": True},
            {"feature_key": "relatorios", "enabled": True},
        ]
        sched_features = [
            {"feature_key": "calendario", "enabled": True},
            {"feature_key": "agendamentos", "enabled": True},
            {"feature_key": "clientes", "enabled": True},
            {"feature_key": "categorias", "enabled": True},
            {"feature_key": "servicos_produtos", "enabled": True},
            {"feature_key": "assinaturas", "enabled": True},
            {"feature_key": "profissionais", "enabled": True},
            {"feature_key": "financeiro", "enabled": True},
            {"feature_key": "comissoes", "enabled": True},
            {"feature_key": "meu_site", "enabled": True},
            {"feature_key": "notificacoes", "enabled": True},
            {"feature_key": "configuracoes", "enabled": True},
            {"feature_key": "relatorios", "enabled": True},
        ]
        default_types = [
            {
                "id": str(uuid.uuid4()),
                "name": "Salao de Beleza",
                "description": "Para saloes, barbearias e studios de beleza",
                "icon": "Scissors",
                "base_type": "scheduling",
                "features": sched_features,
                "is_active": True,
                "created_at": datetime.now(timezone.utc).isoformat()
            },
            {
                "id": str(uuid.uuid4()),
                "name": "Clinica",
                "description": "Para clinicas medicas, odontologicas e esteticas",
                "icon": "Stethoscope",
                "base_type": "scheduling",
                "features": sched_features,
                "is_active": True,
                "created_at": datetime.now(timezone.utc).isoformat()
            },
            {
                "id": str(uuid.uuid4()),
                "name": "Atendimento ao Cliente",
                "description": "CRM completo para gestao de atendimento e suporte",
                "icon": "Headphones",
                "base_type": "crm",
                "features": crm_features,
                "is_active": True,
                "created_at": datetime.now(timezone.utc).isoformat()
            },
            {
                "id": str(uuid.uuid4()),
                "name": "Completo (CRM + Agendamento)",
                "description": "Todas as funcionalidades de CRM e Agendamento",
                "icon": "LayoutGrid",
                "base_type": "both",
                "features": crm_features + sched_features,
                "is_active": True,
                "created_at": datetime.now(timezone.utc).isoformat()
            },
        ]
        await db.business_types.insert_many(default_types)
        logger.info(f"Created {len(default_types)} default business types")
    
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
