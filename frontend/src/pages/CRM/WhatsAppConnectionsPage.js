import React, { useState, useEffect } from 'react';
import { whatsappAPI } from '../../services/api';
import { toast } from 'sonner';
import {
  Plus, Phone, Link, Trash2, X, Wifi, WifiOff, QrCode, RefreshCw,
  MoreVertical, Smartphone, CheckCircle2
} from 'lucide-react';

const WhatsAppConnectionsPage = () => {
  const [connections, setConnections] = useState([]);
  const [stats, setStats] = useState({});
  const [showAdd, setShowAdd] = useState(false);
  const [connectingId, setConnectingId] = useState(null);

  useEffect(() => { load(); }, []);
  const load = async () => {
    const [c, s] = await Promise.all([
      whatsappAPI.getConnections(),
      whatsappAPI.getConnectionStats()
    ]);
    setConnections(c.data);
    setStats(s.data);
  };

  const handleCreate = async (name) => {
    await whatsappAPI.createConnection({ name });
    toast.success('Conexao criada!');
    setShowAdd(false);
    load();
  };

  const handleConnect = async (connId) => {
    setConnectingId(connId);
    await whatsappAPI.connectWhatsApp(connId);
    load();
    // Simulate scan after 5s
    setTimeout(async () => {
      try {
        await whatsappAPI.simulateConnected(connId);
        toast.success('WhatsApp conectado!');
        load();
      } catch (e) { toast.error('Falha na conexao WhatsApp'); }
      setConnectingId(null);
    }, 5000);
  };

  const handleDisconnect = async (connId) => {
    await whatsappAPI.disconnectWhatsApp(connId);
    toast.info('WhatsApp desconectado');
    load();
  };

  const handleDelete = async (connId) => {
    if (!window.confirm('Deletar esta conexao?')) return;
    await whatsappAPI.deleteConnection(connId);
    toast.success('Conexao deletada');
    load();
  };

  return (
    <div className="animate-fade-in" data-testid="whatsapp-connections-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold font-heading text-slate-900">Conexoes WhatsApp</h2>
          <p className="text-sm text-slate-600">Conecte seus canais de atendimento para receber e enviar mensagens</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2" data-testid="add-connection-btn">
          <Plus className="w-4 h-4" /> Nova Conexao
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="card !p-4">
          <div className="flex items-center justify-between">
            <div><p className="text-xs text-slate-500">Total Conexoes</p><p className="text-2xl font-bold font-heading">{stats.total || 0}</p></div>
            <Link className="w-5 h-5 text-slate-400" />
          </div>
        </div>
        <div className="card !p-4">
          <div className="flex items-center justify-between">
            <div><p className="text-xs text-slate-500">Conectadas</p><p className="text-2xl font-bold font-heading text-emerald-600">{stats.connected || 0}</p></div>
            <Wifi className="w-5 h-5 text-emerald-500" />
          </div>
        </div>
        <div className="card !p-4">
          <div className="flex items-center justify-between">
            <div><p className="text-xs text-slate-500">Desconectadas</p><p className="text-2xl font-bold font-heading text-red-500">{stats.disconnected || 0}</p></div>
            <WifiOff className="w-5 h-5 text-red-400" />
          </div>
        </div>
      </div>

      {/* Connections Table */}
      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full" data-testid="connections-table">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-3 px-4 text-xs font-bold uppercase tracking-widest text-slate-400">Nome</th>
                <th className="text-left py-3 px-4 text-xs font-bold uppercase tracking-widest text-slate-400">Numero</th>
                <th className="text-left py-3 px-4 text-xs font-bold uppercase tracking-widest text-slate-400">Status</th>
                <th className="text-left py-3 px-4 text-xs font-bold uppercase tracking-widest text-slate-400">Ultima Conexao</th>
                <th className="text-left py-3 px-4 text-xs font-bold uppercase tracking-widest text-slate-400">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {connections.map(conn => (
                <tr key={conn.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors" data-testid={`conn-row-${conn.id}`}>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        conn.status === 'connected' ? 'bg-emerald-100' : 'bg-slate-100'
                      }`}>
                        <Smartphone className={`w-5 h-5 ${conn.status === 'connected' ? 'text-emerald-600' : 'text-slate-400'}`} />
                      </div>
                      <p className="font-medium text-sm text-slate-900">{conn.name}</p>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-sm text-slate-600">{conn.phone || '-'}</td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${
                        conn.status === 'connected' ? 'bg-emerald-500 animate-pulse' :
                        conn.status === 'connecting' ? 'bg-amber-500 animate-pulse' :
                        'bg-red-400'
                      }`} />
                      <span className={`text-xs font-medium ${
                        conn.status === 'connected' ? 'text-emerald-700' :
                        conn.status === 'connecting' ? 'text-amber-700' :
                        'text-red-600'
                      }`}>
                        {conn.status === 'connected' ? 'Conectado' :
                         conn.status === 'connecting' ? 'Conectando...' :
                         'Desconectado'}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-500">
                    {conn.last_connected ? new Date(conn.last_connected).toLocaleString('pt-BR') : 'Nunca'}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1">
                      {conn.status === 'disconnected' && (
                        <button onClick={() => handleConnect(conn.id)} data-testid={`connect-btn-${conn.id}`}
                          className="px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-medium hover:bg-emerald-200 transition-colors flex items-center gap-1">
                          <QrCode className="w-3 h-3" /> Conectar
                        </button>
                      )}
                      {conn.status === 'connected' && (
                        <button onClick={() => handleDisconnect(conn.id)}
                          className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-medium hover:bg-slate-200 transition-colors">
                          Desconectar
                        </button>
                      )}
                      {conn.status === 'connecting' && (
                        <span className="px-3 py-1.5 bg-amber-100 text-amber-700 rounded-lg text-xs font-medium flex items-center gap-1">
                          <RefreshCw className="w-3 h-3 animate-spin" /> Escaneie o QR
                        </span>
                      )}
                      <button onClick={() => handleDelete(conn.id)} data-testid={`delete-conn-${conn.id}`}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 hover:text-red-600 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {connections.length === 0 && (
                <tr><td colSpan={5} className="py-12 text-center text-sm text-slate-500">
                  Nenhuma conexao configurada. Clique em "Nova Conexao" para comecar.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* QR Code area for connecting connection */}
      {connectingId && (
        <div className="mt-6 card text-center">
          <h3 className="font-semibold text-slate-900 mb-4">Escaneie o QR Code</h3>
          <div className="p-6 bg-white rounded-xl border-2 border-slate-200 max-w-[280px] mx-auto">
            <div className="w-56 h-56 bg-gradient-to-br from-slate-100 to-slate-200 rounded-lg mx-auto flex items-center justify-center relative overflow-hidden">
              <div className="grid grid-cols-8 gap-0.5 p-4">
                {Array.from({length: 64}).map((_, i) => (
                  <div key={i} className={`w-4 h-4 rounded-sm ${Math.random() > 0.5 ? 'bg-slate-800' : 'bg-white'}`} />
                ))}
              </div>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-12 h-12 bg-white rounded-lg flex items-center justify-center shadow-lg">
                  <Phone className="w-6 h-6 text-emerald-600" />
                </div>
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-3">Abra WhatsApp &gt; Dispositivos conectados &gt; Conectar</p>
          </div>
        </div>
      )}

      {/* Add Modal */}
      {showAdd && (
        <AddConnectionModal onClose={() => setShowAdd(false)} onSave={handleCreate} />
      )}
    </div>
  );
};

const AddConnectionModal = ({ onClose, onSave }) => {
  const [name, setName] = useState('');
  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold font-heading">Nova Conexao</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1 block">Nome da Conexao</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: WhatsApp Principal" className="input-field" data-testid="conn-name-input" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="btn-secondary text-sm">Cancelar</button>
          <button onClick={() => name && onSave(name)} className="btn-primary text-sm" data-testid="save-conn-btn">Criar</button>
        </div>
      </div>
    </div>
  );
};

export default WhatsAppConnectionsPage;
