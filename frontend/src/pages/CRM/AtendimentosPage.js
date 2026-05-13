import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { crmAPI, channelsAPI, schedulingAPI } from '../../services/api';
import api from '../../services/api';
import { toast } from 'sonner';
import {
  Search, Plus, X, Phone, Mail, Send, Paperclip, Smile, Mic,
  Clock, MessageSquare, ChevronLeft, MoreVertical,
  Tag, User, Hash, ArrowRightLeft, Ban, CheckCircle2, Check,
  Smartphone, DollarSign, CalendarClock,
  Pencil, Trash2, AlertCircle, Filter, RefreshCw, Bot, FileText
} from 'lucide-react';
import { quotesAPI } from '../../services/api';
import QuoteAttachModal from './QuoteAttachModal';
import { QuoteEditor } from './OrcamentosPage';

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


// Inline value editor for the chat header. Click → opens compact input →
// Enter or blur saves. Shows 'Valor' placeholder when there is no value yet.
const TicketValueEditor = ({ ticket, onSaved }) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(ticket.value || 0);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setValue(ticket.value || 0); }, [ticket.id, ticket.value]);

  const save = async () => {
    const numeric = parseFloat(value) || 0;
    if (numeric === (ticket.value || 0)) { setEditing(false); return; }
    setSaving(true);
    try {
      await crmAPI.updateTicket(ticket.id, { value: numeric });
      toast.success('Valor atualizado');
      setEditing(false);
      onSaved && onSaved();
    } catch { toast.error('Falha ao atualizar valor'); } finally { setSaving(false); }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1 px-2 py-1 bg-emerald-50 border border-emerald-300 rounded-lg" data-testid="ticket-value-editing">
        <span className="text-xs text-emerald-700 font-bold">R$</span>
        <input
          autoFocus
          type="number"
          step="0.01"
          min="0"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setEditing(false); setValue(ticket.value || 0); } }}
          onBlur={save}
          disabled={saving}
          className="w-20 bg-transparent outline-none text-sm text-emerald-800 font-bold"
          data-testid="ticket-value-input"
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="group flex items-center gap-1 px-2 py-1 rounded-lg border border-transparent hover:border-slate-200 hover:bg-slate-50 transition-colors"
      title="Clique para editar o valor"
      data-testid="ticket-value-btn"
    >
      <DollarSign className="w-3.5 h-3.5 text-slate-400" />
      <span className={`text-sm font-bold ${(ticket.value || 0) > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>
        {(ticket.value || 0) > 0 ? formatBRL(ticket.value) : 'Valor'}
      </span>
      <Pencil className="w-3 h-3 text-slate-300 opacity-0 group-hover:opacity-60 transition-opacity" />
    </button>
  );
};


const AtendimentosPage = () => {
  const { user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [counts, setCounts] = useState({ atendendo: 0, aguardando: 0, grupos: 0, total: 0 });
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [showContactInfo, setShowContactInfo] = useState(false);
  const [showNewTicket, setShowNewTicket] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showQuote, setShowQuote] = useState(false);
  const [showQuoteEditor, setShowQuoteEditor] = useState(false);
  const [pendingSendQuote, setPendingSendQuote] = useState(null);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
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
  const [withSignature, setWithSignature] = useState(true);  // ?2 — prefix outgoing msg with operator name (default ON)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const fileInputRef = useRef(null);
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
      if (filterTagName) {
        // Filter by tag name OR by id (tickets store either depending on how they were created)
        const td = allTags.find(t => t.name === filterTagName);
        list = list.filter(t => (t.tags || []).some(x => x === filterTagName || (td && x === td.id)));
      }
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

  // Auto-open ticket via sessionStorage. Two keys supported:
  //   - `open_ticket_id`  (Kanban "open atendimento" icon)
  //   - `focus_ticket_id` (Clientes page "Abrir atendimento" shortcut)
  useEffect(() => {
    const tid = sessionStorage.getItem('open_ticket_id') || sessionStorage.getItem('focus_ticket_id');
    if (tid) {
      sessionStorage.removeItem('open_ticket_id');
      sessionStorage.removeItem('focus_ticket_id');
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

  const handleSelectTicket = async (ticket) => {
    setSelectedTicket(ticket);
    setShowContactInfo(false);
    // OPTIMISTIC: zero the badge locally the instant the operator clicks,
    // BEFORE the backend round-trip completes. We stamp `read_state[uid]`
    // with "now" so the badge calculation below treats every existing
    // message as already-read. If the API call later returns a more
    // accurate timestamp we merge it; if it fails we keep the optimistic
    // stamp until the 8s list-poll reconciles.
    const myUid = user?.id;
    if (myUid) {
      const optimisticIso = new Date().toISOString();
      setTickets(prev => prev.map(t => t.id === ticket.id
        ? { ...t, read_state: { ...(t.read_state || {}), [myUid]: optimisticIso } }
        : t));
    }
    // Hit GET /tickets/{id} so the backend persists `read_state[user_id]`
    // and returns the canonical timestamp. Mirror that into the list so
    // the next render uses the server-side value.
    try {
      const r = await crmAPI.getTicket(ticket.id);
      const fresh = r.data;
      setSelectedTicket(fresh);
      setTickets(prev => prev.map(t => t.id === fresh.id ? { ...t, read_state: fresh.read_state } : t));
    } catch (e) { /* keep the offline UX usable */ }
  };
  // Send media file (image/audio/video/document) to the customer
  const handleSendFile = async (file) => {
    if (!file || !selectedTicket) return;
    if (file.size > 20 * 1024 * 1024) {
      toast.error('Arquivo muito grande (max 20MB)');
      return;
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      const b64 = String(dataUrl).split(',')[1] || '';
      try {
        const r = await crmAPI.sendMedia(selectedTicket.id, {
          filename: file.name,
          mimetype: file.type || 'application/octet-stream',
          data_base64: b64,
        });
        if (r.data?.delivery_status === 'failed') {
          toast.error('Falha ao enviar: ' + (r.data.delivery_error || 'erro desconhecido'));
        } else {
          toast.success('Arquivo enviado');
        }
        loadMessages(selectedTicket.id);
      } catch (err) {
        toast.error(err.response?.data?.detail || 'Erro ao enviar arquivo');
      }
    };
    reader.readAsDataURL(file);
  };

  // PTT voice recording via MediaRecorder API
  const handleToggleRecording = async () => {
    if (isRecording) {
      try { mediaRecorderRef.current?.stop(); } catch {}
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      const chunks = [];
      mr.ondataavailable = (ev) => { if (ev.data.size > 0) chunks.push(ev.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        setIsRecording(false);
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = async (e) => {
          const b64 = String(e.target.result).split(',')[1] || '';
          try {
            const r = await crmAPI.sendMedia(selectedTicket.id, {
              filename: 'audio.webm',
              mimetype: 'audio/ogg; codecs=opus',  // WA expects opus
              data_base64: b64,
            });
            if (r.data?.delivery_status === 'failed') {
              toast.error('Falha ao enviar audio: ' + (r.data.delivery_error || ''));
            } else {
              toast.success('Audio enviado');
            }
            loadMessages(selectedTicket.id);
          } catch {
            toast.error('Erro ao enviar audio');
          }
        };
        reader.readAsDataURL(blob);
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setIsRecording(true);
    } catch {
      toast.error('Microfone negado ou indisponivel');
    }
  };



  const handleSendMessage = async () => {
    if (!messageInput.trim() || !selectedTicket || sending) return;
    setSending(true);
    const text = messageInput;
    setMessageInput('');
    try {
      const res = await crmAPI.addMessage(selectedTicket.id, { content: text, sender_type: 'agent', with_signature: withSignature });
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

  const handleCreateTicket = async (form, { forceCreate = false } = {}) => {
    try {
      const res = await crmAPI.createTicket({ ...form, force_create: forceCreate });
      toast.success('Ticket criado!');
      setShowNewTicket(false);
      await loadData();
      setSelectedTicket(res.data);
    } catch (e) {
      // Backend returns 409 + { detail: { code: 'duplicate_open_ticket', existing_ticket: {...} } }
      // when a ticket already exists for this phone. Offer the operator to
      // open the existing one or force-create a second one.
      const detail = e?.response?.data?.detail;
      const isDup = e?.response?.status === 409 && detail?.code === 'duplicate_open_ticket';
      if (isDup && detail?.existing_ticket?.id) {
        const ex = detail.existing_ticket;
        const num = ex.ticket_number ? `#${ex.ticket_number}` : '';
        const choice = window.confirm(
          `Já existe um atendimento aberto ${num} para o telefone ${form.customer_phone}.\n\n` +
          `Clique em OK para ABRIR o atendimento existente.\n` +
          `Clique em CANCELAR e use o botão "Criar mesmo assim" se realmente quiser duplicar.`
        );
        if (choice) {
          // Open existing
          setShowNewTicket(false);
          try {
            const r = await crmAPI.getTicket(ex.id);
            setSelectedTicket(r.data);
            setTickets(prev => {
              const has = prev.some(t => t.id === ex.id);
              return has ? prev : [r.data, ...prev];
            });
            await loadData();
          } catch (_) { toast.error('Não foi possível abrir o atendimento existente'); }
        } else {
          // Surface a second confirm so the operator must really insist
          // on duplicating. We DO NOT close the modal silently.
          const force = window.confirm(
            `Tem certeza que deseja criar um SEGUNDO atendimento para ${form.customer_phone}?\n\n` +
            `Recomendamos abrir o existente para evitar histórico duplicado.`
          );
          if (force) {
            return handleCreateTicket(form, { forceCreate: true });
          }
        }
        return;
      }
      const fallback = e?.response?.data?.detail;
      toast.error(typeof fallback === 'string' ? fallback : 'Erro ao criar ticket');
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

  const handleSaveContact = async (_clientData) => {
    // Modal already persisted via PUT /tickets/{id}/client. We just refresh
    // the list so the chat header reflects the new denormalized name/phone.
    if (selectedTicket) {
      try {
        const r = await crmAPI.getTicket(selectedTicket.id);
        setSelectedTicket(r.data);
      } catch {}
    }
    loadData();
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
          <TabButton active={activeTab === 'grupos'} onClick={() => setActiveTab('grupos')} label="Grupos" count={counts.grupos} testId="tab-grupos" />
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {tickets.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/10 to-indigo-100 flex items-center justify-center mb-3">
                <MessageSquare className="w-7 h-7 text-primary" />
              </div>
              <p className="text-sm font-semibold text-slate-700">Tudo em dia!</p>
              <p className="text-xs text-slate-400 mt-1">{activeTab === 'atendendo' ? 'Nenhum atendimento em andamento' : activeTab === 'aguardando' ? 'Nenhum cliente aguardando' : 'Nenhuma conversa de grupo'}</p>
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
                    {(ticket.client_registered_name || ticket.customer_name)?.substring(0, 2).toUpperCase()}
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
                      <p className="font-medium text-sm text-slate-900 truncate">{ticket.client_registered_name || ticket.customer_name}</p>
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
                    {/* Pull / Claim ticket — visible only when ticket is unassigned */}
                    {!ticket.assigned_to && user?.id && (
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            await crmAPI.claimTicket(ticket.id);
                            toast.success('Atendimento puxado');
                            loadData();
                          } catch (err) {
                            toast.error(err?.response?.data?.detail || 'Falha ao puxar');
                          }
                        }}
                        data-testid={`claim-ticket-${ticket.id}`}
                        title="Puxar este atendimento para mim (ficara restrito a voce)"
                        className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500 text-white font-bold hover:bg-emerald-600"
                      >
                        + Puxar
                      </button>
                    )}
                    {/* Kanban column picker moved to chat header — list shows only Tags */}
                    {/* Tags — accept legacy NAME format and new ID (UUID) format. */}
                    {ticket.tags?.slice(0, 2).map((tag, i) => {
                      const td = allTags.find(t => t.id === tag) || allTags.find(t => t.name === tag);
                      const label = td ? td.name : tag;
                      return (
                        <span
                          key={`tag-${tag}-${i}`}
                          className="text-[9px] px-1.5 py-0.5 rounded font-medium"
                          style={td ? { background: `${td.color}1A`, color: td.color } : { background: 'rgba(79,70,229,0.1)', color: 'rgb(79,70,229)' }}
                        >{label}</span>
                      );
                    })}
                    {(ticket.value > 0) && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold">{formatBRL(ticket.value)}</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-center gap-1 flex-shrink-0">
                  {(() => {
                    // Unread = inbound (customer-sent) messages whose
                    // timestamp is AFTER the last time the current operator
                    // opened the ticket. The backend stamps
                    // `read_state[uid]` on GET /tickets/{id}, so opening
                    // the conversation zeroes the badge immediately.
                    //
                    // A message is "inbound" when none of the outgoing
                    // flags apply. Different code paths set different
                    // fields (webhook → sender_type, manual/system →
                    // from_me + direction), so we treat any positive
                    // outgoing signal as "not unread".
                    const isOutgoing = (m) => (
                      m.from_me === true ||
                      m.direction === 'outgoing' ||
                      m.sender_type === 'agent' ||
                      m.sender_type === 'system' ||
                      m.sender_type === 'bot'
                    );
                    const inboundMsgs = (ticket.messages || []).filter(m => !isOutgoing(m));
                    // Use the auth-context user, NOT a stale localStorage
                    // key (the codebase stores the session under "user",
                    // never "user_data" — the old lookup returned null and
                    // the badge effectively never used read_state).
                    const myUid = user?.id;
                    const lastRead = ticket.read_state && myUid ? ticket.read_state[myUid] : null;
                    const unread = lastRead
                      ? inboundMsgs.filter(m => ((m.timestamp || m.created_at) || '') > lastRead).length
                      : inboundMsgs.length;
                    if (unread <= 0) return null;
                    return (
                      <span className="w-5 h-5 rounded-full bg-emerald-500 text-white text-[10px] flex items-center justify-center font-bold" data-testid={`unread-badge-${ticket.id}`}>
                        {unread > 99 ? '99+' : unread}
                      </span>
                    );
                  })()}
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
                {(selectedTicket.client_registered_name || selectedTicket.customer_name)?.substring(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-sm text-slate-900 truncate">
                  {selectedTicket.client_registered_name || selectedTicket.customer_name} <span className="text-slate-400 font-normal">#{selectedTicket.ticket_number || selectedTicket.id.substring(0, 4)}</span>
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
                    </p>
                  );
                })()}
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <TicketValueEditor ticket={selectedTicket} onSaved={loadData} />
              <button onClick={() => setShowQuoteEditor(true)} className="p-2 rounded-lg hover:bg-emerald-50 text-emerald-600" title="Novo Orcamento" data-testid="new-quote-from-ticket-btn"><FileText className="w-4 h-4" /></button>
              <button onClick={() => setShowEditContact(true)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500" title="Editar contato" data-testid="edit-contact-btn"><Pencil className="w-4 h-4" /></button>
              <button onClick={handleDeleteTicket} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500" title="Excluir atendimento" data-testid="delete-ticket-btn"><Trash2 className="w-4 h-4" /></button>
              <button
                onClick={() => setShowTransferModal(true)}
                className="p-2 rounded-lg hover:bg-blue-50 text-blue-600 hidden sm:block"
                title="Transferir atendimento"
                data-testid="transfer-ticket-btn"
              >
                <ArrowRightLeft className="w-4 h-4" />
              </button>
              <button
                onClick={async () => {
                  if (!window.confirm('Fechar este atendimento?')) return;
                  try {
                    await crmAPI.updateTicket(selectedTicket.id, { status: 'fechado' });
                    toast.success('Atendimento fechado');
                    setSelectedTicket(null);
                    loadData();
                  } catch (e) { toast.error('Falha ao fechar'); }
                }}
                className="p-2 rounded-lg hover:bg-red-50 text-red-600 hidden sm:block"
                title="Fechar atendimento"
                data-testid="close-ticket-btn"
              >
                <Ban className="w-4 h-4" />
              </button>
              <div className="relative">
                <button
                  onClick={() => setShowMoreMenu(v => !v)}
                  className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"
                  title="Mais"
                  data-testid="ticket-more-btn"
                >
                  <MoreVertical className="w-4 h-4" />
                </button>
                {showMoreMenu && (
                  <div className="absolute right-0 top-full mt-1 bg-white border rounded-lg shadow-lg z-30 min-w-[220px]" onMouseLeave={() => setShowMoreMenu(false)}>
                    <button
                      onClick={() => { setShowMoreMenu(false); setShowMergeModal(true); }}
                      className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                      data-testid="merge-ticket-btn"
                    >
                      <ArrowRightLeft className="w-4 h-4 text-amber-600" /> Mesclar com outro atendimento
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* LID Pending Resolution Banner — shown when WhatsApp delivered the
              first message via a hidden @lid (privacy mode for new contacts).
              Two options for the operator:
                1. "Tentar agora" — calls the microservice to actively probe
                   WhatsApp via onWhatsApp/signalRepository. If WA is willing
                   to expose the phone now, the ticket auto-merges.
                2. "Informar telefone" — manual fallback: operator types the
                   real phone (got via voice/email/business card). */}
          {selectedTicket.pending_lid_resolution && (
            <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-center justify-between gap-3" data-testid="lid-pending-banner">
              <div className="flex items-start gap-2 min-w-0">
                <span className="text-amber-600 text-base leading-none mt-0.5">⚠</span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-amber-900">Numero do contato oculto pelo WhatsApp</p>
                  <p className="text-[11px] text-amber-700 truncate">As respostas chegam via ID interno. Aguarde a proxima mensagem do contato OU informe o telefone manualmente.</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={async () => {
                    if (!selectedTicket.connection_id || !selectedTicket.lid_jid) {
                      toast.error('Faltam dados de conexao para tentar resolver');
                      return;
                    }
                    try {
                      const r = await channelsAPI.probeLid(selectedTicket.connection_id, selectedTicket.lid_jid);
                      const data = r.data || r;
                      if (data.resolved) {
                        toast.success(`Numero descoberto: ${data.phone}. Mesclando atendimento...`);
                        loadData();
                        setSelectedTicket(null);
                      } else {
                        toast.warning(data.error || 'WhatsApp ainda nao expoe o numero. Tente novamente em alguns minutos.');
                      }
                    } catch (e) {
                      toast.error(e?.response?.data?.detail || 'Falha ao tentar resolver');
                    }
                  }}
                  className="text-xs px-2.5 py-1.5 bg-white border border-amber-400 hover:bg-amber-100 text-amber-800 rounded-md font-semibold whitespace-nowrap"
                  data-testid="probe-lid-btn"
                  title="Pergunta ao WhatsApp se o numero real ja pode ser exposto agora"
                >
                  Tentar agora
                </button>
                <button
                  onClick={async () => {
                    const real = window.prompt('Digite o telefone real do contato (com DDD, ex: 5562999999999):');
                    if (!real) return;
                    try {
                      await crmAPI.resolveTicketLid(selectedTicket.id, real);
                      toast.success('Numero atualizado! Mesclando atendimento...');
                      loadData();
                      setSelectedTicket(null);
                    } catch (e) {
                      toast.error(e?.response?.data?.detail || 'Falha ao resolver numero');
                    }
                  }}
                  className="text-xs px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-md font-semibold whitespace-nowrap"
                  data-testid="resolve-lid-btn"
                >
                  Informar telefone
                </button>
              </div>
            </div>
          )}

          {/* Tags Bar */}
          <div className="bg-white/80 px-4 py-2 border-b border-slate-200 flex items-center gap-1.5 flex-wrap">
            <Tag className="w-3 h-3 text-slate-400" />
            <span className="text-[10px] text-slate-400 font-semibold uppercase">Tags:</span>
            {(selectedTicket.tags || []).map((t, i) => {
              const td = allTags.find(at => at.id === t) || allTags.find(at => at.name === t);
              const label = td ? td.name : t;
              return (
                <span
                  key={`htag-${t}-${i}`}
                  className="text-[10px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1"
                  style={td ? { background: `${td.color}22`, color: td.color } : { background: '#E2E8F0', color: '#475569' }}
                >
                  {label}
                  <button onClick={() => handleRemoveTag(t)} className="hover:opacity-70" data-testid={`remove-tag-${label}`}>
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
                      .filter(t => !(selectedTicket.tags || []).some(x => x === t.id || x === t.name))
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
            {/* Kanban column picker — moved from contact sidebar to chat header next to Tags */}
            {kanbanColumns.length > 0 && (
              <div className="ml-2 flex items-center gap-1.5" data-testid="header-kanban-picker">
                <span className="text-[10px] text-slate-400 font-semibold uppercase">Kanban:</span>
                <KanbanColumnPicker
                  ticket={selectedTicket}
                  columns={kanbanColumns}
                  onChange={async (newCol) => {
                    try {
                      await crmAPI.updateTicket(selectedTicket.id, { kanban_column_id: newCol });
                      toast.success('Etapa atualizada');
                      loadData();
                    } catch { toast.error('Falha ao atualizar etapa'); }
                  }}
                />
              </div>
            )}
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
                  {msg.type === 'document' && msg.attachment_kind === 'quote_pdf' && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!msg.quote_id) return;
                        try {
                          const r = await api.get(`/quotes/${msg.quote_id}/pdf`, { responseType: 'blob' });
                          const url = URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
                          window.open(url, '_blank');
                          setTimeout(() => URL.revokeObjectURL(url), 60000);
                        } catch (e) {
                          toast.error('Erro ao abrir anexo: ' + (e?.response?.data?.detail || e.message));
                        }
                      }}
                      disabled={!msg.quote_id}
                      className="w-full text-left flex items-center gap-2 bg-white/70 border border-emerald-200 rounded p-2 mb-1 hover:bg-white disabled:opacity-60"
                      data-testid={`chat-quote-attachment-${msg.id}`}
                    >
                      <FileText className="w-5 h-5 text-emerald-700 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-emerald-800 truncate">{msg.attachment_filename || 'orcamento.pdf'}</p>
                        <p className="text-[10px] text-slate-500">PDF anexado</p>
                      </div>
                    </button>
                  )}
                  {/* Inbound WhatsApp media — rendered inline so the operator
                     can actually play/view it without downloading. */}
                  {msg.media_url && msg.media_kind === 'audio' && (
                    <audio
                      controls
                      preload="metadata"
                      className="w-56 sm:w-64 mb-1"
                      data-testid={`chat-audio-${msg.id}`}
                    >
                      <source
                        src={`${process.env.REACT_APP_BACKEND_URL}${msg.media_url}`}
                        type={msg.media_mimetype || 'audio/ogg'}
                      />
                    </audio>
                  )}
                  {msg.media_url && msg.media_kind === 'image' && (
                    <a
                      href={`${process.env.REACT_APP_BACKEND_URL}${msg.media_url}`}
                      target="_blank"
                      rel="noreferrer"
                      className="block mb-1"
                      data-testid={`chat-image-${msg.id}`}
                    >
                      <img
                        src={`${process.env.REACT_APP_BACKEND_URL}${msg.media_url}`}
                        alt={msg.media_filename || 'Imagem'}
                        className="max-w-[240px] max-h-60 rounded"
                      />
                    </a>
                  )}
                  {msg.media_url && msg.media_kind === 'video' && (
                    <video
                      controls
                      preload="metadata"
                      className="max-w-[280px] max-h-60 rounded mb-1"
                      data-testid={`chat-video-${msg.id}`}
                    >
                      <source
                        src={`${process.env.REACT_APP_BACKEND_URL}${msg.media_url}`}
                        type={msg.media_mimetype || 'video/mp4'}
                      />
                    </video>
                  )}
                  {msg.media_url && msg.media_kind === 'document' && (
                    <a
                      href={`${process.env.REACT_APP_BACKEND_URL}${msg.media_url}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 bg-white/70 border border-slate-200 rounded p-2 mb-1 hover:bg-white"
                      data-testid={`chat-document-${msg.id}`}
                    >
                      <FileText className="w-5 h-5 text-slate-600 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-slate-700 truncate">{msg.media_filename || 'Documento'}</p>
                        <p className="text-[10px] text-slate-400">Abrir / baixar</p>
                      </div>
                    </a>
                  )}
                  {/* Hide the placeholder content (`[Audio]`/`[Imagem]`/
                     `[Video]`) when the media has already been rendered
                     above — duplicate label is ugly and the operator
                     asked to keep just the media bubble. */}
                  {(() => {
                    const isMediaPlaceholder = msg.media_url && /^\[(Audio|Imagem|Image|Video|Documento|Document)\]$/i.test(String(msg.content || '').trim());
                    if (isMediaPlaceholder) return null;
                    return <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>;
                  })()}
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
              <button
                onClick={() => setShowQuote(true)}
                className="p-2 rounded-full hover:bg-emerald-50 text-emerald-600"
                title="Anexar Orcamento"
                data-testid="attach-quote-btn"
              >
                <FileText className="w-5 h-5" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleSendFile(f); e.target.value = ''; }}
                data-testid="file-input"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="p-2 rounded-full hover:bg-slate-100 text-slate-500 hidden sm:block"
                title="Anexar arquivo"
                data-testid="attach-file-btn"
              >
                <Paperclip className="w-5 h-5" />
              </button>
              <div className="flex-1 relative min-w-0">
                <input
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                  placeholder={withSignature ? "Digite uma mensagem (com assinatura)" : "Digite uma mensagem"}
                  className="w-full px-4 py-2.5 bg-slate-50 rounded-full border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  data-testid="message-input"
                  disabled={sending}
                />
              </div>
              <button
                onClick={() => setWithSignature(s => !s)}
                className={`p-2 rounded-full transition-colors ${withSignature ? 'bg-primary/10 text-primary' : 'hover:bg-slate-100 text-slate-400'}`}
                title={withSignature ? 'Assinatura ATIVA — clique para enviar sem nome' : 'Assinatura desativada — clique para ativar'}
                data-testid="toggle-signature-btn"
              >
                <Pencil className="w-4 h-4" />
              </button>
              <div className="relative">
                <button
                  onClick={() => setShowEmojiPicker(v => !v)}
                  className="p-2 rounded-full hover:bg-slate-100 text-slate-500 hidden sm:block"
                  title="Emojis"
                  data-testid="emoji-btn"
                >
                  <Smile className="w-5 h-5" />
                </button>
                {showEmojiPicker && (
                  <div className="absolute bottom-full right-0 mb-2 bg-white border border-slate-200 rounded-xl shadow-lg p-2 grid grid-cols-8 gap-1 w-[280px] z-50" data-testid="emoji-picker">
                    {['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','👍','👎','👌','🤝','🙏','👋','💪','🙌','🎉','🔥','✅','❌','⭐','💯','❤️','💔','🚀','💰','📞','📧','📅','⏰','✨','💡'].map(e => (
                      <button
                        key={e}
                        onClick={() => { setMessageInput(m => m + e); setShowEmojiPicker(false); }}
                        className="text-xl hover:bg-slate-100 rounded p-1"
                      >{e}</button>
                    ))}
                  </div>
                )}
              </div>
              {messageInput.trim() ? (
                <button onClick={handleSendMessage} disabled={sending} className="p-2.5 rounded-full bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50" data-testid="send-message-btn">
                  <Send className="w-5 h-5" />
                </button>
              ) : (
                <button
                  onClick={handleToggleRecording}
                  className={`p-2.5 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-primary'} text-white hover:opacity-90 transition-colors`}
                  title={isRecording ? 'Clique para parar e enviar' : 'Gravar audio'}
                  data-testid="record-audio-btn"
                >
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
      {showTransferModal && selectedTicket && (
        <TransferTicketModal
          ticket={selectedTicket}
          users={users}
          queues={queues}
          onClose={() => setShowTransferModal(false)}
          onTransferred={() => { setShowTransferModal(false); loadData(); setSelectedTicket(null); toast.success('Atendimento transferido'); }}
        />
      )}
      {showQuote && selectedTicket && (
        <QuoteAttachModal
          ticket={selectedTicket}
          connections={connections}
          initialQuoteId={pendingSendQuote}
          onClose={() => { setShowQuote(false); setPendingSendQuote(null); }}
          onSent={() => { setShowQuote(false); setPendingSendQuote(null); crmAPI.getTicket(selectedTicket.id).then(r => setSelectedTicket(r.data)).catch(() => {}); }}
        />
      )}
      {showQuoteEditor && selectedTicket && (
        <QuoteEditor
          initial={{
            client_id: selectedTicket.client_id || '',
            ticket_id: selectedTicket.id,
            ticket_number: selectedTicket.ticket_number,
            customer_name: selectedTicket.customer_name,
            customer_phone: selectedTicket.customer_phone,
          }}
          onClose={() => setShowQuoteEditor(false)}
          onSaved={() => { setShowQuoteEditor(false); toast.success('Orcamento salvo. Disponivel em "Anexar Orcamento" ou no menu Orcamentos.'); }}
          onSavedAndSend={(quote) => { setShowQuoteEditor(false); setPendingSendQuote(quote.id); setShowQuote(true); }}
        />
      )}
      {showMergeModal && selectedTicket && (
        <MergeTicketModal
          source={selectedTicket}
          allTickets={tickets}
          onClose={() => setShowMergeModal(false)}
          onMerged={() => { setShowMergeModal(false); setSelectedTicket(null); loadData(); }}
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

const TransferTicketModal = ({ ticket, users, queues, onClose, onTransferred }) => {
  const [mode, setMode] = useState('user');  // 'user' | 'queue'
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!target) return toast.error('Selecione um destino');
    setBusy(true);
    try {
      const patch = mode === 'user'
        ? { assigned_to: target, status: 'atendendo' }
        : { queue_id: target, assigned_to: null, status: 'aguardando' };
      await crmAPI.updateTicket(ticket.id, patch);
      onTransferred();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Falha ao transferir');
    } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()} data-testid="transfer-ticket-modal">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800">Transferir Atendimento</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4 text-slate-500" /></button>
        </div>
        <div className="flex gap-2 mb-3">
          <button onClick={() => { setMode('user'); setTarget(''); }} className={`flex-1 px-3 py-1.5 text-xs font-semibold rounded ${mode === 'user' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600'}`} data-testid="transfer-user-tab">Para usuario</button>
          <button onClick={() => { setMode('queue'); setTarget(''); }} className={`flex-1 px-3 py-1.5 text-xs font-semibold rounded ${mode === 'queue' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600'}`} data-testid="transfer-queue-tab">Para fila</button>
        </div>
        <select value={target} onChange={e => setTarget(e.target.value)} className="input-field w-full" data-testid="transfer-target-select">
          <option value="">— Selecione —</option>
          {mode === 'user' ? (
            users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)
          ) : (
            queues.map(q => <option key={q.id} value={q.id}>{q.name}</option>)
          )}
        </select>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-slate-300 rounded">Cancelar</button>
          <button onClick={submit} disabled={busy} className="px-3 py-1.5 text-sm bg-primary text-white rounded disabled:opacity-50" data-testid="transfer-confirm-btn">{busy ? 'Transferindo…' : 'Transferir'}</button>
        </div>
      </div>
    </div>
  );
};

const EditContactModal = ({ ticket, onClose, onSave }) => {
  // Now backed by the real Client/Lead record. Compact mode shows the
  // essentials; "Ver mais" expands to CPF/CNPJ + endereço completo.
  const [tab, setTab] = useState('cadastro'); // cadastro | historico
  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(true);  // Open by default — user explicitly requested
  const [cepLoading, setCepLoading] = useState(false);
  // CPF/CNPJ → quote lookup (badge "com orcamento" shown after debounce)
  const [docHasQuote, setDocHasQuote] = useState(null); // null=unknown, {has_quote, count}
  // Timeline state
  const [timeline, setTimeline] = useState(null);
  const [timelineLoading, setTimelineLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    crmAPI.getTicketClient(ticket.id).then(r => {
      if (!alive) return;
      setClient(r.data || {});
    }).catch(() => setClient({})).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [ticket.id]);

  // Load timeline lazily when the tab is opened.
  useEffect(() => {
    if (tab !== 'historico' || timeline || !client?.id) return;
    setTimelineLoading(true);
    crmAPI.getClientTimeline(client.id)
      .then(r => setTimeline(r.data))
      .catch(() => setTimeline({ tickets: [], stats: {} }))
      .finally(() => setTimelineLoading(false));
  }, [tab, client?.id, timeline]);

  const set = (patch) => setClient(c => ({ ...(c || {}), ...patch }));

  const formatCEP = (v) => {
    const d = (v || '').replace(/\D/g, '').slice(0, 8);
    return d.length <= 5 ? d : `${d.slice(0, 5)}-${d.slice(5)}`;
  };
  const formatCPF = (v) => {
    const d = (v || '').replace(/\D/g, '').slice(0, 11);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
    if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  };
  const formatCNPJ = (v) => {
    const d = (v || '').replace(/\D/g, '').slice(0, 14);
    if (d.length <= 2) return d;
    if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
    if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
    if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  };
  // Debounced lookup: whenever CPF/CNPJ value is "complete" (11 / 14 digits),
  // query the backend to know if a quote already exists for that document.
  const currentDoc = client?.person_type === 'juridica' ? (client?.cnpj || '') : (client?.cpf || '');
  useEffect(() => {
    const digits = (currentDoc || '').replace(/\D/g, '');
    const need = client?.person_type === 'juridica' ? 14 : 11;
    if (digits.length !== need) { setDocHasQuote(null); return; }
    let alive = true;
    const t = setTimeout(() => {
      quotesAPI.findByDocument(digits)
        .then(r => { if (alive) setDocHasQuote(r.data || null); })
        .catch(() => { if (alive) setDocHasQuote(null); });
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [currentDoc, client?.person_type]);
  const lookupCep = async (cep) => {
    const raw = (cep || '').replace(/\D/g, '');
    if (raw.length !== 8) return;
    try {
      setCepLoading(true);
      const res = await fetch(`https://viacep.com.br/ws/${raw}/json/`);
      const j = await res.json();
      if (!j.erro) {
        set({
          address: [j.logradouro, j.bairro].filter(Boolean).join(' - ') || client?.address,
          city: j.localidade || client?.city,
          state: (j.uf || client?.state || '').toUpperCase(),
        });
      }
    } catch {} finally { setCepLoading(false); }
  };

  const handleSave = async () => {
    if (!client?.name?.trim()) { toast.error('Informe o nome'); return; }
    setSaving(true);
    try {
      const r = await crmAPI.updateTicketClient(ticket.id, client);
      toast.success('Cadastro atualizado');
      onSave && onSave(r.data);
      onClose();
    } catch (e) {
      toast.error('Falha ao salvar cadastro');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto" onClick={onClose} data-testid="edit-contact-modal">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-5 my-8" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold font-heading text-slate-900">Cadastro do Cliente</h3>
            <p className="text-[11px] text-slate-400">Mesmo cadastro de Cliente / Lead. Alteracoes refletem em todos os atendimentos deste contato.</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 bg-slate-100 p-1 rounded-lg">
          <button
            onClick={() => setTab('cadastro')}
            className={`flex-1 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${tab === 'cadastro' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}
            data-testid="tab-cadastro"
          >Cadastro</button>
          <button
            onClick={() => setTab('historico')}
            disabled={!client?.id}
            className={`flex-1 px-3 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center justify-center gap-1 disabled:opacity-50 ${tab === 'historico' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}
            data-testid="tab-historico"
          >
            Historico {timeline?.stats?.total_tickets > 0 && (
              <span className="text-[10px] bg-primary text-white rounded-full px-1.5 py-0.5 leading-none">{timeline.stats.total_tickets}</span>
            )}
          </button>
        </div>

        {tab === 'cadastro' && (loading ? (
          <div className="py-10 text-center text-sm text-slate-500">Carregando...</div>
        ) : (
          <>
            {/* Tipo Pessoa */}
            <div className="flex gap-1 mb-3 bg-slate-100 p-1 rounded-lg w-full">
              {[
                { v: 'fisica', label: 'Pessoa Fisica' },
                { v: 'juridica', label: 'Pessoa Juridica' },
              ].map(o => (
                <button
                  key={o.v}
                  onClick={() => set({ person_type: o.v })}
                  className={`flex-1 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                    (client?.person_type || 'fisica') === o.v ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'
                  }`}
                  data-testid={`pt-${o.v}`}
                >{o.label}</button>
              ))}
            </div>

            {/* Compacto: nome, telefone, email, doc */}
            <div className="space-y-2.5">
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400">Nome {(client?.person_type === 'juridica') && '/ Contato'}</label>
                <input value={client?.name || ''} onChange={e => set({ name: e.target.value })} className="input-field w-full" data-testid="contact-name" />
              </div>
              {client?.person_type === 'juridica' && (
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-400">Empresa (Razao Social)</label>
                  <input value={client?.company_name || ''} onChange={e => set({ company_name: e.target.value })} className="input-field w-full" data-testid="contact-company" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-400">Telefone</label>
                  <input value={client?.phone || ''} onChange={e => set({ phone: e.target.value })} className="input-field w-full" data-testid="contact-phone" />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-400">{client?.person_type === 'juridica' ? 'CNPJ' : 'CPF'}</label>
                  <input
                    value={client?.person_type === 'juridica' ? (client?.cnpj || '') : (client?.cpf || '')}
                    onChange={e => set(client?.person_type === 'juridica' ? { cnpj: e.target.value } : { cpf: e.target.value })}
                    className="input-field w-full"
                    data-testid="contact-doc"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400">Email</label>
                <input type="email" value={client?.email || ''} onChange={e => set({ email: e.target.value })} className="input-field w-full" data-testid="contact-email" />
              </div>
            </div>

            {/* Toggle expand */}
            <button
              type="button"
              onClick={() => setExpanded(e => !e)}
              className="text-xs text-primary font-semibold mt-3 hover:underline flex items-center gap-1"
              data-testid="contact-toggle-expand"
            >
              {expanded ? 'Ocultar detalhes' : 'Ver mais (endereco, observacoes...)'}
              <span className={`inline-block transition-transform ${expanded ? 'rotate-180' : ''}`}>▾</span>
            </button>

            {expanded && (
              <div className="space-y-2.5 mt-3 pt-3 border-t border-slate-200" data-testid="contact-extra-fields">
                <div className="grid grid-cols-3 gap-2.5">
                  <div className="relative">
                    <label className="text-[10px] font-bold uppercase text-slate-400">CEP</label>
                    <input
                      value={client?.cep || ''}
                      onChange={e => {
                        const v = formatCEP(e.target.value);
                        set({ cep: v });
                        if (v.replace(/\D/g, '').length === 8) lookupCep(v);
                      }}
                      placeholder="00000-000"
                      maxLength={9}
                      className="input-field w-full"
                      data-testid="contact-cep"
                    />
                    {cepLoading && <span className="absolute right-2 top-1/2 mt-1 text-[10px] text-slate-400">...</span>}
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] font-bold uppercase text-slate-400">Cidade</label>
                    <input value={client?.city || ''} onChange={e => set({ city: e.target.value })} className="input-field w-full" data-testid="contact-city" />
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2.5">
                  <div>
                    <label className="text-[10px] font-bold uppercase text-slate-400">UF</label>
                    <input
                      value={client?.state || ''}
                      onChange={e => set({ state: (e.target.value || '').toUpperCase().slice(0, 2) })}
                      maxLength={2}
                      className="input-field w-full"
                      data-testid="contact-state"
                    />
                  </div>
                  <div className="col-span-3">
                    <label className="text-[10px] font-bold uppercase text-slate-400">Endereco</label>
                    <input value={client?.address || ''} onChange={e => set({ address: e.target.value })} className="input-field w-full" placeholder="Rua, numero, complemento, bairro" data-testid="contact-address" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-400">Observacoes</label>
                  <textarea value={client?.notes || ''} onChange={e => set({ notes: e.target.value })} className="input-field w-full" rows={2} data-testid="contact-notes" />
                </div>
              </div>
            )}
          </>
        ))}

        {tab === 'historico' && (
          timelineLoading ? (
            <div className="py-10 text-center text-sm text-slate-500" data-testid="timeline-loading">Carregando historico...</div>
          ) : (
            <div data-testid="client-timeline">
              {/* Stats grid */}
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="bg-slate-50 rounded-lg p-2.5 text-center">
                  <p className="text-[9px] uppercase font-bold text-slate-400">Atendimentos</p>
                  <p className="text-xl font-bold text-slate-900">{timeline?.stats?.total_tickets || 0}</p>
                  <p className="text-[10px] text-slate-500">{timeline?.stats?.open || 0} abertos</p>
                </div>
                <div className="bg-emerald-50 rounded-lg p-2.5 text-center">
                  <p className="text-[9px] uppercase font-bold text-emerald-600">Total movimentado</p>
                  <p className="text-base font-bold text-emerald-700 leading-tight whitespace-nowrap">{`R$ ${(timeline?.stats?.total_value || 0).toFixed(2).replace('.', ',')}`}</p>
                  <p className="text-[10px] text-emerald-600">Media R$ {(timeline?.stats?.avg_value || 0).toFixed(2).replace('.', ',')}</p>
                </div>
                <div className="bg-violet-50 rounded-lg p-2.5 text-center">
                  <p className="text-[9px] uppercase font-bold text-violet-600">Ultima visita</p>
                  <p className="text-xs font-bold text-violet-700 leading-tight">
                    {timeline?.stats?.last_visit
                      ? new Date(timeline.stats.last_visit).toLocaleDateString('pt-BR')
                      : '-'}
                  </p>
                  <p className="text-[10px] text-violet-600">
                    {timeline?.stats?.last_visit
                      ? new Date(timeline.stats.last_visit).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                      : ''}
                  </p>
                </div>
              </div>

              {/* Tickets list */}
              {(timeline?.tickets || []).length === 0 ? (
                <p className="text-center py-6 text-xs text-slate-400">Nenhum atendimento anterior.</p>
              ) : (
                <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                  {timeline.tickets.map(t => {
                    const statusMeta = {
                      aberto: { cls: 'bg-emerald-100 text-emerald-700', label: 'Aberto' },
                      em_atendimento: { cls: 'bg-blue-100 text-blue-700', label: 'Em atendimento' },
                      aguardando: { cls: 'bg-amber-100 text-amber-700', label: 'Aguardando' },
                      fechado: { cls: 'bg-slate-200 text-slate-700', label: 'Fechado' },
                      cancelado: { cls: 'bg-rose-100 text-rose-700', label: 'Cancelado' },
                    }[t.status] || { cls: 'bg-slate-100 text-slate-600', label: t.status || '-' };
                    const isCurrent = t.id === ticket.id;
                    return (
                      <div
                        key={t.id}
                        className={`flex items-center justify-between gap-2 p-2.5 rounded-lg border transition-colors ${
                          isCurrent ? 'bg-primary/5 border-primary/40' : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                        data-testid={`timeline-ticket-${t.id}`}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="text-[10px] font-bold text-slate-400 flex-shrink-0">#{t.ticket_number ?? '?'}</span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${statusMeta.cls}`}>{statusMeta.label}</span>
                              {isCurrent && <span className="text-[9px] text-primary font-semibold">atual</span>}
                            </div>
                            <p className="text-[11px] text-slate-500">
                              {new Date(t.created_at).toLocaleDateString('pt-BR')} às {new Date(t.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                              {t.channel && ` · ${t.channel}`}
                            </p>
                          </div>
                        </div>
                        {(t.value || 0) > 0 && (
                          <span className="text-xs font-bold text-emerald-700 flex-shrink-0">{`R$ ${Number(t.value).toFixed(2).replace('.', ',')}`}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="btn-secondary text-sm">Cancelar</button>
          <button onClick={handleSave} disabled={saving || loading} className="btn-primary text-sm" data-testid="save-contact-btn">
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
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

// Merge a duplicate ticket (e.g. created from an unresolved @lid phone)
// into another existing ticket. Backend endpoint copies messages/tags
// and deletes the source ticket.
const MergeTicketModal = ({ source, allTickets, onClose, onMerged }) => {
  const [search, setSearch] = useState('');
  const [merging, setMerging] = useState(false);
  const candidates = (allTickets || [])
    .filter(t => t.id !== source.id)
    .filter(t => {
      if (!search) return true;
      const q = search.toLowerCase();
      return String(t.ticket_number || '').includes(q)
        || (t.customer_name || '').toLowerCase().includes(q)
        || (t.customer_phone || '').includes(q);
    })
    .slice(0, 50);

  const handleMerge = async (target) => {
    if (!window.confirm(
      `Mesclar atendimento #${source.ticket_number} (${source.customer_phone}) DENTRO de #${target.ticket_number} (${target.customer_phone})?\n\n` +
      `Todas as mensagens e tags serao copiadas para #${target.ticket_number} e o atendimento #${source.ticket_number} sera EXCLUIDO.\n\nEsta acao nao pode ser desfeita.`
    )) return;
    setMerging(true);
    try {
      const { data } = await crmAPI.mergeTickets(source.id, target.id);
      toast.success(`Mesclado: ${data.messages_added} msgs e ${data.tags_added} tags adicionadas em #${data.into_ticket_number}`);
      onMerged && onMerged(target.id);
    } catch (e) {
      toast.error('Erro ao mesclar: ' + (e?.response?.data?.detail || e.message));
    } finally {
      setMerging(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl my-8 flex flex-col max-h-[85vh]" onClick={(e) => e.stopPropagation()} data-testid="merge-ticket-modal">
        <div className="flex justify-between items-center px-4 py-3 border-b">
          <div>
            <h2 className="font-semibold text-slate-800">Mesclar atendimento</h2>
            <p className="text-xs text-slate-500">Origem: #{source.ticket_number} {source.customer_name} — {source.customer_phone}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 overflow-y-auto">
          <div className="bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-900 mb-3">
            Selecione o atendimento <strong>de destino</strong> que vai receber as mensagens. O atendimento de origem (#{source.ticket_number}) sera <strong>excluido</strong>.
          </div>
          <input
            data-testid="merge-search"
            placeholder="Buscar por nome, telefone ou numero..."
            className="w-full border rounded px-3 py-2 text-sm mb-3"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <div className="space-y-1">
            {candidates.length === 0 ? (
              <div className="text-center text-slate-400 py-6 text-sm">Nenhum atendimento encontrado.</div>
            ) : candidates.map(t => (
              <button
                key={t.id}
                onClick={() => handleMerge(t)}
                disabled={merging}
                className="w-full text-left p-2 border rounded hover:bg-emerald-50 hover:border-emerald-300 flex justify-between items-center disabled:opacity-50"
                data-testid={`merge-target-${t.id}`}
              >
                <div>
                  <div className="font-mono text-sm text-slate-700">#{t.ticket_number}</div>
                  <div className="text-sm text-slate-800">{t.customer_name}</div>
                  <div className="text-xs text-slate-500">{t.customer_phone}</div>
                </div>
                <div className="text-xs bg-slate-100 px-2 py-0.5 rounded">{t.status}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};



export default AtendimentosPage;
