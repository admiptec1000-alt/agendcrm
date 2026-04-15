import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { superAdminAPI } from '../../services/api';
import { toast } from 'sonner';
import {
  LogOut, Building, Users, TrendingUp, DollarSign, Settings,
  Plus, Pencil, Trash2, X, ChevronRight, Search, LayoutGrid,
  Briefcase, BarChart3, Eye, Check, Scissors, Stethoscope,
  Headphones, Sparkles, GitBranch, Bot, Code
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
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col fixed h-full z-40">
        <div className="p-6 border-b border-slate-200">
          <h1 className="text-xl font-bold font-heading text-slate-900 tracking-tight">AgentCRM</h1>
          <p className="text-xs text-slate-500 mt-1 uppercase tracking-widest font-bold">Super Admin</p>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {sidebarItems.map(item => (
            <button
              key={item.key}
              onClick={() => setActiveTab(item.key)}
              data-testid={`sidebar-${item.key}`}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
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
      <main className="flex-1 ml-64">
        <header className="glass border-b border-slate-200 sticky top-0 z-30 px-8 py-4">
          <h2 className="text-xl font-bold font-heading text-slate-900">
            {sidebarItems.find(i => i.key === activeTab)?.label || 'Dashboard'}
          </h2>
        </header>

        <div className="p-8">
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
          {activeTab === 'settings' && <SettingsTab />}
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
const CompaniesTab = ({ companies, businessTypes, searchTerm, setSearchTerm, onAdd, onEdit, onDelete }) => {
  const filtered = companies.filter(c =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.cnpj || '').includes(searchTerm)
  );

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            type="text"
            data-testid="company-search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input-field pl-10"
            placeholder="Buscar por nome, CNPJ ou email..."
          />
        </div>
        <button onClick={onAdd} data-testid="add-company-btn" className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" /> Nova Empresa
        </button>
      </div>

      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full" data-testid="companies-table">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-3 px-4 text-xs font-bold uppercase tracking-widest text-slate-400">Empresa</th>
                <th className="text-left py-3 px-4 text-xs font-bold uppercase tracking-widest text-slate-400">Contato</th>
                <th className="text-left py-3 px-4 text-xs font-bold uppercase tracking-widest text-slate-400">Tipo</th>
                <th className="text-left py-3 px-4 text-xs font-bold uppercase tracking-widest text-slate-400">Plano</th>
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
                  </td>
                  <td className="py-3 px-4">
                    <p className="text-sm text-slate-600">{company.email}</p>
                    {company.phone && <p className="text-xs text-slate-500">{company.phone}</p>}
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-sm text-slate-600">{company.business_type_name || 'Personalizado'}</span>
                  </td>
                  <td className="py-3 px-4">
                    <PlanBadge planType={company.plan_type} />
                  </td>
                  <td className="py-3 px-4">
                    <StatusBadge status={company.status} />
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
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
const SettingsTab = () => (
  <div className="animate-fade-in card max-w-2xl">
    <h3 className="text-lg font-semibold font-heading text-slate-900 mb-4">Configuracoes Globais</h3>
    <p className="text-sm text-slate-500">Em breve: configuracoes globais do sistema, integrações, notificacoes.</p>
  </div>
);

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
                <input data-testid="company-name-input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="input-field" required />
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
  });
  const [features, setFeatures] = useState(businessType?.features || []);
  const [saving, setSaving] = useState(false);

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
      const data = { ...form, features };
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
