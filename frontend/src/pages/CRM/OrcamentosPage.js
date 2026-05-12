import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { quotesAPI, schedulingAPI, channelsAPI } from '../../services/api';
import api from '../../services/api';
import { toast } from 'sonner';
import { Plus, Trash2, Edit2, FileText, Truck, Package, Layers, Printer, X, Search, Eye, Copy, Upload, Send, Loader2, RefreshCw } from 'lucide-react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';

const TABS = [
  { key: 'list', label: 'Orcamentos', icon: FileText },
  { key: 'services', label: 'Itens', icon: Package },
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
        <p className="text-sm text-slate-500">Gere propostas comerciais combinando itens, fretes e templates personalizados.</p>
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
    if (!window.confirm('Excluir este item?')) return;
    await quotesAPI.deleteService(id);
    await load();
  };

  return (
    <div data-testid="services-tab">
      <div className="flex justify-between items-center mb-3">
        <p className="text-sm text-slate-600">Cadastre itens isolados (peso/unidade/litro etc) com preco padrao.</p>
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
                <tr><td colSpan={4} className="text-center text-slate-400 py-6">Nenhum item cadastrado.</td></tr>
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
    <ModalShell title={initial?.id ? 'Editar Item' : 'Novo Item'} onClose={onClose}>
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
  { group: 'Orcamento', token: '{{quote_number}}', label: 'Numero do orcamento' },
  { group: 'Orcamento', token: '{{data_emissao}}', label: 'Data de emissao' },
  { group: 'Orcamento', token: '{{validity_days}}', label: 'Validade (dias)' },
  { group: 'Cliente', token: '{{razao_social}}', label: 'Razao social / Nome fantasia' },
  { group: 'Cliente', token: '{{cnpj_cpf}}', label: 'CNPJ ou CPF' },
  { group: 'Cliente', token: '{{nome}}', label: 'Nome do contato' },
  { group: 'Cliente', token: '{{telefone}}', label: 'Telefone do cliente' },
  { group: 'Cliente', token: '{{email}}', label: 'E-mail do cliente' },
  { group: 'Cliente', token: '{{endereco}}', label: 'Endereco completo' },
  { group: 'Cliente', token: '{{cidade}}', label: 'Cidade' },
  { group: 'Cliente', token: '{{estado}}', label: 'Estado (UF)' },
  { group: 'Cliente', token: '{{cep}}', label: 'CEP' },
  { group: 'Valores', token: '{{items_total}}', label: 'Subtotal dos itens' },
  { group: 'Valores', token: '{{freights_total}}', label: 'Subtotal do frete' },
  { group: 'Valores', token: '{{total_value}}', label: 'Valor total do orcamento' },
  { group: 'Condicoes', token: '{{minimum_billing_kg}}', label: 'Faturamento minimo' },
  { group: 'Condicoes', token: '{{payment_terms}}', label: 'Prazo de pagamento (dias)' },
  { group: 'Condicoes', token: '{{payment_method}}', label: 'Forma de pagamento' },
  { group: 'Condicoes', token: '{{prazo_medio}}', label: 'Prazo medio (texto livre)' },
  { group: 'Vendedor', token: '{{seller_name}}', label: 'Nome do vendedor' },
  { group: 'Vendedor', token: '{{seller_contact}}', label: 'Contato do vendedor' },
  { group: 'Observacoes', token: '{{notes}}', label: 'Observacoes livres' },
  { group: 'Blocos (listas)', token: '{{#items}}...{{description}} {{quantity}} {{unit_price}} {{total}}...{{/items}}', label: 'Loop de itens — repete para cada item' },
  { group: 'Blocos (listas)', token: '{{#freights}}...{{description}} {{km_total}} {{price_per_km}} {{total}}...{{/freights}}', label: 'Loop de fretes — repete para cada frete' },
];

// ─── TEMPLATE EDITOR (3 ABAS: Conteúdo / Cabeçalho / Rodapé) ────────────────
// Cabeçalho/rodapé repetem em TODAS as páginas do PDF (multi-page) via
// CSS running elements no WeasyPrint. Placeholders funcionam tanto no
// corpo quanto no header/footer ({{quote_number}}, {{razao_social}} etc).
const TEMPLATE_TABS = [
  { key: 'content', label: 'Conteudo' },
  { key: 'header', label: 'Cabecalho' },
  { key: 'footer', label: 'Rodape' },
  { key: 'layout', label: 'Layout (papel timbrado)' },
];

