/**
 * Meta WhatsApp Cloud API (Official) — Company panel
 *
 * 3 abas:
 *   1. Credenciais  — cliente cola App ID/Secret/Token/WABA ID/Verify Token
 *   2. Templates    — CRUD + sync com Meta + categorias com guia
 *   3. Numeros      — sync e listagem de phone_numbers da WABA
 *
 * 2026-02-28 — Fase 3 (Meta API). Model A: cada empresa tem propria conta.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { metaCloudAPI } from '../../services/api';
import { toast } from 'sonner';
import {
  KeyRound, ShieldCheck, RefreshCw, Plus, Trash2, FileText, Phone,
  AlertTriangle, Info, CheckCircle2, X, Save, BookOpen, Tag,
} from 'lucide-react';

const META_CATEGORY_COLORS = {
  MARKETING:      { bg: 'bg-red-50',    border: 'border-red-300',    text: 'text-red-700',    badge: 'bg-red-100 text-red-700' },
  UTILITY:        { bg: 'bg-blue-50',   border: 'border-blue-300',   text: 'text-blue-700',   badge: 'bg-blue-100 text-blue-700' },
  AUTHENTICATION: { bg: 'bg-purple-50', border: 'border-purple-300', text: 'text-purple-700', badge: 'bg-purple-100 text-purple-700' },
  SERVICE:        { bg: 'bg-emerald-50',border: 'border-emerald-300',text: 'text-emerald-700',badge: 'bg-emerald-100 text-emerald-700' },
};

const MetaCloudAPIPage = () => {
  const [tab, setTab] = useState('credentials');
  return (
    <div className="animate-fade-in" data-testid="meta-cloud-api-page">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 font-heading flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-emerald-600" />
          API Oficial WhatsApp (Meta)
        </h1>
        <p className="text-sm text-slate-500 mt-1">Provedor oficial Meta Cloud API — alternativa ao QR Code (Baileys).</p>
      </div>

      <div className="flex gap-1 border-b border-slate-200 mb-6 overflow-x-auto">
        {[
          { k: 'credentials', label: 'Credenciais', icon: KeyRound },
          { k: 'templates',   label: 'Templates HSM', icon: FileText },
          { k: 'numbers',     label: 'Numeros', icon: Phone },
          { k: 'guide',       label: 'Guia Meta', icon: BookOpen },
        ].map(t => {
          const Ic = t.icon;
          return (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              data-testid={`meta-tab-${t.k}`}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                tab === t.k ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              <Ic className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'credentials' && <CredentialsTab />}
      {tab === 'templates'   && <TemplatesTab />}
      {tab === 'numbers'     && <NumbersTab />}
      {tab === 'guide'       && <GuideTab />}
    </div>
  );
};

/* ─────────────────── CREDENTIALS TAB ─────────────────── */
const CredentialsTab = () => {
  const [creds, setCreds] = useState(null);
  const [form, setForm] = useState({
    app_id: '', app_secret: '', system_user_token: '', waba_id: '',
    api_version: 'v20.0', webhook_verify_token: '',
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    metaCloudAPI.getCredentials().then(r => setCreds(r.data)).catch(() => {});
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    if (creds) {
      setForm(f => ({
        ...f,
        app_id: creds.app_id || '',
        waba_id: creds.waba_id || '',
        api_version: creds.api_version || 'v20.0',
        webhook_verify_token: creds.webhook_verify_token || '',
      }));
    }
  }, [creds]);

  const save = async () => {
    setSaving(true);
    try {
      // Only send non-empty fields so we dont overwrite token with empty.
      const payload = {};
      Object.entries(form).forEach(([k, v]) => {
        if (v && String(v).trim() !== '') payload[k] = v;
      });
      await metaCloudAPI.updateCredentials(payload);
      toast.success('Credenciais salvas!');
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const removeCreds = async () => {
    if (!window.confirm('Remover todas as credenciais Meta? Sera necessario reconfigurar tudo.')) return;
    try {
      await metaCloudAPI.deleteCredentials();
      toast.success('Credenciais removidas');
      setCreds(null);
      setForm({ app_id: '', app_secret: '', system_user_token: '', waba_id: '', api_version: 'v20.0', webhook_verify_token: '' });
    } catch { toast.error('Erro ao remover'); }
  };

  if (!creds) return <div className="text-sm text-slate-500">Carregando...</div>;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Status card */}
      <div className={`card border-l-4 ${creds.configured ? 'border-l-emerald-500' : 'border-l-amber-500'}`}>
        <div className="flex items-start gap-3">
          {creds.configured ? (
            <CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
          )}
          <div className="flex-1">
            <h3 className="font-semibold text-slate-900">
              {creds.configured ? 'Credenciais configuradas' : 'Credenciais nao configuradas'}
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              {creds.configured
                ? `Token: ${creds.system_user_token_masked} · WABA: ${creds.waba_id}`
                : 'Voce precisa de uma conta Meta Business + WABA. Veja a aba "Guia Meta" para passo-a-passo.'}
            </p>
          </div>
          {creds.configured && (
            <button onClick={removeCreds} className="text-red-600 hover:bg-red-50 p-2 rounded" data-testid="meta-creds-delete">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Webhook URL info */}
      <div className="card bg-slate-50 border-slate-200">
        <h4 className="font-semibold text-slate-900 text-sm mb-2 flex items-center gap-1"><Info className="w-4 h-4" /> URL do Webhook (registre na Meta)</h4>
        <code className="text-xs bg-white px-3 py-2 rounded border border-slate-300 block break-all">
          {process.env.REACT_APP_BACKEND_URL}/api/webhooks/meta
        </code>
        <p className="text-xs text-slate-500 mt-2">
          No App Dashboard da Meta {'>'} WhatsApp {'>'} Configuration, cole esta URL e o mesmo "Verify Token" que voce digitou abaixo.
        </p>
      </div>

      {/* Form */}
      <div className="card">
        <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
          <KeyRound className="w-5 h-5" /> Credenciais Meta
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Meta App ID" testid="meta-app-id"
            value={form.app_id}
            onChange={v => setForm({ ...form, app_id: v })}
            hint="Encontre em developers.facebook.com > seu App > Settings > Basic"
          />
          <FormField label="WABA ID" testid="meta-waba-id"
            value={form.waba_id}
            onChange={v => setForm({ ...form, waba_id: v })}
            hint="Business Settings > WhatsApp Accounts > ID da WABA"
          />
          <FormField label="App Secret" type="password" testid="meta-app-secret"
            placeholder={creds.app_secret_masked || 'Nao configurado'}
            value={form.app_secret}
            onChange={v => setForm({ ...form, app_secret: v })}
            hint="Usado para validar assinatura X-Hub-Signature-256 do webhook"
          />
          <FormField label="System User Token" type="password" testid="meta-token"
            placeholder={creds.system_user_token_masked || 'Nao configurado'}
            value={form.system_user_token}
            onChange={v => setForm({ ...form, system_user_token: v })}
            hint="Token permanente do System User (escopo: whatsapp_business_messaging + management)"
          />
          <FormField label="Webhook Verify Token" testid="meta-verify-token"
            value={form.webhook_verify_token}
            onChange={v => setForm({ ...form, webhook_verify_token: v })}
            hint="String que voce inventa — mesmo valor sera colado na Meta"
          />
          <FormField label="API Version" testid="meta-api-version"
            value={form.api_version}
            onChange={v => setForm({ ...form, api_version: v })}
            hint="Recomendado: v20.0"
          />
        </div>
        <div className="flex justify-end mt-4">
          <button onClick={save} disabled={saving} className="btn-primary flex items-center gap-2" data-testid="meta-creds-save">
            <Save className="w-4 h-4" />
            {saving ? 'Salvando...' : 'Salvar Credenciais'}
          </button>
        </div>
      </div>
    </div>
  );
};

const FormField = ({ label, value, onChange, hint, type = 'text', placeholder, testid }) => (
  <div>
    <label className="block text-xs font-medium text-slate-700 mb-1">{label}</label>
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      data-testid={testid}
      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
    />
    {hint && <p className="text-[10px] text-slate-400 mt-1 leading-tight">{hint}</p>}
  </div>
);

/* ─────────────────── TEMPLATES TAB ─────────────────── */
const TemplatesTab = () => {
  const [templates, setTemplates] = useState([]);
  const [categories, setCategories] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    try {
      const [tpl, cat] = await Promise.all([
        metaCloudAPI.listTemplates(),
        metaCloudAPI.getCategories(),
      ]);
      setTemplates(tpl.data || []);
      setCategories(cat.data?.categories || []);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await metaCloudAPI.syncTemplates();
      toast.success(`${r.data.synced} templates sincronizados`);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao sincronizar');
    } finally { setSyncing(false); }
  };

  const remove = async (name) => {
    if (!window.confirm(`Apagar template "${name}" da Meta?`)) return;
    try {
      await metaCloudAPI.deleteTemplate(name);
      toast.success('Template apagado');
      load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Erro ao apagar'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={sync} disabled={syncing} className="btn-secondary flex items-center gap-2 text-sm" data-testid="meta-tpl-sync">
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          Sincronizar da Meta
        </button>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2 text-sm" data-testid="meta-tpl-create">
          <Plus className="w-4 h-4" /> Criar Template
        </button>
      </div>

      {templates.length === 0 && (
        <div className="card text-center text-slate-500 py-12">
          <FileText className="w-12 h-12 mx-auto mb-2 text-slate-300" />
          <p className="text-sm">Nenhum template ainda. Clique em "Sincronizar da Meta" ou crie um novo.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {templates.map(t => {
          const col = META_CATEGORY_COLORS[t.category] || META_CATEGORY_COLORS.UTILITY;
          return (
            <div key={`${t.name}-${t.language}`} className={`card ${col.border} border`} data-testid={`meta-tpl-${t.name}`}>
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-sm text-slate-900 truncate">{t.name}</h4>
                  <span className="text-[10px] text-slate-400">{t.language}</span>
                </div>
                <button onClick={() => remove(t.name)} className="text-red-500 hover:bg-red-50 p-1 rounded" data-testid={`meta-tpl-del-${t.name}`}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-[10px] px-2 py-0.5 rounded ${col.badge}`}>{t.category}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded ${
                  t.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' :
                  t.status === 'PENDING' ? 'bg-amber-100 text-amber-700' :
                  'bg-slate-100 text-slate-600'
                }`}>{t.status}</span>
              </div>
              <pre className="text-[10px] text-slate-600 whitespace-pre-wrap line-clamp-3 bg-slate-50 p-2 rounded border border-slate-100">
                {(t.components || []).map(c => c.text || '').filter(Boolean).join('\n')}
              </pre>
            </div>
          );
        })}
      </div>

      {showCreate && (
        <CreateTemplateModal categories={categories} onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); load(); }} />
      )}
    </div>
  );
};

