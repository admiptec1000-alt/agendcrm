import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { crmAPI, channelsAPI, schedulingAPI } from '../../services/api';
import { toast } from 'sonner';
import {
  Search, Plus, X, Phone, Mail, Send, Paperclip, Smile, Mic,
  Clock, MessageSquare, ChevronLeft, MoreVertical,
  Tag, User, Hash, ArrowRightLeft, Ban, CheckCircle2, Check,
  Smartphone, DollarSign, CalendarClock,
  Pencil, Trash2, AlertCircle, Filter, RefreshCw, Bot
} from 'lucide-react';

const STATUS_COLORS = {
  aberto: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Aberto' },
  em_cobranca: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Em Cobranca' },
  pago: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Pago' },
  bloqueado: { bg: 'bg-red-100', text: 'text-red-700', label: 'Bloqueado' },
  proposta: { bg: 'bg-violet-100', text: 'text-violet-700', label: 'Proposta' },
  fechado: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Fechado' },
};

const formatTime = (isoDate) => {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

const formatBRL = (v) => `R$ ${(Number(v) || 0).toFixed(2).replace('.', ',')}`;

// Small inline dropdown to change kanban column from the ticket list item.
// Uses native <select> for reliability (works on mobile, no popper dependency).
const KanbanColumnPicker = ({ ticket, columns, onChange }) => {
  const current = columns.find(c => c.id === ticket.kanban_column_id);
  // Fallback label when no column is set
  const hasColumns = columns && columns.length > 0;
  if (!hasColumns) return null;
  const label = current?.title || current?.name || 'Etapa';
  const color = current?.color || '#6366F1';
  return (
    <span
      className="relative inline-flex items-center"
      data-testid={`kanban-picker-${ticket.id}`}
      onClick={e => e.stopPropagation()}
    >
      <span
        className="text-[9px] px-1.5 py-0.5 rounded font-bold truncate max-w-[110px]"
        style={{ background: `${color}1A`, color }}
        title={current ? `Kanban: ${label}` : 'Definir etapa do Kanban'}
      >
        {current ? label : 'Kanban'}
      </span>
      <select
        value={ticket.kanban_column_id || ''}
        onChange={e => onChange(e.target.value || null)}
        onClick={e => e.stopPropagation()}
        className="absolute inset-0 opacity-0 cursor-pointer"
        aria-label="Etapa do Kanban"
        data-testid={`kanban-select-${ticket.id}`}
      >
        <option value="">Sem etapa</option>
        {columns.map(c => (
          <option key={c.id} value={c.id}>{c.title || c.name}</option>
        ))}
      </select>
    </span>
  );
};

const AtendimentosPage = () => {
  const { user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [counts, setCounts] = useState({ atendendo: 0, aguardando: 0, total: 0 });
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [showContactInfo, setShowContactInfo] = useState(false);
  const [showNewTicket, setShowNewTicket] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [showEditContact, setShowEditContact] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('atendendo');
  const [channelFilter, setChannelFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filterConnId, setFilterConnId] = useState('');
  const [filterUserId, setFilterUserId] = useState('');
  const [filterTagName, setFilterTagName] = useState('');
  const [filterQueueId, setFilterQueueId] = useState('');
  const [connections, setConnections] = useState([]);
  const [users, setUsers] = useState([]);
  const [queues, setQueues] = useState([]);
  const [kanbanColumns, setKanbanColumns] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const [allTags, setAllTags] = useState([]);
  const [presenceMap, setPresenceMap] = useState({}); // phone -> {presence, updated_at}
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);
  const selectedRef = useRef(null);

  // Keep selectedRef in sync (used inside polling closure)
  useEffect(() => { selectedRef.current = selectedTicket; }, [selectedTicket]);

  // Auto scroll on new messages
  useEffect(() => {
    if (selectedTicket?.messages?.length) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [selectedTicket?.messages?.length, selectedTicket?.id]);

  const loadData = useCallback(async () => {
    try {
      const params = { tab: activeTab };
      if (channelFilter) params.channel = channelFilter;
      if (searchTerm) params.search = searchTerm;
      const [ticketsRes, countsRes] = await Promise.all([
        crmAPI.getTickets(params),
        crmAPI.getTicketCounts()
      ]);
      let list = ticketsRes.data;
      // Client-side filtering for connection/user/tag/queue
      if (filterConnId) list = list.filter(t => t.connection_id === filterConnId);
      if (filterUserId) list = list.filter(t => t.assigned_to === filterUserId);
      if (filterTagName) list = list.filter(t => (t.tags || []).includes(filterTagName));
      if (filterQueueId) list = list.filter(t => t.queue_id === filterQueueId);
      setTickets(list);
      setCounts(countsRes.data);
    } catch (e) { /* silent */ }
  }, [activeTab, channelFilter, searchTerm, filterConnId, filterUserId, filterTagName, filterQueueId]);

  const loadTags = async () => {
    try { const r = await crmAPI.listTags(); setAllTags(r.data); } catch (e) {}
  };

  const loadAux = async () => {
    try {
      const [c, q, k] = await Promise.all([channelsAPI.getConnections(), crmAPI.listQueues(), crmAPI.listKanbanColumns()]);
      setConnections(c.data); setQueues(q.data); setKanbanColumns(k.data || []);
      try { const u = await schedulingAPI.getCompanyUsers(); setUsers(u.data); }
      catch (_) { setUsers([]); }
    } catch (e) {}
  };

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { loadTags(); loadAux(); }, []);

  // Auto-open ticket via sessionStorage (used by Kanban "open atendimento" icon)
  useEffect(() => {
    const tid = sessionStorage.getItem('open_ticket_id');
    if (tid) {
      sessionStorage.removeItem('open_ticket_id');
      crmAPI.getTicket(tid).then(r => setSelectedTicket(r.data)).catch(() => {});
    }
  }, []);

  // Polling: refresh selected ticket every 4s, list every 8s, presence every 5s
  useEffect(() => {
    const ticketInterval = setInterval(async () => {
      const cur = selectedRef.current;
      if (cur?.id) {
        try {
          const r = await crmAPI.getTicket(cur.id);
          // only update if message count changed (to avoid input rerender flicker)
          const currentCount = (selectedRef.current?.messages || []).length;
          const newCount = (r.data.messages || []).length;
          if (newCount !== currentCount || r.data.updated_at !== selectedRef.current?.updated_at) {
            setSelectedTicket(r.data);
          }
        } catch (e) {}
      }
    }, 4000);
    const listInterval = setInterval(() => { loadData(); }, 8000);
    const presenceInterval = setInterval(async () => {
      try {
        const r = await channelsAPI.getContactPresence();
        const map = {};
        for (const p of r.data || []) {
          map[p.phone] = { presence: p.presence, updated_at: p.updated_at };
        }
        setPresenceMap(map);
      } catch (e) {}
    }, 5000);
    return () => { clearInterval(ticketInterval); clearInterval(listInterval); clearInterval(presenceInterval); };
  }, [loadData]);

  const handleSelectTicket = (ticket) => {
    setSelectedTicket(ticket);
    setShowContactInfo(false);
  };

  const handleSendMessage = async () => {
    if (!messageInput.trim() || !selectedTicket || sending) return;
    setSending(true);
    const text = messageInput;
    setMessageInput('');
    try {
      const res = await crmAPI.addMessage(selectedTicket.id, { content: text, sender_type: 'agent' });
      if (res.data?.delivery_status === 'failed') {
        toast.error(`Mensagem nao entregue: ${res.data.delivery_error || 'erro'}`);
      }
      // Refresh selected ticket immediately
      const r = await crmAPI.getTicket(selectedTicket.id);
      setSelectedTicket(r.data);
      loadData();
    } catch (e) {
      toast.error('Erro ao enviar mensagem');
      setMessageInput(text);
    } finally {
      setSending(false);
    }
  };

  const handleCreateTicket = async (form) => {
    try {
      const res = await crmAPI.createTicket(form);
      toast.success('Ticket criado!');
      setShowNewTicket(false);
      await loadData();
      setSelectedTicket(res.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Erro ao criar ticket');
      setShowNewTicket(false);
    }
  };

  const handleAddTag = async (tagName) => {
    if (!selectedTicket) return;
    try {
      const r = await crmAPI.addTicketTag(selectedTicket.id, tagName);
      setSelectedTicket(r.data);
      setShowTagPicker(false);
      loadData();
      toast.success('Tag adicionada');
    } catch (e) { toast.error('Erro ao adicionar tag'); }
  };

  const handleRemoveTag = async (tagName) => {
    if (!selectedTicket) return;
    try {
      const r = await crmAPI.removeTicketTag(selectedTicket.id, tagName);
      setSelectedTicket(r.data);
      loadData();
    } catch (e) { toast.error('Erro ao remover tag'); }
  };

  const handleScheduleMessage = async ({ message, scheduled_at }) => {
    if (!selectedTicket) return;
    try {
      await channelsAPI.createScheduledMessage({
        recipient: selectedTicket.customer_phone,
        channel: selectedTicket.channel || 'whatsapp',
        message,
        scheduled_at,
      });
      toast.success('Mensagem agendada');
      setShowSchedule(false);
    } catch (e) { toast.error('Erro ao agendar'); }
  };

  const handleSaveContact = async (form) => {
    if (!selectedTicket) return;
    try {
      const r = await crmAPI.updateTicket(selectedTicket.id, {
        customer_name: form.customer_name,
        customer_phone: form.customer_phone,
        customer_email: form.customer_email || null,
        value: parseFloat(form.value) || 0,
        description: form.description,
        channel: form.channel,
      });
      setSelectedTicket(r.data);
      loadData();
      toast.success('Contato atualizado');
      setShowEditContact(false);
    } catch (e) { toast.error('Erro ao salvar'); }
  };

  const handleDeleteTicket = async () => {
    if (!selectedTicket || !window.confirm(`Excluir o atendimento "${selectedTicket.customer_name}"?`)) return;
    try {
      await crmAPI.deleteTicket(selectedTicket.id);
      toast.success('Atendimento excluido');
      setSelectedTicket(null);
      loadData();
    } catch (e) { toast.error('Erro ao excluir'); }
  };

  const handleRetryMessage = async (msgId) => {
    if (!selectedTicket) return;
    try {
      await crmAPI.retryMessage(selectedTicket.id, msgId);
      toast.success('Reenviada');
      const r = await crmAPI.getTicket(selectedTicket.id);
      setSelectedTicket(r.data);
    } catch (e) { toast.error(e?.response?.data?.detail || 'Falha no reenvio'); }
  };

  const getLastMessage = (ticket) => {
    if (ticket.messages?.length > 0) return ticket.messages[ticket.messages.length - 1];
    return { content: ticket.description || 'Sem mensagens', sender_type: 'system' };
  };

  return (
    <div className="flex h-full w-full overflow-hidden" data-testid="atendimentos-page">
      {/* === CONVERSATION LIST === */}
      <div className={`${selectedTicket ? 'hidden lg:flex' : 'flex'} flex-col w-full lg:w-[380px] border-r border-slate-200 bg-white flex-shrink-0`}>
        {/* Header with KPIs */}
        <div className="px-4 pt-4 pb-3 bg-gradient-to-br from-primary to-indigo-600 text-white">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest opacity-70">Atendimentos</p>
              <p className="text-2xl font-bold font-heading mt-0.5">{counts.total || 0}<span className="text-xs font-normal opacity-70 ml-2">conversas</span></p>
            </div>
            <button
              onClick={() => setShowNewTicket(true)}
              className="w-11 h-11 rounded-2xl bg-white/15 hover:bg-white/25 backdrop-blur active:scale-95 transition-all flex items-center justify-center shadow-lg"
              data-testid="new-ticket-btn"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/70" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar conversa, cliente ou mensagem"
              className="w-full pl-9 pr-4 py-2.5 text-sm bg-white/15 backdrop-blur placeholder-white/60 text-white border border-white/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-white/40"
              data-testid="search-conversations"
            />
          </div>
        </div>

        {/* Filter row: WhatsApp toggle + Filters button */}
        <div className="px-3 py-2 border-b border-slate-200 flex items-center gap-1.5 overflow-x-auto">
          {[
            { v: '', label: 'Todos' },
            { v: 'whatsapp', label: 'WhatsApp' },
          ].map(c => (
            <button
              key={c.v}
              onClick={() => setChannelFilter(c.v)}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap transition-all ${
                channelFilter === c.v ? 'bg-primary text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
              data-testid={`channel-chip-${c.v || 'all'}`}
            >
              {c.label}
            </button>
          ))}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`ml-auto text-[11px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap flex items-center gap-1 transition-all ${
              (filterConnId || filterUserId || filterTagName || filterQueueId)
                ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
            data-testid="toggle-filters"
          >
            <Filter className="w-3 h-3" /> Filtros
            {(filterConnId || filterUserId || filterTagName || filterQueueId) && (
              <span className="ml-0.5 w-4 h-4 rounded-full bg-white text-primary text-[9px] font-bold flex items-center justify-center">
                {[filterConnId, filterUserId, filterTagName, filterQueueId].filter(Boolean).length}
              </span>
            )}
          </button>
        </div>

        {showFilters && (
          <div className="px-3 py-2.5 border-b border-slate-200 bg-slate-50 space-y-2" data-testid="filters-panel">
            <FilterSelect
              label="Conexao" icon={<Smartphone className="w-3 h-3" />}
              value={filterConnId} onChange={setFilterConnId}
              options={[{ value: '', label: 'Todas' }, ...connections.map(c => ({ value: c.id, label: c.name }))]}
              testId="filter-connection"
            />
            <FilterSelect
              label="Usuario" icon={<User className="w-3 h-3" />}
              value={filterUserId} onChange={setFilterUserId}
              options={[{ value: '', label: 'Todos' }, ...users.map(u => ({ value: u.id, label: u.name }))]}
              testId="filter-user"
            />
            <FilterSelect
              label="Tag" icon={<Tag className="w-3 h-3" />}
              value={filterTagName} onChange={setFilterTagName}
              options={[{ value: '', label: 'Todas' }, ...allTags.map(t => ({ value: t.name, label: t.name }))]}
              testId="filter-tag"
            />
            <FilterSelect
              label="Fila" icon={<Bot className="w-3 h-3" />}
              value={filterQueueId} onChange={setFilterQueueId}
              options={[{ value: '', label: 'Todas' }, ...queues.map(q => ({ value: q.id, label: q.name }))]}
              testId="filter-queue"
            />
            {(filterConnId || filterUserId || filterTagName || filterQueueId) && (
              <button
                onClick={() => { setFilterConnId(''); setFilterUserId(''); setFilterTagName(''); setFilterQueueId(''); }}
                className="text-[10px] text-primary hover:underline font-semibold"
              >
                Limpar filtros
              </button>
            )}
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-slate-200">
          <TabButton active={activeTab === 'atendendo'} onClick={() => setActiveTab('atendendo')} label="Atendendo" count={counts.atendendo} testId="tab-atendendo" />
          <TabButton active={activeTab === 'aguardando'} onClick={() => setActiveTab('aguardando')} label="Aguardando" count={counts.aguardando} testId="tab-aguardando" />
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {tickets.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/10 to-indigo-100 flex items-center justify-center mb-3">
                <MessageSquare className="w-7 h-7 text-primary" />
              </div>
              <p className="text-sm font-semibold text-slate-700">Tudo em dia!</p>
              <p className="text-xs text-slate-400 mt-1">{activeTab === 'atendendo' ? 'Nenhum atendimento em andamento' : 'Nenhum cliente aguardando'}</p>
              <button onClick={() => setShowNewTicket(true)} className="mt-4 text-xs font-semibold text-primary hover:underline">
                + Iniciar novo atendimento
              </button>
            </div>
          )}
          {tickets.map((ticket) => {
            const lastMsg = getLastMessage(ticket);
            const isSelected = selectedTicket?.id === ticket.id;

            return (
              <div
                key={ticket.id}
                onClick={() => handleSelectTicket(ticket)}
                data-testid={`conversation-${ticket.id}`}
                className={`flex items-start gap-3 px-4 py-3 cursor-pointer border-b border-slate-100 transition-colors ${
                  isSelected ? 'bg-primary/5 border-l-2 border-l-primary' : 'hover:bg-slate-50'
                }`}
              >
                <div className="relative flex-shrink-0">
                  <div className="w-11 h-11 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-bold text-sm">
                    {ticket.customer_name?.substring(0, 2).toUpperCase()}
                  </div>
                  <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-emerald-100 flex items-center justify-center">
                    <Smartphone className="w-2.5 h-2.5 text-emerald-600" />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {ticket.ticket_number && (
                        <span
                          data-testid={`ticket-number-${ticket.id}`}
                          className="text-[10px] font-bold text-slate-400 flex-shrink-0"
                        >#{ticket.ticket_number}</span>
                      )}
                      <p className="font-medium text-sm text-slate-900 truncate">{ticket.customer_name}</p>
                    </div>
                    <span className="text-[10px] text-slate-400 flex-shrink-0 ml-2">{formatTime(ticket.updated_at)}</span>
                  </div>
                  <p className="text-xs text-slate-500 truncate mb-1.5">
                    {lastMsg.sender_type === 'agent' && <span className="text-slate-700">Voce: </span>}
                    {lastMsg.content}
                  </p>
                  <div className="flex items-center gap-1 flex-wrap">
                    {/* Conexao */}
                    {ticket.connection_id && (() => {
                      const c = connections.find(x => x.id === ticket.connection_id);
                      return c ? (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold truncate max-w-[80px]" title={`Conexao: ${c.name}`}>{c.name}</span>
                      ) : null;
                    })()}
                    {/* Fila */}
                    {ticket.queue_id && (() => {
                      const q = queues.find(x => x.id === ticket.queue_id);
                      return q ? (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-bold truncate max-w-[80px]" title={`Fila: ${q.name}`}>{q.name}</span>
                      ) : null;
                    })()}
                    {/* Responsavel */}
                    {ticket.assigned_to && (() => {
                      const u = users.find(x => x.id === ticket.assigned_to);
                      return u ? (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-900 text-white font-bold truncate max-w-[90px]" title={`Responsavel: ${u.name}`}>{u.name}</span>
                      ) : null;
                    })()}
                    {/* Kanban column - clicable */}
                    <KanbanColumnPicker
                      ticket={ticket}
                      columns={kanbanColumns}
                      onChange={async (newCol) => {
                        try {
                          await crmAPI.updateTicket(ticket.id, { kanban_column_id: newCol });
                          toast.success('Etapa atualizada');
                          loadData();
                        } catch { toast.error('Falha ao atualizar etapa'); }
                      }}
                    />
                    {/* Tags */}
                    {ticket.tags?.slice(0, 2).map((tag, i) => {
                      const td = allTags.find(t => t.name === tag);
                      return (
                        <span
                          key={`tag-${tag}-${i}`}
                          className="text-[9px] px-1.5 py-0.5 rounded font-medium"
                          style={td ? { background: `${td.color}1A`, color: td.color } : { background: 'rgba(79,70,229,0.1)', color: 'rgb(79,70,229)' }}
                        >{tag}</span>
                      );
                    })}
                    {(ticket.value > 0) && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold">{formatBRL(ticket.value)}</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-center gap-1 flex-shrink-0">
                  {ticket.messages?.length > 0 && (
                    <span className="w-5 h-5 rounded-full bg-emerald-500 text-white text-[10px] flex items-center justify-center font-bold">
                      {ticket.messages.length}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* === CHAT AREA === */}
      {selectedTicket ? (
        <div className="flex-1 flex flex-col bg-[#ECE5DD] min-w-0">
          {/* Chat Header */}
          <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3">
            <button onClick={() => setSelectedTicket(null)} className="lg:hidden p-1 rounded hover:bg-slate-100" data-testid="back-to-list">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="cursor-pointer flex items-center gap-3 flex-1 min-w-0" onClick={() => setShowContactInfo(!showContactInfo)} data-testid="open-contact-info">
              <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-bold text-sm flex-shrink-0">
                {selectedTicket.customer_name?.substring(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-sm text-slate-900 truncate">
                  {selectedTicket.customer_name} <span className="text-slate-400 font-normal">#{selectedTicket.ticket_number || selectedTicket.id.substring(0, 4)}</span>
                </p>
                {(() => {
                  const pres = presenceMap[selectedTicket.customer_phone]?.presence;
                  const isTyping = pres === 'composing';
                  const isRecording = pres === 'recording';
                  if (isTyping || isRecording) {
                    return (
                      <p className="text-xs text-emerald-600 truncate flex items-center gap-1.5" data-testid="typing-indicator">
                        <span className="flex gap-0.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                        </span>
                        <span className="font-medium italic">{isRecording ? 'gravando audio...' : 'digitando...'}</span>
                      </p>
                    );
                  }
                  return (
                    <p className="text-xs text-slate-500 truncate">
                      {selectedTicket.customer_phone}
                      {(selectedTicket.value > 0) && <span className="ml-2 text-emerald-700 font-semibold">{formatBRL(selectedTicket.value)}</span>}
                    </p>
                  );
                })()}
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button onClick={() => setShowEditContact(true)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500" title="Editar contato" data-testid="edit-contact-btn"><Pencil className="w-4 h-4" /></button>
              <button onClick={handleDeleteTicket} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500" title="Excluir atendimento" data-testid="delete-ticket-btn"><Trash2 className="w-4 h-4" /></button>
              <button className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 hidden sm:block" title="Transferir"><ArrowRightLeft className="w-4 h-4" /></button>
              <button className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 hidden sm:block" title="Fechar"><Ban className="w-4 h-4" /></button>
              <button className="p-2 rounded-lg hover:bg-slate-100 text-slate-500" title="Mais"><MoreVertical className="w-4 h-4" /></button>
            </div>
          </div>

          {/* Tags Bar */}
          <div className="bg-white/80 px-4 py-2 border-b border-slate-200 flex items-center gap-1.5 flex-wrap">
            <Tag className="w-3 h-3 text-slate-400" />
            <span className="text-[10px] text-slate-400 font-semibold uppercase">Tags:</span>
            {(selectedTicket.tags || []).map((t, i) => {
              const td = allTags.find(at => at.name === t);
              return (
                <span
                  key={`htag-${t}-${i}`}
                  className="text-[10px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1"
                  style={td ? { background: `${td.color}22`, color: td.color } : { background: '#E2E8F0', color: '#475569' }}
                >
                  {t}
                  <button onClick={() => handleRemoveTag(t)} className="hover:opacity-70" data-testid={`remove-tag-${t}`}>
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              );
            })}
            <div className="relative">
              <button
                onClick={() => setShowTagPicker(!showTagPicker)}
                className="text-[10px] px-2 py-0.5 rounded-full border border-dashed border-slate-300 text-slate-500 hover:border-primary hover:text-primary flex items-center gap-1"
                data-testid="add-tag-btn"
              >
                <Plus className="w-2.5 h-2.5" /> Tag
              </button>
              {showTagPicker && (
                <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-lg p-2 w-56" data-testid="tag-picker">
                  <p className="text-[10px] font-bold uppercase text-slate-400 mb-2 px-1">Adicionar tag</p>
                  {allTags.length === 0 && <p className="text-xs text-slate-500 px-2 py-1">Cadastre tags em CRM &gt; Tags</p>}
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {allTags
                      .filter(t => !selectedTicket.tags?.includes(t.name))
                      .map(t => (
                        <button
                          key={t.id}
                          onClick={() => handleAddTag(t.name)}
                          className="w-full text-left text-xs px-2 py-1.5 rounded-md hover:bg-slate-100 flex items-center gap-2"
                          data-testid={`tag-option-${t.name}`}
                        >
                          <span className="w-2.5 h-2.5 rounded-full" style={{ background: t.color }} />
                          <span className="truncate">{t.name}</span>
                        </button>
                      ))}
                  </div>
                  <button onClick={() => setShowTagPicker(false)} className="w-full text-[10px] text-slate-400 mt-2 py-1 hover:text-slate-600">fechar</button>
                </div>
              )}
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <div className="flex items-center justify-center mb-4">
              <span className="text-[10px] bg-white/90 text-slate-500 px-3 py-1 rounded-lg shadow-sm">CONVERSA</span>
            </div>

            {selectedTicket.messages?.map((msg) => (
              <div key={msg.id} className={`flex mb-3 ${msg.sender_type === 'agent' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] rounded-xl px-4 py-2.5 shadow-sm ${
                  msg.sender_type === 'agent' ? 'bg-[#D9FDD3] text-slate-800 rounded-tr-sm' : 'bg-white text-slate-800 rounded-tl-sm'
                }`}>
                  {msg.sender_type === 'agent' && (
                    <p className="text-[10px] font-bold text-emerald-700 mb-0.5">{msg.sender_name || 'Admin'}</p>
                  )}
                  <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                  <div className="text-[10px] text-slate-400 text-right mt-1 flex items-center justify-end gap-1">
                    {formatTime(msg.created_at)}
                    {msg.sender_type === 'agent' && (
                      msg.delivery_status === 'failed' ? (
                        <>
                          <span title={msg.delivery_error || 'Falha'} className="text-red-500"><AlertCircle className="w-3 h-3 inline" /></span>
                          <button
                            onClick={() => handleRetryMessage(msg.id)}
                            className="text-[10px] text-primary font-semibold hover:underline ml-1 flex items-center gap-0.5"
                            title="Reenviar"
                            data-testid={`retry-msg-${msg.id}`}
                          >
                            <RefreshCw className="w-2.5 h-2.5" /> Reenviar
                          </button>
                        </>
                      ) : msg.delivery_status === 'pending' ? (
                        <Check className="w-3 h-3 inline text-slate-400" title="Enviando" />
                      ) : msg.delivery_status === 'sent' ? (
                        <Check className="w-3 h-3 inline text-slate-400" title="Enviada" />
                      ) : msg.delivery_status === 'delivered' ? (
                        <span className="inline-flex" title="Entregue">
                          <Check className="w-3 h-3 text-slate-400" />
                          <Check className="w-3 h-3 text-slate-400 -ml-1.5" />
                        </span>
                      ) : (msg.delivery_status === 'read' || msg.delivery_status === 'played') ? (
                        <span className="inline-flex" title="Lida" data-testid="msg-read">
                          <Check className="w-3 h-3 text-blue-500" />
                          <Check className="w-3 h-3 text-blue-500 -ml-1.5" />
                        </span>
                      ) : (
                        <CheckCircle2 className="w-3 h-3 inline text-blue-500" />
                      )
                    )}
                  </div>
                  {msg.delivery_status === 'failed' && msg.delivery_error && (
                    <p className="text-[9px] text-red-500 mt-0.5 italic">{msg.delivery_error}</p>
                  )}
                </div>
              </div>
            ))}

            {(!selectedTicket.messages || selectedTicket.messages.length === 0) && (
              <div className="text-center py-12">
                <p className="text-sm text-slate-400 bg-white/80 inline-block px-4 py-2 rounded-lg">Nenhuma mensagem nesta conversa</p>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Message Input */}
          <div className="bg-white border-t border-slate-200 px-3 py-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSchedule(true)}
                className="p-2 rounded-full hover:bg-primary/10 text-primary"
                title="Agendar mensagem"
                data-testid="schedule-message-btn"
              >
                <CalendarClock className="w-5 h-5" />
              </button>
              <button className="p-2 rounded-full hover:bg-slate-100 text-slate-500 hidden sm:block"><Paperclip className="w-5 h-5" /></button>
              <div className="flex-1 relative min-w-0">
                <input
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                  placeholder="Digite uma mensagem"
                  className="w-full px-4 py-2.5 bg-slate-50 rounded-full border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  data-testid="message-input"
                  disabled={sending}
                />
              </div>
              <button className="p-2 rounded-full hover:bg-slate-100 text-slate-500 hidden sm:block"><Smile className="w-5 h-5" /></button>
              {messageInput.trim() ? (
                <button onClick={handleSendMessage} disabled={sending} className="p-2.5 rounded-full bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50" data-testid="send-message-btn">
                  <Send className="w-5 h-5" />
                </button>
              ) : (
                <button className="p-2.5 rounded-full bg-primary text-white hover:bg-primary/90 transition-colors">
                  <Mic className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 hidden lg:flex items-center justify-center bg-slate-50">
          <div className="text-center">
            <div className="w-20 h-20 rounded-2xl bg-slate-200 flex items-center justify-center mx-auto mb-4">
              <MessageSquare className="w-10 h-10 text-slate-400" />
            </div>
            <p className="text-slate-500 font-medium">Selecione uma conversa</p>
            <p className="text-sm text-slate-400 mt-1">Escolha um atendimento para visualizar</p>
          </div>
        </div>
      )}

      {/* === CONTACT INFO PANEL === */}
      {showContactInfo && selectedTicket && (
        <div className="w-80 bg-white border-l border-slate-200 flex-shrink-0 overflow-y-auto hidden xl:block" data-testid="contact-info-panel">
          <div className="p-4 border-b border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-sm text-slate-900">Info do Contato</h3>
              <button onClick={() => setShowContactInfo(false)} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="text-center mb-4">
              <div className="w-16 h-16 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-bold text-xl mx-auto mb-2">
                {selectedTicket.customer_name?.substring(0, 2).toUpperCase()}
              </div>
              <p className="font-semibold text-slate-900">{selectedTicket.customer_name}</p>
              {(selectedTicket.value > 0) && (
                <p className="text-sm text-emerald-600 font-bold mt-1">{formatBRL(selectedTicket.value)}</p>
              )}
            </div>
            <button onClick={() => setShowEditContact(true)} className="w-full btn-secondary text-xs flex items-center justify-center gap-1">
              <Pencil className="w-3 h-3" /> Editar contato
            </button>
          </div>
          <div className="p-4 space-y-4">
            <InfoRow icon={<Phone className="w-4 h-4" />} label="Telefone" value={selectedTicket.customer_phone} />
            <InfoRow icon={<Mail className="w-4 h-4" />} label="Email" value={selectedTicket.customer_email || 'Nao informado'} />
            <InfoRow icon={<DollarSign className="w-4 h-4" />} label="Valor" value={formatBRL(selectedTicket.value)} />
            <InfoRow icon={<Hash className="w-4 h-4" />} label="Canal" value={selectedTicket.channel} />
            <InfoRow icon={<Clock className="w-4 h-4" />} label="Criado em" value={formatTime(selectedTicket.created_at)} />
            <InfoRow icon={<User className="w-4 h-4" />} label="Atribuido a" value={selectedTicket.assigned_to || user?.name || 'Admin'} />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Status</p>
              {STATUS_COLORS[selectedTicket.status] && (
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_COLORS[selectedTicket.status].bg} ${STATUS_COLORS[selectedTicket.status].text}`}>
                  {STATUS_COLORS[selectedTicket.status].label}
                </span>
              )}
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Descricao</p>
              <p className="text-sm text-slate-600">{selectedTicket.description || 'Sem descricao'}</p>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {showNewTicket && <NewTicketModal onClose={() => setShowNewTicket(false)} onSave={handleCreateTicket} />}
      {showSchedule && selectedTicket && (
        <ScheduleMessageModal
          recipient={selectedTicket.customer_phone}
          onClose={() => setShowSchedule(false)}
          onSave={handleScheduleMessage}
        />
      )}
      {showEditContact && selectedTicket && (
        <EditContactModal
          ticket={selectedTicket}
          onClose={() => setShowEditContact(false)}
          onSave={handleSaveContact}
        />
      )}
    </div>
  );
};

