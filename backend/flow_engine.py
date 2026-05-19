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
                  body, headers, queue, summary,
                  capture_format: 'cpf'|'cnpj'|'cpfcnpj'|'email'|'cep'|'phone'|'number',
                  capture_invalid_message: 'Mensagem custom em caso de invalido' }
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


# ── Capture-format validators ──────────────────────────────────────────────
# When a node has `config.capture_format` set, the engine validates the
# incoming text BEFORE storing it in flow_vars. Invalid input keeps the flow
# paused at the same node and re-sends the prompt (optionally with a custom
# `capture_invalid_message`). This lets operators say "ask CPF and refuse
# to continue until customer types a valid one" without writing custom code.
# 2026-02-15 (E) — user requirement: "solicito ao cliente um CPF ou CNPJ
# e só posso continuar com o fluxo depois que o mesmo insere essas informacoes".

def _validate_cpf(digits: str) -> bool:
    if len(digits) != 11 or len(set(digits)) == 1:
        return False
    s = sum(int(digits[i]) * (10 - i) for i in range(9))
    r = (s * 10) % 11
    if r == 10: r = 0
    if r != int(digits[9]): return False
    s = sum(int(digits[i]) * (11 - i) for i in range(10))
    r = (s * 10) % 11
    if r == 10: r = 0
    return r == int(digits[10])


def _validate_cnpj(digits: str) -> bool:
    if len(digits) != 14 or len(set(digits)) == 1:
        return False
    def calc(slc):
        w = [5,4,3,2,9,8,7,6,5,4,3,2] if len(slc) == 12 else [6,5,4,3,2,9,8,7,6,5,4,3,2]
        s = sum(int(slc[i]) * w[i] for i in range(len(slc)))
        r = s % 11
        return 0 if r < 2 else 11 - r
    if calc(digits[:12]) != int(digits[12]): return False
    return calc(digits[:13]) == int(digits[13])


_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def validate_capture(value: str, fmt: str) -> Tuple[bool, str]:
    """Returns (is_valid, default_error_message)."""
    if not fmt:
        return True, ""
    fmt = (fmt or "").strip().lower()
    text = (value or "").strip()
    digits = re.sub(r"\D", "", text)
    if fmt == "cpf":
        return (_validate_cpf(digits), "Por favor envie um CPF valido (somente numeros, 11 digitos).")
    if fmt == "cnpj":
        return (_validate_cnpj(digits), "Por favor envie um CNPJ valido (somente numeros, 14 digitos).")
    if fmt == "cpfcnpj":
        ok = _validate_cpf(digits) or _validate_cnpj(digits)
        return (ok, "Por favor envie um CPF (11 digitos) ou CNPJ (14 digitos) valido.")
    if fmt == "email":
        return (bool(_EMAIL_RE.match(text)), "Por favor envie um email valido (exemplo: nome@dominio.com).")
    if fmt == "cep":
        return (len(digits) == 8, "Por favor envie um CEP valido (8 digitos).")
    if fmt == "phone":
        return (10 <= len(digits) <= 13, "Por favor envie um telefone valido (DDD + numero).")
    if fmt == "number":
        return (digits.isdigit() and len(digits) > 0, "Por favor envie apenas numeros.")
    return True, ""


