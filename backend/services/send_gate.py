"""Send gate — cadenciador global anti-bloqueio.

2026-08-11 — Antes deste modulo, apenas o dispatcher de campanhas
(`bulk_routes` + `wa_dispatcher.py`) respeitava os parametros de
anti-bloqueio. Notificacoes de cobranca, aniversario, pos-atendimento
e demais envios automaticos disparavam sem qualquer cadencia humana,
o que resultou em contas WhatsApp sendo restringidas em producao
("Sua conta foi restringida... voce nao pode iniciar novas conversas
no momento").

Este modulo consolida a decisao "posso enviar agora?" em uma unica
funcao chamada pelos schedulers ANTES de cada envio automatico
NAO-bot. A politica eh armazenada em `campaign_settings` (mesma
collection usada pela aba Parametros — agora movida para
Conexoes → Parametros).

Chamadores:
    * scheduler._process_billing_reminders  (cobranca SA → empresas)
    * scheduler._process_reminders          (lembretes/aniversario)
    * scheduler._process_surveys            (pos-atendimento)
    * wa_dispatcher.process_bulk_tick       (bulk/campanhas — mantido)

NAO aplica a:
    * Bot dentro do flow_engine (ja tem sua propria dinamica em
      `wa_humanize`)
    * Envio manual do atendente pelo painel de atendimento
"""
from __future__ import annotations

import random
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Tuple, Dict, Any

logger = logging.getLogger(__name__)

# Defaults conservadores para numeros NAO-Business. Podem ser
# sobrescritos por empresa via Conexoes → Parametros.
_DEFAULTS = {
    "enabled": True,
    "interval_min_seconds": 40,
    "interval_max_seconds": 120,
    "burst_size": 20,
    "burst_pause_seconds": 300,
    "escalate_after": 100,
    "escalate_factor": 1.5,
    "daily_limit": 250,
    "hourly_limit": 50,
}


async def _load_params(db, company_id: str) -> Dict[str, Any]:
    """Le a config de `campaign_settings.anti_block` de uma empresa e
    aplica os defaults quando ausente. Chamado em cada tick — barato
    porque a collection eh pequena (1 doc por empresa)."""
    if not company_id:
        return dict(_DEFAULTS)
    doc = await db.campaign_settings.find_one({"company_id": company_id}, {"_id": 0}) or {}
    ab = doc.get("anti_block") or {}
    merged = dict(_DEFAULTS)
    for k, v in ab.items():
        if v is not None:
            merged[k] = v
    return merged


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def acquire_send_slot(
    db,
    company_id: str,
    channel: str = "whatsapp",
) -> Tuple[bool, str]:
    """Decide se podemos disparar mais UMA mensagem automatica AGORA
    para uma dada empresa.

    Ordem de checagens (semantica de curto-circuito):
      1) protecao desabilitada → libera sempre
      2) contador horario / diario esgotado → bloqueia
      3) minimo tempo desde ultimo envio (randomico entre min-max, com
         escalonamento) → bloqueia
      4) pausa entre lotes a cada N envios → bloqueia

    Retorna (pode_enviar, motivo). Se pode_enviar for True, o chamador
    OBRIGATORIAMENTE deve invocar `record_send()` apos disparar. Se for
    False, apenas pula esta iteracao (o tick do scheduler volta em 60s e
    tenta de novo).

    channel eh reservado para futuro particionamento (ex: separar contadores
    por conexao especifica). Hoje o gate eh por empresa+canal.
    """
    p = await _load_params(db, company_id)
    if not p.get("enabled"):
        return True, "disabled"

    now = datetime.now(timezone.utc)
    hour_start = now.replace(minute=0, second=0, microsecond=0)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    stats = await db.send_gate_stats.find_one(
        {"company_id": company_id, "channel": channel},
        {"_id": 0},
    ) or {}

    # Reset counters if we crossed the hour/day boundary since last write.
    hour_count = int(stats.get("hour_count") or 0)
    day_count = int(stats.get("day_count") or 0)
    last_send_iso = stats.get("last_send_at")
    hour_marker = stats.get("hour_marker") or ""
    day_marker = stats.get("day_marker") or ""

    if hour_marker != hour_start.isoformat():
        hour_count = 0
    if day_marker != day_start.isoformat():
        day_count = 0

    # Hard limits.
    if day_count >= int(p["daily_limit"]):
        return False, f"daily_limit_reached ({day_count}/{p['daily_limit']})"
    if hour_count >= int(p["hourly_limit"]):
        return False, f"hourly_limit_reached ({hour_count}/{p['hourly_limit']})"

    # Cadence: minimum random interval since last send.
    if last_send_iso:
        try:
            last_send = datetime.fromisoformat(last_send_iso)
            if last_send.tzinfo is None:
                last_send = last_send.replace(tzinfo=timezone.utc)
        except Exception:
            last_send = now - timedelta(hours=1)
        elapsed = (now - last_send).total_seconds()

        factor = 1.0
        if day_count >= int(p["escalate_after"] or 0) > 0:
            factor = float(p["escalate_factor"] or 1.5)
        min_i = float(p["interval_min_seconds"]) * factor
        max_i = float(p["interval_max_seconds"]) * factor
        # Deterministic minimum: elapsed must be >= min_i. We only sample the
        # jitter for logging, not for the decision — this way retries in the
        # same tick don't get random passes.
        if elapsed < min_i:
            return False, f"cadence (elapsed={elapsed:.0f}s < min={min_i:.0f}s)"

        # Burst pause: after every `burst_size` sends, sleep for at least
        # `burst_pause_seconds` before the next.
        bs = int(p["burst_size"] or 0)
        bp = int(p["burst_pause_seconds"] or 0)
        if bs > 0 and bp > 0 and day_count > 0 and day_count % bs == 0:
            if elapsed < bp:
                return False, f"burst_pause ({elapsed:.0f}s < {bp}s after {day_count} msgs)"

    return True, "ok"


async def record_send(
    db,
    company_id: str,
    channel: str = "whatsapp",
) -> None:
    """Registra que 1 envio automatico foi disparado. Sempre chamar apos
    um `acquire_send_slot()` bem-sucedido."""
    if not company_id:
        return
    now = datetime.now(timezone.utc)
    hour_start = now.replace(minute=0, second=0, microsecond=0)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    stats = await db.send_gate_stats.find_one(
        {"company_id": company_id, "channel": channel},
        {"_id": 0},
    ) or {}
    hour_count = int(stats.get("hour_count") or 0)
    day_count = int(stats.get("day_count") or 0)
    if stats.get("hour_marker") != hour_start.isoformat():
        hour_count = 0
    if stats.get("day_marker") != day_start.isoformat():
        day_count = 0
    await db.send_gate_stats.update_one(
        {"company_id": company_id, "channel": channel},
        {"$set": {
            "company_id": company_id,
            "channel": channel,
            "hour_count": hour_count + 1,
            "day_count": day_count + 1,
            "hour_marker": hour_start.isoformat(),
            "day_marker": day_start.isoformat(),
            "last_send_at": now.isoformat(),
            "updated_at": now.isoformat(),
        }},
        upsert=True,
    )


async def get_stats(db, company_id: str, channel: str = "whatsapp") -> Dict[str, Any]:
    """Retorna estatisticas atuais do gate para a empresa (uso em UI)."""
    stats = await db.send_gate_stats.find_one(
        {"company_id": company_id, "channel": channel},
        {"_id": 0},
    ) or {}
    return stats
