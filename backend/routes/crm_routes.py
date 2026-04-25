from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from database import get_database
from auth import get_current_user
from models import (
    TicketCreate, TicketUpdate, MessageCreate, QuickResponseCreate,
    CampaignCreate, FlowCreate, FlowUpdate, AIChatRequest, AIChatResponse,
    TicketStatus
)
import uuid
from datetime import datetime, timezone
from typing import List, Optional, Any
from emergentintegrations.llm.chat import LlmChat, UserMessage
import os

router = APIRouter(prefix="/crm", tags=["crm"])

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

    tickets = await db.tickets.find(query, {"_id": 0}).sort("updated_at", -1).to_list(1000)
    return tickets

@router.get("/tickets/counts")
async def get_ticket_counts(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    company_id = user["company_id"]
    atendendo = await db.tickets.count_documents({"company_id": company_id, "status": {"$in": ["aberto", "em_cobranca", "proposta"]}})
    aguardando = await db.tickets.count_documents({"company_id": company_id, "status": {"$in": ["pago", "bloqueado"]}})
    total = await db.tickets.count_documents({"company_id": company_id})
    return {"atendendo": atendendo, "aguardando": aguardando, "total": total}
    return tickets

@router.post("/tickets")
async def create_ticket(
    data: TicketCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    ticket_id = str(uuid.uuid4())
    ticket = {
        "id": ticket_id,
        "company_id": user["company_id"],
        "customer_name": data.customer_name,
        "customer_phone": data.customer_phone,
        "customer_email": data.customer_email,
        "status": data.status,
        "priority": data.priority,
        "channel": data.channel,
        "description": data.description,
        "assigned_to": None,
        "messages": [],
        "tags": [],
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
    
    update_data = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
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
        raise HTTPException(status_code=404, detail="Ticket não encontrado")
    return {"message": "Ticket deletado com sucesso"}

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
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.tickets.update_one(
        {"id": ticket_id},
        {"$push": {"messages": message}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    
    return message

# Kanban
@router.get("/kanban")
async def get_kanban(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    tickets = await db.tickets.find(
        {"company_id": user["company_id"]},
        {"_id": 0}
    ).sort("created_at", -1).to_list(1000)
    
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

# Campaigns
@router.get("/campaigns")
async def list_campaigns(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    campaigns = await db.campaigns.find(
        {"company_id": user["company_id"]},
        {"_id": 0}
    ).to_list(1000)
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
        "message_template": data.message_template,
        "target_audience": data.target_audience,
        "scheduled_at": data.scheduled_at,
        "status": "draft",
        "sent_count": 0,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.campaigns.insert_one(campaign)
    return {k: v for k, v in campaign.items() if k != "_id"}

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

    tickets = await db.tickets.find(
        {"company_id": user["company_id"]},
        {"_id": 0}
    ).sort("created_at", -1).to_list(2000)

    grouped = {c["id"]: [] for c in columns}
    for t in tickets:
        col = t.get("kanban_column_id")
        if col and col in custom_ids:
            grouped[col].append(t)
        else:
            grouped[NATIVE_FIRST_COLUMN["id"]].append(t)

    return {"columns": columns, "tickets_by_column": grouped}


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
