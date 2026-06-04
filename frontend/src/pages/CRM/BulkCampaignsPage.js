/**
 * Bulk Campaigns — fila persistente pra 20k+ mensagens com
 * rotacao multi-conexao + spintax + janela horaria + opt-out.
 *
 * 2026-02-28 — Substitui a UI antiga de Campanhas para uso massivo.
 */
import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { channelsAPI } from '../../services/api';
import { toast } from 'sonner';
import {
  Send, Plus, Play, Pause, Square, Upload, RefreshCw, X, Save,
  Users, Activity, AlertCircle, CheckCircle2, ShieldOff, Clock,
  ChevronLeft, ChevronRight, Trash2,
} from 'lucide-react';

const STATUS_BADGE = {
  draft:     'bg-slate-100 text-slate-700',
  running:   'bg-emerald-100 text-emerald-700',
  paused:    'bg-amber-100 text-amber-700',
  cancelled: 'bg-red-100 text-red-700',
  completed: 'bg-blue-100 text-blue-700',
};

const REC_STATUS_BADGE = {
  pending:   'bg-slate-100 text-slate-600',
  sent:      'bg-emerald-100 text-emerald-700',
  failed:    'bg-red-100 text-red-700',
  opted_out: 'bg-amber-100 text-amber-700',
};

const BulkCampaignsPage = () => {
  const [jobs, setJobs] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/bulk/jobs');
      setJobs(r.data || []);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 10000);  // auto-refresh every 10s
    return () => clearInterval(t);
  }, [load]);

  if (selected) {
    return <JobDetail jobId={selected} onBack={() => setSelected(null)} reload={load} />;
  }

  return (
    <div className="animate-fade-in" data-testid="bulk-campaigns-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 font-heading flex items-center gap-2">
            <Send className="w-6 h-6 text-emerald-600" />
            Disparo em Massa
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Fila persistente, rotacao multi-conexao, spintax e opt-out automatico — pronto para 20k+ destinatarios.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="btn-secondary text-sm flex items-center gap-2"><RefreshCw className="w-4 h-4" /> Atualizar</button>
          <button onClick={() => setShowCreate(true)} className="btn-primary text-sm flex items-center gap-2" data-testid="bulk-new-job">
            <Plus className="w-4 h-4" /> Novo Disparo
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {jobs.length === 0 && (
          <div className="card text-center py-12 text-slate-400">
            <Send className="w-12 h-12 mx-auto mb-2 text-slate-300" />
            <p className="text-sm">Nenhum disparo ainda. Crie o primeiro!</p>
          </div>
        )}
        {jobs.map(j => (
          <JobCard key={j.id} job={j} onClick={() => setSelected(j.id)} />
        ))}
      </div>

      {showCreate && (
        <CreateJobModal onClose={() => setShowCreate(false)} onSaved={(id) => { setShowCreate(false); setSelected(id); load(); }} />
      )}
    </div>
  );
};

const JobCard = ({ job, onClick }) => {
  const pct = job.audience_size > 0
    ? Math.round(((job.sent_count + job.failed_count + job.opted_out_count) / job.audience_size) * 100)
    : 0;
  return (
    <div className="card cursor-pointer hover:shadow-md transition" onClick={onClick} data-testid={`bulk-job-${job.id}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-slate-900">{job.name}</h3>
          <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${STATUS_BADGE[job.status] || 'bg-slate-100'}`}>
            {job.status.toUpperCase()}
          </span>
        </div>
        <span className="text-xs text-slate-400">{new Date(job.created_at).toLocaleString()}</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
        <Stat label="Audiencia"  value={job.audience_size} icon={Users} />
        <Stat label="Enviadas"   value={job.sent_count}      icon={CheckCircle2} color="text-emerald-600" />
        <Stat label="Falhas"     value={job.failed_count}    icon={AlertCircle}  color="text-red-500" />
        <Stat label="Opt-outs"   value={job.opted_out_count} icon={ShieldOff}    color="text-amber-600" />
        <Stat label="Conexoes"   value={(job.connection_ids || []).length} icon={Activity} />
      </div>
      <div className="mt-3">
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-[10px] text-slate-400 mt-1">{pct}% processado</p>
      </div>
    </div>
  );
};

const Stat = ({ label, value, icon: Ic, color = 'text-slate-600' }) => (
  <div className="flex items-center gap-2">
    <Ic className={`w-3.5 h-3.5 ${color}`} />
    <div>
      <p className="text-[10px] uppercase text-slate-400 leading-tight">{label}</p>
      <p className={`font-bold text-sm ${color}`}>{value || 0}</p>
    </div>
  </div>
);

