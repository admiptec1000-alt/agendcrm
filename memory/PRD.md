# AgentCRM & Booking — PRD

## Original Problem Statement
SaaS multi-tenant para CRM e Agendamento (mobile-first via PWA). Inclui módulos de Flowbuilder, Kanban, Omnichannel WhatsApp via Baileys (microserviço Node.js no Render), TV Indoor, perfis de acesso granulares, agendamentos com confirmação/cancelamento via link, e sistema completo de notificações.

## Architecture
- Backend: FastAPI + MongoDB (motor)
- Frontend: React 19 + Tailwind, PWA dinâmico
- Microserviço: Node.js + Baileys (WhatsApp) com disco persistente no Render (`AUTH_DIR`)
- Scheduler: `/app/backend/scheduler.py` — loop em background a cada 60s para reminders / surveys / bulk messages

## What's been implemented (latest first)

### 2026-04-29 — Renomear conexão WhatsApp + chips de contexto na lista de Atendimentos
- **PUT /api/channels/connections/{id}**: novo endpoint para renomear/atualizar conexões (aceita `name`, `status`). Frontend ganhou `EditableConnectionName` — clicar no nome do card em Conexões transforma em input, Enter ou blur salva.
- **Cards da lista de Atendimentos** agora exibem chips de **Conexão** (verde), **Fila** (azul), **Responsável** (escuro) e **Etapa do Kanban** (cor da column).
- **Etapa Kanban editável inline**: novo `KanbanColumnPicker` com `<select>` invisível sobre o chip. Mudar a etapa dispara `crmAPI.updateTicket(id, {kanban_column_id})` e atualiza o card sem abrir o ticket (stopPropagation no chip).
- **Backend `update_ticket`** agora respeita `null` explícito para campos clearable (`kanban_column_id`, `queue_id`, `connection_id`, `assigned_to`) — antes o filtro `is not None` impedia limpar. Mantém a semântica de campos omitidos = não tocar.
- **Testes (iter36 + retest manual)**: 9/10 PASS na primeira rodada → bug de clear-via-null corrigido → todos os fluxos validados.

### 2026-04-29 — Cadastro de cliente ampliado + Relatório de Atendimentos
- **Cliente** (`/scheduling/clients`): novos campos `cep`, `address`, `city`, `state` e `company_name` (para PJ). Front faz autocomplete de cidade/UF via ViaCEP ao preencher o CEP. Campo "Empresa (Razao Social)" só aparece quando `person_type='juridica'`.
- **Relatório de Atendimentos** — novo menu `relatorio_atendimentos` (grupo CRM, abaixo de Atendimentos):
  - Endpoint `GET /api/reports/tickets` com filtros `start_date`, `end_date`, `search` (nome/tel), `connection_id`, `status`, `user_id`, `tag`, `queue_id`, `only_rated`, paginação (`page`, `page_size`). Hidratação bulk de connection/user/queue (sem N+1). `duration_seconds = closed_at - created_at`.
  - UI mobile-first: filtros compactos + tabela no desktop / cards no mobile + paginação + botão "Exportar Excel" (CSV com BOM UTF-8, separador `;` — Excel abre naturalmente).
  - Respeita permissão `own_appointments_only`: força `assigned_to=user.id` (force-override de qualquer filtro cliente).
- **Migration idempotente no startup** (`backfill_feature_keys`): tenants e business_types que têm `atendimentos` recebem `relatorio_atendimentos` automaticamente — o menu aparece para empresas existentes sem intervenção manual.
- **Testes (iter35)**: 18/18 backend PASS.

### 2026-04-28 — Profissional vê apenas seus dados (own_appointments_only)
- A permissão **own_appointments_only** (já existente no editor de Perfis de Acesso) agora também é aplicada em `GET /api/reports/commissions` e `GET /api/scheduling/professionals`.
- Quando um usuário não-admin tem essa permissão e está vinculado a um Professional (match por email), todas essas listagens retornam apenas dados dele. Qualquer `professional_id` informado pelo cliente é force-overridden para o id próprio (não dá pra burlar via query string).
- Fail-closed: usuário com a permissão mas sem Professional vinculado recebe lista/relatório vazios (não vaza dados de outros).
- Admins (`company_admin`/`super_admin`) sempre veem tudo, independente do perfil.
- Testes (iter34): 18/18 backend PASS — catálogo, listagem restrita, fail-closed, override-bypass, admin bypass e regressão de iter33 (total_cost/total_profit).

