"""
Background scheduler:
  - Sends appointment reminders X minutes before scheduled time (per company `reminder_minutes_before`)
  - Sends post-attendance satisfaction surveys X minutes after `concluded_at`
  - Sends scheduled bulk/campaign messages (collection: scheduled_messages, status=pendente)

Runs every 60 seconds.
"""
import asyncio
import logging
import os
from datetime import datetime, timezone, timedelta

import httpx

from database import get_database

logger = logging.getLogger(__name__)
SCHEDULER_INTERVAL = int(os.environ.get("SCHEDULER_INTERVAL_SECONDS", "60"))
WA_SERVICE_URL = os.environ.get("WA_SERVICE_URL", "http://localhost:3002")


async def _settings_for(db, company_id: str) -> dict:
    s = await db.notification_settings.find_one({"company_id": company_id}, {"_id": 0}) or {}
    s.setdefault("booking_reminder_24h", True)
    s.setdefault("reminder_minutes_before", 1440)
    s.setdefault("survey_enabled", False)
    s.setdefault("survey_minutes_after", 120)
    return s


async def _process_reminders(db, base_url: str):
    """Find appointments needing a reminder and send them."""
    from notifications import notify_appointment_reminder
    now = datetime.now(timezone.utc)
    # Group companies that have notifications enabled
    company_ids = await db.companies.distinct("id")
    for cid in company_ids:
        s = await _settings_for(db, cid)
        if not s.get("booking_reminder_24h"):
            continue
        minutes_before = int(s.get("reminder_minutes_before") or 1440)
        # Window: send if scheduled time is within [now+minutes_before-1m ; now+minutes_before+1m]
        target_dt = now + timedelta(minutes=minutes_before)
        date_str = target_dt.strftime("%Y-%m-%d")
        time_low = (target_dt - timedelta(minutes=1)).strftime("%H:%M")
        time_high = (target_dt + timedelta(minutes=1)).strftime("%H:%M")
        cursor = db.appointments.find({
            "company_id": cid,
            "status": {"$in": ["pendente", "confirmado"]},
            "date": date_str,
            "time": {"$gte": time_low, "$lte": time_high},
            "reminder_sent_at": {"$exists": False},
        }, {"_id": 0})
        async for apt in cursor:
            try:
                await notify_appointment_reminder(db, cid, apt, base_url)
            except Exception as e:
                logger.warning(f"[scheduler] reminder failed for {apt.get('id')}: {e}")


async def _process_surveys(db, base_url: str):
    """Send satisfaction survey X minutes after appointment was concluded."""
    from notifications import notify_satisfaction_survey
    now = datetime.now(timezone.utc)
    company_ids = await db.companies.distinct("id")
    for cid in company_ids:
        s = await _settings_for(db, cid)
        if not s.get("survey_enabled"):
            continue
        minutes_after = int(s.get("survey_minutes_after") or 120)
        # Find appointments concluded between [now-minutes_after-2m ; now-minutes_after+2m]
        target_dt = now - timedelta(minutes=minutes_after)
        low = (target_dt - timedelta(minutes=2)).isoformat()
        high = (target_dt + timedelta(minutes=2)).isoformat()
        cursor = db.appointments.find({
            "company_id": cid,
            "status": "concluido",
            "concluded_at": {"$gte": low, "$lte": high},
            "survey_sent_at": {"$exists": False},
        }, {"_id": 0})
        async for apt in cursor:
            try:
                await notify_satisfaction_survey(db, cid, apt, base_url)
            except Exception as e:
                logger.warning(f"[scheduler] survey failed for {apt.get('id')}: {e}")


async def _process_scheduled_bulk(db):
    """Send scheduled bulk messages whose scheduled_at is now or in the past."""
    from notifications import _get_active_whatsapp_conn, _send_via_baileys
    now_iso = datetime.now(timezone.utc).isoformat()
    cursor = db.scheduled_messages.find({
        "status": "pendente",
        "channel": "whatsapp",
        "scheduled_at": {"$lte": now_iso},
    }, {"_id": 0})
    async for msg in cursor:
        try:
            conn = await _get_active_whatsapp_conn(db, msg["company_id"])
            if not conn:
                # Skip; will retry next tick
                continue
            ok = await _send_via_baileys(conn["id"], msg["recipient"], msg["message"])
            await db.scheduled_messages.update_one(
                {"id": msg["id"]},
                {"$set": {
                    "status": "enviada" if ok else "falhou",
                    "sent_at": datetime.now(timezone.utc).isoformat(),
                }}
            )
        except Exception as e:
            logger.warning(f"[scheduler] bulk message {msg.get('id')} failed: {e}")


