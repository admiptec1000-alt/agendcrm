import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { crmAPI } from '../../services/api';
import { toast } from 'sonner';
import {
  Search, Plus, X, Phone, Mail, Send, Paperclip, Smile, Mic,
  Clock, MessageSquare, Users, Filter, ChevronLeft, MoreVertical,
  Zap, Tag, User, Hash, ArrowRightLeft, Ban, CheckCircle2,
  Instagram, Globe, Smartphone
} from 'lucide-react';

const CHANNEL_ICONS = {
  whatsapp: { icon: Smartphone, color: 'text-emerald-600', bg: 'bg-emerald-100', label: 'WhatsApp' },
  instagram: { icon: Instagram, color: 'text-pink-600', bg: 'bg-pink-100', label: 'Instagram' },
  web: { icon: Globe, color: 'text-blue-600', bg: 'bg-blue-100', label: 'Web' },
  email: { icon: Mail, color: 'text-violet-600', bg: 'bg-violet-100', label: 'Email' },
};

const STATUS_COLORS = {
  aberto: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Aberto' },
  em_cobranca: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Em Cobranca' },
  pago: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Pago' },
  bloqueado: { bg: 'bg-red-100', text: 'text-red-700', label: 'Bloqueado' },
  proposta: { bg: 'bg-violet-100', text: 'text-violet-700', label: 'Proposta' },
  fechado: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Fechado' },
};

