import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { quotesAPI, schedulingAPI } from '../../services/api';
import { Plus, Trash2, Edit2, FileText, Truck, Package, Layers, Printer, X, Search, Eye, Copy } from 'lucide-react';

const TABS = [
  { key: 'list', label: 'Orcamentos', icon: FileText },
  { key: 'services', label: 'Produtos', icon: Package },
  { key: 'freights', label: 'Fretes', icon: Truck },
  { key: 'templates', label: 'Templates', icon: Layers },
];

const formatBRL = (v) => {
  const n = parseFloat(v) || 0;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const OrcamentosPage = () => {
  const [tab, setTab] = useState('list');
  return (
    <div className="p-4 md:p-6" data-testid="orcamentos-page">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-900">Orcamentos</h1>
        <p className="text-sm text-slate-500">Gere propostas comerciais combinando produtos, fretes e templates personalizados.</p>
      </div>

      <div className="flex gap-1 border-b border-slate-200 mb-4 overflow-x-auto">
        {TABS.map(t => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              data-testid={`tab-${t.key}`}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition whitespace-nowrap ${
                active ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon className="w-4 h-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'list' && <QuotesTab />}
      {tab === 'services' && <ServicesTab />}
      {tab === 'freights' && <FreightsTab />}
      {tab === 'templates' && <TemplatesTab />}
    </div>
  );
};

// ─── PRODUTOS / SERVICOS ─────────────────────────────────────────────────────
const ServicesTab = () => {
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await quotesAPI.listServices();
      setItems(data || []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleSave = async (form) => {
    try {
      if (editing?.id) await quotesAPI.updateService(editing.id, form);
      else await quotesAPI.createService(form);
      setEditing(null);
      await load();
    } catch (e) { alert('Erro: ' + (e?.response?.data?.detail || e.message)); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Excluir este produto/servico?')) return;
    await quotesAPI.deleteService(id);
    await load();
  };

  return (
    <div data-testid="services-tab">
      <div className="flex justify-between items-center mb-3">
        <p className="text-sm text-slate-600">Cadastre produtos/servicos isolados (peso/unidade/litro etc) com preco padrao.</p>
        <button
          data-testid="new-service-btn"
          onClick={() => setEditing({ description: '', unit: 'un', default_price: 0, notes: '' })}
          className="flex items-center gap-1 bg-emerald-600 text-white px-3 py-2 rounded-md text-sm hover:bg-emerald-700"
        >
          <Plus className="w-4 h-4" /> Novo
        </button>
      </div>

      {loading ? <div className="text-center text-slate-400 py-8">Carregando...</div> : (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-4 py-2">Descricao</th>
                <th className="px-4 py-2">Unidade</th>
                <th className="px-4 py-2 text-right">Preco padrao</th>
                <th className="px-4 py-2 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={4} className="text-center text-slate-400 py-6">Nenhum produto cadastrado.</td></tr>
              ) : items.map(s => (
                <tr key={s.id} className="border-t border-slate-100" data-testid={`service-row-${s.id}`}>
                  <td className="px-4 py-2 font-medium text-slate-800">{s.description}</td>
                  <td className="px-4 py-2 text-slate-600">{s.unit}</td>
                  <td className="px-4 py-2 text-right text-slate-800">{formatBRL(s.default_price)}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => setEditing(s)} className="p-1 text-slate-500 hover:text-emerald-600" data-testid={`edit-service-${s.id}`}><Edit2 className="w-4 h-4" /></button>
                    <button onClick={() => handleDelete(s.id)} className="p-1 text-slate-500 hover:text-red-600" data-testid={`delete-service-${s.id}`}><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && <ServiceModal initial={editing} onClose={() => setEditing(null)} onSave={handleSave} />}
    </div>
  );
};

const ServiceModal = ({ initial, onClose, onSave }) => {
  const [form, setForm] = useState({
    description: initial?.description || '',
    unit: initial?.unit || 'un',
    default_price: initial?.default_price || 0,
    notes: initial?.notes || '',
  });
  return (
    <ModalShell title={initial?.id ? 'Editar Produto' : 'Novo Produto'} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Descricao *">
          <input data-testid="service-description" autoFocus className="w-full border rounded px-3 py-2 text-sm" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Unidade">
            <select data-testid="service-unit" className="w-full border rounded px-3 py-2 text-sm" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
              <option value="un">un (unidade)</option>
              <option value="kg">kg</option>
              <option value="ton">ton</option>
              <option value="l">litro</option>
              <option value="m3">m&sup3;</option>
              <option value="m">metro</option>
              <option value="h">hora</option>
            </select>
          </Field>
          <Field label="Preco padrao (R$)">
            <input data-testid="service-price" type="number" step="0.01" className="w-full border rounded px-3 py-2 text-sm" value={form.default_price} onChange={(e) => setForm({ ...form, default_price: parseFloat(e.target.value) || 0 })} />
          </Field>
        </div>
        <Field label="Observacao">
          <textarea data-testid="service-notes" className="w-full border rounded px-3 py-2 text-sm" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
      </div>
      <div className="flex justify-end gap-2 pt-4 border-t mt-4">
        <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600">Cancelar</button>
        <button data-testid="save-service-btn" onClick={() => onSave(form)} disabled={!form.description.trim()} className="bg-emerald-600 text-white px-4 py-2 rounded text-sm disabled:opacity-50">Salvar</button>
      </div>
    </ModalShell>
  );
};

// ─── FRETES ──────────────────────────────────────────────────────────────────
const FreightsTab = () => {
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    const { data } = await quotesAPI.listFreights();
    setItems(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleSave = async (form) => {
    try {
      if (editing?.id) await quotesAPI.updateFreight(editing.id, form);
      else await quotesAPI.createFreight(form);
      setEditing(null);
      await load();
    } catch (e) { alert('Erro: ' + (e?.response?.data?.detail || e.message)); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Excluir este frete?')) return;
    await quotesAPI.deleteFreight(id);
    await load();
  };

  return (
    <div data-testid="freights-tab">
      <div className="flex justify-between items-center mb-3">
        <p className="text-sm text-slate-600">Cadastre rotas/fretes padrao com Km e valor por Km.</p>
        <button
          data-testid="new-freight-btn"
          onClick={() => setEditing({ description: '', default_km: 0, default_price_per_km: 0 })}
          className="flex items-center gap-1 bg-emerald-600 text-white px-3 py-2 rounded-md text-sm hover:bg-emerald-700"
        >
          <Plus className="w-4 h-4" /> Novo Frete
        </button>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="px-4 py-2">Descricao</th>
              <th className="px-4 py-2 text-right">Km padrao</th>
              <th className="px-4 py-2 text-right">R$/Km</th>
              <th className="px-4 py-2 text-right">Total estimado</th>
              <th className="px-4 py-2 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={5} className="text-center text-slate-400 py-6">Nenhum frete cadastrado.</td></tr>
            ) : items.map(f => (
              <tr key={f.id} className="border-t border-slate-100" data-testid={`freight-row-${f.id}`}>
                <td className="px-4 py-2 font-medium text-slate-800">{f.description}</td>
                <td className="px-4 py-2 text-right">{f.default_km}</td>
                <td className="px-4 py-2 text-right">{formatBRL(f.default_price_per_km)}</td>
                <td className="px-4 py-2 text-right text-emerald-700 font-medium">{formatBRL((f.default_km || 0) * (f.default_price_per_km || 0))}</td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => setEditing(f)} className="p-1 text-slate-500 hover:text-emerald-600" data-testid={`edit-freight-${f.id}`}><Edit2 className="w-4 h-4" /></button>
                  <button onClick={() => handleDelete(f.id)} className="p-1 text-slate-500 hover:text-red-600" data-testid={`delete-freight-${f.id}`}><Trash2 className="w-4 h-4" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <ModalShell title={editing.id ? 'Editar Frete' : 'Novo Frete'} onClose={() => setEditing(null)}>
          <div className="space-y-3">
            <Field label="Descricao *">
              <input data-testid="freight-description" autoFocus className="w-full border rounded px-3 py-2 text-sm" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Km padrao">
                <input data-testid="freight-km" type="number" step="0.01" className="w-full border rounded px-3 py-2 text-sm" value={editing.default_km} onChange={(e) => setEditing({ ...editing, default_km: parseFloat(e.target.value) || 0 })} />
              </Field>
              <Field label="Valor por Km (R$)">
                <input data-testid="freight-price-per-km" type="number" step="0.01" className="w-full border rounded px-3 py-2 text-sm" value={editing.default_price_per_km} onChange={(e) => setEditing({ ...editing, default_price_per_km: parseFloat(e.target.value) || 0 })} />
              </Field>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t mt-4">
            <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-slate-600">Cancelar</button>
            <button data-testid="save-freight-btn" onClick={() => handleSave(editing)} disabled={!editing.description?.trim()} className="bg-emerald-600 text-white px-4 py-2 rounded text-sm disabled:opacity-50">Salvar</button>
          </div>
        </ModalShell>
      )}
    </div>
  );
};

// ─── TEMPLATES ───────────────────────────────────────────────────────────────
const PLACEHOLDERS = [
  '{{quote_number}}', '{{data_emissao}}', '{{validity_days}}',
  '{{razao_social}}', '{{cnpj_cpf}}', '{{nome}}', '{{telefone}}', '{{email}}',
  '{{endereco}}', '{{cidade}}', '{{estado}}', '{{cep}}',
  '{{items_total}}', '{{freights_total}}', '{{total_value}}',
  '{{minimum_billing_kg}}', '{{payment_terms}}', '{{payment_method}}',
  '{{seller_name}}', '{{seller_contact}}', '{{notes}}',
  '{{#items}}...{{description}} {{quantity}} {{unit_price}} {{total}}...{{/items}}',
  '{{#freights}}...{{description}} {{km_total}} {{price_per_km}} {{total}}...{{/freights}}',
];

const TemplatesTab = () => {
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    const { data } = await quotesAPI.listTemplates();
    setItems(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleSave = async (form) => {
    try {
      if (editing?.id) await quotesAPI.updateTemplate(editing.id, form);
      else await quotesAPI.createTemplate(form);
      setEditing(null);
      await load();
    } catch (e) { alert('Erro: ' + (e?.response?.data?.detail || e.message)); }
  };

  const handleDuplicate = async (t) => {
    await quotesAPI.createTemplate({ name: `${t.name} (copia)`, content: t.content, is_default: false });
    await load();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Excluir este template?')) return;
    await quotesAPI.deleteTemplate(id);
    await load();
  };

  return (
    <div data-testid="templates-tab">
      <div className="flex justify-between items-center mb-3">
        <p className="text-sm text-slate-600">Templates HTML com placeholders. Marque um como padrao para ser usado automaticamente.</p>
        <button
          data-testid="new-template-btn"
          onClick={() => setEditing({ name: '', content: '', is_default: false })}
          className="flex items-center gap-1 bg-emerald-600 text-white px-3 py-2 rounded-md text-sm hover:bg-emerald-700"
        >
          <Plus className="w-4 h-4" /> Novo Template
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {items.map(t => (
          <div key={t.id} className="bg-white border border-slate-200 rounded-lg p-3" data-testid={`template-card-${t.id}`}>
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-semibold text-slate-800">{t.name}</h3>
                {t.is_default && <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">Padrao</span>}
              </div>
              <div className="flex gap-1">
                <button onClick={() => handleDuplicate(t)} className="p-1 text-slate-500 hover:text-blue-600" title="Duplicar"><Copy className="w-4 h-4" /></button>
                <button onClick={() => setEditing(t)} className="p-1 text-slate-500 hover:text-emerald-600" data-testid={`edit-template-${t.id}`}><Edit2 className="w-4 h-4" /></button>
                <button onClick={() => handleDelete(t.id)} className="p-1 text-slate-500 hover:text-red-600" data-testid={`delete-template-${t.id}`}><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="text-xs text-slate-500 mt-2 line-clamp-2">{(t.content || '').replace(/<[^>]*>/g, '').substring(0, 120)}...</div>
          </div>
        ))}
      </div>

      {editing && (
        <ModalShell title={editing.id ? 'Editar Template' : 'Novo Template'} onClose={() => setEditing(null)} large>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Field label="Nome *">
                  <input data-testid="template-name" autoFocus className="w-full border rounded px-3 py-2 text-sm" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                </Field>
              </div>
              <Field label="Padrao da empresa">
                <label className="flex items-center gap-2 mt-2">
                  <input data-testid="template-default" type="checkbox" checked={!!editing.is_default} onChange={(e) => setEditing({ ...editing, is_default: e.target.checked })} />
                  <span className="text-sm">Usar como padrao</span>
                </label>
              </Field>
            </div>
            <Field label="Conteudo HTML *">
              <textarea data-testid="template-content" rows={16} className="w-full border rounded px-3 py-2 text-xs font-mono" value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} />
            </Field>
            <div className="bg-slate-50 rounded p-3">
              <p className="text-xs font-semibold text-slate-700 mb-1">Placeholders disponiveis (clique para copiar):</p>
              <div className="flex flex-wrap gap-1">
                {PLACEHOLDERS.map(p => (
                  <button key={p} onClick={() => navigator.clipboard.writeText(p)} className="text-xs bg-white border border-slate-300 px-2 py-0.5 rounded hover:bg-emerald-50 font-mono">{p}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t mt-4">
            <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-slate-600">Cancelar</button>
            <button data-testid="save-template-btn" onClick={() => handleSave(editing)} disabled={!editing.name?.trim() || !editing.content?.trim()} className="bg-emerald-600 text-white px-4 py-2 rounded text-sm disabled:opacity-50">Salvar</button>
          </div>
        </ModalShell>
      )}
    </div>
  );
};

// ─── ORCAMENTOS (LIST + EDITOR) ──────────────────────────────────────────────
const QuotesTab = () => {
  const [quotes, setQuotes] = useState([]);
  const [editing, setEditing] = useState(null);
  const [previewing, setPreviewing] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await quotesAPI.list();
      setQuotes(data || []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id) => {
    if (!window.confirm('Excluir este orcamento?')) return;
    await quotesAPI.delete(id);
    await load();
  };

  const handlePreview = async (id) => {
    try {
      const { data } = await quotesAPI.render(id);
      setPreviewing({ id, html: data.html, quote: data.quote });
    } catch (e) {
      alert('Erro ao renderizar: ' + (e?.response?.data?.detail || e.message));
    }
  };

  return (
    <div data-testid="quotes-list-tab">
      <div className="flex justify-between items-center mb-3">
        <p className="text-sm text-slate-600">Orcamentos gerados. Clique em "Visualizar" para imprimir/salvar PDF.</p>
        <button
          data-testid="new-quote-btn"
          onClick={() => setEditing({})}
          className="flex items-center gap-1 bg-emerald-600 text-white px-3 py-2 rounded-md text-sm hover:bg-emerald-700"
        >
          <Plus className="w-4 h-4" /> Novo Orcamento
        </button>
      </div>

      {loading ? <div className="text-center py-8 text-slate-400">Carregando...</div> : (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-4 py-2">N&ordm;</th>
                <th className="px-4 py-2">Cliente</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">Total</th>
                <th className="px-4 py-2">Criado em</th>
                <th className="px-4 py-2 w-32"></th>
              </tr>
            </thead>
            <tbody>
              {quotes.length === 0 ? (
                <tr><td colSpan={6} className="text-center text-slate-400 py-6">Nenhum orcamento ainda.</td></tr>
              ) : quotes.map(q => (
                <tr key={q.id} className="border-t border-slate-100" data-testid={`quote-row-${q.id}`}>
                  <td className="px-4 py-2 font-mono text-slate-700">#{q.quote_number}</td>
                  <td className="px-4 py-2">{q.client_name || '—'}</td>
                  <td className="px-4 py-2"><span className="text-xs bg-slate-100 px-2 py-0.5 rounded">{q.status}</span></td>
                  <td className="px-4 py-2 text-right font-medium text-emerald-700">{formatBRL(q.total_value)}</td>
                  <td className="px-4 py-2 text-slate-500 text-xs">{q.created_at ? new Date(q.created_at).toLocaleDateString('pt-BR') : ''}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => handlePreview(q.id)} className="p-1 text-slate-500 hover:text-blue-600" title="Visualizar/Imprimir" data-testid={`preview-quote-${q.id}`}><Eye className="w-4 h-4" /></button>
                    <button onClick={() => setEditing(q)} className="p-1 text-slate-500 hover:text-emerald-600" data-testid={`edit-quote-${q.id}`}><Edit2 className="w-4 h-4" /></button>
                    <button onClick={() => handleDelete(q.id)} className="p-1 text-slate-500 hover:text-red-600" data-testid={`delete-quote-${q.id}`}><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && <QuoteEditor initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {previewing && <PreviewModal {...previewing} onClose={() => setPreviewing(null)} />}
    </div>
  );
};

const QuoteEditor = ({ initial, onClose, onSaved }) => {
  const isEdit = !!initial?.id;
  const [form, setForm] = useState({
    template_id: initial?.template_id || '',
    client_id: initial?.client_id || '',
    items: initial?.items?.length ? initial.items.map(i => ({ description: i.description, unit: i.unit, quantity: i.quantity, unit_price: i.unit_price })) : [],
    freights: initial?.freights?.length ? initial.freights.map(f => ({ description: f.description, km_total: f.km_total, price_per_km: f.price_per_km })) : [],
    minimum_billing_kg: initial?.minimum_billing_kg || '',
    payment_terms: initial?.payment_terms || '30',
    payment_method: initial?.payment_method || 'Boleto',
    seller_name: initial?.seller_name || '',
    seller_contact: initial?.seller_contact || '',
    validity_days: initial?.validity_days || 15,
    notes: initial?.notes || '',
    status: initial?.status || 'rascunho',
  });
  const [clients, setClients] = useState([]);
  const [clientSearch, setClientSearch] = useState('');
  const [showNewClient, setShowNewClient] = useState(false);
  const [newClient, setNewClient] = useState({ name: '', phone: '', email: '', cnpj: '', company_name: '' });
  const [templates, setTemplates] = useState([]);
  const [catalogServices, setCatalogServices] = useState([]);
  const [catalogFreights, setCatalogFreights] = useState([]);
  const [pickService, setPickService] = useState(false);
  const [pickFreight, setPickFreight] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      schedulingAPI.getClients(),
      quotesAPI.listTemplates(),
      quotesAPI.listServices(),
      quotesAPI.listFreights(),
    ]).then(([cs, ts, ss, fs]) => {
      setClients(cs.data || []);
      setTemplates(ts.data || []);
      setCatalogServices(ss.data || []);
      setCatalogFreights(fs.data || []);
      // auto-pick default template
      if (!form.template_id) {
        const def = (ts.data || []).find(t => t.is_default);
        if (def) setForm(f => ({ ...f, template_id: def.id }));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedClient = clients.find(c => c.id === form.client_id);
  const filteredClients = clientSearch
    ? clients.filter(c => (c.name || '').toLowerCase().includes(clientSearch.toLowerCase()) || (c.phone || '').includes(clientSearch))
    : clients.slice(0, 50);

  const itemsTotal = form.items.reduce((s, i) => s + (i.quantity || 0) * (i.unit_price || 0), 0);
  const freightsTotal = form.freights.reduce((s, f) => s + (f.km_total || 0) * (f.price_per_km || 0), 0);
  const grandTotal = itemsTotal + freightsTotal;

  const updateItem = (idx, patch) => setForm({ ...form, items: form.items.map((it, i) => i === idx ? { ...it, ...patch } : it) });
  const removeItem = (idx) => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) });
  const updateFreight = (idx, patch) => setForm({ ...form, freights: form.freights.map((f, i) => i === idx ? { ...f, ...patch } : f) });
  const removeFreight = (idx) => setForm({ ...form, freights: form.freights.filter((_, i) => i !== idx) });

  const addBlankItem = () => setForm({ ...form, items: [...form.items, { description: '', unit: 'un', quantity: 1, unit_price: 0 }] });
  const addBlankFreight = () => setForm({ ...form, freights: [...form.freights, { description: '', km_total: 0, price_per_km: 0 }] });

  const addFromCatalog = (s) => {
    setForm({ ...form, items: [...form.items, { description: s.description, unit: s.unit, quantity: 1, unit_price: s.default_price, quote_service_id: s.id }] });
    setPickService(false);
  };
  const addFreightFromCatalog = (f) => {
    setForm({ ...form, freights: [...form.freights, { description: f.description, km_total: f.default_km, price_per_km: f.default_price_per_km, quote_freight_id: f.id }] });
    setPickFreight(false);
  };

  const handleCreateClient = async () => {
    if (!newClient.name.trim() || !newClient.phone.trim()) {
      alert('Nome e telefone sao obrigatorios');
      return;
    }
    try {
      const { data } = await schedulingAPI.createClient({ ...newClient, person_type: newClient.cnpj ? 'juridica' : 'fisica' });
      setClients([data, ...clients]);
      setForm({ ...form, client_id: data.id });
      setShowNewClient(false);
      setNewClient({ name: '', phone: '', email: '', cnpj: '', company_name: '' });
    } catch (e) { alert('Erro: ' + (e?.response?.data?.detail || e.message)); }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (isEdit) await quotesAPI.update(initial.id, form);
      else await quotesAPI.create(form);
      onSaved();
    } catch (e) { alert('Erro: ' + (e?.response?.data?.detail || e.message)); }
    finally { setSaving(false); }
  };

  return (
    <ModalShell title={isEdit ? `Editar Orcamento #${initial.quote_number}` : 'Novo Orcamento'} onClose={onClose} large>
      <div className="space-y-4">
        {/* Cliente */}
        <section className="border rounded-lg p-3 bg-slate-50">
          <h3 className="font-semibold text-sm text-slate-700 mb-2 flex items-center gap-2"><Search className="w-4 h-4" /> Cliente</h3>
          {selectedClient ? (
            <div className="flex justify-between items-center bg-white border rounded p-2">
              <div>
                <div className="font-medium">{selectedClient.name}</div>
                <div className="text-xs text-slate-500">{selectedClient.phone} {selectedClient.cnpj && `• CNPJ ${selectedClient.cnpj}`}</div>
              </div>
              <button onClick={() => setForm({ ...form, client_id: '' })} className="text-xs text-red-600">Trocar</button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input data-testid="client-search" placeholder="Buscar cliente por nome ou telefone..." className="flex-1 border rounded px-3 py-2 text-sm" value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} />
                <button onClick={() => setShowNewClient(!showNewClient)} className="text-sm border border-emerald-600 text-emerald-600 px-3 py-2 rounded" data-testid="new-client-toggle">+ Novo</button>
              </div>
              {showNewClient && (
                <div className="bg-white border rounded p-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <input data-testid="new-client-name" placeholder="Nome *" className="border rounded px-2 py-1 text-sm" value={newClient.name} onChange={(e) => setNewClient({ ...newClient, name: e.target.value })} />
                    <input data-testid="new-client-phone" placeholder="Telefone *" className="border rounded px-2 py-1 text-sm" value={newClient.phone} onChange={(e) => setNewClient({ ...newClient, phone: e.target.value })} />
                    <input placeholder="E-mail" className="border rounded px-2 py-1 text-sm" value={newClient.email} onChange={(e) => setNewClient({ ...newClient, email: e.target.value })} />
                    <input placeholder="CNPJ (opcional)" className="border rounded px-2 py-1 text-sm" value={newClient.cnpj} onChange={(e) => setNewClient({ ...newClient, cnpj: e.target.value })} />
                    <input placeholder="Razao Social (PJ)" className="col-span-2 border rounded px-2 py-1 text-sm" value={newClient.company_name} onChange={(e) => setNewClient({ ...newClient, company_name: e.target.value })} />
                  </div>
                  <button data-testid="create-client-btn" onClick={handleCreateClient} className="bg-emerald-600 text-white px-3 py-1 rounded text-sm">Criar e selecionar</button>
                </div>
              )}
              {!showNewClient && (
                <div className="max-h-40 overflow-y-auto border rounded bg-white">
                  {filteredClients.map(c => (
                    <button key={c.id} onClick={() => { setForm({ ...form, client_id: c.id }); setClientSearch(''); }} className="block w-full text-left p-2 hover:bg-slate-100 text-sm border-b" data-testid={`pick-client-${c.id}`}>
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-slate-500">{c.phone}</div>
                    </button>
                  ))}
                  {filteredClients.length === 0 && <div className="p-3 text-xs text-slate-400">Nenhum cliente encontrado.</div>}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Template */}
        <Field label="Template do Orcamento">
          <select data-testid="quote-template" className="w-full border rounded px-3 py-2 text-sm" value={form.template_id} onChange={(e) => setForm({ ...form, template_id: e.target.value })}>
            <option value="">— Padrao —</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}{t.is_default ? ' (padrao)' : ''}</option>)}
          </select>
        </Field>

        {/* Itens */}
        <section className="border rounded-lg p-3">
          <div className="flex justify-between items-center mb-2">
            <h3 className="font-semibold text-sm text-slate-700">Produtos / Servicos</h3>
            <div className="flex gap-1">
              <button onClick={() => setPickService(true)} className="text-xs bg-emerald-50 border border-emerald-300 text-emerald-700 px-2 py-1 rounded" data-testid="pick-service-btn">+ do Catalogo</button>
              <button onClick={addBlankItem} className="text-xs bg-slate-100 border px-2 py-1 rounded">+ Linha vazia</button>
            </div>
          </div>
          {form.items.length === 0 && <div className="text-center text-slate-400 text-sm py-4">Nenhum item. Adicione do catalogo ou linha vazia.</div>}
          <div className="space-y-2">
            {form.items.map((it, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center" data-testid={`quote-item-${idx}`}>
                <input className="col-span-5 border rounded px-2 py-1 text-sm" placeholder="Descricao" value={it.description} onChange={(e) => updateItem(idx, { description: e.target.value })} />
                <input className="col-span-1 border rounded px-2 py-1 text-sm text-center" placeholder="un" value={it.unit} onChange={(e) => updateItem(idx, { unit: e.target.value })} />
                <input type="number" step="0.01" className="col-span-2 border rounded px-2 py-1 text-sm text-right" placeholder="Qtde" value={it.quantity} onChange={(e) => updateItem(idx, { quantity: parseFloat(e.target.value) || 0 })} />
                <input type="number" step="0.01" className="col-span-2 border rounded px-2 py-1 text-sm text-right" placeholder="Vlr Unit" value={it.unit_price} onChange={(e) => updateItem(idx, { unit_price: parseFloat(e.target.value) || 0 })} />
                <span className="col-span-1 text-right text-xs font-medium text-emerald-700">{formatBRL((it.quantity || 0) * (it.unit_price || 0))}</span>
                <button onClick={() => removeItem(idx)} className="col-span-1 text-red-500"><Trash2 className="w-4 h-4 mx-auto" /></button>
              </div>
            ))}
          </div>
          <div className="text-right text-sm mt-2 border-t pt-2"><span className="text-slate-500">Subtotal:</span> <strong>{formatBRL(itemsTotal)}</strong></div>
        </section>

        {/* Fretes */}
        <section className="border rounded-lg p-3">
          <div className="flex justify-between items-center mb-2">
            <h3 className="font-semibold text-sm text-slate-700">Fretes / Deslocamentos</h3>
            <div className="flex gap-1">
              <button onClick={() => setPickFreight(true)} className="text-xs bg-emerald-50 border border-emerald-300 text-emerald-700 px-2 py-1 rounded" data-testid="pick-freight-btn">+ do Catalogo</button>
              <button onClick={addBlankFreight} className="text-xs bg-slate-100 border px-2 py-1 rounded">+ Linha vazia</button>
            </div>
          </div>
          {form.freights.length === 0 && <div className="text-center text-slate-400 text-sm py-4">Nenhum frete adicionado.</div>}
          <div className="space-y-2">
            {form.freights.map((f, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center" data-testid={`quote-freight-${idx}`}>
                <input className="col-span-6 border rounded px-2 py-1 text-sm" placeholder="Descricao do frete" value={f.description} onChange={(e) => updateFreight(idx, { description: e.target.value })} />
                <input type="number" step="0.01" className="col-span-2 border rounded px-2 py-1 text-sm text-right" placeholder="Km total" value={f.km_total} onChange={(e) => updateFreight(idx, { km_total: parseFloat(e.target.value) || 0 })} />
                <input type="number" step="0.01" className="col-span-2 border rounded px-2 py-1 text-sm text-right" placeholder="R$/Km" value={f.price_per_km} onChange={(e) => updateFreight(idx, { price_per_km: parseFloat(e.target.value) || 0 })} />
                <span className="col-span-1 text-right text-xs font-medium text-emerald-700">{formatBRL((f.km_total || 0) * (f.price_per_km || 0))}</span>
                <button onClick={() => removeFreight(idx)} className="col-span-1 text-red-500"><Trash2 className="w-4 h-4 mx-auto" /></button>
              </div>
            ))}
          </div>
          <div className="text-right text-sm mt-2 border-t pt-2"><span className="text-slate-500">Subtotal frete:</span> <strong>{formatBRL(freightsTotal)}</strong></div>
        </section>

        {/* Condicoes */}
        <section className="grid grid-cols-2 gap-3 border rounded-lg p-3">
          <Field label="Faturamento minimo">
            <input data-testid="quote-min-billing" className="w-full border rounded px-3 py-2 text-sm" value={form.minimum_billing_kg} placeholder="Ex: 100kg" onChange={(e) => setForm({ ...form, minimum_billing_kg: e.target.value })} />
          </Field>
          <Field label="Validade (dias)">
            <input type="number" data-testid="quote-validity" className="w-full border rounded px-3 py-2 text-sm" value={form.validity_days} onChange={(e) => setForm({ ...form, validity_days: parseInt(e.target.value) || 15 })} />
          </Field>
          <Field label="Prazo pagamento (dias)">
            <input data-testid="quote-payment-terms" className="w-full border rounded px-3 py-2 text-sm" value={form.payment_terms} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })} />
          </Field>
          <Field label="Forma de pagamento">
            <input data-testid="quote-payment-method" className="w-full border rounded px-3 py-2 text-sm" value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })} />
          </Field>
          <Field label="Vendedor (nome)">
            <input data-testid="quote-seller-name" className="w-full border rounded px-3 py-2 text-sm" value={form.seller_name} onChange={(e) => setForm({ ...form, seller_name: e.target.value })} />
          </Field>
          <Field label="Vendedor (contato)">
            <input data-testid="quote-seller-contact" className="w-full border rounded px-3 py-2 text-sm" value={form.seller_contact} onChange={(e) => setForm({ ...form, seller_contact: e.target.value })} />
          </Field>
        </section>

        <Field label="Observacoes">
          <textarea data-testid="quote-notes" rows={3} className="w-full border rounded px-3 py-2 text-sm" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>

        {isEdit && (
          <Field label="Status">
            <select data-testid="quote-status" className="w-full border rounded px-3 py-2 text-sm" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="rascunho">Rascunho</option>
              <option value="enviado">Enviado</option>
              <option value="aceito">Aceito</option>
              <option value="recusado">Recusado</option>
            </select>
          </Field>
        )}

        <div className="bg-emerald-50 border border-emerald-200 rounded p-3 text-right">
          <div className="text-xs text-slate-600">Subtotal: {formatBRL(itemsTotal)} + Frete: {formatBRL(freightsTotal)}</div>
          <div className="text-xl font-bold text-emerald-700 mt-1" data-testid="quote-grand-total">Total: {formatBRL(grandTotal)}</div>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4 border-t mt-4">
        <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600">Cancelar</button>
        <button data-testid="save-quote-btn" onClick={handleSave} disabled={saving} className="bg-emerald-600 text-white px-4 py-2 rounded text-sm disabled:opacity-50">{saving ? 'Salvando...' : 'Salvar Orcamento'}</button>
      </div>

      {pickService && (
        <ModalShell title="Adicionar do Catalogo de Produtos" onClose={() => setPickService(false)}>
          <div className="max-h-96 overflow-y-auto space-y-1">
            {catalogServices.length === 0 && <div className="text-center text-slate-400 py-6 text-sm">Nenhum produto cadastrado. Va para a aba "Produtos" para criar.</div>}
            {catalogServices.map(s => (
              <button key={s.id} onClick={() => addFromCatalog(s)} className="w-full text-left p-2 border rounded hover:bg-emerald-50 flex justify-between" data-testid={`pick-service-${s.id}`}>
                <div>
                  <div className="font-medium text-sm">{s.description}</div>
                  <div className="text-xs text-slate-500">{s.unit}</div>
                </div>
                <div className="text-sm text-emerald-700 font-medium">{formatBRL(s.default_price)}</div>
              </button>
            ))}
          </div>
        </ModalShell>
      )}

      {pickFreight && (
        <ModalShell title="Adicionar do Catalogo de Fretes" onClose={() => setPickFreight(false)}>
          <div className="max-h-96 overflow-y-auto space-y-1">
            {catalogFreights.length === 0 && <div className="text-center text-slate-400 py-6 text-sm">Nenhum frete cadastrado. Va para a aba "Fretes" para criar.</div>}
            {catalogFreights.map(f => (
              <button key={f.id} onClick={() => addFreightFromCatalog(f)} className="w-full text-left p-2 border rounded hover:bg-emerald-50 flex justify-between" data-testid={`pick-freight-${f.id}`}>
                <div>
                  <div className="font-medium text-sm">{f.description}</div>
                  <div className="text-xs text-slate-500">{f.default_km} km @ {formatBRL(f.default_price_per_km)}/km</div>
                </div>
                <div className="text-sm text-emerald-700 font-medium">{formatBRL((f.default_km || 0) * (f.default_price_per_km || 0))}</div>
              </button>
            ))}
          </div>
        </ModalShell>
      )}
    </ModalShell>
  );
};

const PreviewModal = ({ html, quote, onClose }) => {
  const handlePrint = () => {
    const w = window.open('', '_blank', 'width=900,height=900');
    if (!w) { alert('Permita popups para imprimir.'); return; }
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Orcamento #${quote?.quote_number || ''}</title></head><body>${html}<script>window.onload=function(){window.print();}</script></body></html>`);
    w.document.close();
  };
  return (
    <ModalShell title={`Visualizar Orcamento #${quote?.quote_number || ''}`} onClose={onClose} large>
      <div className="bg-white border rounded shadow-inner p-2 max-h-[60vh] overflow-y-auto" data-testid="quote-preview">
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      <div className="flex justify-end gap-2 pt-3 border-t mt-3">
        <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600">Fechar</button>
        <button data-testid="print-quote-btn" onClick={handlePrint} className="flex items-center gap-1 bg-emerald-600 text-white px-4 py-2 rounded text-sm">
          <Printer className="w-4 h-4" /> Imprimir / Salvar PDF
        </button>
      </div>
    </ModalShell>
  );
};

// ─── Shared ──────────────────────────────────────────────────────────────────
const Field = ({ label, children }) => (
  <label className="block">
    <span className="text-xs font-medium text-slate-700">{label}</span>
    <div className="mt-1">{children}</div>
  </label>
);

const ModalShell = ({ title, children, onClose, large }) => {
  return createPortal(
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div
        className={`bg-white rounded-lg shadow-xl w-full ${large ? 'max-w-4xl' : 'max-w-lg'} my-8`}
        onClick={(e) => e.stopPropagation()}
        data-testid="modal-shell"
      >
        <div className="flex justify-between items-center px-4 py-3 border-b">
          <h2 className="font-semibold text-slate-800">{title}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800" data-testid="modal-close"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>,
    document.body
  );
};

export default OrcamentosPage;
