# AgentCRM & Booking — PRD

## Original Problem Statement
SaaS multi-tenant para CRM e Agendamento (mobile-first via PWA). Inclui módulos de Flowbuilder, Kanban, Omnichannel WhatsApp via Baileys (microserviço Node.js no Render), TV Indoor, perfis de acesso granulares, agendamentos com confirmação/cancelamento via link, e sistema completo de notificações.

## Architecture
- Backend: FastAPI + MongoDB (motor)
- Frontend: React 19 + Tailwind, PWA dinâmico
- Microserviço: Node.js + Baileys (WhatsApp) com disco persistente no Render (`AUTH_DIR`)
- Scheduler: `/app/backend/scheduler.py` — loop em background a cada 60s para reminders / surveys / bulk messages


### 2026-05-15 (B) — SGP Gateway: dedup, auto-close, timeout + cache Mongo ✅

**3 problemas reportados:** mensagem Pix duplicada (SGP retry), "Aguardando mensagem" persistiu apos deploy do fix Baileys (cache disco efêmero no Render), e necessidade de fechar tickets SGP automaticamente.

**Mudancas:**

1. **Cache Baileys agora no MongoDB** (`/app/whatsapp-service/index.js` + `/app/backend/routes/internal_routes.py`):
   - Removida persistencia em disco (`sent-cache.json`). Disco no Render eh efemero — toda deploy zerava o cache, e o "Aguardando mensagem" voltava a aparecer.
   - Cada `sendMessage` agora POST async para `/api/internal/wa-cache/sent` (autenticado via header `X-Internal-Token`, default `agentcrm-internal`).
   - Collection `wa_sent_cache` com TTL index de 24h — auto-expire sem cron.
   - No callback `getMessage`, se nao achar na memoria → fallback HTTP para Mongo antes de retornar `{conversation:''}` (que produz "Aguardando").

2. **SGP Gateway dedup 30s** (`/app/backend/routes/sgp_gateway_routes.py`):
   - Hash `sha1(gw_id|phone|message)` armazenado em memoria com timestamp.
   - Se mesmo payload chegar dentro de 30s → retorna `{"success": true, "deduplicated": true}` SEM tocar Baileys ou DB.
   - GC automatico quando cache passa de 500 entries (deleta apenas as fora da janela).
   - Resolve a duplicacao do Pix vista no screenshot (Nystron 2527 recebeu mesma msg 2x em 17:15).

3. **Auto-close ticket apos SGP send** (toggle `companies.sgp_gateway_auto_close`, default OFF):
   - Quando ON, todo envio bem-sucedido via SGP Gateway fecha o ticket imediatamente (`status=fechado`, `closed_reason=sgp_gateway_auto_close`).
   - Se cliente responde depois, NOVO ticket eh aberto pelo webhook inbound (filtro `status NOT IN ['fechado','cancelado']` ja existia).

4. **Auto-close por inatividade** (toggle `companies.ticket_auto_close_hours`, default 0 = OFF):
   - Scheduler em `/app/backend/scheduler.py::_process_ticket_auto_close` roda a cada 60s.
   - Itera empresas com `ticket_auto_close_hours > 0`, fecha tickets em `aberto`/`em_andamento` cujo `updated_at` esteja mais antigo que N horas.
   - Tambem limpa flags `bot_paused*` no fechamento (consistencia com close manual).

5. **Endpoints novos:**
   - `GET /api/crm/company/ticket-settings` → `{sgp_gateway_auto_close: bool, ticket_auto_close_hours: int}`
   - `PUT /api/crm/company/ticket-settings` admin-only, cap 720h (30 dias).
   - `GET|POST /api/internal/wa-cache/sent` para o node service (header `X-Internal-Token`).

6. **Frontend:**
   - Novo card `TicketLifecycleSettingsCard` em `/configuracoes`, abaixo do BotPauseSettings. Toggle do auto-close SGP + input numerico das horas. Mostra badge "Ativo · 2d" quando hours >= 24.

**Testes (`/app/backend/tests/`):**
- `test_sgp_gateway_dedup.py` (3 tests): cache mantem so entries recentes, hash estavel, janela de 30s.
- `test_ticket_auto_close.py` (3 tests): threshold por empresa, hours=0 nao toca tickets, bot_paused limpa no auto-close.
- **Total: 32 testes passando** (+ os 26 anteriores).

**Validacao manual (curl):**
- GET ticket-settings default = `{auto_close: false, hours: 0}` ✓
- PUT seta valores e GET reflete ✓
- POST wa-cache/sent + GET retorna mesmo payload ✓
- GET wa-cache/sent sem header → 403 ✓
- Chamada SGP duplicada em < 30s → segunda retorna `deduplicated: true` ✓

**Deploy requirement (PRODUCAO):** Para o fix do "Aguardando mensagem" valer, precisa redeploy. O cache Mongo so eh consultado se ambos backend E whatsapp-service estiverem com o novo codigo.

**Variavel de ambiente nova:** `INTERNAL_TOKEN` (opcional, default `agentcrm-internal`). Em producao, recomendado setar uma string randomica para impedir que alguem da rede interna acerte os endpoints `/api/internal/*`.


### 2026-05-15 — Fix "Aguardando mensagem" no SGP Gateway + diagnostico de calls ✅

**Problema:** Cliente reporta que mensagens enviadas pelo SGP via novo Gateway (`/api/sgp/gateway/send/{token}`) chegam ao destinatario como o placeholder do WhatsApp "Aguardando mensagem. Essa acao pode levar alguns instantes" — em vez do texto real da mensagem.

**Root cause analise (3 camadas de falha):**

1. **Pre-key bundle nao estabelecido** antes do primeiro `sendMessage` — Baileys cria a sessao E2E de forma lazy ao receber a primeira mensagem do contato. Em fluxos de saida-pura (SGP cobranca/aviso), o contato pode nunca ter falado com aquele numero antes; o ciphertext chega mas as chaves nao, e o WhatsApp do cliente mostra "Aguardando" indefinidamente. **Fix oficial:** chamar `assertSessions([targetJid], false)` antes de `sendMessage`.

2. **Cache de mensagens enviadas em memoria, perdido em deploys** — quando o WA server pede retry via `getMessage()` (callback do Baileys), retornavamos `{conversation: ''}` se nao acharmos a msg no cache. Mensagem vazia = "Aguardando" eterno. Em produção, cada deploy zerava o cache, agravando o problema.

3. **`getMessage` fallback retornava string vazia** — mesmo com cache hit no antigo `sent.message || { conversation: message }`, alguns formatos de `sent.message` deserialized do Baileys nao tem `conversation` no top-level, gerando o mesmo placeholder.

**Mudancas aplicadas em `/app/whatsapp-service/index.js`:**

- **L70+:** `sentMessageStore` agora persiste em `AUTH_DIR/sent-cache.json` (flush a cada 10s quando dirty), sobrevive a deploys.
- **L775+:** Adicionado `await instance.sock.assertSessions([targetJid], false)` ANTES de `sendMessage` para garantir pre-key exchange.
- **L795+:** `rememberSent` agora sempre stamp `{conversation: message}` em vez de `sent.message || {conversation: message}` — garante shape consistente.
- **Capacidade do store dobrada:** 1000 → 2000 entries, eviction 100 → 200.

**Mudancas em `/app/backend/routes/sgp_gateway_routes.py`:**

- **Logging detalhado nos endpoints `GET|POST /gateway/send/{token}`:** Loga content-type, body_len, qp_keys, parsed_keys, message_len, message_preview. Token redacted (so primeiros 6 chars).
- **Ring buffer em memoria `_RECENT_CALLS`** (max 20 calls por token) — captura cada chamada do SGP com payload completo (parseado). Reset a cada deploy.
- **Body parse fix:** lemos `request.body()` UMA VEZ e fazemos parse manual para JSON ou form-encoded (antes, `request.form()` lancava se o body ja tivesse sido lido para logging).
- **Novo endpoint autenticado `GET /api/sgp/gateways/{gid}/recent-calls`:** retorna o ring com newest first + metadados (calls_count_total, last_called_at). Operador inspeciona via UI.
- **Log do resultado do Baileys send:** success, jid, message_id, error — facilita identificar se Baileys teve erro vs WA recebeu mas decifrou vazio.

**Frontend (`/app/frontend/src/pages/CRM/SGPGatewayPage.js`):**

- Botao **Diagnostico** (icone Bug) em cada gateway card.
- Modal `GatewayDebugModal` mostra as ultimas 20 chamadas com: timestamp, metodo, content-type, celular preview, **message_len destacado em vermelho se = 0**, parsed keys, body preview.
- Refresh manual disponivel no modal.

**Como o usuario debuga em producao agora:**

1. Vai em **CRM → SGP Gateway**
2. Clica no botao **Bug** (azul) do gateway problematico
3. Aciona uma cobranca/aviso no SGP
4. Volta no modal e clica em **Refresh** — ve exatamente o que o SGP mandou
5. Se `message_len = 0` em vermelho → SGP esta enviando vazio (config do lado SGP)
6. Se `message_len > 0` mas cliente continua vendo "Aguardando" → problema de pre-key, e o fix do Baileys (assertSessions + cache em disco) deve resolver no proximo deploy

**Testes:** 26 unit tests passando. Validacao via curl confirmou: form-encoded `celular=...&message=...` corretamente parseado, recent-calls retorna o registro com message_preview pronto.


### 2026-05-14 (B) — Pausar bot ao intervir manualmente (per-company toggle) ✅

**Problema:** Em fluxos de atendimento com bot ativo (Flowbuilder), quando o operador respondia uma mensagem pelo painel ou pelo celular conectado (Baileys), o bot continuava enviando respostas automaticas, brigando com o humano. Cliente pediu um parametro nas configuracoes da empresa para que QUALQUER mensagem do operador (plataforma ou celular) pause o bot naquele ticket.

**Decisao de design (1a + 2a + 3a + 4b):**
- Pausa permanece **ate o ticket ser fechado/cancelado** (resume automatico na transicao para `fechado`)
- Setting **per-company** (uma unica chave `pause_bot_on_human_intervention` no `companies`)
- Indicador visual: **badge "Bot pausado"** no header do chat + **dot amarelo** no card do ticket
- Default **ON** para empresas existentes e novas

**Implementacao:**

1. **`/app/backend/bot_pause.py`** (novo arquivo):
   - `is_pause_setting_enabled(db, company_id)` — le o toggle. Distingue `comp is None` (empresa nao existe → False) de `{}` (campo ausente → True default). Esse detalhe foi um bug pego nos testes: motor retorna `{}` em projection quando o campo nao existe, e `if not comp` evaluaria como falso wrongly.
   - `pause_bot_on_ticket_if_enabled(db, ticket, reason)` — idempotente, so atua se a empresa opted-in E o ticket tem flow ativo. Seta `bot_paused=True`, `bot_paused_at`, `bot_paused_reason`, limpa `active_flow_node_id`.
   - `resume_bot_on_ticket(db, ticket_id)` — chamado quando o ticket eh fechado.

2. **`/app/backend/flow_engine.py`:**
   - `advance_flow` faz early-return quando `ticket.bot_paused=True` — kill-switch absoluto, nem com webhook chamando errado vaza mensagem do bot.
   - `is_flow_active(ticket)` retorna `False` para tickets pausados, evitando que o webhook chame advance.

3. **`/app/backend/routes/crm_routes.py`:**
   - `POST /tickets/{id}/messages` com `sender_type=agent` → invoca `pause_bot_on_ticket_if_enabled(reason="agent_message_platform")`.
   - `POST /tickets/{id}/media` (uploads de imagem/audio/video) → mesmo helper com `reason="agent_media_platform"`.
   - `PUT /tickets/{id}` quando `status` muda para `fechado`/`cancelado` → limpa `bot_paused*`.
   - **Novos endpoints:**
     - `GET /api/crm/company/bot-settings` → `{pause_bot_on_human_intervention: bool}`
     - `PUT /api/crm/company/bot-settings` → admin-only (`company_admin|owner|super_admin|admin`), 403 para outros roles
     - `POST /api/crm/tickets/{id}/bot-pause` body `{paused: bool}` → toggle manual por ticket

4. **`/app/backend/routes/channels_routes.py`:**
   - Webhook `/webhook/message`: quando `from_me=True` (operador enviou pelo celular conectado), chama `pause_bot_on_ticket_if_enabled(reason="agent_message_phone")` apos persistir a mensagem.

5. **Frontend:**
   - `/app/frontend/src/components/BotPauseSettingsCard.js` — toggle na pagina `/configuracoes` (so admin pode editar; outros veem o estado mas o toggle fica disabled).
   - `/app/frontend/src/components/BotPausedBadge.js` — exporta `BotPausedBadge` (header do chat, clicavel para retomar bot manualmente) e `BotPausedDot` (icone compacto nos cards da lista de tickets).
   - `AtendimentosPage.js` mostra `<BotPausedDot/>` ao lado do nome do cliente quando `ticket.bot_paused=true`, e `<BotPausedBadge/>` no header da conversa.

**Testes:**
- `/app/backend/tests/test_bot_pause.py` (8 unit tests): default ON, no-op quando company off, no-op em ticket sem flow, short-circuit do advance_flow, is_flow_active=False, resume limpa flags, regressão do `{}` em projection.
- `/app/backend/tests/test_bot_pause_api.py` (10 e2e tests criados pelo testing agent): GET/PUT settings, POST bot-pause, 404, auto-pause apos agent message, resume no close, 403 para non-admin.
- Total: **36 testes passando** (15 flow_engine + 3 sgp_repair + 8 bot_pause unit + 10 bot_pause api).

**Default em rollout:** Cada GET de empresa sem o campo retorna `true`. PUT pela primeira vez cria o campo no doc. Nenhuma migracao necessaria.


### 2026-05-14 — Pix do fluxo SGP usando link público `{{link_pix_html}}` ✅

**Problema:** No bot do WhatsApp (fluxo SGP), a bolha de Pix chegava ao cliente exibindo literalmente `""` (aspas vazias) no lugar do código copia-e-cola, porque alguns tenants do SGP não preenchem o campo `codigopix` para certos contratos. O cliente pediu para o Pix ser entregue como **link HTML público** (campo `link_pix_html` do SGP) — o mesmo link que o SGP envia automaticamente 2 dias antes do vencimento, com QR code, copia-e-cola e código de barras já renderizados.

**Mudanças aplicadas:**

1. **`/app/backend/flow_engine.py` (`_flatten_sgp_response` action `fatura2via`)**: quando `links[0].link_pix_html` vier vazio, faz **fallback automático** para `link_cobranca` (página pública do SGP com QR + copia-e-cola) e em último caso para `link` (boleto). Garante que `{{link_pix_html}}` NUNCA renderize em string vazia se o SGP devolver pelo menos um link público.

2. **`/app/backend/routes/super_admin_routes.py` (`_repair_sgp_flow_data`)**: a cadeia legada de **2 bolhas** (`pix_code_*` com `{{pix_copia_e_cola}}` + `pix_footer_*`) foi substituída por **1 única bolha** `pix_link_*` que usa o template `PIX_LINK_TEMPLATE`:
   ```
   💸 *Pague seu Pix agora!*
   🔗 {{link_pix_html}}
   Vencimento: {{vencimento_fatura}}
   Valor: R$ {{valor_fatura}}
   ```
   O repair detecta e **purga** automaticamente cadeias antigas (`pix_code_*`/`pix_footer_*` ou nodes cujo texto contenha `pix_copia_e_cola`) e cria a bolha nova. Idempotente.

