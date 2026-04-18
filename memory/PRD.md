# PRD - AgentCRM & Booking System

## Current State
- Super Admin: admin@agentcrm.com / admin123 → /admin-login
- Boss Company: admin@boss.com.br / boss123 → /boss/login → /boss/painel

## All Implemented Features
- Multi-tenant SaaS, JWT Auth, PWA, Landing Page
- Super Admin: Companies, Business Types, Subdomain
- CRM: Atendimentos, FlowBuilder, Kanban, AI Agent (GPT-5.2)
- **Header com usuario** top-right + Suspender Agenda + Sair
- **Agenda page**: Lista com filtros (Hoje/Pendentes/Confirmados/Concluidos/Todos), Confirmar/Concluir com pagamento/Cancelar
- **Calendario**: Mensal/Semanal/Diario views
- **Financeiro dinamico**: Filtros data, profissional, forma pagamento
- **Clientes moderno**: Cards, editar/excluir, agendar direto
- **Concluir com pagamento**: 4 formas (Dinheiro/PIX/Credito/Debito), registra financeiro
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

## Backlog
### P1
- [ ] Aplicar permissoes no login profissional (filtrar dados)
- [ ] Message delivery engine (processar scheduled messages)
### P2
- [ ] Stripe, Notificacoes push, Relatorios graficos
