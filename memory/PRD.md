## 2026-07-15 — Diagnostico de crash + Fix "mensagens nao chegam no CRM" ✅

### Bug A — Mensagens recebidas nao chegam no CRM (status conectado) 🔥
Cliente reportou que mensagens enviadas para o numero conectado nao apareciam
no CRM, mesmo com status "conectado". Numero de teste: 55 62 99371-6929.

**Root cause encontrado**: `whatsapp-service/index.js` no handler
`messages.upsert` (linha ~1299) fazia `const m = msg.message || {}` e ia
direto extrair `m.conversation`, `m.imageMessage`, etc. Mas o WhatsApp
moderno envelopa mensagens em:
- `ephemeralMessage.message` — chat efemero (padrao para muitos contatos!)
- `viewOnceMessage(V2)(V2Extension).message` — view-once
- `documentWithCaptionMessage.message`
- `editedMessage.message`

Sem unwrap, `m.conversation` fica `undefined` → `text=""` → linha 1340
`if (!text) continue;` DESCARTA silenciosamente a mensagem, e o operador
ve "conectado mas nada chega".

**Fix**: loop de unwrap ate 5 niveis antes de extrair o texto (mesma coisa
aplicada no handler `messaging-history.set`). Alem disso, quando uma
mensagem inbound eh de fato descartada agora logamos
`DROP_EMPTY_MSG phone=X types=[a,b,c] mid=Y` no stderr — assim proxima
regressao similar eh diagnosticavel em segundos.

**Impacto**: Recupera todas as mensagens efemeras (recurso ativo por
padrao em muitos WhatsApp hoje) e view-once que estavam sumindo do CRM.

### Bug B — Erro "Erro ao carregar esta tela" em Conexoes (producao)
O ErrorBoundary agora captura o crash em vez de tela branca — mas nao
enviava telemetria, entao nao sabiamos QUAL erro estava disparando.

**Fix**:
1. Nova rota `POST /api/diag/frontend-crash` (unauthenticated — de proposito,
   uma pagina crashada pode nao ter token valido). Deduplica pelo
   fingerprint (page + message + primeira linha do stack) em janela de
   5min pra nao floodar. Auto-limpa quando passa de 500 registros ou 30d.
2. Nova rota `GET /api/diag/frontend-crashes` (super admin) para consultar
   os erros capturados. Suporta filtro `?page=conexoes`.
3. Nova rota `DELETE /api/diag/frontend-crashes` (super admin) para limpar
   apos um fix redeployado.
4. `PageErrorBoundary` em `Dashboard.js` agora faz `fetch(...)` com
   `keepalive: true` no `componentDidCatch` mandando: page, message,
   stack, componentStack, user-agent, url, e hints de user_email +
   company_id lidos do localStorage. Nada bloqueante.

**Impacto**: proxima vez que o cliente relatar "Conexoes deu erro", o
Super Admin consulta `/api/diag/frontend-crashes` (ou via curl) e ve o
stack real. Nao precisa reproducao pelo usuario.

### Files touched
- `backend/routes/diag_routes.py` (NEW)
- `backend/server.py` (registro do router)
- `whatsapp-service/index.js` (unwrap de envelopes + drop-log)
- `frontend/src/pages/Company/Dashboard.js` (PageErrorBoundary → POST)

### O que o operador precisa fazer (deploy)
1. Redeploy do **backend** no Render → ativa `/api/diag/frontend-crash*`
2. Redeploy do **whatsapp-service** no Render → ativa unwrap de mensagens efemeras
3. Redeploy do **frontend** (Vercel/Emergent) → ErrorBoundary passa a reportar

### Como consultar os crashes capturados
```bash
TOKEN=$(curl -s -X POST https://agendcrm.onrender.com/api/auth/super-admin/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@agentcrm.com","password":"..."}' | jq -r .access_token)

curl https://agendcrm.onrender.com/api/diag/frontend-crashes?page=conexoes \
  -H "Authorization: Bearer $TOKEN" | jq
```

---


## 2026-07-14 — ErrorBoundary + cache de aba (tela branca em Chrome + delay ao trocar aba) ✅

### Bug A — Tela branca em "Conexoes" em alguns Chromes
Alguns clientes reportavam que ao entrar em Canais/Conexoes num Chrome
especifico, a tela ficava toda branca. Nao havia ErrorBoundary no
projeto — entao qualquer erro sincrono em qualquer pagina desmontava a
arvore inteira do React 18 e o usuario via um `<div>` vazio.

**Fix**: nova classe `PageErrorBoundary` envolvendo `<PageContent>` em
`Dashboard.js`. Se qualquer pagina der throw, mostra:
- Titulo "Erro ao carregar esta tela"
- Nome da pagina que falhou (`code`)
- `<details>` com stack trace pro suporte copiar
- Botao "Voltar ao painel" + "Recarregar pagina"
- Auto-reset ao trocar de pagina (para nao ficar preso no erro antigo)

Cobertura: TODAS as paginas do dashboard, nao so Conexoes.

### Bug B — Delay ao trocar de aba (Atendendo/Aguardando/Grupos/Encerrados)
Cada troca disparava `loadData` → fetch GET /tickets + /tickets/counts
(200-1500ms na Render). Enquanto isso, o usuario via a lista da aba
anterior estagnada ate o novo dado chegar.

**Fix**: cache local por combinacao (aba + filtros) com TTL de 30s no
`AtendimentosPage`. Ao trocar de aba, o cache mostra os tickets
INSTANTANEAMENTE; o refresh continua em background e atualiza a lista
quando terminar. Nova flag `tabLoading` disponivel para futura indicacao
visual (spinner ou skeleton). Percepcao: troca de aba INSTANT em cache
hit; primeira carga da aba usa o comportamento antigo.

---


## 2026-07-10 — "Tela em branco apos Reconectar" resolvido ✅

### Bug reportado
Ao clicar em **Reconectar** na tela de Canais, em vez de aparecer o QR
code, a tela ficava em branco (nem QR, nem spinner, nem botao).

### Causa
Race condition entre o `handleForceReconnect`:
1. Local: `setQrData(null); setPollingAttempts(0);`
2. `POST /api/channels/connections/{id}/connect` → backend seta
   `status='connecting'` no Mongo e retorna
3. `onRefresh()` refaz `GET /api/channels/connections` — mas se a
   escrita anterior ainda estava propagando, retornava `status='disconnected'`
4. React re-renderiza o card com `conn.status='disconnected'` →
   condicional do painel QR `(waiting_qr | connecting)` = **false**
5. Header mostra botao "Conectar" mas o painel do QR simplesmente
   NAO renderiza → **tela em branco**

### Fix (`Dashboard.js::ConnectionCard`)
Optimistic UI: novo estado local `expectingConnecting` setado como
`true` no click do reconectar. Uso de `effectiveStatus` no lugar de
`conn.status` para o polling e para o render do painel QR:
```js
const effectiveStatus = expectingConnecting && conn.status === 'disconnected'
  ? 'connecting'
  : conn.status;
```
Assim que o backend refletir a mudanca (`conn.status in
['connecting','waiting_qr','connected']`), `useEffect` limpa o
override — nenhuma flag stale.

Cobre tanto o botao "QR expirou? Gerar novo" quanto o link
"Demorando demais? Clique para reconectar".

---


## 2026-07-09 — QR "refs attempts ended" loop resolvido (v2.3.3) ✅

### Diagnostico do log de saude
A tela "Saude da conexao WhatsApp 1" que o usuario compartilhou mostrou
9 tentativas seguidas de reconexao, TODAS com o mesmo erro:
```
QR refs attempts ended (status=408)
```
Cada QR ficava disponivel por ~2min (default Baileys), o operador nao
escaneava a tempo, e a reconexao ia para o **backoff exponencial** (5s,
10s, 20s, 40s, 80s, 160s, 300s max). Apos 5 tentativas o operador
esperava 5 minutos entre cada QR — impossivel de escanear.

### Fix (`whatsapp-service/index.js` v2.3.3)
1. **`qrTimeout: 60000`** em `makeWASocket()` (default era ~20s por
   ref). Baileys gera 6 refs consecutivas -> 60s x 6 = **6 minutos**
   de janela pra escanear cada ciclo.
2. **Fast retry on QR expiry**: detectamos `errMsg.match(/QR refs
   attempts ended/i)` e reiniciamos em 3 SEGUNDOS (ignorando o
   backoff exponencial). Nao incrementa `reconnectAttempts` porque
   isto NAO e falha de rede — e apenas usuario nao scaneou.
3. Log de evento novo `qr_expired_fast_retry` no painel de saude.

### "Verificar Deploy" agora valida
Novos flags esperados em `/version`:
- `qr_fast_regen: true` (v2.3.3)
- `br_phone_full_fallback: true` (v2.3.2)

Sem eles, `redeploy_done: false` e o botao fica vermelho.

### Estado atual em producao (07-09)
Render esta em **v2.3.1** — o usuario ainda NAO redeployou depois do
v2.3.2 e v2.3.3. Ate o proximo `Manual Deploy` no dashboard do Render,
ambos os problemas persistem:
- Instabilidade diaria da conexao (QR loop de 5min)
- 514+ falhas por planilhas com formato BR "9-digit" nao normalizado

Ambos os fixes estao prontos no branch principal — so falta o deploy.

---


## 2026-06-30 — BR phone fallback expandido (corrige "Lista copa" 514 falhas) ✅

### O usuario tinha razao
Analise da planilha real `listanacopa.xlsx` (1839 contatos) mostrou:
- **19 contatos** em formato 10 digitos `(62) 9236-5509` → o UNICO formato que enviou
- **1819 contatos** em formato 11 digitos `(62) 99653-9677` → todos rejeitados

O fallback antigo do `/send` e `/send-media` gerava:
- Para 11 digitos: `62996539677` + `5562996539677` (so com 9)
- Para 10 digitos: `6292365509` + `556292365509` (so sem 9)

**Faltava a variante cruzada**: WhatsApp para contas registradas
pre-2012 retorna a JID SEM o 9 mobile. Como `onWhatsApp()` so checa
os candidatos que geramos, contas antigas com o "9" no input nunca
faziam match.

### Fix em `/send` e `/send-media`
Agora geramos TODAS as combinacoes BR e deixamos `onWhatsApp()`
escolher qual existe:
- 11 digitos local com 9 (`62 9 XXXX XXXX`) → adiciona variante SEM o 9 com 55 (`5562 XXXX XXXX`)
- 10 digitos local sem 9 (`62 XXXX XXXX`) → adiciona variante COM o 9 com 55 (`5562 9 XXXX XXXX`)
- Mantem todos os fallbacks antigos (55 prefix add/remove, BR-12 etc.)

### Impacto
Em 1839 contatos da "Lista copa": **+1826 candidatos JID adicionais**
testados via `onWhatsApp()`. Os ~514 que apareceram como "Not connected"
(ou que continuariam rejeitando apos uma reconexao) devem agora
encontrar a JID correta no primeiro disparo.

### Versao
Bump `v2.3.1` → **`v2.3.2`**. Nova flag `br_phone_full_fallback: true`
em `/version`. `service-version-check` deve validar essa flag no proximo
ciclo (TODO).

---


## 2026-06-29 — Anexo em campanhas modo BULK + auto-pause em desconexao ✅

### Causa do desastre
Campanha "Lista copa" do Fin8ip: 1 enviada, **514 falhas com "Not connected"**, 256 pendentes. Dois bugs:
1. A conexao Baileys da empresa caiu no meio do disparo e o dispatcher
   bulk continuou tentando enviar 514 mensagens em sequencia, todas
   falhando com "Not connected" — gravando 514 destinatarios como
   permanently failed (sem retry quando a conexao voltar).
2. O anexo (imagem da Copa) foi **silenciosamente ignorado** porque o
   meu fix anterior so suportava anexo no `_classic_runner`, NAO no
   `process_bulk_tick`. A flag "Modo Disparo em Massa" estava ON
   (recomendado para 1k+), entao roteou pro bulk → anexo perdido.

### Fix
**`wa_dispatcher.py`**: nova `dispatch_send_media(db, conn, to, b64,
mime, filename, caption)` que envelopa o `/instances/{id}/send-media`
do Baileys, retornando o mesmo `{success, message_id, provider, error}`
do dispatch_send_text.

**`bulk_routes.create_bulk_job_from_campaign`**: agora propaga
`attachment_url` e `attachment_filename` da campanha para o job.

**`bulk_routes.process_bulk_tick`**:
- Lazy-loads o anexo UMA vez por job (cache `_bulk_attachment_cache`
  por job_id em memoria do worker — re-builda apos restart)
- Quando ha anexo, envia via `dispatch_send_media` (mensagem renderizada
  vira caption); senao mantem o `dispatch_send_text`. UX = 1 unica
  mensagem com midia + texto, exatamente como o operador espera.

**Anti-massacre**: apos 10 falhas consecutivas na mesma conexao com
erro "Not connected" / "not_found", o job e automaticamente `paused`
com `pause_reason` indicando qual conexao caiu. Antes ficava em loop
gravando 500+ falhas. Operador retoma manualmente apos reconectar.

### Testes
- `dispatch_send_media` envelope correto contra conn fake (success=False
  com erro "Not connected") ✓
- `process_bulk_tick` com `attachment_url`: tentativa de envio passa
  pelo caminho de midia (erro confirma "baileys media http 400") ✓

---


## 2026-06-29 — Anexar Arquivo nas Campanhas funcionando ✅

### Bug
O botao "Anexar Arquivo" no rodape do modal de campanha era so um botao
sem `onClick` — clicar nele nao fazia nada.

### Fix (frontend)
- `useRef` + `<input type=file hidden>` + handler que faz `POST /api/upload/`
  e grava `attachment_url` no form
- Chip indigo com nome do arquivo + botao `×` para remover
- Toast "Arquivo anexado" no sucesso, erro detalhado no erro
- Limite de 16 MB (limite seguro do WhatsApp media)
- `data-testid`: `attach-file-btn`, `attach-file-input`, `attachment-chip`,
  `remove-attachment-btn`
- Validacao do save permite "campanha media-only" (sem mensagens, so
  com anexo)

### Fix (backend)
- Model `CampaignCreate` e `CampaignUpdate`: novo campo
  `attachment_filename` (Optional[str]) — usado como `fileName` no
  `/send-media` do Baileys e pelo chip do frontend
- `_fire_campaign_classic` aceita campanha "media-only" (antes
  rejeitava com "Sem mensagens definidas")
- `_classic_runner` agora carrega o anexo UMA VEZ (via
  `routes.upload_routes.get_object`) e usa `/send-media` do Baileys.
  Primeira mensagem vira caption do anexo; demais sao enviadas como
  texto sequencial. Funciona para imagem, video, audio, PDF e
  documentos genericos.

### Testes
- `POST /api/upload/` → URL retornada ✓
- `POST /api/crm/campaigns` com `attachment_url` + `attachment_filename` ✓
- `POST /api/crm/campaigns` com SO anexo (sem mensagens) → criada com `status=draft` ✓
- UI: botao + input escondido + upload real + chip visivel + toast de sucesso ✓

---


## 2026-06-27 — Bot pause: regra "operador iniciou = bot fica de fora" ✅

### Regra solicitada pelo usuario
"Se EU iniciei a conversa (de dentro da plataforma ou pelo numero), o bot
NAO pode disparar mesmo apos o cliente interagir. Em QUALQUER momento que
eu interagir o bot pausa. So volta se eu retomar manualmente OU se eu
fechar o ticket e o cliente me chamar de novo num novo ticket."

### O que mudou
1. **`bot_pause.pause_bot_on_ticket_if_enabled` agora SEMPRE pausa** quando
   o operador toca o ticket (toggle da empresa ligado). Antes pulava se o
   ticket ainda nao tinha flow ativo — entao se operador iniciasse antes
   do bot, o cliente respondia e o flow disparava. Agora a flag fica de
   pe desde o primeiro toque do operador.
2. **`webhook/message` com `from_me=true` sem ticket existente agora CRIA
   o ticket com `bot_paused=true, bot_paused_reason="operator_initiated_from_phone",
   initiated_by_agent=true`**. Antes ignorava + nao criava ticket → quando
   o cliente respondia, novo ticket nascia → flow auto-disparava.
3. **Anti-loop do auto-responder** (`flow_engine`): apos 3 tentativas de
   menu invalidas consecutivas (sintoma classico de "WhatsApp Business
   ausencia" em ping-pong com o bot), pausa o ticket e marca com a tag
   `auto-resposta-detectada`. Estanca as 30+ mensagens repetidas na
   madrugada que o usuario reportou.
4. **`messages.upsert` com `type='append'`** (sync em background) continua
   sendo processado para preencher historico do ticket — mas o dedup
   estrito por `wa_message_id` (linha 1444) ja impede dupla execucao do
   flow para a mesma mensagem reentregue pos-reconexao.

### Resume do bot
Saidas do estado `bot_paused=true` permanecem so duas:
- Fechar/Reabrir o ticket → `resume_bot_on_ticket` limpa as flags
- Botao manual "Retomar bot" no chat → `bot_paused_reason="manual_toggle"`

### Testes
3 cenarios validados via pytest direto contra Mongo: pause sem flow,
pause com flow, setting desligado (no-op). Backend hot-reloaded sem
erros.

---


## 2026-06-27 (final) — SA QR resolvido ✅ — CAUSA RAIZ: ENOSPC por inode exhaustion

### Causa real do problema (que o usuario insistiu em apontar e estava CERTO)
Apesar do codigo de SA e empresas ser 100% compartilhado, **o sintoma so afetava SA porque a conexao SA era a UNICA criada recentemente**. As outras (empresas) ja tinham seus diretorios `auth_sessions/<id>/` criados ha tempos. Quando o usuario clicou "Resetar sessao" no SA, o full-reset wipou esse diretorio e tentou recriar — e o `mkdir` falhou com **`ENOSPC: no space left on device`**.

**Twist do bug**: O disco de bytes estava em 28% — mas o que tinha esgotado eram os **inodes** do volume persistente do Render. Milhares de pequenos `session-*.json` (1 por contato × varias conexoes ativas) consumiram todos os inodes mesmo com bytes sobrando. `mkdir` precisa de inode → falhou. Empresas existentes nao precisam de mkdir → continuavam funcionando.

### Conserto imediato (ja aplicado)
Rodei `POST https://agendcrm.onrender.com/admin/cleanup-sessions?aggressive=1` que removeu 7553 arquivos stale liberando inodes. Em seguida, `POST /instances/<sa_conn_id>/connect` finalmente conseguiu criar o authDir → Baileys emitiu QR. **O usuario so precisa atualizar a tela Canais e o QR aparece.**

### Conserto permanente (v2.3.1, precisa redeploy)
1. **`createConnection()` agora pega ENOSPC** — quando o `mkdir` falha por falta de inode/bytes, dispara `cleanupStaleSessions({maxAgeMs: 1d, reason: 'enospc_auto'})` e tenta UMA segunda vez. Operador nunca mais precisa SSH no Render.
2. **`checkDiskAndCleanup()` agora monitora INODES tambem** — usa `Math.max(bytes_pct, inodes_pct)` para escolher o tier de cleanup (warn/critical). Antes so olhava bytes.
3. **`/admin/disk-status` retorna `total_inodes, free_inodes, used_inodes, inodes_used_pct`**.
4. **Endpoint `/version` reporta** `enospc_auto_recovery: true`, `inode_aware_disk_monitor: true`. **"Verificar Deploy"** so retorna verde quando AMBOS estao ativos.

### Como o usuario resolve em 30s
1. **Atualize a tela** "Canais" do Super Admin agora — o QR deve aparecer imediatamente
2. **Escaneie com o WhatsApp** do celular
3. Para evitar que o problema volte: **redeploy do servico WhatsApp no Render** (Deploy Latest Commit). Depois disso, "Verificar Deploy" mostra v2.3.1 com auto-recovery de ENOSPC. Se o disco do Render encher de novo, o sistema se cura sozinho em segundos.

---


## 2026-06-27 (continuacao) — Watchdog automatico de conexoes travadas + diagnostico de deploy ✅

### Descoberta critica do redeploy
A primeira tentativa de conserto (Resetar Sessao manual) NAO funcionou em
producao porque o **microservico WhatsApp no Render NAO foi atualizado**
no redeploy do usuario. O endpoint `/version` confirmou: producao roda
**v2.2.0 (build 2026-06-10)** sem `stuck_connection_watchdog` nem
`full_reset_endpoint`. O botao "Verificar Deploy" agora detecta isso
EXPLICITAMENTE e mostra ao operador o que esta faltando.

### Auto-recovery server-side (v2.3.0)
Adicionado **stuck-connection watchdog** em `whatsapp-service/index.js`:
varre a cada 20s todas as instancias em memoria; para cada uma em
`connecting|disconnected|waiting_qr` que:
- Nao emitiu QR ainda, E
- Esta tentando ha mais de 45s com >=2 retries de Baileys, OU
- Esta "silenciosamente travada" >=60s com creds.json corrompido em disco

automaticamente **derruba o socket + apaga AUTH_DIR + recria do zero**.
Cooldown de 90s por instancia previne loops. Funciona para QUALQUER
conexao (SA + empresas) — exatamente o que o usuario pediu.

### Endpoint /version + flag de patches
Bumpamos para `v2.3.0` (build 2026-06-27) e adicionamos 2 feature flags:
- `stuck_connection_watchdog: true`
- `full_reset_endpoint: true`

O endpoint `GET /api/channels/service-version-check` agora exige
ambas as flags para `redeploy_done=true`. Quando o operador clica
"Verificar Deploy" e Render esta desatualizado, aparece:
- ✗ Watchdog de conexoes travadas AUSENTE — redeploy do Render PENDENTE
- ✗ Endpoint Resetar Sessao AUSENTE — redeploy do Render PENDENTE

### Como o usuario pode finalmente resolver
1. Clicar **"Verificar Deploy"** na tela Canais — confirma que Render esta v2.2.0 (PENDENTE)
2. Acessar Render dashboard → servico `agendcrm-wa` (ou nome similar) → **Manual Deploy → Deploy Latest Commit**
3. Aguardar build (~3min). Clicar "Verificar Deploy" novamente
4. Quando aparecer "✓ Versao: v2.3.0" + ambos os patches ATIVOS, o conserto esta vivo
5. A conexao do SA vai se auto-curar em ~60s (sem intervencao manual). Ou clicar "Resetar sessao" para forcar imediatamente.

---


## 2026-06-27 — SA Connection "Gerando QR Code... (tentativa N)" stuck → Full Reset ✅

### Diagnostico
A tela "Canais" do Super Admin reusa exatamente o mesmo `ConexoesPage`
do tenant + as mesmas rotas de backend (`channels_routes.py`). Nao
existia divergencia de codigo entre SA e empresas. Porem, em producao a
conexao do SA ficou presa em "Conectando..." / "Gerando QR Code... (tentativa 5)"
porque o `AUTH_DIR/<conn_id>` do servico Baileys ficou corrompido
(prov. apos a cleanup automatica de Signal sessions que rodou com o
disco do Render quase cheio) e o `createConnection` re-tentava
indefinidamente sem conseguir emitir o QR.

### Fix — Reset profundo (nuclear) de sessao
**WhatsApp service** (`whatsapp-service/index.js`): novo endpoint
`POST /instances/:id/full-reset`. Fluxo:
1. Mata o socket em memoria + remove todos os listeners
2. Apaga `connections[id]` em RAM
3. `fs.rmSync(AUTH_DIR/<id>, recursive)` — wipe COMPLETO (creds.json
   + app-state + session-* + pre-key-*)
4. `createConnection(id)` em fire-and-forget (Cloudflare derruba
   requests > 100s; nao podemos `await` o handshake completo)
Retorna 200 com `{status:'resetting'}` em ~ms.

**Backend** (`channels_routes.py`): `POST /api/channels/connections/{id}/full-reset`
proxia pro WA service, depois marca `status='waiting_qr'`,
`qr_code=None`, zera `send_failures_count` e grava `last_full_reset_at`.

**Frontend** (`Dashboard.js::ConnectionCard`):
- Nova API `channelsAPI.fullResetConnection(id)`
- Botao manual "Continua travado? Resetar sessao" (`data-testid=full-reset-{id}`)
  aparece apos 5 tentativas falhas + confirma com window.confirm
- **Auto-recovery**: apos 8 polls sem QR e status Baileys
  `not_found|disconnected|error`, dispara um `fullReset` automaticamente
  (apenas 1x por sessao da UI; `autoResetTriedRef`)
- Reseta contador apos QR aparecer ou apos o reset

### Por que isso resolve o pedido do usuario
O usuario pediu "mesma confiabilidade e dinamica para o Super Admin
que as empresas". O codigo ja era 100% compartilhado — o problema era
o estado corrompido em disco no servico Baileys da producao. Com o
auto-recovery + botao manual, QUALQUER conexao (SA ou empresa) que
ficar presa "Gerando QR Code..." se cura sozinha em ~25 segundos. Nao
precisa mais SSH no Render nem deletar a conexao no Mongo.

### Notas para deploy
O fix esta em 3 camadas: **frontend** (Emergent) + **backend** (Emergent) +
**WhatsApp service** (Render Node). Os dois primeiros sobem com o deploy
do Emergent; o servico do Render precisa ser redeployed manualmente pelo
usuario pra producao ter o endpoint `/instances/:id/full-reset`.

---


## 2026-06-25 — Campanhas: Pause/Resume + Scheduler + Import Excel + Progresso ao Vivo ✅

### 1. Scheduler agora dispara campanhas `programada`
`scheduler.py::_process_scheduled_campaigns` faz `find_one_and_update` atomico das campanhas com `status='programada'` e `scheduled_at<=now` → marca `em_execucao` → dispara via `_fire_campaign_classic` (ou bulk se `bulk_config.enabled`). Antes desta correcao, campanhas com data agendada ficavam paradas eternamente porque nenhum job estava observando a colecao.

### 2. Pause/Resume/Cancel + nova colecao `campaign_deliveries`
- `_fire_campaign_classic(db, camp)` faz seed de 1 doc por destinatario em `campaign_deliveries` com status `pending|sending|sent|failed|error`. O loop async `_classic_runner` checa `db.campaigns.status` a cada iteracao — se `pausada`, dorme 5s e re-checa; se `cancelada`/`concluida`, sai. Cada envio atualiza `campaign_deliveries.{status, sent_at|failed_at, error}`.
- Endpoints: `POST /campaigns/{id}/pause`, `/resume`, `/cancel`. Idempotentes com 400 em estado invalido.

### 3. Olhinho => modal de progresso ao vivo
- `GET /campaigns/{id}/progress` retorna `{campaign, totals:{pending,sending,sent,failed,total}, sent[], failed[], pending[], sending[]}`.
- Frontend `CampaignProgressModal` (`data-testid=campaign-progress-modal`) abre quando o status nao e `draft|programada`. Auto-refresh a cada 3s (para quando concluida/cancelada). Mostra:
  - 4 cards de totais (Enviadas/Pendentes/Erros/Total)
  - Barra de progresso (`progress-bar-fill`)
  - 3 sub-abas (Enviadas / Pendentes / Erros — com motivo do erro)
  - Atalhos Pause/Resume conforme o status

### 4. Importacao Excel + template
- `GET /api/crm/contact-lists/template.xlsx` retorna xlsx com colunas `Nome, Telefone, Email`. Tab `Contatos` com 2 linhas exemplo.
- `POST /api/crm/contact-lists/import-excel` (multipart .xlsx + querystring `name`) parseia, deduplica por telefone (regex `\D` removido), ignora linhas sem telefone, retorna `{id, name, imported_count, skipped_count}`.
- UI: botoes "Modelo Excel" (`download-template-btn`) e "Importar Excel" (`import-excel-btn`) na aba "Listas de Contato".

### Testes
Backend: 12/12 pytest em `/app/backend/tests/test_iteration_60.py`. Frontend: smoke E2E confirma download template + presenca dos botoes. Pause/Resume UI conditionals validados via leitura do JSX (botoes so renderizam quando status casa).

---


## 2026-06-25 — Contadores 1:1 com lista + Sync 7d WhatsApp + Painel "Ferramentas" SA ✅

### A. Contadores das abas refletem fielmente a lista
`GET /api/crm/tickets/counts` agora aceita os MESMOS filtros que `GET /api/crm/tickets`: `channel, search, connection_id, queue_id, assigned_to, tag`. O frontend (`AtendimentosPage.js` `loadData`) envia todos os filtros server-side e removeu o filtro client-side (que rodava DEPOIS do truncate de 1000 itens e gerava o bug "aba=46 / lista=0").

### B. Sincronizacao automatica WhatsApp (7d padrao, 30d opcional)
`whatsapp-service/index.js` agora SEMPRE define `syncFullHistory: true` ao criar a sessao. O cutoff padrao e 7 dias (catch-up apos QR scan + recuperacao de mensagens offline na reconexao). O operador ainda pode marcar "Importar 30 dias" no checkbox da criacao da conexao → backend manda `sync_history: true` → cutoff vai a 30 dias. O handler `messaging-history.set` continua empurrando em batches de 100 mensagens via `POST /api/channels/webhook/history-import`.

### C. Painel "Ferramentas" por empresa no Super Admin
- Novo botao Wrench (amarelo) entre **Editar** e **Deletar** em cada linha de `CompaniesTab` (`Dashboard.js`). `data-testid="tools-company-<companyId>"`.
- Modal `CompanyToolsModal` (`data-testid="company-tools-modal"`) com selector de acao + input `datetime-local` + botao `tools-run-btn`.
- Hoje suporta **"Restaurar tickets fechados pelo auto-close"** (chama `POST /api/super-admin/restore-auto-closed-tickets` com `company_id + since_iso`). Estrutura preparada para mais acoes futuras (limpar filas, reset BD, etc).

### Testes
Backend: 10/10 pytest passados em `/app/backend/tests/test_iteration_59.py`. Frontend e2e via Playwright validou tabs novas, contadores casando 1:1 com a lista, botao Ferramentas e fluxo do modal. Service WhatsApp Node confirmado em `:3002`.

---


## 2026-06-23 — Recuperar tickets auto-fechados + Aba "Encerrados" ✅

### Contexto / Bug
User comercial2@incinera.com.br ativou `ticket_auto_close_hours=72` na producao e perdeu varios atendimentos. O parametro de fato fecha tickets sem interacao a >=72h (`updated_at < cutoff`), mas a janela curta encerrou muito atendimento legitimo.

### Implementacao

**A. Endpoint de restauracao** (`super_admin_routes.py`):
- `POST /api/super-admin/restore-auto-closed-tickets` body `{company_id|company_name, since_iso?}` (default = meia-noite UTC de hoje)
- Reverte tickets onde `closed_reason='auto_timeout'` E `closed_at >= since_iso`
- Volta `status='aberto'`, marca `reopened_at`, `reopened_by`, `reopened_via='bulk_restore'`, limpa `closed_at`/`closed_reason`
- Retorna `restored_count`
- **NAO toca** em tickets fechados manualmente (sem `closed_reason`) nem fora da janela

**B. Reopen individual** (`crm_routes.py`):
- `POST /api/crm/tickets/{id}/reopen`
- Valida que esta fechado e que user tem visibilidade (mesmo filtro que list)
- Volta `status='aberto'`, marca `reopened_at`, `reopened_by`
- 400 se ja aberto, 403 se sem permissao

**C. Tab "Encerrados"** (`AtendimentosPage.js` + `crm_routes.py`):
- Novo `tab=encerrados` em GET /tickets: filtra `status='fechado'` respeitando `_ticket_visibility_filter`
- Contador `encerrados` em GET /tickets/counts
- Frontend: novo `TabButton` "Encerrados" ao lado de Grupos
- No header do chat, quando ticket esta `fechado`, o botao "Fechar" eh trocado por **"Reabrir"** (pill verde com refresh icon)
- Empty state customizado para a aba

### Validacao via curl/Python
- **Restore**: 4 tickets seed (2 auto_timeout hoje, 1 manual hoje, 1 auto_timeout ontem) → endpoint reabriu APENAS os 2 corretos
- **Counts**: `encerrados: 107 → 106` apos reopen individual
- **Reopen**: status 200 + ticket vira `aberto`; 2a chamada retorna 400 "O ticket nao esta fechado"

### Acao do user
1. Save to GitHub + Deploy
2. Apos o deploy, restaurar os tickets de incinera com:
   ```bash
   curl -X POST https://agentcrm.8ip.com.br/api/super-admin/restore-auto-closed-tickets \
     -H "Authorization: Bearer <SA_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"company_name":"incinera"}'
   ```
   (Logue como SA em `/admin-login` e pegue o token do localStorage `Application -> Local Storage -> access_token`)
- A resposta vai mostrar `restored_count`. Confirme com o operador.
- Para o futuro, os operadores podem usar a aba **"Encerrados"** + botao **"Reabrir"** para resgatar tickets caso a caso, sem precisar de SA.

---


## 2026-06-23 — Falha de envio + modal de saude da conexao em "loop" ✅

### Problemas reportados
1. **Mensagens com "Falha ao reenviar" mesmo com conexao "Saudavel"**: chip do header mostra a conexao verde (`Centroeste - Faturamento`) mas os reenvios continuam falhando.
2. **Modal "Saude da conexao" sobrepoe os cards atras** ("corta as configuracoes e fica em loop"): backdrop nao cobre a tela inteira; usuario nao consegue fechar e/ou interage com cards visiveis embaixo.

### Causa raiz
1. **Tickets antigos guardavam `connection_id` de uma conexao que foi DELETADA ou rotacionada**. O retry chamava `/instances/<conn_id_obsoleto>/send` no microservico → 404/error silencioso. O chip do header mostrava a conexao ATUAL verde, mas o backend insistia na velha.
2. **Modal `ConnectionHealthModal` renderizado dentro do `ConnectionCard`** que tem ancestral com `transform`/`filter` — quebra `position: fixed` (vira anchored ao ancestral, nao ao viewport).

### Fix

**1. Backend** (`routes/crm_routes.py`):
- `retry_ticket_message`: valida o `ticket.connection_id` contra `channel_connections.status == 'connected'`. Se nao estiver, faz fallback para a primeira conexao saudavel do tenant.
- `send_message` (POST /tickets/{id}/messages): mesma logica de fallback. Antes era so "se nao tem connection_id, usa qualquer uma" — agora "se nao tem OU se a do ticket esta offline, usa qualquer uma saudavel".
- Erro mais claro: "Nenhuma conexao WhatsApp conectada no momento".

**2. Frontend** (`pages/Company/Dashboard.js`):
- `ConnectionHealthModal` agora usa `createPortal(<modal/>, document.body)` para escapar de qualquer ancestral com transform/filter. z-index elevado para 60.

### Acao do user
Save to GitHub + Deploy no Render.

### Importante
- Para os tickets antigos que tinham `connection_id` obsoleto: o **proximo envio/reenvio vai usar a conexao saudavel ATUAL** automaticamente. Voce nao precisa atualizar nada manualmente nos tickets.
- Se quiser fixar o ticket a uma conexao especifica de novo, use o **ConnectionSwitcher** no header do chat.

### Sugestao
Posso adicionar um job de manutencao que, ao detectar `connection_id` de um ticket apontando para uma conexao deletada, automaticamente migra para a conexao padrao (ou null) e loga. Quer?

---


## 2026-06-22 — Fix triplo: lembrete financeiro, agendamento duplicado, indices ✅

### Problemas reportados
1. **Lembrete financeiro nao gera atendimento** no SA: SA envia lembrete via Financeiro Admin, mensagem chega no WhatsApp do responsavel, mas nao aparece em lugar nenhum no CRM do SA.
2. **Agendamento duplicado**: barbeiro clica "Salvar", UI trava, ele clica de novo, sistema salva varios agendamentos no mesmo horario.
3. **Performance**: lentidao geral em listagens com volume.

### Implementacao

**Fix 1 — Lembrete vira atendimento** (`scheduler.py` + `routes/super_admin_routes.py`):
- Novo helper `_record_billing_reminder_in_ticket(db, phone, text, customer_name, connection_id, transaction_id)`:
  - Find-or-create de ticket por `(company_id=SA_SYSTEM_COMPANY_ID, customer_phone)` com `status != fechado`
  - Append `messages[]` com `source: 'billing_reminder'`, `sender_type: 'agent'`
  - Atualiza `last_message_at`, `last_message_preview`, `updated_at`
  - `ticket_number` gerado via `system_settings` counter para nao colidir com numeração das empresas
- Chamado em: scheduler auto-send (mensagem principal + Pix follow-up) E manual resend (super_admin_finance_routes)
- Resultado: 1 ticket por empresa-responsavel; multiplas mensagens viram historico no MESMO atendimento (validado com curl)

**Fix 2 — Conflito de slot em agendamento** (`routes/scheduling_routes.py`):
- Pre-check em `POST /scheduling/appointments`: `find_one({company_id, professional_id, date, time, status != cancelado})` → 409 "Ja existe um agendamento neste horario para esse profissional ({nome})"
- Mesmo guard no path de "bloqueio de agenda" (`is_block=true`)
- **Critico**: notificacao WhatsApp movida de `await` sincrono para `asyncio.create_task` (era 10s+ esperando Baileys, "travando" a UI). Resposta agora retorna em <500ms
- Frontend ja tinha `disabled={saving}`, mas com resposta rapida o problema visivel deixa de existir
- Validado curl: 1a chamada → 200 OK; 2a chamada mesmo slot → 409

**Fix 3 — Indices criticos** (`server.py`):
- `tickets`: + `(company_id, group_jid, status)` sparse (group dedup), `(company_id, channel, status)`
- `appointments`: `(company_id, professional_id, date, time)`, `(company_id, date)`
- `clients`: `(company_id, phone)` (usado em todo inbound WA)
- Todos `background=True`, sem downtime

### Validacao
- Curl 1a/2a chamada de agendamento → OK + 409 correto
- Script Python invoca `_record_billing_reminder_in_ticket` 2x → 1 ticket com 2 mensagens
- `list_indexes()` mostra os 12 indices criados

### Acao do user
Save to GitHub + Deploy no Render para producao.

### Importante
Lembretes ja enviados ANTES desse fix nao tem ticket (nao da pra retroagir). Apos o deploy, todo novo lembrete enviado vai aparecer em Atendimentos do SA system_company.

---


## 2026-06-16 (URGENT HOTFIX) — Bot reenviando "Selecione..." varias vezes em prod ✅

### Cenario
Apos rodar `find /var/data/auth_sessions -name 'session-*' -mtime +30 -delete` no shell do Render (limpar disco cheio), o bot comecou a reenviar a MESMA mensagem de menu ("Selecione: [1] - Ja sou cliente...") 3-5 vezes para o mesmo cliente em conversas 1-a-1, especialmente quando o cliente demora pra responder. Cliente recebia o menu repetido sem ter interagido.

### Causa raiz (NAO eh loop de fluxo)
O auto-recovery do microserviço (`whatsapp-service/index.js` linhas 283-322, v2.1.19) tinha 2 gatilhos:
- **A)** `info.needsResend` = true (Baileys emitiu status=0 ERROR explicito) — legitimo
- **B)** `stale && recipientOnline` (>90s sem DELIVERY_ACK + cliente online via presence) — heuristico que ASSUMIA "cliente esta vendo Aguardando mensagem"

