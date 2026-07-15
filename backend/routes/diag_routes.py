"""Diagnostic endpoints — capture frontend runtime crashes (React
ErrorBoundary) so operators can investigate real production errors
without having to reproduce or ask users for stack traces.

2026-07-14 — Introduced after production incident where the "Conexoes"
page rendered blank/errored on some browsers. The old ErrorBoundary only
console.error'd the exception, which is invisible to us. Now the boundary
POSTs the payload here and the Super Admin can review the log in the
dashboard.
"""
import os
import re
import uuid
import logging
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, Request
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel
from typing import Optional

from auth import require_super_admin
from database import get_database

logger = logging.getLogger("diag_routes")
router = APIRouter(prefix="/diag", tags=["diagnostics"])

# Keep at most 500 crash records — plenty for post-mortems, trivial in
# storage. Older records purge in the background sweep below.
MAX_KEEP = 500
CRASH_TTL_DAYS = 30


class FrontendCrashIn(BaseModel):
    # Which page/route triggered the boundary (e.g. "conexoes").
    page: Optional[str] = None
    # `Error.message` from React.
    message: Optional[str] = None
    # Full JS stack trace (may be quite long — capped server-side).
    stack: Optional[str] = None
    # React componentStack — helps pinpoint the failing component.
    component_stack: Optional[str] = None
    # Browser user-agent (client-provided; useful to spot browser-specific
    # regressions).
    user_agent: Optional[str] = None
    # window.location.href when the crash fired.
    url: Optional[str] = None
    # Optional tenant hints (best-effort; the endpoint is unauthenticated
    # so the boundary can report even when the token expired).
    company_id: Optional[str] = None
    user_email: Optional[str] = None
    # Extra structured context (React version, build hash, etc.).
    context: Optional[dict] = None


def _clip(v: Optional[str], n: int) -> Optional[str]:
    if v is None:
        return None
    v = str(v)
    return v if len(v) <= n else v[:n] + "…"


@router.post("/frontend-crash")
async def report_frontend_crash(
    payload: FrontendCrashIn,
    request: Request,
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Fire-and-forget crash report from the React ErrorBoundary.
    Intentionally unauthenticated — a crashing page may not have a valid
    session (e.g. corrupted local storage). Deduped by (page, message,
    stack-hash) within a 5-min window so a repeated crash doesn't flood
    the collection.
    """
    now = datetime.now(timezone.utc)
    # Quick fingerprint (page + first line of stack) for dedup within a 5-min window.
    stack_head = (payload.stack or "").split("\n")[0][:200]
    fingerprint = f"{payload.page or ''}|{_clip(payload.message, 200)}|{stack_head}"

    try:
        cutoff = (now - timedelta(minutes=5)).isoformat()
        existing = await db.frontend_crashes.find_one({
            "fingerprint": fingerprint,
            "created_at": {"$gte": cutoff},
        })
        if existing:
            await db.frontend_crashes.update_one(
                {"id": existing["id"]},
                {"$inc": {"repeat_count": 1}, "$set": {"last_seen_at": now.isoformat()}},
            )
            return {"ok": True, "deduped": True}
    except Exception:
        pass

    # Pull IP from request (behind proxy, best-effort).
    xff = request.headers.get("x-forwarded-for") or ""
    ip = xff.split(",")[0].strip() or (request.client.host if request.client else None)

    doc = {
        "id": str(uuid.uuid4()),
        "page": _clip(payload.page, 100),
        "message": _clip(payload.message, 2000),
        "stack": _clip(payload.stack, 8000),
        "component_stack": _clip(payload.component_stack, 4000),
        "user_agent": _clip(payload.user_agent or request.headers.get("user-agent"), 500),
        "url": _clip(payload.url, 500),
        "company_id": _clip(payload.company_id, 100),
        "user_email": _clip(payload.user_email, 200),
        "context": payload.context or {},
        "ip": _clip(ip, 60),
        "fingerprint": fingerprint,
        "repeat_count": 1,
        "created_at": now.isoformat(),
        "last_seen_at": now.isoformat(),
    }
    try:
        await db.frontend_crashes.insert_one(doc)
        logger.warning(
            f"[frontend-crash] page={doc['page']!r} msg={(doc['message'] or '')[:120]!r} "
            f"company={doc['company_id']} user={doc['user_email']}"
        )
        # Background trim so the collection never grows unbounded.
        try:
            total = await db.frontend_crashes.estimated_document_count()
            if total > MAX_KEEP:
                # Delete anything older than CRASH_TTL_DAYS first.
                ttl_cutoff = (now - timedelta(days=CRASH_TTL_DAYS)).isoformat()
                await db.frontend_crashes.delete_many({"created_at": {"$lt": ttl_cutoff}})
        except Exception:
            pass
    except Exception as e:
        logger.error(f"[frontend-crash] persist failed: {e}")
        return {"ok": False, "error": "persist_failed"}

    return {"ok": True, "id": doc["id"]}


@router.get("/frontend-crashes", dependencies=[Depends(require_super_admin)])
async def list_frontend_crashes(
    limit: int = 100,
    page: Optional[str] = None,
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """List recent frontend crashes — Super Admin only."""
    q = {}
    if page:
        q["page"] = page
    limit = max(1, min(limit, 500))
    docs = await db.frontend_crashes.find(q, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return {"crashes": docs, "count": len(docs)}


@router.delete("/frontend-crashes", dependencies=[Depends(require_super_admin)])
async def clear_frontend_crashes(
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Wipe the crash log — Super Admin only. Useful after a fix redeploy."""
    r = await db.frontend_crashes.delete_many({})
    return {"ok": True, "deleted": r.deleted_count}
