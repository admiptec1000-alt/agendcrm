# PRD - AgentCRM & Booking System

## Current State
- Super Admin: admin@agentcrm.com / admin123 → /admin-login
- Boss Company: admin@boss.com.br / boss123 → /boss/login → /boss/painel

## All Implemented Features
- Multi-tenant SaaS, JWT Auth, PWA, Landing Page
- Super Admin: Companies, Business Types, Subdomain
- CRM: Atendimentos, FlowBuilder, Kanban, AI Agent (GPT-5.2)
- **Header**: usuário top-right + Suspender Agenda (3 modos: Dias / Dia Inteiro / Horas) + Sair
- **Logo global (Configurações)**: upload único, refletido em header, sidebar, site público e TV
- **Agenda page**: Lista com filtros (Hoje/Pendentes/Confirmados/Concluidos/Todos), Confirmar/Concluir com pagamento/Cancelar
- **Calendario**: Mensal/Semanal/Diario views
- **Financeiro dinamico**: Filtros data, profissional, forma pagamento
- **Clientes**: Accordion inline — expande para histórico + botão Agendar rápido com formulário inline
- **Concluir com pagamento**: 4 formas (Dinheiro/PIX/Credito/Debito), registra financeiro
- **Permissões de Profissional**: não-admin vê apenas agendamentos do próprio profissional (vinculado por email). Fail-closed.
- **Meu Site**: mobile-first, sem cortes, URLs truncadas com cópia/visualização
- **Suspensão de Agenda**: Dias (intervalo), Dia Inteiro (único), Algumas Horas (intervalo horário) — backend persiste start_time/end_time
- **Perfis de Permissao**: CRUD
- **WhatsApp Baileys (P0)**: Microservico Node.js port 3002, QR Code REAL, send/receive, webhooks
- **Conexoes**: WhatsApp/Instagram, QR polling real, ConnectionCard component
- **Message Templates**: 6 processos com variaveis, persistido MongoDB
- **Chat Interno**: Canais, polling 5s
- Meus Agendamentos (publico), Indoor TV, Mobile responsive

## Architecture
- FastAPI backend (port 8001)
- React frontend (port 3000)
- WhatsApp Baileys service (port 3002) - Node.js
- MongoDB
- All supervised

## Recent Changes (Feb 2026)
- [x] Renamed "Dashboard" → "Início"
- [x] Global logo upload in Configurações (Logomarca Global)
- [x] Logo displayed in sidebar + header (desktop)
- [x] MySite page mobile-responsive (no overflow)
- [x] Clients page: inline accordion expansion (replaces side panel)
- [x] SuspensionCreate model extended with start_time/end_time
- [x] list_appointments auto-filters non-admin users by their professional (fail-closed)

## Backlog
### P1
- [ ] Message delivery engine (processar scheduled messages)
- [ ] Professional role: dedicated role + UI to link company_user to professional record
### P2
- [ ] Stripe payment integration
- [ ] Notificações push
- [ ] Relatórios gráficos (charts)
- [ ] Refatorar Dashboard.js monolítico (>2500 linhas) em arquivos separados

## Known Minor Issues (non-blocking)
- Inline booking form uses HTML5 native date/time pickers (desktop browser default)
- Services `<option>` dropdown has React hydration warning (span inside option)
