"""Flowbuilder runtime engine — processes incoming customer messages and
advances tickets through their attached chat flow.

State persisted on the ticket:
    active_flow_id        — which flow runs
    active_flow_node_id   — current node waiting for input (or None)
    flow_vars             — dict of captured variables (e.g. cpf_cliente)
    flow_started_at       — ISO timestamp

Node shapes (set by the SGP importer + UI):
    {
      id, position,
      data: {
        nodeType: 'start' | 'message' | 'menu' | 'http' | 'ticket' | ...,
        label,
        config: { text, options:[{label,key}], capture_var, url, method,
                  body, headers, queue, summary }
      }
    }

Edges:
    { id, source, target, sourceHandle? }
    sourceHandle is "option-0"/"option-1"/... for menu branches.
"""
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List, Tuple
import os
import re
import uuid
import logging

import httpx

logger = logging.getLogger("flow_engine")

# Maximum nodes processed in a single hop to avoid runaway loops.
HOP_LIMIT = 25
# How long a flow can sit waiting for a customer reply before we abandon it.
FLOW_TIMEOUT_HOURS = 24


def _node_type(n: dict) -> str:
    d = n.get("data") or {}
    return (d.get("nodeType") or n.get("type") or "").lower()


def _node_text(n: dict, vars_: dict, missing: Optional[set] = None) -> Optional[str]:
    d = n.get("data") or {}
    cfg = d.get("config") or {}
    text = cfg.get("text") or d.get("text") or d.get("message") or d.get("content")
    if not isinstance(text, str):
        return None
    out = _interpolate(text, vars_, missing=missing)
    # Append menu options inline so users see choices in WhatsApp text.
    if _node_type(n) == "menu":
        opts = cfg.get("options") or d.get("options") or []
        if opts:
            lines = []
            for i, opt in enumerate(opts):
                key = opt.get("key") or str(i + 1)
                label = opt.get("label") or opt.get("text") or ""
                lines.append(f"{key}. {label}")
            out = (out + "\n\n" + "\n".join(lines)).strip()
    return out


_VAR_RE = re.compile(r"\{\{\s*([\w\.\-]+)\s*\}\}")

# Placeholders the engine considers "critical": if the flow tries to send a
# message containing one of these and the corresponding var is empty, the
# engine substitutes a friendly fallback in the message AND emits a separate
# warning to the customer so they don't get a half-sent message like
# "Pronto, !" or "Aqui está sua 2ª via:" (without a link).
_CRITICAL_PLACEHOLDERS = {
    "nome_cliente": "Cliente nao encontrado em nossa base. Verifique o CPF/CNPJ informado.",
    "boleto_url": "Nao localizei nenhuma fatura aberta para esse contrato.",
    "linha_digitavel": "Nao localizei nenhuma fatura aberta para esse contrato.",
    "numero_contrato": "Nao localizei contrato vinculado a esse CPF/CNPJ.",
}


def _interpolate(text: str, vars_: dict, missing: Optional[set] = None) -> str:
    def _sub(m):
        key = m.group(1)
        # Direct lookup
        if key in vars_:
            v = vars_[key]
            if v in (None, "", False):
                if missing is not None:
                    missing.add(key)
            return str(v or "")
        # Dotted path (e.g. response.data.nome)
        cur = vars_
        for part in key.split("."):
            if isinstance(cur, dict) and part in cur:
                cur = cur[part]
            else:
                if missing is not None:
                    missing.add(key)
                return ""
        if cur in (None, "", False) and missing is not None:
            missing.add(key)
        return str(cur or "")
    return _VAR_RE.sub(_sub, text)


def _next_edge(edges: List[dict], from_node_id: str, source_handle: Optional[str] = None) -> Optional[dict]:
    """Find the outgoing edge from a node. If `source_handle` is given,
    prefer an edge with that exact handle; fall back to a default edge."""
    if source_handle:
        for e in edges:
            if e.get("source") == from_node_id and e.get("sourceHandle") == source_handle:
                return e
    # Any edge from this source (preferring those without a handle)
    for e in edges:
        if e.get("source") == from_node_id and not e.get("sourceHandle"):
            return e
    for e in edges:
        if e.get("source") == from_node_id:
            return e
    return None


