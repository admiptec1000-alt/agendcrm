from fastapi import APIRouter, Depends, HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorDatabase
from database import get_database
from auth import get_current_user
from pydantic import BaseModel
from typing import Optional, List, Dict
import base64
import uuid
import httpx
import os
import re
import logging
from datetime import datetime, timezone, timedelta
from counters import next_ticket_number
from clients_link import find_or_create_client_by_phone
from routes.upload_routes import put_object, APP_NAME

router = APIRouter(prefix="/channels", tags=["channels"])
logger = logging.getLogger(__name__)

WA_SERVICE_URL = os.environ.get("WA_SERVICE_URL", "http://localhost:3002")


# Extensions for inbound WhatsApp media (used when we store the file in
# object storage and persist a URL on the message). Keep this small — we
# only need enough to help the browser pick a decoder / renderer.
_MEDIA_EXT_BY_KIND = {
    "audio": "ogg",      # WhatsApp ships audio as Opus-in-Ogg
    "image": "jpg",
    "video": "mp4",
    "document": "bin",
    "sticker": "webp",
}


def _ext_for_mime(mimetype: Optional[str], kind: str) -> str:
    """Pick a best-effort file extension for the MIME / media-kind combo."""
    if mimetype:
        mt = mimetype.lower().split(";")[0].strip()
        mapping = {
            "audio/ogg": "ogg", "audio/opus": "opus",
            "audio/mpeg": "mp3", "audio/mp4": "m4a",
            "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
            "video/mp4": "mp4", "video/webm": "webm",
            "application/pdf": "pdf",
        }
        if mt in mapping:
            return mapping[mt]
        if "/" in mt:
            return mt.split("/", 1)[1][:5]
    return _MEDIA_EXT_BY_KIND.get(kind, "bin")


