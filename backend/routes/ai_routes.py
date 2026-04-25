"""AI Providers + AI Agents + (planned) AI Agent execution.

Endpoints under /api/ai/...
- /providers (CRUD)
- /agents (CRUD with templates)

The AI agents are pure data — they describe a persona / system prompt that the
flowbuilder or atendimentos page can plug into when calling LlmChat.
"""
from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel
from typing import List, Optional, Any
from datetime import datetime, timezone
import uuid
import os

from database import get_database
from auth import get_current_user

router = APIRouter(prefix="/ai", tags=["ai"])


# === MODELS ===
class ProviderCreate(BaseModel):
    name: str
    type: str  # 'openai' | 'anthropic' | 'gemini' | 'emergent'
    api_key: Optional[str] = None  # blank/None for emergent (uses universal key)
    models: Optional[List[str]] = None
    base_url: Optional[str] = None


class ProviderUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    api_key: Optional[str] = None
    models: Optional[List[str]] = None
    base_url: Optional[str] = None


# Default models per provider type
DEFAULT_MODELS = {
    "openai": ["gpt-4o-mini", "gpt-4o", "gpt-5.2"],
    "anthropic": ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-4-5"],
    "gemini": ["gemini-3-flash", "gemini-3-pro"],
    "emergent": ["gpt-4o-mini", "gpt-4o", "gpt-5.2", "claude-sonnet-4-5", "claude-haiku-4-5", "gemini-3-flash"],
}


