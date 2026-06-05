import React, { useState, useEffect, useCallback } from 'react';
import { crmAPI, channelsAPI } from '../../services/api';
import api from '../../services/api';
import { toast } from 'sonner';
import {
  Plus, Pencil, Trash2, X, Search, Send, Eye, Rocket,
  Megaphone, Tag as TagIcon, Users, MessageSquare, FileText, Calendar,
  Pause, Play, Square, CheckCircle2, AlertCircle, ShieldOff, Clock,
  ChevronLeft, ChevronRight, Activity, RefreshCw,
} from 'lucide-react';

const STATUS_LABEL = {
  draft: { label: 'Rascunho', bg: 'bg-slate-100', text: 'text-slate-600' },
  programada: { label: 'Programada', bg: 'bg-blue-100', text: 'text-blue-700' },
  em_execucao: { label: 'Em execucao', bg: 'bg-amber-100', text: 'text-amber-700' },
  concluida: { label: 'Concluida', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  cancelada: { label: 'Cancelada', bg: 'bg-red-100', text: 'text-red-700' },
};

const fmtDateTime = (iso) => {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const CampaignsPage = () => {
  const [tab, setTab] = useState('listagem'); // listagem | listas | params | disparos
  const [campaigns, setCampaigns] = useState([]);
  const [search, setSearch] = useState('');
  const [showCampModal, setShowCampModal] = useState(false);
  const [editingCamp, setEditingCamp] = useState(null);
  const [previewing, setPreviewing] = useState(null);
  const [audienceData, setAudienceData] = useState(null);
  // 2026-02-28 — Disparo em massa: modal de boot + tab de monitoramento.
  const [bulkLaunchFor, setBulkLaunchFor] = useState(null);

  const reload = async () => {
    try { const r = await crmAPI.getCampaigns(); setCampaigns(r.data); } catch (e) {}
  };
  useEffect(() => { reload(); }, []);

  const filtered = campaigns.filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()));

  const handleEdit = (c) => { setEditingCamp(c); setShowCampModal(true); };
  const handleNew = () => { setEditingCamp(null); setShowCampModal(true); };

  const handleDelete = async (c) => {
    if (!window.confirm(`Excluir campanha "${c.name}"?`)) return;
    try { await crmAPI.deleteCampaign(c.id); toast.success('Removida'); reload(); }
    catch (e) { toast.error('Erro'); }
  };

  const handlePreview = async (c) => {
    setPreviewing(c); setAudienceData(null);
    try {
      const r = await crmAPI.previewCampaignAudience(c.id);
      setAudienceData(r.data);
    } catch (e) { toast.error('Erro ao calcular audiencia'); }
  };

  const handleRun = async (c) => {
    if (!window.confirm(`Executar campanha "${c.name}" agora?`)) return;
    try {
      const r = await crmAPI.runCampaign(c.id);
      toast.success(`${r.data.sent} enviadas, ${r.data.failed} falhas`);
      reload();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Erro ao executar'); }
  };

  return (
    <div className="animate-fade-in" data-testid="campaigns-page">
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div>
          <h2 className="text-lg font-bold font-page-title">Campanhas</h2>
          <p className="text-xs text-slate-500">Envie mensagens em massa para listas, tags ou todos os contatos.</p>
        </div>
        <button onClick={handleNew} className="btn-primary text-sm flex items-center gap-1.5" data-testid="new-campaign-btn">
          <Plus className="w-4 h-4" /> Nova Campanha
        </button>
      </div>

      <div className="flex gap-1 mb-4 border-b border-slate-200">
        <TabBtn active={tab === 'listagem'} onClick={() => setTab('listagem')} label="Listagem" testId="tab-listagem" />
        <TabBtn active={tab === 'listas'} onClick={() => setTab('listas')} label="Listas de Contato" testId="tab-listas" />
        <TabBtn active={tab === 'disparos'} onClick={() => setTab('disparos')} label="Disparos em Massa" testId="tab-disparos" />
        <TabBtn active={tab === 'params'} onClick={() => setTab('params')} label="Parametros" testId="tab-params-page" />
      </div>

      {tab === 'listagem' && (
        <>
          <div className="mb-3 relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Pesquisa"
              className="input-field text-sm w-full pl-9"
              data-testid="campaigns-search"
            />
          </div>

          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left text-[10px] uppercase tracking-widest text-slate-500">
                  <th className="px-4 py-2.5">Nome</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Lista de Contatos</th>
                  <th className="px-4 py-2.5">Conexao</th>
                  <th className="px-4 py-2.5">Agendamento</th>
                  <th className="px-4 py-2.5">Concluida</th>
                  <th className="px-4 py-2.5">Confirmacao</th>
                  <th className="px-4 py-2.5 text-right">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-10 text-slate-400 text-sm">Nenhuma campanha</td></tr>
                ) : filtered.map(c => {
                  const st = STATUS_LABEL[c.status] || STATUS_LABEL.draft;
                  return (
                    <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50/50" data-testid={`campaign-row-${c.id}`}>
                      <td className="px-4 py-2.5 font-medium text-slate-900">{c.name}</td>
                      <td className="px-4 py-2.5"><span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${st.bg} ${st.text}`}>{st.label}</span></td>
                      <td className="px-4 py-2.5 text-slate-600">{c.contact_list_name || (c.audience_mode === 'tags' ? 'Por Tags' : c.audience_mode === 'no_tag' ? 'Sem Tag' : c.audience_mode === 'all' ? 'Todos' : '-')}</td>
                      <td className="px-4 py-2.5 text-slate-600">{c.connection_name || '-'}</td>
                      <td className="px-4 py-2.5 text-slate-600">{fmtDateTime(c.scheduled_at)}</td>
                      <td className="px-4 py-2.5 text-slate-600">{c.status === 'concluida' ? `${c.sent_count || 0} envios` : 'Nao concluida'}</td>
                      <td className="px-4 py-2.5 text-slate-600">{c.confirmation_enabled ? 'Habilitada' : 'Desabilitada'}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-0.5">
                          <button onClick={() => handlePreview(c)} className="p-1.5 rounded hover:bg-slate-100" title="Audiencia"><Eye className="w-3.5 h-3.5" /></button>
                          <button onClick={() => handleRun(c)} className="p-1.5 rounded hover:bg-emerald-100 text-emerald-700" title="Enviar agora (modo classico)" data-testid={`run-campaign-${c.id}`}><Send className="w-3.5 h-3.5" /></button>
                          <button onClick={() => setBulkLaunchFor(c)} className="p-1.5 rounded hover:bg-violet-100 text-violet-700" title="Disparo em massa (multi-conexao, spintax, janela, opt-out)" data-testid={`bulk-launch-${c.id}`}><Rocket className="w-3.5 h-3.5" /></button>
                          <button onClick={() => handleEdit(c)} className="p-1.5 rounded hover:bg-slate-100" title="Editar"><Pencil className="w-3.5 h-3.5" /></button>
                          <button onClick={() => handleDelete(c)} className="p-1.5 rounded hover:bg-red-50 text-red-600" title="Excluir"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'listas' && <ContactListsTab />}
      {tab === 'disparos' && <BulkJobsTab />}
      {tab === 'params' && <AntiBlockSettingsTab />}

      {showCampModal && (
        <CampaignModal
          campaign={editingCamp}
          onClose={() => setShowCampModal(false)}
          onSaved={() => { setShowCampModal(false); reload(); }}
        />
      )}

      {previewing && (
        <AudienceModal
          campaign={previewing}
          data={audienceData}
          onClose={() => { setPreviewing(null); setAudienceData(null); }}
        />
      )}

      {bulkLaunchFor && (
        <BulkLaunchModal
          campaign={bulkLaunchFor}
          onClose={() => setBulkLaunchFor(null)}
          onLaunched={() => { setBulkLaunchFor(null); setTab('disparos'); toast.success('Disparo criado! Veja a aba "Disparos em Massa".'); }}
        />
      )}
    </div>
  );
};

const TabBtn = ({ active, onClick, label, testId }) => (
  <button
    onClick={onClick}
    data-testid={testId}
    className={`px-4 py-2 text-sm font-semibold relative ${active ? 'text-primary' : 'text-slate-500 hover:text-slate-700'}`}
  >
    {label}
    {active && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
  </button>
);

/* ============== CAMPAIGN MODAL ============== */
const CampaignModal = ({ campaign, onClose, onSaved }) => {
  const isEditing = !!campaign;
  const [form, setForm] = useState({
    name: campaign?.name || '',
    confirmation_enabled: campaign?.confirmation_enabled || false,
    audience_mode: campaign?.audience_mode || 'all',
    contact_list_id: campaign?.contact_list_id || '',
    tag_ids: campaign?.tag_ids || [],
    connection_id: campaign?.connection_id || '',
    scheduled_at: campaign?.scheduled_at ? new Date(campaign.scheduled_at).toISOString().slice(0,16) : '',
    open_ticket: campaign?.open_ticket || false,
    assigned_user_id: campaign?.assigned_user_id || '',
    queue_id: campaign?.queue_id || '',
    ticket_status: campaign?.ticket_status || 'fechado',
    messages: campaign?.messages?.length ? campaign.messages : ['', '', '', '', ''],
    attachment_url: campaign?.attachment_url || '',
    // 2026-02-28 — Modo Disparo em Massa: parametros extras para 20k+
    bulk_config: campaign?.bulk_config || {
      enabled: false,
      connection_ids: [],
      interval_min_sec: 8,
      interval_max_sec: 25,
      daily_cap_per_connection: 800,
      opt_out_keywords: ['PARAR', 'SAIR', 'DESCADASTRAR'],
      window_enabled: true,
      window_start: '09:00',
      window_end: '18:00',
      window_days: [0, 1, 2, 3, 4, 5],
    },
  });
  const [activeMsg, setActiveMsg] = useState(0);
  const [tags, setTags] = useState([]);
  const [conns, setConns] = useState([]);
  const [lists, setLists] = useState([]);
  const [queues, setQueues] = useState([]);

  useEffect(() => {
    Promise.all([
      crmAPI.listTags(), channelsAPI.getConnections(), crmAPI.listContactLists(), crmAPI.listQueues()
    ]).then(([t, c, l, q]) => {
      setTags(t.data); setConns(c.data); setLists(l.data); setQueues(q.data);
    }).catch(() => {});
  }, []);

  const setMsg = (idx, text) => {
    const msgs = [...form.messages];
    msgs[idx] = text;
    setForm({ ...form, messages: msgs });
  };

  const toggleTag = (tagId) => {
    const exists = form.tag_ids.includes(tagId);
    setForm({ ...form, tag_ids: exists ? form.tag_ids.filter(t => t !== tagId) : [...form.tag_ids, tagId] });
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error('Nome obrigatorio'); return; }
    const cleanMessages = form.messages.filter(m => m && m.trim());
    if (cleanMessages.length === 0) { toast.error('Adicione pelo menos uma mensagem'); return; }
    const payload = {
      name: form.name,
      audience_mode: form.audience_mode,
      tag_ids: form.audience_mode === 'tags' ? form.tag_ids : [],
      contact_list_id: form.audience_mode === 'list' ? (form.contact_list_id || null) : null,
      connection_id: form.connection_id || null,
      scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null,
      confirmation_enabled: form.confirmation_enabled,
      open_ticket: form.open_ticket,
      assigned_user_id: form.assigned_user_id || null,
      queue_id: form.queue_id || null,
      ticket_status: form.ticket_status,
      messages: cleanMessages,
      attachment_url: form.attachment_url || null,
      bulk_config: form.bulk_config,
    };
    try {
      if (isEditing) await crmAPI.updateCampaign(campaign.id, payload);
      else await crmAPI.createCampaign(payload);
      toast.success(isEditing ? 'Atualizada' : 'Criada');
      onSaved();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Erro'); }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-start justify-center p-4 overflow-y-auto" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl my-8" onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h3 className="text-lg font-bold flex items-center gap-2"><Megaphone className="w-5 h-5 text-primary" /> {isEditing ? 'Editar' : 'Nova'} Campanha</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-1">
              <label className="text-[10px] font-bold uppercase text-slate-400">Nome</label>
              <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="input-field w-full text-sm" data-testid="camp-name" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-400">Confirmacao</label>
              <select value={form.confirmation_enabled ? 'on' : 'off'} onChange={e => setForm({...form, confirmation_enabled: e.target.value === 'on'})} className="input-field w-full text-sm">
                <option value="off">Desabilitada</option>
                <option value="on">Habilitada</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-400">Audiencia</label>
              <select value={form.audience_mode} onChange={e => setForm({...form, audience_mode: e.target.value})} className="input-field w-full text-sm" data-testid="camp-audience-mode">
                <option value="all">Todos os Contatos</option>
                <option value="tags">Por Tags</option>
                <option value="no_tag">Sem Tag</option>
                <option value="list">Lista de Contato</option>
              </select>
            </div>
          </div>

          {form.audience_mode === 'tags' && (
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-400 flex items-center gap-1"><TagIcon className="w-3 h-3" /> Tags (selecione)</label>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {tags.length === 0 && <span className="text-xs text-slate-400">Nenhuma tag cadastrada</span>}
                {tags.map(t => {
                  const sel = form.tag_ids.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      onClick={() => toggleTag(t.id)}
                      className="text-[11px] px-2.5 py-1 rounded-full font-medium transition-all"
                      style={sel ? { background: t.color, color: 'white' } : { background: `${t.color}22`, color: t.color }}
                      data-testid={`camp-tag-${t.name}`}
                    >
                      {sel && '✓ '}{t.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {form.audience_mode === 'list' && (
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-400 flex items-center gap-1"><Users className="w-3 h-3" /> Lista de Contato</label>
              <select value={form.contact_list_id} onChange={e => setForm({...form, contact_list_id: e.target.value})} className="input-field w-full text-sm" data-testid="camp-list">
                <option value="">Selecione...</option>
                {lists.map(l => <option key={l.id} value={l.id}>{l.name} ({l.count || 0})</option>)}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-400">Conexao WhatsApp</label>
              <select value={form.connection_id} onChange={e => setForm({...form, connection_id: e.target.value})} className="input-field w-full text-sm" data-testid="camp-connection">
                <option value="">Auto (primeira conectada)</option>
                {conns.filter(c => c.type === 'whatsapp').map(c => <option key={c.id} value={c.id}>{c.name} {c.status === 'connected' ? '(conectada)' : ''}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-400 flex items-center gap-1"><Calendar className="w-3 h-3" /> Agendamento</label>
              <input type="datetime-local" value={form.scheduled_at} onChange={e => setForm({...form, scheduled_at: e.target.value})} className="input-field w-full text-sm" data-testid="camp-scheduled" />
            </div>
          </div>

          <div className="border-t border-slate-200 pt-4">
            <p className="text-[11px] font-semibold text-slate-700 mb-2">Atendimento (opcional)</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400">Abrir ticket</label>
                <select value={form.open_ticket ? 'on' : 'off'} onChange={e => setForm({...form, open_ticket: e.target.value === 'on'})} className="input-field w-full text-sm">
                  <option value="off">Desabilitado</option>
                  <option value="on">Habilitado</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400">Transferir para fila</label>
                <select value={form.queue_id} onChange={e => setForm({...form, queue_id: e.target.value})} className="input-field w-full text-sm" disabled={!form.open_ticket}>
                  <option value="">Sem fila</option>
                  {queues.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400">Status do Ticket</label>
                <select value={form.ticket_status} onChange={e => setForm({...form, ticket_status: e.target.value})} className="input-field w-full text-sm" disabled={!form.open_ticket}>
                  <option value="fechado">Fechado</option>
                  <option value="aberto">Aberto</option>
                  <option value="proposta">Proposta</option>
                </select>
              </div>
            </div>
          </div>

          </>

          {/* ═══ MODO DISPARO EM MASSA ═══ */}
          <div className="border-t border-slate-200 pt-4">
            <label className="flex items-start gap-2 p-3 rounded-lg border-2 cursor-pointer transition-colors"
              style={{ borderColor: form.bulk_config.enabled ? '#7c3aed' : '#e2e8f0', background: form.bulk_config.enabled ? '#faf5ff' : 'transparent' }}>
              <input
                type="checkbox"
                checked={form.bulk_config.enabled}
                onChange={e => setForm({ ...form, bulk_config: { ...form.bulk_config, enabled: e.target.checked } })}
                className="mt-1"
                data-testid="bulk-mode-toggle"
              />
              <div className="flex-1">
                <p className="text-sm font-bold flex items-center gap-1.5"><Rocket className="w-4 h-4 text-violet-600" /> Modo Disparo em Massa <span className="text-[10px] bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded">RECOMENDADO PARA 1k+</span></p>
                <p className="text-[11px] text-slate-500 leading-relaxed mt-0.5">
                  Ativa fila persistente com <strong>rotacao multi-conexao</strong> (Baileys + API Oficial Meta), <strong>spintax</strong> {'{a|b|c}'}, <strong>janela horaria</strong>, <strong>cap diario por numero</strong> e <strong>opt-out automatico</strong>. Quando clicar em "Enviar agora", vira um disparo monitorado.
                </p>
              </div>
            </label>

            {form.bulk_config.enabled && (
              <div className="mt-3 space-y-3 p-3 rounded-lg bg-violet-50/40 border border-violet-200" data-testid="bulk-config-section">
                <div>
                  <label className="text-[10px] font-bold uppercase text-violet-700">Conexoes para rotacionar (Baileys + Meta — quanto mais, mais seguro)</label>
                  <div className="mt-1 max-h-32 overflow-y-auto border border-violet-200 rounded p-2 space-y-1 bg-white">
                    {conns.filter(c => c.type === 'whatsapp').map(c => {
                      const checked = form.bulk_config.connection_ids.includes(c.id);
                      return (
                        <label key={c.id} className="flex items-center gap-2 p-1 hover:bg-violet-50 rounded cursor-pointer">
                          <input type="checkbox" checked={checked}
                            onChange={() => setForm({
                              ...form,
                              bulk_config: {
                                ...form.bulk_config,
                                connection_ids: checked
                                  ? form.bulk_config.connection_ids.filter(x => x !== c.id)
                                  : [...form.bulk_config.connection_ids, c.id]
                              }
                            })}
                            data-testid={`bulk-conn-${c.id}`} />
                          <div className="flex-1 text-xs">
                            <span className="font-medium">{c.name}</span>
                            <span className="ml-2 text-[10px] text-slate-400">
                              {c.phone || '-'} · {c.provider === 'whatsapp_cloud' ? '🛡 API Oficial Meta' : '📱 Baileys (QR)'}
                              {c.status === 'connected' || c.provider === 'whatsapp_cloud' ? ' · ativa' : ' · desconectada'}
                            </span>
                          </div>
                        </label>
                      );
                    })}
                    {conns.length === 0 && <p className="text-xs text-slate-400">Nenhuma conexao cadastrada.</p>}
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">{form.bulk_config.connection_ids.length} selecionada(s).</p>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] font-bold uppercase text-violet-700">Intervalo MIN (s)</label>
                    <input type="number" value={form.bulk_config.interval_min_sec}
                      onChange={e => setForm({ ...form, bulk_config: { ...form.bulk_config, interval_min_sec: parseInt(e.target.value) || 1 } })}
                      className="input-field w-full text-sm" data-testid="bulk-int-min" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase text-violet-700">Intervalo MAX (s)</label>
                    <input type="number" value={form.bulk_config.interval_max_sec}
                      onChange={e => setForm({ ...form, bulk_config: { ...form.bulk_config, interval_max_sec: parseInt(e.target.value) || 1 } })}
                      className="input-field w-full text-sm" data-testid="bulk-int-max" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase text-violet-700">Cap diario / numero</label>
                    <input type="number" value={form.bulk_config.daily_cap_per_connection}
                      onChange={e => setForm({ ...form, bulk_config: { ...form.bulk_config, daily_cap_per_connection: parseInt(e.target.value) || 100 } })}
                      className="input-field w-full text-sm" data-testid="bulk-cap" />
                  </div>
                </div>

                <div className="bg-white rounded p-2 border border-violet-200">
                  <label className="flex items-center gap-2 mb-2">
                    <input type="checkbox" checked={form.bulk_config.window_enabled}
                      onChange={e => setForm({ ...form, bulk_config: { ...form.bulk_config, window_enabled: e.target.checked } })}
                      data-testid="bulk-window-enabled" />
                    <span className="text-xs font-semibold">Janela horaria de envio</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <input type="time" value={form.bulk_config.window_start}
                      onChange={e => setForm({ ...form, bulk_config: { ...form.bulk_config, window_start: e.target.value } })}
                      className="input-field w-full text-xs" disabled={!form.bulk_config.window_enabled} />
                    <input type="time" value={form.bulk_config.window_end}
                      onChange={e => setForm({ ...form, bulk_config: { ...form.bulk_config, window_end: e.target.value } })}
                      className="input-field w-full text-xs" disabled={!form.bulk_config.window_enabled} />
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {['Seg','Ter','Qua','Qui','Sex','Sab','Dom'].map((lbl, idx) => (
                      <button key={lbl} type="button"
                        onClick={() => {
                          const has = form.bulk_config.window_days.includes(idx);
                          setForm({
                            ...form,
                            bulk_config: {
                              ...form.bulk_config,
                              window_days: has
                                ? form.bulk_config.window_days.filter(x => x !== idx)
                                : [...form.bulk_config.window_days, idx]
                            }
                          });
                        }}
                        disabled={!form.bulk_config.window_enabled}
                        className={`text-[10px] px-2 py-1 rounded ${form.bulk_config.window_days.includes(idx) ? 'bg-violet-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase text-violet-700 flex items-center gap-1"><ShieldOff className="w-3 h-3" /> Palavras-chave de Opt-out (separadas por virgula)</label>
                  <input value={(form.bulk_config.opt_out_keywords || []).join(', ')}
                    onChange={e => setForm({ ...form, bulk_config: { ...form.bulk_config, opt_out_keywords: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } })}
                    className="input-field w-full text-sm" data-testid="bulk-optout-kw" />
                  <p className="text-[10px] text-slate-500 mt-1">Quem responder uma dessas palavras nunca mais recebera disparos seus.</p>
                </div>

                <div className="text-[11px] bg-white rounded p-2 border border-violet-200">
                  <p className="font-semibold text-violet-700 mb-1">💡 Dica: use spintax nas mensagens</p>
                  <p className="text-slate-600">Escreva <code>{'{Ola|Oi|Boa noite} {{nome}}, {confira|veja} nossa oferta!'}</code> — cada envio sorteia uma variacao diferente, dificultando o WhatsApp detectar como spam.</p>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-slate-200 pt-4">
            <p className="text-[11px] font-semibold text-slate-700 mb-2 flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" /> Mensagens (envio sequencial)</p>
            <div className="flex gap-1 mb-2 border-b border-slate-200 flex-wrap">
              {[0,1,2,3,4].map(i => (
                <button
                  key={i}
                  onClick={() => setActiveMsg(i)}
                  className={`px-3 py-1.5 text-xs font-semibold relative ${activeMsg === i ? 'text-primary' : 'text-slate-400 hover:text-slate-700'}`}
                  data-testid={`msg-tab-${i+1}`}
                >
                  MSG. {i+1}
                  {form.messages[i]?.trim() && <span className="ml-1 w-1.5 h-1.5 inline-block rounded-full bg-emerald-500" />}
                  {activeMsg === i && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
                </button>
              ))}
            </div>
            <textarea
              value={form.messages[activeMsg] || ''}
              onChange={e => setMsg(activeMsg, e.target.value)}
              placeholder={`Mensagem ${activeMsg + 1}`}
              className="input-field w-full text-sm"
              rows={6}
              data-testid={`msg-textarea-${activeMsg+1}`}
            />
            <p className="text-[10px] text-slate-400 mt-1">Utilize variaveis como {'{nome}'}, {'{numero}'}.</p>
          </div>
        </div>

        <div className="flex justify-between items-center gap-2 p-4 border-t border-slate-200">
          <button className="btn-secondary text-xs flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" /> Anexar Arquivo
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary text-sm">Fechar</button>
            <button onClick={save} className="btn-primary text-sm" data-testid="save-campaign-btn">{isEditing ? 'Salvar' : 'Adicionar'}</button>
          </div>
        </div>
      </div>
    </div>
  );
};

const ModalTab = ({ active, onClick, label, testId }) => (
  <button
    onClick={onClick}
    data-testid={testId}
    className={`px-4 py-2 text-xs font-semibold relative -mb-px ${active ? 'text-primary border-b-2 border-primary' : 'text-slate-500 hover:text-slate-700'}`}
  >
    {label}
  </button>
);

const AntiBlockTab = ({ anti_block, onChange }) => {
  const ab = anti_block || {};
  const upd = (k, v) => onChange({ ...ab, [k]: v });
  const numeric = (v, def) => {
    const n = parseFloat(v);
    return isNaN(n) ? def : n;
  };
  return (
    <div className="space-y-4" data-testid="antiblock-tab">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
        <p className="text-[11px] font-bold text-amber-900 mb-1">⚠ Politicas anti-bloqueio do WhatsApp</p>
        <p className="text-[11px] text-amber-800 leading-relaxed">
          Estas configuracoes simulam comportamento humano para reduzir o risco do seu numero ser bloqueado.
          Recomendado para numeros nao-Business: maximo 250 msgs/dia e intervalos randomicos de 30-90s.
        </p>
      </div>

      <label className="flex items-start gap-2 p-3 rounded-lg border border-slate-200 cursor-pointer">
        <input type="checkbox" checked={!!ab.enabled} onChange={e => upd('enabled', e.target.checked)} className="mt-1" data-testid="ab-enabled" />
        <div className="flex-1">
          <p className="text-sm font-semibold">Ativar protecao anti-bloqueio</p>
          <p className="text-[11px] text-slate-500">Recomendado. Aplica delays randomicos e pausas entre lotes.</p>
        </div>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] font-bold uppercase text-slate-400">Intervalo minimo (s)</label>
          <input type="number" min="0" value={ab.interval_min_seconds ?? 30} onChange={e => upd('interval_min_seconds', numeric(e.target.value, 30))} className="input-field w-full text-sm" data-testid="ab-min" />
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase text-slate-400">Intervalo maximo (s)</label>
          <input type="number" min="0" value={ab.interval_max_seconds ?? 90} onChange={e => upd('interval_max_seconds', numeric(e.target.value, 90))} className="input-field w-full text-sm" data-testid="ab-max" />
        </div>
      </div>

      <div className="bg-slate-50 rounded-lg p-3 space-y-3">
        <p className="text-[11px] font-bold text-slate-700">Pausa entre lotes</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400">A cada (msgs)</label>
            <input type="number" min="1" value={ab.burst_size ?? 50} onChange={e => upd('burst_size', numeric(e.target.value, 50))} className="input-field w-full text-sm" data-testid="ab-burst" />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400">Pausa de (s)</label>
            <input type="number" min="0" value={ab.burst_pause_seconds ?? 300} onChange={e => upd('burst_pause_seconds', numeric(e.target.value, 300))} className="input-field w-full text-sm" data-testid="ab-burst-pause" />
          </div>
        </div>
        <p className="text-[10px] text-slate-500">Ex: a cada 50 mensagens, pausa 5 minutos. Simula descanso humano.</p>
      </div>

      <div className="bg-slate-50 rounded-lg p-3 space-y-3">
        <p className="text-[11px] font-bold text-slate-700">Escalonamento progressivo</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400">Apos N mensagens</label>
            <input type="number" min="0" value={ab.escalate_after ?? 100} onChange={e => upd('escalate_after', numeric(e.target.value, 100))} className="input-field w-full text-sm" data-testid="ab-escalate-after" />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400">Multiplicador</label>
            <input type="number" min="1" step="0.1" value={ab.escalate_factor ?? 1.5} onChange={e => upd('escalate_factor', numeric(e.target.value, 1.5))} className="input-field w-full text-sm" data-testid="ab-escalate-factor" />
          </div>
        </div>
        <p className="text-[10px] text-slate-500">Ex: apos 100 envios, multiplica intervalos por 1.5x (30-90s vira 45-135s).</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] font-bold uppercase text-slate-400">Limite por dia</label>
          <input type="number" min="1" value={ab.daily_limit ?? 250} onChange={e => upd('daily_limit', numeric(e.target.value, 250))} className="input-field w-full text-sm" data-testid="ab-daily" />
          <p className="text-[10px] text-slate-400 mt-0.5">Numero nao-Business: ate 250</p>
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase text-slate-400">Limite por hora</label>
          <input type="number" min="1" value={ab.hourly_limit ?? 50} onChange={e => upd('hourly_limit', numeric(e.target.value, 50))} className="input-field w-full text-sm" data-testid="ab-hourly" />
        </div>
      </div>

      <label className="flex items-start gap-2 p-2 rounded-md cursor-pointer">
        <input type="checkbox" checked={!!ab.only_with_phone_validated} onChange={e => upd('only_with_phone_validated', e.target.checked)} className="mt-0.5" />
        <div>
          <p className="text-xs font-semibold">Enviar apenas para numeros validados</p>
          <p className="text-[10px] text-slate-500">Verifica se o numero existe no WhatsApp antes de enviar (recomendado).</p>
        </div>
      </label>
    </div>
  );
};


const AntiBlockSettingsTab = () => {
  const [ab, setAb] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    crmAPI.getCampaignSettings().then(r => setAb(r.data?.anti_block || {})).catch(() => setAb({}));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await crmAPI.updateCampaignSettings({ anti_block: ab });
      toast.success('Parametros salvos');
    } catch (e) { toast.error('Erro ao salvar'); }
    finally { setSaving(false); }
  };

  if (!ab) return <div className="text-center py-12 text-slate-400 text-sm">Carregando...</div>;

  return (
    <div data-testid="antiblock-settings-page">
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <p className="text-sm text-slate-600 max-w-2xl">
          Configuracoes de <span className="font-semibold">protecao anti-bloqueio</span> aplicadas a <span className="font-semibold">todas as campanhas</span> da empresa.
          Campanhas individuais podem sobrescrever estes valores.
        </p>
        <button onClick={save} disabled={saving} className="btn-primary text-sm" data-testid="save-params-btn">
          {saving ? 'Salvando...' : 'Salvar Parametros'}
        </button>
      </div>
      <div className="card max-w-2xl p-5">
        <AntiBlockTab anti_block={ab} onChange={setAb} />
      </div>
    </div>
  );
};

const AudienceModal = ({ campaign, data, onClose }) => (
  <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <div className="bg-white rounded-xl shadow-2xl w-full max-w-md my-8" onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between p-4 border-b border-slate-200">
        <h3 className="text-base font-bold flex items-center gap-2"><Eye className="w-4 h-4 text-primary" /> Audiencia — {campaign.name}</h3>
        <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
      </div>
      <div className="p-4">
        {!data ? (
          <p className="text-sm text-slate-400 text-center py-6">Calculando...</p>
        ) : (
          <>
            <p className="text-sm text-slate-600 mb-3"><span className="font-bold text-slate-900 text-lg">{data.count}</span> contatos serao alcancados</p>
            <div className="max-h-72 overflow-y-auto space-y-1">
              {(data.preview || []).map((p, i) => (
                <div key={i} className="text-xs px-3 py-1.5 rounded-md bg-slate-50 flex items-center justify-between">
                  <span className="truncate">{p.name || '(sem nome)'}</span>
                  <span className="text-slate-400 ml-2">{p.phone}</span>
                </div>
              ))}
            </div>
            {data.count > 50 && <p className="text-[10px] text-slate-400 mt-2">Exibindo primeiros 50 de {data.count}</p>}
          </>
        )}
      </div>
    </div>
  </div>
);

/* ============== CONTACT LISTS TAB ============== */
const ContactListsTab = () => {
  const [lists, setLists] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);

  const reload = async () => {
    try { const r = await crmAPI.listContactLists(); setLists(r.data); } catch (e) {}
  };
  useEffect(() => { reload(); }, []);

  const remove = async (l) => {
    if (!window.confirm(`Excluir lista "${l.name}"?`)) return;
    try { await crmAPI.deleteContactList(l.id); toast.success('Removida'); reload(); }
    catch (e) { toast.error('Erro'); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-slate-500">{lists.length} listas</p>
        <button onClick={() => { setEditing(null); setShowModal(true); }} className="btn-primary text-sm flex items-center gap-1.5" data-testid="new-list-btn">
          <Plus className="w-4 h-4" /> Nova Lista
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {lists.length === 0 && <p className="col-span-full text-center text-sm text-slate-400 py-10">Nenhuma lista criada</p>}
        {lists.map(l => (
          <div key={l.id} className="card" data-testid={`list-${l.id}`}>
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate">{l.name}</p>
                <p className="text-[10px] text-slate-400">{l.count || 0} contatos</p>
              </div>
              <div className="flex items-center gap-0.5 flex-shrink-0">
                <button onClick={() => { setEditing(l); setShowModal(true); }} className="p-1 rounded hover:bg-slate-100"><Pencil className="w-3.5 h-3.5" /></button>
                <button onClick={() => remove(l)} className="p-1 rounded hover:bg-red-50 text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
            {l.description && <p className="text-xs text-slate-500 line-clamp-2">{l.description}</p>}
          </div>
        ))}
      </div>
      {showModal && (
        <ContactListModal
          list={editing}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); reload(); }}
        />
      )}
    </div>
  );
};

