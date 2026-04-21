# PRD - AgentCRM & Booking System

## Current State
- Super Admin: admin@agentcrm.com / admin123 → /admin-login
- Boss Company: admin@boss.com.br / boss123 → /boss/login → /boss/painel

## All Implemented Features
- Multi-tenant SaaS, JWT Auth, PWA, Landing Page
- **PWA Dinâmico**: manifest e favicon personalizados por empresa (nome+logo). Quando usuário adiciona atalho no mobile, traz nome/logo do salão
- Super Admin: Companies, Business Types, Subdomain, features por tipo de negócio
- CRM: Atendimentos, FlowBuilder, Kanban, AI Agent (GPT-5.2)
- **Header**: usuário top-right + Suspender Agenda + Sair (sem título duplicado nas páginas)
- **Início**: menu clicável (grid de atalhos) + 4 stat cards
- **Logo global (Configurações)**: reflete em header, sidebar, site público, TV, PWA manifest e favicon
- **Agenda page**: Lista com filtros, Confirmar/Concluir com pagamento/Cancelar
- **Calendario**: Mensal/Semanal/Diario
- **Financeiro dinamico**: Filtros data, profissional, forma pagamento
- **Clientes**: Accordion inline — expande histórico + Agendar rápido. Ao criar novo cliente, auto-expande e oferece agendamento imediato
- **Concluir com pagamento**: 4 formas, registra financeiro
- **Permissões de Profissional**: não-admin vê apenas agendamentos do próprio. Fail-closed
- **Meu Site**: mobile-first, URLs truncadas com cópia
- **Suspensão de Agenda do Profissional**: modal dedicado em cada card (dias ou horas)
- **Usuarios (Admin)**: CRUD de usuários da empresa com email/senha/perfil de acesso/profissional vinculado
- **Perfis de Acesso**: CRUD de perfis com seleção de 29 permissões agrupadas por categoria (com "Marcar todos" por grupo)
- **Profissional como Usuário**: ao cadastrar/editar profissional, toggle "Este profissional é também um usuário do sistema" abre campos de senha + perfil de acesso e cria/atualiza company_user linkado
- **WhatsApp Baileys (P0)**: Microservice Node.js porta 3002, QR Code real, send/receive, webhooks
- **Conexoes**: WhatsApp/Instagram, QR polling real
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
- [x] Manifest PWA dinâmico `/api/public/manifest/{slug}` com nome+logo da empresa
- [x] Hook `useCompanyBranding` injeta title/favicon/manifest/theme-color
- [x] Features `usuarios` e `perfis_acesso` habilitadas para Salão (e boss)
- [x] Backend CRUD `/api/scheduling/company-users` (bcrypt, cross-login OK)
- [x] Backend `/api/scheduling/all-features` (29 features agrupadas)
- [x] UsuariosPage e PerfisAcessoPage com editor visual de permissões
- [x] ProfessionalModal: toggle "é usuário do sistema" com senha+perfil

## Backlog
### P1
- [ ] Message delivery engine (scheduled messages)
- [ ] Validar permission_profile_id/professional_id da mesma company no POST /company-users
- [ ] Bloquear self-delete em /company-users
### P2
- [ ] Stripe payment integration
- [ ] Notificações push
- [ ] Relatórios gráficos
- [ ] Refatorar Dashboard.js (>3000 linhas) em arquivos separados
- [ ] Substituir HTML5 date/time pickers por shadcn Calendar
- [ ] Hydration warning `<span>` dentro de `<option>` no dropdown de serviços
