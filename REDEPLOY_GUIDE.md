# Guia de Redeploy — 2026-05-01 v4 (PDF: centro + cabeçalho 1-linha + sem corte)

## 3 fixes nesta release que respondem a sua ultima reclamacao

| Reclamacao | Causa raiz descoberta | Fix |
|------------|----------------------|-----|
| "PROPOSTA DE PRESTACAO DE SERVICO 1031" nao aparecia centralizado | Quill emite `class="ql-align-center"` mas nao bundla a stylesheet — WeasyPrint ignorava | Adicionei CSS explicito `.ql-align-center/right/justify/left` no `_generate_pdf_bytes` |
| Texto sendo cortado mid-character no cabecalho ("ITE M", "DESCRIÇAO DOS SERVIÇO" sem o S, "ESTIMAD A") | Template do Word tem **NBSP (U+00A0)** entre as palavras dos cabecalhos. Com `word-break: normal`, "Descrição\xa0dos\xa0Serviços" virava UMA palavra de 22 chars que `overflow-wrap: anywhere` quebrava em qualquer posicao | Pre-processamento: `html.replace("\u00a0", " ")` antes de passar pra WeasyPrint. Spaces normais quebram corretamente em word boundaries. |
| Cabecalhos da tabela em 2 linhas | `table-layout: fixed` distribuia colunas igualmente, "Descricao" nao cabia em 1 linha | Voltei pra `table-layout: auto` (com NBSP fixado, auto layout cresce "Descricao" e mantem "Item" estreito naturalmente) |
| Margens e tamanho do header | `padding: 7pt 9pt` muito grande + `letter-spacing: 0.03em` apertado | `padding: 5pt 6pt` no header + `font-size: 8.5pt` + `letter-spacing: 0.02em` + `line-height: 1.2` |

Validado: pdfminer extraiu o PDF e nenhuma palavra esta cortada, todos os 6 cabecalhos em 1 linha, titulo centralizado, assinaturas centralizadas no rodape.

## Status v3 anterior (resumo)

- v2.1.5 do microservico: Baileys 6.7.16 → 6.7.21 + 8 estrategias de resolucao (profilePictureUrl/fetchStatus/getBusinessProfile + re-check do signalRepository)
- Ainda nao deployed em producao (microservico em `v2.1.3`)

## Ordem de deploy

### 1. Backend (mandatorio)
```bash
git push  # Save to GitHub
```
**Verificacao**: Login na Incinera, abre orcamento, gera PDF. Cabecalhos azul-marinho EM 1 LINHA, titulo CENTRALIZADO, assinaturas no rodape CENTRALIZADAS.

### 2. Microservico (mandatorio para o @lid auto-resolver)
```bash
cd whatsapp-service
git push
```
**Verificacao**: `GET https://agendcrm.onrender.com/version` deve retornar `"version": "v2.1.5"` com features `lid_baileys_upgrade_6_7_21: true`.

## Plano B se v2.1.5 nao resolver o @lid

A unica opcao restante e upgrade Baileys 7.0.0-rc.9 ("Full LID Support" oficial). Eh release candidate com breaking changes e exige reescaneamento do QR code. **Avise se for necessario** e eu implemento.

Alternativa de longo prazo: migracao para WhatsApp Cloud API oficial (Meta) — protocolo diferente, sempre entrega o numero real, custa $0,005-0,07 por conversa. Posso adicionar como segundo canal mantendo o Baileys como fallback.

## Status atual da producao (verificado agora)

| Item | Producao agora | Esperado | Status |
|------|----------------|----------|--------|
| Backend (FastAPI) | Ja deployed com endpoint probe-lid + resolve-lid | OK | ✅ Deployed |
| Backend CSS PDF | LOOK ANTIGO ainda | DEVE estar com look novo | ⚠️ Cache ou BUG do CSS — fix v3 nesta release |
| Microservico (Render) | **v2.1.3** | v2.1.5 (Baileys upgrade + probes extras) | ❌ NAO DEPLOYED |

## Por que o PDF ainda parecia antigo

O template `.docx` da Incinera **NAO usa `<th>` (tag de header)** — ele coloca os titulos das colunas na PRIMEIRA `<tr>` usando `<td>` com `<strong><em>`. Meu CSS antigo so estilizava `<th>`, portanto o estilo "azul-marinho moderno" nao era aplicado.
