import React, { useState, useEffect, useCallback } from 'react';
import ReactFlow, {
  Background, Controls, MiniMap,
  applyNodeChanges, applyEdgeChanges, addEdge,
  MarkerType, Handle, Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { crmAPI, aiAPI } from '../../services/api';
import { toast } from 'sonner';
import {
  Save, Plus, Trash2, X, MessageSquare, MenuSquare,
  Shuffle, Clock, Ticket as TicketIcon, Tag, Bot, Globe, Zap,
  ChevronLeft
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

  return (
    <div
      className="rounded-lg shadow-md bg-white border-2 min-w-[200px] max-w-[260px] group relative"
      style={{ borderColor: cfg.color }}
      data-testid={`flow-node-${data.nodeType}`}
    >
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
      </div>
      <div className="p-2.5">
        <p className="text-[12px] text-slate-700 line-clamp-3">{summary}</p>
      </div>

      {/* Source handle (output) — bottom of node */}
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: cfg.color, width: 10, height: 10, border: '2px solid white' }}
        isConnectable
      />
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
  useEffect(() => {
    reload();
    aiAPI.listAgents().then(r => setAiAgents(r.data)).catch(() => {});
  }, []);

  const deleteNode = useCallback((nodeId) => {
    setNodes(ns => ns.filter(n => n.id !== nodeId));
    setEdges(es => es.filter(e => e.source !== nodeId && e.target !== nodeId));
    setSelectedNode(null);
  }, []);

  // Inject onDelete into node data so the inline X works
  const decorateNode = useCallback((n) => ({
    ...n,
    type: 'flow',
    data: { ...n.data, onDelete: deleteNode },
  }), [deleteNode]);

  const onNodesChange = useCallback(changes => setNodes(ns => applyNodeChanges(changes, ns)), []);
  const onEdgesChange = useCallback(changes => setEdges(es => applyEdgeChanges(changes, es)), []);
  const onConnect = useCallback(params => setEdges(es => addEdge({
    ...params,
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { strokeWidth: 2 },
    animated: true,
  }, es)), []);

  const openFlow = (flow) => {
    setCurrentFlow(flow);
    setShowFlowsList(false);
    setNodes((flow.nodes || []).map(decorateNode));
    setEdges(flow.edges || []);
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
          <button onClick={newFlow} className="btn-primary text-sm flex items-center gap-1.5" data-testid="new-flow-btn"><Plus className="w-4 h-4" /> Novo Fluxo</button>
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
    case 'menu':    return `${(config.options || []).length} opcoes`;
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

const NodeEditor = ({ node, aiAgents, onClose, onSave, onDelete }) => {
  const [config, setConfig] = useState(node.data?.config || {});
  const cfg = NODE_TYPE_BY_KEY[node.data?.nodeType];
  const Icon = cfg?.icon || MessageSquare;

  return (
    <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-end sm:items-center justify-center p-2 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-2xl w-full max-w-md max-h-[95vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
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
              <p className="text-[10px] text-slate-400 mt-1">Variaveis: {`{nome} {telefone} {protocolo}`}</p>
            </div>
          )}
          {node.data?.nodeType === 'menu' && (
            <div className="space-y-2">
              <div><label className="text-[10px] font-bold uppercase text-slate-400">Pergunta</label>
                <textarea value={config.question || ''} onChange={e => setConfig({...config, question: e.target.value})} rows={2} className="input-field text-sm" /></div>
              <label className="text-[10px] font-bold uppercase text-slate-400">Opcoes</label>
              {(config.options || []).map((o, i) => (
                <div key={i} className="flex items-center gap-1">
                  <input value={o} onChange={e => { const x = [...config.options]; x[i] = e.target.value; setConfig({...config, options: x}); }} className="input-field text-sm flex-1" placeholder={`Opcao ${i+1}`} />
                  <button onClick={() => setConfig({...config, options: config.options.filter((_, idx) => idx !== i)})} className="p-1 rounded text-red-500 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
              <button onClick={() => setConfig({...config, options: [...(config.options || []), '']})} className="btn-secondary text-xs w-full">+ Adicionar opcao</button>
            </div>
          )}
          {node.data?.nodeType === 'delay' && (
            <div><label className="text-[10px] font-bold uppercase text-slate-400">Tempo (segundos)</label>
              <input type="number" min="1" value={config.seconds || 5} onChange={e => setConfig({...config, seconds: parseInt(e.target.value) || 5})} className="input-field text-sm" /></div>
          )}
          {node.data?.nodeType === 'ticket' && (
            <div className="space-y-2">
              <div><label className="text-[10px] font-bold uppercase text-slate-400">Nome da Fila</label>
                <input value={config.queue_name || ''} onChange={e => setConfig({...config, queue_name: e.target.value})} className="input-field text-sm" placeholder="Ex: Vendas, Suporte" /></div>
              <div><label className="text-[10px] font-bold uppercase text-slate-400">Status</label>
                <select value={config.status || 'aguardando'} onChange={e => setConfig({...config, status: e.target.value})} className="input-field text-sm">
                  <option value="aguardando">Aguardando</option>
                  <option value="atendendo">Em atendimento</option>
                  <option value="aberto">Aberto</option>
                </select></div>
            </div>
          )}
          {node.data?.nodeType === 'tag' && (
            <div className="space-y-2">
              <div className="flex bg-slate-100 rounded-lg p-0.5">
                <button onClick={() => setConfig({...config, action: 'add'})} className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold ${(config.action || 'add') === 'add' ? 'bg-emerald-500 text-white' : 'text-slate-500'}`}>Adicionar</button>
                <button onClick={() => setConfig({...config, action: 'remove'})} className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold ${config.action === 'remove' ? 'bg-rose-500 text-white' : 'text-slate-500'}`}>Remover</button>
              </div>
              <div><label className="text-[10px] font-bold uppercase text-slate-400">Nome da tag</label>
                <input value={config.tag_name || ''} onChange={e => setConfig({...config, tag_name: e.target.value})} className="input-field text-sm" placeholder="Ex: Lead Qualificado" /></div>
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
