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
from routes.quotes_routes import router as quotes_router
from routes.ai_routes import router as ai_router
from routes.scheduling_routes import router as scheduling_router
from routes.upload_routes import router as upload_router
from routes.public_routes import router as public_router
from routes.whatsapp_routes import router as whatsapp_router
from routes.reports_routes import router as reports_router
from routes.notification_routes import router as notification_router
from routes.channels_routes import router as channels_router
from routes.sgp_routes import router as sgp_router
from routes.sgp_gateway_routes import router as sgp_gateway_router
from routes.asaas_routes import router as asaas_router
from routes.partners_routes import router as partners_router
from routes.super_admin_finance_routes import router as super_admin_finance_router
from routes.internal_routes import router as internal_router, ensure_wa_cache_indexes
from routes.licenses_routes import router as licenses_router

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
api_router.include_router(quotes_router)
api_router.include_router(notification_router)
api_router.include_router(channels_router)
api_router.include_router(sgp_gateway_router)
api_router.include_router(sgp_router)
api_router.include_router(asaas_router)
api_router.include_router(partners_router)
api_router.include_router(super_admin_finance_router)
api_router.include_router(internal_router)
api_router.include_router(licenses_router)

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
                   "configuracoes", "relatorios", "relatorio_atendimentos", "orcamentos"]
    ]
    sched_features = [
        {"feature_key": k, "enabled": True}
        for k in ["calendario", "agenda", "agendamentos", "clientes", "categorias", "servicos_produtos",
                   "assinaturas", "profissionais", "financeiro", "comissoes", "meu_site",
                   "conexoes", "chat_interno", "notificacoes", "configuracoes", "relatorios"]
    ]
    # Super-admin niche: lets you turn each super-admin module on/off the
    # same way a tenant type does. Keys MUST match the sidebar item keys in
    # /app/frontend/src/pages/SuperAdmin/Dashboard.js so the UI can hide
    # entries based on the active super-admin's business type. Source of
    # truth for the canonical list lives in
    # `/app/backend/routes/scheduling_routes.py::SUPER_ADMIN_FEATURES` —
    # we import it here so the seed and the editor stay in sync.
    from routes.scheduling_routes import SUPER_ADMIN_FEATURES as _SA_CATALOG
    sa_features = [
        {"feature_key": f["feature_key"], "enabled": True}
        for f in _SA_CATALOG
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
        # The super-admin niche behaves like any other business type — it's
        # toggled via the same UI — but is applied to the SaaS operator's
        # own login, NOT to a tenant company. The "Tipos de Negócio" panel
        # lets you tick/untick which super-admin modules appear in the
        # sidebar (dashboard, companies, payments, …).
        {"id": str(uuid.uuid4()), "name": "Super Admin", "description": "Painel operacional do SaaS — escolha quais modulos do super-admin ficam visiveis",
         "icon": "Shield", "base_type": "super_admin", "features": sa_features, "is_active": True, "created_at": now},
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

    IMPORTANT: super_admin business_types use a completely different
    feature catalog (sidebar items for the SaaS operator's own login). We
    excluide them from every tenant-feature backfill below so the SA
    niche stays clean, and we run a dedicated repair step at the end that
    re-seeds the canonical SA feature list.
    """
    SUPER_ADMIN_EXCLUSION = {"base_type": {"$ne": "super_admin"}}
    # Companies that already have 'atendimentos' should also have the new
    # relatorio_atendimentos feature.
    await db.business_types.update_many(
        {**SUPER_ADMIN_EXCLUSION,
         "features.feature_key": "atendimentos",
         "features.feature_key": {"$ne": "relatorio_atendimentos"}},
        {"$addToSet": {"features": {"feature_key": "relatorio_atendimentos", "enabled": True}}}
    )
    # Same for companies
    await db.companies.update_many(
        {"features": {"$elemMatch": {"feature_key": "atendimentos"}},
         "features.feature_key": {"$ne": "relatorio_atendimentos"}},
        {"$addToSet": {"features": {"feature_key": "relatorio_atendimentos", "enabled": True}}}
    )
    # Quotes (orcamentos) for the same set
    await db.business_types.update_many(
        {**SUPER_ADMIN_EXCLUSION,
         "features.feature_key": "atendimentos",
         "features.feature_key": {"$ne": "orcamentos"}},
        {"$addToSet": {"features": {"feature_key": "orcamentos", "enabled": True}}}
    )
    await db.companies.update_many(
        {"features": {"$elemMatch": {"feature_key": "atendimentos"}},
         "features.feature_key": {"$ne": "orcamentos"}},
        {"$addToSet": {"features": {"feature_key": "orcamentos", "enabled": True}}}
    )
    # Backfill the unified billing fields on business_types created before
    # the Plan→BusinessType merge. Defaults to free (price 0) so admins can
    # opt-in by editing the BT in the SuperAdmin UI.
    await db.business_types.update_many(
        {"monthly_price": {"$exists": False}},
        {"$set": {
            "monthly_price": 0.0,
            "billing_cycle": "monthly",
            "installments": 1,
            "grace_days": 5,
            "max_connections": 1,
            "max_users": 1,
        }}
    )
    # Backfill show_on_landing — default OFF so previously-public BTs don't
    # leak into the landing page until the admin explicitly opts them in.
    await db.business_types.update_many(
        {"show_on_landing": {"$exists": False}},
        {"$set": {"show_on_landing": False}}
    )
    # Auto-enable the "integrações" feature on every existing BT that has
    # any other feature enabled. Without this, after the SGP/Integrations
    # work, customers' Tipo de Negócio would silently miss the new menu
    # item (since the feature was added later).
    await db.business_types.update_many(
        {
            "base_type": {"$ne": "super_admin"},
            "features": {
                "$elemMatch": {"feature_key": {"$ne": "integrações"}}
            },
            "features.feature_key": {"$ne": "integrações"},
        },
        {
            "$addToSet": {
                "features": {"feature_key": "integrações", "enabled": True}
            }
        },
    )
    await db.companies.update_many(
        {
            "features": {"$exists": True, "$ne": []},
            "features.feature_key": {"$ne": "integrações"},
        },
        {
            "$addToSet": {
                "features": {"feature_key": "integrações", "enabled": True}
            }
        },
    )
    # Add agenda_pro as a NEW feature on every BT/Company that already has the
    # legacy "agenda" feature enabled. Default ENABLED=False so admins must opt-in.
    await db.business_types.update_many(
        {
            "features.feature_key": "agenda",
            "features.feature_key": {"$ne": "agenda_pro"},
        },
        {
            "$addToSet": {
                "features": {"feature_key": "agenda_pro", "enabled": False}
            }
        },
    )
    await db.companies.update_many(
        {
            "features.feature_key": "agenda",
            "features.feature_key": {"$ne": "agenda_pro"},
        },
        {
            "$addToSet": {
                "features": {"feature_key": "agenda_pro", "enabled": False}
            }
        },
    )
    # Consolidate legacy "api" feature into "integrações". The customer-facing
    # menu is a single "API e Integrações" item — having two separate features
    # ("api" without a page + "integrações") only created a blank screen
    # for end users. Migrate-then-delete:
    #   1. Where a BT/company has `api` enabled, ensure `integrações` is enabled too.
    #   2. Pull the standalone `api` entry afterwards.
    async def _consolidate_api_feature(coll):
        async for doc in coll.find(
            {"features.feature_key": "api"},
            {"_id": 1, "features": 1},
        ):
            feats = doc.get("features") or []
            had_api_enabled = any(f.get("feature_key") == "api" and f.get("enabled") for f in feats)
            new_feats = [f for f in feats if f.get("feature_key") != "api"]
            if had_api_enabled and not any(f.get("feature_key") == "integrações" for f in new_feats):
                new_feats.append({"feature_key": "integrações", "enabled": True})
            elif had_api_enabled:
                # Already has integrações — flip it on if currently off
                for f in new_feats:
                    if f.get("feature_key") == "integrações":
                        f["enabled"] = True
            await coll.update_one({"_id": doc["_id"]}, {"$set": {"features": new_feats}})
    await _consolidate_api_feature(db.business_types)
    await _consolidate_api_feature(db.companies)

    # Idempotently seed the Super-Admin niche on existing installs that
    # were seeded before this BT existed. We only insert when no BT with
    # base_type=super_admin is present — safe to run on every startup.
    from routes.scheduling_routes import SUPER_ADMIN_FEATURES as _SA_CATALOG
    existing_sa = await db.business_types.count_documents({"base_type": "super_admin"})
    if existing_sa == 0:
        sa_feats = [
            {"feature_key": f["feature_key"], "enabled": True}
            for f in _SA_CATALOG
        ]
        await db.business_types.insert_one({
            "id": str(uuid.uuid4()),
            "name": "Super Admin",
            "description": "Painel operacional do SaaS — escolha quais modulos do super-admin ficam visiveis",
            "icon": "Shield",
            "base_type": "super_admin",
            "features": sa_feats,
            "is_active": True,
            "monthly_price": 0.0,
            "billing_cycle": "monthly",
            "installments": 1,
            "grace_days": 5,
            "show_on_landing": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info("Seeded Super Admin business type (backfill)")
    else:
        # Repair existing Super Admin BT(s):
        #   1. Strip any tenant feature_keys that leaked via earlier backfill
        #      runs (relatorio_atendimentos, orcamentos, integrações, etc.)
        #   2. Strip legacy keys that don't map to a sidebar item anymore
        #      (`payments`, `support`).
        #   3. Add any canonical sidebar key that's missing (default enabled).
        # We preserve operator choices for any key that IS in the canonical
        # catalog — only the "enabled" flag they previously set survives.
        canonical_keys = {f["feature_key"] for f in _SA_CATALOG}
        async for bt in db.business_types.find({"base_type": "super_admin"}):
            existing = bt.get("features") or []
            kept = []
            existing_keys = set()
            for f in existing:
                k = f.get("feature_key")
                if k in canonical_keys:
                    kept.append({"feature_key": k, "enabled": bool(f.get("enabled", True))})
                    existing_keys.add(k)
            # Append any canonical key missing on this BT (default enabled).
            for k in canonical_keys - existing_keys:
                kept.append({"feature_key": k, "enabled": True})
            if kept != existing:
                await db.business_types.update_one(
                    {"_id": bt["_id"]},
                    {"$set": {"features": kept}},
                )
                logger.info(
                    f"Repaired Super Admin BT features: removed "
                    f"{len(existing) - len([k for k in existing if k.get('feature_key') in canonical_keys])} "
                    f"non-canonical, added {len(canonical_keys - existing_keys)} missing"
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


SA_SYSTEM_COMPANY_ID = "_super_admin_system_"


async def _ensure_super_admin_system_company(db):
    """Idempotently create a pseudo-tenant company that owns the Super
    Admin's operational data (WhatsApp connections, atendimentos used to
    send billing reminders to client companies). 2026-02-16 (J).

    All Super Admin users have their `user.company_id` re-mapped to this
    id in `auth.get_current_user`, so the existing tenant routes work
    uniformly without role-aware branching.
    """
    existing = await db.companies.find_one(
        {"id": SA_SYSTEM_COMPANY_ID}, {"_id": 0, "id": 1}
    )
    if existing:
        return
    from datetime import datetime, timezone
    await db.companies.insert_one({
        "id": SA_SYSTEM_COMPANY_ID,
        "name": "Super Admin (Sistema)",
        "cnpj": "",
        "email": "system@noreply-agentcrm.com",
        "phone": "",
        "status": "active",
        "plan_type": "both",
        "business_type_id": None,
        "is_super_admin_system": True,
        "features": [],
        "mobile_bottom_nav": [],
        "subdomain": "_super_admin_system_",
        "max_connections": None,
        "max_users": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    logger.info(f"Seeded Super Admin system company id={SA_SYSTEM_COMPANY_ID}")


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
    await _ensure_super_admin_system_company(db)
    init_object_storage()
    await ensure_wa_cache_indexes(db)
    # 2026-05-27 — Indices criticos para listagem de tickets / Kanban.
    # Sem isso, GET /api/crm/tickets?status=aguardando e /api/crm/kanban-v2
    # fazem COLLSCAN com 1k+ docs (~3s na empresa Web em prod).
    try:
        await db.tickets.create_index(
            [("company_id", 1), ("status", 1), ("updated_at", -1)],
            name="company_status_updated",
            background=True,
        )
        await db.tickets.create_index(
            [("company_id", 1), ("assigned_to", 1), ("status", 1)],
            name="company_assignedto_status",
            background=True,
        )
        await db.tickets.create_index(
            [("company_id", 1), ("kanban_column_id", 1), ("updated_at", -1)],
            name="company_kanban_updated",
            background=True,
        )
        await db.tickets.create_index(
            [("company_id", 1), ("customer_phone", 1)],
            name="company_phone",
            background=True,
        )
        await db.tickets.create_index(
            [("company_id", 1), ("queue_id", 1), ("status", 1)],
            name="company_queue_status",
            background=True,
        )
        await db.tickets.create_index(
            [("company_id", 1), ("connection_id", 1), ("status", 1)],
            name="company_connection_status",
            background=True,
        )
        # Histograma de mensagens raramente eh necessario na listagem; o
        # projection `messages: 0` ja basta. Index extra nao ajuda.
        logger.info("[startup] tickets indexes ensured")
    except Exception as e:
        logger.warning(f"[startup] failed to ensure tickets indexes: {e}")
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
