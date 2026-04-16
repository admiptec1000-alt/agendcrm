from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase
from database import get_database
from auth import get_current_user
from pydantic import BaseModel
from typing import Optional, List
import uuid
from datetime import datetime, timezone

router = APIRouter(prefix="/reports", tags=["reports"])

@router.get("/commissions")
async def get_commissions_report(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
    start_date: str = None,
    end_date: str = None
):
    company_id = user["company_id"]

    # Get all professionals
    professionals = await db.professionals.find(
        {"company_id": company_id},
        {"_id": 0}
    ).to_list(1000)

    # Get completed appointments
    query = {"company_id": company_id, "status": "concluido"}
    if start_date:
        query["date"] = {"$gte": start_date}
    if end_date:
        if "date" in query:
            query["date"]["$lte"] = end_date
        else:
            query["date"] = {"$lte": end_date}

    appointments = await db.appointments.find(query, {"_id": 0}).to_list(10000)

    # Calculate per professional
    report = []
    total_revenue = 0
    total_commission = 0

    for prof in professionals:
        prof_appointments = [a for a in appointments if a.get("professional_id") == prof["id"]]
        revenue = sum(a.get("price", 0) for a in prof_appointments)
        commission_pct = prof.get("commission_percent", 0)
        commission = revenue * commission_pct / 100
        total_revenue += revenue
        total_commission += commission

        report.append({
            "professional_id": prof["id"],
            "professional_name": prof["name"],
            "appointments_count": len(prof_appointments),
            "revenue": revenue,
            "commission_percent": commission_pct,
            "commission_value": commission,
            "is_active": prof.get("is_active", True)
        })

    return {
        "report": report,
        "summary": {
            "total_revenue": total_revenue,
            "total_commission": total_commission,
            "total_appointments": len(appointments),
            "avg_ticket": total_revenue / len(appointments) if appointments else 0,
            "professionals_count": len(professionals)
        }
    }


@router.get("/financial")
async def get_financial_report(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
    start_date: str = None,
    end_date: str = None
):
    company_id = user["company_id"]

    query = {"company_id": company_id}
    if start_date:
        query["date"] = {"$gte": start_date}
    if end_date:
        if "date" in query:
            query["date"]["$lte"] = end_date
        else:
            query["date"] = {"$lte": end_date}

    appointments = await db.appointments.find(query, {"_id": 0}).to_list(10000)

    total = sum(a.get("price", 0) for a in appointments)
    completed = [a for a in appointments if a.get("status") == "concluido"]
    pending = [a for a in appointments if a.get("status") in ["pendente", "confirmado"]]
    cancelled = [a for a in appointments if a.get("status") == "cancelado"]

    return {
        "total_revenue": total,
        "completed_revenue": sum(a.get("price", 0) for a in completed),
        "pending_revenue": sum(a.get("price", 0) for a in pending),
        "total_appointments": len(appointments),
        "completed_count": len(completed),
        "pending_count": len(pending),
        "cancelled_count": len(cancelled)
    }
