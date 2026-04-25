import React, { useState, useEffect } from 'react';
import { aiAPI } from '../../services/api';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, X, Bot, Cpu, Sparkles, Check } from 'lucide-react';

const PROVIDER_TYPES = [
  { v: 'emergent', label: 'Emergent (Universal Key)', desc: 'Sem precisar configurar API key. Cobranca pelo creditos da Emergent.' },
  { v: 'openai', label: 'OpenAI', desc: 'Sua propria API key da OpenAI (gpt-4o, gpt-5.2...)' },
  { v: 'anthropic', label: 'Anthropic Claude', desc: 'Sua API key Anthropic (Claude Sonnet/Opus/Haiku)' },
  { v: 'gemini', label: 'Google Gemini', desc: 'Sua API key Google AI Studio' },
];

const TONES = ['Profissional', 'Amigavel', 'Empatico e profissional', 'Persuasivo e consultivo', 'Animado e prestativo', 'Confiavel e didatico', 'Formal e profissional', 'Animado e criativo', 'Profissional e atencioso'];
const GENDERS = ['Feminino', 'Masculino', 'Neutro'];
const AGE_RANGES = ['16 a 25', '20 a 30', '26 a 35', '30 a 45', '40+'];

const AIPage = () => {
  const [tab, setTab] = useState('agents');

  return (
    <div className="animate-fade-in" data-testid="ai-page">
      <div className="flex items-center gap-2 mb-4">
        <div className="flex bg-slate-100 rounded-lg p-0.5">
          <button onClick={() => setTab('agents')} className={`px-3 py-1.5 rounded-md text-xs font-semibold ${tab === 'agents' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`} data-testid="tab-agents">Agentes IA</button>
          <button onClick={() => setTab('providers')} className={`px-3 py-1.5 rounded-md text-xs font-semibold ${tab === 'providers' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`} data-testid="tab-providers">Provedores</button>
        </div>
      </div>
      {tab === 'agents' ? <AgentsTab /> : <ProvidersTab />}
    </div>
  );
};