### 2026-04-28 — Custo no produto/serviço + comissão sobre LUCRO
- **Novo campo `cost` no Service** (opcional): cadastrado no modal Servicos/Produtos com hint "Lucro: R$ X (base da comissao)" quando price>cost>0.
- **Cálculo de comissão sobre lucro**: `commission = max(price - cost, 0) * commission_percent / 100`. Quando cost=None/0 mantém o comportamento anterior (comissão sobre faturamento). Override `service.commission_percent > professional.commission_percent` continua funcionando.
- **Resposta do /reports/commissions enriquecida**: summary ganha `total_cost` e `total_profit`; report (por profissional) ganha `cost`/`profit`; breakdown (por item) ganha `cost`/`profit`/`unit_cost`.
- **Frontend ComissoesPage**: card "Ticket Medio" substituído por "Lucro" (cor teal). Hint condicional "Comissao calculada sobre o lucro (preco - custo)" quando há custos. Tabelas e cards mobile mostram colunas Custo + Lucro além de Faturamento e Comissão.
- **Testes (iter33)**: 16/16 backend PASS — 5 cenários (com/sem custo, com/sem override de pct, custo>preço). Frontend 100% verificado.

### 2026-04-28 — Comissões mobile-friendly + filtros + comissão por produto/serviço
- **Comissão individualizada no produto/serviço**: novo campo `commission_percent` em `Service` (opcional, 0-100). Quando definido, sobrepõe a comissão do profissional. UI de cadastro (`ServiceModal`) ganha campo "Comissao deste servico/produto (%)" com hint "Em branco = usa a comissao do profissional".
- **Endpoint /reports/commissions repaginado**: novos filtros `start_date`, `end_date`, `professional_id`, `service_type` (service/product/subscription), `service_id`. Resposta agora inclui `breakdown` (por item) além do `report` (por profissional). Cálculo: `service.commission_percent` tem prioridade sobre `professional.commission_percent`.
- **ComissoesPage mobile-first**: cards compactos com `whitespace-nowrap+truncate` (nada mais quebra "R$ X" em duas linhas), botão "Filtros" com badge contador, painel expansível com presets 7/30/90 dias, toggle "Por Profissional / Por Item" e renderização em cards no mobile (<=640px) ou tabela no desktop.
- **Testes (iter32)**: 14/14 backend PASS + frontend rendering 100% (desktop e mobile 390x844). Fallback profissional, override por serviço, todos os filtros e breakdown ordenado por revenue desc validados.


- **Modal Nova Campanha em uma tela só (mobile-first e desktop)**: removidas as abas "Configuração"/"Mensagens" em `CampaignsPage.js`. Agora um único scroll com Nome, Confirmação, Audiência, Tags/Lista condicionais, Conexão WhatsApp, Agendamento, bloco "Atendimento" (abrir ticket / fila / status) e bloco Mensagens com MSG 1..5.
- **Menu inferior mobile configurável por Tipo de Negócio**: novo campo `mobile_bottom_nav: List[str]` (máx 4 feature_keys) em `BusinessTypeCreate/Update` e nas companies. Super Admin → Tipos de Negócio ganhou seção "Menu Mobile (barra inferior)" com preview de chips numerados e grid para escolher dentre features habilitadas. Limite enforçado client+server (truncamento em 4). Propagação automática em: (a) PUT /business-types (atualiza todas as companies do mesmo BT), (b) POST /companies e PUT /companies com business_type_id, (c) POST /companies/{id}/resync-features (também sincroniza mobile_bottom_nav, não só features). Fallback para os 4 itens padrão (agenda/clientes/conexoes/financeiro) quando o BT não configurou.
- **Dashboard.js MobileBottomNav dinâmico**: monta até 4 slots (2 esquerda + botão Menu central + 2 direita) usando `FEATURE_META` + `ICON_MAP`. Lê `user.company.mobile_bottom_nav` (prioridade) ou `user.business_type.mobile_bottom_nav`.
- **Testes (iter30/31)**: 11/11 PASS — truncamento, defaults [], propagação em PUT BT, POST/PUT company, resync-features e exposição via /auth/me.


