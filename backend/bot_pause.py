"""Helpers for the "pause bot on human intervention" feature.

When the company toggle `pause_bot_on_human_intervention` is ON, any
operator-sent message (via platform UI OR via the linked WhatsApp phone)
must STOP the active flow on that ticket. The flow only resumes once the
ticket is closed/reopened (the close handler clears `bot_paused`) — there
is no in-place "resume bot" button by design (1a in the feature spec).
"""
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# Stored on the `companies` collection. Default for new companies is True
# (most CRMs behave this way: when the human takes over, the bot steps
# aside). Existing tenants without the flag fall back to the default too,
# so the migration is purely client-side via the toggle UI.
COMPANY_SETTING_KEY = "pause_bot_on_human_intervention"


async def is_pause_setting_enabled(db, company_id: str) -> bool:
    """Read the per-company toggle. Missing field → True (default ON)."""
    comp = await db.companies.find_one(
        {"id": company_id},
        {"_id": 0, COMPANY_SETTING_KEY: 1},
    )
    # `comp is None` means the company doesn't exist at all (defensive — we
    # treat that as "feature off" since no company = no scope). When the
    # company exists but the field is missing, motor returns `{}` (truthy
    # check `if not comp` would WRONGLY fall here and return False, which
    # is the opposite of the rollout intent). Compare against None explicitly.
    if comp is None:
        return False
    val = comp.get(COMPANY_SETTING_KEY)
    if val is None:
        return True  # default ON for tenants who never touched the toggle
    return bool(val)


async def pause_bot_on_ticket_if_enabled(
    db,
    ticket: dict,
    *,
    reason: str = "agent_message",
) -> bool:
    """Set `bot_paused=True` on the ticket when the company opted in. Also
    clears `active_flow_node_id` so any in-flight wait state is dropped —
    if the operator later closes the ticket the bot has no leftover anchor.
    Returns True if we paused, False if no-op."""
    if not ticket or ticket.get("bot_paused"):
        return False  # already paused / no ticket
    company_id = ticket.get("company_id")
    if not company_id:
        return False
    enabled = await is_pause_setting_enabled(db, company_id)
    if not enabled:
        return False
    # 2026-06-27 — Antes pulavamos quando o ticket ainda nao tinha flow
    # ativo (entrada `active_flow_id`/`active_flow_node_id`). Mas o usuario
    # reportou: "se eu chamei o cliente, mesmo antes do bot estartar, ele
    # nao pode disparar quando o cliente responder". Agora paused=True e
    # gravado em QUALQUER ticket que o operador toque — assim, no proximo
    # inbound do cliente, `_trigger_flow_for_ticket` → `advance_flow` ve a
    # flag e retorna sem disparar. Sai do "pausado" apenas via:
    #  - fechar/reabrir o ticket (resume_bot_on_ticket)
    #  - botao manual "Retomar bot" no chat (manual_toggle)
    now = datetime.now(timezone.utc).isoformat()
    await db.tickets.update_one(
        {"id": ticket["id"]},
        {"$set": {
            "bot_paused": True,
            "bot_paused_at": now,
            "bot_paused_reason": reason,
            "active_flow_node_id": None,
            "updated_at": now,
        }},
    )
    # Mutate the in-memory copy too so downstream code in the same request
    # sees the updated state without a second find_one.
    ticket["bot_paused"] = True
    ticket["bot_paused_at"] = now
    ticket["bot_paused_reason"] = reason
    ticket["active_flow_node_id"] = None
    logger.info(
        f"[bot_pause] ticket={ticket.get('id')} paused (reason={reason}) — "
        f"operator took over"
    )
    return True


async def resume_bot_on_ticket(db, ticket_id: str) -> None:
    """Clear the pause flags on a ticket. Called by the close/reopen
    handler so a fresh round of customer messages can re-trigger the flow
    cleanly on a brand-new ticket. We intentionally do NOT restore
    `active_flow_node_id` — the next inbound message will start a new flow
    via the connection's `default_flow_id`."""
    await db.tickets.update_one(
        {"id": ticket_id},
        {"$set": {
            "bot_paused": False,
            "bot_paused_at": None,
            "bot_paused_reason": None,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
