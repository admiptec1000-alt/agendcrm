"""Meta WhatsApp Cloud API service — per-tenant adapter.

Each company has its own Meta credentials stored in `companies.meta_credentials`
(Model A: cliente tem propria conta Meta). All Graph API calls are scoped per
company token.

2026-02-28 — Fase 3 inicial: per-company auth, list/create/delete templates,
list phone numbers, send text/template/media, webhook receiver.

References: /app/memory/META_CLOUD_API_PLAYBOOK.md
"""
from __future__ import annotations

import os
import logging
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

GRAPH_BASE = "https://graph.facebook.com"
DEFAULT_VERSION = os.environ.get("META_API_VERSION", "v20.0")


class MetaCloudClient:
    """Per-company Meta Cloud API client.

    Reads credentials from a `companies` document. Caller is responsible for
    handling 401/403 (likely token revogado/expirado) and surfacing actionable
    errors to the operator.
    """

    def __init__(self, creds: dict):
        self.token: str = creds.get("system_user_token") or ""
        self.waba_id: str = creds.get("waba_id") or ""
        self.app_secret: str = creds.get("app_secret") or ""
        self.api_version: str = creds.get("api_version") or DEFAULT_VERSION
        self.base = f"{GRAPH_BASE}/{self.api_version}"

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    async def _get(self, path: str, params: Optional[dict] = None) -> dict:
        async with httpx.AsyncClient(timeout=20.0) as c:
            r = await c.get(f"{self.base}{path}", headers=self._headers(), params=params or {})
            return _meta_handle(r)

    async def _post(self, path: str, json: dict) -> dict:
        async with httpx.AsyncClient(timeout=30.0) as c:
            r = await c.post(f"{self.base}{path}", headers=self._headers(), json=json)
            return _meta_handle(r)

    async def _delete(self, path: str, params: Optional[dict] = None) -> dict:
        async with httpx.AsyncClient(timeout=20.0) as c:
            r = await c.delete(f"{self.base}{path}", headers=self._headers(), params=params or {})
            return _meta_handle(r)

    # ─── Phone numbers ────────────────────────────────────────────────
    async def list_phone_numbers(self) -> list[dict]:
        data = await self._get(f"/{self.waba_id}/phone_numbers")
        return data.get("data", [])

    # ─── Templates ────────────────────────────────────────────────────
    async def list_templates(self) -> list[dict]:
        data = await self._get(f"/{self.waba_id}/message_templates", {"limit": 200})
        return data.get("data", [])

    async def create_template(self, payload: dict) -> dict:
        """payload = {name, language, category, components: [...]}"""
        return await self._post(f"/{self.waba_id}/message_templates", payload)

    async def delete_template(self, name: str) -> dict:
        return await self._delete(f"/{self.waba_id}/message_templates", {"name": name})

    # ─── Messages ─────────────────────────────────────────────────────
    async def send_text(self, phone_number_id: str, to: str, body: str) -> dict:
        return await self._post(
            f"/{phone_number_id}/messages",
            {
                "messaging_product": "whatsapp",
                "to": to,
                "type": "text",
                "text": {"body": body, "preview_url": False},
            },
        )

    async def send_template(
        self,
        phone_number_id: str,
        to: str,
        name: str,
        language: str,
        components: Optional[list] = None,
    ) -> dict:
        tpl: dict[str, Any] = {"name": name, "language": {"code": language}}
        if components:
            tpl["components"] = components
        return await self._post(
            f"/{phone_number_id}/messages",
            {
                "messaging_product": "whatsapp",
                "to": to,
                "type": "template",
                "template": tpl,
            },
        )


def _meta_handle(r: httpx.Response) -> dict:
    """Normalize Meta Graph response; raise on error with readable message."""
    try:
        body = r.json() if r.content else {}
    except Exception:
        body = {"raw": r.text[:500]}
    if r.status_code >= 400:
        err = (body.get("error") or {}) if isinstance(body, dict) else {}
        msg = err.get("message") or r.text[:300]
        code = err.get("code")
        sub = err.get("error_subcode")
        logger.warning("[meta] %s -> %s code=%s sub=%s msg=%s", r.request.url, r.status_code, code, sub, msg)
        raise MetaApiError(http=r.status_code, code=code, message=msg, raw=body)
    return body


class MetaApiError(Exception):
    def __init__(self, http: int, code: Any, message: str, raw: Any):
        super().__init__(message)
        self.http = http
        self.code = code
        self.message = message
        self.raw = raw

    def to_dict(self) -> dict:
        return {"http": self.http, "code": self.code, "message": self.message}


# ─── Per-company credentials helpers ───────────────────────────────────
async def get_company_meta_client(db, company_id: str) -> MetaCloudClient:
    """Return a configured MetaCloudClient for the company or raise 400."""
    from fastapi import HTTPException
    comp = await db.companies.find_one(
        {"id": company_id},
        {"_id": 0, "meta_credentials": 1},
    )
    creds = (comp or {}).get("meta_credentials") or {}
    if not (creds.get("system_user_token") and creds.get("waba_id")):
        raise HTTPException(
            status_code=400,
            detail="Credenciais Meta nao configuradas. Acesse Conexoes > API Oficial Meta > Credenciais.",
        )
    return MetaCloudClient(creds)


