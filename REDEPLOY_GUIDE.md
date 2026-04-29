# Redeploy do Microserviço WhatsApp (Render)

## 🔴 PENDENTE — v2.1.2 (fix crítico @lid)

**O que o fix resolve:** quando o cliente responde do WhatsApp Web/Desktop, o Baileys entrega `remoteJid = xxx@lid` (ID interno do dispositivo vinculado). A versão antiga (`v2.1.1` rodando em produção hoje) apenas retira o sufixo `@lid` e gera um "número fantasma" (ex: `250615737372785`). Isso cria um ticket duplicado no CRM e, quando você responde, a mensagem não chega ao cliente porque esse número fantasma não existe no WhatsApp.

**v2.1.2 corrige:**
- Resolução do `@lid` para o número real via `msg.key.senderPn` / `participantPn` / `remoteJidAlt` / `signalRepository.lidMapping.getPNForLID` (fallback em cascata)
- Remoção de uma declaração duplicada de `const phone` que sobrescrevia o `realJid` já resolvido — bug que causava erro de sintaxe + perda do fix no envio do webhook

**Como validar pós-deploy:**
```bash
curl https://agendcrm.onrender.com/version
# Deve retornar:  "version":"v2.1.2"
#                 "features":{...,"lid_senderpn_resolver":true,"phone_shadow_fix":true}
```

---

## Por que redeploy é necessário?

O microserviço Node.js em `/app/whatsapp-service/index.js` foi atualizado com **fixes críticos**:

1. **Cache de mensagens enviadas** (`sentMessageStore`) — corrige bug de mensagens em branco
2. **Suporte a mais tipos de mensagem** — captions de imagem/vídeo/documento, respostas de botões, etc.
3. **Endpoint `GET /instances/:id/contacts`** — para o botão "Importar Contatos"
4. **Webhook `presence.update`** — para indicador "digitando..."
5. **Webhook `messages.update`** — para duplo check azul (mensagem lida)
6. **Conversão `messageTimestamp` Long → Number**
7. **Captura de eventos `notify` E `append`** (não só `notify`)
8. **[v2.1.2] Resolução de @lid (Linked Device JID)** — respostas do WhatsApp Web/Desktop não criam mais ticket fantasma

Sem o redeploy, NENHUM desses fixes funciona em produção.

---

## Passo a Passo (Render Dashboard)

### 1. Push do código atualizado para o repositório
Se você usa "Save to Github" no Emergent, isso já foi feito. Caso contrário:

```bash
cd /app
git add whatsapp-service/index.js
git commit -m "fix(whatsapp): v2.1.2 — @lid resolver + shadow phone const fix"
git push origin main
```

### 2. Acesse o Render Dashboard
- Login em https://dashboard.render.com
- Encontre o serviço Web `agendcrm` (ou nome equivalente do microserviço Node.js)

### 3. Configure as variáveis de ambiente
**CRÍTICO**: Verifique se `FASTAPI_URL` está configurada apontando para o backend público:

| Variável        | Valor (exemplo)                                              |
|-----------------|---------------------------------------------------------------|
| `FASTAPI_URL`   | `https://agentcrm-book.preview.emergentagent.com`             |
| `AUTH_DIR`      | `/var/data/auth_sessions` (caminho do disco persistente)      |
| `PORT`          | `3002` (ou o que o Render fornecer)                           |
| `WA_KEEPALIVE_TARGET` | (mesma URL do FASTAPI_URL)                              |

⚠ Sem `FASTAPI_URL` correta, o microserviço **não consegue enviar webhooks** para o backend (mensagens recebidas, presence, acks ficam todos perdidos).

### 4. Deploy manual
- No serviço, clique em **"Manual Deploy" → "Deploy latest commit"**
- Aguarde 2-3 min até aparecer "Live"
- Veja os logs — deve aparecer:
  ```
  [whatsapp-service] Using AUTH_DIR=/var/data/auth_sessions
  [whatsapp-service] Webhook target FASTAPI_URL=https://agentcrm-book.preview.emergentagent.com
  WhatsApp Baileys Service running on port 3002
  ```

### 5. Reconectar o WhatsApp
Após o redeploy, no painel **Conexões** do CRM:
- Clique em "Sincronizar" — se voltar conectado, ótimo
- Se não, clique em "Desconectar" → "Conectar" → escaneie o QR novamente

### 6. Validação rápida
Após reconectar:
1. Mande uma mensagem do CRM para si mesmo via Atendimento
2. Confira no celular se a mensagem chegou **com texto** (não em branco)
3. Responda do celular — deve aparecer no Atendimento em até 5s
4. Veja se aparece "digitando..." quando você digita do celular
5. Ao ler do celular, o duplo check no CRM deve virar **azul**

---

## Como saber se está funcionando?

```bash
# Health check do microserviço
curl https://SEU-SERVICO.onrender.com/health
# Deve retornar: {"status":"ok"}

# Lista de contatos (se conectado)
curl https://SEU-SERVICO.onrender.com/instances/SEU-INSTANCE-ID/contacts
# Deve retornar: {"contacts":[{phone, name}, ...]}
```

E nos logs do backend FastAPI (Emergent), você verá:
```
[webhook/message] c477e72c phone=5511... mid=WAMID... text='ola'
```

---

## Problemas comuns

### "Mensagens não aparecem no Atendimento"
- 90% das vezes é `FASTAPI_URL` errada → corrija e redeploy
- 5% é firewall do Render → habilite outbound HTTP
- 5% é a sessão WA expirada → desconecte/reconecte e escaneie QR

### "Mensagens enviadas chegam em branco para alguns contatos"
- O `getMessage` ainda está retornando vazio? Confirme que o redeploy aconteceu (Render mostra timestamp do build)

### "Indicador de digitando não aparece"
- A pessoa precisa estar digitando *com a janela aberta no celular*
- E o Baileys precisa estar inscrito naquele contato (acontece automaticamente após enviar primeira mensagem)
