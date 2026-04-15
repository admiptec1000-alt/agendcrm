# PRD - AgentCRM & Booking System

## Problem Statement
Sistema multi-tenant SaaS de CRM e Agendamento com Super Admin que gerencia tipos de negócio configuráveis, empresas com funcionalidades selecionáveis, landing page pública para vendas, e integração WhatsApp.

## Architecture
- **Backend:** FastAPI + MongoDB (Motor async) + JWT Auth
- **Frontend:** React 19 + TailwindCSS + Shadcn/UI + React Router
- **Integrações:** OpenAI GPT-5.2 (Agente IA), Emergent Object Storage, WhatsApp (Baileys - estrutura)
- **Design:** Outfit (headings) + Manrope (body), CSS Variables para temas personalizáveis

## What's Been Implemented (2026-04-15)

### Phase 1 - Core MVP
- [x] Auth JWT (Super Admin + Company Users)
- [x] MongoDB models + CRUD completo
- [x] Landing page de vendas com tipos de negócio
- [x] Login/Register pages

### Phase 2 - Super Admin (Current)
- [x] Dashboard com métricas (Empresas, Ativas, Trial, Tipos)
- [x] Sidebar com navegação (Dashboard, Empresas, Tipos de Negócio, Config)
- [x] CRUD de Empresas com formulário completo (Nome, CNPJ, Email, Telefone)
- [x] Seleção de tipo de negócio ao criar empresa
- [x] Opção "Personalizado" para setup custom de funcionalidades
- [x] CRUD de Tipos de Negócio (nome, base_type, features)
- [x] Configuração de features por tipo (CRM, Scheduling, Shared)
- [x] 4 tipos padrão pré-seedados
- [x] Criação automática de admin + booking page ao criar empresa
- [x] Busca de empresas por nome, CNPJ, email

### Phase 3 - CRM
- [x] Kanban de atendimento (6 colunas)
- [x] CRUD de tickets
- [x] Agente IA com GPT-5.2
- [x] Respostas rápidas, Campanhas, FlowBuilder

### Phase 4 - Agendamento
- [x] Dashboard com stats
- [x] CRUD de agendamentos, serviços, profissionais, categorias
- [x] Página pública de booking (4 steps)

## Prioritized Backlog
### P0 (Next)
- Menu lateral dinâmico nas dashboards de empresa (baseado em features)
- Flowbuilder visual com React Flow
- Implementação completa de cada menu do CRM/Agendamento

### P1
- Integração WhatsApp completa com Baileys
- Sistema de notificações em tempo real
- Upload de logos/banners nas booking pages
- PWA para mobile

### P2
- Relatórios e analytics avançados
- Sistema de pagamentos (Stripe)
- Comissões por profissional
- Chat interno entre usuários
- Automação de lembretes WhatsApp
