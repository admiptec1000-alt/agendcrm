import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plug, RefreshCw, Save, ShieldBan, CheckCircle2, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import api from '../../services/api';

const fmtDt = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');

export const Integration8ipCard = ({ onSynced }) => {
  const [s, setS] = useState(null);
  const [form, setForm] = useState({ base_url: '', api_key: '', enabled: false, sync_interval_hours: 6, auto_block_enabled: false, auto_block_days: 7 });
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState('');
  const [testRes, setTestRes] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/super-admin/integrations/8ip/settings');
      setS(data);
      setForm(f => ({ ...f, base_url: data.base_url || '', enabled: !!data.enabled, sync_interval_hours: data.sync_interval_hours || 6,
        auto_block_enabled: !!data.auto_block_enabled, auto_block_days: data.auto_block_days ?? 7, api_key: '' }));
    } catch { toast.error('Erro ao carregar integração 8IP'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setBusy('save');
    try {
      const payload = { ...form };
      if (!payload.api_key) delete payload.api_key;
      const { data } = await api.put('/super-admin/integrations/8ip/settings', payload);
      setS(data); setForm(f => ({ ...f, api_key: '' }));
      toast.success('Integração 8IP salva');
    } catch (e) { toast.error(e.response?.data?.detail || 'Falha ao salvar'); }
    finally { setBusy(''); }
  };

  const test = async () => {
    setBusy('test'); setTestRes(null);
    try {
      if (form.api_key || form.base_url !== (s?.base_url || '')) await save();
      const { data } = await api.post('/super-admin/integrations/8ip/test');
      setTestRes(data);
      toast.success(`Conexão OK — ${data.total} empresa(s) no 8IP`);
    } catch (e) { toast.error(e.response?.data?.detail || 'Falha ao testar conexão'); }
    finally { setBusy(''); }
  };

  const sync = async () => {
    setBusy('sync');
    try {
      const { data } = await api.post('/super-admin/integrations/8ip/sync');
      toast.success(`Sincronizado: ${data.created} nova(s), ${data.updated} atualizada(s), ${data.deactivated} desativada(s)`);
      await load(); onSynced && onSynced();
    } catch (e) { toast.error(e.response?.data?.detail || 'Falha ao sincronizar'); }
    finally { setBusy(''); }
  };

  const last = s?.last_sync_result;
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3" data-testid="integration-8ip-card">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-violet-600 text-white flex items-center justify-center"><Plug className="w-4 h-4" /></span>
          <div>
            <p className="font-semibold text-slate-900 text-sm">Integração 8IP Admin</p>
            <p className="text-[11px] text-slate-500">Importa as empresas e o valor da Mensalidade do app.8ip.com.br e gera a cobrança aqui automaticamente.</p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer" data-testid="8ip-enabled-toggle">
          <input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} className="w-4 h-4 accent-violet-600" />
          <span className={form.enabled ? 'text-emerald-700 font-medium' : 'text-slate-500'}>{form.enabled ? 'Ativa' : 'Desativada'}</span>
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
        <div className="md:col-span-5">
          <label className="text-[11px] uppercase tracking-wide text-slate-500">URL do 8IP Admin</label>
          <input data-testid="8ip-base-url" value={form.base_url} onChange={e => setForm({ ...form, base_url: e.target.value })}
            placeholder="https://app.8ip.com.br" className="w-full mt-1 px-3 py-2 text-sm border border-slate-200 rounded-lg" />
        </div>
        <div className="md:col-span-4">
          <label className="text-[11px] uppercase tracking-wide text-slate-500">Chave de integração {s?.has_api_key && <span className="text-emerald-600 normal-case">(salva: {s.api_key_masked})</span>}</label>
          <div className="relative mt-1">
            <input data-testid="8ip-api-key" type={showKey ? 'text' : 'password'} value={form.api_key} onChange={e => setForm({ ...form, api_key: e.target.value })}
              placeholder={s?.has_api_key ? 'Deixe vazio para manter' : 'Cole a BILLING_INTEGRATION_KEY'} className="w-full px-3 py-2 pr-9 text-sm border border-slate-200 rounded-lg" />
            <button type="button" onClick={() => setShowKey(v => !v)} className="absolute right-2 top-2 text-slate-400">{showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
          </div>
        </div>
        <div className="md:col-span-3">
          <label className="text-[11px] uppercase tracking-wide text-slate-500">Sincronizar a cada (h)</label>
          <input data-testid="8ip-interval" type="number" min={1} max={168} value={form.sync_interval_hours} onChange={e => setForm({ ...form, sync_interval_hours: Number(e.target.value) })}
            className="w-full mt-1 px-3 py-2 text-sm border border-slate-200 rounded-lg" />
        </div>
      </div>

      <div className="flex items-center gap-4 flex-wrap text-sm">
        <label className="flex items-center gap-2 cursor-pointer" data-testid="8ip-autoblock-toggle">
          <input type="checkbox" checked={form.auto_block_enabled} onChange={e => setForm({ ...form, auto_block_enabled: e.target.checked })} className="w-4 h-4 accent-red-600" />
          <ShieldBan className="w-4 h-4 text-red-500" /> Bloquear empresa no 8IP automaticamente após
        </label>
        <input data-testid="8ip-autoblock-days" type="number" min={0} max={90} value={form.auto_block_days} onChange={e => setForm({ ...form, auto_block_days: Number(e.target.value) })}
          className="w-16 px-2 py-1 text-sm border border-slate-200 rounded-lg" disabled={!form.auto_block_enabled} />
        <span className="text-slate-500">dias de atraso (desbloqueia sozinho ao quitar)</span>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2 pt-1 border-t border-slate-100">
        <div className="text-[11px] text-slate-500 flex items-center gap-2">
          {last ? (last.ok
            ? <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Última sync {fmtDt(s.last_sync_at)}: {last.total} empresas · {last.created} novas · {last.updated} atualizadas · {last.deactivated} desativadas</>
            : <><AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> Última sync {fmtDt(s.last_sync_at)} falhou: {last.error}</>)
            : 'Nenhuma sincronização ainda'}
        </div>
        <div className="flex items-center gap-2">
          <button data-testid="8ip-test-btn" onClick={test} disabled={!!busy} className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 hover:bg-slate-50 flex items-center gap-1.5 disabled:opacity-50">
            <Plug className="w-3.5 h-3.5" /> {busy === 'test' ? 'Testando…' : 'Testar conexão'}
          </button>
          <button data-testid="8ip-save-btn" onClick={save} disabled={!!busy} className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 hover:bg-slate-50 flex items-center gap-1.5 disabled:opacity-50">
            <Save className="w-3.5 h-3.5" /> Salvar
          </button>
          <button data-testid="8ip-sync-btn" onClick={sync} disabled={!!busy || !s?.has_api_key} className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${busy === 'sync' ? 'animate-spin' : ''}`} /> Sincronizar agora
          </button>
        </div>
      </div>

      {testRes && (
        <div className="text-xs bg-slate-50 rounded-lg p-2 border border-slate-100" data-testid="8ip-test-result">
          <p className="font-medium text-slate-700 mb-1">Amostra ({testRes.total} no total):</p>
          <ul className="space-y-0.5">
            {testRes.sample.map(t => (
              <li key={t.external_id} className="flex justify-between gap-2 text-slate-600">
                <span className="truncate">{t.name} {t.plan_name ? `· ${t.plan_name}` : ''} {!t.is_active && <span className="text-red-500">(inativa)</span>}</span>
                <span className="whitespace-nowrap">R$ {Number(t.monthly_price || 0).toFixed(2).replace('.', ',')} · dia {t.billing_day} · {t.phone || 'sem telefone'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default Integration8ipCard;