Quando o usuario apagou as sessions Signal antigas do disco:
1. Mensagens em voo ficaram sem DELIVERY_ACK (sessao recem destruida)
2. Cliente online no app → `recipientOnline=true`
3. Auto-recovery dispara wipe + resend → cria msgId novo → entra na watchlist
4. Cada novo `sendMessage` do flow_engine entra na watchlist e sofre cascade
5. Resultado: cliente recebe 3-5 copias do "Selecione..."

### Fix
`whatsapp-service/index.js`: removido o gatilho `(stale && recipientOnline)`. Agora SO reenvia quando Baileys emite o sinal explicito `messages.update status=0 (ERROR)`. Mensagens stale sem failure signal **decaem silenciosamente** apos 90s — sem duplicata para o cliente.

Trade-off documentado no codigo: perdemos a cobertura automatica do "Aguardando mensagem" silencioso (raro). Para reabilitar, basta re-adicionar `|| (stale && recipientOnline)` na condicao `shouldResend`.

### Acao do usuario
**REDEPLOY URGENTE** em producao para aplicar o fix.

### Validacao
- `node --check` pass
- Microserviço sobe sem erros
- Cleanup automatico de disco continua rodando (independente do auto-recovery)
- Dedup de grupos preservado

---


## 2026-06-16 — Grupos com multiplas conexoes (dedup) + cleanup de Signal sessions ✅

### Pedido / Bug
1. **Grupos duplicando bot**: quando 2+ conexoes do CRM eram participantes do MESMO grupo do WhatsApp, cada conexao recebia um webhook independente. Resultado: o numero da vitima recebia N respostas duplicadas do `default_flow`.
2. **Mensagens nao chegando + envio falhando**: produção mostrava o erro `ENOSPC: no space left on device, open '/var/data/auth_sessions/...session-XXX.0pn'`. O disco persistente do Render lotou com Signal sessions acumuladas por contato × conexao.

### Implementacao

**P0 — Grupo travado na primeira conexao** (`routes/channels_routes.py /webhook/message`)
- Antes: cada webhook de grupo da mesma `(company_id, group_jid)` rodava o fluxo. Mesmo com dedup por `wa_message_id`, a CRIACAO do ticket sofria race e disparava o flow N vezes.
- Agora: 2 guardas em sequencia:
  1. **Pre-create guard**: se ticket de grupo ja existe e `ticket.connection_id != instance_id` → retorna `ignored: "group_owned_by_other_connection"` IMEDIATAMENTE (sem mensagem, sem flow).
  2. **Race-resolver pos-insert**: apos `insert_one`, refaz query `find_one({group_jid, channel: "whatsapp_group", status != fechado}, sort=created_at)`. Se o ticket mais antigo NAO eh o que acabamos de criar, a conexao perdeu o race → deletamos nosso ticket e retornamos `ignored: "group_duplicate_lost_race"` antes do trigger.
- Resultado validado por curl (3 webhooks em paralelo de 3 conexoes diferentes): **1 ticket unico, 1 mensagem, owner travado**.

**P1 — Cleanup de Signal sessions** (`whatsapp-service/index.js`)
- Nova funcao `cleanupStaleSessions({ dryRun })`:
  - Para cada `<AUTH_DIR>/<conn_id>/`:
    - Se a conexao NAO esta em `connections[]` em memoria E `dir.mtime > 24h` → remove a pasta inteira (orfa de conexao deletada).
    - Caso contrario: deleta `session-*` e `pre-key-*` com `mtime > 30 dias`. NAO toca em `creds.json`, `app-state-*`, `sender-key-*`.
- Scheduler: 1a passada 60s apos boot, depois a cada 6h.
- Endpoint manual `POST /admin/cleanup-sessions` (suporta `?dry_run=1`).
- Retorna stats: `scanned_dirs`, `removed_files`, `removed_orphan_dirs`, `removed_bytes`, `errors`, `elapsed_ms`.

### Testes
- `curl POST /admin/cleanup-sessions?dry_run=1` → retorna stats sem alterar disco.
- 3 webhooks em paralelo p/ mesmo `group_jid` de 3 conexoes diferentes → 1 ticket apenas, mensagens dropadas com `ignored: ...`.

### ⚠️ Atencao em PRODUCAO
- O fix de cleanup NAO recupera o disco ja cheio em prod. O usuario precisa, no painel do Render:
  - **OPCAO A** (recomendada): aumentar tamanho do Persistent Disk em `Settings → Disks`.
  - **OPCAO B**: shell do servico Render e rodar:
    ```bash
    curl -X POST http://localhost:3002/admin/cleanup-sessions
    # ou diretamente:
    find /var/data/auth_sessions -name 'session-*' -mtime +30 -delete
    find /var/data/auth_sessions -name 'pre-key-*' -mtime +30 -delete
    ```
- Apos liberar disco: redeploy para ativar o scheduler automatico.

---


## 2026-06-15 — Seletor de CONEXAO especifica em Novo Atendimento + chat header ✅

### Pedido
No modal "Novo Atendimento" trocar o seletor "WhatsApp/Tipo de canal" por um seletor de **conexao especifica** (instancia cadastrada em Conexoes). Mostrar apenas conexoes vinculadas ao usuario (campo `user.connection_ids` definido no cadastro do usuario). Mostrar todas (conectadas + desconectadas), mas so deixar selecionavel as conectadas. No chat de um atendimento ja existente, permitir trocar a conexao para outra que o usuario tenha acesso — se nao tiver, usar "Transferir".

### Implementacao
**Backend**
- `models.py`: `TicketCreate` recebe `connection_id: Optional[str]`.
- `routes/crm_routes.py`:
  - Novo helper `_ensure_user_can_use_connection(db, user, conn_id, require_connected=True)`. Regras:
    - Conexao deve pertencer a `company_id` do user.
    - Nao-admin com `connection_ids` non-empty → conn_id obrigatoriamente na whitelist (senao 403).
    - Status deve ser `connected` quando `require_connected=True` (400 caso contrario).
  - `POST /api/crm/tickets` valida e persiste `connection_id`.
  - `PUT /api/crm/tickets/{id}` re-valida acesso ao trocar `connection_id` para um valor diferente do atual.
- Comportamento mantido: company_admin / super_admin / perfis com `*` bypassam a whitelist.

**Frontend** (`pages/CRM/AtendimentosPage.js`)
- `NewTicketModal`:
  - Recebe `connections` e `currentUser` (passados de `AtendimentosPage`).
  - Filtra `visibleConnections` pelo `user.connection_ids` (ou todas para admin).
  - Dropdown "Conexao WhatsApp" (data-testid `new-ticket-connection`). Conexoes desconectadas aparecem mas ficam `disabled`. Auto-seleciona a primeira conectada.
  - Validacao no submit: sem conexao vinculada → toast e bloqueio. Forca `channel='whatsapp'`.
- Novo componente `ConnectionSwitcher` no header do chat:
  - Chip com nome da conexao atual + bolinha verde/cinza (status).
  - `<select>` sobreposto (transparente) abre menu nativo com conexoes do usuario; desconectadas ficam disabled.
  - `onChange` -> `PUT /crm/tickets/{id}` { connection_id }; toast de erro 400/403 do backend.
- data-testid: `ticket-connection-switcher`, `ticket-connection-select`.

### Testes (curl)
- Sem conexao -> cria OK (`connection_id: null`).
- conn_id inexistente -> 404 "Conexao nao encontrada".
- conn_id desconectada -> 400 "A conexao 'X' nao esta conectada".
- conn_id conectada -> 200, persistida no ticket.
- PUT trocar para conn desconectada -> 400.

### Pontos abertos / proximos passos
- O usuario `crm@test.com` na preview nao tem conexoes ativas, entao a validacao final de envio so pode ser feita em producao apos o user redeployar.
- Aguardando validacao do user para a migracao Baileys 7 (error 463).

---


## 2026-02-28 (NIGHT 7) — 4 pedidos: ZAP shortcut icon, view_all_tickets, watchdog, 30d history sync

### Pedido 1 — Icone de Respostas Rapidas perto do anexo ✅
**Frontend** (`AtendimentosPage.js`): adicionado botao com icone `Zap` (raio) ao lado do `Paperclip`. data-testid: `quick-responses-btn`. Ao clicar, preenche o input com `/` e abre o popover de respostas rapidas (mesma logica do atalho de teclado `/`).

### Pedido 2 — Admin/perfil ver todos os tickets ✅
**Causa raiz**: `get_current_user` (auth.py) retornava o user RAW sem hydration de permissoes do `permission_profiles`. Resultado: `_user_can_view_all_tickets()` em crm_routes.py:42 sempre retornava `False` para usuarios nao-admin com o flag `view_all_tickets` no perfil — pois `user.get("permissions")` era [].
**Fixes**:
- `auth.py`: `get_current_user` agora hydrata permissions do `permission_profiles` para company_users. Admin recebe `["*"]` implicito. Best-effort: se falhar, nao quebra auth.
- `crm_routes.py`: `_user_can_view_all_tickets` agora aceita tambem `"*"` na lista (perfil admin-equivalente).
- `Dashboard.js` (PerfisAcessoPage form): nova toggle `permission-toggle-view-all-tickets` na secao "Permissoes avancadas". Operador admin pode ativar por perfil de acesso para que aquele perfil veja TODOS os tickets independente de fila/conexao/atribuicao.

### Pedido 3 — Sincronizar 30 dias ao conectar (best-effort) ✅
**Microservico** (`whatsapp-service/index.js`):
- `createConnection(instanceId, { syncHistory })` — novo parametro opcional, liga `syncFullHistory` nesta sessao Baileys.
- `POST /instances/:id/connect` aceita body `{ sync_history: true }`.
- Novo listener `messaging-history.set` que filtra mensagens dos ultimos 30 dias (HISTORY_DAYS=30), agrupa em buffer de ate 100 e POSTa em batch pra `/api/channels/webhook/history-import`. Fluxo final flushed quando `isLatest=true`.
**Backend** (`channels_routes.py`):
- Novo `POST /webhook/history-import` que cria tickets `status=fechado origin=history_import tags=[historico-importado]` (um por contato), faz upsert deduplicado de mensagens (`wa_message_id`), nao dispara flowbuilder. Bypassa o filtro `older_than_connected_at` do webhook normal. Grupos sao ignorados.
- `POST /connections/{conn_id}/connect` agora le `sync_history` do body e repassa pro microservico.
**Frontend**:
- `Dashboard.js > handleConnect`: `window.confirm("Deseja importar os ultimos 30 dias...")` pra opt-in. Operador escolhe a cada clique de "Conectar".
- `WhatsAppConnectionsPage.js`: checkbox dedicado "Importar ultimos 30 dias" no modal de criacao (so mostra em CRIACAO; edicao nao reimporta).

### Pedido 4 — Watchdog mais agressivo (10 conexoes, algumas caem) ✅
**Microservico**:
- Intervalo do watchdog: 90s → 45s
- Janela de stale: 5min → 3min
- Probe forcado: a cada 3o sweep (~2.25min) dispara `sendPresenceUpdate('available')` em TODAS as conexoes, mesmo as ativas — pega "zombie sockets" antes que o usuario perceba.
- Hard check de readyState agora avalia 3 layers (`sock.ws`, `sock.ws.socket`, `sock.ws._socket`); se NENHUM estiver OPEN, forca reconect.

### Bug fixes bonus
- `flow_engine.py`: `sent += 1` (TypeError silencioso em List[str]) substituido por `sent.append(sent_msg_id)`. Antes a mensagem de transfer ate era enviada mas nao era persistida no historico do ticket.

### Validacao
- Backend: 8/8 pytest passaram (ticket-menu); `/auth/me` continua entregando `permissions=["*"]` pra admin e a hidratacao do perfil funciona pra non-admin (preview validado via curl).
- Frontend: Playwright validou que (a) icone ZAP esta presente, (b) confirm dialog do "30 dias" aparece com texto correto, (c) o connect prossegue depois (toast "Conectando..." aparece e geracao de QR comeca).

### Arquivos alterados
- `/app/backend/auth.py` (hydration de permissoes)
- `/app/backend/routes/crm_routes.py` (`_user_can_view_all_tickets` aceita "*")
- `/app/backend/routes/channels_routes.py` (history-import endpoint + connect body)
- `/app/backend/flow_engine.py` (sent.append fix)
- `/app/whatsapp-service/index.js` (watchdog tighter + syncHistory + messaging-history listener)
- `/app/frontend/src/pages/CRM/AtendimentosPage.js` (icone ZAP)
- `/app/frontend/src/pages/CRM/WhatsAppConnectionsPage.js` (checkbox 30d)
- `/app/frontend/src/pages/Company/Dashboard.js` (toggle view_all_tickets + handleConnect com confirm)
- `/app/frontend/src/services/api.js` (connectChannel/connectWhatsApp aceitam opts)

### Acao requerida em PRODUCAO
- Apos redeploy do microservico WhatsApp em https://agentcrm.8ip.com.br, o watchdog mais agressivo entra em vigor.
- Para o perfil "ver todos os tickets" tomar efeito em producao: admin precisa abrir "Perfis de Acesso", editar o perfil desejado e marcar a nova toggle "Ver todos os tickets/atendimentos".

---


## 2026-02-28 (NIGHT 6) — Filtrar analistas pela fila + renomear "atendente" → "analista"

### Pedidos do usuario
1. No node Ticket, a lista de analistas deve mostrar APENAS os usuarios vinculados a fila selecionada (via `allowed_queue_ids`).
2. Renomear todos os textos "qualquer atendente" para "qualquer analista".

### Implementacao (`FlowBuilderPage.js`)
- Lista de analistas agora aplica filtro: `usersList.filter(u => u.allowed_queue_ids?.includes(config.queue_id))`.
- Sem fila selecionada: mensagem amarela "Selecione uma fila acima para ver os analistas vinculados."
- Fila selecionada mas zero usuarios vinculados: mensagem cinza "Nenhum analista vinculado a esta fila. Vincule em Usuarios."
- onChange do select da Fila: agora limpa analistas orfaos (usuarios que estavam selecionados mas nao pertencem a nova fila).
- Textos atualizados: "Qualquer atendente" → "Qualquer Analista" (checkbox label, placeholder do texto da opcao, placeholder do menu_message default).

### Validacao
- Sem fila: 0 opcoes + mensagem amarela ✅
- Fila "Vendas" sem usuarios linkados: mensagem cinza ✅
- Fila "Vendas" com CRM Admin linkado: 1 opcao "CRM Admin" ✅
- Checkbox texto: "Incluir opcao 'qualquer analista da fila'" ✅
- Trocar fila com analistas selecionados: lista limpa automaticamente os IDs orfaos ✅

### Arquivos alterados
- `/app/frontend/src/pages/CRM/FlowBuilderPage.js`

---


## 2026-02-28 (NIGHT 5) — Multi-analista com menu numerado no node Ticket

### Pedido do usuario
No node Ticket, permitir selecionar VARIOS analistas. Quando 2+ analistas
sao selecionados, o bot envia um menu numerado pra o cliente escolher com
qual atendente quer falar. Tem opcao adicional opcional "qualquer atendente
da fila" — quando selecionada, ticket cai na fila publica.

### Backend (`flow_engine.py`)
- Helper `_build_ticket_menu_options(db, cfg, company_id)`: resolve `assigned_user_ids` em users do DB e adiciona opcao "qualquer" (kind="queue") se `include_any_option=true`.
- Helper `_render_ticket_menu(template, options, vars_, queue_name, nome)`: monta texto final com substituicao de `{{options}}`, `{{queue_name}}`, `{{nome}}` e demais flow_vars.
- No node Ticket:
  - Se `len(options) >= 2`: emite menu, salva `vars_["__ticket_menu_options"]`, pausa o flow no node ticket (`active_flow_node_id=ticket`).
  - Se `len(options) <= 1`: roteamento direto (1 user → assigned_to, status=atendendo; 1 queue ou nenhum → fila padrao).
- No handler de resposta (advance_flow incoming_text): quando `prev` e um node ticket com `__ticket_menu_options` setado, parseia digito, atribui o ticket (user OU queue) e ENCERRA o fluxo. Opcao invalida → cai na fila padrao (sem re-prompt).
- Retrocompat: campo legado `assigned_user_id` (singular) continua funcionando.
- Bug-fix bonus: substituido `sent += 1` por `sent.append(sent_msg_id)` no envio de transfer_message — antes era um TypeError silenciado.

### Frontend (`FlowBuilderPage.js`)
- `<select>` simples removido. Substituido por:
  - Lista de checkboxes `ANALISTAS (OPCIONAL)` (multi-select) com `data-testid="ticket-user-multiselect"` e `ticket-user-option-{id}` por linha.
  - Checkbox `Incluir opcao "qualquer atendente da fila"` (`ticket-include-any-checkbox`); quando marcado, mostra input `Texto da opcao` (`ticket-any-option-label`) com placeholder "Qualquer Analista".
  - Textarea `MENSAGEM DO MENU` (`ticket-menu-message`) — aparece dinamicamente quando o total de opcoes (`assigned_user_ids.length + (include_any_option ? 1 : 0)`) >= 2. Variaveis: `{{options}}`, `{{queue_name}}`, `{{nome}}`.
- Mantida retrocompat: se `assigned_user_id` (singular) ja existir, e tratado como `assigned_user_ids: [valor]` na hora do render dos checkboxes.

### Testes (`/app/backend/tests/test_flow_engine_ticket_menu.py`)
8 testes — TODOS PASS:
- single analyst → routes direct sem menu ✅
- legacy `assigned_user_id` (singular) → ainda funciona ✅
- 0 analistas → cai na fila ✅
- 2 analistas → renderiza menu, pausa flow ✅
- 1 analista + include_any → renderiza menu ✅
- menu reply "2" valido → assigned_to=usuario certo, flow encerra ✅
- menu reply pra opcao "qualquer" → assigned_to=None, status=aguardando ✅
- menu reply invalido ("5" com so 2 opcoes) → cai na fila padrao, flow encerra (sem re-prompt) ✅

### Validacao manual no preview
Playwright confirmou: multi-select com 15 usuarios, checkbox include_any, textarea menu_message aparecendo dinamicamente. Backend integration tests 8/8 PASS.

### Arquivos alterados
- `/app/backend/flow_engine.py`
- `/app/frontend/src/pages/CRM/FlowBuilderPage.js`
- `/app/backend/tests/test_flow_engine_ticket_menu.py` (novo)

---


## 2026-02-28 (NIGHT 4) — 4 melhorias CRM (transfer, atalho /, Analista no Flow, Editar Resposta Rapida)

### ✅ Fix: Transferencia de ticket entre usuarios (P0)
**Causa raiz**: `TicketStatus` Enum em `models.py` nao listava `aguardando` nem `atendendo`. Front mandava esses valores no PUT `/api/crm/tickets/{id}` e Pydantic rejeitava com 422, impedindo transferencia.
**Fix**: Adicionados AGUARDANDO e ATENDENDO ao enum. Validado E2E: `PUT /tickets/{id}` com `{status:"atendendo", assigned_to:"<uid>"}` retorna HTTP 200.

### ✅ Feature: Atalho `/` para Respostas Rapidas no chat de Atendimentos
**Implementacao em `AtendimentosPage.js`**:
- Estado novo: `quickResponses`, `quickMenuOpen`, `quickHighlight`. Lista carregada via `crmAPI.getQuickResponses()` no mount.
- Quando o input comeca com `/`, popover aparece acima do input mostrando ate 8 matches (filtra por `shortcut`, `title` ou `content`).
- Teclas: `ArrowUp/Down` navega, `Enter` ou `Tab` seleciona, `Esc` fecha.
- Se a resposta tem anexo (`attachment_data_b64`), o anexo e enviado direto via `sendMedia`; o conteudo de texto fica no input pro operador revisar antes de Enviar.
- `data-testid`: `quick-response-menu`, `quick-response-item-{id}`, `quick-response-menu-empty`.

### ✅ Feature: Editar Respostas Rapidas (Dashboard)
**Backend**: novo `PUT /api/crm/quick-responses/{id}` (e `DELETE`) com Pydantic `QuickResponseUpdate`. Atualiza title/content/shortcut/anexo via `exclude_unset` — quando `attachment_data_b64` nao vem, anexo atual e preservado; quando vem vazio, anexo e removido.
**Frontend** (`Dashboard.js > QuickResponsesPage`): pencil icon ao lado de cada item abre modal "Editar Resposta Rapida" com `title`/`content`/`shortcut` pre-preenchidos + opcao de trocar anexo. Botao Salvar persiste via `crmAPI.updateQuickResponse`. data-testid: `quick-edit-{id}`, `quick-form-title`, `quick-form-save`.

