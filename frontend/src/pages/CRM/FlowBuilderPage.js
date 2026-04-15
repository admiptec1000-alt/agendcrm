import React, { useState, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { crmAPI } from '../../services/api';
import { toast } from 'sonner';
import {
  ReactFlow, Background, Controls, MiniMap,
  addEdge, useNodesState, useEdgesState, Handle, Position
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Plus, Save, Play, Trash2, MessageSquare, Clock, GitBranch, Zap } from 'lucide-react';

const nodeTypes = {
  trigger: TriggerNode,
  message: MessageNode,
  condition: ConditionNode,
  delay: DelayNode,
  action: ActionNode,
};

function TriggerNode({ data }) {
  return (
    <div className="bg-emerald-500 text-white rounded-xl px-5 py-3 shadow-lg min-w-[180px]">
      <div className="flex items-center gap-2 mb-1">
        <Zap className="w-4 h-4" />
        <span className="text-xs font-bold uppercase tracking-wider">Gatilho</span>
      </div>
      <p className="text-sm font-medium">{data.label}</p>
      <Handle type="source" position={Position.Bottom} className="!bg-emerald-700 !w-3 !h-3" />
    </div>
  );
}

function MessageNode({ data }) {
  return (
    <div className="bg-white border-2 border-blue-400 rounded-xl px-5 py-3 shadow-lg min-w-[180px]">
      <Handle type="target" position={Position.Top} className="!bg-blue-500 !w-3 !h-3" />
      <div className="flex items-center gap-2 mb-1">
        <MessageSquare className="w-4 h-4 text-blue-500" />
        <span className="text-xs font-bold uppercase tracking-wider text-blue-500">Mensagem</span>
      </div>
      <p className="text-sm text-slate-700">{data.label}</p>
      <Handle type="source" position={Position.Bottom} className="!bg-blue-500 !w-3 !h-3" />
    </div>
  );
}

function ConditionNode({ data }) {
  return (
    <div className="bg-white border-2 border-amber-400 rounded-xl px-5 py-3 shadow-lg min-w-[180px]">
      <Handle type="target" position={Position.Top} className="!bg-amber-500 !w-3 !h-3" />
      <div className="flex items-center gap-2 mb-1">
        <GitBranch className="w-4 h-4 text-amber-500" />
        <span className="text-xs font-bold uppercase tracking-wider text-amber-500">Condicao</span>
      </div>
      <p className="text-sm text-slate-700">{data.label}</p>
      <Handle type="source" position={Position.Bottom} id="yes" className="!bg-emerald-500 !w-3 !h-3 !left-[30%]" />
      <Handle type="source" position={Position.Bottom} id="no" className="!bg-red-500 !w-3 !h-3 !left-[70%]" />
    </div>
  );
}

function DelayNode({ data }) {
  return (
    <div className="bg-white border-2 border-violet-400 rounded-xl px-5 py-3 shadow-lg min-w-[180px]">
      <Handle type="target" position={Position.Top} className="!bg-violet-500 !w-3 !h-3" />
      <div className="flex items-center gap-2 mb-1">
        <Clock className="w-4 h-4 text-violet-500" />
        <span className="text-xs font-bold uppercase tracking-wider text-violet-500">Espera</span>
      </div>
      <p className="text-sm text-slate-700">{data.label}</p>
      <Handle type="source" position={Position.Bottom} className="!bg-violet-500 !w-3 !h-3" />
    </div>
  );
}

function ActionNode({ data }) {
  return (
    <div className="bg-white border-2 border-rose-400 rounded-xl px-5 py-3 shadow-lg min-w-[180px]">
      <Handle type="target" position={Position.Top} className="!bg-rose-500 !w-3 !h-3" />
      <div className="flex items-center gap-2 mb-1">
        <Play className="w-4 h-4 text-rose-500" />
        <span className="text-xs font-bold uppercase tracking-wider text-rose-500">Acao</span>
      </div>
      <p className="text-sm text-slate-700">{data.label}</p>
      <Handle type="source" position={Position.Bottom} className="!bg-rose-500 !w-3 !h-3" />
    </div>
  );
}

const defaultNodes = [
  { id: '1', type: 'trigger', position: { x: 250, y: 50 }, data: { label: 'Nova mensagem recebida' } },
  { id: '2', type: 'condition', position: { x: 250, y: 180 }, data: { label: 'Horario comercial?' } },
  { id: '3', type: 'message', position: { x: 80, y: 330 }, data: { label: 'Ola! Como posso ajudar?' } },
  { id: '4', type: 'message', position: { x: 420, y: 330 }, data: { label: 'Estamos fora do horario.' } },
];

const defaultEdges = [
  { id: 'e1-2', source: '1', target: '2', animated: true },
  { id: 'e2-3', source: '2', target: '3', sourceHandle: 'yes', label: 'Sim', style: { stroke: '#10B981' } },
  { id: 'e2-4', source: '2', target: '4', sourceHandle: 'no', label: 'Nao', style: { stroke: '#EF4444' } },
];

const FlowBuilderPage = () => {
  const { user } = useAuth();
  const [nodes, setNodes, onNodesChange] = useNodesState(defaultNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(defaultEdges);
  const [flowName, setFlowName] = useState('Novo Fluxo');
  const [saving, setSaving] = useState(false);

  const onConnect = useCallback((params) => {
    setEdges((eds) => addEdge({ ...params, animated: true }, eds));
  }, [setEdges]);

  const addNode = (type) => {
    const newId = `${Date.now()}`;
    const labels = {
      trigger: 'Novo gatilho',
      message: 'Nova mensagem',
      condition: 'Nova condicao',
      delay: 'Esperar 5 min',
      action: 'Nova acao',
    };
    const newNode = {
      id: newId,
      type,
      position: { x: 250 + Math.random() * 100, y: 400 + Math.random() * 100 },
      data: { label: labels[type] || 'Novo no' },
    };
    setNodes((nds) => [...nds, newNode]);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await crmAPI.createFlow({
        name: flowName,
        nodes: nodes.map(n => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
        edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle, label: e.label })),
        trigger_type: 'message',
      });
      toast.success('Fluxo salvo!');
    } catch (e) {
      toast.error('Erro ao salvar fluxo');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col" data-testid="flowbuilder-page">
      {/* Toolbar */}
      <div className="bg-white border-b border-slate-200 p-3 flex items-center gap-3">
        <input
          value={flowName}
          onChange={(e) => setFlowName(e.target.value)}
          className="input-field max-w-xs text-sm"
          data-testid="flow-name-input"
        />
        <div className="flex items-center gap-2 ml-4">
          <button onClick={() => addNode('trigger')} className="px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-medium hover:bg-emerald-200 transition-colors" data-testid="add-trigger-btn">
            <Zap className="w-3 h-3 inline mr-1" />Gatilho
          </button>
          <button onClick={() => addNode('message')} className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg text-xs font-medium hover:bg-blue-200 transition-colors" data-testid="add-message-btn">
            <MessageSquare className="w-3 h-3 inline mr-1" />Mensagem
          </button>
          <button onClick={() => addNode('condition')} className="px-3 py-1.5 bg-amber-100 text-amber-700 rounded-lg text-xs font-medium hover:bg-amber-200 transition-colors" data-testid="add-condition-btn">
            <GitBranch className="w-3 h-3 inline mr-1" />Condicao
          </button>
          <button onClick={() => addNode('delay')} className="px-3 py-1.5 bg-violet-100 text-violet-700 rounded-lg text-xs font-medium hover:bg-violet-200 transition-colors" data-testid="add-delay-btn">
            <Clock className="w-3 h-3 inline mr-1" />Espera
          </button>
          <button onClick={() => addNode('action')} className="px-3 py-1.5 bg-rose-100 text-rose-700 rounded-lg text-xs font-medium hover:bg-rose-200 transition-colors" data-testid="add-action-btn">
            <Play className="w-3 h-3 inline mr-1" />Acao
          </button>
        </div>
        <button onClick={handleSave} disabled={saving} data-testid="save-flow-btn"
          className="ml-auto btn-primary text-sm flex items-center gap-2">
          <Save className="w-4 h-4" />{saving ? 'Salvando...' : 'Salvar Fluxo'}
        </button>
      </div>

      {/* Canvas */}
      <div className="flex-1" style={{ height: 'calc(100vh - 180px)' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          className="bg-slate-50"
        >
          <Background variant="dots" gap={20} size={1} color="#CBD5E1" />
          <Controls />
          <MiniMap nodeStrokeWidth={3} />
        </ReactFlow>
      </div>
    </div>
  );
};

export default FlowBuilderPage;
