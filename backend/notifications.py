"""
Sends WhatsApp confirmation messages to client and professional when an
appointment is created. Uses the 'confirmacao' template from the company's
message templates if available. Auto-tags the appointment as 'confirmado'
once the message is dispatched (user's product decision).
"""
import os
import logging
import re
from typing import Optional

import httpx
from motor.motor_asyncio import AsyncIOMotorDatabase

logger = logging.getLogger(__name__)

WA_SERVICE_URL = os.environ.get("WA_SERVICE_URL", "http://localhost:3002")

# Aliases to make templates forgiving: users often write {nome} instead of
# {{nome_cliente}}, {servico} instead of {{servico}}, etc.
VAR_ALIASES = {
    "nome": "nome_cliente",
    "cliente": "nome_cliente",
    "profissional": "nome_profissional",
    "barbeiro": "nome_profissional",
    "funcionario": "nome_profissional",
    "servico": "servico",
    "produto": "servico",
    "data": "data",
    "hora": "hora",
    "empresa": "empresa",
    "link_cancelar": "link_cancelar",
    "link": "link_cancelar",
}


def render_template(template: str, variables: dict) -> str:
    """Replace {var} and {{var}} placeholders with actual values.
    Accepts both single and double braces (users often save templates with single
    braces) and applies alias map so short names work too.
    """
    if not template:
        return ""
    vars_map = dict(variables or {})
    # Add alias-based keys so {nome} resolves to nome_cliente, etc.
    for alias, real in VAR_ALIASES.items():
        if alias not in vars_map and real in vars_map:
            vars_map[alias] = vars_map[real]

    def _replace(match):
        key = match.group(1).strip()
        return str(vars_map.get(key, match.group(0)))

    # 1) Double-brace {{var}}
    out = re.sub(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}", _replace, template)
    # 2) Single-brace {var} (only if no braces inside)
    out = re.sub(r"(?<!\{)\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}(?!\})", _replace, out)
    return out


async def _get_active_whatsapp_conn(db: AsyncIOMotorDatabase, company_id: str) -> Optional[dict]:
    return await db.channel_connections.find_one(
        {"company_id": company_id, "type": "whatsapp", "status": "connected"},
        {"_id": 0}
    )


def _normalize_br_phone(phone: str) -> str:
    """Normalize a Brazilian phone number to E.164 digits (55DD9XXXXXXXX).

    Accepts inputs like '(62) 99432-0308', '62994320308', '5562994320308'.
    Adds the country code 55 when missing. Returns digits only (no +).
    """
    digits = "".join(c for c in (phone or "") if c.isdigit())
    if not digits:
        return ""
    # Already E.164 Brazil (12 or 13 digits starting with 55)
    if digits.startswith("55") and len(digits) in (12, 13):
        return digits
    # Local BR format: 10 digits (DDD + 8) or 11 digits (DDD + 9)
    if len(digits) in (10, 11):
        return "55" + digits
    # Unknown format -> return as-is; Baileys will reject if invalid
    return digits


async def _send_via_baileys(conn_id: str, phone: str, message: str) -> bool:
    """Send message via the Node Baileys microservice. Fire-and-forget.
    Returns True only when the microservice confirms the message was dispatched.
    """
    if not phone or not message:
        return False
    clean = _normalize_br_phone(phone)
    if not clean:
        return False
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(
                f"{WA_SERVICE_URL}/instances/{conn_id}/send",
                json={"phone": clean, "message": message}
            )
            if r.status_code >= 400:
                logger.warning(
                    f"[notify] WA send HTTP {r.status_code} to {clean}: {r.text[:200]}"
                )
                return False
            return True
    except Exception as e:
        logger.warning(f"[notify] WA send exception to {clean}: {e}")
        return False


async def notify_appointment_created(
    db: AsyncIOMotorDatabase,
    company_id: str,
    appointment: dict,
    base_url: str = "",
    company_slug: str = "",
) -> bool:
    """Send confirmation to client + professional. Returns True if at least one
    message was dispatched, which allows caller to auto-tag the appointment.
    """
    conn = await _get_active_whatsapp_conn(db, company_id)
    if not conn:
        logger.warning(
            f"[notify] No CONNECTED WhatsApp instance for company={company_id}. "
            f"Appointment {appointment.get('id')} WON'T receive confirmation. "
            f"Admin must connect WhatsApp in the Conexoes page."
        )
        return False

    # Verify the remote Baileys actually reports this instance as connected
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            r = await client.get(f"{WA_SERVICE_URL}/instances/{conn['id']}/status")
            if r.status_code == 200:
                st = r.json() or {}
                if not st.get("connected"):
                    logger.warning(
                        f"[notify] DB says connected but Baileys reports status={st.get('status')} "
                        f"for conn={conn['id']} (company={company_id}). Skipping send."
                    )
                    return False
    except Exception as e:
        logger.info(f"[notify] Could not verify remote status ({e}); will try send anyway")

    # Load templates
    tmpls = await db.message_templates.find(
        {"company_id": company_id, "process_key": {"$in": ["confirmacao"]}, "active": True},
        {"_id": 0}
    ).to_list(10)
    template_msg = None
    if tmpls:
        template_msg = tmpls[0].get("message")

    # Company info
    company = await db.companies.find_one({"id": company_id}, {"_id": 0, "name": 1})
    company_name = (company or {}).get("name", "")

    # Build cancel link
    cancel_link = ""
    if base_url and company_slug:
        cancel_link = f"{base_url.rstrip('/')}/{company_slug}/agenda?phone={appointment.get('customer_phone','')}"

    # Default messages if no template configured
    date_pt = appointment.get("date", "")
    try:
        y, m, d = date_pt.split("-")
        date_pt = f"{d}/{m}/{y}"
    except Exception:
        pass

    client_vars = {
        "nome_cliente": appointment.get("customer_name", ""),
        "nome_profissional": appointment.get("professional_name", ""),
        "servico": appointment.get("service_name", ""),
        "data": date_pt,
        "hora": appointment.get("time", ""),
        "empresa": company_name,
        "link_cancelar": cancel_link,
    }

    default_client_msg = (
        f"Ola *{client_vars['nome_cliente']}*! 😊\n\n"
        f"Seu agendamento foi confirmado na *{company_name}*:\n"
        f"📅 {date_pt} as {client_vars['hora']}\n"
        f"💇 {client_vars['servico']}\n"
        f"👤 com {client_vars['nome_profissional']}\n\n"
        f"Te esperamos! Se precisar cancelar acesse: {cancel_link}"
    )
    client_msg = render_template(template_msg, client_vars) if template_msg else default_client_msg

    # Professional message (always auto-gen)
    prof_msg = (
        f"Novo agendamento! 📅\n\n"
        f"Cliente: {appointment.get('customer_name')}\n"
        f"Telefone: {appointment.get('customer_phone')}\n"
        f"Servico: {appointment.get('service_name')}\n"
        f"Data: {date_pt} as {appointment.get('time')}"
    )

    # Get professional phone
    prof = await db.professionals.find_one(
        {"id": appointment.get("professional_id")}, {"_id": 0, "phone": 1, "name": 1}
    )
    prof_phone = (prof or {}).get("phone")

    sent_any = False
    # To client
    if appointment.get("customer_phone"):
        sent_any = await _send_via_baileys(conn["id"], appointment["customer_phone"], client_msg) or sent_any
    # To professional
    if prof_phone:
        await _send_via_baileys(conn["id"], prof_phone, prof_msg)

    return sent_any
