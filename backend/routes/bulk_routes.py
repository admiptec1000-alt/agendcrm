"""Bulk dispatcher — persistent queue for high-volume WhatsApp sends.

Stores work in MongoDB collections:
  bulk_jobs           — campaign-level config + counters
  bulk_job_recipients — per-recipient state (pending/sent/failed/opted_out)
  bulk_opt_outs       — opt-outs scoped per company

Worker (called by scheduler every 15s):
  - Finds `bulk_jobs` with status=running
  - Checks send window (days_of_week + window_start/end)
  - For each job: picks BATCH_SIZE recipients status=pending,
    rotates connection_ids round-robin, sends via wa_dispatcher,
    updates counters atomically.

Routes:
  POST   /api/bulk/jobs                              create
  GET    /api/bulk/jobs                              list
  GET    /api/bulk/jobs/{id}                         detail + per-connection stats
  POST   /api/bulk/jobs/{id}/pause | resume | cancel state changes
  POST   /api/bulk/jobs/{id}/recipients              add recipients (JSON array)
  GET    /api/bulk/jobs/{id}/recipients?status=...   paginated recipients
  GET    /api/bulk/opt-outs                          list
  POST   /api/bulk/opt-outs                          manual opt-out

2026-02-28 — Fase 3 final: pronto pra 20k com rotacao multi-provider.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone, time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel

from auth import get_current_user
from database import get_database

logger = logging.getLogger(__name__)
router = APIRouter(tags=["bulk"])


# ─── Models ────────────────────────────────────────────────────────────
class WindowConfig(BaseModel):
    enabled: bool = True
    start: str = "09:00"  # HH:MM
    end: str = "18:00"
    # 0=Mon..6=Sun (ISO). Default Mon-Sat.
    days_of_week: list[int] = [0, 1, 2, 3, 4, 5]


class BulkJobCreate(BaseModel):
    name: str
    message_template: str  # supports spintax {a|b|c} and {{variables}}
    connection_ids: list[str]  # multi-conexao rotation pool
    rotation_strategy: str = "round_robin"  # round_robin | least_used
    interval_min_sec: int = 8   # entre envios do MESMO numero
    interval_max_sec: int = 25
    window: WindowConfig = WindowConfig()
    opt_out_keywords: list[str] = ["PARAR", "SAIR", "DESCADASTRAR", "STOP"]
    daily_cap_per_connection: int = 800
    auto_start: bool = True


class RecipientCreate(BaseModel):
    phone: str
    name: Optional[str] = ""
    custom_vars: Optional[dict] = None  # extra vars for {{key}} substitution


class JobAction(BaseModel):
    action: str  # pause | resume | cancel


class OptOutCreate(BaseModel):
    phone: str
    reason: Optional[str] = "manual"


# ─── Helpers ───────────────────────────────────────────────────────────
def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _digits(s: str) -> str:
    return "".join(ch for ch in (s or "") if ch.isdigit())


def is_within_window(window: dict, now_local: Optional[datetime] = None) -> bool:
    """Pure helper: returns True if `now_local` falls inside the configured window."""
    if not window or not window.get("enabled"):
        return True
    now_local = now_local or datetime.now()  # naive local time (server tz)
    dow = now_local.weekday()
    if dow not in (window.get("days_of_week") or []):
        return False
    try:
        h1, m1 = (window.get("start") or "00:00").split(":")
        h2, m2 = (window.get("end") or "23:59").split(":")
        t_start = time(int(h1), int(m1))
        t_end = time(int(h2), int(m2))
        cur = now_local.time()
        if t_start <= t_end:
            return t_start <= cur <= t_end
        # window crosses midnight
        return cur >= t_start or cur <= t_end
    except Exception:
        return True


# ─── Routes ────────────────────────────────────────────────────────────
@router.post("/bulk/jobs")
async def create_bulk_job(
    data: BulkJobCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    if not data.connection_ids:
        raise HTTPException(status_code=400, detail="Selecione ao menos uma conexao")
    # Validate connections belong to this company.
    valid = await db.channel_connections.count_documents({
        "company_id": user["company_id"],
        "id": {"$in": data.connection_ids},
    })
    if valid != len(data.connection_ids):
        raise HTTPException(status_code=400, detail="Conexao(oes) invalida(s) para esta empresa")
    job_id = str(uuid.uuid4())
    doc = {
        "id": job_id,
        "company_id": user["company_id"],
        "name": data.name,
        "message_template": data.message_template,
        "connection_ids": data.connection_ids,
        "rotation_strategy": data.rotation_strategy,
        "interval_min_sec": max(1, int(data.interval_min_sec)),
        "interval_max_sec": max(1, int(data.interval_max_sec)),
        "window": data.window.model_dump(),
        "opt_out_keywords": [k.strip().upper() for k in data.opt_out_keywords if k.strip()],
        "daily_cap_per_connection": data.daily_cap_per_connection,
        "status": "draft",
        "audience_size": 0,
        "sent_count": 0,
        "failed_count": 0,
        "opted_out_count": 0,
        "skipped_count": 0,
        "next_rotation_idx": 0,
        "created_by": user.get("id") or user.get("email"),
        "created_at": _now_iso(),
        "started_at": None,
        "completed_at": None,
        "last_tick_at": None,
    }
    await db.bulk_jobs.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@router.get("/bulk/jobs")
async def list_jobs(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    docs = await db.bulk_jobs.find(
        {"company_id": user["company_id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    return docs


@router.get("/bulk/jobs/{job_id}")
async def get_job_detail(
    job_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    doc = await db.bulk_jobs.find_one(
        {"id": job_id, "company_id": user["company_id"]}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Job nao encontrado")
    # Per-connection breakdown
    pipeline = [
        {"$match": {"job_id": job_id}},
        {"$group": {
            "_id": {"conn": "$connection_used", "status": "$status"},
            "count": {"$sum": 1},
        }},
    ]
    breakdown_raw = await db.bulk_job_recipients.aggregate(pipeline).to_list(500)
    breakdown: dict[str, dict[str, int]] = {}
    for row in breakdown_raw:
        conn = row["_id"].get("conn") or "(none)"
        st = row["_id"].get("status") or "unknown"
        breakdown.setdefault(conn, {})[st] = row["count"]
    doc["connection_breakdown"] = breakdown
    return doc


@router.post("/bulk/jobs/{job_id}/recipients")
async def add_recipients(
    job_id: str,
    recipients: list[RecipientCreate],
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    job = await db.bulk_jobs.find_one(
        {"id": job_id, "company_id": user["company_id"]}, {"_id": 0, "id": 1, "status": 1}
    )
    if not job:
        raise HTTPException(status_code=404, detail="Job nao encontrado")
    if job.get("status") not in ("draft", "running", "paused"):
        raise HTTPException(status_code=400, detail=f"Job em estado '{job.get('status')}' nao aceita novos destinatarios")

    # Build set of opt-outs to skip.
    opt_outs = await db.bulk_opt_outs.find(
        {"company_id": user["company_id"]}, {"_id": 0, "phone": 1}
    ).to_list(50000)
    opted_set = {_digits(o["phone"]) for o in opt_outs}

    inserted = 0
    skipped = 0
    # Dedupe inside this batch by phone digits.
    seen = set()
    docs = []
    for r in recipients:
        d = _digits(r.phone)
        if not d or d in seen:
            skipped += 1
            continue
        seen.add(d)
        if d in opted_set:
            docs.append({
                "id": str(uuid.uuid4()),
                "job_id": job_id,
                "company_id": user["company_id"],
                "phone": d,
                "name": r.name or "",
                "custom_vars": r.custom_vars or {},
                "status": "opted_out",
                "connection_used": None,
                "message_rendered": None,
                "attempted_at": None,
                "sent_at": None,
                "error": "Pre-existing opt-out",
                "created_at": _now_iso(),
            })
        else:
            docs.append({
                "id": str(uuid.uuid4()),
                "job_id": job_id,
                "company_id": user["company_id"],
                "phone": d,
                "name": r.name or "",
                "custom_vars": r.custom_vars or {},
                "status": "pending",
                "connection_used": None,
                "message_rendered": None,
                "attempted_at": None,
                "sent_at": None,
                "error": None,
                "created_at": _now_iso(),
            })
    if docs:
        await db.bulk_job_recipients.insert_many(docs)
        inserted = sum(1 for d in docs if d["status"] == "pending")
        opted_skipped = sum(1 for d in docs if d["status"] == "opted_out")
        # audience_size = todos os contatos REGISTRADOS (pending + opted_out),
        # nao contamos `skipped_duplicates`/invalidos porque eles nem entram
        # no banco. Assim a barra de progresso fica sempre <= 100%.
        await db.bulk_jobs.update_one(
            {"id": job_id},
            {"$inc": {"audience_size": inserted + opted_skipped, "opted_out_count": opted_skipped, "skipped_count": skipped}},
        )
    return {"inserted_pending": inserted, "skipped_duplicates": skipped, "opted_out_pre_existing": sum(1 for d in docs if d["status"] == "opted_out")}


@router.get("/bulk/jobs/{job_id}/recipients")
async def list_recipients(
    job_id: str,
    status: Optional[str] = None,
    limit: int = 200,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    q = {"job_id": job_id, "company_id": user["company_id"]}
    if status:
        q["status"] = status
    docs = await db.bulk_job_recipients.find(q, {"_id": 0}).sort("created_at", 1).to_list(min(limit, 1000))
    return docs


@router.post("/bulk/jobs/{job_id}/action")
async def job_action(
    job_id: str,
    data: JobAction,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    job = await db.bulk_jobs.find_one(
        {"id": job_id, "company_id": user["company_id"]}, {"_id": 0, "status": 1}
    )
    if not job:
        raise HTTPException(status_code=404, detail="Job nao encontrado")
    cur = job.get("status")
    act = data.action.lower()
    transitions = {
        "start":  {"draft": "running", "paused": "running"},
        "resume": {"paused": "running", "draft": "running"},
        "pause":  {"running": "paused"},
        "cancel": {"draft": "cancelled", "running": "cancelled", "paused": "cancelled"},
    }
    nxt = transitions.get(act, {}).get(cur)
    if not nxt:
        raise HTTPException(status_code=400, detail=f"Transicao invalida: '{cur}' -> action '{act}'")
    update_set = {"status": nxt, "last_tick_at": _now_iso()}
    if nxt == "running" and cur == "draft":
        update_set["started_at"] = _now_iso()
    if nxt == "cancelled":
        update_set["completed_at"] = _now_iso()
    await db.bulk_jobs.update_one({"id": job_id}, {"$set": update_set})
    return {"id": job_id, "status": nxt}


# ─── Opt-outs ──────────────────────────────────────────────────────────
@router.get("/bulk/opt-outs")
async def list_opt_outs(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    docs = await db.bulk_opt_outs.find(
        {"company_id": user["company_id"]}, {"_id": 0}
    ).sort("opted_out_at", -1).to_list(2000)
    return docs


@router.post("/bulk/opt-outs")
async def add_opt_out(
    data: OptOutCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    phone = _digits(data.phone)
    if not phone:
        raise HTTPException(status_code=400, detail="Telefone invalido")
    await db.bulk_opt_outs.update_one(
        {"company_id": user["company_id"], "phone": phone},
        {"$set": {
            "company_id": user["company_id"],
            "phone": phone,
            "reason": data.reason or "manual",
            "opted_out_at": _now_iso(),
        }},
        upsert=True,
    )
    return {"phone": phone, "reason": data.reason or "manual"}


@router.delete("/bulk/opt-outs/{phone}")
async def remove_opt_out(
    phone: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    digits = _digits(phone)
    await db.bulk_opt_outs.delete_one({"company_id": user["company_id"], "phone": digits})
    return {"removed": digits}


class JobFromCampaign(BaseModel):
    """Override fields when creating a bulk_job from an existing campaign.

    The campaign provides: audience (resolved via _resolve_campaign_audience),
    message template, and basic metadata. This payload lets the operator
    upgrade it to the bulk pipeline (multi-conn, spintax, window, opt-out).
    """
    connection_ids: list[str]
    message_template_override: Optional[str] = None  # if None, uses campaign.messages[0]
    interval_min_sec: int = 8
    interval_max_sec: int = 25
    window: WindowConfig = WindowConfig()
    opt_out_keywords: list[str] = ["PARAR", "SAIR", "DESCADASTRAR", "STOP"]
    daily_cap_per_connection: int = 800
    auto_start: bool = True


@router.post("/bulk/jobs/from-campaign/{campaign_id}")
async def create_bulk_job_from_campaign(
    campaign_id: str,
    data: JobFromCampaign,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Boot a bulk_job pre-populated from an existing campaign:
      - Audience resolved via _resolve_campaign_audience (tags/list/all/no_tag)
      - Message template defaults to campaign.messages[0] (spintax allowed)
      - Pre-existing opt-outs filtered automatically
    Auto-starts if `auto_start=True`.
    """
    from routes.crm_routes import _resolve_campaign_audience
    camp = await db.campaigns.find_one(
        {"id": campaign_id, "company_id": user["company_id"]}, {"_id": 0}
    )
    if not camp:
        raise HTTPException(status_code=404, detail="Campanha nao encontrada")
    if not data.connection_ids:
        raise HTTPException(status_code=400, detail="Selecione ao menos uma conexao")
    # Validate connections belong to this company.
    valid = await db.channel_connections.count_documents({
        "company_id": user["company_id"],
        "id": {"$in": data.connection_ids},
    })
    if valid != len(data.connection_ids):
        raise HTTPException(status_code=400, detail="Conexao(oes) invalida(s)")

    msg_template = (
        data.message_template_override
        or (camp.get("messages") or [None])[0]
        or "Ola {{nome}}!"
    )
    audience = await _resolve_campaign_audience(db, user["company_id"], camp)
    if not audience:
        raise HTTPException(status_code=400, detail="Audiencia da campanha esta vazia")

    job_id = str(uuid.uuid4())
    job_doc = {
        "id": job_id,
        "company_id": user["company_id"],
        "name": f"[Campanha] {camp.get('name')}",
        "message_template": msg_template,
        "connection_ids": data.connection_ids,
        "rotation_strategy": "round_robin",
        "interval_min_sec": max(1, int(data.interval_min_sec)),
        "interval_max_sec": max(1, int(data.interval_max_sec)),
        "window": data.window.model_dump(),
        "opt_out_keywords": [k.strip().upper() for k in data.opt_out_keywords if k.strip()],
        "daily_cap_per_connection": data.daily_cap_per_connection,
        "campaign_id": campaign_id,
        "status": "draft",
        "audience_size": 0,
        "sent_count": 0,
        "failed_count": 0,
        "opted_out_count": 0,
        "skipped_count": 0,
        "next_rotation_idx": 0,
        "created_by": user.get("id") or user.get("email"),
        "created_at": _now_iso(),
        "started_at": None,
        "completed_at": None,
        "last_tick_at": None,
    }
    await db.bulk_jobs.insert_one(job_doc)

    # Insert recipients (dedup + opt-out filter)
    opt_outs = await db.bulk_opt_outs.find(
        {"company_id": user["company_id"]}, {"_id": 0, "phone": 1}
    ).to_list(50000)
    opted_set = {_digits(o["phone"]) for o in opt_outs}
    seen: set[str] = set()
    docs: list[dict] = []
    for person in audience:
        d = _digits(person.get("phone") or "")
        if not d or d in seen:
            continue
        seen.add(d)
        docs.append({
            "id": str(uuid.uuid4()),
            "job_id": job_id,
            "company_id": user["company_id"],
            "phone": d,
            "name": person.get("name") or "",
            "custom_vars": {},
            "status": "opted_out" if d in opted_set else "pending",
            "connection_used": None,
            "message_rendered": None,
            "attempted_at": None,
            "sent_at": None,
            "error": "Pre-existing opt-out" if d in opted_set else None,
            "created_at": _now_iso(),
        })
    if docs:
        await db.bulk_job_recipients.insert_many(docs)
        pending = sum(1 for d in docs if d["status"] == "pending")
        opted = sum(1 for d in docs if d["status"] == "opted_out")
        await db.bulk_jobs.update_one(
            {"id": job_id},
            {"$inc": {"audience_size": pending + opted, "opted_out_count": opted}},
        )

    if data.auto_start:
        await db.bulk_jobs.update_one(
            {"id": job_id},
            {"$set": {"status": "running", "started_at": _now_iso()}},
        )

    return await db.bulk_jobs.find_one({"id": job_id}, {"_id": 0})


