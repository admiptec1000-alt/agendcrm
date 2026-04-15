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
from typing import List

router = APIRouter(prefix="/scheduling", tags=["scheduling"])

# Appointments
@router.get("/appointments")
async def list_appointments(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
    date: str = None,
    professional_id: str = None,
    status: str = None
):
    query = {"company_id": user["company_id"]}
    if date:
        query["date"] = date
    if professional_id:
        query["professional_id"] = professional_id
    if status:
        query["status"] = status
    
    appointments = await db.appointments.find(query, {"_id": 0}).sort("date", -1).to_list(1000)
    return appointments

@router.post("/appointments")
async def create_appointment(
    data: AppointmentCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    # Check if service exists
    service = await db.services.find_one({"id": data.service_id, "company_id": user["company_id"]})
    if not service:
        raise HTTPException(status_code=404, detail="Serviço não encontrado")
    
    # Check if professional exists
    professional = await db.professionals.find_one({"id": data.professional_id, "company_id": user["company_id"]})
    if not professional:
        raise HTTPException(status_code=404, detail="Profissional não encontrado")
    
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
        "price": service["price"],
        "status": AppointmentStatus.PENDENTE,
        "notes": data.notes,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.appointments.insert_one(appointment)
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
        raise HTTPException(status_code=404, detail="Agendamento não encontrado")
    
    update_data = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    
    if update_data:
        await db.appointments.update_one(
            {"id": appointment_id},
            {"$set": update_data}
        )
    
    updated_appointment = await db.appointments.find_one({"id": appointment_id}, {"_id": 0})
    return updated_appointment

@router.delete("/appointments/{appointment_id}")
async def delete_appointment(
    appointment_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    result = await db.appointments.delete_one({"id": appointment_id, "company_id": user["company_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Agendamento não encontrado")
    return {"message": "Agendamento deletado com sucesso"}

# Calendar
@router.get("/calendar")
async def get_calendar(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
    start_date: str = None,
    end_date: str = None
):
    query = {"company_id": user["company_id"]}
    if start_date and end_date:
        query["date"] = {"$gte": start_date, "$lte": end_date}
    
    appointments = await db.appointments.find(query, {"_id": 0}).to_list(1000)
    return appointments

# Services
@router.get("/services")
async def list_services(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
    category_id: str = None,
    type: str = None
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
    service_id: str,
    data: ServiceUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    service = await db.services.find_one({"id": service_id, "company_id": user["company_id"]})
    if not service:
        raise HTTPException(status_code=404, detail="Serviço não encontrado")
    
    update_data = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    
    if update_data:
        await db.services.update_one(
            {"id": service_id},
            {"$set": update_data}
        )
    
    updated_service = await db.services.find_one({"id": service_id}, {"_id": 0})
    return updated_service

@router.delete("/services/{service_id}")
async def delete_service(
    service_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    result = await db.services.delete_one({"id": service_id, "company_id": user["company_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Serviço não encontrado")
    return {"message": "Serviço deletado com sucesso"}

# Professionals
@router.get("/professionals")
async def list_professionals(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    professionals = await db.professionals.find(
        {"company_id": user["company_id"]},
        {"_id": 0}
    ).to_list(1000)
    return professionals

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
        "working_hours": data.working_hours,
        "is_active": True,
        "image_url": data.image_url,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.professionals.insert_one(professional)
    return {k: v for k, v in professional.items() if k != "_id"}

@router.put("/professionals/{professional_id}")
async def update_professional(
    professional_id: str,
    data: ProfessionalUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    professional = await db.professionals.find_one({"id": professional_id, "company_id": user["company_id"]})
    if not professional:
        raise HTTPException(status_code=404, detail="Profissional não encontrado")
    
    update_data = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    
    if update_data:
        await db.professionals.update_one(
            {"id": professional_id},
            {"$set": update_data}
        )
    
    updated_professional = await db.professionals.find_one({"id": professional_id}, {"_id": 0})
    return updated_professional

@router.delete("/professionals/{professional_id}")
async def delete_professional(
    professional_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    result = await db.professionals.delete_one({"id": professional_id, "company_id": user["company_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Profissional não encontrado")
    return {"message": "Profissional deletado com sucesso"}

# Categories
@router.get("/categories")
async def list_categories(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    categories = await db.categories.find(
        {"company_id": user["company_id"]},
        {"_id": 0}
    ).to_list(1000)
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

# Booking Page
@router.get("/booking-page")
async def get_booking_page(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    page = await db.booking_pages.find_one(
        {"company_id": user["company_id"]},
        {"_id": 0}
    )
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
            await db.booking_pages.update_one(
                {"company_id": user["company_id"]},
                {"$set": update_data}
            )
    else:
        # Create new booking page
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

# Onboarding status
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
    await db.companies.update_one(
        {"id": user["company_id"]},
        {"$set": {"onboarding_done": True}}
    )
    return {"message": "Onboarding completed"}
