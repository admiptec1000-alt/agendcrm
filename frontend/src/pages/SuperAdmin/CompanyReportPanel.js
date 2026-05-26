/**
 * Relatorio Empresas — Super Admin
 *
 * Para cada empresa cadastrada: custo das licencas, valor de venda,
 * lucro, proxima parcela do periodo selecionado e status de cobranca
 * (em X dias / atrasado Y dias / pago).
 *
 * Filtros:
 *   • Periodo: mes atual | mes passado | personalizado
 *   • Tipo de BD (Padrao / Externo)
 *   • Busca por nome / representante / email / telefone
 *
 * Mobile-first: a tabela vira lista de cards em telas pequenas (<sm).
 *
 * 2026-02-18
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../../services/api';
import { toast } from 'sonner';
import {
  Search, Calendar, Filter, Download, TrendingUp, TrendingDown,
  AlertTriangle, Check, Clock, X,
} from 'lucide-react';

const fmtBRL = (v) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    .format(Number(v || 0));

const fmtDateBR = (iso) => {
  if (!iso) return '—';
  const s = String(iso).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
};

const StatusBadge = ({ status, days }) => {
  const cfg = {
    em_dia:      { label: `Em ${days}d`,   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: Clock },
    vence_hoje:  { label: 'Vence hoje',    cls: 'bg-amber-50 text-amber-700 border-amber-200',       icon: AlertTriangle },
    atrasado:    { label: `${Math.abs(days || 0)}d atrasado`, cls: 'bg-rose-50 text-rose-700 border-rose-200', icon: AlertTriangle },
    pago:        { label: 'Pago',          cls: 'bg-slate-100 text-slate-600 border-slate-300',     icon: Check },
    sem_cobranca:{ label: 'Sem cobranca',  cls: 'bg-slate-50 text-slate-400 border-slate-200',     icon: X },
  }[status] || { label: status, cls: 'bg-slate-50 text-slate-600 border-slate-200', icon: Clock };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.cls}`}>
      <Icon className="w-3 h-3" />{cfg.label}
    </span>
  );
};

export const CompanyReportPanel = () => {
  const [period, setPeriod] = useState('current_month');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [dbType, setDbType] = useState('');
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  // 2026-02-18 — Tipos de BD: carregados dinamicamente para refletir os
  // mesmos valores cadastrados na tela "Empresas" (ex: "Base Nova | Alvotec",
  // "Base antiga | Alvotec", "Padrao"). Antes vinha hardcoded.
  const [dbTypeOptions, setDbTypeOptions] = useState([]);

  useEffect(() => {
    api.get('/super-admin/companies/database-types')
      .then(r => {
        // Endpoint retorna {types: [...]} (nao um array direto).
        const list = Array.isArray(r.data) ? r.data : (r.data?.types || []);
        setDbTypeOptions(list);
      })
      .catch(() => setDbTypeOptions(['Padrao']));
  }, []);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const params = { period };
      if (period === 'custom') {
        if (dateFrom) params.date_from = dateFrom;
        if (dateTo) params.date_to = dateTo;
      }
      if (dbType) params.database_type = dbType;
      if (q.trim()) params.q = q.trim();
      const r = await api.get('/super-admin/reports/companies', { params });
      setData(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Falha ao gerar relatorio');
    } finally {
      setLoading(false);
    }
  }, [period, dateFrom, dateTo, dbType, q]);

  useEffect(() => { fetchReport(); }, [period, dbType]);   // eslint-disable-line

  const rows = data?.rows || [];
  const totals = data?.totals || {};
  const margemPct = useMemo(() => {
    if (!totals.venda_total) return 0;
    return (totals.lucro_total / totals.venda_total) * 100;
  }, [totals]);

  const exportCsv = () => {
    if (!rows.length) return;
    const headers = ['Empresa', 'Representante', 'BD', 'Custo', 'Venda', 'Desconto', 'Devido', 'Lucro', 'Vencimento', 'Status'];
    const csvRows = rows.map(r => [
      r.company_name, r.representante, r.database_type,
      r.custo, r.venda, r.desconto, r.valor_devido, r.lucro,
      r.due_date || '', r.status + (r.days_to_due != null ? ` ${r.days_to_due}d` : ''),
    ]);
    const csv = [headers, ...csvRows].map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio_empresas_${data?.start || ''}_${data?.end || ''}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4" data-testid="company-report-panel">
      {/* Header + busca */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base sm:text-lg font-bold text-slate-900">Relatorio Empresas</h2>
          <button
            onClick={exportCsv}
            disabled={!rows.length}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-emerald-300 text-emerald-700 bg-white hover:bg-emerald-50 disabled:opacity-40"
            data-testid="report-export-csv"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
        </div>

        {/* Filtros — empilha em mobile, lado-a-lado em sm+ */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <div>
            <label className="block text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">Periodo</label>
            <select
              value={period}
              onChange={e => setPeriod(e.target.value)}
              className="input-field text-sm w-full"
              data-testid="report-period"
            >
              <option value="current_month">Mes atual</option>
              <option value="last_month">Mes passado</option>
              <option value="custom">Personalizado</option>
            </select>
          </div>
          {period === 'custom' && (
            <>
              <div>
                <label className="block text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">De</label>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input-field text-sm w-full" data-testid="report-date-from" />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">Ate</label>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="input-field text-sm w-full" data-testid="report-date-to" />
              </div>
            </>
          )}
          <div>
            <label className="block text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">Tipo BD</label>
            <select value={dbType} onChange={e => setDbType(e.target.value)} className="input-field text-sm w-full" data-testid="report-db-type">
              <option value="">Todos</option>
              {dbTypeOptions.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
          <div className={period === 'custom' ? 'sm:col-span-2 lg:col-span-4' : ''}>
            <label className="block text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">Buscar</label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={q}
                onChange={e => setQ(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && fetchReport()}
                placeholder="nome / representante / email"
                className="input-field text-sm w-full pl-8"
                data-testid="report-search"
              />
            </div>
          </div>
        </div>

        {(period === 'custom' || q.trim()) && (
          <button
            onClick={fetchReport}
            disabled={loading}
            className="mt-3 w-full sm:w-auto px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            data-testid="report-apply"
          >
            {loading ? 'Carregando...' : 'Aplicar filtros'}
          </button>
        )}
      </div>

      {/* Totalizadores */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <TotalCard label="Custo total" value={fmtBRL(totals.custo_total)} tone="slate" testid="report-total-cost" />
        <TotalCard label="Venda total" value={fmtBRL(totals.venda_total)} tone="indigo" testid="report-total-sale" />
        <TotalCard
          label={`Lucro (margem ${margemPct.toFixed(1)}%)`}
          value={fmtBRL(totals.lucro_total)}
          tone="emerald"
          testid="report-total-profit"
        />
        <TotalCard
          label="Atrasados"
          value={`${totals.atrasado_count || 0} empresas`}
          tone={totals.atrasado_count ? 'rose' : 'slate'}
          testid="report-total-atrasado"
        />
      </div>

      {/* Tabela desktop / Cards mobile */}
      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500">
          Carregando...
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500">
          Nenhuma empresa encontrada com os filtros aplicados.
        </div>
      ) : (
        <>
          {/* TABELA — apenas md+ */}
          <div className="hidden md:block bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <Th>Empresa</Th>
                    <Th>BD</Th>
                    <Th right>Custo</Th>
                    <Th right>Venda</Th>
                    <Th right>Lucro</Th>
                    <Th>Vencimento</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map(r => (
                    <tr key={r.company_id} className="hover:bg-slate-50/60" data-testid={`report-row-${r.company_id}`}>
                      <td className="px-3 py-2.5">
                        <div className="font-semibold text-slate-900 truncate max-w-[200px]">{r.company_name}</div>
                        {r.representante && (
                          <div className="text-[10px] text-slate-500 truncate max-w-[200px]">{r.representante}</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-500">{r.database_type}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs">{fmtBRL(r.custo)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs">{fmtBRL(r.venda)}</td>
                      <td className={`px-3 py-2.5 text-right font-mono text-xs font-semibold ${r.lucro >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {fmtBRL(r.lucro)}
                      </td>
                      <td className="px-3 py-2.5 text-xs font-mono text-slate-600">{fmtDateBR(r.due_date)}</td>
                      <td className="px-3 py-2.5"><StatusBadge status={r.status} days={r.days_to_due} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* CARDS — apenas mobile (<md) */}
          <div className="md:hidden space-y-2">
            {rows.map(r => (
              <div
                key={r.company_id}
                className="bg-white rounded-xl border border-slate-200 p-3"
                data-testid={`report-card-${r.company_id}`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900 truncate">{r.company_name}</p>
                    {r.representante && (
                      <p className="text-[11px] text-slate-500 truncate">{r.representante}</p>
                    )}
                    <p className="text-[10px] text-slate-400 mt-0.5">{r.database_type}</p>
                  </div>
                  <StatusBadge status={r.status} days={r.days_to_due} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">Custo</p>
                    <p className="font-mono font-medium text-slate-700">{fmtBRL(r.custo)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">Venda</p>
                    <p className="font-mono font-medium text-slate-700">{fmtBRL(r.venda)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">Lucro</p>
                    <p className={`font-mono font-semibold ${r.lucro >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {fmtBRL(r.lucro)}
                    </p>
                  </div>
                </div>
                {r.due_date && (
                  <p className="text-[11px] text-slate-500 mt-2 flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> Vencimento: <span className="font-mono">{fmtDateBR(r.due_date)}</span>
                  </p>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

const Th = ({ children, right = false }) => (
  <th className={`px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-600 ${right ? 'text-right' : 'text-left'}`}>
    {children}
  </th>
);

const TotalCard = ({ label, value, tone = 'slate', testid }) => {
  const toneClasses = {
    slate:   'bg-white border-slate-200 text-slate-900',
    indigo:  'bg-indigo-50 border-indigo-200 text-indigo-900',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    rose:    'bg-rose-50 border-rose-200 text-rose-900',
  }[tone];
  return (
    <div className={`rounded-xl border p-3 ${toneClasses}`} data-testid={testid}>
      <p className="text-[10px] uppercase tracking-wider opacity-70 mb-1">{label}</p>
      <p className="text-sm sm:text-base font-bold font-mono truncate">{value}</p>
    </div>
  );
};

export default CompanyReportPanel;
