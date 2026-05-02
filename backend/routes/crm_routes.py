from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from database import get_database
from auth import get_current_user
from models import (
    TicketCreate, TicketUpdate, MessageCreate, QuickResponseCreate,
    CampaignCreate, CampaignUpdate, FlowCreate, FlowUpdate, AIChatRequest, AIChatResponse,
    TicketStatus
)
import uuid
from datetime import datetime, timezone
from typing import List, Optional, Any
from emergentintegrations.llm.chat import LlmChat, UserMessage
import os
from pydantic import BaseModel
from counters import next_ticket_number
from clients_link import find_or_create_client_by_phone

router = APIRouter(prefix="/crm", tags=["crm"])

def _user_can_view_all_tickets(user: dict) -> bool:
    """Returns True if the user is allowed to see EVERY ticket in the
    company. Otherwise the user only sees:
      (a) tickets currently assigned to them (`assigned_to == user.id`)
      (b) unassigned tickets in the first kanban column (status='aberto'
          AND `assigned_to` is null) — these are the public pool. As soon
          as another user CLAIMS one of these (POST /tickets/{id}/claim),
          it disappears from this user's listings.
    The permission is granted by either:
      - role (super_admin / company_admin) — implicit
      - explicit `view_all_tickets` flag in `user.permissions` (per-user toggle)
    """
    role = (user.get("role") or "").lower()
    if role in ("super_admin", "superadmin", "company_admin"):
        return True
    perms = user.get("permissions") or []
    return "view_all_tickets" in perms


def _ticket_visibility_filter(user: dict) -> dict:
    """Mongo `$or` clause to enforce the visibility rules above. Returns an
    empty dict (no filter) for users with the view-all permission."""
    if _user_can_view_all_tickets(user):
        return {}
    uid = user["id"]
    return {
        "$or": [
            {"assigned_to": uid},
            {"assigned_to": None, "status": "aberto"},
            {"assigned_to": {"$exists": False}, "status": "aberto"},
        ]
    }


# Tickets
@router.get("/tickets")
async def list_tickets(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
    status: str = None,
    assigned_to: str = None,
    channel: str = None,
    search: str = None,
    tab: str = None
):
    query = {"company_id": user["company_id"]}
    if status:
        query["status"] = status
    if assigned_to:
        query["assigned_to"] = assigned_to
    if channel:
        query["channel"] = channel
    if search:
        query["$or"] = [
            {"customer_name": {"$regex": search, "$options": "i"}},
            {"customer_phone": {"$regex": search, "$options": "i"}},
        ]
    if tab == "atendendo":
        query["status"] = {"$in": ["aberto", "em_cobranca", "proposta"]}
    elif tab == "aguardando":
        query["status"] = {"$in": ["pago", "bloqueado"]}

    # Visibility: non-admin users only see their own tickets + the
    # unassigned-aberto pool. Admins / view_all_tickets see everything.
    vis_filter = _ticket_visibility_filter(user)
    if vis_filter:
        # If a `$or` already exists (from `search`), combine via $and
        if "$or" in query:
            existing_or = query.pop("$or")
            query["$and"] = [{"$or": existing_or}, vis_filter]
        else:
            query.update(vis_filter)

    tickets = await db.tickets.find(query, {"_id": 0}).sort("updated_at", -1).to_list(1000)
    return tickets

