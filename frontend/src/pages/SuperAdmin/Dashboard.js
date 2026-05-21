import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  Receipt, Package, Copy, HandCoins, ShieldCheck, Wrench,
  Columns3, Calendar, CalendarCheck, CalendarDays, Tag, Zap,
  Megaphone, UserCog, Shield, FileText, LifeBuoy, Puzzle,
  PlugZap, FolderOpen, CreditCard, Clock, PieChart, LayoutDashboard,
  MessageSquare, UserCheck
} from 'lucide-react';
import SgpRepairTab from './SgpRepairTab';
import { AdmLancamentosPanel } from './AdmLancamentosPanel';
import { LicensesPanel } from './LicensesPanel';
import { LicenseAssignmentPanel } from './LicenseAssignmentPanel';
import { EditableComboBox } from '../../components/EditableComboBox';
// 2026-02-16 (J) — SA owns its own WA connection (system company id is
// auto-injected by auth.py). Reuse the tenant ConexoesPage + AtendimentosPage.
import { ConexoesPage } from '../Company/Dashboard';
import AtendimentosPage from '../CRM/AtendimentosPage';

const iconMap = {
  Building, Scissors, Stethoscope, Headphones, LayoutGrid,
  Sparkles, GitBranch, Bot, Code, Briefcase, Settings, Users
};

