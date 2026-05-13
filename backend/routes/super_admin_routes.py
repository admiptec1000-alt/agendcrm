from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from database import get_database
from auth import require_super_admin, get_password_hash, create_access_token
from models import (
    CompanyCreate, CompanyUpdate, CompanyResponse, CompanyStatus, ThemeColors,
    BusinessTypeCreate, BusinessTypeUpdate, PlanType, UserRole
)
from pydantic import BaseModel
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta

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
    {"feature_key": "sgp_gateway", "label": "SGP Gateway", "category": "crm", "icon": "PlugZap"},
    {"feature_key": "informativos", "label": "Informativos", "category": "crm", "icon": "Info"},
    # NOTE: legacy "api" feature merged into "integrações" — single menu
    # "API e Integrações" handles both API explorer and 3rd-party integrations
    # (SGP, Asaas, etc). Keeping a stub here is unnecessary.
    {"feature_key": "usuarios", "label": "Usuarios", "category": "administracao", "icon": "UserCog"},
    {"feature_key": "perfis_acesso", "label": "Perfis de Acesso", "category": "administracao", "icon": "Shield"},
    {"feature_key": "filas_chatbot", "label": "Filas & Chatbot", "category": "crm", "icon": "Bot"},
    {"feature_key": "conexoes", "label": "Conexoes", "category": "crm", "icon": "Link"},
    {"feature_key": "agente_ia", "label": "Agente IA", "category": "crm", "icon": "Sparkles"},
    # Scheduling Features
    {"feature_key": "calendario", "label": "Calendario", "category": "scheduling", "icon": "Calendar"},
    {"feature_key": "agenda", "label": "Agenda", "category": "scheduling", "icon": "CalendarCheck"},
    {"feature_key": "agenda_pro", "label": "Agenda Pro", "category": "scheduling", "icon": "CalendarDays"},
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
    {"feature_key": "integrações", "label": "API e Integrações", "category": "shared", "icon": "Puzzle"},
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
        "default_screen": (data.default_screen or "").strip() or None,
        "monthly_price": max(0.0, float(data.monthly_price or 0.0)),
        "billing_cycle": (data.billing_cycle or "monthly").lower(),
        "installments": max(1, int(data.installments or 1)),
        "grace_days": max(0, int(data.grace_days or 5)),
        "max_connections": max(0, int(data.max_connections or 1)),
        "max_users": max(0, int(data.max_users or 1)),
        "show_on_landing": bool(data.show_on_landing),
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.business_types.insert_one(bt)
    return {k: v for k, v in bt.items() if k != "_id"}


