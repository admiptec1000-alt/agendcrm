import React, { useState } from 'react';
import { toast } from 'sonner';
import { Bot, BotOff } from 'lucide-react';
import api from '../services/api';

/**
 * BotPausedBadge — shown on the chat header AND (compact icon variant) on
 * the ticket card in the conversation list when `ticket.bot_paused === true`.
 *
 * Header variant: a pill with "Bot pausado" + tooltip on hover that lets
 * the operator manually resume the bot on this ticket (rare action, but
 * useful when the operator wants the flow to take over again after typing
 * a single comment).
 */
export const BotPausedBadge = ({ ticketId, reason, onResumed }) => {
  const [busy, setBusy] = useState(false);
  const resume = async (e) => {
    e?.stopPropagation?.();
    if (busy) return;
    if (!window.confirm('Reativar o bot neste atendimento? O fluxo voltara a responder o cliente.')) {
      return;
    }
    setBusy(true);
    try {
      await api.post(`/crm/tickets/${ticketId}/bot-pause`, { paused: false });
      toast.success('Bot reativado neste atendimento.');
      onResumed?.();
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Erro ao reativar bot.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={resume}
      disabled={busy}
      title={
        `Bot pausado nesta conversa (motivo: ${reason || 'manual'}). ` +
        'Clique para reativar — o fluxo voltara a responder.'
      }
      data-testid="bot-paused-badge"
      className={[
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold',
        'bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors',
        busy ? 'opacity-50 cursor-wait' : 'cursor-pointer',
      ].join(' ')}
    >
      <BotOff className="w-3 h-3" />
      <span>Bot pausado</span>
    </button>
  );
};

/**
 * BotPausedDot — compact version used on the ticket card in the
 * conversation list. Just a small icon with tooltip; no click action.
 */
export const BotPausedDot = () => (
  <span
    title="Bot pausado neste atendimento"
    data-testid="bot-paused-dot"
    className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-100 text-amber-700"
  >
    <BotOff className="w-2.5 h-2.5" />
  </span>
);

export default BotPausedBadge;
