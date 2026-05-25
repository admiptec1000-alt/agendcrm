import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import api from '../../services/api';
import { Plus, X, Package, AlertCircle } from 'lucide-react';

const money = (v) => `R$ ${Number(v || 0).toFixed(2)}`;

/**
 * License picker embedded in the CompanyModal.
 *
 * Props:
 *   value:     array of { license_id, qty, custom_sale_price? } — current assignments
 *   onChange:  (newValue) => void
 *   companyId: optional. If present, also fetches usage and renders the
 *              "X usadas / Y permitidas" counters next to each total.
 *   discount:  optional. Numero (R$) que reduz `Valor venda total` exibido
 *              no card. 2026-02-18.
 *   onDiscountChange: (value) => void. Setter do desconto. Quando ausente,
 *              o input de desconto nao eh renderizado.
 */
export const LicenseAssignmentPanel = ({ value, onChange, companyId, discount = 0, onDiscountChange }) => {
  const assignments = value || [];
  const [licenses, setLicenses] = useState([]);
  const [usage, setUsage] = useState(null);
  const [loadingCatalog, setLoadingCatalog] = useState(true);

  useEffect(() => {
    let mounted = true;
    api.get('/super-admin/licenses').then(r => {
      if (mounted) {
        setLicenses(r.data || []);
        setLoadingCatalog(false);
      }
    }).catch(() => { if (mounted) setLoadingCatalog(false); });
    return () => { mounted = false; };
  }, []);

  const loadUsage = useCallback(async () => {
    if (!companyId) return;
    try {
      const r = await api.get(`/super-admin/licenses/usage/${companyId}`);
      setUsage(r.data);
    } catch (_) {/* ignore */}
  }, [companyId]);
  useEffect(() => { loadUsage(); }, [loadUsage]);

  const licenseById = useMemo(
    () => Object.fromEntries(licenses.map(l => [l.id, l])),
    [licenses]
  );

  // Local computed totals — gives instant feedback before saving.
  const localTotals = useMemo(() => {
    let maxConn = 0, maxUsr = 0, cost = 0, sale = 0;
    for (const a of assignments) {
      const lic = licenseById[a.license_id];
      if (!lic) continue;
      const qty = Math.max(Number(a.qty) || 1, 1);
      maxConn += (lic.connections_qty || 0) * qty;
      maxUsr += (lic.users_qty || 0) * qty;
      cost += (lic.cost || 0) * qty;
      const custom = a.custom_sale_price;
      sale += (custom !== null && custom !== undefined && custom !== '')
        ? Number(custom)
        : (lic.sale_price || 0) * qty;
    }
    return { maxConn, maxUsr, cost, sale };
  }, [assignments, licenseById]);

  const addLicense = () => {
    const firstActive = licenses.find(l => l.is_active !== false);
    if (!firstActive) {
      toast.error('Crie ao menos uma licenca antes (aba Licencas).');
      return;
    }
    onChange([...assignments, { license_id: firstActive.id, qty: 1, custom_sale_price: null }]);
  };

  const updateAt = (idx, patch) => {
    const next = assignments.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  const removeAt = (idx) => {
    onChange(assignments.filter((_, i) => i !== idx));
  };

  if (loadingCatalog) {
    return <div className="text-sm text-slate-500 py-4">Carregando catalogo de licencas...</div>;
  }

  return (
    <div className="space-y-3" data-testid="license-assignment-panel">
      {/* 2026-02-18 — Botao "Adicionar licenca" movido para LOGO ABAIXO do
          titulo (mais intuitivo: clique adiciona uma nova linha vazia
          imediatamente abaixo das ja existentes). */}
      <button type="button" onClick={addLicense}
        className="w-full px-4 py-2.5 text-sm rounded-lg border-2 border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-semibold flex items-center justify-center gap-2 transition-colors"
        data-testid="license-add-btn">
        <Plus className="w-4 h-4" /> Adicionar licenca
      </button>

      {assignments.length === 0 && (
        <div className="p-4 rounded-lg border-2 border-dashed border-slate-200 text-center text-sm text-slate-500">
          <Package className="w-6 h-6 mx-auto mb-2 opacity-50" />
          Nenhuma licenca atribuida. Empresa sem licenca = sem limite (modo legado).
        </div>
      )}

      {assignments.map((a, idx) => {
        const lic = licenseById[a.license_id];
        const defaultSale = lic ? (lic.sale_price || 0) * (Number(a.qty) || 1) : 0;
        return (
          <div key={idx} className="border border-slate-200 rounded-lg p-3 bg-slate-50/50" data-testid={`license-row-${idx}`}>
            <div className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-12 md:col-span-5">
                <label className="block text-xs font-medium text-slate-600 mb-1">Licenca</label>
                <select value={a.license_id}
                  onChange={e => updateAt(idx, { license_id: e.target.value })}
                  className="input-field text-sm" data-testid={`license-select-${idx}`}>
                  {licenses.filter(l => l.is_active !== false || l.id === a.license_id).map(l => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({l.connections_qty || 0}c + {l.users_qty || 0}u)
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-4 md:col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Qtd</label>
                <input type="number" min="1" value={a.qty || 1}
                  onChange={e => updateAt(idx, { qty: Math.max(parseInt(e.target.value || '1', 10), 1) })}
                  className="input-field text-sm" data-testid={`license-qty-${idx}`} />
              </div>
              <div className="col-span-8 md:col-span-4">
                <label className="block text-xs font-medium text-slate-600 mb-1">Valor venda (R$)</label>
                <input type="number" min="0" step="0.01"
                  value={a.custom_sale_price ?? ''}
                  placeholder={money(defaultSale)}
                  onChange={e => updateAt(idx, { custom_sale_price: e.target.value === '' ? null : Number(e.target.value) })}
                  className="input-field text-sm" data-testid={`license-saleprice-${idx}`} />
              </div>
              <div className="col-span-12 md:col-span-1 flex md:justify-end">
                <button onClick={() => removeAt(idx)} type="button"
                  className="p-2 rounded-lg hover:bg-rose-100 text-rose-600" data-testid={`license-remove-${idx}`}>
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            {lic && (
              <p className="text-[11px] text-slate-500 mt-2">
                Custo unit.: {money(lic.cost)} · Venda unit. padrao: {money(lic.sale_price)} · Concede: {lic.connections_qty || 0} conexao(oes) + {lic.users_qty || 0} usuario(s)
              </p>
            )}
          </div>
        );
      })}

      {/* 2026-02-18 — Campo "Desconto fixo (R$)" ANTES dos cards de totais
          para que o card "Valor venda total" ja mostre o valor liquido
          (sale - discount). So renderizado quando `onDiscountChange` for
          fornecido (modo Editar/Criar Empresa). */}
      {onDiscountChange && (
        <div className="mt-3 max-w-xs">
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Desconto fixo (R$) <span className="text-slate-400">(opcional)</span>
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={discount ?? ''}
            onChange={e => onDiscountChange(e.target.value)}
            placeholder="0.00"
            className="input-field text-sm w-full"
            data-testid="company-discount"
          />
          <p className="text-[11px] text-slate-500 mt-1">
            Subtrai de "Valor venda total" e propaga em cada lancamento gerado.
          </p>
        </div>
      )}

      {/* Totals + usage counters
          2026-02-18 — Reorganizado conforme solicitacao do operador:
            • Conexoes  • Usuarios  • Valor venda total  • Desconto  • Valor devido
          Removido "Custo total" (campo interno, nao precisa exposicao na UI). */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-3">
        <CounterCard
          label="Conexoes"
          used={usage?.used_connections}
          total={localTotals.maxConn}
          warn={usage && usage.used_connections > localTotals.maxConn}
          testid="counter-connections"
        />
        <CounterCard
          label="Usuarios"
          used={usage?.used_users}
          total={localTotals.maxUsr}
          warn={usage && usage.used_users > localTotals.maxUsr}
          testid="counter-users"
        />
        <CounterCard
          label="Valor venda total"
          value={money(localTotals.sale)}
          testid="counter-sale"
        />
        <CounterCard
          label="Desconto"
          value={money(Number(discount) || 0)}
          testid="counter-discount"
        />
        <CounterCard
          label="Valor devido (mensal)"
          value={money(Math.max(0, localTotals.sale - (Number(discount) || 0)))}
          subtitle="venda − desconto"
          testid="counter-devido"
          emphasis
        />
      </div>
    </div>
  );
};


const CounterCard = ({ label, used, total, value, warn, emphasis, testid, subtitle }) => (
  <div className={`rounded-lg border ${warn ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'} p-3`} data-testid={testid}>
    <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">{label}</p>
    {value !== undefined ? (
      <p className={`text-base font-bold ${emphasis ? 'text-emerald-700' : 'text-slate-900'}`}>{value}</p>
    ) : (
      <p className={`text-base font-bold ${warn ? 'text-amber-700' : 'text-slate-900'}`}>
        {used !== undefined ? `${used} / ${total}` : `${total}`}
      </p>
    )}
    {subtitle && (
      <p className="text-[10px] text-slate-500 mt-0.5 font-normal">{subtitle}</p>
    )}
    {warn && (
      <p className="text-[10px] text-amber-700 flex items-center gap-1 mt-1">
        <AlertCircle className="w-3 h-3" /> uso atual excede o limite
      </p>
    )}
  </div>
);

export default LicenseAssignmentPanel;