/* ========== PROVIDERS ========== */
const ProvidersTab = () => {
  const [items, setItems] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', type: 'emergent', api_key: '' });

  const reload = () => aiAPI.listProviders().then(r => setItems(r.data)).catch(() => {});
  useEffect(() => { reload(); }, []);

  const openNew = () => { setEditing(null); setForm({ name: '', type: 'emergent', api_key: '' }); setShowModal(true); };
  const openEdit = (p) => { setEditing(p); setForm({ name: p.name, type: p.type, api_key: '' }); setShowModal(true); };

  const save = async () => {
    if (!form.name.trim()) { toast.error('Nome obrigatorio'); return; }
    try {
      if (editing) {
        const payload = { name: form.name, type: form.type };
        if (form.api_key) payload.api_key = form.api_key;
        await aiAPI.updateProvider(editing.id, payload);
      } else {
        await aiAPI.createProvider(form);
      }
      toast.success('Provedor salvo');
      setShowModal(false);
      reload();
    } catch (e) { toast.error(e.response?.data?.detail || 'Erro'); }
  };

  const remove = async (p) => {
    if (p.id === 'default-emergent') return;
    if (!window.confirm(`Excluir provedor "${p.name}"?`)) return;
    try { await aiAPI.deleteProvider(p.id); toast.success('Removido'); reload(); }
    catch (e) { toast.error('Erro'); }
  };

  return (
    <div data-testid="providers-tab">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-slate-600">Configure os provedores de IA usados pelos seus agentes.</p>
        <button onClick={openNew} className="btn-primary text-sm flex items-center gap-1.5" data-testid="new-provider-btn">
          <Plus className="w-4 h-4" /> Adicionar Provedor IA
        </button>
      </div>

      <div className="space-y-2">
        {items.map(p => (
          <div key={p.id} className="card !p-4 flex items-center gap-3" data-testid={`provider-${p.id}`}>
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary/10 to-indigo-100 flex items-center justify-center flex-shrink-0">
              <Cpu className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-slate-900 truncate">{p.name}</p>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold uppercase">{p.type}</span>
                {p.is_default && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold">PADRAO</span>}
              </div>
              <p className="text-[11px] text-slate-500">{(p.models || []).slice(0, 3).join(', ')}{p.models?.length > 3 && ` +${p.models.length-3}`}</p>
            </div>
            {p.id !== 'default-emergent' && (
              <div className="flex gap-1 flex-shrink-0">
                <button onClick={() => openEdit(p)} className="p-2 rounded hover:bg-slate-100 text-slate-400 hover:text-primary"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => remove(p)} className="p-2 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
              </div>
            )}
          </div>
        ))}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-2 sm:p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h3 className="text-base font-bold">{editing ? 'Editar' : 'Novo'} Provedor</h3>
              <button onClick={() => setShowModal(false)} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400">Nome</label>
                <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Ex: OpenAI Producao" className="input-field text-sm" data-testid="prov-name" />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400">Tipo</label>
                <div className="space-y-1.5 mt-1">
                  {PROVIDER_TYPES.map(p => (
                    <label key={p.v} className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${form.type === p.v ? 'border-primary bg-primary/5' : 'border-slate-200'}`} data-testid={`prov-type-${p.v}`}>
                      <input type="radio" checked={form.type === p.v} onChange={() => setForm({...form, type: p.v})} className="mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{p.label}</p>
                        <p className="text-[11px] text-slate-500">{p.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              {form.type !== 'emergent' && (
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-400">API Key</label>
                  <input type="password" value={form.api_key} onChange={e => setForm({...form, api_key: e.target.value})} placeholder={editing ? 'Deixe em branco para manter a atual' : 'sk-...'} className="input-field text-sm font-mono" data-testid="prov-key" />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 p-3 border-t border-slate-200">
              <button onClick={() => setShowModal(false)} className="btn-secondary text-sm">Cancelar</button>
              <button onClick={save} className="btn-primary text-sm" data-testid="save-prov-btn">{editing ? 'Salvar' : 'Adicionar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ========== AGENTS ========== */
const AgentsTab = () => {
  const [items, setItems] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [providers, setProviders] = useState([]);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [editingAgent, setEditingAgent] = useState(null);

  const reload = () => aiAPI.listAgents().then(r => setItems(r.data)).catch(() => {});

  useEffect(() => {
    reload();
    aiAPI.listAgentTemplates().then(r => setTemplates(r.data)).catch(() => {});
    aiAPI.listProviders().then(r => setProviders(r.data)).catch(() => {});
  }, []);

  const pickTemplate = (tpl) => {
    setShowTemplatePicker(false);
    const newAgent = {
      _isNew: true,
      template_key: tpl.key,
      name: tpl.name,
      icon: tpl.icon,
      color: tpl.color,
      category: tpl.category,
      personality: tpl.personality,
      products: [],
      faq: [],
      objections: [],
      extras: { initial_greeting: tpl.personality.greeting || '', anti_loop: false, transfer_to_human: false },
      site: '',
      instagram: '',
      provider_id: providers[0]?.id || '',
      model: providers[0]?.models?.[0] || 'gpt-4o-mini',
      delay_seconds: 0,
      queue_ids: [],
      is_active: true,
    };
    setEditingAgent(newAgent);
  };

  const remove = async (a) => {
    if (!window.confirm(`Excluir agente "${a.name}"?`)) return;
    try { await aiAPI.deleteAgent(a.id); toast.success('Removido'); reload(); }
    catch (e) { toast.error('Erro'); }
  };

  return (
    <div data-testid="agents-tab">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-slate-600">Agentes virtuais para atendimento automatizado.</p>
        <button onClick={() => setShowTemplatePicker(true)} className="btn-primary text-sm flex items-center gap-1.5" data-testid="new-agent-btn">
          <Plus className="w-4 h-4" /> Adicionar Agente
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {items.length === 0 ? (
          <div className="col-span-full text-center py-12">
            <Bot className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-500">Nenhum agente cadastrado</p>
            <button onClick={() => setShowTemplatePicker(true)} className="mt-3 text-xs font-semibold text-primary hover:underline">+ Criar primeiro agente</button>
          </div>
        ) : items.map(a => (
          <div key={a.id} className="card !p-3 flex items-center gap-3" data-testid={`agent-${a.id}`}>
            <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0" style={{ background: `${a.color}20` }}>
              {a.icon || '🤖'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-900 truncate">{a.name}</p>
              <p className="text-[11px] text-slate-500 truncate">{a.personality?.bio || a.category}</p>
              <div className="flex gap-1 mt-1">
                <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${a.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{a.is_active ? 'ATIVO' : 'INATIVO'}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold">{a.model || 'gpt-4o-mini'}</span>
              </div>
            </div>
            <div className="flex gap-1 flex-shrink-0">
              <button onClick={() => setEditingAgent(a)} className="p-2 rounded hover:bg-slate-100 text-slate-400 hover:text-primary" data-testid={`edit-agent-${a.id}`}><Pencil className="w-4 h-4" /></button>
              <button onClick={() => remove(a)} className="p-2 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
            </div>
          </div>
        ))}
      </div>

      {showTemplatePicker && (
        <TemplatePickerModal templates={templates} onPick={pickTemplate} onClose={() => setShowTemplatePicker(false)} />
      )}

      {editingAgent && (
        <AgentEditor
          agent={editingAgent}
          providers={providers}
          onClose={() => setEditingAgent(null)}
          onSaved={() => { setEditingAgent(null); reload(); }}
        />
      )}
    </div>
  );
};

const TemplatePickerModal = ({ templates, onPick, onClose }) => (
  <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-2 sm:p-4" onClick={onClose}>
    <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between p-4 border-b border-slate-200">
        <div>
          <h3 className="text-base font-bold">Selecione o Tipo do Agente</h3>
          <p className="text-xs text-slate-500">Escolha um modelo pronto ou crie do zero</p>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
      </div>
      <div className="overflow-y-auto p-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {templates.map(t => (
          <button key={t.key} onClick={() => onPick(t)} className="text-left rounded-xl border-2 border-slate-200 hover:border-primary hover:bg-primary/5 p-3 transition-all flex items-center gap-3 group" data-testid={`tpl-${t.key}`}>
            <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0" style={{ background: `${t.color}20` }}>
              {t.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-900">{t.name}</p>
              <p className="text-[11px] text-slate-500 line-clamp-2">{t.personality?.bio}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  </div>
);

const AgentEditor = ({ agent: initial, providers, onClose, onSaved }) => {
  const [tab, setTab] = useState('personality');
  const [agent, setAgent] = useState(initial);
  const [saving, setSaving] = useState(false);

  const setP = (k, v) => setAgent(a => ({ ...a, personality: { ...(a.personality || {}), [k]: v } }));
  const setE = (k, v) => setAgent(a => ({ ...a, extras: { ...(a.extras || {}), [k]: v } }));

  const save = async () => {
    if (!agent.name?.trim()) { toast.error('Nome obrigatorio'); return; }
    setSaving(true);
    try {
      const payload = {
        name: agent.name, icon: agent.icon, color: agent.color, category: agent.category,
        template_key: agent.template_key,
        personality: agent.personality || {},
        products: agent.products || [],
        faq: agent.faq || [],
        objections: agent.objections || [],
        extras: agent.extras || {},
        site: agent.site || '', instagram: agent.instagram || '',
        provider_id: agent.provider_id || '', model: agent.model || '',
        delay_seconds: agent.delay_seconds || 0,
        queue_ids: agent.queue_ids || [],
        is_active: agent.is_active !== false,
      };
      if (agent._isNew || !agent.id) {
        await aiAPI.createAgent(payload);
        toast.success('Agente criado');
      } else {
        await aiAPI.updateAgent(agent.id, payload);
        toast.success('Agente salvo');
      }
      onSaved();
    } catch (e) { toast.error(e.response?.data?.detail || 'Erro'); }
    finally { setSaving(false); }
  };

  const addProduct = () => setAgent(a => ({ ...a, products: [...(a.products || []), { name: '', description: '', price: '' }] }));
  const updProduct = (i, k, v) => setAgent(a => { const x = [...(a.products || [])]; x[i] = { ...x[i], [k]: v }; return { ...a, products: x }; });
  const delProduct = (i) => setAgent(a => ({ ...a, products: (a.products || []).filter((_, idx) => idx !== i) }));

  const addFaq = () => setAgent(a => ({ ...a, faq: [...(a.faq || []), { q: '', a: '' }] }));
  const updFaq = (i, k, v) => setAgent(a => { const x = [...(a.faq || [])]; x[i] = { ...x[i], [k]: v }; return { ...a, faq: x }; });
  const delFaq = (i) => setAgent(a => ({ ...a, faq: (a.faq || []).filter((_, idx) => idx !== i) }));

  const addObj = () => setAgent(a => ({ ...a, objections: [...(a.objections || []), { q: '', a: '' }] }));
  const updObj = (i, k, v) => setAgent(a => { const x = [...(a.objections || [])]; x[i] = { ...x[i], [k]: v }; return { ...a, objections: x }; });
  const delObj = (i) => setAgent(a => ({ ...a, objections: (a.objections || []).filter((_, idx) => idx !== i) }));

  const provider = providers.find(p => p.id === agent.provider_id);
  const availModels = provider?.models || ['gpt-4o-mini', 'gpt-4o'];

  return (
    <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-end sm:items-center justify-center p-2 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-2xl w-full max-w-3xl max-h-[95vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 p-4 border-b border-slate-200">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0" style={{ background: `${agent.color}20` }}>{agent.icon || '🤖'}</div>
          <div className="flex-1 min-w-0">
            <input value={agent.name || ''} onChange={e => setAgent(a => ({ ...a, name: e.target.value }))} className="text-base font-bold w-full focus:outline-none border-b border-transparent focus:border-primary" data-testid="agent-name" />
            <p className="text-[11px] text-slate-500">{agent.category || 'Personalizado'}</p>
          </div>
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={agent.is_active !== false} onChange={e => setAgent(a => ({...a, is_active: e.target.checked}))} className="w-4 h-4" />
            Ativo
          </label>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex bg-slate-100 mx-4 mt-3 rounded-lg p-0.5 overflow-x-auto flex-shrink-0">
          {[
            ['personality', 'Personalidade'],
            ['products', 'Produtos/Servicos'],
            ['faq', 'FAQ'],
            ['objections', 'Objecoes'],
            ['extras', 'Complementos'],
          ].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`flex-shrink-0 px-3 py-1.5 rounded-md text-[11px] font-semibold whitespace-nowrap ${tab === k ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`} data-testid={`agent-tab-${k}`}>{l}</button>
          ))}
        </div>

        <div className="overflow-y-auto p-4 flex-1 space-y-3">
          {tab === 'personality' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-[10px] font-bold uppercase text-slate-400">Genero</label>
                  <select value={agent.personality?.gender || ''} onChange={e => setP('gender', e.target.value)} className="input-field text-sm">
                    {GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
                  </select></div>
                <div><label className="text-[10px] font-bold uppercase text-slate-400">Faixa Etaria</label>
                  <select value={agent.personality?.age_range || ''} onChange={e => setP('age_range', e.target.value)} className="input-field text-sm">
                    {AGE_RANGES.map(g => <option key={g} value={g}>{g}</option>)}
                  </select></div>
              </div>
              <div><label className="text-[10px] font-bold uppercase text-slate-400">Biografia</label>
                <textarea value={agent.personality?.bio || ''} onChange={e => setP('bio', e.target.value)} rows={2} className="input-field text-sm" placeholder="Descreva o agente em uma frase" /></div>
              <div><label className="text-[10px] font-bold uppercase text-slate-400">Saudacao</label>
                <textarea value={agent.personality?.greeting || ''} onChange={e => setP('greeting', e.target.value)} rows={2} className="input-field text-sm" /></div>
              <div><label className="text-[10px] font-bold uppercase text-slate-400">Sobre a Empresa</label>
                <textarea value={agent.personality?.company_about || ''} onChange={e => setP('company_about', e.target.value)} rows={2} className="input-field text-sm" /></div>
              <div><label className="text-[10px] font-bold uppercase text-slate-400">Objetivo Principal</label>
                <textarea value={agent.personality?.main_goal || ''} onChange={e => setP('main_goal', e.target.value)} rows={2} className="input-field text-sm" /></div>
              <div><label className="text-[10px] font-bold uppercase text-slate-400">Especialidade / Conhecimentos</label>
                <textarea value={agent.personality?.expertise || ''} onChange={e => setP('expertise', e.target.value)} rows={2} className="input-field text-sm" /></div>
              <div><label className="text-[10px] font-bold uppercase text-slate-400">Tom</label>
                <select value={agent.personality?.tone || ''} onChange={e => setP('tone', e.target.value)} className="input-field text-sm">
                  {TONES.map(t => <option key={t} value={t}>{t}</option>)}
                </select></div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-[10px] font-bold uppercase text-slate-400">Site</label>
                  <input value={agent.site || ''} onChange={e => setAgent(a => ({...a, site: e.target.value}))} className="input-field text-sm" /></div>
                <div><label className="text-[10px] font-bold uppercase text-slate-400">Instagram</label>
                  <input value={agent.instagram || ''} onChange={e => setAgent(a => ({...a, instagram: e.target.value}))} className="input-field text-sm" /></div>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200">
                <div><label className="text-[10px] font-bold uppercase text-slate-400">Provedor</label>
                  <select value={agent.provider_id || ''} onChange={e => setAgent(a => ({...a, provider_id: e.target.value}))} className="input-field text-sm" data-testid="agent-provider">
                    <option value="">Selecione</option>
                    {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select></div>
                <div><label className="text-[10px] font-bold uppercase text-slate-400">Modelo</label>
                  <select value={agent.model || ''} onChange={e => setAgent(a => ({...a, model: e.target.value}))} className="input-field text-sm" data-testid="agent-model">
                    {availModels.map(m => <option key={m} value={m}>{m}</option>)}
                  </select></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-[10px] font-bold uppercase text-slate-400">Delay (segundos)</label>
                  <input type="number" min="0" value={agent.delay_seconds || 0} onChange={e => setAgent(a => ({...a, delay_seconds: parseInt(e.target.value) || 0}))} className="input-field text-sm" /></div>
              </div>
            </>
          )}
          {tab === 'products' && (
            <div className="space-y-2">
              {(agent.products || []).map((p, i) => (
                <div key={i} className="rounded-lg border border-slate-200 p-2 space-y-1.5">
                  <input value={p.name} onChange={e => updProduct(i, 'name', e.target.value)} placeholder="Nome do produto" className="input-field text-sm" />
                  <textarea value={p.description} onChange={e => updProduct(i, 'description', e.target.value)} placeholder="Descricao" rows={2} className="input-field text-sm" />
                  <div className="flex items-center gap-2">
                    <input value={p.price} onChange={e => updProduct(i, 'price', e.target.value)} placeholder="Preco" className="input-field text-sm flex-1" />
                    <button onClick={() => delProduct(i)} className="p-1.5 rounded text-red-500 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              ))}
              <button onClick={addProduct} className="btn-secondary text-xs w-full"><Plus className="w-3 h-3 inline mr-1" /> Adicionar produto/servico</button>
            </div>
          )}
          {tab === 'faq' && (
            <div className="space-y-2">
              {(agent.faq || []).map((f, i) => (
                <div key={i} className="rounded-lg border border-slate-200 p-2 space-y-1.5">
                  <input value={f.q} onChange={e => updFaq(i, 'q', e.target.value)} placeholder="Pergunta frequente" className="input-field text-sm" />
                  <div className="flex items-start gap-2">
                    <textarea value={f.a} onChange={e => updFaq(i, 'a', e.target.value)} placeholder="Resposta" rows={2} className="input-field text-sm flex-1" />
                    <button onClick={() => delFaq(i)} className="p-1.5 rounded text-red-500 hover:bg-red-50 mt-1"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              ))}
              <button onClick={addFaq} className="btn-secondary text-xs w-full"><Plus className="w-3 h-3 inline mr-1" /> Adicionar FAQ</button>
            </div>
          )}
          {tab === 'objections' && (
            <div className="space-y-2">
              {(agent.objections || []).map((o, i) => (
                <div key={i} className="rounded-lg border border-slate-200 p-2 space-y-1.5">
                  <input value={o.q} onChange={e => updObj(i, 'q', e.target.value)} placeholder="Objecao do cliente (ex: Esta caro)" className="input-field text-sm" />
                  <div className="flex items-start gap-2">
                    <textarea value={o.a} onChange={e => updObj(i, 'a', e.target.value)} placeholder="Como contornar" rows={2} className="input-field text-sm flex-1" />
                    <button onClick={() => delObj(i)} className="p-1.5 rounded text-red-500 hover:bg-red-50 mt-1"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              ))}
              <button onClick={addObj} className="btn-secondary text-xs w-full"><Plus className="w-3 h-3 inline mr-1" /> Adicionar objecao</button>
            </div>
          )}
          {tab === 'extras' && (
            <div className="space-y-3">
              <div><label className="text-[10px] font-bold uppercase text-slate-400">Mensagem de Boas-vindas</label>
                <textarea value={agent.extras?.initial_greeting || ''} onChange={e => setE('initial_greeting', e.target.value)} rows={2} className="input-field text-sm" /></div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={agent.extras?.anti_loop || false} onChange={e => setE('anti_loop', e.target.checked)} className="w-4 h-4" />
                Anti-loop (evitar repetir respostas)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={agent.extras?.transfer_to_human || false} onChange={e => setE('transfer_to_human', e.target.checked)} className="w-4 h-4" />
                Transferir para humano quando solicitado
              </label>
              <div><label className="text-[10px] font-bold uppercase text-slate-400">Instrucoes Extras</label>
                <textarea value={agent.extras?.custom_prompt || ''} onChange={e => setE('custom_prompt', e.target.value)} rows={4} className="input-field text-sm" placeholder="Ex: Sempre responder em ate 2 paragrafos..." /></div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-3 border-t border-slate-200 flex-shrink-0">
          <button onClick={onClose} className="btn-secondary text-sm">Cancelar</button>
          <button onClick={save} disabled={saving} className="btn-primary text-sm flex items-center gap-1.5" data-testid="save-agent-btn">
            {saving ? 'Salvando...' : (<><Check className="w-4 h-4" /> Salvar Agente</>)}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIPage;
