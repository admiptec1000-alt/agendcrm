# Guia de Redeploy — 2026-05-01 (PDF + @lid Novo Contato)

Esta release fecha **dois bugs P0** reportados em producao (Incinera):

| Bug | Sintoma | Status |
|-----|---------|--------|
| PDF de Orcamento estourado / placeholders crus | `{{description}}`, `{{quantity}}`, layout fora do A4 | ✅ Fixado no backend |
| @lid em **NOVO** contato | Cliente novo manda 1a msg → ticket criado com numero `231739574202417` | ✅ Fixado backend + microservico |

---

## 1️⃣ Backend (FastAPI) — DEPLOY OBRIGATORIO

### Mudancas
- **`quotes_routes.py`**:
  - `_auto_wrap_loops` reescrito com BeautifulSoup (parser HTML real)
  - **Strip-and-rewrap**: marcadores `{{#items}}/{{/items}}` mal posicionados (ex: `<p>{{#items}}{{/items}}</p>` antes da tabela) sao IGNORADOS, e os marcadores corretos sao reinjetados ao redor da `<tr>` que contem os placeholders.
  - Funciona out-of-the-box com qualquer `.docx` convertido (incluindo o template atual da Incinera com `<td><p><strong>{{description}}</strong></p></td>`)
  - **Nao precisa mais reconverter templates antigos**.
- **`channels_routes.py`**:
  - Webhook `/api/channels/webhook/message` aceita campo `lid_jid` (microservico envia)
  - Tickets criados com numero oculto agora salvam `lid_jid: "XXX@lid"`, `pending_lid_resolution: true` e tag automatica `"Numero Oculto"`
  - **Novo** `POST /api/channels/webhook/lid-resolved` — chamado pelo microservico quando o numero real e descoberto. Faz auto-merge.
- **`crm_routes.py`**:
  - **Novo** `POST /api/crm/tickets/{id}/resolve-lid` — endpoint manual usado pelo botao "Informar telefone" no banner. Faz a mesma logica de merge.
  - Envio outgoing: se ticket tem `pending_lid_resolution=True`, usa `lid_jid` como destinatario em vez de `customer_phone` (a unica forma do WhatsApp aceitar pra contatos com privacidade).

### Como deployar
```bash
# Save to GitHub (preferido, via UI do Emergent)
# OU manualmente:
git add backend/
git commit -m "fix: PDF auto-wrap robusto + @lid novo contato"
git push
```
Render fara auto-deploy. Apos `Deploy live`:

### Verificacao
1. Faca login na Incinera, abra **Orcamentos** → gere um orcamento com 2 itens + 1 frete → "Imprimir / Salvar PDF" → **deve sair em A4 com itens preenchidos**.
2. Pegue um **contato novo** que nao esta na agenda (peca pra alguem desconhecido mandar Hi pra voce). O ticket vai aparecer com banner amarelo "**Numero do contato oculto pelo WhatsApp**".

---

## 2️⃣ Microservico Node.js (Baileys) — DEPLOY RECOMENDADO

Sem este passo, o backend ainda funciona com o **fallback manual** ("Informar telefone" no banner). Mas com o microservico atualizado, o **auto-resolve** roda quando o Baileys eventualmente expoe o `senderPn` real.

### Mudancas (`whatsapp-service/index.js`)
- Sempre que LID for resolvido (via `senderPn`/`participantPn`/`store`/`map`), envia POST `/api/channels/webhook/lid-resolved` para o backend → ticket com aquele LID e PROMOVIDO ao numero real (ou MESCLADO se ja existir outro ticket pro numero real).
- Webhook outgoing carrega `lid_jid` no payload (preserva o `XXX@lid` original)
- Versao bumped para **v2.1.3** (verifique em `GET /version`)

### Como deployar
```bash
git add whatsapp-service/
git commit -m "feat: lid_jid passthrough + auto-resolve webhook"
git push
# Render auto-deploy do microservico
```

### Verificacao
- `GET https://seumicro.onrender.com/version` deve retornar `"version": "v2.1.3"` e `"lid_resolved_webhook": true`
- Logs do microservico durante uso: deve aparecer `LID resolved via persistent map` ou `LID resolved via baileys_key_field`

---

## 3️⃣ UX do Operador (Banner "Numero Oculto")

Apos os deploys, qualquer ticket criado por contato novo mostra um banner amarelo no header do chat:

```
⚠ Numero do contato oculto pelo WhatsApp
   As respostas chegam via ID interno. Informe o telefone real para
   mesclar e usar normalmente.                        [Informar telefone]
```

Quando o operador clica em **Informar telefone**, abre um prompt → digita `5562994993244` → backend:
1. Atualiza `customer_phone` do ticket
2. Limpa `lid_jid` + `pending_lid_resolution` + tag "Numero Oculto"
3. Se ja existia OUTRO ticket aberto pra aquele numero → faz merge automatico (mensagens unidas, duplicado deletado)

**Mensagens enviadas pelo operador ANTES do resolve** chegam via `@lid` JID (a unica forma do WhatsApp aceitar enquanto a privacidade nao foi quebrada). Funcionam normal.

---

## Limpeza de duplicados antigos (acumulados antes deste deploy)

Para tickets duplicados que ja existem:
1. Abra o ticket com numero estranho
2. **Mais (3 pontinhos)** → **Mesclar com outro atendimento**
3. Escolha o ticket real
4. Confirme — mensagens consolidam, duplicado e deletado