/* ─────────── Create modal ─────────── */
const CreateJobModal = ({ onClose, onSaved }) => {
  const [step, setStep] = useState(1);
  const [connections, setConnections] = useState([]);
  const [form, setForm] = useState({
    name: '',
    message_template: 'Ola {{nome}}! {Confira nossa oferta|Nao perca essa promo} e fale comigo.',
    connection_ids: [],
    interval_min_sec: 8,
    interval_max_sec: 25,
    window: { enabled: true, start: '09:00', end: '18:00', days_of_week: [0, 1, 2, 3, 4, 5] },
    opt_out_keywords: ['PARAR', 'SAIR', 'DESCADASTRAR'],
    daily_cap_per_connection: 800,
  });
  const [recipientsRaw, setRecipientsRaw] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    channelsAPI.listConnections().then(r => setConnections((r.data || []).filter(c => c.status === 'connected' || c.provider === 'whatsapp_cloud'))).catch(() => {});
  }, []);

  const toggleConn = (id) => setForm(f => ({ ...f, connection_ids: f.connection_ids.includes(id) ? f.connection_ids.filter(x => x !== id) : [...f.connection_ids, id] }));
  const toggleDow = (d) => setForm(f => ({ ...f, window: { ...f.window, days_of_week: f.window.days_of_week.includes(d) ? f.window.days_of_week.filter(x => x !== d) : [...f.window.days_of_week, d] } }));

  const parseRecipients = () => {
    const lines = recipientsRaw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    return lines.map(line => {
      const [phone, ...rest] = line.split(/[,;\t]/).map(p => p.trim());
      const name = rest.join(' ').trim();
      return { phone, name };
    }).filter(r => r.phone);
  };

  const save = async () => {
    if (!form.name) { toast.error('Defina um nome'); return; }
    if (!form.message_template) { toast.error('Mensagem vazia'); return; }
    if (form.connection_ids.length === 0) { toast.error('Selecione ao menos 1 conexao'); return; }
    const recipients = parseRecipients();
    if (recipients.length === 0) { toast.error('Cole pelo menos 1 telefone'); return; }
    setSaving(true);
    try {
      const job = await api.post('/bulk/jobs', form);
      const jobId = job.data.id;
      // Upload in chunks of 500
      const CHUNK = 500;
      for (let i = 0; i < recipients.length; i += CHUNK) {
        await api.post(`/bulk/jobs/${jobId}/recipients`, recipients.slice(i, i + CHUNK));
      }
      await api.post(`/bulk/jobs/${jobId}/action`, { action: 'start' });
      toast.success(`Disparo iniciado com ${recipients.length} destinatarios!`);
      onSaved(jobId);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao criar disparo');
    } finally { setSaving(false); }
  };

  const DOW_LABELS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom'];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-xl max-w-3xl w-full max-h-[92vh] overflow-y-auto" data-testid="bulk-create-modal">
        <div className="p-5 border-b flex items-center justify-between">
          <h3 className="font-bold text-lg">Novo Disparo em Massa — Etapa {step} de 3</h3>
          <button onClick={onClose}><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          {step === 1 && (
            <>
              <Field label="Nome interno" value={form.name} onChange={v => setForm({ ...form, name: v })} testid="bulk-form-name" />
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Mensagem (suporta spintax e variaveis)</label>
                <textarea value={form.message_template} onChange={e => setForm({ ...form, message_template: e.target.value })} rows={5}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
                  data-testid="bulk-form-message" />
                <div className="mt-2 text-[11px] text-slate-500 bg-slate-50 rounded p-2 space-y-1">
                  <p><strong>Variaveis:</strong> {'{{nome}}'}, {'{{telefone}}'}, {'{{numero}}'} ou customizadas (key=valor por destinatario)</p>
                  <p><strong>Spintax:</strong> {'{Ola|Oi|Boa noite}'} — cada envio sorteia uma variacao (quebra deduplicacao do WhatsApp)</p>
                  <p><strong>Exemplo:</strong> <code>{'{Ola|Oi} {{nome}}, {confira|veja} nossa oferta!'}</code></p>
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-2">
                  Conexoes WhatsApp para rotacionar ({form.connection_ids.length} selecionadas)
                </label>
                <p className="text-[11px] text-slate-500 mb-2">Quanto mais conexoes, menor o risco de bloqueio. Distribuimos automaticamente.</p>
                <div className="space-y-1 max-h-48 overflow-y-auto border border-slate-200 rounded p-2">
                  {connections.length === 0 && <p className="text-xs text-slate-400">Nenhuma conexao ativa. Conecte um WhatsApp ou ative a API Oficial Meta.</p>}
                  {connections.map(c => (
                    <label key={c.id} className="flex items-center gap-2 p-2 hover:bg-slate-50 rounded cursor-pointer">
                      <input type="checkbox" checked={form.connection_ids.includes(c.id)} onChange={() => toggleConn(c.id)} data-testid={`bulk-conn-${c.id}`} />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{c.name}</p>
                        <p className="text-[10px] text-slate-400">{c.phone || '-'} · {c.provider === 'whatsapp_cloud' ? 'API Oficial Meta' : 'Baileys (QR)'}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Intervalo MIN entre envios (segundos)" type="number" value={form.interval_min_sec} onChange={v => setForm({ ...form, interval_min_sec: parseInt(v) || 1 })} />
                <Field label="Intervalo MAX entre envios (segundos)" type="number" value={form.interval_max_sec} onChange={v => setForm({ ...form, interval_max_sec: parseInt(v) || 1 })} />
              </div>
              <Field label="Limite diario por conexao" type="number" value={form.daily_cap_per_connection} onChange={v => setForm({ ...form, daily_cap_per_connection: parseInt(v) || 100 })} hint="Recomendado 600-1000 por numero. Acima disso, risco de bloqueio." />
              <div className="card bg-slate-50">
                <p className="text-xs font-medium text-slate-700 mb-2">Janela de envio</p>
                <div className="flex items-center gap-2 mb-2">
                  <input type="checkbox" checked={form.window.enabled} onChange={e => setForm({ ...form, window: { ...form.window, enabled: e.target.checked } })} />
                  <span className="text-xs">Habilitar janela horaria</span>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <input type="time" value={form.window.start} onChange={e => setForm({ ...form, window: { ...form.window, start: e.target.value } })} className="px-2 py-1 border rounded text-sm" data-testid="bulk-win-start" />
                  <input type="time" value={form.window.end} onChange={e => setForm({ ...form, window: { ...form.window, end: e.target.value } })} className="px-2 py-1 border rounded text-sm" data-testid="bulk-win-end" />
                </div>
                <div className="flex gap-1 flex-wrap">
                  {DOW_LABELS.map((lbl, idx) => (
                    <button key={lbl} type="button" onClick={() => toggleDow(idx)}
                      className={`text-[10px] px-2 py-1 rounded ${form.window.days_of_week.includes(idx) ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
              <Field label="Palavras-chave de Opt-out (separadas por virgula)" value={form.opt_out_keywords.join(', ')}
                onChange={v => setForm({ ...form, opt_out_keywords: v.split(',').map(s => s.trim()).filter(Boolean) })}
                hint="Cliente que enviar essa palavra entra no opt-out automatico — nunca mais recebe disparos." />
            </>
          )}

          {step === 3 && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Destinatarios (1 por linha)
                </label>
                <p className="text-[11px] text-slate-500 mb-2">
                  Formato: <code>telefone, nome</code>. Apenas digitos no telefone (com DDD e codigo do pais). Exemplo: <code>5511999990001, Alice</code>
                </p>
                <textarea value={recipientsRaw} onChange={e => setRecipientsRaw(e.target.value)} rows={10}
                  placeholder="5511999990001, Alice&#10;5511999990002, Bob&#10;5511999990003"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
                  data-testid="bulk-form-recipients" />
                <p className="text-[10px] text-slate-400 mt-1">
                  {recipientsRaw.split(/\r?\n/).filter(l => l.trim()).length} linhas
                </p>
              </div>
            </>
          )}
        </div>

        <div className="p-5 border-t flex justify-between gap-2">
          <button onClick={() => setStep(s => Math.max(1, s - 1))} disabled={step === 1} className="btn-secondary text-sm flex items-center gap-1">
            <ChevronLeft className="w-4 h-4" /> Voltar
          </button>
          {step < 3 ? (
            <button onClick={() => setStep(s => s + 1)} className="btn-primary text-sm flex items-center gap-1" data-testid="bulk-next">
              Proximo <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button onClick={save} disabled={saving} className="btn-primary text-sm flex items-center gap-1" data-testid="bulk-save">
              <Play className="w-4 h-4" /> {saving ? 'Iniciando...' : 'Iniciar Disparo'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const Field = ({ label, value, onChange, type = 'text', hint, testid }) => (
  <div>
    <label className="block text-xs font-medium text-slate-700 mb-1">{label}</label>
    <input type={type} value={value} onChange={e => onChange(e.target.value)} data-testid={testid}
      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500" />
    {hint && <p className="text-[10px] text-slate-400 mt-1">{hint}</p>}
  </div>
);

/* ─────────── Job detail ─────────── */
const JobDetail = ({ jobId, onBack, reload }) => {
  const [job, setJob] = useState(null);
  const [recipients, setRecipients] = useState([]);
  const [filter, setFilter] = useState('');
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/bulk/jobs/${jobId}`);
      setJob(r.data);
      const q = filter ? `?status=${filter}&limit=300` : '?limit=300';
      const rr = await api.get(`/bulk/jobs/${jobId}/recipients${q}`);
      setRecipients(rr.data || []);
    } catch { /* ignore */ }
  }, [jobId, filter]);
  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (action) => {
    setActing(true);
    try {
      await api.post(`/bulk/jobs/${jobId}/action`, { action });
      toast.success(`Acao '${action}' aplicada`);
      load();
      reload?.();
    } catch (e) { toast.error(e.response?.data?.detail || 'Erro'); }
    finally { setActing(false); }
  };

  if (!job) return <div className="text-sm text-slate-500">Carregando...</div>;
  const pct = job.audience_size > 0
    ? Math.round(((job.sent_count + job.failed_count + job.opted_out_count) / job.audience_size) * 100)
    : 0;

  return (
    <div className="animate-fade-in" data-testid="bulk-job-detail">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-3"><ChevronLeft className="w-4 h-4" /> Voltar</button>
      <div className="card mb-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="font-bold text-lg">{job.name}</h2>
            <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${STATUS_BADGE[job.status] || 'bg-slate-100'}`}>{job.status.toUpperCase()}</span>
          </div>
          <div className="flex items-center gap-2">
            {job.status === 'running' && <button onClick={() => act('pause')} disabled={acting} className="btn-secondary text-sm flex items-center gap-1" data-testid="bulk-pause"><Pause className="w-4 h-4" /> Pausar</button>}
            {job.status === 'paused'  && <button onClick={() => act('resume')} disabled={acting} className="btn-primary text-sm flex items-center gap-1" data-testid="bulk-resume"><Play className="w-4 h-4" /> Retomar</button>}
            {['draft', 'running', 'paused'].includes(job.status) && (
              <button onClick={() => { if (window.confirm('Cancelar este disparo? Nao podera ser retomado.')) act('cancel'); }} disabled={acting} className="text-red-600 hover:bg-red-50 text-sm flex items-center gap-1 px-3 py-1.5 rounded" data-testid="bulk-cancel"><Square className="w-4 h-4" /> Cancelar</button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs mb-3">
          <Stat label="Audiencia"  value={job.audience_size}    icon={Users} />
          <Stat label="Enviadas"   value={job.sent_count}        icon={CheckCircle2} color="text-emerald-600" />
          <Stat label="Falhas"     value={job.failed_count}      icon={AlertCircle}  color="text-red-500" />
          <Stat label="Opt-outs"   value={job.opted_out_count}   icon={ShieldOff}    color="text-amber-600" />
          <Stat label="Restantes"  value={Math.max(0, job.audience_size - job.sent_count - job.failed_count - job.opted_out_count)} icon={Clock} />
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-[10px] text-slate-400 mt-1">{pct}% processado · {job.last_tick_at ? `Ultimo tick: ${new Date(job.last_tick_at).toLocaleString()}` : 'Aguardando primeiro tick'}</p>
      </div>

      {/* Per-connection breakdown */}
      <div className="card mb-4">
        <h3 className="font-semibold text-sm mb-2">Distribuicao por conexao</h3>
        {Object.entries(job.connection_breakdown || {}).map(([conn, byStatus]) => (
          <div key={conn} className="flex items-center gap-2 text-xs py-1 border-b last:border-0">
            <code className="text-[10px] text-slate-400 flex-shrink-0">{conn.substring(0, 8)}</code>
            <div className="flex gap-1 flex-wrap">
              {Object.entries(byStatus).map(([s, c]) => (
                <span key={s} className={`px-2 py-0.5 rounded text-[10px] ${REC_STATUS_BADGE[s] || 'bg-slate-100'}`}>{s}: {c}</span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Recipients */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">Destinatarios</h3>
          <div className="flex gap-1">
            {['', 'pending', 'sent', 'failed', 'opted_out'].map(s => (
              <button key={s || 'all'} onClick={() => setFilter(s)} data-testid={`bulk-filter-${s || 'all'}`}
                className={`text-[10px] px-2 py-1 rounded ${filter === s ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                {s || 'Todos'}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {recipients.map(r => (
            <div key={r.id} className="flex items-center gap-2 text-xs py-1 border-b last:border-0">
              <code className="text-slate-500 w-32">{r.phone}</code>
              <span className="flex-1 truncate">{r.name || '-'}</span>
              <span className={`text-[10px] px-2 py-0.5 rounded ${REC_STATUS_BADGE[r.status] || 'bg-slate-100'}`}>{r.status}</span>
              {r.error && <span className="text-[10px] text-red-500 truncate max-w-xs" title={r.error}>{r.error}</span>}
            </div>
          ))}
          {recipients.length === 0 && <p className="text-xs text-slate-400 text-center py-4">Nenhum destinatario {filter ? `com status "${filter}"` : ''}.</p>}
        </div>
      </div>
    </div>
  );
};

export default BulkCampaignsPage;
