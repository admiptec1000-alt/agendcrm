# PRD - AgentCRM & Booking System

## Problem Statement
Sistema multi-tenant SaaS de CRM e Agendamento com Super Admin, tipos de negocio configuraveis, menu dinamico por empresa, FlowBuilder visual, e integracao WhatsApp.

## Architecture
- Backend: FastAPI + MongoDB (Motor async) + JWT Auth
- Frontend: React 19 + TailwindCSS + Shadcn/UI + React Router + React Flow
- Integracoes: OpenAI GPT-5.2 (Agente IA), Emergent Object Storage, WhatsApp (Baileys)
- Design: Outfit + Manrope, CSS Variables para temas

## Implemented (2026-04-15)

### Phase 1 - Core
- [x] Auth JWT (Super Admin + Company Users)
- [x] Landing page de vendas com tipos de negocio
- [x] Login/Register

### Phase 2 - Super Admin
- [x] Dashboard com metricas
- [x] CRUD Empresas com formulario completo + tipo de negocio
- [x] CRUD Tipos de Negocio com features configuraveis
- [x] Setup personalizado para clientes custom
- [x] 4 tipos padrao seedados

### Phase 3 - Company Dashboard
- [x] Menu lateral dinamico baseado nas features do tipo de negocio
- [x] Sidebar colapsavel
- [x] Todas as paginas CRM: Dashboard, Atendimentos, Kanban, Respostas Rapidas, Contatos, Tags, Chat Interno, Campanhas, FlowBuilder, Informativos, Filas & Chatbot, Conexoes WhatsApp, Agente IA, API, Usuarios
- [x] Todas as paginas Agendamento: Calendario, Agendamentos, Clientes, Categorias, Servicos e Produtos, Assinaturas, Profissionais, Financeiro, Comissoes, Meu Site, Notificacoes, Configuracoes, Relatorios

### Phase 4 - FlowBuilder
- [x] Canvas visual com React Flow
- [x] 5 tipos de nos: Gatilho, Mensagem, Condicao, Espera, Acao
- [x] Toolbar para adicionar nos
- [x] Conexoes entre nos com labels (Sim/Nao)
- [x] Salvar fluxo no backend

### Phase 5 - WhatsApp
- [x] Pagina de Conexoes com placeholder QR Code
- [x] Backend preparado para Baileys

## Backlog
### P0 (Lembrete: Onboarding Wizard)
- [ ] Onboarding Wizard no primeiro login da empresa
- [ ] WhatsApp real com Baileys (Node.js microservice)
- [ ] Drag and drop no Kanban

### P1
- [ ] Chat interno em tempo real
- [ ] Notificacoes push
- [ ] Upload de logos/banners
- [ ] PWA para mobile

### P2
- [ ] Pagamentos (Stripe)
- [ ] Relatorios avancados
- [ ] Automacao de lembretes WhatsApp
