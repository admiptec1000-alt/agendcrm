import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Bot, Loader2 } from 'lucide-react';
import api from '../services/api';

/**
 * BotPauseSettingsCard — toggle exposed to company admins under
 * /configuracoes. When ON (default), the WhatsApp bot stops acting on a
 * ticket as soon as an operator sends a message — either via the platform
 * or via the linked phone. The bot resumes only when the ticket is closed
 * and a NEW ticket is opened later.
 *
 * The backend endpoints live at /api/crm/company/bot-settings.
 */
const BotPauseSettingsCard = ({ canEdit = true }) => {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get('/crm/company/bot-settings')
      .then(r => { if (!cancelled) setEnabled(!!r.data?.pause_bot_on_human_intervention); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const toggle = async () => {
    if (!canEdit || saving) return;
    const next = !enabled;
    setSaving(true);
    setEnabled(next); // optimistic
    try {
      await api.put('/crm/company/bot-settings', {
        pause_bot_on_human_intervention: next,
      });
      toast.success(
        next
          ? 'Bot vai pausar quando voce intervir manualmente.'
          : 'Bot continua ativo mesmo apos a sua intervencao.'
      );
    } catch (e) {
      setEnabled(!next); // revert
      toast.error(e?.response?.data?.detail || 'Falha ao salvar configuracao.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card max-w-2xl mb-6" data-testid="bot-pause-settings-card">
      <div className="flex items-start gap-4">
        <div className="p-3 rounded-xl bg-indigo-50 text-indigo-600 shrink-0">
          <Bot className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-900">Pausar bot ao intervir manualmente</h3>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            Quando ativada, qualquer mensagem que voce ou seus operadores enviarem
            (pelo painel ou pelo WhatsApp do celular conectado) faz o robo do
            Flowbuilder <strong>parar de atuar</strong> naquele atendimento. O bot so
            volta a responder em um <strong>novo atendimento</strong> apos voce
            encerrar o atual.
          </p>
          {!canEdit && (
            <p className="text-xs text-amber-600 mt-2">
              Apenas administradores podem alterar esta configuracao.
            </p>
          )}
        </div>
        <div className="shrink-0 pt-1">
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          ) : (
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              onClick={toggle}
              disabled={!canEdit || saving}
              data-testid="bot-pause-toggle"
              className={[
                'relative inline-flex h-7 w-12 items-center rounded-full transition-colors',
                enabled ? 'bg-indigo-600' : 'bg-slate-300',
                (!canEdit || saving) ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
              ].join(' ')}
            >
              <span
                className={[
                  'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
                  enabled ? 'translate-x-6' : 'translate-x-1',
                ].join(' ')}
              />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default BotPauseSettingsCard;