def _node_by_id(nodes: List[dict], node_id: str) -> Optional[dict]:
    for n in nodes:
        if n.get("id") == node_id:
            return n
    return None


def _entry_node(nodes: List[dict]) -> Optional[dict]:
    for n in nodes:
        if _node_type(n) == "start":
            return n
    # fall back to first node with text
    return nodes[0] if nodes else None


async def _send_whatsapp(ticket: dict, text: str):
    """Fire-and-forget WhatsApp send via local microservice."""
    try:
        wa_url = os.environ.get("WA_SERVICE_URL", "http://localhost:3002")
        target = ticket.get("lid_jid") if ticket.get("pending_lid_resolution") else ticket.get("customer_phone")
        if not (ticket.get("connection_id") and target):
            return
        async with httpx.AsyncClient(timeout=15.0) as cli:
            await cli.post(
                f"{wa_url}/instances/{ticket['connection_id']}/send",
                json={"phone": target, "message": text},
            )
    except Exception as e:
        logger.warning(f"[flow_engine] send failed: {e}")


async def _persist_outgoing(db, ticket_id: str, text: str, flow_id: str):
    msg = {
        "id": str(uuid.uuid4()),
        "ticket_id": ticket_id,
        "content": text,
        "sender_type": "agent",
        "sender_id": None,
        "channel": "whatsapp",
        "wa_message_id": None,
        "auto_flow_id": flow_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.tickets.update_one(
        {"id": ticket_id},
        {"$push": {"messages": msg},
         "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
    )


def _flatten_sgp_response(action: str, data: Any) -> dict:
    """Map common SGP URA response fields to friendly top-level vars so the
    flow can use placeholders like `{{nome_cliente}}` directly without having
    to know the exact JSON path. Tolerant: missing fields don't raise.
    """
    out: dict = {}
    if not isinstance(data, dict):
        return out
    # Default discovery flag so flow can branch on whether SGP actually
    # found something. The flow can use {{cliente_encontrado}} or simply
    # rely on `nome_cliente` being empty — but explicit is better.
    out["cliente_encontrado"] = False
    out["fatura_encontrada"] = False
    try:
        if action == "consultacliente":
            # Typical shape: {"clientes": [...], "contratos": [...]}
            # Newer SGP also returns plain {"contratos": [...]} when the
            # cliente list is at the root of the response.
            clientes = data.get("clientes") or []
            contratos_top = data.get("contratos") or []
            cli = clientes[0] if (isinstance(clientes, list) and clientes) else {}
            if not isinstance(cli, dict):
                return out
            out["nome_cliente"] = cli.get("nome") or cli.get("razaosocial") or cli.get("razao_social") or ""
            out["cpfcnpj_cliente"] = cli.get("cpfcnpj") or cli.get("cnpj") or cli.get("cpf") or ""
            out["email_cliente"] = cli.get("email") or ""
            contratos = cli.get("contratos") or contratos_top or []
            if isinstance(contratos, list) and contratos and isinstance(contratos[0], dict):
                ct = contratos[0]
                out["numero_contrato"] = str(ct.get("contrato") or ct.get("id") or "")
                out["status_contrato"] = ct.get("status") or ct.get("statusexibicao") or ""
                out["plano_cliente"] = ct.get("plano") or ct.get("planointernet") or ""
                out["endereco_cliente"] = ct.get("endereco") or ""
            # Mark "encontrado" only when we actually have a name OR contract.
            out["cliente_encontrado"] = bool(out.get("nome_cliente") or out.get("numero_contrato"))
        elif action == "fatura2via":
            # Typical shape: {"faturas": [{"link": ..., "linhadigitavel": ..., "valor": ..., "vencimento": ...}]}
            faturas = data.get("faturas") or data.get("titulos") or []
            if isinstance(faturas, list) and faturas and isinstance(faturas[0], dict):
                f = faturas[0]
                out["boleto_url"] = f.get("link") or f.get("url") or f.get("linkboleto") or ""
                out["linha_digitavel"] = f.get("linhadigitavel") or f.get("linha_digitavel") or ""
                out["valor_fatura"] = str(f.get("valor") or "")
                out["vencimento_fatura"] = f.get("vencimento") or f.get("datavencimento") or ""
            else:
                out["boleto_url"] = data.get("link") or data.get("url") or ""
                out["linha_digitavel"] = data.get("linhadigitavel") or ""
            out["fatura_encontrada"] = bool(out.get("boleto_url") or out.get("linha_digitavel"))
        elif action == "verificaacesso":
            # Typical shape: {"online": True, "status": "...", "mac": "..."}
            online = data.get("online")
            if online is None and "status" in data:
                online = "online" in str(data.get("status", "")).lower()
            out["status_online_offline"] = "Online" if online else "Offline"
        elif action == "manutencao":
            mans = data.get("manutencoes") or data.get("ocorrencias") or []
            if isinstance(mans, list) and mans and isinstance(mans[0], dict):
                m = mans[0]
                out["descricao"] = m.get("descricao") or m.get("titulo") or ""
                out["mensagem_central"] = m.get("mensagem") or m.get("mensagem_central") or ""
                out["status"] = m.get("status") or "Em andamento"
            else:
                out["descricao"] = "Sem manutencoes ativas"
                out["mensagem_central"] = "Nossa rede esta operando normalmente."
                out["status"] = "OK"
        elif action == "liberacaopromessa":
            out["liberacao_status"] = data.get("status") or data.get("mensagem") or "OK"
    except Exception as e:
        logger.warning(f"[flow_engine] sgp flatten failed action={action}: {e}")
    return out


async def _execute_http_node(node: dict, vars_: dict, company_id: str) -> dict:
    """Execute an http/api node. Returns dict to merge into vars_.
    URL placeholders {{API_URL}}, {{token}} are stripped — we ALWAYS call
    the local SGP proxy when the URL points to /api/sgp/*, since it injects
    company-scoped credentials. External URLs are called as-is.
    """
    cfg = (node.get("data") or {}).get("config") or {}
    method = (cfg.get("method") or "POST").upper()
    raw_url = cfg.get("url") or ""
    body = cfg.get("body") or {}

    # Resolve placeholders against captured vars
    def _walk(v):
        if isinstance(v, str): return _interpolate(v, vars_)
        if isinstance(v, dict): return {k: _walk(x) for k, x in v.items()}
        if isinstance(v, list): return [_walk(x) for x in v]
        return v

    body = _walk(body)
    url = _interpolate(raw_url, vars_)

    # Internal proxy shortcut: {{API_URL}}/api/sgp/<action>
    if "/api/sgp/" in url:
        # Call the internal proxy directly (in-process import) with the
        # company config — this avoids needing a self-HTTP loop.
        from routes.sgp_routes import SGP_ACTIONS
        from database import get_database
        action = url.split("/api/sgp/")[-1].rstrip("/").split("?")[0]
        if action not in SGP_ACTIONS:
            return {"_http_error": f"acao SGP desconhecida: {action}"}
        try:
            db = await get_database()
            cfg_doc = await db.sgp_configs.find_one({"company_id": company_id}, {"_id": 0})
            if not cfg_doc or not cfg_doc.get("enabled"):
                return {"_http_error": "Integracao SGP nao configurada"}
            spec = SGP_ACTIONS[action]
            api_url = cfg_doc["base_url"].rstrip("/") + spec["path"]
            params = (body.get("params") if isinstance(body, dict) else None) or {}
            payload = {**params, "token": cfg_doc["token"], "app": cfg_doc.get("app") or "8ip"}
            logger.info(f"[flow_engine] SGP call action={action} payload_keys={list(params.keys())}")
            async with httpx.AsyncClient(timeout=15.0) as cli:
                if spec["method"] == "GET":
                    r = await cli.get(api_url, params=payload)
                else:
                    r = await cli.post(api_url, json=payload)
            try: data = r.json()
            except Exception: data = {"raw": r.text}
            logger.info(f"[flow_engine] SGP response action={action} status={r.status_code} keys={list(data.keys()) if isinstance(data, dict) else type(data).__name__}")
            # Auto-flatten common SGP fields → top-level vars (e.g. nome_cliente)
            flat = _flatten_sgp_response(action, data)
            if flat:
                logger.info(f"[flow_engine] SGP auto-flatten extracted: {list(flat.keys())}")
            out = {"response": data, "_http_status": r.status_code, **flat}
            return out
        except Exception as e:
            logger.warning(f"[flow_engine] SGP error: {e}")
            return {"_http_error": str(e)}

    # Plain HTTP call
    try:
        async with httpx.AsyncClient(timeout=15.0) as cli:
            if method == "GET":
                r = await cli.get(url, params=body if isinstance(body, dict) else None)
            else:
                r = await cli.request(method, url, json=body)
        try: data = r.json()
        except Exception: data = {"raw": r.text}
        return {"response": data, "_http_status": r.status_code}
    except Exception as e:
        return {"_http_error": str(e)}


async def advance_flow(
    db,
    ticket: dict,
    flow: dict,
    incoming_text: Optional[str] = None,
    is_initial: bool = False,
    dry_run: bool = False,
) -> List[str]:
    """Walk the flow graph from the ticket's current position, sending any
    output messages and updating the ticket's `active_flow_node_id` when we
    reach a node that needs user input (currently: `menu`).

    `is_initial` = True means the caller is `/webhook/message` after creating
    the ticket — we begin at the entry node. Otherwise, `incoming_text` holds
    the customer's reply to the previously-posted menu/prompt.

    `dry_run` = True returns the list of would-be-sent messages WITHOUT
    persisting or calling WhatsApp. Used by the /test endpoint.
    """
    sent: List[str] = []
    nodes = flow.get("nodes") or []
    edges = flow.get("edges") or []
    if not nodes:
        logger.warning(f"[flow_engine] flow {flow.get('id')} has no nodes")
        return sent
    flow_id = flow["id"]
    company_id = ticket["company_id"]
    vars_: dict = ticket.get("flow_vars") or {}
    vars_["nome"] = ticket.get("customer_name") or ""
    vars_["customer_phone"] = ticket.get("customer_phone") or ""
    vars_["number"] = ticket.get("customer_phone") or ""

    tid = ticket.get("id")
    logger.info(f"[flow_engine] advance start flow={flow_id} ticket={tid} is_initial={is_initial} incoming_text={(incoming_text or '')[:80]!r} prev_node={ticket.get('active_flow_node_id')!r}")

    async def _emit_and_persist(text: str):
        """Send text outbound and persist as agent message. Honours dry_run."""
        sent.append(text)
        if dry_run:
            return
        await _persist_outgoing(db, ticket["id"], text, flow_id)
        await _send_whatsapp(ticket, text)

    # Determine starting node + branch
    current_id: Optional[str] = None
    branch_handle: Optional[str] = None
    if is_initial:
        entry = _entry_node(nodes)
        if not entry:
            logger.warning(f"[flow_engine] flow {flow_id}: no entry node — flow has {len(nodes)} nodes")
            return sent
        current_id = entry["id"]
        logger.info(f"[flow_engine] flow {flow_id} initial trigger ticket={tid} entry={entry['id']!r} type={_node_type(entry)!r}")
    else:
        prev_id = ticket.get("active_flow_node_id")
        if not prev_id:
            logger.info(f"[flow_engine] ticket {tid} has no active_flow_node_id; ignoring reply")
            return sent
        prev = _node_by_id(nodes, prev_id)
        if not prev:
            logger.warning(f"[flow_engine] previous node {prev_id!r} missing from flow {flow_id} — clearing state")
            if not dry_run:
                await _save_state(db, ticket["id"], flow_id, None, vars_)
            return sent
        # Process customer reply for menu nodes
        if _node_type(prev) == "menu":
            cfg = (prev.get("data") or {}).get("config") or {}
            opts = cfg.get("options") or []
            choice_idx = _resolve_menu_choice(incoming_text, opts)
            if choice_idx is None:
                logger.info(f"[flow_engine] menu {prev_id} got invalid reply {incoming_text!r}; re-prompting")
                txt = _node_text(prev, vars_) or "Opção inválida. Tente novamente."
                await _emit_and_persist(txt)
                return sent
            branch_handle = f"option-{choice_idx}"
            cap = cfg.get("capture_var")
            if cap and choice_idx < len(opts):
                vars_[cap] = opts[choice_idx].get("label") or opts[choice_idx].get("key") or incoming_text
            logger.info(f"[flow_engine] menu {prev_id} resolved to idx={choice_idx} handle={branch_handle}")
        else:
            cfg = (prev.get("data") or {}).get("config") or {}
            cap = cfg.get("capture_var")
            if cap and incoming_text:
                vars_[cap] = incoming_text.strip()
                logger.info(f"[flow_engine] captured {cap}={incoming_text.strip()!r} from node {prev_id}")
        nxt_edge = _next_edge(edges, prev_id, branch_handle)
        if not nxt_edge:
            logger.info(f"[flow_engine] no edge from {prev_id} (handle={branch_handle}); ending flow")
            if not dry_run:
                await _save_state(db, ticket["id"], flow_id, None, vars_)
            return sent
        current_id = nxt_edge["target"]

    # Linear execution loop
    hops = 0
    pending_node_id: Optional[str] = None
    while current_id and hops < HOP_LIMIT:
        hops += 1
        node = _node_by_id(nodes, current_id)
        if not node:
            logger.warning(f"[flow_engine] referenced node {current_id!r} not found — breaking")
            break
        nt = _node_type(node)
        logger.info(f"[flow_engine] hop={hops} visiting node {current_id!r} type={nt!r}")

        if nt in ("start", "trigger"):
            # No output, just advance
            edge = _next_edge(edges, current_id)
            if not edge:
                logger.warning(f"[flow_engine] start node {current_id} has no outgoing edge — flow ends silently")
            current_id = edge["target"] if edge else None
            continue

        if nt in ("message", "welcome", "send_message", "text"):
            missing: set = set()
            text = _node_text(node, vars_, missing=missing)
            critical_missing = missing & set(_CRITICAL_PLACEHOLDERS.keys())
            if text and critical_missing:
                # Don't deliver "Pronto, !" or "Aqui está sua 2ª via:" without
                # the data. Send a single contextual error and end the flow so
                # the customer can retry from the start instead of seeing a
                # broken half-message.
                fallback = _CRITICAL_PLACEHOLDERS[next(iter(critical_missing))]
                logger.warning(f"[flow_engine] node {current_id} has unresolved critical placeholders {critical_missing}; emitting fallback")
                await _emit_and_persist(fallback)
                if not dry_run:
                    await _save_state(db, ticket["id"], flow_id, None, vars_)
                return sent
            if text:
                await _emit_and_persist(text)
            else:
                logger.info(f"[flow_engine] node {current_id} ({nt}) has no text — skipping emit")
            edge = _next_edge(edges, current_id)
            current_id = edge["target"] if edge else None
            continue

        if nt == "menu":
            missing = set()
            text = _node_text(node, vars_, missing=missing) or "Escolha uma opcao:"
            critical_missing = missing & set(_CRITICAL_PLACEHOLDERS.keys())
            if critical_missing:
                fallback = _CRITICAL_PLACEHOLDERS[next(iter(critical_missing))]
                logger.warning(f"[flow_engine] menu {current_id} has unresolved critical placeholders {critical_missing}; emitting fallback and ending")
                await _emit_and_persist(fallback)
                if not dry_run:
                    await _save_state(db, ticket["id"], flow_id, None, vars_)
                return sent
            await _emit_and_persist(text)
            pending_node_id = current_id
            current_id = None
            logger.info(f"[flow_engine] menu {pending_node_id} posted; waiting for customer reply")
            break

        if nt in ("http", "request", "api", "http_request"):
            logger.info(f"[flow_engine] executing http node {current_id}")
            result = await _execute_http_node(node, vars_, company_id)
            # Merge result into vars so subsequent message nodes can interpolate
            for k, v in result.items():
                vars_[k] = v
            if "_http_error" in result:
                logger.warning(f"[flow_engine] http node {current_id} error: {result['_http_error']}")
            edge = _next_edge(edges, current_id)
            current_id = edge["target"] if edge else None
            continue

        if nt in ("ticket", "queue", "transfer"):
            cfg = (node.get("data") or {}).get("config") or {}
            queue = cfg.get("queue")
            patch = {"updated_at": datetime.now(timezone.utc).isoformat(),
                     "active_flow_node_id": None,
                     "active_flow_id": None,
                     "flow_vars": vars_}
            if queue:
                patch["queue"] = queue
            if not dry_run:
                await db.tickets.update_one({"id": ticket["id"]}, {"$set": patch})
            logger.info(f"[flow_engine] flow ended at ticket/queue node {current_id} queue={queue!r}")
            return sent  # flow ends here — human pickup

        # Unknown node type: try to send text then advance
        logger.info(f"[flow_engine] unknown node type {nt!r}; treating as message")
        text = _node_text(node, vars_)
        if text:
            await _emit_and_persist(text)
        edge = _next_edge(edges, current_id)
        current_id = edge["target"] if edge else None

    if hops >= HOP_LIMIT:
        logger.warning(f"[flow_engine] hop limit reached on flow {flow_id} ticket {tid}")

    if not dry_run:
        await _save_state(db, ticket["id"], flow_id, pending_node_id, vars_)
    logger.info(f"[flow_engine] advance done ticket={tid} sent_count={len(sent)} pending_node={pending_node_id!r}")
    return sent


def _resolve_menu_choice(text: Optional[str], options: list) -> Optional[int]:
    """Match user reply against options. Accepts:
    - exact key ("1", "2")
    - label fuzzy contains
    """
    if not text or not options:
        return None
    s = text.strip().lower()
    # Exact key
    for i, o in enumerate(options):
        k = str(o.get("key") or "").strip().lower()
        if k and s == k:
            return i
    # Numeric idx
    if s.isdigit():
        idx = int(s) - 1
        if 0 <= idx < len(options):
            return idx
    # Label contains
    for i, o in enumerate(options):
        lbl = (o.get("label") or "").strip().lower()
        if lbl and (s == lbl or s in lbl or lbl in s):
            return i
    return None


async def _save_state(db, ticket_id: str, flow_id: str, pending_node_id: Optional[str], vars_: dict):
    patch = {
        "active_flow_id": flow_id if pending_node_id else None,
        "active_flow_node_id": pending_node_id,
        "flow_vars": vars_,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if pending_node_id:
        # First time entering a wait state — record start timestamp once.
        existing = await db.tickets.find_one({"id": ticket_id}, {"_id": 0, "flow_started_at": 1})
        if not (existing or {}).get("flow_started_at"):
            patch["flow_started_at"] = datetime.now(timezone.utc).isoformat()
    res = await db.tickets.update_one({"id": ticket_id}, {"$set": patch})
    logger.info(f"[flow_engine] save_state ticket={ticket_id} pending_node={pending_node_id!r} matched={getattr(res, 'matched_count', '?')}")


async def is_flow_active(ticket: dict) -> bool:
    """Check if the ticket is currently inside a running flow waiting for
    customer input. Stale flows (older than FLOW_TIMEOUT_HOURS) are ignored
    so the customer doesn't get stuck if the flow gets edited or removed."""
    if not (ticket.get("active_flow_id") and ticket.get("active_flow_node_id")):
        return False
    started = ticket.get("flow_started_at")
    if started:
        try:
            ts = datetime.fromisoformat(started.replace("Z", "+00:00"))
            age_h = (datetime.now(timezone.utc) - ts).total_seconds() / 3600
            if age_h > FLOW_TIMEOUT_HOURS:
                return False
        except Exception:
            pass
    return True
