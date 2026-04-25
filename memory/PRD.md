# AgentCRM & Booking — PRD

## Original Problem Statement
SaaS multi-tenant para CRM e Agendamento (mobile-first via PWA). Inclui módulos de Flowbuilder, Kanban, Omnichannel WhatsApp via Baileys (microserviço Node.js no Render), TV Indoor, perfis de acesso granulares, agendamentos com confirmação/cancelamento via link, e sistema completo de notificações.

## Architecture
- Backend: FastAPI + MongoDB (motor)
- Frontend: React 19 + Tailwind, PWA dinâmico
- Microserviço: Node.js + Baileys (WhatsApp) com disco persistente no Render (`AUTH_DIR`)
- Scheduler: `/app/backend/scheduler.py` — loop em background a cada 60s para reminders / surveys / bulk messages

## What's been implemented (latest first)

### 2026-04-25 — Taxas de Pagamento + Pesquisa de Satisfação + Remarketing
- **Taxas Financeiras**: Sub-aba "Taxas" no Financeiro (Pix / Crédito / Débito). Cada uma com % e taxa fixa (R$). Resumo financeiro mostra Bruto / Taxa / Líquido. Endpoints `GET/PUT /api/scheduling/financial/payment-fees` e `financial/summary` enriquecido.
- **Pesquisa de Satisfação**: parâmetro `survey_minutes_after` em notification_settings + mini-página pública 1-5 estrelas (`/api/public/apt/review/{token}`). Token gerado ao concluir agendamento. Variável `{link_avaliacao}` no template `pos_atendimento`.
- **Lembrete de Retorno**: parâmetro `return_reminder_days` + template novo `retorno` com variável `{link_agendar}` (URL pública com `?name=&phone=` pré-preenchidos).
- **Remarketing/Campanha**: nova aba na "Agendamento de Mensagens" com filtros: clientes inativos há X dias, nunca voltaram, aniversariantes do mês, por serviço específico, todos ativos. Envio em massa imediato OU agendado com substituição de variáveis (`{nome}`, `{ultimo_atendimento}`, `{dias_sem_voltar}`, `{ultimo_servico}`, `{aniversario}`, `{link_agendar}`).
- **Scheduler de notificações**: novo `/app/backend/scheduler.py` que roda a cada 60s e dispara: lembretes (`reminder_minutes_before`), pesquisas de satisfação (`survey_minutes_after`) e mensagens agendadas em massa (`scheduled_messages`).

### Sessões anteriores
- Variável `{link_confirmar}` no template lembrete
- Botão "Confirmar" no painel cliente público (substituindo badge "Pendente")
- Bug fix: modal mobile "Novo Agendamento" não estourar mais (overflow-x-hidden + min-w-0 nos inputs)
- Bug fix: WhatsApp `onWhatsApp()` antes de enviar (resolve "Aguardando mensagem" e bug do +62)
- Step 3 Agenda Pública: data dd/mm/aa + filtro de horários passados quando hoje
- Bottom Navigation Bar mobile (esconde sidebar)
- TV Indoor com layouts (lista/grade) e painel global do Super Admin
- Multi-turnos/intervalos para profissionais (`shifts` por dia)
- CRUD de Categorias (Editar/Excluir)
- Permissão `own_appointments_only`

## Backlog / Roadmap

### P0
- Inserir cards de Planos/Preços na Landing Page com botão "Contratar"

### P1
- Refatoração do `Dashboard.js` (+4700 linhas → quebrar em Tabs/AgendaTab.js, ConfigTab.js, etc.)
- Integração Stripe (Cartão + Pix)

### P2
- Notificações Push (Web Push API)
- Relatórios avançados (gráficos, dashboards analíticos)
- Re-sync features no Super Admin (endpoint backend já existe, falta UI)

## Key DB Collections
- `clients` (campos: name, phone, email, birth_date, company_id, id)
- `appointments` (campos: status, confirm_token, cancel_token, review_token, review_rating, review_comment, reminder_sent_at, survey_sent_at)
- `notification_settings` (booking_reminder_24h, reminder_minutes_before, survey_enabled, survey_minutes_after, return_reminder_enabled, return_reminder_days)
- `payment_fees` (pix_pct, pix_fixed, credit_pct, credit_fixed, debit_pct, debit_fixed)
- `scheduled_messages` (status, scheduled_at, recipient, recipient_name, message, campaign_filter)

## Critical Notes for Next Agent
- Cliente é `db.clients` com `birth_date` (NÃO `db.customers` / `birthday`)
- WhatsApp microservice precisa de redeploy no Render para mudanças do `index.js` entrarem em produção
- Variável `{link_agendar}` usa `FRONTEND_PUBLIC_URL` ou `PUBLIC_URL` do env do backend (configurar em produção)

## Test Credentials
- Boss admin: `admin@boss.com.br` / `boss123` (via /boss/login)
- Super admin: `admin@agentcrm.com` / `admin123` (via /admin-login)
