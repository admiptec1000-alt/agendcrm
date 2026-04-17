# PRD - AgentCRM & Booking System

## Current State
- Super Admin: admin@agentcrm.com / admin123 → /admin-login
- 1 Company: Boss (admin@boss.com.br / boss123) → /boss/login → /boss/painel
- Public booking: /boss/agenda | Indoor TV: /boss/indoor

## URL Structure
- `/landing` - Landing page de vendas
- `/admin-login` - Super Admin login
- `/:slug/login` - Login personalizado por empresa
- `/:slug/agenda` - Pagina publica de agendamento
- `/:slug/indoor` - Indoor TV
- `/:slug/painel` - Painel da empresa (dashboard)
- `/super-admin` - Painel Super Admin

## Implemented Features
- [x] JWT Auth, Landing Page, PWA
- [x] Super Admin: Dashboard, Companies CRUD, Business Types CRUD, Subdomain config
- [x] Dynamic Company Dashboard with feature-flagged sidebar
- [x] CRM: Atendimentos, FlowBuilder, Kanban, AI Agent
- [x] Scheduling: Services, Professionals, Subscriptions, Calendar modernizado
- [x] CalendarPageFull (calendar+sidebar, status management, view toggle)
- [x] Menu Calendario + Menu Agendamento (message scheduling)
- [x] Company-branded login pages (/:slug/login)
- [x] URLs com subdominio (/:slug/painel ao inves de /app)
- [x] Meus Agendamentos - busca por telefone na pagina publica + cancelamento
- [x] Bug fix: cliente criado automaticamente ao agendar pelo publico
- [x] Conexoes page: WhatsApp/Instagram connections + message templates com variaveis
- [x] MySitePage: sem config de subdominio (so Super Admin), mostra 3 links
- [x] Badge "Made with Emergent" oculta via CSS
- [x] Indoor TV display
- [x] Mobile responsive

## Mocked
- WhatsApp/Instagram connections (frontend state only)
- Message templates (frontend state only)
- Stripe payments

## Backlog
### P0
- [ ] WhatsApp real integration (Baileys)
- [ ] Persist message templates in backend
### P1
- [ ] Message scheduling backend persistence
- [ ] Chat interno em tempo real
- [ ] Pagamentos (Stripe)
### P2
- [ ] Notificacoes push, Relatorios avancados
