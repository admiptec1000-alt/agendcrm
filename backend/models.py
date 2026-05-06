from pydantic import BaseModel, Field, EmailStr, field_validator
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum

class UserRole(str, Enum):
    SUPER_ADMIN = "super_admin"
    COMPANY_ADMIN = "company_admin"
    AGENT = "agent"
    USER = "user"

class PlanType(str, Enum):
    CRM = "crm"
    SCHEDULING = "scheduling"
    BOTH = "both"

class CompanyStatus(str, Enum):
    ACTIVE = "active"
    TRIAL = "trial"
    BLOCKED = "blocked"

class TicketStatus(str, Enum):
    EM_COBRANCA = "em_cobranca"
    PAGO = "pago"
    BLOQUEADO = "bloqueado"
    PROPOSTA = "proposta"
    ABERTO = "aberto"
    FECHADO = "fechado"

class AppointmentStatus(str, Enum):
    CONFIRMADO = "confirmado"
    CANCELADO = "cancelado"
    CONCLUIDO = "concluido"
    PENDENTE = "pendente"

class ServiceType(str, Enum):
    SERVICE = "service"
    PRODUCT = "product"
    SUBSCRIPTION = "subscription"

# Business Type Models
class FeaturePermission(BaseModel):
    feature_key: str
    enabled: bool
    label: str
    category: str  # crm, scheduling, shared

class BusinessTypeCreate(BaseModel):
    name: str
    description: Optional[str] = None
    icon: Optional[str] = None
    base_type: PlanType  # crm, scheduling, both
    features: List[Dict[str, Any]] = []  # Lista de features habilitadas
    mobile_bottom_nav: List[str] = []    # Até 4 feature_keys para barra inferior mobile
    # Billing & limits — embedded so the Tipo de Negócio fully describes
    # both feature permissions AND commercial terms. When a company is
    # assigned this BT, invoices are auto-generated from these fields.
    monthly_price: float = 0.0
    billing_cycle: str = "monthly"   # monthly | yearly | one_time
    installments: int = 1
    grace_days: int = 5
    max_connections: int = 1
    max_users: int = 1

class BusinessTypeUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    base_type: Optional[PlanType] = None
    features: Optional[List[Dict[str, Any]]] = None
    mobile_bottom_nav: Optional[List[str]] = None
    is_active: Optional[bool] = None
    monthly_price: Optional[float] = None
    billing_cycle: Optional[str] = None
    installments: Optional[int] = None
    grace_days: Optional[int] = None
    max_connections: Optional[int] = None
    max_users: Optional[int] = None

# Auth Models
class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    password: str
    company_name: Optional[str] = None
    business_type_id: Optional[str] = None  # ID do tipo de negócio
    plan_type: PlanType = PlanType.BOTH

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: Dict[str, Any]

# Company Models
class ThemeColors(BaseModel):
    primary: str = "#4F46E5"
    secondary: str = "#10B981"
    accent: str = "#F43F5E"

class CompanyCreate(BaseModel):
    name: str
    cnpj: Optional[str] = None
    email: EmailStr
    phone: Optional[str] = None
    plan_type: PlanType
    business_type_id: Optional[str] = None  # ID do tipo de negócio
    plan_id: Optional[str] = None  # ID of the subscription plan (drives auto-invoicing)
    theme_colors: Optional[ThemeColors] = None
    admin_name: str
    admin_email: EmailStr
    admin_password: str
    subdomain: Optional[str] = None

class CompanyUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    cnpj: Optional[str] = None
    status: Optional[CompanyStatus] = None
    plan_type: Optional[PlanType] = None
    business_type_id: Optional[str] = None
    plan_id: Optional[str] = None
    theme_colors: Optional[ThemeColors] = None
    subdomain: Optional[str] = None

class CompanyResponse(BaseModel):
    id: str
    name: str
    email: str
    phone: Optional[str] = None
    status: CompanyStatus
    plan_type: PlanType
    business_type_id: Optional[str] = None
    theme_colors: ThemeColors
    logo_url: Optional[str] = None
    created_at: str

# Ticket Models
class TicketCreate(BaseModel):
    customer_name: str
    customer_phone: str
    customer_email: Optional[EmailStr] = None
    status: TicketStatus = TicketStatus.ABERTO
    priority: str = "medium"
    channel: str = "web"
    description: Optional[str] = None
    tags: Optional[List[str]] = None
    value: Optional[float] = 0.0

    @field_validator("customer_email", mode="before")
    @classmethod
    def _empty_email_to_none(cls, v):
        if v in ("", None) or (isinstance(v, str) and not v.strip()):
            return None
        return v

class TicketUpdate(BaseModel):
    status: Optional[TicketStatus] = None
    assigned_to: Optional[str] = None
    priority: Optional[str] = None
    description: Optional[str] = None
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_email: Optional[str] = None
    channel: Optional[str] = None
    tags: Optional[List[str]] = None
    value: Optional[float] = None
    queue_id: Optional[str] = None
    connection_id: Optional[str] = None
    kanban_column_id: Optional[str] = None
    client_id: Optional[str] = None

class MessageCreate(BaseModel):
    content: str
    sender_type: str  # user, agent, system, ai

# Appointment Models
class AppointmentCreate(BaseModel):
    customer_name: str
    customer_phone: str
    customer_email: Optional[EmailStr] = None
    service_id: str
    professional_id: str
    date: str  # YYYY-MM-DD
    time: str  # HH:MM
    notes: Optional[str] = None
    use_subscription: Optional[bool] = False