# Built-in AI agent templates (Personalidade, Produtos, FAQ, etc.)
AI_AGENT_TEMPLATES = [
    {
        "key": "clinical",
        "name": "Assistente Clinico Maria",
        "category": "Clinica",
        "icon": "🏥",
        "color": "#EF4444",
        "personality": {
            "name": "Maria",
            "bio": "Assistente clinica focada em recepcao e atendimento humanizado.",
            "gender": "Feminino",
            "age_range": "26 a 35",
            "expertise": "Agendamento, primeiros atendimentos, orientacoes pre-consulta, encaminhamento de exames.",
            "greeting": "Ola! Sou a Maria, assistente da clinica. Como posso te ajudar hoje?",
            "company_about": "Clinica medica focada em saude e bem-estar dos pacientes.",
            "main_goal": "Receber pacientes com empatia, agendar consultas e tirar duvidas comuns.",
            "tone": "Empatico e profissional",
        },
    },
    {
        "key": "tutor",
        "name": "Tutor Educacional Joao",
        "category": "Educacao",
        "icon": "📚",
        "color": "#3B82F6",
        "personality": {
            "name": "Joao",
            "bio": "Tutor virtual que ajuda alunos com duvidas e organiza conteudos.",
            "gender": "Masculino",
            "age_range": "26 a 35",
            "expertise": "Explicacoes didaticas, plano de estudos, exercicios, motivacao.",
            "greeting": "E ai! Sou o Joao, seu tutor. Vamos estudar?",
            "company_about": "Plataforma educacional moderna e personalizada.",
            "main_goal": "Tirar duvidas, explicar conceitos e manter o aluno engajado.",
            "tone": "Amigavel e didatico",
        },
    },
    {
        "key": "commercial",
        "name": "Assessor Comercial Ana",
        "category": "Negocios",
        "icon": "💼",
        "color": "#10B981",
        "personality": {
            "name": "Ana",
            "bio": "Assessora comercial focada em qualificar leads e fechar vendas.",
            "gender": "Feminino",
            "age_range": "26 a 35",
            "expertise": "Apresentacao de produtos, argumentacao de valor, contorno de objecoes, negociacao.",
            "greeting": "Oi! Sou a Ana. Posso te apresentar nossas solucoes?",
            "company_about": "Empresa B2B focada em resultados.",
            "main_goal": "Qualificar leads, marcar reunioes e gerar vendas.",
            "tone": "Persuasivo e consultivo",
        },
    },
    {
        "key": "retail",
        "name": "Atendente de Loja Virtual",
        "category": "Varejo",
        "icon": "🏪",
        "color": "#F59E0B",
        "personality": {
            "name": "Atendente",
            "bio": "Atendente de e-commerce focada em duvidas de produto, frete e pagamento.",
            "gender": "Feminino",
            "age_range": "20 a 30",
            "expertise": "Catalogo, frete, troca, pagamento, status de pedido.",
            "greeting": "Ola! Bem-vindo(a)! Como posso te ajudar com sua compra?",
            "company_about": "Loja online com entrega em todo o Brasil.",
            "main_goal": "Auxiliar o cliente em duvidas e converter visitas em pedidos.",
            "tone": "Amigavel e prestativo",
        },
    },
    {
        "key": "support",
        "name": "Tecnico Virtual Leo",
        "category": "Suporte_tecnico",
        "icon": "🛠",
        "color": "#8B5CF6",
        "personality": {
            "name": "Leo",
            "bio": "Um agente dedicado a resolver problemas tecnicos e fornecer suporte rapido e eficiente.",
            "gender": "Masculino",
            "age_range": "26 a 35",
            "expertise": "Diagnostico de problemas, solucoes de software e hardware, configuracao de sistemas, guias passo a passo, troubleshooting.",
            "greeting": "Ola! Meu nome e Leo e estou pronto para te auxiliar com qualquer questao tecnica que tiver.",
            "company_about": "Empresa de tecnologia focada em inovar e fornecer suporte de ponta para seus produtos.",
            "main_goal": "Resolver problemas tecnicos, reduzir o tempo de inatividade e garantir a satisfacao do usuario com as solucoes.",
            "tone": "Formal e profissional",
        },
    },
    {
        "key": "financial",
        "name": "Consultor Financeiro Clara",
        "category": "Financeiro",
        "icon": "💰",
        "color": "#22C55E",
        "personality": {
            "name": "Clara",
            "bio": "Consultora financeira para investimentos e organizacao financeira pessoal.",
            "gender": "Feminino",
            "age_range": "30 a 45",
            "expertise": "Investimentos, planejamento, divida, orcamento, previdencia.",
            "greeting": "Ola! Sou a Clara, consultora financeira. Posso te ajudar?",
            "company_about": "Consultoria financeira pessoal e empresarial.",
            "main_goal": "Educar e orientar o cliente sobre escolhas financeiras.",
            "tone": "Confiavel e didatico",
        },
    },
    {
        "key": "tourism",
        "name": "Guia Turistico Virtual Pedro",
        "category": "Turismo",
        "icon": "✈️",
        "color": "#06B6D4",
        "personality": {
            "name": "Pedro",
            "bio": "Guia turistico digital para roteiros, dicas e reservas.",
            "gender": "Masculino",
            "age_range": "26 a 35",
            "expertise": "Roteiros, hoteis, transporte, gastronomia, atracoes.",
            "greeting": "Ola! Sou o Pedro. Que tal planejarmos sua proxima viagem?",
            "company_about": "Agencia de turismo focada em experiencias autenticas.",
            "main_goal": "Inspirar viagens e converter em reservas.",
            "tone": "Animado e prestativo",
        },
    },
    {
        "key": "real_estate",
        "name": "Corretora Imobiliaria Sofia",
        "category": "Imobiliario",
        "icon": "🏠",
        "color": "#F97316",
        "personality": {
            "name": "Sofia",
            "bio": "Corretora especializada em compra, venda e aluguel de imoveis.",
            "gender": "Feminino",
            "age_range": "30 a 45",
            "expertise": "Avaliacao de imoveis, financiamento, documentacao, negociacao.",
            "greeting": "Ola! Sou a Sofia, sua corretora. Procurando imovel?",
            "company_about": "Imobiliaria com mais de 20 anos de experiencia.",
            "main_goal": "Entender necessidades e encontrar o imovel ideal.",
            "tone": "Profissional e atencioso",
        },
    },
    {
        "key": "chef",
        "name": "Chef Virtual Gabriel",
        "category": "Gastronomia",
        "icon": "🍴",
        "color": "#DC2626",
        "personality": {
            "name": "Gabriel",
            "bio": "Chef virtual com receitas, dicas culinarias e cardapios.",
            "gender": "Masculino",
            "age_range": "30 a 45",
            "expertise": "Receitas, harmonizacao, dieta, ingredientes, tecnicas.",
            "greeting": "Ola! Sou o Chef Gabriel. Bora cozinhar?",
            "company_about": "Restaurante e escola de culinaria.",
            "main_goal": "Inspirar e ajudar com receitas e pedidos.",
            "tone": "Animado e criativo",
        },
    },
    {
        "key": "automotive",
        "name": "Consultor Automotivo Rafaela",
        "category": "Automotivo",
        "icon": "🚗",
        "color": "#2563EB",
        "personality": {
            "name": "Rafaela",
            "bio": "Consultora automotiva que ajuda a escolher e manter veiculos.",
            "gender": "Feminino",
            "age_range": "26 a 35",
            "expertise": "Comparacao de modelos, financiamento, revisao, seguro.",
            "greeting": "Ola! Sou a Rafaela, sua consultora automotiva.",
            "company_about": "Concessionaria com showroom e servicos.",
            "main_goal": "Ajudar a escolher e manter o carro ideal.",
            "tone": "Profissional e amigavel",
        },
    },
    {
        "key": "custom",
        "name": "Personalizado",
        "category": "Personalizado",
        "icon": "⚙️",
        "color": "#64748B",
        "personality": {
            "name": "",
            "bio": "",
            "gender": "Feminino",
            "age_range": "26 a 35",
            "expertise": "",
            "greeting": "",
            "company_about": "",
            "main_goal": "",
            "tone": "Profissional",
        },
    },
]