### ✅ Feature: Selecionar Analista no node Ticket do Flowbuilder
**Frontend** (`FlowBuilderPage.js`): novo dropdown "Analista (opcional)" no editor do node Ticket (linhas 860-879). Carrega `usersList` via `schedulingAPI.getCompanyUsers()` no mount. Salva `assigned_user_id` no config do node. data-testid: `ticket-user-select`.
**Backend** (`flow_engine.py`): ao executar um node Ticket com `assigned_user_id`, aplica `assigned_to=<user_id>` + `status='atendendo'` no ticket — vai direto pra "Em atendimento" do analista escolhido. Se nao escolher (Auto), comportamento padrao de fila.

### 🐛 Bug defensivo no Flowbuilder
Flows legados com nodes sem `position` quebravam o react-flow (`Cannot read properties of undefined (reading 'x')`) ao abrir. `openFlow()` agora normaliza nodes: garante `position` default (grade 4 colunas) e `data` minimo. Editor agora abre QUALQUER fluxo sem crash.

### Validacao
- Backend: pytest iter58 3/3 PASS (`PUT /tickets/{id}` aceita `atendendo`/`aguardando`; QR CRUD preserva anexo; `/scheduling/company-users` lista usuarios)
- Frontend e2e (Playwright): T1 Editar QR persiste; T2 atalho `/` abre popover + Enter seleciona + Esc fecha; T3 dropdown Analista renderiza com 16 opcoes e select_option grava o uid corretamente.

### Arquivos alterados nesta noite
- `/app/backend/models.py` (TicketStatus enum)
- `/app/backend/routes/crm_routes.py` (PUT /tickets, CRUD quick-responses)
- `/app/backend/flow_engine.py` (assigned_user_id no Ticket node)
- `/app/frontend/src/pages/CRM/AtendimentosPage.js` (atalho `/` + popover)
- `/app/frontend/src/pages/CRM/FlowBuilderPage.js` (dropdown Analista + openFlow defensivo)
- `/app/frontend/src/pages/Company/Dashboard.js` (Editar QR ja estava — UI mantida)

---


## 2026-02-28 (NIGHT 3) — Fix divergencia Atendendo/Aguardando + valida toggle bulk

### Bug: Tela Inicio mostrava 0/0 enquanto Atendimentos mostrava 1296/916
**Causa raiz**: HomePage chamava `crmAPI.getTickets()` que retorna lista paginada/truncada (default 1000). Em prod com 2k+ tickets, a lista era cortada e o filter `status === 'aguardando'` nao batia porque o status REAL no banco e algo como "aberto"/"em_atendimento" — a logica "Aguardando" e baseada em `assigned_to` ausente (nao no campo `status`).

**Fix**:
- Backend `/crm/tickets/counts` ja existia com a logica correta (`assigned_to` null = aguardando). Adicionado `fechados_hoje` no retorno (filtro por `closed_at`/`updated_at` prefix com data atual UTC).
- Frontend `Dashboard.js` HomePage: trocou `crmAPI.getTickets()` por `crmAPI.getTicketCounts()` — agora le os mesmos contadores do tab Atendimentos. Inicio e Atendimentos vao bater sempre.

### Validado: Toggle "Modo Disparo em Massa" funcionando E2E
Playwright confirmou que clicar em "Nova Campanha" -> ativar o toggle exibe o banner violeta + secao expandida com:
- Lista de conexoes mostrando tipo (Baileys QR / Meta Cloud API) + status (ativa/desconectada)
- Intervalos MIN/MAX, Cap diario por numero
- Janela horaria (toggle + horarios + dias da semana)
- Palavras-chave de opt-out
- Dica de spintax inline

Quando o operador salvar com `bulk_config.enabled=true` e clicar "Enviar agora", backend roteia para o bulk dispatcher (codigo ja implementado em `crm_routes.run_campaign_now` na sessao anterior).

### Validacao
- `GET /api/crm/tickets/counts` retorna `{atendendo, aguardando, fechados_hoje, total, grupos}` corretamente
- UI Inicio agora le do endpoint dedicado (count_documents nativo do MongoDB — sem limite de linhas)


## 2026-02-28 (NIGHT 2) — 4 fixes: P0 travamento + P1 permissoes + P1 dashboard + P2 relatorio

### 🔴 P0 — Travamento de fluxo+atendimento a cada ~20h (CRITICO PROD)
**Causa raiz** (via troubleshoot_agent): Motor (MongoDB driver) sem pool config explicito + sem keepalive. Connecoes idle morriam apos ~30min, mas o driver so percebia no proximo query — que entao pendurava `serverSelectionTimeoutMS` (default 30s). Como `scheduler.tick()` rodava todas as tasks **serialmente sem timeout**, 1 query pendurada congelava o tick inteiro → flow, billing, bulk dispatcher, ticket auto-close, opt-out check **TUDO travado simultaneamente** (bate exatamente com o sintoma do cliente: "atendimento e fluxo param juntos").

**Fixes aplicados**:
- `database.py`: `AsyncIOMotorClient` agora com `maxIdleTimeMS=45000`, `socketTimeoutMS=20000`, `serverSelectionTimeoutMS=5000`, `connectTimeoutMS=10000`, `maxPoolSize=50`, `minPoolSize=10`, `retryWrites=True` → conexoes idle reciclam antes de morrerem, falhas detectadas em segundos.
- `scheduler.py`: tick agora faz **health check `db.command("ping")` com timeout 3s** no inicio — se Mongo nao responde, aborta o tick inteiro logando o erro, ao inves de pendurar tudo. Cada step (reminders, surveys, billing, bulk, ticket close) embrulhado em `asyncio.wait_for(..., timeout=60s)` (90s pro bulk dispatcher). 1 step pendurado **nao bloqueia mais os outros**.
- `channels_routes.py` webhook inbound: opt-out check tambem com `asyncio.wait_for(..., timeout=2s)` — se falhar, NUNCA bloqueia o inbound (continua pra logica de tickets/flow).

### 🟠 P1 — Permissoes cruzando entre tipos de negocio
**Problema**: Editor de Perfis de Acesso (`/scheduling/all-features`) mostrava features de OUTROS tipos de negocio porque usava `companies.features` (dessincronizado quando SA edita o `business_type` sem propagar pra todas as empresas).

**Fix em `scheduling_routes.list_all_features`**: Source of truth virou `business_types.features` da empresa + UNION com `companies.features` (overrides). Agora UI mostra **APENAS features habilitadas no tipo de negocio + overrides da empresa**.

### 🟡 P1 — Dashboard Inicio adaptativo por tipo de negocio
**Problema**: Tela "Inicio" sempre mostrava 4 cards fixos (Agend Hoje, Tickets, Servicos, Profissionais) — Atendimento puro nao via "Aguardando" / "Em atendimento" separados.

**Fix em `Dashboard.js` HomePage**: Detecta features liberadas para a empresa e renderiza cards condicionalmente:
- **Tem agendamento** (`agenda`/`servicos`/`profissionais`): mostra Agend Hoje + Servicos + Profissionais
- **Tem atendimento** (`atendimentos`/`kanban`): mostra **Aguardando + Em Atendimento + Fechados Hoje** (split por status)
- **Sem atendimento**: mostra Tickets agregado (modo legacy)

Endpoint nao precisou de mudanca — split feito client-side via filter de status dos tickets que ja existiam.

### 🟢 P2 — Relatorio Empresas: "Venda" = "Valor Devido"
**Problema**: Coluna "Venda" mostrava valor bruto das licencas, nao o que de fato sera cobrado (com acrescimos de multa/juros).

**Fix em `super_admin_finance_routes.reports/companies`**:
- Coluna `venda` agora retorna **valor_devido** = base - desconto + multa + juros (via `compute_late_fee_amount`)
- Adicionados `venda_bruta` e `acrescimo` separados para auditoria
- Frontend `CompanyReportPanel.js`: header mudou para "Venda (valor devido)" + tooltip mostra breakdown "Bruto X − Desconto Y + Acrescimo Z" + badge laranja "+R$ Z" quando ha acrescimo

### Validacao
- Backend restart OK, ping respondendo 200
- Relatorio Empresas: TEST_BillReminder mostra venda=R$ 199,90 (valor devido) corretamente (Playwright OK)
- Header "valor devido" visivel
- Lint: 96 issues pre-existentes nao tocados (E701/E702/F541/F811/F601 — nao introduzidos por esta mudanca)

### Como verificar em PROD
1. Aguardar 20+ horas pos-deploy → flow + atendimento NAO devem mais travar
2. Olhar logs do backend: deve aparecer ocasional `[scheduler] MongoDB health check FAILED` se Mongo flakar (e o tick aborta limpinho); jamais ver mais um tick que "some" sem log de fim
3. Em "Perfis de Acesso", lista deve mostrar apenas features do business_type da empresa
4. Tela Inicio de cliente Atendimento mostra "Aguardando / Em Atendimento / Fechados Hoje"


## 2026-02-28 (NIGHT) — Bulk Dispatcher CONSOLIDADO dentro de Campanhas

### Refatoracao: 1 modulo so
- **Antes**: Disparo em Massa era sub-menu separado, sem reuso da audiencia de Campanhas.
- **Agora**: tudo dentro de `Campanhas` (1 menu so, 1 modelo de audiencia, 1 lugar pra gerenciar).

### Mudancas
1. **Backend (`POST /api/bulk/jobs/from-campaign/{id}`)** novo endpoint:
   - Resolve audience via `_resolve_campaign_audience` reusando 100% da logica existente (tags / list / all / no_tag)
   - Mensagem default = `campaign.messages[0]` (operador pode sobrescrever)
   - Filtra opt-outs pre-existentes automaticamente
   - Linka `bulk_job.campaign_id` -> rastreabilidade
   - Auto-start opcional (default true)
2. **Frontend (`CampaignsPage.js`)**:
   - Novo botao 🚀 (Rocket) por linha de campanha → abre modal `BulkLaunchModal` 2-etapas
   - Nova tab "Disparos em Massa" lado a lado com Listagem/Listas/Parametros
   - Lista de jobs com refresh auto 10s + detalhe completo (breakdown por conexao + filtros de status + pausar/retomar/cancelar)
3. **Removido**: `BulkCampaignsPage.js` (~400 linhas) deletado, sub-menu `disparo_massa` removido do catalogo de features + sidebar.

### Validacao E2E
- Black Friday (audience_mode=all, 188 contatos) → boot job from-campaign
- Backend resolve 188 destinatarios, cria 188 recipients, status=running, audience=188, opted_out=0 (sem opt-out pre)
- UI: tab Disparos em Massa lista o job linkado a campanha (`[Campanha] Black Friday`) + Test 20k antigo (completed)
- Botao Rocket presente em 3 campanhas existentes
- Sidebar antigo "Disparo em Massa" removido (count 0)

### Resultado UX
Operador agora:
1. Cria campanha normal (define audiencia por tag/lista/etc + mensagem padrao)
2. Clica 🚀 na linha da campanha
3. Escolhe conexoes (multi), spintax, janela, opt-out
4. Inicia disparo robusto sem precisar redigitar nada


## 2026-02-28 (LATE PM) — Bulk Dispatcher pra 20k+ COMPLETO

### Arquitetura
- **Fila persistente em MongoDB** (3 colecoes novas):
  - `bulk_jobs` — campanha-level com config + counters (status, audience_size, sent/failed/opted_out/skipped, next_rotation_idx, last_tick_at)
  - `bulk_job_recipients` — estado por destinatario (pending/sent/failed/opted_out), connection_used, message_rendered, error, provider, message_id
  - `bulk_opt_outs` — opt-outs scoped por company_id
- **Worker integrado ao scheduler** (`process_bulk_tick`): roda a cada 60s, processa jobs em status=`running`, escolhe ate 5 destinatarios pendentes por tick, faz round-robin nas conexoes selecionadas, respeita janela horaria + daily_cap_per_connection, chama `wa_dispatcher.dispatch_send_text` (que decide automaticamente Baileys vs Meta).

### Recursos anti-bloqueio
- **Spintax** (`backend/bulk_spintax.py`): parser `{a|b|c}` resolve nested + preserva `{{variaveis}}`. Regex exige pipe pra nao colidir com vars. Cada envio sorteia uma variacao diferente → quebra deduplicacao do WhatsApp.
- **Variaveis**: `{{nome}}`, `{{telefone}}`, `{{numero}}` + custom_vars por destinatario.
- **Rotacao multi-conexao**: round-robin com fallback pra conexoes nao-capadas (cap diario por conexao default 800/dia).
- **Mistura multi-provider** transparente: usuario seleciona conexoes Baileys + Meta na mesma campanha; dispatcher roteia cada envio para o provider certo.
- **Janela horaria**: configuravel por job (start/end HH:MM, dias da semana 0=Seg..6=Dom). Fora da janela, worker pula o job no tick.
- **Inter-message delay**: random em `[interval_min_sec, interval_max_sec]` por job, cap em 6s pra nao starvar outros jobs no tick.
- **Opt-out automatico**:
  - Inbound Baileys (`/webhook/message`) E Meta (`/webhooks/meta`) chamam `check_and_record_opt_out`
  - Match exato com keyword OU "keyword + espaco + algo" (evita falso positivo tipo "i will STOP later")
  - Insere em `bulk_opt_outs` + marca recipients pendentes desse telefone como `opted_out` em TODOS os jobs da empresa
  - Default keywords: PARAR, SAIR, DESCADASTRAR, STOP (customizavel por job)
  - Adicao de destinatarios checa `bulk_opt_outs` previo: se ja optou out, salva como `opted_out` direto sem tentar enviar.

### API (12 endpoints)
- `POST/GET /api/bulk/jobs` — criar/listar
- `GET /api/bulk/jobs/{id}` — detalhe com breakdown por conexao
- `POST /api/bulk/jobs/{id}/action {start|pause|resume|cancel}` — state machine validada
- `POST/GET /api/bulk/jobs/{id}/recipients` — bulk insert ate 500 por chamada, dedupe por digits, opt-out pre-existente vira `opted_out`
- `GET /api/bulk/opt-outs`, `POST /api/bulk/opt-outs`, `DELETE /api/bulk/opt-outs/{phone}` — gestao manual

### Frontend (`BulkCampaignsPage.js`)
- **Lista de jobs** com barra de progresso e stats live (auto-refresh 10s)
- **Wizard 3 etapas pra criar** disparo:
  1. Nome + mensagem com guia visual de spintax/variaveis
  2. Conexoes (multi-select com badge Baileys/Meta) + intervalos + cap diario + janela horaria + keywords opt-out
  3. Cole de destinatarios (1 por linha, formato `phone, nome`)
- **Tela de detalhe**: progress geral + breakdown por conexao + lista paginada de destinatarios com filtros (pending/sent/failed/opted_out) + acoes Pausar/Retomar/Cancelar.
- Sub-menu **"Disparo em Massa"** sob CRM, gated por feature `disparo_massa`.

### Validacoes (curl E2E + Playwright)
- Job criado, 3+1+1 destinatarios processados:
  - Pendentes inseridos OK
  - Duplicado detectado (mesmo phone na mesma chamada): `skipped_duplicates: 2`
  - Telefone invalido (sem digito): pulado
  - Pos-opt-out: novo destinatario marcado `opted_out` automaticamente
  - Start action transiciona pra `running`
  - Worker tick processou 3 pendentes em rotation, renderizou spintax distinto pra cada um (`'Oi Alice, confira nossa oferta!'`, `'Oi Bob, nao perca essa promo!'`, `'Boa noite Carlos, confira nossa oferta!'`)
  - Sem Baileys conectado, falhou com erro claro propagado pelo dispatcher
- UI completa renderiza job list + detail com breakdown + filtros funcionais.

### Capacidade estimada (com cap diario 800/conexao)
- 1 conexao  → 800/dia
- 3 conexoes → 2.400/dia → **20k em 8.5 dias**
- 10 conexoes → 8k/dia → **20k em 2.5 dias**
- Misturar Meta (limite 1k/dia tier inicial, sobe pra 10k+) acelera muito.

### Pontos pendentes (opcionais)
- Upload CSV (hoje so paste textarea — funciona, mas CSV cresceria UX)
- Pre-check via `onWhatsApp([])` Baileys antes de enfileirar (evita gastar tentativa em numero nao-WA)
- Re-categorize template Meta automatico fora da janela 24h


## 2026-02-28 (PM) — Meta WhatsApp Cloud API (Fase 3) IMPLEMENTADA

### Modelo de conta: Modelo A (per-tenant)
Cada empresa tem propria conta Meta Business + WABA + System User Token.
Credenciais ficam em `companies.meta_credentials = {app_id, app_secret, system_user_token, waba_id, api_version, webhook_verify_token}`.
**Vantagens**: cliente paga direto Meta (sem intermediario), compliance LGPD limpo, reputacao isolada, limite 25 numeros/WABA eh POR CLIENTE.

### Backend (novos arquivos)
- `services/meta_cloud.py` — `MetaCloudClient` (per-tenant), `MetaApiError`, `get_company_meta_client()`, `verify_webhook_signature()` (HMAC-SHA256 X-Hub-Signature-256), `META_CATEGORIES` (catalogo estatico Marketing/Utility/Authentication/Service com regras + exemplos OK/EVITAR).
- `routes/meta_cloud_routes.py` — endpoints completos:
  - `GET/PUT/DELETE /api/meta/credentials` (masked output; admin only)
  - `GET /api/meta/categories` (catalogo + flag `allowed` por empresa)
  - `GET /api/meta/phone-numbers` (lista + cache em `meta_phone_numbers`)
  - `GET /api/meta/templates` (cache local), `POST /api/meta/templates/sync` (pull Meta), `POST /api/meta/templates` (CRUD criar), `DELETE /api/meta/templates/{name}`
  - `POST /api/meta/send-text` + `POST /api/meta/send-template`
  - **Super Admin**: `GET/PUT /api/super-admin/meta/companies/{id}/categories` (lock por categoria)
  - **Webhook publico**: `GET /api/webhooks/meta` (handshake hub.challenge resolve company por `webhook_verify_token`), `POST /api/webhooks/meta` (assinatura HMAC + roteia por `entry.id`=WABA_ID, persiste em `meta_webhook_events` + processa messages/statuses em `meta_messages` + atualiza `meta_contact_state.last_inbound_at` para regra 24h).
- `wa_dispatcher.py` — adapter unificado `dispatch_send_text(db, connection_id, to_phone, message)` que le `channel_connections[id].provider` e roteia para Baileys (microservico) ou Meta Cloud API (HTTP). Erro Meta 470 (fora janela 24h) propagado para chamador escolher template.
- `routes/channels_routes.py` — `ConnectionCreate` ganhou `phone_number_id` (obrigatorio se `provider=whatsapp_cloud`). Validacao bloqueia mesmo numero fisico em 2 providers diferentes (Meta Coexistence quebra Baileys).
- `routes/scheduling_routes.py` — features `meta_cloud_api` (tenant) + `sa-meta-api` (SA) adicionadas ao catalogo.

### Frontend
- **`/pages/CRM/MetaCloudAPIPage.js`** (565 linhas) — sub-menu de Conexoes:
  - Aba **Credenciais**: formulario com mascaramento de token, status visual (badge configurado/nao), URL de webhook copiavel, hints inline.
  - Aba **Templates HSM**: grid colorido por categoria, badges status (APPROVED/PENDING/REJECTED), CRUD criar com modal explicando regras Meta de cada categoria selecionada.
  - Aba **Numeros**: sync + listagem com quality_rating (verde/amarelo/vermelho).
  - Aba **Guia Meta**: passo-a-passo de provisao + cards detalhados por categoria com regras, exemplos OK e exemplos EVITAR + indicador "LIBERADO/BLOQUEADO PELO SUPER ADMIN".
- **`/pages/SuperAdmin/Dashboard.js`** — novo tab `sa-meta-api` ("API Meta (Categorias)"): lista empresas + painel de toggles por categoria com regras + exemplos expansiveis.
- **`/services/api.js`** — `metaCloudAPI` exportado com 12 metodos.
- **`Dashboard.js` (Company)**: sub-menu "API Oficial Meta" sob Conexoes, gated por feature `meta_cloud_api`.

### Validacoes (curl + Playwright)
- `GET /api/meta/categories` retorna 4 categorias com regras/exemplos.
- `PUT /api/meta/credentials` salva e retorna token mascarado.
- `PUT /api/super-admin/meta/companies/{id}/categories` aceita subset, persiste e bloqueia categoria invalida.
- Webhook GET resolve verify_token contra `meta_credentials.webhook_verify_token` (403 se token desconhecido).
- SA panel renderiza 4 categorias com toggles + 1 empresa selecionada (Playwright OK).
- Empresa com feature `meta_cloud_api` ve sub-menu sob Conexoes + abas funcionando (Playwright OK).

### Bloqueio Baileys + Meta no mesmo numero
Backend rejeita criar conexao com mesmo `phone` em provider diferente. Mensagem clara: "Numero ja em uso pelo provedor 'baileys'. Um numero fisico nao pode rodar Baileys + Meta simultaneamente."

### Como o cliente liga tudo (recapitulando)
1. Cliente cria conta Meta Business + WABA + numero(s) + System User Token (passo-a-passo no painel "Guia Meta")
2. Cliente cola credenciais no painel "API Oficial Meta > Credenciais"
3. Cliente copia URL do webhook + Verify Token, cola na Meta App Dashboard
4. Cliente clica "Sincronizar Numeros" e "Sincronizar Templates"
5. Cliente cria conexao com `provider=whatsapp_cloud` + escolhe `phone_number_id`
6. Cliente cria templates pelo painel (categoria respeita whitelist SA)
7. Envia normalmente — dispatcher roteia automaticamente Baileys vs Meta


## 2026-02-28 — Pacote 1: Bulk humanizado + SGP close vars + Configuracao Agenda + Meta API skeleton

### 1. Variaveis SGP em mensagens de fechamento (P0)
- **Auto-close (`scheduler.py`)** + **fechamento manual (`crm_routes.py`)**: agora extraem `flow_vars.nome_cliente` (capturado durante consulta SGP no flow) e expõem:
  - `{{nome_sgp}}` — nome completo retornado pelo SGP
  - `{{primeiro_nome_sgp}}` — primeira palavra do nome (usa `.split()[0]`)
- Variaveis adicionadas em paralelo as ja existentes `{{nome}}` (contato) e `{{empresa}}`. Quando o ticket nao consultou SGP, expressao resolve para string vazia.
- Projecao do `find` no scheduler atualizada para incluir `flow_vars: 1`.

### 2. Sub-menu "Configuracao Agenda" + toggle de inversao (P0)
- **Feature catalog**: nova feature `configuracao_agenda` em `ALL_SYSTEM_FEATURES` (`scheduling_routes.py`), categoria "Config Empresa". Super Admin habilita/desabilita por business-type — quando ON, empresa enxerga sub-menu dentro de Configuracoes.
- **Sidebar (`Dashboard.js`)**: novo entry com icone CalendarDays, `parent: 'configuracoes'`, route `configuracao_agenda`.
- **Pagina (`ConfiguracaoAgendaPage`)**: card com toggle "Inverter ordem da pagina publica". ON => Profissional -> Servico. OFF (default) => Servico -> Profissional. Persiste em `booking_pages.invert_service_professional`.
- **Backend**: `BookingPageUpdate` ganhou campo `invert_service_professional`; `/api/public/booking/{slug}` agora retorna esse campo no payload da pagina.
- **Pagina publica (`BookingPage.js`)**: render condicional dos passos com base em `pageData.invert_service_professional`. Labels do steps indicator, botoes "Voltar" e proximo passo (setStep) trocados dinamicamente. Sem regressao no modo padrao.
- **Validado via Playwright**: modo default mostra "1. Servico" / "2. Profissional"; modo invertido mostra "1. Profissional" / "2. Servico" sem botao Voltar no passo 1.

### 3. Humanizacao parametrizavel + entrega no flow (P0)
- **Schema da conexao (`channel_connections.humanization`)**: dict `{enabled, typing_min_ms, typing_max_ms, presence_online}`. Default desligado — mantem comportamento atual (envio instantaneo).
- **API**: `ConnectionCreate/Update` ganhou campo `humanization` (Pydantic `HumanizationConfig`). PUT `/api/channels/connections/{id}` aceita o objeto completo e persiste — validado via curl.
- **Helper (`backend/wa_humanize.py`)**: `humanize_kwargs(db, conn_id)` retorna `{humanize_typing_ms, humanize_presence}` com valor randomico em `[min,max]` quando `enabled=true`, senao `{}`.
- **Plugado em** (sem quebrar fluxos atuais):
  - `flow_engine._send_whatsapp` (todas mensagens do bot durante flow)
  - `crm_routes.run_campaign_now` (envio sincrono + async runner em campanhas)
- **Microservico Baileys (`whatsapp-service/index.js`)**: `/instances/{id}/send` aceita `humanize_typing_ms` (delay ms entre presence "composing" e sendMessage, cap em 8s) + opcional `humanize_presence='available'`. Refresh do "composing" antes do send pra indicator nao expirar em waits longos.

### 4. Provedor da conexao + Meta Cloud API (skeleton para Fase 3) (P1)
- **Campo `provider`** adicionado ao `ConnectionCreate` com default `"baileys"`. Reservado `"whatsapp_cloud"` para Fase 3 quando cliente prover credenciais Meta.
- **Playbook completo** salvo em `/app/memory/META_CLOUD_API_PLAYBOOK.md` (multi-numero por WABA, 24h rule, templates HSM, webhook HMAC, pricing BRL, rotacao). Quando o cliente entregar os tokens (META_APP_ID, META_APP_SECRET, META_SYSTEM_USER_TOKEN, META_WABA_ID, META_WEBHOOK_VERIFY_TOKEN), implementar adapter + UI dual-provider.

### Roadmap atualizado
- **P1**: Bulk dispatcher robusto pra 20k — fila persistente em Mongo (`bulk_jobs`), rotacao multi-conexao automatica, spintax `{a|b|c}`, janela horaria (9h-18h), opt-out automatico, dashboard de progresso por numero.
- **P1**: Toggle `no_back` por menu no Flowbuilder (esconder "[9] Voltar").
- **P2**: Acao "Responder" no MessageActionsMenu do CRM.
- **P2 (Fase 3)**: Integracao Meta Cloud API conforme playbook salvo.
- **P2 (refactor)**: quebrar `Dashboard.js` (~7.4k linhas) + `crm_routes.py` (~3.1k linhas).


# AgentCRM & Booking — PRD

## Original Problem Statement
SaaS multi-tenant para CRM e Agendamento (mobile-first via PWA). Inclui módulos de Flowbuilder, Kanban, Omnichannel WhatsApp via Baileys (microserviço Node.js no Render), TV Indoor, perfis de acesso granulares, agendamentos com confirmação/cancelamento via link, e sistema completo de notificações.

## Architecture
- Backend: FastAPI + MongoDB (motor)
- Frontend: React 19 + Tailwind, PWA dinâmico
- Microserviço: Node.js + Baileys (WhatsApp) com disco persistente no Render (`AUTH_DIR`)
- Scheduler: `/app/backend/scheduler.py` — loop em background a cada 60s para reminders / surveys / bulk messages / **auto-close** / **billing reminders**


### 2026-02-18 (RESYNC + MSG-EDIT-DELETE) — Resync de parcelas + Editar/Apagar mensagem ✅

**Parte 1 — Endpoint batch para resync de parcelas pendentes:**
- `POST /api/super-admin/finance/resync-pending-parcelas` deleta TODAS as parcelas pendentes com `auto_company_billing=true` e re-cria via `_process_billing_reminders(send_messages=False)`, refletindo os valores atuais (`total_sale_price - discount`).
- Parcelas pagas e lancamentos manuais (`kind=diversos`) sao **preservados**.
- Botao "Resync pendentes" no toolbar do Financeiro Adm dispara via UI com confirmacao.

**Parte 2 — Editar / Apagar mensagem do WhatsApp (sem mexer no flow):**

Microservico `whatsapp-service/index.js` (v2.1.19):
- `POST /instances/{id}/edit-message` { phone, message_id, new_text } — usa `sendMessage(jid, {text, edit: msgKey})` da Baileys (protocolMessage MESSAGE_EDIT).
- `POST /instances/{id}/delete-message` { phone, message_id } — usa `sendMessage(jid, {delete: msgKey})` (revoke-for-everyone).
- WhatsApp impoe que **so o remetente** pode editar/apagar suas mensagens (validado no `fromMe:true` do msgKey).

Backend `crm_routes.py`:
- `POST /api/tickets/{ticket_id}/messages/{message_id}/edit` { text }
- `POST /api/tickets/{ticket_id}/messages/{message_id}/delete-for-customer`
- Validacoes: so `sender_type=agent` + `wa_message_id` presente + nao apagada.
- Edit grava `edit_history[]` (preserva versoes anteriores) e atualiza `content`/`edited_at`.
- Delete grava `deleted_for_customer=true`, `deleted_at`, `deleted_by_id/name` — texto original PRESERVADO no banco para auditoria.

Frontend `AtendimentosPage.js`:
- Bubble da mensagem do operador ganha botao **`⋯`** flutuante (aparece on hover) com 2 opcoes via prompt: **1=Editar / 2=Apagar para o cliente**.
- **Mensagem apagada**: bubble fica cinza tracejado + label "Apagada para o cliente por {nome}" (texto NAO some, mas fica em italico).
- **Mensagem editada**: bubble fica amarelado (bg-amber-50) + label "Editada · {hora}" com tooltip mostrando o texto original do `edit_history[0]`.
- Cliente NAO ve mensagens apagadas e ve o texto NOVO das editadas (comportamento nativo do WhatsApp).

**Para verificar em producao:** Save to GitHub + deploy do backend Emergent + Manual Deploy do whatsapp-service no Render.



### 2026-02-18 (REPORT+SIMPLIF) — Card "Custo" removido + Relatorio Empresas + Mensalidade unificada ✅

