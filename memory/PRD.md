# AgentCRM & Booking — PRD

## Original Problem Statement
SaaS multi-tenant para CRM e Agendamento (mobile-first via PWA). Inclui módulos de Flowbuilder, Kanban, Omnichannel WhatsApp via Baileys (microserviço Node.js no Render), TV Indoor, perfis de acesso granulares, agendamentos com confirmação/cancelamento via link, e sistema completo de notificações.

## Architecture
- Backend: FastAPI + MongoDB (motor)
- Frontend: React 19 + Tailwind, PWA dinâmico
- Microserviço: Node.js + Baileys (WhatsApp) com disco persistente no Render (`AUTH_DIR`)
- Scheduler: `/app/backend/scheduler.py` — loop em background a cada 60s para reminders / surveys / bulk messages

## What's been implemented (latest first)

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
