import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { crmAPI, schedulingAPI } from '../../services/api';
import { toast } from 'sonner';
import {
  LogOut, LayoutDashboard, Headphones, Zap, Columns3, Users, Tag,
  MessageSquare, Megaphone, GitBranch, Info, Code, UserCog, Bot, Link,
  Sparkles, Calendar, CalendarCheck, UserCheck, FolderOpen, Scissors,
  CreditCard, Briefcase, DollarSign, PieChart, Globe, Bell, Settings,
  Puzzle, BarChart3, LifeBuoy, Plus, Search, Pencil, Trash2, X, Check,
  ChevronLeft, ChevronRight, Phone, Mail, Clock
} from 'lucide-react';
import FlowBuilderPage from '../CRM/FlowBuilderPage';

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

  const enabledFeatures = useMemo(() => {
    const feats = user?.company?.features || [];
    return feats.filter(f => f.enabled).map(f => f.feature_key);
  }, [user]);

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

        <div className={activePage === 'flowbuilder' ? 'h-[calc(100vh-52px)]' : 'p-6'}>
          <PageContent page={activePage} hasFeature={hasFeature} />
        </div>
      </main>
    </div>
  );
};

/* ========== PAGE ROUTER ========== */
const PageContent = ({ page, hasFeature }) => {
  switch (page) {
    case 'dashboard': return <DashboardPage />;
    case 'kanban': return <KanbanPage />;
    case 'atendimentos': return <TicketsPage />;
    case 'contatos': return <ContactsPage />;
    case 'respostas_rapidas': return <QuickResponsesPage />;
    case 'campanhas': return <CampaignsPage />;
    case 'tags': return <TagsPage />;
    case 'flowbuilder': return <FlowBuilderPage />;
    case 'agente_ia': return <AIAgentPage />;
    case 'conexoes': return <WhatsAppPage />;
    case 'calendario': return <CalendarPage />;
    case 'agendamentos': return <AppointmentsPage />;
    case 'clientes': return <ClientsPage />;
    case 'servicos_produtos': return <ServicesPage />;
    case 'profissionais': return <ProfessionalsPage />;
    case 'categorias': return <CategoriesPage />;
    case 'meu_site': return <MySitePage />;
    case 'financeiro': return <FinanceiroPage />;
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

/* ========== KANBAN ========== */
const KanbanPage = () => {
  const [kanban, setKanban] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  useEffect(() => { crmAPI.getKanban().then(r => setKanban(r.data)).catch(() => {}); }, []);
  const cols = [
    { key: 'aberto', label: 'Aberto', bg: 'bg-blue-500' },
    { key: 'em_cobranca', label: 'Em Cobranca', bg: 'bg-yellow-500' },
    { key: 'pago', label: 'Pago', bg: 'bg-emerald-500' },
    { key: 'bloqueado', label: 'Bloqueado', bg: 'bg-red-500' },
    { key: 'proposta', label: 'Proposta', bg: 'bg-violet-500' },
  ];
  return (
    <div className="animate-fade-in" data-testid="kanban-page">
      <div className="flex items-center justify-between mb-4">
        <p className="text-slate-600 text-sm">Arraste os tickets entre colunas</p>
        <button onClick={() => setShowAdd(true)} className="btn-primary text-sm flex items-center gap-2" data-testid="add-ticket-btn"><Plus className="w-4 h-4" /> Novo Ticket</button>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {cols.map(col => (
          <div key={col.key} className="flex-shrink-0 w-72" data-testid={`kanban-col-${col.key}`}>
            <div className="card !p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-2.5 h-2.5 rounded-full ${col.bg}`} />
                <span className="font-semibold text-sm text-slate-900">{col.label}</span>
                <span className="ml-auto text-xs text-slate-400">{kanban?.[col.key]?.length || 0}</span>
              </div>
              <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                {kanban?.[col.key]?.map(t => (
                  <div key={t.id} className="p-3 bg-slate-50 rounded-lg border border-slate-200 hover:shadow transition-all text-sm" data-testid={`ticket-${t.id}`}>
                    <p className="font-medium text-slate-900">{t.customer_name}</p>
                    <p className="text-xs text-slate-500 mt-1">{t.customer_phone}</p>
                    <div className="flex items-center gap-1.5 mt-2">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-slate-200">{t.channel}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${t.priority === 'high' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>{t.priority}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
      {showAdd && <TicketModal onClose={() => setShowAdd(false)} onSave={() => { setShowAdd(false); crmAPI.getKanban().then(r => setKanban(r.data)); }} />}
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
const ClientsPage = () => <CrudListPage title="Clientes" fetchFn={() => schedulingAPI.getAppointments()} columns={[{key:'customer_name',label:'Nome'},{key:'customer_phone',label:'Telefone'},{key:'service_name',label:'Servico'}]} testId="clients-page" />;

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

/* ========== WHATSAPP CONNECTIONS ========== */
const WhatsAppPage = () => (
  <div className="animate-fade-in" data-testid="whatsapp-page">
    <div className="card text-center py-12">
      <div className="w-20 h-20 rounded-2xl bg-emerald-100 flex items-center justify-center mx-auto mb-4">
        <Phone className="w-10 h-10 text-emerald-600" />
      </div>
      <h3 className="text-xl font-bold font-heading text-slate-900 mb-2">Conexoes WhatsApp</h3>
      <p className="text-sm text-slate-600 mb-6 max-w-md mx-auto">Conecte seu WhatsApp para receber e enviar mensagens. Escaneie o QR Code para vincular.</p>
      <button className="btn-primary" data-testid="connect-whatsapp-btn">Conectar WhatsApp</button>
      <div className="mt-8 p-6 bg-slate-50 rounded-xl max-w-sm mx-auto">
        <div className="w-48 h-48 bg-white border-2 border-dashed border-slate-300 rounded-xl mx-auto flex items-center justify-center">
          <p className="text-xs text-slate-400">QR Code aqui</p>
        </div>
        <p className="text-xs text-slate-500 mt-3">Abra WhatsApp &gt; Dispositivos conectados &gt; Conectar dispositivo</p>
      </div>
    </div>
  </div>
);

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

/* ========== MY SITE (BOOKING PAGE) ========== */
const MySitePage = () => {
  const [page, setPage] = useState(null);
  useEffect(() => { schedulingAPI.getBookingPage().then(r => setPage(r.data)).catch(() => {}); }, []);
  return (
    <div className="animate-fade-in" data-testid="my-site-page">
      <div className="card">
        <h3 className="text-lg font-semibold font-heading text-slate-900 mb-2">Minha Pagina de Agendamento</h3>
        <p className="text-sm text-slate-600 mb-4">Personalize a pagina onde seus clientes fazem agendamentos</p>
        {page?.slug && (
          <div className="p-4 bg-slate-50 rounded-lg mb-4">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Link da Sua Pagina</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-white px-3 py-2 rounded border border-slate-200 text-sm">{window.location.origin}/booking/{page.slug}</code>
              <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/booking/${page.slug}`); toast.success('Link copiado!'); }} className="btn-primary text-sm" data-testid="copy-link-btn">Copiar</button>
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 border border-slate-200 rounded-lg">
            <p className="text-sm font-medium text-slate-700 mb-2">Cor Primaria</p>
            <div className="flex items-center gap-2"><div className="w-8 h-8 rounded" style={{ background: page?.primary_color || '#4F46E5' }} /><span className="text-sm text-slate-600">{page?.primary_color || '#4F46E5'}</span></div>
          </div>
          <div className="p-4 border border-slate-200 rounded-lg">
            <p className="text-sm font-medium text-slate-700 mb-2">Cor Secundaria</p>
            <div className="flex items-center gap-2"><div className="w-8 h-8 rounded" style={{ background: page?.secondary_color || '#10B981' }} /><span className="text-sm text-slate-600">{page?.secondary_color || '#10B981'}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ========== FINANCEIRO ========== */
const FinanceiroPage = () => (
  <div className="animate-fade-in" data-testid="financeiro-page">
    <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
      <StatCard label="Receita Total" value="R$ 0,00" icon={<DollarSign className="w-5 h-5" />} color="bg-emerald-500" />
      <StatCard label="A Receber" value="R$ 0,00" icon={<Clock className="w-5 h-5" />} color="bg-amber-500" />
      <StatCard label="Comissoes" value="R$ 0,00" icon={<PieChart className="w-5 h-5" />} color="bg-violet-500" />
    </div>
    <div className="card"><p className="text-sm text-slate-500 text-center py-8">Nenhuma transacao registrada</p></div>
  </div>
);

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

export default CompanyDashboard;