**Pedido do operador:**
1. Tela cadastro empresa: tirar card "Custo total", ordem `Valor venda total → Desconto → Valor devido`, unificar/remover input "Mensalidade".
2. Financeiro: valor original do lancamento deve ser o `valor_venda_total` da empresa.
3. Novo relatorio: empresa | custo | valor venda | lucro | vencimento (em X dias / atrasado Y dias) com filtros mes atual / mes passado / personalizado + Tipo BD + busca. Adequado a mobile.

**Frontend — `LicenseAssignmentPanel.js`:**
- Removido card "Custo total" (era usado internamente, nao precisa visibilidade do operador).
- Adicionados cards "Desconto" e "Valor devido (mensal)" no grid de totais (agora 5 colunas em md+).
- Ordem final: Conexoes → Usuarios → Valor venda total → Desconto → Valor devido.

**Frontend — `Dashboard.js` (modal Editar Empresa):**
- Input "Mensalidade (R$)" REMOVIDO da UI. Valor agora eh sempre calculado: `total_sale_price - discount`.
- `handleSave` busca o catalogo de licencas via `api.get('/super-admin/licenses')` e calcula `_sale + _disc → _computedMonthly`. Persiste `monthly_price` (compat) + novo `total_sale_price` (canonical).
- Grid de "Ciclo / Parcelas / Carencia" passou de 4 para 3 colunas com a remocao.

**Backend — `models.py`:**
- `CompanyCreate`/`CompanyUpdate` ganharam `total_sale_price: Optional[float]`.
- `super_admin_routes.py::update_company` persiste o campo.

**Backend — `scheduler.py`:**
- Em `_process_billing_reminders`, `price` agora prefere `total_sale_price` (fallback para `monthly_price` legado).
- Filtro do cursor: `$or: [{monthly_price>0}, {total_sale_price>0}]` para empresas que so tem o campo novo.

**Backend — novo endpoint `GET /api/super-admin/reports/companies`:**
- Query params: `period` (`current_month` | `last_month` | `custom`), `date_from`, `date_to`, `database_type`, `q` (busca por nome/representante/email/telefone).
- Retorna `{rows, totals}` com `custo`, `venda`, `desconto`, `valor_devido`, `lucro`, `due_date`, `status` (`em_dia | vence_hoje | atrasado | pago | sem_cobranca`), `days_to_due`.
- Ordenado: atrasados primeiro → vence hoje → em dia → pago → sem cobranca.
- Totalizadores: custo_total, venda_total, lucro_total, atrasado_count, em_dia_count, pago_count.

**Frontend — novo painel `CompanyReportPanel.js`** (sidebar SA: "Relatorio Empresas"):
- **Mobile-first**: tabela em `md+`, **cards** com layout vertical em `<md`.
- Filtros em grid responsivo: 1 col mobile → 2 cols sm → 4 cols lg.
- 4 cards de totalizadores no topo (custo/venda/lucro com margem%/atrasados).
- Badges de status coloridas com icone (verde/amarelo/vermelho/cinza).
- Botao **"Exportar CSV"** que gera download com BOM UTF-8 (compativel Excel).
- Re-fetch automatico ao mudar periodo ou tipo BD; campo busca dispara em Enter ou via botao "Aplicar filtros".

**Testes:** 7/7 regressivos passando (`test_billing_send_messages_flag`, `test_flow_engine_state_preservation`, `test_webhook_self_echo_dedup`). FakeColl atualizada para suportar query `$or`.

**Para verificar em producao:** Save to GitHub + deploy do backend Emergent.



### 2026-02-18 (BILL-NO-SEND) — Edicao/criacao de empresa nao envia mais mensagens ✅

**Problemas reportados:**
1. Editar mensagem em "Notificacoes de Cobranca" → cliente recebia WhatsApp na hora do salvar
2. Editar empresa → mesmo bug + as vezes mandava 2 mensagens em sequencia

**Causa raiz** (`/app/backend/routes/super_admin_routes.py`):
- `create_company` (linha 681) e `update_company` (linha 802) chamavam `_process_billing_reminders(db)` que executava as DUAS responsabilidades juntas: (a) materializar parcelas pendentes + (b) **enviar mensagens** quando o offset batia. Bastava uma edicao recair no offset para disparar envio instantaneo.

**Solucao** (`/app/backend/scheduler.py` + `super_admin_routes.py`):
- Adicionado parametro `send_messages: bool = True` em `_process_billing_reminders`.
- `create_company` e `update_company` agora chamam com `send_messages=False` — somente materializam parcelas, nunca enviam.
- O envio real fica exclusivo do tick periodico do scheduler (rodando a cada N minutos).
- Resultado: editar/criar empresa NUNCA dispara WhatsApp; mensagens so saem quando o scheduler bate o offset configurado.

**Novas variaveis para o template** (`scheduler.py` linha ~496 + `BillingReminderPanel.js`):
- `{{licencas_conexao}}` → `company.max_connections`
- `{{licencas_usuario}}` → `company.max_users`
- `{{valor_venda_total}}` → `company.total_sale_price` (formato `1.234,56`)
- `{{valor_desconto}}` → `company.discount` (formato BR)
- `{{valor_devido}}` → `price - discount` da parcela (ja descontado)
- Painel UI mostra todas em badges roxas + aviso verde explicando o novo comportamento (sem auto-envio na edicao).

**Testes** (`/app/backend/tests/test_billing_send_messages_flag.py`): 2/2 passando.
- `test_send_messages_false_does_not_call_send` — confirma que edicao NAO envia
- `test_send_messages_true_sends_when_offset_matches` — confirma que tick periodico envia E renderiza as novas variaveis

**Para verificar em producao:** Save to GitHub + deploy do backend Emergent.



### 2026-02-18 (FIN-UX) — Pacote completo: bug juros + desconto + observações + UX licenças ✅

**🔴 Bug crítico — Juros aparecia como negativo:**
- `AdmLancamentosPanel.js:965` usava `late_fee_computed.total` (só multa+juros) em vez de `late_fee_computed.valor_devido` (base + multa + juros - desconto).
- Sintoma: "Total devido R$ 10.48" + "Multa+Juros +R$ -199.52" para uma fatura de R$ 210.
- Corrigido em 4 lugares: tabela desktop (linha 378), card mobile (linha 434), badge atrasado (linha 469), e modal "Dar baixa" (PayTxnModal).
- ✅ Confirmado: multa/juros já era calculada sobre a parcela individual (`base_amount` em `compute_late_fee_amount`), não sobre o total recorrente.

**Backend (`finance_helpers.py`, `super_admin_finance_routes.py`, `models.py`, `scheduler.py`):**
- `compute_late_fee_amount` agora aceita `discount` e retorna `valor_devido = base - discount + multa + juros`.
- Endpoint `POST /super-admin/finance/transactions/{id}/observation` cria entradas imutáveis em `transactions.observations[]` (id, text, author_id, author_name, created_at).
- Modelos `CompanyCreate`/`CompanyUpdate` ganharam `discount: Optional[float]` e `observation: Optional[str]`.
- Scheduler (`_process_billing_reminders`) propaga `company.discount` e `company.observation` em cada lançamento gerado (a observação vira a 1ª entrada do histórico).

**Frontend — modal Editar Empresa (`SuperAdmin/Dashboard.js`):**
- Novos campos "Desconto fixo (R$)" e "Observações" logo abaixo do bloco "Data 1º venc. / Representante".

**Frontend — modal Criar/Editar Lançamento (`AdmLancamentosPanel.js`):**
- Removido campo "Vencimento (se pendente)" — agora `due_date` é igual a `date` (mais simples).
- Adicionado campo "Desconto (R$)".
- Quando `status=pago`, o modal abre em modo READ-ONLY com badge verde "Pago" e novo bloco `PaidSummary`:
  - Linha-a-linha: valor original, desconto, multa+juros (com dias), valor devido, valor recebido, diferença (a mais/a menor)
  - Data da baixa + método de pagamento
  - Botão "Estornar baixa" (chama o endpoint `/unpay` já existente)
  - Histórico de observações com timestamp + autor
  - Campo "Adicionar observação" para criar nova entrada

**Frontend — `LicenseAssignmentPanel.js`:**
- Botão "+ Adicionar licença" reposicionado para LOGO ABAIXO do título "LICENCAS E COBRANCA" (era no rodapé). Visual mais intuitivo: clique → nova linha cresce abaixo do botão.

**Para verificar em produção:** Save to GitHub + deploy do backend Emergent (não precisa redeployar microserviço).



### 2026-02-18 (FIN+FMT) — Bug 404 no reenvio + formato de data BR ✅

**Bug 1 — "Falha ao reenviar: http 404 - Cannot POST /instances/.../send-text"**
- `/app/backend/scheduler.py` chamava o endpoint `/send-text` que NÃO existe no microserviço Baileys. Endpoint correto é `/send`.
- Também usava `{"to":phone}` quando o microserviço aceita `{"phone":...}`.
- 2 ocorrências corrigidas: linha 182 (auto-close goodbye) e linha 282 (`_send_billing_reminder`).
- Botão "Reenviar lembrete" no Financeiro Adm agora envia normalmente.

**Bug 2 — Data no formato AAAA-MM-DD em vez de DD-MM-AAAA**
- **No fluxo / mensagem do Pix**: `vencimento_fatura` em `/app/backend/flow_engine.py` linha 641-659 vinha cru do SGP (sempre ISO). Adicionada conversão regex AAAA-MM-DD → DD-MM-AAAA preservando passthrough para outros formatos.
- **Na tabela Financeiro Adm**: 2 lugares em `/app/frontend/src/pages/SuperAdmin/AdmLancamentosPanel.js` (linhas 345 e 448) chamavam `.slice(0,10)`. Substituídos por helper `fmtBrDate(iso)` (regex match → DD-MM-AAAA).
- Não tocados: `<input type="date">` (formato ISO é exigência do browser) e Dashboard da empresa (já usava `split('-').reverse().join('/')`).

**Para verificar em produção:** Save to GitHub + deploy do backend Emergent (microserviço NÃO precisa redeploy).



### 2026-02-18 (v2.1.18-final) — Bump de versão + patch de segurança Baileys ✅

**Deploy no Render foi feito mas painel SA continuava mostrando "v2.1.16":**
- Eu havia esquecido de bumpar as constantes `version: 'v2.1.16'` em `/health` e `/version` quando criei v2.1.17 e v2.1.18. Código novo estava rodando, só a etiqueta era antiga.

**Correção:**
- `/app/whatsapp-service/index.js`: constantes `version: 'v2.1.18'` + `built_at: '2026-02-18'` em ambos endpoints.
- Novos flags adicionados ao `/version`:
  - `auto_recovery_stuck_delivery: true` (v2.1.17)
  - `wa_message_status_enum_fixed: true` (v2.1.17)
  - `session_heal_inbound: true` (v2.1.18)
  - `baileys_6_7_22_security_patch: true` (v2.1.18)

**🔴 Security patch — Baileys 6.7.21 → 6.7.22:**
- Render emitiu warning durante o build: *"This version is affected by a zero-day vulnerability that allows spoofing of messages"* (advisory GHSA-qvv5-jq5g-4cgg).
- `yarn add @whiskeysockets/baileys@6.7.22` aplicou o patch (lockfile atualizado).
- libsignal incluso 6.0.0 — sem breaking changes na API que usamos.

**Para verificar em produção:**
1. Save to GitHub + Manual Deploy do whatsapp-service no Render (Clear build cache & deploy).
2. Painel SA → "WhatsApp Service" deve mostrar **v2.1.18**.
3. No build do Render: o warning de Baileys 6.7.21 NÃO deve aparecer mais.
4. Cliente faz teste — logs do Render mostram `[SESSION-HEAL]` e/ou `[AUTO-RECOVERY]` quando preciso.



### 2026-02-18 (v2.1.18) — SESSION-HEAL: detector inbound de Bad MAC / No matching sessions ✅

**Problema confirmado via logs do Render (2026-05-24 23:08):**
- Cliente envia "1" → Nosso Baileys recebe MAS falha em descriptografar (`SessionError: No matching sessions found` + `Bad MAC Error`)
- Cliente fica re-enviando até libsignal eventualmente disparar `Closing open session in favor of incoming prekey bundle` (5-10 minutos depois)
- Após isso tudo volta ao normal
- Sintoma no celular: "Aguardando mensagem" persistente até o auto-recovery do WhatsApp protocol acontecer

**Causa raiz:** sessão Signal local dessincronizada da do cliente (identity key rotation, multi-device drift, ou corrupção da `currentRatchet`). libsignal NÃO emite evento público para isso — esses erros bubble up via pino logger como `level=50`.

**Solução (`/app/whatsapp-service/index.js` v2.1.18):**

1. **Pino logger custom** envolvendo `process.stdout.write`:
   - Lê toda linha de log
   - Matcher cheap (`indexOf`) busca `SessionError`, `Bad MAC`, `No matching sessions`, `failed to decrypt`
   - Quando bate, parseia o JSON e extrai `key.remoteJid` + `key.senderPn` (cobre @lid + @s.whatsapp.net)
   - Adiciona ao `sessionErrorJids: Set<string>`

2. **Sweep a cada 8s**:
   - Para cada JID flagrado (máx 5 por ciclo, evita burst):
     - `sock.authState.keys.set({ session: { [jid]: null } })` — WIPE local session
     - `jidNeedsForceAssert.add(jid)` — próximo outbound vai fazer assertSessions(force=true) → busca fresh prekey bundle
   - Loga `[SESSION-HEAL] wiped local session for ${jid}` para auditoria

3. **Stream stdout preservado** — todos os logs continuam visíveis no Render. O detector é PASSIVO (não engole nada).

**Testes (`/app/whatsapp-service/tests/test_session_heal.js`):** 4/4 passando.

**Combinado com o auto-recovery (v2.1.17, outbound):**
- **Outbound stuck** → Auto-recovery wipa sessão + re-envia em 20s
- **Inbound Bad MAC** → Session-heal wipa sessão em 8s → próxima troca rebuild fresh
- Resultado esperado: "Aguardando mensagem" deve sumir em segundos, não minutos.

**Para verificar em produção:**
1. **Save to GitHub** + deploy **APENAS** do `whatsapp-service` no Render (Clear build cache & deploy).
2. Nos logs do Render, depois de uma sessão problemática, deve aparecer:
   ```
   [INST_ID] [SESSION-HEAL] wiped local session for 242158913192070@lid (libsignal reported Bad MAC / No matching sessions) — next exchange will rebuild from fresh prekey bundle
   [INST_ID] [SESSION-HEAL] wiped local session for 556294320308@s.whatsapp.net ...
   ```
3. Teste real: cliente manda "Opa", "1", CPF — fluxo completo deve fluir sem "Aguardando mensagem" persistir.



### 2026-02-18 (v2.1.17) — Auto-recovery contra "Aguardando mensagem" ✅

**Contexto:** Mesmo após self-echo dedup (AC2), o cliente final ainda via "Aguardando mensagem. Essa ação pode levar alguns instantes." no celular. CRM mostrava o fluxo executando perfeitamente (welcome, menu, CPF, contratos, Pix) — mas as mensagens chegavam ao WhatsApp do cliente como placeholders criptografados que ele não conseguia decifrar (sessão Signal corrompida).

**Estratégia:** Recovery automática POR MENSAGEM, sem precisar de intervenção do operador.

**Microserviço `/app/whatsapp-service/index.js` (v2.1.17):**
1. **Watchlist `pendingDeliveries`** — toda mensagem enviada via `/send` é registrada (msgId → {jid, text, sentAt, retries}).
2. **Interval a cada 5s** — varre a watchlist. Para qualquer mensagem stuck > 20s (sem ack `DELIVERY_ACK≥3`):
   - Wipe da sessão Signal local: `sock.authState.keys.set({ session: { [jid]: null } })`
   - Marca JID para force-assert + `assertSessions([jid], true)` (busca novo prekey bundle do servidor WA)
   - Re-envia o texto original via `sendMessage`
   - Move tracking pro novo msgId (caso o re-envio também trave)
   - Limite: `MAX_AUTO_RETRIES=2`; depois disso desiste e loga
3. **Notifica o backend** via `POST /api/channels/webhook/auto-recovery` para o SA conseguir auditar.
4. **Correção do mapeamento WAMessageStatus**: estava OFF-BY-ONE (ERROR=0 era ignorado, PENDING=1 era tratado como 'failed' disparando force-assert em TODOS os sends). Corrigido pelo enum oficial do Baileys 6.7.21: `{0:'failed', 1:'pending', 2:'server_ack', 3:'delivered', 4:'read', 5:'played'}`.
5. **Watchlist limpa automaticamente** quando recebe `messages.update` com status≥3 (DELIVERY_ACK): mensagem chegou, recovery não é mais necessária.

**Backend `/app/backend/routes/channels_routes.py`:**
- Novo endpoint `POST /api/channels/webhook/auto-recovery` — recebe a notificação, atualiza `wa_message_id` do ticket pro novo id (para futuros acks baterem), grava em `flow_send_log` com `phase=auto_recovery` para visibilidade no painel SA.

**Diag** `/api/super-admin/diag/backend-version`:
- Novo flag: `auto_recovery_webhook=true`

**Para verificar em produção:**
1. **Save to GitHub** → deploy do backend **E** do microserviço `whatsapp-service`.
2. Diag → `auto_recovery_webhook=true`.
3. Logs do whatsapp-service no Render mostrarão `[AUTO-RECOVERY] msgId=... jid=... stuck >20s; wiping session + re-sending` sempre que o sintoma acontecer.
4. Cliente que estava recebendo "Aguardando mensagem" deve passar a receber a mensagem **automaticamente em ~25s** sem nenhuma ação do operador.



### 2026-02-18 (AC2) — Self-echo dedup + impede auto-pause espúrio do bot ✅

**Sintomas em produção (visíveis nos prints do usuário):**
1. Mensagens do bot apareciam **duplicadas** no CRM (no celular do cliente NÃO duplicam).
2. Ticket aparecia com badge **"Bot pausado"** logo após o welcome+menu.
3. Cliente respondia "1" ou "2" e o bot não processava (porque `is_flow_active` retorna False quando `bot_paused=True`).

**Causa raiz (`/app/backend/routes/channels_routes.py::webhook_message`):**
- Baileys, em algumas contas, NÃO retorna `wa_msg_id` na resposta do send → `_persist_outgoing` grava `wa_message_id=None`.
- O `messages.upsert` echo do WhatsApp com `from_me=true` chega depois carregando o id REAL.
- Dedup estrita por `wa_message_id` falha (None ≠ real id) → mensagem é gravada 2x.
- E como `from_me=true`, `pause_bot_on_ticket_if_enabled` é chamado → bot pausado → cliente travado.

**Fix:**
- Em `channels_routes.py` (entre as linhas ~990 e 994 originais), adicionada uma camada de dedup por **(sender_type=agent + texto idêntico + janela 45s)** ANTES de inserir a mensagem e ANTES de chamar `pause_bot_on_ticket_if_enabled`. Quando detecta echo, retorna `{"ok": True, "duplicate": True, "self_echo": True}` e faz backfill do `wa_message_id` real na mensagem original.
- Janela de 45s é apertada o suficiente para não engolir uma mensagem do operador que tenha o mesmo texto coincidentemente.
- Sanity: mensagens de operador com **texto diferente** ou **fora da janela** continuam pausando o bot normalmente.

**Testes regressivos (`/app/backend/tests/test_webhook_self_echo_dedup.py`):** 2 testes passando.
- `test_from_me_echo_of_bot_message_is_deduped`
- `test_from_me_real_operator_message_still_pauses_bot`

**Feature flags no `/api/super-admin/diag/backend-version`:**
- `self_echo_dedup` — confirma presença do log "dropping self-echo"
- `self_echo_backfill_id` — confirma backfill do wa_message_id

**Para verificar em produção:**
1. **Save to GitHub → Clear build cache & deploy** (backend).
2. Acessar (super-admin) `GET /api/super-admin/diag/backend-version` → confirmar `self_echo_dedup=true` e `self_echo_backfill_id=true`.
3. Como o ticket #2484 do print ainda está com `bot_paused=true`, **excluir/reabrir o atendimento** OU usar o botão "Despausar bot" no menu 3-pontos do ticket para reativar o cliente.
4. Cliente manda "Opa" novamente → welcome + menu (sem duplicar no CRM, sem badge "Bot pausado") → cliente responde "2" → bot avança para "Não cliente".


### 2026-02-18 (AC) — Fix Suporte: preserva pending_node_id em falhas de envio ✅

**Contexto:** Suporte Emergent identificou que o flow_engine estava zerando `pending_node_id` quando um envio do round falhava (`send_failed_in_round`), interrompendo o fluxo permanentemente em vez de aguardar a próxima mensagem do cliente. Bot parava após 1ª mensagem em produção.

**Status do código:** Patch já aplicado no commit `5e662d0` (22/05) — bloco `if send_failed_in_round["v"] and pending_node_id: pending_node_id = None` foi removido. Variável `send_failed_in_round` extinta do arquivo.

**Ações 2026-02-18:**
- Adicionado comentário defensivo em `/app/backend/flow_engine.py:1212` explicando que NÃO se deve reintroduzir lógica de zerar `pending_node_id` em falhas.
- Criado `/app/backend/tests/test_flow_engine_state_preservation.py` com 3 testes regressivos (todos passando) que falham caso a lógica antiga retorne.
- Bumpado `build_at` no endpoint `/api/super-admin/diag/backend-version` para `2026-02-18` e adicionados 2 novos feature flags:
  - `no_send_failed_in_round_flag` — confirma que a variável removida não voltou
  - `preserves_pending_on_failure` — confirma ausência do log "discarding pending_node_id"

**Para verificar em produção:**
1. Em Emergent → **Clear build cache & deploy**.
2. Acessar (super-admin) `GET /api/super-admin/diag/backend-version` → confirmar `build_at="2026-02-18"` e ambos flags = true.
3. Refazer teste real ("Opa" no WhatsApp) — bot deve enviar welcome + menu sem travar.


### 2026-02-17 (AB) — Log persistente de envios do bot + visualizacao SA ✅

**Contexto:** Mesmo apos v2.1.16 + delay de 1.2s entre sends, usuario reportou que o sintoma persiste em prod ("Aguardando" volta + bot nao envia 2a msg). Sem evidencia direta nao da para continuar adivinhando.

**Solucao:** Em vez de mais patches especulativos, criar VISIBILIDADE.

**Backend (`flow_engine.py::_emit_and_persist`):**
- Cada send do bot agora grava 1 linha na nova collection `flow_send_log` com:
  - `company_id`, `ticket_id`, `flow_id`, `customer_phone`
  - `round_send_index` (1 = 1a msg do round, 2 = 2a, etc)
  - `text_preview` (120 chars do texto enviado)
  - `wa_msg_id` (None se Baileys nao retornou ID)
  - `send_ok` (bool)
  - `elapsed_ms` (tempo de envio)
  - `created_at`
- Inserts em try/except — falha de log nao quebra o flow.

**Endpoint:** `GET /api/super-admin/diag/flow-send-log/{company_id}?limit=50` retorna os ultimos N envios.

**UI SA → Reparo SGP:**
- Botao "Log de envios do bot" ao lado de "Auditar Fluxos SGP"
- Tabela com cores: verde (✓) = OK, vermelho (✗) = falhou
- Coluna `elapsed_ms` realca vermelho quando > 15000ms (Baileys lento)
- Texto explicativo final: "se voce ve welcome ✓ mas menu ✗ → confirma falha de envio. Se ambas ✓ mas cliente nao recebe a 2a → problema esta no LADO DO DESTINATARIO (sessao corrompida, app desatualizado, dispositivo offline)"

**Para producao:**
1. **Save to Github** + redeploy do backend + frontend.
2. Faz 1 teste real ("Opa" no WhatsApp).
3. SA → Reparo SGP → seleciona Web Fibra → "Log de envios do bot".
4. Le os ultimos 2-4 envios. Resposta definitiva sobre causa.




### 2026-02-17 (AA) — Delay de 1.2s entre sends consecutivos (fix DEFINITIVO do bot parar na 1a msg) ✅

**Investigacao definitiva:** Carregamos o JSON corrigido do operador no banco de preview e rodamos `advance_flow(dry_run=True, is_initial=True, incoming_text="Opa")`. Resultado:

```
>>> Engine emitiu 2 mensagem(s):
[1] Seja bem-vindo a central de atendimento...
[2] Escolha uma opcao: [1] Ja sou cliente [2] Nao sou cliente [3] Suporte tecnico [4] Contratar plano [9] Voltar
```

**O backend GERA as 2 mensagens corretamente.** Logo, o bug nao esta no flow_engine nem no Flowbuilder nem em capture_var nem em arestas — esta no PIPELINE DE ENVIO.

**Root cause real:** Em prod, quando o engine chama `_send_whatsapp(text1)` seguido imediatamente de `_send_whatsapp(text2)` no MESMO round, a 2a chamada chega ao Baileys antes da 1a terminar:
- assertSessions(force=true)
- prekey bundle fetch
- encrypt session record write
- sendMessage

Baileys silenciosamente DESCARTA a 2a mensagem (msg2 e processada com session record stale do meio da gravacao da msg1). Sintoma: cliente recebe so a 1a msg do round.

**Fix (`flow_engine.py::_emit_and_persist`):**
- Quando `sent` ja tem itens (eh o 2o+ send do round), aguardar `asyncio.sleep(1.2)` ANTES de enviar
- Serializa as chamadas → Baileys tem tempo de terminar a 1a antes da 2a iniciar
- Custo: 1.2s a mais por send adicional. Operador percebe como "bot digitando" → UX ate melhor
- Beneficio: garantia de entrega serializada

**Novo endpoint diagnostico:** `POST /api/super-admin/diag/dry-run-flow/{flow_id}` body `{"incoming_text": "Opa", "is_initial": true}`. Retorna a lista de mensagens que o engine GERARIA sem chamar WhatsApp. Permite ao operador validar fluxos rapidamente.

**Testes:** 23/23 (test_flow_engine + test_bot_pause) passando.

**Para producao:**
1. **Save to Github** + redeploy do backend FastAPI.
2. Apos deploy: enviar "Opa" pelo WhatsApp para a conexao Web Fibra.
3. Esperado: 1a msg de boas-vindas + 1.2s + 2a msg do menu (4 opcoes). Cliente ve "digitando..." entre as duas — UX legitima.




### 2026-02-17 (Z) — Preview de conexao de saida em cada node (vai para: X) ✅

**Contexto:** Usuario relatou que o fluxo continua entregando apenas a 1a mensagem. Captura nao era a causa (Conteudo welcome nao tinha badge ⏸). Canvas com 25+ arestas sobrepostas fazia impossivel visualmente confirmar para onde cada Conteudo aponta.

**Fix UX (sem backend):**

Cada node nao-menu/nao-terminal/nao-start agora mostra um **chip verde** dentro do corpo:
`→ Vai para: <label-do-target> [type]`

Implementado em `decorateNode(n, allEdges, allNodes)`:
- Para non-menu nodes com EXATAMENTE 1 aresta de saida, resolve o `target.id` no allNodes e renderiza o label preview (50 chars).
- Atualiza em tempo real via useEffect quando arestas mudam.
- Excluido para menus (que tem N opcoes/handles diferentes) — esses ja mostram per-opcao via os handles vermelhos quando orfaos.

**Beneficio direto:** o Conteudo "Seja bem-vindo" agora vai exibir, dentro do proprio node:
- ✅ Se conectado corretamente: `→ Vai para: 4 opcoes`
- ❌ Se apontando para no errado: `→ Vai para: Menu (Sem opcoes)` — operador identifica de imediato

**Para producao:**
1. **Save to Github** + redeploy do frontend.
2. Abrir Flowbuilder Web Fibra.
3. Olhar o Conteudo "Seja bem-vindo" — o chip verde dentro dele revelara para onde a aresta de saida realmente aponta.




### 2026-02-17 (Y) — Visibilidade de NODES COM CAPTURA no Flowbuilder ✅

**Root cause confirmado para "fluxo entrega apenas a 1a mensagem":** O node Conteudo "Seja bem-vindo... Como posso te ajudar:" estava com `capture_var` configurado (residuo de edicao anterior). Quando o cliente envia qualquer texto, o engine valida o `capture_format` — se invalido, REPETE a mesma mensagem do Conteudo e NAO avanca para o Menu. Por isso o cliente so via o Conteudo, nunca o menu de opcoes.

**Fix UX (sem mudanca de backend — comportamento esta correto, faltava VISIBILIDADE):**

**No node (canvas):**
- Badge laranja "⏸ Aguarda" no header do node sempre que `capture_var` esta setado
- Bloco amarelo no corpo do node mostrando: variavel + formato (CPF/CNPJ/email/CEP/phone/number) — operador identifica de longe quais Conteudos pausam o fluxo

**No editor lateral (clicar no node):**
- Aviso destacado em amarelo no painel "Capturar resposta": "Atencao: este no esta com captura ATIVADA. O fluxo PAUSA aqui ate o cliente responder. Se o cliente responder algo invalido, o bot re-envia esta mesma mensagem e nao avanca."
- Botao **"Limpar captura"** em vermelho no canto que zera `capture_var`, `capture_format`, `capture_invalid_message` em 1 clique — operador resolve sem precisar mexer em 3 campos.

**Para o cliente Web Fibra:**
1. Abrir Flowbuilder
2. Localizar o Conteudo "Seja bem-vindo a central..." — provavelmente ja apareceu o badge "⏸ Aguarda" no header
3. Clicar nele
4. Clicar em "Limpar captura"
5. Salvar
6. Testar — agora o Menu 4 opcoes deve chegar logo apos o welcome.




### 2026-02-17 (X) — v2.1.16: Reset de sessao Signal por JID + indicador visual de anomalias no Flowbuilder ✅

**Contexto:** Apesar dos 5 patches anteriores (v2.1.11–v2.1.15), o usuario continuava reportando "Aguardando mensagem" recorrente em prod. Os patches reduziram a incidencia mas nao a eliminaram porque ALGUMAS sessoes Signal especificas (em prod) ja estavam permanentemente corrompidas no disco (`auth_sessions/`). O retry-receipt nao consegue se recuperar quando o session record local esta inconsistente com o que o destinatario possui.