async def _persist_inbound_media(
    db: AsyncIOMotorDatabase,
    company_id: str,
    media_base64: str,
    mimetype: Optional[str],
    kind: str,
    filename: Optional[str] = None,
) -> Optional[dict]:
    """Decode a base64 media blob sent from the WhatsApp microservice, push
    it to object storage and register it in `db.files`. Returns a small
    descriptor `{url, mimetype, size, filename}` or None on failure."""
    try:
        data = base64.b64decode(media_base64)
    except Exception as e:
        logger.warning(f"[webhook/media] bad base64: {e}")
        return None
    if not data:
        return None
    ext = _ext_for_mime(mimetype, kind)
    file_id = str(uuid.uuid4())
    path = f"{APP_NAME}/wa/{company_id}/{file_id}.{ext}"
    try:
        # put_object is sync (requests) — run in a worker thread so we don't
        # block the event loop for big files.
        import asyncio
        result = await asyncio.to_thread(
            put_object, path, data, mimetype or "application/octet-stream"
        )
    except Exception as e:
        logger.error(f"[webhook/media] object_store upload failed: {e}")
        return None
    try:
        await db.files.insert_one({
            "id": file_id,
            "company_id": company_id,
            "storage_path": result["path"],
            "original_filename": filename or f"{kind}.{ext}",
            "content_type": mimetype,
            "size": result.get("size", len(data)),
            "is_deleted": False,
            "uploaded_by": "whatsapp:webhook",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as e:
        logger.warning(f"[webhook/media] db.files insert failed (non-fatal): {e}")
    return {
        "url": f"/api/upload/files/{result['path']}",
        "mimetype": mimetype,
        "size": result.get("size", len(data)),
        "filename": filename or f"{kind}.{ext}",
    }


@router.get("/service-health")
async def service_health(user: dict = Depends(get_current_user)):
    """Check if the WhatsApp microservice (Baileys) is reachable.
    Now (2026-02-15 (F)) returns the running `version` + feature flags so
    the SA panel can show whether prod is on the latest patch level."""
    import time
    start = time.time()
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(f"{WA_SERVICE_URL}/health")
            data = resp.json()
            # Also fetch /version for the feature flag block. Optional —
            # ignored if endpoint not present (older builds).
            version_info = None
            try:
                vresp = await client.get(f"{WA_SERVICE_URL}/version")
                if vresp.status_code == 200:
                    version_info = vresp.json()
            except Exception:
                pass
            elapsed_ms = int((time.time() - start) * 1000)
            return {
                "online": True,
                "instances": data.get("instances", 0),
                "version": data.get("version") or (version_info or {}).get("version"),
                "details": data.get("details") or [],
                "features": (version_info or {}).get("features") or {},
                "latency_ms": elapsed_ms,
                "url": WA_SERVICE_URL,
            }
    except Exception as e:
        elapsed_ms = int((time.time() - start) * 1000)
        logger.warning(f"WA service unreachable: {e}")
        return {
            "online": False,
            "instances": 0,
            "latency_ms": elapsed_ms,
            "error": str(e)[:100],
            "url": WA_SERVICE_URL,
        }


@router.get("/service-version-check")
async def service_version_check(user: dict = Depends(get_current_user)):
    """Probe the WA microservice to confirm the latest patches are deployed.
    Used by the 'Verificar Deploy' button after the user redeploys on Render.
    """
    checks = {
        "online": False,
        "version": None,
        "features": {},
        "url": WA_SERVICE_URL,
        "details": [],
    }
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(f"{WA_SERVICE_URL}/health")
            if r.status_code == 200:
                checks["online"] = True
                checks["details"].append("✓ Microservico online")
            else:
                checks["details"].append(f"✗ Health retornou HTTP {r.status_code}")

            # Query new /version endpoint — only exists in v2.1.0+
            v = await client.get(f"{WA_SERVICE_URL}/version")
            if v.status_code == 200:
                data = v.json()
                checks["version"] = data.get("version")
                checks["features"] = data.get("features") or {}
                checks["fastapi_url_on_render"] = data.get("fastapi_url")
                checks["details"].append(f"✓ Versao: {data.get('version')} (build {data.get('built_at')})")
                # Check if FASTAPI_URL points to a public host (not localhost)
                fu = data.get("fastapi_url") or ""
                if "localhost" in fu or "127.0.0.1" in fu:
                    checks["details"].append("⚠ FASTAPI_URL aponta para localhost — mensagens recebidas NAO chegam ao backend!")
                else:
                    checks["details"].append(f"✓ FASTAPI_URL: {fu}")
            else:
                checks["details"].append("✗ Endpoint /version ausente — REDEPLOY PENDENTE (versao antiga)")
    except Exception as e:
        checks["details"].append(f"✗ Erro: {str(e)[:120]}")
    checks["redeploy_done"] = bool(checks["online"] and checks.get("version"))
    return checks


@router.get("/connections/health")
async def connections_health(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    """2026-06 — Monitor de saude por conexao (Baileys).
    Agrega telemetria do microservico (/instances/health-all): uptime,
    ultima mensagem recebida, reconexoes 24h e log de eventos. Classifica
    cada conexao em green/yellow/red para o chip visual no frontend:
      - red:    desconectada (ou DB diz 'connected' mas instancia sumiu = zumbi)
      - yellow: conectando/aguardando QR, ou conectada porem sem receber
                mensagem ha 30+ min (pode ser normal em horario calmo)
      - green:  conectada e recebendo trafego recente
    """
    conns = await db.channel_connections.find(
        {"company_id": user["company_id"]},
        {"_id": 0, "id": 1, "provider": 1, "status": 1},
    ).to_list(100)

    raw = {}
    service_online = True
    telemetry_available = False
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(f"{WA_SERVICE_URL}/instances/health-all")
            if resp.status_code == 200:
                raw = resp.json()
                telemetry_available = True
            # 404 = microservico online porem em versao antiga (sem o
            # endpoint de telemetria). NAO marcar conexoes como vermelhas —
            # mostra "Sem dados" ate o redeploy do microservico.
    except Exception as e:
        logger.warning(f"WA health-all unreachable: {e}")
        service_online = False

    IDLE_YELLOW_MS = 30 * 60 * 1000
    out = {}
    for c in conns:
        if (c.get("provider") or "baileys") != "baileys":
            continue
        if not telemetry_available:
            out[c["id"]] = {"level": "gray", "status": "telemetry_unavailable", "events": [], "reconnects_24h": 0}
            continue
        h = raw.get(c["id"])
        if not h:
            # Microservico nao conhece essa instancia (nunca conectou ou
            # redeploy zerou a memoria). Se o DB acha que esta conectada,
            # eh um zumbi — vermelho.
            out[c["id"]] = {
                "level": "red" if c.get("status") == "connected" else "gray",
                "status": "not_found",
                "events": [],
                "reconnects_24h": 0,
            }
            continue
        if h.get("status") == "connected":
            idle = h.get("last_inbound_ago_ms")
            h["level"] = "yellow" if (idle is not None and idle > IDLE_YELLOW_MS) else "green"
        elif h.get("status") in ("connecting", "waiting_qr"):
            h["level"] = "yellow"
        else:
            h["level"] = "red"
        out[c["id"]] = h
    return {"service_online": service_online, "telemetry_available": telemetry_available, "connections": out}


# === MODELS ===
class HumanizationConfig(BaseModel):
    """Per-connection humanization settings used by flow + campaigns to make
    outgoing messages look organic to WhatsApp / recipients. Empty/None
    keeps current (instant) behavior."""
    enabled: bool = False
    # Typing presence shown to recipient BEFORE the message is actually sent.
    # Backend picks a random value in [min,max] and forwards as
    # `humanize_typing_ms` to the WA microservice.
    typing_min_ms: int = 800
    typing_max_ms: int = 2500
    # Whether to broadcast `available` presence right after the send (so the
    # recipient sees "online" once the bubble lands). Cheap and useful for
    # marketing flows.
    presence_online: bool = True
    # 2026-02-28 — Provedor do canal: hoje somente Baileys (QR).
    # `whatsapp_cloud` reservado para a Fase 3 (Meta Official API).

class ConnectionCreate(BaseModel):
    name: str
    type: str = "whatsapp"  # whatsapp, instagram
    phone: Optional[str] = None
    default_flow_id: Optional[str] = None  # Flowbuilder flow auto-triggered on first message
    queue_ids: List[str] = []  # filas que recebem tickets dessa conexao
    # 2026-02-28 — Provedor (Baileys=padrao QR ou Meta Official Cloud API).
    # Quando provider=whatsapp_cloud, phone_number_id eh obrigatorio.
    provider: Optional[str] = "baileys"
    phone_number_id: Optional[str] = None  # Meta Cloud API
    humanization: Optional[HumanizationConfig] = None

class ConnectionUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None
    default_flow_id: Optional[str] = None  # set to "" to clear, or new flow id
    queue_ids: Optional[List[str]] = None  # multi-select de filas
    phone_number_id: Optional[str] = None  # Meta Cloud API
    humanization: Optional[HumanizationConfig] = None

class TemplateCreate(BaseModel):
    process_key: str
    label: str
    description: Optional[str] = None
    message: str
    active: bool = True

class TemplateUpdate(BaseModel):
    message: Optional[str] = None
    active: Optional[bool] = None

class ScheduledMessageCreate(BaseModel):
    recipient: str
    channel: str = "whatsapp"
    message: str
    scheduled_at: str
    template_key: Optional[str] = None

class ScheduledMessageUpdate(BaseModel):
    status: Optional[str] = None


# === CONNECTIONS ===
@router.get("/connections")
async def list_connections(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    connections = await db.channel_connections.find(
        {"company_id": user["company_id"]}, {"_id": 0}
    ).to_list(100)
    return connections


@router.post("/connections")
async def create_connection(
    data: ConnectionCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    # Enforce the company's license-derived connection limit. Companies
    # without a max (legacy / pre-licenses) are exempt. Block ONLY new
    # creation; pre-existing excess connections keep working.
    from routes.licenses_routes import enforce_company_limit
    await enforce_company_limit(db, user["company_id"], "connection")

    # 2026-02-28 — Provedor whatsapp_cloud (Meta API) tem regras proprias.
    provider = (data.provider or "baileys").lower()
    if provider not in ("baileys", "whatsapp_cloud"):
        raise HTTPException(status_code=400, detail="Provedor invalido (baileys ou whatsapp_cloud)")
    if provider == "whatsapp_cloud" and not data.phone_number_id:
        raise HTTPException(
            status_code=400,
            detail="phone_number_id obrigatorio para provider whatsapp_cloud. Cadastre credenciais Meta primeiro.",
        )
    # Bloquear o mesmo numero fisico atravessar 2 providers (Meta Coexistence quebra Baileys).
    if data.phone:
        digits = "".join(ch for ch in data.phone if ch.isdigit())
        if digits:
            clash = await db.channel_connections.find_one({
                "company_id": user["company_id"],
                "$or": [{"phone": data.phone}, {"phone": digits}],
                "provider": {"$ne": provider},
            })
            if clash:
                raise HTTPException(
                    status_code=400,
                    detail=f"Numero ja em uso pelo provedor '{clash.get('provider')}'. Um numero fisico nao pode rodar Baileys + Meta simultaneamente.",
                )

    conn = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "name": data.name,
        "type": data.type,
        "phone": data.phone,
        "default_flow_id": data.default_flow_id or None,
        "queue_ids": data.queue_ids or [],
        "provider": provider,
        "phone_number_id": data.phone_number_id,
        "humanization": (data.humanization.model_dump() if data.humanization else None),
        "status": "connected" if provider == "whatsapp_cloud" else "disconnected",
        "qr_code": None,
        "last_connected": (datetime.now(timezone.utc).isoformat() if provider == "whatsapp_cloud" else None),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.channel_connections.insert_one(conn)
    return {k: v for k, v in conn.items() if k != "_id"}


@router.post("/connections/{conn_id}/connect")
async def connect_channel(
    conn_id: str,
    request: Request,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    conn = await db.channel_connections.find_one({"id": conn_id, "company_id": user["company_id"]})
    if not conn:
        raise HTTPException(status_code=404, detail="Conexao nao encontrada")

    # 2026-02-28 — Opcional sync de historico (30 dias). Recebido como
    # JSON body: {"sync_history": true}. Repassado ao microservico Baileys
    # pra ligar syncFullHistory na sessao desta conexao.
    sync_history = False
    try:
        body = await request.json()
        sync_history = bool(body.get("sync_history"))
    except Exception:
        pass

    if conn["type"] == "whatsapp":
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(
                    f"{WA_SERVICE_URL}/instances/{conn_id}/connect",
                    json={"sync_history": sync_history} if sync_history else {},
                )
                resp.json()  # validate response
            await db.channel_connections.update_one({"id": conn_id}, {"$set": {"status": "connecting"}})
        except Exception as e:
            logger.error(f"WhatsApp connect error: {e}")
            await db.channel_connections.update_one({"id": conn_id}, {"$set": {"status": "waiting_qr"}})
    else:
        await db.channel_connections.update_one({"id": conn_id}, {"$set": {"status": "waiting_qr"}})

    return await db.channel_connections.find_one({"id": conn_id}, {"_id": 0})


@router.get("/connections/{conn_id}/qr")
async def get_connection_qr(
    conn_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    conn = await db.channel_connections.find_one({"id": conn_id, "company_id": user["company_id"]})
    if not conn:
        raise HTTPException(status_code=404, detail="Conexao nao encontrada")

    if conn["type"] == "whatsapp":
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(f"{WA_SERVICE_URL}/instances/{conn_id}/qr")
                data = resp.json()
                node_status = data.get("status", "disconnected")

                # Self-heal: if DB thinks connection is waiting_qr/connecting but Node has no instance,
                # trigger a new connect so Baileys re-emits the QR.
                if (
                    conn.get("status") in ("waiting_qr", "connecting")
                    and node_status in ("not_found", "disconnected")
                    and not data.get("qr_base64")
                ):
                    try:
                        await client.post(f"{WA_SERVICE_URL}/instances/{conn_id}/connect")
                    except Exception as e:
                        logger.warning(f"Self-heal connect failed for {conn_id}: {e}")

            return {"qr": data.get("qr"), "qr_base64": data.get("qr_base64"), "status": node_status}
        except Exception as e:
            logger.error(f"WhatsApp QR proxy error: {e}")
            return {"qr": None, "qr_base64": None, "status": "error"}
    return {"qr": None, "qr_base64": None, "status": conn.get("status")}


@router.post("/connections/{conn_id}/sync")
async def sync_connection_with_remote(
    conn_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    """Reconcile DB connection with actual Baileys state on the remote service.

    Handles the case where the remote (Render) lost persistence (cold start)
    and now has a DIFFERENT instance id than what the DB expects. If the remote
    has any connected instance for this company and the DB one isn't connected,
    we adopt the remote id/status.
    """
    conn = await db.channel_connections.find_one({"id": conn_id, "company_id": user["company_id"]})
    if not conn:
        raise HTTPException(status_code=404, detail="Conexao nao encontrada")
    if conn.get("type") != "whatsapp":
        return conn

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # 1) Try our own id first
            r = await client.get(f"{WA_SERVICE_URL}/instances/{conn_id}/status")
            st = r.json() if r.status_code == 200 else {}
            if st.get("connected"):
                await db.channel_connections.update_one(
                    {"id": conn_id},
                    {"$set": {"status": "connected", "last_connected": datetime.now(timezone.utc).isoformat()}}
                )
                return await db.channel_connections.find_one({"id": conn_id}, {"_id": 0})

            # 2) Walk all remote instances to find one that's connected
            r_all = await client.get(f"{WA_SERVICE_URL}/instances")
            remote = r_all.json() if r_all.status_code == 200 else []
            # Ignore instances already bound to some other company connection
            bound_ids = set()
            async for c in db.channel_connections.find({}, {"_id": 0, "id": 1}):
                bound_ids.add(c["id"])
            candidate = None
            for inst in remote:
                if inst.get("connected") and inst.get("id") not in bound_ids:
                    candidate = inst
                    break
            if candidate:
                new_id = candidate["id"]
                # Rebind: move DB row to the new id
                await db.channel_connections.update_one(
                    {"id": conn_id},
                    {"$set": {
                        "id": new_id,
                        "status": "connected",
                        "phone": (candidate.get("user") or {}).get("id", "").split(":")[0] or conn.get("phone"),
                        "last_connected": datetime.now(timezone.utc).isoformat(),
                        "qr_code": None,
                    }}
                )
                return await db.channel_connections.find_one({"id": new_id}, {"_id": 0})

            # 3) Nothing connected out there — mark disconnected
            await db.channel_connections.update_one(
                {"id": conn_id}, {"$set": {"status": "disconnected"}}
            )
    except Exception as e:
        logger.warning(f"Sync failed for {conn_id}: {e}")
        raise HTTPException(status_code=502, detail="Erro ao sincronizar com o servico")

    return await db.channel_connections.find_one({"id": conn_id}, {"_id": 0})


@router.post("/connections/{conn_id}/disconnect")
async def disconnect_channel(
    conn_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    conn = await db.channel_connections.find_one({"id": conn_id, "company_id": user["company_id"]})
    if not conn:
        raise HTTPException(status_code=404, detail="Conexao nao encontrada")

    if conn["type"] == "whatsapp":
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                await client.post(f"{WA_SERVICE_URL}/instances/{conn_id}/disconnect")
        except Exception as e:
            logger.error(f"Disconnect error: {e}")

    await db.channel_connections.update_one(
        {"id": conn_id}, {"$set": {"status": "disconnected", "qr_code": None}}
    )
    return await db.channel_connections.find_one({"id": conn_id}, {"_id": 0})


@router.post("/connections/{conn_id}/force-reconnect")
async def force_reconnect_channel(
    conn_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    """2026-02-16 (Q) — Manual recovery hatch for stale Baileys sockets.
    Forces the microservice to recycle the socket without dropping the
    on-disk auth (so QR doesn't need to be re-scanned). Resets the
    consecutive failure counter from the auto-detection (flow_engine).

    Triggered by the frontend banner when a connection is flagged as
    unhealthy by the auto-detection in `flow_engine._bump_send_failure`.
    """
    conn = await db.channel_connections.find_one({"id": conn_id, "company_id": user["company_id"]})
    if not conn:
        raise HTTPException(status_code=404, detail="Conexao nao encontrada")
    error = None
    if conn["type"] == "whatsapp":
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                r = await client.post(f"{WA_SERVICE_URL}/instances/{conn_id}/restart")
                if r.status_code >= 400:
                    error = f"baileys_status_{r.status_code}"
        except Exception as e:
            error = str(e)[:200]
            logger.error(f"Force reconnect error: {e}")
    await db.channel_connections.update_one(
        {"id": conn_id},
        {"$set": {
            "send_failures_count": 0,
            "last_manual_reconnect_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    if error:
        raise HTTPException(502, f"Falha ao forcar reconexao: {error}")
    return {"ok": True}


@router.post("/connections/{conn_id}/reset-signal-session")
async def reset_signal_session(
    conn_id: str,
    body: dict,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    """2026-02-17 (v2.1.16) — Nuclear-option recovery for the persistent
    "Aguardando mensagem" symptom on a SPECIFIC customer. The operator
    triggers this from the ticket UI; backend proxies to the Baileys
    microservice which wipes the Signal session record for that JID and
    flags it for force-rebuild on the next send.

    Body: {"phone": "5562988887777"}
    """
    phone = (body.get("phone") or "").strip()
    if not phone:
        raise HTTPException(400, "phone is required")
    conn = await db.channel_connections.find_one(
        {"id": conn_id, "company_id": user["company_id"]}
    )
    if not conn:
        raise HTTPException(404, "Conexao nao encontrada")
    if conn.get("type") != "whatsapp":
        raise HTTPException(400, "Reset apenas suportado em conexoes WhatsApp")
    try:
        from urllib.parse import quote as _q
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                f"{WA_SERVICE_URL}/instances/{conn_id}/reset-session/{_q(phone)}"
            )
        if r.status_code >= 400:
            raise HTTPException(502, f"Baileys retornou {r.status_code}: {r.text[:200]}")
        return r.json()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"reset-signal-session error: {e}")
        raise HTTPException(500, f"Falha ao resetar sessao: {str(e)[:200]}")



# === WHATSAPP CONTACTS IMPORT ===
class ImportWaContactsRequest(BaseModel):
    mode: str = "all"  # all | with_name | without_name
    list_id: Optional[str] = None  # optional contact_lists doc to populate


@router.get("/connections/{conn_id}/wa-contacts")
async def get_whatsapp_contacts(
    conn_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    conn = await db.channel_connections.find_one({"id": conn_id, "company_id": user["company_id"]})
    if not conn:
        raise HTTPException(status_code=404, detail="Conexao nao encontrada")
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.get(f"{WA_SERVICE_URL}/instances/{conn_id}/contacts")
            data = r.json() if r.status_code == 200 else {"contacts": []}
        return data
    except Exception as e:
        logger.warning(f"wa-contacts fetch failed: {e}")
        return {"contacts": [], "error": str(e)[:120]}


@router.post("/connections/{conn_id}/import-contacts")
async def import_whatsapp_contacts(
    conn_id: str,
    body: ImportWaContactsRequest,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    conn = await db.channel_connections.find_one({"id": conn_id, "company_id": user["company_id"]})
    if not conn:
        raise HTTPException(status_code=404, detail="Conexao nao encontrada")
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.get(f"{WA_SERVICE_URL}/instances/{conn_id}/contacts")
            payload = r.json() if r.status_code == 200 else {"contacts": []}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Microservico indisponivel: {str(e)[:80]}")

    raw = payload.get("contacts") or []
    filtered = []
    for c in raw:
        phone = (c.get("phone") or "").strip()
        name = (c.get("name") or "").strip()
        if not phone:
            continue
        if body.mode == "with_name" and not name:
            continue
        if body.mode == "without_name" and name:
            continue
        filtered.append({"phone": phone, "name": name})

    # Insert/upsert into clients collection (lightweight)
    upserted = 0
    for it in filtered:
        existing = await db.clients.find_one({"company_id": user["company_id"], "phone": it["phone"]})
        if not existing:
            await db.clients.insert_one({
                "id": str(uuid.uuid4()),
                "company_id": user["company_id"],
                "name": it["name"] or it["phone"],
                "phone": it["phone"],
                "tags": [],
                "source": "whatsapp_import",
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            upserted += 1

    # Optionally append to a contact list
    appended = 0
    if body.list_id:
        await db.contact_lists.update_one(
            {"id": body.list_id, "company_id": user["company_id"]},
            {"$push": {"contacts": {"$each": filtered}}}
        )
        appended = len(filtered)

    return {"total_remote": len(raw), "imported": len(filtered), "new_clients": upserted, "list_appended": appended}


# === SEND MESSAGE VIA WHATSAPP ===
class SendMessageRequest(BaseModel):
    phone: str
    message: str

@router.post("/connections/{conn_id}/send")
async def send_whatsapp_message(
    conn_id: str,
    data: SendMessageRequest,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    conn = await db.channel_connections.find_one({"id": conn_id, "company_id": user["company_id"]})
    if not conn:
        raise HTTPException(status_code=404, detail="Conexao nao encontrada")
    if conn.get("status") != "connected":
        raise HTTPException(status_code=400, detail="Conexao nao ativa")

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(f"{WA_SERVICE_URL}/instances/{conn_id}/send", json={"phone": data.phone, "message": data.message})
            result = resp.json()
        if not result.get("success"):
            raise HTTPException(status_code=500, detail=result.get("error", "Erro ao enviar"))
        # Log message
        await db.message_log.insert_one({
            "id": str(uuid.uuid4()), "company_id": user["company_id"], "connection_id": conn_id,
            "direction": "outgoing", "phone": data.phone, "message": data.message,
            "created_at": datetime.now(timezone.utc).isoformat()
        })
        return {"success": True}
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=str(e))


# === WEBHOOKS FROM WHATSAPP SERVICE ===
@router.post("/webhook/presence")
async def webhook_presence(request: Request, db: AsyncIOMotorDatabase = Depends(get_database)):
    """Body: {instance_id, phone, presence: 'composing'|'paused'|'available'|'unavailable'|'recording'}"""
    data = await request.json()
    instance_id = data.get("instance_id")
    phone = (data.get("phone") or "").strip()
    presence = data.get("presence") or "available"
    conn = await db.channel_connections.find_one({"id": instance_id})
    if not conn or not phone:
        return {"ok": False}
    await db.contact_presence.update_one(
        {"company_id": conn["company_id"], "phone": phone},
        {"$set": {"presence": presence, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )
    return {"ok": True}


@router.post("/webhook/message-status")
async def webhook_message_status(request: Request, db: AsyncIOMotorDatabase = Depends(get_database)):
    """Body: {instance_id, message_id, status: 'sent'|'delivered'|'read'|'played'}
    Updates the matching outbound agent message in tickets."""
    data = await request.json()
    instance_id = data.get("instance_id")
    message_id = data.get("message_id")
    status_v = data.get("status")
    conn = await db.channel_connections.find_one({"id": instance_id})
    if not conn or not message_id or not status_v:
        return {"ok": False}
    await db.tickets.update_one(
        {"company_id": conn["company_id"], "messages.wa_message_id": message_id},
        {"$set": {"messages.$.delivery_status": status_v,
                  "messages.$.delivery_updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    return {"ok": True}


@router.post("/webhook/history-import")
async def webhook_history_import(request: Request, db: AsyncIOMotorDatabase = Depends(get_database)):
    """Body: {instance_id, messages: [{id, jid, from_me, timestamp, type, text, push_name}]}

    2026-02-28 — Importa mensagens historicas (ate 30 dias) que o Baileys
    recebe na primeira sincronizacao com WhatsApp Mobile (quando o
    operador marca "Importar ultimos 30 dias" na criacao da conexao).
    Para cada JID:
      1. Localiza ou cria um ticket "fechado" (status=resolvido) na fase
         "historical" para nao poluir as filas de atendimento ativas.
      2. Faz upsert das mensagens deduplicadas por wa_message_id.
    Diferente do webhook normal, este endpoint NAO dispara flowbuilder,
    nem notifica usuarios, nem manipula presenca/typing — e somente
    repopulacao de historico.
    """
    data = await request.json()
    instance_id = data.get("instance_id")
    msgs = data.get("messages") or []
    if not instance_id or not isinstance(msgs, list) or not msgs:
        return {"ok": False, "error": "bad_payload"}

    conn = await db.channel_connections.find_one({"id": instance_id})
    if not conn:
        return {"ok": False, "error": "instance_not_found"}
    company_id = conn["company_id"]

    # Agrupa as mensagens por JID/telefone — uma ticket por contato.
    from collections import defaultdict
    by_jid: Dict[str, list] = defaultdict(list)
    for m in msgs:
        jid = (m.get("jid") or "").strip()
        if not jid or jid == "status@broadcast" or jid.endswith("@newsletter"):
            continue
        by_jid[jid].append(m)

    tickets_created = 0
    messages_inserted = 0
    for jid, jid_msgs in by_jid.items():
        # Telefone: parte antes do @
        phone_part = jid.split("@", 1)[0] if "@" in jid else jid
        phone = phone_part.split(":", 1)[0]  # remove device id ":3" etc.
        is_group = jid.endswith("@g.us")
        if is_group:
            continue  # grupos sao opt-in separadamente — ignoramos no historico

        # Sort cronologico para imports estaveis (oldest first)
        jid_msgs.sort(key=lambda x: x.get("timestamp") or 0)
        push_name = next((mm.get("push_name") for mm in jid_msgs if mm.get("push_name")), None)
        customer_name = push_name or phone

        # Localiza ticket aberto deste contato nesta conexao; se nao houver,
        # cria um ticket "historical" fechado para servir de balde do
        # historico (operador pode reabri-lo se quiser continuar a conversa).
        ticket = await db.tickets.find_one({
            "company_id": company_id,
            "connection_id": instance_id,
            "customer_phone": phone,
        }, {"_id": 0})
        if not ticket:
            tid = str(uuid.uuid4())
            ticket = {
                "id": tid,
                "company_id": company_id,
                "connection_id": instance_id,
                "customer_name": customer_name,
                "customer_phone": phone,
                "status": "fechado",
                "channel": "whatsapp",
                "messages": [],
                "tags": ["historico-importado"],
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "origin": "history_import",
            }
            await db.tickets.insert_one(ticket)
            tickets_created += 1

        # Lista de wa_message_id ja existentes neste ticket (para dedup)
        existing_ids = {
            mm.get("wa_message_id")
            for mm in (ticket.get("messages") or [])
            if mm.get("wa_message_id")
        }
        new_msgs = []
        for m in jid_msgs:
            mid = m.get("id")
            if not mid or mid in existing_ids:
                continue
            ts = m.get("timestamp")
            try:
                iso_ts = datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()
            except Exception:
                iso_ts = datetime.now(timezone.utc).isoformat()
            new_msgs.append({
                "wa_message_id": mid,
                "from": "agent" if m.get("from_me") else "customer",
                "text": m.get("text") or "",
                "type": m.get("type") or "text",
                "timestamp": iso_ts,
                "historical": True,  # marcador para a UI poder estilizar
            })
            existing_ids.add(mid)

        if new_msgs:
            await db.tickets.update_one(
                {"id": ticket["id"]},
                {"$push": {"messages": {"$each": new_msgs}},
                 "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
            )
            messages_inserted += len(new_msgs)

    logger.info(
        f"[history-import] instance={instance_id} contacts={len(by_jid)} "
        f"tickets_created={tickets_created} messages_inserted={messages_inserted}"
    )
    return {
        "ok": True,
        "contacts": len(by_jid),
        "tickets_created": tickets_created,
        "messages_inserted": messages_inserted,
    }




@router.get("/contact-presence")
async def list_contact_presence(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    """Recent presence updates (last 60s) for the current company. UI polls this to show typing."""
    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=60)).isoformat()
    docs = await db.contact_presence.find(
        {"company_id": user["company_id"], "updated_at": {"$gt": cutoff}},
        {"_id": 0}
    ).to_list(500)
    return docs


@router.post("/webhook/auto-recovery")
async def webhook_auto_recovery(request: Request, db: AsyncIOMotorDatabase = Depends(get_database)):
    """2026-02-18 (v2.1.17) — Receives auto-recovery notifications from the
    Baileys microservice. Whenever a bot-sent message stays stuck without
    DELIVERY_ACK (recipient "Aguardando mensagem"), the microservice wipes
    the Signal session, re-sends the same text, and POSTs us here so the
    SA log + flow_send_log reflect the recovery.

    Body: {instance_id, jid, original_msg_id, new_msg_id, retry}
    """
    data = await request.json()
    instance_id = data.get("instance_id")
    original = data.get("original_msg_id")
    new_id = data.get("new_msg_id")
    retry = int(data.get("retry") or 1)
    jid = data.get("jid") or ""
    conn = await db.channel_connections.find_one({"id": instance_id})
    if not conn:
        return {"ok": False, "error": "instance_not_found"}
    company_id = conn["company_id"]
    now_iso = datetime.now(timezone.utc).isoformat()
    # Update the matching outbound message to track the new msg id so any
    # future DELIVERY_ACK arriving for `new_id` actually finds it. Also
    # mark a delivery_status flag so the chat UI can render it visually.
    if original and new_id:
        await db.tickets.update_one(
            {"company_id": company_id, "messages.wa_message_id": original},
            {"$set": {
                "messages.$.wa_message_id": new_id,
                "messages.$.auto_recovery_retry": retry,
                "messages.$.auto_recovery_at": now_iso,
                "messages.$.delivery_status": "resent",
            }},
        )
    # Persist a flow_send_log entry so the operator-facing "Log de envios"
    # surfaces these events.
    try:
        await db.flow_send_log.insert_one({
            "id": str(uuid.uuid4()),
            "company_id": company_id,
            "ticket_id": None,
            "flow_id": None,
            "customer_phone": (jid or "").split("@")[0] if "@" in (jid or "") else jid,
            "round_send_index": 0,
            "text_preview": f"AUTO-RECOVERY retry #{retry} (jid={jid})",
            "wa_msg_id": new_id,
            "send_ok": True,
            "elapsed_ms": 0,
            "phase": "auto_recovery",
            "error": f"recovered_from={original}",
            "created_at": now_iso,
        })
    except Exception:
        pass
    return {"ok": True}


@router.post("/webhook/connected")
async def webhook_connected(request: Request, db: AsyncIOMotorDatabase = Depends(get_database)):
    data = await request.json()
    instance_id = data.get("instance_id")
    phone = data.get("phone", "")
    name = data.get("name", "")
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.channel_connections.update_one(
        {"id": instance_id},
        {"$set": {
            "status": "connected",
            "phone": phone,
            "connected_name": name,
            "last_connected": now_iso,
            "connected_at": now_iso,  # timestamp used to filter older WA messages
        }}
    )
    return {"ok": True}


@router.post("/webhook/message")
async def webhook_message(request: Request, db: AsyncIOMotorDatabase = Depends(get_database)):
    data = await request.json()
    instance_id = data.get("instance_id")
    conn = await db.channel_connections.find_one({"id": instance_id})
    if not conn:
        logger.warning(f"[webhook/message] instance not found: {instance_id}")
        return {"ok": False, "error": "instance_not_found"}

    company_id = conn["company_id"]
    phone = (data.get("phone") or "").strip()
    name = data.get("name") or phone or "Cliente"
    text = data.get("message") or ""
    msg_id = data.get("message_id")
    ts_raw = data.get("timestamp")
    # When the original WhatsApp JID was @lid, the microservice sends the
    # raw `XXX@lid` here so the backend can:
    #   (a) save it on the ticket → the operator's outbound messages will
    #       be sent via the LID JID directly (the only thing WA accepts for
    #       hidden-privacy first contacts), and
    #   (b) auto-merge later when /webhook/lid-resolved arrives with the
    #       real phone for the same LID.
    lid_jid = (data.get("lid_jid") or "").strip() or None
    from_me = bool(data.get("from_me"))  # True when operator sent from phone
    is_group = bool(data.get("is_group"))
    group_jid = (data.get("group_jid") or "").strip() or None
    group_subject = (data.get("group_subject") or "").strip() or None
    # Optional inbound media (audio/image/video/document). The microservice
    # downloads the encrypted payload via Baileys, decrypts it and forwards
    # the decoded bytes as base64. We persist it to object storage here so
    # the operator can play/view/download it from the chat UI.
    media_kind = (data.get("media_kind") or "").strip() or None
    media_mimetype = data.get("media_mimetype")
    media_filename = data.get("media_filename")
    media_b64 = data.get("media_base64")
    logger.info(f"[webhook/message] {company_id[:8]} phone={phone} mid={msg_id} text='{text[:40]}'")

    # Filter out messages older than the moment this channel was connected.
    # The WA microservice forwards messageTimestamp in seconds.
    try:
        msg_ts = int(ts_raw) if ts_raw is not None else None
    except (TypeError, ValueError):
        msg_ts = None
    connected_at_iso = conn.get("connected_at")
    if msg_ts and connected_at_iso:
        try:
            connected_at_dt = datetime.fromisoformat(connected_at_iso.replace("Z", "+00:00"))
            connected_at_ts = int(connected_at_dt.timestamp())
            # Drop only messages that are clearly historical (older than 1h
            # before the connection moment). 1h grace absorbs any clock skew
            # between the Node.js microservice host and the backend.
            if msg_ts < connected_at_ts - 3600:
                logger.info(
                    f"[webhook] ignoring old WA msg (msg_ts={msg_ts} < conn_ts={connected_at_ts}) "
                    f"phone={phone} mid={msg_id}"
                )
                return {"ok": True, "ignored": "older_than_connected_at"}
        except Exception:
            pass

    # Log incoming message (raw)
    await db.message_log.insert_one({
        "id": str(uuid.uuid4()), "company_id": company_id, "connection_id": instance_id,
        "direction": "outgoing" if from_me else "incoming",
        "phone": phone, "sender_name": data.get("name"),
        "message": text, "message_id": msg_id,
        "from_me": from_me,
        "created_at": datetime.now(timezone.utc).isoformat()
    })

    # 2026-02-28 — Bulk opt-out detection: scope LIGHTWEIGHT pra nao
    # impactar latencia do inbound. Roda com timeout curto e isolado;
    # se demorar/quebrar, NUNCA bloqueia o inbound principal.
    if not from_me and text:
        try:
            from routes.bulk_routes import check_and_record_opt_out
            import asyncio as _asyncio
            await _asyncio.wait_for(
                check_and_record_opt_out(db, company_id, phone, text),
                timeout=2.0,
            )
        except Exception as e:
            logger.warning(f"[webhook] opt-out check skipped: {e}")

    # Find or create open ticket for this phone (so it appears in Atendimentos UI)
    if not phone:
        return {"ok": True}

    # @lid / LID fallback guard:
    # Baileys may deliver messages from WhatsApp Linked Devices using an
    # opaque Linked-Identifier (e.g. 250615737372785) instead of the real
    # phone number. The microservice tries to resolve via senderPn /
    # participantPn / remoteJidAlt / lidMapping, but it can fail, in which
    # case the webhook arrives with a fake phone. Without intervention, the
    # same human creates many duplicate tickets. We guard server-side:
    # if the phone looks like a LID (non-Brazilian format, unusually long
    # prefix) AND we already have an OPEN ticket for the same pushName +
    # connection in the last 72h, we append the message there instead of
    # creating a duplicate. The "right" phone is NOT overwritten, so when
    # the user eventually replies from their real device and Baileys
    # resolves it, the message flows to the correct ticket.
    def _looks_like_lid(p: str) -> bool:
        if not p:
            return False
        digits = re.sub(r"\D", "", p)
        if len(digits) < 12:
            return False  # too short to be LID
        # Real Brazilian: starts with 55 + (10|11) digits = 12 or 13 total.
        if digits.startswith("55") and len(digits) in (12, 13):
            return False
        # International numbers also typically fit 10-14 digits; LIDs are
        # typically 14-17 and do not match common country code prefixes of
        # our user base. This heuristic errs on the side of safety (it only
        # triggers the merge when BOTH (a) the phone is suspicious AND
        # (b) we already have a ticket with the same push_name for the
        # same connection).
        if len(digits) >= 14:
            return True
        return False

    fallback_ticket = None
    if _looks_like_lid(phone) and not from_me:
        # @lid fallback is only meaningful for incoming messages: when a
        # client replies via a privacy-mode JID, we try to find the right
        # ticket via recent outgoing or push_name. For outgoing messages
        # from the operator's phone, `phone` is the destination — already
        # canonical — so we just look up the ticket by phone directly.
        from datetime import timedelta
        # Strategy 1: most recent outgoing within 5 minutes ANYWHERE in the
        # tenant — extremely reliable. If the operator just sent something
        # and now an LID-tagged reply arrives within minutes, it's the same
        # conversation. We DROP the connection_id filter so this works even
        # for tickets created manually (which start without connection_id)
        # and only later receive their first outgoing message.
        win_5m = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
        fallback_ticket = await db.tickets.find_one({
            "company_id": company_id,
            "status": {"$nin": ["fechado"]},
            "last_outgoing_at": {"$gte": win_5m},
            "customer_phone": {"$ne": phone},
        }, sort=[("last_outgoing_at", -1)])
        if fallback_ticket:
            logger.warning(
                f"[webhook][lid-fallback:outgoing] LID phone={phone} name={name!r} "
                f"merged into ticket #{fallback_ticket.get('ticket_number')} "
                f"(matched by recent outgoing in tenant, "
                f"real_phone={fallback_ticket.get('customer_phone')})"
            )

        # Strategy 2: same push_name + connection in last 72h (fallback for
        # cases without recent outgoing — e.g. customer wrote first).
        if not fallback_ticket and name:
            cutoff = (datetime.now(timezone.utc) - timedelta(hours=72)).isoformat()
            fallback_ticket = await db.tickets.find_one({
                "company_id": company_id,
                "connection_id": instance_id,
                "customer_name": name,
                "status": {"$nin": ["fechado"]},
                "updated_at": {"$gte": cutoff},
                "customer_phone": {"$ne": phone},
            }, sort=[("updated_at", -1)])
            if fallback_ticket:
                logger.warning(
                    f"[webhook][lid-fallback:name] LID phone={phone} name={name!r} "
                    f"merged into ticket #{fallback_ticket.get('ticket_number')} "
                    f"(matched by push_name, real_phone={fallback_ticket.get('customer_phone')})"
                )

    if is_group:
        # Group messages live in their own ticket scoped to the group_jid
        # so the operator sees one conversation per WhatsApp group, not per
        # member. Channel="whatsapp_group" lets the UI render a separate tab.
        ticket = await db.tickets.find_one({
            "company_id": company_id,
            "group_jid": group_jid,
            "status": {"$nin": ["fechado"]},
        })
        # ── Group owner-connection lock ─────────────────────────────────────
        # When the same company has 2+ connections that are participants of
        # the SAME WhatsApp group, every connection receives an INDEPENDENT
        # webhook for the same message. Without this guard we'd:
        #   (a) append the same message N times to the ticket
        #   (b) trigger the default_flow N times → the user's phone would
        #       receive duplicated bot replies, exactly as reported.
        # The ticket is locked to the FIRST connection that ever saw the
        # group; webhooks from any other connection are silently dropped.
        # Note: `wa_message_id` dedup further below would also catch this,
        # but it runs AFTER we already loaded ticket state — bailing here
        # is cheaper and prevents N flow advance attempts.
        if ticket and ticket.get("connection_id") and ticket["connection_id"] != instance_id:
            logger.info(
                f"[webhook/message][group] dropping webhook from non-owner "
                f"connection={instance_id[:8]} for group_jid={group_jid} "
                f"(owner={ticket['connection_id'][:8]}, msg_id={msg_id})"
            )
            return {"ok": True, "ignored": "group_owned_by_other_connection"}
    else:
        ticket = fallback_ticket or await db.tickets.find_one({
            "company_id": company_id,
            "customer_phone": phone,
            "channel": {"$ne": "whatsapp_group"},
            "status": {"$nin": ["fechado"]}
        })

    new_message = {
        "id": str(uuid.uuid4()),
        "content": text,
        # Messages with from_me=true were sent by the operator from their
        # linked phone / WhatsApp Web — render them on the agent side and
        # tag delivery as already sent (WA confirmed otherwise it would
        # not have left the device).
        "sender_type": "agent" if from_me else "user",
        "sender_id": None,
        "sender_name": (conn.get("connected_name") or "Agente") if from_me else name,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "wa_message_id": msg_id,
    }
    if from_me:
        new_message["delivery_status"] = "sent"
        new_message["source"] = "phone"  # so the UI could badge it as 'sent from phone'

    # Persist inbound media to object storage so the chat can render an
    # inline <audio>/<img>/<video>/<a> element for the operator. The file
    # entry is created under a per-company prefix and referenced in
    # `new_message.media_*` fields. Failures are logged but do NOT break the
    # webhook — we still record the message with its text placeholder.
    if media_kind and media_b64:
        saved = await _persist_inbound_media(
            db, company_id, media_b64,
            mimetype=media_mimetype, kind=media_kind, filename=media_filename,
        )
        if saved:
            new_message["media_kind"] = media_kind
            new_message["media_url"] = saved["url"]
            new_message["media_mimetype"] = saved["mimetype"]
            new_message["media_filename"] = saved["filename"]
            new_message["media_size"] = saved["size"]

    if not ticket:
        if from_me:
            # Operator sent a message from the phone to a brand-new number
            # with NO existing ticket. We could auto-create one, but the
            # safer default is to skip it: the operator is initiating
            # contact outside the CRM, and creating a ticket would orphan
            # it from the funnel/flow. We still keep the message_log row
            # above so audits remain complete.
            logger.info(
                f"[webhook/message][from_me] no open ticket for phone={phone}; "
                f"skipping ticket creation (operator initiated from phone)"
            )
            return {"ok": True, "skipped": "from_me_no_existing_ticket"}
        ticket_id = str(uuid.uuid4())
        ticket_number = await next_ticket_number(db, company_id)
        client_id = await find_or_create_client_by_phone(db, company_id, phone, name=name)
        is_lid = _looks_like_lid(phone)
        ticket = {
            "id": ticket_id,
            "ticket_number": ticket_number,
            "company_id": company_id,
            "connection_id": instance_id,
            "client_id": client_id,
            "customer_name": (group_subject if is_group else name) or name,
            "customer_phone": phone,
            "customer_email": None,
            "status": "aberto",
            "priority": "medium",
            "channel": "whatsapp_group" if is_group else "whatsapp",
            "is_group": is_group,
            "group_jid": group_jid,
            "group_subject": group_subject,
            "description": text[:140] if text else None,
            "assigned_to": None,
            # Auto-bind queue_id from connection. If the connection is wired
            # to exactly ONE queue, the ticket is pinned to that queue; if it
            # is wired to multiple queues, we leave queue_id null so a flow
            # node can ask the customer / operator to pick the right one
            # later. Without this, "Aguardando" filters by queue would miss
            # inbound tickets.
            "queue_id": (conn.get("queue_ids") or [None])[0] if len(conn.get("queue_ids") or []) == 1 else None,
            "messages": [new_message],
            # Auto-tag hidden-number contacts so the operator immediately sees
            # the situation in the conversation list. The tag is plain string
            # (matching the existing tag system; resolver clears it).
            "tags": ["Numero Oculto"] if is_lid else [],
            "value": 0.0,
            "pending_lid_resolution": is_lid,
            # Original `XXX@lid` JID — used by the outbound send path so the
            # operator can reply via the LID JID directly while we wait for
            # WhatsApp to expose the real phone (only happens after the
            # contact has interacted with us at least once).
            "lid_jid": lid_jid if is_lid else None,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.tickets.insert_one(ticket)
        # ── Race-safe group ownership election ─────────────────────────
        # Two webhooks (one per connection that is a member of the same
        # group) may have BOTH passed the "ticket not found" check above
        # before either of them inserted. To avoid creating duplicate
        # group tickets AND triggering the flow multiple times, the
        # newcomer always re-queries by `group_jid` and keeps only the
        # OLDEST ticket. The loser deletes its own row and bails before
        # the default_flow trigger fires.
        if is_group and group_jid:
            try:
                oldest = await db.tickets.find_one(
                    {
                        "company_id": company_id,
                        "group_jid": group_jid,
                        "channel": "whatsapp_group",
                        "status": {"$nin": ["fechado"]},
                    },
                    sort=[("created_at", 1), ("id", 1)],
                )
                if oldest and oldest.get("id") != ticket["id"]:
                    logger.info(
                        f"[webhook/message][group] connection={instance_id[:8]} lost owner "
                        f"race for group_jid={group_jid}; discarding duplicate ticket "
                        f"{ticket['id']} (owner ticket={oldest['id']})"
                    )
                    await db.tickets.delete_one({"id": ticket["id"]})
                    return {"ok": True, "ignored": "group_duplicate_lost_race"}
            except Exception as e:
                logger.warning(f"[webhook/message][group] race-resolve check failed: {e}")
        # Auto-trigger Flowbuilder flow if connection has one configured.
        # Fire-and-forget — flow execution should never block the webhook.
        try:
            if conn.get("default_flow_id"):
                from routes.crm_routes import _trigger_flow_for_ticket
                await _trigger_flow_for_ticket(db, conn["company_id"], conn["default_flow_id"], ticket)
        except Exception as e:
            logger.error(f"[webhook/message] flow trigger CRASHED: {e}", exc_info=True)
            # 2026-02-17 — Also record this in flow_send_log so operator
            # sees the crash without reading server logs.
            try:
                await db.flow_send_log.insert_one({
                    "id": str(__import__('uuid').uuid4()),
                    "company_id": conn.get("company_id"),
                    "ticket_id": ticket.get("id"),
                    "flow_id": conn.get("default_flow_id"),
                    "customer_phone": ticket.get("customer_phone"),
                    "round_send_index": 0,
                    "text_preview": f"FLOW_TRIGGER_CRASH: {str(e)[:100]}",
                    "wa_msg_id": None,
                    "send_ok": False,
                    "elapsed_ms": 0,
                    "phase": "crash",
                    "error": str(e)[:500],
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })
            except Exception:
                pass
    else:
        # Idempotency: skip if same wa message id already pushed.
        # This is CRITICAL for outgoing-from-phone messages: when the
        # operator sends from the system's web UI, crm_routes also stamps
        # `wa_message_id` returned by Baileys. Without dedup, the same
        # message would appear twice (once from crm_routes, once from the
        # messages.upsert echo with fromMe=true).
        existing_ids = [m.get("wa_message_id") for m in (ticket.get("messages") or [])]
        if msg_id and msg_id in existing_ids:
            return {"ok": True, "duplicate": True}
        # 2026-02-18 — Self-echo dedup fallback. When Baileys does NOT
        # return a `wa_message_id` on the bot's send (observed in prod
        # under certain accounts), `_persist_outgoing` stores
        # `wa_message_id=None`. The subsequent `messages.upsert` echo with
        # `fromMe=true` then has a real `msg_id` that does NOT match any
        # stored None → the strict id dedup above misses it, and we end
        # up: (a) duplicating the message in the CRM, and (b) flipping
        # `bot_paused=true` (because from_me echo looks like the operator
        # typed from the phone). Below we look at the LAST FEW agent
        # messages and bail if any one matches on content within a short
        # window. Window kept tight (45s) so a real operator typing the
        # same text shortly after is not swallowed.
        if from_me and text:
            from datetime import timedelta as _td
            now_utc = datetime.now(timezone.utc)
            text_norm = (text or "").strip()
            try:
                for _m in reversed((ticket.get("messages") or [])[-8:]):
                    if (_m.get("sender_type") != "agent"
                            or (_m.get("content") or "").strip() != text_norm):
                        continue
                    _ts = _m.get("created_at")
                    if not _ts:
                        continue
                    try:
                        _dt = datetime.fromisoformat(_ts.replace("Z", "+00:00"))
                    except Exception:
                        continue
                    if (now_utc - _dt) < _td(seconds=45):
                        logger.info(
                            f"[webhook/message] dropping self-echo (from_me=true) "
                            f"matching recent bot/agent message on ticket={ticket['id']} "
                            f"text={text_norm[:60]!r}"
                        )
                        # If the echo carries a real wa_message_id, backfill
                        # it on the existing record so future echoes match
                        # via the strict id path above.
                        if msg_id and not _m.get("wa_message_id"):
                            try:
                                await db.tickets.update_one(
                                    {"id": ticket["id"], "messages.id": _m.get("id")},
                                    {"$set": {"messages.$.wa_message_id": msg_id}},
                                )
                            except Exception:
                                pass
                        return {"ok": True, "duplicate": True, "self_echo": True}
            except Exception as _e:
                logger.warning(f"[webhook/message] self-echo dedup failed: {_e}")
        update_set = {"updated_at": datetime.now(timezone.utc).isoformat()}
        if from_me:
            # Track last outgoing so the @lid fallback works for the very
            # next inbound reply (same as crm_routes does for web-sent
            # outbound). Mirrors the canonical "operator just talked to
            # this contact" signal regardless of where the message was
            # typed from.
            update_set["last_outgoing_at"] = update_set["updated_at"]
        await db.tickets.update_one(
            {"id": ticket["id"]},
            {"$push": {"messages": new_message}, "$set": update_set}
        )
        # Operator-typed messages (from_me=True) on the linked phone also
        # count as "human intervention" and should pause the bot when the
        # company opted in.
        if from_me:
            try:
                from bot_pause import pause_bot_on_ticket_if_enabled
                await pause_bot_on_ticket_if_enabled(
                    db, ticket, reason="agent_message_phone"
                )
            except Exception as e:
                logger.warning(f"[bot_pause] phone-send failed: {e}")
        # Reload ticket to pick up flow state and advance the runtime if it's
        # waiting on this customer reply. Outgoing-from-phone messages do
        # NOT advance flows — they're our own output and would create
        # infinite loops if a flow waited for "user input".
        if not from_me:
            try:
                from flow_engine import advance_flow, is_flow_active
                updated = await db.tickets.find_one({"id": ticket["id"]}, {"_id": 0})
                if updated and await is_flow_active(updated):
                    flow_doc = await db.flow_builders.find_one(
                        {"id": updated["active_flow_id"], "company_id": updated["company_id"]},
                        {"_id": 0},
                    )
                    if flow_doc:
                        await advance_flow(db, updated, flow_doc, incoming_text=text, is_initial=False)
                    else:
                        # 2026-02-15 (I) — observability: explicit log when the
                        # ticket points to a flow that no longer exists. The
                        # flow may have been deleted/renamed by an operator,
                        # leaving the ticket stuck waiting for a node that
                        # can't be resolved. Clear the flow_id so next inbound
                        # falls through to other handlers.
                        logger.warning(
                            f"[webhook/message] ticket={ticket['id']} references missing "
                            f"flow={updated.get('active_flow_id')!r} — clearing flow state"
                        )
                        await db.tickets.update_one(
                            {"id": ticket["id"]},
                            {"$set": {"active_flow_id": None, "active_flow_node_id": None}},
                        )
                elif updated and updated.get("active_flow_id") and not updated.get("active_flow_node_id"):
                    # 2026-02-15 (I) — stuck state diagnostic: flow id set but
                    # no pending node. This usually means a previous
                    # advance_flow crashed mid-execution or an HTTP node hit
                    # an error and cleared the node. Log loudly so the
                    # operator can correlate with WA "stops responding" reports.
                    logger.error(
                        f"[webhook/message] ticket={ticket['id']} stuck flow state: "
                        f"active_flow_id={updated.get('active_flow_id')!r} but "
                        f"active_flow_node_id is None. Customer reply ignored."
                    )
            except Exception as e:
                # ERROR (not warning) + traceback so this surfaces in
                # production dashboards. Previously a silent warning made the
                # "flow stopped" bug invisible until a manual reconnect.
                logger.exception(
                    f"[webhook/message] flow advance crashed ticket={ticket.get('id')}: {e}"
                )

    return {"ok": True}


# === LID resolution webhook & manual API ===
#
# Hidden-number contacts (WhatsApp's privacy mode for new contacts) deliver
# their first messages with a `XXX@lid` JID that does NOT match the real
# phone. We provisionally create a ticket using the LID as `customer_phone`
# and tag it "Numero Oculto". When the contact interacts again (or the
# operator sends a message that gets a response with `senderPn` populated),
# the microservice fires `/webhook/lid-resolved` so we can:
#   1. Update the pending ticket with the real phone (and clean up tag/flag)
#   2. If another ticket already existed for the real phone, merge messages
#      into the older ticket and DELETE the LID-only one. The merge is
#      idempotent (deduplicated by wa_message_id).
#
# The manual `POST /tickets/{id}/resolve-lid` endpoint is the UX fallback:
# operator sees the "Numero Oculto" banner in the chat header, types the
# real phone he/she got via voice/email/business card, hits Resolve. Same
# server-side logic runs.

class LidResolvedWebhook(BaseModel):
    instance_id: str
    lid_jid: str
    phone: str
    source: Optional[str] = None


async def _apply_lid_resolution(db, company_id: str, lid_jid: str, real_phone: str) -> dict:
    """Promote the pending LID ticket to use `real_phone`. Merges into an
    existing ticket for the real phone if one is already open."""
    if not lid_jid or not real_phone:
        return {"updated": False, "reason": "missing_input"}
    real_phone = re.sub(r"\D", "", real_phone)
    if len(real_phone) < 8:
        return {"updated": False, "reason": "invalid_phone"}

    pending = await db.tickets.find_one(
        {"company_id": company_id, "lid_jid": lid_jid, "status": {"$nin": ["fechado"]}},
        sort=[("created_at", -1)],
    )
    if not pending:
        return {"updated": False, "reason": "no_pending_ticket"}

    # Is there already an open ticket for this real phone? If so, merge.
    existing = await db.tickets.find_one(
        {"company_id": company_id, "customer_phone": real_phone, "status": {"$nin": ["fechado"]},
         "id": {"$ne": pending["id"]}},
        sort=[("created_at", 1)],
    )
    if existing:
        # Merge messages dedup'd by wa_message_id, union tags (minus the
        # Numero Oculto tag), and DELETE the LID ticket.
        existing_msgs = existing.get("messages") or []
        existing_msg_ids = {m.get("wa_message_id") for m in existing_msgs if m.get("wa_message_id")}
        new_msgs = [m for m in (pending.get("messages") or []) if m.get("wa_message_id") not in existing_msg_ids]
        merged_tags = list({*(existing.get("tags") or []), *[t for t in (pending.get("tags") or []) if t != "Numero Oculto"]})
        await db.tickets.update_one(
            {"id": existing["id"]},
            {"$push": {"messages": {"$each": new_msgs}},
             "$set": {"tags": merged_tags, "updated_at": datetime.now(timezone.utc).isoformat()}},
        )
        # Re-point quotes to the surviving ticket
        await db.quotes.update_many(
            {"company_id": company_id, "ticket_id": pending["id"]},
            {"$set": {"ticket_id": existing["id"]}},
        )
        await db.tickets.delete_one({"id": pending["id"]})
        logger.info(
            f"[lid-resolved][merge] LID {lid_jid} -> phone {real_phone}; "
            f"merged ticket #{pending.get('ticket_number')} into #{existing.get('ticket_number')}"
        )
        return {"updated": True, "merged_into": existing["id"], "deleted": pending["id"]}

    # No existing ticket → just promote the pending one.
    new_tags = [t for t in (pending.get("tags") or []) if t != "Numero Oculto"]
    new_client_id = await find_or_create_client_by_phone(
        db, company_id, real_phone, name=pending.get("customer_name") or real_phone
    )
    await db.tickets.update_one(
        {"id": pending["id"]},
        {"$set": {
            "customer_phone": real_phone,
            "client_id": new_client_id,
            "tags": new_tags,
            "pending_lid_resolution": False,
            "lid_jid": None,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    logger.info(f"[lid-resolved][promote] ticket #{pending.get('ticket_number')} LID {lid_jid} -> {real_phone}")
    return {"updated": True, "promoted": pending["id"]}


@router.post("/webhook/lid-resolved")
async def webhook_lid_resolved(body: LidResolvedWebhook, db: AsyncIOMotorDatabase = Depends(get_database)):
    """Called by the microservice when it discovers the real phone behind a
    previously unresolved `@lid` (via `key.senderPn`, store contacts, etc).
    Promotes / merges the pending ticket so the conversation continues on
    the real number."""
    conn = await db.channel_connections.find_one({"id": body.instance_id})
    if not conn:
        return {"ok": False, "error": "instance_not_found"}
    result = await _apply_lid_resolution(db, conn["company_id"], body.lid_jid, body.phone)
    return {"ok": True, **result}


@router.post("/instances/{instance_id}/probe-lid")
async def probe_lid_now(
    instance_id: str,
    body: dict,
    user: dict = Depends(get_current_user),
):
    """Triggers the microservice to actively probe a specific @lid JID using
    `onWhatsApp` + `signalRepository.lidMapping` + cached store. If WhatsApp
    is willing to expose the real phone NOW, the microservice fires the
    /webhook/lid-resolved (auto-merge). UI uses this for the
    "Tentar resolver agora" button on the LID-pending banner."""
    lid_jid = (body or {}).get("lid_jid") or ""
    if not lid_jid:
        raise HTTPException(400, "lid_jid obrigatorio")
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.post(f"{WA_SERVICE_URL}/instances/{instance_id}/resolve-lid", json={"lid_jid": lid_jid})
            try:
                return r.json()
            except Exception:
                return {"resolved": False, "error": f"Microservico retornou resposta invalida (HTTP {r.status_code})"}
    except httpx.HTTPError as e:
        # Microservice truly unreachable (connection refused, timeout, etc).
        # Return 200 + resolved:false so the UI shows a friendly toast
        # instead of a generic 502 error.
        logger.warning(f"probe-lid microservice unreachable: {e}")
        return {"resolved": False, "error": "Microservico WhatsApp nao respondeu. Tente em alguns segundos."}


@router.put("/connections/{conn_id}")
async def update_connection(
    conn_id: str,
    data: ConnectionUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    update = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    # Allow empty string to clear default_flow_id (operator unchecks the flow).
    if "default_flow_id" in update and update["default_flow_id"] == "":
        update["default_flow_id"] = None
    # queue_ids: empty list is valid (clears all queue links)
    if "queue_ids" in data.model_dump(exclude_unset=True):
        update["queue_ids"] = data.queue_ids or []
    if not update:
        raise HTTPException(status_code=400, detail="Nada para atualizar")
    result = await db.channel_connections.update_one(
        {"id": conn_id, "company_id": user["company_id"]}, {"$set": update}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Conexao nao encontrada")
    return await db.channel_connections.find_one({"id": conn_id}, {"_id": 0})


@router.delete("/connections/{conn_id}")
async def delete_connection(
    conn_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    result = await db.channel_connections.delete_one({"id": conn_id, "company_id": user["company_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Conexao nao encontrada")
    return {"message": "Conexao deletada"}


# === MESSAGE TEMPLATES ===
@router.get("/templates")
async def list_templates(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    templates = await db.message_templates.find(
        {"company_id": user["company_id"]}, {"_id": 0}
    ).to_list(100)
    return templates


@router.post("/templates")
async def create_template(
    data: TemplateCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    existing = await db.message_templates.find_one({
        "company_id": user["company_id"], "process_key": data.process_key
    })
    if existing:
        await db.message_templates.update_one(
            {"id": existing["id"]},
            {"$set": {"message": data.message, "active": data.active, "updated_at": datetime.now(timezone.utc).isoformat()}}
        )
        return await db.message_templates.find_one({"id": existing["id"]}, {"_id": 0})

    template = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "process_key": data.process_key,
        "label": data.label,
        "description": data.description,
        "message": data.message,
        "active": data.active,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.message_templates.insert_one(template)
    return {k: v for k, v in template.items() if k != "_id"}


@router.put("/templates/{template_id}")
async def update_template(
    template_id: str,
    data: TemplateUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    update_data = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.message_templates.update_one(
        {"id": template_id, "company_id": user["company_id"]}, {"$set": update_data}
    )
    return await db.message_templates.find_one({"id": template_id}, {"_id": 0})


# === SCHEDULED MESSAGES ===
@router.get("/scheduled-messages")
async def list_scheduled_messages(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
    status: str = None
):
    query = {"company_id": user["company_id"]}
    if status:
        query["status"] = status
    messages = await db.scheduled_messages.find(query, {"_id": 0}).sort("scheduled_at", 1).to_list(500)
    return messages


@router.post("/scheduled-messages")
async def create_scheduled_message(
    data: ScheduledMessageCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    msg = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "recipient": data.recipient,
        "channel": data.channel,
        "message": data.message,
        "template_key": data.template_key,
        "scheduled_at": data.scheduled_at,
        "status": "pendente",
        "created_by": user["id"],
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.scheduled_messages.insert_one(msg)
    return {k: v for k, v in msg.items() if k != "_id"}


@router.put("/scheduled-messages/{msg_id}")
async def update_scheduled_message(
    msg_id: str,
    data: ScheduledMessageUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    update_data = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    await db.scheduled_messages.update_one(
        {"id": msg_id, "company_id": user["company_id"]}, {"$set": update_data}
    )
    return await db.scheduled_messages.find_one({"id": msg_id}, {"_id": 0})


@router.delete("/scheduled-messages/{msg_id}")
async def delete_scheduled_message(
    msg_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    result = await db.scheduled_messages.delete_one({"id": msg_id, "company_id": user["company_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Mensagem nao encontrada")
    return {"message": "Mensagem deletada"}


# === REMARKETING / BULK MESSAGES ===
class RemarketingPreview(BaseModel):
    filter_type: str  # inactive_days | never_returned | birthday_month | service | all_active
    inactive_days: Optional[int] = 30
    service_id: Optional[str] = None
    month: Optional[int] = None  # 1..12 (defaults to current)


class BulkSendRequest(BaseModel):
    filter_type: str
    inactive_days: Optional[int] = 30
    service_id: Optional[str] = None
    month: Optional[int] = None
    message: str
    when: str = "now"  # now | scheduled
    scheduled_at: Optional[str] = None  # ISO datetime when when='scheduled'


async def _resolve_audience(db: AsyncIOMotorDatabase, company_id: str, body: dict) -> List[dict]:
    """Return a list of customer dicts matching the remarketing filter.
    Each item shape: {name, phone, last_appointment_date, last_service_name, days_since}
    """
    from datetime import date as _date
    from datetime import datetime as _dt
    today = _date.today()

    # Pull all clients of this company (filtered later)
    customers = await db.clients.find(
        {"company_id": company_id}, {"_id": 0}
    ).to_list(5000)
    if not customers:
        return []

    # Pull last appointment per customer (concluido takes priority, otherwise last by date)
    customer_ids = [c["id"] for c in customers if c.get("id")]
    last_apts: dict = {}
    if customer_ids:
        cursor = db.appointments.find(
            {"company_id": company_id, "customer_id": {"$in": customer_ids}, "status": "concluido"},
            {"_id": 0, "customer_id": 1, "date": 1, "service_id": 1, "service_name": 1}
        ).sort("date", -1)
        async for a in cursor:
            cid = a.get("customer_id")
            if cid and cid not in last_apts:
                last_apts[cid] = a

    filt = body.get("filter_type")
    inactive_days = int(body.get("inactive_days") or 30)
    service_id = body.get("service_id")
    month = body.get("month") or today.month

    audience: List[dict] = []
    for c in customers:
        cid = c.get("id")
        last = last_apts.get(cid)
        last_date_str = (last or {}).get("date", "")
        last_service = (last or {}).get("service_name", "")
        days_since = None
        if last_date_str:
            try:
                ly, lm, ld = last_date_str.split("-")
                days_since = (today - _date(int(ly), int(lm), int(ld))).days
            except Exception:
                days_since = None

        accept = False
        if filt == "all_active":
            accept = True
        elif filt == "inactive_days":
            accept = days_since is not None and days_since >= inactive_days
        elif filt == "never_returned":
            # Has exactly 1 concluded appointment AND that one is older than threshold
            if cid:
                count = await db.appointments.count_documents({
                    "company_id": company_id, "customer_id": cid, "status": "concluido"
                })
                accept = count == 1 and days_since is not None and days_since >= inactive_days
        elif filt == "birthday_month":
            bday = c.get("birth_date") or c.get("birthday") or ""
            try:
                # birth_date formats accepted: YYYY-MM-DD, DD/MM/YYYY, MM-DD
                bm = None
                if "-" in bday and len(bday) >= 7:
                    bm = int(bday.split("-")[1])
                elif "/" in bday and len(bday) >= 5:
                    bm = int(bday.split("/")[1])
                if bm == int(month):
                    accept = True
            except Exception:
                accept = False
        elif filt == "service":
            if service_id and last and last.get("service_id") == service_id:
                accept = True

        if not accept:
            continue
        if not c.get("phone"):
            continue

        audience.append({
            "id": cid,
            "name": c.get("name", ""),
            "phone": c.get("phone", ""),
            "birthday": c.get("birth_date") or c.get("birthday") or "",
            "last_appointment_date": last_date_str,
            "last_service_name": last_service,
            "days_since": days_since,
        })

    return audience


@router.post("/remarketing/preview")
async def remarketing_preview(
    data: RemarketingPreview,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    audience = await _resolve_audience(db, user["company_id"], data.model_dump())
    return {"count": len(audience), "audience": audience[:200]}


def _format_pt_date(iso_date: str) -> str:
    if not iso_date:
        return ""
    try:
        y, m, d = iso_date.split("-")
        return f"{d}/{m}/{y}"
    except Exception:
        return iso_date


def _substitute_personal(template: str, customer: dict, company_name: str, link_agendar: str) -> str:
    # Reuse existing render_template from notifications module
    from notifications import render_template
    variables = {
        "nome_cliente": customer.get("name", ""),
        "empresa": company_name,
        "link_agendar": link_agendar,
        "ultimo_atendimento": _format_pt_date(customer.get("last_appointment_date", "")),
        "ultimo_servico": customer.get("last_service_name", ""),
        "dias_sem_voltar": str(customer.get("days_since")) if customer.get("days_since") is not None else "",
        "aniversario": customer.get("birthday", ""),
    }
    return render_template(template, variables)


@router.post("/remarketing/bulk-send")
async def remarketing_bulk_send(
    data: BulkSendRequest,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    audience = await _resolve_audience(db, user["company_id"], data.model_dump())
    if not audience:
        raise HTTPException(status_code=400, detail="Nenhum cliente encontrado para os filtros selecionados")

    company = await db.companies.find_one({"id": user["company_id"]}, {"_id": 0, "name": 1})
    company_name = (company or {}).get("name", "")
    page = await db.booking_pages.find_one({"company_id": user["company_id"]}, {"_id": 0, "slug": 1})
    slug = (page or {}).get("slug", "")
    base_url = os.environ.get("FRONTEND_PUBLIC_URL") or os.environ.get("PUBLIC_URL") or ""
    from urllib.parse import urlencode, quote

    when = (data.when or "now").lower()
    if when == "scheduled" and not data.scheduled_at:
        raise HTTPException(status_code=400, detail="scheduled_at e obrigatorio quando when=scheduled")

    if when == "now":
        # Send immediately via baileys
        from notifications import _get_active_whatsapp_conn, _send_via_baileys
        conn = await _get_active_whatsapp_conn(db, user["company_id"])
        if not conn:
            raise HTTPException(status_code=502, detail="Nenhum WhatsApp conectado para envio")
        sent = 0
        failed = 0
        for c in audience:
            qs = ""
            if c.get("name") or c.get("phone"):
                qs = "?" + urlencode({"name": c.get("name", ""), "phone": c.get("phone", "")}, quote_via=quote)
            link_agendar = f"{base_url.rstrip('/')}/{slug}/agenda{qs}" if base_url and slug else ""
            personal_msg = _substitute_personal(data.message, c, company_name, link_agendar)
            ok = await _send_via_baileys(conn["id"], c["phone"], personal_msg)
            if ok:
                sent += 1
            else:
                failed += 1
        return {"message": f"{sent} mensagens enviadas, {failed} falhas", "sent": sent, "failed": failed, "total": len(audience)}

    # Scheduled: store one scheduled_messages doc per recipient
    inserted = 0
    for c in audience:
        qs = ""
        if c.get("name") or c.get("phone"):
            qs = "?" + urlencode({"name": c.get("name", ""), "phone": c.get("phone", "")}, quote_via=quote)
        link_agendar = f"{base_url.rstrip('/')}/{slug}/agenda{qs}" if base_url and slug else ""
        personal_msg = _substitute_personal(data.message, c, company_name, link_agendar)
        await db.scheduled_messages.insert_one({
            "id": str(uuid.uuid4()),
            "company_id": user["company_id"],
            "recipient": c["phone"],
            "recipient_name": c.get("name", ""),
            "channel": "whatsapp",
            "message": personal_msg,
            "scheduled_at": data.scheduled_at,
            "status": "pendente",
            "campaign_filter": data.filter_type,
            "created_by": user["id"],
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        inserted += 1
    return {"message": f"{inserted} mensagens agendadas", "scheduled": inserted, "total": len(audience)}


# === CHAT INTERNO ===
class ChatMessageCreate(BaseModel):
    content: str
    channel_id: Optional[str] = "general"

@router.get("/chat/messages")
async def get_chat_messages(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
    channel_id: str = "general",
    limit: int = 50
):
    messages = await db.internal_chat.find(
        {"company_id": user["company_id"], "channel_id": channel_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(limit)
    return list(reversed(messages))


@router.post("/chat/messages")
async def send_chat_message(
    data: ChatMessageCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    msg = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "channel_id": data.channel_id,
        "sender_id": user["id"],
        "sender_name": user["name"],
        "content": data.content,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.internal_chat.insert_one(msg)
    return {k: v for k, v in msg.items() if k != "_id"}


@router.get("/chat/channels")
async def get_chat_channels(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    channels = await db.chat_channels.find(
        {"company_id": user["company_id"]}, {"_id": 0}
    ).to_list(50)
    if not channels:
        default = {
            "id": "general",
            "company_id": user["company_id"],
            "name": "Geral",
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await db.chat_channels.insert_one(default)
        return [{k: v for k, v in default.items() if k != "_id"}]
    return channels
