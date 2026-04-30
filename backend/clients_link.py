"""Find-or-create helper that links a ticket to a real Client (cliente/lead).

A Ticket carries denormalized customer_name/phone/email so the chat can
render fast, but the source of truth for client data (CPF, CNPJ, address,
etc.) lives in the `clients` collection. This module bridges both.
"""
from datetime import datetime, timezone
import re
import uuid

from motor.motor_asyncio import AsyncIOMotorDatabase


def normalize_phone(p: str | None) -> str:
    """Strip everything that is not a digit. Empty string for falsy input."""
    if not p:
        return ""
    return re.sub(r"\D+", "", p)


async def find_or_create_client_by_phone(
    db: AsyncIOMotorDatabase,
    company_id: str,
    phone: str,
    name: str | None = None,
    email: str | None = None,
) -> str | None:
    """Returns the client id matching the phone (digits-only) within the
    company. Creates a minimal client doc when none exists.

    Returns None when phone is empty (we cannot match without a phone).
    """
    digits = normalize_phone(phone)
    if not digits:
        return None

    # Match against any client whose stored phone digits-only equal `digits`.
    # We keep the original phone format on the client doc; matching is done
    # client-side because Mongo can't run a regex transform.
    cursor = db.clients.find(
        {"company_id": company_id},
        {"_id": 0, "id": 1, "phone": 1}
    )
    async for c in cursor:
        if normalize_phone(c.get("phone")) == digits:
            return c["id"]

    # Not found — create a minimal record. Ticket-derived clients get the
    # phone exactly as it came from the channel; the user can fill the rest
    # later via the contact panel.
    cid = str(uuid.uuid4())
    await db.clients.insert_one({
        "id": cid,
        "company_id": company_id,
        "name": (name or phone or "").strip(),
        "phone": phone,
        "email": email,
        "person_type": "fisica",
        "total_appointments": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_via": "ticket",
    })
    return cid
