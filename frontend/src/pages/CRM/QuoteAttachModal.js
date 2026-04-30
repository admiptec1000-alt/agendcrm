import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { quotesAPI } from '../../services/api';
import { toast } from 'sonner';
import { X, FileText, Send, Plus, Eye, Loader2, ExternalLink } from 'lucide-react';

const formatBRL = (v) => {
  const n = parseFloat(v) || 0;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

/**
 * Inline quote picker for the chat. Lets the agent attach an existing quote
 * (filtered by the ticket's client) or open a brand-new quote in a separate
 * tab via Orcamentos. After selecting, choose the WhatsApp connection and
 * fire /quotes/{id}/send-whatsapp which generates the PDF + dispatches it.
 */
const QuoteAttachModal = ({ ticket, connections, onClose, onSent, initialQuoteId }) => {
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedQuote, setSelectedQuote] = useState(null);
  const [previewHtml, setPreviewHtml] = useState(null);
  const [connId, setConnId] = useState(ticket?.connection_id || '');
  const [caption, setCaption] = useState('');
  const [sending, setSending] = useState(false);

  const whatsappConns = (connections || []).filter(c => (c.channel_type || c.type || 'whatsapp') === 'whatsapp');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = ticket?.client_id ? { client_id: ticket.client_id } : {};
      const { data } = await quotesAPI.list(params);
      setQuotes(data || []);
    } catch (e) {
      toast.error('Erro ao carregar orcamentos');
    } finally {
      setLoading(false);
    }
  }, [ticket?.client_id]);

  useEffect(() => { load(); }, [load]);

  // Auto-select the just-created quote when called from the QuoteEditor flow
  useEffect(() => {
    if (initialQuoteId && quotes.length) {
      const found = quotes.find(q => q.id === initialQuoteId);
      if (found) handleSelect(found);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuoteId, quotes]);

  useEffect(() => {
    if (!connId && whatsappConns.length === 1) setConnId(whatsappConns[0].id);
  }, [connId, whatsappConns]);

  const handleSelect = async (q) => {
    setSelectedQuote(q);
    setCaption(`Segue orcamento #${q.quote_number} no valor de ${formatBRL(q.total_value)}`);
    try {
      const { data } = await quotesAPI.render(q.id);
      setPreviewHtml(data.html);
    } catch (e) {
      setPreviewHtml('<p style="padding:16px;color:#a00">Falha ao gerar preview</p>');
    }
  };

  const handleSend = async () => {
    if (!selectedQuote) { toast.error('Selecione um orcamento'); return; }
    if (!connId) { toast.error('Selecione uma conexao WhatsApp'); return; }
    setSending(true);
    try {
      const { data } = await quotesAPI.sendWhatsApp(selectedQuote.id, {
        connection_id: connId,
        ticket_id: ticket.id,
        caption: caption || undefined,
      });
      toast.success(`Orcamento enviado via WhatsApp (${data.delivery_status})`);
      onSent && onSent();
    } catch (e) {
      const msg = e?.response?.data?.detail || e.message;
      toast.error(`Falha no envio: ${msg}`);
    } finally {
      setSending(false);
    }
  };

  const goCreateNew = () => {
    // The Orcamentos page lives under the same dashboard. We persist a hint
    // in sessionStorage so the page can deep-link to "open a new quote with
    // this client pre-selected" once the user implements that handoff. For
    // now we just navigate via a friendly toast + open in new tab.
    sessionStorage.setItem('quote_prefill_client_id', ticket.client_id || '');
    sessionStorage.setItem('quote_prefill_ticket_id', ticket.id || '');
    window.open('/' + (window.location.pathname.split('/')[1] || '') + '/dashboard?tab=orcamentos', '_blank');
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-3" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
        data-testid="quote-attach-modal"
      >
        <div className="flex justify-between items-center px-4 py-3 border-b">
          <h2 className="font-semibold text-slate-800 flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-600" /> Anexar Orcamento ao chat
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800"><X className="w-5 h-5" /></button>
        </div>

        <div className="grid md:grid-cols-2 gap-0 flex-1 overflow-hidden">
          {/* LEFT: quote list */}
          <div className="border-r overflow-y-auto p-3">
            <div className="flex justify-between items-center mb-3">
              <span className="text-xs font-semibold text-slate-600 uppercase">
                {ticket?.client_id ? 'Orcamentos deste cliente' : 'Orcamentos recentes'}
              </span>
              <button
                onClick={goCreateNew}
                className="text-xs flex items-center gap-1 text-emerald-700 border border-emerald-300 rounded px-2 py-1 hover:bg-emerald-50"
                data-testid="open-new-quote-btn"
              >
                <Plus className="w-3 h-3" /> Novo
              </button>
            </div>

            {loading ? (
              <div className="text-center py-6 text-slate-400 text-sm">Carregando...</div>
            ) : quotes.length === 0 ? (
              <div className="text-center py-6 text-slate-400 text-sm">
                Nenhum orcamento encontrado. Clique em <strong>Novo</strong> para criar.
              </div>
            ) : (
              <ul className="space-y-1">
                {quotes.map(q => {
                  const active = selectedQuote?.id === q.id;
                  return (
                    <li key={q.id}>
                      <button
                        onClick={() => handleSelect(q)}
                        data-testid={`pick-quote-${q.id}`}
                        className={`w-full text-left p-2 rounded border transition ${
                          active ? 'bg-emerald-50 border-emerald-400' : 'border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex justify-between items-center">
                          <span className="font-mono text-sm text-slate-700">#{q.quote_number}</span>
                          <span className="text-xs bg-slate-100 px-2 py-0.5 rounded">{q.status}</span>
                        </div>
                        {q.client_name && <div className="text-xs text-slate-500 mt-0.5 truncate">{q.client_name}</div>}
                        <div className="text-sm font-semibold text-emerald-700 mt-1">{formatBRL(q.total_value)}</div>
                        {q.created_at && <div className="text-[10px] text-slate-400">{new Date(q.created_at).toLocaleString('pt-BR')}</div>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* RIGHT: preview + send */}
          <div className="flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto bg-slate-50">
              {selectedQuote ? (
                <div className="p-2">
                  <div
                    className="bg-white rounded border shadow-sm transform scale-[0.7] origin-top-left"
                    style={{ width: '143%', minHeight: '600px' }}
                    data-testid="quote-attach-preview"
                    dangerouslySetInnerHTML={{ __html: previewHtml || '<p style="padding:16px">Carregando...</p>' }}
                  />
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-400 text-sm p-6 text-center">
                  Selecione um orcamento ao lado para ver o preview e enviar.
                </div>
              )}
            </div>

            <div className="border-t p-3 space-y-2 bg-white">
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Conexao WhatsApp</span>
                <select
                  value={connId}
                  onChange={(e) => setConnId(e.target.value)}
                  className="w-full mt-1 border rounded px-2 py-1.5 text-sm"
                  data-testid="quote-attach-connection"
                  disabled={!selectedQuote}
                >
                  <option value="">— Selecione —</option>
                  {whatsappConns.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name || c.id} {c.status === 'connected' ? '(conectada)' : '(offline)'}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Mensagem (legenda do PDF)</span>
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  rows={2}
                  className="w-full mt-1 border rounded px-2 py-1.5 text-sm"
                  data-testid="quote-attach-caption"
                  disabled={!selectedQuote}
                  placeholder="Texto que acompanha o PDF..."
                />
              </label>
              <div className="flex justify-between items-center gap-2 pt-1">
                {selectedQuote && (
                  <a
                    href={quotesAPI.pdfUrl(selectedQuote.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1"
                    data-testid="download-pdf-link"
                  >
                    <ExternalLink className="w-3 h-3" /> Abrir PDF
                  </a>
                )}
                <div className="flex-1" />
                <button onClick={onClose} className="px-3 py-1.5 text-sm text-slate-600">Cancelar</button>
                <button
                  onClick={handleSend}
                  disabled={!selectedQuote || !connId || sending}
                  className="bg-emerald-600 text-white px-4 py-1.5 rounded text-sm flex items-center gap-1 hover:bg-emerald-700 disabled:opacity-50"
                  data-testid="send-quote-whatsapp-btn"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {sending ? 'Enviando...' : 'Enviar via WhatsApp'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default QuoteAttachModal;