def _node_text(n: dict, vars_: dict, missing: Optional[set] = None) -> Optional[str]:
    d = n.get("data") or {}
    cfg = d.get("config") or {}
    # Menu nodes store the prompt under `question` in the operator UI; message
    # nodes store it under `text`. We accept BOTH for both node types so a
    # repair/migration that swapped the key still renders correctly. Without
    # this fallback the engine emits "Escolha uma opcao:" stripped of any
    # template (and {{contratos_menu}} never gets interpolated).
    text = (
        cfg.get("text")
        or cfg.get("question")
        or d.get("text")
        or d.get("message")
        or d.get("content")
    )
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
                # Bracketed format gives a more "modern" feel than "1. label"
                # and matches the contracts picker style ([ N ] - ...).
                lines.append(f"[ {key} ] - {label}")
            # Auto-append a "Voltar ao menu anterior" entry when the operator
            # didn't add one and the menu isn't flagged as root. The handler
            # in `advance_flow` rewinds to the previous menu when the user
            # picks "9". Operators can disable by setting `no_back: true`
            # on the menu node config.
            no_back = cfg.get("no_back") or cfg.get("hide_back")
            already_has_back = any(
                str(o.get("key") or "") == "9"
                or "voltar" in str(o.get("label", "")).lower()
                for o in opts
            )
            if not no_back and not already_has_back:
                lines.append("[ 9 ] - Voltar ao menu anterior")
            out = (out + "\n\n" + "\n".join(lines)).strip()
    return out


_VAR_RE = re.compile(r"\{\{\s*([\w\.\-]+)\s*\}\}")
# Accept SGP-native single-curly placeholders too (their docs show things like
# `{link_pix_html}`, `{linhadigitavel}`). We only match keys that look like
# identifiers so we don't accidentally swallow `{0}` style format strings or
# JSON blocks. Negative lookarounds avoid double-matching `{{var}}`.
_VAR_RE_SINGLE = re.compile(r"(?<!\{)\{\s*([a-zA-Z_][\w\.\-]*)\s*\}(?!\})")

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
        # Dotted path. Supports list indices as numeric segments, e.g.
        # "response.contratos.0.razaoSocial" walks through a dict, then a
        # list, then back into a dict.
        cur = vars_
        for part in key.split("."):
            if isinstance(cur, dict) and part in cur:
                cur = cur[part]
            elif isinstance(cur, list) and part.lstrip("-").isdigit():
                idx = int(part)
                if -len(cur) <= idx < len(cur):
                    cur = cur[idx]
                else:
                    if missing is not None:
                        missing.add(key)
                    return ""
            else:
                if missing is not None:
                    missing.add(key)
                return ""
        if cur in (None, "", False) and missing is not None:
            missing.add(key)
        return str(cur or "")
    out = _VAR_RE.sub(_sub, text)
    # Second pass: single-curly placeholders for compatibility with the
    # native SGP template format the operator copy-pastes from their docs.
    out = _VAR_RE_SINGLE.sub(_sub, out)
    return out


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


async def _send_whatsapp_interactive(ticket: dict, payload: dict):
    """Send a buttons/list message via the local microservice.

    `payload` is forwarded as-is to /send-interactive. Returns True on success,
    False otherwise (caller should fall back to plain text)."""
    try:
        wa_url = os.environ.get("WA_SERVICE_URL", "http://localhost:3002")
        target = ticket.get("lid_jid") if ticket.get("pending_lid_resolution") else ticket.get("customer_phone")
        if not (ticket.get("connection_id") and target):
            return False
        body = {"phone": target, **payload}
        async with httpx.AsyncClient(timeout=15.0) as cli:
            r = await cli.post(
                f"{wa_url}/instances/{ticket['connection_id']}/send-interactive",
                json=body,
            )
            return r.status_code == 200 and r.json().get("success", False)
    except Exception as e:
        logger.warning(f"[flow_engine] send-interactive failed: {e}")
        return False


async def _send_whatsapp(ticket: dict, text: str) -> Optional[str]:
    """Send a WhatsApp message via the local microservice and return the
    Baileys-issued `message_id` (or None on failure). The caller MUST stamp
    that id on the persisted message so the inbound `messages.upsert` echo
    (fromMe=true) gets deduplicated by `channels_routes` — otherwise every
    bot message would appear twice in the operator UI."""
    try:
        wa_url = os.environ.get("WA_SERVICE_URL", "http://localhost:3002")
        target = ticket.get("lid_jid") if ticket.get("pending_lid_resolution") else ticket.get("customer_phone")
        if not (ticket.get("connection_id") and target):
            return None
        async with httpx.AsyncClient(timeout=15.0) as cli:
            r = await cli.post(
                f"{wa_url}/instances/{ticket['connection_id']}/send",
                json={"phone": target, "message": text},
            )
            if r.status_code != 200:
                return None
            payload = r.json() if r.content else {}
            return payload.get("message_id")
    except Exception as e:
        logger.warning(f"[flow_engine] send failed: {e}")
        return None


