# PRD - AgentCRM & Booking System

## Current State
- Super Admin: admin@agentcrm.com / admin123 → /admin-login
- Boss Company: admin@boss.com.br / boss123 → /boss/login → /boss/painel

## All Implemented Features
- Multi-tenant SaaS, JWT Auth, PWA, Landing Page
- Super Admin: Companies, Business Types, Subdomain
- CRM: Atendimentos, FlowBuilder, Kanban, AI Agent (GPT-5.2)
- **Header**: usuário top-right + Suspender Agenda + Sair (sem título duplicado nas páginas)
- **Início**: agora é menu clicável (grid de atalhos para todas as páginas habilitadas) + 4 stat cards
- **Logo global (Configurações)**: upload único refletido em header, sidebar, site público e TV
- **Agenda page**: Lista com filtros (Hoje/Pendentes/Confirmados/Concluidos/Todos), Confirmar/Concluir com pagamento/Cancelar
- **Calendario**: Mensal/Semanal/Diario views
- **Financeiro dinamico**: Filtros data, profissional, forma pagamento
- **Clientes**: Accordion inline — expande para histórico + botão Agendar rápido com formulário inline. Ao criar novo cliente, auto-expande e oferece agendamento imediato
- **Concluir com pagamento**: 4 formas (Dinheiro/PIX/Credito/Debito), registra financeiro
- **Permissões de Profissional**: não-admin vê apenas agendamentos do próprio profissional (vinculado por email). Fail-closed
- **Meu Site**: mobile-first, sem cortes, URLs truncadas com cópia/visualização
- **Suspensão de Agenda do Profissional**: modal dedicado em cada card da página Profissionais
  - Modos: Período de dias OU Período do dia (horas)
  - Data início/fim pré-preenchidas com hoje (editáveis)
  - Lista suspensões existentes com opção de remover
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
- [x] Renamed "Dashboard" → "Início" (header + fallback + onboarding)
- [x] Logomarca global em Configurações aplica em todas as interfaces
- [x] MySite page mobile-responsive
- [x] Clients page: inline accordion expansion + auto-book no novo cliente
- [x] SuspensionCreate model extendido com start_time/end_time
- [x] list_appointments auto-filtra non-admin (fail-closed)
- [x] Títulos duplicados removidos de todas as páginas internas
- [x] Tela Início transformada em menu clicável (acesso rápido para todos os módulos)
- [x] Modal dedicado de Suspensão em cada card de Profissional

## Backlog
### P1
- [ ] Vincular `company_users` a `professionals` via UI dedicada (criar role "profissional" + select)
- [ ] Message delivery engine (processar scheduled messages)
### P2
- [ ] Stripe payment integration (requer chave do usuário)
- [ ] Notificações push
- [ ] Relatórios gráficos (charts)
- [ ] Refatorar Dashboard.js (2667 linhas) em arquivos separados
- [ ] Substituir HTML5 date/time pickers por shadcn Calendar/TimePicker
- [ ] Corrigir React hydration warning no dropdown de serviços
