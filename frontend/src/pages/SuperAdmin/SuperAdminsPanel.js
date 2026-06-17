import React, { useEffect, useState } from 'react';
import { superAdminAPI } from '../../services/api';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Lock, ShieldCheck, X } from 'lucide-react';

// CRUD for the super_admins collection. Mirrors the look-and-feel of the
// existing tenant Users page so the operator does not have to learn a new
// UI just to manage SaaS-level admins. The bootstrap account (`adm@crm.com`)
// is locked from deletion — only its password can be reset — to guarantee
// there is ALWAYS one usable login even if the operator wipes the rest.
const blankForm = { id: null, name: '', email: '', password: '' };

const SuperAdminsPanel = () => {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await superAdminAPI.listSuperAdmins();
      setList(data || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Falha ao carregar super admins');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setForm(blankForm); setShowModal(true); };
  const openEdit = (row) => {
    setForm({ id: row.id, name: row.name || '', email: row.email || '', password: '' });
    setShowModal(true);
  };
  const close = () => { setShowModal(false); setForm(blankForm); };

  const save = async () => {
    const isEdit = !!form.id;
    if (!form.email || !form.email.includes('@')) { toast.error('Informe um e-mail valido'); return; }
    if (!isEdit && (!form.password || form.password.length < 4)) {
      toast.error('Senha precisa ter pelo menos 4 caracteres');
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        const payload = { name: form.name, email: form.email };
        if (form.password) payload.password = form.password;
        await superAdminAPI.updateSuperAdmin(form.id, payload);
        toast.success('Super admin atualizado');
      } else {
        await superAdminAPI.createSuperAdmin({ name: form.name, email: form.email, password: form.password });
        toast.success('Super admin criado');
      }
      close();
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row) => {
    if (row.is_bootstrap) { toast.error('O super admin bootstrap nao pode ser excluido'); return; }
    if (!window.confirm(`Excluir o super admin ${row.email}?`)) return;
    try {
      await superAdminAPI.deleteSuperAdmin(row.id);
      toast.success('Super admin excluido');
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Falha ao excluir');
    }
  };

  return (
    <div className="space-y-6" data-testid="super-admins-panel">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600"><ShieldCheck className="w-5 h-5" /></div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">Super Admins</h2>
            <p className="text-sm text-slate-500">Usuarios com acesso total ao painel administrativo</p>
          </div>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
          data-testid="add-super-admin-btn"
        >
          <Plus className="w-4 h-4" /> Novo Super Admin
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-left text-[11px] uppercase tracking-wider text-slate-500 font-bold">
            <tr>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">E-mail</th>
              <th className="px-4 py-3">Criado em</th>
              <th className="px-4 py-3 text-right">Acoes</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">Carregando...</td></tr>
            ) : list.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">Nenhum super admin cadastrado</td></tr>
            ) : list.map(row => (
              <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50" data-testid={`super-admin-row-${row.id}`}>
                <td className="px-4 py-3 font-medium text-slate-900 flex items-center gap-2">
                  {row.name || '-'}
                  {row.is_bootstrap && (
                    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-bold" title="Conta bootstrap — nao pode ser excluida">
                      <Lock className="w-3 h-3" /> bootstrap
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-700">{row.email}</td>
                <td className="px-4 py-3 text-slate-500">{row.created_at ? new Date(row.created_at).toLocaleDateString('pt-BR') : '-'}</td>
                <td className="px-4 py-3 text-right space-x-1">
                  <button
                    onClick={() => openEdit(row)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs bg-slate-100 text-slate-700 hover:bg-slate-200"
                    data-testid={`edit-super-admin-${row.id}`}
                  >
                    <Pencil className="w-3 h-3" /> Editar
                  </button>
                  {!row.is_bootstrap && (
                    <button
                      onClick={() => remove(row)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs bg-red-50 text-red-700 hover:bg-red-100"
                      data-testid={`delete-super-admin-${row.id}`}
                    >
                      <Trash2 className="w-3 h-3" /> Excluir
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={close}>
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6"
            onClick={e => e.stopPropagation()}
            data-testid="super-admin-modal"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900">
                {form.id ? 'Editar Super Admin' : 'Novo Super Admin'}
              </h3>
              <button onClick={close} className="p-1 rounded hover:bg-slate-100">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Nome</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="Nome completo"
                  data-testid="super-admin-name"
                />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">E-mail</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="admin@empresa.com"
                  data-testid="super-admin-email"
                />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Senha {form.id && <span className="text-slate-400 normal-case font-normal">(deixe em branco para nao alterar)</span>}
                </label>
                <input
                  type="text"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder={form.id ? 'Nova senha (opcional)' : 'Senha de acesso'}
                  data-testid="super-admin-password"
                  autoComplete="new-password"
                />
                <p className="mt-1 text-[11px] text-slate-400">A senha eh criptografada (bcrypt) antes de salvar.</p>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={close}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100"
                data-testid="super-admin-cancel"
              >
                Cancelar
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
                data-testid="super-admin-save"
              >
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SuperAdminsPanel;