async def _persist_outgoing(db, ticket_id: str, text: str, flow_id: str,
                            wa_message_id: Optional[str] = None):
    msg = {
        "id": str(uuid.uuid4()),
        "ticket_id": ticket_id,
        "content": text,
        "sender_type": "agent",
        "sender_id": None,
        # Human-friendly label so the operator can tell an automated message
        # apart from one typed by a teammate. Without this, the UI defaults
        # to "Admin", which confuses operators into thinking a human pushed
        # the reply.
        "sender_name": "Bot (Flow)",
        "channel": "whatsapp",
        # Stamp the Baileys-issued id so the from-me echo coming via the
        # /webhook/message route hits the dedup branch (existing_ids check)
        # and is NOT inserted a second time. When the engine runs in dry-run
        # (no real WA call), this stays None — and the echo path won't fire
        # anyway because nothing was sent over the network.
        "wa_message_id": wa_message_id,
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
            # Real SGP URA shape (verified against web.sgp.net.br): the
            # response has NO "clientes" key — all fields live directly on
            # each item of `contratos[]`. Fields use camelCase ("cpfCnpj",
            # "razaoSocial", "contratoId", "contratoStatusDisplay"...). Older
            # endpoints sometimes use a "clientes" wrapper with snake_case;
            # we try both for forward/backward compatibility.
            clientes = data.get("clientes") or []
            contratos = data.get("contratos") or []
            cli = clientes[0] if (isinstance(clientes, list) and clientes) else {}
            ct = contratos[0] if (isinstance(contratos, list) and contratos and isinstance(contratos[0], dict)) else {}
            # ── Multi-contract support: expose the full list as
            # `contratos_lista` (objects with label/value) and a printable
            # `contratos_menu` (numbered text). The flowbuilder UI picks the
            # rendering format (text/buttons/list) via the new `options_format`
            # setting; the runtime only needs the list ready.
            contratos_lista = []
            for idx, c in enumerate(contratos if isinstance(contratos, list) else []):
                if not isinstance(c, dict):
                    continue
                cid = str(c.get("contratoId") or c.get("contrato") or c.get("id") or "")
                status = (
                    c.get("contratoStatusDisplay") or c.get("statusexibicao")
                    or c.get("status") or "—"
                )
                # Build a human address from a LOT of possible field names.
                # Different SGP tenants serialise the address differently:
                #   • `endereco` as a string (already joined)
                #   • `endereco` as a dict ({logradouro, numero, bairro})
                #   • flat keys at the contract level (`logradouro`, …)
                #   • flat keys at the CLIENT level (when SGP returns the
                #     address shared across all contratos of the same
                #     person — only `cliente` carries it)
                # We try every shape until we get something printable.
                def _addr_from(d: Any) -> str:
                    if not isinstance(d, dict):
                        return ""
                    log = (d.get("logradouro") or d.get("rua") or d.get("address") or "").strip()
                    num = (d.get("numero") or d.get("numero_endereco") or d.get("number") or "").strip()
                    bai = (d.get("bairro") or d.get("neighbourhood") or "").strip()
                    cid = (d.get("cidade") or d.get("municipio") or "").strip()
                    uf = (d.get("uf") or d.get("estado") or "").strip()
                    head_parts = [p for p in [log, num and f"nº {num}"] if p]
                    head = ", ".join(head_parts) if head_parts else ""
                    tail_parts = [p for p in [bai, cid and uf and f"{cid}/{uf}" or cid or uf] if p]
                    tail = " - " + " - ".join(tail_parts) if tail_parts else ""
                    return (head + tail).strip(" -,")

                endereco_raw = ""
                # 1) Direct string at the contract
                if isinstance(c.get("endereco"), str):
                    cand = c["endereco"].strip()
                    if cand and "undefined" not in cand.lower():
                        endereco_raw = cand
                # 2) Dict at the contract
                if not endereco_raw and isinstance(c.get("endereco"), dict):
                    endereco_raw = _addr_from(c["endereco"])
                # 3) Flat keys at the contract
                if not endereco_raw:
                    endereco_raw = _addr_from(c)
                # 4) `enderecoInstalacao` (alternate field on some SGPs)
                if not endereco_raw and isinstance(c.get("enderecoInstalacao"), (str, dict)):
                    val = c.get("enderecoInstalacao")
                    endereco_raw = val.strip() if isinstance(val, str) else _addr_from(val)
                # 5) Fall back to the CLIENTE-level address (top-level data
                #    OR the matching item inside `clientes[]`).
                if not endereco_raw:
                    if isinstance(data.get("endereco"), str):
                        endereco_raw = data["endereco"].strip()
                    elif isinstance(data.get("endereco"), dict):
                        endereco_raw = _addr_from(data["endereco"])
                    elif isinstance(cli, dict):
                        endereco_raw = _addr_from(cli)
                if not endereco_raw:
                    endereco_raw = "Endereco nao informado"
                plano = (
                    c.get("planoInternet") or c.get("planointernet") or c.get("plano")
                    or c.get("planoNome") or c.get("plano_internet") or ""
                )
                label = f"Contrato {cid} ({status})" if cid else status
                # Concise one-line for buttons (max 20 chars per button title)
                title_btn = f"#{cid}" if cid else (status[:18] if status else "Contrato")
                contratos_lista.append({
                    "id": cid,
                    "value": cid,
                    "label": label,
                    "title": title_btn,
                    "status": status,
                    "endereco": endereco_raw,
                    "plano": plano,
                    "_raw": c,
                })
            out["contratos_lista"] = contratos_lista
            out["contratos_count"] = len(contratos_lista)
            # Numbered text menu (used by the "text" options_format and as
            # fallback for chat UIs that don't support interactive messages).
            # Format used: "[ N ] - Status: STATUS  |  Plano: PLAN  |  ENDERECO"
            # — single-line per contract so the picker stays scannable. We
            # only include parts that are populated; an SGP tenant that
            # returns no plano won't print a literal "Plano: undefined".
            def _fmt_contract_row(i: int, ci: dict) -> str:
                # 1-indexed display (operators complained that customers
                # naturally tap "1" for the first contract — not "0").
                # The flow's `_resolve_menu_choice` accepts both schemas.
                idx_label = i + 1
                cid = ci.get("id") or ""
                head = f"*[ {idx_label} ]* - *Contrato #{cid}*" if cid else f"*[ {idx_label} ]*"
                bits = [head]
                status = ci.get("status") or "—"
                bits.append(f"*Status:* {status}")
                plano = ci.get("plano")
                if plano:
                    bits.append(f"*Plano:* {plano}")
                end = ci.get("endereco")
                if end and "nao informado" not in end.lower():
                    # WhatsApp italic = surround in underscores. Used here
                    # for the address to give a "modern receipt" look.
                    bits.append(f"_{end}_")
                # Slash separator looks more "modern" than pipes for this
                # multi-line bullet.
                return " · ".join(bits)

            out["contratos_menu"] = "\n\n".join(
                _fmt_contract_row(i, ci) for i, ci in enumerate(contratos_lista)
            ) or ""
            # Cliente info: prefer wrapper, fall back to contrato fields
            out["nome_cliente"] = (
                cli.get("nome") or cli.get("razaosocial") or cli.get("razao_social")
                or ct.get("razaoSocial") or ct.get("razaosocial") or ct.get("nome") or ""
            )
            out["cpfcnpj_cliente"] = (
                cli.get("cpfcnpj") or cli.get("cnpj") or cli.get("cpf")
                or ct.get("cpfCnpj") or ct.get("cpfcnpj") or ""
            )
            emails = ct.get("emails") or []
            email_from_ct = emails[0] if isinstance(emails, list) and emails and isinstance(emails[0], str) else ""
            if isinstance(emails, list) and emails and isinstance(emails[0], dict):
                email_from_ct = emails[0].get("email") or ""
            out["email_cliente"] = cli.get("email") or email_from_ct or ""
            # Contrato info
            if ct:
                out["numero_contrato"] = str(
                    ct.get("contratoId") or ct.get("contrato") or ct.get("id") or ""
                )
                out["status_contrato"] = (
                    ct.get("contratoStatusDisplay") or ct.get("statusexibicao")
                    or ct.get("status") or ""
                )
                out["plano_cliente"] = (
                    ct.get("planoInternet") or ct.get("planointernet")
                    or ct.get("plano") or ct.get("planotelefonia") or ""
                )
                out["endereco_cliente"] = ct.get("endereco") or ""
                out["pop_cliente"] = ct.get("popNome") or ""
                out["valor_aberto"] = str(ct.get("contratoValorAberto") or "0")
                out["titulos_receber"] = ct.get("contratoTitulosAReceber") or 0
                out["link_quitacao"] = ct.get("link_quitacao") or ""
                out["clienteId"] = str(ct.get("clienteId") or "")
            # "Cliente encontrado" = SGP returned at least 1 contract OR a
            # client name. The msg field may vary in language; trust the data.
            out["cliente_encontrado"] = bool(
                out.get("numero_contrato") or out.get("nome_cliente") or contratos
            )
        elif action == "fatura2via":
            # Real SGP shape (verified):
            #   {"status":1, "razaoSocial":..., "links":[{"link":..., "linhadigitavel":..., "valor":..., "vencimento":..., "codigopix":..., "link_pix_html":...}],
            #    "link":..., "link_cobranca":..., "cpfCnpj":..., "contratoId":...}
            # Older/alt shape: {"faturas":[...]} or {"titulos":[...]}
            links = data.get("links") or data.get("faturas") or data.get("titulos") or []
            f = links[0] if (isinstance(links, list) and links and isinstance(links[0], dict)) else {}
            out["boleto_url"] = (
                f.get("link") or f.get("link_cobranca") or f.get("url") or f.get("linkboleto")
                or data.get("link") or data.get("link_cobranca") or ""
            )
            out["linha_digitavel"] = (
                f.get("linhadigitavel") or f.get("linha_digitavel")
                or data.get("linhadigitavel") or ""
            )
            out["valor_fatura"] = str(f.get("valor") or f.get("valor_original") or "")
            out["vencimento_fatura"] = (
                f.get("vencimento") or f.get("vencimento_original")
                or f.get("datavencimento") or ""
            )
            out["pix_copia_e_cola"] = f.get("codigopix") or f.get("pix_copia_e_cola") or ""
            # Several SGP tenants expose the Pix payment URL under different
            # field names — keep them ALL as aliases so the operator can use
            # whichever they're used to in their templates:
            #   {{link_pix}}        → SGP-native single-link
            #   {{link_pix_html}}   → SGP-native interactive page
            #   {{pix_qr_url}}      → our legacy alias
            link_pix = (
                f.get("link_pix") or f.get("linkPix") or data.get("link_pix") or ""
            )
            link_pix_html = (
                f.get("link_pix_html") or f.get("linkPixHtml")
                or data.get("link_pix_html") or ""
            )
            # When the SGP tenant doesn't expose `link_pix_html` (some
            # operators only return `codigopix` and the boleto URL), fall
            # back to the public payment page (`link_cobranca`) or the
            # boleto link so the customer ALWAYS receives something tappable
            # in the Pix message. This is what the customer originally
            # asked for: a public Pix link instead of the raw copia-e-cola
            # string — when SGP can't supply a Pix-specific URL, the
            # cobranca page still serves the QR code + copia-e-cola.
            if not link_pix_html:
                link_pix_html = (
                    f.get("link_cobranca") or data.get("link_cobranca")
                    or f.get("link") or data.get("link") or ""
                )
            out["link_pix"] = link_pix
            out["link_pix_html"] = link_pix_html
            out["pix_qr_url"] = link_pix_html or link_pix or ""
            out["fatura_protocolo"] = data.get("protocolo") or ""
            out["fatura_encontrada"] = bool(out.get("boleto_url") or out.get("linha_digitavel") or out.get("pix_copia_e_cola"))
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
            # Sanitize CPF/CNPJ-like params: SGP expects digits only. Customers
            # type "016.570.219-20", "(11) 99999-9999" etc — strip everything
            # that isn't a digit when the param name suggests a document/phone.
            digit_only_keys = {"cpfcnpj", "cpf", "cnpj", "telefone", "celular", "phone"}
            clean = {}
            for k, v in params.items():
                if k in digit_only_keys and isinstance(v, str):
                    clean[k] = re.sub(r"\D", "", v)
                else:
                    clean[k] = v
            params = clean
            payload = {**params, "token": cfg_doc["token"], "app": cfg_doc.get("app") or "8ip"}
            logger.info(f"[flow_engine] SGP call action={action} payload={ {k:('***' if k=='token' else v) for k,v in payload.items()} }")
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
    # If the operator has manually intervened on this ticket (sent a message
    # via the platform or the linked phone) AND the company has the "pause
    # bot on human intervention" setting enabled, the ticket carries the
    # flag `bot_paused=True`. In that state the engine must NOT keep
    # answering customer messages — the human is in control. The flag is
    # cleared only when the ticket is closed/reopened (or the operator
    # manually toggles it off; see crm_routes).
    if ticket.get("bot_paused"):
        logger.info(
            f"[flow_engine] ticket {ticket.get('id')} has bot_paused=true — "
            f"skipping flow advance (operator took over)"
        )
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
        """Send text outbound and persist as agent message. Honours dry_run.
        Crucially we SEND FIRST (capturing the Baileys message_id) and only
        then persist locally with that id stamped. This makes the outgoing
        echo from /webhook/message hit the dedup branch and prevents the
        same bot reply from showing up twice in the operator UI."""
        sent.append(text)
        if dry_run:
            return
        wa_msg_id = await _send_whatsapp(ticket, text)
        await _persist_outgoing(db, ticket["id"], text, flow_id,
                                wa_message_id=wa_msg_id)

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
            # ── Universal "Voltar" handler ──────────────────────────────────
            # We auto-append `[9] - Voltar ao menu anterior` to every menu
            # (unless the node config explicitly disables it). When the user
            # types "9" (or anything containing "voltar"), we rewind to the
            # menu they came from. The history is kept inside
            # `vars_["__menu_history"]` so it survives across hops.
            no_back = cfg.get("no_back") or cfg.get("hide_back")
            menu_has_explicit_9 = any(
                str(o.get("key") or "") == "9" for o in opts
            )
            reply_norm = (incoming_text or "").strip().lower()
            is_back_reply = (
                not no_back and not menu_has_explicit_9
                and reply_norm in {"9", "voltar", "menu anterior", "anterior"}
            )
            if is_back_reply:
                history = list(vars_.get("__menu_history") or [])
                target = None
                while history:
                    candidate = history.pop()
                    if candidate != prev_id and _node_by_id(nodes, candidate):
                        target = candidate
                        break
                vars_["__menu_history"] = history
                if target:
                    logger.info(f"[flow_engine] back-handler: rewinding from {prev_id} → {target}")
                    # Re-render the previous menu by saving state to its id
                    # and emitting its text again. We skip running it through
                    # the linear loop because that would re-trigger any HTTPs
                    # in between.
                    target_node = _node_by_id(nodes, target)
                    if target_node and _node_type(target_node) == "menu":
                        msg = _node_text(target_node, vars_)
                        if msg:
                            await _emit_and_persist(msg)
                        if not dry_run:
                            await _save_state(db, ticket["id"], flow_id, target, vars_)
                        return sent
                # No history — fall back to "re-prompt"
                logger.info(f"[flow_engine] back-handler: no history, re-prompting {prev_id}")
                txt = _node_text(prev, vars_) or "Voce ja esta no menu inicial."
                await _emit_and_persist(txt)
                return sent
            # Record the current menu in history BEFORE moving forward so a
            # later "voltar" can find it.
            history = list(vars_.get("__menu_history") or [])
            if not history or history[-1] != prev_id:
                history.append(prev_id)
                # cap at 10 entries to bound memory
                vars_["__menu_history"] = history[-10:]
            # If a dynamic_source is set, the user's reply will match the
            # dynamic items (button rowId / list rowId / typed number).
            dyn_src = cfg.get("dynamic_source") or ""
            dyn_items = vars_.get(dyn_src) if dyn_src else None
            if isinstance(dyn_items, list) and dyn_items:
                s = (incoming_text or "").strip()
                choice_idx = None
                # Exact match on `value` (rowId from buttons/list) — most common
                # path when client tapped a button.
                for i, it in enumerate(dyn_items):
                    val = str(it.get("value") or it.get("id") or "").strip()
                    if val and s == val:
                        choice_idx = i
                        break
                # Numeric idx (when client typed "1", "2", … in text mode).
                # The picker NOW renders contracts starting at 1 (operators
                # complained users naturally tap 1 for the first item, not 0).
                # We accept BOTH schemas so old links and the new display
                # keep working:
                #   typed "0" → idx=0
                #   typed "1" → idx=0 (1-based) OR idx=1 (0-based fallback)
                if choice_idx is None and s.isdigit():
                    idx_raw = int(s)
                    # Prefer 1-based when it falls inside the list.
                    if 1 <= idx_raw <= len(dyn_items):
                        choice_idx = idx_raw - 1
                    elif 0 <= idx_raw < len(dyn_items):
                        choice_idx = idx_raw
                if choice_idx is None:
                    logger.info(f"[flow_engine] menu {prev_id} (dynamic) got invalid reply {incoming_text!r}; re-prompting")
                    txt = _node_text(prev, vars_) or "Opção inválida. Tente novamente."
                    await _emit_and_persist(txt)
                    return sent
                # Capture the selected item into the variable so downstream
                # nodes can reference {{contrato_id}}, {{endereco}}, …
                picked = dyn_items[choice_idx]
                # Always expose the chosen contract's normalised fields
                vars_["contrato_id"] = str(picked.get("value") or picked.get("id") or "")
                if picked.get("status"):  vars_["contrato_status"] = picked.get("status")
                if picked.get("endereco"): vars_["contrato_endereco"] = picked.get("endereco")
                if picked.get("plano"):    vars_["contrato_plano"] = picked.get("plano")
                cap = cfg.get("capture_var")
                if cap:
                    vars_[cap] = vars_["contrato_id"]
                branch_handle = "option-default"
                logger.info(f"[flow_engine] menu {prev_id} (dynamic) resolved idx={choice_idx} contrato_id={vars_['contrato_id']!r}")
            else:
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
                # Validate against capture_format if set. Invalid input
                # keeps the flow paused and re-prompts (with optional
                # custom invalid message).
                fmt = cfg.get("capture_format")
                if fmt:
                    ok, default_err = validate_capture(incoming_text, fmt)
                    if not ok:
                        err = cfg.get("capture_invalid_message") or default_err
                        logger.info(f"[flow_engine] node {prev_id} capture_format={fmt!r} REJECTED {incoming_text!r}; re-prompting")
                        await _emit_and_persist(err)
                        # Re-emit the original prompt so customer sees the question again.
                        prompt_txt = _node_text(prev, vars_)
                        if prompt_txt:
                            await _emit_and_persist(prompt_txt)
                        # Stay on the same node, do NOT advance.
                        if not dry_run:
                            await _save_state(db, ticket["id"], flow_id, prev_id, vars_)
                        return sent
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
            cfg_msg = (node.get("data") or {}).get("config") or {}
            capture = cfg_msg.get("capture_var")
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
            # If this message asks for an input (capture_var set), PAUSE here
            # waiting for the customer's reply. Without this, the engine would
            # rush through the SGP HTTP call with an empty placeholder.
            if capture:
                pending_node_id = current_id
                current_id = None
                logger.info(f"[flow_engine] message {pending_node_id} has capture_var={capture!r}; pausing for customer reply")
                break
            edge = _next_edge(edges, current_id)
            current_id = edge["target"] if edge else None
            continue

        if nt == "menu":
            cfg_menu = (node.get("data") or {}).get("config") or {}
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
            # ─── Render format: text | buttons | list ──────────────────
            # Operators choose via cfg.options_format. If a `dynamic_source`
            # variable name is set (e.g. "contratos_lista"), the menu pulls
            # its options from the SGP-flattened list at runtime; otherwise
            # falls back to cfg.options (operator-defined static items).
            options_format = (cfg_menu.get("options_format") or "text").lower()
            dynamic_source = cfg_menu.get("dynamic_source") or ""
            dynamic_items = []
            if dynamic_source and isinstance(vars_.get(dynamic_source), list):
                dynamic_items = vars_[dynamic_source]
            static_items = cfg_menu.get("options") or []
            options_items = dynamic_items or static_items

            # Friendly fallback when the menu has a dynamic source but the
            # upstream (typically SGP /consultacliente) returned nothing.
            if dynamic_source and not dynamic_items and not static_items:
                friendly = (
                    "Nao localizei contratos vinculados ao CPF/CNPJ informado. "
                    "Verifique o numero digitado e tente novamente, ou escolha "
                    "*Falar com atendente* enviando \"4\"."
                )
                await _emit_and_persist(friendly)
                if not dry_run:
                    await _save_state(db, ticket["id"], flow_id, None, vars_)
                return sent

            # PLAIN TEXT ONLY.
            #
            # WhatsApp's interactive payload (buttons/list) gets silently
            # filtered for some Baileys-attached senders — specifically the
            # Web Fibra account we're integrating with. The customer's screen
            # renders an EMPTY bubble where the buttons would have been, and
            # the followup numeric text is sent right after. End-user
            # experience: a confusing blank bubble.
            #
            # Numbered text works on EVERY WhatsApp client, every account
            # type, every region. We commit to text — the `options_format`
            # field in the operator UI is now treated as a visual hint only.
            _ = options_items  # silence linter; we may use it for richer
            # validation later (e.g. limit options to 9 so single-digit reply
            # works) but for now the rendering is fully delegated to
            # `_node_text` which appends "key. label" lines.
            await _emit_and_persist(text)
            pending_node_id = current_id
            current_id = None
            logger.info(f"[flow_engine] menu {pending_node_id} posted (plain text; fmt hint was {options_format!r}); waiting for customer reply")
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
    so the customer doesn't get stuck if the flow gets edited or removed.
    A ticket flagged `bot_paused=True` (operator intervened, see
    `pause_bot_on_human_intervention` company setting) is reported as NOT
    active so the webhook stops invoking advance_flow for it."""
    if ticket.get("bot_paused"):
        return False
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
