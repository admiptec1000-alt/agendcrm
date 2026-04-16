from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase
from database import get_database
from models import AppointmentCreate, AppointmentStatus
import uuid
from datetime import datetime, timezone, timedelta
from typing import List

router = APIRouter(prefix="/public", tags=["public"])

@router.get("/booking/{slug}/client-lookup/{phone}")
async def public_client_lookup(
    slug: str,
    phone: str,
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    page = await db.booking_pages.find_one({"slug": slug, "is_active": True})
    if not page:
        raise HTTPException(status_code=404, detail="Pagina nao encontrada")
    
    client = await db.clients.find_one({"company_id": page["company_id"], "phone": phone}, {"_id": 0})
    if not client:
        return {"found": False}
    
    # Check subscription
    sub = await db.client_subscriptions.find_one({
        "company_id": page["company_id"],
        "client_phone": phone,
        "status": "active"
    }, {"_id": 0})
    
    included_service_ids = []
    if sub:
        plan = await db.subscription_plans.find_one({"id": sub["plan_id"]}, {"_id": 0})
        if plan:
            sub["plan"] = plan
            included_service_ids = plan.get("included_service_ids", [])
    
    return {
        "found": True,
        "client": client,
        "subscription": sub,
        "included_service_ids": included_service_ids
    }

@router.get("/booking/{slug}")
async def get_booking_page(
    slug: str,
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    # Get booking page
    page = await db.booking_pages.find_one({"slug": slug, "is_active": True}, {"_id": 0})
    if not page:
        raise HTTPException(status_code=404, detail="Página de agendamento não encontrada")
    
    # Get company info
    company = await db.companies.find_one({"id": page["company_id"]}, {"_id": 0})
    if not company:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")
    
    return {
        "page": page,
        "company": {
            "name": company["name"],
            "email": company.get("email"),
            "phone": company.get("phone"),
            "logo_url": company.get("logo_url")
        }
    }

@router.get("/booking/{slug}/services")
async def get_public_services(
    slug: str,
    db: AsyncIOMotorDatabase = Depends(get_database),
    type: str = None
):
    # Get booking page to find company
    page = await db.booking_pages.find_one({"slug": slug, "is_active": True})
    if not page:
        raise HTTPException(status_code=404, detail="Página de agendamento não encontrada")
    
    query = {"company_id": page["company_id"], "is_active": True}
    if type:
        query["type"] = type
    
    services = await db.services.find(query, {"_id": 0}).to_list(1000)
    
    # Group by category
    categories = await db.categories.find(
        {"company_id": page["company_id"]},
        {"_id": 0}
    ).to_list(1000)
    
    return {
        "services": services,
        "categories": categories
    }

@router.get("/booking/{slug}/professionals")
async def get_public_professionals(
    slug: str,
    db: AsyncIOMotorDatabase = Depends(get_database),
    service_id: str = None
):
    # Get booking page to find company
    page = await db.booking_pages.find_one({"slug": slug, "is_active": True})
    if not page:
        raise HTTPException(status_code=404, detail="Página de agendamento não encontrada")
    
    query = {"company_id": page["company_id"], "is_active": True}
    
    professionals = await db.professionals.find(query, {"_id": 0}).to_list(1000)
    return professionals

@router.get("/booking/{slug}/availability")
async def get_availability(
    slug: str,
    professional_id: str,
    date: str,  # YYYY-MM-DD
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    # Get booking page to find company
    page = await db.booking_pages.find_one({"slug": slug, "is_active": True})
    if not page:
        raise HTTPException(status_code=404, detail="Página de agendamento não encontrada")
    
    # Get professional
    professional = await db.professionals.find_one({
        "id": professional_id,
        "company_id": page["company_id"],
        "is_active": True
    })
    if not professional:
        raise HTTPException(status_code=404, detail="Profissional não encontrado")
    
    # Get appointments for this professional on this date
    appointments = await db.appointments.find({
        "company_id": page["company_id"],
        "professional_id": professional_id,
        "date": date,
        "status": {"$ne": AppointmentStatus.CANCELADO}
    }, {"_id": 0}).to_list(1000)
    
    # Generate available time slots (simplified - 9am to 6pm, 30 min intervals)
    all_slots = []
    for hour in range(9, 18):
        for minute in [0, 30]:
            all_slots.append(f"{hour:02d}:{minute:02d}")
    
    # Remove booked slots
    booked_times = [apt["time"] for apt in appointments]
    available_slots = [slot for slot in all_slots if slot not in booked_times]
    
    return {
        "date": date,
        "available_slots": available_slots
    }

@router.post("/booking/{slug}/book")
async def create_public_booking(
    slug: str,
    data: AppointmentCreate,
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    # Get booking page to find company
    page = await db.booking_pages.find_one({"slug": slug, "is_active": True})
    if not page:
        raise HTTPException(status_code=404, detail="Página de agendamento não encontrada")
    
    # Check if service exists
    service = await db.services.find_one({
        "id": data.service_id,
        "company_id": page["company_id"],
        "is_active": True
    })
    if not service:
        raise HTTPException(status_code=404, detail="Serviço não encontrado")
    
    # Check if professional exists
    professional = await db.professionals.find_one({
        "id": data.professional_id,
        "company_id": page["company_id"],
        "is_active": True
    })
    if not professional:
        raise HTTPException(status_code=404, detail="Profissional não encontrado")
    
    # Check if time slot is available
    existing = await db.appointments.find_one({
        "company_id": page["company_id"],
        "professional_id": data.professional_id,
        "date": data.date,
        "time": data.time,
        "status": {"$ne": AppointmentStatus.CANCELADO}
    })
    
    if existing:
        raise HTTPException(status_code=400, detail="Horário já reservado")
    
    appointment_id = str(uuid.uuid4())
    appointment = {
        "id": appointment_id,
        "company_id": page["company_id"],
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
        "price": service["price"],
        "status": AppointmentStatus.CONFIRMADO,
        "notes": data.notes,
        "source": "public_booking",
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.appointments.insert_one(appointment)
    
    return {
        "id": appointment_id,
        "message": "Agendamento realizado com sucesso!",
        "appointment": {k: v for k, v in appointment.items() if k != "_id"}
    }
