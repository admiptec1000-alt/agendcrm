# PRD - AgentCRM & Booking System

## Current State
- Super Admin: admin@agentcrm.com / admin123 → /admin-login
- Boss Company: admin@boss.com.br / boss123 → /boss/login → /boss/painel

## All Implemented Features
- Multi-tenant SaaS, JWT Auth, PWA, Landing Page
- **PWA Dinâmico**: manifest e favicon personalizados por empresa
- Super Admin: Companies, Business Types, Subdomain, features por tipo de negócio
- CRM: Atendimentos, FlowBuilder, Kanban, AI Agent (GPT-5.2)
- **Início**: menu clicável (grid de atalhos) + 4 stat cards
- **Logo global (Configurações)**: reflete em header, sidebar, site público, TV, PWA manifest e favicon
- **Agenda page**:
  - Lista com filtros, Confirmar/Concluir com pagamento/Cancelar
  - **EDITAR agendamento**: alterar data/hora/serviço, adicionar itens extras (serviços/produtos), alterar valor (com permissão)
  - **Concluir com valor final**: permite override do valor (com permissão)
  - Permissões `edit_appointment` e `edit_appointment_price` granulares por perfil
- **Calendario**: Mensal/Semanal/Diario
- **Financeiro dinamico**: Filtros data, profissional, forma pagamento
- **Clientes**: Accordion inline, auto-book ao criar novo
- **Permissões Profissional**: não-admin vê apenas próprios agendamentos. Fail-closed
- **Suspensão de Agenda**:
  - Modal dedicado em cada card (dias OU horas específicas)
  - **FIX**: suspensão por horas bloqueia APENAS o intervalo (não o dia inteiro)
- **Usuarios (Admin)**: CRUD de usuários com email/senha/perfil/profissional vinculado
- **Perfis de Acesso**: CRUD com 31 permissões agrupadas por categoria (incluindo Permissoes granulares)
- **Profissional como Usuário**: toggle no cadastro gera company_user linkado
- **WhatsApp Baileys**: Microservice Node.js porta 3002
- **Conexoes, Message Templates, Chat Interno**: Ver iterações anteriores
- Site público, Indoor TV, Mobile responsive

## Architecture
- FastAPI backend (port 8001)
- React frontend (port 3000)
- WhatsApp Baileys service (port 3002) - Node.js
- MongoDB
- All supervised

## Recent Changes (Feb 2026)
- [x] Typo "Servico" → "Serviço" na tela pública de agendamento
- [x] BUG FIX: suspensão por horas considera o intervalo (não mais dia inteiro)
- [x] Editar agendamento: data, hora, serviço, itens extras, valor
- [x] Concluir com valor final opcional (override)
- [x] Permissões granulares `edit_appointment` e `edit_appointment_price`
- [x] Login + /me retornam user.permissions (['*'] admin, lista scoped user)
- [x] Auto-fill de price em troca de serviço respeita permissão do usuário

## Backlog
### P1
- [ ] Message delivery engine (scheduled messages)
- [ ] Validar permission_profile_id/professional_id da mesma company no POST /company-users
- [ ] Bloquear self-delete em /company-users
### P2
- [ ] Stripe payment integration
- [ ] Notificações push
- [ ] Relatórios gráficos
- [ ] Refatorar scheduling_routes.py e Dashboard.js (arquivos monolíticos)
- [ ] Mover ALL_SYSTEM_FEATURES para módulo dedicado
- [ ] Substituir HTML5 date/time pickers por shadcn Calendar
