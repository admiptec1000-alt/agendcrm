import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Ticket, Loader2 } from 'lucide-react';
import api from '../services/api';

/**
 * TicketLifecycleSettingsCard — controls two ticket lifecycle behaviors
 * exposed to company admins under /configuracoes:
 *
 *   1. sgp_gateway_auto_close — when a message is sent through the public
 *      SGP-gateway endpoint, automatically close the ticket on success.
 *      Useful for one-shot notifications (Pix link, payment reminder)
 *      that shouldn't leave open tickets piling up.
 *
 *   2. ticket_auto_close_hours — after N hours without any new message,
 *      the background scheduler closes the ticket. 0 = disabled.
 *
 * Backend endpoints: GET/PUT /api/crm/company/ticket-settings.
 */
const TicketLifecycleSettingsCard = ({ canEdit = true }) => {
  const [autoClose, setAutoClose] = useState(true);
  const [hours, setHours] = useState(48);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get('/crm/company/ticket-settings')
      .then(r => {
        if (cancelled) return;
        setAutoClose(!!r.data?.sgp_gateway_auto_close);
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

  const toggleAutoClose = async () => {
    if (!canEdit || saving) return;
    const next = !autoClose;
    setAutoClose(next);
    try { await save({ sgp_gateway_auto_close: next }); }
    catch (_) { setAutoClose(!next); }
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
            Regras automaticas para fechamento de tickets. Util para nao acumular
            conversas eternamente abertas e separar notificacoes do SGP do
            atendimento humano.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
      ) : (
        <div className="space-y-5 pl-0 md:pl-16">
          {/* SGP auto-close toggle */}
          <div className="flex items-start gap-4">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm text-slate-800">Fechar tickets criados pelo SGP Gateway automaticamente</p>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Mensagens enviadas pelo SGP Gateway (Pix, lembrete de boleto, etc) abrem
                o ticket, enviam, e <strong>fecham na mesma hora</strong>. Se o cliente
                responder depois, um <strong>novo ticket</strong> e aberto automaticamente.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoClose}
              onClick={toggleAutoClose}
              disabled={!canEdit || saving}
              data-testid="sgp-auto-close-toggle"
              className={[
                'relative inline-flex h-7 w-12 items-center rounded-full transition-colors shrink-0',
                autoClose ? 'bg-emerald-600' : 'bg-slate-300',
                (!canEdit || saving) ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
              ].join(' ')}
            >
              <span className={[
                'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
                autoClose ? 'translate-x-6' : 'translate-x-1',
              ].join(' ')} />
            </button>
          </div>

          <div className="border-t border-slate-100" />

          {/* Inactivity timeout */}
          <div>
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
          </div>

          {!canEdit && (
            <p className="text-xs text-amber-600">Apenas administradores podem alterar.</p>
          )}
        </div>
      )}
    </div>
  );
};

export default TicketLifecycleSettingsCard;
