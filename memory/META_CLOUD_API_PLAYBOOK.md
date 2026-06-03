# Meta WhatsApp Cloud API — Playbook salvo da Fase 3

> Salvo em 2026-02-28 (PM). Conteúdo completo retornado pelo integration_playbook_expert_v2.
> Quando o cliente fornecer credenciais (System User Token + WABA ID + App Secret + Verify Token),
> seguir este playbook para implementar o adapter `whatsapp_cloud` em paralelo ao Baileys.

## Credenciais necessárias (pedir ao usuário)
- `META_APP_ID` — Meta App ID (developers.facebook.com)
- `META_APP_SECRET` — para validar X-Hub-Signature-256 do webhook
- `META_SYSTEM_USER_TOKEN` — token permanente (escopos `whatsapp_business_messaging` + `whatsapp_business_management`)
- `META_WABA_ID` — WhatsApp Business Account ID
- `META_WEBHOOK_VERIFY_TOKEN` — string inventada por nós, registrada no app dashboard
- `META_API_VERSION` — default `v20.0`

## Pontos críticos
- **Múltiplos números por WABA**: até 25 phone_numbers por WABA, cada um com phone_number_id próprio. 1 token controla todos.
- **Coexistência com Baileys**: NUNCA usar o mesmo número físico nos dois provedores. Validação obrigatória no UI.
- **24h rule**: free-form só dentro de 24h da última msg do cliente; fora disso, só template aprovado.
- **Pricing 2025+**: por mensagem entregue (não por sessão), em BRL para WABAs Brasil. Categorias: Marketing > Utility > Service.
- **Tier inicial**: 250 destinatários únicos/24h. Auto-upgrade para 2k → 10k → 100k → ilimitado conforme qualidade.
- **Throughput por número**: 80 msg/s default → até 1000 msg/s automático.
- **Webhook**: GET (handshake hub.challenge) + POST (assinatura X-Hub-Signature-256 = HMAC-SHA256(app_secret, raw_body)).

## Endpoints Graph API principais
- `GET /{waba_id}/phone_numbers` — lista números da WABA
- `GET /{waba_id}/message_templates` — templates aprovados
- `POST /{phone_number_id}/messages` — envio (texto, template, mídia)
- `POST /{phone_number_id}/messages` com `{type:"template"}` para HSM fora da janela 24h

## Schema MongoDB (a criar)
```
channel_connections (campo `provider` novo): "baileys" | "whatsapp_cloud"
  + waba_id, phone_number_id, display_phone_number (quando provider=whatsapp_cloud)
whatsapp_phone_numbers: id, phone_number_id, display, status, quality_rating, recent_count, last_used_at
whatsapp_templates: name, language, category, status, components, body_text
webhook_events: raw payload + processed flag
```

## Rotação multi-número (algoritmo)
```python
# sort by last_used_at asc, filter status=CONNECTED + recent_count < 50/min
# select first eligible, increment counter, atomically
```

## Estrutura proposta no backend
- `routes/whatsapp_cloud_routes.py` — admin endpoints (sync phones, sync templates, webhook handler)
- `services/whatsapp_cloud.py` — Client httpx + send_session / send_template / rotation
- `services/whatsapp_dispatcher.py` — abstração que decide provider por channel_connection_id

## TODO quando integrar
1. Pedir credenciais ao usuário
2. Adicionar campos no .env: META_APP_ID, META_APP_SECRET, META_SYSTEM_USER_TOKEN, META_WABA_ID, META_API_VERSION, META_WEBHOOK_VERIFY_TOKEN
3. Implementar client httpx async + rotation
4. Implementar webhook GET/POST com HMAC validation
5. UI: dropdown "Provedor" no formulário de criar conexão (já feito na Fase 1 — estrutura DB pronta)
6. Adapter no `bulk_dispatcher` para rotear envio para o provider correto
