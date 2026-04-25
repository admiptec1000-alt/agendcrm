import React, { useState, useEffect } from 'react';
import { crmAPI } from '../../services/api';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Tag as TagIcon, X } from 'lucide-react';

const COLOR_PALETTE = [
  '#EF4444', '#F97316', '#F59E0B', '#FBBF24', '#84CC16',
  '#22C55E', '#10B981', '#14B8A6', '#06B6D4', '#0EA5E9',
  '#3B82F6', '#6366F1', '#8B5CF6', '#A855F7', '#D946EF',
  '#EC4899', '#F43F5E', '#64748B'
];

const TagsPage = () => {
  const [tags, setTags] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', color: '#4F46E5', description: '' });

  const reload = () => crmAPI.listTags().then(r => setTags(r.data)).catch(() => {});
  useEffect(() => { reload(); }, []);

  const openNew = () => {
    setEditing(null);
    setForm({ name: '', color: '#4F46E5', description: '' });
    setShowModal(true);
  };

  const openEdit = (t) => {
    setEditing(t);
    setForm({ name: t.name, color: t.color, description: t.description || '' });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Informe o nome'); return; }
    try {
      if (editing) {
        await crmAPI.updateTag(editing.id, form);
        toast.success('Tag atualizada');
      } else {
        await crmAPI.createTag(form);
        toast.success('Tag criada');
      }
      setShowModal(false);
      reload();
    } catch (e) { toast.error('Erro ao salvar'); }
  };

  const handleDelete = async (t) => {
    if (!window.confirm(`Excluir a tag "${t.name}"?`)) return;
    try {
      await crmAPI.deleteTag(t.id);
      toast.success('Tag removida');
      reload();
    } catch (e) { toast.error('Erro ao remover'); }
  };

  return (
    <div className="animate-fade-in" data-testid="tags-page">
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <h2 className="text-lg font-bold font-page-title">Tags</h2>
        <button onClick={openNew} className="btn-primary text-sm flex items-center gap-1.5" data-testid="new-tag-btn">
          <Plus className="w-4 h-4" /> Nova Tag
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {tags.length === 0 ? (
          <div className="col-span-full text-center py-12">
            <TagIcon className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-500">Nenhuma tag cadastrada</p>
          </div>
        ) : tags.map(t => (
          <div key={t.id} className="card !p-3 flex items-center gap-3" data-testid={`tag-${t.id}`}>
            <div className="w-3 h-12 rounded-full flex-shrink-0" style={{ background: t.color }} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate">{t.name}</p>
              {t.description && <p className="text-xs text-slate-500 truncate">{t.description}</p>}
            </div>
            <div className="flex gap-1 flex-shrink-0">
              <button onClick={() => openEdit(t)} className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>
              <button onClick={() => handleDelete(t)} className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-2 sm:p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h3 className="text-base font-bold">{editing ? 'Editar' : 'Nova'} Tag</h3>
              <button onClick={() => setShowModal(false)} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400">Nome</label>
                <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Ex: VIP, Cliente Novo" className="input-field text-sm" data-testid="tag-name" />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400">Cor</label>
                <div className="grid grid-cols-9 gap-2 mt-1">
                  {COLOR_PALETTE.map(c => (
                    <button key={c} onClick={() => setForm({...form, color: c})} className={`w-7 h-7 rounded-lg transition-all ${form.color === c ? 'ring-2 ring-offset-2 ring-slate-900 scale-110' : 'hover:scale-105'}`} style={{ background: c }} data-testid={`color-${c}`} />
                  ))}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs text-slate-500">ou hex:</span>
                  <input value={form.color} onChange={e => setForm({...form, color: e.target.value})} className="input-field text-xs flex-1" />
                  <div className="w-7 h-7 rounded border border-slate-200" style={{ background: form.color }} />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400">Descricao (opcional)</label>
                <input value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="input-field text-sm" />
              </div>

              <div className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg">
                <span className="text-xs text-slate-500">Preview:</span>
                <span className="px-2 py-1 rounded-full text-xs font-medium text-white" style={{ background: form.color }}>{form.name || 'Tag'}</span>
              </div>
            </div>
            <div className="flex justify-end gap-2 p-3 border-t border-slate-200">
              <button onClick={() => setShowModal(false)} className="btn-secondary text-sm">Cancelar</button>
              <button onClick={handleSave} className="btn-primary text-sm" data-testid="save-tag-btn">{editing ? 'Salvar' : 'Criar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TagsPage;
