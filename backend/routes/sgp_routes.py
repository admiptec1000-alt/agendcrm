"""SGP (Sistema de Gestao de Provedores) integration routes.

Two responsibilities:
1. Per-company SGP credentials CRUD (`/api/sgp/config`).
2. Proxy endpoints (`/api/sgp/<action>`) that forward Flowbuilder/HTTP-node
   calls to the configured SGP base_url, injecting the company's token + app
   automatically. Keeping credentials server-side avoids exposing them in the
   chatflow JSON shared between tenants.

Reference: https://bookstack.sgp.net.br/books/api/page/autenticacoes-via-api
"""
from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel
from typing import Optional, Dict, Any
from datetime import datetime, timezone
import httpx
import logging

logger = logging.getLogger(__name__)

from database import get_database
from auth import get_current_user, require_super_admin

router = APIRouter(prefix="/sgp", tags=["sgp"])

# Allowed SGP URA actions. Each maps to the upstream endpoint path. We
# deliberately whitelist these so the proxy can't be abused to call
# arbitrary SGP routes from a Flowbuilder node.
SGP_ACTIONS: Dict[str, Dict[str, str]] = {
    "consultacliente":   {"path": "/api/ura/consultacliente/",    "method": "POST"},
    "fatura2via":        {"path": "/api/ura/fatura2via/",         "method": "POST"},
    "verificaacesso":    {"path": "/api/ura/verificaacesso/",     "method": "POST"},
    "manutencao":        {"path": "/api/ura/manutencao/list/",    "method": "GET"},
    "liberacaopromessa": {"path": "/api/ura/liberacaopromessa/",  "method": "POST"},
}


class SgpConfigIn(BaseModel):
    base_url: str        # e.g. https://web.sgp.net.br (no trailing slash)
    token: str
    app: str = "8ip"     # client/app identifier sent in body
    enabled: bool = True


class SgpProxyIn(BaseModel):
    """Body sent by Flowbuilder/http nodes. Only `params` flows through to SGP;
    `token` and `app` are ALWAYS injected from the company config so they can
    never be spoofed by chatflow content."""
    params: Optional[Dict[str, Any]] = None


