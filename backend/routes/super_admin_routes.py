from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from database import get_database
from auth import require_super_admin, get_password_hash
from models import CompanyCreate, CompanyUpdate, CompanyResponse, CompanyStatus, ThemeColors
from typing import List
import uuid
from datetime import datetime, timezone

router = APIRouter(prefix="/super-admin", tags=["super-admin"])

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
    
    return {
        "total_companies": total_companies,
        "active_companies": active_companies,
        "trial_companies": trial_companies,
        "blocked_companies": blocked_companies,
        "crm_plans": crm_plans,
        "scheduling_plans": scheduling_plans
    }

@router.get("/companies")
async def list_companies(
    user: dict = Depends(require_super_admin),
    db: AsyncIOMotorDatabase = Depends(get_database),
    status: str = None,
    plan_type: str = None
):
    query = {}
    if status:
        query["status"] = status
    if plan_type:
        query["plan_type"] = plan_type
    
    companies = await db.companies.find(query, {"_id": 0}).to_list(1000)
    return companies

@router.post("/companies", response_model=CompanyResponse)
async def create_company(
    data: CompanyCreate,
    user: dict = Depends(require_super_admin),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    company_id = str(uuid.uuid4())
    company = {
        "id": company_id,
        "name": data.name,
        "cnpj": data.cnpj,
        "email": data.email,
        "phone": data.phone,
        "status": CompanyStatus.ACTIVE,
        "plan_type": data.plan_type,
        "theme_colors": (data.theme_colors or ThemeColors()).model_dump(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": user["id"]
    }
    await db.companies.insert_one(company)
    
    # Create booking page if scheduling is included
    if data.plan_type in ["scheduling", "both"]:
        slug = data.name.lower().replace(" ", "").replace(".", "")[:20]
        booking_page = {
            "id": str(uuid.uuid4()),
            "company_id": company_id,
            "slug": slug,
            "primary_color": company["theme_colors"]["primary"],
            "secondary_color": company["theme_colors"]["secondary"],
            "is_active": True,
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await db.booking_pages.insert_one(booking_page)
    
    return CompanyResponse(
        id=company["id"],
        name=company["name"],
        email=company["email"],
        phone=company.get("phone"),
        status=company["status"],
        plan_type=company["plan_type"],
        theme_colors=ThemeColors(**company["theme_colors"]),
        created_at=company["created_at"]
    )

@router.put("/companies/{company_id}")
async def update_company(
    company_id: str,
    data: CompanyUpdate,
    user: dict = Depends(require_super_admin),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    company = await db.companies.find_one({"id": company_id})
    if not company:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Empresa não encontrada"
        )
    
    update_data = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    
    if update_data:
        await db.companies.update_one(
            {"id": company_id},
            {"$set": update_data}
        )
    
    updated_company = await db.companies.find_one({"id": company_id}, {"_id": 0})
    return updated_company

@router.delete("/companies/{company_id}")
async def delete_company(
    company_id: str,
    user: dict = Depends(require_super_admin),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    company = await db.companies.find_one({"id": company_id})
    if not company:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Empresa não encontrada"
        )
    
    # Delete company and all related data
    await db.companies.delete_one({"id": company_id})
    await db.company_users.delete_many({"company_id": company_id})
    await db.tickets.delete_many({"company_id": company_id})
    await db.appointments.delete_many({"company_id": company_id})
    await db.services.delete_many({"company_id": company_id})
    await db.professionals.delete_many({"company_id": company_id})
    await db.booking_pages.delete_many({"company_id": company_id})
    
    return {"message": "Empresa deletada com sucesso"}