3. **Novo endpoint debug `POST /api/sgp/super-admin/debug-fatura2via/{company_id}`** (`/app/backend/routes/sgp_routes.py`): aceita `{params:{cpfcnpj, contrato}}` e devolve resposta crua do SGP **+** preview das variáveis do Flowbuilder (`flow_vars_preview`) para o operador confirmar visualmente se `link_pix_html` está presente para aquele cliente. Token redacted no echo.

4. **`/app/frontend/src/pages/SuperAdmin/SgpRepairTab.js`**: novo painel "Diagnóstico SGP fatura2via" — campos CPF/CNPJ + Contrato + botão "Consultar SGP". Mostra duas colunas: variáveis do Flowbuilder (com `(vazio)` em vermelho quando o campo não vier) e JSON cru do SGP. Action labels atualizados para `attach_pix_link_message` e `purge_legacy_pix_chain`.

**Testes (`/app/backend/tests/`):**
- `test_flow_engine.py::test_flatten_fatura2via_falls_back_when_link_pix_html_missing` ✓
- `test_flow_engine.py::test_interpolate_handles_single_and_double_curly_link_pix_html` ✓
- `test_sgp_pix_repair.py::test_pix_repair_creates_single_link_bubble_from_scratch` ✓
- `test_sgp_pix_repair.py::test_pix_repair_migrates_legacy_two_bubble_chain` ✓
- `test_sgp_pix_repair.py::test_pix_repair_is_idempotent` ✓

**Como aplicar em produção:** Super Admin → SGP Repair → selecionar empresa → **Auditar Fluxos SGP** → em cada flow card, clicar **Pré-visualizar reparo** (deve listar `purge_legacy_pix_chain` + `attach_pix_link_message`) e depois **Aplicar reparo**.

### 2026-05-13 (B) — Botão "Abrir atendimento" em Contatos + Bloqueio de tickets duplicados ✅

**Bug 1: Botão "Abrir atendimento" (ícone de chat verde) nos cards de Contatos não fazia nada**

**Root cause:** `Dashboard.js` linha 652 (`case 'contatos'`) renderizava `<ClientsPage />` SEM passar a prop `setActivePage`. A linha 666 (`case 'clientes'`) já passava. O handler `openTicketFromClient` faz `setActivePage && setActivePage('atendimentos')` — quando a prop é undefined, o short-circuit ignora silenciosamente e nada acontece.

**Fix:** `case 'contatos': return <ClientsPage setActivePage={setActivePage} />;`

**Bug 2: Sistema permitia criar múltiplos tickets para o mesmo telefone**

**Fix (backend `crm_routes.py POST /tickets`):** Adicionado guarda contra duplicidade. Antes de inserir, busca um ticket OPEN (status ∉ {fechado, cancelado}, channel ≠ whatsapp_group) com o mesmo `customer_phone` (matching tanto pelo valor cru quanto pelo digits-only). Se existir, retorna `409 Conflict` com payload:
```
{ "code": "duplicate_open_ticket",
  "message": "Já existe um atendimento aberto (#NNNN) para o telefone XXX.",
  "existing_ticket": { id, ticket_number, customer_name, ... } }
```
O frontend pode forçar a criação enviando `force_create: true` no body.

**Fix (frontend `AtendimentosPage.handleCreateTicket`):** Detecta o 409 → `window.confirm` pergunta se deseja **abrir o atendimento existente** (OK) ou **criar duplicado** (Cancel + segundo confirm). Ao "Abrir existente": `crmAPI.getTicket()` e seleciona; "Criar duplicado": re-submete com `force_create=true`.

**Pydantic (`models.py TicketCreate`):** Adicionado `force_create: Optional[bool] = False`.

**Validação curl:**
- POST `{phone:"...111"}` → 200 (criou)
- POST mesmo phone → **409** com `existing_ticket` ✓
- POST mesmo phone + `force_create:true` → 200 (criou novo) ✓


### 2026-05-13 (A) — Fix Badge "Mensagens não lidas" não zera ao abrir ticket ✅

**Bug:** Em `AtendimentosPage.js`, o contador de mensagens não lidas (badge verde no card do ticket) NÃO zerava quando o operador clicava na conversa. Ficava "congelado" mostrando o número antigo (ou um número inflado, como 99+) mesmo após o backend ter marcado a conversa como lida.

**Root cause (duplo):**
1. A função do badge buscava o user id em `localStorage.getItem('user_data')`, mas a app armazena a sessão na chave `user` (via `AuthContext.js`). Portanto `myUid` era sempre `null`, `lastRead` era sempre `null`, e o cálculo caía no fallback `unread = inboundMsgs.length` (= todas as mensagens, sempre).
2. O filtro de "inbound" usava `!m.from_me && m.direction !== 'outgoing'`. Porém mensagens persistidas pelo webhook (`channels_routes.py`) gravam apenas `sender_type: 'agent'|'user'` (sem `from_me`/`direction`). Resultado: mensagens do próprio operador eram contadas como "não lidas", inflando o badge.

**Fix em `/app/frontend/src/pages/CRM/AtendimentosPage.js`:**
- Substituído `localStorage.getItem('user_data')` por `user?.id` (já vem do `useAuth()` no topo do componente).
- Filtro de outgoing agora cobre os 3 esquemas: `from_me === true || direction === 'outgoing' || sender_type ∈ {agent, system, bot}`.
- `handleSelectTicket` faz update OTIMISTA: marca `read_state[uid] = now` localmente ANTES da chamada API, então o badge some no instante do clique mesmo se a rede demorar.

**Validação:** Login `crm@test.com`, abrir Atendimentos → 3 tickets com badges "1, 1, 3". Clicar no #1523 → badge do #1523 some imediatamente, os outros 2 ficam intactos. ✓

**Produção:** Save to GitHub apenas o arquivo `AtendimentosPage.js`; Render auto-deploy do frontend resolve em ~3min.


### 2026-05-12 (F) — Lote bugs P0 + features ✅

(detalhes acima)

### 2026-05-12 (E) — Fix CRÍTICO Áudio + Remoção placeholder ✅

**Bug 1: "Este áudio não está mais disponível"** no celular do destinatário sempre que o operador grava áudio na plataforma.

**Root cause:** O frontend grava via MediaRecorder em **webm/opus** (container WEBM) mas envia ao backend com `mimetype: 'audio/ogg; codecs=opus'`. WhatsApp aceita o blob, mas como o conteúdo binário é WEBM/EBML (não OGG), o player do destinatário falha ao decodificar. Erro silencioso, no formato que sai como "áudio não disponível".

**Fix:** Adicionado `ffmpeg-static` + `fluent-ffmpeg` no `whatsapp-service`. Helper `convertToOggOpus(buffer)` converte qualquer formato de entrada para OGG/Opus (48k bitrate, mono, 48kHz) antes de enviar ao Baileys. Validado: input WEBM 10kb → output OGG `4f676753` (magic "OggS") 7kb. Versão `v2.1.7`.

**Bug 2: Placeholder `[Audio]` aparece no chat** mesmo quando o player de áudio já está renderizado acima.

**Fix:** `AtendimentosPage.js` linha 1012 — suprimi o `<p>{msg.content}</p>` quando `media_url` está presente E `content` é um placeholder regex `^[(Audio|Imagem|Image|Video|Documento|Document)]$`.

**Bug 3: Áudios enviados pelo operador não aparecem como player no chat**, só "[Audio]".

**Root cause:** `send_media_to_ticket` salvava em `attachment_data_b64` inline. O frontend só renderiza áudio quando `media_url` está presente (era só populado para mensagens inbound do webhook).

**Fix:** `send_media_to_ticket` agora persiste o áudio em object storage via `_persist_inbound_media()` (mesmo helper do webhook) e popula `media_url/media_kind/media_mimetype/media_filename` na mensagem. Adicionado também endpoint fallback `GET /api/crm/tickets/{tid}/messages/{mid}/attachment` para tickets antigos que ainda têm `attachment_data_b64` legado.

**Para produção:**
1. Save to GitHub (3 arquivos: `crm_routes.py`, `AtendimentosPage.js`, `whatsapp-service/index.js` + `package.json`)
2. Render auto-deploy do backend ✓
3. **Redeploy MANUAL do whatsapp-service** (precisa puxar `ffmpeg-static` no build) — `built_at` esperado: `2026-05-12 v2.1.7`


### 2026-05-12 (D) — Fix DEFINITIVO Layout PDF (repete em TODAS as páginas) + Preview Web com layout ✅

**Problema anterior:** O fix anterior (D-1) usava `@page { margin: 0 } + body padding`, mas padding do body só reserva espaço na PRIMEIRA e ÚLTIMA página. Páginas intermediárias tinham o conteúdo sobrepondo o cabeçalho/rodapé do letterhead. Outras tentativas (`bleed`, `position: fixed`) também falharam: backgrounds @page são clipados pelo `@page margin`, e position:fixed em WeasyPrint 68 clipa nas páginas 2+.

**Solução definitiva:**
1. Adicionada função `_slice_letterhead_image(b64, mime, pt_mm, pb_mm)` que recorta a imagem do letterhead em 2 partes (topo + rodapé) usando PIL.
2. As duas partes são injetadas como **`position: running()` elements** em `@page { @top-center }` e `@page { @bottom-center }`. WeasyPrint repete elementos running em TODAS as páginas automaticamente.
3. O `@page { margin: pt x pb x }` continua reservando o espaço para o conteúdo do orçamento sem sobreposição.
4. Quando `use_layout=True`, header_html/footer_html textuais são suprimidos (o letterhead OWN's os margin boxes).

**Validado:** PDF de 6 páginas: cabeçalho e rodapé verde em todas as 6, miolo branco para conteúdo. ✅

**Preview web do orçamento agora mostra layout:** `_build_browser_preview_html` ganhou os parâmetros `layout_image_*` e renderiza as 2 fatias (topo/rodapé) como `<img position:absolute>` no mock A4 do iframe. O preview no modal "Visualizar Orcamento" agora é pixel-accurate com o PDF.

### 2026-05-12 (C) — Tentativa anterior (NÃO FUNCIONAVA em multi-páginas)

**Root cause** (encontrado por reprodução automatizada): no WeasyPrint, `background` aplicado no `@page` é **clipado pela `margin` do `@page`** — tudo dentro da área de margem renderiza branco POR CIMA do background. Como definimos `margin: 40mm 18mm 30mm 18mm`, o letterhead ficava confinado em uma área diminuta no centro, com tudo em volta branco. Visualmente parecia que o layout não foi aplicado.

**Fix:** quando o template tem `layout_image_b64`, agora aplicamos `@page { margin: 0 }` e simulamos as margens (top/bottom/laterais) via `padding` no `<body>`. O letterhead ocupa a folha A4 INTEIRA, e o conteúdo do orçamento fica posicionado dentro da "safe area" definida pelos `layout_padding_*_mm` do template.

Validado com teste programático: pixels de topo/rodapé renderizam a cor do letterhead, miolo fica disponível para o conteúdo.

### 2026-05-12 (B) — SGP Outbound Gateway (HTTP Genérico) ✅

**Feature inversa**: SGP → AgentCRM → WhatsApp. Permite cadastrar o AgentCRM como "SMS Gateway HTTP Genérico" no SGP para que o ERP dispare mensagens WhatsApp pelo CRM (cobrança/avisos).

- Backend (`backend/routes/sgp_gateway_routes.py` — novo arquivo):
  - Collection `sgp_gateways`: `{ id, company_id, token, connection_id, label, active, calls_count, last_called_at }`
  - CRUD autenticado: `GET/POST/PUT/DELETE /api/sgp/gateways` + `POST /gateways/{id}/regenerate-token`
  - **Endpoint PÚBLICO** (sem JWT, auth por token na URL): `GET/POST /api/sgp/gateway/send/{token}?celular=...&message=...`
  - Aceita query/form/json com aliases (`celular`/`to`/`phone`, `message`/`msg`/`text`, `cc_code`)
  - Normaliza telefone (BR default), localiza ou cria ticket aberto no canal `whatsapp`, agrega mensagem ao thread, dispara via Baileys `/instances/{conn}/send`
  - Tag automática "SGP Gateway", `origin: sgp_gateway`
  - Registrado ANTES do `sgp_router` no `server.py` para precedência sobre o catch-all `POST /{action}`

- Frontend (`frontend/src/pages/CRM/SGPGatewayPage.js` — novo arquivo): página dedicada no menu CRM (ícone `PlugZap`); lista cards com URL completa + botão copiar e "Copiar Config JSON" para colar em SGP > Sistema > Config SMS Gateway > HTTP Generico.

- Super Admin: nova feature `sgp_gateway` listada em `/api/super-admin/features`.



### 2026-05-12 — Lote A+B+C: Bug Aguardando + Layout PDF (PDF/JPG/PNG) + Permissões por Fila + Export Flow + Posição Coluna ✅

**Bug fix P0 — aba Atendendo/Aguardando**
- `/api/crm/tickets?tab=...` agora filtra por `assigned_to` (em linha com o contador), não mais por `status` (que tinha valores legados pago/bloqueado). Aba "Aguardando" agora retorna a lista coerente com o badge.

**Bug fix P0 — Layout PDF do orçamento (papel timbrado)**
- `_build_quote_html` agora faz fallback: se o template do orçamento não tem `layout_image_b64` mas o template padrão da empresa tem, herda. Orçamentos antigos passam a sair com o papel timbrado configurado em qualquer template padrão.
- Upload de PDF como layout: `_maybe_convert_pdf_layout_to_png()` usa `pypdfium2` para converter a 1ª página em PNG 200dpi antes de salvar. WeasyPrint só sabe lidar com imagens raster — agora aceitamos PDF transparentemente. Aplicado em POST e PUT de templates.

**Permissões por Fila (RBAC ampliado)**
- Conexão: `ConnectionCreate/Update` ganhou `queue_ids: List[str]`. Modal `WhatsAppConnectionsPage` mostra checkbox-list de filas. Webhook `/api/channels/webhook/message` auto-atribui `queue_id` ao ticket quando a conexão tem exatamente 1 fila vinculada.
- Usuário: `CompanyUserCreate/Update` ganhou `allowed_queue_ids: List[str]`. Modal `UsuarioForm` (Company/Dashboard.js) tem novo card verde "Filas com acesso (Atendimento)".
- `_ticket_visibility_filter` (crm_routes.py) reescrito: não-admins veem (a) tickets próprios + (b) pool sem-dono restrito a `allowed_queue_ids` E/OU `connection_ids` configurados. Sem RBAC configurado → fallback legacy (todos os abertos sem dono).

**Quick wins**
- Endpoint `GET /api/crm/flows/{id}/export` retorna JSON portátil (sem id/company_id/timestamps). Botão "Exportar" (ícone Download) ao lado de Renomear no card do fluxo.
- Modal "Editar Coluna" do Kanban agora tem campo "Posição na lista" (`order` int) — operador escolhe a ordem direto, sem precisar do long-press 3s.

**IMPORTANTE PARA PRODUÇÃO:** 
1. "Save to GitHub" do backend + frontend (Render auto-deploy).
2. Rebuild/redeploy do `whatsapp-service` no Render (apenas se mudanças anteriores SGP buttons + groups + audio PTT ainda não foram). Sem isso o `/send-interactive` não fica acessível.
3. Rodar `python /app/backend/scripts/migrate_sgp_flow_to_dynamic_menu.py` na produção (após pull) para atualizar fluxos SGP existentes.

**Nova dependência backend**: `pypdfium2==5.8.0` adicionado em requirements.txt (puro python, sem dependências de sistema).


### 2026-05-11 — Mega batch: 15+ melhorias Atendimentos + Orçamentos + Filas + Permissões ✅

**Atendimentos (QW + M1)**
- QW2 — Editar contato: "Ver mais" sempre aberto.
- QW3 — Campos CPF/CNPJ com máscara automática (000.000.000-00 / 00.000.000/0000-00).
- QW4 — Seletor de coluna Kanban movido da sidebar do contato para o header do chat (ao lado das Tags).
- QW5 — Lista de tickets mostra nome do cliente cadastrado no CRM (fallback para pushName do WhatsApp).
- ?1 — Badge **"com orçamento (N)"** ao digitar CPF/CNPJ que já tem orçamento (endpoint GET /quotes/by-document/:doc).
- ?2 — Toggle assinatura (ícone lápis ao lado do campo). Padrão ON: prefixa `*Nome do Atendente:*\n…`. OFF: envia sem prefixo. Backend `MessageCreate.with_signature`.
- M1 — Habilitados 5 botões no chat: **anexar (Paperclip)** com input file, **emoji picker** com 75 emojis, **transferir** (modal Para usuário / Para fila), **gravar áudio** (MediaRecorder → opus → WA PTT), **fechar ticket** (status=fechado).
- M7 — Tabs reorganizadas: **Atendendo** = `assigned_to` definido. **Aguardando** = `assigned_to` vazio. (não-puxado → Aguardando automaticamente)
- G1 — Nova aba **Grupos**: microservice agora aceita `@g.us`, backend cria tickets com `channel: whatsapp_group`, frontend separa por tab.

**Orçamentos (QW1 + M5 + M6 + G2)**
- QW1 — Removido auto-pick do template padrão.
- M5 — Permissão `quotes.view_all` adicionada em "Permissões avançadas" do perfil. Sem ela, usuário vê apenas orçamentos que ele criou.
- M6 — Lista de orçamentos: colunas **CPF/CNPJ** + **Usuário criador**. Filtros: CPF/CNPJ, Cliente (regex), Usuário (dropdown).
- G2 — Templates ganharam aba **"Layout (papel timbrado)"**: upload PNG/JPG da arte do papel timbrado; PDF rende com a imagem como background-image @page e padding configurável (top/bottom/x em mm). Header/footer são ignorados quando layout está ativo, evitando desfiguração.

**Filas (M3)**
- Queue model ganhou `connection_ids: List[str]`. UI tem checkbox list para vincular uma ou mais conexões WhatsApp à fila.

**Respostas Rápidas (M4)**
- Campo de anexo (arquivo até 5MB) com preview do nome no card.

**WhatsApp microservice**
- `messages.upsert` agora processa `@g.us` (groups). Forwarda `is_group`, `group_jid`, `group_subject` para o backend.
- `send-media` reconhece `audio/*` e envia como PTT (voice note) com `ptt: true`. `video/*` → vídeo. Outros → documento.

**IMPORTANTE PARA PRODUÇÃO:** Redeploy do whatsapp-service junto com o backend (mudanças em groups + audio PTT).



**1) Agendamento de 90min preenche 3 slots (antes pintava 30min)**

