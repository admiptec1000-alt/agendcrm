# PRD - AgentCRM & Booking System

## Current State
- Super Admin: admin@agentcrm.com / admin123 → /admin-login
- Boss Company: admin@boss.com.br / boss123 → /boss/login → /boss/painel

## All Implemented Features
- Multi-tenant SaaS, JWT Auth, PWA dinâmico (manifest + favicon por empresa)
- Super Admin: Companies, Business Types, Subdomain
- CRM: Atendimentos, FlowBuilder, Kanban, AI Agent (GPT-5.2)
- **Início**: menu clicável + 4 stat cards
- **Logo global**: sidebar, header, site público, TV, PWA
- **Agenda page**:
  - Lista com filtros, Confirmar/Concluir com pagamento/Cancelar
  - **Editar**: data/hora/serviço, adicionar itens extras, alterar valor (c/ permissão)
  - **Concluir com valor final** (override com permissão)
  - Permissões granulares `edit_appointment` e `edit_appointment_price`
- **Calendário**: Mensal/Semanal/Diário
- **Financeiro**: Filtros data/profissional/pagamento
- **Clientes**:
  - Accordion inline, auto-book ao criar novo
  - **Form modernizado** com avatar preview, ícones, máscara telefone, idade em tempo real
  - **Data de nascimento** + chip 🎂 quando aniversário ≤ 30 dias
- **Permissões Profissional**: não-admin vê apenas próprios agendamentos (fail-closed)
- **Suspensão de Agenda**: Modal dedicado, dias OU horas (hour-window só bloqueia o intervalo)
- **Usuários + Perfis de Acesso**: CRUD com 31 permissões agrupadas
- **Profissional como Usuário**: toggle vincula company_user
- **WhatsApp Baileys** (porta 3002):
  - QR Code real com **self-heal** — auto-reconecta Node quando instância some
  - Frontend polling com contador e botão "retry" após 4 tentativas
- **Message Templates**: 6 processos com variáveis
- **Chat Interno**: Canais com polling 5s
- Site público, Indoor TV, Mobile responsive

## Architecture
- FastAPI backend (port 8001)
- React frontend (port 3000)
- WhatsApp Baileys service (port 3002)
- MongoDB
- All supervised

## Recent Changes (Feb 2026 - iter 22)
- [x] QR Code self-heal: quando Node perde a instância, backend auto-triggers /connect
- [x] Frontend ConnectionCard: pollingAttempts + botão "Demorando demais? Clique para reconectar" após 4 tentativas
- [x] ClientCreate model + backend: campo `birth_date` (YYYY-MM-DD)
- [x] ClientForm modernizado: avatar preview, 4 ícones lucide, máscara BR de telefone, validação live, disabled save
- [x] Client expanded card: chip com data + idade, chip rosa 🎂 para aniversários próximos

## Backlog
### P1
- [ ] Refatorar Dashboard.js (3298 linhas) em /components/
- [ ] Hydration warning: `<span>` em `<option>` no BookFromClientForm
- [ ] QR self-heal: opcionalmente aguardar 1s após /connect e re-fetch QR na mesma request
### P2
- [ ] Stripe payment integration
- [ ] Notificações push + Relatórios gráficos
- [ ] Shadcn Calendar no lugar dos HTML5 date pickers
- [ ] Mover ALL_SYSTEM_FEATURES para módulo dedicado
- [ ] Validação cross-company de permission_profile_id e professional_id no POST /company-users
