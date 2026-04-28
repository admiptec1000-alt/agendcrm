from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase
from database import get_database
from auth import get_current_user
from models import (
    AppointmentCreate, AppointmentUpdate, ServiceCreate, ServiceUpdate,
    ProfessionalCreate, ProfessionalUpdate, CategoryCreate,
    BookingPageUpdate, AppointmentStatus
)
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, EmailStr

router = APIRouter(prefix="/scheduling", tags=["scheduling"])
logger = logging.getLogger(__name__)

# === EXTRA MODELS ===
class SubscriptionPlanItem(BaseModel):
    service_id: str
    credits_per_use: int = 1

class SubscriptionPlanCreate(BaseModel):
    name: str
    price: float
    cycle_days: int = 30
    total_credits: int
    items: List[SubscriptionPlanItem] = []  # detailed per-service credits
    included_service_ids: List[str] = []  # legacy fallback
    description: Optional[str] = None
    # Weekdays the plan can be redeemed. 0=Sunday .. 6=Saturday.
    # Empty/None means "any day".
    valid_weekdays: Optional[List[int]] = None

class ClientSubscriptionCreate(BaseModel):
    client_phone: str
    plan_id: str

class ClientCreate(BaseModel):
    name: str
    phone: str
    email: Optional[str] = None
    birth_date: Optional[str] = None  # YYYY-MM-DD
    notes: Optional[str] = None
    person_type: Optional[str] = "fisica"  # fisica | juridica
    cpf: Optional[str] = None
    cnpj: Optional[str] = None

def _calc_sub_status(sub: dict) -> str:
    """Determine if subscription is active or expired based on end_date and credits."""
    if sub.get("status") == "cancelled":
        return "cancelled"
    end = sub.get("end_date")
    if end:
        try:
            end_dt = datetime.fromisoformat(end.replace("Z", "+00:00"))
            if datetime.now(timezone.utc) > end_dt:
                return "expired"
        except Exception:
            pass
    if sub.get("credits_remaining", 0) <= 0:
        return "expired"
    return "active"


async def _load_user_perms(db: AsyncIOMotorDatabase, user: dict) -> list:
    """Return the list of permission feature_keys granted to this user via
    permission_profile_id. Admins get ['*'] implicitly (callers should check
    is_admin separately). Expands legacy verb-like permissions too."""
    if user.get("role") in ("company_admin", "super_admin"):
        return ["*"]
    pid = user.get("permission_profile_id")
    if not pid:
        return []
    pp = await db.permission_profiles.find_one(
        {"id": pid, "company_id": user["company_id"]},
        {"_id": 0, "permissions": 1}
    )
    raw = (pp or {}).get("permissions", []) or []
    # Inline expansion of legacy aliases (kept in sync with auth_routes)
    aliases = {
        "ver_proprios_atendimentos": ["dashboard", "agenda", "own_appointments_only"],
        "concluir_atendimento": ["agenda"],
        "registrar_pagamento": ["agenda", "financeiro"],
    }
    out = set(raw)
    for p in list(out):
        if p in aliases:
            out.update(aliases[p])
    return sorted(out)


async def _resolve_own_professional_id(db: AsyncIOMotorDatabase, user: dict) -> Optional[str]:
    """Return the professional_id linked to this user (by email)."""
    my = await db.professionals.find_one(
        {"company_id": user["company_id"], "email": user.get("email")},
        {"_id": 0, "id": 1}
    )
    return (my or {}).get("id")