async def _process_ticket_auto_close(db):
    """Close tickets that have gone past the per-company inactivity timeout.
    Setting on `companies.ticket_auto_close_hours` (0 = disabled). We only
    look at tickets in 'aberto' or 'em_andamento' status and rely on
    `updated_at` as the staleness signal (set by every message append).
    Ignores tickets that already have `bot_paused=true` AND don't have any
    operator-side activity, because those are by-design parked waiting for
    a human reply and shouldn't auto-close just from the bot's last
    outbound."""
    import httpx
    now = datetime.now(timezone.utc)
    wa_service_url = os.environ.get("WA_SERVICE_URL", "http://localhost:3002")
    # Pull only companies with the setting enabled. Cheap enough to do per
    # tick — most tenants have it off.
    cursor = db.companies.find(
        {"ticket_auto_close_hours": {"$gt": 0}},
        {"_id": 0, "id": 1, "name": 1, "ticket_auto_close_hours": 1, "ticket_auto_close_message": 1},
    )
    async for c in cursor:
        hours = int(c.get("ticket_auto_close_hours") or 0)
        if hours <= 0:
            continue
        cutoff = (now - timedelta(hours=hours)).isoformat()
        message_template = c.get("ticket_auto_close_message") or ""
        # Fetch the tickets we're about to close so we can send the
        # goodbye message via the WhatsApp service. Without this, the
        # mass-update wouldn't tell us which contacts to ping.
        # 2026-02-15 (H) — per-company auto-close message.
        to_close_cursor = db.tickets.find(
            {
                "company_id": c["id"],
                "status": {"$in": ["aberto", "em_andamento"]},
                "updated_at": {"$lt": cutoff},
            },
            {"_id": 0, "id": 1, "contact_id": 1, "channel_id": 1},
        )
        tickets_to_close = await to_close_cursor.to_list(500)
        if not tickets_to_close:
            continue
        # Send the goodbye message (best-effort) BEFORE closing the
        # ticket — message_history append depends on the ticket still
        # being open. Failures here are logged but never abort the close.
        if message_template.strip():
            for t in tickets_to_close:
                try:
                    contact = await db.contacts.find_one(
                        {"id": t.get("contact_id")},
                        {"_id": 0, "phone": 1, "name": 1},
                    )
                    channel = await db.channel_connections.find_one(
                        {"id": t.get("channel_id")},
                        {"_id": 0, "id": 1},
                    )
                    if not (contact and channel and contact.get("phone")):
                        continue
                    contact_name = contact.get("name") or ""
                    company_name = c.get("name") or ""
                    msg = (
                        message_template
                        .replace("{{nome}}", contact_name)
                        .replace("{nome}", contact_name)
                        .replace("{{empresa}}", company_name)
                        .replace("{empresa}", company_name)
                    )
                    async with httpx.AsyncClient(timeout=10.0) as client:
                        await client.post(
                            f"{wa_service_url}/instances/{channel['id']}/send",
                            json={"phone": contact["phone"], "message": msg},
                        )
                    # Persist in ticket message history.
                    await db.tickets.update_one(
                        {"id": t["id"]},
                        {"$push": {"messages": {
                            "from": "bot",
                            "text": msg,
                            "type": "text",
                            "timestamp": now.isoformat(),
                            "system": True,
                            "reason": "auto_close",
                        }}},
                    )
                except Exception as e:
                    logger.warning(
                        f"[scheduler] auto-close goodbye failed ticket={t.get('id')}: {e}"
                    )
        # Now mark them all closed in one shot.
        result = await db.tickets.update_many(
            {
                "company_id": c["id"],
                "status": {"$in": ["aberto", "em_andamento"]},
                "updated_at": {"$lt": cutoff},
            },
            {"$set": {
                "status": "fechado",
                "closed_at": now.isoformat(),
                "closed_reason": "auto_timeout",
                "updated_at": now.isoformat(),
                # Resume bot just in case it was paused — same logic as
                # manual close.
                "bot_paused": False,
                "bot_paused_at": None,
                "bot_paused_reason": None,
            }},
        )
        if result.modified_count:
            logger.info(
                f"[scheduler] auto-closed {result.modified_count} tickets for "
                f"company={c['id']} (idle > {hours}h)"
            )


