import React, { useState, useEffect } from 'react';
import { crmAPI, channelsAPI } from '../../services/api';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, X, Bot, MessageSquareText } from 'lucide-react';

const COLORS = ['#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#06B6D4', '#8B5CF6', '#EC4899', '#64748B'];

const QueuesPage = () => {
  const [queues, setQueues] = useState([]);
  const [flows, setFlows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', color: '#4F46E5', description: '', welcome_message: '', bot_flow_id: '', connection_ids: [] });
  const [connections, setConnections] = useState([]);

  const reload = async () => {
    setLoading(true);
    try {
      const [q, f, c] = await Promise.all([
        crmAPI.listQueues(),
        crmAPI.listFlows(),
        channelsAPI.getConnections().catch(() => ({ data: [] })),
      ]);
      setQueues(q.data);
      setFlows(f.data);
      setConnections(c.data || []);
    } catch (e) {} finally { setLoading(false); }
  };
  useEffect(() => { reload(); }, []);

  const openNew = () => {
    setEditing(null);
    setForm({ name: '', color: '#4F46E5', description: '', welcome_message: '', bot_flow_id: '', connection_ids: [] });
    setShowModal(true);
  };
  const openEdit = (q) => {
    setEditing(q);
    setForm({
      name: q.name, color: q.color || '#4F46E5',
      description: q.description || '', welcome_message: q.welcome_message || '',
      bot_flow_id: q.bot_flow_id || '',
      connection_ids: q.connection_ids || [],
    });
    setShowModal(true);
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error('Nome obrigatorio'); return; }
    try {
      const payload = { ...form, bot_flow_id: form.bot_flow_id || null };
      if (editing) {
        await crmAPI.updateQueue(editing.id, payload);
        toast.success('Fila atualizada');
      } else {
        await crmAPI.createQueue(payload);
        toast.success('Fila criada');
      }
      setShowModal(false); reload();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Erro'); }
  };

  const remove = async (q) => {
    if (!window.confirm(`Excluir a fila "${q.name}"?`)) return;
    try { await crmAPI.deleteQueue(q.id); toast.success('Removida'); reload(); }
    catch (e) { toast.error('Erro'); }
  };

  return (
    <div className="animate-fade-in" data-testid="queues-page">
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div>
          <h2 className="text-lg font-bold font-page-title">Filas & Chatbot</h2>
          <p className="text-xs text-slate-500">Organize seus atendimentos por fila e atribua um fluxo de chatbot.</p>
        </div>
        <button onClick={openNew} className="btn-primary text-sm flex items-center gap-1.5" data-testid="new-queue-btn">
          <Plus className="w-4 h-4" /> Nova Fila
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Carregando...</div>
      ) : queues.length === 0 ? (
        <div className="card text-center py-16">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3"><Bot className="w-7 h-7 text-primary" /></div>
          <p className="text-sm text-slate-700 font-semibold">Nenhuma fila criada</p>
          <p className="text-xs text-slate-400 mt-1">Crie sua primeira fila para distribuir atendimentos.</p>
          <button onClick={openNew} className="btn-primary text-sm mt-4">Criar Fila</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="queues-list">
          {queues.map(q => {
            const flow = flows.find(f => f.id === q.bot_flow_id);
            return (
              <div key={q.id} className="card overflow-hidden p-0" data-testid={`queue-${q.id}`}>
                <div className="px-4 py-3 text-white" style={{ background: q.color }}>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm truncate">{q.name}</span>
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(q)} className="p-1 rounded hover:bg-white/20"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => remove(q)} className="p-1 rounded hover:bg-white/20"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                </div>
                <div className="p-3 space-y-2">
                  <p className="text-xs text-slate-500 line-clamp-2">{q.description || 'Sem descricao'}</p>
                  {q.welcome_message && (
                    <div className="flex items-start gap-1.5 text-[11px] text-slate-600 bg-slate-50 p-2 rounded-md">
                      <MessageSquareText className="w-3 h-3 mt-0.5 flex-shrink-0" />
                      <span className="line-clamp-2">{q.welcome_message}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                    <Bot className="w-3 h-3" />
                    <span>{flow ? `Fluxo: ${flow.name}` : 'Sem chatbot'}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md my-8" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h3 className="text-base font-bold">{editing ? 'Editar' : 'Nova'} Fila</h3>
              <button onClick={() => setShowModal(false)} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400">Nome</label>
                <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Ex: Vendas" className="input-field w-full text-sm" data-testid="queue-name" />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400">Cor</label>
                <div className="grid grid-cols-8 gap-2 mt-1">
                  {COLORS.map(c => (
                    <button key={c} onClick={() => setForm({...form, color: c})} className={`w-8 h-8 rounded-lg ${form.color === c ? 'ring-2 ring-offset-2 ring-slate-900' : ''}`} style={{ background: c }} />
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400">Descricao</label>
                <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="input-field w-full text-sm" rows={2} />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400">Mensagem de boas-vindas (opcional)</label>
                <textarea value={form.welcome_message} onChange={e => setForm({...form, welcome_message: e.target.value})} placeholder="Ola, bem-vindo! Como podemos ajudar?" className="input-field w-full text-sm" rows={3} />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400">Fluxo de Chatbot (opcional)</label>
                <select value={form.bot_flow_id} onChange={e => setForm({...form, bot_flow_id: e.target.value})} className="input-field w-full text-sm">
                  <option value="">Sem chatbot</option>
                  {flows.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400">Conexoes vinculadas (M3)</label>
                <p className="text-[10px] text-slate-500 mb-1.5">Selecione uma ou mais conexoes WhatsApp que devem encaminhar atendimentos para esta fila.</p>
                <div className="border border-slate-200 rounded-lg max-h-32 overflow-y-auto bg-slate-50 p-1.5 space-y-0.5" data-testid="queue-connections-list">
                  {connections.length === 0 && <p className="text-[11px] text-slate-400 text-center py-2">Nenhuma conexao cadastrada</p>}
                  {connections.map(c => {
                    const checked = form.connection_ids.includes(c.id);
                    return (
                      <label key={c.id} className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-xs ${checked ? 'bg-blue-100 text-blue-800' : 'bg-white hover:bg-blue-50 text-slate-700'}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setForm(f => ({ ...f, connection_ids: checked ? f.connection_ids.filter(x => x !== c.id) : [...f.connection_ids, c.id] }))}
                          data-testid={`queue-conn-${c.id}`}
                        />
                        <span className="flex-1 truncate">{c.name || c.id}</span>
                        <span className="text-[10px] text-slate-500">{c.status || ''}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 p-3 border-t border-slate-200">
              <button onClick={() => setShowModal(false)} className="btn-secondary text-sm">Cancelar</button>
              <button onClick={save} className="btn-primary text-sm" data-testid="save-queue-btn">{editing ? 'Salvar' : 'Criar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QueuesPage;
