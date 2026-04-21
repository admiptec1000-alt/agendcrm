from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from motor.motor_asyncio import AsyncIOMotorDatabase
from database import get_database
from models import AppointmentCreate, AppointmentStatus
import uuid
import os
from datetime import datetime, timezone, timedelta
from typing import List

router = APIRouter(prefix="/public", tags=["public"])

async def find_booking_page(db, slug, projection=None):
    """Find booking page by slug or custom_domain."""
    page = await db.booking_pages.find_one({"slug": slug, "is_active": True}, projection)
    if not page:
        page = await db.booking_pages.find_one({"custom_domain": slug, "is_active": True}, projection)
    return page

# === DYNAMIC PWA MANIFEST (per company) ===
@router.get("/manifest/{slug}")
async def get_dynamic_manifest(
    slug: str,
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    """Return a PWA manifest customized for this company (name + logo)."""
    page = await find_booking_page(db, slug)
    company = None
    if page:
        company = await db.companies.find_one({"id": page["company_id"]}, {"_id": 0})

    company_name = (company or {}).get("name") or "AgentCRM"
    short_name = company_name[:12]
    logo_path = (page or {}).get("logo_url")
    backend_url = os.environ.get("BACKEND_PUBLIC_URL", "")

    # Use company logo when available, otherwise default PNGs
    if logo_path:
        icon_url = f"{backend_url}{logo_path}" if backend_url else logo_path
        icons = [
            {"src": icon_url, "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": icon_url, "sizes": "512x512", "type": "image/png", "purpose": "any"},
        ]
    else:
        icons = [
            {"src": "/logo192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable"},
            {"src": "/logo512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"},
        ]

    primary_color = (page or {}).get("primary_color") or "#4F46E5"

    return JSONResponse(content={
        "short_name": short_name,
        "name": company_name,
        "icons": icons,
        "start_url": f"/{slug}/painel",
        "scope": f"/{slug}/",
        "display": "standalone",
        "orientation": "portrait",
        "theme_color": primary_color,
        "background_color": "#F8FAFC",
        "description": f"{company_name} - Agendamento e Gestao"
    })


@router.get("/booking/{slug}/client-lookup/{phone}")
async def public_client_lookup(
    slug: str,
    phone: str,
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    page = await find_booking_page(db, slug)
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
    # Try slug first, then custom_domain
    page = await find_booking_page(db, slug, {"_id": 0})
    if not page:
        raise HTTPException(status_code=404, detail="Pagina de agendamento nao encontrada")
    
    company = await db.companies.find_one({"id": page["company_id"]}, {"_id": 0})
    if not company:
        raise HTTPException(status_code=404, detail="Empresa nao encontrada")
    
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
    page = await find_booking_page(db, slug)
    if not page:
        raise HTTPException(status_code=404, detail="Pagina de agendamento nao encontrada")
    
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
    page = await find_booking_page(db, slug)
    if not page:
        raise HTTPException(status_code=404, detail="Pagina de agendamento nao encontrada")
    
    query = {"company_id": page["company_id"], "is_active": True}
    
    professionals = await db.professionals.find(query, {"_id": 0}).to_list(1000)
    return professionals

@router.get("/booking/{slug}/availability")
async def get_availability(
    slug: str,
    professional_id: str,
    date: str,
    db: AsyncIOMotorDatabase = Depends(get_database),
    service_id: str = None
):
    page = await find_booking_page(db, slug)
    if not page:
        raise HTTPException(status_code=404, detail="Pagina nao encontrada")

    company_id = page["company_id"]
    company = await db.companies.find_one({"id": company_id}, {"_id": 0})

    day_map = {0: "seg", 1: "ter", 2: "qua", 3: "qui", 4: "sex", 5: "sab", 6: "dom"}
    from datetime import date as date_type
    parts = date.split("-")
    d = date_type(int(parts[0]), int(parts[1]), int(parts[2]))
    day_key = day_map[d.weekday()]

    biz_hours = (company or {}).get("business_hours", {}).get(day_key, {"start": "08:00", "end": "18:00", "active": True})
    if not biz_hours.get("active", True):
        return {"date": date, "available_slots": []}

    duration = 30
    if service_id:
        svc = await db.services.find_one({"id": service_id, "company_id": company_id})
        if svc:
            duration = svc.get("duration", 30)

    prof_ids = []
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
        # Full-day suspension check (no hourly window)
        is_suspended = any(
            s["start_date"] <= date <= s["end_date"] and not (s.get("start_time") and s.get("end_time"))
            for s in prof.get("suspensions", [])
        )
        if is_suspended:
            continue

        # Partial-day suspension windows for this date
        suspension_windows = []
        for s in prof.get("suspensions", []):
            if s["start_date"] <= date <= s["end_date"] and s.get("start_time") and s.get("end_time"):
                sh, sm = map(int, s["start_time"].split(":"))
                eh, em = map(int, s["end_time"].split(":"))
                suspension_windows.append((sh * 60 + sm, eh * 60 + em))

        prof_hours = (prof.get("working_hours") or {}).get(day_key)
        if prof_hours:
            if not prof_hours.get("active", True):
                continue
            start, end = prof_hours["start"], prof_hours["end"]
        else:
            start, end = biz_hours["start"], biz_hours["end"]

        start_h, start_m = map(int, start.split(":"))
        end_h, end_m = map(int, end.split(":"))
        start_min = start_h * 60 + start_m
        end_min = end_h * 60 + end_m

        existing = await db.appointments.find({
            "company_id": company_id, "professional_id": pid, "date": date,
            "status": {"$nin": ["cancelado"]}
        }, {"_id": 0}).to_list(1000)
        booked = []
        for apt in existing:
            ah, am = map(int, apt["time"].split(":"))
            booked.append((ah * 60 + am, ah * 60 + am + apt.get("duration", 30)))
        # Merge partial-day suspension windows into booked intervals
        booked.extend(suspension_windows)

        current = start_min
        while current + duration <= end_min:
            slot_end = current + duration
            conflict = any(not (slot_end <= bs or current >= be) for bs, be in booked)
            if not conflict:
                h, m = divmod(current, 60)
                all_slots.add(f"{h:02d}:{m:02d}")
            current += 30

    return {"date": date, "available_slots": sorted(all_slots)}

@router.post("/booking/{slug}/book")
async def create_public_booking(
    slug: str,
    data: AppointmentCreate,
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    # Get booking page to find company
    page = await find_booking_page(db, slug)
    if not page:
        raise HTTPException(status_code=404, detail="Pagina de agendamento nao encontrada")
    
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
    
    # Create/update client record
    company_id = page["company_id"]
    existing_client = await db.clients.find_one({"company_id": company_id, "phone": data.customer_phone})
    if not existing_client:
        await db.clients.insert_one({
            "id": str(uuid.uuid4()),
            "company_id": company_id,
            "name": data.customer_name,
            "phone": data.customer_phone,
            "email": data.customer_email,
            "total_appointments": 1,
            "created_at": datetime.now(timezone.utc).isoformat()
        })
    else:
        await db.clients.update_one(
            {"id": existing_client["id"]},
            {"$inc": {"total_appointments": 1}, "$set": {"name": data.customer_name}}
        )
    
    return {
        "id": appointment_id,
        "message": "Agendamento realizado com sucesso!",
        "appointment": {k: v for k, v in appointment.items() if k != "_id"}
    }


# === MY APPOINTMENTS (public - by phone) ===
@router.get("/booking/{slug}/my-appointments/{phone}")
async def get_my_appointments(
    slug: str,
    phone: str,
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    page = await find_booking_page(db, slug)
    if not page:
        raise HTTPException(status_code=404, detail="Pagina nao encontrada")
    
    appointments = await db.appointments.find(
        {"company_id": page["company_id"], "customer_phone": phone},
        {"_id": 0}
    ).sort("date", -1).to_list(100)
    return appointments


@router.put("/booking/{slug}/my-appointments/{appointment_id}/cancel")
async def cancel_my_appointment(
    slug: str,
    appointment_id: str,
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    page = await find_booking_page(db, slug)
    if not page:
        raise HTTPException(status_code=404, detail="Pagina nao encontrada")
    
    apt = await db.appointments.find_one({"id": appointment_id, "company_id": page["company_id"]})
    if not apt:
        raise HTTPException(status_code=404, detail="Agendamento nao encontrado")
    if apt.get("status") in ["cancelado", "concluido"]:
        raise HTTPException(status_code=400, detail="Agendamento ja finalizado")
    
    await db.appointments.update_one({"id": appointment_id}, {"$set": {"status": "cancelado"}})
    return {"message": "Agendamento cancelado"}


# === INDOOR PUBLIC DISPLAY ===
@router.get("/indoor/{slug}")
async def get_indoor_display(
    slug: str,
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    page = await find_booking_page(db, slug)
    if not page:
        raise HTTPException(status_code=404, detail="Pagina nao encontrada")

    company_id = page["company_id"]
    company = await db.companies.find_one({"id": company_id}, {"_id": 0})

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    appointments = await db.appointments.find(
        {"company_id": company_id, "date": today, "status": {"$nin": ["cancelado"]}},
        {"_id": 0}
    ).sort("time", 1).to_list(1000)

    indoor = await db.indoor_settings.find_one({"company_id": company_id}, {"_id": 0})

    return {
        "company_name": company["name"] if company else "",
        "logo_url": company.get("logo_url") if company else None,
        "appointments": appointments,
        "indoor_settings": indoor or {"slide_duration": 10, "media_links": []},
        "date": today
    }