const AtendimentosPage = () => {
  const { user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [counts, setCounts] = useState({ atendendo: 0, aguardando: 0, total: 0 });
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [showContactInfo, setShowContactInfo] = useState(false);
  const [showNewTicket, setShowNewTicket] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('atendendo');
  const [channelFilter, setChannelFilter] = useState('');
  const [messageInput, setMessageInput] = useState('');
  const messagesEndRef = useRef(null);

  useEffect(() => { loadData(); }, [activeTab, channelFilter, searchTerm]);

  const loadData = async () => {
    try {
      const params = { tab: activeTab };
      if (channelFilter) params.channel = channelFilter;
      if (searchTerm) params.search = searchTerm;
      const [ticketsRes, countsRes] = await Promise.all([
        crmAPI.getTickets(params),
        crmAPI.getTicketCounts()
      ]);
      setTickets(ticketsRes.data);
      setCounts(countsRes.data);
    } catch (e) { /* silent */ }
  };

  const handleSelectTicket = (ticket) => {
    setSelectedTicket(ticket);
    setShowContactInfo(false);
  };

  const handleSendMessage = async () => {
    if (!messageInput.trim() || !selectedTicket) return;
    try {
      await crmAPI.addMessage(selectedTicket.id, { content: messageInput, sender_type: 'agent' });
      setMessageInput('');
      // Reload ticket
      const updatedTickets = await crmAPI.getTickets({ tab: activeTab });
      setTickets(updatedTickets.data);
      const updated = updatedTickets.data.find(t => t.id === selectedTicket.id);
      if (updated) setSelectedTicket(updated);
    } catch (e) { toast.error('Erro ao enviar mensagem'); }
  };

  const handleCreateTicket = async (form) => {
    try {
      const res = await crmAPI.createTicket(form);
      toast.success('Ticket criado!');
      setShowNewTicket(false);
      await loadData();
      setSelectedTicket(res.data);
    } catch (e) {
      toast.error('Erro ao criar ticket');
      setShowNewTicket(false);
    }
  };

  const formatTime = (isoDate) => {
    if (!isoDate) return '';
    const d = new Date(isoDate);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  };

  const getLastMessage = (ticket) => {
    if (ticket.messages?.length > 0) return ticket.messages[ticket.messages.length - 1];
    return { content: ticket.description || 'Sem mensagens', sender_type: 'system' };
  };

  return (
    <div className="flex h-full w-full overflow-hidden" data-testid="atendimentos-page">
      {/* === CONVERSATION LIST === */}
      <div className={`${selectedTicket ? 'hidden lg:flex' : 'flex'} flex-col w-full lg:w-[380px] border-r border-slate-200 bg-white flex-shrink-0`}>
        {/* Modern header with gradient and KPIs */}
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
              title="Novo atendimento"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
          {/* Search */}
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

        {/* Channel filter chips */}
        <div className="px-3 py-2 border-b border-slate-200 flex items-center gap-1.5 overflow-x-auto">
          {[
            { v: '', label: 'Todos' },
            { v: 'whatsapp', label: 'WhatsApp' },
            { v: 'instagram', label: 'Instagram' },
            { v: 'web', label: 'Web' },
            { v: 'email', label: 'Email' },
          ].map(c => (
            <button
              key={c.v}
              onClick={() => setChannelFilter(c.v)}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap transition-all ${
                channelFilter === c.v
                  ? 'bg-primary text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
              data-testid={`channel-chip-${c.v || 'all'}`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200">
          <TabButton active={activeTab === 'atendendo'} onClick={() => setActiveTab('atendendo')} label="Atendendo" count={counts.atendendo} testId="tab-atendendo" />
          <TabButton active={activeTab === 'aguardando'} onClick={() => setActiveTab('aguardando')} label="Aguardando" count={counts.aguardando} testId="tab-aguardando" />
        </div>

        {/* Conversation List */}
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
            const ch = CHANNEL_ICONS[ticket.channel] || CHANNEL_ICONS.web;
            const ChIcon = ch.icon;
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
                {/* Avatar */}
                <div className="relative flex-shrink-0">
                  <div className="w-11 h-11 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-bold text-sm">
                    {ticket.customer_name?.substring(0, 2).toUpperCase()}
                  </div>
                  <div className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full ${ch.bg} flex items-center justify-center`}>
                    <ChIcon className={`w-2.5 h-2.5 ${ch.color}`} />
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <p className="font-medium text-sm text-slate-900 truncate">{ticket.customer_name}</p>
                    <span className="text-[10px] text-slate-400 flex-shrink-0 ml-2">{formatTime(ticket.updated_at)}</span>
                  </div>
                  <p className="text-xs text-slate-500 truncate mb-1.5">
                    {lastMsg.sender_type === 'agent' && <span className="text-slate-700">Voce: </span>}
                    {lastMsg.content}
                  </p>
                  <div className="flex items-center gap-1 flex-wrap">
                    {ticket.tags?.map((tag, i) => (
                      <span key={`tag-${tag}-${i}`} className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">{tag}</span>
                    ))}
                    {ticket.status && STATUS_COLORS[ticket.status] && (
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${STATUS_COLORS[ticket.status].bg} ${STATUS_COLORS[ticket.status].text}`}>
                        {STATUS_COLORS[ticket.status].label}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
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
        <div className="flex-1 flex flex-col bg-[#ECE5DD]">
          {/* Chat Header */}
          <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3">
            <button onClick={() => setSelectedTicket(null)} className="lg:hidden p-1 rounded hover:bg-slate-100" data-testid="back-to-list">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="cursor-pointer flex items-center gap-3 flex-1" onClick={() => setShowContactInfo(!showContactInfo)} data-testid="open-contact-info">
              <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-bold text-sm">
                {selectedTicket.customer_name?.substring(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="font-semibold text-sm text-slate-900">
                  {selectedTicket.customer_name} <span className="text-slate-400 font-normal">#{selectedTicket.id.substring(0, 4)}</span>
                </p>
                <p className="text-xs text-slate-500">
                  Atribuido a: {selectedTicket.assigned_to || user?.name || 'Admin'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button className="p-2 rounded-lg hover:bg-slate-100 text-slate-500" title="Transferir"><ArrowRightLeft className="w-4 h-4" /></button>
              <button className="p-2 rounded-lg hover:bg-slate-100 text-slate-500" title="Fechar"><Ban className="w-4 h-4" /></button>
              <button className="p-2 rounded-lg hover:bg-slate-100 text-slate-500" title="Mais"><MoreVertical className="w-4 h-4" /></button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-6">
            {/* Tags bar */}
            <div className="flex items-center gap-1.5 mb-4 px-2">
              <Tag className="w-3 h-3 text-slate-400" />
              <span className="text-[10px] text-slate-400">Tags:</span>
              {(selectedTicket.tags?.length > 0 ? selectedTicket.tags : ['Sem tags']).map((t, i) => (
                <span key={`tag-${t}-${i}`} className="text-[10px] px-2 py-0.5 rounded-full bg-white/80 text-slate-600">{t}</span>
              ))}
            </div>

            {/* Date divider */}
            <div className="flex items-center justify-center mb-4">
              <span className="text-[10px] bg-white/90 text-slate-500 px-3 py-1 rounded-lg shadow-sm">HOJE</span>
            </div>

            {/* Messages */}
            {selectedTicket.messages?.map((msg) => (
              <div key={msg.id} className={`flex mb-3 ${msg.sender_type === 'agent' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] rounded-xl px-4 py-2.5 shadow-sm ${
                  msg.sender_type === 'agent'
                    ? 'bg-[#D9FDD3] text-slate-800 rounded-tr-sm'
                    : 'bg-white text-slate-800 rounded-tl-sm'
                }`}>
                  {msg.sender_type === 'agent' && (
                    <p className="text-[10px] font-bold text-emerald-700 mb-0.5">{msg.sender_name || 'Admin'}</p>
                  )}
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  <p className="text-[10px] text-slate-400 text-right mt-1">
                    {formatTime(msg.created_at)}
                    {msg.sender_type === 'agent' && <CheckCircle2 className="w-3 h-3 inline ml-1 text-blue-500" />}
                  </p>
                </div>
              </div>
            ))}

            {selectedTicket.messages?.length === 0 && (
              <div className="text-center py-12">
                <p className="text-sm text-slate-400 bg-white/80 inline-block px-4 py-2 rounded-lg">Nenhuma mensagem nesta conversa</p>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Message Input */}
          <div className="bg-white border-t border-slate-200 px-4 py-3">
            <div className="flex items-center gap-2">
              <button className="p-2 rounded-full hover:bg-slate-100 text-slate-500"><Paperclip className="w-5 h-5" /></button>
              <div className="flex-1 relative">
                <input
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                  placeholder="Digite uma mensagem ou aperte / para respostas rapidas"
                  className="w-full px-4 py-2.5 bg-slate-50 rounded-full border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  data-testid="message-input"
                />
              </div>
              <button className="p-2 rounded-full hover:bg-slate-100 text-slate-500"><Smile className="w-5 h-5" /></button>
              {messageInput.trim() ? (
                <button onClick={handleSendMessage} className="p-2.5 rounded-full bg-primary text-white hover:bg-primary/90 transition-colors" data-testid="send-message-btn">
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
            </div>
          </div>
          <div className="p-4 space-y-4">
            <InfoRow icon={<Phone className="w-4 h-4" />} label="Telefone" value={selectedTicket.customer_phone} />
            <InfoRow icon={<Mail className="w-4 h-4" />} label="Email" value={selectedTicket.customer_email || 'Nao informado'} />
            <InfoRow icon={<Hash className="w-4 h-4" />} label="Canal" value={selectedTicket.channel} />
            <InfoRow icon={<Clock className="w-4 h-4" />} label="Criado em" value={formatTime(selectedTicket.created_at)} />
            <InfoRow icon={<User className="w-4 h-4" />} label="Atribuido a" value={selectedTicket.assigned_to || 'Admin'} />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Status</p>
              {STATUS_COLORS[selectedTicket.status] && (
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_COLORS[selectedTicket.status].bg} ${STATUS_COLORS[selectedTicket.status].text}`}>
                  {STATUS_COLORS[selectedTicket.status].label}
                </span>
              )}
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {(selectedTicket.tags?.length > 0 ? selectedTicket.tags : []).map((t, i) => (
                  <span key={`dtag-${t}-${i}`} className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">{t}</span>
                ))}
                <button className="text-xs px-2 py-0.5 rounded-full border border-dashed border-slate-300 text-slate-400 hover:border-primary hover:text-primary transition-colors">+ Tag</button>
              </div>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Descricao</p>
              <p className="text-sm text-slate-600">{selectedTicket.description || 'Sem descricao'}</p>
            </div>
          </div>
        </div>
      )}

      {/* New Ticket Modal */}
      {showNewTicket && <NewTicketModal onClose={() => setShowNewTicket(false)} onSave={handleCreateTicket} />}
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

const formatTime = (isoDate) => {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

const NewTicketModal = ({ onClose, onSave }) => {
  const [form, setForm] = useState({
    customer_name: '', customer_phone: '', customer_email: '',
    description: '', priority: 'medium', channel: 'whatsapp', status: 'aberto'
  });

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold font-heading text-slate-900">Novo Atendimento</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">
          <input value={form.customer_name} onChange={e => setForm({...form, customer_name: e.target.value})} placeholder="Nome do cliente" className="input-field" data-testid="new-ticket-name" />
          <input value={form.customer_phone} onChange={e => setForm({...form, customer_phone: e.target.value})} placeholder="Telefone (WhatsApp)" className="input-field" data-testid="new-ticket-phone" />
          <input value={form.customer_email} onChange={e => setForm({...form, customer_email: e.target.value})} placeholder="Email (opcional)" className="input-field" type="email" />
          <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Descricao ou primeira mensagem" className="input-field" rows={2} />
          <div className="grid grid-cols-2 gap-3">
            <select value={form.channel} onChange={e => setForm({...form, channel: e.target.value})} className="input-field text-sm">
              <option value="whatsapp">WhatsApp</option>
              <option value="instagram">Instagram</option>
              <option value="web">Web</option>
              <option value="email">Email</option>
            </select>
            <select value={form.priority} onChange={e => setForm({...form, priority: e.target.value})} className="input-field text-sm">
              <option value="low">Baixa</option>
              <option value="medium">Media</option>
              <option value="high">Alta</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="btn-secondary text-sm">Cancelar</button>
          <button
            onClick={() => { if (form.customer_name && form.customer_phone) onSave(form); else toast.error('Preencha nome e telefone'); }}
            className="btn-primary text-sm"
            data-testid="save-new-ticket"
          >
            Criar Atendimento
          </button>
        </div>
      </div>
    </div>
  );
};

export default AtendimentosPage;
