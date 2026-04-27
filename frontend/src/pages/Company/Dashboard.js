import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../context/AuthContext';
import { crmAPI, schedulingAPI, uploadAPI, reportsAPI, notificationsAPI, channelsAPI } from '../../services/api';
import { useCompanyBranding } from '../../hooks/useCompanyBranding';
import { toast } from 'sonner';
import {
  LogOut, LayoutDashboard, Headphones, Zap, Columns3, Users, Tag,
  MessageSquare, Megaphone, GitBranch, Info, Code, UserCog, Bot, Link,
  Sparkles, Calendar, CalendarCheck, UserCheck, FolderOpen, Scissors,
  CreditCard, Briefcase, DollarSign, PieChart, Globe, Bell, Settings,
  Puzzle, BarChart3, LifeBuoy, Plus, Search, Pencil, Trash2, X, Check,
  ChevronLeft, ChevronRight, ChevronDown, Phone, Mail, Clock, Upload, Image, GripVertical, ArrowRight, CheckCircle2, Circle, Monitor, Send, Shield, User, Menu, MessageCircle, Filter
} from 'lucide-react';
import FlowBuilderPage from '../CRM/FlowBuilderPage';
import AtendimentosPage from '../CRM/AtendimentosPage';
import TagsPage from '../CRM/TagsPage';
import KanbanPage from '../CRM/KanbanPage';
import AIPage from '../CRM/AIPage';
import WhatsAppConnectionsPage from '../CRM/WhatsAppConnectionsPage';
import CampaignsPage from '../CRM/CampaignsPage';
import QueuesPage from '../CRM/QueuesPage';
import { ProfessionalsPageFull, ServicesPageFull, SubscriptionsPageFull, PlanosPageFull, CalendarPageFull } from '../Scheduling/SchedulingPages';

const ICON_MAP = {
  LayoutDashboard, Headphones, Zap, Columns3, Users, Tag, MessageSquare,
  Megaphone, GitBranch, Info, Code, UserCog, Bot, Link, Sparkles, Calendar,
  CalendarCheck, UserCheck, FolderOpen, Scissors, CreditCard, Briefcase,
  DollarSign, PieChart, Globe, Bell, Settings, Puzzle, BarChart3, LifeBuoy, Monitor, Shield
};

const FEATURE_META = {
  dashboard:          { icon: 'LayoutDashboard', label: 'Início', group: 'Principal' },
  atendimentos:       { icon: 'Headphones',      label: 'Atendimentos', group: 'CRM' },
  respostas_rapidas:  { icon: 'Zap',             label: 'Respostas Rapidas', group: 'CRM' },
  kanban:             { icon: 'Columns3',         label: 'Kanban', group: 'CRM' },
  contatos:           { icon: 'Users',            label: 'Clientes / Leads', group: 'CRM' },
  tags:               { icon: 'Tag',              label: 'Tags', group: 'CRM' },
  chat_interno:       { icon: 'MessageSquare',    label: 'Chat Interno', group: 'CRM' },
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
  planos:             { icon: 'Tag',              label: 'Planos', group: 'Catalogo' },
  profissionais:      { icon: 'Briefcase',        label: 'Profissionais', group: 'Catalogo' },
  financeiro:         { icon: 'DollarSign',       label: 'Financeiro', group: 'Analise' },
  comissoes:          { icon: 'PieChart',         label: 'Comissoes', group: 'Analise' },
  meu_site:           { icon: 'Globe',            label: 'Meu Site', group: 'Config Empresa' },
  // 'notificacoes' agora vive como aba dentro de Conexoes — nao aparece mais no menu lateral
  configuracoes:      { icon: 'Settings',         label: 'Configuracoes', group: 'Config Empresa' },
  'integrações':      { icon: 'Puzzle',           label: 'Integracoes', group: 'Config Empresa' },
  relatorios:         { icon: 'BarChart3',        label: 'Relatorios', group: 'Analise' },
  suporte:            { icon: 'LifeBuoy',         label: 'Suporte', group: 'Config Empresa' },
  indoor:             { icon: 'Monitor',          label: 'Indoor / TV', group: 'Config Empresa' },
  usuarios:           { icon: 'UserCog',          label: 'Usuarios', group: 'Administracao' },
  perfis_acesso:      { icon: 'Shield',           label: 'Perfis de Acesso', group: 'Administracao' },
};

const CompanyDashboard = () => {
  const { user, logout } = useAuth();
  const [activePage, setActivePage] = useState(null);
  const [baseType, setBaseType] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [bookingPage, setBookingPage] = useState(null);
  const [showMenuSheet, setShowMenuSheet] = useState(false);
  // Per-user setting: default is DISABLED on mobile. Admins can enable from settings.
  const [sidebarEnabledMobile, setSidebarEnabledMobile] = useState(() => {
    try { return localStorage.getItem('sidebar_enabled_mobile') === '1'; } catch { return false; }
  });

  const API_BASE = process.env.REACT_APP_BACKEND_URL;
  const logoUrl = bookingPage?.logo_url ? `${API_BASE}${bookingPage.logo_url}` : null;

  // Dynamic PWA branding (favicon + manifest + title) based on company
  useCompanyBranding({
    slug: user?.company?.subdomain || bookingPage?.slug,
    name: user?.company?.name,
    logoUrl: bookingPage?.logo_url,
    themeColor: bookingPage?.primary_color,
  });

  const enabledFeatures = useMemo(() => {
    const feats = user?.company?.features || [];
    const companyEnabled = feats.filter(f => f.enabled).map(f => f.feature_key);
    // Admins see everything the company has enabled
    const isAdmin = user?.role === 'company_admin' || user?.role === 'super_admin';
    const perms = user?.permissions || [];
    if (isAdmin || perms.includes('*')) return companyEnabled;
    // Non-admins: intersection between company-enabled AND user's profile permissions.
    // Fail-closed: if the user has no permission profile assigned, they see nothing.
    return companyEnabled.filter(k => perms.includes(k));
  }, [user]);

  // Check onboarding status on mount
  useEffect(() => {
    schedulingAPI.getOnboardingStatus().then(r => {
      const bt = r.data?.base_type || 'scheduling';
      setBaseType(bt);
      // CRM-only companies (e.g. Atendimento ao Cliente) don't need service/professional setup
      // — skip the onboarding modal entirely; mark it done so it never shows again.
      if (bt === 'crm') {
        if (!r.data.onboarding_done) {
          schedulingAPI.completeOnboarding().catch(() => {});
        }
      } else if (!r.data.onboarding_done) {
        setShowOnboarding(true);
      }
    }).catch(() => {});
    schedulingAPI.getBookingPage().then(r => setBookingPage(r.data)).catch(() => {});
    const onLogoUpdate = () => { schedulingAPI.getBookingPage().then(r => setBookingPage(r.data)).catch(() => {}); };
    window.addEventListener('company-logo-updated', onLogoUpdate);
    return () => window.removeEventListener('company-logo-updated', onLogoUpdate);
  }, []);

  // Pick a default page once enabled features are known.
  // CRM-only -> 'atendimentos' (or first CRM feature); scheduling -> 'agenda'; fallback -> first enabled.
  useEffect(() => {
    if (activePage) return;
    if (!enabledFeatures || enabledFeatures.length === 0) return;
    if (baseType === null) return; // wait for base_type to be resolved
    let target = null;
    if (baseType === 'crm') {
      target = enabledFeatures.includes('atendimentos') ? 'atendimentos'
        : (enabledFeatures.includes('kanban') ? 'kanban'
        : (enabledFeatures.includes('contatos') ? 'contatos'
        : (enabledFeatures.includes('dashboard') ? 'dashboard' : enabledFeatures[0])));
    } else {
      target = enabledFeatures.includes('agenda') ? 'agenda'
        : (enabledFeatures.includes('dashboard') ? 'dashboard' : enabledFeatures[0]);
    }
    setActivePage(target);
  }, [enabledFeatures, baseType, activePage]);

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
    <div className="min-h-screen bg-[#F8FAFC] flex overflow-x-hidden">
      {/* Mobile overlay */}
      {mobileSidebarOpen && <div className="fixed inset-0 bg-slate-900/50 z-30 lg:hidden" onClick={() => setMobileSidebarOpen(false)} />}

      {/* Sidebar */}
      <aside className={`${sidebarCollapsed ? 'w-16' : 'w-60'} bg-white border-r border-slate-200 flex flex-col fixed h-full z-40 transition-all duration-200 ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className="p-4 border-b border-slate-200 flex items-center justify-between gap-2">
          {!sidebarCollapsed && (
            <div className="min-w-0 flex items-center gap-2">
              {logoUrl ? (
                <img src={logoUrl} alt="Logo" className="w-9 h-9 rounded-lg object-cover flex-shrink-0 border border-slate-200" />
              ) : (
                <div className="w-9 h-9 rounded-lg bg-[var(--primary-color)]/10 flex items-center justify-center text-[var(--primary-color)] font-bold flex-shrink-0">
                  {user?.company?.name?.[0]?.toUpperCase() || 'E'}
                </div>
              )}
              <h1 className="text-sm font-bold font-heading text-slate-900 truncate">{user?.company?.name || 'Empresa'}</h1>
            </div>
          )}
          {sidebarCollapsed && logoUrl && (
            <img src={logoUrl} alt="Logo" className="w-9 h-9 rounded-lg object-cover flex-shrink-0 mx-auto" />
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
      <main className={`flex-1 min-w-0 ${sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-60'} transition-all duration-200`}>
        <header className="glass border-b border-slate-200 sticky top-0 z-30 px-4 lg:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            {sidebarEnabledMobile && (
              <button onClick={() => setMobileSidebarOpen(true)} className="lg:hidden p-2 rounded-lg hover:bg-slate-100" data-testid="mobile-menu-btn">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
              </button>
            )}
            {logoUrl && (
              <img src={logoUrl} alt="Logo" className="w-8 h-8 rounded-lg object-cover flex-shrink-0 border border-slate-200 hidden sm:block" data-testid="header-logo" />
            )}
            <h2 className="font-page-title text-2xl lg:text-3xl text-slate-900 truncate">
              {FEATURE_META[activePage]?.label || 'Início'}
            </h2>
          </div>
          <UserHeaderMenu user={user} logout={logout} />
        </header>

        <div className={['flowbuilder', 'atendimentos'].includes(activePage) ? 'h-[calc(100vh-52px)] pb-16 lg:pb-0 overflow-hidden' : 'p-4 lg:p-6 pb-24 lg:pb-6 max-w-full overflow-x-hidden'}>
          <PageContent page={activePage} hasFeature={hasFeature} setActivePage={setActivePage} menuGroups={menuGroups} />
        </div>
      </main>

      {/* Mobile Bottom Navigation (hidden on desktop) */}
      <MobileBottomNav
        activePage={activePage}
        setActivePage={setActivePage}
        onOpenMenu={() => setShowMenuSheet(true)}
        hasFeature={hasFeature}
      />

      {/* Mobile menu sheet (all options) */}
      {showMenuSheet && (
        <MobileMenuSheet
          menuGroups={menuGroups}
          activePage={activePage}
          onPick={(key) => { setActivePage(key); setShowMenuSheet(false); }}
          onClose={() => setShowMenuSheet(false)}
          onLogout={logout}
        />
      )}

      {/* Onboarding Wizard */}
      {showOnboarding && (
        <OnboardingWizard onClose={() => { setShowOnboarding(false); schedulingAPI.completeOnboarding(); }} />
      )}
    </div>
  );
};

