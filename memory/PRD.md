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

## Implemented Features

### Phase 1 - Foundation (2026-04-15)
- [x] JWT Auth (login, register, super admin)
- [x] Landing Page, PWA config (manifest, service worker)
- [x] Super Admin: Dashboard, Companies CRUD, Business Types CRUD
- [x] Dynamic Company Dashboard with feature-flagged sidebar

### Phase 2 - CRM (2026-04-15)
- [x] Atendimentos (Omnichannel 3-column inbox)
- [x] FlowBuilder visual (React Flow, 5 node types)
- [x] Kanban Drag-and-Drop
- [x] WhatsApp Connections UI (MOCKED backend)
- [x] Agente IA com GPT-5.2 (Emergent LLM Key)
- [x] Quick Responses, Campaigns, Tags pages

### Phase 3 - Scheduling (2026-04-15)
- [x] Services & Products CRUD with photo upload
- [x] Professionals CRUD with photo upload, commission
- [x] Subscriptions / Recurring billing
- [x] Onboarding Wizard (4 steps)
- [x] Meu Site: Logo/Banner upload, color config
- [x] Indoor TV display (public route, media rotation)

### Phase 4 - Scheduling Enhancements (2026-04-16)
- [x] CalendarPageFull with calendar grid + list toggle
- [x] Service editing with photo and status
- [x] Professional working hours editing (per day)
- [x] Professional suspensions (add/remove folgas)
- [x] Business hours management in ConfigPage
- [x] Subdomain/Custom domain configuration for booking page
- [x] Public BookingPage shows service & professional photos
- [x] Hierarchical availability logic (Establishment > Professional > Suspensions) in backend

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
- [ ] PWA mobile full optimization

## Key Technical Notes
- All backend endpoints prefixed with /api
- MongoDB _id excluded from responses
- company_id from JWT restricts all tenant data
- Object Storage via Emergent for file uploads
- WhatsApp and Stripe backends are MOCKED