const buildQuillImageHandler = () => function () {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('Imagem muito grande (limite 5MB)'); return; }
    try {
      const fd = new FormData();
      fd.append('file', file);
      const resp = await api.post('/upload/', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const relUrl = resp.data?.url;
      const absUrl = relUrl?.startsWith('/api/') ? `${process.env.REACT_APP_BACKEND_URL}${relUrl}` : relUrl;
      const editor = this.quill;
      const range = editor.getSelection(true);
      editor.insertEmbed(range.index, 'image', absUrl, 'user');
      editor.setSelection(range.index + 1);
      toast.success('Imagem inserida');
    } catch (err) {
      toast.error('Falha no upload: ' + (err?.response?.data?.detail || err.message));
    }
  };
  input.click();
};

const TemplateMultiTabEditor = ({ editing, setEditing }) => {
  const [tab, setTab] = useState('content');
  const [a4Open, setA4Open] = useState(false);
  const [a4Html, setA4Html] = useState('');
  const [a4Loading, setA4Loading] = useState(false);
  const fields = {
    content: 'content',
    header: 'header_html',
    footer: 'footer_html',
  };
  const heights = { content: 320, header: 140, footer: 140 };

  const handleOpenA4 = async () => {
    setA4Loading(true);
    setA4Open(true);
    try {
      const { data } = await api.post('/quotes/templates/preview-html', {
        content: editing?.content || '',
        header_html: editing?.header_html || '',
        footer_html: editing?.footer_html || '',
        header_height_mm: editing?.header_height_mm || 22,
        footer_height_mm: editing?.footer_height_mm || 18,
      });
      setA4Html(data.html);
    } catch (e) {
      toast.error('Falha ao gerar preview A4: ' + (e?.response?.data?.detail || e.message));
      setA4Open(false);
    } finally {
      setA4Loading(false);
    }
  };

  const setHeightField = (field, value) => {
    let n = parseInt(value, 10);
    if (isNaN(n)) n = field === 'header_height_mm' ? 22 : 18;
    n = Math.max(8, Math.min(80, n));
    setEditing(prev => ({ ...prev, [field]: n }));
  };

  // IMPORTANT: render the 3 Quill instances in parallel and toggle visibility
  // via CSS. Swapping a single Quill's `value` prop on tab switch causes
  // `text-change` events to fire with stale closures, leaking content between
  // tabs (e.g. the main body getting saved into header_html).
  const quillModules = useMemo(() => ({
    toolbar: {
      container: [
        [{ header: [1, 2, 3, false] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ color: [] }, { background: [] }],
        [{ list: 'ordered' }, { list: 'bullet' }],
        [{ align: [] }],
        ['link', 'image'],
        ['clean'],
      ],
      handlers: { image: buildQuillImageHandler() },
    },
  }), []);

  return (
    <div data-testid="template-multi-tab-editor">
      {/* Sub-tabs */}
      <div className="flex items-end justify-between gap-2 mb-2 border-b border-slate-200">
        <div className="flex gap-1">
          {TEMPLATE_TABS.map(t => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                data-testid={`template-subtab-${t.key}`}
                className={`px-3 py-1.5 text-xs font-medium border-b-2 transition ${
                  active ? 'border-emerald-500 text-emerald-700' : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={handleOpenA4}
          className="mb-1 px-2.5 py-1 text-xs font-medium rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50 flex items-center gap-1.5"
          data-testid="template-preview-a4-btn"
          title="Veja como a página A4 vai ficar antes de salvar"
        >
          <Eye className="w-3.5 h-3.5" /> Pré-visualizar A4
        </button>
      </div>
      {TEMPLATE_TABS.map(t => {
        const field = fields[t.key];
        const isActive = tab === t.key;
        const heightField = t.key === 'header' ? 'header_height_mm' : (t.key === 'footer' ? 'footer_height_mm' : null);
        const heightVal = heightField
          ? (editing?.[heightField] ?? (heightField === 'header_height_mm' ? 22 : 18))
          : null;
        // ── Layout (papel timbrado) sub-tab — full-page background image
        if (t.key === 'layout') {
          if (!isActive) return <div key={t.key} style={{ display: 'none' }} />;
          const hasImg = !!editing?.layout_image_b64;
          const handleLayoutFile = (file) => {
            if (!file) return;
            if (file.size > 10 * 1024 * 1024) { toast.error('Imagem muito grande (max 10MB)'); return; }
            const reader = new FileReader();
            reader.onload = ev => {
              const b64 = String(ev.target.result).split(',')[1] || '';
              setEditing(prev => ({
                ...prev,
                layout_image_b64: b64,
                layout_image_mimetype: file.type || 'image/png',
              }));
            };
            reader.readAsDataURL(file);
          };
          return (
            <div key={t.key} data-testid="template-layout-tab" className="p-3 bg-slate-50 border border-slate-200 rounded space-y-3">
              <p className="text-xs text-slate-600">
                Faca upload de uma imagem (PNG/JPG) do seu papel timbrado em A4. O orcamento sera renderizado <strong>em cima</strong> dessa imagem em todas as paginas — o cabecalho e rodape acima sao <strong>ignorados</strong> quando esta opcao esta ativa, evitando que a sobreposicao desfigure o leiaute.
              </p>
              <input
                type="file"
                accept="image/png,image/jpeg"
                onChange={e => handleLayoutFile(e.target.files?.[0])}
                className="text-xs w-full"
                data-testid="template-layout-file-input"
              />
              {hasImg && (
                <div className="flex items-start gap-3">
                  <img
                    src={`data:${editing.layout_image_mimetype || 'image/png'};base64,${editing.layout_image_b64}`}
                    alt="Layout preview"
                    className="border border-slate-300 rounded max-h-64 object-contain bg-white"
                    data-testid="template-layout-preview"
                  />
                  <button
                    type="button"
                    onClick={() => setEditing(prev => ({ ...prev, layout_image_b64: '', layout_image_mimetype: '' }))}
                    className="px-2 py-1 text-xs border border-rose-300 text-rose-700 rounded hover:bg-rose-50"
                    data-testid="template-layout-remove"
                  >
                    Remover layout
                  </button>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { k: 'layout_padding_top_mm', label: 'Margem topo (mm)', def: 40 },
                  { k: 'layout_padding_bottom_mm', label: 'Margem rodape (mm)', def: 30 },
                  { k: 'layout_padding_x_mm', label: 'Margem lateral (mm)', def: 18 },
                ].map(p => (
                  <div key={p.k}>
                    <label className="text-[10px] font-bold uppercase text-slate-400">{p.label}</label>
                    <input
                      type="number"
                      min={0} max={120}
                      value={editing?.[p.k] ?? p.def}
                      onChange={e => setEditing(prev => ({ ...prev, [p.k]: parseInt(e.target.value, 10) || p.def }))}
                      className="input-field text-sm"
                      data-testid={`template-${p.k}`}
                    />
                  </div>
                ))}
              </div>
            </div>
          );
        }
        return (
          <div
            key={t.key}
            // Keep DOM mounted so Quill state persists; just hide inactive tabs.
            style={{ display: isActive ? 'block' : 'none' }}
            data-testid={`template-${t.key}-quill`}
          >
            {heightField && (
              <div className="flex items-center gap-3 mb-2 p-2 bg-slate-50 border border-slate-200 rounded text-xs">
                <span className="font-medium text-slate-700 whitespace-nowrap">
                  Altura {t.key === 'header' ? 'do cabeçalho' : 'do rodapé'}:
                </span>
                <input
                  type="range"
                  min={8}
                  max={80}
                  step={1}
                  value={heightVal}
                  onChange={(e) => setHeightField(heightField, e.target.value)}
                  className="flex-1"
                  data-testid={`template-${t.key}-height-range`}
                />
                <input
                  type="number"
                  min={8}
                  max={80}
                  value={heightVal}
                  onChange={(e) => setHeightField(heightField, e.target.value)}
                  className="w-16 px-2 py-1 border border-slate-300 rounded text-right"
                  data-testid={`template-${t.key}-height-input`}
                />
                <span className="text-slate-500">mm</span>
              </div>
            )}
            <div className="border rounded bg-white">
              <ReactQuill
                theme="snow"
                value={editing?.[field] || ''}
                onChange={(html) => setEditing(prev => ({ ...prev, [field]: html }))}
                modules={quillModules}
                style={{ minHeight: `${heights[t.key]}px` }}
              />
            </div>
          </div>
        );
      })}
      <p className="text-xs text-slate-500 mt-1">
        {tab === 'content' && (<>Placeholders disponiveis abaixo. Loop de itens: <code className="bg-slate-100 px-1">{'{{#items}}...{{/items}}'}</code>.</>)}
        {tab === 'header' && 'Aparece no TOPO de TODAS as paginas do PDF. Placeholders funcionam aqui tambem.'}
        {tab === 'footer' && 'Aparece no RODAPE de TODAS as paginas do PDF. Suporta logos, contatos, termos de validade.'}
      </p>

      {a4Open && createPortal(
        <div
          className="fixed inset-0 bg-black/60 z-[120] flex items-center justify-center p-4"
          data-testid="template-a4-modal"
          onClick={() => setA4Open(false)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-[860px] max-h-[92vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Pré-visualização A4</h3>
                <p className="text-[11px] text-slate-500">Renderizado com os mesmos paddings do PDF gerado. Nada foi salvo.</p>
              </div>
              <button
                onClick={() => setA4Open(false)}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
                aria-label="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden bg-slate-100">
              {a4Loading ? (
                <div className="h-full flex items-center justify-center text-slate-400 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" /> Gerando preview…
                </div>
              ) : (
                <iframe
                  title="A4 preview"
                  srcDoc={a4Html}
                  sandbox="allow-same-origin"
                  className="w-full h-full border-0 bg-slate-100"
                  data-testid="template-a4-iframe"
                />
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};


const TemplatesTab = () => {
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

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
    } catch (e) { toast.error('Erro: ' + (e?.response?.data?.detail || e.message)); }
  };

  const handleDuplicate = async (t) => {
    await quotesAPI.createTemplate({ name: `${t.name} (copia)`, content: t.content, is_default: false });
    await load();
  };

  const handleReconvert = async (t) => {
    if (!window.confirm(`Reconverter placeholders do template "${t.name}"?\n\nIsto transforma tokens numerados (ITEM_1, QTDE_1...) em loops {{#items}} e corrige placeholders quebrados pelo Word. Util para templates antigos.`)) return;
    try {
      const { data } = await quotesAPI.reconvertTemplate(t.id);
      toast.success(data.had_loops ? 'Template reconvertido com loops (items/freights)' : 'Template reconvertido (sem loops detectados)');
      await load();
    } catch (e) {
      toast.error('Erro: ' + (e?.response?.data?.detail || e.message));
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Excluir este template?')) return;
    await quotesAPI.deleteTemplate(id);
    await load();
  };

  const handleUploadDocx = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.docx')) {
      toast.error('Selecione um arquivo .docx do Word');
      e.target.value = '';
      return;
    }
    const name = window.prompt('Nome do template:', file.name.replace(/\.docx$/i, '')) || file.name.replace(/\.docx$/i, '');
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('name', name);
      fd.append('is_default', 'false');
      const { data } = await quotesAPI.uploadTemplateDocx(fd);
      toast.success(`Template "${data.name}" criado a partir do .docx`);
      await load();
      // Auto-open the editor so the user can adjust the converted HTML if needed
      setEditing(data);
    } catch (err) {
      toast.error('Falha no upload: ' + (err?.response?.data?.detail || err.message));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div data-testid="templates-tab">
      <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
        <p className="text-sm text-slate-600">Importe um modelo .docx do Word ou crie um template novo. Os placeholders sao convertidos automaticamente.</p>
        <div className="flex gap-2">
          <input ref={fileInputRef} type="file" accept=".docx" onChange={handleUploadDocx} className="hidden" data-testid="upload-docx-input" />
          <button
            data-testid="upload-docx-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1 bg-blue-600 text-white px-3 py-2 rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploading ? 'Enviando...' : 'Upload .docx'}
          </button>
          <button
            data-testid="new-template-btn"
            onClick={() => setEditing({ name: '', content: '', is_default: false })}
            className="flex items-center gap-1 bg-emerald-600 text-white px-3 py-2 rounded-md text-sm hover:bg-emerald-700"
          >
            <Plus className="w-4 h-4" /> Novo Template
          </button>
        </div>
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
                <button onClick={() => handleReconvert(t)} className="p-1 text-slate-500 hover:text-amber-600" title="Reconverter placeholders (templates antigos)" data-testid={`reconvert-template-${t.id}`}><RefreshCw className="w-4 h-4" /></button>
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
            <Field label="Conteudo do template *">
              <TemplateMultiTabEditor editing={editing} setEditing={setEditing} />
            </Field>
            <div className="bg-slate-50 rounded p-3" data-testid="placeholder-list">
              <p className="text-xs font-semibold text-slate-700 mb-2">Placeholders disponiveis (clique para copiar):</p>
              {Object.entries(PLACEHOLDERS.reduce((acc, p) => {
                (acc[p.group] = acc[p.group] || []).push(p);
                return acc;
              }, {})).map(([groupName, tokens]) => (
                <div key={groupName} className="mb-3 last:mb-0">
                  <div className="text-[10px] font-bold uppercase text-emerald-700 mb-1">{groupName}</div>
                  <div className="space-y-0.5">
                    {tokens.map(p => (
                      <button
                        key={p.token}
                        onClick={() => { navigator.clipboard.writeText(p.token); toast.success('Placeholder copiado', { duration: 1500 }); }}
                        className="w-full flex items-start gap-2 text-left bg-white border border-slate-200 px-2 py-1 rounded hover:bg-emerald-50 hover:border-emerald-300 transition"
                      >
                        <code className="text-[11px] font-mono text-emerald-700 flex-shrink-0 whitespace-nowrap">{p.token.length > 40 ? p.token.substring(0, 37) + '...' : p.token}</code>
                        <span className="text-[11px] text-slate-600">{p.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
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
  // M6 filters
  const [filterDoc, setFilterDoc] = useState('');
  const [filterCustomer, setFilterCustomer] = useState('');
  const [filterUser, setFilterUser] = useState('');
  const [allUsers, setAllUsers] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterDoc.trim()) params.document = filterDoc.trim();
      if (filterCustomer.trim()) params.customer = filterCustomer.trim();
      if (filterUser) params.user_id = filterUser;
      const { data } = await quotesAPI.list(params);
      setQuotes(data || []);
    } finally { setLoading(false); }
  }, [filterDoc, filterCustomer, filterUser]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    // Load users for the M6 "Usuario" filter dropdown
    import('../../services/api').then(m => m.schedulingAPI.getCompanyUsers().catch(() => ({ data: [] })).then(r => setAllUsers(r.data || [])));
  }, []);

  const handleDelete = async (id) => {
    if (!window.confirm('Excluir este orcamento?')) return;
    await quotesAPI.delete(id);
    await load();
  };

  const handlePreview = async (id) => {
    try {
      // Use preview-pdf-html so the preview MATCHES the downloaded PDF
      // byte-for-byte (same CSS, header/footer, A4 paper visual).
      const { data } = await quotesAPI.previewPdfHtml(id);
      // IMPORTANT: include `id` inside the quote payload — the modal's
      // "Baixar PDF" / "Abrir PDF" buttons rely on `quote.id` to build the
      // `/quotes/{id}/pdf` URL. Without it, the URL became `/quotes//pdf`
      // and the server returned 404 ("Erro ao baixar PDF: Request failed
      // with status code 404") — exact bug reported by Incinera 03/05/2026.
      setPreviewing({ id, html: data.html, quote: { id, quote_number: data.quote_number } });
    } catch (e) {
      alert('Erro ao renderizar: ' + (e?.response?.data?.detail || e.message));
    }
  };

  return (
    <div data-testid="quotes-list-tab">
      <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
        <p className="text-sm text-slate-600">Orcamentos sao gerados a partir de um atendimento. Abra um chat e use o atalho "Novo Orcamento" no header.</p>
        <button
          data-testid="new-quote-btn"
          onClick={() => toast.info('Novo orcamento deve ser criado a partir de um atendimento. Acesse Atendimentos, abra um chat e clique no icone de orcamento no header.')}
          className="flex items-center gap-1 bg-slate-200 text-slate-600 px-3 py-2 rounded-md text-sm cursor-help"
          title="Novo orcamento e criado pelo atalho dentro de um atendimento"
        >
          <Plus className="w-4 h-4" /> Novo Orcamento
        </button>
      </div>

      {/* M6 Filters */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-3">
        <input
          value={filterDoc}
          onChange={e => setFilterDoc(e.target.value)}
          placeholder="CPF / CNPJ…"
          className="input-field text-sm"
          data-testid="filter-quote-document"
        />
        <input
          value={filterCustomer}
          onChange={e => setFilterCustomer(e.target.value)}
          placeholder="Cliente…"
          className="input-field text-sm"
          data-testid="filter-quote-customer"
        />
        <select
          value={filterUser}
          onChange={e => setFilterUser(e.target.value)}
          className="input-field text-sm"
          data-testid="filter-quote-user"
        >
          <option value="">Usuario (todos)</option>
          {allUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <button
          onClick={() => { setFilterDoc(''); setFilterCustomer(''); setFilterUser(''); }}
          className="px-3 py-2 text-sm border border-slate-300 rounded-md hover:bg-slate-50"
          data-testid="clear-quote-filters"
        >
          Limpar filtros
        </button>
      </div>

      {loading ? <div className="text-center py-8 text-slate-400">Carregando...</div> : (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-4 py-2">N&ordm;</th>
                <th className="px-4 py-2">Cliente</th>
                <th className="px-4 py-2">CPF/CNPJ</th>
                <th className="px-4 py-2">Usuario</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">Total</th>
                <th className="px-4 py-2">Criado em</th>
                <th className="px-4 py-2 w-32"></th>
              </tr>
            </thead>
            <tbody>
              {quotes.length === 0 ? (
                <tr><td colSpan={8} className="text-center text-slate-400 py-6">Nenhum orcamento ainda.</td></tr>
              ) : quotes.map(q => (
                <tr key={q.id} className="border-t border-slate-100" data-testid={`quote-row-${q.id}`}>
                  <td className="px-4 py-2 font-mono text-slate-700">#{q.quote_number}</td>
                  <td className="px-4 py-2">{q.client_name || '—'}</td>
                  <td className="px-4 py-2 text-xs text-slate-500 font-mono">{q.client_document || '—'}</td>
                  <td className="px-4 py-2 text-xs text-slate-600">{q.created_by_name || '—'}</td>
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

const QuoteEditor = ({ initial, onClose, onSaved, onSavedAndSend }) => {
  const isEdit = !!initial?.id;
  const [form, setForm] = useState({
    template_id: initial?.template_id || '',
    client_id: initial?.client_id || '',
    ticket_id: initial?.ticket_id || '',
    items: initial?.items?.length ? initial.items.map(i => ({ description: i.description, unit: i.unit, quantity: i.quantity, unit_price: i.unit_price })) : [],
    freights: initial?.freights?.length ? initial.freights.map(f => ({ description: f.description, km_total: f.km_total, price_per_km: f.price_per_km })) : [],
    minimum_billing_kg: initial?.minimum_billing_kg || '',
    payment_terms: initial?.payment_terms || '30',
    payment_method: initial?.payment_method || 'Boleto',
    average_delivery_days: initial?.average_delivery_days || '',
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
      // Use slim=true: only id/name/is_default — avoids loading huge
      // `layout_image_b64` payloads when the modal opens (was the
      // 5-10s freeze users reported when clicking the template select).
      quotesAPI.listTemplates({ slim: true }),
      quotesAPI.listServices(),
      quotesAPI.listFreights(),
    ]).then(([cs, ts, ss, fs]) => {
      setClients(cs.data || []);
      setTemplates(ts.data || []);
      setCatalogServices(ss.data || []);
      setCatalogFreights(fs.data || []);
      // Do NOT auto-pick the default template — the user must explicitly
      // choose one for each quote (avoids accidentally sending the wrong
      // layout when there are multiple templates per company).
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

  const handleSave = async (sendAfter = false) => {
    setSaving(true);
    try {
      let saved;
      if (isEdit) {
        const { data } = await quotesAPI.update(initial.id, form);
        saved = data;
      } else {
        const { data } = await quotesAPI.create(form);
        saved = data;
      }
      if (sendAfter && onSavedAndSend) onSavedAndSend(saved);
      else if (onSaved) onSaved(saved);
    } catch (e) { toast.error('Erro: ' + (e?.response?.data?.detail || e.message)); }
    finally { setSaving(false); }
  };

  return (
    <ModalShell title={isEdit ? `Editar Orcamento #${initial.quote_number}` : (initial?.ticket_number ? `Novo Orcamento — Atendimento #${initial.ticket_number}` : 'Novo Orcamento')} onClose={onClose} large>
      <div className="space-y-4">
        {/* Banner do ticket vinculado */}
        {form.ticket_id && initial?.ticket_number && (
          <div className="bg-blue-50 border border-blue-200 rounded p-3 flex items-center justify-between" data-testid="quote-ticket-link">
            <div>
              <div className="text-xs text-blue-600 font-semibold uppercase">Vinculado ao Atendimento</div>
              <div className="text-sm text-blue-900 font-medium">#{initial.ticket_number} {initial.customer_name ? `— ${initial.customer_name}` : ''}</div>
              {initial.customer_phone && <div className="text-xs text-blue-700">{initial.customer_phone}</div>}
            </div>
            <div className="text-xs text-slate-500 italic">Numero do orcamento sera o mesmo do atendimento</div>
          </div>
        )}

        {/* Cliente */}
        <section className="border rounded-lg p-3 bg-slate-50">
          <h3 className="font-semibold text-sm text-slate-700 mb-2 flex items-center gap-2"><Search className="w-4 h-4" /> Cliente</h3>
          {selectedClient ? (
            <div className="flex justify-between items-center bg-white border rounded p-2">
              <div>
                <div className="font-medium">{selectedClient.name}</div>
                <div className="text-xs text-slate-500">
                  {selectedClient.phone} {selectedClient.cnpj && `• CNPJ ${selectedClient.cnpj}`}
                  {selectedClient.city && ` • ${selectedClient.city}/${selectedClient.state || ''}`}
                </div>
              </div>
              {!form.ticket_id && (
                <button onClick={() => setForm({ ...form, client_id: '' })} className="text-xs text-red-600">Trocar</button>
              )}
            </div>
          ) : form.ticket_id ? (
            <div className="text-sm text-slate-500 italic p-2">Carregando dados do cliente do atendimento...</div>
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
          <TemplatePicker
            templates={templates}
            value={form.template_id}
            onChange={(id) => setForm({ ...form, template_id: id })}
          />
        </Field>

        {/* Itens */}
        <section className="border rounded-lg p-3">
          <div className="flex justify-between items-center mb-2">
            <h3 className="font-semibold text-sm text-slate-700">Itens do Orcamento</h3>
            <div className="flex gap-1">
              <button onClick={() => setPickService(true)} className="text-xs bg-emerald-50 border border-emerald-300 text-emerald-700 px-2 py-1 rounded" data-testid="pick-service-btn">+ Item</button>
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
              <button onClick={() => setPickFreight(true)} className="text-xs bg-emerald-50 border border-emerald-300 text-emerald-700 px-2 py-1 rounded" data-testid="pick-freight-btn">+ Frete</button>
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
          <Field label="Prazo médio (placeholder {{prazo_medio}})">
            <input
              data-testid="quote-average-delivery"
              className="w-full border rounded px-3 py-2 text-sm"
              placeholder="Ex: 5 dias úteis, 48h, conforme disponibilidade..."
              value={form.average_delivery_days}
              onChange={(e) => setForm({ ...form, average_delivery_days: e.target.value })}
            />
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

      <div className="flex flex-wrap justify-end gap-2 pt-4 border-t mt-4 sticky bottom-0 bg-white -mx-4 -mb-4 px-4 pb-4 z-10">
        <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600">Cancelar</button>
        <button data-testid="save-quote-btn" onClick={() => handleSave(false)} disabled={saving} className="bg-emerald-600 text-white px-4 py-2 rounded text-sm disabled:opacity-50">
          {saving ? 'Salvando...' : 'Salvar Orcamento'}
        </button>
        {onSavedAndSend && (
          <button
            data-testid="save-and-send-quote-btn"
            onClick={() => handleSave(true)}
            disabled={saving}
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm flex items-center gap-1 hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Salvar e Enviar via WhatsApp
          </button>
        )}
      </div>

      {pickService && (
        <ModalShell title="Adicionar Item do Catalogo" onClose={() => setPickService(false)}>
          <div className="max-h-96 overflow-y-auto space-y-1">
            {catalogServices.length === 0 && <div className="text-center text-slate-400 py-6 text-sm">Nenhum item cadastrado. Va para a aba "Itens" para criar.</div>}
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
  const [downloading, setDownloading] = useState(false);

  // Fetch the server-rendered PDF (WeasyPrint) via axios (auth'd), build a
  // blob URL, and open it in a new tab. More reliable than window.open('') +
  // document.write (which produced a blank page in Safari and strict CSP
  // environments). Also provides download button.
  const openPdf = async () => {
    if (!quote?.id) {
      toast.error('Nao foi possivel abrir o PDF: id do orcamento ausente');
      return;
    }
    setDownloading(true);
    try {
      const response = await api.get(`/quotes/${quote.id}/pdf`, { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      // Keep the blob for at least a minute so the tab can load/print
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      toast.error('Erro ao gerar PDF: ' + (e?.response?.data?.detail || e.message));
    } finally {
      setDownloading(false);
    }
  };

  const downloadPdf = async () => {
    if (!quote?.id) {
      toast.error('Nao foi possivel baixar o PDF: id do orcamento ausente');
      return;
    }
    setDownloading(true);
    try {
      const response = await api.get(`/quotes/${quote.id}/pdf`, { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `orcamento-${quote.quote_number || quote.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      toast.error('Erro ao baixar PDF: ' + (e?.response?.data?.detail || e.message));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <ModalShell title={`Visualizar Orcamento #${quote?.quote_number || ''}`} onClose={onClose} large>
      {/* Sandboxed iframe with the SAME stylesheet WeasyPrint uses on the
          server, so the preview matches the downloaded PDF visually. The
          srcDoc payload comes from /quotes/:id/preview-pdf-html. */}
      <div className="bg-slate-100 border rounded shadow-inner max-h-[70vh] overflow-y-auto" data-testid="quote-preview">
        <iframe
          title="Visualizacao do orcamento"
          srcDoc={html}
          sandbox="allow-same-origin"
          className="w-full block bg-transparent"
          style={{ height: '70vh', border: 0 }}
        />
      </div>
      <div className="flex flex-wrap justify-end gap-2 pt-3 border-t mt-3">
        <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600">Fechar</button>
        <button data-testid="download-pdf-btn" onClick={downloadPdf} disabled={downloading} className="flex items-center gap-1 bg-slate-600 text-white px-4 py-2 rounded text-sm disabled:opacity-50">
          {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />} Baixar PDF
        </button>
        <button data-testid="print-quote-btn" onClick={openPdf} disabled={downloading} className="flex items-center gap-1 bg-emerald-600 text-white px-4 py-2 rounded text-sm disabled:opacity-50">
          {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />} Abrir PDF / Imprimir
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

const TemplatePicker = ({ templates, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const wrapRef = useRef(null);
  const selected = templates.find(t => t.id === value);
  const filtered = (templates || []).filter(t =>
    !q || (t.name || '').toLowerCase().includes(q.toLowerCase())
  );

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`w-full text-left border rounded px-3 py-2 text-sm flex items-center justify-between gap-2 hover:border-slate-400 transition-colors ${
          selected ? 'bg-white text-slate-900' : 'bg-white text-slate-400'
        }`}
        data-testid="quote-template-picker"
      >
        <span className="truncate">
          {selected ? selected.name : '— Selecione um template —'}
        </span>
        <svg className={`w-4 h-4 text-slate-400 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-72 overflow-hidden flex flex-col">
          <div className="p-2 border-b">
            <input
              autoFocus
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Pesquisar template..."
              className="w-full border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-emerald-500"
              data-testid="template-search-input"
            />
          </div>
          <div className="overflow-y-auto flex-1">
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-sm text-slate-400 text-center">Nenhum template encontrado</div>
            )}
            {filtered.map(t => {
              const active = t.id === value;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { onChange(t.id); setOpen(false); setQ(''); }}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 transition-colors ${
                    active ? 'bg-emerald-50 text-emerald-700' : 'hover:bg-slate-50 text-slate-700'
                  }`}
                  data-testid={`template-option-${t.id}`}
                >
                  <span className="truncate">{t.name}</span>
                  {t.is_default && (
                    <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded flex-shrink-0">padrao</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const ModalShell = ({ title, children, onClose, large }) => {
  return createPortal(
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-start sm:items-center justify-center p-2 sm:p-4 overflow-y-auto" onClick={onClose}>
      <div
        className={`bg-white rounded-lg shadow-xl w-full ${large ? 'max-w-4xl' : 'max-w-lg'} my-4 max-h-[95vh] sm:max-h-[90vh] flex flex-col`}
        onClick={(e) => e.stopPropagation()}
        data-testid="modal-shell"
      >
        <div className="flex justify-between items-center px-4 py-3 border-b flex-shrink-0">
          <h2 className="font-semibold text-slate-800 truncate pr-2">{title}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800 flex-shrink-0" data-testid="modal-close"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>,
    document.body
  );
};

export { QuoteEditor };
export default OrcamentosPage;