@router.get("/tickets/counts")
async def get_ticket_counts(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    company_id = user["company_id"]
    base = {"company_id": company_id}
    vis = _ticket_visibility_filter(user)
    if vis:
        base = {**base, **vis}
    atendendo = await db.tickets.count_documents({**base, "status": {"$in": ["aberto", "em_cobranca", "proposta"]}})
    aguardando = await db.tickets.count_documents({**base, "status": {"$in": ["pago", "bloqueado"]}})
    total = await db.tickets.count_documents(base)
    return {"atendendo": atendendo, "aguardando": aguardando, "total": total}


@router.get("/tickets/{ticket_id}")
async def get_ticket(
    ticket_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    ticket = await db.tickets.find_one(
        {"id": ticket_id, "company_id": user["company_id"]}, {"_id": 0}
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket nao encontrado")
    return ticket

@router.post("/tickets")
async def create_ticket(
    data: TicketCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    ticket_id = str(uuid.uuid4())
    ticket_number = await next_ticket_number(db, user["company_id"])
    client_id = await find_or_create_client_by_phone(
        db, user["company_id"], data.customer_phone,
        name=data.customer_name, email=data.customer_email
    )
    ticket = {
        "id": ticket_id,
        "ticket_number": ticket_number,
        "company_id": user["company_id"],
        "client_id": client_id,
        "customer_name": data.customer_name,
        "customer_phone": data.customer_phone,
        "customer_email": data.customer_email,
        "status": data.status,
        "priority": data.priority,
        "channel": data.channel,
        "description": data.description,
        "assigned_to": None,
        "messages": [],
        "tags": data.tags or [],
        "value": float(data.value or 0),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    await db.tickets.insert_one(ticket)
    return {k: v for k, v in ticket.items() if k != "_id"}

@router.put("/tickets/{ticket_id}")
async def update_ticket(
    ticket_id: str,
    data: TicketUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    ticket = await db.tickets.find_one({"id": ticket_id, "company_id": user["company_id"]})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket não encontrado")

    raw = data.model_dump(exclude_unset=True)
    # Fields where an explicit null means "clear this value" (not "ignore").
    CLEARABLE_FIELDS = {"kanban_column_id", "queue_id", "connection_id", "assigned_to"}
    update_data = {
        k: v for k, v in raw.items()
        if v is not None or k in CLEARABLE_FIELDS
    }
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    
    if update_data:
        await db.tickets.update_one(
            {"id": ticket_id},
            {"$set": update_data}
        )
    
    updated_ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    return updated_ticket

@router.delete("/tickets/{ticket_id}")
async def delete_ticket(
    ticket_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    result = await db.tickets.delete_one({"id": ticket_id, "company_id": user["company_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Ticket nao encontrado")
    return {"deleted": True}


@router.post("/tickets/{src_id}/merge-into/{dst_id}")
async def merge_tickets(
    src_id: str,
    dst_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    """Merges the SOURCE ticket into the DESTINATION ticket and deletes the source.

    Useful when WhatsApp Linked Devices (@lid) create a duplicate ticket with a
    fake phone number. The admin identifies the real ticket, picks the merge
    action on the duplicate, and this endpoint:

      1. Appends all messages from src into dst (deduped by wa_message_id)
      2. Carries over tags that dst doesn't already have
      3. Preserves dst's ticket_number / kanban_column_id / client_id
      4. Deletes the src ticket

    The destination always wins on single-valued fields; only messages/tags
    are additive. Multi-tenant safe (both must belong to the caller's company).
    """
    if src_id == dst_id:
        raise HTTPException(400, "Ticket de origem e destino sao o mesmo")
    company_id = user["company_id"]
    src = await db.tickets.find_one({"id": src_id, "company_id": company_id})
    dst = await db.tickets.find_one({"id": dst_id, "company_id": company_id})
    if not src or not dst:
        raise HTTPException(404, "Ticket de origem ou destino nao encontrado")

    src_msgs = src.get("messages") or []
    existing_wa_ids = {m.get("wa_message_id") for m in (dst.get("messages") or []) if m.get("wa_message_id")}
    new_msgs = [m for m in src_msgs if not (m.get("wa_message_id") and m.get("wa_message_id") in existing_wa_ids)]

    # Merge tags (unique by tag id/name)
    dst_tags = dst.get("tags") or []
    dst_tag_keys = {(t.get("id") or t.get("name")) for t in dst_tags}
    new_tags = [t for t in (src.get("tags") or []) if (t.get("id") or t.get("name")) not in dst_tag_keys]

    update = {}
    if new_msgs:
        update["$push"] = {"messages": {"$each": new_msgs}}
    set_fields = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if new_tags:
        # Use $addToSet style via combined array to preserve ordering
        set_fields["tags"] = dst_tags + new_tags
    update["$set"] = set_fields

    await db.tickets.update_one({"id": dst_id, "company_id": company_id}, update)
    await db.tickets.delete_one({"id": src_id, "company_id": company_id})

    # Re-point any quotes that were attached to the src ticket to dst
    await db.quotes.update_many(
        {"ticket_id": src_id, "company_id": company_id},
        {"$set": {"ticket_id": dst_id}}
    )

    return {
        "merged": True,
        "into_ticket_id": dst_id,
        "into_ticket_number": dst.get("ticket_number"),
        "messages_added": len(new_msgs),
        "tags_added": len(new_tags),
    }


class ResolveLidRequest(BaseModel):
    real_phone: str


@router.post("/tickets/{ticket_id}/claim")
async def claim_ticket(
    ticket_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Operator pulls (puxa) a ticket from the unassigned-aberto pool.
    From this moment on, the ticket disappears from EVERY other operator's
    list (unless they have `view_all_tickets`). Idempotent: re-claiming
    a ticket already assigned to the caller is a no-op success."""
    ticket = await db.tickets.find_one({"id": ticket_id, "company_id": user["company_id"]})
    if not ticket:
        raise HTTPException(404, "Ticket nao encontrado")
    current = ticket.get("assigned_to")
    if current and current != user["id"] and not _user_can_view_all_tickets(user):
        # Another operator already owns it AND we don't have view-all rights.
        raise HTTPException(409, "Atendimento ja foi puxado por outro operador")
    await db.tickets.update_one(
        {"id": ticket_id},
        {"$set": {"assigned_to": user["id"], "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    return await db.tickets.find_one({"id": ticket_id}, {"_id": 0})


@router.post("/tickets/{ticket_id}/release")
async def release_ticket(
    ticket_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Returns a claimed ticket back to the public pool (sets `assigned_to`
    to null). Only the current owner OR an admin can release. Used when
    the operator realises another colleague is better-suited for the case."""
    ticket = await db.tickets.find_one({"id": ticket_id, "company_id": user["company_id"]})
    if not ticket:
        raise HTTPException(404, "Ticket nao encontrado")
    current = ticket.get("assigned_to")
    if current and current != user["id"] and not _user_can_view_all_tickets(user):
        raise HTTPException(403, "Apenas o atendente atual ou um admin pode liberar este atendimento")
    await db.tickets.update_one(
        {"id": ticket_id},
        {"$set": {"assigned_to": None, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    return await db.tickets.find_one({"id": ticket_id}, {"_id": 0})


@router.post("/tickets/{ticket_id}/resolve-lid")
async def resolve_ticket_lid(
    ticket_id: str,
    body: ResolveLidRequest,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
):
    """Manual fallback for hidden-number contacts (`pending_lid_resolution=True`).

    The operator obtains the real phone via voice/email/business card and
    submits it here. Same merge logic as `/channels/webhook/lid-resolved`:
    if another open ticket already exists for the real phone, messages are
    merged into that one and the LID-only ticket is deleted; otherwise the
    LID ticket is promoted to the real phone in place.
    """
    ticket = await db.tickets.find_one({"id": ticket_id, "company_id": user["company_id"]})
    if not ticket:
        raise HTTPException(404, "Ticket nao encontrado")
    if not ticket.get("lid_jid"):
        raise HTTPException(400, "Este ticket nao tem numero oculto pendente")
    # Reuse the same logic from the webhook handler so behavior is identical
    from routes.channels_routes import _apply_lid_resolution
    result = await _apply_lid_resolution(db, user["company_id"], ticket["lid_jid"], body.real_phone)
    if not result.get("updated"):
        raise HTTPException(400, f"Nao foi possivel resolver: {result.get('reason')}")
    return result


@router.get("/clients/{client_id}/timeline")
async def get_client_timeline(
    client_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database),
    limit: int = 50,
):
    """360° view of a client: full ticket history + summary stats.

    Returns tickets ordered by created_at desc plus aggregated stats so the
    chat sidebar can render a single panel without N+1 queries.
    """
    company_id = user["company_id"]

    # Verify the client belongs to this tenant
    client = await db.clients.find_one(
        {"id": client_id, "company_id": company_id}, {"_id": 0}
    )
    if not client:
        raise HTTPException(status_code=404, detail="Cliente nao encontrado")

    cursor = db.tickets.find(
        {"company_id": company_id, "client_id": client_id},
        {"_id": 0, "id": 1, "ticket_number": 1, "status": 1, "value": 1,
         "channel": 1, "created_at": 1, "closed_at": 1, "updated_at": 1,
         "customer_name": 1, "tags": 1, "rating": 1, "kanban_column_id": 1},
    ).sort("created_at", -1).limit(limit)
    tickets = await cursor.to_list(limit)

    # Stats are computed over the FULL history (independent from the paginated
    # tickets array) so values stay correct on high-volume clients.
    pipeline = [
        {"$match": {"company_id": company_id, "client_id": client_id}},
        {"$group": {
            "_id": None,
            "total_tickets": {"$sum": 1},
            "open": {"$sum": {"$cond": [
                {"$not": {"$in": ["$status", ["fechado", "cancelado"]]}}, 1, 0
            ]}},
            "closed": {"$sum": {"$cond": [{"$eq": ["$status", "fechado"]}, 1, 0]}},
            "total_value": {"$sum": {"$ifNull": ["$value", 0]}},
            "last_visit": {"$max": "$created_at"},
        }},
    ]
    agg = await db.tickets.aggregate(pipeline).to_list(1)
    s = agg[0] if agg else {"total_tickets": 0, "open": 0, "closed": 0, "total_value": 0, "last_visit": None}
    total = s.get("total_tickets") or 0
    total_value = float(s.get("total_value") or 0)
    avg_value = (total_value / total) if total else 0.0

    return {
        "client": client,
        "stats": {
            "total_tickets": total,
            "open": s.get("open") or 0,
            "closed": s.get("closed") or 0,
            "total_value": total_value,
            "avg_value": avg_value,
            "last_visit": s.get("last_visit"),
        },
        "tickets": tickets,
    }



@router.get("/tickets/{ticket_id}/client")
async def get_ticket_client(
    ticket_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    """Returns the linked client (cliente/lead). When the ticket has no
    client_id yet (legacy), tries to match by phone and links it lazily.
    """
    ticket = await db.tickets.find_one(
        {"id": ticket_id, "company_id": user["company_id"]}, {"_id": 0}
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket nao encontrado")

    cid = ticket.get("client_id")
    if not cid:
        cid = await find_or_create_client_by_phone(
            db, user["company_id"],
            ticket.get("customer_phone", ""),
            name=ticket.get("customer_name"),
            email=ticket.get("customer_email"),
        )
        if cid:
            await db.tickets.update_one({"id": ticket_id}, {"$set": {"client_id": cid}})

    if not cid:
        # No phone, no lead yet — return a stub the frontend can fill.
        return {
            "id": None,
            "name": ticket.get("customer_name", ""),
            "phone": ticket.get("customer_phone", ""),
            "email": ticket.get("customer_email", ""),
            "person_type": "fisica",
        }
    client = await db.clients.find_one({"id": cid, "company_id": user["company_id"]}, {"_id": 0})
    return client or {"id": cid}


@router.put("/tickets/{ticket_id}/client")
async def update_ticket_client(
    ticket_id: str,
    payload: dict,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    """Updates (or creates) the linked client and refreshes denormalized
    customer_* fields on the ticket so the chat header stays in sync.
    """
    ticket = await db.tickets.find_one({"id": ticket_id, "company_id": user["company_id"]})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket nao encontrado")

    cid = ticket.get("client_id")
    company_id = user["company_id"]

    # Whitelist the fields a chat operator can edit on the linked client
    ALLOWED = {
        "name", "phone", "email", "person_type", "cpf", "cnpj",
        "company_name", "cep", "address", "city", "state",
        "birth_date", "notes",
    }
    fields = {k: v for k, v in (payload or {}).items() if k in ALLOWED}

    if not cid:
        # First save creates the client document
        if not fields.get("phone"):
            fields["phone"] = ticket.get("customer_phone", "")
        if not fields.get("name"):
            fields["name"] = ticket.get("customer_name") or fields.get("phone") or "Cliente"
        cid = str(uuid.uuid4())
        await db.clients.insert_one({
            "id": cid, "company_id": company_id,
            "person_type": fields.get("person_type") or "fisica",
            "total_appointments": 0,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "created_via": "ticket_panel",
            **fields,
        })
    else:
        if fields:
            await db.clients.update_one(
                {"id": cid, "company_id": company_id}, {"$set": fields}
            )

    # Sync denormalized fields on the ticket so the chat header stays correct.
    sync = {"updated_at": datetime.now(timezone.utc).isoformat(), "client_id": cid}
    if "name" in fields:
        sync["customer_name"] = fields["name"]
    if "phone" in fields:
        sync["customer_phone"] = fields["phone"]
    if "email" in fields:
        sync["customer_email"] = fields["email"]
    await db.tickets.update_one({"id": ticket_id}, {"$set": sync})

    client = await db.clients.find_one({"id": cid, "company_id": company_id}, {"_id": 0})
    return client

@router.post("/tickets/{ticket_id}/messages")
async def add_message_to_ticket(
    ticket_id: str,
    data: MessageCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    ticket = await db.tickets.find_one({"id": ticket_id, "company_id": user["company_id"]})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket não encontrado")
    
    message = {
        "id": str(uuid.uuid4()),
        "content": data.content,
        "sender_type": data.sender_type,
        "sender_id": user["id"],
        "sender_name": user["name"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "delivery_status": "pending",
    }

    # If agent and channel is whatsapp, actually send via Baileys
    delivery_error = None
    if data.sender_type == "agent" and ticket.get("channel") == "whatsapp" and ticket.get("customer_phone"):
        try:
            import httpx
            import os as _os
            import logging as _lg
            _log = _lg.getLogger(__name__)
            wa_url = _os.environ.get("WA_SERVICE_URL", "http://localhost:3002")
            # Prefer ticket's bound connection, fall back to first connected
            conn_id = ticket.get("connection_id")
            if not conn_id:
                conn = await db.channel_connections.find_one(
                    {"company_id": user["company_id"], "type": "whatsapp", "status": "connected"},
                    {"_id": 0, "id": 1}
                )
                conn_id = conn["id"] if conn else None
            # Hidden-number contacts (LID-only): WhatsApp won't accept the
            # raw LID digits via onWhatsApp() — the only address that works
            # is the original `XXX@lid` JID. The microservice's /send
            # endpoint already passes through any value containing `@`
            # straight to sendMessage (no JID resolution), so we just send
            # the lid_jid as `phone`.
            target_phone = ticket["customer_phone"]
            if ticket.get("pending_lid_resolution") and ticket.get("lid_jid"):
                target_phone = ticket["lid_jid"]
            if conn_id:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    resp = await client.post(
                        f"{wa_url}/instances/{conn_id}/send",
                        json={"phone": target_phone, "message": data.content}
                    )
                    try:
                        res = resp.json()
                    except Exception:
                        res = {}
                    if resp.status_code == 200 and res.get("success"):
                        message["delivery_status"] = "sent"
                        message["wa_message_id"] = res.get("jid")
                    else:
                        message["delivery_status"] = "failed"
                        delivery_error = res.get("error") or f"HTTP {resp.status_code}: {resp.text[:80]}"
                        _log.warning(f"WA send failed for ticket {ticket_id}: {delivery_error}")
            else:
                message["delivery_status"] = "failed"
                delivery_error = "Nenhuma conexao WhatsApp ativa"
        except Exception as e:
            message["delivery_status"] = "failed"
            delivery_error = str(e)[:200]

    if delivery_error:
        message["delivery_error"] = delivery_error

    update_set = {"updated_at": datetime.now(timezone.utc).isoformat()}
    # Track last outgoing for the @lid fallback in the webhook handler.
    # When an incoming message arrives later with a fake LID phone, the
    # webhook resolves the destination ticket by looking up the most
    # recent outgoing on the same company (5-min window).
    if (
        data.sender_type == "agent"
        and ticket.get("channel") == "whatsapp"
        and message.get("delivery_status") == "sent"
    ):
        update_set["last_outgoing_at"] = update_set["updated_at"]
        # Bind the connection_id to the ticket if it wasn't already
        # (manual-created tickets often start without one). The ticket
        # remembers which connection it lives on, helping the webhook
        # match incoming replies even when the user replies via @lid.
        if not ticket.get("connection_id") and conn_id:
            update_set["connection_id"] = conn_id

    await db.tickets.update_one(
        {"id": ticket_id},
        {"$push": {"messages": message}, "$set": update_set}
    )

    return message


# === TICKET TAGS ===
class TicketTagToggle(BaseModel):
    tag: str


@router.post("/tickets/{ticket_id}/tags/add")
async def add_tag_to_ticket(
    ticket_id: str,
    data: TicketTagToggle,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    res = await db.tickets.update_one(
        {"id": ticket_id, "company_id": user["company_id"]},
        {"$addToSet": {"tags": data.tag}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Ticket nao encontrado")
    return await db.tickets.find_one({"id": ticket_id}, {"_id": 0})


@router.post("/tickets/{ticket_id}/tags/remove")
async def remove_tag_from_ticket(
    ticket_id: str,
    data: TicketTagToggle,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    res = await db.tickets.update_one(
        {"id": ticket_id, "company_id": user["company_id"]},
        {"$pull": {"tags": data.tag}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Ticket nao encontrado")
    return await db.tickets.find_one({"id": ticket_id}, {"_id": 0})

# Kanban
@router.get("/kanban")
async def get_kanban(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    query = {"company_id": user["company_id"]}
    vis = _ticket_visibility_filter(user)
    if vis:
        query.update(vis)
    tickets = await db.tickets.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    
    kanban = {
        TicketStatus.EM_COBRANCA: [],
        TicketStatus.PAGO: [],
        TicketStatus.BLOQUEADO: [],
        TicketStatus.PROPOSTA: [],
        TicketStatus.ABERTO: [],
        TicketStatus.FECHADO: []
    }
    
    for ticket in tickets:
        status = ticket.get("status", TicketStatus.ABERTO)
        if status in kanban:
            kanban[status].append(ticket)
    
    return kanban

# AI Agent
@router.post("/ai/chat", response_model=AIChatResponse)
async def ai_chat(
    data: AIChatRequest,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    # Get ticket context
    ticket = await db.tickets.find_one({"id": data.ticket_id, "company_id": user["company_id"]})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket não encontrado")
    
    # Get or create AI conversation session
    session_id = data.session_id or str(uuid.uuid4())
    
    # Get conversation history
    conversation = await db.ai_conversations.find_one(
        {"ticket_id": data.ticket_id, "session_id": session_id}
    )
    
    if not conversation:
        conversation = {
            "id": str(uuid.uuid4()),
            "company_id": user["company_id"],
            "ticket_id": data.ticket_id,
            "session_id": session_id,
            "messages": [],
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await db.ai_conversations.insert_one(conversation)
    
    # Prepare AI context
    system_message = f"""Você é um assistente de atendimento ao cliente.
    
Contexto do Ticket:
- Cliente: {ticket['customer_name']}
- Telefone: {ticket['customer_phone']}
- Status: {ticket['status']}
- Descrição: {ticket.get('description', 'N/A')}

Sua função é ajudar o atendente a responder o cliente de forma profissional e útil."""
    
    # Use Emergent LLM Key
    emergent_key = os.environ.get("EMERGENT_LLM_KEY")
    if not emergent_key:
        raise HTTPException(status_code=500, detail="Chave de API não configurada")
    
    try:
        chat = LlmChat(
            api_key=emergent_key,
            session_id=session_id,
            system_message=system_message
        ).with_model("openai", "gpt-5.2")
        
        user_message = UserMessage(text=data.message)
        response = await chat.send_message(user_message)
        
        # Save to conversation history
        new_messages = [
            {
                "role": "user",
                "content": data.message,
                "timestamp": datetime.now(timezone.utc).isoformat()
            },
            {
                "role": "assistant",
                "content": response,
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
        ]
        
        await db.ai_conversations.update_one(
            {"session_id": session_id},
            {"$push": {"messages": {"$each": new_messages}}}
        )
        
        return AIChatResponse(response=response, session_id=session_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao processar chat: {str(e)}")

# Quick Responses
@router.get("/quick-responses")
async def list_quick_responses(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    responses = await db.quick_responses.find(
        {"company_id": user["company_id"]},
        {"_id": 0}
    ).to_list(1000)
    return responses

@router.post("/quick-responses")
async def create_quick_response(
    data: QuickResponseCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    response = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "title": data.title,
        "content": data.content,
        "shortcut": data.shortcut,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.quick_responses.insert_one(response)
    return {k: v for k, v in response.items() if k != "_id"}

# === CAMPAIGN GLOBAL SETTINGS (anti-block policy per company) ===
class CampaignSettingsUpdate(BaseModel):
    anti_block: dict


@router.get("/campaign-settings")
async def get_campaign_settings(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    doc = await db.campaign_settings.find_one({"company_id": user["company_id"]}, {"_id": 0})
    if not doc:
        doc = {
            "company_id": user["company_id"],
            "anti_block": {
                "enabled": True,
                "interval_min_seconds": 30,
                "interval_max_seconds": 90,
                "burst_size": 50,
                "burst_pause_seconds": 300,
                "daily_limit": 250,
                "hourly_limit": 50,
                "escalate_after": 100,
                "escalate_factor": 1.5,
                "only_with_phone_validated": True,
            }
        }
    return doc


@router.put("/campaign-settings")
async def update_campaign_settings(
    data: CampaignSettingsUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    await db.campaign_settings.update_one(
        {"company_id": user["company_id"]},
        {"$set": {"anti_block": data.anti_block,
                  "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )
    doc = await db.campaign_settings.find_one({"company_id": user["company_id"]}, {"_id": 0})
    return doc


# Campaigns
@router.get("/campaigns")
async def list_campaigns(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    campaigns = await db.campaigns.find(
        {"company_id": user["company_id"]},
        {"_id": 0}
    ).sort("created_at", -1).to_list(1000)
    # Enrich with connection name + list name for the list view
    conn_ids = list({c.get("connection_id") for c in campaigns if c.get("connection_id")})
    list_ids = list({c.get("contact_list_id") for c in campaigns if c.get("contact_list_id")})
    conns = {}
    if conn_ids:
        async for cn in db.channel_connections.find({"id": {"$in": conn_ids}}, {"_id":0,"id":1,"name":1}):
            conns[cn["id"]] = cn.get("name")
    lists = {}
    if list_ids:
        async for ln in db.contact_lists.find({"id": {"$in": list_ids}}, {"_id":0,"id":1,"name":1}):
            lists[ln["id"]] = ln.get("name")
    for c in campaigns:
        c["connection_name"] = conns.get(c.get("connection_id"), "-")
        c["contact_list_name"] = lists.get(c.get("contact_list_id"), "-")
    return campaigns


@router.post("/campaigns")
async def create_campaign(
    data: CampaignCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    campaign = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "name": data.name,
        "type": data.type,
        "audience_mode": data.audience_mode,
        "tag_ids": data.tag_ids or [],
        "contact_list_id": data.contact_list_id,
        "connection_id": data.connection_id,
        "scheduled_at": data.scheduled_at,
        "confirmation_enabled": data.confirmation_enabled,
        "open_ticket": data.open_ticket,
        "assigned_user_id": data.assigned_user_id,
        "queue_id": data.queue_id,
        "ticket_status": data.ticket_status or "fechado",
        "messages": data.messages or ([data.message_template] if data.message_template else []),
        "attachment_url": data.attachment_url,
        "anti_block": (data.anti_block.model_dump() if data.anti_block else {
            "enabled": True, "interval_min_seconds": 30, "interval_max_seconds": 90,
            "burst_size": 50, "burst_pause_seconds": 300, "daily_limit": 250,
            "hourly_limit": 50, "escalate_after": 100, "escalate_factor": 1.5,
            "only_with_phone_validated": True,
        }),
        "status": "programada" if data.scheduled_at else "draft",
        "sent_count": 0,
        "failed_count": 0,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.campaigns.insert_one(campaign)
    return {k: v for k, v in campaign.items() if k != "_id"}


@router.put("/campaigns/{campaign_id}")
async def update_campaign(
    campaign_id: str,
    data: CampaignUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    update = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="Sem dados")
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    res = await db.campaigns.update_one(
        {"id": campaign_id, "company_id": user["company_id"]}, {"$set": update}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Campanha nao encontrada")
    return await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})


@router.delete("/campaigns/{campaign_id}")
async def delete_campaign(
    campaign_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    res = await db.campaigns.delete_one({"id": campaign_id, "company_id": user["company_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Campanha nao encontrada")
    return {"message": "Removida"}


async def _resolve_campaign_audience(db: AsyncIOMotorDatabase, company_id: str, c: dict) -> List[dict]:
    """Return [{name, phone}] based on campaign filters."""
    mode = c.get("audience_mode") or "tags"
    out: List[dict] = []
    if mode == "list":
        cl_id = c.get("contact_list_id")
        if not cl_id:
            return []
        cl = await db.contact_lists.find_one({"id": cl_id, "company_id": company_id}, {"_id": 0})
        if not cl:
            return []
        for it in (cl.get("contacts") or []):
            if it.get("phone"):
                out.append({"name": it.get("name") or "", "phone": it["phone"]})
        return out

    # Pull all clients for the company once
    clients = await db.clients.find({"company_id": company_id}, {"_id": 0}).to_list(10000)

    if mode == "all":
        for cli in clients:
            if cli.get("phone"):
                out.append({"name": cli.get("name") or "", "phone": cli["phone"]})
        return out

    if mode == "no_tag":
        for cli in clients:
            if cli.get("phone") and not (cli.get("tags") or []):
                out.append({"name": cli.get("name") or "", "phone": cli["phone"]})
        return out

    # mode == 'tags'
    tag_ids = c.get("tag_ids") or []
    if not tag_ids:
        return []
    # Resolve tag names
    tag_docs = await db.tags.find({"id": {"$in": tag_ids}, "company_id": company_id}, {"_id":0,"name":1}).to_list(50)
    tag_names = {t["name"] for t in tag_docs}
    for cli in clients:
        client_tags = set(cli.get("tags") or [])
        if cli.get("phone") and (client_tags & tag_names):
            out.append({"name": cli.get("name") or "", "phone": cli["phone"]})
    # Also include tickets with such tags (they may not yet be "clients")
    async for t in db.tickets.find(
        {"company_id": company_id, "tags": {"$in": list(tag_names)}},
        {"_id": 0, "customer_name": 1, "customer_phone": 1}
    ):
        if t.get("customer_phone"):
            out.append({"name": t.get("customer_name") or "", "phone": t["customer_phone"]})
    # Dedup by phone
    seen = set()
    dedup = []
    for it in out:
        if it["phone"] in seen:
            continue
        seen.add(it["phone"])
        dedup.append(it)
    return dedup


@router.post("/campaigns/{campaign_id}/preview-audience")
async def preview_campaign_audience(
    campaign_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    camp = await db.campaigns.find_one({"id": campaign_id, "company_id": user["company_id"]}, {"_id": 0})
    if not camp:
        raise HTTPException(status_code=404, detail="Campanha nao encontrada")
    audience = await _resolve_campaign_audience(db, user["company_id"], camp)
    return {"count": len(audience), "preview": audience[:50]}


@router.post("/campaigns/{campaign_id}/run")
async def run_campaign_now(
    campaign_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    """Send the campaign immediately (ignores scheduled_at)."""
    camp = await db.campaigns.find_one({"id": campaign_id, "company_id": user["company_id"]}, {"_id": 0})
    if not camp:
        raise HTTPException(status_code=404, detail="Campanha nao encontrada")
    audience = await _resolve_campaign_audience(db, user["company_id"], camp)
    if not audience:
        raise HTTPException(status_code=400, detail="Audiencia vazia")
    msgs = [m for m in (camp.get("messages") or []) if m and m.strip()]
    if not msgs:
        raise HTTPException(status_code=400, detail="Sem mensagens definidas")

    import asyncio as _asyncio
    import random as _random
    import httpx as _httpx
    import os as _os
    wa_url = _os.environ.get("WA_SERVICE_URL", "http://localhost:3002")
    conn_id = camp.get("connection_id")
    if not conn_id:
        c2 = await db.channel_connections.find_one(
            {"company_id": user["company_id"], "type": "whatsapp", "status": "connected"}, {"_id":0,"id":1}
        )
        if not c2:
            raise HTTPException(status_code=400, detail="Nenhuma conexao WhatsApp ativa")
        conn_id = c2["id"]

    # Anti-block policy: campaign-level override OR company-level settings
    ab = camp.get("anti_block") or {}
    if not ab:
        settings = await db.campaign_settings.find_one({"company_id": user["company_id"]}, {"_id": 0})
        ab = (settings or {}).get("anti_block") or {}
    ab_enabled = ab.get("enabled", True)

    # Helper to render templates with variables (incl. dynamic saudacao)
    from notifications import render_template as _render
    interval_min = max(0, int(ab.get("interval_min_seconds", 30) or 0))
    interval_max = max(interval_min, int(ab.get("interval_max_seconds", 90) or 0))
    burst_size = max(1, int(ab.get("burst_size", 50) or 1))
    burst_pause = max(0, int(ab.get("burst_pause_seconds", 300) or 0))
    daily_limit = max(1, int(ab.get("daily_limit", 250) or 250))
    escalate_after = max(0, int(ab.get("escalate_after", 100) or 0))
    escalate_factor = float(ab.get("escalate_factor", 1.5) or 1.0)

    # Hard cap by daily limit
    if len(audience) > daily_limit:
        audience = audience[:daily_limit]

    # Long campaigns (>5min total) become "em_execucao" + hand off to async task
    estimated_seconds = len(audience) * ((interval_min + interval_max) / 2 if ab_enabled else 0)
    if ab_enabled and estimated_seconds > 300:
        # Mark and process in background; return immediately
        await db.campaigns.update_one(
            {"id": campaign_id},
            {"$set": {"status": "em_execucao", "started_at": datetime.now(timezone.utc).isoformat()}}
        )
        async def _runner():
            try:
                from motor.motor_asyncio import AsyncIOMotorClient as _Cli
                cli = _Cli(_os.environ["MONGO_URL"])
                bdb = cli[_os.environ["DB_NAME"]]
                sent_x, failed_x, count = 0, 0, 0
                async with _httpx.AsyncClient(timeout=30.0) as client:
                    for person in audience:
                        for tpl in msgs:
                            mtxt = _render(tpl or "", {"nome": person.get("name") or "", "numero": person.get("phone") or "", "telefone": person.get("phone") or ""})
                            try:
                                rr = await client.post(f"{wa_url}/instances/{conn_id}/send", json={"phone": person["phone"], "message": mtxt})
                                rs = rr.json() if rr.status_code == 200 else {}
                                if rs.get("success"): sent_x += 1
                                else: failed_x += 1
                            except Exception:
                                failed_x += 1
                        count += 1
                        # escalate
                        cur_min, cur_max = interval_min, interval_max
                        if escalate_after and count > escalate_after:
                            cur_min = int(cur_min * escalate_factor)
                            cur_max = int(cur_max * escalate_factor)
                        # burst pause
                        if burst_size and count % burst_size == 0 and count < len(audience):
                            await _asyncio.sleep(burst_pause)
                        elif count < len(audience):
                            await _asyncio.sleep(_random.randint(cur_min, max(cur_min, cur_max)))
                await bdb.campaigns.update_one(
                    {"id": campaign_id},
                    {"$set": {"status": "concluida", "sent_count": sent_x, "failed_count": failed_x,
                              "completed_at": datetime.now(timezone.utc).isoformat()}}
                )
            except Exception as _e:
                await bdb.campaigns.update_one({"id": campaign_id},
                    {"$set": {"status": "cancelada", "error": str(_e)[:200]}})
        _asyncio.create_task(_runner())
        return {"queued": True, "audience": len(audience), "estimated_minutes": int(estimated_seconds // 60)}

    # Otherwise execute synchronously (small campaigns)
    sent, failed, count = 0, 0, 0
    async with _httpx.AsyncClient(timeout=30.0) as client:
        for person in audience:
            for tpl in msgs:
                msg = _render(tpl or "", {"nome": person.get("name") or "", "numero": person.get("phone") or "", "telefone": person.get("phone") or ""})
                try:
                    r = await client.post(f"{wa_url}/instances/{conn_id}/send", json={"phone": person["phone"], "message": msg})
                    res = r.json() if r.status_code == 200 else {}
                    if res.get("success"):
                        sent += 1
                    else:
                        failed += 1
                except Exception:
                    failed += 1

            if camp.get("open_ticket"):
                # Create ticket if none open for this phone
                existing = await db.tickets.find_one({
                    "company_id": user["company_id"],
                    "customer_phone": person["phone"],
                    "status": {"$ne": "fechado"}
                })
                if not existing:
                    auto_client = await find_or_create_client_by_phone(
                        db, user["company_id"], person.get("phone"), name=person.get("name")
                    )
                    await db.tickets.insert_one({
                        "id": str(uuid.uuid4()),
                        "ticket_number": await next_ticket_number(db, user["company_id"]),
                        "company_id": user["company_id"],
                        "client_id": auto_client,
                        "customer_name": person.get("name") or person["phone"],
                        "customer_phone": person["phone"],
                        "channel": "whatsapp",
                        "status": camp.get("ticket_status") or "aberto",
                        "priority": "medium",
                        "tags": [],
                        "value": 0.0,
                        "messages": [],
                        "assigned_to": camp.get("assigned_user_id"),
                        "queue_id": camp.get("queue_id"),
                        "connection_id": conn_id,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    })
            count += 1
            # apply small synchronous delay between recipients (except last)
            if ab_enabled and count < len(audience):
                cur_min, cur_max = interval_min, interval_max
                if escalate_after and count > escalate_after:
                    cur_min = int(cur_min * escalate_factor)
                    cur_max = int(cur_max * escalate_factor)
                if burst_size and count % burst_size == 0:
                    await _asyncio.sleep(burst_pause)
                else:
                    await _asyncio.sleep(_random.randint(cur_min, max(cur_min, cur_max)))

    await db.campaigns.update_one(
        {"id": campaign_id},
        {"$set": {"status": "concluida", "sent_count": sent, "failed_count": failed,
                  "completed_at": datetime.now(timezone.utc).isoformat()}}
    )
    return {"sent": sent, "failed": failed, "total": len(audience)}


# === QUEUES (Filas & Chatbot) ===
class QueueCreate(BaseModel):
    name: str
    color: Optional[str] = "#4F46E5"
    description: Optional[str] = ""
    welcome_message: Optional[str] = ""
    bot_flow_id: Optional[str] = None


class QueueUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    description: Optional[str] = None
    welcome_message: Optional[str] = None
    bot_flow_id: Optional[str] = None


@router.get("/queues")
async def list_queues(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    return await db.queues.find({"company_id": user["company_id"]}, {"_id": 0}).sort("name", 1).to_list(200)


@router.post("/queues")
async def create_queue(
    data: QueueCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    doc = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "name": data.name,
        "color": data.color or "#4F46E5",
        "description": data.description or "",
        "welcome_message": data.welcome_message or "",
        "bot_flow_id": data.bot_flow_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.queues.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@router.put("/queues/{queue_id}")
async def update_queue(
    queue_id: str,
    data: QueueUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    update = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="Sem dados")
    res = await db.queues.update_one(
        {"id": queue_id, "company_id": user["company_id"]}, {"$set": update}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Fila nao encontrada")
    return await db.queues.find_one({"id": queue_id}, {"_id": 0})


@router.delete("/queues/{queue_id}")
async def delete_queue(
    queue_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    res = await db.queues.delete_one({"id": queue_id, "company_id": user["company_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Fila nao encontrada")
    return {"message": "Removida"}


# === CONTACT LISTS ===
class ContactItem(BaseModel):
    name: Optional[str] = ""
    phone: str


class ContactListCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    contacts: Optional[List[ContactItem]] = None


class ContactListUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    contacts: Optional[List[ContactItem]] = None


@router.get("/contact-lists")
async def list_contact_lists(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    out = await db.contact_lists.find({"company_id": user["company_id"]}, {"_id": 0}).sort("name", 1).to_list(200)
    for o in out:
        o["count"] = len(o.get("contacts") or [])
    return out


@router.post("/contact-lists")
async def create_contact_list(
    data: ContactListCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    contacts = [c.model_dump() for c in (data.contacts or [])]
    doc = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "name": data.name,
        "description": data.description or "",
        "contacts": contacts,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.contact_lists.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@router.put("/contact-lists/{list_id}")
async def update_contact_list(
    list_id: str,
    data: ContactListUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    update = {}
    if data.name is not None: update["name"] = data.name
    if data.description is not None: update["description"] = data.description
    if data.contacts is not None: update["contacts"] = [c.model_dump() for c in data.contacts]
    if not update:
        raise HTTPException(status_code=400, detail="Sem dados")
    res = await db.contact_lists.update_one(
        {"id": list_id, "company_id": user["company_id"]}, {"$set": update}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Lista nao encontrada")
    return await db.contact_lists.find_one({"id": list_id}, {"_id": 0})


@router.delete("/contact-lists/{list_id}")
async def delete_contact_list(
    list_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    res = await db.contact_lists.delete_one({"id": list_id, "company_id": user["company_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Lista nao encontrada")
    return {"message": "Removida"}


# === RETRY MESSAGE ===
@router.post("/tickets/{ticket_id}/messages/{message_id}/retry")
async def retry_ticket_message(
    ticket_id: str,
    message_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    ticket = await db.tickets.find_one({"id": ticket_id, "company_id": user["company_id"]})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket nao encontrado")
    msg = next((m for m in (ticket.get("messages") or []) if m.get("id") == message_id), None)
    if not msg:
        raise HTTPException(status_code=404, detail="Mensagem nao encontrada")
    if msg.get("sender_type") != "agent" or ticket.get("channel") != "whatsapp":
        raise HTTPException(status_code=400, detail="Reenvio so para mensagens de agente em WhatsApp")
    if not ticket.get("customer_phone"):
        raise HTTPException(status_code=400, detail="Sem telefone")

    import httpx as _httpx
    import os as _os
    wa_url = _os.environ.get("WA_SERVICE_URL", "http://localhost:3002")
    # Prefer ticket's connection_id
    conn_id = ticket.get("connection_id")
    if not conn_id:
        c2 = await db.channel_connections.find_one(
            {"company_id": user["company_id"], "type": "whatsapp", "status": "connected"}, {"_id":0,"id":1}
        )
        conn_id = c2["id"] if c2 else None
    if not conn_id:
        raise HTTPException(status_code=400, detail="Nenhuma conexao WhatsApp ativa")
    try:
        async with _httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(f"{wa_url}/instances/{conn_id}/send",
                                  json={"phone": ticket["customer_phone"], "message": msg["content"]})
            res = r.json() if r.status_code == 200 else {}
        if res.get("success"):
            await db.tickets.update_one(
                {"id": ticket_id, "messages.id": message_id},
                {"$set": {"messages.$.delivery_status": "sent", "messages.$.delivery_error": None}}
            )
            return {"ok": True}
        else:
            err = res.get("error", "Falha ao reenviar")
            await db.tickets.update_one(
                {"id": ticket_id, "messages.id": message_id},
                {"$set": {"messages.$.delivery_status": "failed", "messages.$.delivery_error": err}}
            )
            raise HTTPException(status_code=502, detail=err)
    except _httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=str(e)[:120])

# Flow Builder
@router.get("/flows")
async def list_flows(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    flows = await db.flow_builders.find(
        {"company_id": user["company_id"]},
        {"_id": 0}
    ).to_list(1000)
    return flows

@router.post("/flows")
async def create_flow(
    data: FlowCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    flow = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "name": data.name,
        "description": data.description,
        "nodes": data.nodes,
        "edges": data.edges,
        "trigger_type": data.trigger_type,
        "is_active": False,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.flow_builders.insert_one(flow)
    return {k: v for k, v in flow.items() if k != "_id"}

@router.put("/flows/{flow_id}")
async def update_flow(
    flow_id: str,
    data: FlowUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    flow = await db.flow_builders.find_one({"id": flow_id, "company_id": user["company_id"]})
    if not flow:
        raise HTTPException(status_code=404, detail="Flow não encontrado")
    
    update_data = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    
    if update_data:
        await db.flow_builders.update_one(
            {"id": flow_id},
            {"$set": update_data}
        )
    
    updated_flow = await db.flow_builders.find_one({"id": flow_id}, {"_id": 0})
    return updated_flow


@router.delete("/flows/{flow_id}")
async def delete_flow(
    flow_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    res = await db.flow_builders.delete_one({"id": flow_id, "company_id": user["company_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Flow nao encontrado")
    return {"message": "Flow removido"}


# === FLOW EXECUTION (auto-trigger when WhatsApp connection has default_flow_id) ===
async def _trigger_flow_for_ticket(db: AsyncIOMotorDatabase, company_id: str, flow_id: str, ticket: dict) -> None:
    """Sends the WELCOME / FIRST-MESSAGE node of a Flowbuilder flow as the
    initial automated reply on a brand-new ticket.

    Minimal initial implementation: looks for the FIRST node of type
    `message` (or any node with a `message`/`text` data field) and posts
    its content as an outgoing agent message. The full flow execution
    engine (branching, conditions, AI nodes) is a separate roadmap item;
    this fires off the welcome reply so the customer gets an instant
    acknowledgement when they hit a connection that has a flow attached.

    We persist `active_flow_id` and `flow_started_at` on the ticket so
    a future executor can pick up where this leaves off.
    """
    flow = await db.flow_builders.find_one({"id": flow_id, "company_id": company_id}, {"_id": 0})
    if not flow:
        return
    nodes = flow.get("nodes") or []
    if not nodes:
        return

    # Pick the entry node: prefer one explicitly marked as `start`/`trigger`,
    # fallback to the first node that has a usable text payload.
    def _node_text(n):
        d = n.get("data") or {}
        for k in ("message", "text", "label", "content"):
            v = d.get(k)
            if isinstance(v, str) and v.strip():
                return v
        # Some nodes nest under data.config.message
        cfg = (d.get("config") or {})
        for k in ("message", "text"):
            v = cfg.get(k)
            if isinstance(v, str) and v.strip():
                return v
        return None

    entry = next((n for n in nodes if (n.get("type") or "").lower() in ("start", "trigger", "message", "welcome")), None)
    if not entry:
        entry = next((n for n in nodes if _node_text(n)), None)
    if not entry:
        return
    welcome_text = _node_text(entry)
    if not welcome_text:
        return

    # Render simple placeholders against the ticket's customer
    welcome_text = (welcome_text
                    .replace("{{nome}}", ticket.get("customer_name") or "")
                    .replace("{{name}}", ticket.get("customer_name") or "")
                    .replace("{{ticket_number}}", str(ticket.get("ticket_number") or "")))

    # Send via WhatsApp (fire-and-forget) and persist as outgoing message
    new_msg = {
        "id": str(uuid.uuid4()),
        "ticket_id": ticket["id"],
        "content": welcome_text,
        "sender_type": "agent",  # marks it as a system/auto reply
        "sender_id": None,
        "channel": "whatsapp",
        "wa_message_id": None,
        "auto_flow_id": flow_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.tickets.update_one(
        {"id": ticket["id"]},
        {"$push": {"messages": new_msg},
         "$set": {"active_flow_id": flow_id,
                  "flow_started_at": datetime.now(timezone.utc).isoformat(),
                  "updated_at": datetime.now(timezone.utc).isoformat()}}
    )

    # Forward to microservice (best-effort)
    try:
        import httpx as _httpx
        wa_url = os.environ.get("WA_SERVICE_URL", "http://localhost:3002")
        target_phone = ticket.get("lid_jid") if ticket.get("pending_lid_resolution") else ticket.get("customer_phone")
        if ticket.get("connection_id") and target_phone:
            async with _httpx.AsyncClient(timeout=15.0) as client:
                await client.post(
                    f"{wa_url}/instances/{ticket['connection_id']}/send",
                    json={"phone": target_phone, "message": welcome_text}
                )
    except Exception:
        pass


# === TAGS ===
from pydantic import BaseModel as _BM


class TagCreate(_BM):
    name: str
    color: Optional[str] = "#64748B"
    description: Optional[str] = ""


class TagUpdate(_BM):
    name: Optional[str] = None
    color: Optional[str] = None
    description: Optional[str] = None


@router.get("/tags")
async def list_tags(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    tags = await db.tags.find(
        {"company_id": user["company_id"]},
        {"_id": 0}
    ).sort("name", 1).to_list(500)
    return tags


@router.post("/tags")
async def create_tag(
    data: TagCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    doc = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "name": data.name,
        "color": data.color or "#64748B",
        "description": data.description or "",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.tags.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@router.put("/tags/{tag_id}")
async def update_tag(
    tag_id: str,
    data: TagUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    update = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="Sem dados")
    res = await db.tags.update_one(
        {"id": tag_id, "company_id": user["company_id"]},
        {"$set": update}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Tag nao encontrada")
    return await db.tags.find_one({"id": tag_id}, {"_id": 0})


@router.delete("/tags/{tag_id}")
async def delete_tag(
    tag_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    res = await db.tags.delete_one({"id": tag_id, "company_id": user["company_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Tag nao encontrada")
    return {"message": "Tag removida"}


# === KANBAN COLUMNS ===
class KanbanColumnCreate(_BM):
    name: str
    color: Optional[str] = "#64748B"
    order: Optional[int] = 0


class KanbanColumnUpdate(_BM):
    name: Optional[str] = None
    color: Optional[str] = None
    order: Optional[int] = None


# A native first column ("Atendimentos") is always returned. It collects
# every ticket whose status doesn't match a custom column. Companies cannot
# delete or rename it from the UI.
NATIVE_FIRST_COLUMN = {
    "id": "native:atendimentos",
    "name": "Atendimentos",
    "color": "#4F46E5",
    "order": 0,
    "is_native": True,
}


@router.get("/kanban-columns")
async def list_kanban_columns(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    custom = await db.kanban_columns.find(
        {"company_id": user["company_id"]},
        {"_id": 0}
    ).sort("order", 1).to_list(100)
    return [NATIVE_FIRST_COLUMN] + custom


@router.post("/kanban-columns")
async def create_kanban_column(
    data: KanbanColumnCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    # Auto-assign next order if not provided
    cnt = await db.kanban_columns.count_documents({"company_id": user["company_id"]})
    order = data.order if (data.order is not None and data.order > 0) else (cnt + 1)
    doc = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "name": data.name,
        "color": data.color or "#64748B",
        "order": order,
        "is_native": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.kanban_columns.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@router.put("/kanban-columns/{column_id}")
async def update_kanban_column(
    column_id: str,
    data: KanbanColumnUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    if column_id.startswith("native:"):
        raise HTTPException(status_code=400, detail="Coluna nativa nao pode ser editada")
    update = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="Sem dados")
    res = await db.kanban_columns.update_one(
        {"id": column_id, "company_id": user["company_id"]},
        {"$set": update}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Coluna nao encontrada")
    return await db.kanban_columns.find_one({"id": column_id}, {"_id": 0})


@router.delete("/kanban-columns/{column_id}")
async def delete_kanban_column(
    column_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    if column_id.startswith("native:"):
        raise HTTPException(status_code=400, detail="Coluna nativa nao pode ser excluida")
    res = await db.kanban_columns.delete_one({"id": column_id, "company_id": user["company_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Coluna nao encontrada")
    return {"message": "Coluna removida"}


# Override kanban endpoint to use custom columns
@router.get("/kanban-v2")
async def get_kanban_v2(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    """Kanban grouped by company-defined columns (plus the native first one)."""
    custom_cols = await db.kanban_columns.find(
        {"company_id": user["company_id"]}, {"_id": 0}
    ).sort("order", 1).to_list(100)
    columns = [NATIVE_FIRST_COLUMN] + custom_cols
    custom_ids = {c["id"] for c in custom_cols}

    # Apply per-user visibility (Feature #5): non-admins only see their
    # own claimed tickets + the unassigned-aberto pool.
    query = {"company_id": user["company_id"]}
    vis = _ticket_visibility_filter(user)
    if vis:
        query.update(vis)
    tickets = await db.tickets.find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)

    grouped = {c["id"]: [] for c in columns}
    for t in tickets:
        col = t.get("kanban_column_id")
        if col and col in custom_ids:
            grouped[col].append(t)
        else:
            grouped[NATIVE_FIRST_COLUMN["id"]].append(t)

    # Compute total value per column
    totals_by_column = {
        col_id: sum(float(t.get("value") or 0) for t in items)
        for col_id, items in grouped.items()
    }

    return {"columns": columns, "tickets_by_column": grouped, "totals_by_column": totals_by_column}


class KanbanReorderRequest(BaseModel):
    column_ids: List[str]  # ordered list of column ids; first one shown left-most


@router.post("/kanban-columns/reorder")
async def reorder_kanban_columns(
    body: KanbanReorderRequest,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    """Persist a new column ordering. Native columns (`native:*`) are
    silently dropped from the input — they are always anchored on the
    left. Operators access this via a "disfarçado" button in the Kanban
    page header (long-press / admin-only)."""
    if not body.column_ids:
        raise HTTPException(400, "column_ids vazio")
    custom_ids = [c for c in body.column_ids if not c.startswith("native:")]
    # Bulk-update order (1-indexed; native column always sits at 0)
    for idx, col_id in enumerate(custom_ids, start=1):
        await db.kanban_columns.update_one(
            {"id": col_id, "company_id": user["company_id"]},
            {"$set": {"order": idx, "updated_at": datetime.now(timezone.utc).isoformat()}}
        )
    return {"reordered": len(custom_ids)}


@router.put("/tickets/{ticket_id}/kanban-column")
async def move_ticket_to_column(
    ticket_id: str,
    body: dict,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    column_id = body.get("column_id")
    if not column_id:
        raise HTTPException(status_code=400, detail="column_id obrigatorio")
    set_value: Any = column_id
    if column_id.startswith("native:"):
        # Native column: clear custom assignment so the ticket falls back here
        set_value = None
    res = await db.tickets.update_one(
        {"id": ticket_id, "company_id": user["company_id"]},
        {"$set": {"kanban_column_id": set_value, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Ticket nao encontrado")
    return {"message": "Ticket movido"}