# ─── Worker (called by scheduler) ──────────────────────────────────────
async def process_bulk_tick(db: AsyncIOMotorDatabase):
    """Single tick of the bulk worker. Designed to be called every ~15s."""
    from wa_dispatcher import dispatch_send_text
    from bulk_spintax import render_with_vars
    import random as _r

    now = datetime.now()  # naive local
    jobs = await db.bulk_jobs.find({"status": "running"}, {"_id": 0}).to_list(50)
    for job in jobs:
        try:
            if not is_within_window(job.get("window") or {}, now):
                # Outside window: just update tick and continue.
                await db.bulk_jobs.update_one({"id": job["id"]}, {"$set": {"last_tick_at": _now_iso()}})
                continue

            conn_ids = job.get("connection_ids") or []
            if not conn_ids:
                continue

            # Daily-cap counters per connection (today, UTC-naive boundary).
            today_iso_prefix = datetime.now(timezone.utc).date().isoformat()
            cap = int(job.get("daily_cap_per_connection") or 800)
            sent_today: dict[str, int] = {}
            agg = await db.bulk_job_recipients.aggregate([
                {"$match": {"job_id": job["id"], "status": "sent",
                            "sent_at": {"$gte": today_iso_prefix}}},
                {"$group": {"_id": "$connection_used", "count": {"$sum": 1}}},
            ]).to_list(100)
            for row in agg:
                sent_today[row["_id"]] = row["count"]
            available_conns = [c for c in conn_ids if sent_today.get(c, 0) < cap]
            if not available_conns:
                await db.bulk_jobs.update_one({"id": job["id"]}, {"$set": {"last_tick_at": _now_iso()}})
                continue

            # Pick batch — small per tick (5) to spread load across the 15s window.
            pending = await db.bulk_job_recipients.find(
                {"job_id": job["id"], "status": "pending"}, {"_id": 0}
            ).sort("created_at", 1).to_list(5)

            if not pending:
                # No work left -> mark completed.
                await db.bulk_jobs.update_one(
                    {"id": job["id"]},
                    {"$set": {"status": "completed", "completed_at": _now_iso()}},
                )
                continue

            rot_idx = int(job.get("next_rotation_idx") or 0)
            for rec in pending:
                # Choose connection (round-robin, skipping capped ones).
                conn_id = available_conns[rot_idx % len(available_conns)]
                rot_idx += 1

                vars_dict = {
                    "nome": rec.get("name") or "",
                    "numero": rec.get("phone") or "",
                    "telefone": rec.get("phone") or "",
                    **(rec.get("custom_vars") or {}),
                }
                msg = render_with_vars(job["message_template"], vars_dict)

                # Mark attempted before send (idempotency hint).
                await db.bulk_job_recipients.update_one(
                    {"id": rec["id"]},
                    {"$set": {"attempted_at": _now_iso(), "connection_used": conn_id, "message_rendered": msg}},
                )

                result = await dispatch_send_text(db, conn_id, rec["phone"], msg)

                if result.get("success"):
                    await db.bulk_job_recipients.update_one(
                        {"id": rec["id"]},
                        {"$set": {
                            "status": "sent",
                            "sent_at": _now_iso(),
                            "error": None,
                            "provider": result.get("provider"),
                            "message_id": result.get("message_id"),
                        }},
                    )
                    await db.bulk_jobs.update_one({"id": job["id"]}, {"$inc": {"sent_count": 1}})
                    sent_today[conn_id] = sent_today.get(conn_id, 0) + 1
                else:
                    await db.bulk_job_recipients.update_one(
                        {"id": rec["id"]},
                        {"$set": {
                            "status": "failed",
                            "error": (result.get("error") or "")[:300],
                            "provider": result.get("provider"),
                        }},
                    )
                    await db.bulk_jobs.update_one({"id": job["id"]}, {"$inc": {"failed_count": 1}})

                # Inter-message sleep (humanization between sends).
                imin = int(job.get("interval_min_sec") or 8)
                imax = int(job.get("interval_max_sec") or 25)
                delay = _r.randint(min(imin, imax), max(imin, imax))
                # Bound delay to keep tick under ~30s to not starve other jobs.
                delay = min(delay, 6)
                import asyncio
                await asyncio.sleep(delay)

            await db.bulk_jobs.update_one(
                {"id": job["id"]},
                {"$set": {"next_rotation_idx": rot_idx, "last_tick_at": _now_iso()}},
            )
        except Exception as e:
            logger.exception("[bulk] job %s tick failed: %s", job.get("id"), e)


