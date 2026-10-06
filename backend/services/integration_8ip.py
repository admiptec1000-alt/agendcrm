"""Integracao 8IP Admin (app.8ip.com.br) -> Financeiro Admin do AgentCRM.

PULL: busca os tenants do 8IP (GET /api/integrations/billing/tenants, header
X-Integration-Key) e faz upsert em `external_billing_clients` com
source="8ip". O scheduler de cobranca materializa as mensalidades a partir
desses clientes (valor = campo Mensalidade do 8IP, vencimento = dia de
vencimento do 8IP) e envia os lembretes WhatsApp.

AUTO-BLOCK: parcela vencida ha N dias -> POST .../tenants/{id}/block;
quitou tudo -> POST .../tenants/{id}/unblock.
"""
import logging
import uuid
from datetime import datetime, timezone, timedelta, date
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

SETTINGS_KEY = "integration_8ip"
SOURCE = "8ip"
DEFAULTS = {
    "enabled": False,
    "base_url": "",
    "api_key": "",
    "sync_interval_hours": 6,
    "auto_block_enabled": False,
    "auto_block_days": 7,
}


async def get_settings(db) -> dict:
    doc = await db.system_settings.find_one({"key": SETTINGS_KEY}, {"_id": 0}) or {}
    return {**DEFAULTS, **doc}


def _headers(settings: dict) -> dict:
    return {"X-Integration-Key": settings.get("api_key") or "", "Accept": "application/json"}


def _base(settings: dict) -> str:
    return (settings.get("base_url") or "").rstrip("/")


async def fetch_tenants(settings: dict) -> list[dict]:
    base = _base(settings)
    if not base or not settings.get("api_key"):
        raise ValueError("Configure a URL do 8IP Admin e a chave de integracao")
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.get(f"{base}/api/integrations/billing/tenants", headers=_headers(settings))
    if r.status_code == 401 or r.status_code == 403:
        raise ValueError("Chave de integracao recusada pelo 8IP Admin (401/403)")
    if r.status_code != 200:
        raise ValueError(f"8IP Admin respondeu HTTP {r.status_code}: {r.text[:200]}")
    body = r.json()
    items = body.get("tenants") if isinstance(body, dict) else body
    if not isinstance(items, list):
        raise ValueError("Resposta do 8IP Admin invalida (esperado lista de tenants)")
    return items


def _to_float(v) -> float:
    try:
        return float(str(v).replace(",", ".")) if v not in (None, "") else 0.0
    except Exception:
        return 0.0


def _first_due_from(day: int, start: Optional[str]) -> str:
    """Primeiro vencimento = primeiro `day` do mes em/apos `start` (ou hoje)."""
    try:
        base = datetime.fromisoformat(str(start).replace("Z", "+00:00")).date() if start else date.today()
    except Exception:
        base = date.today()
    base = max(base, date.today())

    def _on(y: int, m: int) -> date:
        try:
            return date(y, m, day)
        except ValueError:
            return date(y, m, 28)

    cand = _on(base.year, base.month)
    if cand < base:
        m = base.month % 12 + 1
        cand = _on(base.year + (1 if m == 1 else 0), m)
    return cand.isoformat()


def map_tenant(t: dict) -> dict:
    """Normaliza o payload do 8IP para o doc de external_billing_clients."""
    ext_id = str(t.get("id") or t.get("tenant_id") or t.get("slug") or "")
    billing_day = int(t.get("billing_day") or t.get("due_day") or 10)
    billing_day = max(1, min(31, billing_day))
    return {
        "external_id": ext_id,
        "name": (t.get("name") or t.get("company_name") or ext_id).strip(),
        "slug": t.get("slug"),
        "owner_name": t.get("owner_name") or t.get("owner") or None,
        "email": (t.get("email") or "").strip() or None,
        "phone": "".join(ch for ch in str(t.get("phone") or "") if ch.isdigit()) or None,
        "cnpj": (t.get("cnpj") or "").strip() or None,
        "plan_name": t.get("plan_name") or t.get("plan") or None,
        "monthly_price": round(_to_float(t.get("monthly_price") if t.get("monthly_price") is not None else t.get("mensalidade")), 2),
        "billing_day": billing_day,
        "discount": round(_to_float(t.get("discount")), 2),
        "is_active": bool(t.get("is_active", t.get("active", True))),
        "source_blocked": bool(t.get("is_blocked") or t.get("blocked") or False),
        "billing_start": t.get("billing_start") or t.get("created_at") or None,
        "source_updated_at": t.get("updated_at"),
    }


