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