# ---------- Per-company config ----------
@router.get("/config")
async def get_sgp_config(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    cfg = await db.sgp_configs.find_one({"company_id": user["company_id"]}, {"_id": 0})
    if not cfg:
        return {"company_id": user["company_id"], "base_url": "", "token": "", "app": "8ip", "enabled": False}
    # Mask the token in the response so it doesn't leak through dev tools.
    token = cfg.get("token") or ""
    cfg["token_masked"] = (token[:4] + "•" * 8 + token[-4:]) if len(token) >= 8 else "•" * len(token)
    cfg.pop("token", None)
    return cfg


@router.put("/config")
async def update_sgp_config(
    data: SgpConfigIn,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    base_url = (data.base_url or "").strip().rstrip("/")
    raw_token = (data.token or "").strip()
    # Strip invisible/non-ASCII characters from the token. SGP tokens are UUIDs
    # (hex digits + hyphens). When the user copy-pastes from a browser, fonts
    # sometimes substitute Cyrillic 'а' (U+0430) for Latin 'a' (U+0061), which
    # is visually identical but breaks authentication. Reject such tokens.
    sanitized_token = "".join(ch for ch in raw_token if ch.isascii())
    if sanitized_token != raw_token:
        bad = [(i, ch, hex(ord(ch))) for i, ch in enumerate(raw_token) if not ch.isascii()]
        raise HTTPException(
            400,
            f"O token contém caracteres invisíveis/Unicode "
            f"(posições: {bad}). Provavelmente foi copiado de uma fonte que substituiu "
            f"letras visualmente idênticas. Digite o token manualmente."
        )
    # Detect common mistake: user paste the URL of the Django admin token-edit
    # page (where they clicked to generate the token) instead of the API root.
    # Examples to reject: contains '/admin/', '/django/', '/cauth/' or
    # ends with '/change' / '/edit' / has a query string.
    suspect_segments = ("/admin/", "/admin", "/django", "/cauth", "/change", "/edit")
    low = base_url.lower()
    if any(seg in low for seg in suspect_segments) or "?" in base_url or "#" in base_url:
        raise HTTPException(
            400,
            "Base URL parece incorreta. Use APENAS a raiz da API SGP (ex.: "
            "'https://web.sgp.net.br'). Você colou o link do painel Django onde "
            "gerou o token — isso não é a URL da API."
        )
    payload = {
        "company_id": user["company_id"],
        "base_url": base_url,
        "token": sanitized_token,
        "app": (data.app or "8ip").strip(),
        "enabled": bool(data.enabled),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if not payload["base_url"] or not payload["token"]:
        raise HTTPException(400, "base_url e token sao obrigatorios")
    await db.sgp_configs.update_one(
        {"company_id": user["company_id"]},
        {"$set": payload, "$setOnInsert": {"created_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"ok": True, "message": "Configuração SGP salva"}


@router.post("/config/test")
async def test_sgp_config(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Real connectivity check — calls /api/ura/consultacliente/ with a fake CPF
    and validates the upstream actually responded with JSON (not the Django
    admin login page). 302 / HTML responses are flagged as MISCONFIGURED.
    """
    cfg = await db.sgp_configs.find_one({"company_id": user["company_id"]}, {"_id": 0})
    if not cfg or not cfg.get("base_url") or not cfg.get("token"):
        raise HTTPException(400, "Configure base_url e token primeiro")
    url = cfg["base_url"].rstrip("/") + "/api/ura/consultacliente/"
    payload = {"token": cfg["token"], "app": cfg.get("app") or "8ip", "cpfcnpj": "00000000000"}
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as cli:
            r = await cli.post(url, json=payload)
    except Exception as e:
        raise HTTPException(502, f"Falha de conexao com SGP: {e}")

    # Hard-fail on redirects: Django admin sends 302 → login when base_url is wrong.
    if 300 <= r.status_code < 400:
        loc = r.headers.get("location") or "(sem location)"
        raise HTTPException(
            400,
            f"Resposta {r.status_code} (redirecionamento) — Base URL parece "
            f"errada (apontando para o painel Django, não para a API). Use a "
            f"raiz: 'https://web.sgp.net.br'. Redirect destino: {loc}"
        )
    # Non-JSON response = HTML / login page = wrong endpoint
    ct = (r.headers.get("content-type") or "").lower()
    snippet = r.text[:140]
    if "application/json" not in ct:
        raise HTTPException(
            400,
            f"SGP respondeu com '{ct or 'sem content-type'}' (esperado JSON). "
            f"Provavelmente a Base URL está errada. Trecho da resposta: {snippet!r}"
        )
    try:
        body = r.json()
    except Exception:
        raise HTTPException(400, f"Resposta SGP não é JSON válido: {snippet!r}")
    return {
        "ok": r.status_code < 400,
        "status": r.status_code,
        "url": url,
        "response_preview": body if isinstance(body, dict) else {"raw": str(body)[:200]},
    }


# ---------- Proxy declared at END of file (see comment at file head) ----------


# ---------- One-shot import: company-side. The currently logged-in company
#           admin / user can install the SGP chatflow into their own
#           Flowbuilder. SuperAdmin uses the same path via impersonation. ----
@router.post("/import-flow")
async def import_sgp_flow_self(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Generates a ready-to-edit Flowbuilder flow for the CALLER's company,
    pre-wired to call this server's SGP proxy (no hardcoded SGP token, no
    n8n indirection). Idempotent: if a flow with the same name already exists
    we return its id without creating a duplicate.
    """
    company_id = user["company_id"]
    flow_name = "SGP — Atendimento Web Internet"
    existing = await db.flow_builders.find_one({"company_id": company_id, "name": flow_name}, {"_id": 0})
    if existing:
        return {"created": False, "flow_id": existing["id"], "message": "Fluxo ja existe"}

    nodes, edges = _build_sgp_chatflow_skeleton()
    import uuid as _uuid
    flow = {
        "id": str(_uuid.uuid4()),
        "company_id": company_id,
        "name": flow_name,
        "description": "Fluxo de atendimento ISP (consulta cliente, 2via boleto, suporte, liberação por confiança). Use o nó SGP do CRM/proxy para chamadas API.",
        "nodes": nodes,
        "edges": edges,
        "trigger_type": "manual",
        "is_active": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.flow_builders.insert_one(flow)
    return {"created": True, "flow_id": flow["id"], "name": flow_name}


# ---------- One-shot import (LEGACY — kept for any tool already calling this path) ----------
@router.post("/super-admin/import-flow/{company_id}")
async def import_sgp_flow(
    company_id: str,
    _: dict = Depends(require_super_admin),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Generates a ready-to-edit Flowbuilder flow for the target company,
    pre-wired to call this server's SGP proxy (no hardcoded SGP token, no
    n8n indirection). Idempotent: if a flow with the same name already exists
    we skip creation and return its id.
    """
    company = await db.companies.find_one({"id": company_id}, {"_id": 0, "id": 1, "name": 1})
    if not company:
        raise HTTPException(404, "Empresa nao encontrada")
    flow_name = "SGP — Atendimento Web Internet"
    existing = await db.flow_builders.find_one({"company_id": company_id, "name": flow_name}, {"_id": 0})
    if existing:
        return {"created": False, "flow_id": existing["id"], "message": "Fluxo ja existe"}

    nodes, edges = _build_sgp_chatflow_skeleton()
    import uuid as _uuid
    flow = {
        "id": str(_uuid.uuid4()),
        "company_id": company_id,
        "name": flow_name,
        "description": "Fluxo de atendimento ISP (consulta cliente, 2via boleto, suporte, liberação por confiança). Use o nó SGP do CRM/proxy para chamadas API.",
        "nodes": nodes,
        "edges": edges,
        "trigger_type": "manual",
        "is_active": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.flow_builders.insert_one(flow)
    return {"created": True, "flow_id": flow["id"], "name": flow_name}


def _build_sgp_chatflow_skeleton():
    """Returns (nodes, edges) for the imported SGP chatflow. Layout left-to-
    right with vertical branches. All HTTP nodes target our internal proxy
    `/api/sgp/<action>` so SGP credentials live in the company config, NOT
    in the flow JSON. Variable interpolation uses {{var}} which the flow
    runtime already resolves."""
    n = []
    e = []

    def node(id_, label, ntype, x, y, cfg=None):
        n.append({
            "id": id_,
            "type": "flow",
            "position": {"x": x, "y": y},
            "data": {
                "nodeType": ntype,
                "label": label,
                "config": cfg or {"summary": label},
            },
        })

    def edge(src, dst, src_handle=None):
        eid = f"{src}-{dst}" + (f"-{src_handle}" if src_handle else "")
        ed = {"id": eid, "source": src, "target": dst, "type": "default"}
        if src_handle:
            ed["sourceHandle"] = src_handle
        e.append(ed)

    # === MAIN MENU ===
    node("start", "Inicio", "start", 50, 50)
    node("welcome", "Boas-vindas", "message", 50, 180,
         {"summary": "Mensagem de boas-vindas",
          "text": "Seja bem-vindo à central de atendimento da Web Internet 100% Fibra 🌐\n\nPara que eu possa lhe ajudar, escolha uma das opções:"})
    node("main_menu", "Menu Principal", "menu", 50, 320,
         {"summary": "Menu raiz",
          "text": "Escolha uma opção:",
          "options": [
              {"label": "Já sou cliente",     "key": "1"},
              {"label": "Não sou cliente",    "key": "2"},
              {"label": "Suporte técnico",    "key": "3"},
              {"label": "Contratar plano",    "key": "4"},
          ]})
    edge("start", "welcome")
    edge("welcome", "main_menu")

    # === BRANCH 1: existing customer ===
    node("ask_cpf", "Solicitar CPF", "message", -300, 480,
         {"summary": "Pede CPF/CNPJ do titular",
          "text": "Informe o CPF ou CNPJ do titular do plano:",
          "capture_var": "cpf_cliente"})
    node("sgp_consulta", "SGP: consultar cliente", "http", -300, 620,
         {"summary": "POST /api/sgp/consultacliente",
          "method": "POST",
          "url": "{{API_URL}}/api/sgp/consultacliente",
          "headers": {"Authorization": "Bearer {{token}}"},
          "body": {"params": {"cpfcnpj": "{{cpf_cliente}}", "number": "{{number}}"}}})
    node("found_menu", "Cliente encontrado", "menu", -300, 760,
         {"summary": "Menu pos-consulta",
          "text": "Pronto, {{nome_cliente}}! Como posso ajudar?",
          "options": [
              {"label": "2ª via de boleto",      "key": "1"},
              {"label": "Suporte técnico",       "key": "2"},
              {"label": "Falar com atendente",   "key": "3"},
              {"label": "Liberação por confiança","key": "4"},
          ]})
    edge("main_menu", "ask_cpf",      "option-0")
    edge("ask_cpf",   "sgp_consulta")
    edge("sgp_consulta", "found_menu")

    # 1a. 2ª via boleto
    node("sgp_fatura", "SGP: 2ª via", "http", -540, 920,
         {"summary": "POST /api/sgp/fatura2via",
          "method": "POST",
          "url": "{{API_URL}}/api/sgp/fatura2via",
          "headers": {"Authorization": "Bearer {{token}}"},
          "body": {"params": {"cpfcnpj": "{{cpf_cliente}}", "contrato": "{{numero_contrato}}"}}})
    node("send_boleto", "Enviar boleto", "message", -540, 1060,
         {"summary": "Envia o link/PDF do boleto",
          "text": "Aqui está sua 2ª via: {{boleto_url}}"})
    edge("found_menu", "sgp_fatura",  "option-0")
    edge("sgp_fatura", "send_boleto")

    # 1b. Suporte
    node("sgp_acesso", "SGP: verifica acesso", "http", -300, 920,
         {"summary": "POST /api/sgp/verificaacesso",
          "method": "POST",
          "url": "{{API_URL}}/api/sgp/verificaacesso",
          "headers": {"Authorization": "Bearer {{token}}"},
          "body": {"params": {"contrato": "{{numero_contrato}}"}}})
    node("support_menu", "Diagnostico", "menu", -300, 1060,
         {"summary": "Suporte tecnico",
          "text": "Status: {{status_online_offline}}. O que está acontecendo?",
          "options": [
              {"label": "Sem conexão",     "key": "1"},
              {"label": "Conexão lenta",   "key": "2"},
              {"label": "Falar com atendente", "key": "3"},
          ]})
    edge("found_menu", "sgp_acesso",  "option-1")
    edge("sgp_acesso", "support_menu")

    # 1c. Atendente queue
    node("queue_attendant", "Fila atendente", "ticket", -60, 920,
         {"summary": "Move ticket para atendimento humano",
          "queue": "Atendimento"})
    edge("found_menu", "queue_attendant", "option-2")

    # 1d. Liberação por confiança
    node("sgp_promessa", "SGP: liberação confiança", "http", 180, 920,
         {"summary": "POST /api/sgp/liberacaopromessa",
          "method": "POST",
          "url": "{{API_URL}}/api/sgp/liberacaopromessa",
          "headers": {"Authorization": "Bearer {{token}}"},
          "body": {"params": {"contrato": "{{numero_contrato}}"}}})
    node("promessa_done", "Liberação confirmada", "message", 180, 1060,
         {"summary": "Mensagem de confirmacao",
          "text": "Pronto! Sua liberação foi solicitada. Um único pedido por mês."})
    edge("found_menu", "sgp_promessa", "option-3")
    edge("sgp_promessa", "promessa_done")

    # === BRANCH 2: not a customer ===
    node("not_customer", "Não cliente", "menu", 600, 480,
         {"summary": "Menu nao-cliente",
          "text": "Em que posso ajudar?",
          "options": [
              {"label": "Conhecer planos",       "key": "1"},
              {"label": "Consultar viabilidade", "key": "2"},
              {"label": "Falar com atendente",   "key": "3"},
          ]})
    node("plans_msg", "Planos", "message", 600, 620,
         {"summary": "Lista de planos",
          "text": "Nossos planos PRÉ-PAGO (sem fidelidade):\n• 250MB R$74,90\n• 500MB R$99,99\n• 750MB R$124,99\n• 1000MB R$149,00"})
    edge("main_menu",   "not_customer", "option-1")
    edge("not_customer","plans_msg",    "option-0")

    # === BRANCH 3: support without auth ===
    node("sgp_manutencao", "SGP: manutencao em curso", "http", 1000, 480,
         {"summary": "GET /api/sgp/manutencao",
          "method": "POST",
          "url": "{{API_URL}}/api/sgp/manutencao",
          "headers": {"Authorization": "Bearer {{token}}"},
          "body": {"params": {}}})
    node("maintenance_msg", "Aviso de manutencao", "message", 1000, 620,
         {"summary": "Mostra manutencoes ativas",
          "text": "{{descricao}} — {{mensagem_central}}\nStatus: {{status}}"})
    edge("main_menu",       "sgp_manutencao", "option-2")
    edge("sgp_manutencao",  "maintenance_msg")

    # === BRANCH 4: contratar plano ===
    node("contract_queue", "Fila vendas", "ticket", 1400, 480,
         {"summary": "Encaminha para vendas",
          "queue": "Vendas"})
    edge("main_menu", "contract_queue", "option-3")

    return n, e


# ---------- Proxy ----------
# Declared at the END of the module so the {action} catch-all does NOT match
# concrete routes like /import-flow, /config, /config/test, /super-admin/...
# FastAPI matches routes in declaration order.
@router.post("/{action}")
async def sgp_proxy(
    action: str,
    data: SgpProxyIn,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Generic proxy: Flowbuilder calls `POST /api/sgp/consultacliente` with
    `params: {cpfcnpj: "..."}` and we forward to the configured SGP base_url
    with token+app injected. Returns the SGP JSON response verbatim."""
    if action not in SGP_ACTIONS:
        raise HTTPException(400, f"Acao desconhecida: {action}. Disponiveis: {list(SGP_ACTIONS)}")
    cfg = await db.sgp_configs.find_one({"company_id": user["company_id"]}, {"_id": 0})
    if not cfg or not cfg.get("enabled") or not cfg.get("base_url") or not cfg.get("token"):
        raise HTTPException(400, "Integracao SGP nao configurada para esta empresa")

    spec = SGP_ACTIONS[action]
    url = cfg["base_url"].rstrip("/") + spec["path"]
    body = {**(data.params or {}), "token": cfg["token"], "app": cfg.get("app") or "8ip"}

    try:
        async with httpx.AsyncClient(timeout=20.0) as cli:
            if spec["method"] == "GET":
                r = await cli.get(url, params=body)
            else:
                r = await cli.post(url, json=body)
        try:
            payload = r.json()
        except Exception:
            payload = {"raw": r.text}
        # Debug aid: log the top-level keys + a sample contract so we can
        # diagnose missing fields like the customer's "endereco" complaint
        # without having to dump the entire JSON to logs. PII (token, cpf)
        # never gets printed.
        try:
            if isinstance(payload, dict):
                keys = list(payload.keys())
                contratos = payload.get("contratos") if isinstance(payload.get("contratos"), list) else []
                sample_contract_keys = (
                    list(contratos[0].keys()) if contratos and isinstance(contratos[0], dict) else []
                )
                logger.info(
                    f"[sgp/{action}] resp keys={keys} #contratos={len(contratos)} "
                    f"sample_contract_keys={sample_contract_keys[:30]}"
                )
        except Exception:
            pass
        return {"status": r.status_code, "ok": r.status_code < 400, "data": payload}
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Erro ao chamar SGP: {e}")
