import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactFlow, {
  Background, Controls, MiniMap,
  applyNodeChanges, applyEdgeChanges, addEdge,
  MarkerType, Handle, Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { crmAPI, aiAPI } from '../../services/api';
import api from '../../services/api';
import { toast } from 'sonner';
import {
  Save, Plus, Trash2, X, MessageSquare, MenuSquare, Edit2,
  Shuffle, Clock, Ticket as TicketIcon, Tag, Bot, Globe, Zap,
  ChevronLeft, Upload, Download
} from 'lucide-react';

const NODE_TYPES = [
  { type: 'start',     label: 'Inicio',         icon: Zap,           color: '#10B981', desc: 'Ponto de entrada do fluxo' },
  { type: 'message',   label: 'Conteudo',       icon: MessageSquare, color: '#4F46E5', desc: 'Envia mensagem de texto, audio, imagem' },
  { type: 'menu',      label: 'Menu',           icon: MenuSquare,    color: '#8B5CF6', desc: 'Lista de opcoes para o cliente escolher' },
  { type: 'random',    label: 'Randomizador',   icon: Shuffle,       color: '#EC4899', desc: 'Escolhe um caminho aleatorio' },
  { type: 'delay',     label: 'Intervalo',      icon: Clock,         color: '#F59E0B', desc: 'Aguarda X segundos antes de continuar' },
  { type: 'ticket',    label: 'Ticket',         icon: TicketIcon,    color: '#06B6D4', desc: 'Move o atendimento para uma fila' },
  { type: 'tag',       label: 'Tag',            icon: Tag,           color: '#22C55E', desc: 'Adiciona ou remove tag do contato' },
  { type: 'ai_agent',  label: 'Agente IA',      icon: Bot,           color: '#A855F7', desc: 'Chama um agente IA cadastrado' },
  { type: 'http',      label: 'HTTP Request',   icon: Globe,         color: '#64748B', desc: 'Chama uma API externa (webhook)' },
];

const NODE_TYPE_BY_KEY = Object.fromEntries(NODE_TYPES.map(t => [t.type, t]));

// Node component with connection handles + inline delete
const FlowNode = ({ data, id }) => {
  const cfg = NODE_TYPE_BY_KEY[data.nodeType] || NODE_TYPES[1];
  const Icon = cfg.icon;
  const summary = data.config?.summary || data.label || cfg.label;
  const isStart = data.nodeType === 'start';
  const isMenu = data.nodeType === 'menu';
  const menuOptions = (data.config?.options) || [];
  // 2026-02-17 — Anomaly flags injected by `decorateNode`. These drive
  // visual alerts directly on the canvas so operators see broken connections
  // without leaving the Flowbuilder. Anomaly types:
  //   • orphan: node has no outgoing edge (flow ends here unexpectedly)
  //   • orphan_option: menu option without an outgoing edge
  //   • menu_no_options: menu node without any option configured
  const anomalies = data.anomalies || [];
  const isAnomalous = anomalies.length > 0;
  // 2026-02-17 — Outgoing connection preview. Shows the target node's label
  // INSIDE this node so the operator can confirm "ah, esse Conteudo aponta
  // para o Menu correto" without having to trace lines across the canvas.
  const outgoingTo = data.outgoing_to;

  return (
    <div
      className={`rounded-lg shadow-md bg-white border-2 min-w-[220px] max-w-[280px] group relative ${isAnomalous ? 'ring-2 ring-rose-500 ring-offset-2' : ''}`}
      style={{ borderColor: isAnomalous ? '#e11d48' : cfg.color }}
      data-testid={`flow-node-${data.nodeType}`}
    >
      {isAnomalous && (
        <div
          className="absolute -top-3 -left-3 w-6 h-6 rounded-full bg-rose-600 text-white text-[11px] font-bold flex items-center justify-center shadow-lg z-20"
          title={anomalies.map(a => a.message).join(' | ')}
          data-testid={`flow-node-anomaly-${id}`}
        >
          !
        </div>
      )}
      {/* Target handle (input) — hidden on start */}
      {!isStart && (
        <Handle
          type="target"
          position={Position.Top}
          style={{ background: cfg.color, width: 10, height: 10, border: '2px solid white' }}
          isConnectable
        />
      )}

      {/* Inline delete button (X) — visible on hover */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (data.onDelete) data.onDelete(id);
        }}
        className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-red-600 transition-opacity shadow-md z-10"
        title="Excluir no"
        data-testid={`delete-node-${id}`}
      >
        <X className="w-3 h-3" />
      </button>

      <div className="px-3 py-1.5 flex items-center gap-2 text-white text-xs font-semibold rounded-t-md" style={{ background: cfg.color }}>
        <Icon className="w-3.5 h-3.5" />
        <span>{cfg.label}</span>
        {data.config?.capture_var && (
          <span
            className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[9px] font-bold uppercase tracking-wide shadow"
            title={`Este no PAUSA o fluxo aguardando a resposta do cliente. Variavel: ${data.config.capture_var}${data.config.capture_format ? ` · Formato: ${data.config.capture_format}` : ''}`}
            data-testid={`flow-node-capture-badge-${id}`}
          >
            ⏸ Aguarda
          </span>
        )}
      </div>
      <div className="p-2.5">
        <p className="text-[12px] text-slate-700 line-clamp-2">{summary}</p>
        {outgoingTo && !isMenu && (
          <div
            className="mt-1.5 flex items-start gap-1 text-[10px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5"
            data-testid={`flow-node-outgoing-${id}`}
          >
            <span>→</span>
            <span className="leading-tight">
              Vai para: <strong>{outgoingTo.label || outgoingTo.type}</strong>
              <span className="ml-1 text-[9px] text-emerald-600">[{outgoingTo.type}]</span>
            </span>
          </div>
        )}
        {data.config?.capture_var && (
          <div className="mt-1.5 flex items-start gap-1 text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
            <span>⏸</span>
            <span className="leading-tight">
              <strong>Pausa</strong> aguardando resposta em <code className="font-mono bg-white px-0.5 rounded">{data.config.capture_var}</code>
              {data.config.capture_format && (
                <> · formato <strong>{data.config.capture_format}</strong></>
              )}
            </span>
          </div>
        )}
        {isAnomalous && (
          <div className="mt-2 space-y-0.5" data-testid={`flow-node-anomaly-messages-${id}`}>
            {anomalies.map((a, i) => (
              <div key={i} className="flex items-start gap-1 text-[10px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-1.5 py-0.5">
                <span>⚠</span>
                <span className="leading-tight">{a.message}</span>
              </div>
            ))}
          </div>
        )}
        {isMenu && menuOptions.length > 0 && (
          <div className="mt-2 space-y-1">
            {menuOptions.map((opt, i) => (
              <div
                key={i}
                className="relative flex items-center gap-2 text-[11px] py-1 px-2 rounded bg-slate-50 border border-slate-200"
                title={`Saida da opcao ${i + 1}`}
              >
                <span className="w-4 h-4 rounded-full bg-violet-500 text-white text-[9px] font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
                <span className="truncate text-slate-700">{opt.label || `Opcao ${i + 1}`}</span>
                {/* Per-option output handle — placed on the right edge */}
                <Handle
                  id={`option-${i}`}
                  type="source"
                  position={Position.Right}
                  style={{
                    background: cfg.color, width: 10, height: 10, border: '2px solid white',
                    top: 'auto',
                    transform: 'translate(50%, 0)',
                    right: -5,
                  }}
                  isConnectable
                />
              </div>
            ))}
            <p className="text-[9px] text-slate-400 mt-1">Conecte cada opcao a um proximo no.</p>
          </div>
        )}
      </div>

      {/* Default source handle (output) — bottom of node — hidden for menu (uses per-option) */}
      {!isMenu && (
        <Handle
          type="source"
          position={Position.Bottom}
          style={{ background: cfg.color, width: 10, height: 10, border: '2px solid white' }}
          isConnectable
        />
      )}
    </div>
  );
};

