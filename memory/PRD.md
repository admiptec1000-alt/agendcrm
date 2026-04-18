# PRD - AgentCRM & Booking System

## Current State
- Super Admin: admin@agentcrm.com / admin123 → /admin-login
- Boss Company: admin@boss.com.br / boss123 → /boss/login → /boss/painel

## Implemented Features
- [x] Multi-tenant SaaS com JWT Auth, Landing Page, PWA
- [x] Super Admin: Dashboard, Companies CRUD, Business Types, Subdomain
- [x] CRM: Atendimentos, FlowBuilder, Kanban, AI Agent, Quick Responses
- [x] Scheduling: Services, Professionals, Subscriptions, Calendar
- [x] **ClientsPage moderna**: Card-based, busca, sidebar detalhe, booking direto, editar/excluir
- [x] **Concluir com Pagamento**: Modal 4 formas (Dinheiro/PIX/Credito/Debito), registra transacao financeira
- [x] **Financeiro moderno**: Breakdown por forma de pagamento com barras, lista transacoes, resumo
- [x] **Perfis de Permissao**: CRUD (ver_proprios_atendimentos, concluir_atendimento, registrar_pagamento)
- [x] Conexoes (WhatsApp/Instagram), Message Templates, Scheduled Messages
- [x] Chat Interno com canais e polling
- [x] Meus Agendamentos (público por telefone)
- [x] URLs com subdomínio, Login por empresa, Indoor TV

## Backlog
### P0
- [ ] WhatsApp real integration (Baileys)
### P1
- [ ] Aplicar permissões no login do profissional (filtrar dados por permissão)
- [ ] Message delivery engine
### P2
- [ ] Stripe, Notificações push, Relatórios avançados