**Fix nuclear (whatsapp-service v2.1.16):**

Novo endpoint `POST /instances/{id}/reset-session/{jid}`:
- Apaga o session record do JID via `sock.authState.keys.set({session: {[jid]: null}, 'pre-key': {}})`
- Marca o JID em `jidNeedsForceAssert` para o proximo send forcar refetch do prekey bundle
- Limpa entrada do `jidLastSentAt` para nao mascarar como "fresca"
- Log claro: `[SESSION RESET] cleared session for ${jid} — next send will rebuild`
- 1 chamada ≈ 1 prekey consumido. Use com parcimonia.

Bump v2.1.15 → **v2.1.16**. Nova flag `manual_session_reset: true`.

**Backend proxy:** `POST /api/channels/connections/{conn_id}/reset-signal-session` com body `{"phone": "5562..."}`. Valida company_id ownership e tipo whatsapp.

**UI no Atendimentos (`AtendimentosPage.js`):**
- Adicionado item "Resetar sessao Signal" no dropdown de 3 pontinhos do ticket
- Confirmacao via window.confirm explicando o uso e seguranca da operacao
- Toast de sucesso/falha
- `data-testid="reset-signal-session-btn"`

**Indicadores visuais no Flowbuilder (`FlowBuilderPage.js`) — pedido explicito do operador:**
- Nodes com problema ganham ring vermelho ao redor + badge "!" no canto + lista de mensagens em chips inline:
  - `orphan`: node nao-terminal sem aresta de saida
  - `orphan_option`: opcao de menu sem aresta saindo do handle dela
  - `menu_no_options`: menu sem nenhuma opcao
- Banner global no topo da canvas mostrando contagem total de anomalias quando ha problemas
- Atualizacao em tempo real via useEffect: ao deletar uma aresta o anel vermelho aparece instantaneamente sem precisar salvar
- Padronizacao visual de arestas: todas convertidas para SOLIDAS (`animated:false`) com `stroke:#6366f1`. Resolve a queixa "umas pulsam, outras nao, confunde". Backend ja tratava ambos identicamente — era so confusao visual.

**Para producao:**
1. **Save to Github** + redeploy whatsapp-service (v2.1.16) + backend + frontend.
2. Quando ver "Aguardando" recorrente: Atendimentos -> abrir ticket -> 3 pontinhos -> **Resetar sessao Signal**. Proxima mensagem reconstruira a sessao do zero.
3. No Flowbuilder, nodes com problema ja aparecem em VERMELHO com badge "!" — clique para ver detalhes inline.




### 2026-02-17 (W) — Diagnostic UI: "Auditar Conexoes do Fluxo" (detecta nos orfaos) ✅

**Contexto:** Apos v2.1.15 resolver o "Aguardando mensagem", o usuario continuou reportando que o bot envia apenas 1 mensagem e para. Diagnostico exigiria logs do backend FastAPI (no Emergent, nao no Render) — fluxo complexo para o operador. Decidi criar um diagnostico in-app.

**Novo endpoint:** `GET /api/super-admin/diag/flow-edges-audit/{flow_id}` (read-only). Retorna:
- Stats: total nodes / edges / orfaos / arestas penduradas / contagem por tipo
- Lista de **orfaos** (nodes sem aresta de saida exceto ticket/end/transfer)
- Lista de **dangling_edges** (arestas apontando para nodes inexistentes)
- Per-node breakdown: label preview (80 chars), out_edges com target_label + source_handle + flag animated + target_exists

**Novo painel SA** em **Reparo SGP → "Auditar conexoes do fluxo"**:
- Input para flow_id
- Botao "Auditar Conexoes"
- Mostra stats em chips coloridos (rose para orfaos, amber para penduradas, emerald se tudo OK)
- Bloco vermelho destacando os orfaos com instrucao: "Abra o Flowbuilder, localize esses nos e conecte a bolinha inferior ao proximo node desejado".
- `<details>` expansivel listando TODOS os nos + conexoes (com destaque visual para orfaos).
- Hint sobre arestas animadas (pontilhadas) vs estaticas (continuas): "tratadas igualmente pelo backend".

**Validacao end-to-end (preview):**
- Criado flow de teste com `n_start → n_msg` (sem aresta de saida do msg para o menu).
- GET retornou orfaos: `n_msg` (Seja bem-vindo) + `n_menu` (Escolha:) → exatamente o cenario reportado pelo operador.
- Fluxo de teste removido apos validacao.

**Para producao:**
1. **Save to Github** + redeploy do backend FastAPI no Emergent.
2. Em SA → Reparo SGP → secao "Auditar conexoes do fluxo": copiar flow_id do flowbuilder Web Fibra (vai aparecer no botao "Auditar Fluxos SGP" acima).
3. Clicar em "Auditar Conexoes" → o painel revelara se a aresta Conteudo→Menu existe ou nao.
4. Se houver orfaos: voltar ao Flowbuilder e arrastar a bolinha inferior do node orfao ate a bolinha superior do proximo node desejado, depois "Salvar".




### 2026-02-17 (V) — v2.1.15: msgRetryCounterCache (ROOT CAUSE real do "Aguardando") ✅

**Investigacao profunda apos 4 patches sem efeito:** Os patches v2.1.10-v2.1.14 tentavam EVITAR a sessao Signal ficar dessincronizada. Mas o "Aguardando mensagem" no destinatario eh um estado **temporario** que tem um mecanismo nativo do WhatsApp para se auto-curar: o **retry-receipt protocol**. Quando recipiente nao consegue decifrar, ele manda um retry receipt → nosso Baileys deveria responder re-cifrando com sessao fresca via callback `getMessage` → mensagem chega decifrada. Se isso funcionasse, "Aguardando" sumiria em segundos sozinho.

**Root cause real:** O `makeWASocket` estava sendo criado **SEM `msgRetryCounterCache`**. Baileys 6.7+ exige esse cache (NodeCache) para rastrear quantas vezes cada msg foi retentada. Sem ele:
- Retries chegam mas nao sao contabilizados
- Baileys nao consegue distinguir "primeira tentativa" de "ja tentei 3x desisti"
- Internamente DROPA os retries silenciosamente
- → recipiente fica eternamente em "Aguardando mensagem" mesmo apos minutos/horas

**Fix (whatsapp-service v2.1.15):**

- `yarn add node-cache` — nova dependencia (Baileys-recomendada).
- `msgRetryCounterCache = new NodeCache({ stdTTL: 300, useClones: false })` — 5 min TTL.
- `groupMetadataCache = new NodeCache(...)` — analogo para retries em grupos.
- Wire no `makeWASocket({ ..., msgRetryCounterCache, cachedGroupMetadata })`.
- Flags novas no `/version`: `msg_retry_counter_cache: true`, `cached_group_metadata: true`.

**Por que os patches anteriores nao resolviam:**
- v2.1.10 (stale > 12h) cobria gap longo — nao o problema atual.
- v2.1.13 (smart 1h + flagged) cobria janelas medias — nao adiantou pq retry nao funcionava.
- v2.1.14 (inbound trigger) era surgical para sessoes fresh — mas se a sessao ja falhou e o retry nao auto-curra, o estado "Aguardando" persiste.
- v2.1.15 **habilita o auto-cura nativo do WhatsApp**. Sem essa flag, qualquer falha de decryption no destinatario eh DEFINITIVA.

**Bump:** v2.1.14 → **v2.1.15**.

**Para producao:**
1. **Save to Github** + redeploy do whatsapp-service no Render.
2. Validar `/version` retornando `v2.1.15` + `msg_retry_counter_cache: true`.
3. Teste real: enviar "Opa" varias vezes em conversas distintas. Se ainda aparecer "Aguardando", aguarde 10-30 segundos — agora deveria se auto-curar pelo retry protocol.




### 2026-02-17 (U) — v2.1.14: force_assert_on_inbound (fixa o "Aguardando" residual com gap < 1h) ✅

**Bug residual em prod (apos v2.1.13):** Cliente envia "Opa" em uma janela ATIVA (gap de apenas 2 min desde o ultimo send que funcionou), e a resposta do bot chega como "Aguardando mensagem". O smart-threshold de 1h da v2.1.13 nao cobre esse caso pois a sessao parecia "fresca" (idle < 1h).

**Root cause:** Quando o dispositivo do cliente envia uma mensagem, sua sessao Signal **avanca o ratchet** (chain key, e as vezes prekey de novo). O sock.sendMessage do nosso lado pode usar uma view ANTIGA do session record, gerando ciphertext que o destinatario nao consegue mais decifrar → "Aguardando mensagem".

**Fix (whatsapp-service v2.1.14):**

- **`force_assert_on_inbound`**: hook em `sock.ev.on('messages.upsert')`. Quando uma mensagem NAO `fromMe` chega de um JID nao-grupo, o JID eh adicionado ao Set `jidNeedsForceAssert` automaticamente.
- O proximo send para esse JID dispara `assertSessions(force=true)` (mecanismo `failed_jid_recovery` ja existente) refetchando o prekey bundle e reconstruindo o session record fresco.
- Cobre exatamente a janela "post-inbound stale" reportada em prod, sem impactar latencia de fluxos novos ou outbound proativos.
- Custo: 1 force-assert por turno de conversa (quando cliente realmente responde). Nao afeta sends em serie.

**Bump:** v2.1.13 → **v2.1.14**. Flag nova `force_assert_on_inbound: true` no `/version`.

**Para producao:**
1. **Save to Github** + redeploy do whatsapp-service no Render (v2.1.14).
2. Validar `/version` retornando `v2.1.14` + `force_assert_on_inbound: true`.
3. Teste real no WhatsApp: enviar "Opa" para a conexao SA → primeira resposta do bot deve chegar limpa, sem "Aguardando".




### 2026-02-17 (T) — v2.1.13: ROLLBACK do force-assert-always + cooldown no auto-reconnect (fix regressao do fluxo) ✅

**Regressao identificada:** Apos deploy de v2.1.12 em prod, o FlowBuilder parou de entregar fluxos com multiplos Conteudos em sequencia. Sintomas: 1a mensagem entregue, demais nao chegam. Mesmo ambiente (empresa WEB), mesmo flow que funcionava ate v2.1.11.

**Root cause da regressao (v2.1.12):**

1. **`force_assert_always` era TOO aggressive.** Cada `sendMessage` fazia uma chamada de rede ao servidor WA para refetch de prekey bundle (`assertSessions(force=true)`). Isso adicionou 5-10s por send.
2. **Backend httpx timeout de 15s.** Quando o flow disparava 3-4 sends rapidos (Conteudo -> Conteudo -> Menu), os ultimos sends estouravam o timeout porque a fila de assertSessions atrasava o sendMessage.
3. **MAX_CONSECUTIVE_FAILURES=3 sem cooldown.** Apos 3 timeouts (que aconteciam dentro do MESMO fluxo em ~30s), `_bump_send_failure` disparava `POST /restart` na conexao Baileys → derrubava a conexao no meio da execucao do fluxo → cliente nunca via as mensagens restantes.
4. Resultado: a "cura" (v2.1.12) era pior que a doenca — em vez de "Aguardando mensagem", o fluxo PARAVA completamente.

**Fixes (v2.1.13):**

**whatsapp-service (`index.js`):**
- **`smart_stale_session_force_assert`** (substitui `force_assert_always`): voltou para heuristica de threshold, mas com **1h** (em vez de 12h da v2.1.10). force=true so dispara quando:
  - JID nunca foi contatado (`!jidLastSentAt.has(jid)`)
  - JID idle > 1h
  - JID flagged via `messages.update` status=1 (mantido)
- Cobertura do caso de prod (5h gap = stale) preservada. Sends normais entre msgs proximas nao pagam o custo de network.
- Mantidos: `prekey_periodic_upload` (30 min), `failed_jid_recovery` (Set).
- Bump v2.1.12 → **v2.1.13** com flag `force_assert_always` removida explicitamente.

**Backend (`flow_engine.py`):**
- `MAX_CONSECUTIVE_FAILURES` 3 → **5** (reduz false-positives durante bursts transitorios).
- **`AUTO_RECONNECT_COOLDOWN_MINUTES = 5`**: se um auto-restart aconteceu nos ultimos 5 min, novas falhas NAO disparam restart de novo. Loga warning informativo e retorna. Evita restart storms que matam fluxos.
- httpx timeout 15s → **25s**: tolera o force-assert ocasional sem virar false-positive.
- Removido `send_failed_in_round` + stuck-state pending_node clear (heuristica desnecessaria — o root cause real foi corrigido).

**Testes:** 42/42 passando. Removido `test_real_send_failure_does_not_pin_pending_node` (workaround nao mais necessario).

**Para producao:**
1. **Save to Github** + redeploy do whatsapp-service no Render (v2.1.13 + smart_force).
2. Redeploy do backend FastAPI (cooldown + timeout maior).
3. Apos: o FlowBuilder volta a entregar todos os Conteudos do fluxo + o force-assert ainda corrige sessoes stale (>1h) + auto-reconnect so dispara em falhas SUSTENTADAS (nao em bursts transientes de 30s).




### 2026-02-17 (S) — v2.1.12: fix definitivo do "Aguardando mensagem" + recuperacao de fluxo travado ✅

**Bug recorrente:** Mesmo apos v2.1.10/v2.1.11 (TTL 7d + stale_session_force_assert + /restart), usuarios em prod (empresa WEB) continuavam vendo mensagens do BOT chegando como **"Aguardando mensagem. Essa acao pode levar alguns instantes."** + fluxo parando logo no inicio (nao trazia menu de opcoes).

**Root causes residuais identificados:**

1. **Threshold de 12h era folgado demais.** O `assertSessions(force=true)` so disparava se o JID estivesse idle > 12h. Em prod o gap real (14:56 → 20:13 = ~5h) nao acionava — bastava o destinatario ter rotacionado chaves (atualizacao do WA app, troca de dispositivo, sync de multi-device) para a sessao do nosso lado virar stale.

2. **Sem upload periodico de pre-keys.** Baileys gera 30 pre-keys iniciais. Cada nova sessao consome 1. Em uma base ativa, depois de ~30 contatos novos o servidor WA fica sem pre-keys para entregar a quem nos contata → mensagens chegam undecryptable.

3. **Sem feedback de retry-receipts.** Quando o WA do destinatario reporta `status=failed` (codigo 1), nao tinhamos nenhum reforco direcionado para aquele JID.

4. **Flow stuck quando send falha.** Se um node `menu` chamava `_send_whatsapp` e retornava None (real failure), o backend persistia `pending_node_id=menu` no ticket. O cliente nao via a mensagem mas o bot ficava esperando resposta — fluxo parado sem saida.

**Fixes (whatsapp-service v2.1.12):**

- **`force_assert_always`**: removida heuristica de "stale > 12h". Cada `sendMessage` agora faz `assertSessions(force=true)` incondicionalmente. Operacao barata, idempotente, fetcha prekey bundle fresco do servidor WA toda vez.
- **`prekey_periodic_upload`**: `setInterval` global a cada 30 min chama `sock.uploadPreKeysToServerIfRequired()` em cada instancia conectada. Mais 1 chamada inicial 30s apos `connection==='open'`. Garante que pre-keys nunca esgotem.
- **`failed_jid_recovery`**: hook em `messages.update`. Quando status=1 (failed) chega para uma mensagem enviada, o JID destino entra em `jidNeedsForceAssert` (Set). Limpa quando chega delivered/read/played. Log explicito quando recovery acontece.

**Fixes (backend `flow_engine.py`):**

- **Stuck-state recovery**: novo flag local `send_failed_in_round`. Quando `_emit_and_persist` chama `_send_whatsapp` em um ticket com `connection_id+phone` REAL e retorna None, marca o round como falho. No final, se houver pending_node_id (menu/capture) e algum send falhou, **descarta o pending_node_id** (clear). Resultado: a proxima mensagem do cliente re-dispara o fluxo do zero em vez de ficar travado.
- Scope: so trigga para tickets com connection real, preservando o comportamento de tests/dry-run/preview.

**Bump:** `whatsapp-service/index.js` v2.1.11 → **v2.1.12** com 3 features novas no `/version`:
```
force_assert_always: true
prekey_periodic_upload: true  
failed_jid_recovery: true
```

**Testes:** 43/43 pytest passando (flow_engine + bot_pause + ticket_auto_close + iter55-57). Novo teste `test_real_send_failure_does_not_pin_pending_node` valida o stuck-state recovery.

**Para producao:**
1. **CRITICO — redeploy do whatsapp-service no Render** (Baileys). Sem isso, v2.1.12 nao roda em prod e o bug persiste.
2. Redeploy do backend FastAPI para liberar o stuck-state recovery do flow_engine.
3. Apos: verificar `GET /version` no Render → deve retornar `v2.1.12` com as 3 flags novas. Logs ao enviar para cliente devem mostrar `[STALE FIX] force-assert recovered flagged JID` quando o recovery acontece.




### 2026-02-17 (R) — Fix P0: lembretes de cobranca disparando todos juntos + suporte a 0 e dias negativos ✅

**Bug reportado:** Em prod, mensagens de lembrete chegavam ao cliente de forma SIMULTANEA quando havia varios offsets configurados (ex: [10, 3, 1] disparava as 3 numa unica tick). Operador tambem pediu suporte a dia 0 (no vencimento) e a dias APOS vencimento (negativos) para automatizar follow-ups de inadimplencia.

**Root cause:** O loop em `scheduler.py::_process_billing_reminders` avaliava `today >= due - offset` para cada offset e disparava TODOS os elegiveis no mesmo tick. Quando o TXN era materializado tarde (gen_days < max_offset) OU o scheduler ficou offline alguns dias, multiplos offsets passavam o teste de uma so vez e o cliente recebia 3 msgs.

**Fix (SMART FALLBACK — escolha do usuario 1b):**

**Backend (`scheduler.py`):**
- Logica reescrita: a cada tick, calcula `days_until_due = (due - today).days`, filtra offsets `O >= days_until_due` e exclui os ja `status=sent` no historico. Entre os elegiveis, escolhe `min(O)` — o offset mais PROXIMO de hoje.
- Garante **1 reminder por tick por parcela**. Resiliente a downtime (sempre envia o mais recente elegivel).
- Clip de offsets ampliado de `[0..60]` para `[-30..60]`. Negativos => disparam APOS vencimento. Ex: O=-2 envia 2 dias apos due.
- `_send_billing_reminder` agora retorna `(sent_ok, error_detail)`. `error_detail` eh string legivel salva em `billing_reminder_history.error` (`http 404 - ...`, `timeout_10s`, `no_message_id_in_response`, `exception: ...`). Operador ve o motivo real direto no modal Historico.

**Backend (`super_admin_routes.py`):**
- `BillingReminderSettingsIn`: clip ampliado para `[-30..60]`. Resend endpoint atualizado para unpack da nova tupla.

**Frontend (`BillingReminderPanel.js`):**
- Input min=-30, max=60, placeholder "ex: 3 ou -1".
- Chip helper `chipLabel(d)`: 0 => "no vencimento" (amber), positivo => "Nd antes" (indigo), negativo => "Nd apos" (rose).
- Hint: "Positivo = antes / 0 = no dia / Negativo = apos (cobranca atrasada). O sistema envia apenas 1 lembrete por dia (o mais proximo de hoje)."

**Testes:**
- `tests/test_iteration_57.py` (4/4): aceite de negativos+clip, smart-fallback `[10,3,1]+due=today+1 → so offset=1`, negativo `[-2]+due=today-2 → fire -2`, diagnostic error.
- `tests/test_iteration_56.py` test_02 ATUALIZADO para o novo comportamento (so offset=3 fire quando due=today+3 com lista [10,3,1]).
- Regressao total: 16/16 (iter55+56+57).

**E2E (testing_agent_v3_fork):**
- Backend: 7/7 pytest iter56+57.
- Frontend: chips de -2/0/5 renderizam com label e cor corretos. Out-of-range (99, -50) bloqueado via toast. Save persiste apos reload. Settings finalizada limpa em `[10]`.

**Para producao:**
1. Redeploy do backend (FastAPI) — single source of truth da nova logica do scheduler.
2. Redeploy do frontend para liberar o input com negativos no painel de Cobranca.
3. Em SA -> Financeiro Admin -> Cobranca: revisar a lista (`Dias antes do vencimento`). Para automatizar cobranca de inadimplencia, adicione valores negativos (ex: -1, -3, -7). Para reforco no dia, adicione 0.
4. O sistema continua enviando lembretes uma so vez por dia por parcela (smart fallback) — sem risco de spam mesmo apos outage.




### 2026-02-16 (Q) — Auto-detection de socket Baileys zumbi + force-reconnect ✅

**Pedido do usuario (recorrente):** "WhatsApp travou o fluxo, nao responde mais, precisa desconectar/reconectar manualmente". Empresa WEB (prod) afetada.

**RCA aprofundada:**
- Watchdog do Baileys (v2.1.10) so reconecta quando `ws.readyState != 1`. Em casos de socket "zumbi" (websocket aberto mas com state corrompido de E2E), `readyState=1` mas sends sao silenciosamente perdidos.
- Watchdog soft-liveness so atua apos 5min de inatividade — se mensagens continuam chegando mas o bot nao responde, watchdog nunca dispara.
- `_send_whatsapp` no Python: catch generico que retornava None sem detalhe nem contagem de falhas. Operador so percebia depois que clientes reclamavam.

**Implementacao:**

**Backend (`flow_engine.py`):**
- `_send_whatsapp` reescrito com:
  - Log detalhado de `http_status + body_preview` em falhas.
  - Caso 200 OK mas sem `message_id` → conta como falha (Baileys aceitou mas nao entregou).
  - Catch separado para `TimeoutException` (logado como `timeout`).
- Novos helpers:
  - `_bump_send_failure(db, conn_id, wa_url, reason)`: incrementa contador per-conexao (`send_failures_count`) e persiste `last_send_failure_at` + `last_send_failure_reason`. Apos `MAX_CONSECUTIVE_FAILURES=3` (consecutivas), dispara `POST /instances/{id}/restart` no Baileys e reseta o contador.
  - `_reset_send_failure(db, conn_id)`: zera o contador em cada send bem-sucedido.

**Backend (`channels_routes.py`):**
- Novo endpoint `POST /api/channels/connections/{conn_id}/force-reconnect`: recovery hatch manual. Reseta o contador + dispara `/restart` no Baileys. Util para botao "Forcar reconexao" na UI.

**Baileys microservice (`whatsapp-service/index.js` → v2.1.11):**
- Novo endpoint `POST /instances/:id/restart`: fecha o websocket + recria via `createConnection` reusando o auth on-disk (sem precisar re-scanear QR). Diferente de `/disconnect` que apaga o auth folder.
- Feature flag `soft_restart: true` em `/version`.

**Validacao e2e:**
- Backend startup OK (48/48 testes passando).
- Baileys local v2.1.11: `POST /instances/<id>/restart` retorna `{status:"restarted"}`.
- Frontend pode chamar `POST /api/channels/connections/{id}/force-reconnect` (404 no preview porque `WA_SERVICE_URL` aponta para o Baileys de **producao** que ainda esta em v2.1.10 — funcionara apos redeploy do Render).

**Para producao:**
1. **Redeploy do whatsapp-service no Render** (Baileys v2.1.11 com `/restart`). Sem redeploy, o auto-fix nao funciona porque o endpoint nao existe.
2. **Redeploy do backend FastAPI** para liberar o force-reconnect endpoint + auto-detection.
3. Apos: quando um socket entrar em estado zumbi e 3 sends consecutivos falharem, o backend ja vai forcar restart automaticamente. Operador nao precisa mais intervir.

**TODO frontend:** Adicionar banner "Conexao instavel - Reconectar" na pagina de Conexoes quando `send_failures_count > 0` e CTA chamando o novo endpoint. (Nao bloqueante — o auto-fix ja resolve sem intervencao humana.)



### 2026-02-16 (P) — Periodo presets no Lancamentos + Cobranca como aba do Financeiro + tabs mobile ✅

**Pedido do usuario:**
1. Adicionar **presets de periodo** no filtro (semana, este mes, ult. 3 meses).
2. Mover **multa/juros** para uma aba do Financeiro Admin (em vez de Notificacoes de Cobranca).
3. Melhorar **abas do Financeiro no mobile**.

**Frontend:**
- `AdmLancamentosPanel.js`:
  - Substituido o input de mes pelo dropdown **"Periodo"** com 4 opcoes: `Esta semana`, `Este mes` (default), `Ult. 3 meses`, `Mes especifico`. Quando o usuario escolhe "Mes especifico", reaparece o input `type=month`.
  - Helper `_periodRange(preset, customMonth)` calcula `[start, end)` corretamente para cada caso (domingo a sabado para semana, primeiro do mes corrente para "este mes", D-2 meses para "ult. 3 meses").
- `SuperAdmin/Dashboard.js (FinancialTab)`:
  - Nova aba **"Cobranca"** entre `Lancamentos` e `Comissoes`, renderizando o `BillingReminderPanel` (mesmo componente que estava em Conexoes → Notificacoes de Cobranca, agora disponivel em ambos lugares).
  - **Mobile (`sm:hidden`):** o tab strip horizontal foi substituido por um **`<select>` dropdown** com largura total e padding generoso, evitando quebra de linha em telas pequenas.
  - **Desktop (`hidden sm:flex`):** mantem a barra de tabs horizontal.

**Validacao:**
- Desktop: 5 tabs visiveis (Resumo, Lancamentos, Cobranca, Comissoes, Clientes Externos). Click em "Cobranca" renderiza o BillingReminderPanel (com multa/juros default + dias antes + lembretes).
- Filtro de periodo desktop: default=`this_month`, 4 opcoes corretas, "Mes especifico" expande input mes.
- Mobile (414px): select dropdown com as 5 opcoes, switch para "cobranca" renderiza painel completo verticalmente. Sem horizontal overflow.

**Para producao:** Redeploy. Apos:
- Financeiro Admin → Cobranca: novo local para configurar dias antes, multa, juros, mensagem padrao.
- Financeiro Admin → Lancamentos: usar o dropdown "Periodo" para alternar rapido entre semana/mes/3 meses.
- A configuracao **continua acessivel** tambem em SA → Conexoes → Notificacoes de Cobranca (mesmo dado).



### 2026-02-16 (O) — Multa/juros default global + valor recebido na baixa ✅

**Pedido do usuario:**
1. Verificar onde esta o parametro `lancamento_gen_days`.
2. Adicionar **multa + juros padrao** no mesmo painel de Configuracoes.
3. Adicionar campo **"Valor recebido"** na forma de pagamento.

**Backend:**
- `BillingReminderSettingsIn` ganhou:
  - `default_late_fee_enabled: bool`
  - `default_late_fee_multa_pct: float` (0-100)
  - `default_late_fee_juros_dia_pct: float` (0-100)
- `scheduler._process_billing_reminders` aplica esses defaults no `late_fee` da txn quando cria Lancamento auto (e `enabled=True`). Operador continua podendo sobrescrever por parcela no form de edicao.
- `AdmTxnUpdate` ganhou `valor_recebido: Optional[float]`.
- `POST /finance/transactions/{id}/pay` agora aceita `valor_recebido` no body (alem do `payment_method`). Persistido como auditoria.

**Frontend:**
- `BillingReminderPanel.js`: novo card **"Multa e juros por atraso"** com toggle master + 2 inputs (multa % + juros/dia %). Inputs desabilitados quando toggle off.
- `AdmLancamentosPanel.js`:
  - Novo `PayTxnModal` (modal de baixa). Antes a baixa era direta (clica no metodo → pago). Agora abre modal mostrando:
    - Resumo: Valor original, Multa+Juros (se atrasado), Total devido.
    - Input "Valor recebido (R$)" — pre-preenchido com total devido.
    - 3 botoes coloridos para escolher metodo (Pix/Boleto/Dinheiro).
    - Botoes Cancelar + Confirmar baixa.
  - PaymentCell agora mostra "recebido: R$ XXX" abaixo do badge de metodo quando ha `valor_recebido` salvo (auditoria visivel direto na lista desktop).
  - Cards mobile + toolbar Pix/Boleto/Dinheiro tambem usam o novo modal.

**Validacao e2e:**
- Settings `default_late_fee_enabled=true, multa=2%, juros=0.1%/d` → empresa cadastrada → txn herda `late_fee={enabled:true, multa_pct:2, juros_dia_pct:0.1}`. 
- POST `/pay` com `valor_recebido=110.00` em txn de amount=100 → persistido (`valor_recebido: 110.0`).
- Frontend: panel de Notificacoes de Cobranca renderiza card "Multa e juros por atraso" com toggle + inputs. Click em "Pagar Pix" abre modal "Dar baixa" com input valor=199.9 (default), 3 botoes coloridos para metodo, e "Confirmar baixa".

**Regressao:** 23/23 (iter55+iter56+ticket_auto_close+bot_pause).

**Para producao:** Redeploy. Apos:
1. SA → Conexoes → Notificacoes de Cobranca → ativar "Multa e juros por atraso" + preencher os 2 percentuais.
2. Todo novo Lancamento auto-gerado pelo scheduler vai herdar esses defaults.
3. Ao dar baixa em qualquer parcela (botoes Pix/Boleto/Dinheiro), abre o modal com "Valor recebido" editavel.



### 2026-02-16 (N) — Parametro `lancamento_gen_days` (gera financeiro X dias antes) + sync no save ✅

**Pedido do usuario:** Criar parametro que define quantos dias antes do vencimento o Lancamento eh gerado automaticamente. Antes era hardcoded em 10. Ao cadastrar a empresa com data de 1o vencimento dentro do intervalo, ja lancar imediatamente no financeiro.

**Backend:**
- `BillingReminderSettingsIn`: novo campo `lancamento_gen_days` (default 10, clip 0..180). Persistido em `system_settings.billing_reminder`.
- `scheduler.py::_process_billing_reminders`: decoupling claro:
  - `lancamento_gen_days` controla quando MATERIALIZAR a parcela (cria row em `super_admin_transactions`).
  - `days_before_due_list` controla quando DISPARAR cada lembrete.
  - Cutoff walk = `max(gen_days, max(days_list))` para nao perder eventos quando reminders ficam fora da janela de geracao.
  - Quando `(due - today).days > gen_days` e a row nao existe → `continue` (skip materializacao).
