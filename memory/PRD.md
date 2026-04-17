# PRD - AgentCRM & Booking System

## Original Problem Statement
Multi-tenant SaaS platform (PWA mobile + modal PC) with:
- Super Admin panel for selling CRM and Scheduling tools
- CRM Module: FlowBuilder, Kanban, Omnichannel Chat, AI Agent, WhatsApp
- Scheduling Module: Services, Subscriptions, Professionals, Public Booking, Calendar
- Indoor TV display for waiting rooms
- Smart availability: Establishment Hours > Professional Hours > Suspensions

## Core Architecture
- React Frontend + FastAPI Backend + MongoDB
- Multi-tenant with company_id in JWT
- Feature-flagged sidebar based on Business Type

## Current State
- Super Admin: admin@agentcrm.com / admin123
- 1 Company: Boss (admin@boss.com.br / boss123, subdomain: boss)
- Public booking at /:slug (e.g., /boss) - no /booking/ prefix
- Indoor TV at /indoor/:slug

## Implemented Features

### Phase 1 - Foundation
- [x] JWT Auth, Landing Page, PWA
- [x] Super Admin: Dashboard, Companies CRUD, Business Types CRUD
- [x] Dynamic Company Dashboard with feature-flagged sidebar

### Phase 2 - CRM
- [x] Atendimentos (Omnichannel 3-column inbox)
- [x] FlowBuilder visual (React Flow, 5 node types)
- [x] Kanban Drag-and-Drop
- [x] WhatsApp Connections UI (MOCKED backend)
- [x] Agente IA com GPT-5.2 (Emergent LLM Key)
- [x] Quick Responses, Campaigns, Tags pages

### Phase 3 - Scheduling
- [x] Services & Products CRUD with photo upload
- [x] Professionals CRUD with photo, commission, working hours, suspensions
- [x] Subscriptions / Recurring billing
- [x] Onboarding Wizard
- [x] Meu Site: Logo/Banner upload, color config, subdomain config
- [x] Indoor TV display (public route, media rotation)
- [x] CalendarPageFull with calendar grid + list toggle
- [x] Business hours management in ConfigPage
- [x] Hierarchical availability (Establishment > Professional > Suspensions)

### Phase 4 - Mobile & Auth
- [x] Super Admin mobile responsive sidebar
- [x] Separate Admin login page at /admin-login (dark theme)
- [x] Removed Super Admin checkbox from regular login
- [x] Subdomain auto-generated from company name
- [x] Direct /:slug access (removed /booking/ prefix)
- [x] DB cleanup - only Boss company

### Phase 5 - Code Quality
- [x] Array index keys fixed (11 instances)
- [x] useMemo/useCallback for expensive computations
- [x] server.py startup refactored into helper functions
- [x] smart-availability refactored into 5 helper functions

## Backlog

### P0
- [ ] WhatsApp real integration (Baileys Node.js microservice)

### P1
- [ ] WhatsApp message scheduling ("Agendamento" in CRM module)
- [ ] Chat interno em tempo real
- [ ] Pagamentos (Stripe)

### P2
- [ ] Notificacoes push nativas
- [ ] Relatorios avancados com graficos

## Key Routes
- `/landing` - Landing page de vendas
- `/admin-login` - Super Admin login (dark)
- `/login` - Company user login
- `/register` - New company registration
- `/super-admin` - Super Admin Dashboard
- `/app` - Company Dashboard
- `/:slug` - Public booking (e.g., /boss)
- `/indoor/:slug` - Indoor TV display