def _plan_allows_weekday(plan: dict, date_str: str) -> bool:
    """Check if the plan can be used on the weekday of date_str (YYYY-MM-DD).
    Uses 0=Sunday .. 6=Saturday to match the UI toggles."""
    valid = plan.get("valid_weekdays")
    if not valid:  # None or empty => any day
        return True
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        # Python's weekday(): Mon=0..Sun=6. Convert to Sun=0..Sat=6.
        wd = (dt.weekday() + 1) % 7
        return wd in set(valid)
    except Exception:
        return True

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
    # Non-admin: optionally restrict to own appointments when the profile has
    # the 'own_appointments_only' permission. Fail-closed if the permission is
    # set but the user has no linked professional.
    is_admin = user.get("role") in ("company_admin", "super_admin")
    if not is_admin:
        perms = await _load_user_perms(db, user)
        if "own_appointments_only" in perms:
            my_prof_id = await _resolve_own_professional_id(db, user)
            if not my_prof_id:
                return []
            query["professional_id"] = my_prof_id
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

    # Check client subscription (active + not expired + has credits for this service)
    # Only debits credits when the caller explicitly opted-in via use_subscription=True
    price = service["price"]
    subscription_applied = False
    want_sub = bool(getattr(data, "use_subscription", False))
    client_sub = await db.client_subscriptions.find_one({
        "company_id": user["company_id"],
        "client_phone": data.customer_phone,
        "status": "active"
    })
    if want_sub and client_sub and _calc_sub_status(client_sub) == "active":
        plan = await db.subscription_plans.find_one({"id": client_sub["plan_id"]})
        if plan and not _plan_allows_weekday(plan, data.date):
            # Plan doesn't cover this weekday. Silently fall back to normal price
            # so the client can still book — but the subscription is not debited.
            plan = None
        if plan:
            # Find credits_per_use for this service
            cost = None
            for item in plan.get("items", []):
                if item.get("service_id") == data.service_id:
                    cost = item.get("credits_per_use", 1)
                    break
            # Fallback: legacy included_service_ids with 1 credit each
            if cost is None and data.service_id in plan.get("included_service_ids", []):
                cost = 1
            if cost is not None and client_sub.get("credits_remaining", 0) >= cost:
                price = 0.0
                subscription_applied = True
                await db.client_subscriptions.update_one(
                    {"id": client_sub["id"]},
                    {"$inc": {"credits_remaining": -cost, "credits_used": cost}}
                )
                # Expire if runs out
                updated = await db.client_subscriptions.find_one({"id": client_sub["id"]})
                if updated and updated.get("credits_remaining", 0) <= 0:
                    await db.client_subscriptions.update_one(
                        {"id": client_sub["id"]}, {"$set": {"status": "expired"}}
                    )
            elif cost is None:
                raise HTTPException(status_code=400, detail="Servico nao coberto pela assinatura do cliente")
            else:
                raise HTTPException(status_code=400, detail=f"Creditos insuficientes (necessarios: {cost})")

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
        "confirm_token": str(uuid.uuid4()),
        "cancel_token": str(uuid.uuid4()),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.appointments.insert_one(appointment)

    # Send WhatsApp welcome notification (fire-and-forget).
    # IMPORTANT: status stays PENDENTE until the client clicks the confirm link
    # included in the reminder message.
    try:
        from notifications import notify_appointment_created
        import os as _os
        base_url = _os.environ.get("FRONTEND_PUBLIC_URL", "")
        page = await db.booking_pages.find_one({"company_id": user["company_id"]}, {"_id": 0, "slug": 1})
        slug = (page or {}).get("slug", "")
        sent = await notify_appointment_created(db, user["company_id"], appointment, base_url, slug)
        if sent:
            await db.appointments.update_one(
                {"id": appointment_id},
                {"$set": {"whatsapp_notified_at": datetime.now(timezone.utc).isoformat()}}
            )
    except Exception as e:
        logger.warning(f"Failed to notify appointment {appointment_id}: {e}")

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
    perms = []
    is_admin = user.get("role") in ("company_admin", "super_admin")
    if not is_admin:
        perms = await _load_user_perms(db, user)
        # own_appointments_only: cannot touch appointments of other professionals
        if "own_appointments_only" in perms:
            my_prof_id = await _resolve_own_professional_id(db, user)
            if not my_prof_id or appointment.get("professional_id") != my_prof_id:
                raise HTTPException(status_code=403, detail="Voce so pode editar seus proprios agendamentos")
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
        # Only auto-fill price if caller didn't pass one AND has permission for price
        has_price_perm = is_admin or "edit_appointment_price" in perms
        if "price" not in update_data and has_price_perm:
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