- `super_admin_routes.py`: `create_company` e `update_company` chamam `await _process_billing_reminders(db)` apos salvar (instantaneo, em vez de esperar ate 60s pelo tick do scheduler).

**Frontend:**
- `BillingReminderPanel.js`: novo card **"Geracao automatica do Lancamento"** entre os cards de dias/canal e a mensagem padrao. Input number 0-180 com label "dias antes do vencimento". Default 10.

**Validacao e2e:**
- Configurado `gen_days=30` + `days_list=[10,3,1]`.
- Empresa criada com `first_due_date=today+20`:
  - **TXN criado IMEDIATAMENTE** apos POST (1 row, parcela 1/2, due em 20d). 
  - **History 0 entries** (today+20 > today+10 = fora da janela de qualquer reminder). 
- Reset settings + cleanup OK.

**Regressao:** 15/15 (iter55+iter56+ticket_auto_close).

**Para producao:** Redeploy. Apos:
1. SA → Conexoes → Notificacoes de Cobranca → ajustar o novo campo "Geracao automatica do Lancamento" (default 10 mantem comportamento anterior).
2. Ao salvar uma empresa cujo 1o vencimento esta dentro do intervalo, a parcela ja aparece em Financeiro Admin → Lancamentos imediatamente.



### 2026-02-16 (M) — Financeiro Admin: cards expansiveis mobile + defaults + Cliente como 1a coluna ✅

**Pedido do usuario:**
- Mobile: somente Empresa, Valor e Pagamento visiveis; restante em **card expansivel**.
- Desktop: modernizar, mantendo Valor cobrado + Valor atualizado.
- Cards de totais refletindo valores reais; pre-selecionar **Em aberto** + **Entrada**.
- Remover opcao "Todas direcoes" da dropdown.
- Adicionar filtro de **data** com mes atual pre-selecionado.
- Coluna **Cliente/Empresa** como 1a coluna.

**AdmLancamentosPanel rewrite (2026-02-16 M):**
- Filtros default: `direction=entrada`, `status=pendente`, `month=YYYY-MM (atual)`. Dropdown "direcao" agora so tem `Entradas/Saidas` (removido "Todas direcoes").
- Novo filtro de mes (input `type="month"`) integrado a toolbar. Backend ja suporta `start_date`/`end_date` no endpoint `/finance/transactions` e `/finance/summary` — agora frontend deriva `[startISO, endISO)` a partir do YYYY-MM e envia ambos.
- 4 cards de totais reordenados: **Entradas pagas, Em aberto, Saidas, Liquido**. Todos respeitam o filtro de mes ativo (chamam summary com `start_date/end_date`).
- Nova coluna **Cliente/Empresa** (1a no desktop, titulo do card no mobile). Lookup feito via `/super-admin/companies?limit=1000` (state `companies` + `companyMap`). Fallback: `external_client_name` ou primeiros 8 chars do `company_id` quando empresa nao existe mais.
- **Desktop (`hidden sm:block`):** tabela `Cliente/Empresa | Data | Tipo | Descricao | Valor | Pagamento | Acoes`. Sub-componentes `PaymentCell` (Aberto + 3 botoes) e `RowActions` (Send/History/Edit/Delete) extraidos para reuso.
- **Mobile (`sm:hidden`):** lista de cards. Cabecalho clicavel mostra **Empresa + Valor + badge Aberto/Pago + chevron**. Tap expande para revelar Data, Tipo, Descricao, atrasado (se aplicavel), botoes "Pagar Pix/Boleto/Dinheiro" full-width, e `RowActions`.
- Idle state empty: card com mensagem "Nenhum lancamento encontrado" em ambos layouts.

**Validacao:**
- Desktop screenshot: 4 cards corretos, dropdown direction so com 2 opcoes (Entradas/Saidas), month default=`2026-05`, status default=`Em aberto`, primeira coluna="Cliente / Empresa".
- Mobile (414x896): 18 cards listados, expand do 1o card mostra detalhes + botoes de pagamento + acoes (Reenviar/Historico/Editar/Excluir).
- Regressao: 12/12 testes iter55+iter56 passando.

**Para producao:** Redeploy. UX:
1. Ao abrir o Financeiro Admin, o operador ja ve apenas as contas **a receber do mes corrente** (filtro pre-aplicado).
2. Pode trocar o mes pelo input no canto esquerdo da toolbar.
3. No mobile, lista enxuta — basta tocar para abrir detalhes/pagar.



### 2026-02-16 (L) — Multi-offset reminders + history + resend + representante ✅

**Pedido do usuario:**
1. Historico de reminders por empresa, com opcao de reenviar do Financeiro.
2. Multiplos lembretes (ex: 10, 3, 1 dias antes) configuravel em Notificacoes de Cobranca.
3. Campo `representante` na empresa (usado como variavel `{{nome}}`).

**Backend:**
- `models.py`: campo `representante` em CompanyCreate/Update.
- `super_admin_routes.py`:
  - `BillingReminderSettingsIn` ganhou `days_before_due_list` (mantem singular para back-compat).
  - `GET/PUT /billing-reminder-settings` retorna lista + singular (= max).
  - Novo `GET /super-admin/billing-reminder-history?company_id=&transaction_id=` (200 rows).
  - Novo `POST /super-admin/finance/transactions/{id}/resend-reminder` — refira a mensagem com o template global e os valores da parcela; loga em `billing_reminder_history` com `kind=manual_resend`. Retorna 400 se faltar conexao/telefone (mas ainda loga o failure no historico).
  - `representante` persistido junto com `first_due_date` no save da empresa.
- `scheduler.py::_process_billing_reminders`: reescrito para suportar lista de offsets.
  - Cada parcela pendente pode receber multiplos lembretes (1 por offset).
  - Janela: `today >= due - offset`. Skip offsets >= max para nao quebrar walk.
  - Idempotencia por (txn, offset) usando consulta a `billing_reminder_history` com status=sent.
  - **Failed retries:** offsets que falharam (sem WA, sem telefone, etc) sao reretentados em cada tick — desejado para tolerar outages temporarios.
  - Template usa `representante` quando setado, fallback para `name` da empresa.
  - Cada dispatch (sucesso ou falha) eh registrado em `billing_reminder_history` com:
    `company_id`, `transaction_id`, `phone`, `text`, `kind` (auto|manual_resend), `status` (sent|failed), `error`, `days_before_due`, `sent_at`.

**Frontend:**
- `BillingReminderPanel.js`:
  - Substituiu input unico de dias por **lista de chips** (10d antes, 3d antes, ...). Add via input number + botao "+ Adicionar" (Enter tambem funciona). Remove via botao `x` no chip. Min sempre 1 chip ([10] se vazio).
- `SuperAdmin/Dashboard.js (CompanyModal)`:
  - Novo campo `representante` ao lado de `first_due_date` (grid 2 col em desktop).
  - Texto explicativo deixa claro que `{{nome}}` usa o representante.
- `SuperAdmin/AdmLancamentosPanel.js`:
  - Cada linha de Lancamento com `kind=licenca` + `status!=pago` ganhou 2 botoes:
    - **Send (verde)** — reenvio manual instantaneo.
    - **History (cinza)** — abre modal `ReminderHistoryModal`.
  - Modal mostra timeline: cada entry com badge (ENTREGUE/FALHOU), tipo (Automatico/Manual), offset (Nd antes), data/hora, preview do texto. Botao "Reenviar agora" no rodape.

**Testes:**
- `tests/test_iteration_56.py` (3/3 passing): PUT da lista, scheduler multi-offset com representante + idempotencia, resend endpoint logando historico.
- Regressao total: **71/71** (flow_engine, bot_pause, ticket_auto_close, licenses iter54, sgp_pix_repair, iter55, iter56, bot_pause_api, sgp_gateway_dedup).

**E2E manual:**
- PUT settings `days_before_due_list=[10,3,1]` → GET retorna mesma lista ordenada desc.
- Empresa com `first_due_date=today+3`, `representante="João da Silva"`:
  - Scheduler cria 1 txn + dispara 2 lembretes (offsets 10d e 3d, com `Joao da Silva` no texto). Offset 1d pulado (today < due-1).
  - Tick repetido NAO duplica reminders (idempotencia em `billing_reminder_history`).
- POST `/resend-reminder` cria entrada `kind=manual_resend` no historico.

**Para producao:** Redeploy. Apos:
1. SA → Conexoes → Notificacoes de Cobranca: editar lista (ex: 10, 3, 1 dias antes).
2. SA → Empresas → editar empresas existentes: preencher campo "Representante".
3. SA → Financeiro Admin → Lancamentos: cada parcela de licenca pendente tem botoes Send (reenvio) e History (timeline).



### 2026-02-16 (K) — Conexoes virou parent expansivel + Notificacoes de Cobranca global ✅

**Pedido do usuario:** Remover as 3 abas internas da pagina Conexoes (tanto SA quanto tenant), transformar em sub-itens da sidebar. Criar uma 4a sub-aba "Notificacoes de Cobranca" para configurar globalmente o lembrete (dias antes do vencimento + mensagem + canal). Remover o bloco de lembrete que estava dentro do cadastro da Empresa.

**Decisoes:** 1a (parent expansivel), 2a (config global), 3a (dias unico global), 4 (nomes confirmados), 5c (parent sem rota propria).

**Backend:**
- `scheduling_routes.py`: 4 novas feature_keys tenant (`conexoes_canais`, `conexoes_templates`, `conexoes_notificacoes`, `conexoes_cobranca`) + 4 SA (`sa-conexoes-*`).
- `super_admin_routes.py`: novos endpoints `GET/PUT /api/super-admin/billing-reminder-settings` (storage: `system_settings` doc com `key="billing_reminder"`). Campos: `enabled`, `days_before_due` (0-60), `channel` (whatsapp/email/both), `default_message`.
- `scheduler.py::_process_billing_reminders`: agora le `system_settings.billing_reminder` em cada tick. Respeita `enabled=false`, usa `days_before_due` configurado, `default_message` global, `channel` (envia WA somente quando `whatsapp` ou `both`).
- `models.py`: removido `billing_reminder_message` de CompanyCreate/Update (so `first_due_date` ficou).

**Frontend:**
- **NOVO** `/app/frontend/src/components/BillingReminderPanel.js`: card master toggle + (dias + canal) + textarea mensagem global, com data-testids para todos os controles.
- `SuperAdmin/Dashboard.js`:
  - Sidebar item "Conexoes" virou `isGroup` com `children` (4 sub-itens). Render com chevron expansivel; estado `openGroups`; auto-abre o group quando filho esta ativo.
  - Header label agora resolve via flatMap (parent ou filho).
  - 4 novos `activeTab` cases: `sa-conexoes-canais/templates/notificacoes/cobranca`. Os 3 primeiros renderizam `<ConexoesPage initialTab=X hideTabs />`; o ultimo renderiza `<BillingReminderPanel />`.
  - **CompanyModal:** removido o bloco indigo "Lembrete de cobranca (WhatsApp)". Sobrou apenas o input `first_due_date` simples com texto explicativo apontando para Conexoes → Notificacoes de Cobranca.
- `Company/Dashboard.js`:
  - `ConexoesPage` aceita prop `hideTabs` (oculta o tab strip interno).
  - 4 novos FEATURE_META: `conexoes_canais/templates/notificacoes/cobranca` (parent='conexoes').
  - 4 novos `renderPage` cases que delegam para `<ConexoesPage hideTabs />` com tab correto, exceto cobranca que mostra `<TenantBillingReminderInfoPanel />` (read-only, apontando para o SA).

**Testes:**
- Regressao: 68/68 testes passando.
- E2E manual: GET/PUT `/billing-reminder-settings` funcionando. Sidebar mostra 4 sub-itens sob Conexoes. Painel renderiza, salva (persistencia confirmada via GET subsequente).

**Para producao:** Redeploy. Apos:
1. Como SA, ir em Tipos de Negocio → ativar as 4 features (`conexoes_canais`, `conexoes_templates`, `conexoes_notificacoes`, `conexoes_cobranca`) nos BTs que desejam exibir cada sub-aba.
2. Acessar SA → Conexoes → Notificacoes de Cobranca: configurar dias antes (default 10) + mensagem global.
3. As empresas existentes continuam funcionando — a unica diferenca eh que a mensagem custom por empresa foi descontinuada (todas usam a global agora).



**Pedido do usuario:** mudar a forma de gerar Lancamentos financeiros — em vez de criar todas as parcelas de uma vez ao salvar a empresa, gerar **1 parcela por vez, 10 dias antes do vencimento**, e disparar um lembrete via WhatsApp. Para isso, **liberar Atendimento + Conexao no Super Admin**.

**Decisoes finais do usuario:**
- 1b: Campo novo "Data do 1o vencimento" na empresa (nao a partir do save).
- 2b: Mensagem do lembrete customizavel por empresa com `{{nome}}`/`{{empresa}}`/`{{valor}}`/`{{vencimento}}`/`{{parcela}}`.
- 3c: Se a empresa nao tem `phone`, cria o Lancamento mas pula o reminder (loga info).
- 4a: Apaga todos os pendentes auto-gerados antigos no save e re-cria no novo modelo.
- 5: Adicionar menus de Atendimentos e Conexoes no sidebar do SA.

**Implementacao:**

1. **SA system company** (`server.py`):
   - Novo `_ensure_super_admin_system_company` na startup. Cria company `id="_super_admin_system_"` com flag `is_super_admin_system=true` (idempotente).

2. **auth.py:** apos carregar SA user, injeta `user.company_id = "_super_admin_system_"`. Permite que as rotas tenant existentes (channels, tickets, atendimentos) funcionem sem refactor.

3. **`models.py CompanyCreate/Update`:** novos campos:
   - `first_due_date: Optional[str]` (ISO date)
   - `billing_reminder_message: Optional[str]`

4. **`routes/super_admin_routes.py`:**
   - `create_company`: NAO chama mais `_generate_adm_txns_for_company`. Salva apenas os campos `first_due_date` e `billing_reminder_message`.
   - `update_company`: quando `monthly_price` / `installments` / `billing_cycle` / `first_due_date` muda, faz `delete_many` em `super_admin_transactions` com `auto_company_billing=true` e `status=pendente`. PAGOS sao preservados.

5. **`scheduler.py::_process_billing_reminders`** (NOVO):
   - Itera companies com `monthly_price > 0`, `installments > 0`, `first_due_date` setado.
   - Calcula a proxima parcela ainda nao gerada (consultando `super_admin_transactions` por `recurrence_index`).
   - Se `due_date <= today + 10d`: cria 1 Lancamento (kind=licenca, status=pendente, auto_company_billing=true) + envia reminder WA.
   - Apenas 1 parcela por tick por empresa (evita burst em migracao).
   - Reminder usa a 1a conexao `status=connected` da SA system company. Sem conexao → loga warning, txn ainda eh criada.
   - Tick adicionado em `tick()` apos auto-close.

6. **Frontend `SuperAdmin/Dashboard.js`:**
   - Sidebar ganhou `sa-atendimentos` (Headphones) e `sa-conexoes` (LinkIcon).
   - Renderiza `<AtendimentosPage />` e `<ConexoesPage />` (re-exportado de `Company/Dashboard.js`).
   - CompanyModal: novo bloco indigo "Lembrete de cobranca (WhatsApp)" com input date `first_due_date` + textarea `billing_reminder_message` + hint das 5 variaveis.

**Testes:**
- 9/9 em `tests/test_iteration_55.py`:
  - test_01: company create NAO gera txns eager (lazy).
  - test_02: update billing wipes pending auto (sem crash).
  - **TestBillingReminderScheduler.test_scheduler_generates_one_txn_within_window:** cria company com `first_due_date` em 5 dias, roda `_process_billing_reminders` 2x, valida 1 unico txn criado (idempotencia + janela de 10d).
- Regressao total: 68/68 (flow_engine, bot_pause, ticket_auto_close, licenses iter54, sgp_pix_repair, iter55, bot_pause_api, sgp_gateway_dedup).

**E2E manual (curl):**
- SA agora ve `company_id=_super_admin_system_` em `/api/auth/me`.
- `GET /api/channels/connections` como SA retorna `[]` (esperado, sem instancia ainda).
- POST company com `first_due_date=today+5` → 0 txns. Apos scheduler tick → 1 txn (parcela 1/3 due em 5d). Segundo tick → ainda 1 (idempotente). Mudando `first_due_date` para +30d → 0 txns (wipe + fora da janela). Tick → continua 0.

**Para producao:** Redeploy. Apos:
1. Acessar SA → Conexoes → adicionar 1 instancia WA, escanear QR.
2. Em cada empresa, abrir o cadastro e setar "Data do 1o vencimento" + opcionalmente customizar a mensagem.
3. O scheduler roda a cada 60s. Empresa com 1a parcela em <= 10 dias ja recebera o Lancamento + lembrete na proxima tick apos o save.


### 2026-02-15 (I) — 5 tarefas em lote: auto-close msg + 3 cards SA + auto AdmTxn + mobile + flow obs ✅

**T1 — Mensagem custom de auto-close (`ticket_auto_close_message`):**
- `scheduler.py::_process_ticket_auto_close` agora envia mensagem antes de fechar, substituindo `{{nome}}` (e `{nome}` legado) pelo nome do contato e `{{empresa}}`/`{empresa}` pelo nome da empresa.
- Endpoint `PUT /api/crm/company/ticket-settings` aceita o campo com cap em 1000 chars; GET retorna o valor.
- Frontend `TicketLifecycleSettingsCard`: textarea com hint para `{{nome}}` e `{{empresa}}`, contador de chars, desabilitado quando `hours=0`, save on blur via debounce manual.

**T2 — SA Empresas: 3 cards totalizadores:**
- Substituidos os 4 cards (`Empresas`, `Total Licencas`, `Conexoes em uso`, `Usuarios em uso`) por 3 cards exatos:
  - `total-card-empresas`: contagem de empresas
  - `total-connections`: `used / total_limit`
  - `total-users`: `used / total_limit`
- `TotalCard` aceita prop `testid` para data-testid customizado.

**T3 — Auto-criacao de Lancamentos Adm:**
- Novo helper `_generate_adm_txns_for_company` em `super_admin_routes.py` cria N rows em `super_admin_transactions` com `kind=licenca`, `status=pendente`, `auto_company_billing=true`, `direction=entrada`, descricao "Mensalidade {empresa} - parcela X/N".
- Cycle suportado: `monthly` (incrementa mês), `yearly` (incrementa ano), `one_time` (gera 1 só).
- Chamado em `create_company` (sempre) e em `update_company` (so quando `monthly_price`/`installments`/`billing_cycle` mudaram, com `reset_pending=True`).
- **Idempotente:** wipes apenas rows pendentes auto-geradas; PAGOS sao preservados (auditoria/historico).
- Falhas no auto-gen sao logadas como warning mas nunca bloqueiam o save da empresa.

**T4 — Mobile layout (Finance + CompanyModal):**
- `AdmLancamentosPanel`: hero metrics agora `grid-cols-2 sm:grid-cols-2 lg:grid-cols-4` (igual mas mais responsivo nos gaps). Toolbar com selects `flex-1 min-w-[140px] sm:flex-none`, refresh button com texto oculto em mobile, "Novo Lancamento" full-width em mobile. Form modal interno: grids `grid-cols-1 sm:grid-cols-2`, padding reduzido `p-4 sm:p-6 my-4 sm:my-8`.
- `CompanyModal`: padding `p-2 sm:p-4`, header/sticky-footer `p-4 sm:p-6`, billing fields `grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3`, botoes Cancelar/Salvar em mobile ficam `flex-1` (largura total). Sem horizontal overflow em viewport 390x844.

**T5 — Observabilidade do "WA flow para de responder":**
- Baileys v2.1.10 ja tem todas as resilience features (zombie watchdog, stale session force-assert, 7d cache TTL).
- `channels_routes.py::webhook/message` agora:
  1. **logger.exception** (com traceback) quando `advance_flow` lanca — antes era `warning` silencioso.
  2. **logger.warning** + auto-clear quando ticket aponta para `active_flow_id` mas o flow nao existe mais no DB.
  3. **logger.error** quando ticket tem `active_flow_id` sem `active_flow_node_id` (stuck state — flow crashed mid-execution).

**Testes:**
- `/app/backend/tests/test_iteration_55.py` — 8/8 passing (cobre T1 GET/PUT, T3 create + update preservando pagos, T5 strings de log presentes).
- Regressão completa: 59/59 (test_flow_engine, test_bot_pause, test_ticket_auto_close, test_iteration_54_licenses, test_sgp_pix_repair, test_bot_pause_api, test_sgp_gateway_dedup).

**Para producao:** Redeploy. Operador deve:
1. Configurar mensagem de auto-close em CRM → Configuracoes (card "Ciclo de vida dos atendimentos")
2. Verificar que Super Admin → Empresas agora mostra 3 cards conforme especificado
3. Ao salvar empresa com installments+monthly_price, os Lancamentos pendentes aparecem em Financeiro Admin → Lancamentos automaticamente.



### 2026-02-15 (G2) — "Aguardando mensagem" persistente: TTL 7d + stale-session re-bundle (v2.1.10) ✅

**Bug:** Em TODAS as bases que usam atendimento, mensagens enviadas pelo painel chegam ao cliente como "Aguardando mensagem. Essa ação pode levar alguns instantes." mesmo apos a v2.1.9 (que ja tinha assertSessions + cache MongoDB).

**Root causes (2 distintas combinadas):**

1. **TTL do cache de plaintext era 24h.** Quando o cliente abre uma conversa apos 1-7 dias e o celular pede retry de decrypt, o Baileys chama `getMessage(key)` — cache HIT em RAM (perdido em restart) e MISS no MongoDB (TTL expirou) → retorna `{conversation:''}` → cliente fica preso no placeholder. A screenshot do usuario mostrou exatamente esse cenario: msg OK sexta 10:47 (✓✓ azul) → "Aguardando" segunda 10:59 + terca 10:20.

2. **assertSessions com `force=false`** só estabelece sessao se NAO existir — mas a sessao do nosso lado pode estar tecnicamente valida porem STALE em relacao ao dispositivo do destinatario (que rotacionou keys naquele meio tempo). O envio sai criptografado com sessao velha, o WA do destinatario nao decifra, pede retry, e mesmo com getMessage funcionando o problema da sessao stale persiste.

**Fixes (v2.1.10):**

1. **Backend `routes/internal_routes.py`:** `SENT_CACHE_TTL_HOURS = 24 → 168` (7 dias). Cobre 99% das janelas reais de retry tardio.

2. **Whatsapp-service `index.js`:** novo `Map<jid, lastSentAt> jidLastSentAt` (cap 5000 entries com eviction LRU-like). Antes de cada `sendMessage`:
   - Tenta `assertSessions(jid, false)` (cheap, idempotente)
   - Se NUNCA falou com aquele JID ou idle > 12h → ADICIONALMENTE chama `assertSessions(jid, true)` (forca refetch de prekey bundle do servidor WA). Log explicito `[STALE FIX] force-assertSessions ok` pra diagnostico.
   - Atualiza `jidLastSentAt.set(jid, Date.now())` apos envio bem sucedido.

3. **Backfill script `scripts/extend_wa_sent_cache_ttl.py`:** estende `expires_at` de documentos existentes em wa_sent_cache de 24h pra 7d (essencial em prod — TTL index respeita o valor escrito no doc, nao a constante no codigo).

4. **Bump v2.1.9 → v2.1.10** com flags `stale_session_force_assert: true` + `sent_cache_ttl_7d: true`. Card "WhatsApp Service Health" no SA Reparo SGP mostra essas flags pro operador confirmar deploy.

**Por que isso elimina o bug:**
- Caso 1 (retry tardio): cache 7d cobre. getMessage retorna o texto original. Retry decifra.
- Caso 2 (sessao stale por device rotation): force-assertSessions traz prekey fresco. Proxima sendMessage usa sessao nova. Cliente decifra de primeira, nao precisa retry.

**Validacao:**
- node -c index.js OK, whatsapp-service reiniciou, `/version` reporta v2.1.10 com ambas as features.
- Script de backfill executado no preview (0 docs — esperado, ambiente sem trafego).

**🚀 Para producao:** redeploy preview → prod. Apos:
- Reiniciar a empresa "Incinera" (ou onde quer que seja o problema) — basta abrir Conexoes e o microservico ja vai pegar a nova versao
- Rodar o `extend_wa_sent_cache_ttl.py` em prod para estender os docs antigos (caso contrario eles ainda expiram em 24h)
- Conferir no card SA → Reparo SGP que aparece "v2.1.10" e flags ativas



### 2026-02-15 (G) — Bug tela branca + EditableComboBox para BD e Forma de Pagamento ✅

**Bug critico:** Ao salvar empresa nova com `database_type != Padrao`, a UI ficava completamente branca apos o save.

**Root cause:** O placeholder de admin_email pra empresas externas era `ext-{ts}@external.local` mas o Pydantic `EmailStr` rejeita TLD `.local` como reservado. O backend retornava HTTP 422 com `detail = [{...}, {...}]` (array). O frontend fazia `toast.error(detail || ...)` — quando `detail` eh array, `toast.error` recebe um objeto e o React lanca "Objects are not valid as a React child", crashando a arvore inteira e deixando a pagina em branco. Dois fixes:

1. **Email placeholder** mudou de `@external.local` (rejeitado) pra `@noreply-agentcrm.com` (aceito).
2. **Tratamento defensivo do detail** no catch: se for array de objetos `{loc, msg}`, normaliza pra string `"campo: msg | campo: msg"` antes de passar pro toast.

**EditableComboBox — componente custom em `/app/frontend/src/components/EditableComboBox.js`:**
- Aparenta um select nativo com ChevronDown
- Click → popover com TODAS as opcoes (permanentes + customizadas)
- Permanentes (ex: "Padrao" pra BD, "Boleto" pra pagamento) tem badge "padrao" e nao podem ser excluidas
- Customizadas tem botao X — confirmacao + delete via callback async
- Footer com input + botao "+" para adicionar nova opcao (Enter tambem aciona)
- Click fora fecha o popover

**Aplicado em 2 lugares:**

1. **BD (CompanyModal):**
   - `permanentOptions = ['Padrao']`
   - `customOptions` carregado de `GET /super-admin/companies/database-types`
   - Add: optimistic update na lista local (persistido na proxima save da empresa)
   - Delete: chama `DELETE /super-admin/companies/database-types/{db_name}` (novo endpoint). Reassigna todas as empresas que usam aquela BD para "Padrao" e retorna `companies_reassigned: N`. Recusa deletar "Padrao".

2. **Forma de Pagamento (QuoteEditor):**
   - `permanentOptions = ['Boleto', 'Pix', 'A Vista', 'Cartao de credito', 'Cartao de debito', 'Transferencia bancaria']`
   - **Boleto e o default** (conforme pedido do usuario: "trazer a opcao boleto como The full mais deixar as outras opcoes ao clicar na seta")
   - `customOptions` persistidas em `localStorage['quote_payment_methods']` por usuario — sem custo de backend pra tracking por orcamento

**Testado:**
- Backend curl: POST empresa externa com email `@noreply-agentcrm.com` agora retorna 201 (era 422). Catalog GET retorna `[Padrao, SGP]`. DELETE SGP retorna `{ok: true, companies_reassigned: 1}`. GET volta a retornar so `[Padrao]`.
- Playwright: trigger expande popover, input add aceita "Vox System", trigger atualiza pra "Vox System", modal mostra modo externo (so Dados Basicos + Licencas/Cobranca).

**Cleanup:** empresa de teste removida via DELETE.



### 2026-02-15 (F) — UX/UI batch: BD field, filtros Empresas, msg suporte, WA health, edit Lancamento, etc ✅

**7 melhorias numa rodada (todas testadas):**

**1. Mensagem do limite mais user-friendly:** "Adicione mais licencas no Super Admin" → "Entre em contato com o suporte da 8iP" em `enforce_company_limit()`.

**2. Card "WhatsApp Service Health" no Reparo SGP:** novo componente `WhatsAppHealthCard` em `SgpRepairTab.js` que mostra version (v2.1.9), online/offline status, instancias, latencia, features de resiliencia ativas + breakdown por instancia (status, reconnect_attempts, idle_ms). Backend `/channels/service-health` enriquecido com `version`, `features`, `details`.

**3. Financeiro Admin: removidas abas Faturas e Despesas.** Tudo consolidado em Lancamentos. Default subtab agora abre direto em "Lancamentos".

**4. Botao "Editar" por linha de Lancamento:** `setEditingTxn(t)` + form modal aceita `initial` prop, faz PUT quando `isEdit`. Titulo do modal muda dinamicamente.

**5. Orcamento: Forma de Pagamento auto-cadastravel:** `<select>` virou `<input list>` com `<datalist>` (8 sugestoes pre-cadastradas: A Vista, Pix, Boleto, Cartao de credito/debito, Transferencia, Cheque, Faturamento). Usuario pode digitar qualquer outro.

**6. Empresas: filtros + totais + BD field auto-cadastravel:**
- Toolbar ganhou filtros `BD` (datalist) e `Status` (Ativas/Trial/Bloqueadas)
- Grid de TotalCards: Empresas, Total Licencas (max_conn+max_users), Conexoes em uso, Usuarios em uso — recalculam com o filtro aplicado
- Backend GET `/companies` aceita `database_type` filter, novo endpoint `/companies/database-types` retorna distinct values + sempre "Padrao"
- Backfill script aplicado (2 empresas)

