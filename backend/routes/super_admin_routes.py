from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from database import get_database
from auth import require_super_admin, get_password_hash
from models import (
    CompanyCreate, CompanyUpdate, CompanyResponse, CompanyStatus, ThemeColors,
    BusinessTypeCreate, BusinessTypeUpdate, PlanType, UserRole
)
from pydantic import BaseModel
from typing import List, Optional
import uuid
from datetime import datetime, timezone

router = APIRouter(prefix="/super-admin", tags=["super-admin"])

# === ALL AVAILABLE FEATURES ===
ALL_FEATURES = [
    # CRM Features
    {"feature_key": "atendimentos", "label": "Atendimentos", "category": "crm", "icon": "Headphones"},
    {"feature_key": "respostas_rapidas", "label": "Respostas Rapidas", "category": "crm", "icon": "Zap"},
    {"feature_key": "kanban", "label": "Kanban", "category": "crm", "icon": "Columns3"},
    {"feature_key": "contatos", "label": "Clientes / Leads", "category": "crm", "icon": "Users"},
    {"feature_key": "tags", "label": "Tags", "category": "crm", "icon": "Tag"},
    {"feature_key": "relatorio_atendimentos", "label": "Relatorio de Atendimentos", "category": "crm", "icon": "BarChart3"},
    {"feature_key": "orcamentos", "label": "Orcamentos", "category": "crm", "icon": "FileText"},
    {"feature_key": "chat_interno", "label": "Chat Interno", "category": "crm", "icon": "MessageSquare"},
    {"feature_key": "campanhas", "label": "Campanhas", "category": "crm", "icon": "Megaphone"},
    {"feature_key": "flowbuilder", "label": "Flowbuilder", "category": "crm", "icon": "GitBranch"},
    {"feature_key": "informativos", "label": "Informativos", "category": "crm", "icon": "Info"},
    {"feature_key": "api", "label": "API", "category": "crm", "icon": "Code"},
    {"feature_key": "usuarios", "label": "Usuarios", "category": "administracao", "icon": "UserCog"},
    {"feature_key": "perfis_acesso", "label": "Perfis de Acesso", "category": "administracao", "icon": "Shield"},
    {"feature_key": "filas_chatbot", "label": "Filas & Chatbot", "category": "crm", "icon": "Bot"},
    {"feature_key": "conexoes", "label": "Conexoes", "category": "crm", "icon": "Link"},
    {"feature_key": "agente_ia", "label": "Agente IA", "category": "crm", "icon": "Sparkles"},
    # Scheduling Features
    {"feature_key": "calendario", "label": "Calendario", "category": "scheduling", "icon": "Calendar"},
    {"feature_key": "agenda", "label": "Agenda", "category": "scheduling", "icon": "CalendarCheck"},
    {"feature_key": "agendamentos", "label": "Agendamento de Mensagens", "category": "scheduling", "icon": "Clock"},
    {"feature_key": "clientes", "label": "Clientes", "category": "scheduling", "icon": "UserCheck"},
    {"feature_key": "categorias", "label": "Categorias", "category": "scheduling", "icon": "FolderOpen"},
    {"feature_key": "servicos_produtos", "label": "Servicos e Produtos", "category": "scheduling", "icon": "Scissors"},
    {"feature_key": "assinaturas", "label": "Assinaturas", "category": "scheduling", "icon": "CreditCard"},
    {"feature_key": "planos", "label": "Planos", "category": "scheduling", "icon": "Tag"},
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
        "mobile_bottom_nav": (data.mobile_bottom_nav or [])[:4],
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
    # Cap bottom nav at 4 slots (Menu button takes the 5th position)
    if "mobile_bottom_nav" in update_data:
        update_data["mobile_bottom_nav"] = (update_data["mobile_bottom_nav"] or [])[:4]
    if update_data:
        await db.business_types.update_one({"id": type_id}, {"$set": update_data})

    # Propagate features to all companies of this business type.
    # IMPORTANT: REPLACE features completely with the BT's current features.
    # Previously this code preserved company-specific keys not in BT, but that
    # caused stale features to remain (e.g. company keeps "Completo" features
    # after BT was changed to a smaller "Catalogo" set).
    if "features" in update_data:
        bt_features = update_data["features"]
        await db.companies.update_many(
            {"business_type_id": type_id},
            {"$set": {"features": list(bt_features)}}
        )
    # Propagate mobile_bottom_nav to companies of this BT so the UI picks it up
    # on next load. Companies can still override via their own setting later.
    if "mobile_bottom_nav" in update_data:
        await db.companies.update_many(
            {"business_type_id": type_id},
            {"$set": {"mobile_bottom_nav": list(update_data["mobile_bottom_nav"])}}
        )

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
    mobile_bottom_nav = []
    if data.business_type_id:
        bt = await db.business_types.find_one({"id": data.business_type_id})
        if bt:
            features = bt.get("features", [])
            mobile_bottom_nav = bt.get("mobile_bottom_nav", [])

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
        "mobile_bottom_nav": mobile_bottom_nav,
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

    # If business_type_id changed, update features and mobile bottom nav
    if data.business_type_id:
        bt = await db.business_types.find_one({"id": data.business_type_id})
        if bt:
            update_data["features"] = bt.get("features", [])
            update_data["mobile_bottom_nav"] = bt.get("mobile_bottom_nav", [])

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


@router.post("/companies/{company_id}/resync-features")
async def resync_company_features(
    company_id: str,
    user: dict = Depends(require_super_admin),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    """Force-resync the company's features list to exactly match its assigned
    business type's features. Useful when the business type was edited after
    the company was created, or when a company appears to show extra/missing
    features in the menu.
    """
    company = await db.companies.find_one({"id": company_id})
    if not company:
        raise HTTPException(status_code=404, detail="Empresa nao encontrada")
    bt_id = company.get("business_type_id")
    if not bt_id:
        raise HTTPException(
            status_code=400,
            detail="Empresa nao possui tipo de negocio. Atribua um tipo antes de sincronizar."
        )
    bt = await db.business_types.find_one({"id": bt_id}, {"_id": 0})
    if not bt:
        raise HTTPException(status_code=404, detail="Tipo de negocio da empresa nao foi encontrado")

    bt_features = bt.get("features", [])
    bt_bottom_nav = bt.get("mobile_bottom_nav", [])
    await db.companies.update_one(
        {"id": company_id},
        {"$set": {"features": bt_features, "mobile_bottom_nav": bt_bottom_nav}}
    )

    updated = await db.companies.find_one({"id": company_id}, {"_id": 0})
    return {
        "message": f"Features sincronizadas com '{bt.get('name')}'",
        "feature_count": len(bt_features),
        "company": updated,
    }

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


from pydantic import BaseModel as PydanticBaseModel

# === RESET COMPANY ADMIN PASSWORD ===
class ResetPasswordRequest(PydanticBaseModel):
    new_password: str

@router.put("/companies/{company_id}/reset-password")
async def reset_company_admin_password(
    company_id: str,
    data: ResetPasswordRequest,
    user: dict = Depends(require_super_admin),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    company = await db.companies.find_one({"id": company_id})
    if not company:
        raise HTTPException(status_code=404, detail="Empresa nao encontrada")
    
    admin_user = await db.company_users.find_one({"company_id": company_id, "role": "company_admin"})
    if not admin_user:
        raise HTTPException(status_code=404, detail="Admin da empresa nao encontrado")
    
    await db.company_users.update_one(
        {"id": admin_user["id"]},
        {"$set": {"password": get_password_hash(data.new_password)}}
    )
    return {"message": f"Senha resetada para {admin_user.get('email', 'admin')}", "email": admin_user.get("email")}


# === GLOBAL INDOOR (vídeos exibidos em TODAS as TVs indoor) ===
from pydantic import BaseModel as _BM


class GlobalIndoorUpdate(_BM):
    media_links: List[str]


@router.get("/indoor-global")
async def get_global_indoor(
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin)
):
    doc = await db.global_indoor.find_one({"_id": "settings"})
    if not doc:
        return {"media_links": []}
    return {"media_links": doc.get("media_links", [])}


@router.put("/indoor-global")
async def update_global_indoor(
    data: GlobalIndoorUpdate,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin)
):
    await db.global_indoor.update_one(
        {"_id": "settings"},
        {"$set": {"media_links": data.media_links, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )
    return {"media_links": data.media_links}


@router.get("/companies/{company_id}/indoor")
async def get_company_indoor_for_super(
    company_id: str,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin)
):
    """Super admin reads a company's indoor configuration."""
    settings = await db.indoor_settings.find_one({"company_id": company_id}, {"_id": 0})
    if not settings:
        return {"enabled": True, "slide_duration": 10, "media_links": [], "layout": "grid"}
    return settings


@router.put("/companies/{company_id}/indoor")
async def update_company_indoor_for_super(
    company_id: str,
    payload: dict,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin)
):
    """Super admin updates a company's indoor configuration directly."""
    allowed = {k: v for k, v in payload.items() if k in ("enabled", "slide_duration", "media_links", "layout")}
    existing = await db.indoor_settings.find_one({"company_id": company_id})
    if existing:
        await db.indoor_settings.update_one({"company_id": company_id}, {"$set": allowed})
    else:
        await db.indoor_settings.insert_one({
            "id": str(uuid.uuid4()),
            "company_id": company_id,
            "enabled": True,
            "slide_duration": 10,
            "media_links": [],
            "layout": "grid",
            **allowed
        })
    return await db.indoor_settings.find_one({"company_id": company_id}, {"_id": 0})



# === SUPER-ADMIN: VIEW CLIENTS OF ANY TENANT ================================
@router.get("/companies/{company_id}/clients")
async def list_company_clients(
    company_id: str,
    q: Optional[str] = None,
    limit: int = 200,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    """Read-only list of `clients` for any company in the platform. Used by
    the SuperAdmin to audit a tenant's contact base. Search by name/phone/email."""
    company = await db.companies.find_one({"id": company_id}, {"_id": 0, "name": 1})
    if not company:
        raise HTTPException(404, "Empresa nao encontrada")
    query: dict = {"company_id": company_id}
    if q:
        rx = {"$regex": q, "$options": "i"}
        query["$or"] = [{"name": rx}, {"phone": rx}, {"email": rx}]
    rows = await db.clients.find(query, {"_id": 0}).sort("created_at", -1).limit(max(1, min(1000, int(limit)))).to_list(1000)
    return {"company_name": company.get("name"), "total": len(rows), "clients": rows}


# === SUPER-ADMIN: MANUAL BILLING CLIENTS (financial only) ====================
class BillingClientIn(BaseModel):
    name: str
    licenses: int = 1
    unit_price: float = 0.0
    notes: Optional[str] = None


@router.get("/billing-clients")
async def list_billing_clients(
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    rows = await db.billing_clients.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    total_value = sum((r.get("licenses") or 0) * (r.get("unit_price") or 0.0) for r in rows)
    return {"total": len(rows), "total_value": round(total_value, 2), "items": rows}


@router.post("/billing-clients")
async def create_billing_client(
    data: BillingClientIn,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    licenses = max(0, int(data.licenses or 0))
    unit_price = max(0.0, float(data.unit_price or 0.0))
    doc = {
        "id": str(uuid.uuid4()),
        "name": data.name.strip(),
        "licenses": licenses,
        "unit_price": unit_price,
        "total_value": round(licenses * unit_price, 2),
        "notes": (data.notes or "").strip() or None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.billing_clients.insert_one(doc)
    return await db.billing_clients.find_one({"id": doc["id"]}, {"_id": 0})


@router.put("/billing-clients/{cid}")
async def update_billing_client(
    cid: str,
    data: BillingClientIn,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    licenses = max(0, int(data.licenses or 0))
    unit_price = max(0.0, float(data.unit_price or 0.0))
    update = {
        "name": data.name.strip(),
        "licenses": licenses,
        "unit_price": unit_price,
        "total_value": round(licenses * unit_price, 2),
        "notes": (data.notes or "").strip() or None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    r = await db.billing_clients.update_one({"id": cid}, {"$set": update})
    if r.matched_count == 0:
        raise HTTPException(404, "Cliente financeiro nao encontrado")
    return await db.billing_clients.find_one({"id": cid}, {"_id": 0})


@router.delete("/billing-clients/{cid}")
async def delete_billing_client(
    cid: str,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    r = await db.billing_clients.delete_one({"id": cid})
    if r.deleted_count == 0:
        raise HTTPException(404, "Cliente financeiro nao encontrado")
    return {"message": "Removido"}


# === SUPER-ADMIN: SUBSCRIPTION PLANS (with limits + duplicate) ==============
class PlanIn(BaseModel):
    name: str
    description: Optional[str] = None
    monthly_price: float = 0.0
    plan_type: PlanType = PlanType.BOTH
    max_connections: int = 1
    max_users: int = 1
    enabled_features: Optional[List[str]] = None
    is_active: bool = True


@router.get("/plans")
async def list_plans(
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    rows = await db.subscription_plans.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return rows


@router.post("/plans")
async def create_plan(
    data: PlanIn,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    doc = {
        "id": str(uuid.uuid4()),
        "name": data.name.strip(),
        "description": (data.description or "").strip() or None,
        "monthly_price": max(0.0, float(data.monthly_price or 0.0)),
        "plan_type": data.plan_type.value if hasattr(data.plan_type, "value") else str(data.plan_type),
        "max_connections": max(0, int(data.max_connections or 0)),
        "max_users": max(0, int(data.max_users or 0)),
        "enabled_features": list(data.enabled_features or []),
        "is_active": bool(data.is_active),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.subscription_plans.insert_one(doc)
    return await db.subscription_plans.find_one({"id": doc["id"]}, {"_id": 0})


@router.put("/plans/{pid}")
async def update_plan(
    pid: str,
    data: PlanIn,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    update = {
        "name": data.name.strip(),
        "description": (data.description or "").strip() or None,
        "monthly_price": max(0.0, float(data.monthly_price or 0.0)),
        "plan_type": data.plan_type.value if hasattr(data.plan_type, "value") else str(data.plan_type),
        "max_connections": max(0, int(data.max_connections or 0)),
        "max_users": max(0, int(data.max_users or 0)),
        "enabled_features": list(data.enabled_features or []),
        "is_active": bool(data.is_active),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    r = await db.subscription_plans.update_one({"id": pid}, {"$set": update})
    if r.matched_count == 0:
        raise HTTPException(404, "Plano nao encontrado")
    return await db.subscription_plans.find_one({"id": pid}, {"_id": 0})


@router.post("/plans/{pid}/duplicate")
async def duplicate_plan(
    pid: str,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    src = await db.subscription_plans.find_one({"id": pid}, {"_id": 0})
    if not src:
        raise HTTPException(404, "Plano nao encontrado")
    clone = {
        **src,
        "id": str(uuid.uuid4()),
        "name": f"{src.get('name', 'Plano')} (cópia)",
        "is_active": False,  # safer: clone starts inactive so admin can review before publishing
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    clone.pop("updated_at", None)
    clone.pop("_id", None)  # paranoia: src came from find_one with _id=0, but be safe
    await db.subscription_plans.insert_one(clone)
    return await db.subscription_plans.find_one({"id": clone["id"]}, {"_id": 0})


@router.delete("/plans/{pid}")
async def delete_plan(
    pid: str,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    in_use = await db.companies.count_documents({"plan_id": pid})
    if in_use > 0:
        raise HTTPException(409, f"Plano em uso por {in_use} empresa(s) — desative ou migre antes de deletar")
    r = await db.subscription_plans.delete_one({"id": pid})
    if r.deleted_count == 0:
        raise HTTPException(404, "Plano nao encontrado")
    return {"message": "Plano removido"}
