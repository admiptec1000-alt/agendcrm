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
from routes.ai_routes import router as ai_router
from routes.scheduling_routes import router as scheduling_router
from routes.upload_routes import router as upload_router
from routes.public_routes import router as public_router
from routes.whatsapp_routes import router as whatsapp_router
from routes.reports_routes import router as reports_router
from routes.notification_routes import router as notification_router
from routes.channels_routes import router as channels_router

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
api_router.include_router(ai_router)
api_router.include_router(scheduling_router)
api_router.include_router(upload_router)
api_router.include_router(public_router)
api_router.include_router(whatsapp_router)
api_router.include_router(reports_router)
api_router.include_router(notification_router)
api_router.include_router(channels_router)

# Include the API router in the main app
app.include_router(api_router)

# CORS middleware
cors_origins_str = os.environ.get('CORS_ORIGINS', '')
if cors_origins_str and cors_origins_str.strip() != '*':
    cors_origins = [o.strip() for o in cors_origins_str.split(',') if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_credentials=True,
        allow_origins=cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_credentials=False,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

async def seed_super_admin(db):
    """Create default super admin if not exists."""
    existing = await db.super_admins.find_one({"email": "admin@agentcrm.com"})
    if not existing:
        logger.info("Creating default super admin...")
        await db.super_admins.insert_one({
            "id": str(uuid.uuid4()),
            "name": "Super Admin",
            "email": "admin@agentcrm.com",
            "password": get_password_hash("admin123"),
            "role": "super_admin",
            "created_at": datetime.now(timezone.utc).isoformat()
        })
        logger.info("Super admin created: admin@agentcrm.com / admin123")


async def seed_business_types(db):
    """Seed default business types if none exist."""
    if await db.business_types.count_documents({}) > 0:
        return
    logger.info("Seeding default business types...")
    crm_features = [
        {"feature_key": k, "enabled": True}
        for k in ["dashboard", "atendimentos", "respostas_rapidas", "kanban", "contatos",
                   "tags", "chat_interno", "campanhas", "flowbuilder", "informativos",
                   "api", "usuarios", "filas_chatbot", "conexoes", "agente_ia",
                   "configuracoes", "relatorios", "relatorio_atendimentos"]
    ]
    sched_features = [
        {"feature_key": k, "enabled": True}
        for k in ["calendario", "agenda", "agendamentos", "clientes", "categorias", "servicos_produtos",
                   "assinaturas", "profissionais", "financeiro", "comissoes", "meu_site",
                   "conexoes", "chat_interno", "notificacoes", "configuracoes", "relatorios"]
    ]
    now = datetime.now(timezone.utc).isoformat()
    default_types = [
        {"id": str(uuid.uuid4()), "name": "Salao de Beleza", "description": "Para saloes, barbearias e studios de beleza",
         "icon": "Scissors", "base_type": "scheduling", "features": sched_features, "is_active": True, "created_at": now},
        {"id": str(uuid.uuid4()), "name": "Clinica", "description": "Para clinicas medicas, odontologicas e esteticas",
         "icon": "Stethoscope", "base_type": "scheduling", "features": sched_features, "is_active": True, "created_at": now},
        {"id": str(uuid.uuid4()), "name": "Atendimento ao Cliente", "description": "CRM completo para gestao de atendimento e suporte",
         "icon": "Headphones", "base_type": "crm", "features": crm_features, "is_active": True, "created_at": now},
        {"id": str(uuid.uuid4()), "name": "Completo (CRM + Agendamento)", "description": "Todas as funcionalidades de CRM e Agendamento",
         "icon": "LayoutGrid", "base_type": "both", "features": crm_features + sched_features, "is_active": True, "created_at": now},
    ]
    await db.business_types.insert_many(default_types)
    logger.info(f"Created {len(default_types)} default business types")


async def backfill_ticket_numbers(db):
    """Assign sequential ticket_number to tickets missing it, per company.

    Tickets existed before the sequential-number feature. Without a backfill
    the UI would show blanks for old tickets. We iterate per company ordered
    by created_at so the oldest ticket gets the smallest number.
    """
    missing = await db.tickets.count_documents({"ticket_number": {"$exists": False}})
    if missing == 0:
        return
    logger.info(f"Backfilling ticket_number for {missing} legacy tickets...")
    from counters import next_ticket_number
    company_ids = await db.tickets.distinct("company_id", {"ticket_number": {"$exists": False}})
    for cid in company_ids:
        cursor = db.tickets.find(
            {"company_id": cid, "ticket_number": {"$exists": False}},
            {"id": 1, "_id": 0}
        ).sort("created_at", 1)
        async for t in cursor:
            num = await next_ticket_number(db, cid)
            await db.tickets.update_one({"id": t["id"]}, {"$set": {"ticket_number": num}})
    logger.info("Ticket number backfill complete.")


def init_object_storage():
    """Initialize object storage connection."""
    try:
        from routes.upload_routes import init_storage
        init_storage()
        logger.info("Object storage initialized")
    except Exception as e:
        logger.warning(f"Failed to initialize storage: {e}")


async def backfill_feature_keys(db):
    """Ensure newly-added feature keys are present on existing CRM/both tenants
    and business_types. Idempotent — only adds when absent.

    We key off the presence of 'atendimentos' (the core CRM feature) rather
    than plan_type, because plan_type values vary (starter/pro/...) and
    business_types may not have base_type populated on older installs.
    """
    # Business types that already have 'atendimentos' should also have the new
    # relatorio_atendimentos feature.
    await db.business_types.update_many(
        {"features.feature_key": "atendimentos",
         "features.feature_key": {"$ne": "relatorio_atendimentos"}},
        {"$addToSet": {"features": {"feature_key": "relatorio_atendimentos", "enabled": True}}}
    )
    # Same for companies
    await db.companies.update_many(
        {"features": {"$elemMatch": {"feature_key": "atendimentos"}},
         "features.feature_key": {"$ne": "relatorio_atendimentos"}},
        {"$addToSet": {"features": {"feature_key": "relatorio_atendimentos", "enabled": True}}}
    )


async def backfill_ticket_client_links(db):
    """For tickets created before client_id existed, try to match a client
    by phone (digits-only) within the same company. Idempotent.
    """
    cursor = db.tickets.find(
        {"$or": [{"client_id": {"$exists": False}}, {"client_id": None}]},
        {"_id": 0, "id": 1, "company_id": 1, "customer_phone": 1, "customer_name": 1, "customer_email": 1}
    )
    from clients_link import find_or_create_client_by_phone
    linked = 0
    async for t in cursor:
        phone = t.get("customer_phone", "")
        if not phone:
            continue
        cid = await find_or_create_client_by_phone(
            db, t["company_id"], phone,
            name=t.get("customer_name"), email=t.get("customer_email")
        )
        if cid:
            await db.tickets.update_one({"id": t["id"]}, {"$set": {"client_id": cid}})
            linked += 1
    if linked:
        logger.info(f"Backfilled client_id on {linked} tickets")


@app.on_event("startup")
async def startup_event():
    logger.info("Starting AgentCRM & Booking System...")
    await connect_to_mongo()
    db = await get_database()
    await seed_super_admin(db)
    await seed_business_types(db)
    await backfill_ticket_numbers(db)
    await backfill_feature_keys(db)
    await backfill_ticket_client_links(db)
    init_object_storage()
    # Start WhatsApp keep-alive background loop (Render free tier wake-up)
    try:
        from wa_keepalive import start_keepalive_loop
        import asyncio
        asyncio.create_task(start_keepalive_loop())
        logger.info("WhatsApp keep-alive task started")
    except Exception as e:
        logger.warning(f"Failed to start WA keepalive: {e}")
    # Start notifications scheduler (reminders, surveys, bulk messages)
    try:
        from scheduler import start_scheduler_loop
        import asyncio
        asyncio.create_task(start_scheduler_loop())
        logger.info("Notification scheduler started")
    except Exception as e:
        logger.warning(f"Failed to start scheduler: {e}")
    logger.info("Startup complete!")

@app.on_event("shutdown")
async def shutdown_event():
    await close_mongo_connection()
    logger.info("Shutdown complete!")
