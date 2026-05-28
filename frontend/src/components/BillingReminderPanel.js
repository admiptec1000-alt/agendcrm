import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Loader2, Bell, MessageSquare, Calendar as CalendarIcon, Percent } from 'lucide-react';
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
    days_before_due_list: [10],
    lancamento_gen_days: 10,
    default_late_fee_enabled: false,
    default_late_fee_multa_pct: 0,
    default_late_fee_juros_dia_pct: 0,
    channel: 'whatsapp',
    default_message: '',
    // 2026-05-28 — Chave Pix em msg separada (facil de copiar no celular)
    pix_key: '',
    pix_send_separate: false,
  });
  const [daysInput, setDaysInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get('/super-admin/billing-reminder-settings')
      .then(r => {
        if (cancelled) return;
        const list = Array.isArray(r.data?.days_before_due_list) && r.data.days_before_due_list.length
          ? r.data.days_before_due_list
          : [Number(r.data?.days_before_due ?? 10)];
        setForm({
          enabled: !!r.data?.enabled,
          days_before_due_list: list.map(Number),
          lancamento_gen_days: Number(r.data?.lancamento_gen_days ?? 10),
          default_late_fee_enabled: !!r.data?.default_late_fee_enabled,
          default_late_fee_multa_pct: Number(r.data?.default_late_fee_multa_pct ?? 0),
          default_late_fee_juros_dia_pct: Number(r.data?.default_late_fee_juros_dia_pct ?? 0),
          channel: r.data?.channel || 'whatsapp',
          default_message: r.data?.default_message || '',
          pix_key: r.data?.pix_key || '',
          pix_send_separate: !!r.data?.pix_send_separate,
        });
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const addDay = () => {
    const n = parseInt(daysInput, 10);
    if (Number.isNaN(n) || n < -30 || n > 60) {
      toast.error('Informe um valor entre -30 (dias apos) e 60 (dias antes)');
      return;
    }
    if (form.days_before_due_list.includes(n)) {
      setDaysInput('');
      return;
    }
    const next = [...form.days_before_due_list, n].sort((a, b) => b - a);
    setForm({ ...form, days_before_due_list: next });
    setDaysInput('');
  };

  const removeDay = (n) => {
    const next = form.days_before_due_list.filter(d => d !== n);
    setForm({ ...form, days_before_due_list: next.length ? next : [10] });
  };

  const chipLabel = (d) => {
    if (d === 0) return 'no vencimento';
    if (d > 0) return `${d}d antes`;
    return `${Math.abs(d)}d apos`;
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/super-admin/billing-reminder-settings', {
        enabled: form.enabled,
        days_before_due_list: form.days_before_due_list,
        lancamento_gen_days: Math.max(0, Math.min(180, parseInt(form.lancamento_gen_days, 10) || 0)),
        default_late_fee_enabled: !!form.default_late_fee_enabled,
        default_late_fee_multa_pct: Math.max(0, Math.min(100, parseFloat(form.default_late_fee_multa_pct) || 0)),
        default_late_fee_juros_dia_pct: Math.max(0, Math.min(100, parseFloat(form.default_late_fee_juros_dia_pct) || 0)),
        channel: form.channel,
        default_message: form.default_message,
        pix_key: form.pix_key || '',
        pix_send_separate: !!form.pix_send_separate,
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
            <div className="flex flex-wrap items-center gap-2 mb-2" data-testid="billing-reminder-days-list">
              {form.days_before_due_list.map(d => (
                <span
                  key={d}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                    d > 0 ? 'bg-indigo-100 text-indigo-700' :
                    d === 0 ? 'bg-amber-100 text-amber-700' :
                    'bg-rose-100 text-rose-700'
                  }`}
                  data-testid={`billing-reminder-day-chip-${d}`}
                >
                  {chipLabel(d)}
                  <button
                    type="button"
                    onClick={() => removeDay(d)}
                    disabled={!form.enabled}
                    className="hover:opacity-70 disabled:opacity-50"
                    aria-label={`Remover ${d} dias`}
                  >
                    x
                  </button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={-30}
                max={60}
                value={daysInput}
                onChange={(e) => setDaysInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDay(); } }}
                placeholder="ex: 3 ou -1"
                className="input-field w-28"
                data-testid="billing-reminder-day-input"
                disabled={!form.enabled}
              />
              <button
                type="button"
                onClick={addDay}
                disabled={!form.enabled || daysInput === ''}
                data-testid="billing-reminder-add-day"
                className="btn-secondary text-sm px-3 py-1.5"
              >
                + Adicionar
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Positivo = antes do vencimento. <strong>0</strong> = no dia. <strong>Negativo</strong> = apos vencimento (cobranca atrasada). Ex: 10, 3, 1, 0, -1, -3.
              O sistema envia apenas 1 lembrete por dia (o mais proximo de hoje).
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
          <CalendarIcon className="w-5 h-5 text-slate-500" />
          <h3 className="font-semibold text-slate-900">Geracao automatica do Lancamento</h3>
        </div>
        <p className="text-xs text-slate-500 mb-3">
          Dias antes do vencimento em que o sistema cria automaticamente o Lancamento
          financeiro da proxima parcela. Tambem dispara imediatamente ao cadastrar uma
          empresa cujo 1o vencimento esta dentro desse intervalo.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={180}
            value={form.lancamento_gen_days}
            onChange={(e) => setForm({ ...form, lancamento_gen_days: e.target.value })}
            className="input-field w-28"
            data-testid="billing-reminder-gen-days"
            disabled={!form.enabled}
          />
          <span className="text-sm text-slate-600">dias antes do vencimento</span>
        </div>
        <p className="text-[11px] text-slate-500 mt-1">
          Recomendado: 10. Permitido: 0 a 180. Independente dos lembretes (acima),
          esse parametro controla apenas quando a parcela aparece no Financeiro Admin.
        </p>
      </div>

      {/* Multa + Juros padrao — 2026-02-16 (O). Aplicados em cada Lancamento
          auto gerado pelo scheduler. Operador pode sobrescrever por parcela
          no form de edicao. */}
      <div className="card max-w-2xl">
        <div className="flex items-center justify-between gap-4 mb-2">
          <div className="flex items-center gap-2">
            <Percent className="w-5 h-5 text-slate-500" />
            <h3 className="font-semibold text-slate-900">Multa e juros por atraso</h3>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={form.default_late_fee_enabled}
              onChange={(e) => setForm({ ...form, default_late_fee_enabled: e.target.checked })}
              className="sr-only peer"
              data-testid="billing-late-fee-enabled"
            />
            <div className="w-11 h-6 bg-slate-200 rounded-full peer peer-checked:bg-indigo-600 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-transform peer-checked:after:translate-x-5"></div>
          </label>
        </div>
        <p className="text-xs text-slate-500 mb-3">
          Quando ativo, todo novo Lancamento de licenca gerado automaticamente
          recebe estes parametros. Voce ainda pode sobrescrever por parcela no
          form de edicao do lancamento.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Multa unica (%)</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={form.default_late_fee_multa_pct}
              onChange={(e) => setForm({ ...form, default_late_fee_multa_pct: e.target.value })}
              disabled={!form.enabled || !form.default_late_fee_enabled}
              className="input-field text-sm w-full"
              data-testid="billing-late-fee-multa"
            />
            <p className="text-[11px] text-slate-500 mt-1">Aplicada uma vez sobre o valor original.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Juros ao dia (%)</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={form.default_late_fee_juros_dia_pct}
              onChange={(e) => setForm({ ...form, default_late_fee_juros_dia_pct: e.target.value })}
              disabled={!form.enabled || !form.default_late_fee_enabled}
              className="input-field text-sm w-full"
              data-testid="billing-late-fee-juros"
            />
            <p className="text-[11px] text-slate-500 mt-1">Acumula por cada dia em atraso.</p>
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
          {/* 2026-02-18 — Variaveis novas */}
          <code className="ml-1 px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded text-[11px] font-mono">{'{{licencas_conexao}}'}</code>
          <code className="ml-1 px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded text-[11px] font-mono">{'{{licencas_usuario}}'}</code>
          <code className="ml-1 px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded text-[11px] font-mono">{'{{valor_venda_total}}'}</code>
          <code className="ml-1 px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded text-[11px] font-mono">{'{{valor_desconto}}'}</code>
          <code className="ml-1 px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded text-[11px] font-mono">{'{{valor_liquido}}'}</code>
          <code className="ml-1 px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded text-[11px] font-mono">{'{{valor_acrescimo}}'}</code>
          <code className="ml-1 px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded text-[11px] font-mono">{'{{valor_devido}}'}</code>
          {/* 2026-05-26 — Total da venda ja descontado (alternativa ao
              valor_devido que eh per-parcela). */}
          <code className="ml-1 px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded text-[11px] font-mono">{'{{valor_total_liquido}}'}</code>
        </p>
        <p className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md p-2 mb-3 mt-1 leading-relaxed">
          <strong>Aviso importante:</strong> mensagens automaticas SO sao enviadas pelo
          tick periodico do scheduler quando o prazo configurado em &quot;Antes do vencimento&quot;
          bater. Editar esta mensagem ou salvar uma empresa <strong>NAO</strong> dispara
          envio (corrigido em 2026-02-18).
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

      {/* 2026-05-28 — Chave Pix em mensagem separada (facil de copiar
          no celular do cliente). Quando habilitado, apos a notificacao
          principal o sistema envia UMA segunda mensagem contendo APENAS
          a chave Pix. O cliente toca + segura -> Copiar. */}
      <div className="max-w-2xl p-4 rounded-xl border border-emerald-200 bg-emerald-50/40" data-testid="pix-key-section">
        <h3 className="font-semibold text-slate-900 mb-2 text-sm">Chave Pix (mensagem separada)</h3>
        <label className="flex items-start gap-2 cursor-pointer mb-3">
          <input
            type="checkbox"
            checked={form.pix_send_separate}
            onChange={(e) => setForm({ ...form, pix_send_separate: e.target.checked })}
            className="mt-0.5"
            data-testid="pix-send-separate"
          />
          <span className="text-xs text-slate-700">
            <strong>Enviar Pix em 2a mensagem</strong> apos a notificacao de cobranca<br/>
            <span className="text-slate-500">Facilita ao cliente copiar a chave no WhatsApp (toca+segura -&gt; Copiar). Sem layouts complexos que travam botoes em alguns aparelhos.</span>
          </span>
        </label>
        <label className="block text-xs font-medium text-slate-600 mb-1">Chave Pix</label>
        <input
          type="text"
          value={form.pix_key}
          onChange={(e) => setForm({ ...form, pix_key: e.target.value })}
          placeholder="00.000.000/0001-00, +55 11 99999-9999, email@empresa.com ou chave aleatoria"
          className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
          data-testid="pix-key-input"
          maxLength={200}
          disabled={!form.pix_send_separate}
        />
        <p className="text-[10px] text-slate-500 mt-1">
          Texto livre — pode ser CPF/CNPJ, telefone, email ou chave aleatoria. So eh enviada quando a cobranca principal eh entregue com sucesso.
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