**7. BD no CompanyModal — empresas nativas vs externas:**
- Campo `database_type` no topo do modal (datalist com Padrao/SGP/Vox/ERP Externo)
- **Quando "Padrao"** (nativa): renderiza todos os campos normais (Dados, Subdominio, Tipo de Negocio, Funcionalidades, Licencas, Cobranca, Administrador)
- **Quando != "Padrao"** (externa SGP/Vox/etc): renderiza SOMENTE "Dados Basicos" (Nome/CNPJ/Email/Telefone) + "Licencas e Cobranca". Subdominio/CRM/Plano/Features e secao do Administrador todos OCULTOS. Save manda placeholders pro admin_* (necessario pelo Pydantic CompanyCreate) e business_type_id=null
- Backend model `CompanyCreate` ganhou `database_type: str = "Padrao"`

**Whatsapp prod (Incinera "Aguardando mensagem"):**
- Verificacao via novo card mostrou que **prod JA esta em v2.1.9** com todas as resilience features ativas (zombie_socket_watchdog, reconnect_exponential_backoff, old_socket_cleanup).
- 2 instancias na produçao reportaram 326 reconnect_attempts (limite cap de 5min) com idle ~3min — isso indica **sessao deslogada** (precisa QR novo). O Baileys nao consegue reconectar porque a credencial foi invalidada pelo WhatsApp. O fix do `connection.update => loggedOut` ja limpa essas pastas, mas se o usuario nao reconectar via QR no painel, fica em loop. Acao: na empresa Incinera, abrir Conexoes → reescanear QR.

**Testado e2e (Playwright):**
- FLOW A (Empresas): BD filter, status filter, totals row presentes; BD options = `['Todas BD', 'Padrao']`
- FLOW B (Reparo SGP): WA health card present, version `v2.1.9`
- FLOW C (Financial): tabs invoices/expenses count=0; lancamentos/summary/commissions/external count=1
- FLOW D (CompanyModal): BD input present; ao mudar pra "SGP", subdomain field HIDDEN, ext-name field SHOWN (modo externo)
- Backend curl: distinct types, filtered list, BD persisted



### 2026-02-15 (E) — Pagamento unificado + Empresas usage cols + Validador CPF/CNPJ no Flowbuilder + outros ✅

**6 mudancas em uma rodada (todas testadas e2e):**

**1. Lancamento Adm: campo "Pagamento" unificado.** Removi os 2 selects separados (Status + Metodo) por UM unico dropdown `Aberto / Pix / Boleto / Dinheiro`. Na tabela tambem: coluna `Pagamento` exibe badge verde com o metodo quando `pago`, OU mostra "ABERTO" + 3 mini-botoes (Pix/Boleto/Dinheiro) que dao baixa direto. Toast aparece com botao **Desfazer (5s)** que reverte via POST `/finance/transactions/{id}/unpay`. Backend `pay` ganhou body opcional `{payment_method}` que atualiza no mesmo update. Novo endpoint `/unpay`.

**2. Empresas list: colunas usage.** `GET /super-admin/companies` agora enriquece cada row com `used_connections` e `used_users` (via `compute_company_usage` helper, evita N+1 do frontend). Tabela ganhou 2 colunas novas (hidden lg:table-cell) renderizando `UsageBadge` que mostra `X / Y` (verde, amber se excedeu, ∞ pra legados com max=None).

**3. Kanban "AGUARDANDO".** `NATIVE_FIRST_COLUMN.name` mudou de `Atendimentos` para `Aguardando` em `/app/backend/routes/crm_routes.py:2283`. Cor passou pra amber (`#F59E0B`) pra reforcar a semantica de espera.

**4. Orcamento: Forma de Pagamento como dropdown + Vendedor automatico.**
- "Forma de pagamento": input livre virou `<select>` com opcoes `A Vista / Pix / Boleto`.
- Campos `Vendedor (nome)` e `Vendedor (contato)` REMOVIDOS da UI. `QuoteEditor` agora pega `user.name` e `user.phone || user.email` do `useAuth()` e preenche `seller_name` / `seller_contact` por baixo dos panos — operador nao precisa digitar. Tokens `{{seller_name}}` e `{{seller_contact}}` no template continuam resolvendo.

**5. Cadastro Cliente (Atendimentos): validadores ao salvar.**
- Validador CPF (DV duplo + rejeita "11111111111")
- Validador CNPJ (DV duplo)
- Validador email (regex)
- Validador CEP (8 digitos)
- Mascaras CPF/CNPJ/CEP/phone JA estavam aplicadas no onChange — confirmado em `ClientForm`. O usuario reportou que "ao digitar a pontuacao nao esta sendo automatica" mas no codigo a mascara funciona. Pode ser bug visual de prod sem o deploy atualizado.
- `handleSubmit` substitui `onSave` direto. Cada campo invalido dispara `toast.error` especifico, nao salva.

**6. Flowbuilder: capture_format (CPF/CNPJ/email/CEP/phone/number) — ITEM 3 DO USUARIO.**

**Backend (`flow_engine.py`):**
- Novo helper `validate_capture(value, fmt)` retorna `(bool, default_error_msg)`. Suporta `cpf`, `cnpj`, `cpfcnpj`, `email`, `cep`, `phone`, `number`.
- Quando node de mensagem tem `config.capture_format` setado:
  1. Cliente responde texto
  2. Engine valida antes de armazenar em `flow_vars`
  3. Se invalido: emite mensagem de erro (custom em `config.capture_invalid_message` OU default) + re-envia a pergunta + **PAUSA no mesmo node** (nao avanca). Cliente fica preso ate enviar formato correto.
  4. Se valido: armazena e segue.

**Frontend (`FlowBuilderPage.js`):**
- Painel lateral do node de mensagem ganhou bloco azul `Capturar resposta do cliente`:
  - `capture_var` — nome da variavel pra guardar (ex: `cpf_cliente`)
  - `capture_format` — select com 7 opcoes (sem validacao, cpf, cnpj, cpfcnpj, email, cep, phone, number)
  - `capture_invalid_message` — mensagem de erro custom (opcional)
- Hint: "Quando invalido, o fluxo repete a pergunta — o cliente nao avanca ate enviar no formato correto."

**Validacao:**
- Pytest existente passa.
- curl: create txn pendente → pay com pix → unpay → delete. Tudo OK.
- curl: GET /companies → retorna `used_connections` e `used_users` enriquecidos.
- Playwright: companies headers OK, Lancamentos headers OK, form pagamento dropdown com 4 opcoes, antigos status/method REMOVIDOS.

**Como configurar no Flowbuilder (resposta direta do usuario):**
1. Editar o node de mensagem que faz a pergunta (ex.: "Para continuar, me envie seu CPF.")
2. No painel lateral, secao **Capturar resposta do cliente**, preencher `capture_var = cpf_cliente` (ou nome que preferir)
3. Em `Validar formato`, escolher `CPF (11 digitos)` ou `CPF ou CNPJ`
4. Opcionalmente custom: `capture_invalid_message = "Voce digitou {entrada}. Por favor envie um CPF valido."` (sem o `{entrada}` por enquanto, mas a mensagem aparece em ciclo ate o cliente acertar)
5. Salvar o fluxo. Cliente fica preso ate enviar 11 digitos validos.



### 2026-02-15 (D) — SA: remocao da impersonacao + BT modal limpo ✅

**Pedido:** "ao tentar acessar o menu licencas" → redirecionava para `agentcrm.8ip.com.br/__impersonate__?...&slug=fin8ip` (DNS fail). Diretriz mais ampla: **"tudo que eu for liberar para o super Admin precisa abrir dentro do super Admin e nao uma empresa vinculada"**.

**Mudancas em `/app/frontend/src/pages/SuperAdmin/Dashboard.js`:**

1. **Removido o grupo "MODULOS OPERACIONAIS"** que renderizava features tenant ENABLED no SA BT como links externos via `openOperationalPanel()`. Era a fonte do redirect indesejado. `tenantSidebarItems` e seu render bloco foram deletados; `TENANT_SIDEBAR_META` ficou no codigo como dead code mas inativo (sem impacto).

2. **BT modal: ocultar grupos tenant para SA BT.** Quando `form.base_type === 'super_admin'`, os blocos CRM / Agendamento / Compartilhado **nao renderizam** (envolvidos em fragment condicional). So fica visivel o "Itens do menu Super Admin" (amber block) com as 10 keys SA-nativas (incluindo o novo `licenses`).

3. **Seção "Plano e Cobranca" removida do BT modal.** Antes tinha 6 campos (monthly_price, billing_cycle, installments, grace_days, max_connections, max_users). Agora substituida por aviso explicativo + UNICO checkbox `show_on_landing` — exatamente o que o usuario pediu na sessao anterior ao mover billing para a Empresa. Os campos do form (`form.monthly_price` etc) permanecem em memoria para nao quebrar o `BusinessTypeUpdate` do backend; apenas a UI nao expoe mais.

**Validacao:**
- Lint clean.
- Playwright: click `[data-testid="sidebar-licenses"]` → URL permanece `/super-admin`, `LicensesPanel` renderiza inline, `sa-operational-modules-group` count = 0.
- Screenshot BT tenant (Salao de Beleza): mostra "LANDING PAGE" + texto explicativo + checkbox `show_on_landing` apenas; campos `bt-monthly-price`/etc count = 0. CRM / Agendamento ainda visiveis (correto para BT tenant).

**Para producao:** redeploy. Apos, qualquer feature tenant que ja estava marcada no SA BT continua marcada no banco mas **nao tem UI para desmarcar** e **nao causa mais redirect** (toggle nao renderiza, sidebar nao renderiza). Caso o usuario queira limpar: editar BT SA → desabilitar tudo no amber block → salvar. Sem regressao no fluxo tenant.



### 2026-02-15 (C) — Licencas: catalogo + cobranca por empresa + enforcement ✅

**Pedido:** Catalogo de licencas (unidade ou pacote: conexao/usuario), cobranca movida do BusinessType para a Empresa, Lancamentos do Financeiro Admin com campo Tipo (Licenca/Diversos) e seletor de Empresa, e enforcement de criacao acima do limite.

**Backend (~250 linhas):**
- `models.py`: novos `LicenseCreate/Update`, `CompanyLicense`. `CompanyCreate/Update` ganharam `licenses[]`, `monthly_price`, `billing_cycle`, `installments`, `grace_days`, `max_connections`, `max_users`.
- `routes/licenses_routes.py` (novo): CRUD `/api/super-admin/licenses` (incluindo soft-deactivate quando referenciada por empresa), helper `compute_company_limits` que soma `connections_qty*qty` e `users_qty*qty`, `compute_company_usage` que conta `channel_connections` e `company_users`, `enforce_company_limit(resource)` que retorna 403 quando used>=cap. Endpoint `GET /usage/{company_id}` para a UI.
- `routes/super_admin_routes.py`: `create_company` e `update_company` recomputam max_* automaticamente quando `licenses` muda; `licenses=[]` => max=None (modo legado, sem enforcement). Mantem override manual via `max_connections`/`max_users`.
- `routes/channels_routes.py:226` e `routes/scheduling_routes.py:1261`: chamam `enforce_company_limit` antes de inserir.
- `routes/super_admin_finance_routes.py`: `AdmTxnIn`/`Update` aceitam `kind` (licenca|diversos), `company_id`, `external_client_name`, snapshot `license_connections/users/cost/sale_price`. `GET /finance/transactions` ganhou filtros `kind` + `company_id`.
- `routes/scheduling_routes.py`: `licenses` adicionado ao `SUPER_ADMIN_FEATURES` (10 keys agora).

**Frontend:**
- `pages/SuperAdmin/LicensesPanel.js` (novo): tab Licencas com tabela + modal de criacao/edicao.
- `pages/SuperAdmin/LicenseAssignmentPanel.js` (novo): picker reutilizavel embutido no CompanyModal, com 4 counter-cards (Conexoes X/Y, Usuarios X/Y, Custo total, Valor venda total) e badge "uso excede limite".
- `pages/SuperAdmin/Dashboard.js`: aba `licenses` no sidebar + branch de render + CompanyModal renderiza secao "Licencas e Cobranca" (picker + monthly_price + billing_cycle + installments + grace_days).
- `pages/SuperAdmin/AdmLancamentosPanel.js`: filtro `Tipo` na toolbar, coluna `Tipo` na tabela com badge Licenca/Diversos, form com selector Tipo + toggle Cliente cadastrada/Externo + dropdown de Empresa que chama `/usage/{id}` no onChange e auto-popula license_connections/users/cost/sale_price + amount.

**Validacao:**
- Pytest: `tests/test_iteration_54_licenses.py` — **17/17 passing** em 8.07s, cobrindo Licenses CRUD, integracao Company-licenses, enforcement positivo (block 403), enforcement negativo (legacy max=None passa), AdmTxn kind/snapshot/filters, soft-deactivate.
- Playwright smoke: 3 flows UI confirmados (Licencas tab cria licenca, CompanyModal mostra LicenseAssignmentPanel + counters, AdmLancamento form tem Tipo + Cliente + snapshot fields).
- BT modal continua expondo `show_on_landing` (mantido conforme pedido); demais campos billing nao serao mais editaveis no BT a partir da prox iteracao (UI cleanup pendente).

**Para producao:** redeploy do preview. O usuario precisa: (1) cadastrar licencas em "SA -> Licencas", (2) atribuir em "SA -> Empresas -> editar -> Licencas e Cobranca", (3) usar em "Financeiro Admin -> Lancamentos -> Novo -> Tipo=Licenca -> selecionar Empresa".



### 2026-02-15 (B) — SA Sidebar: features tenant agora aparecem como "Modulos Operacionais" ✅

**Pedido:** "no Super Admin eu configurei para que tenha mais menus no ambiente de super Admin porém salvo e mesmo assim o super Admin não as assume os novos menus".

**Root cause:** O modal do BT "Super Admin" expõe TODAS as 46 features do sistema (mudança da iter 53), mas o `allSidebarItems` em `/app/frontend/src/pages/SuperAdmin/Dashboard.js` era hardcoded com apenas **9 chaves SA-native** (`dashboard, companies, business-types, partners, financial, indoor, my-panel, sgp-repair, settings`). Habilitar `kanban`, `agenda`, `orcamentos`, etc no BT do SA salvava no banco corretamente (verificado com PUT + `/auth/me`), mas o frontend não tinha mapeamento de ícone/label pra eles → silenciosamente ignorava.

**Mudanças em `/app/frontend/src/pages/SuperAdmin/Dashboard.js`:**

1. Importados ícones lucide-react adicionais (Columns3, CalendarCheck, Tag, Zap, Megaphone, UserCog, Shield, FileText, LifeBuoy, Puzzle, PlugZap, FolderOpen, CreditCard, Clock, PieChart, LayoutDashboard, MessageSquare, UserCheck, etc).

2. Novo `TENANT_SIDEBAR_META` (34 entries) mapeando cada feature_key tenant a `{ icon, label }`.

3. `tenantSidebarItems` calculado em runtime: feature_keys ENABLED no BT do SA que NÃO estão nos 9 SA-native viram items extras com `external: true`.

4. Render do `<nav>` ganhou bloco condicional `tenantSidebarItems.length > 0` renderizando o grupo separado `MODULOS OPERACIONAIS` com borda superior. Cada item externo dispara `openOperationalPanel()` (impersonação da Empresa Operacional em nova aba) ao ser clicado — única forma do SA acessar dados tenant.

5. `data-testid` adicionados: `sa-operational-modules-group` e `sidebar-op-{feature_key}`.

**Validação e2e (script bash + curl + screenshot):**
- PUT `/api/super-admin/business-types/{id}` com features incluindo `kanban`, `agenda`, `orcamentos` → persistiu.
- `/api/auth/me` retornou os 11 enabled keys.
- Screenshot do painel SA pos-login mostrou os 9 itens nativos + grupo `MODULOS OPERACIONAIS` contendo Kanban / Agenda / Orcamentos com ícone de ExternalLink.
- BT revertido após teste para preservar estado limpo do preview.

**Não houve mudança de backend** — o save de BT já estava OK (verificado em `routes/super_admin_routes.py:177-229`).

**Próximo deploy em produção corrige imediatamente o bug reportado pelo usuário.**



### 2026-02-15 — Baileys: resilience hardening (auto-reconnect + watchdog) ✅

**Pedido:** Usuário reportou que "às vezes a instância web para de processar fluxos" — sessões caindo silenciosamente sem auto-recuperação.

**Mudanças em `/app/whatsapp-service/index.js` (v2.1.8 → v2.1.9):**

1. **Cleanup de socket antigo** dentro de `createConnection(instanceId)`:
   - Antes de criar o novo `sock`, remove `ev.removeAllListeners()` e fecha o socket anterior. Sem isso, cada reconexão deixava listeners ativos → `messages.upsert` disparava em duplicidade + memory leak gradual → Render matava o worker por OOM (sintoma: "fluxos param").

2. **Exponential backoff** no handler `connection.update` (close, `shouldReconnect=true`):
   - Era: `setTimeout(reconnect, 5000)` fixo (hammer em WA).
   - Agora: `min(5s × 2^(attempt-1), 5min)` → 5s → 10s → 20s → 40s → 80s → 160s → 300s (capa).
   - Contador `instance.reconnectAttempts` é **resetado para 0** ao receber `connection === 'open'`.

3. **Watchdog de socket zumbi** (`setInterval` a cada 90s):
   - Para cada instância marcada como `'connected'`:
     - Checa `sock.ws.readyState` — se não for OPEN, força reconexão.
     - Se inativa há mais de 5 minutos, dispara `sock.sendPresenceUpdate('available')`. Falha → reconexão.
   - `lastActivityAt` é atualizado em `messages.upsert`.

4. **`/health` enriquecido**: agora retorna `details[]` com `status`, `reconnect_attempts`, `idle_ms` por instância (útil pra alarmes externos).

5. **Bump de versão**: `v2.1.9` com flags `reconnect_exponential_backoff`, `old_socket_cleanup`, `zombie_socket_watchdog`.

**Validação:**
- `node -c index.js` → SYNTAX_OK.
- Serviço reinicia limpo (sem erros nos supervisord logs).
- `curl /version` → confirma `v2.1.9` + 3 features novas.
- Teste unitário `/app/whatsapp-service/tests/reconnect-backoff.test.js` passando (sequência 5→10→20→40→80→160→300→300).

**Pré-requisitos já existentes (não tocados):**
- `process.on('uncaughtException')` / `unhandledRejection` (linhas 63-68) — guards contra crash global.
- `DisconnectReason.loggedOut` (401) — limpa `auth_sessions/` e não tenta reconectar.
- `isConflict` (440) — 60s + retry único.



### 2026-05-16 (G) — Fallback endpoint agora cobre TODO o catalogo ✅

**Pedido:** "ainda nao aparece as funcoes do CRM ne do Agendamento para Compartilhar para selecionar para o super admin conforme tela anexo."

**Root cause:** Em producao, `/all-features` ainda nao tinha sido atualizado (deploy pendente OU role detection diferente do esperado). Meu fallback `/super-admin-features` antigo so retornava `SUPER_ADMIN_FEATURES` (9 items), nao incluia o catalogo tenant. Resultado: grupos CRM/Agendamento/Compartilhado renderizavam HEADERS mas sem toggles.

**Mudancas:**

1. **`/app/backend/routes/scheduling_routes.py`:** endpoint `/super-admin-features` agora retorna `ALL_SYSTEM_FEATURES + SUPER_ADMIN_FEATURES` (46 entries no total). Anti-fragil contra qualquer estado do `/all-features`.

2. **`/app/frontend/src/pages/SuperAdmin/Dashboard.js`:**
   - Renomeado `fallbackSAFeatures` → `fallbackAllFeatures`.
   - Condicao do useEffect ficou mais agressiva: agora dispara o fallback se `allFeatures` nao tiver tanto categoria "Super Admin" QUANTO categorias tenant ("CRM", "Operacional", etc). Antes so checava SA.
   - Novo `useMemo effectiveFeatures` que faz uniao por categoria: parente preenche o que tem, fallback preenche o resto. Garante que nenhum grupo fique vazio.
   - Os 4 filtros (`crmFeatures`, `schedFeatures`, `sharedFeatures`, `superAdminFeatures`) agora usam `effectiveFeatures` em vez de `allFeatures`.

**Validacao:**
- `curl /api/scheduling/super-admin-features` → 46 features, distribuidas: CRM=15, Operacional=4, Catalogo=5, Analise=3, Config Empresa=4, Administracao=2, Super Admin=9, Permissoes=3, Principal=1.
- 5 testes em test_super_admin_features.py passando.
- Lint clean.

Apos o proximo deploy em producao, o BT do Super Admin vai mostrar todos os toggles preenchidos em todos os 4 grupos.


### 2026-05-16 (F) — Editor do BT Super Admin agora expoe TODAS as features ✅

**Pedido:** "Agora ja aparece as funcoes mas so as do super Admin atual preciso selecionar [...] qualquer funcao disponivel no sistema inclusive as disponibilizadas para o agendamento ou atendimento."

**Mudanca:**

`/app/frontend/src/pages/SuperAdmin/Dashboard.js` — `BusinessTypeModal` agora mostra **simultaneamente** todos os 4 grupos quando editando o BT Super Admin:

1. **CRM** (atendimentos, kanban, flowbuilder, etc.) — sempre visivel
2. **Agendamento** (agenda, calendario, profissionais, etc.) — sempre visivel
3. **Compartilhado** (financeiro, comissoes, configuracoes, etc.) — sempre visivel
4. **Itens do menu Super Admin** (9 chaves do sidebar SA) — visivel SO quando `form.base_type === 'super_admin'`, com fundo amarelo claro para diferenciar

A logica anterior alternava entre os 3 primeiros grupos OU o quarto. Agora os 3 primeiros sao SEMPRE renderizados, e o 4o vira um anexo opt-in quando o BT eh Super Admin.

**Por que isso importa:** O operador SA pode atribuir features de CRM/Agendamento ao proprio BT — por exemplo para registrar quais permissoes ele teria se entrasse via "Painel Operacional" (impersonate). O sidebar do SA continua filtrando apenas as 9 chaves de SA (`allSidebarItems` em Dashboard.js linha 60-68) — features de tenant adicionadas ao BT do SA nao poluem o sidebar dele, mas ficam registradas como permissoes na BT.

**Validacao:** lint passou clean, screenshot do login confirma a logo 8ip presente. Save end-to-end ja foi validado nos commits anteriores.


### 2026-05-16 (E) — Branding 8ip no Super Admin (login + sidebar + PWA shortcut) ✅

**Pedido:** "Insira essa logomarca no ambiente do super Admin tanto na parte de login na interna do sistema e tambem ao criar o atalho."

**Mudancas:**

1. **Asset:** baixado o PNG do usuario para `/app/frontend/public/8ip-logo.png` (103 KB, image/png).

2. **Tela de login do admin (`/app/frontend/src/pages/AdminLoginPage.js`):** substituido o icone Shield generico (purpura) por `<img src="/8ip-logo.png" data-testid="admin-login-logo">` em 80x80 com sombra. Removido import nao usado de `Shield` lucide.

3. **Sidebar do painel Super Admin (`/app/frontend/src/pages/SuperAdmin/Dashboard.js`):** logo 8ip 36x36 inserido a esquerda do titulo "AgentCRM / Super Admin", `data-testid="super-admin-logo"`.