@router.get("/agent-templates")
async def list_agent_templates():
    """Public list of built-in templates the user can pick from."""
    return AI_AGENT_TEMPLATES


# === PROVIDERS CRUD ===
@router.get("/providers")
async def list_providers(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    items = await db.ai_providers.find(
        {"company_id": user["company_id"]}, {"_id": 0, "api_key": 0}
    ).sort("created_at", -1).to_list(200)
    # Provide a default "emergent" provider stub if user has none
    if not items:
        items = [{
            "id": "default-emergent",
            "name": "Emergent (Universal Key)",
            "type": "emergent",
            "models": DEFAULT_MODELS["emergent"],
            "is_default": True,
        }]
    return items


@router.post("/providers")
async def create_provider(
    data: ProviderCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    if data.type not in DEFAULT_MODELS:
        raise HTTPException(status_code=400, detail="Tipo invalido")
    doc = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "name": data.name,
        "type": data.type,
        "api_key": data.api_key or "",
        "base_url": data.base_url or "",
        "models": data.models or DEFAULT_MODELS[data.type],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.ai_providers.insert_one(doc)
    return {k: v for k, v in doc.items() if k not in ("_id", "api_key")}


@router.put("/providers/{provider_id}")
async def update_provider(
    provider_id: str,
    data: ProviderUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    update = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="Sem dados para atualizar")
    if "type" in update and update["type"] not in DEFAULT_MODELS:
        raise HTTPException(status_code=400, detail="Tipo invalido")
    res = await db.ai_providers.update_one(
        {"id": provider_id, "company_id": user["company_id"]},
        {"$set": update}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Provedor nao encontrado")
    return await db.ai_providers.find_one(
        {"id": provider_id}, {"_id": 0, "api_key": 0}
    )


@router.delete("/providers/{provider_id}")
async def delete_provider(
    provider_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    res = await db.ai_providers.delete_one({"id": provider_id, "company_id": user["company_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Provedor nao encontrado")
    return {"message": "Provedor removido"}


# === AGENTS CRUD ===
class AgentCreate(BaseModel):
    name: str
    template_key: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    category: Optional[str] = None
    personality: Optional[dict] = None
    products: Optional[List[dict]] = None
    faq: Optional[List[dict]] = None
    objections: Optional[List[dict]] = None
    extras: Optional[dict] = None
    site: Optional[str] = None
    instagram: Optional[str] = None
    provider_id: Optional[str] = None
    model: Optional[str] = None
    delay_seconds: Optional[int] = 0
    queue_ids: Optional[List[str]] = None
    is_active: Optional[bool] = True


class AgentUpdate(BaseModel):
    name: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    category: Optional[str] = None
    personality: Optional[dict] = None
    products: Optional[List[dict]] = None
    faq: Optional[List[dict]] = None
    objections: Optional[List[dict]] = None
    extras: Optional[dict] = None
    site: Optional[str] = None
    instagram: Optional[str] = None
    provider_id: Optional[str] = None
    model: Optional[str] = None
    delay_seconds: Optional[int] = None
    queue_ids: Optional[List[str]] = None
    is_active: Optional[bool] = None


@router.get("/agents")
async def list_agents(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    items = await db.ai_agents.find(
        {"company_id": user["company_id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    return items


@router.get("/agents/{agent_id}")
async def get_agent(
    agent_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    a = await db.ai_agents.find_one(
        {"id": agent_id, "company_id": user["company_id"]}, {"_id": 0}
    )
    if not a:
        raise HTTPException(status_code=404, detail="Agente nao encontrado")
    return a


@router.post("/agents")
async def create_agent(
    data: AgentCreate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    doc = {
        "id": str(uuid.uuid4()),
        "company_id": user["company_id"],
        "name": data.name,
        "template_key": data.template_key,
        "icon": data.icon or "🤖",
        "color": data.color or "#4F46E5",
        "category": data.category or "Personalizado",
        "personality": data.personality or {},
        "products": data.products or [],
        "faq": data.faq or [],
        "objections": data.objections or [],
        "extras": data.extras or {},
        "site": data.site or "",
        "instagram": data.instagram or "",
        "provider_id": data.provider_id or "",
        "model": data.model or "",
        "delay_seconds": int(data.delay_seconds or 0),
        "queue_ids": data.queue_ids or [],
        "is_active": data.is_active if data.is_active is not None else True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.ai_agents.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@router.put("/agents/{agent_id}")
async def update_agent(
    agent_id: str,
    data: AgentUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    update = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="Sem dados para atualizar")
    res = await db.ai_agents.update_one(
        {"id": agent_id, "company_id": user["company_id"]},
        {"$set": update}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Agente nao encontrado")
    return await db.ai_agents.find_one({"id": agent_id}, {"_id": 0})


@router.delete("/agents/{agent_id}")
async def delete_agent(
    agent_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    res = await db.ai_agents.delete_one({"id": agent_id, "company_id": user["company_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Agente nao encontrado")
    return {"message": "Agente removido"}


class AgentTestRequest(BaseModel):
    message: str
    history: Optional[List[dict]] = None


@router.post("/agents/{agent_id}/test")
async def test_agent(
    agent_id: str,
    body: AgentTestRequest,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    """Send a test message to the agent and get a response (single-turn)."""
    agent = await db.ai_agents.find_one(
        {"id": agent_id, "company_id": user["company_id"]}, {"_id": 0}
    )
    if not agent:
        raise HTTPException(status_code=404, detail="Agente nao encontrado")

    p = agent.get("personality", {}) or {}
    products = "\n".join([f"- {x.get('name','')}: {x.get('description','')}" for x in agent.get("products", []) or []]) or ""
    faq = "\n".join([f"Q: {x.get('q','')}\nA: {x.get('a','')}" for x in agent.get("faq", []) or []]) or ""
    objections = "\n".join([f"Q: {x.get('q','')}\nA: {x.get('a','')}" for x in agent.get("objections", []) or []]) or ""

    system = f"""Voce e {p.get('name', agent.get('name',''))}, {p.get('bio','')}.
Tom: {p.get('tone','Profissional')}.
Empresa: {p.get('company_about','')}.
Objetivo: {p.get('main_goal','')}.
Saudacao padrao: {p.get('greeting','')}

Expertise: {p.get('expertise','')}

Produtos/Servicos:
{products}

FAQ:
{faq}

Objecoes:
{objections}

Responda em portugues brasileiro, de forma direta e util."""

    from emergentintegrations.llm.chat import LlmChat, UserMessage
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY nao configurada")

    model = agent.get("model") or "gpt-4o-mini"
    provider_type = "openai"
    if agent.get("provider_id"):
        prov = await db.ai_providers.find_one({"id": agent["provider_id"]}, {"_id": 0, "type": 1})
        if prov and prov.get("type"):
            provider_type = prov["type"] if prov["type"] != "emergent" else "openai"

    try:
        chat = LlmChat(
            api_key=api_key,
            session_id=f"test-{agent_id}-{user['id']}",
            system_message=system
        ).with_model(provider_type, model)
        ans = await chat.send_message(UserMessage(text=body.message))
        return {"response": ans, "agent": agent.get("name")}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro: {str(e)}")