// Tenant feature_keys that the Super Admin can additionally enable on the
// "Super Admin" Business Type. When ticked there, they appear as EXTRA items
// in the SA sidebar under the "Modulos Operacionais" group. Clicking opens
// the operational impersonation panel in a new tab — the SA has no tenant
// data of its own, so the link is meant to give 1-click access to the
// tenant-side modules (which were configured to be assignable from the SA
// BT modal back in iteration 53 / 2026-05-16 F).
const TENANT_SIDEBAR_META = {
  dashboard:              { icon: LayoutDashboard, label: 'Início' },
  atendimentos:           { icon: Headphones,      label: 'Atendimentos' },
  relatorio_atendimentos: { icon: BarChart3,       label: 'Relatorio Atendimentos' },
  orcamentos:             { icon: FileText,        label: 'Orcamentos' },
  respostas_rapidas:      { icon: Zap,             label: 'Respostas Rapidas' },
  kanban:                 { icon: Columns3,        label: 'Kanban' },
  contatos:               { icon: Users,           label: 'Clientes / Leads' },
  tags:                   { icon: Tag,             label: 'Tags' },
  campanhas:              { icon: Megaphone,       label: 'Campanhas' },
  flowbuilder:            { icon: GitBranch,       label: 'Flowbuilder' },
  sgp_gateway:            { icon: PlugZap,         label: 'SGP Gateway' },
  filas_chatbot:          { icon: Bot,             label: 'Filas' },
  conexoes:               { icon: LinkIcon,        label: 'Conexoes' },
  agente_ia:              { icon: Sparkles,        label: 'Agente IA' },
  calendario:             { icon: Calendar,        label: 'Calendario' },
  agenda:                 { icon: CalendarCheck,   label: 'Agenda' },
  agenda_pro:             { icon: CalendarDays,    label: 'Agenda Pro' },
  agendamentos:           { icon: Clock,           label: 'Agendamento Msg' },
  clientes:               { icon: UserCheck,       label: 'Clientes / Leads' },
  categorias:             { icon: FolderOpen,      label: 'Categorias' },
  servicos_produtos:      { icon: Scissors,        label: 'Servicos e Produtos' },
  assinaturas:            { icon: CreditCard,      label: 'Assinaturas' },
  planos:                 { icon: Tag,             label: 'Planos' },
  profissionais:          { icon: Briefcase,       label: 'Profissionais' },
  financeiro:             { icon: DollarSign,      label: 'Financeiro' },
  comissoes:              { icon: PieChart,        label: 'Comissoes' },
  meu_site:               { icon: Globe,           label: 'Meu Site' },
  configuracoes:          { icon: Settings,        label: 'Configuracoes Empresa' },
  'integrações':          { icon: Puzzle,          label: 'API e Integrações' },
  relatorios:             { icon: BarChart3,       label: 'Relatorios' },
  suporte:                { icon: LifeBuoy,        label: 'Suporte' },
  usuarios:               { icon: UserCog,         label: 'Usuarios' },
  perfis_acesso:          { icon: Shield,          label: 'Perfis de Acesso' },
  parceiros:              { icon: HandCoins,       label: 'Programa de Parceiros' },
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

  const allSidebarItems = [
    { key: 'dashboard', label: 'Dashboard', icon: BarChart3 },
    { key: 'companies', label: 'Empresas', icon: Building },
    { key: 'business-types', label: 'Tipos de Negocio', icon: Briefcase },
    { key: 'licenses', label: 'Licencas', icon: Package },
    { key: 'partners', label: 'Parceiros', icon: HandCoins },
    { key: 'financial', label: 'Financeiro Admin', icon: Receipt },
    // 2026-02-16 (J) — Atendimento + Conexao para o SA (usados para
    // enviar lembretes de cobranca via WhatsApp).
    { key: 'sa-atendimentos', label: 'Atendimentos', icon: Headphones },
    { key: 'sa-conexoes', label: 'Conexoes', icon: LinkIcon },
    { key: 'indoor', label: 'Indoor', icon: Tv },
    { key: 'my-panel', label: 'Meu Painel', icon: ShieldCheck },
    { key: 'sgp-repair', label: 'Reparo SGP', icon: Wrench },
    { key: 'settings', label: 'Configuracoes', icon: Settings },
  ];

  // The Super-Admin niche (business_type with base_type=super_admin) governs
  // which sidebar entries are visible. We always keep `business-types` and
  // `settings` visible so an operator who accidentally disables everything
  // can still recover by re-toggling features.
  //
  // 2026-02-15 (D): Tenant-only features that happen to be toggled on the SA
  // BT must NOT appear here. The SA panel has no tenant data of its own, so
  // routing to a tenant page from the SA sidebar would either 404 or open
  // the wrong-tenant operational panel via impersonation. The previous
  // "MODULOS OPERACIONAIS" external-link group was removed — anything the
  // operator wants inside the SA panel MUST be a SA-native feature (i.e.
  // appear in `allSidebarItems` AND the backend `SUPER_ADMIN_FEATURES` catalog).
  const saFeatures = (user?.business_type?.features || []);
  const featureMap = Object.fromEntries(
    saFeatures.map(f => [f.feature_key, !!f.enabled])
  );
  const ALWAYS_VISIBLE = new Set(['business-types', 'settings']);
  const sidebarItems = saFeatures.length > 0
    ? allSidebarItems.filter(i =>
        ALWAYS_VISIBLE.has(i.key) || featureMap[i.key] !== false
      )
    : allSidebarItems;

  const openOperationalPanel = async () => {
    try {
      const { data } = await api.post('/super-admin/me/operational-impersonate');
      const url = `${window.location.origin}/__impersonate__?token=${encodeURIComponent(data.access_token)}&slug=${encodeURIComponent(data.company_slug || '')}`;
      window.open(url, '_blank');
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Configure a Empresa Operacional em Configuracoes');
      setActiveTab('settings');
    }
  };

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
          <div className="flex items-center gap-3 min-w-0">
            <img
              src="/8ip-logo.png"
              alt="8ip"
              className="w-9 h-9 rounded-lg shadow-sm flex-shrink-0"
              data-testid="super-admin-logo"
            />
            <div className="min-w-0">
              <h1 className="text-lg font-bold font-heading text-slate-900 tracking-tight truncate">AgentCRM</h1>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Super Admin</p>
            </div>
          </div>
          <button onClick={() => setMobileSidebarOpen(false)} className="lg:hidden p-1.5 rounded-lg hover:bg-slate-100" data-testid="close-sidebar-btn">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
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
              onDuplicate={async (bt) => {
                try {
                  await api.post(`/super-admin/business-types/${bt.id}/duplicate`);
                  toast.success('Tipo duplicado!');
                  loadAll();
                } catch (e) { toast.error(e.response?.data?.detail || 'Falha ao duplicar'); }
              }}
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
          {activeTab === 'licenses' && <LicensesPanel />}
          {activeTab === 'partners' && <PartnersTab companies={companies} onRefresh={loadAll} />}
          {activeTab === 'financial' && <FinancialTab companies={companies} />}
          {activeTab === 'indoor' && <IndoorTab companies={companies} />}
          {activeTab === 'my-panel' && <MyOperationalPanelTab onOpen={openOperationalPanel} onGoToSettings={() => setActiveTab('settings')} />}
          {activeTab === 'sa-atendimentos' && (
            <div data-testid="sa-atendimentos-panel" className="-mx-4 lg:-mx-8 -my-4 lg:-my-8 h-[calc(100vh-72px)]">
              <AtendimentosPage />
            </div>
          )}
          {activeTab === 'sa-conexoes' && (
            <div data-testid="sa-conexoes-panel">
              <ConexoesPage />
            </div>
          )}
          {activeTab === 'sgp-repair' && <SgpRepairTab companies={companies} />}
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
  // 2026-02-15 (F) — filtros adicionais (BD e Ativas) + totais.
  const [bdFilter, setBdFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [bdOptions, setBdOptions] = useState(['Padrao']);

  useEffect(() => {
    api.get('/super-admin/companies/database-types')
      .then(r => setBdOptions(r.data?.types || ['Padrao']))
      .catch(() => {});
  }, [companies]);

  const filtered = companies.filter(c => {
    const matchSearch = !searchTerm ||
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.cnpj || '').includes(searchTerm);
    const matchBd = !bdFilter || (c.database_type || 'Padrao') === bdFilter;
    const matchStatus = !statusFilter || c.status === statusFilter;
    return matchSearch && matchBd && matchStatus;
  });

  // Totais — recalculam sempre com base no filtro aplicado.
  // 2026-02-15 (I) — substituidos os 4 cards por 3: EMPRESAS, TOTAL CONEXOES (X/Y),
  // TOTAL USUARIOS (X/Y). Empresas legadas sem limite (max=null) sao contabilizadas
  // apenas no `used` (nao inflam o total).
  const totals = {
    count: filtered.length,
    used_connections: filtered.reduce((s, c) => s + Number(c.used_connections || 0), 0),
    total_connections: filtered.reduce((s, c) => s + Number(c.max_connections || 0), 0),
    used_users: filtered.reduce((s, c) => s + Number(c.used_users || 0), 0),
    total_users: filtered.reduce((s, c) => s + Number(c.max_users || 0), 0),
  };

  return (
    <div className="animate-fade-in">
      {/* Filtros + busca compactos. 2026-02-15 (F). */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mb-3">
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
        <select
          data-testid="company-bd-filter"
          value={bdFilter}
          onChange={e => setBdFilter(e.target.value)}
          className="input-field sm:w-40"
        >
          <option value="">Todas BD</option>
          {bdOptions.map(bd => <option key={bd} value={bd}>{bd}</option>)}
        </select>
        <select
          data-testid="company-status-filter"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="input-field sm:w-36"
        >
          <option value="">Todas</option>
          <option value="active">Ativas</option>
          <option value="trial">Trial</option>
          <option value="blocked">Bloqueadas</option>
        </select>
        <button onClick={onAdd} data-testid="add-company-btn" className="btn-primary flex items-center justify-center gap-2 whitespace-nowrap">
          <Plus className="w-4 h-4" /> Nova Empresa
        </button>
      </div>

      {/* Totais — recalculam com o filtro. 2026-02-15 (I): 3 cards conforme solicitado. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4" data-testid="companies-totals">
        <TotalCard label="Empresas" value={totals.count} accent="indigo" />
        <TotalCard
          label="Total Conexoes"
          value={`${totals.used_connections} / ${totals.total_connections}`}
          accent="amber"
          testid="total-connections"
        />
        <TotalCard
          label="Total Usuarios"
          value={`${totals.used_users} / ${totals.total_users}`}
          accent="rose"
          testid="total-users"
        />
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
                <th className="text-center py-3 px-4 text-xs font-bold uppercase tracking-widest text-slate-400 hidden lg:table-cell">Conexoes</th>
                <th className="text-center py-3 px-4 text-xs font-bold uppercase tracking-widest text-slate-400 hidden lg:table-cell">Usuarios</th>
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
                  {/* Conexoes (X/Y) — `used_*` enriched by the list endpoint to avoid N+1 */}
                  <td className="py-3 px-4 hidden lg:table-cell text-center">
                    <UsageBadge used={company.used_connections} max={company.max_connections} />
                  </td>
                  <td className="py-3 px-4 hidden lg:table-cell text-center">
                    <UsageBadge used={company.used_users} max={company.max_users} />
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
                <tr><td colSpan={8} className="py-8 text-center text-sm text-slate-500">Nenhuma empresa encontrada</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

/* ========== BUSINESS TYPES TAB ========== */
const BusinessTypesTab = ({ businessTypes, allFeatures, onAdd, onEdit, onDuplicate, onDelete }) => (
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
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-slate-900">{bt.name}</h3>
                  {bt.show_on_landing && (
                    <span className="text-[9px] font-bold uppercase tracking-wide bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded" data-testid={`bt-landing-badge-${bt.id}`}>
                      Landing
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500">{bt.description}</p>
              </div>
            </div>
            <div className="flex gap-1">
              <button onClick={() => onEdit(bt)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600" title="Editar" data-testid={`edit-bt-${bt.id}`}><Pencil className="w-4 h-4" /></button>
              <button onClick={() => onDuplicate(bt)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600" title="Duplicar" data-testid={`duplicate-bt-${bt.id}`}><Copy className="w-4 h-4" /></button>
              <button onClick={() => onDelete(bt.id)} className="p-2 rounded-lg hover:bg-red-50 text-red-500" title="Excluir" data-testid={`delete-bt-${bt.id}`}><Trash2 className="w-4 h-4" /></button>
            </div>
          </div>
          <div className="flex items-center gap-2 mb-3">
            <PlanBadge planType={bt.base_type} />
            <span className="text-xs text-slate-500">{bt.features?.length || 0} funcionalidades</span>
            {bt.monthly_price > 0 && (
              <span className="text-xs font-semibold text-emerald-700">R$ {Number(bt.monthly_price).toFixed(2)}/{bt.billing_cycle === 'yearly' ? 'ano' : bt.billing_cycle === 'one_time' ? 'avulso' : 'mes'}</span>
            )}
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
    license_cost: initial?.license_cost ?? 0,
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
              <label className="text-xs font-medium text-slate-700 mb-1 block">Custo de licença (R$)</label>
              <input type="number" min={0} step="0.01" value={form.license_cost} onChange={(e) => set('license_cost', parseFloat(e.target.value) || 0)} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" data-testid="plan-license-cost-input" />
              <p className="text-[10px] text-slate-400 mt-1">Custo que pagamos por cliente (infra/3rd-party). Usado p/ DRE.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
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


// ─── PARTNERS TAB ────────────────────────────────────────────────────────
const PartnersTab = ({ companies, onRefresh }) => {
  const [partners, setPartners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/super-admin/partners');
      setPartners(r.data || []);
    } catch { toast.error('Erro ao carregar parceiros'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const togglePartner = async (company, isOn) => {
    try {
      await api.put(`/super-admin/companies/${company.id}/partner`, {
        is_partner: isOn,
        partner_commission_pct: company.partner_commission_pct ?? 20,
        partner_recurring: company.partner_recurring ?? true,
      });
      toast.success(isOn ? 'Empresa virou parceira!' : 'Removida do programa');
      load();
      onRefresh && onRefresh();
    } catch (e) { toast.error('Falha ao salvar'); }
  };

  const updatePartnerConfig = async (data) => {
    try {
      await api.put(`/super-admin/companies/${editing.id}/partner`, {
        is_partner: true,
        partner_commission_pct: parseFloat(data.pct) || 0,
        partner_recurring: !!data.recurring,
        partner_notes: data.notes || '',
      });
      toast.success('Comissao atualizada');
      setEditing(null);
      load();
    } catch { toast.error('Falha ao atualizar'); }
  };

  const nonPartnerCompanies = (companies || []).filter(c => !partners.some(p => p.id === c.id));
  const totalCommission = partners.reduce((sum, p) => sum + (p.commission_total || 0), 0);
  const totalReferrals = partners.reduce((sum, p) => sum + (p.referred_count || 0), 0);

  return (
    <div className="space-y-4" data-testid="partners-tab">
      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <KPI label="Parceiros ativos" value={partners.length} icon={HandCoins} color="emerald" testid="kpi-partners" />
        <KPI label="Indicacoes totais" value={totalReferrals} icon={Users} color="blue" testid="kpi-referrals" />
        <KPI label="Comissao gerada" value={`R$ ${totalCommission.toFixed(2)}`} icon={DollarSign} color="violet" testid="kpi-commission" />
        <KPI label="Empresas elegiveis" value={nonPartnerCompanies.length} icon={Building} color="amber" testid="kpi-eligible" />
      </div>

      {/* Partners list */}
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-bold text-slate-800">Parceiros ativos</h3>
          <span className="text-xs text-slate-500">{partners.length} parceiro(s)</span>
        </div>
        {loading ? (
          <div className="p-6 text-center text-sm text-slate-400">Carregando...</div>
        ) : partners.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-400">
            Nenhum parceiro ainda. Promova uma empresa cliente abaixo para gerar o link de indicacao dela.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {partners.map(p => (
              <div key={p.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <div className="font-semibold text-slate-800">{p.name}</div>
                  <div className="text-xs text-slate-500 flex items-center gap-2">
                    <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[10px]">{p.referral_code}</code>
                    <span>{p.partner_commission_pct || 0}% {p.partner_recurring ? 'recorrente' : 'unico'}</span>
                  </div>
                </div>
                <div className="text-xs text-slate-600 flex gap-3">
                  <span><strong>{p.referred_count || 0}</strong> indicados</span>
                  <span><strong>{p.active_referred_count || 0}</strong> ativos</span>
                  <span className="text-emerald-600 font-semibold">R$ {(p.commission_total || 0).toFixed(2)}</span>
                </div>
                <button onClick={() => setEditing(p)} className="text-xs px-3 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg" data-testid={`partner-edit-${p.id}`}>Editar</button>
                <button onClick={() => togglePartner(p, false)} className="text-xs px-3 py-1 text-rose-600 hover:bg-rose-50 rounded-lg" data-testid={`partner-remove-${p.id}`}>Remover</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Promote new partner */}
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="px-4 py-3 border-b border-slate-200">
          <h3 className="font-bold text-slate-800">Promover empresa a parceira</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">Ao habilitar, a empresa recebe um link unico de indicacao e comeca a acumular comissao quando indicacoes pagam suas mensalidades.</p>
        </div>
        <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
          {nonPartnerCompanies.map(c => (
            <div key={c.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
              <div className="text-sm text-slate-800">{c.name}</div>
              <button onClick={() => togglePartner(c, true)} className="text-xs px-3 py-1 bg-emerald-500 text-white hover:bg-emerald-600 rounded-lg" data-testid={`partner-promote-${c.id}`}>+ Tornar parceira</button>
            </div>
          ))}
        </div>
      </div>

      {editing && (
        <PartnerEditModal partner={editing} onClose={() => setEditing(null)} onSave={updatePartnerConfig} />
      )}
    </div>
  );
};

const PartnerEditModal = ({ partner, onClose, onSave }) => {
  const [pct, setPct] = useState(String(partner.partner_commission_pct ?? 20));
  const [recurring, setRecurring] = useState(partner.partner_recurring !== false);
  const [notes, setNotes] = useState(partner.partner_notes || '');
  return (
    <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()} data-testid="partner-edit-modal">
        <h3 className="font-bold text-slate-800 mb-3">Comissao de {partner.name}</h3>
        <label className="text-[10px] uppercase font-bold text-slate-400">% de comissao</label>
        <input value={pct} onChange={e => setPct(e.target.value)} type="number" step="0.01" min="0" max="100" className="w-full px-3 py-2 border border-slate-300 rounded text-sm mb-3" data-testid="partner-pct-input" />
        <label className="flex items-center gap-2 text-sm mb-3">
          <input type="checkbox" checked={recurring} onChange={e => setRecurring(e.target.checked)} data-testid="partner-recurring-check" />
          <span>Recorrente (toda fatura paga)</span>
        </label>
        <label className="text-[10px] uppercase font-bold text-slate-400">Notas</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="w-full px-3 py-2 border border-slate-300 rounded text-sm mb-3" />
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border rounded">Cancelar</button>
          <button onClick={() => onSave({ pct, recurring, notes })} className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded" data-testid="partner-save-btn">Salvar</button>
        </div>
      </div>
    </div>
  );
};

const KPI = ({ label, value, icon: Icon, color, testid }) => (
  <div className="bg-white rounded-xl border border-slate-200 p-3" data-testid={testid}>
    <div className="flex items-center gap-2 text-[10px] uppercase font-bold text-slate-500">
      <Icon className={`w-3.5 h-3.5 text-${color}-500`} /> {label}
    </div>
    <div className="text-xl font-bold text-slate-800 mt-1">{value}</div>
  </div>
);



// ─── FINANCIAL TAB (invoices + suspension control) ──────────────────────────
const FinancialTab = ({ companies }) => {
  const [subTab, setSubTab] = useState('lancamentos');
  // 2026-02-15 (F): "Faturas" e "Despesas" removidas — todos os lancamentos
  // (faturas E despesas) ficam centralizados na aba Lancamentos com filtro
  // de Direcao (entrada/saida).
  const tabs = [
    { key: 'summary', label: 'Resumo' },
    { key: 'lancamentos', label: 'Lancamentos' },
    { key: 'commissions', label: 'Comissoes' },
    { key: 'external', label: 'Clientes Externos' },
  ];
  return (
    <div className="space-y-4" data-testid="financial-tab">
      <div className="flex gap-1 border-b border-slate-200 overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.key}
            data-testid={`financial-subtab-${t.key}`}
            onClick={() => setSubTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              subTab === t.key ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}>
            {t.label}
          </button>
        ))}
      </div>
      {subTab === 'summary' && <FinancialSummaryPanel />}
      {subTab === 'lancamentos' && <AdmLancamentosPanel />}
      {subTab === 'invoices' && <InvoicesPanel companies={companies} />}
      {subTab === 'expenses' && <ExpensesPanel />}
      {subTab === 'commissions' && <CommissionsPanel />}
      {subTab === 'external' && <ExternalClientsPanel />}
    </div>
  );
};

// ─── FINANCIAL SUMMARY PANEL (Phase 3 — main P&L view) ─────────────────
const FinancialSummaryPanel = () => {
  const today = new Date();
  const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const [month, setMonth] = useState(defaultMonth);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: r } = await api.get('/super-admin/financial/summary', { params: { month } });
      setData(r);
    } catch (e) { toast.error('Erro ao carregar resumo financeiro'); }
    finally { setLoading(false); }
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const totals = data?.totals || {};
  const fmt = (v) => `R$ ${Number(v || 0).toFixed(2)}`;

  return (
    <div className="space-y-4" data-testid="financial-summary-panel">
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-xs font-bold uppercase text-slate-500">Periodo</label>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="px-3 py-2 border border-slate-300 rounded text-sm" data-testid="summary-month-input" />
        <button onClick={load} className="px-3 py-2 text-sm rounded border border-slate-300 hover:bg-slate-50 flex items-center gap-1" data-testid="summary-refresh-btn">
          <RefreshCw className="w-4 h-4" /> Atualizar
        </button>
      </div>

      {/* Hero P&L */}
      <div className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white p-5" data-testid="summary-hero">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase opacity-70 tracking-wider">Receita</p>
            <p className="text-2xl font-bold mt-1">{fmt(totals.revenue)}</p>
            <p className="text-[10px] opacity-70 mt-0.5">{data?.invoices_count || 0} faturas pagas</p>
          </div>
          <div className="border-l border-white/20 pl-4">
            <p className="text-[10px] font-bold uppercase opacity-70 tracking-wider">Custos Totais</p>
            <p className="text-2xl font-bold text-rose-100 mt-1">- {fmt(totals.total_costs)}</p>
          </div>
          <div className="border-l border-white/20 pl-4">
            <p className="text-[10px] font-bold uppercase opacity-70 tracking-wider">Lucro Liquido</p>
            <p className={`text-2xl font-bold mt-1 ${(totals.net_profit || 0) >= 0 ? 'text-emerald-100' : 'text-rose-100'}`}>{fmt(totals.net_profit)}</p>
          </div>
          <div className="border-l border-white/20 pl-4">
            <p className="text-[10px] font-bold uppercase opacity-70 tracking-wider">Margem</p>
            <p className="text-2xl font-bold mt-1">{(totals.margin_pct || 0).toFixed(1)}%</p>
            <p className="text-[10px] opacity-70 mt-0.5">{data?.active_companies || 0} clientes ativos</p>
          </div>
        </div>
      </div>

      {/* Cost breakdown cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="card p-4">
          <p className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Custos de Licenca</p>
          <p className="text-xl font-bold text-slate-800 mt-1">{fmt(totals.license_cost)}</p>
          <p className="text-xs text-slate-500 mt-0.5">infra/servicos por cliente ativo</p>
        </div>
        <div className="card p-4">
          <p className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Comissoes (parceiros)</p>
          <p className="text-xl font-bold text-slate-800 mt-1">{fmt(totals.commissions_total)}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            <span className="text-emerald-600">{fmt(totals.commissions_paid)} pagas</span>
            {' · '}
            <span className="text-amber-600">{fmt(totals.commissions_pending)} pendentes</span>
          </p>
        </div>
        <div className="card p-4">
          <p className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Despesas Manuais</p>
          <p className="text-xl font-bold text-slate-800 mt-1">{fmt(totals.manual_expenses)}</p>
          <p className="text-xs text-slate-500 mt-0.5">infra, marketing, salarios, etc.</p>
        </div>
      </div>

      {/* Per-company breakdown */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-bold text-slate-800">Margem por Cliente</h3>
          <span className="text-xs text-slate-500">{data?.by_company?.length || 0} clientes no periodo</span>
        </div>
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-400">Carregando…</div>
        ) : !data?.by_company?.length ? (
          <div className="p-8 text-center text-sm text-slate-400">Sem movimentacao financeira no periodo.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="text-left px-4 py-2.5">Cliente</th>
                  <th className="text-right px-4 py-2.5">Receita</th>
                  <th className="text-right px-4 py-2.5">Custo Licenca</th>
                  <th className="text-right px-4 py-2.5">Comissao</th>
                  <th className="text-right px-4 py-2.5">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {data.by_company.map(row => (
                  <tr key={row.company_id} className="border-t border-slate-100" data-testid={`company-pl-${row.company_id}`}>
                    <td className="px-4 py-2.5 font-medium text-slate-900">{row.company_name}</td>
                    <td className="px-4 py-2.5 text-right text-emerald-600">{fmt(row.revenue)}</td>
                    <td className="px-4 py-2.5 text-right text-rose-500">- {fmt(row.license_cost)}</td>
                    <td className="px-4 py-2.5 text-right text-rose-500">- {fmt(row.commission_cost)}</td>
                    <td className={`px-4 py-2.5 text-right font-bold ${row.net >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{fmt(row.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── EXPENSES PANEL (manual outflows) ─────────────────────────────────
const ExpensesPanel = () => {
  const today = new Date();
  const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const [month, setMonth] = useState(defaultMonth);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/super-admin/expenses', { params: { month } });
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch { toast.error('Erro ao carregar despesas'); }
    finally { setLoading(false); }
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const remove = async (e) => {
    if (!window.confirm('Remover esta despesa?')) return;
    await api.delete(`/super-admin/expenses/${e.id}`);
    toast.success('Removida');
    load();
  };

  const fmt = (v) => `R$ ${Number(v || 0).toFixed(2)}`;
  const catLabel = { infra: 'Infra', marketing: 'Marketing', salaries: 'Salarios', taxes: 'Impostos', other: 'Outros' };

  return (
    <div className="space-y-4" data-testid="expenses-panel">
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-xs font-bold uppercase text-slate-500">Periodo</label>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="px-3 py-2 border border-slate-300 rounded text-sm" data-testid="expenses-month-input" />
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-slate-500">Total: <strong className="text-slate-800">{fmt(total)}</strong></span>
          <button onClick={() => { setEditing(null); setShowModal(true); }} className="btn-primary text-sm flex items-center gap-2" data-testid="add-expense-btn">
            <Plus className="w-4 h-4" /> Nova despesa
          </button>
        </div>
      </div>
      {loading ? (
        <div className="py-12 text-center text-slate-400 text-sm">Carregando…</div>
      ) : items.length === 0 ? (
        <div className="py-12 text-center text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-xl">Nenhuma despesa no periodo.</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-left px-4 py-2.5">Data</th>
                <th className="text-left px-4 py-2.5">Descricao</th>
                <th className="text-left px-4 py-2.5">Categoria</th>
                <th className="text-right px-4 py-2.5">Valor</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {items.map(e => (
                <tr key={e.id} className="border-t border-slate-100 hover:bg-slate-50" data-testid={`expense-row-${e.id}`}>
                  <td className="px-4 py-2.5 text-slate-600">{e.date}</td>
                  <td className="px-4 py-2.5 font-medium text-slate-900">{e.description}</td>
                  <td className="px-4 py-2.5"><span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-bold">{catLabel[e.category] || e.category}</span></td>
                  <td className="px-4 py-2.5 text-right font-bold text-rose-600">- {fmt(e.amount)}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button onClick={() => { setEditing(e); setShowModal(true); }} className="p-1.5 rounded hover:bg-slate-200 text-slate-600 mr-1" data-testid={`edit-expense-${e.id}`}><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => remove(e)} className="p-1.5 rounded hover:bg-red-50 text-red-500" data-testid={`delete-expense-${e.id}`}><Trash2 className="w-3.5 h-3.5" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showModal && (
        <ExpenseModal
          expense={editing}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load(); }}
        />
      )}
    </div>
  );
};

const ExpenseModal = ({ expense, onClose, onSaved }) => {
  const [form, setForm] = useState({
    description: expense?.description || '',
    amount: expense?.amount || '',
    date: expense?.date || new Date().toISOString().slice(0, 10),
    category: expense?.category || 'other',
    notes: expense?.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!form.description.trim() || !form.amount || !form.date) {
      toast.error('Preencha descricao, valor e data');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form, amount: parseFloat(form.amount) };
      if (expense?.id) await api.put(`/super-admin/expenses/${expense.id}`, payload);
      else await api.post('/super-admin/expenses', payload);
      toast.success('Salvo');
      onSaved();
    } catch (e) { toast.error('Falha ao salvar'); }
    finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()} data-testid="expense-modal">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800">{expense ? 'Editar Despesa' : 'Nova Despesa'}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4 text-slate-500" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase font-bold text-slate-400">Descricao</label>
            <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" data-testid="expense-desc-input" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] uppercase font-bold text-slate-400">Valor (R$)</label>
              <input type="number" step="0.01" min="0" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" data-testid="expense-amount-input" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-slate-400">Data</label>
              <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" data-testid="expense-date-input" />
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold text-slate-400">Categoria</label>
            <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" data-testid="expense-category-select">
              <option value="infra">Infra/Servidores</option>
              <option value="marketing">Marketing</option>
              <option value="salaries">Salarios</option>
              <option value="taxes">Impostos</option>
              <option value="other">Outros</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold text-slate-400">Notas</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-slate-300 rounded">Cancelar</button>
          <button onClick={save} disabled={saving} className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded disabled:opacity-50" data-testid="save-expense-btn">{saving ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  );
};

// ─── COMMISSIONS PANEL ─────────────────────────────────────────────────
const CommissionsPanel = () => {
  const today = new Date();
  const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const [month, setMonth] = useState(defaultMonth);
  const [status, setStatus] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { month };
      if (status) params.status = status;
      const { data } = await api.get('/super-admin/partners/commissions', { params });
      setItems(data.items || []);
      setTotal(data.total || 0);
      setSelected(new Set());
    } catch { toast.error('Erro ao carregar comissoes'); }
    finally { setLoading(false); }
  }, [month, status]);
  useEffect(() => { load(); }, [load]);

  const settle = async () => {
    if (!selected.size) { toast.error('Selecione ao menos uma comissao pendente'); return; }
    if (!window.confirm(`Marcar ${selected.size} comissao(oes) como pagas ao parceiro?`)) return;
    try {
      const r = await api.post('/super-admin/partners/settle', { commission_ids: Array.from(selected) });
      toast.success(`${r.data.settled} comissao(oes) liquidadas`);
      load();
    } catch { toast.error('Falha ao liquidar'); }
  };

  const fmt = (v) => `R$ ${Number(v || 0).toFixed(2)}`;
  const toggle = (id) => {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id); else n.add(id);
    setSelected(n);
  };

  return (
    <div className="space-y-4" data-testid="commissions-panel">
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-xs font-bold uppercase text-slate-500">Periodo</label>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="px-3 py-2 border border-slate-300 rounded text-sm" data-testid="commissions-month-input" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-3 py-2 border border-slate-300 rounded text-sm" data-testid="commissions-status-select">
          <option value="">Todas</option>
          <option value="pending">Pendentes</option>
          <option value="paid">Pagas</option>
        </select>
        <span className="text-sm text-slate-500 ml-auto">Total: <strong className="text-slate-800">{fmt(total)}</strong></span>
        <button onClick={settle} disabled={!selected.size} className="px-3 py-2 text-sm rounded bg-emerald-600 text-white disabled:opacity-50" data-testid="settle-commissions-btn">
          Liquidar selecionadas ({selected.size})
        </button>
      </div>
      {loading ? (
        <div className="py-12 text-center text-slate-400 text-sm">Carregando…</div>
      ) : items.length === 0 ? (
        <div className="py-12 text-center text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-xl">Sem comissoes no periodo.</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5"></th>
                <th className="text-left px-4 py-2.5">Data</th>
                <th className="text-left px-4 py-2.5">Parceiro</th>
                <th className="text-left px-4 py-2.5">Cliente Indicado</th>
                <th className="text-right px-4 py-2.5">Fatura</th>
                <th className="text-right px-4 py-2.5">% / Valor</th>
                <th className="text-left px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map(c => (
                <tr key={c.id} className="border-t border-slate-100" data-testid={`commission-row-${c.id}`}>
                  <td className="px-4 py-2.5">
                    {!c.paid_to_partner && (
                      <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} data-testid={`commission-check-${c.id}`} />
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{(c.created_at || '').slice(0, 10)}</td>
                  <td className="px-4 py-2.5 font-medium text-slate-900">{c.partner_company_name}</td>
                  <td className="px-4 py-2.5 text-slate-600">{c.referred_company_name}</td>
                  <td className="px-4 py-2.5 text-right text-slate-600">{fmt(c.invoice_amount)}</td>
                  <td className="px-4 py-2.5 text-right font-bold text-emerald-600">{c.commission_pct}% · {fmt(c.amount)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${c.paid_to_partner ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {c.paid_to_partner ? 'PAGA' : 'PENDENTE'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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


// ─── MY OPERATIONAL PANEL TAB (Phase 2) ─────────────────────────────────
const MyOperationalPanelTab = ({ onOpen, onGoToSettings }) => {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/super-admin/settings');
        setSettings(data || {});
      } catch { setSettings({}); }
      finally { setLoading(false); }
    })();
  }, []);
  const configured = !!settings?.financial_manager_company_id;
  return (
    <div className="animate-fade-in space-y-4 max-w-3xl" data-testid="my-panel-tab">
      <div className="bg-gradient-to-br from-violet-600 to-indigo-700 text-white rounded-xl p-6">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-8 h-8" />
          <div>
            <h3 className="text-xl font-bold font-heading">Meu Painel Operacional</h3>
            <p className="text-sm opacity-90 mt-1">Use os modulos do SaaS (Kanban, Integracoes, Agenda, Permissoes…) como qualquer cliente para sua propria gestao interna.</p>
          </div>
        </div>
      </div>
      {loading ? (
        <div className="card p-8 text-center text-slate-400 text-sm">Carregando…</div>
      ) : configured ? (
        <div className="card p-6 space-y-3">
          <p className="text-sm text-slate-700">Empresa operacional configurada. Abra o painel em uma nova aba — voce nao perde a sessao do SuperAdmin neste navegador.</p>
          <button onClick={onOpen} data-testid="open-operational-btn" className="btn-primary flex items-center gap-2">
            <ExternalLink className="w-4 h-4" /> Abrir meu painel operacional
          </button>
          <p className="text-xs text-slate-500">
            Os modulos disponiveis dependem do <strong>Tipo de Negocio</strong> dessa empresa. Edite-a em <em>Empresas</em> para liberar/restringir features (ex.: Kanban, API/Integracoes, Agente IA).
          </p>
        </div>
      ) : (
        <div className="card p-6 space-y-3">
          <p className="text-sm text-slate-700">Selecione qual empresa servira como sua <strong>operacao interna</strong>. Geralmente voce cria uma empresa nova chamada "AgentCRM Interno" e a designa aqui.</p>
          <button onClick={onGoToSettings} data-testid="goto-settings-btn" className="btn-primary text-sm">
            Configurar agora
          </button>
        </div>
      )}
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
              Empresa Operacional do SuperAdmin
            </label>
            <select
              value={settings.financial_manager_company_id}
              onChange={(e) => setSettings({ ...settings, financial_manager_company_id: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
              data-testid="settings-financial-mgr-select"
            >
              <option value="">— Nenhuma —</option>
              {(companies || []).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1">
              Esta empresa atua como o "tenant interno" do SuperAdmin: ao clicar em <strong>Meu Painel</strong>, voce abre o dashboard dela em uma nova aba para usar Kanban, Integracoes, Agenda e demais modulos para sua propria gestao. Tambem alimenta o Financeiro Admin (margem por cliente, parceiros, custos).
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
    // 2026-02-15 (F) — BD (Base de Dados). "Padrao" = empresa nativa.
    // Outros valores ex.: SGP, Vox, ERP_X = empresas externas, so
    // gerencia-se licenca/cobranca aqui.
    database_type: company?.database_type || 'Padrao',
    // Billing/limits — moved from BusinessType to Company (2026-02-15).
    licenses: company?.licenses || [],
    monthly_price: company?.monthly_price ?? '',
    billing_cycle: company?.billing_cycle || 'monthly',
    installments: company?.installments ?? 1,
    grace_days: company?.grace_days ?? 5,
    // 2026-02-16 (J) — Recurring billing reminder fields.
    first_due_date: company?.first_due_date || '',
    billing_reminder_message: company?.billing_reminder_message || '',
  });
  const [customFeatures, setCustomFeatures] = useState(company?.features || []);
  const [showCustomFeatures, setShowCustomFeatures] = useState(!form.business_type_id);
  const [saving, setSaving] = useState(false);
  // BD catalog — preloaded from backend, excludes the permanent "Padrao"
  // entry. Used by the EditableComboBox to render the custom list.
  const [bdCustomOptions, setBdCustomOptions] = useState([]);
  useEffect(() => {
    api.get('/super-admin/companies/database-types')
      .then(r => {
        const all = r.data?.types || [];
        setBdCustomOptions(all.filter(t => t !== 'Padrao'));
      })
      .catch(() => {});
  }, []);

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
      // Billing fields: send as numbers (or null when empty). The backend
      // recomputes max_connections/max_users from the licenses array, so we
      // don't need to send those.
      const billingPayload = {
        licenses: form.licenses || [],
        monthly_price: form.monthly_price === '' || form.monthly_price === null ? null : Number(form.monthly_price),
        billing_cycle: form.billing_cycle || null,
        installments: form.installments === '' ? null : Number(form.installments),
        grace_days: form.grace_days === '' ? null : Number(form.grace_days),
        first_due_date: form.first_due_date || null,
        billing_reminder_message: form.billing_reminder_message || null,
      };
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
          database_type: form.database_type || 'Padrao',
          ...billingPayload,
        });
        if (showCustomFeatures) {
          await superAdminAPI.updateCompanyFeatures(company.id, customFeatures);
        }
        toast.success('Empresa atualizada!');
      } else {
        // External (BD != Padrao) companies don't need admin login. They
        // are billed/managed in the SA but never authenticate.
        const isExternal = form.database_type && form.database_type !== 'Padrao';
        if (!isExternal && (!form.admin_email || !form.admin_password || !form.admin_name)) {
          toast.error('Preencha os dados do administrador');
          setSaving(false);
          return;
        }
        await superAdminAPI.createCompany({
          ...form,
          ...billingPayload,
          // For external companies, send minimal admin placeholders so the
          // backend pydantic Create model accepts the payload. Use a real
          // public TLD pattern (`.com`) — Pydantic rejects `.local`/`.invalid`.
          // Random subdomain keeps emails unique without collision risk.
          admin_name: isExternal ? (form.name || 'Externo') : form.admin_name,
          admin_email: isExternal ? `ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@noreply-agentcrm.com` : form.admin_email,
          admin_password: isExternal ? `ext_${Math.random().toString(36).slice(2)}` : form.admin_password,
          business_type_id: isExternal ? null : (form.business_type_id || null),
          subdomain: isExternal ? null : (form.subdomain || null),
          database_type: form.database_type || 'Padrao',
        });
        toast.success('Empresa criada!');
      }
      onSave();
      onClose();
    } catch (e) {
      // Pydantic 422 errors come as array of {msg, loc, ...} — passing that
      // to toast.error renders "Objects are not valid as a React child" and
      // crashes the whole page (white screen reported 2026-02-15 (G)).
      let detail = e.response?.data?.detail;
      if (Array.isArray(detail)) {
        detail = detail.map(d => `${(d.loc || []).slice(-1).join('.') || 'erro'}: ${d.msg}`).join(' | ');
      }
      toast.error(detail || e.message || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  // Backend uses Portuguese, capitalized category labels ('CRM',
  // 'Operacional', 'Catalogo', 'Analise', 'Config Empresa', 'Administracao',
  // 'Principal', 'Super Admin'). The legacy lowercase aliases this code
  // used ('crm'/'scheduling'/'shared') never matched anything → all the
  // toggles in the BT editor rendered EMPTY. We now group by actual
  // backend categories and keep the legacy names pointing to the right
  // buckets for the "Ativar todas" shortcut buttons.
  const crmFeatures = allFeatures.filter(f => f.category === 'CRM');
  const schedFeatures = allFeatures.filter(f => f.category === 'Operacional');
  const sharedFeatures = allFeatures.filter(f => ['Catalogo', 'Analise', 'Config Empresa', 'Administracao', 'Principal'].includes(f.category));
  const superAdminFeatures = allFeatures.filter(f => f.category === 'Super Admin');

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[96vh] sm:max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-slate-200 sticky top-0 bg-white z-10">
          <h2 className="text-lg sm:text-xl font-bold font-heading text-slate-900">
            {isEditing ? 'Editar Empresa' : 'Nova Empresa'}
          </h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
          {/* BD (Base de Dados) — 2026-02-15 (F). Auto-cadastravel via
              datalist: o operador seleciona uma BD existente OU digita uma
              nova (ex: SGP, Vox). Quando != "Padrao", a empresa eh
              externa — desabilitamos campos Subdominio, Tipo de Negocio,
              Tipo de Plano e Funcionalidades pra deixar so cadastro
              + licencas/cobranca. */}
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-4">
            <div className="flex items-center gap-3">
              <div>
                <label className="block text-sm font-bold uppercase tracking-widest text-indigo-700 mb-1">Base de Dados (BD)</label>
                <p className="text-xs text-slate-600">Empresas nativas usam <strong>Padrao</strong>. Para empresas que sao clientes de outros sistemas (SGP, Vox, ERP), use um BD especifico — so os campos de licenca/cobranca ficam ativos.</p>
              </div>
            </div>
            <div className="mt-3">
              <EditableComboBox
                value={form.database_type || 'Padrao'}
                onChange={(v) => setForm({...form, database_type: v || 'Padrao'})}
                permanentOptions={['Padrao']}
                customOptions={bdCustomOptions}
                onAddCustom={async (v) => {
                  // The new option is auto-persisted as soon as the company
                  // is saved — but we also expose it immediately on the list
                  // so other modals see it. Catalog refresh handled by parent.
                  setBdCustomOptions(prev => prev.includes(v) ? prev : [...prev, v]);
                }}
                onDeleteCustom={async (v) => {
                  try {
                    await api.delete(`/super-admin/companies/database-types/${encodeURIComponent(v)}`);
                    setBdCustomOptions(prev => prev.filter(x => x !== v));
                    toast.success(`BD "${v}" removida`);
                  } catch (e) {
                    toast.error(e?.response?.data?.detail || 'Falha ao excluir');
                    throw e;
                  }
                }}
                placeholder="Padrao"
                testid="company-database-type"
              />
            </div>
          </div>

          {/* Campos exclusivos de empresa NATIVA. Quando BD != Padrao,
              a empresa eh externa: nao precisa de subdominio, tipo de
              negocio, plano nem features — so cadastro + cobranca. */}
          {form.database_type === 'Padrao' && (
            <>
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

          {/* Licenses & Billing — moved from BusinessType to Company (2026-02-15). */}
            </>
          )}

          {/* When BD != Padrao, render a minimal Dados Basicos block so the
              operator can still input name/CNPJ/email/telefone for the
              external client before going to licenses/billing. */}
          {form.database_type !== 'Padrao' && (
            <div>
              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-4">Dados Basicos</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nome / Razao social</label>
                  <input data-testid="ext-company-name-input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="input-field" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">CNPJ</label>
                  <input data-testid="ext-company-cnpj-input" value={form.cnpj} onChange={e => setForm({...form, cnpj: e.target.value})} className="input-field" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                  <input type="email" data-testid="ext-company-email-input" value={form.email} onChange={e => setForm({...form, email: e.target.value})} className="input-field" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Telefone</label>
                  <input data-testid="ext-company-phone-input" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} className="input-field" />
                </div>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                Empresas externas nao tem subdomain/CRM/Tipo de Negocio. Vao direto pra cobranca.
              </p>
            </div>
          )}

          {/* Licenses & Billing — section continues for both BD types. */}
          <div>
            <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-4">Licencas e Cobranca</h3>
            <LicenseAssignmentPanel
              value={form.licenses}
              onChange={(licenses) => setForm({...form, licenses})}
              companyId={isEditing ? company?.id : null}
            />
            <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 mt-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Mensalidade (R$)</label>
                <input type="number" step="0.01" value={form.monthly_price}
                  onChange={e => setForm({...form, monthly_price: e.target.value})}
                  className="input-field text-sm" data-testid="company-monthly-price" placeholder="0,00" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Ciclo</label>
                <select value={form.billing_cycle}
                  onChange={e => setForm({...form, billing_cycle: e.target.value})}
                  className="input-field text-sm" data-testid="company-billing-cycle">
                  <option value="monthly">Mensal</option>
                  <option value="yearly">Anual</option>
                  <option value="one_time">Avulso</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Parcelas</label>
                <input type="number" min="1" value={form.installments}
                  onChange={e => setForm({...form, installments: e.target.value})}
                  className="input-field text-sm" data-testid="company-installments" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Carencia (dias)</label>
                <input type="number" min="0" value={form.grace_days}
                  onChange={e => setForm({...form, grace_days: e.target.value})}
                  className="input-field text-sm" data-testid="company-grace-days" />
              </div>
            </div>

            {/* 2026-02-16 (J) — Lembrete recorrente: 1a parcela + mensagem custom.
                Scheduler cria cada Lancamento 10 dias antes do vencimento e
                envia este texto via WhatsApp da conexao do Super Admin. */}
            <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/30 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-indigo-600" />
                <p className="text-sm font-semibold text-indigo-900">Lembrete de cobranca (WhatsApp)</p>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                O sistema cria automaticamente cada parcela <strong>10 dias antes</strong> do vencimento
                e envia um lembrete pelo WhatsApp da conexao do Super Admin (configure em <em>Conexoes</em>).
              </p>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Data do 1o vencimento</label>
                <input
                  type="date"
                  value={form.first_due_date || ''}
                  onChange={e => setForm({...form, first_due_date: e.target.value})}
                  className="input-field text-sm w-full sm:w-56"
                  data-testid="company-first-due-date"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Mensagem do lembrete</label>
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={form.billing_reminder_message || ''}
                  onChange={e => setForm({...form, billing_reminder_message: e.target.value})}
                  placeholder={'Ola {{nome}}! Sua mensalidade de R$ {{valor}} vence em {{vencimento}} (parcela {{parcela}}). Em caso de duvida nos chame.'}
                  className="input-field text-sm w-full font-mono"
                  data-testid="company-billing-reminder-message"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Variaveis: <code className="px-1 bg-slate-100 rounded">{'{{nome}}'}</code>,
                  <code className="ml-1 px-1 bg-slate-100 rounded">{'{{empresa}}'}</code>,
                  <code className="ml-1 px-1 bg-slate-100 rounded">{'{{valor}}'}</code>,
                  <code className="ml-1 px-1 bg-slate-100 rounded">{'{{vencimento}}'}</code>,
                  <code className="ml-1 px-1 bg-slate-100 rounded">{'{{parcela}}'}</code>.
                </p>
              </div>
            </div>
          </div>

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

          {/* Admin User (creating only — and only for native BD companies,
              since external ones don't login). */}
          {!isEditing && form.database_type === 'Padrao' && (
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

        <div className="flex items-center justify-end gap-2 sm:gap-3 p-4 sm:p-6 border-t border-slate-200 sticky bottom-0 bg-white">
          <button onClick={onClose} className="btn-secondary flex-1 sm:flex-none">Cancelar</button>
          <button onClick={handleSave} disabled={saving} data-testid="save-company-btn" className="btn-primary flex-1 sm:flex-none">
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
    show_on_landing: businessType?.show_on_landing || false,
    default_screen: businessType?.default_screen || '',
  });
  const [features, setFeatures] = useState(businessType?.features || []);
  const [mobileBottomNav, setMobileBottomNav] = useState(businessType?.mobile_bottom_nav || []);
  const [saving, setSaving] = useState(false);
  // Fallback feature catalog: when the parent's `allFeatures` doesn't
  // include the "Super Admin" category (legacy backend / role detection
  // issue), OR doesn't include ANY tenant features (same issue — SA user's
  // role made /all-features return the filtered tenant branch instead of
  // the full catalog), we hit the dedicated public endpoint which always
  // returns the COMPLETE catalog (tenant + SA = 46 entries). Without this,
  // the BT editor showed empty CRM / Agendamento / Compartilhado groups
  // for the SA user in production.
  const [fallbackAllFeatures, setFallbackAllFeatures] = useState([]);
  React.useEffect(() => {
    const list = allFeatures || [];
    const hasSA = list.some(f => f.category === 'Super Admin');
    const hasTenant = list.some(f => ['CRM', 'Operacional', 'Catalogo', 'Analise', 'Config Empresa', 'Administracao'].includes(f.category));
    if (hasSA && hasTenant) return; // /all-features already gave us everything
    api.get('/scheduling/super-admin-features')
      .then(r => setFallbackAllFeatures(r.data || []))
      .catch(() => {});
  }, [allFeatures]);

  // Effective catalog used by the filters below: prefer the parent-supplied
  // `allFeatures` for any category it already has; for categories that are
  // EMPTY in `allFeatures` but present in the fallback, use the fallback.
  const effectiveFeatures = useMemo(() => {
    const parentByCat = {};
    (allFeatures || []).forEach(f => {
      const c = f.category;
      if (!parentByCat[c]) parentByCat[c] = [];
      parentByCat[c].push(f);
    });
    const fallbackByCat = {};
    fallbackAllFeatures.forEach(f => {
      const c = f.category;
      if (!fallbackByCat[c]) fallbackByCat[c] = [];
      fallbackByCat[c].push(f);
    });
    // Union of categories
    const cats = new Set([...Object.keys(parentByCat), ...Object.keys(fallbackByCat)]);
    const out = [];
    cats.forEach(c => {
      const parentItems = parentByCat[c] || [];
      out.push(...(parentItems.length > 0 ? parentItems : (fallbackByCat[c] || [])));
    });
    return out;
  }, [allFeatures, fallbackAllFeatures]);

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

  // Backend uses Portuguese, capitalized category labels ('CRM',
  // 'Operacional', 'Catalogo', 'Analise', 'Config Empresa', 'Administracao',
  // 'Principal', 'Super Admin'). The legacy lowercase aliases this code
  // used ('crm'/'scheduling'/'shared') never matched anything → all the
  // toggles in the BT editor rendered EMPTY. We now group by actual
  // backend categories and keep the legacy names pointing to the right
  // buckets for the "Ativar todas" shortcut buttons.
  // Use `effectiveFeatures` (parent's allFeatures + endpoint fallback) so
  // every group renders populated even when /all-features returned an
  // incomplete catalog for this user's role.
  const crmFeatures = effectiveFeatures.filter(f => f.category === 'CRM');
  const schedFeatures = effectiveFeatures.filter(f => f.category === 'Operacional');
  const sharedFeatures = effectiveFeatures.filter(f => ['Catalogo', 'Analise', 'Config Empresa', 'Administracao', 'Principal'].includes(f.category));
  const superAdminFeatures = effectiveFeatures.filter(f => f.category === 'Super Admin');

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
              {form.base_type === 'super_admin' ? (
                // SA niche is a system-managed singleton — operator can't
                // demote it to a tenant type or the sidebar permission
                // system breaks. Surface a locked, descriptive control.
                <div
                  data-testid="bt-base-type-locked"
                  className="input-field flex items-center gap-2 bg-slate-50 text-slate-500 cursor-not-allowed"
                >
                  <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[10px] font-bold uppercase tracking-wide">
                    Singleton
                  </span>
                  <span>Super Admin (gerenciado pelo sistema)</span>
                </div>
              ) : (
                <select data-testid="bt-base-type" value={form.base_type} onChange={e => setForm({...form, base_type: e.target.value})} className="input-field">
                  <option value="crm">CRM</option>
                  <option value="scheduling">Agendamento</option>
                  <option value="both">Ambos</option>
                </select>
              )}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Descricao</label>
            <input data-testid="bt-description-input" value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="input-field" />
          </div>

          <div className="border-t border-slate-200 pt-5">
            <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-1">Landing Page</h3>
            <p className="text-xs text-slate-500 mb-4">
              Valor, ciclo, parcelas, carencia e quantidades de conexao/usuario foram
              movidos para o <strong>cadastro da Empresa</strong> (Empresas {'>'} editar {'>'} Licencas e Cobranca).
              Aqui no Tipo de Negocio mantemos somente o controle de exibicao na Landing Page.
            </p>
            <label className="flex items-center gap-2 cursor-pointer p-3 rounded-lg border border-slate-200 hover:border-primary/40">
              <input
                type="checkbox"
                data-testid="bt-show-on-landing"
                checked={form.show_on_landing}
                onChange={e => setForm({...form, show_on_landing: e.target.checked})}
                className="w-4 h-4 text-primary border-slate-300 rounded" />
              <span className="text-sm font-medium text-slate-700">Exibir como plano na Landing Page (pagina de venda)</span>
            </label>
          </div>

          <div>
            <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-4">Funcionalidades Habilitadas</h3>
            {/* Tenant feature groups (CRM, Agendamento, Compartilhado).
                2026-02-15 (D): HIDDEN for the Super Admin niche by user
                requirement — "tudo que eu for liberar para o super Admin
                precisa abrir dentro do super Admin e nao uma empresa
                vinculada". Tenant features cannot render natively inside
                the SA panel (no tenant data) so exposing them only causes
                broken impersonation redirects. SA-native features live in
                the amber block below. */}
            {form.base_type !== 'super_admin' && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-slate-700">CRM</span>
                      <button onClick={() => enableAll('CRM')} className="text-xs text-primary hover:underline">Ativar todas</button>
                    </div>
                    {crmFeatures.map(f => (
                      <FeatureToggle key={f.feature_key} feature={f} enabled={isFeatureEnabled(f.feature_key)} onToggle={() => toggleFeature(f.feature_key)} />
                    ))}
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-slate-700">Agendamento</span>
                      <button onClick={() => enableAll('Operacional')} className="text-xs text-primary hover:underline">Ativar todas</button>
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
              </>
            )}
            {/* Super Admin sidebar items — exclusive to the SA niche. We
                only render this group when editing the Super Admin BT so
                tenant editors don't see super-admin-only keys. */}
            {form.base_type === 'super_admin' && (
              <div className="mt-6 pt-5 border-t-2 border-amber-200" data-testid="bt-super-admin-features">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-amber-700 uppercase tracking-widest">Itens do menu Super Admin</span>
                  <button
                    onClick={() => {
                      const updated = [...features];
                      superAdminFeatures.forEach(saf => {
                        const idx = updated.findIndex(f => f.feature_key === saf.feature_key);
                        if (idx >= 0) updated[idx] = { ...updated[idx], enabled: true };
                        else updated.push({ feature_key: saf.feature_key, enabled: true });
                      });
                      setFeatures(updated);
                    }}
                    className="text-xs text-primary hover:underline"
                    data-testid="bt-enable-all-super-admin"
                  >Ativar todos</button>
                </div>
                <p className="text-[11px] text-slate-500 mb-3">
                  Estes toggles controlam quais itens aparecem no <strong>sidebar do painel Super Admin</strong>.
                  Alteracoes aplicam apos logout/login dos usuarios com role <code>super_admin</code>.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1 p-3 rounded-lg bg-amber-50/50 border border-amber-200">
                  {superAdminFeatures.length === 0 ? (
                    <p className="text-xs text-amber-700 col-span-full">
                      Carregando catalogo de features do Super Admin… Se persistir, faca logout/login.
                    </p>
                  ) : superAdminFeatures.map(f => (
                    <FeatureToggle
                      key={f.feature_key}
                      feature={f}
                      enabled={isFeatureEnabled(f.feature_key)}
                      onToggle={() => toggleFeature(f.feature_key)}
                    />
                  ))}
                </div>
              </div>
            )}
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

          <div className="border-t border-slate-200 pt-4">
            <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-1">Tela Inicial</h3>
            <p className="text-xs text-slate-500 mb-3">Define qual modulo abre automaticamente apos o login. Se vazio, o sistema escolhe um padrao baseado no Tipo Base.</p>
            <select
              data-testid="bt-default-screen"
              value={form.default_screen}
              onChange={(e) => setForm({ ...form, default_screen: e.target.value })}
              className="input-field w-full md:w-1/2"
            >
              <option value="">— Padrao automatico —</option>
              {allFeatures
                .filter(f => isFeatureEnabled(f.feature_key))
                .map(f => (
                  <option key={f.feature_key} value={f.feature_key}>{f.label}</option>
                ))}
            </select>
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

// Compact totals card used at top of the Empresas list. 2026-02-15 (F).
const TotalCard = ({ label, value, accent, testid }) => {
  const accentMap = {
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-100',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    rose: 'bg-rose-50 text-rose-700 border-rose-100',
  };
  return (
    <div
      className={`rounded-xl border px-3 py-2 ${accentMap[accent] || accentMap.indigo}`}
      data-testid={testid || `total-card-${(label || '').toLowerCase().replace(/\s+/g, '-')}`}
    >
      <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">{label}</p>
      <p className="text-xl font-bold mt-0.5 font-mono">{value}</p>
    </div>
  );
};

// Inline "X / Y" counter. Highlights red when used==max (saturado), amber
// when used > max (excedeu o limite — empresas legadas), slate otherwise.
// Legacy mode (max=null) shows just `used` to avoid "X / null" garbage.
const UsageBadge = ({ used, max }) => {
  const u = Number(used || 0);
  if (max === null || max === undefined) {
    return <span className="text-xs font-mono text-slate-500">{u} <span className="text-slate-300">/ ∞</span></span>;
  }
  const m = Number(max);
  let cls = 'text-slate-700';
  if (u > m) cls = 'text-amber-700 font-semibold';
  else if (u === m) cls = 'text-rose-600 font-semibold';
  return <span className={`text-xs font-mono ${cls}`}>{u} <span className="text-slate-400">/</span> {m}</span>;
};

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