const nodeTypes = { flow: FlowNode };

const FlowBuilderPage = () => {
  const [flows, setFlows] = useState([]);
  const [currentFlow, setCurrentFlow] = useState(null);
  const [showFlowsList, setShowFlowsList] = useState(true);
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [aiAgents, setAiAgents] = useState([]);

  const reload = () => crmAPI.listFlows().then(r => setFlows(r.data)).catch(() => {});
  const [tagsList, setTagsList] = useState([]);
  const [queuesList, setQueuesList] = useState([]);
  // 2026-02-28 — Lista de usuarios da empresa pra usar no Ticket node
  // como rota direta a um analista especifico.
  const [usersList, setUsersList] = useState([]);
  const importFileRef = useRef(null);
  useEffect(() => {
    reload();
    aiAPI.listAgents().then(r => setAiAgents(r.data)).catch(() => {});
    crmAPI.listTags().then(r => setTagsList(r.data)).catch(() => {});
    crmAPI.listQueues().then(r => setQueuesList(r.data)).catch(() => {});
    import('../../services/api').then(({ schedulingAPI }) => {
      if (schedulingAPI?.getCompanyUsers) schedulingAPI.getCompanyUsers().then(r => setUsersList(r.data || [])).catch(() => {});
    });
  }, []);

  const deleteNode = useCallback((nodeId) => {
    setNodes(ns => ns.filter(n => n.id !== nodeId));
    setEdges(es => es.filter(e => e.source !== nodeId && e.target !== nodeId));
    setSelectedNode(null);
  }, []);

  // Inject onDelete + anomaly flags + outgoing-target preview into node data.
  // The third arg `allNodes` enables resolution of "this node points to: X"
  // chip rendered inside each non-menu node body.
  const decorateNode = useCallback((n, allEdges = [], allNodes = null) => {
    // Migrate legacy menu options (string[]) to {label}[]
    let cfg = n.data?.config || {};
    if (n.data?.nodeType === 'menu' && Array.isArray(cfg.options)) {
      cfg = {
        ...cfg,
        options: cfg.options.map(o => typeof o === 'string' ? { label: o } : o),
      };
    }
    // 2026-02-17 — Compute per-node anomalies AND outgoing target preview.
    // Visible on the canvas as a red ring + "!" badge + inline message chips
    // for anomalies, plus a green "→ Vai para: X" chip for outgoing previews.
    const TERMINAL = new Set(['ticket', 'end', 'transfer']);
    const anomalies = [];
    const nt = n.data?.nodeType;
    // Helper to label a node (used both for outgoing preview and inside menu's option pretty-print)
    const _label = (target) => {
      if (!target) return null;
      const tcfg = (target.data?.config) || {};
      const txt = tcfg.message || tcfg.text || tcfg.question || tcfg.label || '';
      if (!txt) {
        const opts = tcfg.options;
        if (Array.isArray(opts) && opts.length) return `${opts.length} opcoes`;
      }
      const s = (txt || '(sem texto)').replace(/\n/g, ' ');
      return s.length > 50 ? s.slice(0, 50) + '...' : s;
    };
    const nodesById = (() => {
      const m = {};
      // This callback receives one node — we don't have the full node list
      // here. The map will be supplied via a second arg to decorateNode
      // (see useEffect / openFlow callers below).
      return m;
    })();
    // The function caller passes (n, allEdges, allNodes). The third arg is
    // optional for back-compat; when present we resolve the outgoing target's
    // label so it appears inline on the canvas.
    if (!TERMINAL.has(nt) && nt !== 'start' && nt !== undefined) {
      if (nt === 'menu') {
        const opts = ((n.data?.config?.options) || []);
        if (opts.length === 0 && !(n.data?.config?.dynamic_source)) {
          anomalies.push({ type: 'menu_no_options', message: 'Menu sem opcoes configuradas' });
        } else {
          const handles = new Set(
            allEdges
              .filter(e => e.source === n.id)
              .map(e => e.sourceHandle)
              .filter(Boolean)
          );
          opts.forEach((opt, i) => {
            const handle = `option-${i}`;
            if (!handles.has(handle)) {
              const label = (opt?.label || `Opcao ${i + 1}`).slice(0, 30);
              anomalies.push({
                type: 'orphan_option',
                message: `Opcao ${i + 1} ("${label}") sem proximo no`,
              });
            }
          });
        }
      } else {
        const out = allEdges.filter(e => e.source === n.id);
        if (out.length === 0) {
          anomalies.push({ type: 'orphan', message: 'Sem proximo no — fluxo termina aqui' });
        }
      }
    }
    // Compute outgoing_to preview for non-menu nodes with exactly one out edge.
    let outgoing_to = null;
    if (nt !== 'menu' && !TERMINAL.has(nt) && nt !== 'start') {
      const out = allEdges.filter(e => e.source === n.id);
      if (out.length === 1 && allNodes) {
        const target = allNodes.find(x => x.id === out[0].target);
        if (target) {
          outgoing_to = {
            id: target.id,
            type: target.data?.nodeType || 'unknown',
            label: _label(target),
          };
        }
      }
    }
    // Avoid unused-var lint
    void nodesById;
    return {
      ...n,
      type: 'flow',
      data: { ...n.data, config: cfg, onDelete: deleteNode, anomalies, outgoing_to },
    };
  }, [deleteNode]);

  const onNodesChange = useCallback(changes => setNodes(ns => applyNodeChanges(changes, ns)), []);
  const onEdgesChange = useCallback(changes => setEdges(es => applyEdgeChanges(changes, es)), []);
  const onConnect = useCallback(params => setEdges(es => addEdge({
    ...params,
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { strokeWidth: 2, stroke: '#6366f1' },
    animated: false,  // 2026-02-17 — Padronizado: arestas SOLIDAS (sem pulsar)
                       // para que conexoes novas e antigas tenham o mesmo visual.
  }, es)), []);

  // 2026-02-17 — Re-run anomaly + outgoing detection whenever edges change.
  useEffect(() => {
    setNodes(ns => {
      const decorated = ns.map(n => decorateNode(n, edges, ns));
      return decorated;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edges, decorateNode]);

  const openFlow = (flow) => {
    setCurrentFlow(flow);
    setShowFlowsList(false);
    // 2026-02-17 — Normalize edges so old (animated/dashed) and new (solid)
    // share the same visual.
    const incomingEdges = (flow.edges || []).map(e => ({
      ...e,
      animated: false,
      style: { strokeWidth: 2, stroke: '#6366f1', ...(e.style || {}) },
      markerEnd: e.markerEnd || { type: MarkerType.ArrowClosed },
    }));
    // 2026-02-28 — Defensive: legacy/test flows occasionally have nodes
    // sem `position` ou `data` definidos (seed antigo). React-flow crasha
    // dentro de createNodeInternals quando le `node.position.x`. Aqui
    // garantimos defaults pra abrir QUALQUER fluxo sem quebrar a UI.
    const incomingNodes = (flow.nodes || []).map((n, idx) => ({
      ...n,
      type: n.type || 'flow',
      position: (n.position && typeof n.position.x === 'number' && typeof n.position.y === 'number')
        ? n.position
        : { x: 80 + (idx % 4) * 220, y: 80 + Math.floor(idx / 4) * 140 },
      data: n.data || { nodeType: n.nodeType || 'message', label: n.label || 'No', config: {} },
    }));
    setNodes(incomingNodes.map(n => decorateNode(n, incomingEdges, incomingNodes)));
    setEdges(incomingEdges);
  };

  const newFlow = async () => {
    const name = window.prompt('Nome do fluxo:');
    if (!name) return;
    try {
      const r = await crmAPI.createFlow({ name, description: '', nodes: [], edges: [], trigger_type: 'manual' });
      reload();
      openFlow(r.data);
    } catch (e) { toast.error('Erro ao criar'); }
  };

  const deleteFlow = async (f) => {
    if (!window.confirm(`Excluir o fluxo "${f.name}"?`)) return;
    try { await crmAPI.deleteFlow(f.id); toast.success('Fluxo removido'); reload(); }
    catch (e) { toast.error('Erro'); }
  };

  const renameFlow = async (f) => {
    const newName = window.prompt('Novo nome do fluxo:', f.name || '');
    if (!newName || !newName.trim() || newName.trim() === f.name) return;
    try {
      await crmAPI.updateFlow(f.id, { name: newName.trim() });
      toast.success('Nome atualizado');
      reload();
    } catch (e) {
      toast.error('Erro ao renomear');
    }
  };

  const exportFlow = async (f) => {
    try {
      const { data } = await crmAPI.exportFlow(f.id);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safe = (f.name || 'fluxo').replace(/[^a-z0-9_\-]+/gi, '_').slice(0, 60);
      a.href = url;
      a.download = `${safe}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Fluxo exportado');
    } catch (e) {
      toast.error('Erro ao exportar');
    }
  };

  const importSgpFlow = async () => {
    if (!window.confirm('Importar fluxo de atendimento SGP?\n\nSerá criado um fluxo "SGP — Atendimento Web Internet" desativado, com nós já apontando para o proxy interno (sem token hardcoded).\n\nLembre de configurar a integração SGP em Integrações antes de ativar.')) return;
    try {
      const { data } = await api.post('/sgp/import-flow');
      if (data.created) {
        toast.success('Fluxo SGP criado!');
        reload();
      } else {
        toast.info('Fluxo SGP já existe — abrindo...');
        reload();
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao importar');
    }
  };

  // Read a .json exported via the Export button (or shipped by support),
  // parse it, and POST to /crm/flows/import so it lands as a NEW disabled
  // flow on the current tenant. The backend strips company-specific ids.
  const importFlowFromFile = async (file) => {
    try {
      const text = await file.text();
      let parsed;
      try { parsed = JSON.parse(text); }
      catch (_) { toast.error('Arquivo JSON inválido'); return; }
      if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
        toast.error('JSON sem nodes/edges — exporte um fluxo deste sistema antes de importar.');
        return;
      }
      const { data } = await crmAPI.importFlow(parsed);
      toast.success(`Fluxo "${data.name}" importado!`);
      reload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Erro ao importar fluxo');
    }
  };

  const saveFlow = async () => {
    if (!currentFlow) return;
    try {
      // Strip non-serializable fields (onDelete callback) before saving
      const cleanNodes = nodes.map(n => ({
        ...n,
        data: {
          nodeType: n.data?.nodeType,
          label: n.data?.label,
          config: n.data?.config,
        },
      }));
      await crmAPI.updateFlow(currentFlow.id, { nodes: cleanNodes, edges });
      toast.success('Fluxo salvo!');
      reload();
    } catch (e) { toast.error('Erro ao salvar'); }
  };

  const addNode = (typeKey) => {
    const cfg = NODE_TYPE_BY_KEY[typeKey];
    const id = `${typeKey}_${Date.now()}`;
    const summary = typeKey === 'start' ? 'Inicio do fluxo'
      : typeKey === 'message' ? 'Clique para configurar a mensagem'
      : `Configure ${cfg.label}`;
    const newNode = {
      id, type: 'flow',
      position: { x: 250 + (nodes.length * 30), y: 80 + (nodes.length * 30) },
      data: { nodeType: typeKey, label: cfg.label, config: { summary }, onDelete: deleteNode }
    };
    setNodes(ns => [...ns, newNode]);
  };

  const updateNodeConfig = (nodeId, config) => {
    setNodes(ns => ns.map(n => n.id === nodeId ? { ...n, data: { ...n.data, config: { ...config, summary: buildSummary(n.data.nodeType, config) } } } : n));
  };

  if (showFlowsList) {
    return (
      <div className="p-4 lg:p-6 animate-fade-in" data-testid="flows-list-page">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold font-page-title">Fluxos de Conversa</h2>
          <div className="flex items-center gap-2">
            <input
              type="file"
              accept=".json,application/json"
              ref={importFileRef}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importFlowFromFile(f);
                e.target.value = ''; // allow re-importing the same file
              }}
              className="hidden"
              data-testid="import-flow-file-input"
            />
            <button
              onClick={() => importFileRef.current?.click()}
              className="text-sm flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
              data-testid="import-flow-btn"
              title="Importar fluxo de um arquivo JSON do computador">
              <Upload className="w-4 h-4" /> Importar Fluxo
            </button>
            <button onClick={newFlow} className="btn-primary text-sm flex items-center gap-1.5" data-testid="new-flow-btn"><Plus className="w-4 h-4" /> Novo Fluxo</button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {flows.length === 0 ? (
            <div className="col-span-full text-center py-12">
              <Zap className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">Nenhum fluxo criado</p>
              <button onClick={newFlow} className="mt-3 text-xs font-semibold text-primary hover:underline">+ Criar primeiro fluxo</button>
            </div>
          ) : flows.map(f => (
            <div key={f.id} className="card !p-3 cursor-pointer hover:shadow-md transition-shadow" onClick={() => openFlow(f)} data-testid={`flow-${f.id}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-900 truncate">{f.name}</p>
                  <p className="text-[11px] text-slate-500">{f.nodes?.length || 0} nos · {f.edges?.length || 0} conexoes</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); renameFlow(f); }}
                  className="p-1 rounded text-slate-400 hover:text-blue-500"
                  data-testid={`rename-flow-${f.id}`}
                  title="Renomear fluxo"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); exportFlow(f); }}
                  className="p-1 rounded text-slate-400 hover:text-emerald-500"
                  data-testid={`export-flow-${f.id}`}
                  title="Exportar JSON"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
                <button onClick={(e) => { e.stopPropagation(); deleteFlow(f); }} className="p-1 rounded text-slate-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full" data-testid="flow-builder-page">
      {/* Sidebar of node types */}
      <div className={`${showSidebar ? 'w-56' : 'w-0'} flex-shrink-0 bg-white border-r border-slate-200 transition-all overflow-hidden flex flex-col`}>
        <div className="p-3 border-b border-slate-200 flex items-center justify-between">
          <button onClick={() => setShowFlowsList(true)} className="text-xs font-semibold text-slate-500 hover:text-primary flex items-center gap-1"><ChevronLeft className="w-3 h-3" /> Voltar</button>
          <button onClick={() => setShowSidebar(false)} className="p-1 rounded hover:bg-slate-100"><X className="w-3 h-3" /></button>
        </div>
        <div className="p-2 space-y-1 overflow-y-auto flex-1">
          <p className="text-[10px] font-bold uppercase text-slate-400 px-2 pt-2 pb-1">Adicionar No</p>
          {NODE_TYPES.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.type} onClick={() => addNode(t.type)} className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-slate-50 text-left transition-colors" data-testid={`add-node-${t.type}`}>
                <div className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: `${t.color}20`, color: t.color }}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <span className="text-xs font-semibold text-slate-700">{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative">
        {!showSidebar && (
          <button onClick={() => setShowSidebar(true)} className="absolute top-3 left-3 z-10 px-2 py-1 rounded bg-white shadow border border-slate-200 text-xs font-semibold">+ Nos</button>
        )}
        <div className="absolute top-3 right-3 z-10 flex gap-2">
          <span className="px-3 py-1.5 rounded-lg bg-white shadow border border-slate-200 text-xs font-semibold text-slate-700 max-w-[200px] truncate">{currentFlow?.name}</span>
          <button onClick={saveFlow} className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold flex items-center gap-1 shadow-md hover:bg-primary/90" data-testid="save-flow-btn">
            <Save className="w-3.5 h-3.5" /> Salvar
          </button>
        </div>
        {nodes.length > 0 && edges.length === 0 && (
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-10 bg-amber-50 border border-amber-200 text-amber-800 text-[11px] px-3 py-1.5 rounded-lg shadow-sm pointer-events-none">
            💡 Arraste do <span className="font-bold">circulo inferior</span> de um no ate o <span className="font-bold">circulo superior</span> de outro para conectar
          </div>
        )}
        {/* 2026-02-17 — Live anomaly counter banner */}
        {(() => {
          const totalAnomalies = nodes.reduce(
            (sum, n) => sum + ((n.data?.anomalies?.length) || 0),
            0,
          );
          const orphanCount = nodes.filter(n => (n.data?.anomalies || []).length > 0).length;
          if (totalAnomalies === 0) return null;
          return (
            <div
              className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-rose-50 border-2 border-rose-300 text-rose-800 text-xs font-semibold px-4 py-2 rounded-xl shadow-md flex items-center gap-2"
              data-testid="flow-anomaly-banner"
            >
              <span className="text-base">⚠</span>
              <span>
                {orphanCount} no(s) com {totalAnomalies} problema(s) de conexao —
                veja o circulo vermelho <strong>!</strong> em cada no afetado
              </span>
            </div>
          );
        })()}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, n) => setSelectedNode(n)}
          nodeTypes={nodeTypes}
          deleteKeyCode={['Backspace', 'Delete']}
          fitView
        >
          <Background />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>

      {selectedNode && (
        <NodeEditor
          node={selectedNode}
          aiAgents={aiAgents}
          tagsList={tagsList}
          queuesList={queuesList}
          usersList={usersList}
          onClose={() => setSelectedNode(null)}
          onSave={(config) => { updateNodeConfig(selectedNode.id, config); setSelectedNode(null); }}
          onDelete={() => deleteNode(selectedNode.id)}
        />
      )}
    </div>
  );
};

