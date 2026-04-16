import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { crmAPI, schedulingAPI, uploadAPI, reportsAPI, notificationsAPI } from '../../services/api';
import { toast } from 'sonner';
import {
  LogOut, LayoutDashboard, Headphones, Zap, Columns3, Users, Tag,
  MessageSquare, Megaphone, GitBranch, Info, Code, UserCog, Bot, Link,
  Sparkles, Calendar, CalendarCheck, UserCheck, FolderOpen, Scissors,
  CreditCard, Briefcase, DollarSign, PieChart, Globe, Bell, Settings,
  Puzzle, BarChart3, LifeBuoy, Plus, Search, Pencil, Trash2, X, Check,
  ChevronLeft, ChevronRight, Phone, Mail, Clock, Upload, Image, GripVertical, ArrowRight, CheckCircle2, Circle
} from 'lucide-react';
import FlowBuilderPage from '../CRM/FlowBuilderPage';
import AtendimentosPage from '../CRM/AtendimentosPage';
import WhatsAppConnectionsPage from '../CRM/WhatsAppConnectionsPage';
import { ProfessionalsPageFull, ServicesPageFull, SubscriptionsPageFull } from '../Scheduling/SchedulingPages';

const ICON_MAP = {
  LayoutDashboard, Headphones, Zap, Columns3, Users, Tag, MessageSquare,
  Megaphone, GitBranch, Info, Code, UserCog, Bot, Link, Sparkles, Calendar,
  CalendarCheck, UserCheck, FolderOpen, Scissors, CreditCard, Briefcase,
  DollarSign, PieChart, Globe, Bell, Settings, Puzzle, BarChart3, LifeBuoy
};

const FEATURE_META = {
  dashboard:          { icon: 'LayoutDashboard', label: 'Dashboard', group: 'Principal' },
  atendimentos:       { icon: 'Headphones',      label: 'Atendimentos', group: 'CRM' },
  respostas_rapidas:  { icon: 'Zap',             label: 'Respostas Rapidas', group: 'CRM' },
  kanban:             { icon: 'Columns3',         label: 'Kanban', group: 'CRM' },
  contatos:           { icon: 'Users',            label: 'Contatos', group: 'CRM' },
  tags:               { icon: 'Tag',              label: 'Tags', group: 'CRM' },
  chat_interno:       { icon: 'MessageSquare',    label: 'Chat Interno', group: 'CRM' },
  campanhas:          { icon: 'Megaphone',        label: 'Campanhas', group: 'CRM' },
  flowbuilder:        { icon: 'GitBranch',        label: 'Flowbuilder', group: 'CRM' },
  informativos:       { icon: 'Info',             label: 'Informativos', group: 'CRM' },
  api:                { icon: 'Code',             label: 'API', group: 'Administracao' },
  usuarios:           { icon: 'UserCog',          label: 'Usuarios', group: 'Administracao' },
  filas_chatbot:      { icon: 'Bot',              label: 'Filas & Chatbot', group: 'CRM' },
  conexoes:           { icon: 'Link',             label: 'Conexoes', group: 'CRM' },
  agente_ia:          { icon: 'Sparkles',         label: 'Agente IA', group: 'CRM' },
  calendario:         { icon: 'Calendar',         label: 'Calendario', group: 'Operacional' },
  agendamentos:       { icon: 'CalendarCheck',    label: 'Agendamentos', group: 'Operacional' },
  clientes:           { icon: 'UserCheck',        label: 'Clientes', group: 'Operacional' },
  categorias:         { icon: 'FolderOpen',       label: 'Categorias', group: 'Catalogo' },
  servicos_produtos:  { icon: 'Scissors',         label: 'Servicos e Produtos', group: 'Catalogo' },
  assinaturas:        { icon: 'CreditCard',       label: 'Assinaturas', group: 'Catalogo' },
  profissionais:      { icon: 'Briefcase',        label: 'Profissionais', group: 'Catalogo' },
  financeiro:         { icon: 'DollarSign',       label: 'Financeiro', group: 'Analise' },
  comissoes:          { icon: 'PieChart',         label: 'Comissoes', group: 'Analise' },
  meu_site:           { icon: 'Globe',            label: 'Meu Site', group: 'Config Empresa' },
  notificacoes:       { icon: 'Bell',             label: 'Notificacoes', group: 'Config Empresa' },
  configuracoes:      { icon: 'Settings',         label: 'Configuracoes', group: 'Config Empresa' },
  'integrações':      { icon: 'Puzzle',           label: 'Integracoes', group: 'Config Empresa' },
  relatorios:         { icon: 'BarChart3',        label: 'Relatorios', group: 'Analise' },
  suporte:            { icon: 'LifeBuoy',         label: 'Suporte', group: 'Config Empresa' },
};

