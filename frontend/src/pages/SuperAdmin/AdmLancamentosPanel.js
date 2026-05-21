import React, { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import api from '../../services/api';
import {
  Plus, Trash2, RefreshCw, TrendingUp, TrendingDown,
  CheckCircle2, Clock, AlertTriangle, X, Repeat, Percent, Building, Pencil,
  Send, History, ChevronDown, ChevronUp, Calendar as CalendarIcon,
} from 'lucide-react';

// Returns YYYY-MM for today (used as default month filter). 2026-02-16 (M).
const _currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
// Returns [start, end) date strings (YYYY-MM-DD) for a given YYYY-MM month.
const _monthRange = (yyyymm) => {
  if (!yyyymm) return ['', ''];
  const [y, m] = yyyymm.split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const end = `${ny}-${String(nm).padStart(2, '0')}-01`;
  return [start, end];
};

// 2026-02-16 (P) — Presets de periodo. Devolve [startISO, endISO) prontos
// para enviar ao backend.
const _isoDate = (d) => d.toISOString().slice(0, 10);
const PERIOD_PRESETS = [
  { key: 'this_week', label: 'Esta semana' },
  { key: 'this_month', label: 'Este mes' },
  { key: 'last_3_months', label: 'Ult. 3 meses' },
  { key: 'custom', label: 'Mes especifico' },
];
const _periodRange = (preset, customMonth) => {
  const today = new Date();
  if (preset === 'this_week') {
    const dow = today.getDay(); // 0=Sun
    const start = new Date(today);
    start.setDate(today.getDate() - dow);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    return [_isoDate(start), _isoDate(end)];
  }
  if (preset === 'this_month') {
    return _monthRange(_currentMonth());
  }
  if (preset === 'last_3_months') {
    const start = new Date(today.getFullYear(), today.getMonth() - 2, 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    return [_isoDate(start), _isoDate(end)];
  }
  // custom — mes especifico via input type=month
  return _monthRange(customMonth || _currentMonth());
};

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
  const [companies, setCompanies] = useState([]);  // {id, name} list, 2026-02-16 (M)
  const [summary, setSummary] = useState(null);
  // 2026-02-16 (M+P) — defaults: direction=entrada, status=pendente,
  // period=this_month (com fallback custom para mes especifico).
  const [filters, setFilters] = useState({
    direction: 'entrada',
    status: 'pendente',
    kind: '',
    period: 'this_month',
    month: _currentMonth(),
  });
  const [showForm, setShowForm] = useState(false);
  const [editingTxn, setEditingTxn] = useState(null);
  // 2026-02-16 (L) — historico de lembretes por txn (modal).
  const [historyTxn, setHistoryTxn] = useState(null);
  const [resending, setResending] = useState(null);
  // 2026-02-16 (M) — controle de expansao por linha (mobile/desktop).
  const [expandedIds, setExpandedIds] = useState(new Set());
  const toggleExpand = (id) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Lookup: company_id -> { name, representante } so we can show the real
  // company name as the primary column instead of an opaque id slice.
  const companyMap = React.useMemo(() => {
    const m = {};
    for (const c of companies) m[c.id] = c;
    return m;
  }, [companies]);
  const empresaName = useCallback((t) => {
    if (t.external_client_name) return t.external_client_name;
    if (t.company_id && companyMap[t.company_id]) {
      return companyMap[t.company_id].name || t.company_id.slice(0, 8);
    }
    if (t.company_id) return t.company_id.slice(0, 8);
    return '—';
  }, [companyMap]);

  const resendReminder = async (txnId) => {
    setResending(txnId);
    try {
      await api.post(`/super-admin/finance/transactions/${txnId}/resend-reminder`);
      toast.success('Lembrete reenviado.');
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Falha ao reenviar lembrete');
    } finally {
      setResending(null);
    }
  };
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [startDate, endDate] = _periodRange(filters.period, filters.month);
      const params = {
        direction: filters.direction || undefined,
        status: filters.status || undefined,
        kind: filters.kind || undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      };
      const [tx, sm] = await Promise.all([
        api.get('/super-admin/finance/transactions', { params }),
        api.get('/super-admin/finance/summary', {
          params: { start_date: startDate || undefined, end_date: endDate || undefined },
        }),
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

  // Load company list once for the empresa-name lookup. We rely on the SA
  // companies endpoint which is paginated; pull a big page (sufficient
  // for any realistic SaaS tenant count).
  useEffect(() => {
    api.get('/super-admin/companies', { params: { limit: 1000 } })
      .then(r => {
        const list = Array.isArray(r.data) ? r.data : (r.data?.items || r.data?.companies || []);
        setCompanies(list);
      })
      .catch(() => setCompanies([]));
  }, []);

  const handleDelete = async (id) => {
    if (!window.confirm('Excluir este lancamento? A acao nao pode ser desfeita.')) return;
    try {
      await api.delete(`/super-admin/finance/transactions/${id}`);
      toast.success('Lancamento excluido');
      load();    } catch (e) {
      toast.error('Falha ao excluir');
    }
  };

  // 2026-02-16 (O) — Antes de dar baixa, abre o modal de pagamento que
  // permite editar o `valor_recebido` (default = total devido incluindo
  // multa/juros, fallback no amount original) e escolher o metodo.
  const [payModalTxn, setPayModalTxn] = useState(null);

  // Pay with a specific method (Pix/Boleto/Dinheiro). Aceita valor_recebido
  // opcional vindo do modal. Mantem o toast "Desfazer" de 5s.
  const handlePayWithMethod = async (id, method, valor_recebido = null) => {
    try {
      const body = { payment_method: method };
      if (valor_recebido !== null && valor_recebido !== undefined && valor_recebido !== '') {
        body.valor_recebido = Number(valor_recebido);
      }
      await api.post(`/super-admin/finance/transactions/${id}/pay`, body);
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

  // Abre o modal de pagamento (uso geral: tabela desktop e cards mobile).
  const openPayModal = (txn, prefMethod = null) => {
    setPayModalTxn({ txn, method: prefMethod || txn.payment_method || 'pix' });
  };

  return (
    <div className="space-y-4" data-testid="adm-lancamentos-panel">
      {/* Hero metrics — 2026-02-16 (M) — totais agora refletem o filtro
          aplicado (mes corrente por default). Substituido "Liquido" por
          "Em aberto" para deixar mais explicito o pipeline financeiro. */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        <MetricCard label="Entradas pagas" value={fmt(summary?.bruto)} icon={TrendingUp} color="emerald" />
        <MetricCard label="Em aberto" value={fmt(summary?.pendente_entrada)} icon={Clock} color="amber" />
        <MetricCard label="Saidas pagas" value={fmt(summary?.saidas)} icon={TrendingDown} color="rose" />
        <MetricCard label="Liquido" value={fmt(summary?.liquido)} icon={CheckCircle2} color={(summary?.liquido || 0) >= 0 ? 'emerald' : 'rose'} />
      </div>

      {/* Toolbar — 2026-02-16 (M+P) — preset de periodo + filtro de mes
          condicional, defaults setados, "Todas direcoes" removido. */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 flex flex-wrap items-stretch sm:items-center gap-2">
        <div className="flex items-center gap-1.5 text-slate-600 px-1">
          <CalendarIcon className="w-4 h-4 shrink-0" />
          <select
            value={filters.period}
            onChange={(e) => setFilters({ ...filters, period: e.target.value })}
            className="px-2 py-1.5 border border-slate-300 rounded text-sm"
            data-testid="adm-filter-period"
          >
            {PERIOD_PRESETS.map(p => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </select>
        </div>
        {filters.period === 'custom' && (
          <input
            type="month"
            value={filters.month}
            onChange={(e) => setFilters({ ...filters, month: e.target.value || _currentMonth() })}
            className="px-2 py-1.5 border border-slate-300 rounded text-sm font-mono"
            data-testid="adm-filter-month"
          />
        )}
        <select
          value={filters.direction}
          onChange={(e) => setFilters({ ...filters, direction: e.target.value })}
          className="px-3 py-2 border border-slate-300 rounded text-sm flex-1 min-w-[120px] sm:flex-none"
          data-testid="adm-filter-direction"
        >
          <option value="entrada">Entradas</option>
          <option value="saida">Saidas</option>
        </select>
        <select
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          className="px-3 py-2 border border-slate-300 rounded text-sm flex-1 min-w-[120px] sm:flex-none"
          data-testid="adm-filter-status"
        >
          <option value="">Todos pagamentos</option>
          <option value="pendente">Em aberto</option>
          <option value="pago">Baixados</option>
        </select>
        <select
          value={filters.kind}
          onChange={(e) => setFilters({ ...filters, kind: e.target.value })}
          className="px-3 py-2 border border-slate-300 rounded text-sm flex-1 min-w-[120px] sm:flex-none"
          data-testid="adm-filter-kind"
        >
          <option value="">Todos tipos</option>
          <option value="licenca">Licenca</option>
          <option value="diversos">Diversos</option>
        </select>
        <button onClick={load} className="px-3 py-2 text-sm rounded border border-slate-300 hover:bg-slate-50 flex items-center justify-center gap-1" data-testid="adm-refresh-btn">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> <span className="hidden sm:inline">Atualizar</span>
        </button>
        <button
          onClick={() => setShowForm(true)}
          className="sm:ml-auto w-full sm:w-auto px-4 py-2 bg-primary text-white rounded text-sm font-semibold flex items-center justify-center gap-1.5"
          data-testid="adm-new-txn-btn"
        >
          <Plus className="w-4 h-4" /> Novo Lancamento
        </button>
      </div>

      {/* === DESKTOP TABLE (sm and up) ===========================
          2026-02-16 (M) — Cliente/Empresa virou a 1a coluna; restante
          das infos ainda visivel em desktop. */}
      <div className="hidden sm:block bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2 text-left">Cliente / Empresa</th>
                <th className="px-3 py-2 text-left">Data</th>
                <th className="px-3 py-2 text-left">Tipo</th>
                <th className="px-3 py-2 text-left">Descricao</th>
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
                    <td className="px-3 py-2">
                      <div className="font-semibold text-slate-900">{empresaName(t)}</div>
                      {t.license_connections !== undefined && t.license_connections !== null && (
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {t.license_connections}c · {t.license_users || 0}u
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-700 font-mono text-xs whitespace-nowrap">{(t.due_date || t.date || '').slice(0,10)}</td>
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
                      <div className="text-slate-700 line-clamp-1">{t.description}</div>
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
                            <AlertTriangle className="w-3 h-3" /> +{t.late_fee_computed.days_overdue}d
                          </span>
                        )}
                      </div>
                    </td>
                    <td className={`px-3 py-2 text-right font-semibold whitespace-nowrap ${isOut ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {isOut ? '−' : '+'} {fmt(t.amount)}
                      {overdue && (
                        <div className="text-[10px] text-slate-500 font-normal">Devido: {fmt(t.late_fee_computed.total)}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <PaymentCell
                        t={t}
                        onPay={(id, method) => openPayModal(items.find(x => x.id === id), method)}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <RowActions
                        t={t}
                        resending={resending}
                        onResend={resendReminder}
                        onHistory={setHistoryTxn}
                        onEdit={(tx) => { setEditingTxn(tx); setShowForm(true); }}
                        onDelete={handleDelete}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* === MOBILE CARD LIST (below sm) =========================
          2026-02-16 (M) — Apenas Empresa/Valor/Pagamento visiveis. Restante
          em card expansivel via chevron. */}
      <div className="sm:hidden space-y-2">
        {items.length === 0 && (
          <div className="bg-white rounded-xl border border-slate-200 py-10 text-center text-sm text-slate-400">
            Nenhum lancamento encontrado.
          </div>
        )}
        {items.map(t => {
          const isOut = t.direction === 'saida';
          const overdue = t.late_fee_computed && t.late_fee_computed.days_overdue > 0;
          const expanded = expandedIds.has(t.id);
          return (
            <div
              key={t.id}
              className="bg-white rounded-xl border border-slate-200 overflow-hidden"
              data-testid={`adm-txn-card-${t.id}`}
            >
              <button
                onClick={() => toggleExpand(t.id)}
                className="w-full p-3 flex items-center gap-3 text-left active:bg-slate-50"
                data-testid={`adm-txn-card-toggle-${t.id}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-900 truncate">{empresaName(t)}</div>
                  <div className={`text-sm font-bold mt-0.5 ${isOut ? 'text-rose-600' : 'text-emerald-600'}`}>
                    {isOut ? '−' : '+'} {fmt(t.amount)}
                    {overdue && (
                      <span className="ml-2 text-[10px] font-normal text-slate-500">→ {fmt(t.late_fee_computed.total)}</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <MobilePaymentBadge t={t} />
                  <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                </div>
              </button>
              {expanded && (
                <div className="border-t border-slate-100 p-3 bg-slate-50/40 space-y-2 text-xs" data-testid={`adm-txn-card-expanded-${t.id}`}>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Data</div>
                      <div className="text-slate-700 font-mono">{(t.due_date || t.date || '').slice(0,10)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Tipo</div>
                      <div>
                        {t.kind === 'licenca' ? (
                          <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 bg-violet-50 text-violet-700 rounded font-medium">
                            <Building className="w-3 h-3" /> Licenca
                          </span>
                        ) : (
                          <span className="inline-block text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded font-medium">Diversos</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Descricao</div>
                    <div className="text-slate-700">{t.description}</div>
                  </div>
                  {overdue && (
                    <div className="flex items-center gap-1 text-rose-700 text-[11px] font-medium">
                      <AlertTriangle className="w-3 h-3" /> Atrasado {t.late_fee_computed.days_overdue}d · Devido {fmt(t.late_fee_computed.total)}
                    </div>
                  )}
                  {/* Mobile actions row — paga/edit/delete/lembrete */}
                  <div className="pt-1 border-t border-slate-200">
                    {t.status !== 'pago' && (
                      <div className="flex gap-1.5 mb-2">
                        {PAYMENT_METHODS.map(pm => (
                          <button
                            key={pm.value}
                            onClick={() => openPayModal(t, pm.value)}
                            className="flex-1 text-[11px] py-1.5 rounded border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 font-medium"
                            data-testid={`adm-pay-${pm.value}-${t.id}`}
                          >
                            Pagar {pm.label}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center justify-end">
                      <RowActions
                        t={t}
                        resending={resending}
                        onResend={resendReminder}
                        onHistory={setHistoryTxn}
                        onEdit={(tx) => { setEditingTxn(tx); setShowForm(true); }}
                        onDelete={handleDelete}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showForm && <AdmTxnFormModal initial={editingTxn} onClose={() => { setShowForm(false); setEditingTxn(null); }} onSaved={() => { setShowForm(false); setEditingTxn(null); load(); }} />}
      {payModalTxn && (
        <PayTxnModal
          txn={payModalTxn.txn}
          method={payModalTxn.method}
          onClose={() => setPayModalTxn(null)}
          onConfirm={async (method, valor_recebido) => {
            await handlePayWithMethod(payModalTxn.txn.id, method, valor_recebido);
            setPayModalTxn(null);
          }}
        />
      )}
      {historyTxn && (
        <ReminderHistoryModal
          txn={historyTxn}
          onClose={() => setHistoryTxn(null)}
          onResend={async () => { await resendReminder(historyTxn.id); }}
        />
      )}
    </div>
  );
};


// 2026-02-16 (M) — Helpers compartilhados pela tabela desktop e cards mobile.

// PaymentCell — exibe metodo de baixa OU os 3 botoes Pix/Boleto/Dinheiro
// quando ainda esta em aberto. Usado apenas em desktop (mobile tem botoes
// inline no expand).
const PaymentCell = ({ t, onPay }) => {
  if (t.status === 'pago') {
    return (
      <div className="inline-flex flex-col items-center gap-0.5">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded text-xs font-medium" data-testid={`adm-paid-${t.id}`}>
          <CheckCircle2 className="w-3 h-3" /> {labelForMethod(t.payment_method)}
        </span>
        {t.valor_recebido !== undefined && t.valor_recebido !== null && (
          <span className="text-[10px] font-mono text-slate-500" data-testid={`adm-paid-valor-${t.id}`}>
            recebido: {fmt(t.valor_recebido)}
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="inline-flex items-center gap-1" data-testid={`adm-open-${t.id}`}>
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded text-[10px] font-semibold uppercase">
        <Clock className="w-3 h-3" /> Aberto
      </span>
      {PAYMENT_METHODS.map(pm => (
        <button
          key={pm.value}
          onClick={() => onPay(t.id, pm.value)}
          className="text-[10px] px-1.5 py-0.5 rounded border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 transition-colors"
          title={`Baixar como ${pm.label}`}
          data-testid={`adm-pay-${pm.value}-${t.id}`}
        >
          {pm.label}
        </button>
      ))}
    </div>
  );
};

// MobilePaymentBadge — versao compacta sem botoes. Os botoes sao mostrados
// dentro do card expandido.
const MobilePaymentBadge = ({ t }) => {
  if (t.status === 'pago') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded text-[10px] font-semibold">
        <CheckCircle2 className="w-3 h-3" /> {labelForMethod(t.payment_method)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 rounded text-[10px] font-semibold uppercase">
      <Clock className="w-3 h-3" /> Aberto
    </span>
  );
};

// RowActions — botoes de Send/History (apenas Licenca pendente) + Edit + Delete.
const RowActions = ({ t, resending, onResend, onHistory, onEdit, onDelete }) => (
  <div className="inline-flex items-center gap-1">
    {t.kind === 'licenca' && t.status !== 'pago' && t.company_id && (
      <>
        <button
          onClick={() => onResend(t.id)}
          disabled={resending === t.id}
          className="p-1.5 hover:bg-emerald-50 rounded text-emerald-600 disabled:opacity-50"
          title="Reenviar lembrete de cobranca"
          data-testid={`adm-resend-${t.id}`}
        >
          <Send className={`w-4 h-4 ${resending === t.id ? 'animate-pulse' : ''}`} />
        </button>
        <button
          onClick={() => onHistory(t)}
          className="p-1.5 hover:bg-slate-100 rounded text-slate-600"
          title="Historico de lembretes"
          data-testid={`adm-history-${t.id}`}
        >
          <History className="w-4 h-4" />
        </button>
      </>
    )}
    <button
      onClick={() => onEdit(t)}
      className="p-1.5 hover:bg-indigo-50 rounded text-indigo-600"
      title="Editar"
      data-testid={`adm-edit-${t.id}`}
    >
      <Pencil className="w-4 h-4" />
    </button>
    <button
      onClick={() => onDelete(t.id)}
      className="p-1.5 hover:bg-rose-50 rounded text-rose-500"
      title="Excluir"
      data-testid={`adm-delete-${t.id}`}
    >
      <Trash2 className="w-4 h-4" />
    </button>
  </div>
);


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

const AdmTxnFormModal = ({ initial, onClose, onSaved }) => {
  const isEdit = !!initial?.id;
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    direction: initial?.direction || 'entrada',
    description: initial?.description || '',
    amount: initial?.amount ?? '',
    payment_method: initial?.payment_method || 'pix',
    category: initial?.category || 'servico',
    date: initial?.date || today,
    due_date: initial?.due_date || today,
    status: initial?.status || 'pendente',
    notes: initial?.notes || '',
    kind: initial?.kind || 'licenca',
    client_kind: initial?.external_client_name ? 'external' : 'native',
    company_id: initial?.company_id || '',
    external_client_name: initial?.external_client_name || '',
    license_connections: initial?.license_connections ?? '',
    license_users: initial?.license_users ?? '',
    license_cost: initial?.license_cost ?? '',
    license_sale_price: initial?.license_sale_price ?? '',
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
      if (isEdit) {
        // Edit mode — PUT existing txn (does NOT propagate to siblings).
        await api.put(`/super-admin/finance/transactions/${initial.id}`, payload);
        toast.success('Lancamento atualizado');
      } else {
        const { data } = await api.post('/super-admin/finance/transactions', payload);
        if (data._siblings_created > 0) {
          toast.success(`Lancamento + ${data._siblings_created} parcelas recorrentes criados`);
        } else {
          toast.success('Lancamento criado');
        }
      }
      onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-start justify-center p-2 sm:p-4 overflow-y-auto" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-4 sm:p-6 my-4 sm:my-8"
        data-testid="adm-txn-form-modal"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-slate-900">{isEdit ? 'Editar Lancamento' : 'Novo Lancamento (Adm)'}</h2>
          <button type="button" onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
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

// 2026-02-16 (O) — PayTxnModal: confirma baixa com possibilidade de editar
// valor recebido (default = total devido com multa/juros, fallback = amount)
// e trocar metodo de pagamento. UX: 3 botoes coloridos para Pix/Boleto/Dinheiro
// + campo valor + Confirmar.
const PayTxnModal = ({ txn, method: initialMethod, onClose, onConfirm }) => {
  const totalDevido = txn?.late_fee_computed?.total ?? txn?.amount ?? 0;
  const [method, setMethod] = useState(initialMethod || 'pix');
  const [valor, setValor] = useState(String(totalDevido));
  const [confirming, setConfirming] = useState(false);

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      await onConfirm(method, valor);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-start justify-center p-3 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md my-4 sm:my-8"
        onClick={(e) => e.stopPropagation()}
        data-testid="pay-txn-modal"
      >
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-200">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-900">Dar baixa</h3>
            <p className="text-xs text-slate-500 mt-0.5 truncate">{txn?.description || '—'}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 sm:p-5 space-y-4">
          <div className="bg-slate-50 rounded-lg p-3 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-500">Valor original</span>
              <span className="font-mono font-medium">{fmt(txn?.amount)}</span>
            </div>
            {txn?.late_fee_computed?.days_overdue > 0 && (
              <>
                <div className="flex justify-between">
                  <span className="text-slate-500">Multa + Juros ({txn.late_fee_computed.days_overdue}d)</span>
                  <span className="font-mono font-medium text-amber-700">+ {fmt(totalDevido - (txn?.amount || 0))}</span>
                </div>
                <div className="flex justify-between pt-1 border-t border-slate-200">
                  <span className="text-slate-600 font-semibold">Total devido</span>
                  <span className="font-mono font-bold text-rose-700">{fmt(totalDevido)}</span>
                </div>
              </>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Valor recebido (R$)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              data-testid="pay-modal-valor-recebido"
              className="input-field text-base font-semibold"
              autoFocus
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Permite registrar valor diferente do devido (desconto, multa parcial, etc).
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Forma de pagamento</label>
            <div className="grid grid-cols-3 gap-2">
              {PAYMENT_METHODS.map(pm => (
                <button
                  key={pm.value}
                  type="button"
                  onClick={() => setMethod(pm.value)}
                  data-testid={`pay-modal-method-${pm.value}`}
                  className={`px-3 py-2.5 rounded-lg text-sm font-medium border transition-all ${
                    method === pm.value
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white text-slate-600 border-slate-300 hover:border-emerald-400'
                  }`}
                >
                  {pm.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 p-4 sm:p-5 border-t border-slate-200">
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button
            onClick={handleConfirm}
            disabled={confirming}
            data-testid="pay-modal-confirm"
            className="btn-primary"
          >
            {confirming ? 'Salvando...' : 'Confirmar baixa'}
          </button>
        </div>
      </div>
    </div>
  );
};

// 2026-02-16 (L) — Modal mostrando o historico de lembretes enviados para
// um Lancamento (auto-gerados + reenvios manuais). Permite reenviar pelo
// botao do modal tambem. Endpoint: GET /super-admin/billing-reminder-history.
const ReminderHistoryModal = ({ txn, onClose, onResend }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resending, setResending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/super-admin/billing-reminder-history', {
        params: { transaction_id: txn.id, limit: 100 },
      });
      setRows(Array.isArray(r.data) ? r.data : []);
    } catch (_) {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [txn.id]);

  useEffect(() => { load(); }, [load]);

  const handleResend = async () => {
    setResending(true);
    try { await onResend(); await load(); }
    finally { setResending(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-start justify-center p-3 sm:p-4 overflow-y-auto" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-4 sm:my-8"
        onClick={(e) => e.stopPropagation()}
        data-testid="reminder-history-modal"
      >
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-slate-200">
          <div>
            <h3 className="text-base sm:text-lg font-bold text-slate-900">Historico de lembretes</h3>
            <p className="text-xs text-slate-500 mt-0.5 truncate">{txn.description}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 sm:p-6">
          {loading ? (
            <div className="text-center py-8 text-sm text-slate-500">Carregando...</div>
          ) : rows.length === 0 ? (
            <div className="text-center py-8 text-sm text-slate-500">
              Nenhum lembrete registrado ainda para este Lancamento.
            </div>
          ) : (
            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              {rows.map(r => (
                <div
                  key={r.id}
                  className={`rounded-lg border p-3 ${r.status === 'sent' ? 'border-emerald-200 bg-emerald-50/40' : 'border-rose-200 bg-rose-50/40'}`}
                  data-testid={`reminder-history-row-${r.id}`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 text-xs">
                      <span className={`px-2 py-0.5 rounded font-semibold ${r.status === 'sent' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                        {r.status === 'sent' ? 'ENTREGUE' : 'FALHOU'}
                      </span>
                      <span className="text-slate-500">
                        {r.kind === 'manual_resend' ? 'Manual' : 'Automatico'}
                        {r.days_before_due !== null && r.days_before_due !== undefined && ` · ${r.days_before_due}d antes`}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-400 whitespace-nowrap">
                      {r.sent_at ? new Date(r.sent_at).toLocaleString('pt-BR') : ''}
                    </span>
                  </div>
                  {r.error && (
                    <p className="text-[11px] text-rose-700 mb-1">Erro: {r.error}</p>
                  )}
                  <p className="text-xs text-slate-700 whitespace-pre-wrap line-clamp-4 font-mono">
                    {r.text || ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 p-4 sm:p-6 border-t border-slate-200">
          <button onClick={onClose} className="btn-secondary">Fechar</button>
          <button
            onClick={handleResend}
            disabled={resending}
            data-testid="reminder-history-resend"
            className="btn-primary flex items-center gap-1.5"
          >
            <Send className={`w-4 h-4 ${resending ? 'animate-pulse' : ''}`} />
            {resending ? 'Reenviando...' : 'Reenviar agora'}
          </button>
        </div>
      </div>
    </div>
  );
};
