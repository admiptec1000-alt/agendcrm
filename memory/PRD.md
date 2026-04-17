# PRD - AgentCRM & Booking System

## Current State
- Super Admin: admin@agentcrm.com / admin123 → /admin-login
- Boss Company: admin@boss.com.br / boss123 → /boss/login → /boss/painel
- Public: /boss/agenda | Indoor: /boss/indoor

## Implemented Features (All Phases)
- [x] JWT Auth, Landing Page, PWA
- [x] Super Admin: Dashboard, Companies CRUD, Business Types, Subdomain config
- [x] Dynamic Company Dashboard with feature-flagged sidebar
- [x] CRM: Atendimentos, FlowBuilder, Kanban, AI Agent (GPT-5.2)
- [x] Scheduling: Services, Professionals, Subscriptions, Calendar modernizado
- [x] CalendarPageFull (calendar+sidebar, status management)
- [x] Company-branded login (/:slug/login), URLs com subdominio
- [x] Meus Agendamentos na pagina publica (busca por telefone + cancelamento)
- [x] **Conexoes (P0)**: WhatsApp/Instagram connections persistidas no MongoDB
- [x] **Message Templates (P0)**: 6 templates com variaveis ({nome},{servico},{data},{hora},{profissional},{empresa},{valor}) persistidos no MongoDB
- [x] **Scheduled Messages (P1)**: Agendamento de mensagens WhatsApp/SMS/Email com CRUD completo, persistido no MongoDB
- [x] **Chat Interno (P1)**: Chat em tempo real com canais, polling 5s, persistido no MongoDB
- [x] Indoor TV, Mobile responsive, Badge Emergent oculta

## Mocked (Awaiting Real Integration)
- WhatsApp message delivery (QR code simulado)
- Instagram connection
- Stripe payments

## Backlog
### P0
- [ ] WhatsApp real integration (Baileys - send/receive messages)
### P1
- [ ] Actual message delivery engine (process scheduled messages)
### P2
- [ ] Notificacoes push, Relatorios avancados, Stripe
