import React, { useEffect, useState } from 'react';
import { ChevronUp, ChevronDown, Lock, History } from 'lucide-react';
import { crmAPI } from '../services/api';

const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
};

const msgEpoch = (m) => {
  const v = m.created_at || m.timestamp;
  if (!v) return 0;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
};
const sortByDate = (msgs) => (msgs || []).map((m, i) => ({ m, i, t: msgEpoch(m) })).sort((a, b) => (a.t - b.t) || (a.i - b.i)).map(x => x.m);

const isOutgoing = (m) => m.from_me === true || m.direction === 'outgoing' || m.sender_type === 'agent' || m.sender_type === 'system' || m.sender_type === 'bot';

const PrevBubble = ({ m }) => {
  const content = m.content != null ? m.content : (m.text || '');
  if (!content && !m.media_url) return null;
  const mine = isOutgoing(m);
  if (m.system || m.sender_type === 'system') {
    return (
      <div className="flex justify-center mb-2">
        <span className="text-[10px] bg-slate-200/80 text-slate-600 px-2.5 py-1 rounded-md">{content}</span>
      </div>
    );
  }
  const mediaHref = m.media_url && m.media_url.startsWith('/api') ? `${process.env.REACT_APP_BACKEND_URL}${m.media_url}` : m.media_url;
  return (
    <div className={`flex mb-2 ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[75%] rounded-xl px-3 py-2 shadow-sm text-sm opacity-80 ${mine ? 'bg-[#D9FDD3] rounded-tr-sm' : 'bg-white rounded-tl-sm'}`}>
        {mine && <p className="text-[10px] font-bold text-emerald-700 mb-0.5">{m.sender_name || 'Atendente'}</p>}
        {m.media_url && (
          <a href={mediaHref} target="_blank" rel="noreferrer" className="text-xs text-blue-600 underline block mb-1">
            {m.media_kind === 'image' ? 'Imagem' : m.media_kind === 'audio' ? 'Áudio' : m.media_kind === 'video' ? 'Vídeo' : 'Arquivo'}
          </a>
        )}
        {content && <p className="whitespace-pre-wrap break-words text-slate-800">{content}</p>}
        <p className="text-[9px] text-slate-400 text-right mt-0.5">{fmtDate(m.created_at || m.timestamp)}</p>
      </div>
    </div>
  );
};

const PrevBar = ({ prev, depth, open, onToggle }) => {
  const label = `Ticket anterior #${prev.ticket_number}${prev.closed_at ? ` · encerrado ${fmtDate(prev.closed_at)}` : ''}${prev.assigned_to_name ? ` · ${prev.assigned_to_name}` : ''}`;
  return (
    <button
      type="button"
      onClick={() => prev.can_view && onToggle()}
      disabled={!prev.can_view}
      data-testid={`previous-ticket-toggle-${depth}`}
      className={`w-full flex items-center justify-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
        prev.can_view
          ? 'bg-white/90 border-slate-200 text-indigo-700 hover:bg-indigo-50 cursor-pointer'
          : 'bg-slate-100/80 border-slate-200 text-slate-400 cursor-not-allowed'
      }`}
      title={prev.can_view ? (open ? 'Recolher conversa anterior' : 'Ver conversa do ticket anterior') : 'Sem acesso à conversa deste ticket'}
    >
      {prev.can_view ? (open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />) : <Lock className="w-3 h-3" />}
      <History className="w-3 h-3" />
      <span className="truncate">{label}</span>
      {!prev.can_view && <span className="ml-1">(sem acesso)</span>}
    </button>
  );
};

// Cadeia lazy: `chain[0]` e o ticket imediatamente anterior ao atual;
// `chain[n]` e o anterior de `chain[n-1]`. So carrega o proximo elo quando
// o operador clica na setinha do ultimo aberto — nunca a cadeia inteira.
const PreviousTicketHistory = ({ ticketId }) => {
  const [chain, setChain] = useState([]);
  const [openDepth, setOpenDepth] = useState(-1);

  useEffect(() => {
    let alive = true;
    setChain([]); setOpenDepth(-1);
    crmAPI.getPreviousTicket(ticketId)
      .then(r => { if (alive && r.data && r.data.previous) setChain([r.data.previous]); })
      .catch(() => {});
    return () => { alive = false; };
  }, [ticketId]);

  if (chain.length === 0) return null;

  const toggle = async (depth) => {
    if (openDepth >= depth) { setOpenDepth(depth - 1); return; }
    setOpenDepth(depth);
    const node = chain[depth];
    if (node.has_older && !chain[depth + 1]) {
      try {
        const r = await crmAPI.getPreviousTicket(node.id);
        if (r.data && r.data.previous) setChain(c => [...c.slice(0, depth + 1), r.data.previous]);
      } catch {}
    }
  };

  // Renderiza do mais antigo (topo) pro mais recente (embaixo, logo acima da conversa atual).
  const visible = chain.slice(0, openDepth + 2);
  return (
    <div className="mb-3" data-testid="previous-ticket-history">
      {[...visible].reverse().map((prev, i) => {
        const depth = visible.length - 1 - i;
        const open = openDepth >= depth;
        return (
          <div key={prev.id} className="mb-2" data-testid={`previous-ticket-block-${depth}`}>
            <PrevBar prev={prev} depth={depth} open={open} onToggle={() => toggle(depth)} />
            {open && prev.can_view && (
              <div className="mt-2 pb-2 border-b border-dashed border-slate-300" data-testid={`previous-ticket-messages-${depth}`}>
                <div className="flex items-center justify-center mb-3">
                  <span className="text-[10px] bg-indigo-100 text-indigo-700 px-3 py-1 rounded-lg shadow-sm font-semibold">— Ticket #{prev.ticket_number} —</span>
                </div>
                {sortByDate(prev.messages).map((m, idx) => <PrevBubble key={m.id || `p-${idx}`} m={m} />)}
                {(!prev.messages || prev.messages.length === 0) && (
                  <p className="text-center text-[11px] text-slate-400">Sem mensagens neste ticket</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export { PreviousTicketHistory };
export default PreviousTicketHistory;
