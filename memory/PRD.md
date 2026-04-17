# PRD - AgentCRM & Booking System

## Current State
- Super Admin: admin@agentcrm.com / admin123 → /admin-login
- 1 Company: Boss (admin@boss.com.br / boss123) → /boss/login
- Public booking: /boss/agenda | Indoor TV: /boss/indoor

## URL Structure
- `/landing` - Landing page de vendas
- `/admin-login` - Super Admin login (dark)
- `/:slug/login` - Login personalizado por empresa
- `/:slug/agenda` - Pagina publica de agendamento
- `/:slug/indoor` - Indoor TV
- `/super-admin` - Painel Super Admin
- `/app` - Painel da empresa

## Implemented Features
- [x] JWT Auth, Landing Page, PWA
- [x] Super Admin: Dashboard, Companies CRUD, Business Types CRUD
- [x] Dynamic Company Dashboard with feature-flagged sidebar
- [x] CRM: Atendimentos, FlowBuilder, Kanban, WhatsApp (MOCK), AI Agent
- [x] Scheduling: Services, Professionals, Subscriptions, Calendar
- [x] CalendarPageFull modernized (calendar+sidebar, status management, view toggle)
- [x] Menu Calendario (visual calendar) + Menu Agendamento (message scheduling)
- [x] Company-branded login pages (/:slug/login)
- [x] Subdomain auto-generated from company name
- [x] Indoor TV display with appointment info
- [x] MySitePage shows 3 links (Agenda, Login, Indoor)
- [x] Mobile responsive (Super Admin + Company Dashboard)

## Bug Fixes
- [x] White screen on booking with empty email - fixed by removing empty email from payload

## Backlog
### P0
- [ ] WhatsApp real integration (Baileys)
### P1
- [ ] Message scheduling backend persistence
- [ ] Chat interno em tempo real
- [ ] Pagamentos (Stripe)
### P2
- [ ] Notificacoes push, Relatorios avancados
