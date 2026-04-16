from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from database import get_database
from auth import require_super_admin, get_password_hash
from models import (
    CompanyCreate, CompanyUpdate, CompanyResponse, CompanyStatus, ThemeColors,
    BusinessTypeCreate, BusinessTypeUpdate, PlanType, UserRole
)
from typing import List
import uuid
from datetime import datetime, timezone

router = APIRouter(prefix="/super-admin", tags=["super-admin"])

# === ALL AVAILABLE FEATURES ===
ALL_FEATURES = [
    # CRM Features
    {"feature_key": "dashboard", "label": "Dashboard", "category": "crm", "icon": "LayoutDashboard"},
    {"feature_key": "atendimentos", "label": "Atendimentos", "category": "crm", "icon": "Headphones"},
    {"feature_key": "respostas_rapidas", "label": "Respostas Rapidas", "category": "crm", "icon": "Zap"},
    {"feature_key": "kanban", "label": "Kanban", "category": "crm", "icon": "Columns3"},
    {"feature_key": "contatos", "label": "Contatos", "category": "crm", "icon": "Users"},
    {"feature_key": "tags", "label": "Tags", "category": "crm", "icon": "Tag"},
    {"feature_key": "chat_interno", "label": "Chat Interno", "category": "crm", "icon": "MessageSquare"},
    {"feature_key": "campanhas", "label": "Campanhas", "category": "crm", "icon": "Megaphone"},
    {"feature_key": "flowbuilder", "label": "Flowbuilder", "category": "crm", "icon": "GitBranch"},
    {"feature_key": "informativos", "label": "Informativos", "category": "crm", "icon": "Info"},
    {"feature_key": "api", "label": "API", "category": "crm", "icon": "Code"},
    {"feature_key": "usuarios", "label": "Usuarios", "category": "crm", "icon": "UserCog"},
    {"feature_key": "filas_chatbot", "label": "Filas & Chatbot", "category": "crm", "icon": "Bot"},
    {"feature_key": "conexoes", "label": "Conexoes WhatsApp", "category": "crm", "icon": "Link"},
    {"feature_key": "agente_ia", "label": "Agente de IA", "category": "crm", "icon": "Sparkles"},
    # Scheduling Features
    {"feature_key": "calendario", "label": "Calendario", "category": "scheduling", "icon": "Calendar"},
    {"feature_key": "agendamentos", "label": "Agendamentos", "category": "scheduling", "icon": "CalendarCheck"},
    {"feature_key": "clientes", "label": "Clientes", "category": "scheduling", "icon": "UserCheck"},
    {"feature_key": "categorias", "label": "Categorias", "category": "scheduling", "icon": "FolderOpen"},
    {"feature_key": "servicos_produtos", "label": "Servicos e Produtos", "category": "scheduling", "icon": "Scissors"},
    {"feature_key": "assinaturas", "label": "Assinaturas", "category": "scheduling", "icon": "CreditCard"},
    {"feature_key": "profissionais", "label": "Profissionais", "category": "scheduling", "icon": "Briefcase"},
    {"feature_key": "financeiro", "label": "Financeiro", "category": "scheduling", "icon": "DollarSign"},
    {"feature_key": "comissoes", "label": "Comissoes", "category": "scheduling", "icon": "PieChart"},
    {"feature_key": "meu_site", "label": "Meu Site", "category": "scheduling", "icon": "Globe"},
    {"feature_key": "notificacoes", "label": "Notificacoes", "category": "scheduling", "icon": "Bell"},
    # Shared Features
    {"feature_key": "configuracoes", "label": "Configuracoes", "category": "shared", "icon": "Settings"},
    {"feature_key": "integrações", "label": "API e Integracoes", "category": "shared", "icon": "Puzzle"},
    {"feature_key": "relatorios", "label": "Relatorios", "category": "shared", "icon": "BarChart3"},
    {"feature_key": "suporte", "label": "Suporte", "category": "shared", "icon": "LifeBuoy"},
    {"feature_key": "indoor", "label": "Indoor / TV", "category": "scheduling", "icon": "Monitor"},
]

