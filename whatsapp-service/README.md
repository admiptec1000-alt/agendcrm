# WhatsApp Baileys Microservice

Microserviço Node.js que usa `@whiskeysockets/baileys` para conexão real com WhatsApp via QR Code.

## Deploy em Produção

Este serviço **NÃO é deployado** junto com o backend FastAPI no Emergent. Você precisa hospedá-lo separadamente.

### Opção 1: Render (Recomendado)

1. Crie um novo **Web Service** no Render apontando para o repositório Git
2. Configure:
   - **Root Directory**: `whatsapp-service`
   - **Build Command**: `yarn install`
   - **Start Command**: `node index.js`
   - **Environment Variables**:
     - `FASTAPI_URL` = URL do seu backend em produção (ex: `https://agentcrm.8ip.com.br`)
3. Render expõe automaticamente a porta via `process.env.PORT`
4. Copie a URL pública gerada (ex: `https://boss-whatsapp.onrender.com`)

### Opção 2: Railway, Fly.io, VPS

Mesmo conceito — basta garantir que o Node tenha acesso a persistência de disco (auth_sessions/) e exponha a porta HTTP.

### Configurar o Backend FastAPI

No painel do Emergent em produção, adicione a variável:

```
WA_SERVICE_URL=https://boss-whatsapp.onrender.com
```

Redeploy o backend — o QR Code começará a funcionar.

## Rotas

- `POST /instances/:id/connect` — inicia uma nova sessão WhatsApp
- `GET /instances/:id/qr` — retorna `{ qr_base64, status }`
- `GET /instances/:id/status` — status atual
- `POST /instances/:id/send` — envia mensagem
- `POST /instances/:id/disconnect` — desconecta

## Webhooks emitidos para o FASTAPI_URL

- `POST /api/channels/webhook/connected` — quando conecta
- `POST /api/channels/webhook/message` — quando recebe mensagem