/* === COMPONENTS === */
const TabButton = ({ active, onClick, label, count, testId }) => (
  <button
    onClick={onClick}
    data-testid={testId}
    className={`flex-1 py-2.5 text-xs font-semibold relative transition-colors ${
      active ? 'text-primary' : 'text-slate-500 hover:text-slate-700'
    }`}
  >
    <span className="flex items-center justify-center gap-1.5">
      {count > 0 && (
        <span className={`w-5 h-5 rounded-full text-[10px] flex items-center justify-center font-bold ${
          active ? 'bg-primary text-white' : 'bg-slate-200 text-slate-600'
        }`}>{count}</span>
      )}
      {label}
    </span>
    {active && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
  </button>
);

const InfoRow = ({ icon, label, value }) => (
  <div>
    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">{label}</p>
    <div className="flex items-center gap-2">
      <span className="text-slate-400">{icon}</span>
      <span className="text-sm text-slate-700">{value}</span>
    </div>
  </div>
);

const FilterSelect = ({ label, icon, value, onChange, options, testId }) => (
  <div>
    <label className="text-[10px] font-bold uppercase text-slate-400 flex items-center gap-1">
      {icon} {label}
    </label>
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full mt-0.5 px-2 py-1.5 text-xs rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
      data-testid={testId}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>
);

const NewTicketModal = ({ onClose, onSave }) => {
  const [mode, setMode] = useState('existing'); // existing | new
  const [form, setForm] = useState({
    customer_name: '', customer_phone: '', customer_email: '',
    description: '', priority: 'medium', channel: 'whatsapp', status: 'aberto',
    value: 0,
  });
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);

  // Debounced search
  useEffect(() => {
    if (mode !== 'existing' || !search.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await schedulingAPI.getClients({ search });
        setResults((r.data || []).slice(0, 20));
      } catch (e) { setResults([]); } finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [search, mode]);

  const pickClient = (c) => {
    setSelected(c);
    setForm({
      ...form,
      customer_name: c.name || '',
      customer_phone: c.phone || '',
      customer_email: c.email || '',
    });
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 my-8" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold font-heading text-slate-900">Novo Atendimento</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex gap-1 bg-slate-100 rounded-lg p-1 mb-4">
          <button
            onClick={() => { setMode('existing'); setSelected(null); setForm({...form, customer_name:'', customer_phone:'', customer_email:''}); }}
            className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${mode === 'existing' ? 'bg-white text-primary shadow-sm' : 'text-slate-500'}`}
            data-testid="mode-existing"
          >Selecionar Cliente</button>
          <button
            onClick={() => { setMode('new'); setSelected(null); setForm({...form, customer_name:'', customer_phone:'', customer_email:''}); }}
            className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${mode === 'new' ? 'bg-white text-primary shadow-sm' : 'text-slate-500'}`}
            data-testid="mode-new"
          >Novo Cliente</button>
        </div>

        {mode === 'existing' && !selected && (
          <div className="space-y-2 mb-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar por nome ou telefone..."
                className="input-field w-full pl-9"
                autoFocus
                data-testid="customer-search"
              />
            </div>
            {searching && <p className="text-xs text-slate-400 text-center py-2">Buscando...</p>}
            {!searching && search && results.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-3">Nenhum cliente encontrado.<br/><button onClick={() => setMode('new')} className="text-primary font-semibold hover:underline mt-1">Criar novo</button></p>
            )}
            <div className="max-h-60 overflow-y-auto space-y-1">
              {results.map(c => (
                <button
                  key={c.id}
                  onClick={() => pickClient(c)}
                  className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 text-left transition-colors"
                  data-testid={`pick-client-${c.id}`}
                >
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-indigo-500 text-white flex items-center justify-center text-[11px] font-bold flex-shrink-0">
                    {(c.name || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{c.name}</p>
                    <p className="text-[10px] text-slate-500 truncate">{c.phone}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {(mode === 'new' || selected) && (
          <div className="space-y-3">
            {selected && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2 flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[11px] font-bold flex-shrink-0">
                  {(selected.name || '?').charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-emerald-900 truncate">{selected.name}</p>
                  <p className="text-[10px] text-emerald-700 truncate">{selected.phone}</p>
                </div>
                <button onClick={() => { setSelected(null); setForm({...form, customer_name:'', customer_phone:'', customer_email:''}); }} className="text-emerald-700 hover:text-emerald-900 text-xs font-semibold">Trocar</button>
              </div>
            )}
            <input value={form.customer_name} onChange={e => setForm({...form, customer_name: e.target.value})} placeholder="Nome do cliente" className="input-field w-full" data-testid="new-ticket-name" disabled={!!selected} />
            <input value={form.customer_phone} onChange={e => setForm({...form, customer_phone: e.target.value})} placeholder="Telefone (WhatsApp)" className="input-field w-full" data-testid="new-ticket-phone" disabled={!!selected} />
            <input value={form.customer_email} onChange={e => setForm({...form, customer_email: e.target.value})} placeholder="Email (opcional)" className="input-field w-full" type="email" disabled={!!selected} />
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={form.value}
                onChange={e => setForm({...form, value: e.target.value})}
                placeholder="Valor do negocio (R$)"
                className="input-field w-full pl-9"
                type="number" step="0.01" min="0"
                data-testid="new-ticket-value"
              />
            </div>
            <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Descricao ou primeira mensagem" className="input-field w-full" rows={2} />
            <div className="grid grid-cols-2 gap-3">
              <select value={form.channel} onChange={e => setForm({...form, channel: e.target.value})} className="input-field text-sm w-full">
                <option value="whatsapp">WhatsApp</option>
                <option value="instagram">Instagram</option>
                <option value="web">Web</option>
                <option value="email">Email</option>
              </select>
              <select value={form.priority} onChange={e => setForm({...form, priority: e.target.value})} className="input-field text-sm w-full">
                <option value="low">Baixa</option>
                <option value="medium">Media</option>
                <option value="high">Alta</option>
              </select>
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="btn-secondary text-sm">Cancelar</button>
          <button
            onClick={() => {
              if (form.customer_name && form.customer_phone) {
                onSave({
                  ...form,
                  customer_email: form.customer_email?.trim() || null,
                  value: parseFloat(form.value) || 0,
                });
              } else { toast.error('Preencha nome e telefone'); }
            }}
            className="btn-primary text-sm"
            data-testid="save-new-ticket"
            disabled={mode === 'existing' && !selected}
          >
            Criar Atendimento
          </button>
        </div>
      </div>
    </div>
  );
};

const EditContactModal = ({ ticket, onClose, onSave }) => {
  const [form, setForm] = useState({
    customer_name: ticket.customer_name || '',
    customer_phone: ticket.customer_phone || '',
    customer_email: ticket.customer_email || '',
    value: ticket.value || 0,
    description: ticket.description || '',
    channel: ticket.channel || 'whatsapp',
  });

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto" onClick={onClose} data-testid="edit-contact-modal">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 my-8" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold font-heading text-slate-900">Editar Contato</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400">Nome</label>
            <input value={form.customer_name} onChange={e => setForm({...form, customer_name: e.target.value})} className="input-field w-full" data-testid="edit-contact-name" />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400">Telefone</label>
            <input value={form.customer_phone} onChange={e => setForm({...form, customer_phone: e.target.value})} className="input-field w-full" data-testid="edit-contact-phone" />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400">Email</label>
            <input value={form.customer_email} onChange={e => setForm({...form, customer_email: e.target.value})} className="input-field w-full" type="email" />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400">Valor (R$)</label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={form.value}
                onChange={e => setForm({...form, value: e.target.value})}
                className="input-field w-full pl-9"
                type="number" step="0.01" min="0"
                data-testid="edit-contact-value"
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400">Canal</label>
            <select value={form.channel} onChange={e => setForm({...form, channel: e.target.value})} className="input-field text-sm w-full">
              <option value="whatsapp">WhatsApp</option>
              <option value="instagram">Instagram</option>
              <option value="web">Web</option>
              <option value="email">Email</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400">Observacoes</label>
            <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="input-field w-full" rows={2} />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="btn-secondary text-sm">Cancelar</button>
          <button onClick={() => onSave(form)} className="btn-primary text-sm" data-testid="save-contact-btn">Salvar</button>
        </div>
      </div>
    </div>
  );
};

const ScheduleMessageModal = ({ recipient, onClose, onSave }) => {
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
  const defaultDateTime = `${tomorrow.toISOString().slice(0, 10)}T09:00`;
  const [message, setMessage] = useState('');
  const [scheduledAt, setScheduledAt] = useState(defaultDateTime);

  const handleSave = () => {
    if (!message.trim()) { toast.error('Digite a mensagem'); return; }
    if (!scheduledAt) { toast.error('Selecione data/hora'); return; }
    const iso = new Date(scheduledAt).toISOString();
    onSave({ message, scheduled_at: iso });
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto" onClick={onClose} data-testid="schedule-modal">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 my-8" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold font-heading text-slate-900 flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-primary" /> Agendar Mensagem
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400">Destinatario</label>
            <input value={recipient || ''} disabled className="input-field w-full bg-slate-50" />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400">Data e Hora</label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={e => setScheduledAt(e.target.value)}
              className="input-field w-full"
              data-testid="schedule-datetime"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400">Mensagem</label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Digite a mensagem que sera enviada..."
              className="input-field w-full"
              rows={4}
              data-testid="schedule-message-text"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="btn-secondary text-sm">Cancelar</button>
          <button onClick={handleSave} className="btn-primary text-sm" data-testid="save-schedule-btn">Agendar</button>
        </div>
      </div>
    </div>
  );
};

export default AtendimentosPage;
