# Guia de Redeploy — Fase 6 (Fix definitivo @lid)

## O QUE FOI CORRIGIDO

### Causa-raiz #1014/#1015
Tickets criados **manualmente** (botao `+`, sem WhatsApp) nao tinham `connection_id`. O fallback que eu fiz na Fase 5 filtrava por `connection_id`, entao nunca achava match. Resultado: cliente respondia via @lid, sistema criava ticket novo.

### O que esta diferente agora

**Backend (FastAPI):**
1. Quando o agente envia mensagem outgoing via chat:
   - `last_outgoing_at` eh registrado
   - Se o ticket nao tinha `connection_id`, eh setado AGORA automaticamente
2. Webhook do WhatsApp ao receber phone formato LID:
   - **Strategy 1 (5 min, GLOBAL na empresa)**: pega o ticket que TEM outgoing recente, **independente de connection_id**. Resolve o caso #1014/#1015.
   - **Strategy 2 (72h, mesma connection)**: fallback por nome.

**Microservico Node.js (Baileys):**
3. `lid_phone_map` persistido em disco. Toda vez que o operador envia mensagem, o LID retornado pelo Baileys eh mapeado para o phone real digitado. Quando chega incoming com @lid, o microservico CONSULTA esse map e converte para o phone real ANTES de enviar pro backend. **Sobrevive a restarts/redeploys**.

## ORDEM DE DEPLOY

### 1. Backend (PRIORITARIO)
Pode usar SOMENTE o backend e o fix ja funciona. Os tickets criados manualmente serao corretamente identificados pelo Strategy 1.

```bash
git push  # ou via "Save to Github" + Render auto-deploy
```

Verificar pos-deploy:
- Logs devem aparecer: `[webhook][lid-fallback:outgoing] LID phone=250615... merged into ticket #N`
- Nenhum ticket novo com phone `250615...` apos resposta de cliente que voce acabou de mandar mensagem

### 2. Microservico (Render)
Recomendado — adiciona o `lid_phone_map` que torna o fix completo MESMO em casos que o backend nao consegue resolver (ex: cliente que escreveu pra voce primeiro, sem outgoing recente).

```bash
# git push do whatsapp-service (commit recente: lid mapping)
```

## TESTE EM PRODUCAO

1. Abra um ticket criado manualmente (sem connection_id) — ex `Teste Suporte`
2. Mande "Oi" pelo chat
3. Peca pra pessoa responder do WhatsApp dela
4. Verifique: a resposta deve aparecer no MESMO ticket (nao criar novo)
5. Se aparecer um novo ticket com phone `250615...`, copie esse phone + dump dos logs do backend e me envie

## LIMPEZA DOS DUPLICADOS JA EXISTENTES

Para mesclar #1014/#1015, #1011/#1012, #1007/#1008:

1. Acesse o ticket DUPLICADO (com phone LID)
2. Clique nos 3 pontinhos (MoreVertical) no header
3. Selecione "Mesclar com outro atendimento"
4. Busque o ticket REAL e clique nele
5. Confirma — mensagens consolidam, duplicado eh deletado
