import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { crmAPI, schedulingAPI, uploadAPI, reportsAPI, notificationsAPI, channelsAPI } from '../../services/api';
import { toast } from 'sonner';
import {
  LogOut, LayoutDashboard, Headphones, Zap, Columns3, Users, Tag,
  MessageSquare, Megaphone, GitBranch, Info, Code, UserCog, Bot, Link,
  Sparkles, Calendar, CalendarCheck, UserCheck, FolderOpen, Scissors,
  CreditCard, Briefcase, DollarSign, PieChart, Globe, Bell, Settings,
  Puzzle, BarChart3, LifeBuoy, Plus, Search, Pencil, Trash2, X, Check,
  ChevronLeft, ChevronRight, Phone, Mail, Clock, Upload, Image, GripVertical, ArrowRight, CheckCircle2, Circle, Monitor, Send
} from 'lucide-react';
import FlowBuilderPage from '../CRM/FlowBuilderPage';
import AtendimentosPage from '../CRM/AtendimentosPage';
import WhatsAppConnectionsPage from '../CRM/WhatsAppConnectionsPage';
import { ProfessionalsPageFull, ServicesPageFull, SubscriptionsPageFull, CalendarPageFull } from '../Scheduling/SchedulingPages';

const ICON_MAP = {
  LayoutDashboard, Headphones, Zap, Columns3, Users, Tag, MessageSquare,
  Megaphone, GitBranch, Info, Code, UserCog, Bot, Link, Sparkles, Calendar,
  CalendarCheck, UserCheck, FolderOpen, Scissors, CreditCard, Briefcase,
  DollarSign, PieChart, Globe, Bell, Settings, Puzzle, BarChart3, LifeBuoy, Monitor
};

const FEATURE_META = {
  dashboard:          { icon: 'LayoutDashboard', label: 'Dashboard', group: 'Principal' },
  atendimentos:       { icon: 'Headphones',      label: 'Atendimentos', group: 'CRM' },
  respostas_rapidas:  { icon: 'Zap',             label: 'Respostas Rapidas', group: 'CRM' },
  kanban:             { icon: 'Columns3',         label: 'Kanban', group: 'CRM' },
  contatos:           { icon: 'Users',            label: 'Clientes / Leads', group: 'CRM' },
  tags:               { icon: 'Tag',              label: 'Tags', group: 'CRM' },
  chat_interno:       { icon: 'MessageSquare',    label: 'Chat Interno', group: 'CRM' },
  chat_interno:       { icon: 'MessageSquare',    label: 'Chat Interno', group: 'Operacional' },
  campanhas:          { icon: 'Megaphone',        label: 'Campanhas', group: 'CRM' },
  flowbuilder:        { icon: 'GitBranch',        label: 'Flowbuilder', group: 'CRM' },
  informativos:       { icon: 'Info',             label: 'Informativos', group: 'CRM' },
  api:                { icon: 'Code',             label: 'API', group: 'Administracao' },
  usuarios:           { icon: 'UserCog',          label: 'Usuarios', group: 'Administracao' },
  filas_chatbot:      { icon: 'Bot',              label: 'Filas & Chatbot', group: 'CRM' },
  conexoes:           { icon: 'Link',             label: 'Conexoes', group: 'Config Empresa' },
  agente_ia:          { icon: 'Sparkles',         label: 'Agente IA', group: 'CRM' },
  calendario:         { icon: 'Calendar',         label: 'Calendario', group: 'Operacional' },
  agenda:             { icon: 'CalendarCheck',    label: 'Agenda', group: 'Operacional' },
  agendamentos:       { icon: 'Clock',            label: 'Agendamento Msg', group: 'Operacional' },
  clientes:           { icon: 'UserCheck',        label: 'Clientes / Leads', group: 'Operacional' },
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
  indoor:             { icon: 'Monitor',          label: 'Indoor / TV', group: 'Config Empresa' },
};

