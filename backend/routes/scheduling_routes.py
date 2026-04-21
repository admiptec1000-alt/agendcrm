from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from database import get_database
from auth import get_current_user
from models import (
    AppointmentCreate, AppointmentUpdate, ServiceCreate, ServiceUpdate,
    ProfessionalCreate, ProfessionalUpdate, CategoryCreate,
    BookingPageUpdate, AppointmentStatus
)
import uuid
from datetime import datetime, timezone, timedelta
from typing import List, Optional
from pydantic import BaseModel, EmailStr

router = APIRouter(prefix="/scheduling", tags=["scheduling"])

# === EXTRA MODELS ===
class SubscriptionPlanCreate(BaseModel):
    name: str
    price: float
    visits_per_month: int
    included_service_ids: List[str] = []
    description: Optional[str] = None

class ClientSubscriptionCreate(BaseModel):
    client_phone: str
    plan_id: str

class ClientCreate(BaseModel):
    name: str
    phone: str
    email: Optional[str] = None
    notes: Optional[str] = None

# === APPOINTMENTS ===
@router.get("/appointments")
async def list_appointments(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
    date: str = None,
    professional_id: str = None,
    status_filter: str = None
):
    query = {"company_id": user["company_id"]}
    if date:
        query["date"] = date
    if professional_id:
        query["professional_id"] = professional_id
    if status_filter:
        query["status"] = status_filter
    # Non-admin users: auto-filter by their linked professional (matched by email)
    if user.get("role") and user["role"] != "company_admin" and user["role"] != "super_admin":
        my_prof = await db.professionals.find_one(
            {"company_id": user["company_id"], "email": user.get("email")},
            {"_id": 0, "id": 1}
        )
        if my_prof:
            query["professional_id"] = my_prof["id"]
        else:
            # Fail-closed: non-admin user with no linked professional sees nothing
            return []
    appointments = await db.appointments.find(query, {"_id": 0}).sort("date", -1).to_list(1000)
    return appointments