function buildSummary(nodeType, config) {
  if (!config) return '';
  switch (nodeType) {
    case 'message': return (config.text || '').slice(0, 100) || 'Mensagem vazia';
    case 'menu':    {
      const opts = config.options || [];
      const labels = opts.map(o => typeof o === 'string' ? o : (o?.label || '')).filter(Boolean);
      if (opts.length === 0) return 'Sem opcoes';
      return `${opts.length} opcoes: ${labels.slice(0, 2).join(', ')}${labels.length > 2 ? '...' : ''}`;
    }
    case 'delay':   return `Aguarda ${config.seconds || 0}s`;
    case 'ticket':  return `Fila: ${config.queue_name || 'nao definida'}`;
    case 'tag':     return `${config.action || 'add'} #${config.tag_name || ''}`;
    case 'ai_agent':return `Agente: ${config.agent_name || 'nao definido'}`;
    case 'http':    return `${config.method || 'GET'} ${(config.url || '').slice(0, 40)}`;
    case 'random':  return `${(config.branches || 2)} caminhos aleatorios`;
    case 'start':   return 'Inicio do fluxo';
    default: return '';
  }
}

const NodeEditor = ({ node, aiAgents, tagsList = [], queuesList = [], usersList = [], onClose, onSave, onDelete }) => {
  const [config, setConfig] = useState(node.data?.config || {});
  const cfg = NODE_TYPE_BY_KEY[node.data?.nodeType];
  const Icon = cfg?.icon || MessageSquare;

  const insertVariable = (varName) => {
    const text = (config.text || '') + (config.text ? ' ' : '') + `{${varName}}`;
    setConfig({ ...config, text });
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-end sm:items-center justify-center p-2 sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-2xl w-full max-w-md max-h-[95vh] overflow-hidden flex flex-col" onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-200 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white" style={{ background: cfg?.color }}>
            <Icon className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold">{cfg?.label}</h3>
            <p className="text-[11px] text-slate-500">{cfg?.desc}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
        </div>
        <div className="overflow-y-auto p-4 space-y-3 flex-1">
          {node.data?.nodeType === 'message' && (
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-400">Mensagem</label>
              <textarea value={config.text || ''} onChange={e => setConfig({...config, text: e.target.value})} rows={5} className="input-field text-sm" placeholder="Ola {nome}! ..." data-testid="msg-text" />
              <div className="mt-2 flex flex-wrap gap-1.5">
                <p className="text-[10px] font-bold uppercase text-slate-400 w-full">Inserir variavel:</p>
                <button onClick={() => insertVariable('saudacao')} className="text-[10px] px-2 py-1 rounded-full bg-amber-100 text-amber-800 font-semibold hover:bg-amber-200" data-testid="var-saudacao">
                  ☀ Saudacao
                </button>
                <button onClick={() => insertVariable('nome')} className="text-[10px] px-2 py-1 rounded-full bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200">
                  Nome
                </button>
                <button onClick={() => insertVariable('telefone')} className="text-[10px] px-2 py-1 rounded-full bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200">
                  Telefone
                </button>
                <button onClick={() => insertVariable('protocolo')} className="text-[10px] px-2 py-1 rounded-full bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200">
                  Protocolo
                </button>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">{`{saudacao}`} retorna "Bom dia/Boa tarde/Boa noite" conforme a hora do envio.</p>

              {/* Captura de resposta — 2026-02-15 (E). Quando capture_var
                  esta setado, o engine PAUSA aqui esperando a resposta do
                  cliente. Com capture_format = cpf/cnpj/cpfcnpj/email/cep,
                  o engine valida o formato e re-pergunta se invalido —
                  garantindo que o cliente nao avance no fluxo sem dar a
                  informacao no formato correto. */}
              <div className="mt-4 p-3 rounded-lg bg-indigo-50/40 border border-indigo-200 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-700">Capturar resposta do cliente</p>
                  {config.capture_var && (
                    <button
                      type="button"
                      onClick={() => setConfig({
                        ...config,
                        capture_var: '',
                        capture_format: '',
                        capture_invalid_message: '',
                      })}
                      className="text-[10px] font-bold text-rose-600 hover:text-rose-800 underline"
                      data-testid="msg-clear-capture-btn"
                      title="Remove a pausa — fluxo passa direto ao proximo no"
                    >
                      Limpar captura
                    </button>
                  )}
                </div>
                {config.capture_var && (
                  <div className="text-[10px] text-amber-900 bg-amber-100 border border-amber-300 rounded px-2 py-1.5 leading-tight">
                    ⏸ <strong>Atencao:</strong> este no esta com captura ATIVADA. O fluxo PAUSA aqui ate o cliente responder
                    {config.capture_format ? ` no formato ${config.capture_format.toUpperCase()}` : ''}.
                    Se o cliente responder algo invalido, o bot re-envia esta mesma mensagem e nao avanca para o proximo no.
                    Se voce nao quer pausa, clique em <strong>Limpar captura</strong>.
                  </div>
                )}
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-500">Variavel para guardar a resposta</label>
                  <input
                    value={config.capture_var || ''}
                    onChange={e => setConfig({...config, capture_var: e.target.value})}
                    placeholder="ex: cpf_cliente, email, contrato_id"
                    className="input-field text-sm"
                    data-testid="msg-capture-var"
                  />
                  <p className="text-[10px] text-slate-500 mt-0.5">Se preenchido, o fluxo PAUSA aqui ate o cliente responder. A resposta vai parar em <code>{`{${config.capture_var || 'sua_variavel'}}`}</code>.</p>
                </div>
                {config.capture_var && (
                  <>
                    <div>
                      <label className="text-[10px] font-bold uppercase text-slate-500">Validar formato (opcional)</label>
                      <select
                        value={config.capture_format || ''}
                        onChange={e => setConfig({...config, capture_format: e.target.value})}
                        className="input-field text-sm"
                        data-testid="msg-capture-format"
                      >
                        <option value="">Sem validacao (aceita qualquer texto)</option>
                        <option value="cpf">CPF (11 digitos)</option>
                        <option value="cnpj">CNPJ (14 digitos)</option>
                        <option value="cpfcnpj">CPF ou CNPJ</option>
                        <option value="email">Email</option>
                        <option value="cep">CEP (8 digitos)</option>
                        <option value="phone">Telefone (DDD + numero)</option>
                        <option value="number">Apenas numeros</option>
                      </select>
                      <p className="text-[10px] text-slate-500 mt-0.5">Quando invalido, o fluxo repete a pergunta — o cliente nao avanca ate enviar no formato correto.</p>
                    </div>
                    {config.capture_format && (
                      <div>
                        <label className="text-[10px] font-bold uppercase text-slate-500">Mensagem de erro (opcional)</label>
                        <input
                          value={config.capture_invalid_message || ''}
                          onChange={e => setConfig({...config, capture_invalid_message: e.target.value})}
                          placeholder="Por favor envie um CPF valido."
                          className="input-field text-sm"
                          data-testid="msg-capture-invalid-msg"
                        />
                        <p className="text-[10px] text-slate-500 mt-0.5">Se vazio, usa a mensagem padrao do sistema.</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
          {node.data?.nodeType === 'menu' && (
            <div className="space-y-2">
              <div><label className="text-[10px] font-bold uppercase text-slate-400">Pergunta enviada ao cliente</label>
                <textarea value={config.question || ''} onChange={e => setConfig({...config, question: e.target.value})} rows={2} className="input-field text-sm" placeholder="Ex: Como posso ajudar?" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-400">Formato</label>
                  <select
                    value={config.options_format || 'text'}
                    onChange={e => setConfig({...config, options_format: e.target.value})}
                    className="input-field text-sm"
                    data-testid="menu-options-format"
                  >
                    <option value="text">Texto numerado (cliente digita)</option>
                    <option value="buttons">Botoes (max 3)</option>
                    <option value="list">Lista (suporta ate 10)</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-400">Variavel dinamica (opcional)</label>
                  <input
                    value={config.dynamic_source || ''}
                    onChange={e => setConfig({...config, dynamic_source: e.target.value})}
                    placeholder="ex: contratos_lista"
                    className="input-field text-sm"
                    data-testid="menu-dynamic-source"
                  />
                </div>
              </div>
              <p className="text-[10px] text-slate-500">
                Variavel dinamica: quando preenchida, o menu usa a lista carregada em runtime (ex.: contratos do SGP). Cada item vira automaticamente uma opcao com o titulo, descricao e id retornados pela integracao.
              </p>
              <div className="bg-violet-50 border border-violet-200 rounded p-2 text-[11px] text-violet-800">
                💡 Cada opção vira uma <strong>saída separada</strong> no nó. Conecte cada saída ao próximo nó (mensagem, fila, etc.) para criar caminhos diferentes.
              </div>
              <label className="text-[10px] font-bold uppercase text-slate-400">Opcoes estaticas (ignoradas quando variavel dinamica esta definida)</label>
              {(config.options || []).map((o, i) => {
                const opt = typeof o === 'string' ? { label: o } : o;
                return (
                  <div key={i} className="flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-violet-500 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
                    <input
                      value={opt.label || ''}
                      onChange={e => {
                        const x = [...(config.options || [])];
                        x[i] = { ...opt, label: e.target.value };
                        setConfig({...config, options: x});
                      }}
                      className="input-field text-sm flex-1"
                      placeholder={`Texto da opcao ${i + 1}`}
                      data-testid={`menu-option-${i}`}
                    />
                    <button onClick={() => setConfig({...config, options: (config.options || []).filter((_, idx) => idx !== i)})} className="p-1 rounded text-red-500 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                );
              })}
              <button
                onClick={() => setConfig({...config, options: [...(config.options || []), { label: '' }]})}
                className="btn-secondary text-xs w-full"
                data-testid="add-menu-option"
              >+ Adicionar opcao</button>
            </div>
          )}
          {node.data?.nodeType === 'delay' && (
            <div><label className="text-[10px] font-bold uppercase text-slate-400">Tempo (segundos)</label>
              <input type="number" min="1" value={config.seconds || 5} onChange={e => setConfig({...config, seconds: parseInt(e.target.value) || 5})} className="input-field text-sm" /></div>
          )}
          {node.data?.nodeType === 'ticket' && (
            <div className="space-y-2">
              <div><label className="text-[10px] font-bold uppercase text-slate-400">Fila</label>
                <select
                  value={config.queue_id || ''}
                  onChange={e => {
                    const newQueueId = e.target.value;
                    const q = queuesList.find(x => x.id === newQueueId);
                    // 2026-02-28 — Ao trocar a fila, remove analistas
                    // selecionados que NAO pertencem a nova fila (evita
                    // ficar com referencias orfas no menu).
                    const curIds = Array.isArray(config.assigned_user_ids)
                      ? config.assigned_user_ids
                      : (config.assigned_user_id ? [config.assigned_user_id] : []);
                    const validIds = newQueueId
                      ? curIds.filter(uid => {
                          const u = usersList.find(x => x.id === uid);
                          return u && Array.isArray(u.allowed_queue_ids) && u.allowed_queue_ids.includes(newQueueId);
                        })
                      : [];
                    setConfig({
                      ...config,
                      queue_id: newQueueId,
                      queue_name: q?.name || '',
                      assigned_user_ids: validIds,
                      assigned_user_id: validIds.length === 1 ? validIds[0] : '',
                    });
                  }}
                  className="input-field text-sm"
                  data-testid="ticket-queue-select"
                >
                  <option value="">Selecione uma fila</option>
                  {queuesList.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}
                </select>
                {queuesList.length === 0 && <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-1">Nenhuma fila cadastrada. Va em "Filas" para criar.</p>}
              </div>
              {/* 2026-02-28 — Roteamento opcional para um ou MAIS analistas.
                  Quando >= 2 opcoes (analistas selecionados + "qualquer"),
                  o bot envia um menu numerado e espera o cliente escolher.
                  Quando <= 1 opcao, mantem o comportamento direto. */}
              {(() => {
                // Filtra usuarios pela fila selecionada — so quem tem essa
                // fila em `allowed_queue_ids` aparece pra ser marcado. Sem
                // fila escolhida, lista fica vazia (com instrucao na UI).
                const selectedQueueId = config.queue_id || '';
                const queueUsers = selectedQueueId
                  ? usersList.filter(u => Array.isArray(u.allowed_queue_ids) && u.allowed_queue_ids.includes(selectedQueueId))
                  : [];
                const ids = Array.isArray(config.assigned_user_ids)
                  ? config.assigned_user_ids
                  : (config.assigned_user_id ? [config.assigned_user_id] : []);
                return (
                  <>
                    <div>
                      <label className="text-[10px] font-bold uppercase text-slate-400">Analistas (opcional)</label>
                      <div
                        className="border border-slate-200 rounded-lg max-h-40 overflow-y-auto bg-white"
                        data-testid="ticket-user-multiselect"
                      >
                        {!selectedQueueId && (
                          <p className="text-[11px] text-amber-700 p-2 bg-amber-50">
                            Selecione uma fila acima para ver os analistas vinculados.
                          </p>
                        )}
                        {selectedQueueId && queueUsers.length === 0 && (
                          <p className="text-[11px] text-slate-500 p-2">
                            Nenhum analista vinculado a esta fila. Vincule em Usuarios.
                          </p>
                        )}
                        {queueUsers.map(u => {
                          const checked = ids.includes(u.id);
                          return (
                            <label
                              key={u.id}
                              className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer text-sm border-b border-slate-100 last:border-b-0 ${checked ? 'bg-primary/5' : 'hover:bg-slate-50'}`}
                              data-testid={`ticket-user-option-${u.id}`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  const cur = ids.slice();
                                  const next = checked ? cur.filter(x => x !== u.id) : [...cur, u.id];
                                  setConfig({
                                    ...config,
                                    assigned_user_ids: next,
                                    assigned_user_id: next.length === 1 ? next[0] : '',
                                  });
                                }}
                                className="w-3.5 h-3.5"
                              />
                              <span className="text-slate-700">{u.name || u.email || u.id}</span>
                            </label>
                          );
                        })}
                      </div>
                      <p className="text-[10px] text-slate-500 mt-1">
                        Marque um para roteamento direto, ou varios para apresentar um menu numerado ao cliente.
                      </p>
                    </div>
                    {/* Opcao adicional: "Qualquer analista" — sempre cai na fila */}
                    <div className="border border-slate-200 rounded-lg p-2 bg-slate-50">
                      <label className="flex items-start gap-2 text-xs cursor-pointer" data-testid="ticket-include-any-label">
                        <input
                          type="checkbox"
                          checked={!!config.include_any_option}
                          onChange={e => setConfig({ ...config, include_any_option: e.target.checked })}
                          className="mt-0.5"
                          data-testid="ticket-include-any-checkbox"
                        />
                        <span className="text-slate-700">Incluir opcao "qualquer analista da fila"</span>
                      </label>
                      {config.include_any_option && (
                        <div className="mt-2">
                          <label className="text-[10px] font-bold uppercase text-slate-400">Texto da opcao</label>
                          <input
                            type="text"
                            value={config.any_option_label || ''}
                            onChange={e => setConfig({ ...config, any_option_label: e.target.value })}
                            placeholder="Qualquer Analista"
                            className="input-field text-sm"
                            data-testid="ticket-any-option-label"
                          />
                        </div>
                      )}
                    </div>
                    {/* Mensagem do menu (so usada quando ha 2+ opcoes) */}
                    {(() => {
                      const totalOptions = ids.length + (config.include_any_option ? 1 : 0);
                      if (totalOptions < 2) return null;
                      return (
                        <div>
                          <label className="text-[10px] font-bold uppercase text-slate-400">Mensagem do menu</label>
                          <textarea
                            value={config.menu_message || ''}
                            onChange={e => setConfig({ ...config, menu_message: e.target.value })}
                            rows={3}
                            className="input-field text-sm font-mono"
                            placeholder={"Com qual analista voce prefere falar?\n{{options}}"}
                            data-testid="ticket-menu-message"
                          />
                          <p className="text-[10px] text-slate-500 mt-1">
                            Variaveis: <code className="font-mono">{'{{options}}'}</code> (lista numerada), <code className="font-mono">{'{{queue_name}}'}</code>, <code className="font-mono">{'{{nome}}'}</code>.
                            Se o cliente digitar uma opcao invalida, o ticket cai direto na fila.
                          </p>
                        </div>
                      );
                    })()}
                  </>
                );
              })()}
              <div><label className="text-[10px] font-bold uppercase text-slate-400">Status</label>
                <select value={config.status || 'aguardando'} onChange={e => setConfig({...config, status: e.target.value})} className="input-field text-sm">
                  <option value="aguardando">Aguardando</option>
                  <option value="atendendo">Em atendimento</option>
                  <option value="aberto">Aberto</option>
                </select></div>
              {/* 2026-05-28 — Mensagem opcional enviada ao cliente quando
                  o fluxo encaminha o ticket. Suporta {{queue_name}}. */}
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400">Mensagem de encaminhamento (opcional)</label>
                <textarea
                  value={config.transfer_message || ''}
                  onChange={e => setConfig({...config, transfer_message: e.target.value})}
                  rows={3}
                  className="input-field text-sm font-mono"
                  data-testid="ticket-transfer-message"
                  placeholder="Ex: Otimo! Estamos encaminhando voce para o setor {{queue_name}}. Aguarde, um atendente ja vai te responder."
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Variaveis disponiveis: <code className="font-mono">{'{{queue_name}}'}</code> (nome da fila), <code className="font-mono">{'{{nome}}'}</code> (nome do cliente). Deixe em branco para nao enviar nenhuma mensagem extra.
                </p>
              </div>
            </div>
          )}
          {node.data?.nodeType === 'tag' && (
            <div className="space-y-2">
              <div className="flex bg-slate-100 rounded-lg p-0.5">
                <button onClick={() => setConfig({...config, action: 'add'})} className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold ${(config.action || 'add') === 'add' ? 'bg-emerald-500 text-white' : 'text-slate-500'}`}>Adicionar</button>
                <button onClick={() => setConfig({...config, action: 'remove'})} className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold ${config.action === 'remove' ? 'bg-rose-500 text-white' : 'text-slate-500'}`}>Remover</button>
              </div>
              <div><label className="text-[10px] font-bold uppercase text-slate-400">Tag</label>
                <select
                  value={config.tag_id || ''}
                  onChange={e => {
                    const t = tagsList.find(x => x.id === e.target.value);
                    setConfig({...config, tag_id: e.target.value, tag_name: t?.name || ''});
                  }}
                  className="input-field text-sm"
                  data-testid="tag-select"
                >
                  <option value="">Selecione uma tag</option>
                  {tagsList.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                {tagsList.length === 0 && <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-1">Nenhuma tag cadastrada. Va em "Tags" para criar.</p>}
              </div>
            </div>
          )}
          {node.data?.nodeType === 'ai_agent' && (
            <div className="space-y-2">
              <div><label className="text-[10px] font-bold uppercase text-slate-400">Agente</label>
                <select value={config.agent_id || ''} onChange={e => {
                  const a = aiAgents.find(x => x.id === e.target.value);
                  setConfig({...config, agent_id: e.target.value, agent_name: a?.name || ''});
                }} className="input-field text-sm" data-testid="ai-agent-select">
                  <option value="">Selecione um agente</option>
                  {aiAgents.map(a => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
                </select></div>
              {aiAgents.length === 0 && <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">Nenhum agente cadastrado. Va em "Agentes IA" para criar.</p>}
              <div><label className="text-[10px] font-bold uppercase text-slate-400">Mensagem inicial (opcional)</label>
                <input value={config.initial_message || ''} onChange={e => setConfig({...config, initial_message: e.target.value})} className="input-field text-sm" /></div>
            </div>
          )}
          {node.data?.nodeType === 'http' && (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <div><label className="text-[10px] font-bold uppercase text-slate-400">Metodo</label>
                  <select value={config.method || 'GET'} onChange={e => setConfig({...config, method: e.target.value})} className="input-field text-sm">
                    <option>GET</option><option>POST</option><option>PUT</option><option>DELETE</option>
                  </select></div>
                <div className="col-span-2"><label className="text-[10px] font-bold uppercase text-slate-400">URL</label>
                  <input value={config.url || ''} onChange={e => setConfig({...config, url: e.target.value})} className="input-field text-sm" placeholder="https://..." /></div>
              </div>
              <div><label className="text-[10px] font-bold uppercase text-slate-400">Body (JSON)</label>
                <textarea value={config.body || ''} onChange={e => setConfig({...config, body: e.target.value})} rows={3} className="input-field text-sm font-mono" /></div>
            </div>
          )}
          {node.data?.nodeType === 'random' && (
            <div><label className="text-[10px] font-bold uppercase text-slate-400">Numero de caminhos</label>
              <input type="number" min="2" max="10" value={config.branches || 2} onChange={e => setConfig({...config, branches: parseInt(e.target.value) || 2})} className="input-field text-sm" /></div>
          )}
          {node.data?.nodeType === 'start' && (
            <p className="text-sm text-slate-500">No de inicio. Conecte sua primeira acao ao "+" deste no.</p>
          )}
        </div>
        <div className="flex justify-between items-center p-3 border-t border-slate-200 flex-shrink-0">
          <button onClick={onDelete} className="text-xs text-red-500 hover:underline flex items-center gap-1"><Trash2 className="w-3.5 h-3.5" /> Excluir no</button>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary text-sm">Cancelar</button>
            <button onClick={() => onSave(config)} className="btn-primary text-sm" data-testid="save-node-btn">Salvar</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FlowBuilderPage;
