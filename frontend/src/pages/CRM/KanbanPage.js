import React, { useState, useEffect, useRef } from 'react';
import { crmAPI } from '../../services/api';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, X, Phone, MessageSquare, GripHorizontal, ArrowLeftRight } from 'lucide-react';

const COLORS = ['#4F46E5','#EF4444','#F59E0B','#10B981','#06B6D4','#8B5CF6','#EC4899','#64748B'];

const KanbanPage = ({ setActivePage }) => {
  const [data, setData] = useState({ columns: [], tickets_by_column: {} });
  const [loading, setLoading] = useState(true);
  const [showColModal, setShowColModal] = useState(false);
  const [editingCol, setEditingCol] = useState(null);
  const [colForm, setColForm] = useState({ name: '', color: '#4F46E5' });
  const [draggingTicket, setDraggingTicket] = useState(null);

  // === Disfarçado: reorder mode ===
  // Activated via secret long-press (3s) on the page TITLE OR by pressing
  // Shift+R on the keyboard. Visually swaps the page subtitle and adds a
  // "drag-handle" affordance to non-native columns. Drag a column header
  // onto another to swap order. Persists via /kanban-columns/reorder.
  const [reorderMode, setReorderMode] = useState(false);
  const [draggingColId, setDraggingColId] = useState(null);
  const titlePressTimer = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (e.shiftKey && (e.key === 'R' || e.key === 'r')) { setReorderMode(m => !m); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const reload = async () => {
    setLoading(true);
    try { const r = await crmAPI.getKanbanV2(); setData(r.data); }
    catch (e) {} finally { setLoading(false); }
  };
  useEffect(() => { reload(); }, []);

  const openNewCol = () => {
    setEditingCol(null);
    setColForm({ name: '', color: '#4F46E5' });
    setShowColModal(true);
  };

  const openEditCol = (c) => {
    setEditingCol(c);
    setColForm({ name: c.name, color: c.color });
    setShowColModal(true);
  };

  const saveCol = async () => {
    if (!colForm.name.trim()) { toast.error('Nome obrigatorio'); return; }
    try {
      if (editingCol) {
        await crmAPI.updateKanbanColumn(editingCol.id, colForm);
        toast.success('Coluna atualizada');
      } else {
        await crmAPI.createKanbanColumn(colForm);
        toast.success('Coluna criada');
      }
      setShowColModal(false);
      reload();
    } catch (e) { toast.error(e.response?.data?.detail || 'Erro'); }
  };

  const deleteCol = async (c) => {
    if (!window.confirm(`Excluir a coluna "${c.name}"? Os tickets voltam para Atendimentos.`)) return;
    try {
      await crmAPI.deleteKanbanColumn(c.id);
      toast.success('Coluna removida');
      reload();
    } catch (e) { toast.error('Erro'); }
  };

  const handleDrop = async (columnId) => {
    if (!draggingTicket) return;
    try {
      await crmAPI.moveTicketColumn(draggingTicket, columnId);
      reload();
    } catch (e) { toast.error('Erro ao mover'); }
    setDraggingTicket(null);
  };

  // Reorder mode: column-on-column drag swaps order
  const handleColumnDrop = async (targetCol) => {
    if (!draggingColId || draggingColId === targetCol.id) return;
    if (targetCol.is_native) { toast.error('Coluna nativa nao pode trocar de posicao'); setDraggingColId(null); return; }
    const customCols = data.columns.filter(c => !c.is_native);
    const fromIdx = customCols.findIndex(c => c.id === draggingColId);
    const toIdx = customCols.findIndex(c => c.id === targetCol.id);
    if (fromIdx < 0 || toIdx < 0) return;
    const reordered = [...customCols];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    try {
      await crmAPI.reorderKanbanColumns(reordered.map(c => c.id));
      toast.success('Ordem atualizada');
      reload();
    } catch (e) { toast.error('Erro ao reordenar'); }
    setDraggingColId(null);
  };

  const onTitlePressStart = () => {
    titlePressTimer.current = setTimeout(() => {
      setReorderMode(m => !m);
      toast.info(reorderMode ? 'Modo reordenacao DESATIVADO' : 'Modo reordenacao ATIVADO. Arraste cabecalhos das colunas customizadas.');
    }, 3000);
  };
  const onTitlePressEnd = () => {
    if (titlePressTimer.current) { clearTimeout(titlePressTimer.current); titlePressTimer.current = null; }
  };

  return (
    <div className="animate-fade-in" data-testid="kanban-page">
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div
          onMouseDown={onTitlePressStart}
          onMouseUp={onTitlePressEnd}
          onMouseLeave={onTitlePressEnd}
          onTouchStart={onTitlePressStart}
          onTouchEnd={onTitlePressEnd}
          className="select-none cursor-default"
        >
          <h2 className="text-lg font-bold font-page-title flex items-center gap-2">
            Kanban de Atendimentos
            {reorderMode && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold flex items-center gap-1" data-testid="reorder-mode-badge">
                <ArrowLeftRight className="w-3 h-3" /> ORDENANDO
              </span>
            )}
          </h2>
          <p className="text-xs text-slate-500">
            {reorderMode
              ? 'Arraste o cabecalho de uma coluna sobre outra para trocar a ordem. Pressione Shift+R para sair.'
              : 'Arraste cards entre as colunas. A coluna "Atendimentos" e nativa.'}
          </p>
        </div>
        <button onClick={openNewCol} className="btn-primary text-sm flex items-center gap-1.5" data-testid="new-column-btn">
          <Plus className="w-4 h-4" /> Nova Coluna
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Carregando...</div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4 snap-x snap-mandatory" data-testid="kanban-columns">
          {data.columns.map(col => {
            const tickets = data.tickets_by_column[col.id] || [];
            return (
              <div
                key={col.id}
                onDragOver={e => e.preventDefault()}
                onDrop={() => reorderMode ? handleColumnDrop(col) : handleDrop(col.id)}
                className="flex-shrink-0 w-72 snap-start"
                data-testid={`kanban-col-${col.id}`}
              >
                <div
                  className={`rounded-t-xl px-3 py-2.5 text-white shadow-sm ${reorderMode && !col.is_native ? 'cursor-grab' : ''} ${draggingColId === col.id ? 'opacity-60' : ''}`}
                  style={{ background: col.color }}
                  draggable={reorderMode && !col.is_native}
                  onDragStart={() => reorderMode && !col.is_native && setDraggingColId(col.id)}
                  onDragEnd={() => setDraggingColId(null)}
                  data-testid={`kanban-col-header-${col.id}`}
                >
                  <div className="flex items-center gap-2">
                    {reorderMode && !col.is_native && (
                      <GripHorizontal className="w-3.5 h-3.5 text-white/80" />
                    )}
                    <span className="font-semibold text-sm flex-1 truncate">{col.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/20 font-bold">{tickets.length}</span>
                    {!col.is_native && (
                      <>
                        <button onClick={() => openEditCol(col)} className="p-1 rounded hover:bg-white/20" title="Editar"><Pencil className="w-3 h-3" /></button>
                        <button onClick={() => deleteCol(col)} className="p-1 rounded hover:bg-white/20" title="Excluir"><Trash2 className="w-3 h-3" /></button>
                      </>
                    )}
                  </div>
                  <div className="text-[11px] font-bold mt-1 text-white/95" data-testid={`kanban-col-total-${col.id}`}>
                    Total: R$ {((data.totals_by_column || {})[col.id] || 0).toFixed(2).replace('.', ',')}
                  </div>
                </div>
                <div className="bg-slate-50 rounded-b-xl p-2 min-h-[400px] space-y-2">
                  {tickets.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-8">Solte cards aqui</p>
                  ) : tickets.map(t => (
                    <div
                      key={t.id}
                      draggable
                      onDragStart={() => setDraggingTicket(t.id)}
                      onDragEnd={() => setDraggingTicket(null)}
                      className="bg-white rounded-lg p-2.5 shadow-sm border border-slate-200 cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow"
                      data-testid={`ticket-card-${t.id}`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary to-indigo-500 text-white flex items-center justify-center text-[11px] font-bold flex-shrink-0">
                          {(t.customer_name || '?').charAt(0).toUpperCase()}
                        </div>
                        <p className="text-[13px] font-semibold text-slate-900 truncate flex-1">{t.customer_name}</p>
                        {(t.value > 0) && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold flex-shrink-0">
                            R$ {Number(t.value).toFixed(2).replace('.', ',')}
                          </span>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            try { sessionStorage.setItem('open_ticket_id', t.id); } catch (_) {}
                            if (setActivePage) setActivePage('atendimentos');
                          }}
                          className="p-1 rounded hover:bg-primary/10 text-primary flex-shrink-0"
                          title="Abrir atendimento"
                          data-testid={`open-ticket-${t.id}`}
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {t.last_message && <p className="text-[11px] text-slate-500 truncate">{t.last_message}</p>}
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        {(t.tags || []).slice(0, 3).map((tagName, i) => (
                          <span key={i} className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">#{tagName}</span>
                        ))}
                        {t.channel && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium uppercase">{t.channel}</span>}
                      </div>
                      <div className="flex items-center gap-2 mt-1.5 text-[10px] text-slate-400">
                        <Phone className="w-2.5 h-2.5" />
                        <span className="truncate">{t.customer_phone || ''}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {data.columns.length === 1 && (
            <button onClick={openNewCol} className="flex-shrink-0 w-72 snap-start min-h-[440px] rounded-xl border-2 border-dashed border-slate-200 hover:border-primary hover:bg-primary/5 flex flex-col items-center justify-center gap-2 transition-colors text-slate-400 hover:text-primary">
              <Plus className="w-8 h-8" />
              <span className="text-sm font-semibold">Adicionar coluna</span>
            </button>
          )}
        </div>
      )}

      {showColModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowColModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h3 className="text-base font-bold">{editingCol ? 'Editar' : 'Nova'} Coluna</h3>
              <button onClick={() => setShowColModal(false)} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400">Nome</label>
                <input value={colForm.name} onChange={e => setColForm({...colForm, name: e.target.value})} placeholder="Ex: Em Negociacao" className="input-field text-sm" data-testid="col-name" />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400">Cor</label>
                <div className="grid grid-cols-8 gap-2 mt-1">
                  {COLORS.map(c => (
                    <button key={c} onClick={() => setColForm({...colForm, color: c})} className={`w-8 h-8 rounded-lg ${colForm.color === c ? 'ring-2 ring-offset-2 ring-slate-900' : ''}`} style={{ background: c }} />
                  ))}
                </div>
              </div>
              <div className="rounded-lg p-3 text-white" style={{ background: colForm.color }}>
                <span className="text-sm font-semibold">{colForm.name || 'Preview'}</span>
              </div>
            </div>
            <div className="flex justify-end gap-2 p-3 border-t border-slate-200">
              <button onClick={() => setShowColModal(false)} className="btn-secondary text-sm">Cancelar</button>
              <button onClick={saveCol} className="btn-primary text-sm" data-testid="save-col-btn">{editingCol ? 'Salvar' : 'Criar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default KanbanPage;
