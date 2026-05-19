import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import api from '../../services/api';
import { Plus, Trash2, Pencil, X, Package, RefreshCw } from 'lucide-react';

const money = (v) => `R$ ${Number(v || 0).toFixed(2)}`;

/**
 * Licenses catalog — Super Admin tab.
 *
 * A License is a sellable bundle that grants a Company N connections
 * AND/OR M users. Can be unitary (e.g. "1 connection", qty 1) or
 * composite (e.g. "Plano Pro: 10 conn + 5 usr").
 *
 * Companies reference licenses via `company.licenses[]`; max_connections
 * and max_users are auto-computed at save time by the backend.
 */
export const LicensesPanel = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/super-admin/licenses', { params: { include_inactive: true } });
      setItems(data || []);
    } catch (e) {
      toast.error('Erro ao carregar licencas');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Excluir a licenca "${name}"? Se estiver em uso por alguma empresa, sera apenas desativada.`)) return;
    try {
      const { data } = await api.delete(`/super-admin/licenses/${id}`);
      if (data?.soft_deleted) toast.info(data.reason || 'Licenca desativada');
      else toast.success('Licenca excluida');
      load();
    } catch (e) {
      toast.error('Falha ao excluir');
    }
  };

  return (
    <div className="space-y-4" data-testid="licenses-panel">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold font-heading text-slate-900">Licencas</h2>
          <p className="text-sm text-slate-500">Pacotes de conexao e/ou usuario que voce vende para as empresas.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="px-3 py-2 text-sm rounded border border-slate-300 hover:bg-slate-50 flex items-center gap-1" data-testid="licenses-refresh-btn">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
          </button>
          <button onClick={() => { setEditing(null); setShowForm(true); }}
            className="btn-primary text-sm flex items-center gap-2" data-testid="licenses-add-btn">
            <Plus className="w-4 h-4" /> Nova Licenca
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-4 py-2 text-left font-medium text-slate-600">Nome</th>
              <th className="px-4 py-2 text-right font-medium text-slate-600">Conexoes</th>
              <th className="px-4 py-2 text-right font-medium text-slate-600">Usuarios</th>
              <th className="px-4 py-2 text-right font-medium text-slate-600">Custo</th>
              <th className="px-4 py-2 text-right font-medium text-slate-600">Venda</th>
              <th className="px-4 py-2 text-center font-medium text-slate-600">Status</th>
              <th className="px-4 py-2 text-right font-medium text-slate-600">Acoes</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !loading && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
                Nenhuma licenca cadastrada. Crie a primeira para liberar pacotes para as empresas.
              </td></tr>
            )}
            {items.map(lic => (
              <tr key={lic.id} className="border-b border-slate-100 hover:bg-slate-50" data-testid={`license-row-${lic.id}`}>
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-900">{lic.name}</div>
                  {lic.description && <div className="text-xs text-slate-500">{lic.description}</div>}
                </td>
                <td className="px-4 py-3 text-right font-mono text-slate-700">{lic.connections_qty || 0}</td>
                <td className="px-4 py-3 text-right font-mono text-slate-700">{lic.users_qty || 0}</td>
                <td className="px-4 py-3 text-right text-slate-600">{money(lic.cost)}</td>
                <td className="px-4 py-3 text-right font-medium text-slate-900">{money(lic.sale_price)}</td>
                <td className="px-4 py-3 text-center">
                  {lic.is_active === false
                    ? <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-slate-100 text-slate-600">Inativa</span>
                    : <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-emerald-100 text-emerald-700">Ativa</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex items-center gap-1">
                    <button onClick={() => { setEditing(lic); setShowForm(true); }}
                      className="p-1.5 rounded hover:bg-slate-200 text-slate-600" data-testid={`license-edit-${lic.id}`}>
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDelete(lic.id, lic.name)}
                      className="p-1.5 rounded hover:bg-rose-100 text-rose-600" data-testid={`license-delete-${lic.id}`}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <LicenseFormModal
          initial={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
};


const LicenseFormModal = ({ initial, onClose, onSaved }) => {
  const isEdit = !!initial;
  const [form, setForm] = useState({
    name: initial?.name || '',
    description: initial?.description || '',
    connections_qty: initial?.connections_qty ?? 0,
    users_qty: initial?.users_qty ?? 0,
    cost: initial?.cost ?? 0,
    sale_price: initial?.sale_price ?? 0,
    is_active: initial?.is_active !== false,
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.name.trim()) { toast.error('Informe um nome'); return; }
    if ((form.connections_qty || 0) <= 0 && (form.users_qty || 0) <= 0) {
      toast.error('A licenca precisa conceder ao menos 1 conexao OU 1 usuario');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        description: form.description || null,
        connections_qty: Number(form.connections_qty) || 0,
        users_qty: Number(form.users_qty) || 0,
        cost: Number(form.cost) || 0,
        sale_price: Number(form.sale_price) || 0,
      };
      if (isEdit) {
        await api.put(`/super-admin/licenses/${initial.id}`, { ...payload, is_active: form.is_active });
        toast.success('Licenca atualizada');
      } else {
        await api.post('/super-admin/licenses', payload);
        toast.success('Licenca criada');
      }
      onSaved();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()} data-testid="license-form-modal">
        <div className="flex items-center justify-between p-5 border-b border-slate-200">
          <h2 className="text-lg font-bold font-heading text-slate-900">{isEdit ? 'Editar Licenca' : 'Nova Licenca'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Nome</label>
            <input value={form.name} onChange={e => setForm({...form, name: e.target.value})}
              className="input-field" placeholder="Ex.: Conexao Solo, Pacote Pro" data-testid="license-name-input" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Descricao (opcional)</label>
            <input value={form.description} onChange={e => setForm({...form, description: e.target.value})}
              className="input-field" data-testid="license-description-input" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Conexoes</label>
              <input type="number" min="0" value={form.connections_qty}
                onChange={e => setForm({...form, connections_qty: e.target.value})}
                className="input-field" data-testid="license-connections-input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Usuarios</label>
              <input type="number" min="0" value={form.users_qty}
                onChange={e => setForm({...form, users_qty: e.target.value})}
                className="input-field" data-testid="license-users-input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Custo (R$)</label>
              <input type="number" min="0" step="0.01" value={form.cost}
                onChange={e => setForm({...form, cost: e.target.value})}
                className="input-field" data-testid="license-cost-input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Valor de Venda (R$)</label>
              <input type="number" min="0" step="0.01" value={form.sale_price}
                onChange={e => setForm({...form, sale_price: e.target.value})}
                className="input-field" data-testid="license-sale-input" />
            </div>
          </div>
          {isEdit && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.is_active}
                onChange={e => setForm({...form, is_active: e.target.checked})}
                className="w-4 h-4" data-testid="license-active-input" />
              <span className="text-sm text-slate-700">Licenca ativa</span>
            </label>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 p-5 border-t border-slate-200">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-slate-300 hover:bg-slate-50" data-testid="license-cancel-btn">Cancelar</button>
          <button onClick={save} disabled={saving}
            className="btn-primary text-sm" data-testid="license-save-btn">
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default LicensesPanel;