# ─── Opt-out detection from inbound messages (called by webhook + Baileys) ──
async def check_and_record_opt_out(db: AsyncIOMotorDatabase, company_id: str, phone: str, message_text: str) -> bool:
    """Scan inbound message text against company-wide opt-out keywords from
    any bulk_job. If matched, record opt-out and return True."""
    if not message_text:
        return False
    txt = message_text.strip().upper()
    # Collect distinct opt-out keywords used by company's jobs.
    jobs = await db.bulk_jobs.find(
        {"company_id": company_id}, {"_id": 0, "opt_out_keywords": 1}
    ).to_list(500)
    keywords = set()
    for j in jobs:
        for k in (j.get("opt_out_keywords") or []):
            kk = k.strip().upper()
            if kk:
                keywords.add(kk)
    if not keywords:
        return False
    # Exact word match (avoid false positives in "I will STOP later" -> no).
    # Accept message that EQUALS keyword OR starts with it.
    matched = next((kw for kw in keywords if txt == kw or txt.startswith(kw + " ")), None)
    if not matched:
        return False
    digits = _digits(phone)
    await db.bulk_opt_outs.update_one(
        {"company_id": company_id, "phone": digits},
        {"$set": {
            "company_id": company_id,
            "phone": digits,
            "reason": f"keyword:{matched}",
            "opted_out_at": _now_iso(),
        }},
        upsert=True,
    )
    # Mark any pending recipients with this phone as opted_out.
    await db.bulk_job_recipients.update_many(
        {"company_id": company_id, "phone": digits, "status": "pending"},
        {"$set": {"status": "opted_out", "error": f"opt-out keyword '{matched}'"}},
    )
    logger.info("[bulk] opt-out recorded company=%s phone=%s keyword=%s", company_id, digits, matched)
    return True
