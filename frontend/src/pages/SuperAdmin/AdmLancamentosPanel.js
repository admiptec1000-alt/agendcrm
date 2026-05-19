import React, { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import api from '../../services/api';
import {
  Plus, Trash2, RefreshCw, TrendingUp, TrendingDown,
  CheckCircle2, Clock, AlertTriangle, X, Repeat, Percent, Building,
} from 'lucide-react';

const fmt = (v) => `R$ ${Number(v || 0).toFixed(2)}`;

// Pagamento unificado: o operador escolhe Pix/Boleto/Dinheiro pra dar baixa
// direto da lista. "Aberto" = ainda nao pago (status=pendente OR ausente).
const PAYMENT_METHODS = [
  { value: 'pix',      label: 'Pix' },
  { value: 'boleto',   label: 'Boleto' },
  { value: 'dinheiro', label: 'Dinheiro' },
];
const labelForMethod = (m) => (PAYMENT_METHODS.find(x => x.value === m)?.label || m || '—');

/**
 * Financeiro ADM — Lancamentos
 * Mirrors the company-level Financial > Lançamentos tab but stored in the
 * `super_admin_transactions` collection (saas operator's own books).
 *
 * Shared features added this iteration:
 *  • Recurrence (mensal/semanal/anual) — auto-generates future occurrences
 *  • Late-fee (multa + juros) — UI toggle + percentages, backend computes
 *    `valor_devido` for overdue pending bills.
 */
export const AdmLancamentosPanel = () => {
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [filters, setFilters] = useState({ direction: '', status: '', kind: '' });
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tx, sm] = await Promise.all([
        api.get('/super-admin/finance/transactions', { params: filters }),
        api.get('/super-admin/finance/summary'),
      ]);
      setItems(tx.data || []);
      setSummary(sm.data || null);
    } catch (e) {
      toast.error('Erro ao carregar lancamentos');
    } finally {
      setLoading(false);
    }
  }, [filters]);
  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id) => {
    if (!window.confirm('Excluir este lancamento? A acao nao pode ser desfeita.')) return;
    try {
      await api.delete(`/super-admin/finance/transactions/${id}`);
      toast.success('Lancamento excluido');
      load();    } catch (e) {
      toast.error('Falha ao excluir');
    }
  };

  // Pay with a specific method (Pix/Boleto/Dinheiro). Shows a 5s "Desfazer"
  // toast — clicking it reverts the txn to status=pendente. The user
  // explicitly asked for direct action with undo (2026-02-15 (E)).
  const handlePayWithMethod = async (id, method) => {
    try {
      await api.post(`/super-admin/finance/transactions/${id}/pay`, { payment_method: method });
      load();
      toast.success(`Baixa em ${labelForMethod(method)}`, {
        action: {
          label: 'Desfazer',
          onClick: async () => {
            try {
              await api.post(`/super-admin/finance/transactions/${id}/unpay`);
              toast.info('Baixa desfeita');
              load();
            } catch (_) {
              toast.error('Nao foi possivel desfazer');
            }
          },
        },
        duration: 5000,
      });
    } catch (e) {
      toast.error('Falha ao dar baixa');
    }
  };

  return (
    <div className="space-y-4" data-testid="adm-lancamentos-panel">
      {/* Hero metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard label="Entradas pagas" value={fmt(summary?.bruto)} icon={TrendingUp} color="emerald" />
        <MetricCard label="Saidas pagas" value={fmt(summary?.saidas)} icon={TrendingDown} color="rose" />
        <MetricCard label="Liquido" value={fmt(summary?.liquido)} icon={CheckCircle2} color={(summary?.liquido || 0) >= 0 ? 'emerald' : 'rose'} />
        <MetricCard label="Pendente (entradas)" value={fmt(summary?.pendente_entrada)} icon={Clock} color="amber" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filters.direction}
          onChange={(e) => setFilters({ ...filters, direction: e.target.value })}
          className="px-3 py-2 border border-slate-300 rounded text-sm"
          data-testid="adm-filter-direction"
        >
          <option value="">Todas direcoes</option>
          <option value="entrada">Entradas</option>
          <option value="saida">Saidas</option>
        </select>
        <select
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          className="px-3 py-2 border border-slate-300 rounded text-sm"
          data-testid="adm-filter-status"
        >
          <option value="">Todos pagamentos</option>
          <option value="pendente">Em aberto</option>
          <option value="pago">Baixados</option>
        </select>
        <select
          value={filters.kind}
          onChange={(e) => setFilters({ ...filters, kind: e.target.value })}
          className="px-3 py-2 border border-slate-300 rounded text-sm"
          data-testid="adm-filter-kind"
        >
          <option value="">Todos tipos</option>
          <option value="licenca">Licenca</option>
          <option value="diversos">Diversos</option>
        </select>
        <button onClick={load} className="px-3 py-2 text-sm rounded border border-slate-300 hover:bg-slate-50 flex items-center gap-1" data-testid="adm-refresh-btn">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
        </button>
        <button
          onClick={() => setShowForm(true)}
          className="ml-auto px-4 py-2 bg-primary text-white rounded text-sm font-semibold flex items-center gap-1.5"
          data-testid="adm-new-txn-btn"
        >
          <Plus className="w-4 h-4" /> Novo Lancamento
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2 text-left">Data</th>
                <th className="px-3 py-2 text-left">Tipo</th>
                <th className="px-3 py-2 text-left">Descricao</th>
                <th className="px-3 py-2 text-left">Categoria</th>
                <th className="px-3 py-2 text-right">Valor</th>
                <th className="px-3 py-2 text-center">Pagamento</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-400">Nenhum lancamento encontrado.</td></tr>
              )}
              {items.map(t => {
                const isOut = t.direction === 'saida';
                const overdue = t.late_fee_computed && t.late_fee_computed.days_overdue > 0;
                return (
                  <tr key={t.id} data-testid={`adm-txn-row-${t.id}`} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-700 font-mono text-xs">{(t.due_date || t.date || '').slice(0,10)}</td>
                    <td className="px-3 py-2">
                      {t.kind === 'licenca' ? (
                        <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 bg-violet-50 text-violet-700 rounded font-medium">
                          <Building className="w-3 h-3" /> Licenca
                        </span>
                      ) : (
                        <span className="inline-block text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded font-medium">Diversos</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">{t.description}</div>
                      {(t.company_id || t.external_client_name) && (
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          Cliente: {t.external_client_name || t.company_id?.slice(0, 8)}
                          {t.license_connections !== undefined && t.license_connections !== null && (
                            <> · {t.license_connections}c</>
                          )}
                          {t.license_users !== undefined && t.license_users !== null && (
                            <> · {t.license_users}u</>
                          )}
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-0.5">
                        {t.recurrence_group_id && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded font-medium">
                            <Repeat className="w-3 h-3" /> {t.recurrence_index + 1}/{t.recurrence_total} {t.recurrence_interval}
                          </span>
                        )}
                        {t.late_fee?.enabled && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded font-medium">
                            <Percent className="w-3 h-3" /> multa/juros
                          </span>
                        )}
                        {overdue && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 bg-rose-50 text-rose-700 rounded font-medium">
                            <AlertTriangle className="w-3 h-3" /> +{t.late_fee_computed.days_overdue}d · {fmt(t.late_fee_computed.total)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-slate-500">{t.category || '—'}</td>
                    <td className={`px-3 py-2 text-right font-semibold ${isOut ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {isOut ? '−' : '+'} {fmt(t.amount)}
                      {overdue && (
                        <div className="text-[10px] text-slate-500 font-normal">Devido: {fmt(t.late_fee_computed.valor_devido)}</div>
                      )}
                    </td>
                    {/* Pagamento unificado — quando 'Aberto' o operador clica
                        em Pix/Boleto/Dinheiro pra dar baixa direto. Quando ja
                        pago, mostra o metodo com check verde. 2026-02-15 (E). */}
                    <td className="px-3 py-2 text-center">
                      {t.status === 'pago' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded text-xs font-medium" data-testid={`adm-paid-${t.id}`}>
                          <CheckCircle2 className="w-3 h-3" /> {labelForMethod(t.payment_method)}
                        </span>
                      ) : (
                        <div className="inline-flex items-center gap-1" data-testid={`adm-open-${t.id}`}>
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded text-[10px] font-semibold uppercase">
                            <Clock className="w-3 h-3" /> Aberto
                          </span>
                          {PAYMENT_METHODS.map(pm => (
                            <button
                              key={pm.value}
                              onClick={() => handlePayWithMethod(t.id, pm.value)}
                              className="text-[10px] px-1.5 py-0.5 rounded border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 transition-colors"
                              title={`Baixar como ${pm.label}`}
                              data-testid={`adm-pay-${pm.value}-${t.id}`}
                            >
                              {pm.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => handleDelete(t.id)}
                        className="p-1.5 hover:bg-rose-50 rounded text-rose-500"
                        title="Excluir"
                        data-testid={`adm-delete-${t.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && <AdmTxnFormModal onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />}
    </div>
  );
};

const MetricCard = ({ label, value, icon: Icon, color }) => {
  const colors = {
    emerald: 'bg-emerald-50 text-emerald-600',
    rose: 'bg-rose-50 text-rose-600',
    amber: 'bg-amber-50 text-amber-600',
  };
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3 flex items-center gap-3">
      <div className={`p-2 rounded-lg ${colors[color] || colors.emerald}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
        <p className="text-lg font-bold text-slate-800 truncate">{value}</p>
      </div>
    </div>
  );
};

const AdmTxnFormModal = ({ onClose, onSaved }) => {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    direction: 'entrada',
    description: '',
    amount: '',
    payment_method: 'pix',
    category: 'servico',
    date: today,
    due_date: today,
    status: 'pago',
    notes: '',
    // 2026-02-15 — Tipo do lancamento (Licenca / Diversos) + cliente nativo/externo.
    kind: 'licenca',
    client_kind: 'native',         // 'native' (empresa cadastrada) | 'external'
    company_id: '',
    external_client_name: '',
    // Snapshot a partir de /usage — preenchido ao escolher a empresa.
    license_connections: '',
    license_users: '',
    license_cost: '',
    license_sale_price: '',
  });
  const [recurrence, setRecurrence] = useState({ enabled: false, interval: 'mensal', until: '' });
  const [lateFee, setLateFee] = useState({ enabled: false, multa_pct: 2.0, juros_dia_pct: 0.033 });
  const [saving, setSaving] = useState(false);
  const [companies, setCompanies] = useState([]);

  // Load companies once when the modal opens (only needed when kind=licenca
  // & client_kind=native, but we cache eagerly — list is small).
  useEffect(() => {
    api.get('/super-admin/companies').then(r => setCompanies(r.data || [])).catch(() => {});
  }, []);

  // When an Empresa is selected, fetch usage/limits and auto-populate the
  // license fields + suggested amount. Operator can still edit any field.
  const handleCompanyChange = async (companyId) => {
    setForm(f => ({ ...f, company_id: companyId }));
    if (!companyId) return;
    try {
      const { data } = await api.get(`/super-admin/licenses/usage/${companyId}`);
      const c = companies.find(co => co.id === companyId);
      setForm(f => ({
        ...f,
        license_connections: data.max_connections ?? '',
        license_users: data.max_users ?? '',
        license_cost: data.total_cost ?? '',
        license_sale_price: data.total_sale_price ?? '',
        // Suggested amount = total sale price (operator can edit).
        amount: f.amount || (data.total_sale_price ?? ''),
        description: f.description || `Licenca — ${c?.name || ''}`.trim(),
      }));
    } catch (_) {/* ignore */}
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.description.trim() || !form.amount) {
      toast.error('Preencha descricao e valor');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        amount: parseFloat(form.amount),
      };
      // New fields (2026-02-15). Only send the relevant ones — backend
      // accepts them via Optional[...] so omitting is fine.
      if (form.kind === 'licenca') {
        if (form.client_kind === 'native') {
          payload.company_id = form.company_id || null;
          payload.external_client_name = null;
        } else {
          payload.company_id = null;
          payload.external_client_name = form.external_client_name || null;
        }
        // Snapshot — convert empty strings to null
        for (const k of ['license_connections', 'license_users']) {
          payload[k] = form[k] === '' || form[k] === null ? null : parseInt(form[k], 10);
        }
        for (const k of ['license_cost', 'license_sale_price']) {
          payload[k] = form[k] === '' || form[k] === null ? null : parseFloat(form[k]);
        }
      } else {
        // Diversos — strip licenca-specific fields so they don't pollute the doc.
        payload.company_id = null;
        payload.external_client_name = null;
      }
      // Strip helper-only field — backend doesn't know about it.
      delete payload.client_kind;
      if (recurrence.enabled) {
        payload.recurrence = {
          interval: recurrence.interval,
          until: recurrence.until || null,
        };
      }
      if (lateFee.enabled) {
        payload.late_fee = {
          enabled: true,
          multa_pct: parseFloat(lateFee.multa_pct) || 0,
          juros_dia_pct: parseFloat(lateFee.juros_dia_pct) || 0,
        };
      }
      const { data } = await api.post('/super-admin/finance/transactions', payload);
      if (data._siblings_created > 0) {
        toast.success(`Lancamento + ${data._siblings_created} parcelas recorrentes criados`);
      } else {
        toast.success('Lancamento criado');
      }
      onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 my-8"
        data-testid="adm-txn-form-modal"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-slate-900">Novo Lancamento (Adm)</h2>
          <button type="button" onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* Tipo do lancamento — Licenca (vincula a empresa cadastrada/externa) OU Diversos. */}
          <Field label="Tipo">
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className="input" data-testid="adm-form-kind">
              <option value="licenca">Licenca</option>
              <option value="diversos">Diversos</option>
            </select>
          </Field>
          <Field label="Direcao">
            <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })} className="input" data-testid="adm-form-direction">
              <option value="entrada">Entrada (receber)</option>
              <option value="saida">Saida (pagar)</option>
            </select>
          </Field>
          {form.kind === 'licenca' && (
            <>
              <Field label="Cliente" className="col-span-2">
                <div className="flex gap-2 mb-2">
                  <button type="button" onClick={() => setForm({ ...form, client_kind: 'native' })}
                    className={`flex-1 px-3 py-2 text-xs font-medium rounded border ${form.client_kind === 'native' ? 'bg-primary text-white border-primary' : 'bg-white border-slate-300 text-slate-600'}`}
                    data-testid="adm-form-client-native">
                    Empresa cadastrada
                  </button>
                  <button type="button" onClick={() => setForm({ ...form, client_kind: 'external' })}
                    className={`flex-1 px-3 py-2 text-xs font-medium rounded border ${form.client_kind === 'external' ? 'bg-primary text-white border-primary' : 'bg-white border-slate-300 text-slate-600'}`}
                    data-testid="adm-form-client-external">
                    Externo (texto livre)
                  </button>
                </div>
                {form.client_kind === 'native' ? (
                  <select value={form.company_id} onChange={(e) => handleCompanyChange(e.target.value)} className="input" data-testid="adm-form-company">
                    <option value="">Selecione a empresa...</option>
                    {companies.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                ) : (
                  <input type="text" value={form.external_client_name}
                    onChange={(e) => setForm({ ...form, external_client_name: e.target.value })}
                    className="input" placeholder="Nome do cliente externo" data-testid="adm-form-external-name" />
                )}
              </Field>
              {/* License snapshot — editable. Filled automatically when picking an Empresa. */}
              <Field label="Qtd conexoes">
                <input type="number" min="0" value={form.license_connections}
                  onChange={(e) => setForm({ ...form, license_connections: e.target.value })}
                  className="input" data-testid="adm-form-license-conn" />
              </Field>
              <Field label="Qtd usuarios">
                <input type="number" min="0" value={form.license_users}
                  onChange={(e) => setForm({ ...form, license_users: e.target.value })}
                  className="input" data-testid="adm-form-license-usr" />
              </Field>
              <Field label="Custo total (R$)">
                <input type="number" step="0.01" min="0" value={form.license_cost}
                  onChange={(e) => setForm({ ...form, license_cost: e.target.value })}
                  className="input" data-testid="adm-form-license-cost" />
              </Field>
              <Field label="Valor venda total (R$)">
                <input type="number" step="0.01" min="0" value={form.license_sale_price}
                  onChange={(e) => setForm({ ...form, license_sale_price: e.target.value })}
                  className="input" data-testid="adm-form-license-sale" />
              </Field>
            </>
          )}
          {/* Pagamento unificado: 'aberto' (= status pendente, sem metodo
              definitivo) ou um dos 3 metodos baixados ja na criacao.
              2026-02-15 (E). */}
          <Field label="Pagamento">
            <select
              value={form.status === 'pago' ? form.payment_method : 'aberto'}
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'aberto') {
                  setForm({ ...form, status: 'pendente' });
                } else {
                  setForm({ ...form, status: 'pago', payment_method: v });
                }
              }}
              className="input" data-testid="adm-form-pagamento">
              <option value="aberto">Aberto</option>
              <option value="pix">Pix</option>
              <option value="boleto">Boleto</option>
              <option value="dinheiro">Dinheiro</option>
            </select>
          </Field>
          <Field label="Descricao" className="col-span-2">
            <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input" placeholder="Mensalidade plataforma — Cliente X" data-testid="adm-form-description" />
          </Field>
          <Field label="Valor (R$)">
            <input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="input" data-testid="adm-form-amount" />
          </Field>
          <Field label="Categoria">
            <input type="text" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="input" data-testid="adm-form-category" />
          </Field>
          <Field label="Data">
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="input" data-testid="adm-form-date" />
          </Field>
          <Field label="Vencimento (se pendente)" className="col-span-2">
            <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className="input" data-testid="adm-form-due-date" />
          </Field>
          <Field label="Observacoes" className="col-span-2">
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="input" data-testid="adm-form-notes" />
          </Field>
        </div>

        {/* Recurrence card */}
        <div className={`mt-4 rounded-xl border-2 p-4 transition-colors ${recurrence.enabled ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 bg-white'}`}>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={recurrence.enabled} onChange={(e) => setRecurrence({ ...recurrence, enabled: e.target.checked })} data-testid="adm-form-recurrence-enabled" />
            <Repeat className="w-4 h-4 text-indigo-600" />
            <span className="font-semibold text-sm text-slate-700">Lancamento recorrente</span>
          </label>
          {recurrence.enabled && (
            <div className="grid grid-cols-2 gap-3 mt-3">
              <Field label="Periodicidade">
                <select value={recurrence.interval} onChange={(e) => setRecurrence({ ...recurrence, interval: e.target.value })} className="input" data-testid="adm-form-recurrence-interval">
                  <option value="mensal">Mensal</option>
                  <option value="semanal">Semanal</option>
                  <option value="anual">Anual</option>
                </select>
              </Field>
              <Field label="Repetir ate (opcional)">
                <input type="date" value={recurrence.until} onChange={(e) => setRecurrence({ ...recurrence, until: e.target.value })} className="input" data-testid="adm-form-recurrence-until" />
              </Field>
              <p className="col-span-2 text-xs text-slate-600">Sera criado o lancamento atual + parcelas futuras (max 24). Cada parcela futura nasce como Pendente.</p>
            </div>
          )}
        </div>

        {/* Late fee card */}
        <div className={`mt-3 rounded-xl border-2 p-4 transition-colors ${lateFee.enabled ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={lateFee.enabled} onChange={(e) => setLateFee({ ...lateFee, enabled: e.target.checked })} data-testid="adm-form-latefee-enabled" />
            <Percent className="w-4 h-4 text-amber-600" />
            <span className="font-semibold text-sm text-slate-700">Cobrar multa e juros apos vencimento</span>
          </label>
          {lateFee.enabled && (
            <div className="grid grid-cols-2 gap-3 mt-3">
              <Field label="Multa unica (%)">
                <input type="number" step="0.01" min="0" value={lateFee.multa_pct} onChange={(e) => setLateFee({ ...lateFee, multa_pct: e.target.value })} className="input" placeholder="2.0" data-testid="adm-form-multa-pct" />
              </Field>
              <Field label="Juros por dia (%)">
                <input type="number" step="0.001" min="0" value={lateFee.juros_dia_pct} onChange={(e) => setLateFee({ ...lateFee, juros_dia_pct: e.target.value })} className="input" placeholder="0.033" data-testid="adm-form-juros-pct" />
              </Field>
              <p className="col-span-2 text-xs text-slate-600">Sistema calcula automaticamente quando atrasado: valor + multa + (juros × dias).</p>
            </div>
          )}
        </div>

        <div className="flex gap-2 mt-5">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-slate-300 rounded text-sm font-semibold hover:bg-slate-50">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-primary text-white rounded text-sm font-semibold disabled:opacity-50" data-testid="adm-form-submit">
            {saving ? 'Salvando...' : 'Criar Lancamento'}
          </button>
        </div>
      </form>
    </div>
  );
};

const Field = ({ label, children, className = '' }) => (
  <div className={className}>
    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">{label}</label>
    {children}
  </div>
);

export default AdmLancamentosPanel;