@router.post("/appointments")
async def create_appointment(
    data: AppointmentCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    service = await db.services.find_one({"id": data.service_id, "company_id": user["company_id"]})
    if not service:
        raise HTTPException(status_code=404, detail="Servico nao encontrado")
    professional = await db.professionals.find_one({"id": data.professional_id, "company_id": user["company_id"]})
    if not professional:
        raise HTTPException(status_code=404, detail="Profissional nao encontrado")

    # Check client subscription
    price = service["price"]
    subscription_applied = False
    client_sub = await db.client_subscriptions.find_one({
        "company_id": user["company_id"],
        "client_phone": data.customer_phone,
        "status": "active",
        "credits_remaining": {"$gt": 0}
    })
    if client_sub:
        plan = await db.subscription_plans.find_one({"id": client_sub["plan_id"]})
        if plan and data.service_id in plan.get("included_service_ids", []):
            price = 0.0
            subscription_applied = True
            await db.client_subscriptions.update_one(
                {"id": client_sub["id"]},
                {"$inc": {"credits_remaining": -1}}
            )

    appointment_id = str(uuid.uuid4())
    appointment = {
        "id": appointment_id,
        "company_id": user["company_id"],
        "customer_name": data.customer_name,
        "customer_phone": data.customer_phone,
        "customer_email": data.customer_email,
        "service_id": data.service_id,
        "service_name": service["name"],
        "professional_id": data.professional_id,
        "professional_name": professional["name"],
        "date": data.date,
        "time": data.time,
        "duration": service["duration"],
        "price": price,
        "original_price": service["price"],
        "subscription_applied": subscription_applied,
        "status": AppointmentStatus.PENDENTE,
        "notes": data.notes,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.appointments.insert_one(appointment)

    # Update/create client record
    existing_client = await db.clients.find_one({"company_id": user["company_id"], "phone": data.customer_phone})
    if not existing_client:
        await db.clients.insert_one({
            "id": str(uuid.uuid4()),
            "company_id": user["company_id"],
            "name": data.customer_name,
            "phone": data.customer_phone,
            "email": data.customer_email,
            "total_appointments": 1,
            "created_at": datetime.now(timezone.utc).isoformat()
        })
    else:
        await db.clients.update_one(
            {"id": existing_client["id"]},
            {"$inc": {"total_appointments": 1}}
        )

    return {k: v for k, v in appointment.items() if k != "_id"}

@router.put("/appointments/{appointment_id}")
async def update_appointment(
    appointment_id: str,
    data: AppointmentUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    appointment = await db.appointments.find_one({"id": appointment_id, "company_id": user["company_id"]})
    if not appointment:
        raise HTTPException(status_code=404, detail="Agendamento nao encontrado")

    update_data = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}

    # Permission check: non-admin needs edit_appointment or edit_appointment_price
    sensitive_fields = {"date", "time", "service_id", "extra_items", "price"}
    price_fields = {"price"}
    if user.get("role") and user["role"] not in ("company_admin", "super_admin"):
        perms = []
        if user.get("permission_profile_id"):
            prof_doc = await db.permission_profiles.find_one(
                {"id": user["permission_profile_id"], "company_id": user["company_id"]},
                {"_id": 0, "permissions": 1}
            )
            perms = (prof_doc or {}).get("permissions", []) or []
        touching = set(update_data.keys())
        if (touching & sensitive_fields) - price_fields and "edit_appointment" not in perms:
            raise HTTPException(status_code=403, detail="Sem permissao para editar este agendamento")
        if (touching & price_fields) and "edit_appointment_price" not in perms:
            raise HTTPException(status_code=403, detail="Sem permissao para alterar o valor")

    # If service_id changed, refresh service_name and default price/duration
    if "service_id" in update_data and update_data["service_id"] != appointment.get("service_id"):
        new_service = await db.services.find_one({"id": update_data["service_id"], "company_id": user["company_id"]})
        if not new_service:
            raise HTTPException(status_code=404, detail="Servico nao encontrado")
        update_data["service_name"] = new_service["name"]
        update_data.setdefault("duration", new_service.get("duration", 30))
        # Only set price from service if caller didn't explicitly pass price
        if "price" not in update_data:
            update_data["price"] = new_service.get("price", 0)

    # Normalize extra_items: ensure proper structure and recompute total if items provided
    if "extra_items" in update_data:
        items = update_data["extra_items"] or []
        normalized = []
        for it in items:
            normalized.append({
                "service_id": it.get("service_id"),
                "name": it.get("name"),
                "price": float(it.get("price", 0) or 0),
                "type": it.get("type", "service"),
            })
        update_data["extra_items"] = normalized
        # If no explicit price passed, recompute: base price + sum extras
        if "price" not in update_data:
            base = appointment.get("price", 0) if "service_id" not in update_data else update_data.get("price", 0)
            update_data["price"] = float(base) + sum(i["price"] for i in normalized)

    if update_data:
        await db.appointments.update_one({"id": appointment_id}, {"$set": update_data})
    updated = await db.appointments.find_one({"id": appointment_id}, {"_id": 0})
    return updated

@router.delete("/appointments/{appointment_id}")
async def delete_appointment(
    appointment_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    result = await db.appointments.delete_one({"id": appointment_id, "company_id": user["company_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Agendamento nao encontrado")
    return {"message": "Agendamento deletado"}



# === CONCLUDE APPOINTMENT WITH PAYMENT ===
class ConcludeAppointment(BaseModel):
    payment_method: str  # dinheiro, pix, cartao_debito, cartao_credito
    notes: Optional[str] = None
    final_price: Optional[float] = None  # override final price at conclusion

@router.put("/appointments/{appointment_id}/conclude")
async def conclude_appointment(
    appointment_id: str,
    data: ConcludeAppointment,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    apt = await db.appointments.find_one({"id": appointment_id, "company_id": user["company_id"]})
    if not apt:
        raise HTTPException(status_code=404, detail="Agendamento nao encontrado")
    if apt.get("status") in ["cancelado", "concluido"]:
        raise HTTPException(status_code=400, detail="Agendamento ja finalizado")

    # Permission check for final_price override
    if data.final_price is not None and user.get("role") and user["role"] not in ("company_admin", "super_admin"):
        perms = []
        if user.get("permission_profile_id"):
            prof_doc = await db.permission_profiles.find_one(
                {"id": user["permission_profile_id"], "company_id": user["company_id"]},
                {"_id": 0, "permissions": 1}
            )
            perms = (prof_doc or {}).get("permissions", []) or []
        if "edit_appointment_price" not in perms:
            raise HTTPException(status_code=403, detail="Sem permissao para alterar o valor")

    final_amount = float(data.final_price) if data.final_price is not None else apt.get("price", 0)

    update = {
        "status": "concluido",
        "payment_method": data.payment_method,
        "payment_status": "pago",
        "price": final_amount,
        "concluded_at": datetime.now(timezone.utc).isoformat(),
        "concluded_by": user["id"]
    }
    if data.notes:
        update["notes"] = data.notes
    await db.appointments.update_one({"id": appointment_id}, {"$set": update})

    # Record financial transaction
    transaction = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "appointment_id": appointment_id,
        "type": "receita",
        "amount": final_amount,
        "payment_method": data.payment_method,
        "description": f"{apt.get('service_name','')} - {apt.get('customer_name','')}",
        "professional_id": apt.get("professional_id"),
        "professional_name": apt.get("professional_name"),
        "date": apt.get("date"),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.financial_transactions.insert_one(transaction)

    return await db.appointments.find_one({"id": appointment_id}, {"_id": 0})


# === FINANCIAL TRANSACTIONS ===
@router.get("/financial/transactions")
async def list_transactions(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
    start_date: str = None, end_date: str = None,
    payment_method: str = None
):
    query = {"company_id": user["company_id"]}
    if start_date:
        query["date"] = {"$gte": start_date}
    if end_date:
        query.setdefault("date", {})["$lte"] = end_date
    if payment_method:
        query["payment_method"] = payment_method
    txns = await db.financial_transactions.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return txns


@router.get("/financial/summary")
async def financial_summary(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
    start_date: str = None, end_date: str = None
):
    query = {"company_id": user["company_id"]}
    if start_date:
        query["date"] = {"$gte": start_date}
    if end_date:
        query.setdefault("date", {})["$lte"] = end_date
    
    txns = await db.financial_transactions.find(query, {"_id": 0}).to_list(5000)
    total = sum(t.get("amount", 0) for t in txns)
    by_method = {}
    for t in txns:
        m = t.get("payment_method", "outros")
        by_method[m] = by_method.get(m, 0) + t.get("amount", 0)
    
    return {
        "total_revenue": total,
        "transaction_count": len(txns),
        "by_payment_method": by_method,
        "transactions": txns[:50]
    }


# === PERMISSION PROFILES ===
class PermissionProfileCreate(BaseModel):
    name: str
    permissions: list  # list of permission keys

@router.get("/permission-profiles")
async def list_permission_profiles(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    profiles = await db.permission_profiles.find({"company_id": user["company_id"]}, {"_id": 0}).to_list(100)
    return profiles

@router.post("/permission-profiles")
async def create_permission_profile(
    data: PermissionProfileCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    profile = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "name": data.name,
        "permissions": data.permissions,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.permission_profiles.insert_one(profile)
    return {k: v for k, v in profile.items() if k != "_id"}

@router.put("/permission-profiles/{profile_id}")
async def update_permission_profile(
    profile_id: str,
    data: PermissionProfileCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    await db.permission_profiles.update_one(
        {"id": profile_id, "company_id": user["company_id"]},
        {"$set": {"name": data.name, "permissions": data.permissions}}
    )
    return await db.permission_profiles.find_one({"id": profile_id}, {"_id": 0})

@router.delete("/permission-profiles/{profile_id}")
async def delete_permission_profile(
    profile_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    await db.permission_profiles.delete_one({"id": profile_id, "company_id": user["company_id"]})
    return {"message": "Perfil deletado"}


# === COMPANY USERS (non-admin users linked to professionals) ===
from auth import get_password_hash, verify_password

ALL_SYSTEM_FEATURES = [
    {"feature_key": "dashboard", "label": "Inicio", "category": "Principal"},
    {"feature_key": "atendimentos", "label": "Atendimentos", "category": "CRM"},
    {"feature_key": "respostas_rapidas", "label": "Respostas Rapidas", "category": "CRM"},
    {"feature_key": "kanban", "label": "Kanban", "category": "CRM"},
    {"feature_key": "contatos", "label": "Contatos", "category": "CRM"},
    {"feature_key": "tags", "label": "Tags", "category": "CRM"},
    {"feature_key": "chat_interno", "label": "Chat Interno", "category": "CRM"},
    {"feature_key": "campanhas", "label": "Campanhas", "category": "CRM"},
    {"feature_key": "flowbuilder", "label": "Flowbuilder", "category": "CRM"},
    {"feature_key": "filas_chatbot", "label": "Filas & Chatbot", "category": "CRM"},
    {"feature_key": "agente_ia", "label": "Agente de IA", "category": "CRM"},
    {"feature_key": "conexoes", "label": "Conexoes", "category": "CRM"},
    {"feature_key": "calendario", "label": "Calendario", "category": "Operacional"},
    {"feature_key": "agenda", "label": "Agenda", "category": "Operacional"},
    {"feature_key": "agendamentos", "label": "Agendamento Msg", "category": "Operacional"},
    {"feature_key": "clientes", "label": "Clientes", "category": "Operacional"},
    {"feature_key": "categorias", "label": "Categorias", "category": "Catalogo"},
    {"feature_key": "servicos_produtos", "label": "Servicos e Produtos", "category": "Catalogo"},
    {"feature_key": "assinaturas", "label": "Assinaturas", "category": "Catalogo"},
    {"feature_key": "profissionais", "label": "Profissionais", "category": "Catalogo"},
    {"feature_key": "financeiro", "label": "Financeiro", "category": "Analise"},
    {"feature_key": "comissoes", "label": "Comissoes", "category": "Analise"},
    {"feature_key": "relatorios", "label": "Relatorios", "category": "Analise"},
    {"feature_key": "meu_site", "label": "Meu Site", "category": "Config Empresa"},
    {"feature_key": "notificacoes", "label": "Notificacoes", "category": "Config Empresa"},
    {"feature_key": "configuracoes", "label": "Configuracoes", "category": "Config Empresa"},
    {"feature_key": "indoor", "label": "Indoor / TV", "category": "Config Empresa"},
    {"feature_key": "usuarios", "label": "Usuarios", "category": "Administracao"},
    {"feature_key": "perfis_acesso", "label": "Perfis de Acesso", "category": "Administracao"},
    {"feature_key": "edit_appointment", "label": "Editar agendamento (hora/servico)", "category": "Permissoes"},
    {"feature_key": "edit_appointment_price", "label": "Alterar valor do agendamento", "category": "Permissoes"},
]

@router.get("/all-features")
async def list_all_features(user: dict = Depends(get_current_user)):
    """List all system features for permission profile editor."""
    return ALL_SYSTEM_FEATURES

class CompanyUserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str
    permission_profile_id: Optional[str] = None
    professional_id: Optional[str] = None

class CompanyUserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    permission_profile_id: Optional[str] = None
    professional_id: Optional[str] = None

@router.get("/company-users")
async def list_company_users(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    users = await db.company_users.find({"company_id": user["company_id"]}, {"_id": 0, "password": 0}).to_list(500)
    return users

@router.post("/company-users")
async def create_company_user(
    data: CompanyUserCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    existing = await db.company_users.find_one({"email": data.email})
    if existing:
        raise HTTPException(status_code=400, detail="Email ja cadastrado")
    new_user = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "name": data.name,
        "email": data.email,
        "password": get_password_hash(data.password),
        "role": "user",
        "permission_profile_id": data.permission_profile_id,
        "professional_id": data.professional_id,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.company_users.insert_one(new_user)
    return {k: v for k, v in new_user.items() if k not in ("_id", "password")}

@router.put("/company-users/{user_id}")
async def update_company_user(
    user_id: str,
    data: CompanyUserUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    existing = await db.company_users.find_one({"id": user_id, "company_id": user["company_id"]})
    if not existing:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado")
    update = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if "password" in update and update["password"]:
        update["password"] = get_password_hash(update["password"])
    if update:
        await db.company_users.update_one({"id": user_id}, {"$set": update})
    doc = await db.company_users.find_one({"id": user_id}, {"_id": 0, "password": 0})
    return doc

@router.delete("/company-users/{user_id}")
async def delete_company_user(
    user_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    existing = await db.company_users.find_one({"id": user_id, "company_id": user["company_id"]})
    if not existing:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado")
    if existing.get("role") == "company_admin":
        raise HTTPException(status_code=400, detail="Nao e possivel excluir o administrador")
    await db.company_users.delete_one({"id": user_id})
    return {"message": "Usuario excluido"}


@router.get("/calendar")
async def get_calendar(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
    start_date: str = None, end_date: str = None
):
    query = {"company_id": user["company_id"]}
    if start_date and end_date:
        query["date"] = {"$gte": start_date, "$lte": end_date}
    appointments = await db.appointments.find(query, {"_id": 0}).to_list(1000)
    return appointments

# === SERVICES ===
@router.get("/services")
async def list_services(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
    category_id: str = None, type: str = None
):
    query = {"company_id": user["company_id"]}
    if category_id:
        query["category_id"] = category_id
    if type:
        query["type"] = type
    services = await db.services.find(query, {"_id": 0}).to_list(1000)
    return services

@router.post("/services")
async def create_service(
    data: ServiceCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    service = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "name": data.name,
        "description": data.description,
        "category_id": data.category_id,
        "type": data.type,
        "duration": data.duration,
        "price": data.price,
        "is_active": True,
        "image_url": data.image_url,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.services.insert_one(service)
    return {k: v for k, v in service.items() if k != "_id"}

@router.put("/services/{service_id}")
async def update_service(
    service_id: str, data: ServiceUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    service = await db.services.find_one({"id": service_id, "company_id": user["company_id"]})
    if not service:
        raise HTTPException(status_code=404, detail="Servico nao encontrado")
    update_data = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if update_data:
        await db.services.update_one({"id": service_id}, {"$set": update_data})
    updated = await db.services.find_one({"id": service_id}, {"_id": 0})
    return updated

@router.delete("/services/{service_id}")
async def delete_service(
    service_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    result = await db.services.delete_one({"id": service_id, "company_id": user["company_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Servico nao encontrado")
    return {"message": "Servico deletado"}

# === PROFESSIONALS (ENHANCED) ===
@router.get("/professionals")
async def list_professionals(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
    search: str = None
):
    query = {"company_id": user["company_id"]}
    if search:
        query["name"] = {"$regex": search, "$options": "i"}
    professionals = await db.professionals.find(query, {"_id": 0}).to_list(1000)

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    for prof in professionals:
        appts_today = await db.appointments.count_documents({
            "company_id": user["company_id"],
            "professional_id": prof["id"],
            "date": today
        })
        prof["appointments_today"] = appts_today
        # Calculate commission
        completed = await db.appointments.find({
            "company_id": user["company_id"],
            "professional_id": prof["id"],
            "status": "concluido"
        }, {"_id": 0}).to_list(1000)
        total_revenue = sum(a.get("price", 0) for a in completed)
        commission_pct = prof.get("commission_percent", 0)
        prof["total_commission"] = total_revenue * commission_pct / 100
        prof["total_revenue"] = total_revenue

    return professionals

@router.get("/professionals/stats")
async def get_professionals_stats(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    total = await db.professionals.count_documents({"company_id": user["company_id"]})
    active = await db.professionals.count_documents({"company_id": user["company_id"], "is_active": True})
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    appts_today = await db.appointments.count_documents({"company_id": user["company_id"], "date": today})
    completed = await db.appointments.find({"company_id": user["company_id"], "status": "concluido"}, {"_id": 0}).to_list(10000)
    revenue = sum(a.get("price", 0) for a in completed)
    return {"total": total, "active": active, "revenue": revenue, "appointments_today": appts_today}

@router.post("/professionals")
async def create_professional(
    data: ProfessionalCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    professional = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "name": data.name,
        "email": data.email,
        "phone": data.phone,
        "specialties": data.specialties,
        "working_hours": data.working_hours or {
            "seg": {"start": "08:00", "end": "18:00", "active": True},
            "ter": {"start": "08:00", "end": "18:00", "active": True},
            "qua": {"start": "08:00", "end": "18:00", "active": True},
            "qui": {"start": "08:00", "end": "18:00", "active": True},
            "sex": {"start": "08:00", "end": "18:00", "active": True},
            "sab": {"start": "08:00", "end": "13:00", "active": True},
            "dom": {"start": "00:00", "end": "00:00", "active": False},
        },
        "suspensions": [],
        "is_active": True,
        "image_url": data.image_url,
        "commission_percent": 0,
        "rating": 5.0,
        "address": None,
        "notes": None,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.professionals.insert_one(professional)
    return {k: v for k, v in professional.items() if k != "_id"}

@router.put("/professionals/{professional_id}")
async def update_professional(
    professional_id: str, data: ProfessionalUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    professional = await db.professionals.find_one({"id": professional_id, "company_id": user["company_id"]})
    if not professional:
        raise HTTPException(status_code=404, detail="Profissional nao encontrado")
    update_data = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if update_data:
        await db.professionals.update_one({"id": professional_id}, {"$set": update_data})
    updated = await db.professionals.find_one({"id": professional_id}, {"_id": 0})
    return updated

@router.delete("/professionals/{professional_id}")
async def delete_professional(
    professional_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    result = await db.professionals.delete_one({"id": professional_id, "company_id": user["company_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Profissional nao encontrado")
    return {"message": "Profissional deletado"}

# === CATEGORIES ===
@router.get("/categories")
async def list_categories(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    categories = await db.categories.find({"company_id": user["company_id"]}, {"_id": 0}).to_list(1000)
    return categories

@router.post("/categories")
async def create_category(
    data: CategoryCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    category = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "name": data.name,
        "description": data.description,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.categories.insert_one(category)
    return {k: v for k, v in category.items() if k != "_id"}

# === CLIENTS ===
@router.get("/clients")
async def list_clients(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
    search: str = None
):
    query = {"company_id": user["company_id"]}
    if search:
        query["$or"] = [
            {"name": {"$regex": search, "$options": "i"}},
            {"phone": {"$regex": search, "$options": "i"}}
        ]
    clients = await db.clients.find(query, {"_id": 0}).to_list(1000)
    # Enrich with subscription info
    for client in clients:
        sub = await db.client_subscriptions.find_one({
            "company_id": user["company_id"],
            "client_phone": client["phone"],
            "status": "active"
        }, {"_id": 0})
        client["active_subscription"] = sub
    return clients

@router.post("/clients")
async def create_client(
    data: ClientCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    existing = await db.clients.find_one({"company_id": user["company_id"], "phone": data.phone})
    if existing:
        raise HTTPException(status_code=400, detail="Cliente com este telefone ja existe")
    client = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "name": data.name,
        "phone": data.phone,
        "email": data.email,
        "notes": data.notes,
        "total_appointments": 0,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.clients.insert_one(client)
    return {k: v for k, v in client.items() if k != "_id"}

@router.put("/clients/{client_id}")
async def update_client(
    client_id: str,
    data: ClientCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    update_data = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    await db.clients.update_one({"id": client_id, "company_id": user["company_id"]}, {"$set": update_data})
    return await db.clients.find_one({"id": client_id}, {"_id": 0})

@router.delete("/clients/{client_id}")
async def delete_client(
    client_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    result = await db.clients.delete_one({"id": client_id, "company_id": user["company_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Cliente nao encontrado")
    return {"message": "Cliente deletado"}



@router.get("/clients/lookup/{phone}")
async def lookup_client_by_phone(
    phone: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    client = await db.clients.find_one({"company_id": user["company_id"], "phone": phone}, {"_id": 0})
    if not client:
        return {"found": False}
    sub = await db.client_subscriptions.find_one({
        "company_id": user["company_id"],
        "client_phone": phone,
        "status": "active"
    }, {"_id": 0})
    if sub:
        plan = await db.subscription_plans.find_one({"id": sub["plan_id"]}, {"_id": 0})
        sub["plan"] = plan
    return {"found": True, "client": client, "subscription": sub}

# === SUBSCRIPTION PLANS ===
@router.get("/subscription-plans")
async def list_subscription_plans(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    plans = await db.subscription_plans.find({"company_id": user["company_id"]}, {"_id": 0}).to_list(1000)
    # Enrich with service names
    for plan in plans:
        service_names = []
        for sid in plan.get("included_service_ids", []):
            svc = await db.services.find_one({"id": sid}, {"_id": 0, "name": 1, "price": 1})
            if svc:
                service_names.append({"id": sid, "name": svc["name"], "price": svc.get("price", 0)})
        plan["included_services"] = service_names
    return plans

@router.post("/subscription-plans")
async def create_subscription_plan(
    data: SubscriptionPlanCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    plan = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "name": data.name,
        "price": data.price,
        "visits_per_month": data.visits_per_month,
        "included_service_ids": data.included_service_ids,
        "description": data.description,
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.subscription_plans.insert_one(plan)
    return {k: v for k, v in plan.items() if k != "_id"}

@router.delete("/subscription-plans/{plan_id}")
async def delete_subscription_plan(
    plan_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    result = await db.subscription_plans.delete_one({"id": plan_id, "company_id": user["company_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Plano nao encontrado")
    return {"message": "Plano deletado"}

# === CLIENT SUBSCRIPTIONS ===
@router.get("/subscriptions")
async def list_subscriptions(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    subs = await db.client_subscriptions.find({"company_id": user["company_id"]}, {"_id": 0}).to_list(1000)
    for sub in subs:
        plan = await db.subscription_plans.find_one({"id": sub["plan_id"]}, {"_id": 0})
        sub["plan_name"] = plan["name"] if plan else "Desconhecido"
        sub["plan_price"] = plan["price"] if plan else 0
        sub["visits_per_month"] = plan["visits_per_month"] if plan else 0
    return subs

@router.post("/subscriptions")
async def create_subscription(
    data: ClientSubscriptionCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    plan = await db.subscription_plans.find_one({"id": data.plan_id, "company_id": user["company_id"]})
    if not plan:
        raise HTTPException(status_code=404, detail="Plano nao encontrado")
    client = await db.clients.find_one({"company_id": user["company_id"], "phone": data.client_phone})
    if not client:
        raise HTTPException(status_code=404, detail="Cliente nao encontrado")

    # Check existing active sub
    existing = await db.client_subscriptions.find_one({
        "company_id": user["company_id"],
        "client_phone": data.client_phone,
        "status": "active"
    })
    if existing:
        raise HTTPException(status_code=400, detail="Cliente ja possui assinatura ativa")

    now = datetime.now(timezone.utc)
    next_billing = (now + timedelta(days=30)).isoformat()

    sub = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "client_phone": data.client_phone,
        "client_name": client["name"],
        "plan_id": data.plan_id,
        "status": "active",
        "credits_remaining": plan["visits_per_month"],
        "next_billing_date": next_billing,
        "created_at": now.isoformat()
    }
    await db.client_subscriptions.insert_one(sub)
    return {k: v for k, v in sub.items() if k != "_id"}

@router.delete("/subscriptions/{sub_id}")
async def cancel_subscription(
    sub_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    await db.client_subscriptions.update_one(
        {"id": sub_id, "company_id": user["company_id"]},
        {"$set": {"status": "cancelled"}}
    )
    return {"message": "Assinatura cancelada"}

# === BOOKING PAGE ===
@router.get("/booking-page")
async def get_booking_page(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    page = await db.booking_pages.find_one({"company_id": user["company_id"]}, {"_id": 0})
    return page or {}

@router.put("/booking-page")
async def update_booking_page(
    data: BookingPageUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    page = await db.booking_pages.find_one({"company_id": user["company_id"]})
    update_data = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if page:
        if update_data:
            await db.booking_pages.update_one({"company_id": user["company_id"]}, {"$set": update_data})
    else:
        company = await db.companies.find_one({"id": user["company_id"]})
        slug = company["name"].lower().replace(" ", "").replace(".", "")[:20]
        new_page = {
            "id": str(uuid.uuid4()),
            "company_id": user["company_id"],
            "slug": slug,
            "is_active": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
            **update_data
        }
        await db.booking_pages.insert_one(new_page)
    updated_page = await db.booking_pages.find_one({"company_id": user["company_id"]}, {"_id": 0})
    return updated_page

# === ONBOARDING ===
@router.get("/onboarding-status")
async def get_onboarding_status(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    company_id = user["company_id"]
    services_count = await db.services.count_documents({"company_id": company_id})
    professionals_count = await db.professionals.count_documents({"company_id": company_id})
    booking_page = await db.booking_pages.find_one({"company_id": company_id}, {"_id": 0})
    company = await db.companies.find_one({"id": company_id}, {"_id": 0})
    onboarding_done = company.get("onboarding_done", False) if company else False
    return {
        "onboarding_done": onboarding_done,
        "steps": {
            "company_configured": bool(company and company.get("theme_colors")),
            "has_services": services_count > 0,
            "has_professionals": professionals_count > 0,
            "has_booking_page": bool(booking_page and booking_page.get("slug")),
        },
        "services_count": services_count,
        "professionals_count": professionals_count,
    }

@router.post("/onboarding-complete")
async def complete_onboarding(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    await db.companies.update_one({"id": user["company_id"]}, {"$set": {"onboarding_done": True}})
    return {"message": "Onboarding completed"}

# === BUSINESS HOURS ===
class BusinessHoursUpdate(BaseModel):
    hours: dict  # {"seg": {"start":"08:00","end":"18:00","active":true}, ...}

@router.get("/business-hours")
async def get_business_hours(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    company = await db.companies.find_one({"id": user["company_id"]}, {"_id": 0})
    default_hours = {
        "seg": {"start": "08:00", "end": "18:00", "active": True},
        "ter": {"start": "08:00", "end": "18:00", "active": True},
        "qua": {"start": "08:00", "end": "18:00", "active": True},
        "qui": {"start": "08:00", "end": "18:00", "active": True},
        "sex": {"start": "08:00", "end": "18:00", "active": True},
        "sab": {"start": "08:00", "end": "13:00", "active": True},
        "dom": {"start": "00:00", "end": "00:00", "active": False},
    }
    return company.get("business_hours", default_hours) if company else default_hours

@router.put("/business-hours")
async def update_business_hours(
    data: BusinessHoursUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    await db.companies.update_one({"id": user["company_id"]}, {"$set": {"business_hours": data.hours}})
    return data.hours

# === PROFESSIONAL SUSPENSIONS ===
class SuspensionCreate(BaseModel):
    start_date: str
    end_date: str
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    reason: Optional[str] = None

@router.post("/professionals/{professional_id}/suspensions")
async def add_suspension(
    professional_id: str,
    data: SuspensionCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    prof = await db.professionals.find_one({"id": professional_id, "company_id": user["company_id"]})
    if not prof:
        raise HTTPException(status_code=404, detail="Profissional nao encontrado")
    suspension = {
        "id": str(uuid.uuid4()),
        "start_date": data.start_date,
        "end_date": data.end_date,
        "start_time": data.start_time,
        "end_time": data.end_time,
        "reason": data.reason,
    }
    await db.professionals.update_one({"id": professional_id}, {"$push": {"suspensions": suspension}})
    return suspension

@router.delete("/professionals/{professional_id}/suspensions/{suspension_id}")
async def remove_suspension(
    professional_id: str,
    suspension_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    await db.professionals.update_one(
        {"id": professional_id, "company_id": user["company_id"]},
        {"$pull": {"suspensions": {"id": suspension_id}}}
    )
    return {"message": "Suspensao removida"}

# === INDOOR DISPLAY ===
class IndoorSettingsUpdate(BaseModel):
    enabled: Optional[bool] = None
    slide_duration: Optional[int] = None  # seconds
    media_links: Optional[List[str]] = None  # URLs to images/videos

@router.get("/indoor")
async def get_indoor_settings(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    settings = await db.indoor_settings.find_one({"company_id": user["company_id"]}, {"_id": 0})
    if not settings:
        settings = {
            "company_id": user["company_id"],
            "enabled": True,
            "slide_duration": 10,
            "media_links": [],
        }
    return settings

@router.put("/indoor")
async def update_indoor_settings(
    data: IndoorSettingsUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    company_id = user["company_id"]
    existing = await db.indoor_settings.find_one({"company_id": company_id})
    update_data = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if existing:
        await db.indoor_settings.update_one({"company_id": company_id}, {"$set": update_data})
    else:
        await db.indoor_settings.insert_one({
            "id": str(uuid.uuid4()),
            "company_id": company_id,
            "enabled": True,
            "slide_duration": 10,
            "media_links": [],
            **update_data
        })
    return await db.indoor_settings.find_one({"company_id": company_id}, {"_id": 0})

# === SMART AVAILABILITY HELPERS ===
def parse_date_to_day_key(date_str: str) -> str:
    """Convert date string to Portuguese day key."""
    day_map = {0: "seg", 1: "ter", 2: "qua", 3: "qui", 4: "sex", 5: "sab", 6: "dom"}
    from datetime import date as date_type
    parts = date_str.split("-")
    d = date_type(int(parts[0]), int(parts[1]), int(parts[2]))
    return day_map[d.weekday()]


def is_professional_suspended(prof: dict, date_str: str) -> bool:
    """Check if a professional has a FULL-DAY suspension on given date."""
    for sus in prof.get("suspensions", []):
        if sus["start_date"] <= date_str <= sus["end_date"]:
            # Only counts as suspended-all-day if no time window is defined
            if not sus.get("start_time") or not sus.get("end_time"):
                return True
    return False


def get_suspension_intervals(prof: dict, date_str: str) -> list:
    """Get time intervals (in minutes) when professional is suspended on a specific date.
    Returns list of (start_min, end_min) tuples."""
    intervals = []
    for sus in prof.get("suspensions", []):
        if sus["start_date"] <= date_str <= sus["end_date"]:
            st = sus.get("start_time")
            et = sus.get("end_time")
            if st and et:
                sh, sm = map(int, st.split(":"))
                eh, em = map(int, et.split(":"))
                intervals.append((sh * 60 + sm, eh * 60 + em))
    return intervals


def get_working_hours(prof: dict, day_key: str, biz_start: str, biz_end: str):
    """Get professional working hours, falling back to business hours."""
    prof_hours = (prof.get("working_hours") or {}).get(day_key)
    if prof_hours:
        if not prof_hours.get("active", True):
            return None
        return prof_hours["start"], prof_hours["end"]
    return biz_start, biz_end


def calculate_available_slots(start: str, end: str, duration: int, booked: list) -> set:
    """Generate available time slots given start/end hours, duration and booked intervals."""
    start_h, start_m = map(int, start.split(":"))
    end_h, end_m = map(int, end.split(":"))
    start_min = start_h * 60 + start_m
    end_min = end_h * 60 + end_m
    slots = set()
    current = start_min
    while current + duration <= end_min:
        slot_end = current + duration
        conflict = any(not (slot_end <= bs or current >= be) for bs, be in booked)
        if not conflict:
            h, m = divmod(current, 60)
            slots.add(f"{h:02d}:{m:02d}")
        current += 30
    return slots


async def get_booked_intervals(db, company_id: str, professional_id: str, date_str: str) -> list:
    """Get booked time intervals for a professional on a date."""
    existing = await db.appointments.find({
        "company_id": company_id,
        "professional_id": professional_id,
        "date": date_str,
        "status": {"$nin": ["cancelado"]}
    }, {"_id": 0}).to_list(1000)
    booked = []
    for apt in existing:
        apt_h, apt_m = map(int, apt["time"].split(":"))
        apt_start = apt_h * 60 + apt_m
        booked.append((apt_start, apt_start + apt.get("duration", 30)))
    return booked


# === SMART AVAILABILITY ===
@router.get("/smart-availability")
async def get_smart_availability(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
    professional_id: str = None,
    date: str = None,
    service_id: str = None
):
    if not date:
        raise HTTPException(status_code=400, detail="Data obrigatoria")

    company_id = user["company_id"]
    company = await db.companies.find_one({"id": company_id}, {"_id": 0})
    day_key = parse_date_to_day_key(date)

    biz_hours = company.get("business_hours", {}).get(day_key, {"start": "08:00", "end": "18:00", "active": True})
    if not biz_hours.get("active", True):
        return {"date": date, "available_slots": [], "reason": "Estabelecimento fechado"}

    duration = 30
    if service_id:
        service = await db.services.find_one({"id": service_id, "company_id": company_id})
        if service:
            duration = service.get("duration", 30)

    if professional_id and professional_id != "all":
        prof_ids = [professional_id]
    else:
        profs = await db.professionals.find({"company_id": company_id, "is_active": True}, {"_id": 0}).to_list(100)
        prof_ids = [p["id"] for p in profs]

    all_slots = set()
    for pid in prof_ids:
        prof = await db.professionals.find_one({"id": pid}, {"_id": 0})
        if not prof or not prof.get("is_active", True):
            continue
        if is_professional_suspended(prof, date):
            continue

        hours = get_working_hours(prof, day_key, biz_hours["start"], biz_hours["end"])
        if not hours:
            continue

        booked = await get_booked_intervals(db, company_id, pid, date)
        # Add partial-day suspensions as blocked intervals
        booked.extend(get_suspension_intervals(prof, date))
        all_slots |= calculate_available_slots(hours[0], hours[1], duration, booked)

    return {"date": date, "available_slots": sorted(all_slots), "duration": duration}
