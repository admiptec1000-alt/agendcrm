# Guia de Redeploy — 2026-05-01 v2 (PDF Moderno + @lid Auto-Resolve)

Esta release fecha as **2 reclamacoes follow-up** apos a release anterior:

| Bug reportado | Sintoma | Status |
|---------------|---------|--------|
| PDF ainda estourava margem A4 + cabecalhos quebravam mid-word ("Descricao d / os Servicos") | layout dated, nao moderno | ✅ CSS reescrito no backend |
| @lid em **NOVO contato** continuava gerando numero estranho | Operador nao tem como digitar manualmente porque NUNCA salvou | ✅ Resolucao proativa no microservico |

---

## 1️⃣ Backend (FastAPI) — DEPLOY OBRIGATORIO

**Mudancas em `quotes_routes.py` `_generate_pdf_bytes`**:
- CSS reescrito com paleta moderna (slate + brand-blue)
- Cabecalhos `<h2>` agora tem **gradiente claro azul + borda lateral** + texto uppercase
- Headers de tabela `<th>` agora sao **fundo azul-marinho com texto branco** (uppercase)
- Word-break corrigido: `word-break: normal; overflow-wrap: anywhere; hyphens: auto` — nao quebra mais no meio das palavras (ex: "Descricao dos Servicos" agora fica numa linha so OU quebra entre "Descricao" e "dos")
- `box-sizing: border-box` + `max-width: 100% !important` em **todos** os elementos: anula widths inline do `.docx` que causavam overflow
- Margem A4 maior: `16mm 14mm`

**Mudancas em `channels_routes.py`**:
- Novo endpoint `POST /api/channels/instances/{instance_id}/probe-lid` — proxy para o microservico tentar resolver um LID sob demanda. Sempre retorna 200 (graceful), mesmo se microservico esta down.

### Como deployar
```bash
# Save to GitHub (preferido)
git add backend/
git commit -m "feat: PDF moderno + probe-lid endpoint"
git push
# Render auto-deploy
```

### Verificacao pos-deploy
1. Login na Incinera, abre **Orcamentos** → gera quote com 2-3 itens + 1 frete → clique "Imprimir / Salvar PDF"
2. PDF deve sair em A4 com:
   - Cabecalhos azul-marinho com texto branco
   - Tabelas DENTRO da margem direita (>=14mm de respiro)
   - Palavras NAO quebradas mid-character
   - Sem placeholders `{{...}}` vazando

---

## 2️⃣ Microservico Node.js Baileys — **DEPLOY MANDATORIO** (resolve o @lid automatico)

Sem este deploy, o sintoma do @lid continua. O backend ja tem o fallback manual ("Informar telefone"), mas o **AUTO-RESOLVE** so funciona com este redeploy.

### Mudancas (`whatsapp-service/index.js` v2.1.4)
1. **`tryResolveLid()` central**: 4 estrategias em cascata (cache persistente, `signalRepository.lidMapping.getPNForLID`, `sock.onWhatsApp` probe, `store.contacts`).
2. **Background sweep a cada 30s**: para cada LID em fila pendente, retenta resolucao. Para apos 30 tentativas (~15min) ou na 1a vez que resolver. Quando resolver, dispara webhook para o backend → ticket auto-promovido/mesclado.
3. **Endpoint `POST /instances/:id/resolve-lid`**: probe sob demanda (UI tem botao "Tentar agora").

### Como deployar
```bash
git add whatsapp-service/
git commit -m "feat: lid auto-resolve com bg retry e probe endpoint v2.1.4"
git push
# Render auto-deploy do servico whatsapp-service
```

### Verificacao
- `GET https://seumicroservico.onrender.com/version` deve retornar `"version": "v2.1.4"` com `lid_active_resolver: true`, `lid_background_retry: true`, `lid_manual_probe_endpoint: true`
- Logs durante uso: `[ID] LID 23173... -> 5562999... (via bg_retry_signal_repository) - backend notified`

---

## 3️⃣ Como funciona agora (UX final)

Quando um contato novo (privacidade ativada) manda 1a mensagem:

1. ⏱️ **Imediato**: ticket criado com banner amarelo "Numero do contato oculto pelo WhatsApp" + tag "Numero Oculto"
2. 🔄 **Em segundo plano**: a cada 30s o microservico tenta resolver o LID. **Quando o WhatsApp finalmente expoe o numero real** (geralmente apos voce mandar 1 mensagem ou apos algumas trocas), o backend recebe webhook e:
   - Se ja existe outro ticket com o numero real → MERGE automatico das mensagens, ticket LID deletado
   - Se nao existe → PROMOTE in-place: customer_phone trocado pra real, tag/flag limpas
3. 🆘 **Fallback manual no banner**: 2 botoes
   - **"Tentar agora"** — forca o probe imediatamente (chama o microservico)
   - **"Informar telefone"** — operador digita o numero (recurso ultimo se o WA nunca expor)

### Limpeza de tickets duplicados antigos
1. Abre o ticket DUPLICADO (com numero estranho)
2. **Mais (3 pontinhos)** → **Mesclar com outro atendimento**
3. Escolhe o ticket REAL → confirma

---

## Resumo de versoes

| Componente | Versao | Mudou? |
|------------|--------|--------|
| Backend FastAPI | (sem versao explicita) | SIM — _generate_pdf_bytes + probe-lid endpoint |
| Microservico Baileys | **v2.1.4** | SIM — auto-resolve do @lid |
| Frontend React | hot-reload | SIM — banner com 2 botoes |

**Apos os 2 deploys**, o usuario nao precisa fazer NADA na app dele — tudo eh automatico.
