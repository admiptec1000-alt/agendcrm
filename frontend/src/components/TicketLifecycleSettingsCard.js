import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Ticket, Loader2 } from 'lucide-react';
import api from '../services/api';

/**
 * TicketLifecycleSettingsCard — controls the company-wide ticket inactivity
 * timeout. The per-gateway "auto-close on SGP send" toggle lives in the
 * SGP Gateway page (segunda tela / edit modal), so it's NOT included here
 * anymore.
 *
 *   ticket_auto_close_hours — after N hours without any new message,
 *   the background scheduler closes the ticket. 0 = disabled.
 *
 * Backend endpoints: GET/PUT /api/crm/company/ticket-settings.
 */
const TicketLifecycleSettingsCard = ({ canEdit = true }) => {
  const [hours, setHours] = useState(48);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get('/crm/company/ticket-settings')
      .then(r => {
        if (cancelled) return;
        setHours(Number(r.data?.ticket_auto_close_hours || 0));
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const save = async (next) => {
    setSaving(true);
    try {
      await api.put('/crm/company/ticket-settings', next);
      toast.success('Configuracao salva.');
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Falha ao salvar.');
      throw e;
    } finally {
      setSaving(false);
    }
  };

  const commitHours = async (value) => {
    if (!canEdit) return;
    const n = Math.max(0, Math.min(720, Math.floor(Number(value) || 0)));
    setHours(n);
    try { await save({ ticket_auto_close_hours: n }); }
    catch (_) {}
  };

  return (
    <div className="card max-w-2xl mb-6" data-testid="ticket-lifecycle-settings-card">
      <div className="flex items-start gap-4 mb-5">
        <div className="p-3 rounded-xl bg-emerald-50 text-emerald-600 shrink-0">
          <Ticket className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-900">Ciclo de vida dos atendimentos</h3>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            Fechar automaticamente atendimentos parados ha muito tempo. Ajuda a
            manter a caixa de entrada limpa sem ter que fechar cada ticket
            manualmente.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
      ) : (
        <div className="pl-0 md:pl-16">
          <p className="font-medium text-sm text-slate-800">Fechar tickets sem movimentacao apos</p>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed mb-3">
            Apos esse tempo sem nenhuma mensagem nova, o ticket eh fechado automaticamente.
            <strong> 0 = desativado</strong>. Recomendado: <strong>48h</strong>.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={720}
              step={1}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              onBlur={(e) => commitHours(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              disabled={!canEdit || saving}
              data-testid="ticket-auto-close-hours-input"
              className="w-24 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            />
            <span className="text-sm text-slate-600">horas</span>
            {hours > 0 && (
              <span className="ml-2 text-[10px] px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 font-semibold">
                Ativo · {hours >= 24 ? `${Math.round(hours/24)}d` : `${hours}h`}
              </span>
            )}
          </div>
          {!canEdit && (
            <p className="text-xs text-amber-600 mt-3">Apenas administradores podem alterar.</p>
          )}
        </div>
      )}
    </div>
  );
};

export default TicketLifecycleSettingsCard;