# === FEATURES ENDPOINT ===
@router.get("/features")
async def get_all_features(user: dict = Depends(require_super_admin)):
    return ALL_FEATURES

# === DASHBOARD ===
@router.get("/dashboard")
async def get_dashboard(
    user: dict = Depends(require_super_admin),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    total_companies = await db.companies.count_documents({})
    active_companies = await db.companies.count_documents({"status": CompanyStatus.ACTIVE})
    trial_companies = await db.companies.count_documents({"status": CompanyStatus.TRIAL})
    blocked_companies = await db.companies.count_documents({"status": CompanyStatus.BLOCKED})
    crm_plans = await db.companies.count_documents({"plan_type": {"$in": ["crm", "both"]}})
    scheduling_plans = await db.companies.count_documents({"plan_type": {"$in": ["scheduling", "both"]}})
    total_business_types = await db.business_types.count_documents({"is_active": True})

    return {
        "total_companies": total_companies,
        "active_companies": active_companies,
        "trial_companies": trial_companies,
        "blocked_companies": blocked_companies,
        "crm_plans": crm_plans,
        "scheduling_plans": scheduling_plans,
        "total_business_types": total_business_types
    }

# === BUSINESS TYPES ===
@router.get("/business-types")
async def list_business_types(
    user: dict = Depends(require_super_admin),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    types = await db.business_types.find({}, {"_id": 0}).to_list(1000)
    return types

@router.get("/business-types/{type_id}")
async def get_business_type(
    type_id: str,
    user: dict = Depends(require_super_admin),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    bt = await db.business_types.find_one({"id": type_id}, {"_id": 0})
    if not bt:
        raise HTTPException(status_code=404, detail="Tipo de negocio nao encontrado")
    return bt

@router.post("/business-types")
async def create_business_type(
    data: BusinessTypeCreate,
    user: dict = Depends(require_super_admin),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    bt = {
        "id": str(uuid.uuid4()),
        "name": data.name,
        "description": data.description,
        "icon": data.icon or "Building",
        "base_type": data.base_type,
        "features": data.features,
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.business_types.insert_one(bt)
    return {k: v for k, v in bt.items() if k != "_id"}

@router.put("/business-types/{type_id}")
async def update_business_type(
    type_id: str,
    data: BusinessTypeUpdate,
    user: dict = Depends(require_super_admin),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    bt = await db.business_types.find_one({"id": type_id})
    if not bt:
        raise HTTPException(status_code=404, detail="Tipo de negocio nao encontrado")

    update_data = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if update_data:
        await db.business_types.update_one({"id": type_id}, {"$set": update_data})

    updated = await db.business_types.find_one({"id": type_id}, {"_id": 0})
    return updated

@router.delete("/business-types/{type_id}")
async def delete_business_type(
    type_id: str,
    user: dict = Depends(require_super_admin),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    result = await db.business_types.delete_one({"id": type_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Tipo de negocio nao encontrado")
    return {"message": "Tipo de negocio deletado com sucesso"}

# === COMPANIES ===
@router.get("/companies")
async def list_companies(
    user: dict = Depends(require_super_admin),
    db: AsyncIOMotorDatabase = Depends(get_database),
    status_filter: str = None,
    plan_type: str = None,
    search: str = None
):
    query = {}
    if status_filter:
        query["status"] = status_filter
    if plan_type:
        query["plan_type"] = plan_type
    if search:
        query["$or"] = [
            {"name": {"$regex": search, "$options": "i"}},
            {"email": {"$regex": search, "$options": "i"}},
            {"cnpj": {"$regex": search, "$options": "i"}}
        ]

    companies = await db.companies.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)

    # Enrich with business type names
    for company in companies:
        if company.get("business_type_id"):
            bt = await db.business_types.find_one({"id": company["business_type_id"]}, {"_id": 0})
            company["business_type_name"] = bt["name"] if bt else "Personalizado"

    return companies

@router.post("/companies")
async def create_company(
    data: CompanyCreate,
    user: dict = Depends(require_super_admin),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    # Check if admin email already exists
    existing = await db.company_users.find_one({"email": data.admin_email})
    if existing:
        raise HTTPException(status_code=400, detail="Email do administrador ja cadastrado")

    # Get business type features if provided
    features = []
    if data.business_type_id:
        bt = await db.business_types.find_one({"id": data.business_type_id})
        if bt:
            features = bt.get("features", [])

    company_id = str(uuid.uuid4())
    company = {
        "id": company_id,
        "name": data.name,
        "cnpj": data.cnpj,
        "email": data.email,
        "phone": data.phone,
        "status": CompanyStatus.ACTIVE,
        "plan_type": data.plan_type,
        "business_type_id": data.business_type_id,
        "features": features,
        "subdomain": data.subdomain,
        "theme_colors": (data.theme_colors or ThemeColors()).model_dump(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": user["id"]
    }
    await db.companies.insert_one(company)

    # Create admin user for this company
    admin_user = {
        "id": str(uuid.uuid4()),
        "company_id": company_id,
        "name": data.admin_name,
        "email": data.admin_email,
        "password": get_password_hash(data.admin_password),
        "role": UserRole.COMPANY_ADMIN,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.company_users.insert_one(admin_user)

    # Create booking page with subdomain as slug if provided
    slug = data.subdomain or data.name.lower().replace(" ", "").replace(".", "")[:20]
    booking_page = {
        "id": str(uuid.uuid4()),
        "company_id": company_id,
        "slug": slug,
        "custom_domain": data.subdomain,
        "primary_color": company["theme_colors"]["primary"],
        "secondary_color": company["theme_colors"]["secondary"],
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.booking_pages.insert_one(booking_page)

    result = {k: v for k, v in company.items() if k != "_id"}
    result["admin_email"] = data.admin_email
    return result

@router.put("/companies/{company_id}")
async def update_company(
    company_id: str,
    data: CompanyUpdate,
    user: dict = Depends(require_super_admin),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    company = await db.companies.find_one({"id": company_id})
    if not company:
        raise HTTPException(status_code=404, detail="Empresa nao encontrada")

    update_data = {}
    for k, v in data.model_dump(exclude_unset=True).items():
        if v is not None:
            if k == "theme_colors":
                update_data[k] = v.model_dump() if hasattr(v, 'model_dump') else v
            else:
                update_data[k] = v

    # If business_type_id changed, update features
    if data.business_type_id:
        bt = await db.business_types.find_one({"id": data.business_type_id})
        if bt:
            update_data["features"] = bt.get("features", [])

    if update_data:
        await db.companies.update_one({"id": company_id}, {"$set": update_data})

    # Sync subdomain with booking_pages
    if data.subdomain is not None:
        await db.booking_pages.update_one(
            {"company_id": company_id},
            {"$set": {"slug": data.subdomain, "custom_domain": data.subdomain}}
        )

    updated = await db.companies.find_one({"id": company_id}, {"_id": 0})
    return updated

@router.put("/companies/{company_id}/features")
async def update_company_features(
    company_id: str,
    features: List[dict],
    user: dict = Depends(require_super_admin),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    """Update individual company features (for custom setup)"""
    company = await db.companies.find_one({"id": company_id})
    if not company:
        raise HTTPException(status_code=404, detail="Empresa nao encontrada")

    await db.companies.update_one(
        {"id": company_id},
        {"$set": {"features": features}}
    )

    updated = await db.companies.find_one({"id": company_id}, {"_id": 0})
    return updated

@router.delete("/companies/{company_id}")
async def delete_company(
    company_id: str,
    user: dict = Depends(require_super_admin),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    company = await db.companies.find_one({"id": company_id})
    if not company:
        raise HTTPException(status_code=404, detail="Empresa nao encontrada")

    await db.companies.delete_one({"id": company_id})
    await db.company_users.delete_many({"company_id": company_id})
    await db.tickets.delete_many({"company_id": company_id})
    await db.appointments.delete_many({"company_id": company_id})
    await db.services.delete_many({"company_id": company_id})
    await db.professionals.delete_many({"company_id": company_id})
    await db.booking_pages.delete_many({"company_id": company_id})

    return {"message": "Empresa deletada com sucesso"}
