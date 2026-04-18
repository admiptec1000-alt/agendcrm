# PRD - AgentCRM & Booking System

## Current State
- Super Admin: admin@agentcrm.com / admin123 → /admin-login
- Boss Company: admin@boss.com.br / boss123 → /boss/login → /boss/painel

## All Implemented Features
- Multi-tenant SaaS com JWT Auth, PWA, Landing Page
- Super Admin: Dashboard, Companies, Business Types, Subdomain
- CRM: Atendimentos, FlowBuilder, Kanban, AI Agent, Quick Responses
- **Header com usuario logado** top-right + dropdown Suspender Agenda / Sair
- **Agenda page**: Lista de agendamentos com filtros (Hoje/Pendentes/Confirmados/Concluidos/Todos), Confirmar/Concluir com pagamento/Cancelar
- **Calendario**: 3 views - Mensal (grid), Semanal (timeline), Diario (hora-a-hora)
- **Financeiro dinamico**: Filtros por data, profissional, forma de pagamento
- **Clientes moderno**: Cards, busca, editar/excluir, agendar direto do cliente
- Concluir com 4 formas pagamento (Dinheiro/PIX/Credito/Debito), registra transacao
- Perfis de Permissao CRUD
- Conexoes (WhatsApp/Instagram), Message Templates com variaveis
- Chat Interno com canais e polling
- Meus Agendamentos (publico por telefone)
- URLs com subdominio, Login por empresa, Indoor TV

## Backlog
### P0
- [ ] WhatsApp real integration (Evolution API/Baileys)
### P1
- [ ] Aplicar permissoes no login do profissional
- [ ] Message delivery engine
### P2
- [ ] Stripe, Notificacoes push, Relatorios graficos