### 2026-05-11 — Sync mensagens enviadas pelo celular do operador ✅

- Microservice `whatsapp-service/index.js` parou de descartar `key.fromMe`; envia `from_me: true` no payload.
- Backend `webhook/message` persiste fromMe como `sender_type: 'agent'`, `delivery_status: 'sent'`, `source: 'phone'`. Bypassa @lid fallback, flow trigger e criacao de ticket orfao. Dedupe via `wa_message_id`.
- Requer redeploy do whatsapp-service + backend em producao.

### 2026-05-11 — AgendaPro: duracao real + service search unificado ✅
- Bug do `gridRow span` corrigido (coordenadas explicitas, span = ceil(duration/30)).
- Search picker moderno com chips uniformes (sem distincao Principal/Adicional) nos modais Novo Agendamento e QuickBook.


- Bug raiz: `apt.duration` era usado para calcular `span` mas o layout CSS Grid usava `gridRow: span N` sem `gridColumn` explicito. Cells subsequentes do mesmo column entravam na "next available" cell e empurravam a coluna, mascarando o efeito visual da duracao.
- Fix: `gridColumn` e `gridRow` explicitos em todas as celulas. Calculo da `span = ceil(duration / 30)`. Celulas cobertas por um appt multi-slot anterior nao sao renderizadas (evita overlap). Bloco do appt agora exibe `duration` no rodape para confirmacao visual.

**2) Service search moderno (substitui dropdown + checkbox list)**
- Aplicado nos dois modais: Company/Dashboard `NewAppointmentModal` (Agenda) e AgendaProPage `QuickBookModal`.
- UI: chips dos servicos selecionados (Principal em primary, extras em indigo) com botao × para remover. Input de pesquisa com lupa filtra em tempo real. Primeira selecao vira Principal; demais viram Adicionais.
- Promove primeiro Adicional para Principal quando o Principal e removido.
- Totalizador: "N servico(s) selecionado(s) · X min · R$ Y".



**Problema:** Quando o operador enviava uma mensagem via WhatsApp do celular (linked device), ela chegava no cliente mas NAO aparecia na tela de Atendimentos do sistema. Recebimento (cliente → sistema) funcionava normalmente.

**Causa raiz:** O microservico Baileys (`/app/whatsapp-service/index.js`) descartava todas as mensagens com `key.fromMe: true` antes mesmo de chamar o webhook (`continue` na linha 417). Apenas mensagens recebidas eram forwardadas.

**Fix:**
1. Microservice agora forwarda tambem `fromMe:true` no payload, com flag `from_me: true`.
2. Backend `/api/channels/webhook/message` reconhece o flag e:
   - Persiste a mensagem com `sender_type: "agent"`, `sender_name: connected_name`, `delivery_status: "sent"`, `source: "phone"`.
   - Bypassa `@lid fallback` (phone e o destinatario, ja canonico) e flow trigger (mensagem nossa nao deve avancar flows).
   - Idempotencia via `wa_message_id` (evita duplicar quando operador envia pelo proprio sistema e o microservico ecoa o `fromMe:true`).
   - Atualiza `last_outgoing_at` (mantem o fallback @lid funcionando para a proxima resposta).
   - Se nao existir ticket aberto para o destino, ignora (operador iniciando contato fora do CRM nao cria orfao).
3. Frontend ja renderiza por `sender_type === 'agent'` (bolha verde direita) — nenhuma mudanca necessaria na UI.


### 2026-05-11 — AgendaPro respeita Horario de Funcionamento ✅

- Endpoint existente `/api/scheduling/business-hours` alimenta os slots do AgendaPro.
- Day view: slots so dentro do intervalo do dia (Seg-Sex 08:00-18:00 -> 08:00..17:30). Dia inativo mostra empty state "Estabelecimento fechado".
- Week view: uniao das janelas ativas; celulas fora do expediente ficam dimmed e nao-clicaveis.
- Botao Novo continua aberto para agendamento manual fora do horario.

**Verificado:** 3 cenarios validados via curl (mensagem nova OK, dedupe OK, no-ticket OK). Backend logs + DB confirmados.

**ATENCAO:** Mudanca tambem no `whatsapp-service/index.js` — precisa rebuild/redeploy do microservico no Render junto com o backend.



- Endpoint existente `/api/scheduling/business-hours` agora alimenta os slots do AgendaPro.
- **Day view**: slots renderizam apenas no intervalo configurado para aquele dia (ex.: Seg 08:00-18:00 mostra `08:00..17:30`). Dia inativo (ex.: domingo) mostra estado "Estabelecimento fechado neste dia" com instrucao para usar botao Novo.
- **Week view**: usa a uniao das janelas ativas como linhas; celulas de dias fechados ou fora do horario do dia ficam dimmed/disabled (`bg-slate-50/80 pointer-events-none`).
- Botao **Novo** continua aberto: o usuario pode digitar manualmente data/hora fora do expediente quando necessario. Apenas o clique-no-grid e restrito.
- Removido `buildSlots`, `DAY_START_HOUR`, `DAY_END_HOUR` (hardcoded 07-22) — substituidos pelo `slotsFromRange(start, end)` adaptativo.



**1) Tela inicial por Tipo de Negocio**

### 2026-05-11 — Tela inicial por BT + Slots 30min + Multi-servico + Fix Sync ✅

**1) Tela inicial por Tipo de Negocio**
- Modelo `BusinessTypeCreate/Update` ganhou campo `default_screen: Optional[str]`.
- Modal SuperAdmin tem select `bt-default-screen` listando apenas features habilitadas.
- Company Dashboard prioriza `user.business_type.default_screen` sobre o fallback heuristico.

**2) Agenda Pro: rotulos de 30 min**
- Antes `slot.endsWith(':00') ? slot : ''` → agora `{slot}` (todos visiveis).

**3) Sync Agenda ↔ Agenda Pro**
- `isoDate(d)` usa componentes locais (corrigia off-by-one em UTC-3 que ocultava agendamentos).
- Coluna sintetica "Sem profissional" agrupa appointments orfaos.

**4) Multi-servico**
- `AppointmentCreate.extra_items` opcional. Backend soma duration/price, concatena `service_name`.
- UI: checkbox panel "Servicos adicionais" no QuickBook (AgendaPro) e NewAppointmentModal (Agenda).


- Modelo `BusinessTypeCreate/Update` ganhou campo `default_screen: Optional[str]`.
- `super_admin_routes` POST/PUT business-types normaliza empty → None.
- Modal SuperAdmin (`BusinessTypeModal`) tem select `bt-default-screen` que lista apenas features habilitadas.
- Company Dashboard usa `user.business_type.default_screen` como prioridade sobre o fallback heuristico baseado em `base_type`.

**2) Agenda Pro: rotulos de 30 min**
- Antes: `slot.endsWith(':00') ? slot : ''` (so horario inteiro). Agora: `{slot}` — todos os rotulos visiveis (07:00, 07:30, 08:00...).

**3) Sync Agenda ↔ Agenda Pro corrigido**
- `isoDate(d)` agora usa componentes locais (getFullYear/getMonth/getDate) — antes usava `toISOString()` em UTC, causando off-by-one em fuso BR (UTC-3) e ocultando agendamentos do dia.
- Appointments com `professional_id` ausente ou invalido vao para coluna sintetica `Sem profissional` no view Dia (antes desapareciam silenciosamente).

**4) Multi-servico no agendamento**
- `AppointmentCreate` aceita `extra_items: List[Dict]` opcional.
- `scheduling_routes.create_appointment` soma duration/price de cada extra (resolve do DB para validar), concatena nomes em `service_name` (e.g. "Corte + Hidratacao") e armazena `extra_items` no doc.
- Modal QuickBook (AgendaPro) e Modal `NewAppointmentModal` (Agenda) tem painel "Servicos adicionais" com checkboxes, totalizador em tempo real.

**Testes:** backend pytest 9/9 PASS (`/app/test_reports/iteration_51.json`). Frontend smoke screenshots OK em /boss/painel.

