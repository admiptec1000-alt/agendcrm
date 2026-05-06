import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { superAdminAPI } from '../../services/api';
import api from '../../services/api';
import { toast } from 'sonner';
import {
  LogOut, Building, Users, TrendingUp, DollarSign, Settings,
  Plus, Pencil, Trash2, X, ChevronRight, Search, LayoutGrid,
  Briefcase, BarChart3, Eye, Check, Scissors, Stethoscope,
  Headphones, Sparkles, GitBranch, Bot, Code, Menu, Globe,
  Monitor, ExternalLink, Tv, Link as LinkIcon, RefreshCw,
  Receipt, Package, Copy
} from 'lucide-react';

const iconMap = {
  Building, Scissors, Stethoscope, Headphones, LayoutGrid,
  Sparkles, GitBranch, Bot, Code, Briefcase, Settings, Users
};

const SuperAdminDashboard = () => {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [stats, setStats] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [businessTypes, setBusinessTypes] = useState([]);
  const [allFeatures, setAllFeatures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCompanyModal, setShowCompanyModal] = useState(false);
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [editingCompany, setEditingCompany] = useState(null);
  const [editingType, setEditingType] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    try {
      const [s, c, bt, f] = await Promise.all([
        superAdminAPI.getDashboard(),
        superAdminAPI.getCompanies(),
        superAdminAPI.getBusinessTypes(),
        superAdminAPI.getAllFeatures()
      ]);
      setStats(s.data);
      setCompanies(c.data);
      setBusinessTypes(bt.data);
      setAllFeatures(f.data);
    } catch (e) {
      toast.error('Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  const sidebarItems = [
    { key: 'dashboard', label: 'Dashboard', icon: BarChart3 },
    { key: 'companies', label: 'Empresas', icon: Building },
    { key: 'business-types', label: 'Tipos de Negocio', icon: Briefcase },
    { key: 'financial', label: 'Financeiro', icon: Receipt },
    { key: 'indoor', label: 'Indoor', icon: Tv },
    { key: 'settings', label: 'Configuracoes', icon: Settings },
  ];

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex">
      {/* Mobile overlay */}
      {mobileSidebarOpen && <div className="fixed inset-0 bg-slate-900/50 z-30 lg:hidden" onClick={() => setMobileSidebarOpen(false)} />}

      {/* Sidebar */}
      <aside className={`w-64 bg-white border-r border-slate-200 flex flex-col fixed h-full z-40 transition-transform duration-200 ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className="p-5 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold font-heading text-slate-900 tracking-tight">AgentCRM</h1>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Super Admin</p>
          </div>
          <button onClick={() => setMobileSidebarOpen(false)} className="lg:hidden p-1.5 rounded-lg hover:bg-slate-100" data-testid="close-sidebar-btn">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {sidebarItems.map(item => (
            <button
              key={item.key}
              onClick={() => { setActiveTab(item.key); setMobileSidebarOpen(false); }}
              data-testid={`sidebar-${item.key}`}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === item.key
                  ? 'bg-primary/10 text-primary'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-slate-200">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
              {user?.name?.[0] || 'A'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-900 truncate">{user?.name}</p>
              <p className="text-xs text-slate-500 truncate">{user?.email}</p>
            </div>
          </div>
          <button onClick={logout} data-testid="logout-button" className="w-full btn-secondary text-sm flex items-center justify-center gap-2">
            <LogOut className="w-4 h-4" /> Sair
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 lg:ml-64 transition-all duration-200 min-w-0">
        <header className="glass border-b border-slate-200 sticky top-0 z-20 px-4 lg:px-8 py-3 flex items-center gap-3">
          <button onClick={() => setMobileSidebarOpen(true)} className="lg:hidden p-2 rounded-lg hover:bg-slate-100" data-testid="mobile-menu-btn">
            <Menu className="w-5 h-5 text-slate-600" />
          </button>
          <h2 className="text-lg font-bold font-heading text-slate-900">
            {sidebarItems.find(i => i.key === activeTab)?.label || 'Dashboard'}
          </h2>
        </header>

        <div className="p-4 lg:p-8">
          {activeTab === 'dashboard' && <DashboardTab stats={stats} companies={companies} businessTypes={businessTypes} />}
          {activeTab === 'companies' && (
            <CompaniesTab
              companies={companies}
              businessTypes={businessTypes}
              allFeatures={allFeatures}
              searchTerm={searchTerm}
              setSearchTerm={setSearchTerm}
              onAdd={() => { setEditingCompany(null); setShowCompanyModal(true); }}
              onEdit={(c) => { setEditingCompany(c); setShowCompanyModal(true); }}
              onDelete={async (id) => {
                if (window.confirm('Tem certeza que deseja deletar esta empresa?')) {
                  await superAdminAPI.deleteCompany(id);
                  toast.success('Empresa deletada');
                  loadAll();
                }
              }}
              onImpersonate={async (c) => {
                try {
                  const { data } = await api.post(`/super-admin/companies/${c.id}/impersonate`);
                  // Open a fresh tab for the client's dashboard. The new
                  // tab consumes the token via ImpersonateHandler which
                  // stores it in **sessionStorage** (per-tab) so the
                  // SuperAdmin's localStorage token in this tab is NOT
                  // overwritten — preventing permission errors when the
                  // SuperAdmin keeps managing global resources here.
                  const url = `${window.location.origin}/__impersonate__?token=${encodeURIComponent(data.access_token)}&slug=${encodeURIComponent(data.company_slug || '')}`;
                  window.open(url, '_blank');
                } catch (e) {
                  toast.error('Falha ao acessar: ' + (e?.response?.data?.detail || e.message));
                }
              }}
              reload={loadAll}
            />
          )}
          {activeTab === 'business-types' && (
            <BusinessTypesTab
              businessTypes={businessTypes}
              allFeatures={allFeatures}
              onAdd={() => { setEditingType(null); setShowTypeModal(true); }}
              onEdit={(bt) => { setEditingType(bt); setShowTypeModal(true); }}
              onDelete={async (id) => {
                if (window.confirm('Tem certeza que deseja deletar este tipo?')) {
                  await superAdminAPI.deleteBusinessType(id);
                  toast.success('Tipo deletado');
                  loadAll();
                }
              }}
            />
          )}
          {activeTab === 'plans' && <PlansTab />}
          {activeTab === 'financial' && <FinancialTab companies={companies} />}
          {activeTab === 'indoor' && <IndoorTab companies={companies} />}
          {activeTab === 'settings' && <SettingsTab companies={companies} />}
        </div>
      </main>

      {/* Modals */}
      {showCompanyModal && (
        <CompanyModal
          company={editingCompany}
          businessTypes={businessTypes}
          allFeatures={allFeatures}
          onClose={() => setShowCompanyModal(false)}
          onSave={loadAll}
        />
      )}
      {showTypeModal && (
        <BusinessTypeModal
          businessType={editingType}
          allFeatures={allFeatures}
          onClose={() => setShowTypeModal(false)}
          onSave={loadAll}
        />
      )}
    </div>
  );
};

/* ========== DASHBOARD TAB ========== */
const DashboardTab = ({ stats, companies, businessTypes }) => (
  <div className="animate-fade-in">
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      <StatsCard title="Total de Empresas" value={stats?.total_companies || 0} icon={<Building className="w-6 h-6" />} color="bg-blue-500" />
      <StatsCard title="Empresas Ativas" value={stats?.active_companies || 0} icon={<TrendingUp className="w-6 h-6" />} color="bg-emerald-500" />
      <StatsCard title="Em Trial" value={stats?.trial_companies || 0} icon={<Eye className="w-6 h-6" />} color="bg-amber-500" />
      <StatsCard title="Tipos de Negocio" value={stats?.total_business_types || 0} icon={<Briefcase className="w-6 h-6" />} color="bg-violet-500" />
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="card">
        <h3 className="text-lg font-semibold font-heading text-slate-900 mb-4">Ultimas Empresas</h3>
        <div className="space-y-3">
          {companies.slice(0, 5).map(c => (
            <div key={c.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <div>
                <p className="text-sm font-medium text-slate-900">{c.name}</p>
                <p className="text-xs text-slate-500">{c.email}</p>
              </div>
              <StatusBadge status={c.status} />
            </div>
          ))}
          {companies.length === 0 && <p className="text-sm text-slate-500 text-center py-4">Nenhuma empresa cadastrada</p>}
        </div>
      </div>
      <div className="card">
        <h3 className="text-lg font-semibold font-heading text-slate-900 mb-4">Tipos de Negocio</h3>
        <div className="space-y-3">
          {businessTypes.map(bt => (
            <div key={bt.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                  <Briefcase className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-900">{bt.name}</p>
                  <p className="text-xs text-slate-500">{bt.base_type} - {bt.features?.length || 0} funcionalidades</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

/* ========== COMPANIES TAB ========== */
const CompaniesTab = ({ companies, businessTypes, searchTerm, setSearchTerm, onAdd, onEdit, onDelete, onImpersonate }) => {
  const filtered = companies.filter(c =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.cnpj || '').includes(searchTerm)
  );

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            type="text"
            data-testid="company-search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input-field pl-10 w-full"
            placeholder="Buscar por nome, CNPJ ou email..."
          />
        </div>
        <button onClick={onAdd} data-testid="add-company-btn" className="btn-primary flex items-center justify-center gap-2 whitespace-nowrap">
          <Plus className="w-4 h-4" /> Nova Empresa
        </button>
      </div>

      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full" data-testid="companies-table">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-3 px-4 text-xs font-bold uppercase tracking-widest text-slate-400">Empresa</th>
                <th className="text-left py-3 px-4 text-xs font-bold uppercase tracking-widest text-slate-400 hidden md:table-cell">Contato</th>
                <th className="text-left py-3 px-4 text-xs font-bold uppercase tracking-widest text-slate-400 hidden lg:table-cell">Subdominio</th>
                <th className="text-left py-3 px-4 text-xs font-bold uppercase tracking-widest text-slate-400 hidden md:table-cell">Tipo</th>
                <th className="text-left py-3 px-4 text-xs font-bold uppercase tracking-widest text-slate-400">Status</th>
                <th className="text-left py-3 px-4 text-xs font-bold uppercase tracking-widest text-slate-400">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(company => (
                <tr key={company.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors" data-testid={`company-row-${company.id}`}>
                  <td className="py-3 px-4">
                    <p className="text-sm font-medium text-slate-900">{company.name}</p>
                    {company.cnpj && <p className="text-xs text-slate-500">{company.cnpj}</p>}
                    <p className="text-xs text-slate-500 md:hidden">{company.email}</p>
                  </td>
                  <td className="py-3 px-4 hidden md:table-cell">
                    <p className="text-sm text-slate-600">{company.email}</p>
                    {company.phone && <p className="text-xs text-slate-500">{company.phone}</p>}
                  </td>
                  <td className="py-3 px-4 hidden lg:table-cell">
                    {company.subdomain ? (
                      <span className="text-xs px-2 py-1 bg-indigo-50 text-indigo-700 rounded-lg font-mono">{company.subdomain}</span>
                    ) : (
                      <span className="text-xs text-slate-400">-</span>
                    )}
                  </td>
                  <td className="py-3 px-4 hidden md:table-cell">
                    <span className="text-sm text-slate-600">{company.business_type_name || 'Personalizado'}</span>
                  </td>
                  <td className="py-3 px-4">
                    <StatusBadge status={company.status} />
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1">
                      <CompanyLinksDropdown company={company} />
                      <button onClick={() => onImpersonate(company)} data-testid={`impersonate-company-${company.id}`}
                        className="p-2 rounded-lg hover:bg-indigo-50 text-indigo-600 transition-colors" title="Gestão (acessar como admin)">
                        <Headphones className="w-4 h-4" />
                      </button>
                      <button onClick={() => onEdit(company)} data-testid={`edit-company-${company.id}`}
                        className="p-2 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => onDelete(company.id)} data-testid={`delete-company-${company.id}`}
                        className="p-2 rounded-lg hover:bg-red-50 text-red-500 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-sm text-slate-500">Nenhuma empresa encontrada</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

/* ========== BUSINESS TYPES TAB ========== */
const BusinessTypesTab = ({ businessTypes, allFeatures, onAdd, onEdit, onDelete }) => (
  <div className="animate-fade-in">
    <div className="flex items-center justify-between mb-6">
      <p className="text-slate-600">Configure os tipos de negocio e suas funcionalidades</p>
      <button onClick={onAdd} data-testid="add-business-type-btn" className="btn-primary flex items-center gap-2">
        <Plus className="w-4 h-4" /> Novo Tipo
      </button>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {businessTypes.map(bt => (
        <div key={bt.id} className="card hover:shadow-lg" data-testid={`bt-card-${bt.id}`}>
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                <Briefcase className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">{bt.name}</h3>
                <p className="text-xs text-slate-500">{bt.description}</p>
              </div>
            </div>
            <div className="flex gap-1">
              <button onClick={() => onEdit(bt)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600"><Pencil className="w-4 h-4" /></button>
              <button onClick={() => onDelete(bt.id)} className="p-2 rounded-lg hover:bg-red-50 text-red-500"><Trash2 className="w-4 h-4" /></button>
            </div>
          </div>
          <div className="flex items-center gap-2 mb-3">
            <PlanBadge planType={bt.base_type} />
            <span className="text-xs text-slate-500">{bt.features?.length || 0} funcionalidades</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(bt.features || []).filter(f => f.enabled).slice(0, 8).map(f => (
              <span key={f.feature_key} className="text-xs px-2 py-1 bg-slate-100 text-slate-600 rounded">
                {allFeatures.find(af => af.feature_key === f.feature_key)?.label || f.feature_key}
              </span>
            ))}
            {(bt.features || []).filter(f => f.enabled).length > 8 && (
              <span className="text-xs px-2 py-1 bg-primary/10 text-primary rounded">
                +{(bt.features || []).filter(f => f.enabled).length - 8} mais
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  </div>
);

/* ========== SETTINGS TAB ========== */

// ─── PLANS TAB ────────────────────────────────────────────────────────────────
const PlansTab = () => {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [showModal, setShowModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/super-admin/plans');
      setPlans(data || []);
    } catch (e) { toast.error('Erro ao carregar planos'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleSave = async (form) => {
    try {
      if (editing?.id) await api.put(`/super-admin/plans/${editing.id}`, form);
      else await api.post('/super-admin/plans', form);
      toast.success(editing?.id ? 'Plano atualizado' : 'Plano criado');
      setShowModal(false); setEditing(null);
      await load();
    } catch (e) { toast.error('Erro ao salvar: ' + (e?.response?.data?.detail || e.message)); }
  };

  const handleDuplicate = async (p) => {
    try {
      await api.post(`/super-admin/plans/${p.id}/duplicate`);
      toast.success('Plano duplicado');
      await load();
    } catch (e) { toast.error('Erro ao duplicar'); }
  };

  const handleDelete = async (p) => {
    if (!window.confirm(`Excluir o plano "${p.name}"?`)) return;
    try {
      await api.delete(`/super-admin/plans/${p.id}`);
      toast.success('Plano excluído');
      await load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Erro ao excluir'); }
  };

  return (
    <div className="space-y-4" data-testid="plans-tab">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">{plans.length} plano(s) cadastrado(s)</p>
        <button
          onClick={() => { setEditing(null); setShowModal(true); }}
          className="btn-primary text-sm flex items-center gap-2"
          data-testid="add-plan-btn"
        >
          <Plus className="w-4 h-4" /> Novo Plano
        </button>
      </div>
      {loading ? (
        <div className="py-12 text-center text-slate-400 text-sm">Carregando…</div>
      ) : plans.length === 0 ? (
        <div className="py-12 text-center text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-xl">
          Nenhum plano cadastrado. Clique em "Novo Plano" para criar.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {plans.map(p => (
            <div key={p.id} className="bg-white rounded-xl border border-slate-200 p-4 space-y-3" data-testid={`plan-card-${p.id}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-900 truncate">{p.name}</h3>
                  <p className="text-xs text-slate-500 truncate">{p.description || '—'}</p>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${p.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {p.is_active ? 'ATIVO' : 'INATIVO'}
                </span>
              </div>
              <div className="text-xl font-bold text-primary">
                R$ {(p.monthly_price || 0).toFixed(2)}<span className="text-xs text-slate-400 font-normal">/mês</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-slate-50 rounded p-2">
                  <p className="text-slate-500">Conexões</p>
                  <p className="font-bold text-slate-900">{p.max_connections}</p>
                </div>
                <div className="bg-slate-50 rounded p-2">
                  <p className="text-slate-500">Usuários</p>
                  <p className="font-bold text-slate-900">{p.max_users}</p>
                </div>
              </div>
              <div className="text-[10px] text-slate-500">
                Tipo: <span className="font-semibold uppercase">{p.plan_type}</span> · {(p.enabled_features || []).length} feature(s)
              </div>
              <div className="flex items-center gap-1 pt-2 border-t border-slate-100">
                <button onClick={() => { setEditing(p); setShowModal(true); }} className="flex-1 text-xs px-2 py-1.5 rounded border border-slate-300 hover:bg-slate-50 flex items-center justify-center gap-1" data-testid={`edit-plan-${p.id}`}>
                  <Pencil className="w-3 h-3" /> Editar
                </button>
                <button onClick={() => handleDuplicate(p)} className="flex-1 text-xs px-2 py-1.5 rounded border border-slate-300 hover:bg-slate-50 flex items-center justify-center gap-1" data-testid={`duplicate-plan-${p.id}`}>
                  <Copy className="w-3 h-3" /> Duplicar
                </button>
                <button onClick={() => handleDelete(p)} className="text-xs px-2 py-1.5 rounded border border-red-200 text-red-500 hover:bg-red-50" data-testid={`delete-plan-${p.id}`}>
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {showModal && (
        <PlanModal
          initial={editing}
          onClose={() => { setShowModal(false); setEditing(null); }}
          onSave={handleSave}
        />
      )}
    </div>
  );
};

const PlanModal = ({ initial, onClose, onSave }) => {
  const [businessTypes, setBusinessTypes] = useState([]);
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/super-admin/business-types');
        setBusinessTypes(Array.isArray(data) ? data : (data.items || []));
      } catch (e) { /* ignore */ }
    })();
  }, []);
  const [form, setForm] = useState({
    name: initial?.name || '',
    description: initial?.description || '',
    monthly_price: initial?.monthly_price ?? 0,
    plan_type: initial?.plan_type || 'both',
    max_connections: initial?.max_connections ?? 1,
    max_users: initial?.max_users ?? 1,
    enabled_features: initial?.enabled_features || [],
    is_active: initial?.is_active !== false,
    business_type_ids: initial?.business_type_ids || [],
    billing_cycle: initial?.billing_cycle || 'monthly',
    installments: initial?.installments ?? 1,
    grace_days: initial?.grace_days ?? 5,
  });
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  const toggleBt = (id) => {
    setForm(prev => ({
      ...prev,
      business_type_ids: prev.business_type_ids.includes(id)
        ? prev.business_type_ids.filter(x => x !== id)
        : [...prev.business_type_ids, id]
    }));
  };
  return (
    <div className="fixed inset-0 bg-black/60 z-[120] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()} data-testid="plan-modal">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h3 className="text-lg font-bold text-slate-900">{initial ? 'Editar Plano' : 'Novo Plano'}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">
          <div>
            <label className="text-xs font-medium text-slate-700 mb-1 block">Nome *</label>
            <input value={form.name} onChange={(e) => set('name', e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" data-testid="plan-name-input" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-700 mb-1 block">Descrição</label>
            <textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={2} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-700 mb-1 block">Preço mensal (R$)</label>
              <input type="number" min={0} step="0.01" value={form.monthly_price} onChange={(e) => set('monthly_price', parseFloat(e.target.value) || 0)} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" data-testid="plan-price-input" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700 mb-1 block">Tipo</label>
              <select value={form.plan_type} onChange={(e) => set('plan_type', e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded text-sm">
                <option value="crm">CRM</option>
                <option value="scheduling">Agendamento</option>
                <option value="both">CRM + Agendamento</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-700 mb-1 block">Máx. Conexões WhatsApp</label>
              <input type="number" min={0} value={form.max_connections} onChange={(e) => set('max_connections', parseInt(e.target.value, 10) || 0)} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" data-testid="plan-max-connections-input" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700 mb-1 block">Máx. Usuários</label>
              <input type="number" min={0} value={form.max_users} onChange={(e) => set('max_users', parseInt(e.target.value, 10) || 0)} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" data-testid="plan-max-users-input" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-700 mb-1 block">Ciclo</label>
              <select value={form.billing_cycle} onChange={(e) => set('billing_cycle', e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" data-testid="plan-cycle-select">
                <option value="monthly">Mensal</option>
                <option value="yearly">Anual</option>
                <option value="one_time">Pagamento único</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700 mb-1 block">Parcelas geradas</label>
              <input type="number" min={1} max={60} value={form.installments} onChange={(e) => set('installments', parseInt(e.target.value, 10) || 1)} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" data-testid="plan-installments-input" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700 mb-1 block">Dias p/ bloqueio</label>
              <input type="number" min={0} max={90} value={form.grace_days} onChange={(e) => set('grace_days', parseInt(e.target.value, 10) || 0)} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" data-testid="plan-grace-days-input" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-700 mb-1 block">Tipos de negócio (em quais este plano aparece)</label>
            <div className="flex flex-wrap gap-2 p-2 border border-slate-200 rounded max-h-32 overflow-y-auto">
              {businessTypes.length === 0 ? (
                <span className="text-xs text-slate-400">Nenhum tipo cadastrado ainda.</span>
              ) : businessTypes.map(bt => {
                const on = form.business_type_ids.includes(bt.id);
                return (
                  <button key={bt.id} type="button" onClick={() => toggleBt(bt.id)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition ${on ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
                    data-testid={`plan-bt-toggle-${bt.id}`}>
                    {bt.name}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-slate-500 mt-1">Na tela de cadastro pública (/landing), ao escolher um desses tipos o cliente verá este plano.</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
            Plano ativo (disponível para venda)
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded border border-slate-300 hover:bg-white">Cancelar</button>
          <button
            onClick={() => onSave(form)}
            disabled={!form.name?.trim()}
            className="px-4 py-2 text-sm rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
            data-testid="save-plan-btn"
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
};


// ─── FINANCIAL TAB (invoices + suspension control) ──────────────────────────
const FinancialTab = ({ companies }) => {
  const [subTab, setSubTab] = useState('invoices');
  return (
    <div className="space-y-4" data-testid="financial-tab">
      <div className="flex gap-2 border-b border-slate-200">
        <button
          data-testid="financial-subtab-invoices"
          onClick={() => setSubTab('invoices')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            subTab === 'invoices' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}>
          Faturas
        </button>
        <button
          data-testid="financial-subtab-external"
          onClick={() => setSubTab('external')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            subTab === 'external' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}>
          Clientes Externos
        </button>
      </div>
      {subTab === 'invoices' ? <InvoicesPanel companies={companies} /> : <ExternalClientsPanel />}
    </div>
  );
};

const InvoicesPanel = ({ companies }) => {
  const [data, setData] = useState({ items: [], total: 0, totals: { pending: 0, paid: 0, overdue: 0 } });
  const [externals, setExternals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCompany, setFilterCompany] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterCompany) params.company_id = filterCompany;
      if (filterStatus) params.status_filter = filterStatus;
      const [{ data: d }, { data: ex }] = await Promise.all([
        api.get('/super-admin/invoices', { params }),
        api.get('/super-admin/external-clients'),
      ]);
      setData(d);
      setExternals(ex || []);
    } catch (e) { toast.error('Erro ao carregar faturas'); }
    finally { setLoading(false); }
  }, [filterCompany, filterStatus]);
  useEffect(() => { load(); }, [load]);

  const markPaid = async (inv) => {
    try {
      await api.put(`/super-admin/invoices/${inv.id}`, { status: 'paid' });
      toast.success('Fatura marcada como paga');
      await load();
    } catch (e) { toast.error('Erro ao atualizar'); }
  };

  const del = async (inv) => {
    if (!window.confirm('Excluir esta fatura?')) return;
    await api.delete(`/super-admin/invoices/${inv.id}`);
    await load();
  };

  const runSuspension = async () => {
    if (!window.confirm('Rodar verificação de inadimplência? Empresas com atraso > grace_days serão suspensas.')) return;
    setRunning(true);
    try {
      const { data: r } = await api.post('/super-admin/invoices/run-suspension-check');
      toast.success(`${r.marked_overdue} faturas marcadas como vencidas, ${r.companies_suspended} empresa(s) suspensa(s)`);
      await load();
    } catch (e) { toast.error('Erro na rotina'); }
    finally { setRunning(false); }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-3"><p className="text-xs text-slate-500">A Receber</p><p className="text-lg font-bold text-amber-600">R$ {(data.totals?.pending || 0).toFixed(2)}</p></div>
        <div className="card p-3"><p className="text-xs text-slate-500">Vencido</p><p className="text-lg font-bold text-red-600">R$ {(data.totals?.overdue || 0).toFixed(2)}</p></div>
        <div className="card p-3"><p className="text-xs text-slate-500">Pago</p><p className="text-lg font-bold text-emerald-600">R$ {(data.totals?.paid || 0).toFixed(2)}</p></div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <select value={filterCompany} onChange={(e) => setFilterCompany(e.target.value)} className="px-3 py-2 border border-slate-300 rounded text-sm" data-testid="financial-filter-company">
          <option value="">— Todas empresas —</option>
          {(companies || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="px-3 py-2 border border-slate-300 rounded text-sm" data-testid="financial-filter-status">
          <option value="">— Todos status —</option>
          <option value="pending">A receber</option>
          <option value="overdue">Vencido</option>
          <option value="paid">Pago</option>
          <option value="canceled">Cancelado</option>
        </select>
        <button onClick={() => setShowNew(true)} className="btn-primary text-sm flex items-center gap-2" data-testid="add-invoice-btn"><Plus className="w-4 h-4" /> Nova fatura</button>
        <button onClick={runSuspension} disabled={running} className="px-3 py-2 text-sm rounded border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-60" data-testid="run-suspension-btn">
          {running ? 'Rodando…' : 'Rodar inadimplência'}
        </button>
      </div>
      {loading ? (
        <div className="py-12 text-center text-slate-400 text-sm">Carregando…</div>
      ) : data.items.length === 0 ? (
        <div className="py-12 text-center text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-xl">Sem faturas.</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-left px-4 py-2.5">Cliente</th>
                <th className="text-left px-4 py-2.5">Tipo</th>
                <th className="text-left px-4 py-2.5">Descrição</th>
                <th className="text-left px-4 py-2.5">Vencimento</th>
                <th className="text-right px-4 py-2.5">Valor</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map(inv => {
                const statusClr = inv.status === 'paid' ? 'bg-emerald-100 text-emerald-700'
                  : inv.status === 'overdue' ? 'bg-red-100 text-red-700'
                  : inv.status === 'canceled' ? 'bg-slate-100 text-slate-500'
                  : 'bg-amber-100 text-amber-700';
                const isExternal = inv.client_kind === 'external';
                return (
                  <tr key={inv.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`invoice-row-${inv.id}`}>
                    <td className="px-4 py-2.5 font-medium text-slate-900">{inv.client_name || inv.company_name}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${isExternal ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'}`}>
                        {isExternal ? 'AVULSO' : 'EMPRESA'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{inv.description || '—'}</td>
                    <td className="px-4 py-2.5 text-slate-600">{inv.due_date}</td>
                    <td className="px-4 py-2.5 text-right font-bold">R$ {(inv.amount || 0).toFixed(2)}</td>
                    <td className="px-4 py-2.5"><span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${statusClr}`}>{inv.status?.toUpperCase()}</span></td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {inv.status !== 'paid' && (
                        <button onClick={() => markPaid(inv)} className="text-xs px-2 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 mr-1" data-testid={`mark-paid-${inv.id}`}>Pago</button>
                      )}
                      <button onClick={() => del(inv)} className="p-1.5 rounded hover:bg-red-50 text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {showNew && (
        <NewInvoiceModal
          companies={companies}
          externals={externals}
          onClose={() => setShowNew(false)}
          onSaved={async () => { setShowNew(false); await load(); }}
        />
      )}
    </div>
  );
};

const ExternalClientsPanel = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [showModal, setShowModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/super-admin/external-clients');
      setItems(data || []);
    } catch (e) { toast.error('Erro ao carregar clientes externos'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const remove = async (cli) => {
    if (!window.confirm(`Remover "${cli.name}"?`)) return;
    try {
      await api.delete(`/super-admin/external-clients/${cli.id}`);
      toast.success('Cliente removido');
      await load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Falha ao remover'); }
  };

  return (
    <div className="space-y-4" data-testid="external-clients-panel">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          Clientes que <strong>não usam o sistema</strong> mas você cobra mensalmente (consultorias, contratos avulsos, etc).
        </p>
        <button
          data-testid="add-external-btn"
          onClick={() => { setEditing(null); setShowModal(true); }}
          className="btn-primary text-sm flex items-center gap-2">
          <Plus className="w-4 h-4" /> Novo cliente externo
        </button>
      </div>
      {loading ? (
        <div className="py-12 text-center text-slate-400 text-sm">Carregando…</div>
      ) : items.length === 0 ? (
        <div className="py-12 text-center text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-xl">
          Nenhum cliente externo cadastrado ainda.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-left px-4 py-2.5">Nome</th>
                <th className="text-left px-4 py-2.5">CNPJ</th>
                <th className="text-left px-4 py-2.5">E-mail</th>
                <th className="text-left px-4 py-2.5">Telefone</th>
                <th className="text-left px-4 py-2.5">Notas</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {items.map(c => (
                <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`external-row-${c.id}`}>
                  <td className="px-4 py-2.5 font-medium text-slate-900">{c.name}</td>
                  <td className="px-4 py-2.5 text-slate-600">{c.cnpj || '—'}</td>
                  <td className="px-4 py-2.5 text-slate-600">{c.email || '—'}</td>
                  <td className="px-4 py-2.5 text-slate-600">{c.phone || '—'}</td>
                  <td className="px-4 py-2.5 text-slate-600 truncate max-w-[200px]">{c.notes || '—'}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button
                      data-testid={`edit-external-${c.id}`}
                      onClick={() => { setEditing(c); setShowModal(true); }}
                      className="p-1.5 rounded hover:bg-slate-100 text-slate-600 mr-1">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      data-testid={`delete-external-${c.id}`}
                      onClick={() => remove(c)}
                      className="p-1.5 rounded hover:bg-red-50 text-red-500">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showModal && (
        <ExternalClientModal
          client={editing}
          onClose={() => setShowModal(false)}
          onSaved={async () => { setShowModal(false); await load(); }}
        />
      )}
    </div>
  );
};

const ExternalClientModal = ({ client, onClose, onSaved }) => {
  const [form, setForm] = useState({
    name: client?.name || '',
    cnpj: client?.cnpj || '',
    email: client?.email || '',
    phone: client?.phone || '',
    notes: client?.notes || '',
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.name.trim()) return toast.error('Nome obrigatório');
    setSaving(true);
    try {
      if (client?.id) {
        await api.put(`/super-admin/external-clients/${client.id}`, form);
        toast.success('Cliente atualizado');
      } else {
        await api.post('/super-admin/external-clients', form);
        toast.success('Cliente criado');
      }
      onSaved();
    } catch (e) { toast.error(e.response?.data?.detail || 'Falha ao salvar'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[120] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()} data-testid="external-modal">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h3 className="text-lg font-bold">{client ? 'Editar' : 'Novo'} Cliente Externo</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-700 mb-1 block">Nome *</label>
            <input data-testid="external-name-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-700 mb-1 block">CNPJ</label>
              <input data-testid="external-cnpj-input" value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700 mb-1 block">Telefone</label>
              <input data-testid="external-phone-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-700 mb-1 block">E-mail</label>
            <input data-testid="external-email-input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-700 mb-1 block">Notas</label>
            <textarea data-testid="external-notes-input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" rows={3} />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded border border-slate-300 hover:bg-white">Cancelar</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 text-sm rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50" data-testid="save-external-btn">
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
};

const NewInvoiceModal = ({ companies, externals, onClose, onSaved }) => {
  const today = new Date().toISOString().slice(0, 10);
  const [kind, setKind] = useState('company'); // 'company' | 'external'
  const [form, setForm] = useState({ company_id: '', external_client_id: '', amount: 0, due_date: today, description: '' });
  const save = async () => {
    if (kind === 'company' && !form.company_id) return toast.error('Selecione uma empresa');
    if (kind === 'external' && !form.external_client_id) return toast.error('Selecione um cliente externo');
    try {
      const payload = {
        amount: form.amount,
        due_date: form.due_date,
        description: form.description,
      };
      if (kind === 'company') payload.company_id = form.company_id;
      else payload.external_client_id = form.external_client_id;
      await api.post('/super-admin/invoices', payload);
      toast.success('Fatura criada');
      onSaved();
    } catch (e) { toast.error(e.response?.data?.detail || 'Erro ao criar fatura'); }
  };
  return (
    <div className="fixed inset-0 bg-black/60 z-[120] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()} data-testid="new-invoice-modal">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h3 className="text-lg font-bold">Nova Fatura Manual</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="flex gap-2">
            <button
              data-testid="kind-company-btn"
              onClick={() => setKind('company')}
              className={`flex-1 px-3 py-2 text-sm rounded border ${kind === 'company' ? 'border-primary bg-primary/10 text-primary font-semibold' : 'border-slate-300 text-slate-600'}`}>
              Empresa do sistema
            </button>
            <button
              data-testid="kind-external-btn"
              onClick={() => setKind('external')}
              className={`flex-1 px-3 py-2 text-sm rounded border ${kind === 'external' ? 'border-primary bg-primary/10 text-primary font-semibold' : 'border-slate-300 text-slate-600'}`}>
              Cliente externo (avulso)
            </button>
          </div>
          {kind === 'company' ? (
            <div>
              <label className="text-xs font-medium text-slate-700 mb-1 block">Empresa *</label>
              <select value={form.company_id} onChange={(e) => setForm({ ...form, company_id: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" data-testid="invoice-company-select">
                <option value="">— Selecione —</option>
                {(companies || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          ) : (
            <div>
              <label className="text-xs font-medium text-slate-700 mb-1 block">Cliente Externo *</label>
              <select value={form.external_client_id} onChange={(e) => setForm({ ...form, external_client_id: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" data-testid="invoice-external-select">
                <option value="">— Selecione —</option>
                {(externals || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {(!externals || externals.length === 0) && (
                <p className="text-xs text-amber-600 mt-1">Nenhum cliente externo cadastrado. Cadastre na aba "Clientes Externos".</p>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-700 mb-1 block">Valor (R$)</label>
              <input type="number" min={0} step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" data-testid="invoice-amount-input" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700 mb-1 block">Vencimento</label>
              <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" data-testid="invoice-due-input" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-700 mb-1 block">Descrição</label>
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded border border-slate-300 hover:bg-white">Cancelar</button>
          <button onClick={save} className="px-4 py-2 text-sm rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50" data-testid="save-invoice-btn">Salvar</button>
        </div>
      </div>
    </div>
  );
};


const SettingsTab = ({ companies }) => {
  const [settings, setSettings] = useState({ financial_manager_company_id: '' });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/super-admin/settings');
        setSettings({ financial_manager_company_id: data.financial_manager_company_id || '' });
      } catch (e) { /* first access: no doc yet */ }
      finally { setLoading(false); }
    })();
  }, []);
  const save = async () => {
    setSaving(true);
    try {
      await api.put('/super-admin/settings', settings);
      toast.success('Configurações salvas');
    } catch (e) { toast.error('Falha ao salvar configurações'); }
    finally { setSaving(false); }
  };
  return (
    <div className="animate-fade-in card max-w-2xl" data-testid="settings-tab">
      <h3 className="text-lg font-semibold font-heading text-slate-900 mb-4">Configuracoes Globais</h3>
      {loading ? (
        <p className="text-sm text-slate-400">Carregando…</p>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-700 mb-1 block">
              Empresa Gestora Financeira (opcional)
            </label>
            <select
              value={settings.financial_manager_company_id}
              onChange={(e) => setSettings({ ...settings, financial_manager_company_id: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
              data-testid="settings-financial-mgr-select"
            >
              <option value="">— Nenhuma (SuperAdmin gerencia) —</option>
              {(companies || []).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1">
              Essa empresa terá acesso a um menu especial "Gestão SuperAdmin" com as faturas e clientes da plataforma.
            </p>
          </div>
          <button
            onClick={save}
            disabled={saving}
            className="btn-primary text-sm"
            data-testid="save-settings-btn"
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      )}
    </div>
  );
};

/* ========== INDOOR TAB (Super Admin) ========== */
const CompanyLinksDropdown = ({ company }) => {
  const [open, setOpen] = useState(false);
  const ref = React.useRef(null);
  const slug = company.subdomain || company.slug || (company.name || '').toLowerCase().replace(/\s/g, '');
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const links = [
    { key: 'painel', label: 'Painel Admin', path: `/${slug}/painel`, hint: 'Acesso administrativo' },
    { key: 'booking', label: 'Agenda Publica', path: `/${slug}`, hint: 'Pagina de agendamento do cliente' },
    { key: 'indoor', label: 'TV Indoor', path: `/${slug}/indoor`, hint: 'Tela da recepcao' },
  ];

  const copy = async (url) => {
    try { await navigator.clipboard.writeText(url); toast.success('Link copiado!'); }
    catch { toast.error('Falha ao copiar'); }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="p-2 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors"
        title="Links da empresa"
        data-testid={`company-links-${company.id}`}
      >
        <LinkIcon className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
            <p className="text-[10px] uppercase tracking-widest font-bold text-slate-500">Links da empresa</p>
            <p className="text-xs font-semibold text-slate-800 truncate">{company.name}</p>
          </div>
          <div className="divide-y divide-slate-100">
            {links.map(l => {
              const fullUrl = `${origin}${l.path}`;
              return (
                <div key={l.key} className="p-2.5 hover:bg-slate-50" data-testid={`link-${l.key}-${company.id}`}>
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-slate-900">{l.label}</p>
                      <p className="text-[10px] text-slate-500">{l.hint}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => copy(fullUrl)}
                        className="p-1.5 rounded-md hover:bg-slate-200 text-slate-500 hover:text-slate-800"
                        title="Copiar"
                      >
                        <LinkIcon className="w-3.5 h-3.5" />
                      </button>
                      <a
                        href={fullUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 rounded-md hover:bg-slate-200 text-slate-500 hover:text-slate-800"
                        title="Abrir"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-400 truncate mt-1 font-mono">{l.path}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const IndoorTab = ({ companies }) => {
  const [globalLinks, setGlobalLinks] = useState([]);
  const [newGlobal, setNewGlobal] = useState('');
  const [loading, setLoading] = useState(true);
  const [expandedCompany, setExpandedCompany] = useState(null);

  useEffect(() => {
    superAdminAPI.getGlobalIndoor()
      .then(r => setGlobalLinks(r.data.media_links || []))
      .catch(() => setGlobalLinks([]))
      .finally(() => setLoading(false));
  }, []);

  const saveGlobal = async (links) => {
    try {
      await superAdminAPI.updateGlobalIndoor({ media_links: links });
      setGlobalLinks(links);
      toast.success('Midia global salva');
    } catch (e) {
      toast.error('Erro ao salvar');
    }
  };

  const addGlobal = () => {
    const v = newGlobal.trim();
    if (!v) return;
    saveGlobal([...globalLinks, v]);
    setNewGlobal('');
  };

  const removeGlobal = (idx) => saveGlobal(globalLinks.filter((_, i) => i !== idx));

  if (loading) return <div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" /></div>;

  return (
    <div className="animate-fade-in space-y-6">
      {/* GLOBAL MEDIA */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-lg font-semibold font-heading text-slate-900">Midias Globais</h3>
            <p className="text-xs text-slate-500">Exibidas em TODAS as TVs indoor, intercalando com o conteudo local</p>
          </div>
          <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary font-semibold">{globalLinks.length}</span>
        </div>
        <div className="flex gap-2 mb-3">
          <input
            value={newGlobal}
            onChange={e => setNewGlobal(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addGlobal()}
            placeholder="YouTube, Google Drive, Vimeo ou URL direta .mp4"
            className="input-field flex-1"
            data-testid="global-media-input"
          />
          <button onClick={addGlobal} className="btn-primary text-sm" data-testid="global-media-add">Adicionar</button>
        </div>
        <div className="space-y-1.5">
          {globalLinks.map((link, i) => (
            <div key={`g-${i}`} className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg">
              <LinkIcon className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <span className="text-xs text-slate-700 truncate flex-1">{link}</span>
              <a href={link} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-primary"><ExternalLink className="w-4 h-4" /></a>
              <button onClick={() => removeGlobal(i)} className="text-red-500 hover:text-red-700"><X className="w-4 h-4" /></button>
            </div>
          ))}
          {globalLinks.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-6">Nenhuma midia global</p>
          )}
        </div>
      </div>

      {/* PER-COMPANY INDOOR */}
      <div className="card">
        <h3 className="text-lg font-semibold font-heading text-slate-900 mb-3">Indoor por Empresa</h3>
        <p className="text-xs text-slate-500 mb-4">Clique em uma empresa para editar as midias locais e o link publico</p>
        <div className="space-y-2">
          {companies.map(c => (
            <CompanyIndoorRow
              key={c.id}
              company={c}
              expanded={expandedCompany === c.id}
              onToggle={() => setExpandedCompany(expandedCompany === c.id ? null : c.id)}
            />
          ))}
          {companies.length === 0 && <p className="text-xs text-slate-400 text-center py-6">Nenhuma empresa</p>}
        </div>
      </div>
    </div>
  );
};

const CompanyIndoorRow = ({ company, expanded, onToggle }) => {
  const [data, setData] = useState(null);
  const [newLink, setNewLink] = useState('');
  const [loading, setLoading] = useState(false);
  const slug = company.subdomain || company.slug || company.name?.toLowerCase().replace(/\s/g, '');
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  useEffect(() => {
    if (!expanded) return;
    setLoading(true);
    superAdminAPI.getCompanyIndoor(company.id)
      .then(r => setData(r.data))
      .catch(() => setData({ media_links: [], layout: 'grid', slide_duration: 10 }))
      .finally(() => setLoading(false));
  }, [expanded, company.id]);

  const save = async (patch) => {
    try {
      const r = await superAdminAPI.updateCompanyIndoor(company.id, patch);
      setData(r.data);
      toast.success('Atualizado');
    } catch { toast.error('Erro ao salvar'); }
  };

  const addLink = () => {
    const v = newLink.trim();
    if (!v) return;
    save({ media_links: [...(data?.media_links || []), v] });
    setNewLink('');
  };

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden" data-testid={`company-indoor-${company.id}`}>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 hover:bg-slate-50 text-left"
      >
        <div className="flex items-center gap-3">
          <Tv className="w-5 h-5 text-slate-400" />
          <div>
            <p className="font-semibold text-sm text-slate-900">{company.name}</p>
            <p className="text-[11px] text-slate-500">/{slug}/indoor</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`${origin}/${slug}/indoor`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            <ExternalLink className="w-3 h-3" /> Abrir
          </a>
          <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </div>
      </button>
      {expanded && (
        <div className="p-3 border-t border-slate-200 bg-slate-50 space-y-3">
          {loading ? (
            <p className="text-xs text-slate-500">Carregando...</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Duracao (s)</label>
                  <input
                    type="number"
                    value={data?.slide_duration || 10}
                    onChange={e => save({ slide_duration: parseInt(e.target.value) || 10 })}
                    className="input-field !py-1.5 text-sm"
                    min={5}
                    max={120}
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Layout</label>
                  <select
                    value={data?.layout || 'grid'}
                    onChange={e => save({ layout: e.target.value })}
                    className="input-field !py-1.5 text-sm"
                  >
                    <option value="grid">Lista</option>
                    <option value="columns">Colunas por profissional</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Adicionar midia local</label>
                <div className="flex gap-2">
                  <input
                    value={newLink}
                    onChange={e => setNewLink(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addLink()}
                    placeholder="URL de video/imagem"
                    className="input-field !py-1.5 flex-1 text-sm"
                  />
                  <button onClick={addLink} className="btn-primary text-sm">+</button>
                </div>
              </div>
              <div className="space-y-1">
                {(data?.media_links || []).map((l, i) => (
                  <div key={`cl-${i}`} className="flex items-center gap-2 p-1.5 bg-white rounded">
                    <span className="text-xs text-slate-700 truncate flex-1">{l}</span>
                    <button
                      onClick={() => save({ media_links: data.media_links.filter((_, idx) => idx !== i) })}
                      className="text-red-500 hover:text-red-700"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {(data?.media_links || []).length === 0 && <p className="text-[11px] text-slate-400 text-center py-2">Nenhuma midia local</p>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

/* ========== COMPANY MODAL ========== */
const CompanyModal = ({ company, businessTypes, allFeatures, onClose, onSave }) => {
  const isEditing = !!company;
  const [form, setForm] = useState({
    name: company?.name || '',
    cnpj: company?.cnpj || '',
    email: company?.email || '',
    phone: company?.phone || '',
    plan_type: company?.plan_type || 'both',
    business_type_id: company?.business_type_id || '',
    admin_name: '',
    admin_email: '',
    admin_password: '',
    status: company?.status || 'active',
    subdomain: company?.subdomain || '',
  });
  const [customFeatures, setCustomFeatures] = useState(company?.features || []);
  const [showCustomFeatures, setShowCustomFeatures] = useState(!form.business_type_id);
  const [saving, setSaving] = useState(false);

  const handleTypeChange = (typeId) => {
    setForm({ ...form, business_type_id: typeId });
    if (typeId) {
      const bt = businessTypes.find(t => t.id === typeId);
      if (bt) {
        setForm(f => ({ ...f, plan_type: bt.base_type }));
        setCustomFeatures(bt.features || []);
        setShowCustomFeatures(false);
      }
    } else {
      setShowCustomFeatures(true);
    }
  };

  const toggleFeature = (featureKey) => {
    const existing = customFeatures.find(f => f.feature_key === featureKey);
    if (existing) {
      setCustomFeatures(customFeatures.map(f => f.feature_key === featureKey ? { ...f, enabled: !f.enabled } : f));
    } else {
      setCustomFeatures([...customFeatures, { feature_key: featureKey, enabled: true }]);
    }
  };

  const isFeatureEnabled = (featureKey) => {
    const f = customFeatures.find(cf => cf.feature_key === featureKey);
    return f?.enabled || false;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (isEditing) {
        await superAdminAPI.updateCompany(company.id, {
          name: form.name,
          cnpj: form.cnpj,
          email: form.email,
          phone: form.phone,
          plan_type: form.plan_type,
          business_type_id: form.business_type_id || null,
          status: form.status,
          subdomain: form.subdomain || null,
        });
        if (showCustomFeatures) {
          await superAdminAPI.updateCompanyFeatures(company.id, customFeatures);
        }
        toast.success('Empresa atualizada!');
      } else {
        if (!form.admin_email || !form.admin_password || !form.admin_name) {
          toast.error('Preencha os dados do administrador');
          setSaving(false);
          return;
        }
        await superAdminAPI.createCompany({
          ...form,
          business_type_id: form.business_type_id || null,
          subdomain: form.subdomain || null,
        });
        toast.success('Empresa criada!');
      }
      onSave();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const crmFeatures = allFeatures.filter(f => f.category === 'crm');
  const schedFeatures = allFeatures.filter(f => f.category === 'scheduling');
  const sharedFeatures = allFeatures.filter(f => f.category === 'shared');

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-6 border-b border-slate-200 sticky top-0 bg-white z-10">
          <h2 className="text-xl font-bold font-heading text-slate-900">
            {isEditing ? 'Editar Empresa' : 'Nova Empresa'}
          </h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-6">
          {/* Company Info */}
          <div>
            <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-4">Dados da Empresa</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nome da Empresa</label>
                <input data-testid="company-name-input" value={form.name} onChange={e => {
                  const name = e.target.value;
                  const slug = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                  setForm({...form, name, subdomain: form.subdomain || slug});
                }} className="input-field" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">CNPJ</label>
                <input data-testid="company-cnpj-input" value={form.cnpj} onChange={e => setForm({...form, cnpj: e.target.value})} className="input-field" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                <input type="email" data-testid="company-email-input" value={form.email} onChange={e => setForm({...form, email: e.target.value})} className="input-field" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Telefone</label>
                <input data-testid="company-phone-input" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} className="input-field" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Subdominio / Slug</label>
                <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden">
                  <span className="px-3 py-2 bg-slate-50 text-xs text-slate-500 border-r border-slate-200 whitespace-nowrap">{window.location.origin}/</span>
                  <input data-testid="company-subdomain-input" value={form.subdomain}
                    onChange={e => setForm({...form, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')})}
                    className="flex-1 px-3 py-2 text-sm focus:outline-none" placeholder="meu-salao" />
                </div>
                <p className="text-xs text-slate-500 mt-1">Usado para acesso publico: /nome-da-loja</p>
              </div>
            </div>
          </div>

          {/* Business Type */}
          <div>
            <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-4">Tipo de Negocio</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {businessTypes.map(bt => (
                <button key={bt.id} type="button" onClick={() => handleTypeChange(bt.id)}
                  data-testid={`bt-option-${bt.id}`}
                  className={`p-4 rounded-lg border-2 text-left transition-all ${
                    form.business_type_id === bt.id ? 'border-primary bg-primary/5' : 'border-slate-200 hover:border-slate-300'
                  }`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${form.business_type_id === bt.id ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600'}`}>
                      <Briefcase className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="font-medium text-slate-900">{bt.name}</p>
                      <p className="text-xs text-slate-500">{bt.base_type} - {bt.features?.filter(f => f.enabled)?.length || 0} funcionalidades</p>
                    </div>
                    {form.business_type_id === bt.id && <Check className="w-5 h-5 text-primary ml-auto" />}
                  </div>
                </button>
              ))}
              <button type="button" onClick={() => handleTypeChange('')}
                data-testid="bt-option-custom"
                className={`p-4 rounded-lg border-2 text-left transition-all ${
                  showCustomFeatures && !form.business_type_id ? 'border-primary bg-primary/5' : 'border-slate-200 hover:border-slate-300'
                }`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${showCustomFeatures && !form.business_type_id ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600'}`}>
                    <Settings className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-medium text-slate-900">Personalizado</p>
                    <p className="text-xs text-slate-500">Configure funcionalidades manualmente</p>
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* Custom Features */}
          {showCustomFeatures && (
            <div>
              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-4">Funcionalidades</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FeatureGroup title="CRM" features={crmFeatures} customFeatures={customFeatures} toggleFeature={toggleFeature} isFeatureEnabled={isFeatureEnabled} />
                <FeatureGroup title="Agendamento" features={schedFeatures} customFeatures={customFeatures} toggleFeature={toggleFeature} isFeatureEnabled={isFeatureEnabled} />
              </div>
              <div className="mt-4">
                <FeatureGroup title="Compartilhado" features={sharedFeatures} customFeatures={customFeatures} toggleFeature={toggleFeature} isFeatureEnabled={isFeatureEnabled} />
              </div>
              <div className="mt-3">
                <label className="block text-sm font-medium text-slate-700 mb-1">Tipo de Plano</label>
                <select data-testid="plan-type-select" value={form.plan_type} onChange={e => setForm({...form, plan_type: e.target.value})} className="input-field">
                  <option value="crm">CRM</option>
                  <option value="scheduling">Agendamento</option>
                  <option value="both">Ambos</option>
                </select>
              </div>
            </div>
          )}

          {/* Status (editing only) */}
          {isEditing && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
              <select data-testid="company-status-select" value={form.status} onChange={e => setForm({...form, status: e.target.value})} className="input-field">
                <option value="active">Ativa</option>
                <option value="trial">Trial</option>
                <option value="blocked">Bloqueada</option>
              </select>
            </div>
          )}

          {/* Admin User (creating only) */}
          {!isEditing && (
            <div>
              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-4">Administrador da Empresa</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nome</label>
                  <input data-testid="admin-name-input" value={form.admin_name} onChange={e => setForm({...form, admin_name: e.target.value})} className="input-field" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                  <input type="email" data-testid="admin-email-input" value={form.admin_email} onChange={e => setForm({...form, admin_email: e.target.value})} className="input-field" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Senha</label>
                  <input type="password" data-testid="admin-password-input" value={form.admin_password} onChange={e => setForm({...form, admin_password: e.target.value})} className="input-field" required />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 p-6 border-t border-slate-200 sticky bottom-0 bg-white">
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button onClick={handleSave} disabled={saving} data-testid="save-company-btn" className="btn-primary">
            {saving ? 'Salvando...' : isEditing ? 'Salvar Alteracoes' : 'Criar Empresa'}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ========== BUSINESS TYPE MODAL ========== */
const BusinessTypeModal = ({ businessType, allFeatures, onClose, onSave }) => {
  const isEditing = !!businessType;
  const [form, setForm] = useState({
    name: businessType?.name || '',
    description: businessType?.description || '',
    icon: businessType?.icon || 'Building',
    base_type: businessType?.base_type || 'both',
    monthly_price: businessType?.monthly_price ?? 0,
    billing_cycle: businessType?.billing_cycle || 'monthly',
    installments: businessType?.installments ?? 1,
    grace_days: businessType?.grace_days ?? 5,
    max_connections: businessType?.max_connections ?? 1,
    max_users: businessType?.max_users ?? 1,
  });
  const [features, setFeatures] = useState(businessType?.features || []);
  const [mobileBottomNav, setMobileBottomNav] = useState(businessType?.mobile_bottom_nav || []);
  const [saving, setSaving] = useState(false);

  const toggleBottomNav = (featureKey) => {
    setMobileBottomNav((curr) => {
      if (curr.includes(featureKey)) return curr.filter(k => k !== featureKey);
      if (curr.length >= 4) {
        toast.error('Maximo de 4 itens na barra inferior');
        return curr;
      }
      return [...curr, featureKey];
    });
  };

  const toggleFeature = (featureKey) => {
    const existing = features.find(f => f.feature_key === featureKey);
    if (existing) {
      setFeatures(features.map(f => f.feature_key === featureKey ? { ...f, enabled: !f.enabled } : f));
    } else {
      setFeatures([...features, { feature_key: featureKey, enabled: true }]);
    }
  };

  const isFeatureEnabled = (featureKey) => {
    const f = features.find(cf => cf.feature_key === featureKey);
    return f?.enabled || false;
  };

  const enableAll = (category) => {
    const categoryFeatures = allFeatures.filter(f => f.category === category);
    const updated = [...features];
    categoryFeatures.forEach(cf => {
      const idx = updated.findIndex(f => f.feature_key === cf.feature_key);
      if (idx >= 0) updated[idx] = { ...updated[idx], enabled: true };
      else updated.push({ feature_key: cf.feature_key, enabled: true });
    });
    setFeatures(updated);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const data = { ...form, features, mobile_bottom_nav: mobileBottomNav };
      if (isEditing) {
        await superAdminAPI.updateBusinessType(businessType.id, data);
        toast.success('Tipo atualizado!');
      } else {
        await superAdminAPI.createBusinessType(data);
        toast.success('Tipo criado!');
      }
      onSave();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const crmFeatures = allFeatures.filter(f => f.category === 'crm');
  const schedFeatures = allFeatures.filter(f => f.category === 'scheduling');
  const sharedFeatures = allFeatures.filter(f => f.category === 'shared');

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-6 border-b border-slate-200 sticky top-0 bg-white z-10">
          <h2 className="text-xl font-bold font-heading text-slate-900">
            {isEditing ? 'Editar Tipo de Negocio' : 'Novo Tipo de Negocio'}
          </h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Nome</label>
              <input data-testid="bt-name-input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="input-field" placeholder="Ex: Salao de Beleza" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Tipo Base</label>
              <select data-testid="bt-base-type" value={form.base_type} onChange={e => setForm({...form, base_type: e.target.value})} className="input-field">
                <option value="crm">CRM</option>
                <option value="scheduling">Agendamento</option>
                <option value="both">Ambos</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Descricao</label>
            <input data-testid="bt-description-input" value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="input-field" />
          </div>

          <div className="border-t border-slate-200 pt-5">
            <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-1">Plano e Cobranca</h3>
            <p className="text-xs text-slate-500 mb-4">
              Estes valores sao aplicados automaticamente quando uma empresa for vinculada a este Tipo de Negocio. As faturas sao geradas no cadastro da empresa.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Valor mensal (R$)</label>
                <input
                  type="number" min={0} step="0.01"
                  data-testid="bt-monthly-price"
                  value={form.monthly_price}
                  onChange={e => setForm({...form, monthly_price: parseFloat(e.target.value) || 0})}
                  className="input-field" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Ciclo</label>
                <select
                  data-testid="bt-billing-cycle"
                  value={form.billing_cycle}
                  onChange={e => setForm({...form, billing_cycle: e.target.value})}
                  className="input-field">
                  <option value="monthly">Mensal</option>
                  <option value="yearly">Anual</option>
                  <option value="one_time">Avulso</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Parcelas</label>
                <input
                  type="number" min={1} max={60}
                  data-testid="bt-installments"
                  value={form.installments}
                  onChange={e => setForm({...form, installments: Math.max(1, parseInt(e.target.value) || 1)})}
                  className="input-field" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Carencia (dias)</label>
                <input
                  type="number" min={0} max={90}
                  data-testid="bt-grace-days"
                  value={form.grace_days}
                  onChange={e => setForm({...form, grace_days: Math.max(0, parseInt(e.target.value) || 0)})}
                  className="input-field" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Max. conexoes</label>
                <input
                  type="number" min={0} max={50}
                  data-testid="bt-max-connections"
                  value={form.max_connections}
                  onChange={e => setForm({...form, max_connections: Math.max(0, parseInt(e.target.value) || 0)})}
                  className="input-field" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Max. usuarios</label>
                <input
                  type="number" min={0} max={500}
                  data-testid="bt-max-users"
                  value={form.max_users}
                  onChange={e => setForm({...form, max_users: Math.max(0, parseInt(e.target.value) || 0)})}
                  className="input-field" />
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-4">Funcionalidades Habilitadas</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-700">CRM</span>
                  <button onClick={() => enableAll('crm')} className="text-xs text-primary hover:underline">Ativar todas</button>
                </div>
                {crmFeatures.map(f => (
                  <FeatureToggle key={f.feature_key} feature={f} enabled={isFeatureEnabled(f.feature_key)} onToggle={() => toggleFeature(f.feature_key)} />
                ))}
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-700">Agendamento</span>
                  <button onClick={() => enableAll('scheduling')} className="text-xs text-primary hover:underline">Ativar todas</button>
                </div>
                {schedFeatures.map(f => (
                  <FeatureToggle key={f.feature_key} feature={f} enabled={isFeatureEnabled(f.feature_key)} onToggle={() => toggleFeature(f.feature_key)} />
                ))}
              </div>
            </div>
            <div className="mt-4">
              <span className="text-sm font-medium text-slate-700 mb-2 block">Compartilhado</span>
              {sharedFeatures.map(f => (
                <FeatureToggle key={f.feature_key} feature={f} enabled={isFeatureEnabled(f.feature_key)} onToggle={() => toggleFeature(f.feature_key)} />
              ))}
            </div>
          </div>

          <div className="border-t border-slate-200 pt-4">
            <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-1">Menu Mobile (barra inferior)</h3>
            <p className="text-xs text-slate-500 mb-3">Selecione ate <strong>4 itens</strong> para aparecer na barra inferior do celular. O 5o slot e reservado para o botao Menu.</p>

            {mobileBottomNav.length > 0 && (
              <div className="flex gap-2 flex-wrap mb-3" data-testid="bottom-nav-preview">
                {mobileBottomNav.map((k, idx) => {
                  const feat = allFeatures.find(af => af.feature_key === k);
                  return (
                    <span key={k} className="inline-flex items-center gap-1.5 text-xs bg-primary/10 text-primary px-2.5 py-1 rounded-full font-medium">
                      <span className="text-[9px] opacity-60">#{idx+1}</span>
                      {feat?.label || k}
                      <button onClick={() => toggleBottomNav(k)} className="ml-0.5 hover:text-primary/70" data-testid={`bottom-nav-remove-${k}`}>
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5 max-h-56 overflow-y-auto p-2 border border-slate-200 rounded-lg bg-slate-50">
              {allFeatures
                .filter(f => isFeatureEnabled(f.feature_key))
                .map(f => {
                  const selected = mobileBottomNav.includes(f.feature_key);
                  const disabled = !selected && mobileBottomNav.length >= 4;
                  return (
                    <button
                      key={f.feature_key}
                      type="button"
                      onClick={() => toggleBottomNav(f.feature_key)}
                      disabled={disabled}
                      data-testid={`bottom-nav-pick-${f.feature_key}`}
                      className={`text-left text-xs px-2.5 py-2 rounded-md border transition-all ${
                        selected
                          ? 'bg-primary text-white border-primary shadow-sm'
                          : disabled
                            ? 'bg-white text-slate-300 border-slate-200 cursor-not-allowed'
                            : 'bg-white text-slate-700 border-slate-200 hover:border-primary/40'
                      }`}
                    >
                      {selected && <span className="mr-1">✓</span>}
                      {f.label}
                    </button>
                  );
                })}
              {allFeatures.filter(f => isFeatureEnabled(f.feature_key)).length === 0 && (
                <p className="col-span-full text-xs text-slate-400 text-center py-4">Habilite funcionalidades acima para poder escolher.</p>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 p-6 border-t border-slate-200 sticky bottom-0 bg-white">
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button onClick={handleSave} disabled={saving} data-testid="save-bt-btn" className="btn-primary">
            {saving ? 'Salvando...' : isEditing ? 'Salvar Alteracoes' : 'Criar Tipo'}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ========== SHARED COMPONENTS ========== */
const FeatureToggle = ({ feature, enabled, onToggle }) => (
  <label className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 cursor-pointer">
    <input type="checkbox" checked={enabled} onChange={onToggle} className="w-4 h-4 text-primary border-slate-300 rounded" />
    <span className="text-sm text-slate-700">{feature.label}</span>
  </label>
);

const FeatureGroup = ({ title, features, toggleFeature, isFeatureEnabled }) => (
  <div>
    <p className="text-sm font-medium text-slate-700 mb-2">{title}</p>
    <div className="space-y-1">
      {features.map(f => (
        <FeatureToggle key={f.feature_key} feature={f} enabled={isFeatureEnabled(f.feature_key)} onToggle={() => toggleFeature(f.feature_key)} />
      ))}
    </div>
  </div>
);

const StatsCard = ({ title, value, icon, color }) => (
  <div className="card" data-testid={`stats-${title.toLowerCase().replace(/\s+/g, '-')}`}>
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm text-slate-600 mb-1">{title}</p>
        <p className="text-3xl font-bold font-heading text-slate-900">{value}</p>
      </div>
      <div className={`${color} p-3 rounded-lg text-white`}>{icon}</div>
    </div>
  </div>
);

const StatusBadge = ({ status }) => (
  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
    status === 'active' ? 'bg-emerald-100 text-emerald-700' :
    status === 'trial' ? 'bg-blue-100 text-blue-700' :
    'bg-red-100 text-red-700'
  }`}>
    {status === 'active' ? 'Ativa' : status === 'trial' ? 'Trial' : 'Bloqueada'}
  </span>
);

const PlanBadge = ({ planType }) => (
  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
    planType === 'both' ? 'bg-violet-100 text-violet-700' :
    planType === 'crm' ? 'bg-indigo-100 text-indigo-700' :
    'bg-teal-100 text-teal-700'
  }`}>
    {planType === 'both' ? 'CRM + Agendamento' : planType === 'crm' ? 'CRM' : 'Agendamento'}
  </span>
);

export default SuperAdminDashboard;