# === MANUAL REMINDER (uses 'lembrete' template with link_confirmar) ===
@router.post("/appointments/{appointment_id}/send-reminder")
async def send_appointment_reminder(
    appointment_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    apt = await db.appointments.find_one(
        {"id": appointment_id, "company_id": user["company_id"]}, {"_id": 0}
    )
    if not apt:
        raise HTTPException(status_code=404, detail="Agendamento nao encontrado")
    if apt.get("status") in ["cancelado", "concluido"]:
        raise HTTPException(status_code=400, detail="Agendamento ja finalizado")

    try:
        from notifications import notify_appointment_reminder
        import os as _os
        base_url = _os.environ.get("FRONTEND_PUBLIC_URL", "")
        sent = await notify_appointment_reminder(db, user["company_id"], apt, base_url)
        if not sent:
            raise HTTPException(status_code=502, detail="Nao foi possivel enviar o lembrete. Verifique a conexao do WhatsApp.")
        return {"message": "Lembrete enviado!"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error sending reminder: {e}")
        raise HTTPException(status_code=500, detail=f"Erro ao enviar lembrete: {str(e)}")



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

    # Permission checks for non-admins
    is_admin = user.get("role") in ("company_admin", "super_admin")
    perms = [] if is_admin else await _load_user_perms(db, user)

    if not is_admin and "own_appointments_only" in perms:
        my_prof_id = await _resolve_own_professional_id(db, user)
        if not my_prof_id or apt.get("professional_id") != my_prof_id:
            raise HTTPException(status_code=403, detail="Voce so pode concluir seus proprios atendimentos")

    # Permission check for final_price override
    if data.final_price is not None and not is_admin:
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
    # Generate review token if not already present (used by satisfaction survey link)
    if not apt.get("review_token"):
        update["review_token"] = str(uuid.uuid4())
    await db.appointments.update_one({"id": appointment_id}, {"$set": update})

    # Record financial transaction
    transaction = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "appointment_id": appointment_id,
        "type": "receita",
        "direction": "entrada",
        "status": "pago",
        "amount": final_amount,
        "payment_method": data.payment_method,
        "description": f"{apt.get('service_name','')} - {apt.get('customer_name','')}",
        "category": "servico",
        "professional_id": apt.get("professional_id"),
        "professional_name": apt.get("professional_name"),
        "date": apt.get("date"),
        "due_date": apt.get("date"),
        "paid_at": datetime.now(timezone.utc).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.financial_transactions.insert_one(transaction)

    return await db.appointments.find_one({"id": appointment_id}, {"_id": 0})


# === FINANCIAL TRANSACTIONS ===
# === FINANCIAL TRANSACTIONS ===
class TransactionCreate(BaseModel):
    direction: str  # 'entrada' | 'saida'
    description: str
    amount: float
    payment_method: Optional[str] = None  # dinheiro, pix, cartao_credito, cartao_debito, outros
    category: Optional[str] = None  # servico, fornecedor, salario, aluguel, conta, outros
    date: str  # ISO date when actually happened OR when registered
    due_date: Optional[str] = None  # vencimento for accounts payable/receivable
    status: str = "pago"  # 'pago' | 'pendente'
    notes: Optional[str] = None


class TransactionUpdate(BaseModel):
    direction: Optional[str] = None
    description: Optional[str] = None
    amount: Optional[float] = None
    payment_method: Optional[str] = None
    category: Optional[str] = None
    date: Optional[str] = None
    due_date: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None


@router.get("/financial/transactions")
async def list_transactions(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
    start_date: str = None, end_date: str = None,
    payment_method: str = None,
    direction: str = None,
    status: str = None
):
    query = {"company_id": user["company_id"]}
    if start_date:
        query["date"] = {"$gte": start_date}
    if end_date:
        query.setdefault("date", {})["$lte"] = end_date
    if payment_method:
        query["payment_method"] = payment_method
    if direction:
        query["direction"] = direction
    if status:
        query["status"] = status
    txns = await db.financial_transactions.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    fees = await _get_payment_fees(db, user["company_id"])
    for t in txns:
        gross = float(t.get("amount", 0) or 0)
        # Backfill defaults for legacy records
        t.setdefault("direction", "entrada")
        t.setdefault("status", "pago")
        fee_amount = _calc_fee(gross, t.get("payment_method", ""), fees) if t.get("direction") == "entrada" else 0.0
        t["gross_amount"] = round(gross, 2)
        t["fee_amount"] = round(fee_amount, 2)
        t["net_amount"] = round(gross - fee_amount, 2)
    return txns


@router.post("/financial/transactions")
async def create_transaction(
    data: TransactionCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    if data.direction not in ("entrada", "saida"):
        raise HTTPException(status_code=400, detail="direction deve ser 'entrada' ou 'saida'")
    if data.status not in ("pago", "pendente"):
        raise HTTPException(status_code=400, detail="status deve ser 'pago' ou 'pendente'")

    txn = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "type": "receita" if data.direction == "entrada" else "despesa",
        "direction": data.direction,
        "status": data.status,
        "amount": float(data.amount or 0),
        "payment_method": data.payment_method or "outros",
        "category": data.category or "outros",
        "description": data.description,
        "date": data.date,
        "due_date": data.due_date or data.date,
        "notes": data.notes,
        "manual": True,
        "created_by": user["id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if data.status == "pago":
        txn["paid_at"] = datetime.now(timezone.utc).isoformat()
    await db.financial_transactions.insert_one(txn)
    return {k: v for k, v in txn.items() if k != "_id"}


@router.put("/financial/transactions/{txn_id}")
async def update_transaction(
    txn_id: str,
    data: TransactionUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    update = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if "amount" in update:
        update["amount"] = float(update["amount"] or 0)
    if "status" in update and update["status"] == "pago":
        update["paid_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.financial_transactions.update_one(
        {"id": txn_id, "company_id": user["company_id"]},
        {"$set": update}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Lancamento nao encontrado")
    return await db.financial_transactions.find_one({"id": txn_id}, {"_id": 0})


@router.post("/financial/transactions/{txn_id}/pay")
async def mark_transaction_paid(
    txn_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    result = await db.financial_transactions.update_one(
        {"id": txn_id, "company_id": user["company_id"]},
        {"$set": {"status": "pago", "paid_at": datetime.now(timezone.utc).isoformat()}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Lancamento nao encontrado")
    return await db.financial_transactions.find_one({"id": txn_id}, {"_id": 0})


@router.delete("/financial/transactions/{txn_id}")
async def delete_transaction(
    txn_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    result = await db.financial_transactions.delete_one({"id": txn_id, "company_id": user["company_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Lancamento nao encontrado")
    return {"message": "Lancamento removido"}


# === PAYMENT FEES (taxas por forma de pagamento) ===
class PaymentFeesUpdate(BaseModel):
    pix_pct: Optional[float] = 0.0
    pix_fixed: Optional[float] = 0.0
    credit_pct: Optional[float] = 0.0
    credit_fixed: Optional[float] = 0.0
    debit_pct: Optional[float] = 0.0
    debit_fixed: Optional[float] = 0.0


def _empty_fees() -> dict:
    return {
        "pix_pct": 0.0, "pix_fixed": 0.0,
        "credit_pct": 0.0, "credit_fixed": 0.0,
        "debit_pct": 0.0, "debit_fixed": 0.0,
    }


async def _get_payment_fees(db: AsyncIOMotorDatabase, company_id: str) -> dict:
    doc = await db.payment_fees.find_one({"company_id": company_id}, {"_id": 0})
    if not doc:
        return _empty_fees()
    out = _empty_fees()
    out.update({k: float(doc.get(k) or 0) for k in out.keys()})
    return out


def _calc_fee(amount: float, payment_method: str, fees: dict) -> float:
    if not amount or amount <= 0:
        return 0.0
    pm = (payment_method or "").lower()
    if pm == "pix":
        return amount * (fees.get("pix_pct", 0) / 100.0) + fees.get("pix_fixed", 0)
    if pm == "cartao_credito":
        return amount * (fees.get("credit_pct", 0) / 100.0) + fees.get("credit_fixed", 0)
    if pm == "cartao_debito":
        return amount * (fees.get("debit_pct", 0) / 100.0) + fees.get("debit_fixed", 0)
    return 0.0


@router.get("/financial/payment-fees")
async def get_payment_fees(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    return await _get_payment_fees(db, user["company_id"])


@router.put("/financial/payment-fees")
async def update_payment_fees(
    data: PaymentFeesUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    payload = {k: float(v or 0) for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    # Clamp negative values
    for k in payload:
        if payload[k] < 0:
            payload[k] = 0.0
    existing = await db.payment_fees.find_one({"company_id": user["company_id"]})
    if existing:
        await db.payment_fees.update_one(
            {"company_id": user["company_id"]},
            {"$set": payload}
        )
    else:
        doc = {"id": str(uuid.uuid4()), "company_id": user["company_id"], **_empty_fees(), **payload}
        await db.payment_fees.insert_one(doc)
    return await _get_payment_fees(db, user["company_id"])

@router.get("/client-subscription-lookup")
async def lookup_client_subscription(
    phone: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    """Return the active subscription of a client (by phone) for this company.
    Used by the admin Agenda screen to decide whether to debit credits.
    """
    if not phone:
        return {"has_subscription": False}
    sub = await db.client_subscriptions.find_one(
        {"company_id": user["company_id"], "client_phone": phone, "status": "active"},
        {"_id": 0}
    )
    if not sub or _calc_sub_status(sub) != "active":
        return {"has_subscription": False}
    plan = await db.subscription_plans.find_one({"id": sub["plan_id"]}, {"_id": 0})
    return {
        "has_subscription": True,
        "subscription": sub,
        "plan": plan,
    }


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
    fees = await _get_payment_fees(db, user["company_id"])

    # Receita = entradas pagas
    total_gross = 0.0
    total_fee = 0.0
    by_method_gross = {}
    by_method_fee = {}
    by_method_net = {}
    # Despesas pagas
    total_expenses = 0.0
    # A receber (entradas pendentes) e A pagar (saidas pendentes)
    total_receivable = 0.0
    total_payable = 0.0

    for t in txns:
        # Backfill legacy records as paid income
        direction = t.get("direction", "entrada")
        status = t.get("status", "pago")
        amount = float(t.get("amount", 0) or 0)

        if direction == "entrada" and status == "pago":
            method = t.get("payment_method", "outros")
            fee_amount = _calc_fee(amount, method, fees)
            net = amount - fee_amount
            total_gross += amount
            total_fee += fee_amount
            by_method_gross[method] = by_method_gross.get(method, 0) + amount
            by_method_fee[method] = by_method_fee.get(method, 0) + fee_amount
            by_method_net[method] = by_method_net.get(method, 0) + net
            t["gross_amount"] = round(amount, 2)
            t["fee_amount"] = round(fee_amount, 2)
            t["net_amount"] = round(net, 2)
        elif direction == "saida" and status == "pago":
            total_expenses += amount
            t["gross_amount"] = round(amount, 2)
            t["fee_amount"] = 0.0
            t["net_amount"] = round(amount, 2)
        elif direction == "entrada" and status == "pendente":
            total_receivable += amount
        elif direction == "saida" and status == "pendente":
            total_payable += amount

    paid_txns = [t for t in txns if t.get("status", "pago") == "pago"]

    return {
        "total_revenue": round(total_gross, 2),  # legacy/back-compat
        "total_gross": round(total_gross, 2),
        "total_fee": round(total_fee, 2),
        "total_net": round(total_gross - total_fee, 2),
        "total_expenses": round(total_expenses, 2),
        "total_profit": round((total_gross - total_fee) - total_expenses, 2),
        "total_receivable": round(total_receivable, 2),
        "total_payable": round(total_payable, 2),
        "transaction_count": len(paid_txns),
        "by_payment_method": {k: round(v, 2) for k, v in by_method_gross.items()},  # legacy
        "by_payment_method_gross": {k: round(v, 2) for k, v in by_method_gross.items()},
        "by_payment_method_fee": {k: round(v, 2) for k, v in by_method_fee.items()},
        "by_payment_method_net": {k: round(v, 2) for k, v in by_method_net.items()},
        "fees": fees,
        "transactions": txns[:50],
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
    {"feature_key": "planos", "label": "Planos", "category": "Catalogo"},
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
    {"feature_key": "own_appointments_only", "label": "Ver/concluir somente os proprios agendamentos", "category": "Permissoes"},
]

@router.get("/all-features")
async def list_all_features(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    """List features for permission profile editor.
    Returns only features ENABLED by the Super Admin for this company's business type.
    Permission-only features (edit_appointment*) are always included regardless of features toggle.
    """
    permission_only_keys = {"edit_appointment", "edit_appointment_price", "own_appointments_only"}

    # Load company features (set by Super Admin toggles)
    company = await db.companies.find_one({"id": user["company_id"]}, {"_id": 0, "features": 1})
    enabled_keys = set()
    for f in (company or {}).get("features", []):
        if f.get("enabled"):
            enabled_keys.add(f["feature_key"])

    return [
        f for f in ALL_SYSTEM_FEATURES
        if f["feature_key"] in enabled_keys or f["feature_key"] in permission_only_keys
    ]

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
        "cost": data.cost,
        "is_active": True,
        "image_url": data.image_url,
        "commission_percent": data.commission_percent,
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


@router.put("/categories/{category_id}")
async def update_category(
    category_id: str,
    data: CategoryCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    updated = {
        "name": data.name,
        "description": data.description,
    }
    result = await db.categories.update_one(
        {"id": category_id, "company_id": user["company_id"]},
        {"$set": updated}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Categoria nao encontrada")
    category = await db.categories.find_one(
        {"id": category_id, "company_id": user["company_id"]}, {"_id": 0}
    )
    return category


@router.delete("/categories/{category_id}")
async def delete_category(
    category_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    # If any service still references this category, clear the link instead of
    # failing, so the admin isn't blocked by legacy data.
    await db.services.update_many(
        {"company_id": user["company_id"], "category_id": category_id},
        {"$set": {"category_id": None}}
    )
    result = await db.categories.delete_one(
        {"id": category_id, "company_id": user["company_id"]}
    )
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Categoria nao encontrada")
    return {"ok": True}

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
        "birth_date": data.birth_date,
        "notes": data.notes,
        "person_type": data.person_type or "fisica",
        "cpf": data.cpf,
        "cnpj": data.cnpj,
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
    items = [it.model_dump() for it in data.items]
    # Derive included_service_ids from items for backward compat
    if items and not data.included_service_ids:
        included_ids = [i["service_id"] for i in items]
    else:
        included_ids = data.included_service_ids
    plan = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "name": data.name,
        "price": data.price,
        "cycle_days": data.cycle_days,
        "total_credits": data.total_credits,
        "visits_per_month": data.total_credits,  # legacy alias
        "items": items,
        "included_service_ids": included_ids,
        "description": data.description,
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.subscription_plans.insert_one(plan)
    return {k: v for k, v in plan.items() if k != "_id"}

class SubscriptionPlanUpdate(BaseModel):
    name: Optional[str] = None
    price: Optional[float] = None
    cycle_days: Optional[int] = None
    total_credits: Optional[int] = None
    items: Optional[List[SubscriptionPlanItem]] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None
    valid_weekdays: Optional[List[int]] = None

@router.put("/subscription-plans/{plan_id}")
async def update_subscription_plan(
    plan_id: str,
    data: SubscriptionPlanUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    plan = await db.subscription_plans.find_one({"id": plan_id, "company_id": user["company_id"]})
    if not plan:
        raise HTTPException(status_code=404, detail="Plano nao encontrado")
    update = {}
    raw = data.model_dump(exclude_unset=True)
    if "items" in raw and raw["items"] is not None:
        update["items"] = [it.model_dump() if hasattr(it, "model_dump") else it for it in raw["items"]]
        update["included_service_ids"] = [i["service_id"] for i in update["items"]]
    for k in ["name", "price", "cycle_days", "description", "is_active"]:
        if k in raw and raw[k] is not None:
            update[k] = raw[k]
    if "total_credits" in raw and raw["total_credits"] is not None:
        update["total_credits"] = raw["total_credits"]
        update["visits_per_month"] = raw["total_credits"]
    if update:
        await db.subscription_plans.update_one({"id": plan_id}, {"$set": update})
    return await db.subscription_plans.find_one({"id": plan_id}, {"_id": 0})

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
    cycle_days = plan.get("cycle_days", 30)
    total_credits = plan.get("total_credits", plan.get("visits_per_month", 0))
    end_date = (now + timedelta(days=cycle_days)).isoformat()

    sub = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "client_phone": data.client_phone,
        "client_name": client["name"],
        "plan_id": data.plan_id,
        "plan_name": plan["name"],
        "status": "active",
        "credits_total": total_credits,
        "credits_used": 0,
        "credits_remaining": total_credits,
        "cycle_days": cycle_days,
        "start_date": now.isoformat(),
        "end_date": end_date,
        "next_billing_date": end_date,  # legacy alias
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

    # Resolve business type base_type to drive behavior:
    #   'crm'       -> CRM only (e.g. Atendimento ao Cliente) — no service/professional onboarding
    #   'scheduling'-> scheduling (Salao, Clinica)
    #   'both'      -> Completo
    base_type = "scheduling"  # safe default
    if company and company.get("business_type_id"):
        bt = await db.business_types.find_one({"id": company["business_type_id"]}, {"_id": 0, "base_type": 1})
        if bt and bt.get("base_type"):
            base_type = bt["base_type"]

    return {
        "onboarding_done": onboarding_done,
        "base_type": base_type,
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
    layout: Optional[str] = None  # 'grid' | 'columns'

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
    """Get professional working hours, falling back to business hours.

    Supports three formats (backwards-compatible):
    1. None / missing -> defaults to (biz_start, biz_end)
    2. {"active": false} -> returns None (day off)
    3. {"start": "08:00", "end": "18:00"} -> single shift
    4. {"shifts": [{"start": "08:00","end":"12:00"}, {"start":"13:00","end":"18:00"}]}
       -> multi-shift (returns list of tuples)
    """
    prof_hours = (prof.get("working_hours") or {}).get(day_key)
    if prof_hours is None:
        return biz_start, biz_end
    if not prof_hours.get("active", True):
        return None
    if prof_hours.get("shifts"):
        shifts = [(s["start"], s["end"]) for s in prof_hours["shifts"] if s.get("start") and s.get("end")]
        if shifts:
            return shifts  # list signals multi-shift
    return prof_hours.get("start", biz_start), prof_hours.get("end", biz_end)


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
        # hours is either (start, end) for single shift or a list of tuples for multi-shift
        shifts = hours if isinstance(hours, list) else [hours]
        for s, e in shifts:
            all_slots |= calculate_available_slots(s, e, duration, booked)

    return {"date": date, "available_slots": sorted(all_slots), "duration": duration}