const CompanyDashboard = () => {
  const { user, logout } = useAuth();
  const [activePage, setActivePage] = useState('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
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
      {/* Mobile overlay */}
      {mobileSidebarOpen && <div className="fixed inset-0 bg-slate-900/50 z-30 lg:hidden" onClick={() => setMobileSidebarOpen(false)} />}

      {/* Sidebar */}
      <aside className={`${sidebarCollapsed ? 'w-16' : 'w-60'} bg-white border-r border-slate-200 flex flex-col fixed h-full z-40 transition-all duration-200 ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
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
                    onClick={() => { setActivePage(item.key); setMobileSidebarOpen(false); }}
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
      <main className={`flex-1 ${sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-60'} transition-all duration-200`}>
        <header className="glass border-b border-slate-200 sticky top-0 z-30 px-4 lg:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileSidebarOpen(true)} className="lg:hidden p-2 rounded-lg hover:bg-slate-100" data-testid="mobile-menu-btn">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
            <h2 className="text-lg font-bold font-heading text-slate-900">
              {FEATURE_META[activePage]?.label || 'Dashboard'}
            </h2>
          </div>
          <UserHeaderMenu user={user} logout={logout} />
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
    case 'conexoes': return <ConexoesPage />;
    case 'chat_interno': return <ChatInternoPage />;
    case 'calendario': return <CalendarPageFull />;
    case 'agenda': return <AgendaPage />;
    case 'agendamentos': return <MessageSchedulingPage />;
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
    case 'indoor': return <IndoorSettingsPage />;
    default: return <PlaceholderPage title={FEATURE_META[page]?.label || page} />;
  }
};

/* ========== USER HEADER MENU ========== */
const UserHeaderMenu = ({ user, logout }) => {
  const [open, setOpen] = useState(false);
  const [showSuspend, setShowSuspend] = useState(false);
  const [suspendForm, setSuspendForm] = useState({ start_date: '', end_date: '', reason: '' });

  const handleSuspend = async () => {
    if (!suspendForm.start_date || !suspendForm.end_date) { toast.error('Informe as datas'); return; }
    try {
      // If the user is a professional, suspend their agenda
      const profs = await schedulingAPI.getProfessionals();
      const myProf = profs.data.find(p => p.email === user?.email || p.name === user?.name);
      if (myProf) {
        await schedulingAPI.addSuspension(myProf.id, suspendForm);
        toast.success('Agenda suspensa!');
      } else {
        toast.error('Profissional nao encontrado');
      }
      setShowSuspend(false);
      setSuspendForm({ start_date: '', end_date: '', reason: '' });
    } catch (e) { toast.error('Erro ao suspender'); }
  };

  return (
    <>
      <div className="relative">
        <button onClick={() => setOpen(!open)} className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors" data-testid="user-menu-btn">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
            {user?.name?.[0]?.toUpperCase() || 'U'}
          </div>
          <div className="text-left hidden sm:block">
            <p className="text-sm font-medium text-slate-900 leading-tight">{user?.name}</p>
            <p className="text-[10px] text-slate-500">{user?.company?.name}</p>
          </div>
          <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-xl shadow-xl border border-slate-200 py-2 z-50" data-testid="user-dropdown">
              <div className="px-4 py-2 border-b border-slate-100">
                <p className="text-sm font-medium text-slate-900">{user?.name}</p>
                <p className="text-xs text-slate-500">{user?.email}</p>
              </div>
              <button onClick={() => { setShowSuspend(true); setOpen(false); }} className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2" data-testid="suspend-agenda-btn">
                <Calendar className="w-4 h-4 text-amber-500" /> Suspender Minha Agenda
              </button>
              <button onClick={() => { logout(); setOpen(false); }} className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2" data-testid="header-logout-btn">
                <LogOut className="w-4 h-4" /> Sair
              </button>
            </div>
          </>
        )}
      </div>

      {showSuspend && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowSuspend(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-200">
              <h3 className="text-lg font-bold font-heading">Suspender Agenda</h3>
              <p className="text-xs text-slate-500">Informe o periodo de folga ou ausencia</p>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-slate-700">Inicio</label>
                  <input type="date" value={suspendForm.start_date} onChange={e => setSuspendForm({...suspendForm, start_date: e.target.value})} className="input-field text-sm" data-testid="suspend-start" /></div>
                <div><label className="text-xs font-medium text-slate-700">Fim</label>
                  <input type="date" value={suspendForm.end_date} onChange={e => setSuspendForm({...suspendForm, end_date: e.target.value})} className="input-field text-sm" data-testid="suspend-end" /></div>
              </div>
              <div><label className="text-xs font-medium text-slate-700">Motivo</label>
                <input value={suspendForm.reason} onChange={e => setSuspendForm({...suspendForm, reason: e.target.value})} placeholder="Ex: Ferias" className="input-field text-sm" /></div>
            </div>
            <div className="flex gap-2 p-5 border-t border-slate-200">
              <button onClick={() => setShowSuspend(false)} className="btn-secondary flex-1 text-sm">Cancelar</button>
              <button onClick={handleSuspend} className="btn-primary flex-1 text-sm" data-testid="confirm-suspend-btn">Suspender</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
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
  const [editingClient, setEditingClient] = useState(null);
  const [selectedClient, setSelectedClient] = useState(null);
  const [clientHistory, setClientHistory] = useState([]);
  const [showBooking, setShowBooking] = useState(false);
  const [services, setServices] = useState([]);
  const [professionals, setProfessionals] = useState([]);

  useEffect(() => { load(); }, [search]);
  useEffect(() => {
    schedulingAPI.getServices().then(r => setServices(r.data)).catch(() => {});
    schedulingAPI.getProfessionals().then(r => setProfessionals(r.data)).catch(() => {});
  }, []);

  const load = async () => {
    const res = await schedulingAPI.getClients({ search: search || undefined });
    setClients(res.data);
  };

  const loadHistory = async (phone) => {
    const res = await schedulingAPI.getAppointments();
    setClientHistory(res.data.filter(a => a.customer_phone === phone).sort((a,b) => b.date.localeCompare(a.date)));
  };

  const handleSelectClient = (client) => { setSelectedClient(client); loadHistory(client.phone); };

  const handleSaveClient = async (form) => {
    try {
      if (editingClient) {
        await schedulingAPI.updateClient(editingClient.id, form);
        toast.success('Cliente atualizado!');
      } else {
        await schedulingAPI.createClient(form);
        toast.success('Cliente criado!');
      }
      setShowAdd(false); setEditingClient(null); load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Erro'); }
  };

  const handleDeleteClient = async (id) => {
    if (!window.confirm('Excluir este cliente?')) return;
    try { await schedulingAPI.deleteClient(id); toast.success('Excluido!'); setSelectedClient(null); load(); }
    catch (e) { toast.error('Erro ao excluir'); }
  };

  const handleBookFromClient = async (bookForm) => {
    try {
      await schedulingAPI.createAppointment({
        customer_name: selectedClient.name,
        customer_phone: selectedClient.phone,
        customer_email: selectedClient.email || undefined,
        ...bookForm
      });
      toast.success('Agendamento criado!');
      setShowBooking(false);
      loadHistory(selectedClient.phone);
    } catch (e) { toast.error(e.response?.data?.detail || 'Erro ao agendar'); }
  };

  const STATUS_COLORS = { confirmado: 'bg-emerald-100 text-emerald-700', pendente: 'bg-amber-100 text-amber-700', cancelado: 'bg-red-100 text-red-700', concluido: 'bg-blue-100 text-blue-700' };

  return (
    <div className="animate-fade-in" data-testid="clients-page">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-bold font-heading text-slate-900">Clientes</h2>
          <p className="text-sm text-slate-600">{clients.length} clientes cadastrados</p>
        </div>
        <button onClick={() => { setEditingClient(null); setShowAdd(true); }} className="btn-primary flex items-center gap-2" data-testid="add-client-btn">
          <Plus className="w-4 h-4" /> Novo Cliente
        </button>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nome ou telefone..." className="input-field pl-10" data-testid="client-search" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-2">
          {clients.map(c => (
            <div key={c.id} onClick={() => handleSelectClient(c)}
              className={`card !p-4 cursor-pointer transition-all hover:shadow-sm ${selectedClient?.id === c.id ? 'ring-2 ring-primary/50 bg-primary/5' : ''}`}
              data-testid={`client-row-${c.id}`}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/20 to-primary/40 flex items-center justify-center text-primary font-bold text-sm flex-shrink-0">
                  {c.name?.substring(0,2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">{c.name}</p>
                  <p className="text-xs text-slate-500">{c.phone} {c.email ? `• ${c.email}` : ''}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-slate-500">{c.total_appointments || 0} agend.</p>
                  {c.active_subscription && <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Assinante</span>}
                </div>
              </div>
            </div>
          ))}
          {clients.length === 0 && <div className="card text-center py-12"><Users className="w-12 h-12 text-slate-300 mx-auto mb-3" /><p className="text-sm text-slate-500">Nenhum cliente encontrado</p></div>}
        </div>

        <div>
          {selectedClient ? (
            <div className="card sticky top-20" data-testid="client-detail">
              <div className="text-center mb-4">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-primary/40 flex items-center justify-center text-primary text-xl font-bold mx-auto mb-3">
                  {selectedClient.name?.substring(0,2).toUpperCase()}
                </div>
                <p className="font-bold text-slate-900 text-lg">{selectedClient.name}</p>
                <p className="text-sm text-slate-500">{selectedClient.phone}</p>
                {selectedClient.email && <p className="text-xs text-slate-400">{selectedClient.email}</p>}
              </div>

              <div className="flex gap-2 mb-4">
                <button onClick={() => setShowBooking(true)} className="btn-primary flex-1 text-sm flex items-center justify-center gap-1" data-testid="book-from-client-btn">
                  <Calendar className="w-4 h-4" /> Agendar
                </button>
                <button onClick={() => { setEditingClient(selectedClient); setShowAdd(true); }} className="btn-secondary text-sm p-2" data-testid="edit-client-btn">
                  <Pencil className="w-4 h-4" />
                </button>
                <button onClick={() => handleDeleteClient(selectedClient.id)} className="p-2 rounded-lg border border-red-200 text-red-500 hover:bg-red-50" data-testid="delete-client-btn">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {selectedClient.notes && <p className="text-xs text-slate-600 bg-slate-50 p-2 rounded-lg mb-4">{selectedClient.notes}</p>}

              <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Historico de Agendamentos</h4>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {clientHistory.map(a => (
                  <div key={a.id} className="p-3 bg-slate-50 rounded-lg">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-primary">{a.date?.split('-').reverse().join('/')} {a.time}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[a.status] || 'bg-slate-100 text-slate-600'}`}>{a.status}</span>
                    </div>
                    <p className="text-xs font-medium text-slate-900">{a.service_name}</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[11px] text-slate-500">{a.professional_name}</span>
                      <span className="text-xs font-medium">R$ {(a.price || 0).toFixed(2)}</span>
                    </div>
                    {a.payment_method && <span className="text-[10px] text-slate-400 mt-0.5 block">Pago: {a.payment_method}</span>}
                  </div>
                ))}
                {clientHistory.length === 0 && <p className="text-xs text-slate-400 text-center py-6">Sem historico</p>}
              </div>
            </div>
          ) : (
            <div className="card text-center py-12"><UserCheck className="w-10 h-10 text-slate-300 mx-auto mb-2" /><p className="text-sm text-slate-500">Selecione um cliente</p></div>
          )}
        </div>
      </div>

      {/* Add/Edit Client Modal */}
      {showAdd && (
        <Modal title={editingClient ? 'Editar Cliente' : 'Novo Cliente'} onClose={() => { setShowAdd(false); setEditingClient(null); }}>
          <ClientForm client={editingClient} onSave={handleSaveClient} />
        </Modal>
      )}

      {/* Book from Client Modal */}
      {showBooking && selectedClient && (
        <Modal title={`Agendar para ${selectedClient.name}`} onClose={() => setShowBooking(false)}>
          <BookFromClientForm services={services} professionals={professionals} onSave={handleBookFromClient} />
        </Modal>
      )}
    </div>
  );
};

const ClientForm = ({ client, onSave }) => {
  const [form, setForm] = useState({ name: client?.name || '', phone: client?.phone || '', email: client?.email || '', notes: client?.notes || '' });
  return (
    <div className="space-y-3">
      <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Nome completo" className="input-field" data-testid="client-name-input" />
      <input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} placeholder="Telefone" className="input-field" data-testid="client-phone-input" />
      <input value={form.email} onChange={e => setForm({...form, email: e.target.value})} placeholder="Email (opcional)" className="input-field" type="email" />
      <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} placeholder="Observacoes" className="input-field" rows={2} />
      <div className="flex justify-end"><button onClick={() => form.name && form.phone && onSave(form)} className="btn-primary text-sm" data-testid="save-client-btn">Salvar</button></div>
    </div>
  );
};

const BookFromClientForm = ({ services, professionals, onSave }) => {
  const [form, setForm] = useState({ service_id: '', professional_id: '', date: '', time: '' });
  return (
    <div className="space-y-3">
      <div>
        <label className="text-sm font-medium text-slate-700 mb-1 block">Servico</label>
        <select value={form.service_id} onChange={e => setForm({...form, service_id: e.target.value})} className="input-field" data-testid="book-service-select">
          <option value="">Selecione...</option>
          {services.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name} - R$ {s.price?.toFixed(2)}</option>)}
        </select>
      </div>
      <div>
        <label className="text-sm font-medium text-slate-700 mb-1 block">Profissional</label>
        <select value={form.professional_id} onChange={e => setForm({...form, professional_id: e.target.value})} className="input-field" data-testid="book-prof-select">
          <option value="">Selecione...</option>
          {professionals.filter(p => p.is_active).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-sm font-medium text-slate-700 mb-1 block">Data</label>
          <input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} className="input-field" data-testid="book-date-input" /></div>
        <div><label className="text-sm font-medium text-slate-700 mb-1 block">Hora</label>
          <input type="time" value={form.time} onChange={e => setForm({...form, time: e.target.value})} className="input-field" data-testid="book-time-input" /></div>
      </div>
      <div className="flex justify-end">
        <button onClick={() => form.service_id && form.professional_id && form.date && form.time && onSave(form)} className="btn-primary text-sm" data-testid="confirm-book-btn">Confirmar Agendamento</button>
      </div>
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
          <div key={`msg-${i}-${m.role}`} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
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
                    <div key={`qr-${i}`} className={`w-4 h-4 rounded-sm ${Math.random() > 0.5 ? 'bg-slate-800' : 'bg-white'}`} />
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

/* ========== AGENDA PAGE (Appointment List with Conclude/Payment) ========== */
const PAYMENT_METHODS = [{key:'dinheiro',label:'Dinheiro'},{key:'pix',label:'PIX'},{key:'cartao_credito',label:'Credito'},{key:'cartao_debito',label:'Debito'}];
const APT_STATUS_COLORS = { confirmado: 'bg-emerald-100 text-emerald-700', pendente: 'bg-amber-100 text-amber-700', cancelado: 'bg-red-100 text-red-700', concluido: 'bg-blue-100 text-blue-700' };
const APT_STATUS_DOT = { confirmado: 'bg-emerald-500', pendente: 'bg-amber-500', cancelado: 'bg-red-500', concluido: 'bg-blue-500' };

const AgendaPage = () => {
  const [appointments, setAppointments] = useState([]);
  const [filter, setFilter] = useState('hoje');
  const [concludeApt, setConcludeApt] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState('');

  const today = new Date().toISOString().split('T')[0];

  useEffect(() => { load(); }, []);
  const load = async () => { const r = await schedulingAPI.getAppointments(); setAppointments(r.data); };

  const filtered = appointments.filter(a => {
    if (filter === 'hoje') return a.date === today;
    if (filter === 'pendentes') return a.status === 'pendente';
    if (filter === 'confirmados') return a.status === 'confirmado';
    if (filter === 'concluidos') return a.status === 'concluido';
    return true;
  }).sort((a,b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

  const handleStatusChange = async (id, status) => {
    try { await schedulingAPI.updateAppointment(id, { status }); toast.success('Status atualizado!'); load(); }
    catch (e) { toast.error('Erro'); }
  };

  const handleConclude = async () => {
    if (!paymentMethod) { toast.error('Selecione pagamento'); return; }
    try {
      await schedulingAPI.concludeAppointment(concludeApt.id, { payment_method: paymentMethod });
      toast.success('Concluido!');
      setConcludeApt(null); setPaymentMethod(''); load();
    } catch (e) { toast.error('Erro ao concluir'); }
  };

  const todayCount = appointments.filter(a => a.date === today).length;
  const pendingCount = appointments.filter(a => a.status === 'pendente').length;

  return (
    <div className="animate-fade-in" data-testid="agenda-page">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-bold font-heading text-slate-900">Agenda</h2>
          <p className="text-sm text-slate-600">{todayCount} hoje • {pendingCount} pendentes</p>
        </div>
      </div>

      <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
        {[{key:'hoje',label:'Hoje'},{key:'pendentes',label:'Pendentes'},{key:'confirmados',label:'Confirmados'},{key:'concluidos',label:'Concluidos'},{key:'todos',label:'Todos'}].map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${filter===f.key ? 'bg-primary text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            data-testid={`filter-${f.key}`}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {filtered.map(a => (
          <div key={a.id} className="card !p-4" data-testid={`agenda-item-${a.id}`}>
            <div className="flex items-center gap-4">
              <div className={`w-1.5 h-12 rounded-full flex-shrink-0 ${APT_STATUS_DOT[a.status] || 'bg-slate-300'}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-bold text-primary tabular-nums">{a.time}</span>
                  <span className="text-xs text-slate-400">{a.date?.split('-').reverse().join('/')}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${APT_STATUS_COLORS[a.status] || 'bg-slate-100 text-slate-600'}`}>{a.status}</span>
                </div>
                <p className="text-sm font-semibold text-slate-900 truncate">{a.customer_name}</p>
                <p className="text-xs text-slate-500">{a.service_name} • {a.professional_name} • R$ {(a.price||0).toFixed(2)}</p>
                {a.payment_method && <p className="text-[10px] text-slate-400 mt-0.5">Pago: {a.payment_method}</p>}
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {a.status === 'pendente' && (
                  <button onClick={() => handleStatusChange(a.id, 'confirmado')} className="px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-700 text-xs font-medium hover:bg-emerald-200" data-testid={`agenda-confirm-${a.id}`}>Confirmar</button>
                )}
                {a.status === 'confirmado' && (
                  <button onClick={() => setConcludeApt(a)} className="px-3 py-1.5 rounded-lg bg-blue-100 text-blue-700 text-xs font-medium hover:bg-blue-200" data-testid={`agenda-conclude-${a.id}`}>Concluir</button>
                )}
                {a.status !== 'cancelado' && a.status !== 'concluido' && (
                  <button onClick={() => handleStatusChange(a.id, 'cancelado')} className="px-2 py-1.5 rounded-lg text-red-500 hover:bg-red-50" data-testid={`agenda-cancel-${a.id}`}>
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <div className="card text-center py-12"><CalendarCheck className="w-12 h-12 text-slate-300 mx-auto mb-3" /><p className="text-sm text-slate-500">Nenhum agendamento</p></div>}
      </div>

      {/* Conclude Payment Modal */}
      {concludeApt && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setConcludeApt(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-200">
              <h3 className="text-lg font-bold font-heading">Concluir Atendimento</h3>
              <p className="text-sm text-slate-500">{concludeApt.customer_name} - {concludeApt.service_name}</p>
            </div>
            <div className="p-5 space-y-4">
              <div className="text-center">
                <p className="text-3xl font-bold text-primary">R$ {(concludeApt.price || 0).toFixed(2)}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 mb-2 block">Forma de Pagamento</label>
                <div className="grid grid-cols-2 gap-2">
                  {PAYMENT_METHODS.map(m => (
                    <button key={m.key} onClick={() => setPaymentMethod(m.key)}
                      className={`p-3 rounded-xl border-2 text-sm font-medium transition-all ${paymentMethod === m.key ? 'border-primary bg-primary/10 text-primary' : 'border-slate-200 text-slate-600'}`}
                      data-testid={`agenda-payment-${m.key}`}>
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2 p-5 border-t border-slate-200">
              <button onClick={() => setConcludeApt(null)} className="btn-secondary flex-1 text-sm">Cancelar</button>
              <button onClick={handleConclude} disabled={!paymentMethod} className="btn-primary flex-1 text-sm" data-testid="agenda-confirm-conclude-btn">Concluir</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


const MessageSchedulingPage = () => {
  const [messages, setMessages] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ recipient: '', channel: 'whatsapp', message: '', scheduled_at: '' });
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadMessages(); }, []);
  const loadMessages = async () => {
    try { const r = await channelsAPI.getScheduledMessages(); setMessages(r.data); }
    catch (e) {} finally { setLoading(false); }
  };

  const handleSave = async () => {
    if (!form.recipient || !form.message || !form.scheduled_at) { toast.error('Preencha todos os campos'); return; }
    try {
      await channelsAPI.createScheduledMessage(form);
      setShowModal(false);
      setForm({ recipient: '', channel: 'whatsapp', message: '', scheduled_at: '' });
      loadMessages();
      toast.success('Mensagem agendada!');
    } catch (e) { toast.error('Erro ao agendar'); }
  };

  const handleCancel = async (id) => {
    try {
      await channelsAPI.updateScheduledMessage(id, { status: 'cancelada' });
      loadMessages(); toast.success('Cancelada!');
    } catch (e) { toast.error('Erro ao cancelar'); }
  };

  return (
    <div className="animate-fade-in" data-testid="message-scheduling-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold font-heading text-slate-900">Agendamento de Mensagens</h2>
          <p className="text-sm text-slate-600">Agende envios de mensagens via WhatsApp e outros canais</p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2" data-testid="new-msg-schedule-btn">
          <Plus className="w-4 h-4" /> Agendar Mensagem
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="card !p-4"><p className="text-xs text-slate-500 mb-1">Total</p><p className="text-xl font-bold font-heading">{messages.length}</p></div>
        <div className="card !p-4"><p className="text-xs text-slate-500 mb-1">Pendentes</p><p className="text-xl font-bold font-heading text-amber-600">{messages.filter(m => m.status === 'pendente').length}</p></div>
        <div className="card !p-4"><p className="text-xs text-slate-500 mb-1">Enviadas</p><p className="text-xl font-bold font-heading text-emerald-600">{messages.filter(m => m.status === 'enviada').length}</p></div>
        <div className="card !p-4"><p className="text-xs text-slate-500 mb-1">Canceladas</p><p className="text-xl font-bold font-heading text-red-600">{messages.filter(m => m.status === 'cancelada').length}</p></div>
      </div>

      <div className="card">
        {messages.length === 0 ? (
          <div className="text-center py-16">
            <CalendarCheck className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 text-sm">Nenhuma mensagem agendada</p>
            <p className="text-slate-400 text-xs mt-1">Clique em "Agendar Mensagem" para comecar</p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map(msg => (
              <div key={msg.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${msg.channel === 'whatsapp' ? 'bg-emerald-100 text-emerald-600' : 'bg-blue-100 text-blue-600'}`}>
                    <Phone className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{msg.recipient}</p>
                    <p className="text-xs text-slate-500 truncate">{msg.message}</p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0 ml-3">
                  <p className="text-xs font-medium text-primary">{new Date(msg.scheduled_at).toLocaleString('pt-BR')}</p>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${msg.status === 'pendente' ? 'bg-amber-100 text-amber-700' : msg.status === 'enviada' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{msg.status}</span>
                  {msg.status === 'pendente' && (
                    <button onClick={() => handleCancel(msg.id)} className="block text-[10px] text-red-500 hover:text-red-700 mt-1 font-medium">Cancelar</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h3 className="text-lg font-bold font-heading">Agendar Mensagem</h3>
              <button onClick={() => setShowModal(false)} className="p-1 rounded hover:bg-slate-100"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div><label className="text-sm font-medium text-slate-700 mb-1 block">Destinatario (telefone)</label>
                <input value={form.recipient} onChange={e => setForm({...form, recipient: e.target.value})} placeholder="(62) 99999-0000" className="input-field" data-testid="msg-recipient" /></div>
              <div><label className="text-sm font-medium text-slate-700 mb-1 block">Canal</label>
                <select value={form.channel} onChange={e => setForm({...form, channel: e.target.value})} className="input-field">
                  <option value="whatsapp">WhatsApp</option>
                  <option value="sms">SMS</option>
                  <option value="email">Email</option>
                </select></div>
              <div><label className="text-sm font-medium text-slate-700 mb-1 block">Mensagem</label>
                <textarea value={form.message} onChange={e => setForm({...form, message: e.target.value})} rows={3} className="input-field" placeholder="Digite a mensagem..." data-testid="msg-content" /></div>
              <div><label className="text-sm font-medium text-slate-700 mb-1 block">Data/Hora do Envio</label>
                <input type="datetime-local" value={form.scheduled_at} onChange={e => setForm({...form, scheduled_at: e.target.value})} className="input-field" data-testid="msg-schedule-date" /></div>
            </div>
            <div className="flex justify-end gap-2 p-5 border-t border-slate-200">
              <button onClick={() => setShowModal(false)} className="btn-secondary text-sm">Cancelar</button>
              <button onClick={handleSave} className="btn-primary text-sm" data-testid="save-msg-schedule-btn">Agendar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ========== CALENDAR ========== */

/* ========== CHAT INTERNO ========== */
const ChatInternoPage = () => {
  const { user } = useAuth();
  const [channels, setChannels] = useState([]);
  const [activeChannel, setActiveChannel] = useState('general');
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    channelsAPI.getChatChannels().then(r => setChannels(r.data)).catch(() => {});
    loadMessages();
  }, []);

  useEffect(() => { loadMessages(); }, [activeChannel]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const loadMessages = async () => {
    setLoading(true);
    try { const r = await channelsAPI.getChatMessages({ channel_id: activeChannel, limit: 50 }); setMessages(r.data); }
    catch (e) {} finally { setLoading(false); }
  };

  const sendMessage = async () => {
    if (!newMessage.trim()) return;
    try {
      await channelsAPI.sendChatMessage({ content: newMessage, channel_id: activeChannel });
      setNewMessage('');
      loadMessages();
    } catch (e) { toast.error('Erro ao enviar'); }
  };

  // Poll for new messages every 5s
  useEffect(() => {
    const interval = setInterval(loadMessages, 5000);
    return () => clearInterval(interval);
  }, [activeChannel]);

  return (
    <div className="animate-fade-in h-[calc(100vh-120px)] flex flex-col" data-testid="chat-interno-page">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold font-heading text-slate-900">Chat Interno</h2>
          <p className="text-sm text-slate-600">Comunicacao da equipe</p>
        </div>
      </div>

      <div className="flex-1 flex gap-4 min-h-0">
        {/* Channels sidebar */}
        <div className="w-48 bg-white rounded-xl border border-slate-200 p-3 flex-shrink-0 hidden lg:block">
          <p className="text-[10px] font-bold uppercase text-slate-400 tracking-widest mb-2 px-2">Canais</p>
          {channels.map(ch => (
            <button key={ch.id} onClick={() => setActiveChannel(ch.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${activeChannel === ch.id ? 'bg-primary/10 text-primary font-medium' : 'text-slate-600 hover:bg-slate-50'}`}
              data-testid={`chat-channel-${ch.id}`}>
              # {ch.name}
            </button>
          ))}
        </div>

        {/* Messages area */}
        <div className="flex-1 bg-white rounded-xl border border-slate-200 flex flex-col min-h-0">
          <div className="px-5 py-3 border-b border-slate-200">
            <p className="text-sm font-semibold text-slate-900"># {channels.find(c => c.id === activeChannel)?.name || 'Geral'}</p>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {loading && messages.length === 0 && <p className="text-sm text-slate-400 text-center py-8">Carregando...</p>}
            {!loading && messages.length === 0 && <p className="text-sm text-slate-400 text-center py-8">Nenhuma mensagem ainda. Comece uma conversa!</p>}
            {messages.map(msg => {
              const isMe = msg.sender_id === user?.id;
              return (
                <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`} data-testid={`chat-msg-${msg.id}`}>
                  <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${isMe ? 'bg-primary text-white rounded-br-md' : 'bg-slate-100 text-slate-900 rounded-bl-md'}`}>
                    {!isMe && <p className="text-[10px] font-bold mb-0.5 opacity-70">{msg.sender_name}</p>}
                    <p className="text-sm leading-relaxed">{msg.content}</p>
                    <p className={`text-[10px] mt-1 ${isMe ? 'text-white/60' : 'text-slate-400'}`}>
                      {new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          <div className="px-4 py-3 border-t border-slate-200">
            <div className="flex items-center gap-2">
              <input value={newMessage} onChange={e => setNewMessage(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendMessage())}
                placeholder="Digite uma mensagem..."
                className="flex-1 input-field" data-testid="chat-input" />
              <button onClick={sendMessage} disabled={!newMessage.trim()}
                className="btn-primary p-2.5 rounded-lg" data-testid="chat-send-btn">
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

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


/* ========== CONEXOES PAGE (Connections + Message Templates) ========== */
const PROCESS_TYPES = [
  { key: 'confirmacao', label: 'Confirmacao de Agendamento', desc: 'Enviada ao confirmar um agendamento' },
  { key: 'lembrete', label: 'Lembrete', desc: 'Enviada antes do horario agendado' },
  { key: 'cancelamento', label: 'Cancelamento', desc: 'Enviada ao cancelar um agendamento' },
  { key: 'boas_vindas', label: 'Boas-vindas', desc: 'Enviada para novos clientes' },
  { key: 'pos_atendimento', label: 'Pos-Atendimento', desc: 'Enviada apos o atendimento' },
  { key: 'aniversario', label: 'Aniversario', desc: 'Mensagem de aniversario' },
];

const VARIABLES = ['{nome}', '{servico}', '{data}', '{hora}', '{profissional}', '{empresa}', '{valor}'];

const ConexoesPage = () => {
  const [tab, setTab] = useState('conexoes');
  const [connections, setConnections] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);
  const loadData = async () => {
    setLoading(true);
    try {
      const [conns, tmpls] = await Promise.all([channelsAPI.getConnections(), channelsAPI.getTemplates()]);
      setConnections(conns.data);
      const merged = PROCESS_TYPES.map(p => {
        const saved = tmpls.data.find(t => t.process_key === p.key);
        return saved ? { ...p, ...saved } : { ...p, message: '', active: false };
      });
      setTemplates(merged);
    } catch (e) { toast.error('Erro ao carregar dados'); }
    finally { setLoading(false); }
  };

  const handleConnect = async (connId) => {
    try { await channelsAPI.connectChannel(connId); loadData(); toast.success('Conectando...'); }
    catch (e) { toast.error('Erro ao conectar'); }
  };

  const handleDisconnect = async (connId) => {
    try { await channelsAPI.disconnectChannel(connId); loadData(); toast.success('Desconectado!'); }
    catch (e) { toast.error('Erro ao desconectar'); }
  };

  const addConnection = async (type) => {
    const name = type === 'whatsapp' ? 'WhatsApp' : 'Instagram';
    try {
      await channelsAPI.createConnection({ name: `${name} ${connections.length + 1}`, type });
      loadData(); toast.success('Conexao adicionada!');
    } catch (e) { toast.error('Erro ao criar conexao'); }
  };

  const removeConnection = async (connId) => {
    try { await channelsAPI.deleteConnection(connId); loadData(); toast.success('Removida!'); }
    catch (e) { toast.error('Erro ao remover'); }
  };

  const saveTemplate = async (key, message, active) => {
    const tmpl = PROCESS_TYPES.find(p => p.key === key);
    try {
      await channelsAPI.createTemplate({ process_key: key, label: tmpl.label, description: tmpl.desc, message, active });
      loadData(); setEditingTemplate(null); toast.success('Modelo salvo!');
    } catch (e) { toast.error('Erro ao salvar'); }
  };

  return (
    <div className="animate-fade-in" data-testid="conexoes-page">
      <h2 className="text-2xl font-bold font-heading text-slate-900 mb-1">Conexoes</h2>
      <p className="text-sm text-slate-600 mb-6">Gerencie canais de comunicacao e mensagens automaticas</p>

      <div className="flex items-center gap-2 bg-slate-100 rounded-lg p-1 mb-6 w-fit">
        <button onClick={() => setTab('conexoes')} className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${tab==='conexoes'?'bg-white text-slate-900 shadow-sm':'text-slate-500'}`} data-testid="tab-conexoes">Canais</button>
        <button onClick={() => setTab('templates')} className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${tab==='templates'?'bg-white text-slate-900 shadow-sm':'text-slate-500'}`} data-testid="tab-templates">Mensagens Modelo</button>
      </div>

      {tab === 'conexoes' && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <button onClick={() => addConnection('whatsapp')} className="btn-primary text-sm flex items-center gap-2" data-testid="add-whatsapp-btn">
              <Plus className="w-4 h-4" /> WhatsApp
            </button>
            <button onClick={() => addConnection('instagram')} className="btn-secondary text-sm flex items-center gap-2" data-testid="add-instagram-btn">
              <Plus className="w-4 h-4" /> Instagram
            </button>
          </div>
          <div className="space-y-3">
            {connections.map(conn => (
              <ConnectionCard key={conn.id} conn={conn} onConnect={handleConnect} onDisconnect={handleDisconnect} onRemove={removeConnection} onRefresh={loadData} />
            ))}
          </div>
        </div>
      )}

      {tab === 'templates' && (
        <div>
          <p className="text-xs text-slate-500 mb-3">
            Variaveis disponiveis: {VARIABLES.map(v => <code key={v} className="mx-0.5 px-1.5 py-0.5 bg-slate-100 rounded text-primary text-[10px] font-mono">{v}</code>)}
          </p>
          <div className="space-y-3">
            {templates.map(tmpl => (
              <div key={tmpl.key} className="card !p-5" data-testid={`template-${tmpl.key}`}>
                {editingTemplate === tmpl.key ? (
                  <TemplateEditor tmpl={tmpl} onSave={saveTemplate} onCancel={() => setEditingTemplate(null)} />
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-semibold text-slate-900">{tmpl.label}</p>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${tmpl.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          {tmpl.active ? 'Ativo' : 'Inativo'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">{tmpl.desc}</p>
                      {tmpl.message && <p className="text-xs text-slate-700 mt-1 bg-slate-50 rounded p-2 line-clamp-2">{tmpl.message}</p>}
                    </div>
                    <button onClick={() => setEditingTemplate(tmpl.key)} className="btn-secondary text-sm ml-3" data-testid={`edit-template-${tmpl.key}`}>
                      <Pencil className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};


const STATUS_LABEL = { connected: 'Conectado', disconnected: 'Desconectado', connecting: 'Conectando...', waiting_qr: 'Aguardando QR Code' };
const STATUS_COLOR = { connected: 'bg-emerald-500', disconnected: 'bg-slate-400', connecting: 'bg-amber-500 animate-pulse', waiting_qr: 'bg-blue-500 animate-pulse' };

const ConnectionCard = ({ conn, onConnect, onDisconnect, onRemove, onRefresh }) => {
  const [qrData, setQrData] = useState(null);
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    if (conn.status === 'waiting_qr' || conn.status === 'connecting') {
      setPolling(true);
      const interval = setInterval(async () => {
        try {
          const res = await channelsAPI.getConnectionQR(conn.id);
          if (res.data.status === 'connected') {
            setPolling(false); setQrData(null); onRefresh();
            clearInterval(interval);
          } else if (res.data.qr_base64) {
            setQrData(res.data.qr_base64);
          }
        } catch (e) {}
      }, 3000);
      return () => clearInterval(interval);
    } else {
      setPolling(false); setQrData(null);
    }
  }, [conn.status, conn.id]);

  return (
    <div className="card !p-5" data-testid={`conn-${conn.id}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white flex-shrink-0 ${conn.type === 'whatsapp' ? 'bg-emerald-500' : 'bg-gradient-to-br from-purple-500 to-pink-500'}`}>
            <Phone className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">{conn.name}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <div className={`w-2 h-2 rounded-full ${STATUS_COLOR[conn.status] || 'bg-slate-400'}`} />
              <span className="text-xs text-slate-500">{STATUS_LABEL[conn.status] || conn.status}</span>
            </div>
            {conn.phone && <p className="text-xs text-slate-400 mt-0.5">{conn.phone}</p>}
            {conn.connected_name && <p className="text-xs text-emerald-600 mt-0.5">{conn.connected_name}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {conn.status === 'disconnected' && (
            <button onClick={() => onConnect(conn.id)} className="btn-primary text-sm" data-testid={`connect-${conn.id}`}>Conectar</button>
          )}
          {(conn.status === 'connected' || conn.status === 'connecting') && (
            <button onClick={() => onDisconnect(conn.id)} className="text-sm text-red-500 hover:text-red-700 font-medium">Desconectar</button>
          )}
          <button onClick={() => onRemove(conn.id)} className="p-2 rounded-lg hover:bg-red-50 text-red-400"><Trash2 className="w-4 h-4" /></button>
        </div>
      </div>
      {(conn.status === 'waiting_qr' || conn.status === 'connecting') && (
        <div className="mt-4 p-4 bg-slate-50 rounded-xl text-center">
          {qrData ? (
            <div>
              <img src={qrData} alt="QR Code" className="w-48 h-48 mx-auto rounded-lg" />
              <p className="text-xs text-slate-500 mt-2">Abra o WhatsApp &gt; Aparelhos conectados &gt; Conectar</p>
            </div>
          ) : (
            <div className="py-6">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2" />
              <p className="text-xs text-slate-500">Gerando QR Code...</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};


const TemplateEditor = ({ tmpl, onSave, onCancel }) => {
  const [message, setMessage] = useState(tmpl.message || '');
  const [active, setActive] = useState(tmpl.active);
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-slate-900">{tmpl.label}</p>
      <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3}
        className="input-field text-sm" placeholder="Ola {nome}, seu agendamento de {servico} foi confirmado para {data} as {hora}." data-testid={`template-msg-${tmpl.key}`} />
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="w-4 h-4 text-primary rounded" />
          <span className="text-sm text-slate-700">Ativo</span>
        </label>
        <div className="flex gap-2">
          <button onClick={onCancel} className="btn-secondary text-sm">Cancelar</button>
          <button onClick={() => onSave(tmpl.key, message, active)} className="btn-primary text-sm" data-testid={`save-template-${tmpl.key}`}>Salvar</button>
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

/* ========== MY SITE (BOOKING PAGE) WITH UPLOAD + SUBDOMAIN ========== */
const MySitePage = () => {
  const [page, setPage] = useState(null);
  const [uploading, setUploading] = useState(null);
  const [saving, setSaving] = useState(false);
  const logoRef = useRef(null);
  const bannerRef = useRef(null);

  useEffect(() => {
    schedulingAPI.getBookingPage().then(r => {
      setPage(r.data);
    }).catch(() => {});
  }, []);

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
          <div className="space-y-3">
            <div className="p-4 bg-slate-50 rounded-lg">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Agenda Publica</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-white px-3 py-2 rounded border border-slate-200 text-sm">{window.location.origin}/{page.slug}/agenda</code>
                <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/${page.slug}/agenda`); toast.success('Link copiado!'); }} className="btn-primary text-sm" data-testid="copy-link-btn">Copiar</button>
                <a href={`/${page.slug}/agenda`} target="_blank" rel="noopener noreferrer" className="btn-secondary text-sm">Visualizar</a>
              </div>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Login da Empresa</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-white px-3 py-2 rounded border border-slate-200 text-sm">{window.location.origin}/{page.slug}/login</code>
                <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/${page.slug}/login`); toast.success('Link copiado!'); }} className="btn-primary text-sm" data-testid="copy-login-link-btn">Copiar</button>
                <a href={`/${page.slug}/login`} target="_blank" rel="noopener noreferrer" className="btn-secondary text-sm">Visualizar</a>
              </div>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Indoor TV</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-white px-3 py-2 rounded border border-slate-200 text-sm">{window.location.origin}/{page.slug}/indoor</code>
                <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/${page.slug}/indoor`); toast.success('Link copiado!'); }} className="btn-primary text-sm" data-testid="copy-indoor-link-btn">Copiar</button>
                <a href={`/${page.slug}/indoor`} target="_blank" rel="noopener noreferrer" className="btn-secondary text-sm">Visualizar</a>
              </div>
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
  const [summary, setSummary] = useState(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [filterProf, setFilterProf] = useState('');
  const [filterMethod, setFilterMethod] = useState('');
  const [view, setView] = useState('resumo');
  const [professionals, setProfessionals] = useState([]);

  useEffect(() => { schedulingAPI.getProfessionals().then(r => setProfessionals(r.data)).catch(() => {}); }, []);

  useEffect(() => {
    const params = {};
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    if (filterMethod) params.payment_method = filterMethod;
    schedulingAPI.getFinancialSummary(params).then(r => setSummary(r.data)).catch(() => {
      reportsAPI.getFinancial(params).then(r => setSummary(r.data)).catch(() => {});
    });
  }, [startDate, endDate, filterMethod]);

  const PAYMENT_LABELS = { dinheiro: 'Dinheiro', pix: 'PIX', cartao_credito: 'Cartao Credito', cartao_debito: 'Cartao Debito', outros: 'Outros' };
  const PAYMENT_COLORS = { dinheiro: 'bg-emerald-500', pix: 'bg-cyan-500', cartao_credito: 'bg-violet-500', cartao_debito: 'bg-blue-500', outros: 'bg-slate-400' };
  const byMethod = summary?.by_payment_method || {};
  const totalRevenue = summary?.total_revenue || 0;

  let txns = summary?.transactions || [];
  if (filterProf) txns = txns.filter(t => t.professional_id === filterProf);

  return (
    <div className="animate-fade-in" data-testid="financeiro-page">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-bold font-heading text-slate-900">Financeiro</h2>
          <p className="text-sm text-slate-600">Controle de receitas e formas de pagamento</p>
        </div>
        <div className="flex bg-slate-100 rounded-lg p-0.5">
          <button onClick={() => setView('resumo')} className={`px-3 py-1.5 rounded-md text-xs font-medium ${view==='resumo'?'bg-white shadow-sm':'text-slate-500'}`}>Resumo</button>
          <button onClick={() => setView('transacoes')} className={`px-3 py-1.5 rounded-md text-xs font-medium ${view==='transacoes'?'bg-white shadow-sm':'text-slate-500'}`}>Transacoes</button>
        </div>
      </div>

      {/* Filters */}
      <div className="card !p-3 mb-6">
        <div className="flex flex-wrap gap-3 items-end">
          <div><label className="text-[10px] font-bold uppercase text-slate-400">Data Inicio</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="input-field text-sm !py-1.5" data-testid="fin-start-date" /></div>
          <div><label className="text-[10px] font-bold uppercase text-slate-400">Data Fim</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="input-field text-sm !py-1.5" data-testid="fin-end-date" /></div>
          <div><label className="text-[10px] font-bold uppercase text-slate-400">Profissional</label>
            <select value={filterProf} onChange={e => setFilterProf(e.target.value)} className="input-field text-sm !py-1.5" data-testid="fin-prof-filter">
              <option value="">Todos</option>
              {professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></div>
          <div><label className="text-[10px] font-bold uppercase text-slate-400">Forma Pgto</label>
            <select value={filterMethod} onChange={e => setFilterMethod(e.target.value)} className="input-field text-sm !py-1.5" data-testid="fin-method-filter">
              <option value="">Todas</option>
              <option value="dinheiro">Dinheiro</option>
              <option value="pix">PIX</option>
              <option value="cartao_credito">Credito</option>
              <option value="cartao_debito">Debito</option>
            </select></div>
          {(startDate || endDate || filterProf || filterMethod) && (
            <button onClick={() => { setStartDate(''); setEndDate(''); setFilterProf(''); setFilterMethod(''); }} className="text-xs text-red-500 hover:text-red-700 font-medium pb-2">Limpar</button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Receita Total" value={`R$ ${totalRevenue.toFixed(2)}`} icon={<DollarSign className="w-5 h-5" />} color="bg-emerald-500" />
        <StatCard label="Transacoes" value={summary?.transaction_count || 0} icon={<CheckCircle2 className="w-5 h-5" />} color="bg-blue-500" />
        <StatCard label="Ticket Medio" value={`R$ ${summary?.transaction_count ? (totalRevenue / summary.transaction_count).toFixed(2) : '0.00'}`} icon={<BarChart3 className="w-5 h-5" />} color="bg-amber-500" />
        <StatCard label="Formas Pgto" value={Object.keys(byMethod).length} icon={<CreditCard className="w-5 h-5" />} color="bg-violet-500" />
      </div>

      {view === 'resumo' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card">
            <h3 className="font-semibold text-slate-900 mb-4">Por Forma de Pagamento</h3>
            <div className="space-y-3">
              {Object.entries(byMethod).length === 0 && <p className="text-sm text-slate-400 py-4 text-center">Nenhuma transacao registrada</p>}
              {Object.entries(byMethod).map(([method, amount]) => (
                <div key={method} className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full flex-shrink-0 ${PAYMENT_COLORS[method] || 'bg-slate-400'}`} />
                  <div className="flex-1">
                    <div className="flex justify-between mb-1">
                      <span className="text-sm font-medium text-slate-700">{PAYMENT_LABELS[method] || method}</span>
                      <span className="text-sm font-bold text-slate-900">R$ {amount.toFixed(2)}</span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${PAYMENT_COLORS[method] || 'bg-slate-400'}`} style={{ width: `${totalRevenue ? (amount / totalRevenue * 100) : 0}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <h3 className="font-semibold text-slate-900 mb-4">Ultimas Transacoes</h3>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {txns.slice(0, 20).map(t => (
                <div key={t.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{t.description}</p>
                    <p className="text-xs text-slate-500">{t.date} • {PAYMENT_LABELS[t.payment_method] || t.payment_method}</p>
                  </div>
                  <span className="text-sm font-bold text-emerald-600 flex-shrink-0 ml-2">R$ {(t.amount || 0).toFixed(2)}</span>
                </div>
              ))}
              {txns.length === 0 && <p className="text-sm text-slate-400 text-center py-6">Nenhuma transacao</p>}
            </div>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-slate-200">
                <th className="text-left py-3 px-4 text-xs font-bold uppercase tracking-widest text-slate-400">Data</th>
                <th className="text-left py-3 px-4 text-xs font-bold uppercase tracking-widest text-slate-400">Descricao</th>
                <th className="text-left py-3 px-4 text-xs font-bold uppercase tracking-widest text-slate-400">Profissional</th>
                <th className="text-left py-3 px-4 text-xs font-bold uppercase tracking-widest text-slate-400">Forma Pgto</th>
                <th className="text-left py-3 px-4 text-xs font-bold uppercase tracking-widest text-slate-400">Valor</th>
              </tr></thead>
              <tbody>
                {txns.map(t => (
                  <tr key={t.id} className="border-b border-slate-100 hover:bg-slate-50 text-sm">
                    <td className="py-3 px-4 text-slate-600">{t.date}</td>
                    <td className="py-3 px-4 font-medium text-slate-900">{t.description}</td>
                    <td className="py-3 px-4 text-slate-600">{t.professional_name || '-'}</td>
                    <td className="py-3 px-4"><span className={`text-xs px-2 py-0.5 rounded-full text-white font-medium ${PAYMENT_COLORS[t.payment_method] || 'bg-slate-400'}`}>{PAYMENT_LABELS[t.payment_method] || t.payment_method}</span></td>
                    <td className="py-3 px-4 font-bold text-emerald-600">R$ {(t.amount || 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {txns.length === 0 && <p className="text-center py-8 text-sm text-slate-500">Nenhuma transacao</p>}
          </div>
        </div>
      )}
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
  const [businessHours, setBusinessHours] = useState(null);
  const [saving, setSaving] = useState(false);

  const DAY_LABELS = { seg: 'Segunda', ter: 'Terca', qua: 'Quarta', qui: 'Quinta', sex: 'Sexta', sab: 'Sabado', dom: 'Domingo' };

  useEffect(() => { schedulingAPI.getBusinessHours().then(r => setBusinessHours(r.data)).catch(() => {}); }, []);

  const updateDay = (day, field, value) => {
    setBusinessHours(h => ({ ...h, [day]: { ...h[day], [field]: value } }));
  };

  const saveHours = async () => {
    setSaving(true);
    try {
      await schedulingAPI.updateBusinessHours(businessHours);
      toast.success('Horarios do estabelecimento salvos!');
    } catch (e) { toast.error('Erro ao salvar'); }
    finally { setSaving(false); }
  };

  return (
    <div className="animate-fade-in" data-testid="config-page">
      <div className="card max-w-2xl mb-6">
        <h3 className="font-semibold text-slate-900 mb-4">Configuracoes da Empresa</h3>
        <div className="space-y-3">
          <div><label className="text-xs font-bold uppercase text-slate-400">Nome</label><p className="text-sm">{user?.company?.name}</p></div>
          <div><label className="text-xs font-bold uppercase text-slate-400">Email</label><p className="text-sm">{user?.company?.email}</p></div>
          <div><label className="text-xs font-bold uppercase text-slate-400">Plano</label><p className="text-sm capitalize">{user?.company?.plan_type}</p></div>
          <div><label className="text-xs font-bold uppercase text-slate-400">Status</label><p className="text-sm capitalize">{user?.company?.status}</p></div>
        </div>
      </div>

      {businessHours && (
        <div className="card max-w-2xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-slate-900">Horario de Funcionamento</h3>
              <p className="text-xs text-slate-500">Define os horarios do estabelecimento. Profissionais podem ter horarios proprios.</p>
            </div>
            <button onClick={saveHours} disabled={saving} className="btn-primary text-sm" data-testid="save-biz-hours-btn">
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
          <div className="space-y-2">
            {Object.entries(DAY_LABELS).map(([key, label]) => (
              <div key={key} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg" data-testid={`biz-hours-${key}`}>
                <label className="flex items-center gap-2 w-28 cursor-pointer">
                  <input type="checkbox" checked={businessHours[key]?.active ?? false}
                    onChange={e => updateDay(key, 'active', e.target.checked)}
                    className="w-4 h-4 text-primary rounded" />
                  <span className="text-sm font-medium text-slate-700">{label}</span>
                </label>
                {businessHours[key]?.active ? (
                  <div className="flex items-center gap-2">
                    <input type="time" value={businessHours[key]?.start || '08:00'}
                      onChange={e => updateDay(key, 'start', e.target.value)}
                      className="input-field !py-1.5 text-sm" />
                    <span className="text-xs text-slate-400">ate</span>
                    <input type="time" value={businessHours[key]?.end || '18:00'}
                      onChange={e => updateDay(key, 'end', e.target.value)}
                      className="input-field !py-1.5 text-sm" />
                  </div>
                ) : (
                  <span className="text-xs text-slate-400">Fechado</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/* ========== SHARED COMPONENTS ========== */
const PlaceholderPage = ({ title }) => (
  <div className="animate-fade-in card text-center py-12">
    <p className="text-slate-500">{title} - Em breve</p>
  </div>
);

/* ========== INDOOR SETTINGS ========== */
const IndoorSettingsPage = () => {
  const { user } = useAuth();
  const [settings, setSettings] = useState(null);
  const [newLink, setNewLink] = useState('');

  useEffect(() => { schedulingAPI.getIndoorSettings().then(r => setSettings(r.data)).catch(() => {}); }, []);

  const handleSave = async (update) => {
    const res = await schedulingAPI.updateIndoorSettings(update);
    setSettings(res.data);
    toast.success('Configuracao salva!');
  };

  const addMedia = () => {
    if (!newLink.trim()) return;
    const links = [...(settings?.media_links || []), newLink.trim()];
    handleSave({ media_links: links });
    setNewLink('');
  };

  const removeMedia = (idx) => {
    const links = (settings?.media_links || []).filter((_, i) => i !== idx);
    handleSave({ media_links: links });
  };

  const bookingPage = user?.company?.name?.toLowerCase().replace(/\s/g, '').replace(/\./g, '').substring(0, 20);

  return (
    <div className="animate-fade-in" data-testid="indoor-settings-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold font-heading text-slate-900">Indoor / TV</h2>
          <p className="text-sm text-slate-600">Configure a tela que sera exibida no salao ou clinica</p>
        </div>
        <a href={`/${bookingPage}/indoor`} target="_blank" rel="noopener noreferrer" className="btn-primary text-sm flex items-center gap-2" data-testid="open-indoor-btn">
          <Monitor className="w-4 h-4" /> Abrir Tela Indoor
        </a>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="font-semibold text-slate-900 mb-4">Configuracoes</h3>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1 block">Link publico da TV</label>
              <code className="block bg-slate-50 px-3 py-2 rounded text-sm border border-slate-200">{window.location.origin}/{bookingPage}/indoor</code>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1 block">Duracao do slide (segundos)</label>
              <input type="number" value={settings?.slide_duration || 10} onChange={e => handleSave({ slide_duration: parseInt(e.target.value) || 10 })}
                className="input-field" min={5} max={120} data-testid="slide-duration" />
            </div>
          </div>
        </div>

        <div className="card">
          <h3 className="font-semibold text-slate-900 mb-4">Midias (Propagandas)</h3>
          <p className="text-xs text-slate-500 mb-3">Adicione links de imagens ou videos que serao intercalados com a agenda</p>
          <div className="flex gap-2 mb-4">
            <input value={newLink} onChange={e => setNewLink(e.target.value)} placeholder="https://... (imagem ou video)" className="input-field flex-1" data-testid="media-link-input" />
            <button onClick={addMedia} className="btn-primary text-sm">Adicionar</button>
          </div>
          <div className="space-y-2">
            {(settings?.media_links || []).map((link, i) => (
              <div key={`media-${i}-${link.substring(0, 20)}`} className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg">
                <span className="text-xs text-slate-600 truncate flex-1">{link}</span>
                <button onClick={() => removeMedia(i)} className="text-red-500 hover:text-red-700"><X className="w-4 h-4" /></button>
              </div>
            ))}
            {(settings?.media_links || []).length === 0 && <p className="text-xs text-slate-400 text-center py-4">Nenhuma midia adicionada</p>}
          </div>
        </div>
      </div>
    </div>
  );
};

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
              <React.Fragment key={`step-${i}`}>
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
