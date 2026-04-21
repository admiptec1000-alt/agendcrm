"""
Sends WhatsApp confirmation messages to client and professional when an
appointment is created. Uses the 'confirmacao' template from the company's
message templates if available. Auto-tags the appointment as 'confirmado'
once the message is dispatched (user's product decision).
"""
import os
import logging
from typing import Optional

import httpx
from motor.motor_asyncio import AsyncIOMotorDatabase

logger = logging.getLogger(__name__)

WA_SERVICE_URL = os.environ.get("WA_SERVICE_URL", "http://localhost:3002")


def render_template(template: str, variables: dict) -> str:
    """Replace {{var}} placeholders with actual values."""
    if not template:
        return ""
    out = template
    for k, v in (variables or {}).items():
        out = out.replace(f"{{{{{k}}}}}", str(v if v is not None else ""))
    return out


async def _get_active_whatsapp_conn(db: AsyncIOMotorDatabase, company_id: str) -> Optional[dict]:
    return await db.channel_connections.find_one(
        {"company_id": company_id, "type": "whatsapp", "status": "connected"},
        {"_id": 0}
    )


async def _send_via_baileys(conn_id: str, phone: str, message: str):
    """Send message via the Node Baileys microservice. Fire-and-forget."""
    if not phone or not message:
        return False
    # Normalize phone: keep digits only
    clean = "".join(c for c in phone if c.isdigit())
    if not clean:
        return False
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                f"{WA_SERVICE_URL}/instances/{conn_id}/send",
                json={"phone": clean, "message": message}
            )
        return True
    except Exception as e:
        logger.warning(f"WhatsApp send failed to {clean}: {e}")
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
        logger.info(f"[notify] No active WhatsApp for company={company_id}")
        return False

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
