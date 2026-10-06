# Spec — Integração de Cobrança 8IP Admin → AgentCRM

Cole o texto abaixo (entre as linhas) no chat do ambiente **8IP Admin (app.8ip.com.br)**.

---

Preciso expor uma integração de cobrança para um sistema externo (AgentCRM) consumir as empresas (tenants) e o valor da mensalidade. Requisitos:

## 1. Variável de ambiente
- Criar `BILLING_INTEGRATION_KEY` no `backend/.env` com uma chave aleatória longa (ex: `openssl rand -hex 32`). Me mostre o valor gerado no final para eu cadastrar no outro sistema.

## 2. Novo campo por empresa: Dia de vencimento
- Adicionar `billing_day` (inteiro 1–31, default 10) no cadastro de Empresa (SuperAdmin → Empresas → Nova/Editar Empresa), ao lado do campo Mensalidade. Label: "Dia de vencimento".
- Adicionar `is_blocked` (bool, default false) + `blocked_reason` + `blocked_at` na empresa. Empresa bloqueada: login do tenant mostra tela "Acesso suspenso por pendência financeira — entre em contato" e as rotas do tenant retornam 402. O toggle Ativa/Inativa existente continua independente.
- Mostrar badge "Bloqueada (financeiro)" no card da empresa no SuperAdmin quando `is_blocked=true`, com botão para desbloquear manualmente.

## 3. Endpoints (prefixo `/api`, autenticados por header `X-Integration-Key` que deve ser igual a `BILLING_INTEGRATION_KEY`; chave ausente/errada → 401)

### GET /api/integrations/billing/tenants
Retorna TODAS as empresas (ativas e inativas), no formato:
```json
{
  "tenants": [
    {
      "id": "uuid-da-empresa",
      "name": "Mega Brasil Atacado",
      "slug": "megabrasil",
      "owner_name": "Mega Brasil",
      "email": "adm@megabrasil.com",
      "phone": "5562999990000",
      "cnpj": "00.000.000/0001-00",
      "is_active": true,
      "is_blocked": false,
      "plan_name": "Pro Catalogo + ERP",
      "monthly_price": 197.00,
      "billing_day": 10,
      "discount": 0,
      "billing_start": "2026-01-05T00:00:00+00:00",
      "created_at": "2026-01-05T00:00:00+00:00",
      "updated_at": "2026-06-01T12:00:00+00:00"
    }
  ]
}
```
- `monthly_price` = o campo **Mensalidade** da empresa (número, 2 casas).
- `phone` só dígitos, com DDI 55 (é para onde vai a cobrança por WhatsApp).
- `billing_start` = data de início da cobrança (use `created_at` se não houver campo específico).

### POST /api/integrations/billing/tenants/{id}/block
Body: `{"reason": "Mensalidade vencida em 2026-06-10 (7d)", "source": "agentcrm"}` → marca `is_blocked=true`, `blocked_reason`, `blocked_at`. Retorna 200 `{"ok": true, "id": "...", "is_blocked": true}`. 404 se a empresa não existir.

### POST /api/integrations/billing/tenants/{id}/unblock
Body: `{"reason": "Pagamento regularizado", "source": "agentcrm"}` → `is_blocked=false`. Retorna 200 `{"ok": true, "id": "...", "is_blocked": false}`.

## 4. Segurança
- Comparar a chave com `hmac.compare_digest`.
- Registrar em log cada chamada (rota, id, resultado).
- Não expor esses endpoints no Swagger público (`include_in_schema=False`).

## 5. Testes
- Chave errada → 401 nas 3 rotas.
- GET lista empresas com `monthly_price` e `billing_day` corretos.
- block/unblock alternam `is_blocked` e empresa bloqueada recebe 402 no login do tenant.

---

## Depois, no AgentCRM (Super Admin → Financeiro Admin → Clientes Externos → "Integração 8IP Admin")
1. URL: `https://app.8ip.com.br` · Chave: a `BILLING_INTEGRATION_KEY` gerada · marcar **Ativa**.
2. "Testar conexão" → deve listar as empresas com valor e dia de vencimento.
3. "Sincronizar agora" → as empresas aparecem com badge **8IP** e os lançamentos "Mensalidade {Empresa} - MM/AAAA" passam a ser gerados automaticamente em Lançamentos, com lembretes WhatsApp pelo fluxo de cobrança já existente.
4. Opcional: ligar "Bloquear empresa no 8IP automaticamente após N dias de atraso" (desbloqueia sozinho ao marcar como pago).