class AppointmentUpdate(BaseModel):
    status: Optional[AppointmentStatus] = None
    date: Optional[str] = None
    time: Optional[str] = None
    notes: Optional[str] = None
    payment_method: Optional[str] = None  # dinheiro, pix, cartao_debito, cartao_credito
    payment_status: Optional[str] = None  # pendente, pago
    service_id: Optional[str] = None
    price: Optional[float] = None
    extra_items: Optional[List[Dict[str, Any]]] = None  # [{service_id, name, price, type}]

# Service Models
class ServiceCreate(BaseModel):
    name: str
    description: Optional[str] = None
    category_id: Optional[str] = None
    type: ServiceType = ServiceType.SERVICE
    duration: int  # em minutos
    price: float
    cost: Optional[float] = None  # custo unitario; comissao incide sobre (price - cost)
    image_url: Optional[str] = None
    commission_percent: Optional[float] = None  # se None, usa o do profissional

class ServiceUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    category_id: Optional[str] = None
    duration: Optional[int] = None
    price: Optional[float] = None
    cost: Optional[float] = None
    is_active: Optional[bool] = None
    image_url: Optional[str] = None
    commission_percent: Optional[float] = None

# Professional Models
class ProfessionalCreate(BaseModel):
    name: str
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    specialties: List[str] = []
    working_hours: Optional[Dict[str, Any]] = None
    image_url: Optional[str] = None

class ProfessionalUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    specialties: Optional[List[str]] = None
    working_hours: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None
    image_url: Optional[str] = None
    commission_percent: Optional[float] = None

# Category Models
class CategoryCreate(BaseModel):
    name: str
    description: Optional[str] = None

# Booking Page Models
class BookingPageUpdate(BaseModel):
    logo_url: Optional[str] = None
    banner_url: Optional[str] = None
    primary_color: Optional[str] = None
    secondary_color: Optional[str] = None
    seo_title: Optional[str] = None
    seo_description: Optional[str] = None
    custom_domain: Optional[str] = None
    slug: Optional[str] = None
    show_email_field: Optional[bool] = None

# Quick Response Models
class QuickResponseCreate(BaseModel):
    title: str
    content: str
    shortcut: Optional[str] = None

# Campaign Models
class CampaignAntiBlock(BaseModel):
    """Anti-block / human-like sending policies."""
    enabled: bool = True
    interval_min_seconds: int = 30      # min delay between two messages
    interval_max_seconds: int = 90      # max delay between two messages
    burst_size: int = 50                # after N messages...
    burst_pause_seconds: int = 300      # ...pause this long
    daily_limit: int = 250              # max messages per 24h window
    hourly_limit: int = 50              # max messages per hour
    escalate_after: int = 100           # after N msgs, increase interval
    escalate_factor: float = 1.5        # multiplier applied to min/max
    only_with_phone_validated: bool = True


class CampaignCreate(BaseModel):
    name: str
    type: str = "broadcast"  # broadcast | drip
    # Audience selection (one mode):
    audience_mode: str = "tags"  # tags | list | no_tag | all
    tag_ids: Optional[List[str]] = None         # when audience_mode == tags
    contact_list_id: Optional[str] = None       # when audience_mode == list
    # Channel + scheduling
    connection_id: Optional[str] = None
    scheduled_at: Optional[str] = None  # ISO datetime; null = send now
    confirmation_enabled: bool = False
    # Ticket auto-creation upon delivery
    open_ticket: bool = False
    assigned_user_id: Optional[str] = None
    queue_id: Optional[str] = None
    ticket_status: Optional[str] = "fechado"
    # Messages (1..5 sequential)
    messages: List[str] = []
    attachment_url: Optional[str] = None
    # Anti-block parameters
    anti_block: Optional[CampaignAntiBlock] = None
    # Legacy fields (kept for backwards compatibility)
    message_template: Optional[str] = None
    target_audience: Optional[str] = None


class CampaignUpdate(BaseModel):
    name: Optional[str] = None
    audience_mode: Optional[str] = None
    tag_ids: Optional[List[str]] = None
    contact_list_id: Optional[str] = None
    connection_id: Optional[str] = None
    scheduled_at: Optional[str] = None
    confirmation_enabled: Optional[bool] = None
    open_ticket: Optional[bool] = None
    assigned_user_id: Optional[str] = None
    queue_id: Optional[str] = None
    ticket_status: Optional[str] = None
    messages: Optional[List[str]] = None
    attachment_url: Optional[str] = None
    anti_block: Optional[CampaignAntiBlock] = None
    status: Optional[str] = None  # draft | programada | em_execucao | concluida | cancelada

# AI Chat Models
class AIChatRequest(BaseModel):
    ticket_id: str
    message: str
    session_id: Optional[str] = None

class AIChatResponse(BaseModel):
    response: str
    session_id: str

# Flow Builder Models
class FlowCreate(BaseModel):
    name: str
    description: Optional[str] = None
    nodes: List[Dict[str, Any]] = []
    edges: List[Dict[str, Any]] = []
    trigger_type: Optional[str] = None

class FlowUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    nodes: Optional[List[Dict[str, Any]]] = None
    edges: Optional[List[Dict[str, Any]]] = None
    is_active: Optional[bool] = None