@router.post("/business-types/{type_id}/duplicate")
async def duplicate_business_type(
    type_id: str,
    user: dict = Depends(require_super_admin),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    """Clone a BusinessType (features + billing config) under a new name.
    The clone starts with `is_active=True` and `show_on_landing=False` so the
    SuperAdmin can review/edit before exposing it publicly."""
    src = await db.business_types.find_one({"id": type_id}, {"_id": 0})
    if not src:
        raise HTTPException(status_code=404, detail="Tipo de negocio nao encontrado")
    clone = {
        **src,
        "id": str(uuid.uuid4()),
        "name": f"{src.get('name', 'Tipo')} (cópia)",
        "show_on_landing": False,
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    clone.pop("updated_at", None)
    clone.pop("_id", None)
    await db.business_types.insert_one(clone)
    return await db.business_types.find_one({"id": clone["id"]}, {"_id": 0})

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
    # Normalize empty default_screen → null (means "use legacy default")
    if "default_screen" in update_data:
        update_data["default_screen"] = (update_data["default_screen"] or "").strip() or None
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
    # If a referral code was supplied, validate it and link the company to the
    # partner so future paid invoices accrue commission.
    referred_by = None
    if data.referred_by:
        partner = await db.companies.find_one(
            {"referral_code": data.referred_by.upper().strip(), "is_partner": True},
            {"_id": 0, "id": 1, "referral_code": 1},
        )
        if partner:
            referred_by = partner["referral_code"]

    company = {
        "id": company_id,
        "name": data.name,
        "cnpj": data.cnpj,
        "email": data.email,
        "phone": data.phone,
        "status": CompanyStatus.ACTIVE,
        "plan_type": data.plan_type,
        "business_type_id": data.business_type_id,
        "plan_id": data.plan_id,
        "features": features,
        "mobile_bottom_nav": mobile_bottom_nav,
        "subdomain": data.subdomain,
        "theme_colors": (data.theme_colors or ThemeColors()).model_dump(),
        "referred_by": referred_by,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": user["id"]
    }
    await db.companies.insert_one(company)

    # Auto-generate invoices. Priority: explicit plan_id (legacy) > business_type
    # billing config (new unified model). Either path generates monthly/yearly
    # installments based on the chosen billing_cycle.
    billing_source = None
    if data.plan_id:
        billing_source = await db.subscription_plans.find_one({"id": data.plan_id}, {"_id": 0})
    if not billing_source and data.business_type_id:
        bt_full = await db.business_types.find_one({"id": data.business_type_id}, {"_id": 0})
        if bt_full and float(bt_full.get("monthly_price") or 0) > 0:
            # Wrap BT into the same shape `_generate_invoices_for_company` expects.
            billing_source = {
                "id": bt_full["id"],
                "name": bt_full.get("name") or "Tipo de Negócio",
                "monthly_price": bt_full.get("monthly_price") or 0,
                "billing_cycle": bt_full.get("billing_cycle") or "monthly",
                "installments": bt_full.get("installments") or 1,
                "grace_days": bt_full.get("grace_days") or 5,
            }
    if billing_source:
        await _generate_invoices_for_company(db, company_id, billing_source)

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



# === SUPER-ADMIN: IMPERSONATE COMPANY (support access) =======================
@router.post("/companies/{company_id}/impersonate")
async def impersonate_company(
    company_id: str,
    db: AsyncIOMotorDatabase = Depends(get_database),
    sa: dict = Depends(require_super_admin),
):
    """Issue a short-lived JWT that logs the SuperAdmin IN as the admin of
    the target company — lets 8IP staff troubleshoot a tenant by seeing
    EXACTLY what the customer sees (same CRM, Agenda, Orçamentos menus).
    The frontend opens a new tab with this token prefilled in localStorage.

    Security:
      * Only SuperAdmins can call this endpoint.
      * Token is valid for 60 minutes (shorter than normal).
      * `impersonated_by` is recorded in the token so we can audit + show a
        banner in the cloned UI.
    """
    company = await db.companies.find_one({"id": company_id}, {"_id": 0})
    if not company:
        raise HTTPException(404, "Empresa nao encontrada")

    # Pick the first company admin; fallback to any user if none.
    admin = await db.company_users.find_one(
        {"company_id": company_id, "role": UserRole.COMPANY_ADMIN.value},
        {"_id": 0, "password": 0},
    ) or await db.company_users.find_one(
        {"company_id": company_id}, {"_id": 0, "password": 0}
    )
    if not admin:
        raise HTTPException(409, "Empresa nao possui nenhum usuario cadastrado")

    token_data = {
        "sub": admin["id"],
        "type": "company_user",
        "role": admin["role"],
        "company_id": company_id,
        "impersonated_by": sa.get("id") or sa.get("sub"),
    }
    token = create_access_token(token_data, expires_delta=timedelta(minutes=60))
    return {
        "access_token": token,
        "token_type": "bearer",
        "company_slug": company.get("slug"),
        "company_name": company.get("name"),
        "user": {k: v for k, v in admin.items() if k != "password"},
    }


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
    business_type_ids: Optional[List[str]] = None  # which tipos-de-negocio offer this plan
    billing_cycle: str = "monthly"  # monthly | yearly | one_time
    installments: int = 1  # how many invoices to auto-generate on company signup
    grace_days: int = 5  # days after due_date before auto-suspension
    # Plan economics — used by Financeiro Admin to compute margin per active client.
    license_cost: float = 0.0   # what we PAY upstream per active client (servers, third-party licenses, etc)


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
        "license_cost": max(0.0, float(data.license_cost or 0.0)),
        "plan_type": data.plan_type.value if hasattr(data.plan_type, "value") else str(data.plan_type),
        "max_connections": max(0, int(data.max_connections or 0)),
        "max_users": max(0, int(data.max_users or 0)),
        "enabled_features": list(data.enabled_features or []),
        "is_active": bool(data.is_active),
        "business_type_ids": list(data.business_type_ids or []),
        "billing_cycle": (data.billing_cycle or "monthly").lower(),
        "installments": max(1, int(data.installments or 1)),
        "grace_days": max(0, int(data.grace_days or 5)),
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
        "license_cost": max(0.0, float(data.license_cost or 0.0)),
        "plan_type": data.plan_type.value if hasattr(data.plan_type, "value") else str(data.plan_type),
        "max_connections": max(0, int(data.max_connections or 0)),
        "max_users": max(0, int(data.max_users or 0)),
        "enabled_features": list(data.enabled_features or []),
        "is_active": bool(data.is_active),
        "business_type_ids": list(data.business_type_ids or []),
        "billing_cycle": (data.billing_cycle or "monthly").lower(),
        "installments": max(1, int(data.installments or 1)),
        "grace_days": max(0, int(data.grace_days or 5)),
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


# === SUPER-ADMIN: FINANCIAL MODULE (invoices + auto-suspend) =================
class InvoiceIn(BaseModel):
    company_id: Optional[str] = None
    external_client_id: Optional[str] = None
    amount: float
    due_date: str  # ISO YYYY-MM-DD
    description: Optional[str] = None


class InvoiceUpdate(BaseModel):
    amount: Optional[float] = None
    due_date: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None  # pending | paid | overdue | canceled
    paid_at: Optional[str] = None


async def _generate_invoices_for_company(db, company_id: str, plan: dict, start_date: Optional[str] = None) -> list:
    """Create auto-invoices for a newly assigned plan/business-type. Called from:
      * `POST /api/super-admin/companies` right after company creation
      * `PUT /api/super-admin/companies/{id}/plan` (plan switch)
    `plan` accepts either a subscription_plans document OR a business_types
    document — both share the same billing fields (monthly_price, billing_cycle,
    installments, grace_days) so the generator works uniformly.
    Rules:
      * `installments` invoices are created, spaced by `billing_cycle`.
      * First due_date = start_date (default: today).
      * Skips generation when `monthly_price <= 0`.
    """
    price = float(plan.get("monthly_price") or 0)
    if price <= 0:
        return []
    cycle = (plan.get("billing_cycle") or "monthly").lower()
    installments = int(plan.get("installments") or 1)
    base_dt = datetime.fromisoformat(start_date) if start_date else datetime.now(timezone.utc)
    docs = []
    for i in range(installments):
        if cycle == "yearly":
            due = base_dt.replace(year=base_dt.year + i)
        elif cycle == "one_time":
            due = base_dt
            if i > 0:
                break
        else:  # monthly
            month = ((base_dt.month - 1) + i) % 12 + 1
            year = base_dt.year + ((base_dt.month - 1) + i) // 12
            try:
                due = base_dt.replace(year=year, month=month)
            except ValueError:
                due = base_dt.replace(year=year, month=month, day=28)
        docs.append({
            "id": str(uuid.uuid4()),
            "company_id": company_id,
            "plan_id": plan.get("id"),
            "amount": price,
            "due_date": due.date().isoformat(),
            "status": "pending",
            "description": f"{plan.get('name')} - parcela {i + 1}/{installments}" if installments > 1 else plan.get("name"),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    if docs:
        await db.invoices.insert_many(docs)
    return docs


@router.get("/invoices")
async def list_invoices(
    company_id: Optional[str] = None,
    external_client_id: Optional[str] = None,
    status_filter: Optional[str] = None,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    q: dict = {}
    if company_id: q["company_id"] = company_id
    if external_client_id: q["external_client_id"] = external_client_id
    if status_filter: q["status"] = status_filter
    rows = await db.invoices.find(q, {"_id": 0}).sort("due_date", 1).to_list(2000)
    cmap: dict = {}
    for c in await db.companies.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(1000):
        cmap[c["id"]] = c["name"]
    emap: dict = {}
    for e in await db.external_billing_clients.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(1000):
        emap[e["id"]] = e["name"]
    for r in rows:
        if r.get("external_client_id"):
            r["client_name"] = emap.get(r["external_client_id"], "—")
            r["client_kind"] = "external"
        else:
            r["client_name"] = cmap.get(r.get("company_id") or "", "—")
            r["client_kind"] = "company"
        # Backward compat: keep "company_name" so existing UI rows still render.
        r["company_name"] = r["client_name"]
    agg = {"pending": 0.0, "paid": 0.0, "overdue": 0.0}
    for r in rows:
        agg[r["status"]] = agg.get(r["status"], 0.0) + float(r.get("amount") or 0.0)
    return {"total": len(rows), "items": rows, "totals": agg}


@router.post("/invoices")
async def create_invoice(
    data: InvoiceIn,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    # Exactly one client identifier must be provided.
    if bool(data.company_id) == bool(data.external_client_id):
        raise HTTPException(400, "Informe company_id OU external_client_id (um e somente um)")
    if data.company_id and not await db.companies.find_one({"id": data.company_id}, {"_id": 0, "id": 1}):
        raise HTTPException(404, "Empresa nao encontrada")
    if data.external_client_id and not await db.external_billing_clients.find_one({"id": data.external_client_id}, {"_id": 0, "id": 1}):
        raise HTTPException(404, "Cliente externo nao encontrado")
    doc = {
        "id": str(uuid.uuid4()),
        "company_id": data.company_id,
        "external_client_id": data.external_client_id,
        "plan_id": None,
        "amount": max(0.0, float(data.amount or 0)),
        "due_date": data.due_date,
        "status": "pending",
        "description": (data.description or "").strip() or "Cobranca manual",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.invoices.insert_one(doc)
    return await db.invoices.find_one({"id": doc["id"]}, {"_id": 0})


@router.put("/invoices/{inv_id}")
async def update_invoice(
    inv_id: str,
    data: InvoiceUpdate,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    update: dict = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if data.status == "paid" and not data.paid_at:
        update["paid_at"] = datetime.now(timezone.utc).isoformat()
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    # Detect transition to "paid" so we can credit the partner commission once.
    invoice_before = await db.invoices.find_one({"id": inv_id}, {"_id": 0})
    r = await db.invoices.update_one({"id": inv_id}, {"$set": update})
    if r.matched_count == 0:
        raise HTTPException(404, "Fatura nao encontrada")
    fresh = await db.invoices.find_one({"id": inv_id}, {"_id": 0})
    became_paid = (
        invoice_before and invoice_before.get("status") != "paid"
        and fresh and fresh.get("status") == "paid"
    )
    if became_paid:
        try:
            from routes.partners_routes import credit_commission_for_invoice
            await credit_commission_for_invoice(db, fresh)
        except Exception as e:
            # Don't block the invoice update if commission accrual fails — log only.
            import logging
            logging.getLogger(__name__).warning(f"partner commission credit failed for invoice {inv_id}: {e}")
    return fresh


@router.delete("/invoices/{inv_id}")
async def delete_invoice(
    inv_id: str,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    r = await db.invoices.delete_one({"id": inv_id})
    if r.deleted_count == 0:
        raise HTTPException(404, "Fatura nao encontrada")
    return {"message": "Removida"}


@router.post("/invoices/run-suspension-check")
async def run_suspension_check(
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    """Sweep overdue invoices, mark them `overdue`, and auto-suspend
    (status='blocked') any company whose oldest overdue invoice has been
    past its grace_days window. Idempotent — safe to re-run."""
    today = datetime.now(timezone.utc).date().isoformat()
    overdue_upd = 0
    suspended = 0
    async for inv in db.invoices.find({"status": "pending"}, {"_id": 0, "id": 1, "due_date": 1}):
        if (inv.get("due_date") or "") < today:
            await db.invoices.update_one(
                {"id": inv["id"]}, {"$set": {"status": "overdue", "updated_at": datetime.now(timezone.utc).isoformat()}}
            )
            overdue_upd += 1
    async for company in db.companies.find({"status": {"$ne": "blocked"}}, {"_id": 0, "id": 1, "plan_id": 1, "business_type_id": 1}):
        oldest = await db.invoices.find_one(
            {"company_id": company["id"], "status": "overdue"},
            {"_id": 0, "due_date": 1},
            sort=[("due_date", 1)],
        )
        if not oldest:
            continue
        # Resolve grace_days: prefer plan_id (legacy), fall back to business_type.
        grace = 5
        plan = await db.subscription_plans.find_one({"id": company.get("plan_id") or ""}, {"_id": 0, "grace_days": 1})
        if plan and plan.get("grace_days") is not None:
            grace = int(plan.get("grace_days") or 5)
        else:
            bt = await db.business_types.find_one({"id": company.get("business_type_id") or ""}, {"_id": 0, "grace_days": 1})
            if bt and bt.get("grace_days") is not None:
                grace = int(bt.get("grace_days") or 5)
        try:
            due = datetime.fromisoformat(oldest["due_date"]).date()
        except Exception:
            continue
        if (datetime.now(timezone.utc).date() - due).days >= grace:
            await db.companies.update_one(
                {"id": company["id"]},
                {"$set": {"status": "blocked", "suspended_at": datetime.now(timezone.utc).isoformat(), "suspended_reason": "inadimplencia"}},
            )
            suspended += 1
    return {"marked_overdue": overdue_upd, "companies_suspended": suspended}


# === SUPER-ADMIN: SETTINGS (financial delegate company) =====================
class SettingsIn(BaseModel):
    financial_manager_company_id: Optional[str] = None


@router.get("/settings")
async def get_super_admin_settings(
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    doc = await db.super_admin_settings.find_one({"_id": "singleton"}, {"_id": 0}) or {}
    return doc


@router.put("/settings")
async def update_super_admin_settings(
    data: SettingsIn,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    payload = {k: v for k, v in data.model_dump(exclude_unset=True).items()}
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.super_admin_settings.update_one(
        {"_id": "singleton"}, {"$set": payload}, upsert=True
    )
    return await db.super_admin_settings.find_one({"_id": "singleton"}, {"_id": 0}) or {}


# === SUPER-ADMIN: EXTERNAL BILLING CLIENTS ===================================
# Standalone clients that exist only in the financial module — they are NOT
# tenants of the SaaS, just external entities the SuperAdmin tracks invoices
# for (e.g. consultancy, agency contracts, outsourced services).
class ExternalClientIn(BaseModel):
    name: str
    cnpj: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    notes: Optional[str] = None


@router.get("/external-clients")
async def list_external_clients(
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    rows = await db.external_billing_clients.find({}, {"_id": 0}).sort("name", 1).to_list(1000)
    return rows


@router.post("/external-clients")
async def create_external_client(
    data: ExternalClientIn,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    doc = {
        "id": str(uuid.uuid4()),
        "name": data.name.strip(),
        "cnpj": (data.cnpj or "").strip() or None,
        "email": (data.email or "").strip() or None,
        "phone": (data.phone or "").strip() or None,
        "notes": (data.notes or "").strip() or None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.external_billing_clients.insert_one(doc)
    return await db.external_billing_clients.find_one({"id": doc["id"]}, {"_id": 0})


@router.put("/external-clients/{cid}")
async def update_external_client(
    cid: str,
    data: ExternalClientIn,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    update = {
        "name": data.name.strip(),
        "cnpj": (data.cnpj or "").strip() or None,
        "email": (data.email or "").strip() or None,
        "phone": (data.phone or "").strip() or None,
        "notes": (data.notes or "").strip() or None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    r = await db.external_billing_clients.update_one({"id": cid}, {"$set": update})
    if r.matched_count == 0:
        raise HTTPException(404, "Cliente externo nao encontrado")
    return await db.external_billing_clients.find_one({"id": cid}, {"_id": 0})


@router.delete("/external-clients/{cid}")
async def delete_external_client(
    cid: str,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    in_use = await db.invoices.count_documents({"external_client_id": cid})
    if in_use > 0:
        raise HTTPException(409, f"Cliente externo possui {in_use} cobranca(s). Remova-as antes.")
    r = await db.external_billing_clients.delete_one({"id": cid})
    if r.deleted_count == 0:
        raise HTTPException(404, "Cliente externo nao encontrado")
    return {"message": "Cliente externo removido"}


# === SUPER-ADMIN: ONE-TIME MIGRATION (Plans → BusinessTypes) =================
@router.post("/migrate-plans-to-business-types")
async def migrate_plans_to_business_types(
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: dict = Depends(require_super_admin),
):
    """One-time migration: copy commercial fields (price, cycle, installments,
    grace_days, max_*) from `subscription_plans` into the `business_types`
    they reference (via `business_type_ids`). Idempotent — only fills fields
    that are missing or zero on the BusinessType side.
    """
    migrated = 0
    skipped = 0
    plans = await db.subscription_plans.find({}, {"_id": 0}).to_list(1000)
    for p in plans:
        for bt_id in (p.get("business_type_ids") or []):
            bt = await db.business_types.find_one({"id": bt_id}, {"_id": 0})
            if not bt:
                continue
            patch: dict = {}
            if not float(bt.get("monthly_price") or 0):
                patch["monthly_price"] = float(p.get("monthly_price") or 0)
            if not bt.get("billing_cycle"):
                patch["billing_cycle"] = (p.get("billing_cycle") or "monthly").lower()
            if not int(bt.get("installments") or 0):
                patch["installments"] = max(1, int(p.get("installments") or 1))
            if bt.get("grace_days") is None:
                patch["grace_days"] = max(0, int(p.get("grace_days") or 5))
            if not int(bt.get("max_connections") or 0):
                patch["max_connections"] = max(0, int(p.get("max_connections") or 1))
            if not int(bt.get("max_users") or 0):
                patch["max_users"] = max(0, int(p.get("max_users") or 1))
            if patch:
                await db.business_types.update_one({"id": bt_id}, {"$set": patch})
                migrated += 1
            else:
                skipped += 1
    return {"migrated_business_types": migrated, "already_filled": skipped, "plans_scanned": len(plans)}



# ──── SGP MIGRATION ────
@router.post("/migrate-sgp-flow")
async def migrate_sgp_flow_endpoint(
    dry_run: bool = True,
    user: dict = Depends(require_super_admin),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Run the SGP flow migration (multi-tenant, idempotent).

    Patches every "SGP" flow in `flow_builders`:
      - converts the contract picker menu to dynamic list (buttons/list)
      - rewrites the segunda-via follow-up message with PDF + Pix block

    Pass `?dry_run=false` to actually persist; default is dry-run so the
    operator can preview safely.
    """
    from scripts.migrate_sgp_flow_to_dynamic_menu import run_migration
    report = await run_migration(db, dry_run=dry_run)
    return report


# ──── INSERT CONTRACTS MENU INTO SGP FLOW ────
@router.get("/sgp-flows")
async def list_sgp_flows(
    user: dict = Depends(require_super_admin),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """List every SGP flow across all companies. Used by the operator to
    discover the `flow_id` they want to patch via
    `/insert-contracts-menu/{flow_id}`."""
    flows = await db.flow_builders.find(
        {"$or": [
            {"name": {"$regex": "SGP", "$options": "i"}},
            {"nodes.data.config.url": {"$regex": "/sgp/", "$options": "i"}},
        ]},
        {"_id": 0, "id": 1, "name": 1, "company_id": 1, "updated_at": 1},
    ).to_list(500)
    # Augment with company name for ergonomics.
    company_ids = list({f["company_id"] for f in flows if f.get("company_id")})
    company_names = {}
    if company_ids:
        async for c in db.companies.find({"id": {"$in": company_ids}}, {"_id": 0, "id": 1, "name": 1}):
            company_names[c["id"]] = c.get("name")
    for f in flows:
        f["company_name"] = company_names.get(f.get("company_id"))
    return flows


@router.post("/insert-contracts-menu/{flow_id}")
async def insert_contracts_menu(
    flow_id: str,
    dry_run: bool = True,
    user: dict = Depends(require_super_admin),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Insert a "contratos" (contracts list) menu node between the
    `consultacliente` HTTP request and the next downstream menu, on the
    SGP flow identified by `flow_id`.

    This addresses the second customer's request: after the customer
    types CPF/CNPJ, list their contracts (via SGP) BEFORE showing the
    Pix/2nd-via menu.

    Behaviour:
      - Locates the HTTP-Request node whose URL contains `consultacliente`.
      - If a menu node with `dynamic_source: contratos_lista` already sits
        downstream of it, returns `inserted=False` (idempotent).
      - Otherwise: creates a new menu node, re-wires the consultacliente
        outbound edges to point to the new node, and chains the new node
        to whatever was previously downstream.
    """
    flow = await db.flow_builders.find_one({"id": flow_id}, {"_id": 0})
    if not flow:
        raise HTTPException(404, "Fluxo nao encontrado")

    nodes = flow.get("nodes") or []
    edges = flow.get("edges") or []

    # 1) Locate consultacliente node
    cc_node = None
    for n in nodes:
        cfg = (n.get("data") or {}).get("config") or {}
        if "consultacliente" in (cfg.get("url") or "").lower():
            cc_node = n
            break
    if not cc_node:
        raise HTTPException(400, "No node calling /sgp/consultacliente found in this flow")

    # 2) Check idempotency — any menu downstream already dynamic_source=contratos_lista?
    cc_id = cc_node["id"]
    downstream_ids = [e["target"] for e in edges if e.get("source") == cc_id]
    for n in nodes:
        if n["id"] in downstream_ids:
            cfg = (n.get("data") or {}).get("config") or {}
            if cfg.get("dynamic_source") in ("contratos_lista", "contratos_menu"):
                return {"inserted": False, "reason": "Menu de contratos ja existe downstream do consultacliente", "flow_id": flow_id}

    # 3) Build the new menu node
    import uuid as _uuid
    new_id = f"menu_{_uuid.uuid4().hex[:8]}"
    # position it visually under the consultacliente
    cc_pos = cc_node.get("position") or {"x": 0, "y": 0}
    new_node = {
        "id": new_id,
        "type": "flow",
        "position": {"x": (cc_pos.get("x") or 0), "y": (cc_pos.get("y") or 0) + 180},
        "data": {
            "nodeType": "menu",
            "label": "Menu Contratos (SGP)",
            "config": {
                "title": "Seus contratos",
                "question": "Selecione o contrato que deseja atender:",
                "options_format": "list",
                "dynamic_source": "contratos_lista",
                "footer": "Toque para escolher",
                "list_button_text": "Ver contratos",
                "list_section_title": "Contratos disponiveis",
            },
        },
    }

    # 4) Re-wire edges:
    #    - keep one downstream id (the "main next") to chain after the new node
    #    - replace consultacliente→downstream edges with consultacliente→newNode
    #    - add newNode→main_downstream
    if not downstream_ids:
        # consultacliente had no outgoing edge. Just add the new node and connect.
        next_id = None
    else:
        next_id = downstream_ids[0]  # main next; if there are alternates we keep them as-is

    new_edges = []
    seen_main = False
    for e in edges:
        if e.get("source") == cc_id and e.get("target") == next_id and not seen_main:
            # Rewire the main downstream: cc -> newNode (instead of cc -> next_id)
            seen_main = True
            new_edges.append({
                **e,
                "target": new_id,
                "id": f"e_{cc_id}_{new_id}",
            })
        else:
            new_edges.append(e)
    if next_id:
        new_edges.append({
            "id": f"e_{new_id}_{next_id}",
            "source": new_id,
            "target": next_id,
        })

    if dry_run:
        return {
            "inserted": True,
            "dry_run": True,
            "flow_id": flow_id,
            "new_node_id": new_id,
            "consultacliente_node": cc_id,
            "next_node": next_id,
            "would_add_node": new_node,
        }

    nodes.append(new_node)
    await db.flow_builders.update_one(
        {"id": flow_id},
        {"$set": {"nodes": nodes, "edges": new_edges, "updated_at": datetime.utcnow().isoformat()}},
    )
    return {
        "inserted": True,
        "dry_run": False,
        "flow_id": flow_id,
        "new_node_id": new_id,
        "consultacliente_node": cc_id,
        "next_node": next_id,
    }


@router.get("/inspect-flow/{flow_id}")
async def inspect_flow(
    flow_id: str,
    user: dict = Depends(require_super_admin),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Diagnostic helper: returns a compact summary of a flow so the
    operator can see WHY a menu / node isn't reaching the customer
    without having to open the Flowbuilder UI."""
    flow = await db.flow_builders.find_one({"id": flow_id}, {"_id": 0})
    if not flow:
        raise HTTPException(404, "Fluxo nao encontrado")
    nodes = flow.get("nodes") or []
    edges = flow.get("edges") or []
    summary = []
    for n in nodes:
        cfg = (n.get("data") or {}).get("config") or {}
        nt = (n.get("data") or {}).get("nodeType")
        outs = [e.get("target") for e in edges if e.get("source") == n.get("id")]
        ins = [e.get("source") for e in edges if e.get("target") == n.get("id")]
        summary.append({
            "id": n.get("id"),
            "type": nt,
            "label": (n.get("data") or {}).get("label"),
            "url": cfg.get("url"),
            "dynamic_source": cfg.get("dynamic_source"),
            "options_format": cfg.get("options_format"),
            "question": (cfg.get("question") or "")[:80],
            "next": outs,
            "from": ins,
        })
    return {
        "flow_id": flow_id,
        "name": flow.get("name"),
        "trigger_type": flow.get("trigger_type"),
        "node_count": len(nodes),
        "edge_count": len(edges),
        "nodes": summary,
    }


@router.post("/split-contract-menu/{flow_id}")
async def split_contract_menu(
    flow_id: str,
    dry_run: bool = True,
    user: dict = Depends(require_super_admin),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Fix the legacy SGP migration where the `found_menu` node had both
    `dynamic_source: contratos_lista` AND multiple outgoing edges to
    static "service" options (Pix, 2nd-via, Support, Promise, Attendant).

    Splits the menu in two: keeps the original node as the contracts
    picker (single outgoing edge to the service menu) and creates a new
    `service_menu` node that inherits the outgoing edges (Pix, 2via, ...).
    """
    flow = await db.flow_builders.find_one({"id": flow_id}, {"_id": 0})
    if not flow:
        raise HTTPException(404, "Fluxo nao encontrado")
    nodes = flow.get("nodes") or []
    edges = flow.get("edges") or []
    # Find the menu that has both dynamic_source AND multiple outgoing edges.
    target_menu = None
    for n in nodes:
        cfg = (n.get("data") or {}).get("config") or {}
        nt = (n.get("data") or {}).get("nodeType")
        if nt == "menu" and cfg.get("dynamic_source") in ("contratos_lista", "contratos_menu"):
            outs = [e for e in edges if e.get("source") == n.get("id")]
            if len(outs) > 1:
                target_menu = n
                break
    if not target_menu:
        return {"split": False, "reason": "Nenhum menu de contratos com multiplas saidas encontrado"}

    target_id = target_menu["id"]
    target_pos = target_menu.get("position") or {"x": 0, "y": 0}

    # Build the new service_menu using the SAME static options that already
    # exist as outgoing edges from the contracts menu, but preserving the
    # node labels (Pix, 2via, Acesso, Promessa, Atendente).
    import uuid as _uuid
    new_id = f"service_menu_{_uuid.uuid4().hex[:6]}"
    new_node = {
        "id": new_id,
        "type": "flow",
        "position": {"x": target_pos.get("x", 0), "y": (target_pos.get("y", 0) or 0) + 180},
        "data": {
            "nodeType": "menu",
            "label": "Tipo de Atendimento",
            "config": {
                "title": "O que voce precisa?",
                "question": "Escolha o tipo de atendimento:",
                "options_format": "list",
                "footer": "Toque para escolher",
                "list_button_text": "Ver opcoes",
                "list_section_title": "Servicos disponiveis",
            },
        },
    }
    # Reroute: every edge that was source=target_id → keep target the same,
    # but change source to new_id. Then add one new edge target_id → new_id.
    new_edges = []
    rerouted = 0
    for e in edges:
        if e.get("source") == target_id:
            new_edges.append({**e, "source": new_id, "id": f"e_{new_id}_{e.get('target')}"})
            rerouted += 1
        else:
            new_edges.append(e)
    new_edges.append({
        "id": f"e_{target_id}_{new_id}",
        "source": target_id,
        "target": new_id,
    })

    # Update the original menu to make it clear it is now the contracts picker.
    for n in nodes:
        if n.get("id") == target_id:
            cfg = (n.get("data") or {}).get("config") or {}
            cfg["question"] = cfg.get("question") or "Selecione o contrato para atendimento:"
            cfg["title"] = cfg.get("title") or "Seus contratos"
            cfg["options_format"] = "list"
            cfg["dynamic_source"] = "contratos_lista"
            cfg["list_button_text"] = cfg.get("list_button_text") or "Ver contratos"
            cfg["list_section_title"] = cfg.get("list_section_title") or "Contratos disponiveis"
            cfg["footer"] = cfg.get("footer") or "Toque para escolher"
            n["data"]["config"] = cfg
            n["data"]["label"] = "Menu Contratos (SGP)"

    if dry_run:
        return {
            "split": True, "dry_run": True, "flow_id": flow_id,
            "target_menu": target_id, "new_service_menu": new_id,
            "rerouted_edges": rerouted,
        }

    nodes.append(new_node)
    await db.flow_builders.update_one(
        {"id": flow_id},
        {"$set": {"nodes": nodes, "edges": new_edges, "updated_at": datetime.utcnow().isoformat()}},
    )
    return {
        "split": True, "dry_run": False, "flow_id": flow_id,
        "target_menu": target_id, "new_service_menu": new_id,
        "rerouted_edges": rerouted,
    }


# === SGP FLOW AUDIT + AUTO-REPAIR =============================================
#
# The "Web Fibra" customer's SGP flow has a recurring failure mode: after the
# `consultacliente` HTTP node, the operator-built flow jumps straight to a
# static "Tipo de Atendimento" menu (Pix / 2ª via / Suporte / …) WITHOUT a
# dynamic menu in-between to pick which contract. As a result:
#   • the contract list never renders in WhatsApp (no buttons/list);
#   • `{{contrato_id}}` is never captured, so the downstream /api/sgp/fatura2via
#     call ends up with an empty parameter and SGP returns nothing → no PDF,
#     no Pix.
#
# `/super-admin/audit-sgp-flow/{flow_id}` returns a structured report.
# `/super-admin/repair-sgp-flow/{flow_id}` inserts the missing contract picker
# AND rewrites the 2ª-via downstream message to include boleto + Pix + linha
# digitavel. Both endpoints accept `dry_run=true|false`. The repair is
# idempotent — re-running on an already-repaired flow is a no-op.

SECOND_VIA_RICH_TEMPLATE = (
    "Aqui esta sua 2a via!\n\n"
    "📄 Boleto / link de cobranca:\n{{boleto_url}}\n\n"
    "💳 Linha digitavel:\n{{linha_digitavel}}\n\n"
    "⚡ PIX Copia-e-Cola:\n{{pix_copia_e_cola}}\n\n"
    "Vencimento: {{vencimento_fatura}}\n"
    "Valor: R$ {{valor_fatura}}\n\n"
    "_Se ja pagou, desconsidere esta mensagem._"
)


def _sgp_action_of(node: dict) -> Optional[str]:
    """Return the SGP action ('consultacliente', 'fatura2via', …) called by
    the node's HTTP URL, or None if it isn't an SGP node."""
    cfg = (node.get("data") or {}).get("config") or {}
    nt = (node.get("data") or {}).get("nodeType") or node.get("type") or ""
    if nt not in ("http", "http_request", "request", "api"):
        return None
    url = cfg.get("url") or ""
    if "/api/sgp/" not in url:
        return None
    return url.split("/api/sgp/", 1)[1].rstrip("/").split("?")[0]


def _audit_sgp_flow_report(flow: dict) -> dict:
    nodes = flow.get("nodes") or []
    edges = flow.get("edges") or []
    issues: list = []
    info: list = []
    by_id = {n.get("id"): n for n in nodes}
    edges_by_src: dict = {}
    for e in edges:
        edges_by_src.setdefault(e.get("source"), []).append(e)

    consult_nodes = [n for n in nodes if _sgp_action_of(n) == "consultacliente"]
    if not consult_nodes:
        issues.append({
            "code": "missing_consultacliente",
            "message": "Nenhum HTTP node chamando /api/sgp/consultacliente foi encontrado.",
        })
    for cn in consult_nodes:
        downstream = [by_id.get(e["target"]) for e in edges_by_src.get(cn["id"], [])]
        downstream = [d for d in downstream if d]
        has_picker = False
        for d in downstream:
            dcfg = (d.get("data") or {}).get("config") or {}
            dnt = (d.get("data") or {}).get("nodeType") or d.get("type")
            if dnt == "menu" and dcfg.get("dynamic_source") in ("contratos_lista", "contratos_menu"):
                has_picker = True
                info.append({
                    "code": "contract_picker_ok",
                    "consultacliente_node": cn["id"],
                    "picker_node": d["id"],
                })
                break
        if not has_picker:
            issues.append({
                "code": "missing_contract_picker",
                "message": (
                    "Após o HTTP consultacliente, deveria existir um Menu dinâmico "
                    "com `dynamic_source=contratos_lista` para o cliente escolher "
                    "qual contrato. O fluxo atual pula direto para outro nó, então "
                    "a lista de contratos nunca é exibida e `contrato_id` nunca é "
                    "capturado."
                ),
                "consultacliente_node": cn["id"],
                "current_downstream": [d.get("id") for d in downstream],
            })

    fatura_nodes = [n for n in nodes if _sgp_action_of(n) == "fatura2via"]
    for fn in fatura_nodes:
        downstream = [by_id.get(e["target"]) for e in edges_by_src.get(fn["id"], [])]
        downstream = [d for d in downstream if d]
        rich = False
        for d in downstream:
            dnt = (d.get("data") or {}).get("nodeType") or d.get("type")
            if dnt not in ("message", "welcome", "send_message", "text"):
                continue
            txt = ((d.get("data") or {}).get("config") or {}).get("text") or \
                  ((d.get("data") or {}).get("config") or {}).get("question") or ""
            keys = ("boleto_url", "linha_digitavel", "pix_copia_e_cola")
            present = [k for k in keys if k in txt]
            if len(present) >= 2:
                rich = True
                info.append({
                    "code": "second_via_template_ok",
                    "fatura2via_node": fn["id"],
                    "message_node": d["id"],
                    "placeholders_present": present,
                })
                break
        if not rich:
            issues.append({
                "code": "second_via_template_poor",
                "message": (
                    "O nó de mensagem após o HTTP fatura2via não inclui os "
                    "placeholders {{boleto_url}}, {{linha_digitavel}} e "
                    "{{pix_copia_e_cola}} simultaneamente — então o cliente "
                    "não recebe o pacote completo (PDF + Linha + Pix)."
                ),
                "fatura2via_node": fn["id"],
                "downstream_messages": [d.get("id") for d in downstream
                                         if ((d.get("data") or {}).get("nodeType") or d.get("type")) in ("message","welcome","send_message","text")],
            })

    for fn in fatura_nodes:
        cfg = (fn.get("data") or {}).get("config") or {}
        body = cfg.get("body") or {}
        params = (body.get("params") if isinstance(body, dict) else None) or {}
        contrato_val = ""
        for k in ("contrato", "contratoId", "contrato_id"):
            v = params.get(k)
            if isinstance(v, str) and v.strip():
                contrato_val = v.strip()
                break
        if "{{contrato_id}}" not in contrato_val and "{{contratoId}}" not in contrato_val:
            issues.append({
                "code": "fatura2via_missing_contrato_placeholder",
                "message": (
                    "O nó HTTP fatura2via NÃO passa {{contrato_id}} no body — "
                    "sem isso, o SGP devolve vazio. Esperado algo como "
                    "`{ \"params\": { \"contrato\": \"{{contrato_id}}\" } }`."
                ),
                "fatura2via_node": fn["id"],
                "current_body_params": list(params.keys()),
            })

    return {
        "flow_id": flow.get("id"),
        "flow_name": flow.get("name"),
        "company_id": flow.get("company_id"),
        "nodes_count": len(nodes),
        "edges_count": len(edges),
        "issues": issues,
        "info": info,
        "ok": not issues,
    }


@router.get("/audit-sgp-flow/{flow_id}")
async def audit_sgp_flow(
    flow_id: str,
    user: dict = Depends(require_super_admin),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Inspect a flow and report missing/misconfigured SGP nodes.
    Read-only — never modifies the flow."""
    flow = await db.flow_builders.find_one({"id": flow_id}, {"_id": 0})
    if not flow:
        raise HTTPException(404, "Fluxo nao encontrado")
    return _audit_sgp_flow_report(flow)


@router.get("/audit-sgp-flow-by-company/{company_id}")
async def audit_sgp_flow_by_company(
    company_id: str,
    user: dict = Depends(require_super_admin),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Audit ALL flows of a company that look like SGP flows
    (name contains 'SGP' OR has at least one /api/sgp/* node).
    Useful when you don't know the flow_id from production."""
    cursor = db.flow_builders.find({"company_id": company_id}, {"_id": 0})
    flows = await cursor.to_list(200)
    reports = []
    for f in flows:
        looks_sgp = bool(f.get("name") and "sgp" in f["name"].lower())
        if not looks_sgp:
            looks_sgp = any(_sgp_action_of(n) for n in (f.get("nodes") or []))
        if looks_sgp:
            reports.append(_audit_sgp_flow_report(f))
    return {"company_id": company_id, "flows_audited": len(reports), "reports": reports}


def _repair_sgp_flow_data(flow: dict) -> tuple:
    """Pure function — takes a flow dict, returns (nodes, edges, changes)
    after applying the SGP repair. Does NOT touch the database. Used by
    both /repair-sgp-flow (persists) and /export-repaired-sgp-flow (returns
    the JSON ready for download/import)."""
    import copy as _copy
    flow = _copy.deepcopy(flow)
    nodes = flow.get("nodes") or []
    edges = flow.get("edges") or []
    by_id = {n.get("id"): n for n in nodes}
    edges_by_src: dict = {}
    for e in edges:
        edges_by_src.setdefault(e.get("source"), []).append(e)

    changes: list = []
    consult_nodes = [n for n in nodes if _sgp_action_of(n) == "consultacliente"]
    new_nodes: list = []
    new_edges = list(edges)
    for cn in consult_nodes:
        out_edges = edges_by_src.get(cn["id"], [])
        downstream = [by_id.get(e["target"]) for e in out_edges]
        downstream = [d for d in downstream if d]
        has_picker = False
        for d in downstream:
            dcfg = (d.get("data") or {}).get("config") or {}
            dnt = (d.get("data") or {}).get("nodeType") or d.get("type")
            if dnt == "menu" and dcfg.get("dynamic_source") in ("contratos_lista", "contratos_menu"):
                has_picker = True
                break
        if has_picker:
            continue

        picker_id = f"contract_picker_{uuid.uuid4().hex[:6]}"
        cn_pos = cn.get("position") or {"x": 0, "y": 0}
        picker_node = {
            "id": picker_id,
            "type": "flow",
            "position": {"x": cn_pos.get("x", 0), "y": (cn_pos.get("y", 0) or 0) + 160},
            "data": {
                "nodeType": "menu",
                "label": "Selecione o Contrato (SGP)",
                "config": {
                    "title": "Seus contratos",
                    "question": (
                        "Ola {{nome_cliente}}!\n"
                        "Selecione o contrato para o atendimento:\n\n"
                        "{{contratos_menu}}\n\n"
                        "Digite o numero da opcao (ex: 0)."
                    ),
                    "options_format": "text",
                    "dynamic_source": "contratos_lista",
                    "capture_var": "contrato_id",
                    "footer": "",
                    "summary": "Lista dinâmica de contratos (SGP)",
                },
            },
        }
        new_nodes.append(picker_node)
        rerouted = 0
        rewired_edges = []
        for e in new_edges:
            if e.get("source") == cn["id"]:
                rewired_edges.append({**e, "source": picker_id,
                                       "id": f"e_{picker_id}_{e.get('target')}"})
                rerouted += 1
            else:
                rewired_edges.append(e)
        rewired_edges.append({
            "id": f"e_{cn['id']}_{picker_id}",
            "source": cn["id"],
            "target": picker_id,
        })
        new_edges = rewired_edges
        changes.append({
            "action": "insert_contract_picker",
            "consultacliente_node": cn["id"],
            "picker_node": picker_id,
            "rerouted_edges": rerouted,
        })

    nodes = nodes + new_nodes

    edges_by_src = {}
    for e in new_edges:
        edges_by_src.setdefault(e.get("source"), []).append(e)
    by_id = {n.get("id"): n for n in nodes}
    fatura_nodes = [n for n in nodes if _sgp_action_of(n) == "fatura2via"]
    for fn in fatura_nodes:
        outs = edges_by_src.get(fn["id"], [])
        downstream = [by_id.get(e["target"]) for e in outs]
        downstream = [d for d in downstream if d]
        for d in downstream:
            dnt = (d.get("data") or {}).get("nodeType") or d.get("type")
            if dnt not in ("message", "welcome", "send_message", "text"):
                continue
            cfg = (d.get("data") or {}).get("config") or {}
            cur = cfg.get("text") or cfg.get("question") or ""
            keys = ("boleto_url", "linha_digitavel", "pix_copia_e_cola")
            present = sum(1 for k in keys if k in cur)
            if present >= 2:
                continue
            cfg["text"] = SECOND_VIA_RICH_TEMPLATE
            d["data"]["config"] = cfg
            changes.append({
                "action": "rewrite_second_via_message",
                "fatura2via_node": fn["id"],
                "message_node": d["id"],
                "placeholders_present_before": present,
            })

        cfg_fn = (fn.get("data") or {}).get("config") or {}
        body = cfg_fn.get("body") or {}
        params = (body.get("params") if isinstance(body, dict) else None) or {}
        needs_patch = True
        for k in ("contrato", "contratoId", "contrato_id"):
            v = params.get(k)
            if isinstance(v, str) and ("{{contrato_id}}" in v or "{{contratoId}}" in v):
                needs_patch = False
                break
        if needs_patch:
            params["contrato"] = "{{contrato_id}}"
            body["params"] = params
            cfg_fn["body"] = body
            fn["data"]["config"] = cfg_fn
            changes.append({
                "action": "patch_fatura2via_body",
                "fatura2via_node": fn["id"],
                "now_passes": "contrato={{contrato_id}}",
            })

    picker_ids = {c["picker_node"] for c in changes if c.get("action") == "insert_contract_picker"}
    edges_by_src_now: dict = {}
    for e in new_edges:
        edges_by_src_now.setdefault(e.get("source"), []).append(e)
    by_id_now = {n.get("id"): n for n in nodes}
    for cn in consult_nodes:
        for e in edges_by_src_now.get(cn["id"], []):
            tgt = by_id_now.get(e["target"])
            if not tgt:
                continue
            tcfg = (tgt.get("data") or {}).get("config") or {}
            tnt = (tgt.get("data") or {}).get("nodeType") or tgt.get("type")
            if tnt == "menu" and tcfg.get("dynamic_source") in ("contratos_lista", "contratos_menu"):
                picker_ids.add(tgt["id"])
    for n in nodes:
        if n.get("id") in picker_ids:
            continue
        cfg = (n.get("data") or {}).get("config") or {}
        nt = (n.get("data") or {}).get("nodeType") or n.get("type")
        if nt != "menu":
            continue
        if cfg.get("dynamic_source") not in ("contratos_lista", "contratos_menu"):
            continue
        opts = cfg.get("options") or []
        looks_service = any(
            isinstance(o, dict) and (o.get("key") or o.get("label"))
            and not str(o.get("label", "")).lower().startswith("contrato")
            for o in opts
        )
        if not looks_service:
            continue
        removed = []
        for k in ("dynamic_source", "capture_var", "header", "button_label",
                  "list_button_text", "list_section_title"):
            if k in cfg:
                cfg.pop(k)
                removed.append(k)
        if cfg.get("title") in ("Seus contratos",):
            cfg["title"] = "Tipo de Atendimento"
        if not (cfg.get("question") or cfg.get("text")):
            cfg["question"] = "Como posso te ajudar?"
        for i, o in enumerate(opts):
            if isinstance(o, dict) and not o.get("key"):
                o["key"] = str(i + 1)
        cfg["options"] = opts
        n["data"]["config"] = cfg
        if (n["data"].get("label") or "").lower().startswith("menu contratos"):
            n["data"]["label"] = "Tipo de Atendimento"
        changes.append({
            "action": "strip_dynamic_from_service_menu",
            "menu_node": n["id"],
            "removed_keys": removed,
        })

    for pid in picker_ids:
        pnode = next((n for n in nodes if n.get("id") == pid), None)
        if not pnode:
            continue
        cfg = (pnode.get("data") or {}).get("config") or {}
        touched = False
        if cfg.get("options"):
            cfg["options"] = []
            touched = True
        if cfg.get("options_format") != "text":
            cfg["options_format"] = "text"
            touched = True
        q = cfg.get("question") or ""
        if "{{contratos_menu}}" not in q:
            cfg["question"] = (
                "Ola {{nome_cliente}}!\n"
                "Selecione o contrato para o atendimento:\n\n"
                "{{contratos_menu}}\n\n"
                "Digite o numero da opcao (ex: 0)."
            )
            touched = True
        for k in ("header", "button_label", "list_button_text",
                  "list_section_title"):
            if k in cfg:
                cfg.pop(k)
                touched = True
        if touched:
            pnode["data"]["config"] = cfg
            changes.append({
                "action": "force_picker_text_mode",
                "picker_node": pid,
            })

    for n in nodes:
        nt = (n.get("data") or {}).get("nodeType") or n.get("type")
        if nt not in ("http", "http_request", "request", "api"):
            continue
        cfg = (n.get("data") or {}).get("config") or {}
        if cfg.get("body") == "[object Object]":
            cfg["body"] = {}
            n["data"]["config"] = cfg
            changes.append({
                "action": "fix_corrupt_http_body",
                "http_node": n["id"],
                "url": cfg.get("url", ""),
            })

    return nodes, new_edges, changes


@router.post("/repair-sgp-flow/{flow_id}")
async def repair_sgp_flow(
    flow_id: str,
    dry_run: bool = True,
    user: dict = Depends(require_super_admin),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Persist the SGP repair on the given flow. Pass `dry_run=false` to
    actually save. Idempotent."""
    flow = await db.flow_builders.find_one({"id": flow_id}, {"_id": 0})
    if not flow:
        raise HTTPException(404, "Fluxo nao encontrado")
    nodes, new_edges, changes = _repair_sgp_flow_data(flow)

    if dry_run:
        return {"dry_run": True, "flow_id": flow_id, "changes": changes,
                "changes_count": len(changes)}

    if not changes:
        return {"dry_run": False, "flow_id": flow_id, "changes": [],
                "changes_count": 0, "message": "Nothing to repair."}

    await db.flow_builders.update_one(
        {"id": flow_id},
        {"$set": {
            "nodes": nodes,
            "edges": new_edges,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    return {"dry_run": False, "flow_id": flow_id, "changes": changes,
            "changes_count": len(changes)}


@router.get("/export-repaired-sgp-flow/{flow_id}")
async def export_repaired_sgp_flow(
    flow_id: str,
    user: dict = Depends(require_super_admin),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Return the FULL repaired flow as a downloadable JSON in the exact
    shape consumed by /api/crm/flows/import — does NOT persist to the
    source flow. Use this to:
      1. curl -OJ on production to download the file
      2. delete or rename the broken flow on the operator UI
      3. import the downloaded JSON via the Flowbuilder "Importar Fluxo"
         button — the new flow lands disabled, you toggle it active.
    Idempotent on already-repaired flows.
    """
    from fastapi.responses import Response
    import json as _json
    flow = await db.flow_builders.find_one({"id": flow_id}, {"_id": 0})
    if not flow:
        raise HTTPException(404, "Fluxo nao encontrado")
    nodes, new_edges, changes = _repair_sgp_flow_data(flow)
    out = {
        "name": (flow.get("name") or "Fluxo SGP") + " (corrigido)",
        "description": (flow.get("description") or ""),
        "trigger_type": flow.get("trigger_type") or "manual",
        "nodes": nodes,
        "edges": new_edges,
        "_repair_changes": changes,
        "_repair_changes_count": len(changes),
    }
    safe = (flow.get("name") or "fluxo").replace("/", "_").replace(" ", "_")
    # HTTP headers are latin-1 only — strip non-ASCII (em-dashes, accents)
    safe = safe.encode("ascii", "ignore").decode("ascii")[:60] or "fluxo"
    filename = f"{safe}_FIXED.json"
    body = _json.dumps(out, ensure_ascii=False, indent=2)
    return Response(
        content=body,
        media_type="application/json; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
