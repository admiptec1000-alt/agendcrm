from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse, Response, HTMLResponse
import json
from motor.motor_asyncio import AsyncIOMotorDatabase
from database import get_database
from models import AppointmentCreate, AppointmentStatus
import uuid
import os
from datetime import datetime, timezone, timedelta
from typing import List, Optional
from pydantic import BaseModel

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

    # Priority: booking page title -> company name -> default
    company_name = (page or {}).get("title") or (company or {}).get("name") or "AgentCRM"
    # Short name: up to 12 chars, cut at word boundary when possible
    short_name = company_name.strip()[:12]
    logo_path = (page or {}).get("logo_url") or ""
    backend_url = os.environ.get("BACKEND_PUBLIC_URL", "")

    # Use company logo when available, otherwise default PNGs
    if logo_path:
        if logo_path.startswith("http"):
            icon_url = logo_path
        else:
            icon_url = f"{backend_url}{logo_path}" if backend_url else logo_path
        icons = [
            {"src": icon_url, "sizes": "96x96", "type": "image/png", "purpose": "any"},
            {"src": icon_url, "sizes": "152x152", "type": "image/png", "purpose": "any"},
            {"src": icon_url, "sizes": "180x180", "type": "image/png", "purpose": "any"},
            {"src": icon_url, "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": icon_url, "sizes": "512x512", "type": "image/png", "purpose": "any"},
            {"src": icon_url, "sizes": "192x192", "type": "image/png", "purpose": "maskable"},
            {"src": icon_url, "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ]
    else:
        icons = [
            {"src": "/logo192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable"},
            {"src": "/logo512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"},
        ]

    primary_color = (page or {}).get("primary_color") or "#4F46E5"

    return Response(
        content=json.dumps({
            "id": f"/{slug}/painel",
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
        }),
        media_type="application/manifest+json"
    )


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
        if prof_hours and not prof_hours.get("active", True):
            continue

        # Resolve shifts: multi-shift list > single (start,end) > business hours fallback
        shifts = []
        if prof_hours and prof_hours.get("shifts"):
            shifts = [(s["start"], s["end"]) for s in prof_hours["shifts"] if s.get("start") and s.get("end")]
        if not shifts:
            if prof_hours and prof_hours.get("start") and prof_hours.get("end"):
                shifts = [(prof_hours["start"], prof_hours["end"])]
            else:
                shifts = [(biz_hours["start"], biz_hours["end"])]

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

        for shift_start, shift_end in shifts:
            sh, sm = map(int, shift_start.split(":"))
            eh, em = map(int, shift_end.split(":"))
            start_min = sh * 60 + sm
            end_min = eh * 60 + em
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

    # === Subscription handling ===
    from routes.scheduling_routes import _calc_sub_status
    price = service["price"]
    subscription_applied = False
    credits_consumed = 0
    use_subscription = getattr(data, "use_subscription", False)
    client_sub = await db.client_subscriptions.find_one({
        "company_id": page["company_id"],
        "client_phone": data.customer_phone,
        "status": "active"
    })
    if client_sub and _calc_sub_status(client_sub) == "active" and use_subscription:
        plan = await db.subscription_plans.find_one({"id": client_sub["plan_id"]})
        # Respect weekday restriction (fall back to normal price if not allowed)
        from routes.scheduling_routes import _plan_allows_weekday
        if plan and not _plan_allows_weekday(plan, data.date):
            plan = None
        if plan:
            cost = None
            for item in plan.get("items", []):
                if item.get("service_id") == data.service_id:
                    cost = item.get("credits_per_use", 1)
                    break
            if cost is None and data.service_id in plan.get("included_service_ids", []):
                cost = 1
            if cost is not None and client_sub.get("credits_remaining", 0) >= cost:
                price = 0.0
                subscription_applied = True
                credits_consumed = cost
                await db.client_subscriptions.update_one(
                    {"id": client_sub["id"]},
                    {"$inc": {"credits_remaining": -cost, "credits_used": cost}}
                )
                updated = await db.client_subscriptions.find_one({"id": client_sub["id"]})
                if updated and updated.get("credits_remaining", 0) <= 0:
                    await db.client_subscriptions.update_one(
                        {"id": client_sub["id"]}, {"$set": {"status": "expired"}}
                    )

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
        "price": price,
        "original_price": service["price"],
        "subscription_applied": subscription_applied,
        "credits_consumed": credits_consumed,
        "status": AppointmentStatus.PENDENTE,
        "notes": data.notes,
        "source": "public_booking",
        "confirm_token": str(uuid.uuid4()),
        "cancel_token": str(uuid.uuid4()),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.appointments.insert_one(appointment)

    # Send WhatsApp welcome notification (fire-and-forget).
    # IMPORTANT: status stays PENDENTE until the client clicks the confirm link.
    try:
        from notifications import notify_appointment_created
        import os as _os
        base_url = _os.environ.get("FRONTEND_PUBLIC_URL", "")
        sent = await notify_appointment_created(db, page["company_id"], appointment, base_url, slug)
        if sent:
            await db.appointments.update_one(
                {"id": appointment_id},
                {"$set": {"whatsapp_notified_at": datetime.now(timezone.utc).isoformat()}}
            )
    except Exception:
        pass
    
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


def _render_status_page(title: str, message: str, color: str) -> HTMLResponse:
    html = f"""<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<style>
  body{{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}}
  .card{{max-width:420px;width:100%;background:#1e293b;border-radius:24px;padding:40px 28px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.4)}}
  .icon{{width:72px;height:72px;margin:0 auto 20px;border-radius:50%;background:{color};display:flex;align-items:center;justify-content:center;font-size:36px;color:#fff}}
  h1{{font-size:22px;margin:0 0 8px;color:#f1f5f9}}
  p{{color:#94a3b8;line-height:1.5}}
</style></head><body>
<div class="card">
  <div class="icon">✓</div>
  <h1>{title}</h1>
  <p>{message}</p>
</div></body></html>"""
    return HTMLResponse(content=html)


@router.get("/apt/confirmar/{token}", response_class=HTMLResponse)
async def confirm_appointment_by_token(
    token: str,
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    apt = await db.appointments.find_one({"confirm_token": token})
    if not apt:
        return _render_status_page("Link invalido", "Este link de confirmacao nao existe ou ja expirou.", "#ef4444")
    if apt.get("status") == "cancelado":
        return _render_status_page("Agendamento cancelado", "Este agendamento foi cancelado. Fale com a empresa para reagendar.", "#f59e0b")
    if apt.get("status") != "confirmado":
        await db.appointments.update_one(
            {"id": apt["id"]},
            {"$set": {"status": "confirmado", "confirmed_at": datetime.now(timezone.utc).isoformat()}}
        )
    return _render_status_page(
        "Agendamento confirmado!",
        f"Te esperamos em {apt.get('date','')} as {apt.get('time','')}. Ate breve!",
        "#10b981"
    )


@router.get("/apt/cancelar/{token}", response_class=HTMLResponse)
async def cancel_appointment_by_token(
    token: str,
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    apt = await db.appointments.find_one({"cancel_token": token})
    if not apt:
        return _render_status_page("Link invalido", "Este link de cancelamento nao existe ou ja expirou.", "#ef4444")
    if apt.get("status") == "cancelado":
        return _render_status_page("Ja cancelado", "Este agendamento ja estava cancelado.", "#64748b")
    await db.appointments.update_one(
        {"id": apt["id"]},
        {"$set": {"status": "cancelado", "cancelled_at": datetime.now(timezone.utc).isoformat()}}
    )
    return _render_status_page(
        "Agendamento cancelado",
        "Seu agendamento foi cancelado e o horario ja foi liberado. Se mudar de ideia, agende um novo horario.",
        "#ef4444"
    )


# === SATISFACTION SURVEY (1-5 stars) ===
def _render_review_page(token: str, apt: dict, company_name: str, primary_color: str = "#4F46E5") -> str:
    customer = apt.get("customer_name", "")
    service = apt.get("service_name", "")
    return f"""<!DOCTYPE html><html lang=\"pt-br\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Avaliacao - {company_name}</title>
<style>
  *{{box-sizing:border-box;margin:0;padding:0}}
  body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:linear-gradient(135deg,#0f172a 0%,#1e1b4b 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}}
  .card{{max-width:460px;width:100%;background:#fff;border-radius:24px;padding:32px 24px;box-shadow:0 20px 60px rgba(0,0,0,.4)}}
  h1{{font-size:22px;margin:0 0 6px;color:#0f172a;text-align:center}}
  .sub{{color:#64748b;text-align:center;margin-bottom:24px;font-size:14px}}
  .info{{background:#f1f5f9;border-radius:12px;padding:12px;text-align:center;margin-bottom:24px}}
  .info b{{color:#0f172a}}
  .info span{{color:#475569;font-size:13px}}
  .stars{{display:flex;gap:8px;justify-content:center;margin-bottom:24px}}
  .star{{font-size:42px;cursor:pointer;color:#cbd5e1;transition:transform .15s;user-select:none}}
  .star.active{{color:#facc15}}
  .star:hover{{transform:scale(1.15)}}
  textarea{{width:100%;padding:12px;border:1px solid #e2e8f0;border-radius:12px;font-size:14px;resize:vertical;min-height:90px;font-family:inherit}}
  textarea:focus{{outline:2px solid {primary_color};outline-offset:-1px;border-color:transparent}}
  button{{width:100%;padding:14px;background:{primary_color};color:#fff;border:0;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;margin-top:16px;transition:opacity .2s}}
  button:hover{{opacity:.9}}
  button:disabled{{opacity:.4;cursor:not-allowed}}
  .ok{{display:none;text-align:center;padding:20px}}
  .ok.show{{display:block}}
  .ok h2{{color:#10b981;margin-bottom:6px}}
  .ok p{{color:#64748b}}
  .form{{display:block}}
  .form.hide{{display:none}}
</style></head><body>
<div class=\"card\">
  <div class=\"form\" id=\"form\">
    <h1>Como foi seu atendimento?</h1>
    <p class=\"sub\">{company_name}</p>
    <div class=\"info\">
      <b>{customer}</b><br>
      <span>{service}</span>
    </div>
    <div class=\"stars\" id=\"stars\">
      <span class=\"star\" data-v=\"1\">★</span>
      <span class=\"star\" data-v=\"2\">★</span>
      <span class=\"star\" data-v=\"3\">★</span>
      <span class=\"star\" data-v=\"4\">★</span>
      <span class=\"star\" data-v=\"5\">★</span>
    </div>
    <textarea id=\"comment\" placeholder=\"Quer deixar um comentario? (opcional)\"></textarea>
    <button id=\"submit\" disabled>Enviar Avaliacao</button>
  </div>
  <div class=\"ok\" id=\"ok\">
    <h2>Obrigado! 💜</h2>
    <p>Sua avaliacao nos ajuda a melhorar cada dia mais.</p>
  </div>
</div>
<script>
  let rating = 0;
  const stars = document.querySelectorAll('.star');
  const submit = document.getElementById('submit');
  stars.forEach(s => {{
    s.addEventListener('click', () => {{
      rating = parseInt(s.dataset.v, 10);
      stars.forEach(x => {{ x.classList.toggle('active', parseInt(x.dataset.v,10) <= rating); }});
      submit.disabled = false;
    }});
  }});
  submit.addEventListener('click', async () => {{
    submit.disabled = true;
    submit.textContent = 'Enviando...';
    try {{
      const r = await fetch('/api/public/apt/review/{token}', {{
        method: 'POST', headers: {{'Content-Type':'application/json'}},
        body: JSON.stringify({{ rating, comment: document.getElementById('comment').value }})
      }});
      if (r.ok) {{
        document.getElementById('form').classList.add('hide');
        document.getElementById('ok').classList.add('show');
      }} else {{
        submit.disabled = false;
        submit.textContent = 'Enviar Avaliacao';
        alert('Erro ao enviar. Tente novamente.');
      }}
    }} catch(e) {{
      submit.disabled = false;
      submit.textContent = 'Enviar Avaliacao';
    }}
  }});
</script>
</body></html>"""


@router.get("/apt/review/{token}", response_class=HTMLResponse)
async def review_appointment_page(
    token: str,
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    apt = await db.appointments.find_one({"review_token": token})
    if not apt:
        return _render_status_page("Link invalido", "Este link de avaliacao nao existe ou expirou.", "#ef4444")
    if apt.get("review_rating"):
        return _render_status_page("Ja avaliado", "Voce ja enviou sua avaliacao para este atendimento. Obrigado!", "#10b981")
    company = await db.companies.find_one({"id": apt["company_id"]}, {"_id": 0, "name": 1})
    page = await db.booking_pages.find_one({"company_id": apt["company_id"]}, {"_id": 0, "primary_color": 1})
    return HTMLResponse(content=_render_review_page(
        token, apt,
        (company or {}).get("name", "Avaliacao"),
        (page or {}).get("primary_color", "#4F46E5")
    ))


class ReviewSubmit(BaseModel):
    rating: int
    comment: Optional[str] = ""


@router.post("/apt/review/{token}")
async def review_appointment_submit(
    token: str,
    data: ReviewSubmit,
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    apt = await db.appointments.find_one({"review_token": token})
    if not apt:
        raise HTTPException(status_code=404, detail="Link invalido")
    if apt.get("review_rating"):
        raise HTTPException(status_code=400, detail="Avaliacao ja registrada")
    rating = max(1, min(5, int(data.rating or 0)))
    await db.appointments.update_one(
        {"id": apt["id"]},
        {"$set": {
            "review_rating": rating,
            "review_comment": (data.comment or "").strip()[:500],
            "review_at": datetime.now(timezone.utc).isoformat(),
        }}
    )
    return {"message": "Avaliacao registrada", "rating": rating}


@router.get("/booking/{slug}/subscription")
async def get_public_subscription(
    slug: str,
    phone: str,
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    """Check if a customer phone has an active subscription on this company.
    Returns plan details + credits + per-service cost map."""
    page = await find_booking_page(db, slug)
    if not page:
        raise HTTPException(status_code=404, detail="Pagina nao encontrada")
    clean_phone = "".join(c for c in phone if c.isdigit()) or phone
    sub = await db.client_subscriptions.find_one(
        {"company_id": page["company_id"], "client_phone": {"$in": [phone, clean_phone]}},
        {"_id": 0},
        sort=[("created_at", -1)]
    )
    if not sub:
        return {"has_subscription": False}
    from routes.scheduling_routes import _calc_sub_status
    status_now = _calc_sub_status(sub)
    plan = await db.subscription_plans.find_one({"id": sub["plan_id"]}, {"_id": 0})
    service_costs = {}
    if plan:
        for it in plan.get("items", []):
            service_costs[it["service_id"]] = it.get("credits_per_use", 1)
        for sid in plan.get("included_service_ids", []):
            service_costs.setdefault(sid, 1)
    return {
        "has_subscription": True,
        "status": status_now,
        "plan_name": sub.get("plan_name"),
        "credits_remaining": sub.get("credits_remaining", 0),
        "credits_total": sub.get("credits_total", sub.get("credits_remaining", 0)),
        "end_date": sub.get("end_date"),
        "service_costs": service_costs,
    }


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


@router.put("/booking/{slug}/my-appointments/{appointment_id}/confirm")
async def confirm_my_appointment(
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
    if apt.get("status") == "confirmado":
        return {"message": "Agendamento ja confirmado"}

    await db.appointments.update_one(
        {"id": appointment_id},
        {"$set": {"status": "confirmado", "confirmed_at": datetime.now(timezone.utc).isoformat()}}
    )
    return {"message": "Agendamento confirmado"}


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
    # Global indoor media controlled by Super Admin — displayed across ALL companies.
    global_doc = await db.global_indoor.find_one({"_id": "settings"}, {"_id": 0})
    global_media = (global_doc or {}).get("media_links", [])

    return {
        "company_name": company["name"] if company else "",
        "logo_url": company.get("logo_url") if company else None,
        "appointments": appointments,
        "indoor_settings": indoor or {"slide_duration": 10, "media_links": [], "layout": "grid"},
        "global_media_links": global_media,
        "date": today
    }