# ─── Webhook signature verification ────────────────────────────────────
def verify_webhook_signature(app_secret: str, raw_body: bytes, signature_header: Optional[str]) -> bool:
    """Validate Meta's X-Hub-Signature-256 header (HMAC-SHA256 of raw body)."""
    import hmac
    import hashlib
    if not (app_secret and signature_header):
        return False
    try:
        scheme, sig = signature_header.split("=", 1)
    except ValueError:
        return False
    if scheme != "sha256":
        return False
    expected = hmac.new(app_secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig)


# ─── Static Meta category catalog (used by Super Admin / company UI) ─
# Source: https://developers.facebook.com/docs/whatsapp/pricing &
# https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates/
META_CATEGORIES = [
    {
        "key": "MARKETING",
        "label": "Marketing",
        "color": "#ef4444",
        "price_tier": "alto",
        "description": "Promocoes, ofertas, anuncios, lancamentos, recuperacao de carrinho.",
        "rules": [
            "Cliente DEVE ter dado opt-in explicito antes de receber.",
            "Texto promocional/CTA permitido (cupom, desconto, novidade).",
            "Imagens promocionais permitidas no header.",
            "Categoria com MAIOR preco por mensagem entregue (BR).",
            "Nao pode prometer ou enganar (politicas anti-spam Meta).",
        ],
        "examples_good": [
            "Ola {{1}}! Hoje tem 30% OFF em todo o catalogo. Codigo: PROMO30. Aproveite ate domingo!",
            "{{1}}, voce esqueceu itens no carrinho. Finalize agora e ganhe frete gratis!",
        ],
        "examples_bad": [
            "Pague {{1}} reais agora ou perde o desconto!! (linguagem agressiva)",
            "GARANTIDO!! VOCE GANHOU UMA OFERTA EXCLUSIVA!!! (caps lock + clickbait)",
        ],
    },
    {
        "key": "UTILITY",
        "label": "Utilidade (Transacional)",
        "color": "#3b82f6",
        "price_tier": "medio",
        "description": "Confirmacoes de pedido, status, lembretes, atualizacoes de conta, cobrancas.",
        "rules": [
            "Relacionado a uma TRANSACAO real do cliente.",
            "Conteudo informacional, nao promocional.",
            "Pode incluir botoes de acao (pagar, confirmar, cancelar).",
            "Custo MENOR que Marketing — ideal para fluxos operacionais.",
            "Nao misturar com promocoes (Meta re-categoriza pra Marketing).",
        ],
        "examples_good": [
            "Ola {{1}}, seu pedido #{{2}} foi enviado e chega em ate {{3}} dias.",
            "Lembrete: sua consulta com Dr. {{1}} esta agendada para {{2}} as {{3}}h.",
            "Sua fatura de R$ {{1}} vence em {{2}}. Acesse o link para pagar.",
        ],
        "examples_bad": [
            "Sua fatura venceu! Aproveite e contrate nosso plano premium! (mistura cobranca + venda)",
        ],
    },
    {
        "key": "AUTHENTICATION",
        "label": "Autenticacao",
        "color": "#a855f7",
        "price_tier": "medio",
        "description": "Codigos OTP, verificacao em 2 etapas, recuperacao de senha.",
        "rules": [
            "Conteudo EXCLUSIVO de autenticacao: codigos numericos curtos.",
            "Template DEVE usar formato OTP padrao da Meta.",
            "Botao 'Copiar codigo' incluido automaticamente.",
            "Expiracao do codigo deve ser informada.",
            "Validade do template revisada com mais rigor que outras categorias.",
        ],
        "examples_good": [
            "{{1}} e seu codigo de verificacao. Valido por 5 minutos.",
            "Seu codigo de acesso e {{1}}. Nao compartilhe com ninguem.",
        ],
        "examples_bad": [
            "Confirme seu codigo {{1}} e aproveite a promocao! (mistura OTP com marketing)",
        ],
    },
    {
        "key": "SERVICE",
        "label": "Atendimento (Servico)",
        "color": "#10b981",
        "price_tier": "baixo (gratis em sessao)",
        "description": "Respostas a perguntas iniciadas pelo cliente, suporte, FAQs.",
        "rules": [
            "Disparada apenas DENTRO da janela de 24h apos mensagem do cliente.",
            "Free-form permitido — nao precisa de template aprovado.",
            "Gratuita quando dentro da janela (a Meta nao cobra).",
            "Apos 24h sem nova mensagem do cliente, so pode mandar template (Utility/Marketing).",
            "Ideal para atendimento humano + bot de FAQ.",
        ],
        "examples_good": [
            "Ola! Como posso ajudar hoje?",
            "Entendi sua duvida. Vou transferir voce para um especialista.",
        ],
        "examples_bad": [
            "Mandar conteudo promocional como 'servico' apos 24h (Meta bloqueia).",
        ],
    },
]