async def sync_tenants(db, *, triggered_by: str = "manual") -> dict:
    settings = await get_settings(db)
    started = datetime.now(timezone.utc)
    result = {"ok": False, "created": 0, "updated": 0, "deactivated": 0, "total": 0, "error": None,
              "triggered_by": triggered_by, "at": started.isoformat()}
    try:
        tenants = await fetch_tenants(settings)
    except Exception as e:
        result["error"] = str(e)[:300]
        await db.system_settings.update_one(
            {"key": SETTINGS_KEY},
            {"$set": {"last_sync_at": started.isoformat(), "last_sync_result": result}}, upsert=True)
        logger.warning(f"[8ip] sync failed: {e}")
        return result

    seen: set[str] = set()
    now_iso = started.isoformat()
    for t in tenants:
        m = map_tenant(t)
        if not m["external_id"]:
            continue
        seen.add(m["external_id"])
        existing = await db.external_billing_clients.find_one(
            {"source": SOURCE, "external_id": m["external_id"]}, {"_id": 0})
        if existing:
            first_due = existing.get("first_due_date")
            if existing.get("billing_day") != m["billing_day"] or not first_due:
                first_due = _first_due_from(m["billing_day"], None)
            upd = {**m, "first_due_date": first_due, "synced_at": now_iso, "missing_in_source": False,
                   "updated_at": now_iso}
            await db.external_billing_clients.update_one({"id": existing["id"]}, {"$set": upd})
            result["updated"] += 1
            price_changed = round(float(existing.get("monthly_price") or 0), 2) != m["monthly_price"]
            name_changed = (existing.get("name") or "") != m["name"]
            if price_changed or name_changed or (existing.get("discount") or 0) != m["discount"]:
                await db.super_admin_transactions.update_many(
                    {"external_client_id": existing["id"], "auto_company_billing": True, "status": "pendente"},
                    {"$set": {"amount": m["monthly_price"], "discount": m["discount"],
                              "external_client_name": m["name"],
                              "description": f"Mensalidade {m['name']}"}})
        else:
            doc = {
                "id": str(uuid.uuid4()), "source": SOURCE, **m,
                "first_due_date": _first_due_from(m["billing_day"], m.get("billing_start")),
                "blocked_by_billing": False, "missing_in_source": False,
                "notes": f"Importado do 8IP Admin ({m.get('plan_name') or 'sem plano'})",
                "created_at": now_iso, "synced_at": now_iso, "updated_at": now_iso,
            }
            await db.external_billing_clients.insert_one(doc)
            result["created"] += 1

    gone = await db.external_billing_clients.update_many(
        {"source": SOURCE, "external_id": {"$nin": list(seen)}, "is_active": True},
        {"$set": {"is_active": False, "missing_in_source": True, "updated_at": now_iso}})
    result["deactivated"] = gone.modified_count
    result["total"] = len(seen)
    result["ok"] = True
    await db.system_settings.update_one(
        {"key": SETTINGS_KEY},
        {"$set": {"last_sync_at": now_iso, "last_sync_result": result}}, upsert=True)
    logger.info(f"[8ip] sync ok total={len(seen)} created={result['created']} updated={result['updated']} deactivated={result['deactivated']}")

    try:
        from scheduler import _process_billing_reminders
        await _process_billing_reminders(db, send_messages=False, suppress_auto=True)
    except Exception as e:
        logger.warning(f"[8ip] materializacao pos-sync falhou: {e}")
    return result


