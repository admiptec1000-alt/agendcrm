import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Loader2, Bell, MessageSquare, Calendar as CalendarIcon } from 'lucide-react';
import api from '../services/api';

/**
 * BillingReminderPanel — global config for the billing reminder scheduler.
 * 2026-02-16 (K). Lives under sidebar Conexoes -> Notificacoes de Cobranca.
 *
 * Endpoints: GET/PUT /api/super-admin/billing-reminder-settings.
 *
 * The scheduler (backend/scheduler.py::_process_billing_reminders) reads this
 * doc each tick and uses:
 *   - enabled: master on/off
 *   - days_before_due: how many days before the parcela due_date to fire
 *   - channel: whatsapp | email | both (currently only whatsapp wired)
 *   - default_message: template with {{nome}}, {{empresa}}, {{valor}},
 *                      {{vencimento}}, {{parcela}}
 */
const BillingReminderPanel = () => {
  const [form, setForm] = useState({
    enabled: true,
    days_before_due: 10,
    channel: 'whatsapp',
    default_message: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get('/super-admin/billing-reminder-settings')
      .then(r => {
        if (cancelled) return;
        setForm({
          enabled: !!r.data?.enabled,
          days_before_due: Number(r.data?.days_before_due ?? 10),
          channel: r.data?.channel || 'whatsapp',
          default_message: r.data?.default_message || '',
        });
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/super-admin/billing-reminder-settings', {
        enabled: form.enabled,
        days_before_due: Math.max(0, Math.min(60, parseInt(form.days_before_due, 10) || 0)),
        channel: form.channel,
        default_message: form.default_message,
      });
      toast.success('Configuracao salva.');
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-4" data-testid="billing-reminder-panel">
      <p className="text-sm text-slate-600 mb-4">
        Lembrete automatico de cobranca enviado X dias antes do vencimento de cada parcela
        cadastrada nas empresas. O sistema cria o Lancamento e dispara a mensagem via
        WhatsApp da conexao do Super Admin.
      </p>

      {/* Master toggle */}
      <div className="card max-w-2xl">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-50 text-indigo-600 shrink-0">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Lembretes de cobranca ativos</h3>
              <p className="text-xs text-slate-500 mt-1">
                Quando desligado, nenhum Lancamento automatico ou lembrete sera criado.
              </p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              className="sr-only peer"
              data-testid="billing-reminder-enabled"
            />
            <div className="w-11 h-6 bg-slate-200 rounded-full peer peer-checked:bg-indigo-600 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-transform peer-checked:after:translate-x-5"></div>
          </label>
        </div>
      </div>

      {/* Days + Channel */}
      <div className="card max-w-2xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center gap-2">
              <CalendarIcon className="w-4 h-4 text-slate-500" />
              Dias antes do vencimento
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={60}
                value={form.days_before_due}
                onChange={(e) => setForm({ ...form, days_before_due: e.target.value })}
                className="input-field w-28"
                data-testid="billing-reminder-days"
                disabled={!form.enabled}
              />
              <span className="text-sm text-slate-600">dias</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Recomendado: 10. Permitido: 0 a 60.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Canal de envio
            </label>
            <div className="flex gap-2">
              {['whatsapp', 'email', 'both'].map(ch => (
                <button
                  key={ch}
                  type="button"
                  disabled={!form.enabled}
                  onClick={() => setForm({ ...form, channel: ch })}
                  data-testid={`billing-reminder-channel-${ch}`}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-all ${
                    form.channel === ch
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'
                  } disabled:opacity-50`}
                >
                  {ch === 'whatsapp' ? 'WhatsApp' : ch === 'email' ? 'Email' : 'Ambos'}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Email ainda nao implementado — somente WhatsApp eh disparado hoje.
            </p>
          </div>
        </div>
      </div>

      {/* Default message */}
      <div className="card max-w-2xl">
        <div className="flex items-center gap-2 mb-2">
          <MessageSquare className="w-5 h-5 text-slate-500" />
          <h3 className="font-semibold text-slate-900">Mensagem padrao</h3>
        </div>
        <p className="text-xs text-slate-500 mb-3">
          Variaveis disponiveis:
          <code className="ml-1 px-1.5 py-0.5 bg-slate-100 rounded text-[11px] font-mono">{'{{nome}}'}</code>
          <code className="ml-1 px-1.5 py-0.5 bg-slate-100 rounded text-[11px] font-mono">{'{{empresa}}'}</code>
          <code className="ml-1 px-1.5 py-0.5 bg-slate-100 rounded text-[11px] font-mono">{'{{valor}}'}</code>
          <code className="ml-1 px-1.5 py-0.5 bg-slate-100 rounded text-[11px] font-mono">{'{{vencimento}}'}</code>
          <code className="ml-1 px-1.5 py-0.5 bg-slate-100 rounded text-[11px] font-mono">{'{{parcela}}'}</code>
        </p>
        <textarea
          rows={5}
          maxLength={2000}
          value={form.default_message}
          onChange={(e) => setForm({ ...form, default_message: e.target.value })}
          disabled={!form.enabled}
          placeholder={'Ola {{nome}}! Sua mensalidade no valor de R$ {{valor}} vence em {{vencimento}} (parcela {{parcela}}). Em caso de duvida nos chame.'}
          className="input-field font-mono text-sm w-full disabled:bg-slate-50"
          data-testid="billing-reminder-message"
        />
        <p className="text-[11px] text-slate-400 mt-1">
          {(form.default_message || '').length}/2000
        </p>
      </div>

      <div className="max-w-2xl flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          data-testid="billing-reminder-save"
          className="btn-primary"
        >
          {saving ? 'Salvando...' : 'Salvar configuracao'}
        </button>
      </div>
    </div>
  );
};

export default BillingReminderPanel;
