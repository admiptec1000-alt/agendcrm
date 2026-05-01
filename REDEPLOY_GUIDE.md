# Guia de Redeploy — 2026-05-01 v3 (PDF td-as-header + Baileys upgrade)

## Status atual da producao (verificado agora)

| Item | Producao agora | Esperado | Status |
|------|----------------|----------|--------|
| Backend (FastAPI) | Ja deployed com endpoint probe-lid + resolve-lid | OK | ✅ Deployed |
| Backend CSS PDF | LOOK ANTIGO ainda | DEVE estar com look novo | ⚠️ Cache ou BUG do CSS — fix v3 nesta release |
| Microservico (Render) | **v2.1.3** | v2.1.5 (Baileys upgrade + probes extras) | ❌ NAO DEPLOYED |

## Por que o PDF ainda parecia antigo

O template `.docx` da Incinera **NAO usa `<th>` (tag de header)** — ele coloca os titulos das colunas na PRIMEIRA `<tr>` usando `<td>` com `<strong><em>`. Meu CSS antigo so estilizava `<th>`, portanto o estilo "azul-marinho moderno" nao era aplicado.

**Fix nesta release (v3)**: nova regra CSS que estiliza tambem `table > tbody > tr:first-child > td` (a primeira linha de qualquer tabela) com fundo brand-blue + texto branco uppercase + bordas modernas, **mesmo quando o template nao usa `<th>`**. Validado com diag PDF.

## Por que o @lid continua "estourando" mesmo apos minha v2.1.4

A v2.1.4 NAO foi deployed ainda — o microservico ainda esta em **v2.1.3**. Mas mesmo depois de deployed, **Baileys 6.7.16 tem um bug conhecido** com LIDs de novos contatos: `senderPn` chega vazio na primeira mensagem.

**Fix nesta release (v2.1.5)**:
1. **Upgrade Baileys 6.7.16 -> 6.7.21** (5 patches a frente, todos com fixes de LID e session reliability — release notes oficiais [whiskeysockets/Baileys releases](https://github.com/WhiskeySockets/Baileys/releases))
2. **Estrategias adicionais no `tryResolveLid`**:
   - `sock.profilePictureUrl(lidJid)` — toca no contato e forca um roster sync no servidor
   - `sock.fetchStatus(lidJid)` — mesma coisa, side effect resolve o roster
   - `sock.getBusinessProfile(lidJid)` — para contas Business, retorna o JID real verificado
   - **Re-check do signalRepository.lidMapping APOS as 3 sondas acima** — frequentemente o cache foi populado pelos side effects
3. **Tudo isso roda automaticamente**:
   - Na primeira mensagem com @lid
   - No background-retry a cada 30s
   - Quando o operador clica "Tentar agora" na UI

Quando QUALQUER uma dessas estrategias resolve o numero, dispara `/api/channels/webhook/lid-resolved` e o ticket eh **auto-mesclado** no ticket real (ou promovido in-place).

## ORDEM DE DEPLOY

### 1. Backend (mandatorio para o PDF moderno aparecer)
```bash
git push  # ou via "Save to Github"
```
Render auto-deploy. Verifique em pos-deploy:
- Login na Incinera, gere um orcamento, baixe PDF
- Cabecalhos das tabelas (Item / Descricao / Unid / Valor) DEVEM estar com **fundo azul escuro e texto branco uppercase**

### 2. Microservico (mandatorio para o @lid auto-resolver)
```bash
cd whatsapp-service
git push
# Render auto-deploy
```
Verifique:
- `GET https://agendcrm.onrender.com/version` → `"version": "v2.1.5"`
- Features esperadas: `lid_baileys_upgrade_6_7_21: true`, `lid_extra_probes_business_status: true`, `lid_double_signal_lookup: true`

### ⚠️ ATENCAO — Risco do upgrade Baileys

Upgrade 6.7.16 → 6.7.21 eh **patch level** (mesma major+minor). API externa identica, sem breaking changes. **NAO** quebra conexoes existentes — o disco persistente (`AUTH_DIR`) sera lido normalmente.

Se ainda assim o @lid persistir apos v2.1.5 com 3 contatos novos diferentes, **a unica solucao restante eh upgrade pra Baileys 7.0.0-rc.9** que tem "Full LID Support" oficial. Eh release candidate, com breaking changes — exige autorizacao explicita.

---

## Como funciona o fluxo completo apos v3 deployed

1. Contato novo manda primeira mensagem → microservico tenta 8 estrategias de resolucao em sequencia
2. Se resolver → ticket criado direto com phone real
3. Se NAO resolver → ticket criado com banner amarelo + tag "Numero Oculto"
4. Background-retry ativa a cada 30s ate 15min, repetindo as 8 estrategias
5. UI tem 2 botoes: "Tentar agora" (probe imediato) + "Informar telefone" (manual)
6. Quando QUALQUER estrategia resolve → backend faz auto-merge ou promote do ticket