# === Billing reminder generator (2026-02-16 J) ====================================
# For each company with monthly_price > 0 and installments > 0 and a
# first_due_date set, this task walks parcela 0..N-1, finds the NEXT one
# that has no auto-generated row yet, and — when the due_date is within 10
# days — creates the Lancamento (super_admin_transactions, kind=licenca,
# auto_company_billing=True) AND fires a WhatsApp reminder via the Super
# Admin's system connection.
BILLING_REMINDER_DAYS = int(os.environ.get("BILLING_REMINDER_DAYS", "10"))
SA_SYSTEM_COMPANY_ID = "_super_admin_system_"


def _compute_due_date(first_due_iso: str, cycle: str, index: int):
    base = datetime.fromisoformat(first_due_iso).date()
    if cycle == "yearly":
        try:
            return base.replace(year=base.year + index)
        except ValueError:
            return base.replace(year=base.year + index, day=28)
    if cycle == "one_time":
        return base if index == 0 else None
    # monthly
    month = ((base.month - 1) + index) % 12 + 1
    year = base.year + ((base.month - 1) + index) // 12
    try:
        return base.replace(year=year, month=month)
    except ValueError:
        return base.replace(year=year, month=month, day=28)


async def _get_sa_system_connection(db):
    """Find the first active WhatsApp connection owned by the SA system
    company. Returns the connection doc or None."""
    return await db.channel_connections.find_one(
        {
            "company_id": SA_SYSTEM_COMPANY_ID,
            "status": "connected",
        },
        {"_id": 0, "id": 1, "company_id": 1},
    )


async def _send_billing_reminder(conn_id: str, phone: str, text: str):
    """Send a billing reminder via the Baileys microservice.

    Returns a tuple `(sent_ok: bool, error_detail: Optional[str])`.
    `error_detail` is a short human-readable string saved into
    `billing_reminder_history.error` to help operators diagnose failures
    directly from the History modal (e.g. "http 404 - instance not found",
    "timeout after 10s", "no message_id returned").
    """
    if not phone:
        return False, "no_phone"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                f"{WA_SERVICE_URL}/instances/{conn_id}/send",
                json={"phone": phone, "message": text},
            )
        if r.status_code >= 400:
            body_preview = (r.text or "")[:200].replace("\n", " ")
            return False, f"http {r.status_code} - {body_preview}"
        # 200 OK but Baileys may have silently dropped the message.
        try:
            payload = r.json()
        except Exception:
            payload = {}
        if isinstance(payload, dict) and not (payload.get("message_id") or payload.get("id")):
            return False, "no_message_id_in_response"
        return True, None
    except httpx.TimeoutException:
        logger.warning(f"[scheduler] reminder send timeout conn={conn_id}")
        return False, "timeout_10s"
    except Exception as e:
        logger.warning(f"[scheduler] reminder send failed: {e}")
        return False, f"exception: {str(e)[:200]}"


def _render_reminder(template: str, ctx: dict) -> str:
    if not template:
        return ""
    out = template
    for key, val in ctx.items():
        sval = "" if val is None else str(val)
        out = out.replace("{{" + key + "}}", sval).replace("{" + key + "}", sval)
    return out