- **Ticket number sequencial (#1001, #1002...)**: novo `/app/backend/counters.py` com `next_sequence(db, company_id, name, start)` usando `find_one_and_update` + `$inc` + `upsert=True` + `ReturnDocument.AFTER` → race-safe. `next_ticket_number()` usa `start=1000` → primeiro ticket é #1001. Aplicado em 3 pontos: `POST /api/crm/tickets`, webhook `POST /api/channels/webhook/message` (novo ticket), e tickets criados via `run_campaign`. Coleção `counters` com `_id` = `${company_id}:tickets` → isolamento por tenant.
- **Backfill legado**: `server.py` roda `backfill_ticket_numbers()` no startup — tickets sem `ticket_number` recebem numeração por company, ordenados por `created_at`. Idempotente (só processa quem não tem).
- **Frontend**: `AtendimentosPage.js` exibe `#{ticket.ticket_number}` no card da lista e no header do chat (fallback para UUID.substring se ausente). `data-testid="ticket-number-{id}"`.
- **Fix bug @lid (microserviço)**: `/app/whatsapp-service/index.js` tinha erro de sintaxe — `const phone` e `const pushName` eram declarados duas vezes (a segunda redeclaração sobrescrevia `realJid` resolvido via `senderPn` com o `remoteJid` original contendo `@lid`). Removido o shadow. Agora mensagens de WhatsApp Desktop/Web chegam com o número real e reutilizam o ticket aberto em vez de criar um fantasma com LID.
- **Testes (iteration_29)**: 23/23 PASS (7 novos + 16 regressão iter28). Validado: sequencial por tenant, idempotência de webhook (phone+status!=fechado), 8 criações concorrentes sem colisão, backfill idempotente.

### 2026-04-27 — Anti-bloqueio + Typing/Read receipts + Flowbuilder Handles
- **Aba Parâmetros na Campanha (anti-bloqueio WhatsApp)**: nova `CampaignAntiBlock` policy com 10 parâmetros — intervalos min/max randomizados, burst+pausa entre lotes, escalonamento progressivo após N envios (multiplicador), limites diário/horário, validação de números. Defaults seguros (250 msgs/dia, 30-90s entre envios, pausa 5min a cada 50). Modal com 3 abas: Configuração / Mensagens / Parâmetros.
- **Long-campaign async runner**: `POST /crm/campaigns/{id}/run` agora detecta campanhas > 5min estimado, marca status `em_execucao`, dispara `asyncio.create_task` em background e retorna `{queued:true}` imediatamente. Pequenas continuam síncronas.
- **Indicador "digitando..." no chat**: webhook `POST /channels/webhook/presence` recebe eventos do Baileys (composing/recording/paused). UI faz polling em `GET /channels/contact-presence` a cada 5s e mostra bolha animada de 3 pontos verdes + "digitando..." / "gravando audio..." no header.
- **Duplo check azul (read receipts)**: webhook `POST /channels/webhook/message-status` aceita acks Baileys (sent/delivered/read/played) e atualiza `messages.$.delivery_status`. UI: 1 check cinza (enviada), 2 cinza (entregue), 2 azuis (lida).
- **Flowbuilder com conexões**: `<Handle target top>` + `<Handle source bottom>` em cada nó — agora dá pra arrastar conexões. Edges animadas. Hint banner quando há nós sem conexão. Botão **X inline** no canto superior-direito (hover) para excluir nó. `Backspace`/`Delete` também removem.
- **Microserviço Node.js (críticos)**:
  - `sentMessageStore` cache + `getMessage()` retorna payload original → **fim das mensagens em branco**
  - Suporta 8+ tipos: `extendedTextMessage`, captions `image/video/document`, respostas `buttons/list/template`, placeholders para mídia
  - `notify` + `append` no upsert; `messageTimestamp` Long→Number; filtra grupos/status
  - `presenceSubscribe` ao enviar; forwarders `presence.update` e `messages.update` (acks 1-6)
  - `GET /instances/:id/contacts` para importação
- **Documentação**: `/app/REDEPLOY_GUIDE.md` com passo a passo Render + checklist de variáveis.

### 2026-04-27 — Épico Campanhas + Filtros Atendimento + Filas + Kanban→Atendimento + Importar Contatos
- **Campanhas reformuladas (P1)**: nova `CampaignsPage` com abas Listagem/Listas de Contato. Modal completo com Nome, Confirmação, **Audiência** (4 modos: Todos / Por Tags / Sem Tag / Lista de Contato), seleção multi-tag, Conexão WhatsApp, Agendamento datetime, Abrir Ticket+Atribuir Usuário+Transferir para Fila+Status, **MSG 1..MSG 5** (abas de mensagens sequenciais), Anexar Arquivo. Listagem com colunas Nome/Status/Lista/Conexão/Agendamento/Concluída/Confirmação/Ações (👁 audiência, ▶ executar, ✏ editar, 🗑). Endpoints: `GET/POST/PUT/DELETE /crm/campaigns`, `POST /crm/campaigns/{id}/preview-audience`, `POST /crm/campaigns/{id}/run`.
- **Listas de Contato (P1)**: nova coleção `contact_lists`. CRUD completo + bulk paste de "nome, telefone" para popular contatos. Endpoints `/crm/contact-lists` (GET/POST/PUT/DELETE).
- **Filas & Chatbot (P1)**: nova `QueuesPage` (rota `filas_chatbot` agora real, não placeholder). CRUD de filas com nome, cor, descrição, mensagem de boas-vindas, vínculo opcional com Flowbuilder. Endpoints `/crm/queues`. Tickets agora aceitam `queue_id`.
- **Filtros Atendimento (P1)**: removidos chips Instagram/Web/Email. Mantidos apenas "Todos" e "WhatsApp". Botão **"Filtros"** abre painel expansível com selects: Conexão, Usuário (atendente), Tag, Fila. Aplicação client-side com indicador de quantidade de filtros ativos.
- **Kanban → Atendimento (P1)**: ícone 💬 (MessageSquare) em cada card. Click salva `open_ticket_id` no sessionStorage e navega para Atendimentos, abrindo automaticamente aquela conversa.
- **Importar Contatos do WhatsApp (P1)**: botão "Importar contatos" aparece apenas em conexões WhatsApp conectadas. Modal com 3 modos (Todos / Apenas com nome / Apenas sem nome). Endpoint `POST /channels/connections/{id}/import-contacts` busca do microserviço e popula a coleção `clients`. Microserviço Node.js ganhou endpoint `GET /instances/:id/contacts` (lista contatos cacheados pelo Baileys).
- **Sincronização "a partir da conexão"**: webhook `/channels/webhook/connected` agora salva `connected_at`. Webhook de mensagem ignora mensagens com timestamp anterior à conexão (`older_than_connected_at`). Histórico antigo não polui o CRM.
- **P0 — Resiliência envio mensagens**: timeout do envio aumentou para 30s, log do erro real (HTTP code + body), `connection_id` persistido no ticket para reuso, novo endpoint `POST /crm/tickets/{id}/messages/{msg_id}/retry` para reenvio. UI mostra botão "↻ Reenviar" em mensagens com `delivery_status='failed'`.

### 2026-04-27 — Atendimento Omnichannel: Tags inline, Valor, Real-time, Agendamento
- **Real-time WhatsApp na UI Atendimento**: Polling de 4s no ticket selecionado e 8s na lista. Webhook `/api/channels/webhook/message` agora **auto-cria ou anexa mensagem** no ticket existente (procura por phone+status!=fechado). Idempotência por `wa_message_id`. Antes: mensagens iam para `message_log` mas não apareciam no chat.
- **Envio de WhatsApp via Atendimento**: `POST /crm/tickets/{id}/messages` com `sender_type='agent'` e ticket.channel='whatsapp' agora chama o microserviço Baileys. Retorna `delivery_status` (sent/failed/pending) + `delivery_error`. UI mostra ícone vermelho (failed) ou check azul (sent). Resiliente a microserviço offline (não 500).
- **Tags inline no chat**: Header da conversa tem barra de tags com chips coloridos (cor da tag). Botão "+ Tag" abre dropdown com tags da empresa (de `/crm/tags`). Endpoints novos: `POST /crm/tickets/{id}/tags/add` e `/remove` (idempotent via `$addToSet/$pull`).
- **Campo "Valor" do contato**: TicketCreate/Update aceita `value: float`. Modal "Novo Atendimento" tem campo R$. Modal "Editar Contato" novo (modern CRUD) acessível via lápis no header. Valor exibido: badge no card da lista, header do chat, painel info.
- **Kanban com somatória de valores**: `GET /crm/kanban-v2` agora retorna `totals_by_column` (soma dos `value` por coluna). Header de cada coluna mostra "Total: R$ X" e cada card mostra o valor em chip esmeralda.
- **Agendamento de mensagens inline**: Botão calendário no input do chat abre modal com datetime + textarea. Cria via `/channels/scheduled-messages`. Scheduler em background (já existente) processa.
- **CRUD moderno de Lead/Cliente**: Modal de Editar Contato com nome, telefone, email, valor, canal, observações. Botão de excluir atendimento no header.
- **Hardening**: TicketCreate.customer_email agora aceita string vazia (validador coerce para None) — UI envia "" quando user deixa em branco.

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
- (nenhum bloqueador conhecido)

### P1
- Inserir cards de Planos/Preços na Landing Page com botão "Contratar"
- Refatoração do `Dashboard.js` (+5000 linhas → quebrar em Tabs/AgendaTab.js, ConfigTab.js, etc.)
- Integração Stripe (Cartão + Pix)
- Notificações Push (Web Push API)

### P2
- Relatórios avançados (gráficos, dashboards analíticos)
- Re-sync features no Super Admin (endpoint backend já existe, falta UI)
- Drag-and-drop de tickets entre colunas do Kanban com persistência via novo endpoint (já tem move-column endpoint)
- WebSocket/SSE entre microserviço Node.js e backend FastAPI (substituir polling para latência menor)
- HMAC signature header no webhook /channels/webhook/message para hardening

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