**IMPORTANT**: mudancas aplicadas no preview. Para produção (https://agentcrm.8ip.com.br): "Save to GitHub" + redeploy no Render.




### 2026-05-09 — Phase 2 (Operational Impersonate) + Phase 3 (Financeiro Admin) ✅

**Phase 2 — Super Admin usa modulos do sistema para gestao propria**
**Phase 2 — Super Admin usa modulos do sistema para gestao propria**
- Setting `financial_manager_company_id` (já existente) agora funciona como "Empresa Operacional" do SuperAdmin.
- Novo endpoint `POST /api/super-admin/me/operational-impersonate` que emite JWT scoped na empresa configurada (validade 120 min, claim `impersonated_by` para auditoria).
- Sidebar SuperAdmin → "Meu Painel" abre um hero violeta com botão que chama o endpoint e abre uma nova aba via `/__impersonate__` (token vai para sessionStorage, não sobrescreve o token do SA na aba atual).
- Errors: 400 quando setting vazio (CTA → vai para Settings), 409 quando empresa não tem `company_users`, 404 quando empresa apagada.

**Phase 3 — Modulo Financeiro Super Admin**
- Novo arquivo `/app/backend/routes/super_admin_finance_routes.py` (344 linhas, 8 endpoints).
- `GET /api/super-admin/financial/summary?month=YYYY-MM` retorna P&L mensal: `revenue` (faturas pagas), `license_cost` (license_cost × clientes ativos, amortizado p/ planos anuais), `commissions_total/paid/pending`, `manual_expenses`, `net_profit`, `margin_pct`, `by_company` (margem por cliente), `expenses_by_category`.
- CRUD `/api/super-admin/expenses` (collection `super_admin_expenses`) — Pydantic valida `description min_length=1` (defesa em profundidade).
- `GET /api/super-admin/partners/commissions` lista commissions com filtros `status` (paid/pending) e `month`.
- Frontend `FinancialTab` ganhou 5 sub-abas: **Resumo** (hero verde + 3 cards de custos + tabela margem por cliente), **Faturas** (existente), **Despesas** (CRUD + modal categoria infra/marketing/salaries/taxes/other), **Comissoes** (lista + multi-select para liquidar via `/super-admin/partners/settle`), **Clientes Externos** (existente).

**Bug fix anterior corrigido**
- `<PartnersTab onRefresh={loadDashboardData}>` (variavel inexistente) → `loadAll`. UI de Parceiros voltou a recarregar pos-toggle.

**Testes**
- `/app/backend/tests/test_iteration_50_finance.py` — 18/19 passing (1 skip por falta de seed de parceiro→cliente, não bloqueante).
- E2E via testing_agent_v3: 100% (Resumo, Despesas CRUD, Comissoes, Meu Painel, Settings).



### 2026-05-07 — SGP auto-flatten + Agenda Pro Modernization

**Bug-3 fix (`Pronto, !` + 2ª via vazia)**
- `flow_engine._flatten_sgp_response` agora normaliza retornos SGP em vars top-level:
  - `consultacliente` → `nome_cliente`, `cpfcnpj_cliente`, `email_cliente`, `numero_contrato`, `status_contrato`, `plano_cliente`, `endereco_cliente`
  - `fatura2via` → `boleto_url`, `linha_digitavel`, `valor_fatura`, `vencimento_fatura`
  - `verificaacesso` → `status_online_offline`
  - `manutencao` → `descricao`, `mensagem_central`, `status`
  - `liberacaopromessa` → `liberacao_status`
- Tolerante: aceita arrays vazios, chaves alt (`razaosocial`, `statusexibicao`, `planointernet`), top-level fallback para `fatura2via`.
- `_execute_http_node` agora loga payload_keys/response_keys + chave do flatten.

**Agenda Pro modernizada**
- Carrossel Instagram-style de profissionais no topo (avatares circulares, ring azul quando ativo). "Equipe" mostra todos; clicar num profissional filtra a coluna.
- Modal QuickBook agora tem **toggle Agendamento ↔ Bloqueio**. Modo Bloqueio cria appointment com `is_block: true`, sem cliente/serviço, marcando o slot como indisponível com motivo + duração configurável (15/30/45/60/90/120/180/240 min).
- **Busca de cliente existente** via `schedulingAPI.getClients({search})` com debounce 200ms, dropdown de até 8 resultados, autocomplete preenche nome+telefone.
- Click em appointment existente abre modal com botão **"Concluir"** que expõe painel inline com:
  - Valor final editável + desconto (%)
  - Grid de formas de pagamento (`/scheduling/financial/payment-methods`)
  - Botão "Concluir atendimento" → chama `concludeAppointment` que cria a transação financeira automaticamente.

**Backend novo**
- Modelo `AppointmentCreate` aceita `is_block`, `block_duration`, `block_reason`. `service_id` virou Optional.
- `scheduling_routes.create_appointment` curto-circuita o caminho de bloqueio antes da validação de serviço, status default `CONFIRMADO`.

**Sincronização Agenda ↔ Agenda Pro ↔ Calendário**
- Confirmado: todas as 3 telas usam `schedulingAPI.getAppointments` na collection `appointments`. Mesma fonte → qualquer mudança aparece nas outras visualizações.

**Testes**: testing_agent_v3_fork rodou iteration_49 → backend 100% (16/16 novos casos + 7/7 regressão), frontend 90% (carrossel, block toggle, client search verificados; conclude panel não exercitado por falta de agendamento prévio no tenant Boss). Sem bugs críticos.


### 2026-05-06 (cont.) — Flow Engine: Logging + Debug Endpoints + Hardening + Modal memo

**Bug raiz reconfirmado**: a versão antiga do `_trigger_flow_for_ticket` usava `data.label` como fallback para o texto enviado, fazendo com que o bot só mandasse "Inicio" (label do nó start) e nunca avançasse. O motor real (`flow_engine.py`) já corrige isso skipando o nó `start`. Em produção (`agentcrm.8ip.com.br`), o redeploy é OBRIGATÓRIO para o fix entrar em ação.

**O que foi feito nesta sessão**:
- **Logging detalhado em `flow_engine.advance_flow`** — cada hop (visit, type, branching) emite INFO log. Erros (orphan node, http error, hop limit) emitem WARNING. `_save_state` loga `matched/modified` para diagnosticar persistência travada.
- **Hardening**:
  - Orphan node (estado salvo refere-se a node inexistente após edição do fluxo) agora limpa o estado ao invés de retornar silenciosamente.
  - `dry_run=True` agora honrado em TODOS os caminhos (não só no `_emit`); retorna mensagens previstas sem persistir nem chamar WhatsApp.
  - Nó `ticket/queue/transfer` agora retorna `sent` (era `return` cru — TypeError potencial em chamador que faça `len(...)`).
  - `_save_state` consulta o ticket existente antes de regravar `flow_started_at` (não mais regravado a cada save).
- **3 endpoints de debug** (admin/owner-only, prefixados `/api/crm/`):
  - `GET /tickets/{id}/flow-state` — mostra `active_flow_id/node_id`, `flow_vars`, `flow_started_at` + nó atual completo do fluxo.
  - `POST /tickets/{id}/reset-flow` — limpa todo o estado de fluxo do ticket (uso: cliente travado, fluxo editado).
  - `POST /tickets/{id}/test-flow` `{incoming_text?, is_initial?}` — DRY-RUN advance_flow no estado atual; retorna mensagens previstas. Não persiste nem envia WhatsApp.
- **Frontend**: `ConnectionFlowModal` agora é `React.memo` com comparator estrito (`conn.id` + `conn.default_flow_id`) e o `useEffect` de carregar fluxos tem cleanup com flag `active` (evita setState após unmount). `loadData` em `ConexoesPage` virou `useCallback([])` para reduzir re-renders descendentes. Esses ajustes endurecem contra o flicker reportado pelo usuário (não reproduzível em preview, mas aplicado defensivamente).
- **Testes**: novo `/app/backend/tests/test_flow_engine.py` com 7 cases pytest cobrindo: trigger inicial (welcome+menu), reply de menu (branch), reply inválido (re-prompt), nó ticket/queue (encerra fluxo), dry_run (não persiste), orphan node (limpa estado), start com texto malicioso (skipado). **7/7 passing**.
- **Validação E2E em preview**: criei conexão + fluxo via `/api/crm/flows/import`, ataquei `default_flow_id`, simulei `POST /api/channels/webhook/message` 2x. Confirmado:
  1. Primeira msg: cria ticket, dispara welcome + menu. Logs trace cada hop. Estado salvo: `active_flow_node_id="menu1"`.
  2. Reply "1": resolve idx=0, envia "Plano Basico", encerra fluxo (`active_flow_node_id=None`).



### 2026-05-06 — Hotfix P0: Bot só respondia "Início" no fluxo importado
**Causa raiz**: `_trigger_flow_for_ticket` (em `crm_routes.py`) era um **MOCK**. O comentário no código admitia: *"The full flow execution engine (branching, conditions, AI nodes) is a separate roadmap item; this fires off the welcome reply so the customer gets an instant acknowledgement"*. Resultado: cliente mandava mensagem → bot enviava só o nó de início e parava. Os menus, branches, HTTP nodes (SGP) e ticket-queues nunca eram executados.

**Fix**: Implementado **Flowbuilder Runtime Engine** completo em `/app/backend/flow_engine.py` (~280 linhas). Funcionalidades:
- Walker do grafo respeitando `edges` (incluindo `sourceHandle` para branches de menu, ex: `option-0`, `option-1`).
- Tipos de nó suportados: `start` (skip+advance), `message`/`welcome` (envia texto + advance), `menu` (envia opções + espera reply), `http`/`request`/`api` (executa chamada HTTP, mescla `response.*` em variáveis), `ticket`/`queue`/`transfer` (move ticket pra fila e finaliza fluxo).
- **Interpolação `{{var}}`** com path dotted (`{{response.data.nome}}`) — variáveis seedadas automaticamente: `nome`, `customer_phone`, `number`.
- **Captura de input**: nós com `capture_var` salvam a resposta do cliente em `flow_vars`.
- **Resolução de menu choice**: aceita key exato ("1"), número (`1` → idx 0), ou label fuzzy contains.
- **Re-prompt em input inválido** (não avança o estado).
- **HTTP node SGP**: detecta URL `/api/sgp/<acao>` e chama o proxy interno in-process (sem HTTP loop) injetando `token`+`app` do `sgp_configs` da empresa. Falha graciosa se SGP não configurado.
- **Hop limit** (25) contra runaway loops + **Flow timeout** (24h) contra travas.
- Estado persistido no ticket: `active_flow_id`, `active_flow_node_id`, `flow_vars`, `flow_started_at`.

**Hooks**:
- `routes/crm_routes.py::_trigger_flow_for_ticket` agora delega ao `flow_engine.advance_flow(is_initial=True)`.
- `routes/channels_routes.py` (webhook de mensagem inbound): após persistir a mensagem do cliente, se `is_flow_active(ticket)` chama `advance_flow(incoming_text=text, is_initial=False)`.

**Validado** com `/tmp/test_flow_engine.py` (3 testes):
1. Trigger inicial envia welcome + menu, marca `pending_node=menu`. ✅
2. Cliente responde "1" → envia próximo nó e finaliza fluxo. ✅
3. Resposta inválida re-pergunta sem avançar estado. ✅



### 2026-05-06 — Hotfix P0: Toggle "Todos os módulos" vazando para clientes finais
**Problema**: o toggle âmbar "Todos os módulos" estava aparecendo para QUALQUER cliente que tivesse `sessionStorage.impersonating='1'` setado de alguma sessão anterior. O `sessionStorage` é per-tab mas se o cliente abrir o painel num tab que antes foi usado pelo Super Admin para impersonação, a flag persiste — o cliente ganha o toggle indevidamente.

**Fix (defesa em profundidade no backend)**:
- `auth.py::get_current_user`: passa o claim JWT `impersonated_by` para o objeto `user` retornado.
- `auth_routes.py::/auth/me`: quando `impersonated_by` está presente no token, retorna `is_impersonating=True`.
- Frontend (`Company/Dashboard.js`): trocou a heurística baseada em `sessionStorage` por leitura direta de `user.is_impersonating` vinda do `/auth/me`. Token de cliente final NÃO tem o claim → flag nunca fica True → toggle nunca aparece.

**Impacto de segurança**: agora a única forma de ver o toggle é possuir um JWT criado por `POST /super-admin/companies/{id}/impersonate`. Manipulação de sessionStorage não basta.

**Validado curl**: `/auth/me` com token de impersonação → `is_impersonating=true, impersonated_by=<sa_id>`. Validado Playwright: toggle aparece em sessão impersonada e o `/auth/me` retorna a flag corretamente.



### 2026-05-06 — Consolidação dos menus "API" + "Integrações" → "API e Integrações"
**Problema relatado**: no Tipo de Negócio do SuperAdmin existiam 2 features (`api` em CRM + `integrações` em Config Empresa), mas para o cliente apareciam dois itens diferentes ("API" sem página → tela em branco; "Integrações" com SGP). Confuso e quebrado.
**Fix**:
- Removido `api` do `FEATURE_REGISTRY` (`super_admin_routes.py`) e do `FEATURE_META` (`Company/Dashboard.js`).
- Renomeado label de `integrações`: "API e Integracoes" → **"API e Integrações"** (com acento, consistente em todo lugar).
- **Migração one-shot no startup** (`server.py::backfill_feature_keys`): toda BT/Company com `api` ativada recebe `integrações=enabled`, depois o entry standalone `api` é removido. Validado: 0 BTs e 0 Companies com `api` legado, 10 BTs + 2 Companies com `integrações` ativa.
- Resultado: SuperAdmin e cliente final veem o MESMO item: **"API e Integrações"** (grupo Config Empresa). A página hospeda os cards **SGP** + **Asaas**.



### 2026-05-06 — Asaas + SuperAdmin "Todos os módulos" + Drag & Drop Agenda Pro

**🟢 Integração Asaas (Banco / Cobranças BR)**
- Novo arquivo `/app/backend/routes/asaas_routes.py`:
  - `GET/PUT /api/asaas/config` — config por empresa: `api_key`, `environment` (sandbox|production), `webhook_token`, `enabled`. API key mascarada na resposta.
  - `POST /api/asaas/config/test` — bate em `/customers?limit=1` para validar conectividade.
  - `POST /api/asaas/customers` — cria cliente no Asaas (mapeia local↔asaas via `asaas_customer_links`).
  - `POST /api/asaas/charges` — cria cobrança Pix/Boleto/CartãoCrédito (`/payments` no Asaas). Loga em `asaas_charges`.
  - `GET /api/asaas/charges/{id}` — consulta status.
  - `POST /api/asaas/webhook/{company_id}` — endpoint público; valida `Asaas-Access-Token` header se config tem `webhook_token`. Idempotente (dedupe por event+payment.id em `asaas_webhook_events`). Atualiza espelho local da cobrança.
- Auth: header `access_token: <api_key>` (formato Asaas oficial — NÃO `Bearer`).
- Base URLs: `https://sandbox.asaas.com/api/v3` e `https://api.asaas.com/api/v3`.
- UI: `AsaasConfigCard` em **Integrações** com passo a passo embutido (6 passos com URL do webhook gerada automaticamente do origin + company_id).

**🟡 SuperAdmin "Todos os módulos"**
- Toggle **âmbar no header** ("Todos os módulos") aparece quando `user.role === 'super_admin'` OU `sessionStorage.impersonating === '1'`.
- Quando ativo, `enabledFeatures` retorna `Object.keys(FEATURE_META)` ignorando o filtro do BT da empresa. Permite o SuperAdmin configurar QUALQUER módulo sem precisar habilitar antes no BT.
- Persistido em `localStorage` (sessão SuperAdmin direta) ou `sessionStorage` (sessão impersonada — per-tab).

**🟢 Drag & Drop em Agenda Pro**
- `AgendaProPage.js`: cards de agendamento agora têm `draggable=true` + `onDragStart` que carrega o ID via `dataTransfer`. Slots vazios têm `onDragOver`/`onDrop` que recalculam (date, time, professional_id) e fazem `PUT /scheduling/appointments/{id}`. Funciona tanto na visão diária (mover entre profissionais) quanto semanal (mover entre dias).
- Implementação via HTML5 nativo — sem dependências adicionais.

**Validação**: backend curl confirmou GET/PUT config Asaas + mascaramento + test connection (401 esperado com fake key) + create charge propaga erro do Asaas. Frontend Playwright capturou: toggle "Todos os módulos" funcionando + sidebar mostra ALL features + página Integrações com cards SGP+Asaas.



### 2026-05-06 — Fase 1+2+3 (Bugfixes + Pagamentos + Agenda Pro)

**🔴 FASE 1 — Bugfixes P0**
- **Fix tela em branco "Lançamentos"**: faltava `useCallback` no `import` de `Company/Dashboard.js` (linha 1) — causava `ReferenceError: useCallback is not defined` ao montar `LancamentosView`.
- **Auto-enable feature `integrações`** em todos os BTs e Companies que tenham qualquer outra feature (backfill no startup `server.py`). Sem isso, o menu "API e Integrações" não aparecia em empresas existentes.

**🟠 FASE 2 — Reestruturação Financeira**
- **Backend** (`scheduling_routes.py`):
  - CRUD `/scheduling/financial/payment-methods` — auto-seed de 6 métodos padrão (Dinheiro, Pix, Débito, Crédito, Transferência, Cortesia) na primeira leitura.
  - `ConcludeAppointment` aceita `payment_method_id`, `discount_amount` (R$), `discount_pct` (%) e `is_courtesy`. Cortesia zera valor mas mantém transação no histórico.
  - Transação financeira gerada inclui descrição "(Cortesia)" ou "(desconto R$ X)" para rastreabilidade.
- **Frontend** (`Company/Dashboard.js`):
  - Aba **"Taxas"** removida → substituída por sub-aba **"Formas de Pagamento"** com cards CRUD (criar/editar/excluir, com Tipo, Taxa%, Taxa fixa, Parcelas, Cortesia, Ativa).
  - Modal "Concluir Agendamento" agora carrega métodos de pagamento dinamicamente; campos de **desconto R$** e **% off**; botão Cortesia em destaque verde.

**🟢 FASE 3 — Agenda Pro (NOVA feature)**
- Novo arquivo `/app/frontend/src/pages/Scheduling/AgendaProPage.js` (~330 linhas).
- Feature key `agenda_pro` registrada no `FEATURE_REGISTRY` (backend) e `FEATURE_META` (frontend, ícone `CalendarDays`, grupo Operacional).
- **Visão Diária**: timeline 07:00→22:00 em slots de 30min, colunas por profissional. Horários ocupados aparecem como cards coloridos por status (pendente=âmbar, confirmado=verde, em_atendimento=azul, concluído=cinza, cancelado=rosa-tracejado).
- **Visão Semanal**: 7 colunas (Dom-Sáb) para 1 profissional selecionado.
- Click em slot vazio → abre `QuickBookModal` pré-preenchido (data + hora + profissional).
- Click em agendamento existente → mesmo modal em modo edição (com select de status + botão Excluir).
- Toolbar com ◀ Hoje ▶, label do range, seletor de profissional (visão semanal), botão **+ Novo**.
- Reusa a mesma collection `appointments` (mesma fonte da Agenda legada — confirme `2a` do user).

**Validação**:
- Backend: curl confirmou auto-seed de 6 formas, criação de "Boleto Bancário" custom, total 7.
- Frontend: Playwright capturou 3 telas: vista diária, semanal e modal de novo agendamento — todas funcionando.



### 2026-05-06 — Importar Fluxo genérico (JSON do computador)
- **Antes**: o botão "Importar SGP" só criava o esqueleto SGP.
- **Agora**: três botões no header da lista de fluxos:
  - **"Importar Fluxo"** (Upload) — abre file picker `.json`, lê do PC do usuário, faz `POST /api/crm/flows/import`. Funciona com qualquer JSON exportado deste sistema.
  - **"Modelo SGP"** (link violeta discreto) — mantido para criar o esqueleto pré-pronto SGP.
  - **"Novo Fluxo"** (primário) — manteve.
- **Backend**: novo endpoint `POST /api/crm/flows/import` (`crm_routes.py`) — valida `nodes` e `edges` como listas, força `is_active=False`, evita colisão de nome incrementando `(N)`. Strip de `id`/`company_id`/timestamps do JSON original.
- **Validado curl**: importação OK (1), auto-rename para "(2)" (2), JSON inválido retorna 400 com mensagem clara (3), fluxo vazio aceito (4).

### Confirmação: SGP só em Integrações
- O `SgpConfigCard` foi removido de `ConfigPage` na iteração anterior. Confirmado via grep — só permanece dentro de `IntegracoesPage` (route `'integrações'`). O menu "API e Integracoes" só aparece quando o feature está habilitado no Tipo de Negócio (controle multi-tenant correto).



### 2026-05-06 — Refator UX SGP: feature passa a ser company-side (refeito conforme feedback)
- **Removido**: botão violeta "Importar SGP" da tabela de Empresas no Super Admin; card SGP do `ConfigPage` da empresa.
- **Adicionado**:
  - Página `IntegracoesPage` em `/app/frontend/src/pages/Company/Dashboard.js` (route `'integrações'`) que hospeda o `SgpConfigCard`. Aparece no menu lateral da empresa quando o feature `integrações` está habilitado no Tipo de Negócio.
  - Botão "Importar SGP" (`Globe` violet pill) no header da tela de Fluxos do FlowBuilder (`/app/frontend/src/pages/CRM/FlowBuilderPage.js`), ao lado de "Novo Fluxo".
  - Backend: novo endpoint `POST /api/sgp/import-flow` (company-side, usa `user.company_id`); endpoint legado `POST /api/sgp/super-admin/import-flow/{id}` mantido para compatibilidade.
- **Bugfix de roteamento FastAPI**: o catch-all `POST /api/sgp/{action}` (proxy) era declarado ANTES de `/import-flow`, então engolia a chamada e retornava "Acao desconhecida: import-flow". Movido para o final do arquivo (única posição válida) — agora `/import-flow`, `/config`, `/config/test`, `/super-admin/import-flow/{id}` resolvem antes do catch-all.



### 2026-05-06 — SGP Integration + BT enhancements (Duplicar, show_on_landing)
**Bloco 4 — Tipo de Negócio:**
- Novo campo `show_on_landing` (default `False`) e endpoint público `/api/auth/business-types` agora filtra por esse flag — só aparece na Landing quem foi explicitamente marcado.
- `POST /api/super-admin/business-types/{id}/duplicate` cria cópia inativa-na-landing (nome + " (cópia)").
- UI: badge verde "Landing" no card; botões Editar / Duplicar / Excluir no card do BT; toggle "Exibir como plano na Landing Page" no modal.

**Bloco 1 — Integração SGP genérica (qualquer empresa pode configurar):**
- Novo arquivo `/app/backend/routes/sgp_routes.py` com:
  - `GET/PUT /api/sgp/config` — credenciais por empresa (`base_url`, `token`, `app`, `enabled`); token é mascarado na resposta (`token_masked`) e nunca pré-preenchido na UI.
  - `POST /api/sgp/config/test` — bate em `/api/ura/manutencao/list/` para validar conexão.
  - `POST /api/sgp/<acao>` — proxy whitelisted para 5 ações: `consultacliente`, `fatura2via`, `verificaacesso`, `manutencao`, `liberacaopromessa`. Token e app são INJETADOS server-side; o body do flow só carrega `params: {}` específicos da ação (CPF, contrato, etc).
- UI: card "Integração SGP (Provedores)" em **Configurações da Empresa** (`SgpConfigCard`) com base_url, token, app, toggle Ativa, botão Testar, link da documentação SGP.

**Bloco 2 — Importar fluxos SGP:**
- `POST /api/sgp/super-admin/import-flow/{company_id}` — gera fluxo "SGP — Atendimento Web Internet" pronto, com nós HTTP apontando para o proxy `/api/sgp/<acao>` (sem token hardcoded, sem n8n). 18 nós: menu principal, identificação por CPF (consultacliente), submenu cliente (2ª via, suporte, atendente, liberação por confiança), branches não-cliente/manutenção/contratar plano. Idempotente: re-importação retorna o flow existente.
- UI: botão violeta "Importar SGP" em cada linha da tabela de Empresas no Super Admin (ícone GitBranch). Confirmação antes de criar.

**Validação:** curl E2E confirmou: BT show_on_landing filtra público (Public BTs só com flag true), duplicate cria cópia com flag False, import flow cria + idempotência, 404 para empresa inexistente. UI confirmada via Playwright (10 botões duplicar, 2 botões SGP, toggle landing presente).

**Como usar em produção (`adm@web.com` na agentcrm.8ip.com.br):**
1. Faça redeploy desta versão preview → produção.
2. Garanta que o **Tipo de Negócio da empresa Web Internet** tenha a feature `integrações` ativa (Super Admin → Tipos de Negocio → editar BT).
3. Logue como admin da empresa (ou via "Gestão" no Super Admin). Vá em **Flowbuilder → "Importar SGP"**. O fluxo "SGP — Atendimento Web Internet" será criado desativado.
4. Vá em **Integrações** (menu lateral) e preencha o card SGP: `base_url=https://web.sgp.net.br`, `app=8ip`, token gerado em https://bit.ly/token-api-ura. Clique **Testar conexão**.
5. Volte ao Flowbuilder, abra o fluxo importado, ajuste textos/queues e ative.



### 2026-05-06 — Super Admin Simplification: Plano fundido ao Tipo de Negócio
**Refatoração** pedida pelo usuário (escolhas: 1a migrar plans, 2a esconder aba Planos, 3a Landing usa BT.monthly_price):
- **Tipo de Negócio agora carrega permissões + comercial em um único objeto:** novos campos `monthly_price`, `billing_cycle` (monthly/yearly/one_time), `installments`, `grace_days`, `max_connections`, `max_users` em `BusinessTypeCreate/Update` (`models.py`) e expostos no endpoint público `/api/auth/business-types`.
- **Auto-faturamento via Tipo de Negócio:** `POST /api/super-admin/companies` gera as parcelas a partir do BT quando `monthly_price > 0` (sem `plan_id`). Path legado com `plan_id` continua funcionando.
- **Aba "Planos" removida** do menu Super Admin (endpoints permanecem como legado).
- **Clientes Externos (avulsos):** nova collection `external_billing_clients` + CRUD `/api/super-admin/external-clients`.
- **Faturas avulsas:** `POST /api/super-admin/invoices` aceita `company_id` OU `external_client_id` (mutuamente exclusivos, validação 400). `GET /api/super-admin/invoices` resolve `client_name` e `client_kind` (`company`/`external`).
- **Aba Financeiro com sub-abas:** "Faturas" (com coluna TIPO mostrando AVULSO/EMPRESA) e "Clientes Externos" (CRUD na UI).
- **Modal "Nova Fatura"** com toggle Empresa do sistema / Cliente externo.
- **Migração:** `POST /api/super-admin/migrate-plans-to-business-types` (idempotente). Backfill auto de defaults zero no startup (`server.py::backfill_feature_keys`).
- **Suspension check** usa `grace_days` do BT quando empresa não tem `plan_id`.
- **Landing Page** mostra preço a partir de `business_type.monthly_price` (R$ 999,90 / mês|ano|avulso).
- **Validado:** 14/14 testes pytest em `/app/backend/tests/test_iteration_49.py`.



### 2026-05-05 — Fix P0: Conflito de Token Super Admin × Impersonação
- **Bug**: Após o SuperAdmin clicar em "Gestão" para impersonar uma empresa (abre nova aba), o token clonado era gravado em `localStorage.token`, sobrescrevendo o token do SuperAdmin. Voltando à aba original, qualquer ação privilegiada (ex.: salvar Nicho de Negócio) falhava com 401/403.
- **Fix**:
  - `pages/ImpersonateHandler.js`: token de impersonação agora é gravado **APENAS em `sessionStorage`** (per-tab), nunca em `localStorage`. Flag `sessionStorage.impersonating='1'` marca a aba.
  - `services/api.js`: interceptor de requisição já preferia `sessionStorage` sobre `localStorage`. Interceptor 401 atualizado para limpar somente o storage que contém o token corrente (impede deslogar o SuperAdmin se a aba impersonada perder a sessão).
  - `context/AuthContext.js`: refatorado com helpers `readToken/readUser/getAuthStorage`. `loadUser()` cacheia o user no storage correto; `logout()` limpa apenas o próprio storage; expõe `isImpersonating` e `refreshUser`.
  - `App.js`: `hasToken` agora inclui `sessionStorage` para hidratação correta de abas impersonadas.
- **Validado via Playwright**: SuperAdmin login → setItem fake token em sessionStorage → `localStorage.token` permanece intacto; após clear da session, SuperAdmin segue logado.


## What's been implemented (latest first)

### 2026-05-04 — Super-Admin v2: impersonação, planos por tipo de negócio, módulo financeiro
**Refeito** após feedback do usuário (a v1 estava interpretada errada). Agora:
- **Botão "Gestão" na lista de Empresas** — ícone de fone de ouvido: chama `POST /api/super-admin/companies/{id}/impersonate`, recebe JWT da empresa e abre nova aba em `/__impersonate__?token=...&slug=...` que persiste o token em localStorage e redireciona para o dashboard do cliente. SuperAdmin passa a "ser" o admin da empresa para suporte (token válido por 60min, com claim `impersonated_by`).
- **Planos configuráveis e vinculados a Tipos de Negócio** — `subscription_plans` ganhou `business_type_ids[]`, `billing_cycle` (monthly/yearly/one_time), `installments` (parcelas auto-geradas) e `grace_days` (dias até bloqueio automático). Modal do SuperAdmin mostra toggles multi-seleção dos tipos de negócio para escolher onde o plano aparece na `/landing`.
- **Criação de empresa auto-gera faturas** — quando SuperAdmin cadastra uma empresa com `plan_id`, o backend chama `_generate_invoices_for_company()` que cria N parcelas no ciclo configurado (mensal avança o mês, anual avança o ano).
- **Aba Financeiro no SuperAdmin** — `GET/POST/PUT/DELETE /api/super-admin/invoices` + agregados por status (A receber/Vencido/Pago). UI com tabela filtrável, marcar como pago, criar fatura manual.
- **Rotina de inadimplência** — `POST /api/super-admin/invoices/run-suspension-check` varre faturas vencidas, move `pending → overdue`, e para cada empresa verifica se a mais antiga vencida passou do `grace_days` → muda `companies.status = "blocked"`. Botão manual na UI; idempotente.
- **Configuração "Empresa Gestora Financeira"** — `GET/PUT /api/super-admin/settings` persiste `financial_manager_company_id`. Opção mostrada em *SuperAdmin → Configurações*. (P1 futuro: renderizar menu especial na UI dessa empresa).
- Abas temporárias "Base de Clientes" e "Clientes Financeiros" (v1 errada) foram **removidas**.
- Validado E2E: 2 botões Gestão nos cards, modal de plano com ciclo/parcelas/grace/10 toggles de tipo, aba Financeiro com ações, Settings salva empresa gestora.

### 2026-05-04 — Super-Admin v1 (removido; substituído pela v2 acima)
- **Backend** (`routes/super_admin_routes.py`):
  - `GET /api/super-admin/companies/{id}/clients` — read-only browser dos clientes de qualquer empresa, com busca por nome/telefone/email.
  - CRUD `GET/POST/PUT/DELETE /api/super-admin/billing-clients` — cadastro manual de clientes financeiros (nome, qtd licenças, valor unitário, total auto-calculado).
  - CRUD `GET/POST/PUT/DELETE /api/super-admin/plans` + `POST /api/super-admin/plans/{id}/duplicate` — gestão de planos com `max_connections`, `max_users`, `enabled_features`, `monthly_price`. Duplicação cria cópia inativa.
- **Frontend** (`pages/SuperAdmin/Dashboard.js`): 3 novas abas no sidebar do SuperAdmin:
  - **Planos**: cards com preço/limites, botões Editar/Duplicar/Excluir, modal de edição com nome/preço/tipo/conexões/usuários/ativo.
  - **Clientes Financeiros**: tabela com nome/licenças/valor unit./total/notas, agregando o valor total recorrente. Modal de cadastro com cálculo automático.
  - **Base de Clientes**: select de empresa + busca textual → tabela read-only com nome/telefone/email/tags/cadastro.
- Validado via browser: criação de plano funcionou (Starter, R$99,90, 1 conexão, 3 usuários), abas todas carregam, select de empresas populado.

### 2026-05-04 — Fix: Cabeçalho/rodapé não expandiam + altura configurável
- **Bug**: o `max-height` fixo (22/18mm) impedia o usuário de aumentar a área do cabeçalho — por mais que ele subisse a imagem, ela não preenchia mais espaço. E mesmo aumentando a imagem, ela ficava centralizada com largura parcial.
- **Fix**:
  - Modelo `QuoteTemplate` agora tem `header_height_mm` e `footer_height_mm` (8–80mm, defaults 22/18).
  - Backend (`_generate_pdf_bytes` e `_build_browser_preview_html`): CSS dinâmico aplica esses valores em `#__quote_header { height: …mm }` e nos `img` filhos. As margens `@page` são calculadas como `altura + 4mm` para o conteúdo nunca esbarrar na faixa.
  - Imagens dentro do header/footer agora SEMPRE preenchem 100% da largura (`width:100%; object-fit:contain`) — não há mais centralização parcial.
- **Frontend** (`OrcamentosPage.js → TemplateMultiTabEditor`): nas abas Cabeçalho e Rodapé, novo painel com **slider** + **input numérico** "Altura do cabeçalho/rodapé" (8–80mm). Persistido no save do template via `editing.{header,footer}_height_mm`. Pré-visualização A4 reflete o valor em tempo real.
- Endpoints atualizados: `POST /api/quotes/templates`, `PUT /api/quotes/templates/{tid}`, `POST /api/quotes/templates/preview-html`, `GET /api/quotes/{qid}/preview-pdf-html`, `GET /api/quotes/{qid}/pdf`, `POST /api/quotes/{qid}/send-whatsapp` — todos passam as novas alturas.
- Validado E2E: criou template com 35/25mm, alterou para 50/30mm via PUT, persistiu, preview retorna `height: 35mm/40mm/50mm` no CSS conforme escolhido.

### 2026-05-04 — Feature: "Pré-visualizar A4" no editor de templates
- O usuário pediu uma forma de ver o alinhamento cabeçalho/conteúdo/rodapé no formato A4 enquanto monta o template, antes de salvar. Adicionado:
  - **Endpoint** `POST /api/quotes/templates/preview-html` — recebe `{content, header_html, footer_html}` (rascunho não-salvo), renderiza com placeholders fake (cliente exemplo + 1 item) e devolve HTML com o mesmo wrapper A4 usado pelo `/preview-pdf-html`.
  - **UI**: botão `Pré-visualizar A4` no canto direito da barra de abas do `TemplateMultiTabEditor`. Abre um modal com iframe sandbox renderizando o template em formato A4 (210×297mm com paddings idênticos ao PDF final).
- Validado: clicar no botão abre modal, iframe carrega com cabeçalho/conteúdo/rodapé alinhados A4. Sem precisar salvar.

### 2026-05-04 — Fix: Importador não convertia data BR (DD/MM/YYYY) + migração em produção
- **Bug**: a planilha do usuário trazia datas no formato BR `20/12/1985`. O importador armazenava a string crua, e o frontend (`new Date('20/12/1985')`) retornava NaN — campo aparecia vazio.
- **Fix do importador** (`backend/routes/crm_routes.py`): agora aceita `DD/MM/YYYY` e `DD-MM-YYYY`, converte para ISO `YYYY-MM-DD` antes de salvar. Também aceita Timestamp do Excel e ISO já formatado. Validado com a planilha real (179 linhas → 74 com aniversário, todos em ISO).
- **Novo endpoint** `POST /api/crm/clients/normalize-birth-dates` — migração admin-only, idempotente, converte registros já salvos em formato BR para ISO.
- **Migração já aplicada na PRODUÇÃO da Beauty Academy** (`agentcrm.8ip.com.br`) usando `/api/scheduling/clients/{id}` PUT (endpoint existente): **74 / 74 contatos convertidos**, 0 falhas. Validado: zero registros em formato BR cru após a migração.

### 2026-05-04 — Importação XLSX completa: modelo padrão + birth_date + remoção do Agendar
- **Novo endpoint** `GET /api/crm/clients/import-xlsx-template` — retorna `.xlsx` pronto pra preencher com 2 abas:
  - `clientes`: 14 colunas (name, Telefone, email, **data de nascimento**, tipo de pessoa, cpf, cnpj, razão social, cep, endereço, cidade, estado, tags e Kambam, observações) + 2 linhas de exemplo (1 PF + 1 PJ).
  - `instrucoes`: documentação coluna a coluna (obrigatório? formato? defaults).
- **Importador estendido** (`POST /api/crm/clients/import-xlsx`) — agora reconhece todos os 14 campos com aliases PT/EN; person_type vira automaticamente `juridica` se houver CNPJ; birth_date aceita Timestamp do Excel ou string ISO. Validado E2E: importou template → todos os campos persistidos em `db.clients`.
- **UI**: novo botão `Baixar modelo` em *Clientes / Leads* (Dashboard.js), ao lado do `Importar XLSX`. Tooltip explicativo. Faz download via blob (com JWT).
- **Removido**: botão `Agendar` do cadastro de cliente (a pedido). Estados `bookingClientId`, função `handleBookFromClient` e `BookFromClientForm` inline removidos. Agendamento permanece disponível normalmente em Atendimentos / Agenda.

### 2026-05-03 — Fix: "Erro anexo" ao clicar Abrir PDF no modal Anexar Orçamento
- **Causa raiz**: o botão "Abrir PDF" no `QuoteAttachModal` era um `<a href="/api/quotes/{id}/pdf" target="_blank">`. Browser não anexa o `Authorization: Bearer <token>` em cliques de anchor → backend retornava 401/403 e o usuário via "erro ao abrir anexo".
- **Mesmo padrão errado** havia em `AtendimentosPage.js` na bolha de chat (PDF anexado por mensagem de "documento") — clicar no card abria a URL direto sem auth.
- **Fix**: substituí ambos `<a href>` por `<button>` que faz `api.get(..., responseType:'blob')` (com JWT), cria `Blob URL` e abre em nova aba via `window.open(url)`. Mesmo padrão usado pelo PreviewModal.
- **Validado**: click no "Abrir PDF" → HTTP 200 logado no network → `window.open` chamado com blob URL → PDF abre em nova aba. Sem toast de erro.

### 2026-05-03 — Fix crítico: "Erro ao baixar PDF 404" (root cause encontrado)
- **Causa raiz (real)**: no arquivo `OrcamentosPage.js`, `handlePreview()` criava o objeto `quote` passado ao `PreviewModal` SEM o campo `id` (só `quote_number`). Os botões "Baixar PDF" e "Abrir PDF" montavam a URL `/quotes/${quote.id}/pdf` → viravam `/quotes/undefined/pdf` → HTTP 404. **Não** era versão antiga do backend em produção — o endpoint funciona em ambos.
- **Fix**: `setPreviewing({ id, html: data.html, quote: { id, quote_number: data.quote_number } })` agora inclui o `id`. Também adicionei guard nos handlers `openPdf`/`downloadPdf` que mostra toast amigável caso id esteja ausente.
- **Validado**: click no botão "Baixar PDF" no preview retorna HTTP 200 + PDF binário real.

### 2026-05-03 — Feature: Áudio/Imagem/Vídeo/Documento do WhatsApp tocável no chat
- **Causa raiz**: o microserviço só gravava `"[Audio]"` como texto — nunca baixava o arquivo. O operador nunca tinha como ouvir.
- **Implementado** em 3 camadas:
  1. **Microserviço** (`whatsapp-service/index.js`): importa `downloadMediaMessage` do Baileys e baixa inbound media até 15 MB por mensagem. Envia base64 + mimetype + kind + filename no webhook.
  2. **Backend** (`routes/channels_routes.py`): novo helper `_persist_inbound_media()` decodifica base64, faz upload em object storage (via `put_object`) e registra em `db.files`. Persiste `media_url`, `media_mimetype`, `media_kind`, `media_filename`, `media_size` na própria mensagem do ticket.
  3. **Frontend** (`AtendimentosPage.js`): player `<audio controls>` para kind=audio, `<img>` para image, `<video controls>` para video, link de download para document. Tudo inline na bolha da mensagem.
- Reutiliza o endpoint público `/api/upload/files/{path}` que já existia (sem auth, via db.files lookup).
- Validado: webhook simulado → ticket criado → ticket-list retorna `media_url` → browser carrega o áudio num `<audio>` element com HTTP 200 + Content-Type audio/ogg.
- **Importante para deploy**: para essa feature funcionar em produção é OBRIGATÓRIO redeployar TANTO o backend QUANTO o microserviço Node.js (`whatsapp-service/`).

### 2026-05-02 — Fix: Cabeçalho/rodapé com imagem espremiam o conteúdo do PDF
- **Bug**: ao colar uma imagem grande (banner) no Cabeçalho e Rodapé do template de orçamento, o PDF reservava uma faixa enorme para a imagem (que ultrapassava a margem `@page`), comprimindo o conteúdo do orçamento para metade da página. Além disso, a imagem podia renderizar com largura parcial (centro ~50%).
- **Fix** (`backend/routes/quotes_routes.py` em `_generate_pdf_bytes` e `_build_browser_preview_html`):
  - Adicionada CSS de constraint para `#__quote_header` (max-height 22mm) e `#__quote_footer` (max-height 18mm) com `overflow:hidden`.
  - Imagens dentro do header/footer agora forçadas a `width:100%; max-width:100%; max-height:22mm/18mm; height:auto; object-fit:contain` — preenchem toda a largura útil mas não ultrapassam a faixa reservada.
  - Mesmas constraints aplicadas no preview HTML (iframe) para que browser e PDF fiquem visualmente idênticos.
- **Validado**: PDF de teste com banner pesado (`AgentCRM.png`) → 162 KB, conteúdo fluindo com 200+ linhas, banner em cada página com largura total.

### 2026-05-02 — Fix: Editor de template (conteúdo sumia ao trocar de aba)
- **Bug**: ao alternar entre abas Conteúdo / Cabeçalho / Rodapé do editor de templates, o conteúdo digitado em uma aba sumia ou vazava para outra.
- **Causa raiz**: um único `ReactQuill` com `value` controlado — ao mudar de aba, o `setContents` interno disparava `text-change` com a closure nova, gravando o HTML da aba anterior no campo da nova aba.
- **Fix**: renderizar **3 instâncias** de `ReactQuill` em paralelo (uma por aba) e alternar via `display:none`. Cada editor mantém seu próprio value + onChange, sem cross-contamination. Arquivo: `/app/frontend/src/pages/CRM/OrcamentosPage.js` → `TemplateMultiTabEditor`.
- Validado via browser: os 3 campos persistem independentemente em round-trip entre abas.

### 2026-05-02 — Importação XLSX de Contatos (Incinera)
- Novo endpoint `POST /api/crm/clients/import-xlsx` (admin/owner-only) — multipart `file`
- Auto-matching de cada item de `tags e Kambam` contra Tags da empresa OU Colunas do Kanban (case/whitespace-insensitive). Não-matched vira tag livre + relatório.
- Cliente existente (mesmo phone digits-only) é atualizado: nome/email refrescados, tags em **união**.
- Quando há match com coluna do Kanban → cria/atualiza UM ticket com `kanban_column_id` (último match vence). 1 ticket por cliente, idempotente.
- Telefones com 15+ dígitos (LIDs) são importados normalmente (sem filtro).
- UI: botão `Importar XLSX` em `Clientes / Leads` (Dashboard.js) + report verde com counts e top labels desconhecidos
- Validado em preview com a base real da Incinera: 1153 linhas, 0 ignoradas, 103 tickets ancorados em colunas, dedup OK em re-run.
- Testes: `/app/backend/tests/test_xlsx_import.py` (2 passes)
- Documentação: `/app/IMPORT_INCINERA_GUIDE.md`

### 2026-05-02 — 5 Features em sequência (1 → 5)
**F1: Cabeçalho/Rodapé multi-página no editor**
- `quote_templates` agora persistem `header_html` + `footer_html`
- `_generate_pdf_bytes` injeta como CSS running elements (`@page { @top-center; @bottom-center }`) — repete em todas as páginas
- Editor com 3 sub-abas (Conteúdo / Cabeçalho / Rodapé), cada uma com Quill + image upload

**F2: Preview = PDF (visualização idêntica)**
- Novo helper Python `_QUOTE_STYLESHEET` (single source of truth visual)
- Nova função `_build_browser_preview_html` injeta o stylesheet num wrapper A4 mockado
- Novo endpoint `GET /api/quotes/{qid}/preview-pdf-html`
- `OrcamentosPage.PreviewModal` e `QuoteAttachModal` agora usam iframe sandbox em vez de `dangerouslySetInnerHTML` — preview = PDF byte-for-byte

**F3: Conexão WhatsApp → Flow automático**
- `default_flow_id` em `/channels/connections` e `/whatsapp/connections` (empty string clears)
- Webhook trigger: `_trigger_flow_for_ticket()` envia o primeiro nó `message` como outgoing quando ticket NOVO numa conexão com flow
- UI: botão `GitBranch` (`edit-conn-{id}`) abre modal `ConnectionFlowModal` com select dos fluxos
- Renomear flow: novo botão `Edit2` em FlowBuilderPage + função `renameFlow()`

**F4: Reordenar Kanban (modo disfarçado)**
- `POST /api/crm/kanban-columns/reorder` aceita `{column_ids: List[str]}`
- UI: long-press 3s no título OU `Shift+R` ativa modo reordenação; badge "ORDENANDO"; column headers viram draggable

**F5: Restrição de visibilidade (claim/release)**
- `_user_can_view_all_tickets()` + `_ticket_visibility_filter()` aplicam Mongo `$or`: assigned_to=self OR (null AND status=aberto)
- Aplicado em `/tickets`, `/tickets/counts`, `/kanban`, `/kanban-v2`
- Endpoints: `POST /tickets/{id}/claim` (409 se já reivindicado), `POST /tickets/{id}/release`
- UI: botão verde "+ Puxar" (`claim-ticket-{id}`) em tickets unassigned

**Validação iter48**: 10/10 backend + UI confirmada (claim-ticket count=82, rename-flow count=12, kanban-col-header count=9, edit-conn modal com select de flow funcionando)

### 2026-05-01 v2 — PDF Moderno + @lid AUTO-RESOLVE (resolve as 2 follow-ups do user)
**Reclamacao do user**: PDF orcamento-1025.pdf ainda estourava a margem direita do A4 e cabecalhos quebravam mid-word ("Descricao d / os Servicos", "Valor km rodad / 0.", "Qtde. Estim / ada"); @lid em **NOVO contato** continuava chegando como numero estranho — operador NAO TEM como digitar manualmente porque nem tem o numero salvo.

**Fix PDF Modern CSS** (`quotes_routes.py _generate_pdf_bytes`):
- Margem A4 ajustada para `16mm 14mm` (mais respiro)
- `box-sizing: border-box` em todos os elementos + `max-width: 100% !important` em table/p/div/section/header/footer/ul/ol/blockquote/img — anula widths inline do `.docx` que estavam causando overflow
- Word-break corrigido: `word-break: normal; overflow-wrap: anywhere; hyphens: auto` — palavras quebram em whitespace primeiro, so no meio de char se o token isolado nao couber
- Paleta moderna slate-blue: `<h2>` com gradiente claro + border-left brand-blue + uppercase, `<th>` fundo solido brand-blue com texto branco uppercase, zebra striping `#f8fafc`, bordas `#cbd5e1` consistentes
- Typography: Inter font, `font-size: 9.8pt` base, `line-height: 1.5`, `letter-spacing` ajustado
- `tr { page-break-inside: avoid }` evita orphan rows

**Fix @lid Auto-Resolve** (microservico v2.1.4):
- Refatorado: nova funcao `tryResolveLid(instance, instanceId, lidJid)` com 4 estrategias em cascata (persistent_map → signalRepository.lidMapping.getPNForLID → sock.onWhatsApp probe → store.contacts cross-ref)
- **Background sweep a cada 30s**: queue de LIDs pendentes com max 30 attempts (~15min); quando resolve, dispara `/api/channels/webhook/lid-resolved` → ticket auto-promovido ou mesclado pelo backend (logica ja existente)
- **Endpoint `POST /instances/:id/resolve-lid`** para probe sob demanda (UI button)

**Backend `channels_routes.py`**: novo `POST /api/channels/instances/{instance_id}/probe-lid` proxy graceful (sempre 200, retorna `{resolved, phone, source}` ou `{resolved:false, error:...}` mesmo com microservico down).

**Frontend `AtendimentosPage.js`**: banner amarelo agora tem **DOIS botoes**:
- `data-testid="probe-lid-btn"` "Tentar agora" — chama backend → microservico → se WA expoe o numero AGORA, ticket auto-mescla
- `data-testid="resolve-lid-btn"` "Informar telefone" — fallback manual existente
Novo helper `channelsAPI.probeLid(instanceId, lidJid)` em `services/api.js`.

**Validacao** (testing agent iter47): 11/11 novos testes + 72/72 regressao total + UI E2E. NO bugs found.

**Acao do user**:
1. Deploy backend (Save to GitHub) — PDF moderno + endpoint probe-lid
2. **Deploy microservico (mandatorio para auto-resolve!)** — sem isso, o @lid continua precisando do fallback manual

### 2026-05-01 — Fix DEFINITIVO PDF Orcamento + Bug @lid Novo Contato
**Reproducao confirmada com producao** (acesso fornecido pelo user em agentcrm.8ip.com.br/incinera adm@incinera.com): baixei via script Python o HTML real do template "INCINERA - Orcamento Padao" e descobri que ele continha `<p>{{#items}}{{/items}}</p>` (par VAZIO de marcadores) ANTES da tabela, com a `<tr>` real (contendo `{{description}}`, `{{quantity}}`, etc) DESEMBRULHADA. O `_auto_wrap_loops` antigo fazia early-return ao detectar `{{#items}}` em qualquer lugar, e o `_render_template` substituia o par vazio por nada, deixando os placeholders reais vazarem para o PDF.

**Fix 1: PDF Engine** (`quotes_routes.py`):
- Reescrito `_auto_wrap_loops` com **BeautifulSoup4** (parser HTML real). Estrategia: STRIP-AND-REWRAP — primeiro remove todos os marcadores `{{#items}}/{{/items}}/{{#freights}}/{{/freights}}` existentes, depois localiza a primeira `<tr>` que contem o token-marcador (`{{description}}` para items, `{{km_total}}`/`{{price_per_km}}` para freights) e injeta novos marcadores como NavigableString ANTES e DEPOIS da `<tr>`. Linhas irmas duplicadas com mesmos placeholders sao removidas via `.decompose()`.
- Resiliente a: marcadores aninhados em `<p>`, tags inline `<strong>/<em>/<span>` dentro das celulas, `<td data-row="..">` annotations do Word, multiplas tabelas no mesmo template.
- **Validado contra o template REAL da Incinera**: 0 placeholders vazando no render, PDF de 50KB com header `%PDF-1.7` valido, items+fretes corretamente expandidos.

**Fix 2: @lid Novo Contato** (microserviço + backend + frontend):
- **Microservico Node.js (`whatsapp-service/index.js v2.1.3`)**:
  - Webhook `/webhook/message` agora carrega novo campo `lid_jid` no payload (preserva o `XXX@lid` original quando o LID nao foi resolvido)
  - Novo: quando o microservico CONSEGUE resolver um LID via Baileys (senderPn/store/persistent_map), ele dispara fire-and-forget `POST /api/channels/webhook/lid-resolved` com `{instance_id, lid_jid, phone, source}` — o backend faz auto-merge.
- **Backend (`channels_routes.py`)**:
  - Tickets criados com `_looks_like_lid(phone)=True` agora salvam `lid_jid="XXX@lid"`, `pending_lid_resolution=True` e tag automatica `"Numero Oculto"`.
  - Novo endpoint `POST /api/channels/webhook/lid-resolved` chamado pelo microservico → `_apply_lid_resolution(...)` faz merge automatico (se ja existe outro ticket aberto com o phone real) ou promote (atualiza customer_phone in-place + limpa tag/flags + religa client_id).
- **Backend (`crm_routes.py`)**:
  - Novo endpoint `POST /api/crm/tickets/{id}/resolve-lid` (UX manual) — operador digita o phone real e a mesma logica de merge/promote roda.
  - Envio outgoing via `POST /api/crm/tickets/{id}/messages`: se o ticket tem `pending_lid_resolution=True`, usa `lid_jid` como `phone` no payload pro microservico (a UNICA forma do WhatsApp aceitar para contatos com privacidade ativa).
- **Frontend (`AtendimentosPage.js`)**: banner amarelo `data-testid="lid-pending-banner"` no header do chat quando `selectedTicket.pending_lid_resolution=True`. Botao `data-testid="resolve-lid-btn"` abre `window.prompt` → chama `crmAPI.resolveTicketLid(id, real_phone)` → toast + reload.

**Validacao** (testing agent iter46): 14/14 backend + UI confirmada. PDF gerado com 0 leaks usando o template REAL quebrado da producao. Fluxo @lid completo (webhook -> banner -> resolve-lid -> merge automatico) funcionando. Ver `/app/test_reports/iteration_46.json`.

**Acao do user**:
1. Deploy backend (Save to GitHub → Render auto-deploy) — PDF fica funcional imediatamente.
2. Deploy microservico (recomendado, nao mandatorio) — habilita auto-resolve do @lid quando o Baileys descobre o phone real (fallback manual via banner sempre funciona).

### 2026-04-30 — Fase 11: Auto-wrap em tempo de render + CSS moderno
**Problema persistente**: mesmo apos Fase 10, o user reportou que `{{description}}`, `{{quantity}}`, `{{km_total}}`, `{{price_per_km}}` continuavam raw no PDF. Causa: o template no banco nao tinha wrapper `{{#items}}/{{/items}}` (produto foi uploadado ANTES do Fase 9, e user nao clicou Reconverter).

**Fix definitivo — auto-wrap no render**:
- `_auto_wrap_loops(html)` detecta automaticamente em tempo de render:
  - Primeira `<tr>` com `{{description}}` → envelopa com `{{#items}}...{{/items}}`, remove linhas irmas que tambem tem `{{description}}` / `{{quantity}}` / `{{unit_price}}`
  - Primeira `<tr>` com `{{km_total}}` ou `{{price_per_km}}` → envelopa com `{{#freights}}...{{/freights}}`, idem para irmas
- So atua se `{{#items}}` / `{{#freights}}` NAO existir no HTML — respeita templates que ja tem wrapper explicito
- `_render_template` agora chama `_auto_wrap_loops` antes da substituicao
- **Templates antigos (sem reconverter) funcionam out-of-the-box** agora

**CSS modernizado** no `_generate_pdf_bytes`:
- Fonte: `Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica Neue, Arial, sans-serif`
- Headers `h1` 18pt / `h2` 13pt / `h3` 11pt com cor slate-900
- Tabelas com borders sutis (slate-200) + zebra striping (fafbfc) + th bg slate-100
- Padding generoso (5pt 7pt), line-height 1.45, letra legivel 10pt base
- `table-layout: fixed` + `word-wrap: break-word` (nunca mais estoura a pagina)
- Margem A4 ajustada pra 14mm x 12mm

**Validacao**:
- Unit test local com template sem wrapper: `{{description}}` e `{{km_total}}` substituidos por valores corretos ("Coleta", "Goiania", "R$ 12,50", "R$ 280,00")
- Regressao 31/31 backend tests passing

**Acao do user**:
Apenas redeploy do backend. **Nao precisa reconverter templates nem re-uploadar .docx**. O auto-wrap acontece automaticamente em toda renderizacao.

### 2026-04-30 — Fase 10: Fix PDF desfigurado — CSS A4 + Reconvert templates antigos
**Analise do orcamento-1016.3.pdf do user**:
- Placeholders `{{description}}`, `{{quantity}}`, `{{unit}}`, `{{total}}`, `{{km_total}}`, `{{price_per_km}}` aparecendo VERBATIM no PDF → template antigo foi convertido ANTES do `_fold_rows` ser deployed → nao tem wrapper `{{#items}}/{{/items}}` → `_render_template` nao expandiu.
- Tabelas espremidas, texto truncado mid-word ("ativid", "mer") → falta de `@page size: A4` + `table-layout: fixed` no HTML.

**Fixes**:
- **`_generate_pdf_bytes` agora injeta CSS prefixo automatico**: `@page { size: A4; margin: 15mm 12mm }`, `table { width:100%; table-layout: fixed; word-wrap: break-word }`, `img { max-width: 100%; height: auto }`, `td/th { padding, vertical-align, overflow-wrap: break-word }`. Todo PDF sai A4 com layout consistente.
- **Novo endpoint `POST /api/quotes/templates/{tid}/reconvert-placeholders`**: aplica `_normalize_docx_placeholders` sobre o HTML armazenado, consertando templates antigos sem precisar re-upload do .docx. Retorna `{updated, had_loops}`.
- **Botao UI "Reconverter placeholders"** (icone RefreshCw) em cada card de template na aba Templates. Dica aparece ao hover. Toast confirma se loops foram detectados.
- **Regressao**: 31/31 tests passing.

**Acao do user**:
1. Fazer Save to GitHub + redeploy do BACKEND (traz o CSS A4 + endpoint reconvert).
2. Na producao, Orcamentos → Templates → icone **"Reconverter"** (circulo com flecha) no template "Incinera Padrao" → confirma.
3. Gerar novo orcamento → PDF agora sai em A4 com items expandidos corretamente.

### 2026-04-30 — Fase 9: Conversao .docx super robusta (imagens + loops automaticos)
- **Imagens embedded**: upload .docx agora converte imagens (logos/cabecalho/rodape) em data URIs base64 inline no HTML via `mammoth.images.img_element`. Templates viram self-contained — WeasyPrint renderiza sem fetch externo.
- **Auto-fold de linhas numeradas → loops**: detecta tokens numerados (`ITEM_1/ITEM_2/...`, `QTDE_1/QTDE_2/...`, `VALOR_UNI_1/VALOR_UNI_2/...`) e converte automaticamente a PRIMEIRA `<tr>` do docx em `{{#items}}...{{/items}}`, removendo as demais linhas que eram duplicatas. Mesma logica para fretes.
- **Marcador de primeira linha flexivel**: aceita tanto `{{ITEM_1}}` quanto `{{ITEM_FRETE}}` (sem sufixo numerico) como abertura do loop — template da Incinera ja funciona out-of-the-box.
- **Fix placeholder partido em runs**: tokens como `{<strong>Faturamento_minimo_em_kg</strong>}` (Word quebrou o placeholder entre tags HTML) sao colapsados antes da conversao via `_flatten_inline_brace_tags`.
- **Validacao completa** com o `.docx` real da Incinera: 23 tokens agora 100% canonicalizados, 2 loops (items + freights) detectados, `minimum_billing_kg` resolvido, render HTML OK, PDF 14.5KB com header `%PDF-1.7`.
- **Regressao**: 31/31 backend tests passing.

### 2026-04-30 — Fase 8: Placeholders com descricao amigavel + confirmacao que Fase 7 esta live
- **Lista de placeholders melhorada**: agora agrupada em 7 categorias (ORCAMENTO, CLIENTE, VALORES, CONDICOES, VENDEDOR, OBSERVACOES, BLOCOS) com **descricao em linguagem humana** ao lado de cada token (ex: `{{razao_social}}` — "Razao social / Nome fantasia"). Click copia o token pra clipboard + toast de confirmacao.
- **Validacao E2E** no preview Emergent: 14/14 checks PASSED pelo testing agent. Confirmado que:
  - Aba "Itens" (nao "Produtos") esta live
  - Modal "Novo Item" (nao "Novo Produto") esta live
  - Botao de imagem no Quill toolbar presente (`button.ql-image`)
  - Placeholders agrupados com descricoes funcionando
  - Toast "Placeholder copiado" dispara no click
- **Conclusao sobre a reclamacao do user**: nao ha bug no codebase — producao dele (`agentcrm.8ip.com.br`) esta servindo bundle antigo em cache ou git nao foi atualizado. Acao do user: fazer **hard refresh (Ctrl+Shift+R)** apos o redeploy para limpar cache do Service Worker / bundle JS.

### 2026-04-30 — Fase 7: Renomeacoes + Editor de template com imagem + Fix PDF branco
- **"Produtos/Servicos" → "Itens"** em toda UI (aba, label de secao, modais "Novo Item"/"Editar Item", placeholders, mensagens de vazio, confirmacao de delete).
- **"+ do Catalogo" → "+ Item"** (items) / **"+ Frete"** (fretes) — botoes mais curtos e genericos.
- **Editor de template com upload de imagem** — `ReactQuill` com handler customizado no botao de imagem: abre `<input type=file>`, envia para `POST /api/upload/`, e insere `<img src="URL publica">` no conteudo. Permite criar cabecalho/rodape/timbrado da empresa. WeasyPrint agora configurado com `base_url` (`PUBLIC_BACKEND_URL`/`FASTAPI_URL`) para resolver as URLs das imagens durante render de PDF.
- **Bug "tela branca" do PDF RESOLVIDO**: PreviewModal substituiu `window.open('') + document.write` (que falha no Safari) por download real do PDF via `api.get(..., responseType: 'blob')` + `URL.createObjectURL` → abre no browser nativo ou faz download. 2 botoes: "Baixar PDF" (data-testid download-pdf-btn) + "Abrir PDF / Imprimir" (print-quote-btn).
- **Checkmarks WhatsApp-style** (Fase anterior, confirmados): sent=1check cinza, delivered=2check cinza, read=2check azul — codigo ja existia no AtendimentosPage linhas 745-775 e eh atualizado via `messages.update` do microservice.
- **Testes**: 36/36 backend (iter40 21/21 + iter44 10/10 + iter45 5/5). Novos testes iter45 validam `/api/upload/` funcionando, `/api/upload/files/{path}` publico (necessario para WeasyPrint), PDF retornando binario com header %PDF-1.x.

### 2026-04-30 — Fase 6: Fix DEFINITIVO @lid (independente de connection_id + lid_phone_map persistente)
- **Causa-raiz da Fase 5 falhar**: tickets criados manualmente (botao `+`) nao tinham `connection_id`. O fallback Strategy 1 da Fase 5 filtrava por `connection_id`, entao tickets manuais nunca casavam. User reportou caso #1014/#1015.
- **Fix backend definitivo**:
  - Quando agente envia outgoing via chat: `connection_id` eh setado no ticket automaticamente se estiver vazio (idempotente).
  - Strategy 1 do webhook fallback agora eh GLOBAL na empresa (sem filtro de connection_id), janela 5min — extremamente confiavel.
- **Fix microservico (lid_phone_map persistente em disco)**:
  - Nova funcao `rememberLidForPhone(instanceId, lid, phone)` salva mapping LID → phone real toda vez que o operador envia outgoing (`/send` e `/send-media`).
  - `lookupPhoneForLid` consulta o map quando chega incoming com @lid e nem `senderPn` nem `participantPn` resolveram.
  - Persiste em `${AUTH_DIR}/${instanceId}/lid_phone_map.json` — sobrevive restarts/redeploys.
- **Testes**: 10/10 backend test_iteration_44.py incluindo `test_lid_fallback_works_even_without_ticket_connection_id` que reproduz EXATAMENTE o caso #1014/#1015 (ticket manual sem connection_id).
- **REDEPLOY_GUIDE.md** atualizado com instrucoes especificas para backend (prioritario) + microservico (recomendado).

### 2026-04-30 — Fase 5: Fix @lid robusto via last_outgoing_at
- **Causa raiz identificada**: a Fase 4 fazia fallback por push_name. Mas quando o operador edita o nome do contato no CRM ('Izaque Ferreira'), o WhatsApp continua mandando o pushName real da conta WhatsApp ('Izaque Carriço'). Os nomes nao batem → fallback nao acionava → ticket duplicado.
- **Solucao definitiva**: rastrear `last_outgoing_at` no ticket (atualizado quando agente envia msg via `/api/crm/tickets/{id}/messages`). Quando webhook chega com phone formato LID:
  - **Strategy 1 (mais confiavel)**: ticket com `last_outgoing_at` nas ultimas 5 minutos na mesma connection → match direto. Resolve o cenario "operador acabou de mandar mensagem e cliente respondeu".
  - **Strategy 2 (fallback)**: ticket com mesmo `customer_name` + connection nas ultimas 72h.
  - Ambas independentes do microservico Baileys conseguir resolver `senderPn`.
- **Testes**: 9/9 backend test_iteration_44.py incluindo novo `test_lid_fallback_via_last_outgoing` que reproduz exatamente o cenario do user (#1011/#1012).
- **Acao do usuario**: redeployar o backend novamente para esse fix entrar em prod.

### 2026-04-30 — Fase 4: Fix Bug @lid + Merge tickets + Quote = Ticket Number
- **Fix bug `@lid` (server-side fallback)** (`/app/backend/routes/channels_routes.py`): heuristica `_looks_like_lid` (>= 14 digitos OU nao-brasileiro). Quando webhook chega com phone LID + push_name e ja existe ticket aberto recente do mesmo `customer_name + connection_id` (72h window), **mescla a mensagem nesse ticket existente** em vez de criar duplicado. customer_phone real do ticket NAO eh sobrescrito. Funciona MESMO quando o microservico Baileys nao consegue resolver `senderPn` — completamente independente de redeploy do Render.
- **Endpoint `POST /api/crm/tickets/{src}/merge-into/{dst}`**: mescla src dentro de dst (mensagens dedup por wa_message_id + tags unicas + re-aponta quotes), deleta src, multi-tenant safe. UI: botao "Mesclar com outro atendimento" no menu MoreVertical do header do chat → `MergeTicketModal` com search e lista de candidatos.
- **Microservico Node.js**: logging detalhado quando @lid nao resolve (printa `senderPn/participantPn/remoteJidAlt/participant/pushName`) + tentativa adicional via `store.contacts` lookup. Pendente redeploy no Render para usar (mas o fallback no backend ja resolve mesmo sem isso).
- **Quote_number = ticket_number**: orcamento agora SO pode ser criado a partir de um ticket. POST /quotes sem ticket_id retorna 400. quote_number herdado do ticket. Segundo orcamento no mesmo ticket fica versionado (#1007.2). Botao "Novo Orcamento" na aba lista mostra apenas toast orientando criar via Atendimentos.
- **QuoteEditor responsivo + banner ticket**: ModalShell com `max-h-[90vh] + flex-col + overflow-y-auto`. Footer agora **sticky** para sempre visivel mesmo em telas baixas. Banner azul "Vinculado ao Atendimento #N" + cliente travado (sem botao Trocar) quando vem via ticket. Header mostra "Novo Orcamento — Atendimento #1006".
- **Testes**: 8 novos backend (test_iteration_44.py) + 32 regressao (iter40 21/21 + iter42 + iter43) all green. Frontend 10/10 E2E.

### 2026-04-30 — Modulo de Orcamentos - Fase 3 (Atalho no chat + Upload .docx + WYSIWYG)
- **Atalho "Novo Orcamento" no header do ticket** (`AtendimentosPage.js`): icone FileText verde (`data-testid="new-quote-from-ticket-btn"`) ao lado de Editar Contato/Excluir. Abre o `QuoteEditor` com `client_id` e `ticket_id` pre-preenchidos. Footer do editor agora tem **2 botoes**:
  - **Salvar Orcamento** (verde) — salva e fecha. Disponivel depois em Orcamentos ou via "Anexar Orcamento" no chat.
  - **Salvar e Enviar via WhatsApp** (azul) — salva e abre automaticamente o `QuoteAttachModal` com o orcamento recem-criado **ja selecionado** (preview carregado, conexao auto-selecionada, basta clicar Enviar).
- **Upload de template .docx** (`POST /api/quotes/templates/upload-docx`): 
  - Multipart com `file` (.docx), `name`, `is_default`. Limite 10MB. Reject extensao invalida.
  - Conversao via **mammoth** (preserva paragrafos, tabelas, bold/italic, listas).
  - Helper `_normalize_docx_placeholders` converte placeholders Word-friendly para canonicos: `{ NOME }` -> `{{nome}}`, `{ RAZÃO_SOCIAL_/_FANTASIA }` -> `{{razao_social}}` (com strip de acentos), `{ CNPJ_CPF }` -> `{{cnpj_cpf}}`, `{ SOMA_TOTAL_ITENS }` -> `{{total_value}}`, etc. 12+ tokens da estrutura Incinera mapeados automaticamente. Tokens nao reconhecidos preservam como `{{ITEM_1}}` para o usuario ajustar no editor.
  - Multi-tenant safe + apos upload abre auto-mente no editor para refinamento.
- **Editor WYSIWYG (Quill)** no `TemplatesTab`: substituido `<textarea>` HTML cru por `react-quill-new` com toolbar (Bold/Italic/Underline/Strike, cores, listas, alinhamento, link). Placeholders chips clicaveis (copy clipboard) continuam disponiveis. Usuario comum agora pode editar sem saber HTML.
- **Bug @lid/numero estranho no chat resolvido**: usuario redeployou microservico no Render (commit `58d294e`) — `/send-media` (Fase 2) e fix `senderPn` (handoff anterior) agora ativos em prod.
- **Testes**: 36/36 backend (7 novos iter43 + 29 regressao iter40/42) + 7/7 frontend E2E. Todos os fluxos validados.

### 2026-04-30 — Modulo de Orcamentos - Fase 2 (PDF + envio via WhatsApp no chat)
- **Backend - geracao de PDF server-side** (`/app/backend/routes/quotes_routes.py`):
  - Instalado **WeasyPrint 68.1** (deps libpango/libcairo ja presentes no container).
  - Novo `GET /api/quotes/{id}/pdf` retorna PDF binario (Content-Type: application/pdf) com filename `orcamento-{N}.pdf` — gerado a partir do mesmo HTML do `/render`. ~15KB por orcamento, header `%PDF-1.7` valido.
  - Refator: extraido helper `_build_quote_html(qid, user, db)` reusado por `/render`, `/pdf` e `/send-whatsapp`.
- **Backend - envio direto via WhatsApp** (`POST /api/quotes/{id}/send-whatsapp`):
  - Resolve telefone na ordem `data.phone -> quote.client.phone -> ticket.customer_phone`. 400 se nao puder resolver.
  - Valida ownership da `connection_id` (multi-tenant) — 404 cross-tenant.
  - Codifica PDF em base64 e POSTa no microservico Node.js endpoint `/instances/{conn}/send-media`.
  - Loga mensagem do tipo `document` com `attachment_kind='quote_pdf'` no `tickets.messages` (sempre, mesmo em falha — permite retry).
  - Atualiza `quote.last_sent_at/phone/status` e promove rascunho->enviado SOMENTE em sucesso.
  - Falha 502 com mensagem amigavel sanitizada (sem leak de stacktrace) — diferenciacao automatica entre "Not connected" / "send-media nao implementado" / generico.
- **Microservico Node.js** (`/app/whatsapp-service/index.js`): novo endpoint `/instances/:id/send-media` aceita `{phone, filename, mimetype, data_base64, caption}`. Suporta image (`image:`) ou document (`document:` com `fileName`). Reusa toda a logica de resolucao de JID brasileiro (onWhatsApp + 4 fallbacks) ja consolidada no `/send`. **Producao requer redeploy no Render** para entrar em uso (dev: testado e funcional na porta 3002).
- **Frontend - integracao no chat** (`/app/frontend/src/pages/CRM/AtendimentosPage.js`):
  - Botao discreto `data-testid="attach-quote-btn"` (icone FileText verde) no rodape do chat ao lado do schedule-message-btn.
  - Renderizacao de mensagens `type='document'` com chip clicavel `chat-quote-attachment-{id}` linkando para o PDF inline.
- **Componente `QuoteAttachModal.js`**: 2 colunas (lista de orcamentos do cliente + preview HTML scaled), select da conexao WhatsApp, textarea de legenda pre-preenchida, botao "Abrir PDF" (download direto) e "Enviar via WhatsApp" com toast de feedback.
- **Testes**: 9/9 backend Phase 2 (test_iteration_42.py) + 60% frontend smoke (modal opens, lista carrega — full pick→send→chip flow disponivel apos seed de quote vinculado a ticket, ja criado: quote #17 → ticket #1006).

### 2026-04-30 — Modulo de Orcamentos (Quotes) - Fase 1 Completa
- **Backend completo** (`/app/backend/routes/quotes_routes.py`):
  - 4 collections: `quote_services` (catalogo de produtos), `quote_freights` (catalogo de fretes), `quote_templates` (HTML templates com placeholders), `quotes` (propostas geradas).
  - CRUD completo para todos os modelos com isolamento multi-tenant.
  - **Auto-seed** de 1 template default "Padrao Comercial" na primeira chamada de `GET /quotes/templates` ou `GET /quotes/{id}/render` — promove canonical/oldest se nenhum esta marcado como default (idempotente, robusto).
  - **Quote_number sequencial** via collection `counters` (`{company_id}:quotes`) — atomico/race-safe.
  - **Calculos automaticos** server-side: `items_total + freights_total = total_value`. Recalculo automatico no PUT quando items/freights mudam.
  - **Template engine simples** com placeholders escalares (`{{quote_number}}`, `{{razao_social}}`, etc) e blocos de loop (`{{#items}}...{{/items}}` e `{{#freights}}...{{/freights}}`) — regex DOTALL. Valores monetarios formatados via `_format_brl` (R$ 1.350,00).
  - **Endpoint `/render`**: combina quote + template + dados do cliente (via `clients` collection, suporta PJ via `company_name` e `cnpj`/`cpf`) e retorna `{html, quote}` para preview/impressao.
- **Frontend completo** (`/app/frontend/src/pages/CRM/OrcamentosPage.js`):
  - 4 abas (Orcamentos / Produtos / Fretes / Templates) com data-testids para testabilidade.
  - **QuoteEditor**: busca/cria cliente inline (autocomplete + criar novo modal), seleciona template, "+ do Catalogo" abre modal pickando produtos/fretes pre-cadastrados, copia o `default_price` mas mantem **unit_price editavel inline** (alteracao recalcula `quote-grand-total` em tempo real). Subtotais por categoria + total geral.
  - **PreviewModal**: HTML renderizado pelo backend exibido via `dangerouslySetInnerHTML`, botao "Imprimir / Salvar PDF" abre nova janela com `window.print()` automatico.
  - **Templates**: editor HTML com lista de placeholders chips clicaveis (copy to clipboard), checkbox "is_default" exclusivo (apenas 1 default por empresa).
  - **createPortal** para todos os modais (`document.body` + `z-[100]`) — fix de bug de stacking encontrado em iter40 quando picker nesteado dentro do editor.
  - Feature `orcamentos` com icone `FileText` no menu CRM.
- **Backfill no startup**: companies com `atendimentos` ou `agendamentos` recebem `orcamentos` automaticamente.
- **Testes**: 20/20 backend (`/app/backend/tests/test_iteration_40.py`) + 7/7 frontend E2E (`iteration_41.json`) — flow completo validado, edicao inline de valor unitario com total atualizando ao vivo confirmada.

### 2026-04-30 — Visão 360° do cliente (timeline no painel de atendimento)
- Novo endpoint `GET /api/crm/clients/{id}/timeline?limit=N` retornando `{client, stats, tickets}`.
- **Stats via MongoDB aggregation pipeline** (`$group`) — totais corretos mesmo com mais de `limit` tickets. Inclui: `total_tickets`, `open`, `closed`, `total_value`, `avg_value`, `last_visit`.
- **Tickets paginados** ordenados por `created_at` desc, projeção sem `_id`.
- **EditContactModal ganhou aba "Histórico"** com badge de contagem, 3 cards de stats (Atendimentos, Total Movimentado, Última Visita) e lista de tickets passados destacando o ticket atual.
- **Testes (iter39 + retest manual)**: 8/8 backend PASS + frontend e2e completo OK.

### 2026-04-30 — Contato no chat = Cliente/Lead real (vínculo definitivo)
- Novo campo `ticket.client_id` ligando o atendimento ao cadastro real do Cliente/Lead.
- **Helper `find_or_create_client_by_phone`** (digits-only) usado em: POST /api/crm/tickets, webhook do WhatsApp e run_campaign — todo ticket novo já nasce vinculado.
- **Backfill no startup** (`backfill_ticket_client_links`): tickets legados que tinham só `customer_phone` recebem `client_id` automaticamente via match por telefone.
- **Novos endpoints**: `GET /api/crm/tickets/{id}/client` (lazy-link quando ainda não há vínculo) e `PUT /api/crm/tickets/{id}/client` (atualiza o cliente real e sincroniza os denormalized fields do ticket).
- **EditContactModal reescrito**: agora carrega/edita o Cliente real. Modo compacto (nome, doc, telefone, email) + "Ver mais" expande endereço completo (CEP com auto-fill ViaCEP, cidade, UF, observações). Toggle PF/PJ controla CPF↔CNPJ e exibe campo "Empresa" para PJ.
- **Testes (iter38)**: 10/10 backend PASS + frontend e2e completo OK.

### 2026-04-29 — Perfis de Acesso liberado na Incinera + Valor sai do contato e vai pro header do chat
- **Produção**: habilitado `perfis_acesso: enabled=true` no Tipo de Negócio "Atendimento ao Cliente" (usado pela Incinera). Propagado automaticamente para a company.
- **Campo "Valor" removido do EditContactModal** (ele pertence ao ticket, não ao contato). Substituído por `TicketValueEditor` inline no header do chat — clique no valor → input edita → Enter/blur salva → toast. Atende ao mockup do usuário.
- **Próximo passo (pendente)**: unificar EditContactModal com ClientForm completo (CPF/CNPJ, endereço, CEP, empresa) + modo compacto/expandir, amarrado ao cadastro real do cliente/lead (necessita adicionar `client_id` no ticket).

### 2026-04-29 — Vincular usuario a uma ou mais conexões WhatsApp + reforço do escopo do Perfil de Acesso
- **CompanyUser ganhou `connection_ids: List[str]`** — POST/PUT/GET `/api/scheduling/company-users` aceitam e retornam o campo. Lista vazia `[]` LIMPA o vínculo (não é silenciosamente ignorada). Default `[]` quando omitido.
- **`/api/auth/login` propaga `user.connection_ids`** automaticamente para o frontend.
- **Frontend UserForm**: novo grid de checkboxes com todas as conexões da empresa, contador "X selecionada(s)" e hint explicando que vazio = acesso a todas as conexões.
- **Hint de Perfil de Acesso** no form do usuário: "O perfil libera apenas as funcionalidades habilitadas para o nicho de negócio da empresa." Verificado que `/api/scheduling/all-features` continua filtrando pelo `company.features` (que vem do `business_type`) — comportamento já correto desde iter34/35.
- **Testes (iter37)**: 9/9 backend PASS — incluindo regressão completa de iter36 (rename de conexão + kanban_column_id set/clear).

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
- Modulo Orcamentos — Fase 3: ja recebido como entrega Fase 2 — restante: BackgroundTasks para gerar PDF assincrono em quotes muito grandes (atual: sincrono ~100-500ms suficiente)
- **REDEPLOY do microservico Node.js no Render** (urgente quando user quiser ativar envio de PDF via WhatsApp em producao) — adiciona endpoint `/send-media`
- Importacao Incinera (BLOCKED, aguardando CSV do usuario)
- Inserir cards de Planos/Preços na Landing Page com botão "Contratar"
- Refatoração do `Dashboard.js` (+5000 linhas → quebrar em Tabs/AgendaTab.js, ConfigTab.js, etc.) e do `quotes_routes.py` (~750 linhas → splitar em quotes_catalog/quotes_send_service)
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