async def _process_billing_reminders(db, *, send_messages: bool = True):
    """2026-02-18 — Nao deve enviar mensagens em edicoes/criacoes de
    empresa. Quando `send_messages=False`, somente cria/atualiza linhas
    pendentes em super_admin_transactions (lado materializacao). O envio
    real eh sempre feito pelo tick periodico do scheduler. Isso evita o
    bug de operador ver o cliente recebendo cobranca toda vez que ele
    salva uma edicao de empresa ou ajusta a mensagem padrao.
    """
    # Global config (2026-02-16 K + L + N) — operator can override via SA UI.
    settings = await db.system_settings.find_one(
        {"key": "billing_reminder"}, {"_id": 0}
    ) or {}
    if settings.get("enabled") is False:
        return
    days_list = settings.get("days_before_due_list")
    if not isinstance(days_list, list) or not days_list:
        days_list = [int(settings.get("days_before_due") or BILLING_REMINDER_DAYS)]
    # Normalize: dedupe + clip to [-30..60] + sort descending. Negative
    # offsets fire AFTER the due date (late-payment follow-ups). E.g. -3
    # means "send 3 days after due".
    days_list = sorted({max(-30, min(60, int(x))) for x in days_list}, reverse=True)
    # 2026-02-16 (N) — `lancamento_gen_days` controls TXN creation. Decoupled
    # from the reminder offsets — default = max(days_list) for back-compat.
    gen_days = settings.get("lancamento_gen_days")
    if gen_days is None:
        gen_days = max(days_list) if days_list else BILLING_REMINDER_DAYS
    gen_days = max(0, min(180, int(gen_days)))
    # 2026-02-16 (O) — Defaults de multa/juros aplicados nos Lancamentos auto.
    default_lf_enabled = bool(settings.get("default_late_fee_enabled", False))
    default_lf_multa = float(settings.get("default_late_fee_multa_pct") or 0)
    default_lf_juros = float(settings.get("default_late_fee_juros_dia_pct") or 0)
    global_default_msg = settings.get("default_message") or (
        "Ola {{nome}}! Sua mensalidade no valor de R$ {{valor}} "
        "vence em {{vencimento}} (parcela {{parcela}}). Em caso de duvida nos chame."
    )
    channel = (settings.get("channel") or "whatsapp").lower()
    today = datetime.now(timezone.utc).date()
    # Walk parcelas where due is within max(gen_days, max(days_list)). The
    # gen_days controls when we create the row; days_list controls when we
    # fire reminders. Both events are independent. Only positive offsets
    # extend the materialization window — negative offsets fire AFTER due
    # so the row must already exist.
    max_positive_offset = max([d for d in days_list if d > 0] or [0])
    cutoff = today + timedelta(days=max(gen_days, max_positive_offset))
    cursor = db.companies.find(
        {
            # 2026-02-18 — Aceita empresas com monthly_price > 0 OU
            # total_sale_price > 0 (novo modelo unificado).
            "$or": [
                {"monthly_price": {"$gt": 0}},
                {"total_sale_price": {"$gt": 0}},
            ],
            "installments": {"$gt": 0},
            "first_due_date": {"$ne": None},
            "is_super_admin_system": {"$ne": True},
            "status": {"$ne": "blocked"},
        },
        {
            "_id": 0, "id": 1, "name": 1, "phone": 1, "representante": 1,
            "monthly_price": 1, "billing_cycle": 1, "installments": 1,
            "first_due_date": 1,
            # 2026-02-18 — Necessarios para as novas variaveis do template
            # de cobranca.
            "max_connections": 1, "max_users": 1,
            "total_sale_price": 1, "discount": 1, "observation": 1,
        },
    )
    sa_conn = await _get_sa_system_connection(db)
    sa_conn_id = sa_conn.get("id") if sa_conn else None
    async for c in cursor:
        try:
            first_due = c.get("first_due_date") or ""
            if not first_due:
                continue
            # 2026-02-18 — Valor da parcela: prefere `total_sale_price` (calculado
            # a partir das licencas no cadastro da empresa). Fallback para
            # `monthly_price` quando ausente (compatibilidade legado).
            _tsp = float(c.get("total_sale_price") or 0)
            price = _tsp if _tsp > 0 else float(c.get("monthly_price") or 0)
            installments = int(c.get("installments") or 0)
            cycle = (c.get("billing_cycle") or "monthly").lower()
            if price <= 0 or installments <= 0:
                continue
            # Map of recurrence_index -> existing txn doc (id + due_date).
            existing_rows = await db.super_admin_transactions.find(
                {"company_id": c["id"], "auto_company_billing": True},
                {"_id": 0, "id": 1, "recurrence_index": 1, "due_date": 1, "status": 1},
            ).to_list(installments + 5)
            by_index = {int(x.get("recurrence_index") or 0): x for x in existing_rows}

            # Walk parcelas. We may create the txn AND/OR send reminders for
            # already-existing pending txns when a later offset comes due.
            for i in range(installments):
                due = _compute_due_date(first_due, cycle, i)
                if not due:
                    break
                # Earliest meaningful action for this parcela is when
                # due - max_offset <= today. After that, future parcelas are
                # too far out → stop walking.
                if due > cutoff:
                    break

                txn = by_index.get(i)
                if not txn:
                    # Create the Lancamento only when within `gen_days` window
                    # (2026-02-16 N). Reminders may still walk further out.
                    if (due - today).days > gen_days:
                        # Too early to materialize the row, but maybe a
                        # reminder offset is past-due. Skip creation.
                        continue
                    desc_suffix = f" - parcela {i + 1}/{installments}" if installments > 1 else ""
                    txn = {
                        "id": str(__import__('uuid').uuid4()),
                        "direction": "entrada",
                        "status": "pendente",
                        "amount": price,
                        "payment_method": "outros",
                        "category": "outros",
                        "description": f"Mensalidade {c.get('name') or ''}{desc_suffix}",
                        "date": due.isoformat(),
                        "due_date": due.isoformat(),
                        "kind": "licenca",
                        "company_id": c["id"],
                        "auto_company_billing": True,
                        "recurrence_index": i,
                        "recurrence_total": installments,
                        "recurrence_interval": cycle,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    }
                    # 2026-02-16 (O) — Inject default late_fee if enabled.
                    if default_lf_enabled and (default_lf_multa > 0 or default_lf_juros > 0):
                        txn["late_fee"] = {
                            "enabled": True,
                            "multa_pct": default_lf_multa,
                            "juros_dia_pct": default_lf_juros,
                        }
                    # 2026-02-18 — Propaga `discount` da empresa para a parcela.
                    _company_discount = float(c.get("discount") or 0)
                    if _company_discount > 0:
                        txn["discount"] = _company_discount
                    # 2026-02-18 — Snapshot do campo `observation` da empresa
                    # no momento da geracao, para auditoria/historico.
                    _company_obs = (c.get("observation") or "").strip()
                    if _company_obs:
                        txn["observations"] = [{
                            "id": str(__import__('uuid').uuid4()),
                            "text": _company_obs,
                            "author_id": None,
                            "author_name": "Sistema (cadastro da empresa)",
                            "created_at": datetime.now(timezone.utc).isoformat(),
                        }]
                    await db.super_admin_transactions.insert_one(txn)
                    logger.info(
                        f"[scheduler] billing-reminder: created Lancamento "
                        f"company={c['id']} parcela={i+1}/{installments} due={due.isoformat()}"
                    )
                # Skip reminders for already-paid parcelas.
                if (txn.get("status") or "").lower() == "pago":
                    continue
                # 2026-02-18 — Edicoes/criacoes de empresa chamam este loop
                # apenas pra materializar Lancamentos pendentes. NUNCA
                # disparam mensagens — isso eh exclusivo do tick periodico.
                if not send_messages:
                    continue
                # Decide which offset fires today for this parcela.
                # SMART FALLBACK (2026-02-17 — bug fix): instead of firing
                # every eligible offset on the same tick (which spammed the
                # client when multiple offsets passed before any was sent),
                # we pick the SINGLE most-relevant offset for today:
                #   - Eligible offsets: O where today >= due - O
                #     i.e. O >= days_until_due (positive O = before due,
                #     negative O = after due).
                #   - Exclude (txn, O) pairs already sent in history.
                #   - Among the rest, pick the SMALLEST O — the one whose
                #     `fire_on` day is closest to today (or today itself).
                # This guarantees at most ONE reminder per tick per parcela,
                # tolerates downtime (always fires the most-recent eligible
                # offset), and naturally supports day-0 (due) and negative
                # offsets (late-payment follow-up).
                already_sent_offsets = set()
                hist_rows = await db.billing_reminder_history.find(
                    {"transaction_id": txn["id"], "status": "sent",
                     "days_before_due": {"$in": days_list}},
                    {"_id": 0, "days_before_due": 1},
                ).to_list(50)
                for h in hist_rows:
                    if h.get("days_before_due") is not None:
                        already_sent_offsets.add(int(h["days_before_due"]))

                days_until_due = (due - today).days
                eligible = [
                    o for o in days_list
                    if o >= days_until_due and o not in already_sent_offsets
                ]
                if not eligible:
                    continue
                offset = min(eligible)  # closest to today (smallest O)
                # Fire this single reminder.
                template = global_default_msg
                nome = (c.get("representante") or c.get("name") or "")
                # 2026-02-18 — Variaveis adicionais para o template:
                #   {{licencas_conexao}}  → total de conexoes liberadas
                #   {{licencas_usuario}}  → total de usuarios liberados
                #   {{valor_venda_total}} → soma de venda das licencas
                #   {{valor_desconto}}    → desconto fixo da empresa
                #   {{valor_devido}}      → valor da parcela menos desconto
                # 2026-05-26 — {{valor_total_liquido}} → valor_venda_total
                #              menos valor_desconto (total da venda ja
                #              descontado, util pra exibir "Total a pagar"
                #              no template alem do per-parcela).
                # 2026-05-26 (P2) — {{valor_devido}} agora inclui juros e
                # multa quando a parcela esta atrasada. {{valor_liquido}}
                # eh a versao SEM acrescimo (= amount - desconto).
                # {{valor_acrescimo}} eh o total de multa + juros do dia.
                from finance_helpers import compute_late_fee_amount
                _disc = float(c.get("discount") or 0)
                _venda_total = float(c.get("total_sale_price") or 0)
                _total_liquido = max(0.0, _venda_total - _disc)
                _lf = (txn or {}).get("late_fee") or {}
                _lf_calc = compute_late_fee_amount(
                    float(price), txn.get("due_date") or due.isoformat(),
                    float(_lf.get("multa_pct") or 0) if _lf.get("enabled") else 0.0,
                    float(_lf.get("juros_dia_pct") or 0) if _lf.get("enabled") else 0.0,
                    discount=_disc,
                )
                _valor_liquido = max(0.0, float(price) - _disc)
                _valor_devido = float(_lf_calc.get("valor_devido") or _valor_liquido)
                _valor_acrescimo = float(_lf_calc.get("total") or 0.0)
                ctx = {
                    "nome": nome,
                    "empresa": c.get("name") or "",
                    "valor": f"{price:.2f}".replace(".", ","),
                    "vencimento": due.strftime("%d/%m/%Y"),
                    "parcela": f"{i + 1}/{installments}",
                    "licencas_conexao": str(c.get("max_connections") or 0),
                    "licencas_usuario": str(c.get("max_users") or 0),
                    "valor_venda_total": f"{_venda_total:.2f}".replace(".", ","),
                    "valor_desconto": f"{_disc:.2f}".replace(".", ","),
                    "valor_liquido": f"{_valor_liquido:.2f}".replace(".", ","),
                    "valor_acrescimo": f"{_valor_acrescimo:.2f}".replace(".", ","),
                    "valor_devido": f"{_valor_devido:.2f}".replace(".", ","),
                    "valor_total_liquido": f"{_total_liquido:.2f}".replace(".", ","),
                }
                text = _render_reminder(template, ctx)
                phone = c.get("phone") or ""
                wants_whatsapp = channel in ("whatsapp", "both")
                sent_ok = False
                error = None
                if wants_whatsapp and sa_conn_id and phone and text:
                    try:
                        sent_ok, error = await _send_billing_reminder(sa_conn_id, phone, text)
                    except Exception as e:
                        sent_ok = False
                        error = f"exception: {str(e)[:200]}"
                else:
                    if not wants_whatsapp:
                        error = "channel_disabled"
                    elif not sa_conn_id:
                        error = "no_sa_connection"
                    elif not phone:
                        error = "no_phone"
                    else:
                        error = "no_text"
                await db.billing_reminder_history.insert_one({
                    "id": str(__import__('uuid').uuid4()),
                    "company_id": c["id"],
                    "transaction_id": txn["id"],
                    "phone": phone,
                    "text": text,
                    "kind": "auto",
                    "status": "sent" if sent_ok else "failed",
                    "error": error,
                    "days_before_due": offset,
                    "sent_at": datetime.now(timezone.utc).isoformat(),
                })
                if sent_ok:
                    logger.info(
                        f"[scheduler] billing-reminder sent company={c['id']} "
                        f"txn={txn['id']} offset={offset}d"
                    )
                else:
                    logger.warning(
                        f"[scheduler] billing-reminder NOT sent company={c['id']} "
                        f"txn={txn['id']} offset={offset}d error={error}"
                    )
        except Exception as e:
            logger.warning(
                f"[scheduler] billing-reminder error company={c.get('id')}: {e}"
            )


async def tick():
    db = await get_database()
    base_url = os.environ.get("FRONTEND_PUBLIC_URL", "")
    try:
        await _process_reminders(db, base_url)
    except Exception as e:
        logger.error(f"[scheduler] reminders error: {e}")
    try:
        await _process_surveys(db, base_url)
    except Exception as e:
        logger.error(f"[scheduler] surveys error: {e}")
    try:
        await _process_scheduled_bulk(db)
    except Exception as e:
        logger.error(f"[scheduler] bulk error: {e}")
    try:
        await _process_ticket_auto_close(db)
    except Exception as e:
        logger.error(f"[scheduler] ticket auto-close error: {e}")
    try:
        await _process_billing_reminders(db)
    except Exception as e:
        logger.error(f"[scheduler] billing reminders error: {e}")


async def start_scheduler_loop():
    await asyncio.sleep(20)
    logger.info(f"[scheduler] started, interval={SCHEDULER_INTERVAL}s")
    while True:
        try:
            await tick()
        except Exception as e:
            logger.error(f"[scheduler] tick error: {e}")
        await asyncio.sleep(SCHEDULER_INTERVAL)
