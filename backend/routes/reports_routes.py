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
    end_date: str = None,
    professional_id: str = None,
    service_type: str = None,   # 'service' | 'product' | 'subscription'
    service_id: str = None,
):
    """Relatório de comissões com filtros por período, profissional, tipo (serviço/produto)
    e item específico. Calcula a comissão usando, em ordem de prioridade:
      1) `service.commission_percent` (cadastrado no produto/serviço)
      2) `professional.commission_percent` (fallback global)
    """
    company_id = user["company_id"]

    # Get all professionals
    professionals = await db.professionals.find(
        {"company_id": company_id},
        {"_id": 0}
    ).to_list(1000)
    if professional_id:
        professionals = [p for p in professionals if p.get("id") == professional_id]

    # Get completed appointments matching the period filter
    query = {"company_id": company_id, "status": "concluido"}
    if start_date:
        query["date"] = {"$gte": start_date}
    if end_date:
        query.setdefault("date", {})["$lte"] = end_date
    if professional_id:
        query["professional_id"] = professional_id

    appointments = await db.appointments.find(query, {"_id": 0}).to_list(10000)

    # Pre-load services that appear in the appointments so we can use
    # service-level commission_percent when set. Also enables filtering by
    # service_type / service_id.
    service_ids = {a.get("service_id") for a in appointments if a.get("service_id")}
    services_by_id = {}
    if service_ids:
        cursor = db.services.find({"id": {"$in": list(service_ids)}}, {"_id": 0})
        async for svc in cursor:
            services_by_id[svc["id"]] = svc

    if service_type:
        appointments = [
            a for a in appointments
            if services_by_id.get(a.get("service_id"), {}).get("type") == service_type
        ]
    if service_id:
        appointments = [a for a in appointments if a.get("service_id") == service_id]

    # Build per-professional + per-item breakdown in a single pass
    by_prof = {p["id"]: {"prof": p, "appts": [], "revenue": 0.0, "cost": 0.0, "profit": 0.0, "commission": 0.0} for p in professionals}
    by_item = {}  # service_id -> { name, type, qty, revenue, cost, profit, commission }
    total_revenue = 0.0
    total_cost = 0.0
    total_profit = 0.0
    total_commission = 0.0

    for a in appointments:
        prof_id = a.get("professional_id")
        prof = next((p for p in professionals if p["id"] == prof_id), None)
        if not prof:
            continue
        price = float(a.get("price") or 0)
        sid = a.get("service_id")
        svc = services_by_id.get(sid) if sid else None
        # Cost is per-unit on the service. Default 0 when not set.
        unit_cost = float((svc or {}).get("cost") or 0)
        # Commission base = profit (price - cost). Never negative.
        profit = max(price - unit_cost, 0.0)
        # service-level pct overrides professional-level pct when defined
        svc_pct = svc.get("commission_percent") if svc else None
        prof_pct = prof.get("commission_percent") or 0
        pct = svc_pct if svc_pct is not None else prof_pct
        commission = profit * (pct or 0) / 100

        bp = by_prof[prof_id]
        bp["appts"].append(a)
        bp["revenue"] += price
        bp["cost"] += unit_cost
        bp["profit"] += profit
        bp["commission"] += commission

        item_key = sid or "_no_service_"
        if item_key not in by_item:
            by_item[item_key] = {
                "service_id": sid,
                "service_name": (svc or {}).get("name") or "Sem servico",
                "service_type": (svc or {}).get("type") or "service",
                "quantity": 0,
                "revenue": 0.0,
                "cost": 0.0,
                "profit": 0.0,
                "commission": 0.0,
                "commission_percent": svc_pct if svc_pct is not None else None,
                "unit_cost": unit_cost,
            }
        bi = by_item[item_key]
        bi["quantity"] += 1
        bi["revenue"] += price
        bi["cost"] += unit_cost
        bi["profit"] += profit
        bi["commission"] += commission

        total_revenue += price
        total_cost += unit_cost
        total_profit += profit
        total_commission += commission

    report = []
    for prof in professionals:
        bp = by_prof[prof["id"]]
        report.append({
            "professional_id": prof["id"],
            "professional_name": prof["name"],
            "appointments_count": len(bp["appts"]),
            "revenue": bp["revenue"],
            "cost": bp["cost"],
            "profit": bp["profit"],
            "commission_percent": prof.get("commission_percent", 0),
            "commission_value": bp["commission"],
            "is_active": prof.get("is_active", True),
        })

    breakdown = sorted(by_item.values(), key=lambda x: x["revenue"], reverse=True)

    return {
        "report": report,
        "breakdown": breakdown,
        "summary": {
            "total_revenue": total_revenue,
            "total_cost": total_cost,
            "total_profit": total_profit,
            "total_commission": total_commission,
            "total_appointments": len(appointments),
            "avg_ticket": total_revenue / len(appointments) if appointments else 0,
            "professionals_count": len(professionals),
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