const CompanyDashboard = () => {
  const { user, logout } = useAuth();
  const [activePage, setActivePage] = useState('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  const enabledFeatures = useMemo(() => {
    const feats = user?.company?.features || [];
    return feats.filter(f => f.enabled).map(f => f.feature_key);
  }, [user]);

  // Check onboarding status on mount
  useEffect(() => {
    schedulingAPI.getOnboardingStatus().then(r => {
      if (!r.data.onboarding_done) setShowOnboarding(true);
    }).catch(() => {});
  }, []);

  const menuGroups = useMemo(() => {
    const groups = {};
    enabledFeatures.forEach(key => {
      const meta = FEATURE_META[key];
      if (!meta) return;
      const group = meta.group || 'Outros';
      if (!groups[group]) groups[group] = [];
      groups[group].push({ key, ...meta });
    });
    return groups;
  }, [enabledFeatures]);

  const hasFeature = (key) => enabledFeatures.includes(key);

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex">
      {/* Sidebar */}
      <aside className={`${sidebarCollapsed ? 'w-16' : 'w-60'} bg-white border-r border-slate-200 flex flex-col fixed h-full z-40 transition-all duration-200`}>
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          {!sidebarCollapsed && (
            <div className="min-w-0">
              <h1 className="text-lg font-bold font-heading text-slate-900 truncate">{user?.company?.name || 'Empresa'}</h1>
            </div>
          )}
          <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 flex-shrink-0" data-testid="toggle-sidebar">
            {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          {Object.entries(menuGroups).map(([group, items]) => (
            <div key={group} className="mb-3">
              {!sidebarCollapsed && (
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 px-3 py-2">{group}</p>
              )}
              {items.map(item => {
                const Icon = ICON_MAP[item.icon] || LayoutDashboard;
                return (
                  <button
                    key={item.key}
                    onClick={() => setActivePage(item.key)}
                    data-testid={`nav-${item.key}`}
                    title={sidebarCollapsed ? item.label : undefined}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all ${
                      activePage === item.key
                        ? 'bg-[var(--primary-color)]/10 text-[var(--primary-color)] font-medium'
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Icon className="w-[18px] h-[18px] flex-shrink-0" />
                    {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-slate-200">
          {!sidebarCollapsed ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-full bg-[var(--primary-color)]/10 flex items-center justify-center text-[var(--primary-color)] font-bold text-xs flex-shrink-0">
                  {user?.name?.[0]}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-900 truncate">{user?.name}</p>
                </div>
              </div>
              <button onClick={logout} data-testid="logout-button" className="w-full text-xs btn-secondary flex items-center justify-center gap-1.5 py-1.5">
                <LogOut className="w-3 h-3" /> Sair
              </button>
            </>
          ) : (
            <button onClick={logout} data-testid="logout-button" className="p-2 rounded-lg hover:bg-slate-100 text-slate-600 w-full flex justify-center">
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className={`flex-1 ${sidebarCollapsed ? 'ml-16' : 'ml-60'} transition-all duration-200`}>
        <header className="glass border-b border-slate-200 sticky top-0 z-30 px-6 py-3 flex items-center justify-between">
          <h2 className="text-lg font-bold font-heading text-slate-900">
            {FEATURE_META[activePage]?.label || 'Dashboard'}
          </h2>
          <div className="text-right">
            <p className="text-xs text-slate-500">{user?.company?.name}</p>
          </div>
        </header>

        <div className={['flowbuilder', 'atendimentos'].includes(activePage) ? 'h-[calc(100vh-52px)]' : 'p-6'}>
          <PageContent page={activePage} hasFeature={hasFeature} />
        </div>
      </main>

      {/* Onboarding Wizard */}
      {showOnboarding && (
        <OnboardingWizard onClose={() => { setShowOnboarding(false); schedulingAPI.completeOnboarding(); }} />
      )}
    </div>
  );
};

/* ========== PAGE ROUTER ========== */
const PageContent = ({ page, hasFeature }) => {
  switch (page) {
    case 'dashboard': return <DashboardPage />;
    case 'kanban': return <KanbanPage />;
    case 'atendimentos': return <AtendimentosPage />;
    case 'contatos': return <ContactsPage />;
    case 'respostas_rapidas': return <QuickResponsesPage />;
    case 'campanhas': return <CampaignsPage />;
    case 'tags': return <TagsPage />;
    case 'flowbuilder': return <FlowBuilderPage />;
    case 'agente_ia': return <AIAgentPage />;
    case 'conexoes': return <WhatsAppConnectionsPage />;
    case 'calendario': return <CalendarPage />;
    case 'agendamentos': return <AppointmentsPage />;
    case 'clientes': return <ClientsPage />;
    case 'servicos_produtos': return <ServicesPageFull />;
    case 'profissionais': return <ProfessionalsPageFull />;
    case 'assinaturas': return <SubscriptionsPageFull />;
    case 'categorias': return <CategoriesPage />;
    case 'meu_site': return <MySitePage />;
    case 'financeiro': return <FinanceiroPage />;
    case 'comissoes': return <ComissoesPage />;
    case 'notificacoes': return <NotificacoesPage />;
    case 'relatorios': return <FinanceiroPage />;
    case 'configuracoes': return <ConfigPage />;
    default: return <PlaceholderPage title={FEATURE_META[page]?.label || page} />;
  }
};

/* ========== DASHBOARD ========== */
const DashboardPage = () => {
  const [data, setData] = useState({ tickets: 0, appointments: 0, services: 0, professionals: 0 });
  useEffect(() => {
    Promise.all([
      crmAPI.getTickets().catch(() => ({ data: [] })),
      schedulingAPI.getAppointments().catch(() => ({ data: [] })),
      schedulingAPI.getServices().catch(() => ({ data: [] })),
      schedulingAPI.getProfessionals().catch(() => ({ data: [] })),
    ]).then(([t, a, s, p]) => setData({ tickets: t.data.length, appointments: a.data.length, services: s.data.length, professionals: p.data.length }));
  }, []);
  return (
    <div className="animate-fade-in" data-testid="dashboard-page">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <StatCard label="Tickets" value={data.tickets} icon={<Headphones className="w-5 h-5" />} color="bg-blue-500" />
        <StatCard label="Agendamentos" value={data.appointments} icon={<CalendarCheck className="w-5 h-5" />} color="bg-emerald-500" />
        <StatCard label="Servicos" value={data.services} icon={<Scissors className="w-5 h-5" />} color="bg-violet-500" />
        <StatCard label="Profissionais" value={data.professionals} icon={<Briefcase className="w-5 h-5" />} color="bg-amber-500" />
      </div>
    </div>
  );
};

/* ========== KANBAN WITH DRAG AND DROP ========== */
const KanbanPage = () => {
  const [kanban, setKanban] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [draggedTicket, setDraggedTicket] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);

  useEffect(() => { crmAPI.getKanban().then(r => setKanban(r.data)).catch(() => {}); }, []);
  const reload = () => crmAPI.getKanban().then(r => setKanban(r.data));

  const cols = [
    { key: 'aberto', label: 'Aberto', bg: 'bg-blue-500', border: 'border-blue-300' },
    { key: 'em_cobranca', label: 'Em Cobranca', bg: 'bg-yellow-500', border: 'border-yellow-300' },
    { key: 'pago', label: 'Pago', bg: 'bg-emerald-500', border: 'border-emerald-300' },
    { key: 'bloqueado', label: 'Bloqueado', bg: 'bg-red-500', border: 'border-red-300' },
    { key: 'proposta', label: 'Proposta', bg: 'bg-violet-500', border: 'border-violet-300' },
  ];

  const handleDragStart = (e, ticket, fromCol) => {
    setDraggedTicket({ ...ticket, fromCol });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, colKey) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverCol(colKey);
  };

  const handleDragLeave = () => setDragOverCol(null);

  const handleDrop = async (e, toCol) => {
    e.preventDefault();
    setDragOverCol(null);
    if (!draggedTicket || draggedTicket.fromCol === toCol) { setDraggedTicket(null); return; }
    try {
      await crmAPI.updateTicket(draggedTicket.id, { status: toCol });
      toast.success(`Ticket movido para ${cols.find(c => c.key === toCol)?.label}`);
      reload();
    } catch (err) {
      toast.error('Erro ao mover ticket');
    }
    setDraggedTicket(null);
  };

  return (
    <div className="animate-fade-in" data-testid="kanban-page">
      <div className="flex items-center justify-between mb-4">
        <p className="text-slate-600 text-sm">Arraste os tickets entre colunas</p>
        <button onClick={() => setShowAdd(true)} className="btn-primary text-sm flex items-center gap-2" data-testid="add-ticket-btn"><Plus className="w-4 h-4" /> Novo Ticket</button>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {cols.map(col => (
          <div
            key={col.key}
            className={`flex-shrink-0 w-72 transition-all ${dragOverCol === col.key ? 'scale-[1.02]' : ''}`}
            data-testid={`kanban-col-${col.key}`}
            onDragOver={(e) => handleDragOver(e, col.key)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, col.key)}
          >
            <div className={`card !p-4 ${dragOverCol === col.key ? `border-2 ${col.border} bg-slate-50` : ''}`}>
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-2.5 h-2.5 rounded-full ${col.bg}`} />
                <span className="font-semibold text-sm text-slate-900">{col.label}</span>
                <span className="ml-auto text-xs text-slate-400">{kanban?.[col.key]?.length || 0}</span>
              </div>
              <div className="space-y-2 max-h-[60vh] overflow-y-auto min-h-[60px]">
                {kanban?.[col.key]?.map(t => (
                  <div
                    key={t.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, t, col.key)}
                    className="p-3 bg-slate-50 rounded-lg border border-slate-200 hover:shadow transition-all text-sm cursor-grab active:cursor-grabbing"
                    data-testid={`ticket-${t.id}`}
                  >
                    <div className="flex items-start gap-2">
                      <GripVertical className="w-4 h-4 text-slate-300 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900">{t.customer_name}</p>
                        <p className="text-xs text-slate-500 mt-1">{t.customer_phone}</p>
                        <div className="flex items-center gap-1.5 mt-2">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-slate-200">{t.channel}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${t.priority === 'high' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>{t.priority}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
      {showAdd && <TicketModal onClose={() => setShowAdd(false)} onSave={() => { setShowAdd(false); reload(); }} />}
    </div>
  );
};

/* ========== TICKETS ========== */
const TicketsPage = () => {
  const [tickets, setTickets] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  useEffect(() => { crmAPI.getTickets().then(r => setTickets(r.data)).catch(() => {}); }, []);
  return (
    <div className="animate-fade-in" data-testid="tickets-page">
      <div className="flex items-center justify-between mb-4">
        <p className="text-slate-600 text-sm">{tickets.length} tickets</p>
        <button onClick={() => setShowAdd(true)} className="btn-primary text-sm flex items-center gap-2" data-testid="add-ticket-btn2"><Plus className="w-4 h-4" /> Novo</button>
      </div>
      <div className="card">
        <table className="w-full">
          <thead><tr className="border-b border-slate-200">
            <th className="text-left py-2 px-3 text-xs font-bold uppercase tracking-widest text-slate-400">Cliente</th>
            <th className="text-left py-2 px-3 text-xs font-bold uppercase tracking-widest text-slate-400">Telefone</th>
            <th className="text-left py-2 px-3 text-xs font-bold uppercase tracking-widest text-slate-400">Canal</th>
            <th className="text-left py-2 px-3 text-xs font-bold uppercase tracking-widest text-slate-400">Status</th>
            <th className="text-left py-2 px-3 text-xs font-bold uppercase tracking-widest text-slate-400">Prioridade</th>
          </tr></thead>
          <tbody>
            {tickets.map(t => (
              <tr key={t.id} className="border-b border-slate-100 hover:bg-slate-50 text-sm"><td className="py-2 px-3 font-medium">{t.customer_name}</td><td className="py-2 px-3 text-slate-600">{t.customer_phone}</td><td className="py-2 px-3"><span className="text-xs px-2 py-0.5 rounded bg-slate-100">{t.channel}</span></td><td className="py-2 px-3"><StatusBadge s={t.status} /></td><td className="py-2 px-3"><PriorityBadge p={t.priority} /></td></tr>
            ))}
          </tbody>
        </table>
        {tickets.length === 0 && <p className="text-center py-8 text-sm text-slate-500">Nenhum ticket</p>}
      </div>
      {showAdd && <TicketModal onClose={() => setShowAdd(false)} onSave={() => { setShowAdd(false); crmAPI.getTickets().then(r => setTickets(r.data)); }} />}
    </div>
  );
};

/* ========== CONTACTS / CLIENTS ========== */
const ContactsPage = () => <CrudListPage title="Contatos" fetchFn={() => crmAPI.getTickets()} columns={[{key:'customer_name',label:'Nome'},{key:'customer_phone',label:'Telefone'},{key:'customer_email',label:'Email'}]} testId="contacts-page" />;

/* ========== CLIENTS PAGE (ENHANCED) ========== */
const ClientsPage = () => {
  const [clients, setClients] = useState([]);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const [clientHistory, setClientHistory] = useState([]);

  useEffect(() => { load(); }, [search]);
  const load = async () => {
    const res = await schedulingAPI.getClients({ search: search || undefined });
    setClients(res.data);
  };

  const loadHistory = async (phone) => {
    const res = await schedulingAPI.getAppointments({ search: phone });
    // filter by phone
    const filtered = res.data.filter(a => a.customer_phone === phone);
    setClientHistory(filtered);
  };

  const handleSelectClient = (client) => {
    setSelectedClient(client);
    loadHistory(client.phone);
  };

  const handleAddClient = async (form) => {
    try {
      await schedulingAPI.createClient(form);
      toast.success('Cliente criado!');
      setShowAdd(false);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro');
    }
  };

  return (
    <div className="animate-fade-in" data-testid="clients-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold font-heading text-slate-900">Clientes</h2>
          <p className="text-sm text-slate-600">{clients.length} clientes cadastrados</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2" data-testid="add-client-btn">
          <Plus className="w-4 h-4" /> Novo Cliente
        </button>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nome ou telefone..." className="input-field pl-10" data-testid="client-search" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Client List */}
        <div className="lg:col-span-2">
          <div className="card">
            <table className="w-full">
              <thead><tr className="border-b border-slate-200">
                <th className="text-left py-2 px-3 text-xs font-bold uppercase tracking-widest text-slate-400">Cliente</th>
                <th className="text-left py-2 px-3 text-xs font-bold uppercase tracking-widest text-slate-400">Telefone</th>
                <th className="text-left py-2 px-3 text-xs font-bold uppercase tracking-widest text-slate-400">Assinatura</th>
                <th className="text-left py-2 px-3 text-xs font-bold uppercase tracking-widest text-slate-400">Agend.</th>
              </tr></thead>
              <tbody>
                {clients.map(c => (
                  <tr key={c.id} onClick={() => handleSelectClient(c)}
                    className={`border-b border-slate-100 hover:bg-slate-50 cursor-pointer text-sm transition-colors ${selectedClient?.id === c.id ? 'bg-primary/5' : ''}`}
                    data-testid={`client-row-${c.id}`}>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold">{c.name?.substring(0,2).toUpperCase()}</div>
                        <div><p className="font-medium">{c.name}</p><p className="text-xs text-slate-400">{c.email || ''}</p></div>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-slate-600">{c.phone}</td>
                    <td className="py-2 px-3">
                      {c.active_subscription ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Plano Ativo</span>
                      ) : (
                        <span className="text-xs text-slate-400">-</span>
                      )}
                    </td>
                    <td className="py-2 px-3 font-medium">{c.total_appointments || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {clients.length === 0 && <p className="text-center py-8 text-sm text-slate-500">Nenhum cliente</p>}
          </div>
        </div>

        {/* Client Detail */}
        <div>
          {selectedClient ? (
            <div className="card" data-testid="client-detail">
              <div className="text-center mb-4">
                <div className="w-16 h-16 rounded-full bg-slate-200 flex items-center justify-center text-lg font-bold mx-auto mb-2">
                  {selectedClient.name?.substring(0,2).toUpperCase()}
                </div>
                <p className="font-bold text-slate-900">{selectedClient.name}</p>
                <p className="text-sm text-slate-500">{selectedClient.phone}</p>
              </div>
              {selectedClient.active_subscription && (
                <div className="p-3 bg-emerald-50 rounded-lg mb-4 text-center">
                  <p className="text-xs font-bold text-emerald-700">Assinante</p>
                  <p className="text-sm text-emerald-600">{selectedClient.active_subscription.credits_remaining} creditos restantes</p>
                </div>
              )}
              <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Historico</h4>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {clientHistory.map(a => (
                  <div key={a.id} className="p-2 bg-slate-50 rounded text-xs">
                    <div className="flex justify-between"><span className="font-medium">{a.service_name}</span><span className="text-slate-400">{a.date}</span></div>
                    <div className="flex justify-between mt-1"><span className="text-slate-500">{a.professional_name}</span><span className="font-medium">R$ {(a.price || 0).toFixed(2)}</span></div>
                  </div>
                ))}
                {clientHistory.length === 0 && <p className="text-xs text-slate-400 text-center py-4">Sem historico</p>}
              </div>
            </div>
          ) : (
            <div className="card text-center py-8"><p className="text-sm text-slate-500">Selecione um cliente</p></div>
          )}
        </div>
      </div>

      {showAdd && (
        <Modal title="Novo Cliente" onClose={() => setShowAdd(false)}>
          <ClientForm onSave={handleAddClient} />
        </Modal>
      )}
    </div>
  );
};

const ClientForm = ({ onSave }) => {
  const [form, setForm] = useState({ name: '', phone: '', email: '', notes: '' });
  return (
    <div className="space-y-3">
      <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Nome completo" className="input-field" data-testid="client-name-input" />
      <input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} placeholder="Telefone" className="input-field" data-testid="client-phone-input" />
      <input value={form.email} onChange={e => setForm({...form, email: e.target.value})} placeholder="Email (opcional)" className="input-field" type="email" />
      <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} placeholder="Observacoes" className="input-field" rows={2} />
      <div className="flex justify-end gap-2"><button onClick={() => form.name && form.phone && onSave(form)} className="btn-primary text-sm" data-testid="save-client-btn">Salvar</button></div>
    </div>
  );
};

/* ========== QUICK RESPONSES ========== */
const QuickResponsesPage = () => {
  const [items, setItems] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: '', content: '', shortcut: '' });
  useEffect(() => { crmAPI.getQuickResponses().then(r => setItems(r.data)).catch(() => {}); }, []);
  const handleSave = async () => {
    await crmAPI.createQuickResponse(form);
    toast.success('Resposta criada!');
    setShowAdd(false);
    setForm({ title: '', content: '', shortcut: '' });
    crmAPI.getQuickResponses().then(r => setItems(r.data));
  };
  return (
    <div className="animate-fade-in" data-testid="quick-responses-page">
      <div className="flex items-center justify-between mb-4">
        <p className="text-slate-600 text-sm">{items.length} respostas rapidas</p>
        <button onClick={() => setShowAdd(true)} className="btn-primary text-sm flex items-center gap-2"><Plus className="w-4 h-4" /> Nova</button>
      </div>
      <div className="grid gap-3">
        {items.map(i => (
          <div key={i.id} className="card !p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="font-medium text-sm text-slate-900">{i.title}</p>
              {i.shortcut && <code className="text-xs bg-slate-100 px-2 py-0.5 rounded">/{i.shortcut}</code>}
            </div>
            <p className="text-sm text-slate-600">{i.content}</p>
          </div>
        ))}
      </div>
      {showAdd && (
        <Modal title="Nova Resposta Rapida" onClose={() => setShowAdd(false)}>
          <div className="space-y-3">
            <input value={form.title} onChange={e => setForm({...form, title: e.target.value})} placeholder="Titulo" className="input-field" />
            <textarea value={form.content} onChange={e => setForm({...form, content: e.target.value})} placeholder="Conteudo da resposta" className="input-field" rows={3} />
            <input value={form.shortcut} onChange={e => setForm({...form, shortcut: e.target.value})} placeholder="Atalho (ex: ola)" className="input-field" />
          </div>
          <div className="flex justify-end gap-2 mt-4"><button onClick={() => setShowAdd(false)} className="btn-secondary text-sm">Cancelar</button><button onClick={handleSave} className="btn-primary text-sm">Salvar</button></div>
        </Modal>
      )}
    </div>
  );
};

/* ========== CAMPAIGNS ========== */
const CampaignsPage = () => {
  const [items, setItems] = useState([]);
  useEffect(() => { crmAPI.getCampaigns().then(r => setItems(r.data)).catch(() => {}); }, []);
  return (
    <div className="animate-fade-in" data-testid="campaigns-page">
      <div className="flex items-center justify-between mb-4">
        <p className="text-slate-600 text-sm">{items.length} campanhas</p>
        <button className="btn-primary text-sm flex items-center gap-2"><Plus className="w-4 h-4" /> Nova Campanha</button>
      </div>
      <div className="card">
        {items.length === 0 ? <p className="text-center py-8 text-sm text-slate-500">Nenhuma campanha criada</p> :
          items.map(i => <div key={i.id} className="p-3 border-b border-slate-100"><p className="font-medium text-sm">{i.name}</p><p className="text-xs text-slate-500">{i.status} - {i.type}</p></div>)}
      </div>
    </div>
  );
};

/* ========== TAGS ========== */
const TagsPage = () => (
  <div className="animate-fade-in card" data-testid="tags-page">
    <h3 className="font-semibold text-slate-900 mb-4">Tags</h3>
    <p className="text-sm text-slate-500">Gerencie suas tags para organizar tickets e contatos.</p>
    <div className="flex flex-wrap gap-2 mt-4">
      {['Urgente', 'VIP', 'Novo', 'Financeiro', 'Suporte', 'Vendas'].map(t => (
        <span key={t} className="px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium">{t}</span>
      ))}
    </div>
  </div>
);

/* ========== AI AGENT ========== */
const AIAgentPage = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const handleSend = async () => {
    if (!input.trim()) return;
    const userMsg = { role: 'user', content: input };
    setMessages(m => [...m, userMsg]);
    setInput('');
    setLoading(true);
    try {
      // Create a dummy ticket for AI context
      const res = await crmAPI.aiChat({ ticket_id: 'demo', message: input });
      setMessages(m => [...m, { role: 'assistant', content: res.data.response }]);
    } catch (e) {
      setMessages(m => [...m, { role: 'assistant', content: 'Desculpe, ocorreu um erro. Verifique se a chave de API esta configurada.' }]);
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="animate-fade-in card h-[calc(100vh-140px)] flex flex-col" data-testid="ai-agent-page">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center"><Sparkles className="w-5 h-5 text-primary" /></div>
        <div><p className="font-semibold text-sm">Agente IA</p><p className="text-xs text-slate-500">GPT-5.2 - Assistente de Atendimento</p></div>
      </div>
      <div className="flex-1 overflow-y-auto space-y-3 mb-4">
        {messages.length === 0 && <p className="text-center text-sm text-slate-400 mt-20">Envie uma mensagem para conversar com o Agente IA</p>}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[70%] rounded-xl px-4 py-2.5 text-sm ${m.role === 'user' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-800'}`}>{m.content}</div>
          </div>
        ))}
        {loading && <div className="flex justify-start"><div className="bg-slate-100 rounded-xl px-4 py-2.5 text-sm text-slate-500">Digitando...</div></div>}
      </div>
      <div className="flex gap-2">
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSend()} placeholder="Digite sua mensagem..." className="input-field flex-1" data-testid="ai-chat-input" />
        <button onClick={handleSend} disabled={loading} className="btn-primary" data-testid="ai-send-btn">Enviar</button>
      </div>
    </div>
  );
};

/* ========== WHATSAPP CONNECTIONS - ENHANCED ========== */
const WhatsAppPage = () => {
  const [status, setStatus] = useState('disconnected'); // disconnected, connecting, connected
  const [qrVisible, setQrVisible] = useState(false);

  const handleConnect = () => {
    setStatus('connecting');
    setQrVisible(true);
    // Simulate connection after 5s
    setTimeout(() => {
      setStatus('connected');
      setQrVisible(false);
      toast.success('WhatsApp conectado com sucesso!');
    }, 5000);
  };

  return (
    <div className="animate-fade-in" data-testid="whatsapp-page">
      {/* Status Banner */}
      <div className={`card mb-6 border-l-4 ${
        status === 'connected' ? 'border-l-emerald-500 bg-emerald-50' :
        status === 'connecting' ? 'border-l-amber-500 bg-amber-50' :
        'border-l-slate-400 bg-slate-50'
      }`}>
        <div className="flex items-center gap-4">
          <div className={`w-3 h-3 rounded-full ${
            status === 'connected' ? 'bg-emerald-500 animate-pulse' :
            status === 'connecting' ? 'bg-amber-500 animate-pulse' :
            'bg-slate-400'
          }`} />
          <div>
            <p className="font-medium text-sm text-slate-900">
              {status === 'connected' ? 'WhatsApp Conectado' :
               status === 'connecting' ? 'Conectando...' :
               'WhatsApp Desconectado'}
            </p>
            <p className="text-xs text-slate-600">
              {status === 'connected' ? 'Pronto para enviar e receber mensagens' :
               status === 'connecting' ? 'Escaneie o QR Code no seu celular' :
               'Clique em conectar para vincular seu WhatsApp'}
            </p>
          </div>
          {status === 'disconnected' && (
            <button onClick={handleConnect} className="ml-auto btn-primary text-sm" data-testid="connect-whatsapp-btn">Conectar</button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* QR Code Section */}
        <div className="card text-center">
          <h3 className="font-semibold text-slate-900 mb-4">Vincular Dispositivo</h3>
          {qrVisible ? (
            <div className="p-6 bg-white rounded-xl border-2 border-slate-200 max-w-[280px] mx-auto">
              <div className="w-56 h-56 bg-gradient-to-br from-slate-100 to-slate-200 rounded-lg mx-auto flex items-center justify-center relative overflow-hidden">
                {/* Simulated QR pattern */}
                <div className="grid grid-cols-8 gap-0.5 p-4">
                  {Array.from({length: 64}).map((_, i) => (
                    <div key={i} className={`w-4 h-4 rounded-sm ${Math.random() > 0.5 ? 'bg-slate-800' : 'bg-white'}`} />
                  ))}
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-12 h-12 bg-white rounded-lg flex items-center justify-center shadow-lg">
                    <Phone className="w-6 h-6 text-emerald-600" />
                  </div>
                </div>
              </div>
              <p className="text-xs text-slate-500 mt-3">Escaneie com seu WhatsApp</p>
              <p className="text-[10px] text-slate-400 mt-1">Abra WhatsApp &gt; Dispositivos conectados &gt; Conectar</p>
            </div>
          ) : (
            <div className="py-8">
              <div className="w-20 h-20 rounded-2xl bg-emerald-100 flex items-center justify-center mx-auto mb-3">
                <Phone className="w-10 h-10 text-emerald-600" />
              </div>
              <p className="text-sm text-slate-600">
                {status === 'connected' ? 'Dispositivo vinculado com sucesso' : 'Clique em Conectar para gerar o QR Code'}
              </p>
            </div>
          )}
        </div>

        {/* Info Section */}
        <div className="card">
          <h3 className="font-semibold text-slate-900 mb-4">Informacoes da Conexao</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <span className="text-sm text-slate-600">Status</span>
              <StatusBadge s={status} />
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <span className="text-sm text-slate-600">Numero</span>
              <span className="text-sm font-medium text-slate-900">{status === 'connected' ? '+55 (11) 9XXXX-XXXX' : '-'}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <span className="text-sm text-slate-600">Mensagens hoje</span>
              <span className="text-sm font-medium text-slate-900">{status === 'connected' ? '0' : '-'}</span>
            </div>
          </div>
          {status === 'connected' && (
            <button onClick={() => { setStatus('disconnected'); toast.info('WhatsApp desconectado'); }} className="btn-secondary text-sm w-full mt-4">
              Desconectar
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

/* ========== APPOINTMENTS ========== */
const AppointmentsPage = () => {
  const [items, setItems] = useState([]);
  useEffect(() => { schedulingAPI.getAppointments().then(r => setItems(r.data)).catch(() => {}); }, []);
  return (
    <div className="animate-fade-in" data-testid="appointments-page">
      <div className="flex items-center justify-between mb-4">
        <p className="text-slate-600 text-sm">{items.length} agendamentos</p>
      </div>
      <div className="card">
        <table className="w-full">
          <thead><tr className="border-b border-slate-200">
            <th className="text-left py-2 px-3 text-xs font-bold uppercase tracking-widest text-slate-400">Cliente</th>
            <th className="text-left py-2 px-3 text-xs font-bold uppercase tracking-widest text-slate-400">Servico</th>
            <th className="text-left py-2 px-3 text-xs font-bold uppercase tracking-widest text-slate-400">Profissional</th>
            <th className="text-left py-2 px-3 text-xs font-bold uppercase tracking-widest text-slate-400">Data</th>
            <th className="text-left py-2 px-3 text-xs font-bold uppercase tracking-widest text-slate-400">Hora</th>
            <th className="text-left py-2 px-3 text-xs font-bold uppercase tracking-widest text-slate-400">Status</th>
          </tr></thead>
          <tbody>{items.map(a => (
            <tr key={a.id} className="border-b border-slate-100 hover:bg-slate-50 text-sm">
              <td className="py-2 px-3 font-medium">{a.customer_name}</td>
              <td className="py-2 px-3 text-slate-600">{a.service_name}</td>
              <td className="py-2 px-3 text-slate-600">{a.professional_name}</td>
              <td className="py-2 px-3 text-slate-600">{a.date}</td>
              <td className="py-2 px-3 font-medium text-primary">{a.time}</td>
              <td className="py-2 px-3"><StatusBadge s={a.status} /></td>
            </tr>
          ))}</tbody>
        </table>
        {items.length === 0 && <p className="text-center py-8 text-sm text-slate-500">Nenhum agendamento</p>}
      </div>
    </div>
  );
};

/* ========== CALENDAR ========== */
const CalendarPage = () => {
  const [items, setItems] = useState([]);
  useEffect(() => { schedulingAPI.getAppointments().then(r => setItems(r.data)).catch(() => {}); }, []);
  const today = new Date().toISOString().split('T')[0];
  const todayItems = items.filter(i => i.date === today);
  return (
    <div className="animate-fade-in" data-testid="calendar-page">
      <div className="card">
        <h3 className="font-semibold text-slate-900 mb-4">Agendamentos de Hoje ({today})</h3>
        <div className="space-y-2">
          {todayItems.length === 0 && <p className="text-sm text-slate-500 py-4 text-center">Nenhum agendamento para hoje</p>}
          {todayItems.map(a => (
            <div key={a.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <div><p className="font-medium text-sm">{a.customer_name}</p><p className="text-xs text-slate-500">{a.service_name} - {a.professional_name}</p></div>
              <div className="text-right"><p className="font-semibold text-sm text-primary">{a.time}</p><StatusBadge s={a.status} /></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/* ========== SERVICES ========== */
const ServicesPage = () => {
  const [items, setItems] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', price: '', duration: '', type: 'service' });
  useEffect(() => { schedulingAPI.getServices().then(r => setItems(r.data)).catch(() => {}); }, []);
  const handleSave = async () => {
    await schedulingAPI.createService({ ...form, price: parseFloat(form.price), duration: parseInt(form.duration) });
    toast.success('Servico criado!');
    setShowAdd(false);
    schedulingAPI.getServices().then(r => setItems(r.data));
  };
  return (
    <div className="animate-fade-in" data-testid="services-page">
      <div className="flex items-center justify-between mb-4">
        <p className="text-slate-600 text-sm">{items.length} servicos</p>
        <button onClick={() => setShowAdd(true)} className="btn-primary text-sm flex items-center gap-2" data-testid="add-service-btn"><Plus className="w-4 h-4" /> Novo Servico</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map(s => (
          <div key={s.id} className="card !p-4" data-testid={`service-card-${s.id}`}>
            <div className="flex items-center justify-between mb-2">
              <p className="font-medium text-sm text-slate-900">{s.name}</p>
              <span className={`text-xs px-2 py-0.5 rounded-full ${s.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{s.is_active ? 'Ativo' : 'Inativo'}</span>
            </div>
            {s.description && <p className="text-xs text-slate-500 mb-2">{s.description}</p>}
            <div className="flex items-center gap-3 text-xs text-slate-600">
              <span className="font-semibold text-primary">R$ {s.price?.toFixed(2)}</span>
              <span><Clock className="w-3 h-3 inline" /> {s.duration} min</span>
            </div>
          </div>
        ))}
      </div>
      {showAdd && (
        <Modal title="Novo Servico" onClose={() => setShowAdd(false)}>
          <div className="space-y-3">
            <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Nome do servico" className="input-field" data-testid="service-name-input" />
            <input value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Descricao" className="input-field" />
            <div className="grid grid-cols-2 gap-3">
              <input type="number" value={form.price} onChange={e => setForm({...form, price: e.target.value})} placeholder="Preco (R$)" className="input-field" data-testid="service-price-input" />
              <input type="number" value={form.duration} onChange={e => setForm({...form, duration: e.target.value})} placeholder="Duracao (min)" className="input-field" data-testid="service-duration-input" />
            </div>
            <select value={form.type} onChange={e => setForm({...form, type: e.target.value})} className="input-field">
              <option value="service">Servico</option><option value="product">Produto</option><option value="subscription">Assinatura</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setShowAdd(false)} className="btn-secondary text-sm">Cancelar</button>
            <button onClick={handleSave} className="btn-primary text-sm" data-testid="save-service-btn">Salvar</button>
          </div>
        </Modal>
      )}
    </div>
  );
};

/* ========== PROFESSIONALS ========== */
const ProfessionalsPage = () => {
  const [items, setItems] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '', specialties: [] });
  useEffect(() => { schedulingAPI.getProfessionals().then(r => setItems(r.data)).catch(() => {}); }, []);
  const handleSave = async () => {
    const payload = { name: form.name, phone: form.phone, specialties: form.specialties };
    if (form.email) payload.email = form.email;
    await schedulingAPI.createProfessional(payload);
    toast.success('Profissional criado!');
    setShowAdd(false);
    schedulingAPI.getProfessionals().then(r => setItems(r.data));
  };
  return (
    <div className="animate-fade-in" data-testid="professionals-page">
      <div className="flex items-center justify-between mb-4">
        <p className="text-slate-600 text-sm">{items.length} profissionais</p>
        <button onClick={() => setShowAdd(true)} className="btn-primary text-sm flex items-center gap-2" data-testid="add-professional-btn"><Plus className="w-4 h-4" /> Novo Profissional</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map(p => (
          <div key={p.id} className="card !p-4" data-testid={`prof-card-${p.id}`}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">{p.name[0]}</div>
              <div><p className="font-medium text-sm">{p.name}</p>{p.phone && <p className="text-xs text-slate-500">{p.phone}</p>}</div>
            </div>
          </div>
        ))}
      </div>
      {showAdd && (
        <Modal title="Novo Profissional" onClose={() => setShowAdd(false)}>
          <div className="space-y-3">
            <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Nome" className="input-field" data-testid="prof-name-input" />
            <input value={form.email} onChange={e => setForm({...form, email: e.target.value})} placeholder="Email" className="input-field" />
            <input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} placeholder="Telefone" className="input-field" />
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setShowAdd(false)} className="btn-secondary text-sm">Cancelar</button>
            <button onClick={handleSave} className="btn-primary text-sm" data-testid="save-prof-btn">Salvar</button>
          </div>
        </Modal>
      )}
    </div>
  );
};

/* ========== CATEGORIES ========== */
const CategoriesPage = () => {
  const [items, setItems] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  useEffect(() => { schedulingAPI.getCategories().then(r => setItems(r.data)).catch(() => {}); }, []);
  const handleSave = async () => {
    await schedulingAPI.createCategory(form);
    toast.success('Categoria criada!');
    setShowAdd(false);
    schedulingAPI.getCategories().then(r => setItems(r.data));
  };
  return (
    <div className="animate-fade-in" data-testid="categories-page">
      <div className="flex items-center justify-between mb-4">
        <p className="text-slate-600 text-sm">{items.length} categorias</p>
        <button onClick={() => setShowAdd(true)} className="btn-primary text-sm flex items-center gap-2"><Plus className="w-4 h-4" /> Nova Categoria</button>
      </div>
      <div className="grid gap-3">
        {items.map(c => <div key={c.id} className="card !p-4"><p className="font-medium text-sm">{c.name}</p>{c.description && <p className="text-xs text-slate-500 mt-1">{c.description}</p>}</div>)}
      </div>
      {showAdd && (
        <Modal title="Nova Categoria" onClose={() => setShowAdd(false)}>
          <div className="space-y-3">
            <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Nome" className="input-field" />
            <input value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Descricao" className="input-field" />
          </div>
          <div className="flex justify-end gap-2 mt-4"><button onClick={() => setShowAdd(false)} className="btn-secondary text-sm">Cancelar</button><button onClick={handleSave} className="btn-primary text-sm">Salvar</button></div>
        </Modal>
      )}
    </div>
  );
};

/* ========== MY SITE (BOOKING PAGE) WITH UPLOAD ========== */
const MySitePage = () => {
  const [page, setPage] = useState(null);
  const [uploading, setUploading] = useState(null); // 'logo' | 'banner' | null
  const [saving, setSaving] = useState(false);
  const logoRef = useRef(null);
  const bannerRef = useRef(null);

  useEffect(() => { schedulingAPI.getBookingPage().then(r => setPage(r.data)).catch(() => {}); }, []);

  const handleUpload = async (file, type) => {
    if (!file) return;
    setUploading(type);
    try {
      const res = await uploadAPI.uploadBookingImage(file);
      const url = res.data.url;
      const updateData = type === 'logo' ? { logo_url: url } : { banner_url: url };
      await schedulingAPI.updateBookingPage(updateData);
      const updated = await schedulingAPI.getBookingPage();
      setPage(updated.data);
      toast.success(`${type === 'logo' ? 'Logo' : 'Banner'} atualizado!`);
    } catch (e) {
      toast.error(`Erro ao fazer upload do ${type}`);
    } finally {
      setUploading(null);
    }
  };

  const handleColorSave = async (field, value) => {
    setSaving(true);
    try {
      await schedulingAPI.updateBookingPage({ [field]: value });
      const updated = await schedulingAPI.getBookingPage();
      setPage(updated.data);
      toast.success('Cor atualizada!');
    } catch (e) {
      toast.error('Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const API_BASE = process.env.REACT_APP_BACKEND_URL;

  return (
    <div className="animate-fade-in" data-testid="my-site-page">
      <div className="card mb-6">
        <h3 className="text-lg font-semibold font-heading text-slate-900 mb-2">Minha Pagina de Agendamento</h3>
        <p className="text-sm text-slate-600 mb-4">Personalize a pagina onde seus clientes fazem agendamentos</p>
        {page?.slug && (
          <div className="p-4 bg-slate-50 rounded-lg mb-4">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Link da Sua Pagina</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-white px-3 py-2 rounded border border-slate-200 text-sm">{window.location.origin}/booking/{page.slug}</code>
              <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/booking/${page.slug}`); toast.success('Link copiado!'); }} className="btn-primary text-sm" data-testid="copy-link-btn">Copiar</button>
              <a href={`/booking/${page.slug}`} target="_blank" rel="noopener noreferrer" className="btn-secondary text-sm">Visualizar</a>
            </div>
          </div>
        )}
      </div>

      {/* Identity Section */}
      <div className="card mb-6">
        <h3 className="font-semibold text-slate-900 mb-4">Identidade Visual</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Logo Upload */}
          <div>
            <p className="text-sm font-medium text-slate-700 mb-2">Logo da Empresa</p>
            <input type="file" ref={logoRef} className="hidden" accept="image/*" onChange={(e) => handleUpload(e.target.files[0], 'logo')} />
            <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center hover:border-primary transition-colors cursor-pointer" onClick={() => logoRef.current?.click()} data-testid="logo-upload-area">
              {page?.logo_url ? (
                <img src={`${API_BASE}${page.logo_url}`} alt="Logo" className="max-h-24 mx-auto rounded" />
              ) : (
                <div className="flex flex-col items-center">
                  <Upload className="w-8 h-8 text-slate-400 mb-2" />
                  <p className="text-sm text-slate-500">Clique para enviar logo</p>
                </div>
              )}
              {uploading === 'logo' && <p className="text-xs text-primary mt-2">Enviando...</p>}
            </div>
          </div>

          {/* Banner Upload */}
          <div>
            <p className="text-sm font-medium text-slate-700 mb-2">Banner da Pagina</p>
            <input type="file" ref={bannerRef} className="hidden" accept="image/*" onChange={(e) => handleUpload(e.target.files[0], 'banner')} />
            <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center hover:border-primary transition-colors cursor-pointer" onClick={() => bannerRef.current?.click()} data-testid="banner-upload-area">
              {page?.banner_url ? (
                <img src={`${API_BASE}${page.banner_url}`} alt="Banner" className="max-h-24 mx-auto rounded" />
              ) : (
                <div className="flex flex-col items-center">
                  <Image className="w-8 h-8 text-slate-400 mb-2" />
                  <p className="text-sm text-slate-500">Clique para enviar banner</p>
                </div>
              )}
              {uploading === 'banner' && <p className="text-xs text-primary mt-2">Enviando...</p>}
            </div>
          </div>
        </div>
      </div>

      {/* Colors */}
      <div className="card">
        <h3 className="font-semibold text-slate-900 mb-4">Cores</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 border border-slate-200 rounded-lg">
            <p className="text-sm font-medium text-slate-700 mb-2">Cor Primaria</p>
            <div className="flex items-center gap-3">
              <input type="color" value={page?.primary_color || '#4F46E5'} onChange={(e) => handleColorSave('primary_color', e.target.value)} className="w-10 h-10 rounded cursor-pointer border-0" data-testid="primary-color-picker" />
              <span className="text-sm text-slate-600">{page?.primary_color || '#4F46E5'}</span>
            </div>
          </div>
          <div className="p-4 border border-slate-200 rounded-lg">
            <p className="text-sm font-medium text-slate-700 mb-2">Cor Secundaria</p>
            <div className="flex items-center gap-3">
              <input type="color" value={page?.secondary_color || '#10B981'} onChange={(e) => handleColorSave('secondary_color', e.target.value)} className="w-10 h-10 rounded cursor-pointer border-0" data-testid="secondary-color-picker" />
              <span className="text-sm text-slate-600">{page?.secondary_color || '#10B981'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ========== FINANCEIRO (REAL) ========== */
const FinanceiroPage = () => {
  const [data, setData] = useState(null);
  const [period, setPeriod] = useState('');
  useEffect(() => { reportsAPI.getFinancial(period ? { start_date: period } : {}).then(r => setData(r.data)).catch(() => {}); }, [period]);
  return (
    <div className="animate-fade-in" data-testid="financeiro-page">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-5 mb-6">
        <StatCard label="Receita Total" value={`R$ ${(data?.total_revenue || 0).toFixed(2)}`} icon={<DollarSign className="w-5 h-5" />} color="bg-emerald-500" />
        <StatCard label="Concluidos" value={data?.completed_count || 0} icon={<CheckCircle2 className="w-5 h-5" />} color="bg-blue-500" />
        <StatCard label="Pendentes" value={data?.pending_count || 0} icon={<Clock className="w-5 h-5" />} color="bg-amber-500" />
        <StatCard label="Cancelados" value={data?.cancelled_count || 0} icon={<X className="w-5 h-5" />} color="bg-red-500" />
      </div>
      <div className="card">
        <h3 className="font-semibold text-slate-900 mb-4">Resumo Financeiro</h3>
        <div className="space-y-3">
          <div className="flex justify-between p-3 bg-emerald-50 rounded-lg"><span className="text-sm text-slate-700">Receita Concluida</span><span className="font-bold text-emerald-700">R$ {(data?.completed_revenue || 0).toFixed(2)}</span></div>
          <div className="flex justify-between p-3 bg-amber-50 rounded-lg"><span className="text-sm text-slate-700">Receita Pendente</span><span className="font-bold text-amber-700">R$ {(data?.pending_revenue || 0).toFixed(2)}</span></div>
          <div className="flex justify-between p-3 bg-slate-50 rounded-lg"><span className="text-sm font-medium text-slate-900">Total</span><span className="font-bold text-lg text-slate-900">R$ {(data?.total_revenue || 0).toFixed(2)}</span></div>
        </div>
      </div>
    </div>
  );
};

/* ========== COMISSOES (REAL) ========== */
const ComissoesPage = () => {
  const [data, setData] = useState(null);
  useEffect(() => { reportsAPI.getCommissions().then(r => setData(r.data)).catch(() => {}); }, []);
  return (
    <div className="animate-fade-in" data-testid="comissoes-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold font-heading text-slate-900">Comissoes</h2>
          <p className="text-sm text-slate-600">Relatorio de comissoes por profissional</p>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Faturamento Total" value={`R$ ${(data?.summary?.total_revenue || 0).toFixed(2)}`} icon={<DollarSign className="w-5 h-5" />} color="bg-emerald-500" />
        <StatCard label="Total Comissoes" value={`R$ ${(data?.summary?.total_commission || 0).toFixed(2)}`} icon={<PieChart className="w-5 h-5" />} color="bg-violet-500" />
        <StatCard label="Atendimentos" value={data?.summary?.total_appointments || 0} icon={<CalendarCheck className="w-5 h-5" />} color="bg-blue-500" />
        <StatCard label="Ticket Medio" value={`R$ ${(data?.summary?.avg_ticket || 0).toFixed(2)}`} icon={<BarChart3 className="w-5 h-5" />} color="bg-amber-500" />
      </div>
      <div className="card">
        <table className="w-full" data-testid="commissions-table">
          <thead><tr className="border-b border-slate-200">
            <th className="text-left py-3 px-4 text-xs font-bold uppercase tracking-widest text-slate-400">Profissional</th>
            <th className="text-left py-3 px-4 text-xs font-bold uppercase tracking-widest text-slate-400">Atendimentos</th>
            <th className="text-left py-3 px-4 text-xs font-bold uppercase tracking-widest text-slate-400">Faturamento</th>
            <th className="text-left py-3 px-4 text-xs font-bold uppercase tracking-widest text-slate-400">% Comissao</th>
            <th className="text-left py-3 px-4 text-xs font-bold uppercase tracking-widest text-slate-400">Valor Comissao</th>
          </tr></thead>
          <tbody>
            {(data?.report || []).map(r => (
              <tr key={r.professional_id} className="border-b border-slate-100 hover:bg-slate-50 text-sm">
                <td className="py-3 px-4 font-medium text-slate-900">{r.professional_name}</td>
                <td className="py-3 px-4 text-slate-600">{r.appointments_count}</td>
                <td className="py-3 px-4 text-slate-600">R$ {r.revenue.toFixed(2)}</td>
                <td className="py-3 px-4"><span className="text-xs px-2 py-1 rounded-full bg-violet-100 text-violet-700 font-medium">{r.commission_percent}%</span></td>
                <td className="py-3 px-4 font-bold text-emerald-600">R$ {r.commission_value.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(data?.report || []).length === 0 && <p className="text-center py-8 text-sm text-slate-500">Nenhum dado de comissao disponivel. Complete atendimentos para gerar relatorio.</p>}
      </div>
    </div>
  );
};

/* ========== NOTIFICACOES (REAL) ========== */
const NotificacoesPage = () => {
  const [settings, setSettings] = useState(null);
  const [history, setHistory] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([notificationsAPI.getSettings(), notificationsAPI.getHistory()])
      .then(([s, h]) => { setSettings(s.data); setHistory(h.data); }).catch(() => {});
  }, []);

  const toggleSetting = async (key) => {
    if (!settings) return;
    setSaving(true);
    const newValue = !settings[key];
    await notificationsAPI.updateSettings({ [key]: newValue });
    setSettings({ ...settings, [key]: newValue });
    toast.success('Configuracao atualizada!');
    setSaving(false);
  };

  const handleSendTest = async () => {
    const res = await notificationsAPI.sendTest();
    toast.success('Notificacao de teste enviada!');
    setHistory(h => [res.data, ...h]);
  };

  const notifTypes = [
    { key: 'booking_confirmation', label: 'Confirmacao de Agendamento', desc: 'Envia mensagem quando agendamento e confirmado' },
    { key: 'booking_reminder_24h', label: 'Lembrete 24h antes', desc: 'Envia lembrete 24 horas antes do agendamento' },
    { key: 'booking_cancelled', label: 'Cancelamento', desc: 'Envia notificacao quando agendamento e cancelado' },
    { key: 'new_client', label: 'Novo Cliente', desc: 'Notifica quando um novo cliente se cadastra' },
    { key: 'daily_summary', label: 'Resumo Diario', desc: 'Envia resumo dos agendamentos do dia seguinte' },
  ];

  return (
    <div className="animate-fade-in" data-testid="notificacoes-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold font-heading text-slate-900">Notificacoes</h2>
          <p className="text-sm text-slate-600">Configure as notificacoes automaticas da sua empresa</p>
        </div>
        <button onClick={handleSendTest} className="btn-secondary text-sm" data-testid="send-test-notif">Enviar Teste</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {/* Channel */}
          <div className="card">
            <h3 className="font-semibold text-slate-900 mb-3">Canal de Envio</h3>
            <div className="flex gap-3">
              {['whatsapp', 'email', 'both'].map(ch => (
                <button key={ch} onClick={() => notificationsAPI.updateSettings({ channel: ch }).then(r => setSettings(r.data))}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border-2 transition-all ${
                    settings?.channel === ch ? 'border-primary bg-primary/5 text-primary' : 'border-slate-200 text-slate-600 hover:border-slate-300'
                  }`} data-testid={`channel-${ch}`}>
                  {ch === 'whatsapp' ? 'WhatsApp' : ch === 'email' ? 'Email' : 'Ambos'}
                </button>
              ))}
            </div>
          </div>

          {/* Settings */}
          <div className="card">
            <h3 className="font-semibold text-slate-900 mb-4">Tipos de Notificacao</h3>
            <div className="space-y-3">
              {notifTypes.map(nt => (
                <div key={nt.key} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{nt.label}</p>
                    <p className="text-xs text-slate-500">{nt.desc}</p>
                  </div>
                  <button onClick={() => toggleSetting(nt.key)} disabled={saving}
                    className={`w-12 h-6 rounded-full transition-colors relative ${settings?.[nt.key] ? 'bg-primary' : 'bg-slate-300'}`}
                    data-testid={`toggle-${nt.key}`}>
                    <div className={`w-5 h-5 rounded-full bg-white shadow-sm absolute top-0.5 transition-all ${settings?.[nt.key] ? 'left-[26px]' : 'left-0.5'}`} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* History */}
        <div className="card">
          <h3 className="font-semibold text-slate-900 mb-4">Historico</h3>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {history.map(n => (
              <div key={n.id} className="p-2 bg-slate-50 rounded text-xs">
                <div className="flex justify-between mb-1">
                  <span className="font-medium text-slate-900">{n.title}</span>
                  <span className={`px-1.5 py-0.5 rounded ${n.status === 'sent' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{n.status}</span>
                </div>
                <p className="text-slate-500">{n.message}</p>
                <p className="text-slate-400 mt-1">{new Date(n.created_at).toLocaleString('pt-BR')}</p>
              </div>
            ))}
            {history.length === 0 && <p className="text-xs text-slate-400 text-center py-8">Nenhuma notificacao enviada</p>}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ========== CONFIG ========== */
const ConfigPage = () => {
  const { user } = useAuth();
  return (
    <div className="animate-fade-in" data-testid="config-page">
      <div className="card max-w-2xl">
        <h3 className="font-semibold text-slate-900 mb-4">Configuracoes da Empresa</h3>
        <div className="space-y-3">
          <div><label className="text-xs font-bold uppercase text-slate-400">Nome</label><p className="text-sm">{user?.company?.name}</p></div>
          <div><label className="text-xs font-bold uppercase text-slate-400">Email</label><p className="text-sm">{user?.company?.email}</p></div>
          <div><label className="text-xs font-bold uppercase text-slate-400">Plano</label><p className="text-sm capitalize">{user?.company?.plan_type}</p></div>
          <div><label className="text-xs font-bold uppercase text-slate-400">Status</label><p className="text-sm capitalize">{user?.company?.status}</p></div>
        </div>
      </div>
    </div>
  );
};

/* ========== SHARED COMPONENTS ========== */
const PlaceholderPage = ({ title }) => (
  <div className="animate-fade-in card text-center py-12">
    <p className="text-slate-500">{title} - Em breve</p>
  </div>
);

const Modal = ({ title, onClose, children }) => (
  <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
    <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold font-heading text-slate-900">{title}</h3>
        <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-5 h-5" /></button>
      </div>
      {children}
    </div>
  </div>
);

const TicketModal = ({ onClose, onSave }) => {
  const [form, setForm] = useState({ customer_name: '', customer_phone: '', description: '', priority: 'medium', channel: 'whatsapp' });
  const handleSave = async () => {
    await crmAPI.createTicket(form);
    toast.success('Ticket criado!');
    onSave();
  };
  return (
    <Modal title="Novo Ticket" onClose={onClose}>
      <div className="space-y-3">
        <input value={form.customer_name} onChange={e => setForm({...form, customer_name: e.target.value})} placeholder="Nome do cliente" className="input-field" data-testid="ticket-name-input" />
        <input value={form.customer_phone} onChange={e => setForm({...form, customer_phone: e.target.value})} placeholder="Telefone" className="input-field" data-testid="ticket-phone-input" />
        <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Descricao" className="input-field" rows={2} />
        <div className="grid grid-cols-2 gap-3">
          <select value={form.priority} onChange={e => setForm({...form, priority: e.target.value})} className="input-field">
            <option value="low">Baixa</option><option value="medium">Media</option><option value="high">Alta</option>
          </select>
          <select value={form.channel} onChange={e => setForm({...form, channel: e.target.value})} className="input-field">
            <option value="whatsapp">WhatsApp</option><option value="web">Web</option><option value="email">Email</option>
          </select>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="btn-secondary text-sm">Cancelar</button>
        <button onClick={handleSave} className="btn-primary text-sm" data-testid="save-ticket-btn">Criar Ticket</button>
      </div>
    </Modal>
  );
};

const CrudListPage = ({ title, fetchFn, columns, testId }) => {
  const [items, setItems] = useState([]);
  useEffect(() => { fetchFn().then(r => setItems(r.data)).catch(() => {}); }, []);
  const uniqueItems = items.reduce((acc, item) => {
    const key = item.customer_name + item.customer_phone;
    if (!acc.find(a => a.customer_name + a.customer_phone === key)) acc.push(item);
    return acc;
  }, []);
  return (
    <div className="animate-fade-in" data-testid={testId}>
      <div className="flex items-center justify-between mb-4"><p className="text-slate-600 text-sm">{uniqueItems.length} {title.toLowerCase()}</p></div>
      <div className="card">
        <table className="w-full">
          <thead><tr className="border-b border-slate-200">{columns.map(c => <th key={c.key} className="text-left py-2 px-3 text-xs font-bold uppercase tracking-widest text-slate-400">{c.label}</th>)}</tr></thead>
          <tbody>{uniqueItems.map((item, i) => (
            <tr key={i} className="border-b border-slate-100 hover:bg-slate-50 text-sm">{columns.map(c => <td key={c.key} className="py-2 px-3 text-slate-700">{item[c.key] || '-'}</td>)}</tr>
          ))}</tbody>
        </table>
        {uniqueItems.length === 0 && <p className="text-center py-8 text-sm text-slate-500">Nenhum registro</p>}
      </div>
    </div>
  );
};

const StatCard = ({ label, value, icon, color }) => (
  <div className="card !p-4"><div className="flex items-center justify-between"><div><p className="text-xs text-slate-500 mb-1">{label}</p><p className="text-2xl font-bold font-heading text-slate-900">{value}</p></div><div className={`${color} p-2.5 rounded-lg text-white`}>{icon}</div></div></div>
);

const StatusBadge = ({ s }) => (
  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
    ['confirmado','pago','active'].includes(s) ? 'bg-emerald-100 text-emerald-700' :
    ['pendente','aberto','em_cobranca'].includes(s) ? 'bg-amber-100 text-amber-700' :
    ['cancelado','bloqueado'].includes(s) ? 'bg-red-100 text-red-700' :
    'bg-slate-100 text-slate-600'
  }`}>{s}</span>
);

const PriorityBadge = ({ p }) => (
  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
    p === 'high' ? 'bg-red-100 text-red-700' : p === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
  }`}>{p}</span>
);

/* ========== ONBOARDING WIZARD ========== */
const OnboardingWizard = ({ onClose }) => {
  const [step, setStep] = useState(0);
  const [serviceForm, setServiceForm] = useState({ name: '', price: '', duration: '' });
  const [profForm, setProfForm] = useState({ name: '', phone: '' });
  const [status, setStatus] = useState({ has_services: false, has_professionals: false });

  useEffect(() => {
    schedulingAPI.getOnboardingStatus().then(r => setStatus(r.data.steps)).catch(() => {});
  }, []);

  const steps = [
    { title: 'Bem-vindo!', desc: 'Vamos configurar sua empresa em poucos passos', icon: CheckCircle2 },
    { title: 'Adicionar Servico', desc: 'Cadastre pelo menos um servico que voce oferece', icon: Scissors },
    { title: 'Adicionar Profissional', desc: 'Cadastre um profissional para realizar atendimentos', icon: Briefcase },
    { title: 'Tudo Pronto!', desc: 'Sua empresa esta configurada. Compartilhe sua pagina!', icon: CheckCircle2 },
  ];

  const handleCreateService = async () => {
    if (!serviceForm.name || !serviceForm.price || !serviceForm.duration) { toast.error('Preencha todos os campos'); return; }
    try {
      await schedulingAPI.createService({ ...serviceForm, price: parseFloat(serviceForm.price), duration: parseInt(serviceForm.duration), type: 'service' });
      toast.success('Servico criado!');
      setStep(2);
    } catch (e) { toast.error('Erro ao criar servico'); }
  };

  const handleCreateProfessional = async () => {
    if (!profForm.name) { toast.error('Preencha o nome'); return; }
    try {
      await schedulingAPI.createProfessional({ name: profForm.name, phone: profForm.phone });
      toast.success('Profissional criado!');
      setStep(3);
    } catch (e) { toast.error('Erro ao criar profissional'); }
  };

  const CurrentIcon = steps[step].icon;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Progress */}
        <div className="h-1.5 bg-slate-100">
          <div className="h-full bg-primary transition-all duration-500" style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
        </div>

        <div className="p-8">
          {/* Step indicator */}
          <div className="flex items-center justify-center mb-6">
            {steps.map((_, i) => (
              <React.Fragment key={i}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                  i <= step ? 'bg-primary text-white' : 'bg-slate-200 text-slate-400'
                }`}>
                  {i < step ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
                </div>
                {i < steps.length - 1 && <div className={`w-12 h-0.5 ${i < step ? 'bg-primary' : 'bg-slate-200'}`} />}
              </React.Fragment>
            ))}
          </div>

          <div className="text-center mb-6">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <CurrentIcon className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-2xl font-bold font-heading text-slate-900 mb-2">{steps[step].title}</h2>
            <p className="text-sm text-slate-600">{steps[step].desc}</p>
          </div>

          {/* Step Content */}
          {step === 0 && (
            <div className="text-center">
              <p className="text-sm text-slate-600 mb-6">Este assistente vai te ajudar a configurar os itens essenciais para comecar a receber agendamentos.</p>
              <button onClick={() => setStep(1)} className="btn-primary w-full flex items-center justify-center gap-2" data-testid="onboarding-start-btn">
                Comecar <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3">
              <input value={serviceForm.name} onChange={e => setServiceForm({...serviceForm, name: e.target.value})} placeholder="Nome do servico (ex: Corte de Cabelo)" className="input-field" data-testid="onboarding-service-name" />
              <div className="grid grid-cols-2 gap-3">
                <input type="number" value={serviceForm.price} onChange={e => setServiceForm({...serviceForm, price: e.target.value})} placeholder="Preco (R$)" className="input-field" data-testid="onboarding-service-price" />
                <input type="number" value={serviceForm.duration} onChange={e => setServiceForm({...serviceForm, duration: e.target.value})} placeholder="Duracao (min)" className="input-field" data-testid="onboarding-service-duration" />
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={() => setStep(2)} className="btn-secondary flex-1 text-sm">Pular</button>
                <button onClick={handleCreateService} className="btn-primary flex-1 text-sm" data-testid="onboarding-save-service">Criar e Continuar</button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <input value={profForm.name} onChange={e => setProfForm({...profForm, name: e.target.value})} placeholder="Nome do profissional" className="input-field" data-testid="onboarding-prof-name" />
              <input value={profForm.phone} onChange={e => setProfForm({...profForm, phone: e.target.value})} placeholder="Telefone" className="input-field" />
              <div className="flex gap-2 mt-4">
                <button onClick={() => setStep(3)} className="btn-secondary flex-1 text-sm">Pular</button>
                <button onClick={handleCreateProfessional} className="btn-primary flex-1 text-sm" data-testid="onboarding-save-prof">Criar e Continuar</button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="text-center">
              <div className="bg-emerald-50 rounded-xl p-4 mb-4">
                <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-2" />
                <p className="text-sm font-medium text-emerald-800">Configuracao concluida!</p>
              </div>
              <button onClick={onClose} className="btn-primary w-full" data-testid="onboarding-finish-btn">Ir para o Dashboard</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CompanyDashboard;