const ContactListModal = ({ list, onClose, onSaved }) => {
  const isEditing = !!list;
  const [name, setName] = useState(list?.name || '');
  const [description, setDescription] = useState(list?.description || '');
  const [contacts, setContacts] = useState(list?.contacts || []);
  const [bulk, setBulk] = useState('');

  const addBulk = () => {
    const lines = bulk.split('\n').map(s => s.trim()).filter(Boolean);
    const parsed = lines.map(l => {
      const parts = l.split(/[,;]/).map(p => p.trim());
      if (parts.length >= 2) return { name: parts[0], phone: parts[1].replace(/\D/g, '') };
      return { name: '', phone: l.replace(/\D/g, '') };
    }).filter(c => c.phone);
    setContacts([...contacts, ...parsed]);
    setBulk('');
    toast.success(`${parsed.length} contatos adicionados`);
  };

  const remove = (idx) => setContacts(contacts.filter((_, i) => i !== idx));

  const save = async () => {
    if (!name.trim()) { toast.error('Nome obrigatorio'); return; }
    try {
      const payload = { name, description, contacts };
      if (isEditing) await crmAPI.updateContactList(list.id, payload);
      else await crmAPI.createContactList(payload);
      toast.success(isEditing ? 'Atualizada' : 'Criada');
      onSaved();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Erro'); }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl my-8" onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h3 className="text-base font-bold">{isEditing ? 'Editar' : 'Nova'} Lista de Contato</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400">Nome</label>
            <input value={name} onChange={e => setName(e.target.value)} className="input-field w-full text-sm" data-testid="list-name" />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400">Descricao</label>
            <input value={description} onChange={e => setDescription(e.target.value)} className="input-field w-full text-sm" />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400">Adicionar contatos (1 por linha — formato: nome, telefone)</label>
            <textarea
              value={bulk}
              onChange={e => setBulk(e.target.value)}
              placeholder="Joao, 5511988887777&#10;Maria, 5511999998888"
              className="input-field w-full text-sm font-mono"
              rows={4}
              data-testid="list-bulk-input"
            />
            <button onClick={addBulk} className="btn-secondary text-xs mt-1.5">Adicionar contatos acima</button>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400">Contatos ({contacts.length})</label>
            <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-md mt-1">
              {contacts.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-4">Nenhum contato</p>
              ) : contacts.map((c, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-1.5 border-b border-slate-100 text-xs">
                  <span>{c.name || '(sem nome)'} — {c.phone}</span>
                  <button onClick={() => remove(i)} className="text-red-500 hover:text-red-700"><X className="w-3 h-3" /></button>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 p-3 border-t border-slate-200">
          <button onClick={onClose} className="btn-secondary text-sm">Cancelar</button>
          <button onClick={save} className="btn-primary text-sm" data-testid="save-list-btn">{isEditing ? 'Salvar' : 'Criar'}</button>
        </div>
      </div>
    </div>
  );
};

export default CampaignsPage;

/* ════════════════════════════════════════════════════════════════════
 * BULK LAUNCH MODAL — boota um bulk_job reutilizando uma Campanha
 * existente (audiencia + mensagem) + adiciona os parametros de
 * disparo robusto (multi-conexao, spintax, janela, opt-out).
 * 2026-02-28 — Integracao Campanhas ⟶ Bulk Dispatcher.
 * ════════════════════════════════════════════════════════════════════ */
const BulkLaunchModal = ({ campaign, onClose, onLaunched }) => {
  const [conns, setConns] = useState([]);
  const [audienceCount, setAudienceCount] = useState(null);
  const [form, setForm] = useState({
    connection_ids: [],
    message_template_override: (campaign.messages || []).find(Boolean) || '',
    interval_min_sec: 8,
    interval_max_sec: 25,
    window: { enabled: true, start: '09:00', end: '18:00', days_of_week: [0,1,2,3,4,5] },
    opt_out_keywords: ['PARAR', 'SAIR', 'DESCADASTRAR'],
    daily_cap_per_connection: 800,
    auto_start: true,
  });
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(1);

  useEffect(() => {
    channelsAPI.getConnections().then(r => setConns((r.data || []).filter(c => c.status === 'connected' || c.provider === 'whatsapp_cloud'))).catch(() => {});
    crmAPI.previewCampaignAudience(campaign.id).then(r => setAudienceCount(r.data?.count || 0)).catch(() => setAudienceCount(0));
  }, [campaign.id]);

  const toggleConn = (id) => setForm(f => ({ ...f, connection_ids: f.connection_ids.includes(id) ? f.connection_ids.filter(x => x !== id) : [...f.connection_ids, id] }));
  const toggleDow = (d) => setForm(f => ({ ...f, window: { ...f.window, days_of_week: f.window.days_of_week.includes(d) ? f.window.days_of_week.filter(x => x !== d) : [...f.window.days_of_week, d] } }));

  const submit = async () => {
    if (form.connection_ids.length === 0) { toast.error('Selecione ao menos 1 conexao'); return; }
    setSaving(true);
    try {
      await api.post(`/bulk/jobs/from-campaign/${campaign.id}`, form);
      onLaunched();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao criar disparo');
    } finally { setSaving(false); }
  };

  const DOW_LABELS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom'];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[92vh] overflow-y-auto" data-testid="bulk-launch-modal">
        <div className="p-5 border-b flex items-center justify-between">
          <div>
            <h3 className="font-bold text-lg flex items-center gap-2"><Rocket className="w-5 h-5 text-violet-600" /> Disparo em Massa</h3>
            <p className="text-xs text-slate-500">Campanha: <strong>{campaign.name}</strong> · Audiencia: {audienceCount ?? '...'} destinatarios</p>
          </div>
          <button onClick={onClose}><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          {step === 1 && (
            <>
              <div className="card bg-violet-50 border-violet-200 text-xs space-y-1">
                <p className="font-semibold text-violet-800">O que e diferente do "Enviar agora"?</p>
                <p>O disparo em massa usa <strong>fila persistente</strong>, rotaciona <strong>varios numeros</strong>, suporta <strong>spintax</strong> (variacao por envio), respeita <strong>janela horaria</strong>, e tem <strong>opt-out automatico</strong> via palavra-chave. Recomendado pra 1k+ destinatarios.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Mensagem (heranca da campanha — pode editar)</label>
                <textarea value={form.message_template_override} onChange={e => setForm({ ...form, message_template_override: e.target.value })} rows={5}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono" data-testid="bulk-msg-override" />
                <div className="mt-2 text-[11px] text-slate-500 bg-slate-50 rounded p-2 space-y-1">
                  <p><strong>Variaveis:</strong> {'{{nome}}'} (do contato), {'{{telefone}}'}, {'{{numero}}'}</p>
                  <p><strong>Spintax:</strong> {'{Ola|Oi|Boa noite}'} — sorteia variacao por envio. Ex: <code>{'{Ola|Oi} {{nome}}, {confira|veja} nossa oferta!'}</code></p>
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-2">
                  Conexoes ({form.connection_ids.length} selecionadas) — quanto mais, mais seguro
                </label>
                <div className="space-y-1 max-h-40 overflow-y-auto border rounded p-2">
                  {conns.length === 0 && <p className="text-xs text-slate-400">Nenhuma conexao ativa.</p>}
                  {conns.map(c => (
                    <label key={c.id} className="flex items-center gap-2 p-1.5 hover:bg-slate-50 rounded cursor-pointer">
                      <input type="checkbox" checked={form.connection_ids.includes(c.id)} onChange={() => toggleConn(c.id)} data-testid={`bulk-conn-${c.id}`} />
                      <div className="flex-1 text-xs">
                        <p className="font-medium">{c.name}</p>
                        <p className="text-[10px] text-slate-400">{c.phone || '-'} · {c.provider === 'whatsapp_cloud' ? 'Meta Cloud API' : 'Baileys (QR)'}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-xs font-medium mb-1">Intervalo MIN (s)</label>
                  <input type="number" value={form.interval_min_sec} onChange={e => setForm({ ...form, interval_min_sec: parseInt(e.target.value) || 1 })} className="w-full px-2 py-1.5 border rounded" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Intervalo MAX (s)</label>
                  <input type="number" value={form.interval_max_sec} onChange={e => setForm({ ...form, interval_max_sec: parseInt(e.target.value) || 1 })} className="w-full px-2 py-1.5 border rounded" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Limite diario por conexao</label>
                <input type="number" value={form.daily_cap_per_connection} onChange={e => setForm({ ...form, daily_cap_per_connection: parseInt(e.target.value) || 100 })} className="w-full px-2 py-1.5 border rounded text-sm" />
                <p className="text-[10px] text-slate-400 mt-1">Recomendado 600-1000 por numero pra evitar bloqueio.</p>
              </div>
              <div className="card bg-slate-50 p-3">
                <p className="text-xs font-medium mb-2">Janela horaria</p>
                <div className="flex items-center gap-2 mb-2 text-xs">
                  <input type="checkbox" checked={form.window.enabled} onChange={e => setForm({ ...form, window: { ...form.window, enabled: e.target.checked } })} />
                  <span>Habilitar janela</span>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <input type="time" value={form.window.start} onChange={e => setForm({ ...form, window: { ...form.window, start: e.target.value } })} className="px-2 py-1 border rounded text-xs" />
                  <input type="time" value={form.window.end} onChange={e => setForm({ ...form, window: { ...form.window, end: e.target.value } })} className="px-2 py-1 border rounded text-xs" />
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
              <div>
                <label className="block text-xs font-medium mb-1">Palavras opt-out (separadas por virgula)</label>
                <input value={form.opt_out_keywords.join(', ')} onChange={e => setForm({ ...form, opt_out_keywords: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} className="w-full px-2 py-1.5 border rounded text-sm" />
                <p className="text-[10px] text-slate-400 mt-1">Contato que enviar essa palavra entra no opt-out automaticamente.</p>
              </div>
            </>
          )}
        </div>

        <div className="p-5 border-t flex justify-between gap-2">
          <button onClick={() => step === 1 ? onClose() : setStep(1)} className="btn-secondary text-sm flex items-center gap-1">
            <ChevronLeft className="w-4 h-4" /> {step === 1 ? 'Cancelar' : 'Voltar'}
          </button>
          {step === 1 ? (
            <button onClick={() => setStep(2)} className="btn-primary text-sm flex items-center gap-1" data-testid="bulk-launch-next">
              Proximo <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button onClick={submit} disabled={saving} className="btn-primary text-sm flex items-center gap-1 bg-violet-600 hover:bg-violet-700" data-testid="bulk-launch-submit">
              <Rocket className="w-4 h-4" /> {saving ? 'Iniciando...' : 'Iniciar Disparo'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════
 * BULK JOBS TAB — listagem + detalhe dos disparos em massa ativos.
 * Tudo integrado dentro da pagina Campanhas (aba "Disparos em Massa").
 * ════════════════════════════════════════════════════════════════════ */
const BULK_STATUS_BADGE = {
  draft: 'bg-slate-100 text-slate-700', running: 'bg-emerald-100 text-emerald-700',
  paused: 'bg-amber-100 text-amber-700', cancelled: 'bg-red-100 text-red-700',
  completed: 'bg-blue-100 text-blue-700',
};
const REC_STATUS_BADGE = {
  pending: 'bg-slate-100 text-slate-600', sent: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700', opted_out: 'bg-amber-100 text-amber-700',
};

const BulkJobsTab = () => {
  const [jobs, setJobs] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  const load = useCallback(async () => {
    try { const r = await api.get('/bulk/jobs'); setJobs(r.data || []); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  if (selectedId) return <BulkJobDetail jobId={selectedId} onBack={() => { setSelectedId(null); load(); }} />;

  return (
    <div data-testid="bulk-jobs-tab">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-slate-500">Disparos criados a partir das campanhas — multi-conexao, spintax, janela e opt-out.</p>
        <button onClick={load} className="btn-secondary text-xs flex items-center gap-1"><RefreshCw className="w-3 h-3" /> Atualizar</button>
      </div>
      {jobs.length === 0 && (
        <div className="card text-center py-10 text-slate-400 text-sm">
          <Rocket className="w-10 h-10 mx-auto mb-2 text-slate-300" />
          <p>Nenhum disparo em massa. Use o icone 🚀 (foguete) na lista de campanhas para criar.</p>
        </div>
      )}
      <div className="space-y-2">
        {jobs.map(j => {
          const pct = j.audience_size > 0 ? Math.min(100, Math.round(((j.sent_count + j.failed_count + j.opted_out_count) / j.audience_size) * 100)) : 0;
          return (
            <div key={j.id} onClick={() => setSelectedId(j.id)} className="card cursor-pointer hover:shadow-md transition" data-testid={`bulk-job-${j.id}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-sm">{j.name}</h3>
                  <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${BULK_STATUS_BADGE[j.status] || 'bg-slate-100'}`}>{j.status.toUpperCase()}</span>
                </div>
                <span className="text-[10px] text-slate-400">{new Date(j.created_at).toLocaleString()}</span>
              </div>
              <div className="grid grid-cols-5 gap-2 text-xs mb-2">
                <BulkStat label="Audiencia" value={j.audience_size} icon={Users} />
                <BulkStat label="Enviadas" value={j.sent_count} icon={CheckCircle2} color="text-emerald-600" />
                <BulkStat label="Falhas" value={j.failed_count} icon={AlertCircle} color="text-red-500" />
                <BulkStat label="Opt-outs" value={j.opted_out_count} icon={ShieldOff} color="text-amber-600" />
                <BulkStat label="Conexoes" value={(j.connection_ids || []).length} icon={Activity} />
              </div>
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const BulkStat = ({ label, value, icon: Ic, color = 'text-slate-600' }) => (
  <div className="flex items-center gap-1.5">
    <Ic className={`w-3 h-3 ${color}`} />
    <div>
      <p className="text-[9px] uppercase text-slate-400 leading-tight">{label}</p>
      <p className={`font-bold text-xs ${color}`}>{value || 0}</p>
    </div>
  </div>
);

const BulkJobDetail = ({ jobId, onBack }) => {
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
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [load]);

  const act = async (action) => {
    setActing(true);
    try { await api.post(`/bulk/jobs/${jobId}/action`, { action }); toast.success(`Acao '${action}' aplicada`); load(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Erro'); }
    finally { setActing(false); }
  };

  if (!job) return <div className="text-sm text-slate-500">Carregando...</div>;
  const pct = job.audience_size > 0 ? Math.min(100, Math.round(((job.sent_count + job.failed_count + job.opted_out_count) / job.audience_size) * 100)) : 0;

  return (
    <div data-testid="bulk-job-detail">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-3"><ChevronLeft className="w-4 h-4" /> Voltar</button>
      <div className="card mb-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="font-bold text-lg">{job.name}</h2>
            <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${BULK_STATUS_BADGE[job.status] || 'bg-slate-100'}`}>{job.status.toUpperCase()}</span>
          </div>
          <div className="flex items-center gap-2">
            {job.status === 'running' && <button onClick={() => act('pause')} disabled={acting} className="btn-secondary text-xs flex items-center gap-1" data-testid="bulk-pause"><Pause className="w-3 h-3" /> Pausar</button>}
            {job.status === 'paused'  && <button onClick={() => act('resume')} disabled={acting} className="btn-primary text-xs flex items-center gap-1" data-testid="bulk-resume"><Play className="w-3 h-3" /> Retomar</button>}
            {['draft', 'running', 'paused'].includes(job.status) && (
              <button onClick={() => { if (window.confirm('Cancelar este disparo?')) act('cancel'); }} disabled={acting} className="text-red-600 hover:bg-red-50 text-xs flex items-center gap-1 px-2 py-1 rounded" data-testid="bulk-cancel"><Square className="w-3 h-3" /> Cancelar</button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-5 gap-2 mb-3">
          <BulkStat label="Audiencia" value={job.audience_size} icon={Users} />
          <BulkStat label="Enviadas" value={job.sent_count} icon={CheckCircle2} color="text-emerald-600" />
          <BulkStat label="Falhas" value={job.failed_count} icon={AlertCircle} color="text-red-500" />
          <BulkStat label="Opt-outs" value={job.opted_out_count} icon={ShieldOff} color="text-amber-600" />
          <BulkStat label="Restantes" value={Math.max(0, job.audience_size - job.sent_count - job.failed_count - job.opted_out_count)} icon={Clock} />
        </div>
        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-[10px] text-slate-400 mt-1">{pct}% processado{job.last_tick_at ? ` · Ultimo tick: ${new Date(job.last_tick_at).toLocaleString()}` : ''}</p>
      </div>

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

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">Destinatarios</h3>
          <div className="flex gap-1">
            {['', 'pending', 'sent', 'failed', 'opted_out'].map(s => (
              <button key={s || 'all'} onClick={() => setFilter(s)} className={`text-[10px] px-2 py-1 rounded ${filter === s ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
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
