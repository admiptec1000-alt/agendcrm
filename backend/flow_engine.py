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


def _node_text(n: dict, vars_: dict) -> Optional[str]:
    d = n.get("data") or {}
    cfg = d.get("config") or {}
    text = cfg.get("text") or d.get("text") or d.get("message") or d.get("content")
    if not isinstance(text, str):
        return None
    out = _interpolate(text, vars_)
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


def _interpolate(text: str, vars_: dict) -> str:
    def _sub(m):
        key = m.group(1)
        # Direct lookup
        if key in vars_:
            return str(vars_[key] or "")
        # Dotted path (e.g. response.data.nome)
        cur = vars_
        for part in key.split("."):
            if isinstance(cur, dict) and part in cur:
                cur = cur[part]
            else:
                return ""
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
        from routes.sgp_routes import sgp_proxy, SGP_ACTIONS, SgpProxyIn
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
            async with httpx.AsyncClient(timeout=15.0) as cli:
                if spec["method"] == "GET":
                    r = await cli.get(api_url, params=payload)
                else:
                    r = await cli.post(api_url, json=payload)
            try: data = r.json()
            except Exception: data = {"raw": r.text}
            return {"response": data, "_http_status": r.status_code}
        except Exception as e:
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

    async def _emit(text: str):
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
            logger.warning(f"[flow_engine] flow {flow_id}: no entry node")
            return sent
        current_id = entry["id"]
        logger.info(f"[flow_engine] flow {flow_id} initial trigger ticket={ticket.get('id')} entry={entry['id']}")
    else:
        prev_id = ticket.get("active_flow_node_id")
        if not prev_id:
            logger.info(f"[flow_engine] ticket {ticket.get('id')} has no active_flow_node_id; ignoring reply")
            return sent
        prev = _node_by_id(nodes, prev_id)
        if not prev:
            logger.warning(f"[flow_engine] previous node {prev_id} missing from flow")
            return sent
        # Process customer reply for menu nodes
        if _node_type(prev) == "menu":
            cfg = (prev.get("data") or {}).get("config") or {}
            opts = cfg.get("options") or []
            choice_idx = _resolve_menu_choice(incoming_text, opts)
            if choice_idx is None:
                txt = _node_text(prev, vars_) or "Opção inválida. Tente novamente."
                await _emit(txt)
                return sent
            branch_handle = f"option-{choice_idx}"
            cap = cfg.get("capture_var")
            if cap and choice_idx < len(opts):
                vars_[cap] = opts[choice_idx].get("label") or opts[choice_idx].get("key") or incoming_text
        else:
            cfg = (prev.get("data") or {}).get("config") or {}
            cap = cfg.get("capture_var")
            if cap and incoming_text:
                vars_[cap] = incoming_text.strip()
        nxt_edge = _next_edge(edges, prev_id, branch_handle)
        if not nxt_edge:
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
            break
        nt = _node_type(node)

        if nt in ("start",):
            # No output, just advance
            edge = _next_edge(edges, current_id)
            current_id = edge["target"] if edge else None
            continue

        if nt in ("message", "welcome", "send_message"):
            text = _node_text(node, vars_)
            if text:
                await _persist_outgoing(db, ticket["id"], text, flow_id)
                await _send_whatsapp(ticket, text)
            edge = _next_edge(edges, current_id)
            current_id = edge["target"] if edge else None
            continue

        if nt == "menu":
            text = _node_text(node, vars_) or "Escolha uma opcao:"
            await _persist_outgoing(db, ticket["id"], text, flow_id)
            await _send_whatsapp(ticket, text)
            pending_node_id = current_id
            current_id = None
            break

        if nt in ("http", "request", "api", "http_request"):
            result = await _execute_http_node(node, vars_, company_id)
            # Merge result into vars so subsequent message nodes can interpolate
            for k, v in result.items():
                vars_[k] = v
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
            await db.tickets.update_one({"id": ticket["id"]}, {"$set": patch})
            return  # flow ends here — human pickup

        # Unknown node type: try to send text then advance
        text = _node_text(node, vars_)
        if text:
            await _persist_outgoing(db, ticket["id"], text, flow_id)
            await _send_whatsapp(ticket, text)
        edge = _next_edge(edges, current_id)
        current_id = edge["target"] if edge else None

    await _save_state(db, ticket["id"], flow_id, pending_node_id, vars_)


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
    if pending_node_id and not vars_.get("_flow_started"):
        patch["flow_started_at"] = datetime.now(timezone.utc).isoformat()
    await db.tickets.update_one({"id": ticket_id}, {"$set": patch})


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