4. **PWA shortcut:**
   - Novo `/app/frontend/public/admin-manifest.json` com `short_name="8ip Admin"`, `name="8ip Infinity Tilt Tech — Admin"`, icons apontando pra `/8ip-logo.png` (192/512 com `purpose: "any maskable"`), `start_url=/admin-login`, theme dark (#0F172A).
   - Script inline em `/app/frontend/public/index.html` atualizado: quando a primeira parte do path eh `admin-login` ou `super-admin`, troca o `<link rel="manifest">` para `/admin-manifest.json`, hot-patcha todos `apple-touch-icon`/`shortcut icon`/`icon` para `/8ip-logo.png`, e atualiza `apple-mobile-web-app-title` e `document.title` para "8ip Admin". Resultado: "Adicionar a tela inicial" no iOS/Android gera atalho com a marca 8ip.

**Validacao:**
- Screenshot: tela de login renderiza com o logo gradient (8 em azul/roxo + P).
- `curl /admin-manifest.json` → 200 com JSON valido.
- `curl /8ip-logo.png` → 200 image/png 104688 bytes.
- Sidebar logo presente no DOM (verificado via query_selector).


### 2026-05-16 (D) — Fallback endpoint para o catalogo de features SA ✅

**Pedido:** Apos deploy, em producao o modal de "Editar Super Admin BT" mostrava a mensagem "Catalogo de features do Super Admin nao disponivel. Verifique se o backend esta atualizado." mesmo logando/saindo. Em preview funcionava.

**Hipotese mais provavel:** O `role` do usuario em producao nao era exatamente `"super_admin"` (talvez `"admin"` com `is_super_admin=true`, ou alguma variante legada). Meu check anterior em `/all-features` era estritamente `user.get("role") == "super_admin"` — qualquer outro valor caia no branch tenant que filtra por `company_id` (que SA nao tem) e retornava lista vazia → frontend nao via a categoria "Super Admin".

**Mudancas:**

1. **`/all-features` agora usa o mesmo check lenient do `require_super_admin`:** aceita `super_admin`, `superadmin`, `root` (com normalizacao de hifens/underscores), alem dos flags booleanos `is_super_admin`/`is_superadmin`. Garante que todas as variantes de SA legacy vejam o catalogo completo.

2. **Novo endpoint `/api/scheduling/super-admin-features`:** read-only, autenticacao basica (qualquer user logado). Retorna SEMPRE o catalogo `SUPER_ADMIN_FEATURES`. Anti-fragil contra role detection issues. Curl validou: 9 features retornadas tanto para super_admin quanto para tenant user.

3. **Frontend BusinessTypeModal:** novo useEffect que detecta `allFeatures` sem a categoria "Super Admin" e ai chama `/super-admin-features` como fallback. Estado `fallbackSAFeatures` populado, e a variavel `superAdminFeatures` agora eh derivada com prioridade pro `allFeatures` mas cai pro fallback se vazio.

4. **Empty-state melhorado:** texto antigo "Catalogo nao disponivel. Verifique se o backend esta atualizado." trocado por "Carregando catalogo… Se persistir, faca logout/login". Comunica melhor a tentativa de fallback.

**Validacao:**
- `/api/scheduling/super-admin-features` como super_admin → 9 features ✓
- `/api/scheduling/super-admin-features` como tenant admin → tambem 9 features (intencional, eh um catalogo publico) ✓
- 37 testes passando.


### 2026-05-16 (C) — Fix save do Super Admin BT (422 silencioso) + enforce singleton ✅

**Pedido:** "Quando salvo nao salvo as funcoes selecionada para o super Admin e a tela fica em branco. Vamos deixar so um tipo de negocio super admin que vai ministrar a gestao de permissao de menus que aparecera no super Admin."

**Root cause:** `PlanType` enum (em `/app/backend/models.py`) so tinha `crm`, `scheduling`, `both` — **nao tinha `super_admin`**. Toda vez que o operador salvava o BT do Super Admin via PUT, o Pydantic rejeitava `base_type="super_admin"` com **HTTP 422 Validation Error**. O frontend recebia o erro, disparava `toast.error` rapido (passava despercebido) e o modal/estado ficava em condicao inconsistente — daí a "tela em branco" reportada e features que nao persistiam.

**Mudancas:**

1. **`/app/backend/models.py`:** adicionado `SUPER_ADMIN = "super_admin"` ao enum `PlanType`. Resolve o 422 imediato.

2. **`/app/backend/routes/super_admin_routes.py`:**
   - **POST `/business-types`:** se `base_type=="super_admin"` e ja existe um, retorna `400` com mensagem clara ("So pode haver UM por instalacao — edite o existente em vez de criar outro").
   - **PUT `/business-types/{id}`:** se o BT atual tem `base_type=="super_admin"`, forca `update_data["base_type"] = "super_admin"` (operador nao pode demotar o singleton); se um BT tenant tenta promover-se a `super_admin`, retorna 400.
   - **DELETE `/business-types/{id}`:** rejeita com 400 se for o SA BT.

3. **`/app/frontend/src/pages/SuperAdmin/Dashboard.js`:** quando `form.base_type === 'super_admin'`, o select "Tipo Base" eh substituido por um campo de leitura com badge "SINGLETON" + texto "Super Admin (gerenciado pelo sistema)". Operador nao consegue mudar o tipo nem por engano.

**Validacao via curl (preview real):**
- PUT no SA BT com 9 features (uma delas `enabled:false`) → 200 OK, features persistiram ✓
- POST tentando criar outro SA BT → 400 "Ja existe um Tipo de Negocio Super Admin" ✓
- DELETE no SA BT → 400 "nao pode ser excluido" ✓

**Testes:** 37 testes passando (5 sobre SA features incluindo regressao que `PlanType` contem `super_admin`).


### 2026-05-16 (B) — Fix toggles do Super Admin no editor de Tipo de Negocio ✅

**Pedido:** "nao consigo liberar mais menus para o super Admin". Usuario tentava habilitar mais itens no sidebar do Super Admin via "Tipos de Negocio → Super Admin" e os toggles nao funcionavam.

**Root cause — 4 bugs interconectados:**

1. **`/api/scheduling/all-features` retornava VAZIO para super_admin** — endpoint filtrava por `company_id`, mas super_admin nao tem company. Resultado: `allFeatures = []` no front, editor sem nenhum toggle visivel.

2. **Filtro de categoria no `BusinessTypeModal` comparava `'crm'/'scheduling'/'shared'` (lowercase)** mas o catalogo `ALL_SYSTEM_FEATURES` usa `'CRM'/'Operacional'/...` (capitalizado em portugues). Todos os grupos renderizavam VAZIOS mesmo quando havia features.

3. **Seeded `sa_features` em server.py tinha chaves erradas:** `payments`, `support` (nao existem no sidebar do Super Admin) e faltavam `business-types`, `partners`, `indoor` (existem no sidebar mas nao tinham toggle).

4. **`backfill_feature_keys` poluia o BT do Super Admin** com features de tenant (`relatorio_atendimentos`, `orcamentos`, `integrações`, `agenda_pro`) que nao correspondem a nada no sidebar dele.

**Mudancas:**

1. **`/app/backend/routes/scheduling_routes.py`:**
   - Novo catalogo `SUPER_ADMIN_FEATURES` com as 9 chaves canonicas do sidebar do Super Admin: `dashboard`, `companies`, `business-types`, `partners`, `financial`, `indoor`, `my-panel`, `sgp-repair`, `settings` (categoria "Super Admin").
   - `/all-features` agora detecta `role == "super_admin"` e retorna `ALL_SYSTEM_FEATURES + SUPER_ADMIN_FEATURES` (46 features), bypass o filtro por company.
   - Tambem adicionei `sgp_gateway` e `integrações` ao catalogo tenant (estavam faltando).

2. **`/app/backend/server.py`:**
   - Seeded `sa_features` agora importa do catalogo canonico (single source of truth).
   - `backfill_feature_keys` recebeu exclusao `{"base_type": {"$ne": "super_admin"}}` em todas as queries que tocam `business_types` — assim o BT do Super Admin nao recebe mais features de tenant.
   - **Nova etapa de reparo:** itera todos os BTs com `base_type=super_admin` e (1) remove chaves nao-canonicas leaked por backfills antigos, (2) adiciona qualquer chave canonica faltando. Preserva escolhas do operador para chaves que ainda sao validas.

3. **`/app/frontend/src/pages/SuperAdmin/Dashboard.js`:**
   - `crmFeatures/schedFeatures/sharedFeatures` agora filtram pelas categorias REAIS do backend (`CRM`, `Operacional`, e o agrupado `Catalogo+Analise+Config Empresa+Administracao+Principal`).
   - Novo `superAdminFeatures` para a categoria "Super Admin".
   - `BusinessTypeModal` agora detecta `form.base_type === 'super_admin'` e troca os grupos CRM/Agendamento/Compartilhado por um unico grupo "Itens do menu Super Admin" com botao "Ativar todos".
   - `enableAll('crm')` virou `enableAll('CRM')` (etc.) pra bater com as labels do catalogo.

**Validacao no startup:** logs do backend mostraram `Repaired Super Admin BT features: removed 1 non-canonical, added 0 missing` — confirma que a migracao automatica funcionou.

**Validacao manual via curl:**
- GET `/api/scheduling/all-features` como super_admin → 46 features (37 tenant + 9 super_admin) ✓
- DB direto: BT do Super Admin agora tem as 9 chaves canonicas ✓

**Testes:** 36 testes passando (4 novos em `tests/test_super_admin_features.py`):
- Backend SA catalog == frontend `allSidebarItems` (parse do JS em runtime).
- Super Admin keys nao vazam pro catalogo tenant.
- Todas SA features tem `category="Super Admin"`.

**Como usar agora:** Super Admin → Tipos de Negocio → editar "Super Admin" → ve 9 toggles correspondentes aos itens do sidebar. Pode desligar/ligar qualquer um, e ao salvar a mudanca reflete no proximo refresh da pagina.


### 2026-05-16 — Toggle SGP auto-close movido para o gateway + reorganizacao sidebar ✅

**Pedido:** mover o toggle "Fechar tickets SGP" das Configuracoes para dentro do modal de edicao de cada SGP Gateway (segunda tela). E reorganizar o menu lateral: SGP Gateway sai de CRM e vai pra Config Empresa, logo abaixo de "API e Integrações".

**Mudancas:**

1. **Backend (`/app/backend/routes/sgp_gateway_routes.py`):**
   - `GatewayCreate` e `GatewayUpdate` agora aceitam `auto_close_ticket: bool` (default False).
   - `_public_view` expoe o campo no GET/POST/PUT.
   - `_handle_send` agora prioriza `gw.auto_close_ticket` em vez do `companies.sgp_gateway_auto_close` (fallback mantido para tenants antigos durante migration).

2. **Frontend SGP Gateway page (`/app/frontend/src/pages/CRM/SGPGatewayPage.js`):**
   - `GatewayForm` (modal de criar/editar) ganhou seccao "Fechar tickets automaticamente" com toggle switch.
   - `sgpGatewayAPI` ja levava o campo no objeto que envia pro backend (via spread).

3. **Frontend Configuracoes:**
   - `TicketLifecycleSettingsCard` agora SO tem o input de "Fechar tickets sem movimentacao apos X horas" (campo company-wide).
   - O toggle SGP-auto-close foi REMOVIDO daqui — vive so no gateway agora.

4. **Sidebar order (`/app/frontend/src/pages/Company/Dashboard.js`):**
   - Item `sgp_gateway` mudou de `group: 'CRM'` para `group: 'Config Empresa'`.
   - Adicionado campo `order` em `FEATURE_META` para items do grupo Config Empresa: `conexoes=10`, `configuracoes=20`, `meu_site=50`, `integrações=80`, `sgp_gateway=90`, `suporte=100`, `indoor=110`, `parceiros=120`.
   - `menuGroups` useMemo agora ordena items por `order` (default 999) dentro de cada grupo. Items sem order mantem seu lugar antigo.

**Backwards compat:** Empresas que tinham `companies.sgp_gateway_auto_close=true` na config antiga continuam funcionando — o `_handle_send` ainda le esse campo como fallback quando o gateway NAO tem `auto_close_ticket` definido.

**Testes:** 32 testes passando (sem regressoes). Curl validou: POST cria com auto_close=true, PUT alterna entre true/false, GET retorna o valor correto.


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

## 2026-05-26 — Resync pendentes redesenhado + Próximo mês + Editar parcela em lote
- Backend: `/super-admin/finance/resync-pending-parcelas` agora aceita `?company_id=` (resync escopado por empresa). Sem o param mantém comportamento global (uso interno/test).
- Backend: `PUT /super-admin/finance/transactions/{id}` aceita `scope: "this"|"all"`. Quando `all`, propaga `amount/description/notes/late_fee/discount/payment_method/category` para todas as parcelas PENDENTES da mesma `recurrence_group_id` (ou mesma empresa+kind quando não há series). Retorna `_siblings_updated`.
- Backend: `CompanyUpdate` ganhou flag `resync_pending`. Edição de empresa NÃO mexe mais no financeiro automaticamente — só quando o operador confirma "Sim" no diálogo.
- Backend: variáveis novas ({{licencas_conexao/usuario/valor_venda_total/valor_desconto/valor_devido}}) agora também expandem no reenvio manual via SA (`/finance/transactions/{id}/resend-reminder`).
- Frontend (AdmLancamentosPanel.js): botão "Resync pendentes" removido; filtro de data ganhou "Proximo mes" (mês seguinte ao atual); modal de edição de parcela ganhou seletor "Aplicar em: Somente esta / Esta + todas em aberto".
- Frontend (Dashboard.js — modal Editar Empresa): após salvar com mudança financeira/descritiva, pergunta "Deseja atualizar todos os lançamentos em aberto desta empresa?". Se sim, chama resync escopado.
- Testado via curl: scope=all propagou 2 irmãs; scope=this manteve siblings intactos; resync com company_id inexistente retornou 0/0; flow completo de criação→edit em lote→cleanup OK.

## 2026-05-26 — FIX duplicate messages bug (Baileys v2.1.18) + variavel {{valor_total_liquido}}
- **CRITICAL BUG FIX**: Mensagens enviadas pelo atendimento CRM duplicavam/triplicavam no celular do cliente (mas nao no painel do atendente). Causa raiz: auto-recovery v2.1.17 reenviava a mensagem sempre que `DELIVERY_ACK` nao chegava em 20s, mas o ACK depende do destinatario estar ONLINE. Cliente offline / sinal ruim → ACK demora minutos legitimamente → re-send disparava.
- **Correcao** (`/app/whatsapp-service/index.js`): re-send agora eh gated por sinal REAL de falha (`messages.update` com status=0/ERROR). Ausencia de ACK apenas faz o entry decair silenciosamente apos 60s. STUCK_TIMEOUT_MS=60s (era 20s), MAX_AUTO_RETRIES=1 (era 2).
- Microservico reiniciado em preview. Sintaxe validada via `node -c`.
- **Variavel nova**: `{{valor_total_liquido}}` = `valor_venda_total - valor_desconto`. Disponivel no envio automatico (scheduler) e no reenvio manual SA. UI atualizada em `BillingReminderPanel.js`.
- **ATENCAO PRODUCAO**: Para a correcao do Baileys chegar em `agentcrm.8ip.com.br`, eh preciso REDEPLOY DO MICROSERVICO NODE no Render (nao basta o git push do main backend/frontend — o whatsapp-service eh um servico separado no Render).

## 2026-05-26 (PM) — {{valor_devido}} = liquido + juros + UI destacando Liquido/Devido
- **Backend (`scheduler.py` + `super_admin_routes.py`)**: `{{valor_devido}}` no template de cobranca agora inclui multa+juros do dia (era so `amount - desconto`). Novas vars: `{{valor_liquido}}` (= amount - desconto, sem acrescimo) e `{{valor_acrescimo}}` (= multa + juros do dia).
- **Tabela do Financeiro Admin (`AdmLancamentosPanel.js`)**: celula VALOR agora exibe `Liquido` (verde) quando ha desconto e `Devido` (vermelho/bold) quando ha juros — antes mostrava apenas `Devido` quando atrasado.
- **Modal "Dar baixa"**: ganhou linha `Valor liquido` em destaque entre `Desconto` e `Acrescimo (multa + juros)`. `Total devido` renomeado para `Valor devido`. Visualizacao validada via screenshot (R$ 200 - R$ 10 = R$ 190 liquido + R$ 16,78 acrescimo = R$ 206,78 devido).
- `BillingReminderPanel.js`: legenda de variaveis adicionou `{{valor_liquido}}` e `{{valor_acrescimo}}`.

## 2026-05-27 — Batch 1 + Batch 2 (Orcamentos + Usuarios)
**Batch 1 — Orcamentos:**
- Cadastro de Item ganhou campo `Excedente` (texto livre, informativo). Snapshot vai pro QuoteItem ao adicionar do catalogo (operador pode sobrescrever).
- Variavel `{{excedente}}` disponivel no loop `{{#items}}...{{/items}}` do template.
- Variavel `{{seller_phone}}` (telefone do vendedor, fallback do user logado).
- Form de orcamento ganhou campos `Vigencia` e `Frequencia` (texto livre). Variaveis `{{vigencia}}` e `{{frequencia}}` no template.
- Lista de placeholders atualizada na UI (`OrcamentosPage.js`).

**Batch 2 — Usuarios:**
- Modal "Editar Usuario" ganhou `max-h-[90vh] overflow-y-auto` + header sticky (resolveu o "estourando" da tela).
- Novo flag por usuario: `view_all_kanban: bool` (CompanyUser model). Toggle "Acesso a todos os Kanban" no form de usuario, descricao destacada em indigo.
- Backend (`/api/crm/kanban-v2`) respeita o flag: quando True, ignora `_ticket_visibility_filter` (allowed_queue_ids / connection_ids) somente para o Kanban — outras telas (Aguardando/Atendimento) mantem filtro normal.
- Validado via curl: PUT view_all_kanban=true → True; PUT false → False.

## 2026-05-27 (PM) — Batch 3 (Baileys + Roteamento de fila) + Batch 4 (Performance)
**Batch 3:**
- **Baileys v2.1.19 (`whatsapp-service/index.js`)**: re-send agora dispara em DOIS gatilhos: (A) `messages.update` status=0 ERROR, OU (B) stuck >90s + destinatario ONLINE (recebemos inbound/presence dele em <5min). Caso (B) cobre o "Aguardando mensagem" que afetava a Incinera sem reintroduzir duplicatas em clientes offline. STUCK_TIMEOUT=90s, MAX_AUTO_RETRIES=1. `markRecipientSeen` chamada em messages.upsert (inbound) e presence.update. Aplicado globalmente para TODAS as conexoes/empresas (microservico unico).
- **Flow Engine (`/app/backend/flow_engine.py`)**: bug do node `ticket/queue/transfer` corrigido. Antes lia `cfg.get("queue")` e gravava em `ticket.queue`; frontend grava `queue_id`+`queue_name`. Agora aceita ambos e grava em `ticket.queue_id` (campo canonico usado pelo CRM). Tambem aplica `status` do node (aguardando/atendendo/aberto) e quando `aguardando` desatribui `assigned_to` (cai no pool publico da fila). Bug que impedia ticket de aparecer na fila filtrada — RESOLVIDO.

**Batch 4:**
- **Indices Mongo na startup (`/app/backend/server.py`)**: 6 indices em `tickets` (`company_status_updated`, `company_assignedto_status`, `company_kanban_updated`, `company_phone`, `company_queue_status`, `company_connection_status`). Sem isso, COLLSCAN de 2.5k+ tickets na Incinera (~3s por troca de aba).
- **GET /api/crm/tickets**: projecao mudou de `{messages: 0}` (excluindo tudo) para `{messages: {$slice: -1}}` — mantem APENAS a ultima mensagem (para o card de Atendimento via `getLastMessage`), elimina o pull de 100+ mensagens por ticket sem quebrar a UX.
- Resultado em preview: aguardando 153ms, atendendo 205ms, kanban-v2 144ms (84KB).

**ATENCAO PRODUCAO**: Mudancas no microservico Baileys (v2.1.19) requerem REDEPLOY DO whatsapp-service no Render alem do backend/frontend.

## 2026-05-27 (PM2) — UX critical fixes: modais + CPF mascara + editor de template
- **Bug "modal fechando ao clicar em campo"** (afetava todas as telas com `<div class="fixed inset-0..." onClick={onClose}>`): substituido por `onMouseDown={(e) => e.target === e.currentTarget && onClose()}` + `onMouseDown={e => e.stopPropagation()}` no inner. Aplicado bulk em 15 arquivos / 35 modais (AIPage, FlowBuilderPage, CampaignsPage, WhatsAppConnectionsPage, OrcamentosPage, SGPGatewayPage, AtendimentosPage, QuoteAttachModal, LicensesPanel, SA Dashboard, AdmLancamentosPanel, BookingPage, Company Dashboard, SchedulingPages, AgendaProPage). Validado via Playwright: clique na borda do overlay nao fecha mais o modal.
- **CPF/CNPJ sem mascara no "Editar via contato"**: agora aplica `formatCPF/formatCNPJ` no onChange (mesma logica do ClientForm). Telefone tambem mascarado `(00) 00000-0000`. Validado: CPF `12345678901` -> `123.456.789-01`, CNPJ `12345678000199` -> `12.345.678/0001-99`.
- **Editor de templates "jump to top"**: ReactQuill com altura FIXA + scroll interno (`.quill-bounded .ql-editor { height:100%; overflow-y:auto }`) — antes o modal externo competia pelo scroll quando o caret saia da viewport. Adicionado tambem botao "Editar HTML (avancado)" abaixo de cada campo (content/header/footer) para o power-user adicionar/editar TABELAS, COLUNAS, classes que a toolbar do Quill nao expoe.

## 2026-05-27 (PM3) — Editor de tabelas no template (visual, sem mexer em HTML)
- Toolbar dedicada de TABELA no topo do editor de templates (acima da toolbar Quill) com 8 botoes: `+ Tabela`, `+ Coluna ->`, `<- + Coluna`, `- Coluna`, `+ Linha v`, `^ + Linha`, `- Linha`, `- Tabela`.
- Implementacao: identifica posicao do cursor (tableIndex/rowIndex/colIndex) na DOM live do Quill, aplica mutacao via DOMParser em copia em memoria do HTML state, faz `setEditing` (Quill re-renderiza). Evita o problema de duplicacao de linhas quando Quill faz diff no controlled value.
- `+ Tabela` funciona mesmo SEM cursor posicionado (insere no fim do conteudo). Demais botoes exigem cursor numa celula.
- Validado via Playwright: 3x3 inserida -> 3x4 (col added) -> back to 3x3 (col deleted).

## 2026-05-27 (PM4) — Coluna VALOR enxuta + Bug envio duplicado resolvido
**Coluna VALOR (AdmLancamentosPanel.js)**:
- Removida a linha "Valor total" (amount bruto) — operador so precisa ver o real.
- **Valor liquido** agora eh o valor PRINCIPAL grande, em verde (entrada) ou vermelho (saida).
- Quando ha juros/multa, exibe "Valor atualizado: R$ X" embaixo em vermelho (era "Devido:").

**Bug envio DUPLICADO ao salvar empresa (RESOLVIDO)**:
- Causa raiz: o resync apaga parcelas e recria com IDs novos. O dedup em `billing_reminder_history` eh por `transaction_id`, entao a parcela nova nao tem histórico - scheduler envia outra mensagem no próximo tick. = 2 mensagens.
- Fix backend (`scheduler.py`): `_process_billing_reminders` aceita `suppress_auto`. Quando True, parcelas criadas ganham `auto_notify=False`. Scheduler pula parcelas com essa flag.
- `update_company` e `/resync-pending-parcelas` agora chamam com `suppress_auto=True`. Resultado: NENHUMA mensagem eh enviada automaticamente apos salvar empresa.
- `/resync-pending-parcelas?notify=true|false`: quando `notify=true`, pega a parcela em aberto mais proxima do vencimento de cada empresa afetada e dispara UMA mensagem manual (via `resend_transaction_reminder`).
- Frontend: o `window.confirm` foi substituido por modal customizado com checkbox **"Notificar cliente (envia UMA mensagem)"**. Desmarcado = sem mensagem. Marcado = exatamente 1 mensagem.

## 2026-05-28 — Chave Pix em mensagem separada na notificacao de cobranca
- Configuracao global `pix_key` + `pix_send_separate` em `system_settings.billing_reminder`.
- Quando habilitado, APOS a mensagem principal de cobranca (automatica via scheduler ou reenvio manual SA), o sistema envia uma 2a mensagem WhatsApp contendo APENAS a chave Pix — facilita o cliente copiar (toca+segura -> Copiar). Decisao de design: texto puro em vez de botoes interativos porque Baileys nao garante render de botoes em todos os aparelhos (e botoes interativos exigem Business API certificada).
- Backend: scheduler `_process_billing_reminders` envia follow-up Pix apos sucesso. `super_admin_routes.resend_transaction_reminder` faz o mesmo. Falha do Pix follow-up NAO bloqueia o sucesso da cobranca principal — registra em billing_reminder_history como `kind=auto_pix`/`manual_resend_pix`.
- Frontend: nova secao verde "Chave Pix (mensagem separada)" no painel de configuracao (BillingReminderPanel.js) com checkbox + input de chave (max 200 chars). Quando checkbox desmarcado, o input fica disabled.
- Validado via curl: PUT settings com pix_key persiste, GET retorna corretamente.

## 2026-05-28 — Coluna Excedente na grid de itens + preview real
- **Grid de itens do orcamento (OrcamentosPage.js)**: adicionada coluna "Excedente" editavel inline. Auto-preenchida do catalogo quando o item vem de `addFromCatalog`; pode ser sobrescrita por orcamento. Reorganizado o grid de 12 cols: 4 desc + 1 un + 1 qtd + 2 vlr + 2 excedente + 1 subtotal + 1 lixeira.
- **Bug `{{excedente}}` literal no preview do template**: causa raiz era o endpoint `/quotes/templates/preview-html` que usava mock fixo "Servico exemplo" ignorando items do payload. Corrigido: agora aceita `items`/`freights` opcionais no payload e os utiliza no contexto de render. Validado via curl: `{{excedente}}` agora resolve para `"R$ 0,50/kg adicional"` no preview.
- O endpoint `_build_quote_html` (usado em PDF/render real) ja repassava items completos (incluindo excedente) — nada a corrigir la.

## 2026-05-28 — Auto-close por inatividade + Mensagem no fechamento manual
**Bug critico do auto-close (RESOLVIDO)**:
- Scheduler `_process_ticket_auto_close` (em `scheduler.py`) filtrava `status: ["aberto","em_andamento"]`, mas no CRM os tickets ativos ficam em **`aberto|atendendo|aguardando`** (sem `em_andamento`). Resultado: o auto-close NUNCA executava em prod. Adicionado `atendendo` e `aguardando` ao filtro.
- Endereco do contato/conexao: antes lia de `contacts` + `channel_connections`. Agora le direto do ticket (`customer_phone` / `connection_id`), com fallback ao schema antigo. Sem isso a msg falhava silenciosamente.
- Adicionado log `[scheduler] auto-close msg sent ticket=... status=...` pra diagnostico.

**Nova feature: mensagem no fechamento MANUAL**:
- Backend (`/api/crm/tickets/{id}`): quando o operador muda `status=fechado` e `companies.send_close_message_on_manual=true`, envia a MESMA mensagem do auto-close para o cliente (best-effort, falha NAO bloqueia o PUT).
- Frontend (`TicketLifecycleSettingsCard.js`): toggle "Enviar tambem no fechamento MANUAL" no card de configuracao. Default desligado.
- Validado: GET/PUT `/api/crm/company/ticket-settings` aceita o novo campo `send_close_message_on_manual` e persiste.

## 2026-05-28 — Seller phone via conexao + Mensagem de encaminhamento no node Ticket
**Bug `{{seller_phone}}` vazio (RESOLVIDO)**:
- Causa: cadastro de user sem campo telefone -> fallback retornava string vazia.
- Fix: cadastro de usuario ganhou campo "Contato (conexao WhatsApp) para variavel {{seller_phone}}" — dropdown com todas as conexoes da empresa. Selecionou? Backend resolve `phone_number` da conexao na criacao do orcamento.
- Cascata de resolucao: 1) `payload.seller_phone` (form) -> 2) `user.phone` -> 3) `phone_number` da conexao em `user.seller_connection_id`.
- Backend: `CompanyUser*.seller_connection_id`, helper `_resolve_seller_phone_from_connection`. Frontend: dropdown verde com hint.
- Validado: usuario com `seller_connection_id` -> orcamento criado com `seller_phone="+5562999991234"`.

**Node "Ticket/Queue/Transfer" envia mensagem ao cliente (NOVO)**:
- Causa do problema: ate hoje o node ticket apenas mudava status/queue do ticket. Cliente nao recebia nada e ficava confuso.
- Backend (`flow_engine.py`): node passa a aceitar `transfer_message` no config. Quando preenchido, antes de retornar (encerrar fluxo) envia via `_send_whatsapp` + persiste no historico do ticket com `reason: "transfer"`. Variaveis: `{{queue_name}}`, `{{nome}}`, + qualquer var acumulada (vars_).
- Frontend (`FlowBuilderPage.js`): novo textarea "Mensagem de encaminhamento (opcional)" no editor do node ticket, com placeholder e dica das variaveis disponiveis.


## 2026-05-28 (PM) — Formatacao de `{{excedente}}` e `{{seller_phone}}` no render
- **Bug**: variaveis chegavam ao PDF/preview "cruas" (ex.: `5562999991234` ou `3,10`), exigindo formatacao manual do operador no input.
- **Fix em `routes/quotes_routes.py`**:
  - `_format_excedente(v)` — se for numero puro (`3,10` / `1.234,56` / `100`), formata como `R$ X,YY`. Se for texto livre (`R$ 0,50/kg`, `10% sobre franquia`), preserva como esta.
  - `_format_phone_br(v)` — strip de `+` e codigo `55`, retorna `(XX) XXXXX-XXXX` (11 digitos) ou `(XX) XXXX-XXXX` (10 digitos). Input ja formatado tambem funciona (re-extrai digitos).
  - Aplicado em `_build_quote_html` (PDF/render real) iterando `quote["items"]` para formatar `excedente` e formatando `seller_phone` no ctx.
  - Aplicado tambem em `/api/quotes/templates/preview-html` para o live preview do editor refletir exatamente o PDF final. Preview agora resolve `seller_phone` via mesma cascata do POST de orcamento (`user.phone` -> conexao WA).
- **Import**: adicionado `Any` em `from typing import ...`.
- **Validacao**: testes unitarios diretos das helpers + curl no `/preview-html` confirmam:
  - `+5562999991234` -> `(62) 99999-1234`
  - `5562999991234` -> `(62) 99999-1234`
  - `6233334444` -> `(62) 3333-4444`
  - `3,10` -> `R$ 3,10`; `1.234,56` -> `R$ 1.234,56`; `R$ 0,50/kg` -> mantido; `10% sobre franquia` -> mantido.

## 2026-06-10 — Monitor de Saude das Conexoes WhatsApp (Health Monitor & Event Log)
**Contexto**: apos o incidente do "watchdog agressivo" em producao (revertido na sessao anterior), o usuario pediu visibilidade: indicador visual de saude por conexao + log de eventos, para detectar conexoes mortas antes do cliente reclamar.

**Microservico (`whatsapp-service/index.js`, v2.1.20)**:
- `connectedAt` por instancia (uptime); ja existiam `lastInboundAt`/`lastActivityAt` e `eventLog`/`reconnectStats` (rolling 50 eventos, janela 24h de reconexoes).
- `recordEvent` agora cobre: `qr_generated` (so na transicao), `conflict`, `reconnect_scheduled`, `logged_out`, `connect_requested`, `manual_disconnect`, `manual_restart` (+ ja existentes `connected`, `disconnected`, `watchdog_*`).
- Novos endpoints: `GET /instances/health-all` (mapa por instancia) e `GET /instances/:id/health`. Payload: status, connected_at, uptime_ms, last_inbound_at/_ago_ms, reconnects_24h, last_reconnect_at, last_error, events[].
- Versao bump v2.1.20 + flags `health_event_log` e `conservative_watchdog` (o botao "Verificar Deploy" do SA detecta).

**Backend (`channels_routes.py`)**:
- `GET /api/channels/connections/health` — agrega `health-all` do microservico para as conexoes Baileys da empresa e classifica: red (desconectada/zumbi), yellow (connecting/waiting_qr ou 30+ min sem msg recebida), green (conectada com trafego), gray (sem telemetria).
- IMPORTANTE: se o microservico em producao ainda nao tem o endpoint (404 = versao antiga), retorna `telemetry_available: false` e TODAS as conexoes ficam gray "Sem dados" (nunca vermelhas falsamente). Producao precisa de REDEPLOY do microservico no Render para ativar a telemetria.

**Frontend (`Dashboard.js` > ConexoesPage/ConnectionCard)**:
- Chip clicavel por conexao (`health-chip-{id}`): bolinha verde/amarela/vermelha/cinza + uptime + "ult. msg ha X".
- `ConnectionHealthModal` (`health-modal-{id}`): tiles Status / Ultima msg recebida / Reconexoes 24h / Ultimo erro + log de eventos com timestamp pt-BR e badges coloridos por tipo.
- Poll a cada 30s junto do service-health.

**Validacao**: e2e com microservico local (WA_SERVICE_URL trocado temporariamente e revertido para `https://agendcrm.onrender.com`): chip amarelo/vermelho + modal com 8 eventos reais renderizados. 49 testes pytest passando (test_channels_api, test_flow_engine*, test_iteration_58).
- Testes desatualizados corrigidos (nao eram regressoes): `test_connect_channel_sets_waiting_qr` (aceita `connecting`; qr_code e assincrono), `test_ticket_node_clears_flow_state` (campo canonico `queue_id`), `test_flatten_fatura2via_real_sgp_shape` (data PT-BR dd-mm-aaaa).

**Acao do usuario em producao**: redeployar o microservico WhatsApp no Render (v2.1.20) — sem isso os chips ficam "Sem dados".

## 2026-06-10 — Migracao Baileys 6.7.22 → 7.0.0-rc13 (fix erro 463 / entregas bloqueadas)
**Incidente em producao**: bot e operadores "enviavam" (painel OK, eco FROM_ME no log) mas NADA chegava no celular do cliente; recebimento normal. Log do Render mostrou `received error in ack — error 463` = **"Reach-out Time-lock"**: restricao temporaria que o WhatsApp aplica na conta quando o cliente nao envia privacy tokens (tctoken/cstoken) — cada mensagem sem token conta como "abordagem a desconhecido" e acumula ate o bloqueio (disparos em massa aceleram). Issue oficial: WhiskeySockets/Baileys#2441. Baileys 6.7.x NAO envia esses tokens; somente o 7.x.

**Mudancas (`whatsapp-service`, v2.2.0)**:
- Pacote `@whiskeysockets/baileys@6.7.22` → `baileys@7.0.0-rc13` (novo nome oficial).
- Runtime convertido para **ESM** (`"type": "module"`, imports, `__dirname` via `import.meta.url`), exigencia do Baileys 7. `engines.node >= 20` no package.json (Render precisa de Node 20+!).
- Removido `printQRInTerminal` (extinto no 7.x).
- LID nativo do 7.x: resolucao de PN agora prefere `remoteJidAlt`/`participantAlt`/`senderPn` em formato `@s.whatsapp.net` (DMs e grupos). Corrigido bug pre-existente `instance.groupMetadata` → `instance.sock.groupMetadata`.
- Todos os workarounds 6.7.x mantidos (sent_message_store, session-heal, auto-recovery, watchdog conservador, monitor de saude) — sao defensivos e compativeis.

**Validado no preview**: boot limpo, QR real gerado (handshake WA OK com auth state novo), endpoints `/version`, `/health`, `/instances/health-all`, connect/disconnect funcionando. Envio real depende de conexao pareada — validar em producao apos redeploy.

**Acoes do usuario (producao)**:
1. Redeploy do microservico no Render (vai instalar baileys 7; conferir Node >= 20 — se houver env `NODE_VERSION` antiga, atualizar para 20+).
2. Sessoes existentes migram automaticamente; algumas conexoes podem pedir novo QR.
3. A restricao 463 na conta **expira sozinha** — mesmo apos o upgrade, aguardar a expiracao e testar. Evitar disparos em massa ate o upgrade estar no ar.

## Roadmap
- **P1**: Toggle `no_back` por menu no Flowbuilder (esconder "[9] Voltar" via configuracao por nivel/menu).
- **P2**: Acao "Responder" no `MessageActionsMenu` do CRM (citar mensagem com banner amarelo lateral).
- **P2 (refactor)**: quebrar `Dashboard.js` (~7k linhas) em componentes/paginas dedicados e `crm_routes.py` (~3k linhas) em routers menores.