const CreateTemplateModal = ({ categories, onClose, onSaved }) => {
  const [form, setForm] = useState({ name: '', language: 'pt_BR', category: '', body: '' });
  const [saving, setSaving] = useState(false);
  const allowed = (categories || []).filter(c => c.allowed);
  const selectedCat = (categories || []).find(c => c.key === form.category);

  const save = async () => {
    if (!form.name || !form.category || !form.body) { toast.error('Preencha nome, categoria e corpo'); return; }
    setSaving(true);
    try {
      await metaCloudAPI.createTemplate({
        name: form.name.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
        language: form.language,
        category: form.category,
        components: [{ type: 'BODY', text: form.body }],
      });
      toast.success('Template enviado para aprovacao da Meta (1-24h)');
      onSaved();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao criar template');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" data-testid="meta-tpl-create-modal">
        <div className="p-5 border-b flex items-center justify-between">
          <h3 className="font-bold text-lg">Criar Template Meta</h3>
          <button onClick={onClose}><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <FormField label="Nome do template (snake_case, ex: pedido_confirmado)" value={form.name}
            onChange={v => setForm({ ...form, name: v })} testid="meta-new-tpl-name"
            hint="Min 1, max 512 chars; sem acentos; lowercase + underscore." />
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Idioma</label>
            <select value={form.language} onChange={e => setForm({ ...form, language: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" data-testid="meta-new-tpl-lang">
              <option value="pt_BR">Portugues (Brasil) — pt_BR</option>
              <option value="en_US">English (US) — en_US</option>
              <option value="es_ES">Espanol — es_ES</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-2">Categoria</label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {allowed.map(c => {
                const col = META_CATEGORY_COLORS[c.key] || META_CATEGORY_COLORS.UTILITY;
                return (
                  <button key={c.key} type="button" onClick={() => setForm({ ...form, category: c.key })}
                    data-testid={`meta-new-tpl-cat-${c.key}`}
                    className={`text-left p-3 rounded-lg border-2 transition-all ${
                      form.category === c.key ? `${col.border} ${col.bg}` : 'border-slate-200 hover:border-slate-300'
                    }`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs font-bold ${col.text}`}>{c.label}</span>
                      <span className="text-[10px] text-slate-400">Preco: {c.price_tier}</span>
                    </div>
                    <p className="text-[11px] text-slate-600 leading-tight">{c.description}</p>
                  </button>
                );
              })}
              {allowed.length === 0 && (
                <p className="col-span-2 text-xs text-amber-600 bg-amber-50 p-2 rounded">
                  Nenhuma categoria liberada para esta empresa. Contate o Super Admin.
                </p>
              )}
            </div>
          </div>
          {selectedCat && (
            <div className={`p-3 rounded-lg text-xs space-y-1 ${META_CATEGORY_COLORS[selectedCat.key].bg} ${META_CATEGORY_COLORS[selectedCat.key].border} border`}>
              <p className="font-semibold mb-1">Regras Meta para {selectedCat.label}:</p>
              <ul className="list-disc list-inside space-y-0.5 text-slate-700">
                {selectedCat.rules.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Corpo da mensagem</label>
            <textarea value={form.body} onChange={e => setForm({ ...form, body: e.target.value })}
              rows={5} placeholder="Ola {{1}}, seu pedido {{2}} foi enviado!"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
              data-testid="meta-new-tpl-body" />
            <p className="text-[10px] text-slate-400 mt-1">
              Use {`{{1}}, {{2}}`} etc para variaveis. Meta substitui no momento do envio.
            </p>
          </div>
        </div>
        <div className="p-5 border-t flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary text-sm">Cancelar</button>
          <button onClick={save} disabled={saving} className="btn-primary text-sm" data-testid="meta-new-tpl-save">
            {saving ? 'Enviando...' : 'Enviar para Aprovacao'}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ─────────────────── NUMBERS TAB ─────────────────── */
const NumbersTab = () => {
  const [nums, setNums] = useState([]);
  const [loading, setLoading] = useState(false);

  const sync = async () => {
    setLoading(true);
    try {
      const r = await metaCloudAPI.listPhoneNumbers();
      setNums(r.data.numbers || []);
      toast.success(`${(r.data.numbers || []).length} numeros sincronizados`);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao listar numeros');
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <button onClick={sync} disabled={loading} className="btn-primary flex items-center gap-2 text-sm" data-testid="meta-num-sync">
        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        Sincronizar Numeros da WABA
      </button>
      {nums.length === 0 && (
        <div className="card text-center text-slate-500 py-8">
          <Phone className="w-10 h-10 mx-auto mb-2 text-slate-300" />
          <p className="text-sm">Clique em sincronizar para carregar numeros da sua WABA.</p>
        </div>
      )}
      <div className="space-y-2">
        {nums.map(n => (
          <div key={n.id} className="card flex items-center justify-between" data-testid={`meta-num-${n.id}`}>
            <div>
              <p className="font-semibold text-sm">{n.display_phone_number}</p>
              <p className="text-xs text-slate-500">{n.verified_name || '(sem nome verificado)'}</p>
              <p className="text-[10px] text-slate-400">phone_number_id: {n.id}</p>
            </div>
            <div className="flex items-center gap-2">
              {n.quality_rating && (
                <span className={`text-[10px] px-2 py-0.5 rounded ${
                  n.quality_rating === 'GREEN' ? 'bg-emerald-100 text-emerald-700' :
                  n.quality_rating === 'YELLOW' ? 'bg-amber-100 text-amber-700' :
                  'bg-red-100 text-red-700'
                }`}>{n.quality_rating}</span>
              )}
              <span className={`text-[10px] px-2 py-0.5 rounded ${
                (n.code_verification_status === 'VERIFIED' || n.status === 'CONNECTED') ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700'
              }`}>{n.code_verification_status || n.status || 'unknown'}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ─────────────────── GUIDE TAB ─────────────────── */
const GuideTab = () => {
  const [categories, setCategories] = useState([]);
  useEffect(() => { metaCloudAPI.getCategories().then(r => setCategories(r.data?.categories || [])).catch(() => {}); }, []);

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="card">
        <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
          <BookOpen className="w-5 h-5" /> Passo-a-passo para ativar a API Oficial
        </h3>
        <ol className="text-sm text-slate-700 space-y-3 list-decimal list-inside">
          <li><strong>Crie conta Meta Business:</strong> acesse <a href="https://business.facebook.com" target="_blank" rel="noreferrer" className="text-emerald-600 underline">business.facebook.com</a> e verifique a empresa (CNPJ + documentos).</li>
          <li><strong>Crie um App tipo "Business":</strong> em <a href="https://developers.facebook.com" target="_blank" rel="noreferrer" className="text-emerald-600 underline">developers.facebook.com</a>, adicione o produto "WhatsApp".</li>
          <li><strong>Crie WABA + adicione numero(s):</strong> Business Settings {'>'} WhatsApp Accounts. Cada numero precisa ser verificado por SMS/voz. ATENCAO: o numero nao pode estar ativo no app comum nem no Baileys.</li>
          <li><strong>Crie System User permanente:</strong> Business Settings {'>'} System Users {'>'} Add. Atribua a WABA com permissoes <code>whatsapp_business_messaging</code> + <code>whatsapp_business_management</code>. Gere token (nao expira).</li>
          <li><strong>Cole tudo na aba "Credenciais"</strong> e clique salvar.</li>
          <li><strong>Configure o webhook na Meta:</strong> copie a URL mostrada na aba Credenciais, va em App Dashboard {'>'} WhatsApp {'>'} Configuration {'>'} Webhook, cole a URL + o mesmo Verify Token, subscribe os campos <code>messages</code>.</li>
          <li><strong>Sincronize numeros + templates</strong> nas abas correspondentes.</li>
          <li><strong>Crie templates aprovados</strong> antes de mandar mensagens fora da janela 24h. Aprovacao Meta demora 1-24h.</li>
          <li><strong>Adicione metodo de pagamento</strong> em Business Manager {'>'} Billing (Meta cobra por mensagem entregue fora da janela 24h).</li>
        </ol>
      </div>

      <div className="card">
        <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
          <Tag className="w-5 h-5" /> Categorias Meta — regras + exemplos
        </h3>
        <p className="text-xs text-slate-500 mb-4">
          Cada template Meta pertence a UMA categoria. A categoria determina o preco e as regras do que pode/nao pode ser enviado.
          Mensagens fora da regra resultam em rejeicao do template ou queda de quality rating.
        </p>
        <div className="space-y-4">
          {categories.map(c => {
            const col = META_CATEGORY_COLORS[c.key] || META_CATEGORY_COLORS.UTILITY;
            return (
              <div key={c.key} className={`border-l-4 ${col.border} ${col.bg} rounded-r-lg p-4`}>
                <div className="flex items-center justify-between mb-2">
                  <h4 className={`font-bold ${col.text}`}>{c.label}</h4>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-500">Preco: {c.price_tier}</span>
                    {c.allowed
                      ? <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">LIBERADO</span>
                      : <span className="text-[10px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded">BLOQUEADO PELO SUPER ADMIN</span>}
                  </div>
                </div>
                <p className="text-xs text-slate-700 mb-3">{c.description}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="font-semibold text-slate-700 mb-1 flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-emerald-600" /> Regras</p>
                    <ul className="list-disc list-inside text-slate-600 space-y-0.5">{c.rules.map((r, i) => <li key={i}>{r}</li>)}</ul>
                  </div>
                  <div>
                    <p className="font-semibold text-emerald-700 mb-1">Exemplos OK</p>
                    {c.examples_good.map((e, i) => (
                      <pre key={i} className="bg-white border border-emerald-200 rounded p-2 mb-1 whitespace-pre-wrap text-[11px]">{e}</pre>
                    ))}
                    {c.examples_bad?.length > 0 && (
                      <>
                        <p className="font-semibold text-red-700 mb-1 mt-2">Exemplos a EVITAR</p>
                        {c.examples_bad.map((e, i) => (
                          <pre key={i} className="bg-white border border-red-200 rounded p-2 mb-1 whitespace-pre-wrap text-[11px] text-red-800">{e}</pre>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default MetaCloudAPIPage;