/* ========== PAGE ROUTER ========== */
/* ========== WEEK DATE STRIP ========== */
const WeekDateStrip = ({ viewDate, onPick }) => {
  const [open, setOpen] = useState(false);
  const nativeRef = React.useRef(null);

  const parse = (iso) => new Date(iso + 'T00:00:00');
  const fmt = (d) => d.toISOString().split('T')[0];
  const current = parse(viewDate);

  // Build 7-day window centered on viewDate (3 before, view, 3 after)
  const days = [];
  for (let i = -3; i <= 3; i++) {
    const d = new Date(current);
    d.setDate(d.getDate() + i);
    days.push(d);
  }

  const shift = (n) => {
    const d = new Date(current);
    d.setDate(d.getDate() + n);
    onPick(fmt(d));
  };

  const monthYear = current.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const weekLabels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
  const todayIso = new Date().toISOString().split('T')[0];

  const openPicker = () => {
    try { if (nativeRef.current?.showPicker) { nativeRef.current.showPicker(); return; } } catch { /* ignore */ }
    setOpen(o => !o);
  };

  return (
    <div className="mb-4" data-testid="week-date-strip">
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={openPicker}
          className="flex items-center gap-1.5 text-base font-semibold text-slate-900 font-page-title capitalize"
          data-testid="week-month-opener"
        >
          {monthYear}
          <ChevronDown className="w-4 h-4 text-slate-500" />
        </button>
        <div className="flex items-center gap-1">
          <button
            onClick={() => shift(-7)}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
            data-testid="week-prev"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => onPick(todayIso)}
            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
            data-testid="week-today"
          >
            Hoje
          </button>
          <button
            onClick={() => shift(7)}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
            data-testid="week-next"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
      {/* hidden native date input for showPicker */}
      <input
        ref={nativeRef}
        type="date"
        value={viewDate}
        onChange={(e) => { if (e.target.value) { onPick(e.target.value); setOpen(false); } }}
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
      />
      {open && (
        <div className="mb-2">
          <input
            type="date"
            value={viewDate}
            onChange={(e) => { onPick(e.target.value); setOpen(false); }}
            className="input-field text-sm"
            autoFocus
          />
        </div>
      )}
      <div className="grid grid-cols-7 gap-1">
        {days.map(d => {
          const iso = fmt(d);
          const isSel = iso === viewDate;
          const isToday = iso === todayIso;
          return (
            <button
              key={iso}
              onClick={() => onPick(iso)}
              className={`flex flex-col items-center py-2 rounded-xl text-xs font-medium transition-all ${
                isSel
                  ? 'bg-[var(--primary-color)] text-white shadow'
                  : isToday
                  ? 'bg-slate-100 text-slate-800'
                  : 'text-slate-500 hover:bg-slate-50'
              }`}
              data-testid={`week-day-${iso}`}
            >
              <span className="text-[10px] uppercase tracking-wider opacity-80">{weekLabels[d.getDay()]}</span>
              <span className={`text-lg font-bold leading-tight ${isSel ? '' : 'text-slate-900'}`}>{d.getDate()}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

/* ========== PROFESSIONAL STORIES (Instagram-like filter) ========== */
const ProfessionalStories = ({ professionals, activeId, onPick }) => {
  const actives = (professionals || []).filter(p => p.is_active !== false);
  if (actives.length === 0) return null;

  const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map(s => s[0] || '').join('').toUpperCase();

  const Circle = ({ item, active, onClick, label, isAll }) => (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1 flex-shrink-0 group"
      data-testid={`story-${isAll ? 'all' : item.id}`}
    >
      <div
        className={`p-[2.5px] rounded-full transition-all ${
          active
            ? 'bg-gradient-to-tr from-amber-400 via-pink-500 to-fuchsia-600'
            : 'bg-slate-200 group-hover:bg-slate-300'
        }`}
      >
        <div className="bg-white rounded-full p-[2px]">
          <div className="w-16 h-16 rounded-full overflow-hidden flex items-center justify-center bg-gradient-to-br from-slate-700 to-slate-900 text-white text-lg font-bold">
            {isAll ? (
              <Users className="w-6 h-6" />
            ) : item.avatar_url || item.photo_url ? (
              <img src={item.avatar_url || item.photo_url} alt={item.name} className="w-full h-full object-cover" />
            ) : (
              <span>{initials(item.name)}</span>
            )}
          </div>
        </div>
      </div>
      <span className={`text-[11px] leading-tight max-w-[72px] truncate ${active ? 'text-slate-900 font-semibold' : 'text-slate-500'}`}>
        {label}
      </span>
    </button>
  );

  return (
    <div className="mb-4" data-testid="professional-stories">
      <div className="flex items-center gap-3 overflow-x-auto pb-1 scrollbar-hide -mx-4 lg:-mx-6 px-4 lg:px-6">
        <Circle
          isAll
          active={activeId === 'todos'}
          onClick={() => onPick('todos')}
          label="Todos"
        />
        {actives.map(p => (
          <Circle
            key={p.id}
            item={p}
            active={activeId === p.id}
            onClick={() => onPick(p.id)}
            label={p.name?.split(' ')[0] || p.name}
          />
        ))}
      </div>
    </div>
  );
};

/* ========== MOBILE BOTTOM NAV ========== */
const MobileBottomNav = ({ activePage, setActivePage, onOpenMenu, hasFeature }) => {
  const items = [
    { key: 'agenda', label: 'Agenda', icon: CalendarCheck, feat: 'agenda' },
    { key: 'clientes', label: 'Clientes', icon: Users, feat: 'clientes' },
    { key: '__menu', label: 'Menu', icon: Menu, action: onOpenMenu, always: true },
    { key: 'conexoes', label: 'Notificacoes', icon: Bell, feat: 'conexoes' },
    { key: 'financeiro', label: 'Financeiro', icon: DollarSign, feat: 'financeiro' },
  ];

  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-40 flex items-stretch justify-around px-1 pt-1 pb-[env(safe-area-inset-bottom,0)]"
      data-testid="mobile-bottom-nav"
    >
      {items.map(item => {
        // Hide items the user doesn't have access to (but always show Menu)
        if (!item.always && item.feat && !hasFeature(item.feat)) {
          return <div key={item.key} className="flex-1" />;
        }
        const Icon = item.icon;
        const isActive = !item.action && activePage === item.key;
        const isMenu = item.key === '__menu';
        return (
          <button
            key={item.key}
            onClick={() => (item.action ? item.action() : setActivePage(item.key))}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 transition-colors ${
              isActive ? 'text-[var(--primary-color)]' : 'text-slate-500'
            }`}
            data-testid={`bottom-nav-${item.key}`}
          >
            {isMenu ? (
              <span className="w-10 h-10 rounded-full bg-[var(--primary-color)]/10 flex items-center justify-center">
                <Icon className="w-5 h-5 text-[var(--primary-color)]" />
              </span>
            ) : (
              <Icon className="w-5 h-5" />
            )}
            <span className="text-[10px] font-medium">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
};

/* ========== MOBILE MENU SHEET (all options as cards) ========== */
const MobileMenuSheet = ({ menuGroups, activePage, onPick, onClose, onLogout }) => {
  const { user } = useAuth();
  return (
    <div
      className="fixed inset-0 bg-slate-900/40 z-50 lg:hidden flex items-end"
      onClick={onClose}
      data-testid="mobile-menu-sheet"
    >
      <div
        className="w-full bg-white rounded-t-3xl max-h-[90vh] overflow-hidden flex flex-col animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-page-title text-slate-900">{user?.company?.name || 'Menu'}</h3>
            <p className="text-[11px] text-slate-500">Todas as opcoes do sistema</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-4">
          {Object.entries(menuGroups).map(([groupName, items]) => (
            <div key={groupName} className="mb-5">
              <p className="text-[10px] uppercase tracking-widest font-bold text-slate-400 px-1 mb-2">{groupName}</p>
              <div className="grid grid-cols-2 gap-2">
                {items.map(it => {
                  const Icon = ICON_MAP[it.icon] || LayoutDashboard;
                  const active = activePage === it.key;
                  return (
                    <button
                      key={it.key}
                      onClick={() => onPick(it.key)}
                      className={`flex flex-col items-center justify-center gap-1.5 py-4 rounded-xl border transition-all ${
                        active
                          ? 'border-[var(--primary-color)] bg-[var(--primary-color)]/5 text-[var(--primary-color)]'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                      }`}
                      data-testid={`menu-sheet-${it.key}`}
                    >
                      <Icon className="w-6 h-6" />
                      <span className="text-xs font-medium">{it.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="p-3 border-t border-slate-100 bg-slate-50">
          <button
            onClick={() => { onClose(); onLogout(); }}
            className="w-full btn-secondary text-sm flex items-center justify-center gap-2"
          >
            <LogOut className="w-4 h-4" /> Sair
          </button>
        </div>
      </div>
    </div>
  );
};


const PageContent = ({ page, hasFeature, setActivePage, menuGroups }) => {
  if (!page) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-sm text-slate-400">Carregando...</div>
      </div>
    );
  }
  switch (page) {
    case 'dashboard': return <DashboardPage setActivePage={setActivePage} menuGroups={menuGroups} />;
    case 'kanban': return <KanbanPage setActivePage={setActivePage} />;
    case 'atendimentos': return <AtendimentosPage />;
    case 'contatos': return <ContactsPage />;
    case 'respostas_rapidas': return <QuickResponsesPage />;
    case 'campanhas': return <CampaignsPage />;
    case 'tags': return <TagsPage />;
    case 'flowbuilder': return <FlowBuilderPage />;
    case 'agente_ia': return <AIPage />;
    case 'conexoes': return <ConexoesPage />;
    case 'chat_interno': return <ChatInternoPage />;
    case 'filas_chatbot': return <QueuesPage />;
    case 'calendario': return <CalendarPageFull />;
    case 'agenda': return <AgendaPage />;
    case 'agendamentos': return <MessageSchedulingPage />;
    case 'clientes': return <ClientsPage />;
    case 'servicos_produtos': return <ServicesPageFull />;
    case 'profissionais': return <ProfessionalsPageFull />;
    case 'assinaturas': return <SubscriptionsPageFull />;
    case 'planos': return <PlanosPageFull />;
    case 'categorias': return <CategoriesPage />;
    case 'meu_site': return <MySitePage />;
    case 'financeiro': return <FinanceiroPage />;
    case 'comissoes': return <ComissoesPage />;
    case 'notificacoes': return <ConexoesPage initialTab="notificacoes" />;
    case 'relatorios': return <FinanceiroPage />;
    case 'configuracoes': return <ConfigPage />;
    case 'indoor': return <IndoorSettingsPage />;
    case 'usuarios': return <UsuariosPage />;
    case 'perfis_acesso': return <PerfisAcessoPage />;
    default: return <PlaceholderPage title={FEATURE_META[page]?.label || page} />;
  }
};

/* ========== USER HEADER MENU ========== */
const UserHeaderMenu = ({ user, logout }) => {
  const [open, setOpen] = useState(false);
  const [showSuspend, setShowSuspend] = useState(false);
  const [suspendType, setSuspendType] = useState('days');
  const [suspendForm, setSuspendForm] = useState({ start_date: '', end_date: '', start_time: '', end_time: '', reason: '' });

  const handleSuspend = async () => {
    if (!suspendForm.start_date) { toast.error('Informe a data'); return; }
    const payload = { start_date: suspendForm.start_date, end_date: suspendType === 'hours' ? suspendForm.start_date : (suspendForm.end_date || suspendForm.start_date), reason: suspendForm.reason || '' };
    if (suspendType === 'hours') { payload.start_time = suspendForm.start_time; payload.end_time = suspendForm.end_time; }
    try {
      const profs = await schedulingAPI.getProfessionals();
      const myProf = profs.data.find(p => p.email === user?.email || p.name === user?.name);
      if (myProf) { await schedulingAPI.addSuspension(myProf.id, payload); toast.success('Agenda suspensa!'); }
      else { toast.error('Profissional nao encontrado'); }
      setShowSuspend(false);
      setSuspendForm({ start_date: '', end_date: '', start_time: '', end_time: '', reason: '' });
    } catch (e) { toast.error('Erro ao suspender'); }
  };

  return (
    <>
      <div className="relative">
        <button onClick={() => setOpen(!open)} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-100 transition-colors" data-testid="user-menu-btn">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm flex-shrink-0">
            {user?.name?.[0]?.toUpperCase() || 'U'}
          </div>
          <div className="text-left hidden sm:block">
            <p className="text-sm font-medium text-slate-900 leading-tight truncate max-w-[120px]">{user?.name}</p>
            <p className="text-[10px] text-slate-500 truncate max-w-[120px]">{user?.company?.name}</p>
          </div>
          <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform flex-shrink-0 ${open ? 'rotate-90' : ''}`} />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-xl shadow-xl border border-slate-200 py-2 z-50" data-testid="user-dropdown">
              <div className="px-4 py-2 border-b border-slate-100">
                <p className="text-sm font-medium text-slate-900 truncate">{user?.name}</p>
                <p className="text-xs text-slate-500 truncate">{user?.email}</p>
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

      {showSuspend && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center"
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
          data-testid="suspend-modal-overlay"
        >
          <div
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            onClick={() => setShowSuspend(false)}
          />
          <div
            className="relative bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl flex flex-col"
            style={{ maxHeight: '90vh' }}
            data-testid="suspend-modal"
          >
            {/* Handle bar for mobile */}
            <div className="sm:hidden w-full flex justify-center pt-2 pb-1">
              <div className="w-10 h-1 rounded-full bg-slate-300" />
            </div>
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-page-title">Suspender Agenda</h3>
                <p className="text-xs text-slate-500">Escolha o tipo de suspensao</p>
              </div>
              <button onClick={() => setShowSuspend(false)} className="p-1.5 rounded-lg hover:bg-slate-100" data-testid="close-suspend-modal">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {/* Type selector */}
              <div className="flex bg-slate-100 rounded-lg p-0.5" data-testid="suspend-type-tabs">
                {[{k:'days',l:'Dias'},{k:'day',l:'Dia Inteiro'},{k:'hours',l:'Horas'}].map(t => (
                  <button key={t.k} onClick={() => setSuspendType(t.k)} className={`flex-1 py-2 rounded-md text-xs font-semibold transition-all ${suspendType===t.k?'bg-white shadow-sm text-slate-900':'text-slate-500'}`} data-testid={`suspend-type-${t.k}`}>{t.l}</button>
                ))}
              </div>

              {suspendType === 'days' && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">De</label>
                    <input type="date" value={suspendForm.start_date} onChange={e => setSuspendForm({...suspendForm, start_date: e.target.value})} className="input-field text-sm !py-2 w-full" data-testid="suspend-start" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Ate</label>
                    <input type="date" value={suspendForm.end_date} onChange={e => setSuspendForm({...suspendForm, end_date: e.target.value})} className="input-field text-sm !py-2 w-full" data-testid="suspend-end" />
                  </div>
                </div>
              )}

              {suspendType === 'day' && (
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Data</label>
                  <input type="date" value={suspendForm.start_date} onChange={e => setSuspendForm({...suspendForm, start_date: e.target.value, end_date: e.target.value})} className="input-field text-sm !py-2 w-full" data-testid="suspend-day-date" />
                </div>
              )}

              {suspendType === 'hours' && (
                <>
                  <div>
                    <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Data</label>
                    <input type="date" value={suspendForm.start_date} onChange={e => setSuspendForm({...suspendForm, start_date: e.target.value})} className="input-field text-sm !py-2 w-full" data-testid="suspend-hours-date" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">De</label>
                      <input type="time" value={suspendForm.start_time} onChange={e => setSuspendForm({...suspendForm, start_time: e.target.value})} className="input-field text-sm !py-2 w-full" data-testid="suspend-start-time" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Ate</label>
                      <input type="time" value={suspendForm.end_time} onChange={e => setSuspendForm({...suspendForm, end_time: e.target.value})} className="input-field text-sm !py-2 w-full" data-testid="suspend-end-time" />
                    </div>
                  </div>
                </>
              )}

              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Motivo (opcional)</label>
                <input value={suspendForm.reason} onChange={e => setSuspendForm({...suspendForm, reason: e.target.value})} placeholder="Ex: Ferias, consulta..." className="input-field text-sm !py-2" data-testid="suspend-reason" />
              </div>
            </div>

            <div className="flex gap-2 p-4 border-t border-slate-100 bg-white">
              <button onClick={() => setShowSuspend(false)} className="btn-secondary flex-1 text-sm">Cancelar</button>
              <button onClick={handleSuspend} className="btn-primary flex-1 text-sm" data-testid="confirm-suspend-btn">Suspender</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

/* ========== INICIO (MENU DE ATALHOS) ========== */
const DashboardPage = ({ setActivePage, menuGroups }) => {
  const [data, setData] = useState({ tickets: 0, appointments: 0, services: 0, professionals: 0, today: 0 });
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    Promise.all([
      crmAPI.getTickets().catch(() => ({ data: [] })),
      schedulingAPI.getAppointments().catch(() => ({ data: [] })),
      schedulingAPI.getServices().catch(() => ({ data: [] })),
      schedulingAPI.getProfessionals().catch(() => ({ data: [] })),
    ]).then(([t, a, s, p]) => setData({
      tickets: t.data.length,
      appointments: a.data.length,
      services: s.data.length,
      professionals: p.data.length,
      today: a.data.filter(x => x.date === today).length,
    }));
  }, []);

  // Flatten menu groups into ordered list (excluding 'dashboard' itself)
  const shortcuts = useMemo(() => {
    if (!menuGroups) return [];
    const list = [];
    Object.entries(menuGroups).forEach(([group, items]) => {
      items.forEach(it => { if (it.key !== 'dashboard') list.push({ ...it, group }); });
    });
    return list;
  }, [menuGroups]);

  return (
    <div className="animate-fade-in space-y-6" data-testid="dashboard-page">
      {/* Quick Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Agend. Hoje" value={data.today} icon={<CalendarCheck className="w-5 h-5" />} color="bg-emerald-500" />
        <StatCard label="Tickets" value={data.tickets} icon={<Headphones className="w-5 h-5" />} color="bg-blue-500" />
        <StatCard label="Servicos" value={data.services} icon={<Scissors className="w-5 h-5" />} color="bg-violet-500" />
        <StatCard label="Profissionais" value={data.professionals} icon={<Briefcase className="w-5 h-5" />} color="bg-amber-500" />
      </div>

      {/* Menu Grid */}
      {shortcuts.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 mb-3">Acesso Rapido</p>
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3" data-testid="home-menu-grid">
            {shortcuts.map(item => {
              const Icon = ICON_MAP[item.icon] || LayoutDashboard;
              return (
                <button
                  key={item.key}
                  onClick={() => setActivePage(item.key)}
                  className="group flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-white border border-slate-200 hover:border-primary/50 hover:shadow-md active:scale-95 transition-all"
                  data-testid={`home-shortcut-${item.key}`}
                >
                  <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-white transition-colors">
                    <Icon className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-medium text-slate-700 text-center leading-tight line-clamp-2">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

/* ========== KANBAN WITH DRAG AND DROP ========== */
// eslint-disable-next-line no-unused-vars
const _KanbanPageOld = () => {
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
  const [expandedId, setExpandedId] = useState(null);
  const [historyByPhone, setHistoryByPhone] = useState({});
  const [bookingClientId, setBookingClientId] = useState(null);
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
    const list = res.data.filter(a => a.customer_phone === phone).sort((a,b) => b.date.localeCompare(a.date));
    setHistoryByPhone(h => ({ ...h, [phone]: list }));
  };

  const handleToggleExpand = (client) => {
    if (expandedId === client.id) {
      setExpandedId(null);
      setBookingClientId(null);
    } else {
      setExpandedId(client.id);
      setBookingClientId(null);
      if (!historyByPhone[client.phone]) loadHistory(client.phone);
    }
  };

  const handleSaveClient = async (form) => {
    try {
      if (editingClient) {
        await schedulingAPI.updateClient(editingClient.id, form);
        toast.success('Cliente atualizado!');
        setShowAdd(false); setEditingClient(null); load();
      } else {
        const res = await schedulingAPI.createClient(form);
        toast.success('Cliente criado!');
        setShowAdd(false); setEditingClient(null);
        await load();
        // Auto-expand new client and prompt to book
        const newClient = res.data;
        if (newClient?.id) {
          setExpandedId(newClient.id);
          setBookingClientId(newClient.id);
          if (!historyByPhone[newClient.phone]) loadHistory(newClient.phone);
          toast('Deseja agendar agora?', { description: 'Preencha os dados abaixo' });
        }
      }
    } catch (e) { toast.error(e.response?.data?.detail || 'Erro'); }
  };

  const handleDeleteClient = async (id) => {
    if (!window.confirm('Excluir este cliente?')) return;
    try {
      await schedulingAPI.deleteClient(id);
      toast.success('Excluido!');
      setExpandedId(null);
      load();
    } catch (e) { toast.error('Erro ao excluir'); }
  };

  const handleBookFromClient = async (client, bookForm) => {
    try {
      await schedulingAPI.createAppointment({
        customer_name: client.name,
        customer_phone: client.phone,
        customer_email: client.email || undefined,
        ...bookForm
      });
      toast.success('Agendamento criado!');
      setBookingClientId(null);
      loadHistory(client.phone);
    } catch (e) { toast.error(e.response?.data?.detail || 'Erro ao agendar'); }
  };

  const STATUS_COLORS = { confirmado: 'bg-emerald-100 text-emerald-700', pendente: 'bg-amber-100 text-amber-700', cancelado: 'bg-red-100 text-red-700', concluido: 'bg-blue-100 text-blue-700' };

  return (
    <div className="animate-fade-in" data-testid="clients-page">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-4">
        <p className="text-sm text-slate-600">{clients.length} clientes cadastrados</p>
        <button onClick={() => { setEditingClient(null); setShowAdd(true); }} className="btn-primary flex items-center gap-2 justify-center" data-testid="add-client-btn">
          <Plus className="w-4 h-4" /> Novo Cliente
        </button>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nome ou telefone..." className="input-field pl-10" data-testid="client-search" />
      </div>

      <div className="space-y-2">
        {clients.map(c => {
          const isExpanded = expandedId === c.id;
          const history = historyByPhone[c.phone] || [];
          const isBookingHere = bookingClientId === c.id;
          return (
            <div key={c.id} className={`rounded-xl border bg-white transition-all ${isExpanded ? 'border-primary/40 shadow-sm' : 'border-slate-200'}`} data-testid={`client-card-${c.id}`}>
              <button onClick={() => handleToggleExpand(c)} className="w-full p-3 sm:p-4 flex items-center gap-3 text-left" data-testid={`client-row-${c.id}`}>
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/20 to-primary/40 flex items-center justify-center text-primary font-bold text-sm flex-shrink-0">
                  {c.name?.substring(0,2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">{c.name}</p>
                  <p className="text-xs text-slate-500 truncate">{c.phone}{c.email ? ` • ${c.email}` : ''}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="text-right hidden sm:block">
                    <p className="text-xs text-slate-500">{c.total_appointments || 0} agend.</p>
                    {c.active_subscription && <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Assinante</span>}
                  </div>
                  <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-slate-100 p-3 sm:p-4 space-y-3 animate-fade-in" data-testid={`client-expanded-${c.id}`}>
                  {/* Action buttons */}
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => setBookingClientId(isBookingHere ? null : c.id)} className="btn-primary text-sm flex items-center gap-1.5" data-testid={`book-from-client-btn-${c.id}`}>
                      <Calendar className="w-4 h-4" /> {isBookingHere ? 'Cancelar' : 'Agendar'}
                    </button>
                    <button onClick={() => { setEditingClient(c); setShowAdd(true); }} className="btn-secondary text-sm flex items-center gap-1.5" data-testid={`edit-client-btn-${c.id}`}>
                      <Pencil className="w-4 h-4" /> Editar
                    </button>
                    <button onClick={() => handleDeleteClient(c.id)} className="p-2 rounded-lg border border-red-200 text-red-500 hover:bg-red-50" data-testid={`delete-client-btn-${c.id}`}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {c.notes && <p className="text-xs text-slate-600 bg-slate-50 p-2 rounded-lg">{c.notes}</p>}

                  {/* Client info */}
                  {c.birth_date && (() => {
                    const bd = new Date(c.birth_date);
                    if (isNaN(bd)) return null;
                    const today = new Date();
                    let age = today.getFullYear() - bd.getFullYear();
                    const m = today.getMonth() - bd.getMonth();
                    if (m < 0 || (m === 0 && today.getDate() < bd.getDate())) age--;
                    const formatted = bd.toLocaleDateString('pt-BR');
                    const upcoming = (() => {
                      const thisYr = new Date(today.getFullYear(), bd.getMonth(), bd.getDate());
                      const diffDays = Math.ceil((thisYr - today) / 86400000);
                      if (diffDays >= 0 && diffDays <= 30) return `Aniversário em ${diffDays} dias`;
                      return null;
                    })();
                    return (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 flex items-center gap-1.5">
                          <Calendar className="w-3 h-3" /> {formatted} · {age} anos
                        </span>
                        {upcoming && <span className="px-2.5 py-1 rounded-full bg-pink-100 text-pink-700 font-semibold">🎂 {upcoming}</span>}
                      </div>
                    );
                  })()}

                  {/* Inline Booking Form */}
                  {isBookingHere && (
                    <div className="bg-primary/5 border border-primary/20 rounded-xl p-3" data-testid={`inline-booking-${c.id}`}>
                      <p className="text-xs font-bold uppercase tracking-widest text-primary mb-2">Novo Agendamento</p>
                      <BookFromClientForm services={services} professionals={professionals} onSave={(form) => handleBookFromClient(c, form)} />
                    </div>
                  )}

                  {/* History */}
                  <div>
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Historico de Agendamentos</h4>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {history.map(a => (
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
                      {history.length === 0 && <p className="text-xs text-slate-400 text-center py-4">Sem historico</p>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {clients.length === 0 && <div className="card text-center py-12"><Users className="w-12 h-12 text-slate-300 mx-auto mb-3" /><p className="text-sm text-slate-500">Nenhum cliente encontrado</p></div>}
      </div>

      {/* Add/Edit Client Modal */}
      {showAdd && (
        <Modal title={editingClient ? 'Editar Cliente' : 'Novo Cliente'} onClose={() => { setShowAdd(false); setEditingClient(null); }}>
          <ClientForm client={editingClient} onSave={handleSaveClient} />
        </Modal>
      )}
    </div>
  );
};

const ClientForm = ({ client, onSave }) => {
  const [form, setForm] = useState({
    name: client?.name || '',
    phone: client?.phone || '',
    email: client?.email || '',
    birth_date: client?.birth_date || '',
    notes: client?.notes || ''
  });

  const formatPhone = (v) => {
    const digits = v.replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 2) return digits;
    if (digits.length <= 7) return `(${digits.slice(0,2)}) ${digits.slice(2)}`;
    if (digits.length <= 10) return `(${digits.slice(0,2)}) ${digits.slice(2,6)}-${digits.slice(6)}`;
    return `(${digits.slice(0,2)}) ${digits.slice(2,7)}-${digits.slice(7)}`;
  };

  const age = useMemo(() => {
    if (!form.birth_date) return null;
    const bd = new Date(form.birth_date);
    if (isNaN(bd)) return null;
    const today = new Date();
    let a = today.getFullYear() - bd.getFullYear();
    const m = today.getMonth() - bd.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < bd.getDate())) a--;
    return a;
  }, [form.birth_date]);

  const initials = (form.name || '?').split(' ').slice(0,2).map(p => p[0]).join('').toUpperCase();
  const isValid = form.name.trim().length >= 2 && form.phone.replace(/\D/g,'').length >= 10;

  return (
    <div className="space-y-4" data-testid="client-form">
      {/* Preview card */}
      <div className="flex items-center gap-3 p-3 rounded-2xl bg-gradient-to-br from-primary/8 to-primary/2 border border-primary/15">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-primary/60 text-white font-bold text-lg flex items-center justify-center shadow-sm">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-900 truncate">{form.name || 'Novo cliente'}</p>
          <p className="text-xs text-slate-500 truncate">{form.phone || 'Informe o contato abaixo'}</p>
          {age !== null && age >= 0 && age < 120 && (
            <span className="inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">{age} anos</span>
          )}
        </div>
      </div>

      {/* Dados principais */}
      <div className="space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Dados Principais</p>
        <div className="relative">
          <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            value={form.name}
            onChange={e => setForm({...form, name: e.target.value})}
            placeholder="Nome completo"
            className="input-field !pl-9"
            data-testid="client-name-input"
            autoFocus
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label htmlFor="client-phone" className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block mb-1">Telefone / WhatsApp</label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                id="client-phone"
                value={form.phone}
                onChange={e => setForm({...form, phone: formatPhone(e.target.value)})}
                placeholder="(99) 99999-9999"
                className="input-field !pl-9"
                data-testid="client-phone-input"
                inputMode="tel"
              />
            </div>
          </div>
          <div>
            <label htmlFor="client-birthdate" className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block mb-1">Data de Nascimento</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                id="client-birthdate"
                type="date"
                value={form.birth_date}
                onChange={e => setForm({...form, birth_date: e.target.value})}
                className="input-field !pl-9"
                data-testid="client-birthdate-input"
                max={new Date().toISOString().split('T')[0]}
              />
            </div>
          </div>
        </div>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            value={form.email}
            onChange={e => setForm({...form, email: e.target.value})}
            placeholder="Email (opcional)"
            className="input-field !pl-9"
            type="email"
            data-testid="client-email-input"
          />
        </div>
      </div>

      {/* Observações */}
      <div className="space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Observações</p>
        <textarea
          value={form.notes}
          onChange={e => setForm({...form, notes: e.target.value})}
          placeholder="Preferências, alergias, detalhes relevantes..."
          className="input-field text-sm"
          rows={3}
          data-testid="client-notes-input"
        />
      </div>

      <div className="flex justify-end pt-2 border-t border-slate-100">
        <button
          onClick={() => isValid && onSave(form)}
          disabled={!isValid}
          className="btn-primary text-sm flex items-center gap-2"
          data-testid="save-client-btn"
        >
          <Check className="w-4 h-4" /> Salvar Cliente
        </button>
      </div>
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
// Removed inline CampaignsPage — now imported from ../CRM/CampaignsPage

/* ========== TAGS ========== */
// eslint-disable-next-line no-unused-vars
const _TagsPageOld = () => (
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
// eslint-disable-next-line no-unused-vars
const _AIAgentPageOld = () => {
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
// Soft tints for the whole card background (light + distinctive)
const APT_STATUS_CARD = {
  confirmado: 'bg-emerald-50/70 border-emerald-200',
  pendente:   'bg-amber-50/70 border-amber-200',
  cancelado:  'bg-red-50/50 border-red-200',
  concluido:  'bg-blue-50/70 border-blue-200',
};

const MetricCard = ({ label, value, subtitle, icon, iconBg, iconColor, testId }) => (
  <div
    className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow"
    data-testid={testId}
  >
    <div className="flex items-start justify-between">
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-500 truncate">{label}</p>
        <p className="mt-1 text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums leading-tight">{value}</p>
        <p className="text-[11px] text-slate-400 mt-1 truncate">{subtitle}</p>
      </div>
      <div className={`w-10 h-10 rounded-xl ${iconBg} ${iconColor} flex items-center justify-center flex-shrink-0 ml-2`}>
        {icon}
      </div>
    </div>
  </div>
);

const AgendaPage = () => {
  const { user } = useAuth();
  const hasPerm = (key) => {
    const perms = user?.permissions || [];
    return perms.includes('*') || perms.includes(key) || user?.role === 'company_admin';
  };
  const canEdit = hasPerm('edit_appointment');
  const canEditPrice = hasPerm('edit_appointment_price');

  const [appointments, setAppointments] = useState([]);
  const [services, setServices] = useState([]);
  const [professionals, setProfessionals] = useState([]);
  // Quick filter is driven by the week strip (view date). Default = show the
  // appointments of the selected day from the strip.
  const [filter, setFilter] = useState('hoje');
  const [concludeApt, setConcludeApt] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [finalPrice, setFinalPrice] = useState('');
  const [editApt, setEditApt] = useState(null);

  // New filters
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('todos');
  const [professionalFilter, setProfessionalFilter] = useState('todos');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // New appointment modal
  const [showNewApt, setShowNewApt] = useState(false);

  // Visible date (for the week-strip header). Defaults to today.
  const today = new Date().toISOString().split('T')[0];
  const [viewDate, setViewDate] = useState(today);
  const [showAdvFilters, setShowAdvFilters] = useState(false);

  useEffect(() => {
    load();
    schedulingAPI.getServices().then(r => setServices(r.data)).catch(() => {});
    schedulingAPI.getProfessionals().then(r => setProfessionals(r.data)).catch(() => {});
  }, []);
  const load = async () => { const r = await schedulingAPI.getAppointments(); setAppointments(r.data); };

  // Quick pill filter. 'hoje' now means "the date selected in the header strip".
  const byPill = (a) => {
    if (filter === 'hoje') return a.date === viewDate;
    if (filter === 'pendentes') return a.status === 'pendente';
    if (filter === 'confirmados') return a.status === 'confirmado';
    if (filter === 'concluidos') return a.status === 'concluido';
    return true;
  };
  // Advanced filters on top of pill
  const byAdvanced = (a) => {
    if (statusFilter !== 'todos' && a.status !== statusFilter) return false;
    if (professionalFilter !== 'todos' && a.professional_id !== professionalFilter) return false;
    if (dateFrom && a.date < dateFrom) return false;
    if (dateTo && a.date > dateTo) return false;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const hay = `${a.customer_name || ''} ${a.service_name || ''} ${a.professional_name || ''} ${a.customer_phone || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };
  const filtered = appointments
    .filter(a => byPill(a) && byAdvanced(a))
    .sort((a,b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

  const clearFilters = () => {
    setSearchTerm(''); setStatusFilter('todos'); setProfessionalFilter('todos');
    setDateFrom(''); setDateTo('');
  };
  const hasAnyAdvFilter = searchTerm || statusFilter !== 'todos' || professionalFilter !== 'todos' || dateFrom || dateTo;

  const handleStatusChange = async (id, status) => {
    try { await schedulingAPI.updateAppointment(id, { status }); toast.success('Status atualizado!'); load(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Erro'); }
  };

  const openConclude = (a) => {
    setConcludeApt(a);
    setPaymentMethod('');
    setFinalPrice(String((a.price || 0).toFixed(2)));
  };

  const handleConclude = async () => {
    if (!paymentMethod) { toast.error('Selecione pagamento'); return; }
    try {
      const payload = { payment_method: paymentMethod };
      const numericPrice = parseFloat(finalPrice);
      if (canEditPrice && !isNaN(numericPrice) && numericPrice !== (concludeApt.price || 0)) {
        payload.final_price = numericPrice;
      }
      await schedulingAPI.concludeAppointment(concludeApt.id, payload);
      toast.success('Concluido!');
      setConcludeApt(null); setPaymentMethod(''); setFinalPrice(''); load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Erro ao concluir'); }
  };

  const handleCreateAppointment = async ({ customer, booking }) => {
    try {
      await schedulingAPI.createAppointment({
        customer_name: customer.name,
        customer_phone: customer.phone,
        customer_email: customer.email || undefined,
        ...booking,
      });
      toast.success('Agendamento criado!');
      setShowNewApt(false);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao agendar');
    }
  };

  // Metrics (global, not affected by filters)
  const totalCount = appointments.length;
  const todayCount = appointments.filter(a => a.date === today).length;
  const concludedCount = appointments.filter(a => a.status === 'concluido').length;
  const conclusionRate = totalCount > 0 ? Math.round((concludedCount / totalCount) * 100) : 0;
  const pendingCount = appointments.filter(a => a.status === 'pendente').length;
  const confirmedCount = appointments.filter(a => a.status === 'confirmado').length;
  const todayStr = new Date().toLocaleDateString('pt-BR');

  const FILTERS = [
    {key:'hoje', label:'Hoje', count: todayCount},
    {key:'pendentes', label:'Pendentes', count: pendingCount},
    {key:'confirmados', label:'Confirmados', count: confirmedCount},
    {key:'concluidos', label:'Concluidos'},
    {key:'todos', label:'Todos'}
  ];

  return (
    <div className="animate-fade-in relative" data-testid="agenda-page">
      {/* Week date strip header */}
      <WeekDateStrip
        viewDate={viewDate}
        onPick={(iso) => { setViewDate(iso); setFilter('hoje'); }}
      />

      {/* Stories-style professional filter */}
      <ProfessionalStories
        professionals={professionals}
        activeId={professionalFilter}
        onPick={(id) => setProfessionalFilter(id)}
      />

      {/* Collapsible Advanced Filters */}
      <div className="mb-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <button
            type="button"
            onClick={() => setShowAdvFilters(s => !s)}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900"
            data-testid="toggle-adv-filters"
          >
            <Filter className="w-3.5 h-3.5" />
            Filtros {hasAnyAdvFilter && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-primary" />}
            <ChevronRight className={`w-3.5 h-3.5 transition-transform ${showAdvFilters ? 'rotate-90' : ''}`} />
          </button>
          {hasAnyAdvFilter && (
            <button
              onClick={clearFilters}
              className="text-xs text-slate-500 hover:text-primary font-medium flex items-center gap-1"
              data-testid="agenda-clear-filters"
            >
              <X className="w-3 h-3" /> Limpar
            </button>
          )}
        </div>
        {showAdvFilters && (
          <div
            className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm animate-fade-in"
            data-testid="agenda-filters-card"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
              <div className="relative lg:col-span-2">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  placeholder="Buscar por cliente, servico ou profissional"
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  data-testid="agenda-search"
                />
              </div>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="px-3 py-2 text-sm rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                data-testid="agenda-status-filter"
              >
                <option value="todos">Todos os status</option>
                <option value="pendente">Pendente</option>
                <option value="confirmado">Confirmado</option>
                <option value="concluido">Concluido</option>
                <option value="cancelado">Cancelado</option>
              </select>
              <select
                value={professionalFilter}
                onChange={e => setProfessionalFilter(e.target.value)}
                className="px-3 py-2 text-sm rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                data-testid="agenda-prof-filter"
              >
                <option value="todos">Todos profissionais</option>
                {professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-2 lg:col-span-1">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={e => setDateFrom(e.target.value)}
                  className="px-2 py-2 text-xs rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  data-testid="agenda-date-from"
                />
                <input
                  type="date"
                  value={dateTo}
                  onChange={e => setDateTo(e.target.value)}
                  className="px-2 py-2 text-xs rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  data-testid="agenda-date-to"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Appointment list */}
      <div className="space-y-2">
        {filtered.map(a => {
          const isCancelled = a.status === 'cancelado';
          const isDone = a.status === 'concluido';
          const extraCount = (a.extra_items || []).length;
          return (
            <div key={a.id}
              className={`rounded-xl border overflow-hidden ${APT_STATUS_CARD[a.status] || 'bg-white border-slate-200'} ${isCancelled ? 'opacity-70' : ''}`}
              data-testid={`agenda-item-${a.id}`}>
              <div className="flex flex-wrap sm:flex-nowrap items-stretch">
                <div className={`w-1 flex-shrink-0 ${APT_STATUS_DOT[a.status] || 'bg-slate-300'}`} />
                <div className="flex-1 basis-full sm:basis-auto px-3 py-3 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-bold text-primary tabular-nums leading-none">{a.time}</span>
                    <span className="text-[11px] text-slate-400 leading-none">{a.date?.split('-').reverse().join('/')}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold leading-none ${APT_STATUS_COLORS[a.status] || 'bg-slate-100 text-slate-600'}`}>{a.status}</span>
                  </div>
                  <p className="text-[13px] font-semibold text-slate-900 truncate leading-snug">{a.customer_name}</p>
                  <p className="text-[11px] text-slate-500 truncate leading-snug mt-0.5">
                    {a.service_name}{extraCount > 0 ? ` +${extraCount}` : ''} &middot; {a.professional_name} &middot; R$ {(a.price||0).toFixed(2)}
                  </p>
                  {a.payment_method && <p className="text-[10px] text-emerald-600 font-medium mt-0.5">{a.payment_method.replace('_', ' ')}</p>}
                </div>
                <div className="flex items-center justify-end w-full sm:w-auto px-2 pb-2 sm:py-0 sm:pb-0 flex-shrink-0 gap-1 border-t sm:border-t-0 border-slate-200/60 sm:border-transparent">
                  {!isCancelled && !isDone && canEdit && (
                    <button onClick={() => setEditApt(a)} className="p-1.5 rounded-lg text-slate-400 hover:text-primary hover:bg-primary/10" data-testid={`agenda-edit-${a.id}`} title="Editar">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {a.status === 'pendente' && (
                    <button onClick={() => handleStatusChange(a.id, 'confirmado')}
                      className="px-2.5 py-1.5 rounded-lg bg-emerald-500 text-white text-[11px] font-semibold active:scale-95 transition-transform"
                      data-testid={`agenda-confirm-${a.id}`}>Confirmar</button>
                  )}
                  {a.status === 'confirmado' && (
                    <button onClick={() => openConclude(a)}
                      className="px-2.5 py-1.5 rounded-lg bg-primary text-white text-[11px] font-semibold active:scale-95 transition-transform"
                      data-testid={`agenda-conclude-${a.id}`}>Concluir</button>
                  )}
                  {!isCancelled && !isDone && (
                    <button
                      onClick={async () => {
                        try {
                          await schedulingAPI.sendAppointmentReminder(a.id);
                          toast.success('Lembrete enviado via WhatsApp!');
                        } catch (e) {
                          toast.error(e.response?.data?.detail || 'Erro ao enviar lembrete');
                        }
                      }}
                      className="p-1.5 rounded-lg text-amber-500 hover:bg-amber-50"
                      title="Enviar lembrete com link de confirmacao"
                      data-testid={`agenda-reminder-${a.id}`}
                    >
                      <Bell className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {!isCancelled && !isDone && (
                    <button
                      onClick={() => {
                        const phone = (a.customer_phone || '').replace(/\D/g, '');
                        const normalized = phone.startsWith('55') ? phone : `55${phone}`;
                        const msg = encodeURIComponent(`Ola ${a.customer_name}, sobre seu agendamento de ${a.service_name} no dia ${a.date.split('-').reverse().join('/')} as ${a.time}:`);
                        window.open(`https://wa.me/${normalized}?text=${msg}`, '_blank');
                      }}
                      className="p-1.5 rounded-lg text-emerald-500 hover:bg-emerald-50"
                      title="Abrir conversa no WhatsApp"
                      data-testid={`agenda-wa-${a.id}`}
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {!isCancelled && !isDone && (
                    <button onClick={() => handleStatusChange(a.id, 'cancelado')}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50"
                      data-testid={`agenda-cancel-${a.id}`}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-center py-16">
            <CalendarCheck className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-500">Nenhum agendamento</p>
            <p className="text-xs text-slate-400 mt-0.5">Nao ha agendamentos neste filtro</p>
          </div>
        )}
      </div>

      {/* Edit Appointment Modal */}
      {editApt && (
        <EditAppointmentModal
          appointment={editApt}
          services={services}
          canEditPrice={canEditPrice}
          onClose={() => setEditApt(null)}
          onSaved={() => { setEditApt(null); load(); }}
        />
      )}

      {/* Conclude Payment Modal */}
      {concludeApt && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center" onClick={() => setConcludeApt(null)}>
          <div className="bg-white w-full sm:max-w-sm sm:rounded-2xl rounded-t-2xl" onClick={e => e.stopPropagation()} data-testid="conclude-modal">
            <div className="p-5 border-b border-slate-100">
              <h3 className="text-xl font-page-title">Concluir Atendimento</h3>
              <p className="text-xs text-slate-500 mt-0.5">{concludeApt.customer_name} &middot; {concludeApt.service_name}</p>
            </div>
            <div className="p-5 space-y-4">
              {canEditPrice ? (
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Valor Final (R$)</label>
                  <input type="number" step="0.01" value={finalPrice} onChange={e => setFinalPrice(e.target.value)}
                    className="input-field text-2xl font-bold text-primary text-center !py-3"
                    data-testid="conclude-final-price" />
                </div>
              ) : (
                <div className="text-center py-2">
                  <p className="text-3xl font-bold text-primary">R$ {(concludeApt.price || 0).toFixed(2)}</p>
                </div>
              )}
              <div>
                <p className="text-xs font-semibold text-slate-700 mb-2">Forma de Pagamento</p>
                <div className="grid grid-cols-2 gap-2">
                  {PAYMENT_METHODS.map(m => (
                    <button key={m.key} onClick={() => setPaymentMethod(m.key)}
                      className={`p-3 rounded-xl border-2 text-sm font-medium transition-all ${paymentMethod === m.key ? 'border-primary bg-primary/5 text-primary' : 'border-slate-200 text-slate-600'}`}
                      data-testid={`agenda-payment-${m.key}`}>
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2 p-5 border-t border-slate-100">
              <button onClick={() => setConcludeApt(null)} className="btn-secondary flex-1 text-sm">Cancelar</button>
              <button onClick={handleConclude} disabled={!paymentMethod} className="btn-primary flex-1 text-sm" data-testid="agenda-confirm-conclude-btn">Concluir</button>
            </div>
          </div>
        </div>
      )}

      {/* New Appointment Modal */}
      {showNewApt && (
        <NewAppointmentModal
          services={services}
          professionals={professionals}
          onClose={() => setShowNewApt(false)}
          onSave={handleCreateAppointment}
        />
      )}

      {/* Floating Action Button (Novo agendamento) */}
      <button
        onClick={() => setShowNewApt(true)}
        className="fixed right-4 bottom-24 lg:bottom-8 z-30 w-14 h-14 rounded-full bg-[var(--primary-color)] text-white shadow-xl hover:shadow-2xl flex items-center justify-center transition-all hover:scale-105 active:scale-95"
        data-testid="agenda-new-btn"
        title="Novo agendamento"
      >
        <Plus className="w-6 h-6" />
      </button>
    </div>
  );
};

/* ========== NEW APPOINTMENT MODAL (pick or create client + book) ========== */
const NewAppointmentModal = ({ services, professionals, onClose, onSave }) => {
  const [step, setStep] = useState('pick'); // 'pick' (search/existing) | 'new' (create client)
  const [clients, setClients] = useState([]);
  const [searchCli, setSearchCli] = useState('');
  const [selectedClient, setSelectedClient] = useState(null);
  const [loadingClients, setLoadingClients] = useState(false);

  // new client inline form
  const [newClient, setNewClient] = useState({ name: '', phone: '', email: '' });

  // booking form
  const todayStr = new Date().toISOString().split('T')[0];
  const [book, setBook] = useState({ service_id: '', professional_id: '', date: todayStr, time: '' });

  // Subscription for currently picked client
  const [subInfo, setSubInfo] = useState(null); // { has_subscription, subscription, plan }
  const [useSubscription, setUseSubscription] = useState(false);

  const formatPhone = (v) => {
    const d = v.replace(/\D/g,'').slice(0,11);
    if (d.length <= 2) return d;
    if (d.length <= 7) return `(${d.slice(0,2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
    return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  };

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoadingClients(true);
      try {
        const res = await schedulingAPI.getClients({ search: searchCli || undefined });
        if (!cancelled) setClients(res.data.slice(0, 8));
      } catch { /* noop */ }
      if (!cancelled) setLoadingClients(false);
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [searchCli]);

  // Lookup subscription whenever selected client changes
  useEffect(() => {
    const phone = step === 'pick' ? selectedClient?.phone : newClient.phone;
    if (!phone || phone.replace(/\D/g,'').length < 10) {
      setSubInfo(null); setUseSubscription(false); return;
    }
    let cancelled = false;
    schedulingAPI.lookupClientSubscription(phone).then(r => {
      if (cancelled) return;
      setSubInfo(r.data);
      if (r.data?.has_subscription) setUseSubscription(true);
      else setUseSubscription(false);
    }).catch(() => {
      if (!cancelled) { setSubInfo(null); setUseSubscription(false); }
    });
    return () => { cancelled = true; };
  }, [selectedClient, newClient.phone, step]);

  const pickExisting = (c) => {
    setSelectedClient({ name: c.name, phone: c.phone, email: c.email || '', id: c.id });
  };

  const handleSubmit = async () => {
    let customer = null;
    if (step === 'new') {
      if (!newClient.name.trim() || newClient.phone.replace(/\D/g,'').length < 10) {
        toast.error('Informe nome e telefone validos'); return;
      }
      try {
        const created = await schedulingAPI.createClient(newClient);
        customer = { name: created.data.name, phone: created.data.phone, email: created.data.email };
        toast.success('Cliente cadastrado!');
      } catch (e) {
        toast.error(e.response?.data?.detail || 'Erro ao cadastrar cliente'); return;
      }
    } else {
      if (!selectedClient) { toast.error('Selecione um cliente'); return; }
      customer = selectedClient;
    }
    if (!book.service_id || !book.professional_id || !book.date || !book.time) {
      toast.error('Preencha servico, profissional, data e hora'); return;
    }
    onSave({ customer, booking: { ...book, use_subscription: !!useSubscription } });
  };

  const ready = (step === 'new'
      ? (newClient.name.trim().length >= 2 && newClient.phone.replace(/\D/g,'').length >= 10)
      : !!selectedClient
    ) && book.service_id && book.professional_id && book.date && book.time;

  return createPortal(
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl max-h-[92vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
        data-testid="new-appointment-modal"
      >
        <div className="p-5 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
          <div>
            <h3 className="text-xl font-page-title text-slate-900">Novo Agendamento</h3>
            <p className="text-xs text-slate-500 mt-0.5">Escolha um cliente ou cadastre um novo</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100" data-testid="new-apt-close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto overflow-x-hidden flex-1 p-5 space-y-5 min-w-0">
          {/* Step toggle */}
          <div className="flex gap-2 p-1 rounded-xl bg-slate-100">
            <button
              onClick={() => { setStep('pick'); }}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${step==='pick' ? 'bg-white text-primary shadow-sm' : 'text-slate-500'}`}
              data-testid="step-pick"
            >
              Cliente existente
            </button>
            <button
              onClick={() => { setStep('new'); setSelectedClient(null); }}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${step==='new' ? 'bg-white text-primary shadow-sm' : 'text-slate-500'}`}
              data-testid="step-new"
            >
              Novo cliente
            </button>
          </div>

          {/* Step content */}
          {step === 'pick' ? (
            <div className="space-y-3">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={searchCli}
                  onChange={e => setSearchCli(e.target.value)}
                  placeholder="Buscar por nome ou telefone"
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
                  data-testid="new-apt-client-search"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {loadingClients && <p className="text-xs text-slate-400 text-center py-3">Buscando...</p>}
                {!loadingClients && clients.length === 0 && (
                  <div className="text-center py-4">
                    <p className="text-xs text-slate-500">Nenhum cliente encontrado</p>
                    <button onClick={() => setStep('new')} className="text-xs font-semibold text-primary mt-1">
                      + Cadastrar novo
                    </button>
                  </div>
                )}
                {clients.map(c => {
                  const sel = selectedClient?.id === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => pickExisting(c)}
                      className={`w-full flex items-center gap-3 p-2.5 rounded-lg border transition-all text-left ${sel ? 'border-primary bg-primary/5' : 'border-slate-200 hover:border-slate-300'}`}
                      data-testid={`new-apt-client-opt-${c.id}`}
                    >
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary/30 to-primary/60 text-white font-bold text-xs flex items-center justify-center flex-shrink-0">
                        {(c.name || '?').substring(0,2).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-900 truncate">{c.name}</p>
                        <p className="text-[11px] text-slate-500 truncate">{c.phone}</p>
                      </div>
                      {sel && <Check className="w-4 h-4 text-primary flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  value={newClient.name}
                  onChange={e => setNewClient({...newClient, name: e.target.value})}
                  placeholder="Nome completo"
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
                  data-testid="new-apt-newc-name"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    value={newClient.phone}
                    onChange={e => setNewClient({...newClient, phone: formatPhone(e.target.value)})}
                    placeholder="(99) 99999-9999"
                    inputMode="tel"
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
                    data-testid="new-apt-newc-phone"
                  />
                </div>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="email"
                    value={newClient.email}
                    onChange={e => setNewClient({...newClient, email: e.target.value})}
                    placeholder="Email (opcional)"
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
                    data-testid="new-apt-newc-email"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Subscription banner */}
          {subInfo?.has_subscription && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3" data-testid="sub-banner">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-emerald-500 text-white flex items-center justify-center flex-shrink-0">
                  <CreditCard className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-emerald-800">
                    Cliente assinante: {subInfo.plan?.name || 'Plano'}
                  </p>
                  <p className="text-[11px] text-emerald-700 mt-0.5">
                    Creditos restantes: <b>{subInfo.subscription?.credits_remaining ?? 0}</b>
                    {subInfo.subscription?.end_date && (
                      <> &middot; Valido ate {new Date(subInfo.subscription.end_date).toLocaleDateString('pt-BR')}</>
                    )}
                  </p>
                  <label className="mt-2 flex items-center gap-2 cursor-pointer" data-testid="sub-toggle-label">
                    <input
                      type="checkbox"
                      checked={useSubscription}
                      onChange={e => setUseSubscription(e.target.checked)}
                      className="w-4 h-4 rounded border-emerald-400 text-emerald-600 focus:ring-emerald-500"
                      data-testid="sub-use-toggle"
                    />
                    <span className="text-sm font-medium text-emerald-900">
                      {useSubscription
                        ? 'Usar creditos da assinatura (valor R$ 0,00)'
                        : 'Cobrar valor normal do servico (sem debitar creditos)'}
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Booking section */}
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Detalhes do Agendamento</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0">
              <select
                value={book.service_id}
                onChange={e => setBook({...book, service_id: e.target.value})}
                className="w-full min-w-0 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
                data-testid="new-apt-service"
              >
                <option value="">Servico...</option>
                {services.filter(s => s.is_active).map(s => (
                  <option key={s.id} value={s.id}>{s.name} - R$ {s.price?.toFixed(2)}</option>
                ))}
              </select>
              <select
                value={book.professional_id}
                onChange={e => setBook({...book, professional_id: e.target.value})}
                className="w-full min-w-0 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
                data-testid="new-apt-prof"
              >
                <option value="">Profissional...</option>
                {professionals.filter(p => p.is_active).map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <input
                type="date"
                value={book.date}
                onChange={e => setBook({...book, date: e.target.value})}
                className="w-full min-w-0 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
                data-testid="new-apt-date"
              />
              <input
                type="time"
                value={book.time}
                onChange={e => setBook({...book, time: e.target.value})}
                className="w-full min-w-0 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
                data-testid="new-apt-time"
              />
            </div>
          </div>
        </div>

        <div className="flex gap-2 p-4 border-t border-slate-100 flex-shrink-0">
          <button onClick={onClose} className="btn-secondary flex-1 text-sm" data-testid="new-apt-cancel">Cancelar</button>
          <button
            onClick={handleSubmit}
            disabled={!ready}
            className="btn-primary flex-1 text-sm disabled:opacity-50"
            data-testid="new-apt-save"
          >
            <Check className="w-4 h-4 inline mr-1" /> Criar Agendamento
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

/* ========== EDIT APPOINTMENT MODAL ========== */
const EditAppointmentModal = ({ appointment, services, canEditPrice, onClose, onSaved }) => {
  const [form, setForm] = useState({
    date: appointment.date,
    time: appointment.time,
    service_id: appointment.service_id,
    price: (appointment.price || 0).toFixed(2),
    extra_items: appointment.extra_items || [],
  });
  const [addSvcId, setAddSvcId] = useState('');
  const [saving, setSaving] = useState(false);

  const basePrice = useMemo(() => {
    const svc = services.find(s => s.id === form.service_id);
    return svc ? svc.price : 0;
  }, [services, form.service_id]);

  const extrasTotal = useMemo(() => form.extra_items.reduce((sum, it) => sum + (it.price || 0), 0), [form.extra_items]);
  const suggestedTotal = basePrice + extrasTotal;

  const handleAddExtra = () => {
    const svc = services.find(s => s.id === addSvcId);
    if (!svc) { toast.error('Selecione um item'); return; }
    setForm(f => ({
      ...f,
      extra_items: [...f.extra_items, { service_id: svc.id, name: svc.name, price: svc.price, type: svc.type || 'service' }],
    }));
    setAddSvcId('');
  };

  const handleRemoveExtra = (idx) => {
    setForm(f => ({ ...f, extra_items: f.extra_items.filter((_, i) => i !== idx) }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        date: form.date,
        time: form.time,
        service_id: form.service_id,
        extra_items: form.extra_items,
      };
      if (canEditPrice) payload.price = parseFloat(form.price) || 0;
      await schedulingAPI.updateAppointment(appointment.id, payload);
      toast.success('Agendamento atualizado!');
      onSaved?.();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao salvar');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()} data-testid="edit-appointment-modal">
        <div className="flex items-center justify-between p-4 border-b border-slate-100 sticky top-0 bg-white">
          <div>
            <h3 className="text-xl font-page-title">Editar Agendamento</h3>
            <p className="text-xs text-slate-500">{appointment.customer_name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 space-y-3">
          {/* Date + Time */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-400">Data</label>
              <input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} className="input-field text-sm !py-2" data-testid="edit-apt-date" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-400">Hora</label>
              <input type="time" value={form.time} onChange={e => setForm({...form, time: e.target.value})} className="input-field text-sm !py-2" data-testid="edit-apt-time" />
            </div>
          </div>

          {/* Service */}
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400">Servico / Produto Principal</label>
            <select value={form.service_id} onChange={e => setForm({...form, service_id: e.target.value, price: (services.find(s=>s.id===e.target.value)?.price || 0).toFixed(2)})} className="input-field text-sm" data-testid="edit-apt-service">
              {services.filter(s => s.is_active !== false).map(s => (
                <option key={s.id} value={s.id}>{s.name} - R$ {(s.price || 0).toFixed(2)}</option>
              ))}
            </select>
          </div>

          {/* Extra items */}
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400">Itens Adicionais</label>
            <div className="space-y-1.5 mb-2">
              {form.extra_items.map((it, i) => (
                <div key={`extra-${i}-${it.service_id}`} className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg" data-testid={`extra-item-${i}`}>
                  <span className="flex-1 text-sm text-slate-900 truncate">{it.name}</span>
                  <span className="text-sm font-semibold text-slate-700">R$ {(it.price || 0).toFixed(2)}</span>
                  <button onClick={() => handleRemoveExtra(i)} className="p-1 text-red-400 hover:text-red-600" data-testid={`remove-extra-${i}`}><X className="w-3.5 h-3.5" /></button>
                </div>
              ))}
              {form.extra_items.length === 0 && <p className="text-[11px] text-slate-400 italic">Nenhum item adicional</p>}
            </div>
            <div className="flex gap-2">
              <select value={addSvcId} onChange={e => setAddSvcId(e.target.value)} className="input-field text-sm flex-1" data-testid="add-extra-select">
                <option value="">+ Adicionar servico ou produto</option>
                {services.filter(s => s.is_active !== false && s.id !== form.service_id).map(s => (
                  <option key={s.id} value={s.id}>{s.name} - R$ {(s.price || 0).toFixed(2)}</option>
                ))}
              </select>
              <button onClick={handleAddExtra} disabled={!addSvcId} className="btn-secondary text-xs px-3" data-testid="add-extra-btn">Add</button>
            </div>
          </div>

          {/* Price */}
          <div className="border-t border-slate-100 pt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold uppercase text-slate-400">Valor Total</span>
              {canEditPrice && parseFloat(form.price) !== suggestedTotal && (
                <button onClick={() => setForm({...form, price: suggestedTotal.toFixed(2)})} className="text-[10px] text-primary font-medium" data-testid="use-suggested-price">
                  Usar sugerido R$ {suggestedTotal.toFixed(2)}
                </button>
              )}
            </div>
            {canEditPrice ? (
              <input type="number" step="0.01" value={form.price} onChange={e => setForm({...form, price: e.target.value})}
                className="input-field text-xl font-bold text-primary text-center !py-2.5" data-testid="edit-apt-price" />
            ) : (
              <p className="text-xl font-bold text-primary text-center py-2">R$ {suggestedTotal.toFixed(2)}</p>
            )}
          </div>
        </div>

        <div className="flex gap-2 p-4 border-t border-slate-100 sticky bottom-0 bg-white">
          <button onClick={onClose} className="btn-secondary flex-1 text-sm">Cancelar</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary flex-1 text-sm" data-testid="save-edit-apt-btn">
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
};


const FILTER_TYPES = [
  { key: 'inactive_days', label: 'Clientes sem atendimento ha X dias', needsDays: true },
  { key: 'never_returned', label: 'Clientes que nao voltaram apos 1o atendimento', needsDays: true },
  { key: 'birthday_month', label: 'Aniversariantes do mes', needsMonth: true },
  { key: 'service', label: 'Clientes de um servico especifico', needsService: true },
  { key: 'all_active', label: 'Todos os clientes ativos' },
];

const REMARK_VARS = ['{nome}', '{empresa}', '{link_agendar}', '{ultimo_atendimento}', '{ultimo_servico}', '{dias_sem_voltar}', '{aniversario}'];

const RemarketingTab = () => {
  const [filterType, setFilterType] = useState('inactive_days');
  const [days, setDays] = useState(45);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [services, setServices] = useState([]);
  const [serviceId, setServiceId] = useState('');
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [message, setMessage] = useState('Ola {nome}! Sentimos sua falta na {empresa}. Faz {dias_sem_voltar} dias desde seu ultimo atendimento ({ultimo_servico} em {ultimo_atendimento}). Que tal voltar? Agende: {link_agendar}');
  const [when, setWhen] = useState('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [sending, setSending] = useState(false);
  const messageRef = React.useRef(null);

  useEffect(() => { schedulingAPI.getServices().then(r => setServices(r.data)).catch(() => {}); }, []);

  const filterCfg = FILTER_TYPES.find(f => f.key === filterType);

  const buildBody = () => ({
    filter_type: filterType,
    inactive_days: filterCfg?.needsDays ? parseInt(days, 10) || 30 : null,
    month: filterCfg?.needsMonth ? parseInt(month, 10) : null,
    service_id: filterCfg?.needsService ? (serviceId || null) : null,
  });

  const loadPreview = async () => {
    if (filterCfg?.needsService && !serviceId) { toast.error('Selecione um servico'); return; }
    setLoadingPreview(true);
    try {
      const r = await channelsAPI.remarketingPreview(buildBody());
      setPreview(r.data);
    } catch (e) {
      toast.error('Erro ao buscar audiencia');
    } finally { setLoadingPreview(false); }
  };

  const insertVar = (v) => {
    const ta = messageRef.current;
    if (!ta) { setMessage(m => m + v); return; }
    const start = ta.selectionStart ?? message.length;
    const end = ta.selectionEnd ?? message.length;
    setMessage(message.slice(0, start) + v + message.slice(end));
    requestAnimationFrame(() => { try { ta.focus(); ta.setSelectionRange(start + v.length, start + v.length); } catch {} });
  };

  const handleSend = async () => {
    if (!message.trim()) { toast.error('Escreva uma mensagem'); return; }
    if (when === 'scheduled' && !scheduledAt) { toast.error('Defina a data/hora do envio'); return; }
    if (!preview || !preview.count) { toast.error('Carregue a previa primeiro'); return; }
    if (!window.confirm(`Confirmar envio para ${preview.count} cliente(s)?`)) return;
    setSending(true);
    try {
      const body = { ...buildBody(), message, when, scheduled_at: when === 'scheduled' ? new Date(scheduledAt).toISOString() : null };
      const r = await channelsAPI.remarketingBulkSend(body);
      toast.success(r.data.message);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao enviar');
    } finally { setSending(false); }
  };

  return (
    <div className="space-y-4" data-testid="remarketing-tab">
      <div className="card !p-4">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">1. Selecione o publico</p>
        <select value={filterType} onChange={e => { setFilterType(e.target.value); setPreview(null); }} className="input-field text-sm" data-testid="filter-type">
          {FILTER_TYPES.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-3 mt-3">
          {filterCfg?.needsDays && (
            <div>
              <label className="text-xs font-medium text-slate-700">Dias minimos sem visita</label>
              <input type="number" min="1" value={days} onChange={e => setDays(e.target.value)} className="input-field text-sm" data-testid="filter-days" />
            </div>
          )}
          {filterCfg?.needsMonth && (
            <div>
              <label className="text-xs font-medium text-slate-700">Mes</label>
              <select value={month} onChange={e => setMonth(e.target.value)} className="input-field text-sm" data-testid="filter-month">
                {['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'].map((m,i) => <option key={i} value={i+1}>{m}</option>)}
              </select>
            </div>
          )}
          {filterCfg?.needsService && (
            <div className="col-span-2">
              <label className="text-xs font-medium text-slate-700">Servico</label>
              <select value={serviceId} onChange={e => setServiceId(e.target.value)} className="input-field text-sm" data-testid="filter-service">
                <option value="">Selecione...</option>
                {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
        </div>
        <button onClick={loadPreview} disabled={loadingPreview} className="btn-secondary text-sm mt-3 w-full" data-testid="preview-audience-btn">
          {loadingPreview ? 'Buscando...' : 'Carregar Previa'}
        </button>
        {preview && (
          <div className="mt-3 p-3 bg-primary/5 rounded-lg border border-primary/10" data-testid="audience-result">
            <p className="text-sm font-semibold text-primary">{preview.count} cliente(s) na audiencia</p>
            <div className="mt-1 max-h-28 overflow-y-auto">
              {preview.audience.slice(0, 8).map(c => (
                <p key={c.id} className="text-xs text-slate-600">{c.name} - {c.phone} {c.days_since !== null && `· ${c.days_since}d`}</p>
              ))}
              {preview.count > 8 && <p className="text-[10px] text-slate-400 mt-1">... e mais {preview.count - 8}</p>}
            </div>
          </div>
        )}
      </div>

      <div className="card !p-4">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">2. Escreva a mensagem</p>
        <textarea ref={messageRef} value={message} onChange={e => setMessage(e.target.value)} rows={5} className="input-field text-sm" data-testid="remarketing-message" />
        <div className="flex flex-wrap gap-1.5 mt-2">
          {REMARK_VARS.map(v => (
            <button key={v} type="button" onClick={() => insertVar(v)} className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-slate-50 text-primary border border-slate-200 hover:bg-slate-100" data-testid={`insert-${v.replace(/[{}]/g,'')}`}>{v}</button>
          ))}
        </div>
      </div>

      <div className="card !p-4">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">3. Quando enviar</p>
        <div className="flex gap-2 mb-3">
          <button onClick={() => setWhen('now')} className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold ${when==='now'?'bg-primary text-white':'bg-slate-100 text-slate-600'}`} data-testid="when-now">Imediato</button>
          <button onClick={() => setWhen('scheduled')} className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold ${when==='scheduled'?'bg-primary text-white':'bg-slate-100 text-slate-600'}`} data-testid="when-scheduled">Agendar</button>
        </div>
        {when === 'scheduled' && (
          <input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} className="input-field text-sm" data-testid="schedule-datetime" />
        )}
        <button onClick={handleSend} disabled={sending || !preview?.count} className="btn-primary text-sm w-full mt-3" data-testid="bulk-send-btn">
          {sending ? 'Enviando...' : (when === 'now' ? `Enviar agora para ${preview?.count || 0} cliente(s)` : `Agendar envio para ${preview?.count || 0} cliente(s)`)}
        </button>
      </div>
    </div>
  );
};

const MessageSchedulingPage = () => {
  const [tab, setTab] = useState('campanha');
  const [messages, setMessages] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ recipient: '', channel: 'whatsapp', message: '', scheduled_at: '' });

  useEffect(() => { loadMessages(); }, []);
  const loadMessages = async () => {
    try { const r = await channelsAPI.getScheduledMessages(); setMessages(r.data); }
    catch (e) {}
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
      <div className="flex bg-slate-100 rounded-lg p-0.5 mb-4 overflow-x-auto">
        <button onClick={() => setTab('campanha')} className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap ${tab==='campanha'?'bg-white shadow-sm text-slate-900':'text-slate-500'}`} data-testid="tab-campanha">📢 Campanha / Remarketing</button>
        <button onClick={() => setTab('agendadas')} className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap ${tab==='agendadas'?'bg-white shadow-sm text-slate-900':'text-slate-500'}`} data-testid="tab-agendadas">📅 Agendadas ({messages.length})</button>
      </div>

      {tab === 'campanha' ? <RemarketingTab /> : (
        <>
          <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
            <p className="text-sm text-slate-600">Mensagens individuais agendadas</p>
            <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2 text-sm" data-testid="new-msg-schedule-btn">
              <Plus className="w-4 h-4" /> Agendar
            </button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
            <div className="card !p-3"><p className="text-xs text-slate-500">Total</p><p className="text-lg font-bold font-heading">{messages.length}</p></div>
            <div className="card !p-3"><p className="text-xs text-slate-500">Pendentes</p><p className="text-lg font-bold font-heading text-amber-600">{messages.filter(m => m.status === 'pendente').length}</p></div>
            <div className="card !p-3"><p className="text-xs text-slate-500">Enviadas</p><p className="text-lg font-bold font-heading text-emerald-600">{messages.filter(m => m.status === 'enviada').length}</p></div>
            <div className="card !p-3"><p className="text-xs text-slate-500">Canceladas</p><p className="text-lg font-bold font-heading text-red-600">{messages.filter(m => m.status === 'cancelada').length}</p></div>
          </div>

          <div className="card">
            {messages.length === 0 ? (
              <div className="text-center py-12">
                <CalendarCheck className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <p className="text-slate-500 text-sm">Nenhuma mensagem agendada</p>
              </div>
            ) : (
              <div className="space-y-2">
                {messages.map(msg => (
                  <div key={msg.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg gap-3">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Phone className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">{msg.recipient_name || msg.recipient}</p>
                        <p className="text-xs text-slate-500 truncate">{msg.message}</p>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs font-medium text-primary whitespace-nowrap">{new Date(msg.scheduled_at).toLocaleString('pt-BR')}</p>
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
        </>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h3 className="text-xl font-page-title">Agendar Mensagem</h3>
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
        <p className="text-sm text-slate-600">Comunicacao da equipe</p>
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
  { key: 'pos_atendimento', label: 'Pos-Atendimento (Pesquisa de Satisfacao)', desc: 'Enviada apos o atendimento concluido. Use {link_avaliacao} para o cliente avaliar com 1-5 estrelas' },
  { key: 'retorno', label: 'Lembrete de Retorno', desc: 'Reativa clientes que nao voltam ha algum tempo. Use {link_agendar} com pre-preenchimento' },
  { key: 'aniversario', label: 'Aniversario', desc: 'Mensagem de aniversario' },
];

const VARIABLES = ['{nome}', '{servico}', '{data}', '{hora}', '{profissional}', '{empresa}', '{valor}', '{link_confirmar}', '{link_cancelar}', '{link_avaliacao}', '{link_agendar}', '{ultimo_atendimento}', '{dias_sem_voltar}', '{ultimo_servico}', '{aniversario}'];

const ConexoesPage = ({ initialTab = 'conexoes' }) => {
  const [tab, setTab] = useState(initialTab);
  const [connections, setConnections] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [serviceHealth, setServiceHealth] = useState(null);

  useEffect(() => { loadData(); }, []);
  useEffect(() => {
    let cancelled = false;
    const checkHealth = async () => {
      try {
        const r = await channelsAPI.getServiceHealth();
        if (!cancelled) setServiceHealth(r.data);
      } catch (e) {
        if (!cancelled) setServiceHealth({ online: false });
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 30000); // poll every 30s
    return () => { cancelled = true; clearInterval(interval); };
  }, []);
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <p className="text-sm text-slate-600">Gerencie canais de comunicacao e mensagens automaticas</p>
        {serviceHealth && (
          <div
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border w-fit ${
              serviceHealth.online
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-red-50 text-red-700 border-red-200'
            }`}
            data-testid="wa-service-health"
            title={serviceHealth.online ? `Latencia ${serviceHealth.latency_ms}ms` : (serviceHealth.error || 'Servico indisponivel')}
          >
            <span className={`w-2 h-2 rounded-full ${serviceHealth.online ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
            {serviceHealth.online
              ? `WhatsApp Online · ${serviceHealth.latency_ms}ms`
              : 'WhatsApp Offline'}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 bg-slate-100 rounded-lg p-1 mb-6 w-fit overflow-x-auto">
        <button onClick={() => setTab('conexoes')} className={`px-4 py-2 rounded-md text-sm font-medium transition-all whitespace-nowrap ${tab==='conexoes'?'bg-white text-slate-900 shadow-sm':'text-slate-500'}`} data-testid="tab-conexoes">Canais</button>
        <button onClick={() => setTab('templates')} className={`px-4 py-2 rounded-md text-sm font-medium transition-all whitespace-nowrap ${tab==='templates'?'bg-white text-slate-900 shadow-sm':'text-slate-500'}`} data-testid="tab-templates">Mensagens Modelo</button>
        <button onClick={() => setTab('notificacoes')} className={`px-4 py-2 rounded-md text-sm font-medium transition-all whitespace-nowrap ${tab==='notificacoes'?'bg-white text-slate-900 shadow-sm':'text-slate-500'}`} data-testid="tab-notificacoes">Configuracao de Notificacao</button>
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

      {tab === 'notificacoes' && <NotificacoesPage embedded />}
    </div>
  );
};


const STATUS_LABEL = { connected: 'Conectado', disconnected: 'Desconectado', connecting: 'Conectando...', waiting_qr: 'Aguardando QR Code' };
const STATUS_COLOR = { connected: 'bg-emerald-500', disconnected: 'bg-slate-400', connecting: 'bg-amber-500 animate-pulse', waiting_qr: 'bg-blue-500 animate-pulse' };

const ConnectionCard = ({ conn, onConnect, onDisconnect, onRemove, onRefresh }) => {
  const [qrData, setQrData] = useState(null);
  const [polling, setPolling] = useState(false);
  const [pollingAttempts, setPollingAttempts] = useState(0);

  useEffect(() => {
    if (conn.status === 'waiting_qr' || conn.status === 'connecting') {
      setPolling(true);
      let attempts = 0;
      const fetchQR = async () => {
        try {
          attempts++;
          setPollingAttempts(attempts);
          const res = await channelsAPI.getConnectionQR(conn.id);
          if (res.data.status === 'connected') {
            setPolling(false); setQrData(null); onRefresh();
            return true; // stop
          } else if (res.data.qr_base64) {
            setQrData(res.data.qr_base64);
          }
          // After 5 failed attempts, auto-try sync (covers the case where Render
          // cold-started and the current instance id no longer matches the DB).
          if (attempts === 5 && !res.data.qr_base64) {
            try {
              const sync = await channelsAPI.syncConnection(conn.id);
              if (sync.data?.status === 'connected') {
                toast.success('Conexao recuperada do servidor!');
                onRefresh();
                return true;
              }
            } catch { /* silent */ }
          }
        } catch (e) {}
        return false;
      };
      // Immediate first poll (don't wait 3s)
      fetchQR();
      const interval = setInterval(async () => {
        const done = await fetchQR();
        if (done) clearInterval(interval);
      }, 3000);
      return () => clearInterval(interval);
    } else {
      setPolling(false); setQrData(null); setPollingAttempts(0);
    }
  }, [conn.status, conn.id]);

  const handleForceReconnect = async () => {
    setQrData(null); setPollingAttempts(0);
    try {
      await channelsAPI.connectChannel(conn.id);
      toast.success('Reiniciando conexao...');
      onRefresh();
    } catch (e) { toast.error('Erro ao reconectar'); }
  };

  const handleSync = async () => {
    try {
      const r = await channelsAPI.syncConnection(conn.id);
      if (r.data?.status === 'connected') {
        toast.success('Sincronizado: WhatsApp ja esta conectado!');
      } else {
        toast.info('Nada para sincronizar. Tente reconectar e escanear o QR.');
      }
      onRefresh();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Falha ao sincronizar');
    }
  };

  const [showImport, setShowImport] = useState(false);
  const [importMode, setImportMode] = useState('all');
  const [importing, setImporting] = useState(false);

  const handleImport = async () => {
    setImporting(true);
    try {
      const r = await channelsAPI.importWaContacts(conn.id, { mode: importMode });
      toast.success(`${r.data.imported} contatos importados (${r.data.new_clients} novos)`);
      setShowImport(false);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Erro ao importar');
    } finally { setImporting(false); }
  };

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
          {conn.status === 'connected' && conn.type === 'whatsapp' && (
            <button
              onClick={() => setShowImport(true)}
              className="text-xs text-emerald-700 hover:text-emerald-800 font-semibold px-2 py-1 rounded-md hover:bg-emerald-50"
              data-testid={`import-contacts-${conn.id}`}
              title="Importar contatos do WhatsApp"
            >
              Importar contatos
            </button>
          )}
          {(conn.status !== 'connected') && (
            <button
              onClick={handleSync}
              className="text-xs text-primary hover:text-primary-dark font-semibold px-2 py-1 rounded-md hover:bg-primary/5"
              data-testid={`sync-${conn.id}`}
              title="Verificar se ja existe uma sessao conectada no servidor"
            >
              Sincronizar
            </button>
          )}
          <button onClick={() => onRemove(conn.id)} className="p-2 rounded-lg hover:bg-red-50 text-red-400"><Trash2 className="w-4 h-4" /></button>
        </div>
      </div>
      {(conn.status === 'waiting_qr' || conn.status === 'connecting') && (
        <div className="mt-4 p-4 bg-slate-50 rounded-xl text-center">
          {qrData ? (
            <div>
              <img src={qrData} alt="QR Code" className="w-48 h-48 mx-auto rounded-lg" data-testid={`qr-img-${conn.id}`} />
              <p className="text-xs text-slate-500 mt-2">Abra o WhatsApp &gt; Aparelhos conectados &gt; Conectar</p>
              <button onClick={handleForceReconnect} className="mt-2 text-[11px] text-primary font-medium hover:underline" data-testid={`reconnect-${conn.id}`}>
                QR expirou? Gerar novo
              </button>
            </div>
          ) : (
            <div className="py-6">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2" />
              <p className="text-xs text-slate-500">Gerando QR Code...{pollingAttempts > 1 ? ` (tentativa ${pollingAttempts})` : ''}</p>
              {pollingAttempts >= 4 && (
                <button onClick={handleForceReconnect} className="mt-3 text-xs text-primary font-medium hover:underline" data-testid={`retry-connect-${conn.id}`}>
                  Demorando demais? Clique para reconectar
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {showImport && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto" onClick={() => setShowImport(false)} data-testid={`import-modal-${conn.id}`}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md my-8" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h3 className="text-base font-bold">Importar Contatos do WhatsApp</h3>
              <button onClick={() => setShowImport(false)} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-slate-500">Escolha quais contatos do seu WhatsApp deseja importar para o CRM:</p>
              <label className="flex items-start gap-2 p-3 rounded-lg border border-slate-200 hover:border-primary cursor-pointer">
                <input type="radio" name="import-mode" value="all" checked={importMode === 'all'} onChange={e => setImportMode(e.target.value)} className="mt-1" data-testid={`import-mode-all-${conn.id}`} />
                <div>
                  <p className="text-sm font-semibold">Todos os contatos</p>
                  <p className="text-[11px] text-slate-500">Importa todos, com e sem nome</p>
                </div>
              </label>
              <label className="flex items-start gap-2 p-3 rounded-lg border border-slate-200 hover:border-primary cursor-pointer">
                <input type="radio" name="import-mode" value="with_name" checked={importMode === 'with_name'} onChange={e => setImportMode(e.target.value)} className="mt-1" data-testid={`import-mode-with-${conn.id}`} />
                <div>
                  <p className="text-sm font-semibold">Apenas com nome cadastrado</p>
                  <p className="text-[11px] text-slate-500">Pula contatos sem nome (apenas numero)</p>
                </div>
              </label>
              <label className="flex items-start gap-2 p-3 rounded-lg border border-slate-200 hover:border-primary cursor-pointer">
                <input type="radio" name="import-mode" value="without_name" checked={importMode === 'without_name'} onChange={e => setImportMode(e.target.value)} className="mt-1" data-testid={`import-mode-without-${conn.id}`} />
                <div>
                  <p className="text-sm font-semibold">Apenas sem nome</p>
                  <p className="text-[11px] text-slate-500">Importa somente os contatos identificados por numero</p>
                </div>
              </label>
              <p className="text-[10px] text-slate-400">Os contatos sao adicionados como Clientes/Leads no CRM. Conversas existentes nao sao importadas — apenas mensagens novas (apos a conexao) sincronizam.</p>
            </div>
            <div className="flex justify-end gap-2 p-3 border-t border-slate-200">
              <button onClick={() => setShowImport(false)} className="btn-secondary text-sm">Cancelar</button>
              <button onClick={handleImport} disabled={importing} className="btn-primary text-sm disabled:opacity-50" data-testid={`do-import-${conn.id}`}>
                {importing ? 'Importando...' : 'Importar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


const TemplateEditor = ({ tmpl, onSave, onCancel }) => {
  const [message, setMessage] = useState(tmpl.message || '');
  const [active, setActive] = useState(tmpl.active);
  const textareaRef = React.useRef(null);

  const insertVar = (variable) => {
    const ta = textareaRef.current;
    if (!ta) {
      setMessage(m => m + variable);
      return;
    }
    const start = ta.selectionStart ?? message.length;
    const end = ta.selectionEnd ?? message.length;
    const next = message.slice(0, start) + variable + message.slice(end);
    setMessage(next);
    // Restore focus + cursor after the inserted variable
    requestAnimationFrame(() => {
      try {
        ta.focus();
        const pos = start + variable.length;
        ta.setSelectionRange(pos, pos);
      } catch { /* ignore */ }
    });
  };

  const isReminder = tmpl.key === 'lembrete';

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-slate-900">{tmpl.label}</p>
      <textarea
        ref={textareaRef}
        value={message}
        onChange={e => setMessage(e.target.value)}
        rows={4}
        className="input-field text-sm"
        placeholder={
          isReminder
            ? 'Ola {nome}, lembrando do seu agendamento de {servico} em {data} as {hora}. Para confirmar clique: {link_confirmar}'
            : 'Ola {nome}, seu agendamento de {servico} foi confirmado para {data} as {hora}.'
        }
        data-testid={`template-msg-${tmpl.key}`}
      />
      <div>
        <p className="text-[11px] font-semibold text-slate-500 mb-1.5">Clique para inserir variavel no texto:</p>
        <div className="flex flex-wrap gap-1.5">
          {VARIABLES.map(v => {
            const isLink = v.includes('link_');
            return (
              <button
                type="button"
                key={v}
                onClick={() => insertVar(v)}
                className={`px-2 py-1 rounded-md text-[11px] font-mono font-medium border transition-colors ${
                  isLink
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                    : 'bg-slate-50 text-primary border-slate-200 hover:bg-slate-100'
                }`}
                data-testid={`var-insert-${v.replace(/[{}]/g, '')}`}
              >
                {v}
              </button>
            );
          })}
        </div>
        {isReminder && (
          <p className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md mt-2 p-2 leading-relaxed">
            <b>Dica:</b> use <code className="font-mono">{'{link_confirmar}'}</code> no lembrete. Quando o cliente clicar no link recebido via WhatsApp, o agendamento e confirmado automaticamente (fica verde na agenda).
          </p>
        )}
      </div>
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
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', description: '' });

  const load = () => schedulingAPI.getCategories().then(r => setItems(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setForm({ name: '', description: '' }); setShowAdd(true); };
  const openEdit = (c) => { setEditing(c); setForm({ name: c.name || '', description: c.description || '' }); setShowAdd(true); };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Informe o nome'); return; }
    try {
      if (editing) {
        await schedulingAPI.updateCategory(editing.id, form);
        toast.success('Categoria atualizada!');
      } else {
        await schedulingAPI.createCategory(form);
        toast.success('Categoria criada!');
      }
      setShowAdd(false); setEditing(null);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Erro ao salvar'); }
  };

  const handleDelete = async (c) => {
    if (!window.confirm(`Excluir a categoria "${c.name}"?\nServicos que usam essa categoria ficarao sem categoria.`)) return;
    try {
      await schedulingAPI.deleteCategory(c.id);
      toast.success('Categoria excluida!');
      load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Erro ao excluir'); }
  };

  return (
    <div className="animate-fade-in" data-testid="categories-page">
      <div className="flex items-center justify-between mb-4">
        <p className="text-slate-600 text-sm">{items.length} categorias</p>
        <button onClick={openNew} className="btn-primary text-sm flex items-center gap-2" data-testid="new-category-btn">
          <Plus className="w-4 h-4" /> Nova Categoria
        </button>
      </div>
      <div className="grid gap-3">
        {items.map(c => (
          <div key={c.id} className="card !p-4 flex items-center justify-between gap-3" data-testid={`category-${c.id}`}>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-sm truncate">{c.name}</p>
              {c.description && <p className="text-xs text-slate-500 mt-1 truncate">{c.description}</p>}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => openEdit(c)}
                className="p-2 rounded-lg hover:bg-slate-100 text-slate-600"
                title="Editar"
                data-testid={`edit-category-${c.id}`}
              >
                <Pencil className="w-4 h-4" />
              </button>
              <button
                onClick={() => handleDelete(c)}
                className="p-2 rounded-lg hover:bg-red-50 text-red-500"
                title="Excluir"
                data-testid={`delete-category-${c.id}`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="card !p-6 text-center text-sm text-slate-500">
            Nenhuma categoria cadastrada.
          </div>
        )}
      </div>
      {showAdd && (
        <Modal title={editing ? 'Editar Categoria' : 'Nova Categoria'} onClose={() => { setShowAdd(false); setEditing(null); }}>
          <div className="space-y-3">
            <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Nome" className="input-field" data-testid="category-name-input" />
            <input value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Descricao (opcional)" className="input-field" />
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => { setShowAdd(false); setEditing(null); }} className="btn-secondary text-sm">Cancelar</button>
            <button onClick={handleSave} className="btn-primary text-sm" data-testid="save-category-btn">Salvar</button>
          </div>
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
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <code className="flex-1 min-w-0 bg-white px-3 py-2 rounded border border-slate-200 text-xs sm:text-sm truncate">{window.location.origin}/{page.slug}/agenda</code>
                <div className="flex gap-2">
                  <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/${page.slug}/agenda`); toast.success('Link copiado!'); }} className="btn-primary text-sm flex-1 sm:flex-initial" data-testid="copy-link-btn">Copiar</button>
                  <a href={`/${page.slug}/agenda`} target="_blank" rel="noopener noreferrer" className="btn-secondary text-sm flex-1 sm:flex-initial text-center">Visualizar</a>
                </div>
              </div>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Login da Empresa</p>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <code className="flex-1 min-w-0 bg-white px-3 py-2 rounded border border-slate-200 text-xs sm:text-sm truncate">{window.location.origin}/{page.slug}/login</code>
                <div className="flex gap-2">
                  <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/${page.slug}/login`); toast.success('Link copiado!'); }} className="btn-primary text-sm flex-1 sm:flex-initial" data-testid="copy-login-link-btn">Copiar</button>
                  <a href={`/${page.slug}/login`} target="_blank" rel="noopener noreferrer" className="btn-secondary text-sm flex-1 sm:flex-initial text-center">Visualizar</a>
                </div>
              </div>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Indoor TV</p>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <code className="flex-1 min-w-0 bg-white px-3 py-2 rounded border border-slate-200 text-xs sm:text-sm truncate">{window.location.origin}/{page.slug}/indoor</code>
                <div className="flex gap-2">
                  <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/${page.slug}/indoor`); toast.success('Link copiado!'); }} className="btn-primary text-sm flex-1 sm:flex-initial" data-testid="copy-indoor-link-btn">Copiar</button>
                  <a href={`/${page.slug}/indoor`} target="_blank" rel="noopener noreferrer" className="btn-secondary text-sm flex-1 sm:flex-initial text-center">Visualizar</a>
                </div>
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

      {/* Form fields on public page */}
      <div className="card">
        <h3 className="font-semibold text-slate-900 mb-3">Campos do formulario publico</h3>
        <p className="text-xs text-slate-500 mb-4">Escolha quais campos o cliente vera ao agendar</p>
        <label className="flex items-center justify-between gap-3 p-3 bg-slate-50 rounded-lg cursor-pointer">
          <div>
            <p className="text-sm font-medium text-slate-800">Exibir campo Email</p>
            <p className="text-xs text-slate-500 mt-0.5">Quando desligado, apenas Telefone e Nome aparecem para o cliente</p>
          </div>
          <input
            type="checkbox"
            checked={page?.show_email_field !== false}
            onChange={(e) => handleColorSave('show_email_field', e.target.checked)}
            className="w-5 h-5 rounded text-[var(--primary-color)] focus:ring-primary"
            data-testid="show-email-toggle"
          />
        </label>
      </div>
    </div>
  );
};

/* ========== FINANCEIRO (REAL) ========== */
const TX_CATEGORIES = {
  entrada: [
    { v: 'servico', label: 'Servico' },
    { v: 'venda_produto', label: 'Venda de produto' },
    { v: 'comissao', label: 'Comissao' },
    { v: 'outros', label: 'Outros' },
  ],
  saida: [
    { v: 'fornecedor', label: 'Fornecedor / Compra' },
    { v: 'salario', label: 'Salario / Comissao paga' },
    { v: 'aluguel', label: 'Aluguel' },
    { v: 'conta', label: 'Conta (luz/agua/internet)' },
    { v: 'imposto', label: 'Imposto' },
    { v: 'manutencao', label: 'Manutencao' },
    { v: 'outros', label: 'Outros' },
  ],
};

const LancamentosView = ({ startDate, endDate, filterMethod, fees, onChanged }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterDirection, setFilterDirection] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const todayIso = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({ direction: 'entrada', description: '', amount: '', payment_method: 'dinheiro', category: 'servico', date: todayIso, due_date: todayIso, status: 'pago', notes: '' });

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      if (filterMethod) params.payment_method = filterMethod;
      if (filterDirection) params.direction = filterDirection;
      if (filterStatus) params.status = filterStatus;
      const r = await schedulingAPI.getFinancialTransactions(params);
      setItems(r.data || []);
    } catch (e) {
      toast.error('Erro ao carregar lancamentos');
    } finally { setLoading(false); }
  }, [startDate, endDate, filterMethod, filterDirection, filterStatus]);

  useEffect(() => { reload(); }, [reload]);

  const openNew = (direction = 'entrada') => {
    setEditing(null);
    setForm({
      direction,
      description: '',
      amount: '',
      payment_method: direction === 'entrada' ? 'dinheiro' : 'dinheiro',
      category: direction === 'entrada' ? 'servico' : 'fornecedor',
      date: todayIso,
      due_date: todayIso,
      status: 'pago',
      notes: '',
    });
    setShowModal(true);
  };

  const openEdit = (it) => {
    setEditing(it);
    setForm({
      direction: it.direction || 'entrada',
      description: it.description || '',
      amount: String(it.amount || ''),
      payment_method: it.payment_method || 'dinheiro',
      category: it.category || 'outros',
      date: it.date || todayIso,
      due_date: it.due_date || it.date || todayIso,
      status: it.status || 'pago',
      notes: it.notes || '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.description.trim()) { toast.error('Informe a descricao'); return; }
    const amount = parseFloat(String(form.amount).replace(',', '.')) || 0;
    if (amount <= 0) { toast.error('Valor deve ser maior que zero'); return; }
    const payload = { ...form, amount };
    try {
      if (editing) {
        await schedulingAPI.updateFinancialTransaction(editing.id, payload);
        toast.success('Lancamento atualizado!');
      } else {
        await schedulingAPI.createFinancialTransaction(payload);
        toast.success('Lancamento criado!');
      }
      setShowModal(false);
      reload();
      onChanged && onChanged();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao salvar');
    }
  };

  const handlePay = async (id) => {
    try {
      await schedulingAPI.payFinancialTransaction(id);
      toast.success('Marcado como pago!');
      reload();
      onChanged && onChanged();
    } catch (e) { toast.error('Erro ao atualizar'); }
  };

  const handleDelete = async (it) => {
    if (!window.confirm(`Excluir o lancamento "${it.description}"?`)) return;
    try {
      await schedulingAPI.deleteFinancialTransaction(it.id);
      toast.success('Removido!');
      reload();
      onChanged && onChanged();
    } catch (e) { toast.error('Erro ao excluir'); }
  };

  // Aggregates for header chips
  const totals = useMemo(() => {
    const out = { entradaPago: 0, entradaPendente: 0, saidaPago: 0, saidaPendente: 0 };
    for (const t of items) {
      const dir = t.direction || 'entrada';
      const st = t.status || 'pago';
      const amt = Number(t.amount || 0);
      if (dir === 'entrada' && st === 'pago') out.entradaPago += amt;
      if (dir === 'entrada' && st === 'pendente') out.entradaPendente += amt;
      if (dir === 'saida' && st === 'pago') out.saidaPago += amt;
      if (dir === 'saida' && st === 'pendente') out.saidaPendente += amt;
    }
    return out;
  }, [items]);

  return (
    <div className="space-y-3" data-testid="lancamentos-view">
      {/* Action bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => openNew('entrada')} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500 text-white text-xs font-semibold shadow-sm hover:bg-emerald-600 active:scale-95 transition-all" data-testid="new-receivable-btn">
          <Plus className="w-3.5 h-3.5" /> Receita
        </button>
        <button onClick={() => openNew('saida')} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-500 text-white text-xs font-semibold shadow-sm hover:bg-rose-600 active:scale-95 transition-all" data-testid="new-payable-btn">
          <Plus className="w-3.5 h-3.5" /> Despesa
        </button>
        <div className="ml-auto flex bg-slate-100 rounded-lg p-0.5 text-[11px]">
          <button onClick={() => setFilterDirection('')} className={`px-2 py-1 rounded-md font-semibold ${!filterDirection ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>Todos</button>
          <button onClick={() => setFilterDirection('entrada')} className={`px-2 py-1 rounded-md font-semibold ${filterDirection==='entrada' ? 'bg-white shadow-sm text-emerald-700' : 'text-slate-500'}`} data-testid="filter-entrada">Entradas</button>
          <button onClick={() => setFilterDirection('saida')} className={`px-2 py-1 rounded-md font-semibold ${filterDirection==='saida' ? 'bg-white shadow-sm text-rose-700' : 'text-slate-500'}`} data-testid="filter-saida">Saidas</button>
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="text-[11px] px-2 py-1 rounded-md bg-slate-100 border-0">
          <option value="">Todos status</option>
          <option value="pago">Pago</option>
          <option value="pendente">Pendente</option>
        </select>
      </div>

      {/* Summary chips */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <div className="p-2 bg-emerald-50 border border-emerald-100 rounded-lg"><p className="text-[10px] uppercase font-bold text-emerald-700">Recebido</p><p className="text-sm font-bold text-emerald-700">R$ {totals.entradaPago.toFixed(2)}</p></div>
        <div className="p-2 bg-emerald-50/60 border border-emerald-100 rounded-lg"><p className="text-[10px] uppercase font-bold text-emerald-600">A Receber</p><p className="text-sm font-bold text-emerald-600">R$ {totals.entradaPendente.toFixed(2)}</p></div>
        <div className="p-2 bg-rose-50 border border-rose-100 rounded-lg"><p className="text-[10px] uppercase font-bold text-rose-700">Pago</p><p className="text-sm font-bold text-rose-700">R$ {totals.saidaPago.toFixed(2)}</p></div>
        <div className="p-2 bg-amber-50 border border-amber-100 rounded-lg"><p className="text-[10px] uppercase font-bold text-amber-700">A Pagar</p><p className="text-sm font-bold text-amber-700">R$ {totals.saidaPendente.toFixed(2)}</p></div>
      </div>

      {/* List */}
      {loading ? (
        <div className="text-center py-12 text-sm text-slate-400">Carregando...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12">
          <DollarSign className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">Nenhum lancamento</p>
          <p className="text-xs text-slate-400 mt-1">Clique em Receita ou Despesa para comecar</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.map(it => {
            const isIn = (it.direction || 'entrada') === 'entrada';
            const isPaid = (it.status || 'pago') === 'pago';
            const dueText = it.due_date ? it.due_date.split('-').reverse().join('/') : '';
            return (
              <div key={it.id} className={`rounded-xl border bg-white p-3 ${isIn ? 'border-l-2 border-l-emerald-400' : 'border-l-2 border-l-rose-400'}`} data-testid={`txn-${it.id}`}>
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-slate-900 truncate">{it.description}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] text-slate-500">{(it.date || '').split('-').reverse().join('/')}</span>
                      {!isPaid && dueText && <span className="text-[10px] text-amber-700">venc. {dueText}</span>}
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold uppercase">{it.category || 'outros'}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${isPaid ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{isPaid ? 'pago' : 'pendente'}</span>
                      {it.payment_method && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{it.payment_method.replace('_',' ')}</span>}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`text-sm font-bold ${isIn ? 'text-emerald-600' : 'text-rose-600'}`}>{isIn ? '+' : '-'} R$ {Number(it.amount || 0).toFixed(2)}</p>
                    <div className="flex justify-end gap-1 mt-1">
                      {!isPaid && (
                        <button onClick={() => handlePay(it.id)} className="text-[10px] px-2 py-0.5 rounded bg-emerald-500 text-white font-semibold" data-testid={`pay-txn-${it.id}`}>Pagar</button>
                      )}
                      <button onClick={() => openEdit(it)} className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-primary" data-testid={`edit-txn-${it.id}`}><Pencil className="w-3 h-3" /></button>
                      {it.manual && (
                        <button onClick={() => handleDelete(it)} className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500" data-testid={`del-txn-${it.id}`}><Trash2 className="w-3 h-3" /></button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-2 sm:p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h3 className="text-base font-bold text-slate-900">{editing ? 'Editar' : 'Novo'} Lancamento</h3>
              <button onClick={() => setShowModal(false)} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-3 overflow-y-auto max-h-[70vh]">
              {/* Direction toggle */}
              <div className="flex bg-slate-100 rounded-lg p-0.5">
                <button onClick={() => setForm({...form, direction: 'entrada', category: 'servico'})} className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${form.direction==='entrada'?'bg-emerald-500 text-white shadow-sm':'text-slate-500'}`} data-testid="modal-direction-entrada">Receita (Entrada)</button>
                <button onClick={() => setForm({...form, direction: 'saida', category: 'fornecedor'})} className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${form.direction==='saida'?'bg-rose-500 text-white shadow-sm':'text-slate-500'}`} data-testid="modal-direction-saida">Despesa (Saida)</button>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400">Descricao</label>
                <input value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder={form.direction === 'entrada' ? 'Ex: Venda de produto' : 'Ex: Conta de luz'} className="input-field text-sm" data-testid="modal-tx-description" />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-400">Valor</label>
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">R$</span>
                    <input type="number" step="0.01" min="0" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} className="input-field text-sm pl-8" data-testid="modal-tx-amount" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-400">Categoria</label>
                  <select value={form.category} onChange={e => setForm({...form, category: e.target.value})} className="input-field text-sm" data-testid="modal-tx-category">
                    {TX_CATEGORIES[form.direction].map(c => <option key={c.v} value={c.v}>{c.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-400">Data</label>
                  <input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} className="input-field text-sm" data-testid="modal-tx-date" />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-400">Vencimento</label>
                  <input type="date" value={form.due_date} onChange={e => setForm({...form, due_date: e.target.value})} className="input-field text-sm" data-testid="modal-tx-duedate" />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400">Forma de pagamento</label>
                <select value={form.payment_method} onChange={e => setForm({...form, payment_method: e.target.value})} className="input-field text-sm" data-testid="modal-tx-method">
                  <option value="dinheiro">Dinheiro</option>
                  <option value="pix">PIX</option>
                  <option value="cartao_credito">Cartao Credito</option>
                  <option value="cartao_debito">Cartao Debito</option>
                  <option value="boleto">Boleto</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="outros">Outros</option>
                </select>
              </div>

              <div className="flex bg-slate-100 rounded-lg p-0.5">
                <button onClick={() => setForm({...form, status: 'pago'})} className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold ${form.status==='pago'?'bg-white shadow-sm text-emerald-700':'text-slate-500'}`} data-testid="modal-tx-status-pago">Pago</button>
                <button onClick={() => setForm({...form, status: 'pendente'})} className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold ${form.status==='pendente'?'bg-white shadow-sm text-amber-700':'text-slate-500'}`} data-testid="modal-tx-status-pendente">{form.direction==='entrada' ? 'A receber' : 'A pagar'}</button>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400">Observacoes (opcional)</label>
                <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} rows={2} className="input-field text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-2 p-3 border-t border-slate-200">
              <button onClick={() => setShowModal(false)} className="btn-secondary text-sm">Cancelar</button>
              <button onClick={handleSave} className="btn-primary text-sm" data-testid="modal-tx-save">{editing ? 'Salvar' : 'Criar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const FinanceiroPage = () => {
  const [summary, setSummary] = useState(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [filterProf, setFilterProf] = useState('');
  const [filterMethod, setFilterMethod] = useState('');
  const [view, setView] = useState('resumo');
  const [showFilters, setShowFilters] = useState(false);
  const [professionals, setProfessionals] = useState([]);
  const [fees, setFees] = useState(null);
  const [feesDraft, setFeesDraft] = useState(null);
  const [savingFees, setSavingFees] = useState(false);

  useEffect(() => { schedulingAPI.getProfessionals().then(r => setProfessionals(r.data)).catch(() => {}); }, []);

  const reloadFees = () => {
    schedulingAPI.getPaymentFees().then(r => { setFees(r.data); setFeesDraft(r.data); }).catch(() => {});
  };
  useEffect(() => { reloadFees(); }, []);

  useEffect(() => {
    const params = {};
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    if (filterMethod) params.payment_method = filterMethod;
    schedulingAPI.getFinancialSummary(params).then(r => setSummary(r.data)).catch(() => {
      reportsAPI.getFinancial(params).then(r => setSummary(r.data)).catch(() => {});
    });
  }, [startDate, endDate, filterMethod, fees]);

  const PAY_LABEL = { dinheiro: 'Dinheiro', pix: 'PIX', cartao_credito: 'Credito', cartao_debito: 'Debito', outros: 'Outros' };
  const PAY_COLOR = { dinheiro: 'bg-emerald-500', pix: 'bg-cyan-500', cartao_credito: 'bg-violet-500', cartao_debito: 'bg-blue-500', outros: 'bg-slate-400' };
  const PAY_BG = { dinheiro: 'bg-emerald-50 text-emerald-700', pix: 'bg-cyan-50 text-cyan-700', cartao_credito: 'bg-violet-50 text-violet-700', cartao_debito: 'bg-blue-50 text-blue-700' };
  const grossByMethod = summary?.by_payment_method_gross || summary?.by_payment_method || {};
  const feeByMethod = summary?.by_payment_method_fee || {};
  const netByMethod = summary?.by_payment_method_net || {};
  const totalGross = summary?.total_gross ?? summary?.total_revenue ?? 0;
  const totalFee = summary?.total_fee ?? 0;
  const totalNet = summary?.total_net ?? totalGross;
  const activeFilters = [startDate, endDate, filterProf, filterMethod].filter(Boolean).length;

  let txns = summary?.transactions || [];
  if (filterProf) txns = txns.filter(t => t.professional_id === filterProf);

  const saveFees = async () => {
    setSavingFees(true);
    try {
      await schedulingAPI.updatePaymentFees(feesDraft || {});
      toast.success('Taxas salvas!');
      reloadFees();
    } catch (e) { toast.error('Erro ao salvar taxas'); }
    finally { setSavingFees(false); }
  };

  return (
    <div className="animate-fade-in" data-testid="financeiro-page">
      {/* Toggle + View */}
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div className="flex bg-slate-100 rounded-lg p-0.5 flex-wrap">
          <button onClick={() => setView('resumo')} className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${view==='resumo'?'bg-white shadow-sm text-slate-900':'text-slate-500'}`} data-testid="fin-view-resumo">Resumo</button>
          <button onClick={() => setView('lancamentos')} className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${view==='lancamentos'?'bg-white shadow-sm text-slate-900':'text-slate-500'}`} data-testid="fin-view-lancamentos">Lancamentos</button>
          <button onClick={() => setView('taxas')} className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${view==='taxas'?'bg-white shadow-sm text-slate-900':'text-slate-500'}`} data-testid="fin-view-taxas">Taxas</button>
        </div>
        {view !== 'taxas' && (
          <button onClick={() => setShowFilters(!showFilters)} className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${activeFilters > 0 ? 'bg-primary/10 text-primary' : 'bg-slate-100 text-slate-600'}`}>
            <Settings className="w-3.5 h-3.5" /> Filtros {activeFilters > 0 && <span className="w-4 h-4 rounded-full bg-primary text-white text-[10px] flex items-center justify-center">{activeFilters}</span>}
          </button>
        )}
      </div>

      {/* Collapsible filters */}
      {showFilters && view !== 'taxas' && (
        <div className="rounded-xl border border-slate-200 bg-white p-3 mb-4 space-y-2 overflow-hidden">
          <div className="grid grid-cols-2 gap-2">
            <div className="min-w-0"><label className="text-[10px] font-bold uppercase text-slate-400">Inicio</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="input-field text-xs !py-1.5 w-full min-w-0" data-testid="fin-start-date" /></div>
            <div className="min-w-0"><label className="text-[10px] font-bold uppercase text-slate-400">Fim</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="input-field text-xs !py-1.5 w-full min-w-0" data-testid="fin-end-date" /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-[10px] font-bold uppercase text-slate-400">Profissional</label>
              <select value={filterProf} onChange={e => setFilterProf(e.target.value)} className="input-field text-xs !py-1.5 w-full" data-testid="fin-prof-filter">
                <option value="">Todos</option>
                {professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></div>
            <div><label className="text-[10px] font-bold uppercase text-slate-400">Forma Pgto</label>
              <select value={filterMethod} onChange={e => setFilterMethod(e.target.value)} className="input-field text-xs !py-1.5 w-full" data-testid="fin-method-filter">
                <option value="">Todas</option>
                <option value="dinheiro">Dinheiro</option><option value="pix">PIX</option>
                <option value="cartao_credito">Credito</option><option value="cartao_debito">Debito</option>
              </select></div>
          </div>
          {activeFilters > 0 && (
            <button onClick={() => { setStartDate(''); setEndDate(''); setFilterProf(''); setFilterMethod(''); }} className="text-xs text-red-500 font-semibold">Limpar filtros</button>
          )}
        </div>
      )}

      {view === 'taxas' ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4" data-testid="fin-fees-card">
          <p className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-1">Taxas das formas de pagamento</p>
          <p className="text-xs text-slate-500 mb-4">As taxas sao deduzidas automaticamente nos calculos do resumo financeiro (Bruto / Taxa / Liquido).</p>
          {feesDraft && (
            <div className="space-y-4">
              {[
                { key: 'pix', label: 'PIX', icon: '⚡', pctK: 'pix_pct', fixedK: 'pix_fixed' },
                { key: 'credit', label: 'Cartao de Credito', icon: '💳', pctK: 'credit_pct', fixedK: 'credit_fixed' },
                { key: 'debit', label: 'Cartao de Debito', icon: '💳', pctK: 'debit_pct', fixedK: 'debit_fixed' },
              ].map(row => (
                <div key={row.key} className="rounded-lg border border-slate-200 p-3" data-testid={`fee-row-${row.key}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-base">{row.icon}</span>
                    <span className="text-sm font-semibold text-slate-900">{row.label}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold uppercase text-slate-400">Taxa %</label>
                      <div className="relative">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={feesDraft[row.pctK] ?? 0}
                          onChange={e => setFeesDraft({ ...feesDraft, [row.pctK]: parseFloat(e.target.value) || 0 })}
                          className="input-field text-sm pr-6"
                          data-testid={`fee-${row.key}-pct`}
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase text-slate-400">Taxa fixa</label>
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">R$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={feesDraft[row.fixedK] ?? 0}
                          onChange={e => setFeesDraft({ ...feesDraft, [row.fixedK]: parseFloat(e.target.value) || 0 })}
                          className="input-field text-sm pl-8"
                          data-testid={`fee-${row.key}-fixed`}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setFeesDraft(fees)} className="btn-secondary text-sm" data-testid="fees-cancel">Cancelar</button>
                <button onClick={saveFees} disabled={savingFees} className="btn-primary text-sm" data-testid="fees-save">{savingFees ? 'Salvando...' : 'Salvar Taxas'}</button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Revenue hero - Bruto / Taxa / Liquido */}
          <div className="rounded-xl bg-gradient-to-r from-primary to-indigo-600 text-white p-4 mb-4" data-testid="fin-hero">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-[10px] font-medium opacity-70 uppercase tracking-wider">Bruto</p>
                <p className="text-xl font-bold font-heading mt-0.5">R$ {totalGross.toFixed(2)}</p>
              </div>
              <div className="border-l border-white/20 pl-3">
                <p className="text-[10px] font-medium opacity-70 uppercase tracking-wider">Taxa</p>
                <p className="text-xl font-bold font-heading mt-0.5 text-rose-200">- R$ {totalFee.toFixed(2)}</p>
              </div>
              <div className="border-l border-white/20 pl-3">
                <p className="text-[10px] font-medium opacity-70 uppercase tracking-wider">Liquido</p>
                <p className="text-xl font-bold font-heading mt-0.5 text-emerald-200">R$ {totalNet.toFixed(2)}</p>
              </div>
            </div>
            <div className="flex gap-4 mt-3 text-xs opacity-80">
              <span>{summary?.transaction_count || 0} transacoes</span>
              <span>Ticket: R$ {summary?.transaction_count ? (totalGross / summary.transaction_count).toFixed(2) : '0.00'}</span>
            </div>
          </div>

          {/* Secondary metrics: Despesas / Lucro / A Receber / A Pagar */}
          {(summary?.total_expenses > 0 || summary?.total_receivable > 0 || summary?.total_payable > 0) && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-4" data-testid="fin-metrics-row">
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Despesas pagas</p>
                <p className="text-base font-bold text-rose-600 mt-0.5">R$ {(summary?.total_expenses || 0).toFixed(2)}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Lucro</p>
                <p className={`text-base font-bold mt-0.5 ${(summary?.total_profit || 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>R$ {(summary?.total_profit || 0).toFixed(2)}</p>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-[10px] font-bold uppercase text-emerald-700 tracking-wider">A receber</p>
                <p className="text-base font-bold text-emerald-700 mt-0.5">R$ {(summary?.total_receivable || 0).toFixed(2)}</p>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-[10px] font-bold uppercase text-amber-700 tracking-wider">A pagar</p>
                <p className="text-base font-bold text-amber-700 mt-0.5">R$ {(summary?.total_payable || 0).toFixed(2)}</p>
              </div>
            </div>
          )}

          {view === 'resumo' ? (
            <>
              {/* Payment methods breakdown */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 mb-4">
                <p className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-3">Por Forma de Pagamento</p>
                {Object.entries(grossByMethod).length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-4">Nenhuma transacao registrada</p>
                ) : (
                  <div className="space-y-3">
                    {Object.entries(grossByMethod).map(([method, gross]) => {
                      const fee = feeByMethod[method] || 0;
                      const net = netByMethod[method] ?? gross;
                      return (
                        <div key={method}>
                          <div className="flex justify-between mb-1">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${PAY_COLOR[method] || 'bg-slate-400'}`} />
                              <span className="text-xs font-medium text-slate-700 truncate">{PAY_LABEL[method] || method}</span>
                            </div>
                            <div className="flex items-baseline gap-2 flex-shrink-0">
                              {fee > 0 && (
                                <span className="text-[10px] text-rose-500 font-medium">- R$ {fee.toFixed(2)}</span>
                              )}
                              <span className="text-xs font-bold text-emerald-700">R$ {net.toFixed(2)}</span>
                            </div>
                          </div>
                          <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${PAY_COLOR[method] || 'bg-slate-400'}`} style={{ width: `${totalGross ? (gross / totalGross * 100) : 0}%` }} />
                          </div>
                          {fee > 0 && (
                            <p className="text-[10px] text-slate-400 mt-0.5">Bruto R$ {gross.toFixed(2)}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Recent transactions */}
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <p className="text-xs font-bold uppercase text-slate-400 tracking-wider px-4 pt-3 pb-2">Ultimas Transacoes</p>
                <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
                  {txns.slice(0, 20).map(t => (
                    <div key={t.id} className="flex items-center justify-between px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-slate-900 truncate">{t.description}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px] text-slate-400">{t.date?.split('-').reverse().join('/')}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${PAY_BG[t.payment_method] || 'bg-slate-100 text-slate-600'}`}>{PAY_LABEL[t.payment_method] || t.payment_method}</span>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0 ml-3">
                        <span className="text-sm font-bold text-emerald-600">R$ {(t.net_amount ?? t.amount ?? 0).toFixed(2)}</span>
                        {t.fee_amount > 0 && (
                          <p className="text-[10px] text-slate-400">- R$ {(t.fee_amount || 0).toFixed(2)}</p>
                        )}
                      </div>
                    </div>
                  ))}
                  {txns.length === 0 && <p className="text-xs text-slate-400 text-center py-8">Nenhuma transacao</p>}
                </div>
              </div>
            </>
          ) : view === 'lancamentos' ? (
            <LancamentosView
              startDate={startDate}
              endDate={endDate}
              filterMethod={filterMethod}
              filterProf={filterProf}
              fees={fees}
              onChanged={() => {
                // re-trigger summary refresh
                const params = {};
                if (startDate) params.start_date = startDate;
                if (endDate) params.end_date = endDate;
                if (filterMethod) params.payment_method = filterMethod;
                schedulingAPI.getFinancialSummary(params).then(r => setSummary(r.data)).catch(() => {});
              }}
            />
          ) : (
            /* Transaction list view (legacy) */
            <div className="space-y-2">
              {txns.map(t => (
                <div key={t.id} className="rounded-xl border border-slate-200 bg-white p-3 flex items-center gap-3" data-testid={`txn-${t.id}`}>
                  <div className={`w-1 h-10 rounded-full flex-shrink-0 ${PAY_COLOR[t.payment_method] || 'bg-slate-300'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-slate-900 truncate">{t.description}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-slate-400">{t.date?.split('-').reverse().join('/')}</span>
                      <span className="text-[11px] text-slate-500">{t.professional_name || ''}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-emerald-600">R$ {(t.net_amount ?? t.amount ?? 0).toFixed(2)}</p>
                    {t.fee_amount > 0 ? (
                      <p className="text-[10px] text-rose-500">- R$ {t.fee_amount.toFixed(2)} taxa</p>
                    ) : (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${PAY_BG[t.payment_method] || 'bg-slate-100 text-slate-600'}`}>{PAY_LABEL[t.payment_method] || t.payment_method}</span>
                    )}
                  </div>
                </div>
              ))}
              {txns.length === 0 && (
                <div className="text-center py-16">
                  <DollarSign className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-500">Nenhuma transacao</p>
                </div>
              )}
            </div>
          )}
        </>
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
        <p className="text-sm text-slate-600">Relatorio de comissoes por profissional</p>
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
const NotificacoesPage = ({ embedded = false }) => {
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

  const saveReminderMinutes = async (minutes) => {
    const val = Math.max(1, parseInt(minutes, 10) || 0);
    setSettings(s => ({ ...s, reminder_minutes_before: val }));
    try {
      await notificationsAPI.updateSettings({ reminder_minutes_before: val });
      toast.success('Tempo do lembrete atualizado!');
    } catch (e) { toast.error('Erro ao salvar'); }
  };

  const handleSendTest = async () => {
    const res = await notificationsAPI.sendTest();
    toast.success('Notificacao de teste enviada!');
    setHistory(h => [res.data, ...h]);
  };

  const notifTypes = [
    { key: 'booking_confirmation', label: 'Confirmacao de Agendamento', desc: 'Envia mensagem quando agendamento e confirmado' },
    { key: 'booking_reminder_24h', label: 'Lembrete antes do agendamento', desc: 'Envia um lembrete automatico ao cliente antes do horario' },
    { key: 'booking_cancelled', label: 'Cancelamento', desc: 'Envia notificacao quando agendamento e cancelado' },
    { key: 'survey_enabled', label: 'Pesquisa de Satisfacao', desc: 'Envia mensagem com link de avaliacao apos o atendimento concluido' },
    { key: 'return_reminder_enabled', label: 'Lembrete de Retorno', desc: 'Reativa clientes que nao voltam (use no template "retorno")' },
    { key: 'new_client', label: 'Novo Cliente', desc: 'Notifica quando um novo cliente se cadastra' },
    { key: 'daily_summary', label: 'Resumo Diario', desc: 'Envia resumo dos agendamentos do dia seguinte' },
  ];

  const saveSurveyMinutes = async (minutes) => {
    const val = Math.max(1, parseInt(minutes, 10) || 0);
    setSettings(s => ({ ...s, survey_minutes_after: val }));
    try {
      await notificationsAPI.updateSettings({ survey_minutes_after: val });
      toast.success('Tempo da pesquisa atualizado!');
    } catch (e) { toast.error('Erro ao salvar'); }
  };

  const saveReturnDays = async (days) => {
    const val = Math.max(1, parseInt(days, 10) || 0);
    setSettings(s => ({ ...s, return_reminder_days: val }));
    try {
      await notificationsAPI.updateSettings({ return_reminder_days: val });
      toast.success('Periodo de retorno atualizado!');
    } catch (e) { toast.error('Erro ao salvar'); }
  };

  return (
    <div className="animate-fade-in" data-testid="notificacoes-page">
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-slate-600">Configure as notificacoes automaticas da sua empresa</p>
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
                <div key={nt.key} className="p-3 bg-slate-50 rounded-lg">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900">{nt.label}</p>
                      <p className="text-xs text-slate-500">{nt.desc}</p>
                    </div>
                    <button onClick={() => toggleSetting(nt.key)} disabled={saving}
                      className={`w-12 h-6 rounded-full transition-colors relative flex-shrink-0 ${settings?.[nt.key] ? 'bg-primary' : 'bg-slate-300'}`}
                      data-testid={`toggle-${nt.key}`}>
                      <div className={`w-5 h-5 rounded-full bg-white shadow-sm absolute top-0.5 transition-all ${settings?.[nt.key] ? 'left-[26px]' : 'left-0.5'}`} />
                    </button>
                  </div>
                  {nt.key === 'booking_reminder_24h' && settings?.booking_reminder_24h && (
                    <div className="mt-3 pt-3 border-t border-slate-200">
                      <label className="text-xs font-semibold text-slate-700 block mb-1.5">Enviar lembrete quanto tempo antes?</label>
                      <div className="flex items-center gap-2 flex-wrap">
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={settings?.reminder_minutes_before ?? 1440}
                          onChange={e => setSettings(s => ({ ...s, reminder_minutes_before: e.target.value }))}
                          onBlur={e => saveReminderMinutes(e.target.value)}
                          className="w-28 px-3 py-1.5 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
                          data-testid="reminder-minutes-input"
                        />
                        <span className="text-xs text-slate-500">minutos antes do horario</span>
                        <div className="flex gap-1.5 ml-auto flex-wrap">
                          {[
                            { label: '30min', v: 30 },
                            { label: '1h', v: 60 },
                            { label: '2h', v: 120 },
                            { label: '24h', v: 1440 },
                          ].map(preset => (
                            <button
                              key={preset.v}
                              onClick={() => saveReminderMinutes(preset.v)}
                              className={`text-[10px] px-2 py-1 rounded-md font-semibold transition-colors ${
                                (settings?.reminder_minutes_before ?? 1440) === preset.v
                                  ? 'bg-primary text-white'
                                  : 'bg-white border border-slate-200 text-slate-600 hover:border-primary hover:text-primary'
                              }`}
                              data-testid={`reminder-preset-${preset.v}`}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  {nt.key === 'survey_enabled' && settings?.survey_enabled && (
                    <div className="mt-3 pt-3 border-t border-slate-200">
                      <label className="text-xs font-semibold text-slate-700 block mb-1.5">Enviar pesquisa quanto tempo apos atendimento?</label>
                      <div className="flex items-center gap-2 flex-wrap">
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={settings?.survey_minutes_after ?? 120}
                          onChange={e => setSettings(s => ({ ...s, survey_minutes_after: e.target.value }))}
                          onBlur={e => saveSurveyMinutes(e.target.value)}
                          className="w-28 px-3 py-1.5 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
                          data-testid="survey-minutes-input"
                        />
                        <span className="text-xs text-slate-500">minutos apos concluir</span>
                        <div className="flex gap-1.5 ml-auto flex-wrap">
                          {[
                            { label: '30min', v: 30 },
                            { label: '1h', v: 60 },
                            { label: '2h', v: 120 },
                            { label: '24h', v: 1440 },
                          ].map(preset => (
                            <button
                              key={preset.v}
                              onClick={() => saveSurveyMinutes(preset.v)}
                              className={`text-[10px] px-2 py-1 rounded-md font-semibold transition-colors ${
                                (settings?.survey_minutes_after ?? 120) === preset.v
                                  ? 'bg-primary text-white'
                                  : 'bg-white border border-slate-200 text-slate-600 hover:border-primary hover:text-primary'
                              }`}
                              data-testid={`survey-preset-${preset.v}`}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <p className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md mt-2 p-2 leading-relaxed">
                        <b>Dica:</b> use a variavel <code className="font-mono">{'{link_avaliacao}'}</code> no template "Pos-Atendimento" para que o cliente possa avaliar o atendimento de 1 a 5 estrelas.
                      </p>
                    </div>
                  )}
                  {nt.key === 'return_reminder_enabled' && settings?.return_reminder_enabled && (
                    <div className="mt-3 pt-3 border-t border-slate-200">
                      <label className="text-xs font-semibold text-slate-700 block mb-1.5">Considerar cliente "ausente" apos quantos dias sem visita?</label>
                      <div className="flex items-center gap-2 flex-wrap">
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={settings?.return_reminder_days ?? 30}
                          onChange={e => setSettings(s => ({ ...s, return_reminder_days: e.target.value }))}
                          onBlur={e => saveReturnDays(e.target.value)}
                          className="w-28 px-3 py-1.5 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
                          data-testid="return-days-input"
                        />
                        <span className="text-xs text-slate-500">dias</span>
                      </div>
                      <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md mt-2 p-2 leading-relaxed">
                        <b>Dica:</b> use a variavel <code className="font-mono">{'{link_agendar}'}</code> no template "Lembrete de Retorno" — o cliente entra ja com nome e telefone preenchidos.
                      </p>
                    </div>
                  )}
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
/* ========== MOBILE PREFERENCES (in Config) ========== */
const MobilePreferencesCard = () => {
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem('sidebar_enabled_mobile') === '1'; } catch { return false; }
  });
  const toggle = (v) => {
    setEnabled(v);
    try { localStorage.setItem('sidebar_enabled_mobile', v ? '1' : '0'); } catch { /* ignore */ }
    toast.success('Preferencia salva. Recarregue a pagina para ver o efeito.');
  };
  return (
    <div className="card max-w-2xl mb-6" data-testid="mobile-prefs-card">
      <h3 className="font-semibold text-slate-900 mb-1">Preferencias do Mobile</h3>
      <p className="text-xs text-slate-500 mb-4">Controla como o painel se comporta em celulares e tablets pequenos.</p>
      <label className="flex items-center justify-between gap-3 p-3 bg-slate-50 rounded-lg cursor-pointer">
        <div>
          <p className="text-sm font-medium text-slate-800">Menu lateral expansivel no mobile</p>
          <p className="text-xs text-slate-500 mt-0.5">Quando desligado (padrao), o rodape com 5 atalhos substitui o menu lateral. Quando ligado, um botao hamburger reaparece no topo para abrir o menu completo.</p>
        </div>
        <input
          type="checkbox"
          checked={enabled}
          onChange={e => toggle(e.target.checked)}
          className="w-5 h-5 rounded text-[var(--primary-color)]"
          data-testid="sidebar-mobile-toggle"
        />
      </label>
    </div>
  );
};


const ConfigPage = () => {
  const { user } = useAuth();
  const [businessHours, setBusinessHours] = useState(null);
  const [saving, setSaving] = useState(false);
  const [bookingPage, setBookingPage] = useState(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoRef = useRef(null);
  const API_BASE = process.env.REACT_APP_BACKEND_URL;

  const DAY_LABELS = { seg: 'Segunda', ter: 'Terca', qua: 'Quarta', qui: 'Quinta', sex: 'Sexta', sab: 'Sabado', dom: 'Domingo' };

  useEffect(() => {
    schedulingAPI.getBusinessHours().then(r => setBusinessHours(r.data)).catch(() => {});
    schedulingAPI.getBookingPage().then(r => setBookingPage(r.data)).catch(() => {});
  }, []);

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

  const handleLogoUpload = async (file) => {
    if (!file) return;
    setUploadingLogo(true);
    try {
      const res = await uploadAPI.uploadBookingImage(file);
      await schedulingAPI.updateBookingPage({ logo_url: res.data.url });
      const updated = await schedulingAPI.getBookingPage();
      setBookingPage(updated.data);
      window.dispatchEvent(new CustomEvent('company-logo-updated'));
      toast.success('Logomarca atualizada!');
    } catch (e) {
      toast.error('Erro ao enviar logomarca');
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleRemoveLogo = async () => {
    try {
      await schedulingAPI.updateBookingPage({ logo_url: null });
      const updated = await schedulingAPI.getBookingPage();
      setBookingPage(updated.data);
      window.dispatchEvent(new CustomEvent('company-logo-updated'));
      toast.success('Logomarca removida');
    } catch (e) { toast.error('Erro ao remover'); }
  };

  return (
    <div className="animate-fade-in" data-testid="config-page">
      {/* Mobile Preferences */}
      <MobilePreferencesCard />

      {/* Logo Global */}
      <div className="card max-w-2xl mb-6" data-testid="config-logo-section">
        <h3 className="font-semibold text-slate-900 mb-2">Logomarca Global</h3>
        <p className="text-xs text-slate-500 mb-4">Esta logo aparecera no painel, no site publico de agendamento e na Indoor TV.</p>
        <input type="file" ref={logoRef} className="hidden" accept="image/*" onChange={(e) => handleLogoUpload(e.target.files[0])} data-testid="config-logo-input" />
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <div className="w-28 h-28 rounded-xl border-2 border-dashed border-slate-300 flex items-center justify-center overflow-hidden bg-slate-50 flex-shrink-0">
            {bookingPage?.logo_url ? (
              <img src={`${API_BASE}${bookingPage.logo_url}`} alt="Logo" className="w-full h-full object-cover" />
            ) : (
              <Image className="w-8 h-8 text-slate-300" />
            )}
          </div>
          <div className="flex-1 w-full flex flex-col sm:flex-row gap-2">
            <button onClick={() => logoRef.current?.click()} disabled={uploadingLogo} className="btn-primary text-sm flex items-center justify-center gap-2" data-testid="config-logo-upload-btn">
              <Upload className="w-4 h-4" />
              {uploadingLogo ? 'Enviando...' : (bookingPage?.logo_url ? 'Trocar Logo' : 'Enviar Logo')}
            </button>
            {bookingPage?.logo_url && (
              <button onClick={handleRemoveLogo} className="btn-secondary text-sm flex items-center justify-center gap-2" data-testid="config-logo-remove-btn">
                <Trash2 className="w-4 h-4" /> Remover
              </button>
            )}
          </div>
        </div>
      </div>

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

/* ========== USUARIOS PAGE (Users/Access Accounts) ========== */
const UsuariosPage = () => {
  const [users, setUsers] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [professionals, setProfessionals] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    const [u, p, pr] = await Promise.all([
      schedulingAPI.getCompanyUsers(),
      schedulingAPI.getPermissionProfiles(),
      schedulingAPI.getProfessionals(),
    ]);
    setUsers(u.data); setProfiles(p.data); setProfessionals(pr.data);
  };
  useEffect(() => { load(); }, []);

  const handleSave = async (form) => {
    try {
      if (editing) {
        const payload = { name: form.name, email: form.email, permission_profile_id: form.permission_profile_id || null, professional_id: form.professional_id || null };
        if (form.password) payload.password = form.password;
        await schedulingAPI.updateCompanyUser(editing.id, payload);
        toast.success('Usuario atualizado!');
      } else {
        if (!form.password) { toast.error('Informe uma senha'); return; }
        await schedulingAPI.createCompanyUser(form);
        toast.success('Usuario criado!');
      }
      setShowAdd(false); setEditing(null); load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Erro'); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Excluir este usuario?')) return;
    try { await schedulingAPI.deleteCompanyUser(id); toast.success('Excluido'); load(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Erro'); }
  };

  const getProfileName = (id) => profiles.find(p => p.id === id)?.name || '-';
  const getProfessionalName = (id) => professionals.find(p => p.id === id)?.name || '-';

  return (
    <div className="animate-fade-in" data-testid="usuarios-page">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-4">
        <p className="text-sm text-slate-600">{users.length} usuarios</p>
        <button onClick={() => { setEditing(null); setShowAdd(true); }} className="btn-primary flex items-center gap-2 justify-center" data-testid="add-user-btn">
          <Plus className="w-4 h-4" /> Novo Usuario
        </button>
      </div>
      <div className="space-y-2">
        {users.map(u => (
          <div key={u.id} className="card !p-4 flex items-center gap-3" data-testid={`user-row-${u.id}`}>
            <div className="w-10 h-10 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center">{u.name?.[0]?.toUpperCase()}</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate">{u.name}</p>
              <p className="text-xs text-slate-500 truncate">{u.email}</p>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {u.role === 'company_admin' && <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium">Admin</span>}
                {u.permission_profile_id && <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{getProfileName(u.permission_profile_id)}</span>}
                {u.professional_id && <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">{getProfessionalName(u.professional_id)}</span>}
              </div>
            </div>
            {u.role !== 'company_admin' && (
              <div className="flex items-center gap-1">
                <button onClick={() => { setEditing(u); setShowAdd(true); }} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400" data-testid={`edit-user-${u.id}`}><Pencil className="w-4 h-4" /></button>
                <button onClick={() => handleDelete(u.id)} className="p-2 rounded-lg hover:bg-red-50 text-red-500" data-testid={`delete-user-${u.id}`}><Trash2 className="w-4 h-4" /></button>
              </div>
            )}
          </div>
        ))}
        {users.length === 0 && <div className="card text-center py-12"><UserCog className="w-10 h-10 text-slate-300 mx-auto mb-2" /><p className="text-sm text-slate-500">Nenhum usuario cadastrado</p></div>}
      </div>

      {showAdd && (
        <Modal title={editing ? 'Editar Usuario' : 'Novo Usuario'} onClose={() => { setShowAdd(false); setEditing(null); }}>
          <UsuarioForm user={editing} profiles={profiles} professionals={professionals} onSave={handleSave} />
        </Modal>
      )}
    </div>
  );
};

const UsuarioForm = ({ user, profiles, professionals, onSave }) => {
  const [form, setForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
    password: '',
    permission_profile_id: user?.permission_profile_id || '',
    professional_id: user?.professional_id || '',
  });
  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs font-bold uppercase text-slate-400">Nome</label>
        <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="input-field" data-testid="user-name-input" />
      </div>
      <div>
        <label className="text-xs font-bold uppercase text-slate-400">Email</label>
        <input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} className="input-field" data-testid="user-email-input" />
      </div>
      <div>
        <label className="text-xs font-bold uppercase text-slate-400">Senha {user ? '(deixe em branco para manter)' : ''}</label>
        <input type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} className="input-field" data-testid="user-password-input" />
      </div>
      <div>
        <label className="text-xs font-bold uppercase text-slate-400">Perfil de Acesso</label>
        <select value={form.permission_profile_id} onChange={e => setForm({...form, permission_profile_id: e.target.value})} className="input-field" data-testid="user-profile-select">
          <option value="">Sem perfil (acesso limitado)</option>
          {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div>
        <label className="text-xs font-bold uppercase text-slate-400">Vincular a Profissional (opcional)</label>
        <select value={form.professional_id} onChange={e => setForm({...form, professional_id: e.target.value})} className="input-field" data-testid="user-prof-select">
          <option value="">Nao vinculado</option>
          {professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="flex justify-end">
        <button onClick={() => form.name && form.email && onSave(form)} className="btn-primary text-sm" data-testid="save-user-btn">Salvar</button>
      </div>
    </div>
  );
};

/* ========== PERFIS DE ACESSO PAGE ========== */
const PerfisAcessoPage = () => {
  const [profiles, setProfiles] = useState([]);
  const [features, setFeatures] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    const [p, f] = await Promise.all([
      schedulingAPI.getPermissionProfiles(),
      schedulingAPI.getAllFeatures(),
    ]);
    setProfiles(p.data); setFeatures(f.data);
  };
  useEffect(() => { load(); }, []);

  const handleSave = async (form) => {
    try {
      if (editing) {
        await schedulingAPI.updatePermissionProfile(editing.id, form);
        toast.success('Perfil atualizado!');
      } else {
        await schedulingAPI.createPermissionProfile(form);
        toast.success('Perfil criado!');
      }
      setShowAdd(false); setEditing(null); load();
    } catch (e) { toast.error('Erro ao salvar'); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Excluir este perfil?')) return;
    try { await schedulingAPI.deletePermissionProfile(id); toast.success('Excluido'); load(); }
    catch (e) { toast.error('Erro'); }
  };

  return (
    <div className="animate-fade-in" data-testid="perfis-acesso-page">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-4">
        <p className="text-sm text-slate-600">{profiles.length} perfis de acesso</p>
        <button onClick={() => { setEditing(null); setShowAdd(true); }} className="btn-primary flex items-center gap-2 justify-center" data-testid="add-profile-btn">
          <Plus className="w-4 h-4" /> Novo Perfil
        </button>
      </div>
      <div className="space-y-2">
        {profiles.map(p => (
          <div key={p.id} className="card !p-4 flex items-center gap-3" data-testid={`profile-row-${p.id}`}>
            <div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center"><Shield className="w-5 h-5" /></div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate">{p.name}</p>
              <p className="text-xs text-slate-500">{(p.permissions || []).length} permissoes</p>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => { setEditing(p); setShowAdd(true); }} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400" data-testid={`edit-profile-${p.id}`}><Pencil className="w-4 h-4" /></button>
              <button onClick={() => handleDelete(p.id)} className="p-2 rounded-lg hover:bg-red-50 text-red-500" data-testid={`delete-profile-${p.id}`}><Trash2 className="w-4 h-4" /></button>
            </div>
          </div>
        ))}
        {profiles.length === 0 && <div className="card text-center py-12"><Shield className="w-10 h-10 text-slate-300 mx-auto mb-2" /><p className="text-sm text-slate-500">Nenhum perfil cadastrado</p></div>}
      </div>

      {showAdd && (
        <Modal title={editing ? 'Editar Perfil' : 'Novo Perfil'} onClose={() => { setShowAdd(false); setEditing(null); }}>
          <PerfilAcessoForm profile={editing} features={features} onSave={handleSave} />
        </Modal>
      )}
    </div>
  );
};

const PerfilAcessoForm = ({ profile, features, onSave }) => {
  const [form, setForm] = useState({
    name: profile?.name || '',
    permissions: profile?.permissions || [],
  });
  const grouped = useMemo(() => {
    const g = {};
    features.forEach(f => {
      if (!g[f.category]) g[f.category] = [];
      g[f.category].push(f);
    });
    return g;
  }, [features]);

  const toggle = (key) => {
    setForm(f => ({
      ...f,
      permissions: f.permissions.includes(key)
        ? f.permissions.filter(k => k !== key)
        : [...f.permissions, key]
    }));
  };

  const toggleAll = (categoryKeys, checked) => {
    setForm(f => {
      const set = new Set(f.permissions);
      categoryKeys.forEach(k => checked ? set.add(k) : set.delete(k));
      return { ...f, permissions: Array.from(set) };
    });
  };

  return (
    <div className="space-y-4 max-h-[60vh] overflow-y-auto">
      <div>
        <label className="text-xs font-bold uppercase text-slate-400">Nome do Perfil</label>
        <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Ex: Recepcionista, Profissional..." className="input-field" data-testid="profile-name-input" />
      </div>
      <div>
        <p className="text-xs font-bold uppercase text-slate-400 mb-2">Permissoes ({form.permissions.length} de {features.length})</p>
        <div className="space-y-3">
          {Object.entries(grouped).map(([cat, items]) => {
            const catKeys = items.map(i => i.feature_key);
            const allChecked = catKeys.every(k => form.permissions.includes(k));
            return (
              <div key={cat} className="border border-slate-200 rounded-xl p-3" data-testid={`permission-group-${cat}`}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold uppercase text-slate-500">{cat}</p>
                  <button onClick={() => toggleAll(catKeys, !allChecked)} className="text-xs text-primary font-medium" data-testid={`toggle-all-${cat}`}>
                    {allChecked ? 'Desmarcar todos' : 'Marcar todos'}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {items.map(f => (
                    <label key={f.feature_key} className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 cursor-pointer" data-testid={`permission-toggle-${f.feature_key}`}>
                      <input type="checkbox" checked={form.permissions.includes(f.feature_key)} onChange={() => toggle(f.feature_key)} className="w-4 h-4 rounded text-primary" />
                      <span className="text-sm text-slate-700">{f.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex justify-end sticky bottom-0 bg-white pt-3 border-t border-slate-100">
        <button onClick={() => form.name && onSave(form)} className="btn-primary text-sm" data-testid="save-profile-btn">Salvar</button>
      </div>
    </div>
  );
};


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
        <p className="text-sm text-slate-600">Configure a tela que sera exibida no salao ou clinica</p>
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
            <div>
              <label className="text-sm font-medium text-slate-700 mb-2 block">Layout da agenda</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleSave({ layout: 'grid' })}
                  className={`p-3 rounded-xl border-2 transition-all text-left ${
                    (settings?.layout || 'grid') === 'grid' ? 'border-primary bg-primary/5' : 'border-slate-200'
                  }`}
                  data-testid="layout-grid"
                >
                  <div className="flex gap-1 mb-2">
                    <div className="w-full h-3 bg-slate-300 rounded" />
                    <div className="w-full h-3 bg-slate-300 rounded" />
                    <div className="w-full h-3 bg-slate-300 rounded" />
                  </div>
                  <p className="text-xs font-semibold text-slate-900">Lista (grade)</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">Todos os agendamentos juntos</p>
                </button>
                <button
                  type="button"
                  onClick={() => handleSave({ layout: 'columns' })}
                  className={`p-3 rounded-xl border-2 transition-all text-left ${
                    settings?.layout === 'columns' ? 'border-primary bg-primary/5' : 'border-slate-200'
                  }`}
                  data-testid="layout-columns"
                >
                  <div className="grid grid-cols-3 gap-1 mb-2">
                    <div className="h-6 bg-slate-300 rounded" />
                    <div className="h-6 bg-slate-300 rounded" />
                    <div className="h-6 bg-slate-300 rounded" />
                  </div>
                  <p className="text-xs font-semibold text-slate-900">Colunas</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">Uma coluna por profissional</p>
                </button>
              </div>
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
        <h3 className="text-xl font-page-title text-slate-900">{title}</h3>
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
              <button onClick={onClose} className="btn-primary w-full" data-testid="onboarding-finish-btn">Ir para o Início</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CompanyDashboard;