async def set_tenant_block(settings: dict, external_id: str, blocked: bool, reason: str) -> tuple[bool, Optional[str]]:
    base = _base(settings)
    if not base or not settings.get("api_key"):
        return False, "integration_not_configured"
    action = "block" if blocked else "unblock"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(f"{base}/api/integrations/billing/tenants/{external_id}/{action}",
                                  headers=_headers(settings), json={"reason": reason, "source": "agentcrm"})
        if r.status_code in (200, 201, 204):
            return True, None
        return False, f"HTTP {r.status_code}: {r.text[:160]}"
    except Exception as e:
        return False, f"exception: {str(e)[:160]}"


async def apply_block(db, client: dict, blocked: bool, reason: str, *, by: str = "auto") -> tuple[bool, Optional[str]]:
    settings = await get_settings(db)
    ok, err = await set_tenant_block(settings, client["external_id"], blocked, reason)
    now_iso = datetime.now(timezone.utc).isoformat()
    log = {"id": str(uuid.uuid4()), "external_client_id": client["id"], "external_id": client["external_id"],
           "action": "block" if blocked else "unblock", "ok": ok, "error": err, "reason": reason, "by": by,
           "created_at": now_iso}
    await db.integration_8ip_block_log.insert_one(log)
    if ok:
        await db.external_billing_clients.update_one(
            {"id": client["id"]},
            {"$set": {"blocked_by_billing": blocked,
                      "blocked_at": now_iso if blocked else None,
                      "unblocked_at": None if blocked else now_iso,
                      "block_reason": reason if blocked else None}})
    return ok, err


async def process_autoblock(db) -> dict:
    """Roda no scheduler (1x por hora). Bloqueia tenants 8IP com parcela
    vencida ha >= auto_block_days; desbloqueia quando nao houver mais
    parcela vencida."""
    settings = await get_settings(db)
    out = {"blocked": 0, "unblocked": 0, "errors": 0}
    if not settings.get("enabled") or not settings.get("auto_block_enabled"):
        return out
    days = max(0, int(settings.get("auto_block_days") or 7))
    limit = (date.today() - timedelta(days=days)).isoformat()
    clients = await db.external_billing_clients.find({"source": SOURCE}, {"_id": 0}).to_list(2000)
    for c in clients:
        try:
            overdue = await db.super_admin_transactions.find_one(
                {"external_client_id": c["id"], "status": "pendente", "due_date": {"$lte": limit}},
                {"_id": 0, "id": 1, "due_date": 1, "description": 1})
            if overdue and c.get("is_active") and not c.get("blocked_by_billing"):
                ok, _ = await apply_block(db, c, True, f"Mensalidade vencida em {overdue.get('due_date')} ({days}d)")
                out["blocked" if ok else "errors"] += 1
            elif not overdue and c.get("blocked_by_billing"):
                ok, _ = await apply_block(db, c, False, "Pagamento regularizado")
                out["unblocked" if ok else "errors"] += 1
        except Exception as e:
            out["errors"] += 1
            logger.warning(f"[8ip] autoblock error client={c.get('id')}: {e}")
    if any(out.values()):
        logger.info(f"[8ip] autoblock {out}")
    return out


async def scheduler_step(db) -> None:
    """Chamado a cada tick: sync quando passou o intervalo; autoblock 1x/h."""
    settings = await get_settings(db)
    if not settings.get("enabled"):
        return
    now = datetime.now(timezone.utc)
    interval_h = max(1, int(settings.get("sync_interval_hours") or 6))
    last = settings.get("last_sync_at")
    due_sync = True
    if last:
        try:
            due_sync = (now - datetime.fromisoformat(last)) >= timedelta(hours=interval_h)
        except Exception:
            due_sync = True
    if due_sync:
        await sync_tenants(db, triggered_by="scheduler")
    last_ab = settings.get("last_autoblock_at")
    due_ab = True
    if last_ab:
        try:
            due_ab = (now - datetime.fromisoformat(last_ab)) >= timedelta(hours=1)
        except Exception:
            due_ab = True
    if due_ab:
        res = await process_autoblock(db)
        await db.system_settings.update_one(
            {"key": SETTINGS_KEY},
            {"$set": {"last_autoblock_at": now.isoformat(), "last_autoblock_result": res}}, upsert=True)
