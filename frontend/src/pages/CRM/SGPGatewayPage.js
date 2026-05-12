import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Copy, RefreshCw, Trash2, Power, X, Link as LinkIcon, AlertCircle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import api, { channelsAPI } from '../../services/api';

const sgpGatewayAPI = {
  list: () => api.get('/sgp/gateways'),
  create: (data) => api.post('/sgp/gateways', data),
  update: (id, data) => api.put(`/sgp/gateways/${id}`, data),
  regenerate: (id) => api.post(`/sgp/gateways/${id}/regenerate-token`),
  remove: (id) => api.delete(`/sgp/gateways/${id}`),
};

const SGPGatewayPage = () => {
  const [items, setItems] = useState([]);
  const [conns, setConns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [g, c] = await Promise.all([
        sgpGatewayAPI.list(),
        channelsAPI.getConnections(),
      ]);
      setItems(g.data || []);
      setConns(c.data || []);
    } catch (e) {
      toast.error('Erro ao carregar gateways');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (form) => {
    try {
      if (editing?.id) {
        await sgpGatewayAPI.update(editing.id, form);
        toast.success('Gateway atualizado');
      } else {
        await sgpGatewayAPI.create(form);
        toast.success('Gateway criado');
      }
      setShowForm(false);
      setEditing(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao salvar');
    }
  };

  const handleRegenerate = async (g) => {
    if (!window.confirm(`Gerar novo token para "${g.label}"? O token atual deixara de funcionar imediatamente.`)) return;
    try {
      await sgpGatewayAPI.regenerate(g.id);
      toast.success('Novo token gerado. Atualize a configuracao no SGP.');
      load();
    } catch (e) {
      toast.error('Erro ao regenerar');
    }
  };

  const handleDelete = async (g) => {
    if (!window.confirm(`Excluir gateway "${g.label}"?`)) return;
    try {
      await sgpGatewayAPI.remove(g.id);
      toast.success('Excluido');
      load();
    } catch (e) {
      toast.error('Erro ao excluir');
    }
  };

  const handleToggleActive = async (g) => {
    try {
      await sgpGatewayAPI.update(g.id, { active: !g.active });
      load();
    } catch (e) {
      toast.error('Erro');
    }
  };

  return (
    <div className="animate-fade-in" data-testid="sgp-gateway-page">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 font-heading">SGP Gateway</h1>
          <p className="text-sm text-slate-500 mt-1">
            Endereços que o SGP usa para enviar mensagens via WhatsApp pelo AgentCRM.
          </p>
        </div>
        <button
          onClick={() => { setEditing(null); setShowForm(true); }}
          className="btn-primary text-sm flex items-center gap-2"
          data-testid="new-gateway-btn"
        >
          <Plus className="w-4 h-4" /> Novo Gateway
        </button>
      </div>

      <InstructionsCard />

      {loading ? (
        <div className="text-center text-slate-400 py-12 text-sm">Carregando...</div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border-2 border-dashed border-slate-200 p-12 text-center">
          <LinkIcon className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-medium mb-1">Nenhum gateway cadastrado</p>
          <p className="text-xs text-slate-400">Crie um gateway para receber chamadas do SGP e disparar mensagens via WhatsApp.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(g => (
            <GatewayCard
              key={g.id}
              gateway={g}
              connections={conns}
              onEdit={() => { setEditing(g); setShowForm(true); }}
              onRegenerate={() => handleRegenerate(g)}
              onDelete={() => handleDelete(g)}
              onToggleActive={() => handleToggleActive(g)}
            />
          ))}
        </div>
      )}

      {showForm && (
        <GatewayForm
          initial={editing}
          connections={conns}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSave={handleSave}
        />
      )}
    </div>
  );
};

const InstructionsCard = () => {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl mb-5 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-blue-100/40 transition-colors"
        data-testid="toggle-instructions"
      >
        <span className="flex items-center gap-2 text-blue-900 font-medium text-sm">
          <AlertCircle className="w-4 h-4" /> Como configurar no SGP?
        </span>
        <span className="text-xs text-blue-700">{open ? 'Ocultar' : 'Mostrar'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 text-sm text-blue-900 space-y-2">
          <ol className="list-decimal list-inside space-y-1.5 ml-1">
            <li>No SGP, vá em <strong>Sistema → Configurações SMS Gateway</strong> e clique em <strong>Adicionar Configuração SMS Gateway</strong>.</li>
            <li><strong>Descrição:</strong> escolha um nome (ex: "AgentCRM WhatsApp").</li>
            <li><strong>Gateway:</strong> selecione <strong>HTTP Generico</strong>.</li>
            <li>No campo <strong>Config</strong>, cole o JSON abaixo (use a "URL" do gateway que voce vai criar aqui):
              <pre className="bg-white border border-blue-200 rounded p-2 mt-2 text-xs whitespace-pre-wrap break-all">{`{
  "url": "https://agentcrm.8ip.com.br/api/sgp/gateway/send/SEU_TOKEN_AQUI",
  "set_to": "celular",
  "set_msg": "message",
  "verify": 0,
  "cc_code": "55"
}`}</pre>
            </li>
            <li>Salve. Pronto — toda vez que o SGP usar esse gateway (cobrança, aviso, etc.), o AgentCRM disparará via WhatsApp e abrirá um ticket no Atendimento.</li>
          </ol>
        </div>
      )}
    </div>
  );
};

