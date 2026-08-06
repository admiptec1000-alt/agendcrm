import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Ticket, Loader2, MessageSquare } from 'lucide-react';
import api from '../services/api';

/**
 * TicketLifecycleSettingsCard — controls the company-wide ticket inactivity
 * timeout AND the goodbye message sent right before auto-closing.
 *
 *   ticket_auto_close_hours    — after N hours without any new message,
 *                                the background scheduler closes the ticket. 0 = disabled.
 *   ticket_auto_close_message  — optional text sent to the contact right
 *                                before closing. Supports `{{nome}}` and `{{empresa}}`.
 *
 * Backend endpoints: GET/PUT /api/crm/company/ticket-settings.
 */
const TicketLifecycleSettingsCard = ({ canEdit = true }) => {
  const [hours, setHours] = useState(48);
  const [message, setMessage] = useState('');
  const [initialMessage, setInitialMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // 2026-05-28 — Flag para enviar a MESMA mensagem no fechamento MANUAL
  // do ticket pelo operador (alem do auto-close por inatividade).
  const [sendOnManual, setSendOnManual] = useState(false);
  // 2026-07-27 — Cooldown em dias: se ja enviei a msg de encerramento
  // pro mesmo telefone/empresa nesse periodo, NAO envia de novo, so fecha.
  const [cooldownDays, setCooldownDays] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.get('/crm/company/ticket-settings')
      .then(r => {
        if (cancelled) return;
        setHours(Number(r.data?.ticket_auto_close_hours || 0));
        const msg = r.data?.ticket_auto_close_message || '';
        setMessage(msg);
        setInitialMessage(msg);
        setSendOnManual(!!r.data?.send_close_message_on_manual);
        setCooldownDays(Number(r.data?.close_message_cooldown_days || 0));
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

  const commitMessage = async () => {
    if (!canEdit) return;
    if (message === initialMessage) return;
    const trimmed = (message || '').slice(0, 1000);
    try {
      await save({ ticket_auto_close_message: trimmed });
      setInitialMessage(trimmed);
    } catch (_) {}
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
        <div className="pl-0 md:pl-16 space-y-6">
          <div>
            <p className="font-medium text-sm text-slate-800">Fechar tickets sem movimentacao apos</p>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed mb-3">
              Apos esse tempo sem nenhuma mensagem nova, o ticket eh fechado automaticamente.
              <strong> 0 = desativado</strong>. Recomendado: <strong>48h</strong>.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
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

          <div className="border-t border-slate-100 pt-5">
            <div className="flex items-center gap-2 mb-1">
              <MessageSquare className="w-4 h-4 text-slate-500" />
              <p className="font-medium text-sm text-slate-800">Mensagem de encerramento</p>
            </div>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed mb-3">
              Mensagem enviada ao cliente <strong>antes</strong> do fechamento automatico do ticket.
              Use <code className="px-1 py-0.5 bg-slate-100 rounded text-[11px] font-mono">{'{{nome}}'}</code> para o nome do contato e
              <code className="ml-1 px-1 py-0.5 bg-slate-100 rounded text-[11px] font-mono">{'{{empresa}}'}</code> para o nome da empresa.
              Deixe vazio para nao enviar nada.
            </p>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onBlur={commitMessage}
              disabled={!canEdit || saving || hours === 0}
              data-testid="ticket-auto-close-message-input"
              rows={4}
              maxLength={1000}
              placeholder="Ex: Ola {{nome}}! Estamos encerrando este atendimento por inatividade. Caso ainda precise de ajuda, basta nos enviar uma nova mensagem."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 resize-y font-mono disabled:bg-slate-50 disabled:text-slate-400"
            />
            <div className="flex items-center justify-between mt-1">
              <p className="text-[11px] text-slate-400">
                {hours === 0 ? 'Ative o fechamento automatico para usar a mensagem.' : `${(message || '').length}/1000`}
              </p>
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
            </div>

            {/* 2026-07-27 — Cooldown por dias: nao reenvia a mensagem se
                ja enviei ao mesmo contato dentro do periodo. */}
            <div className="mt-4 pt-4 border-t border-slate-100">
              <p className="font-medium text-sm text-slate-800">Nao reenviar por (dias)</p>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed mb-3">
                Se ja enviei a mensagem de encerramento a este contato dentro deste periodo,
                o sistema apenas finaliza o atendimento sem enviar a mensagem novamente.
                Vale tanto pro fechamento automatico quanto pro manual.
                <strong> 0 = desativado</strong> (sempre envia).
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="number"
                  min={0}
                  max={365}
                  step={1}
                  value={cooldownDays}
                  onChange={(e) => setCooldownDays(e.target.value)}
                  onBlur={async (e) => {
                    if (!canEdit) return;
                    const n = Math.max(0, Math.min(365, Math.floor(Number(e.target.value) || 0)));
                    setCooldownDays(n);
                    try { await save({ close_message_cooldown_days: n }); } catch (_) {}
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                  disabled={!canEdit || saving}
                  data-testid="close-message-cooldown-days-input"
                  className="w-24 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
                <span className="text-sm text-slate-600">dias</span>
                {cooldownDays > 0 && (
                  <span className="ml-2 text-[10px] px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 font-semibold">
                    Ativo · nao reenvia por {cooldownDays}d
                  </span>
                )}
              </div>
            </div>
          </div>

          {!canEdit && (
            <p className="text-xs text-amber-600">Apenas administradores podem alterar.</p>
          )}

          {/* 2026-05-28 — Toggle: enviar a mesma mensagem quando o operador
              fecha MANUALMENTE o ticket. */}
          <div className="border-t border-slate-100 pt-5">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={sendOnManual}
                onChange={async (e) => {
                  const v = e.target.checked;
                  setSendOnManual(v);
                  try { await save({ send_close_message_on_manual: v }); } catch (_) {}
                }}
                disabled={!canEdit || saving}
                data-testid="send-close-on-manual"
                className="mt-0.5"
              />
              <span className="text-xs text-slate-700">
                <strong>Enviar tambem no fechamento MANUAL</strong> do atendimento<br/>
                <span className="text-slate-500">Quando habilitado, a mesma mensagem acima eh enviada ao cliente toda vez que o operador clica em "Encerrar atendimento" no painel. Desligado por padrao.</span>
              </span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
};

export default TicketLifecycleSettingsCard;