const GatewayCard = ({ gateway, connections, onEdit, onRegenerate, onDelete, onToggleActive }) => {
  const conn = connections.find(c => c.id === gateway.connection_id);
  const base = window.location.origin;
  const url = `${base}/api/sgp/gateway/send/${gateway.token}`;

  const copyUrl = () => {
    navigator.clipboard.writeText(url);
    toast.success('URL copiada');
  };

  const copyConfig = () => {
    const cfg = JSON.stringify({
      url, set_to: 'celular', set_msg: 'message', verify: 0, cc_code: '55'
    }, null, 2);
    navigator.clipboard.writeText(cfg);
    toast.success('Config JSON copiado — cole no campo Config do SGP');
  };

  const lastCalled = gateway.last_called_at
    ? new Date(gateway.last_called_at).toLocaleString('pt-BR')
    : 'Aguardando primeira chamada';

  return (
    <div
      className={`bg-white rounded-xl border ${gateway.active ? 'border-slate-200' : 'border-slate-200 opacity-60'} p-4 hover:shadow-sm transition-shadow`}
      data-testid={`gateway-card-${gateway.id}`}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-slate-800 text-base">{gateway.label}</h3>
            {gateway.active ? (
              <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-medium">ATIVO</span>
            ) : (
              <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-medium">INATIVO</span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
            <span>Conexão: <strong className="text-slate-700">{conn?.name || gateway.connection_id?.slice(0, 8)}</strong></span>
            <span className="text-slate-300">•</span>
            <span>{gateway.calls_count || 0} chamada(s)</span>
            <span className="text-slate-300">•</span>
            <span>Última: {lastCalled}</span>
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onToggleActive}
            className={`p-2 rounded-lg transition-colors ${gateway.active ? 'text-emerald-600 hover:bg-emerald-50' : 'text-slate-400 hover:bg-slate-100'}`}
            title={gateway.active ? 'Desativar' : 'Ativar'}
            data-testid={`toggle-active-${gateway.id}`}
          >
            <Power className="w-4 h-4" />
          </button>
          <button onClick={onEdit} className="px-3 py-1.5 text-xs rounded-md text-slate-600 hover:bg-slate-100" data-testid={`edit-gateway-${gateway.id}`}>Editar</button>
          <button onClick={onRegenerate} className="p-2 rounded-lg text-amber-600 hover:bg-amber-50" title="Regenerar token" data-testid={`regen-${gateway.id}`}><RefreshCw className="w-4 h-4" /></button>
          <button onClick={onDelete} className="p-2 rounded-lg text-red-500 hover:bg-red-50" title="Excluir" data-testid={`delete-${gateway.id}`}><Trash2 className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="mt-3 bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-slate-500 font-medium flex-shrink-0">URL de envio:</span>
          <code className="flex-1 text-slate-700 font-mono break-all min-w-0">{url}</code>
          <button onClick={copyUrl} className="flex items-center gap-1 px-2 py-1 bg-white border border-slate-300 rounded text-xs hover:bg-slate-50 flex-shrink-0" data-testid={`copy-url-${gateway.id}`}>
            <Copy className="w-3 h-3" /> Copiar URL
          </button>
        </div>
        <div className="text-right">
          <button onClick={copyConfig} className="text-xs text-blue-600 hover:underline font-medium" data-testid={`copy-config-${gateway.id}`}>
            Copiar Config JSON (para colar no SGP)
          </button>
        </div>
      </div>
    </div>
  );
};

const GatewayForm = ({ initial, connections, onClose, onSave }) => {
  const [label, setLabel] = useState(initial?.label || '');
  const [connId, setConnId] = useState(initial?.connection_id || (connections[0]?.id || ''));

  const canSave = label.trim() && connId;

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold font-heading">{initial?.id ? 'Editar Gateway' : 'Novo Gateway SGP'}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1 block">Descrição (apelido interno)</label>
            <input
              autoFocus
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="Ex: Cobranca SGP, Avisos rede, etc."
              className="input-field"
              data-testid="gw-label-input"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1 block">Conexão WhatsApp</label>
            <select
              value={connId}
              onChange={e => setConnId(e.target.value)}
              className="input-field"
              data-testid="gw-connection-select"
            >
              <option value="">— Selecione —</option>
              {connections.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.status === 'connected' ? '(conectado)' : '(offline)'}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500 mt-1">As mensagens disparadas por este gateway sairão desta conexão.</p>
          </div>
          {!initial?.id && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs text-emerald-800 flex gap-2">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>Um <strong>token único</strong> sera gerado automaticamente. A URL aparecera na lista — copie e cole no SGP.</span>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="btn-secondary text-sm">Cancelar</button>
          <button
            onClick={() => canSave && onSave({ label: label.trim(), connection_id: connId })}
            disabled={!canSave}
            className="btn-primary text-sm disabled:opacity-50"
            data-testid="save-gateway-btn"
          >
            {initial?.id ? 'Salvar' : 'Criar Gateway'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SGPGatewayPage;
