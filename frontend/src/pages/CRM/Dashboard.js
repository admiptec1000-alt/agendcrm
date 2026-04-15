import React, { useState, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { crmAPI } from '../../services/api';
import { LogOut, Layout, MessageSquare, Zap, Users, Tag } from 'lucide-react';
import { toast } from 'sonner';

const CRMDashboard = () => {
  const { user, logout } = useAuth();
  const [kanbanData, setKanbanData] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCRMData();
  }, []);

  const loadCRMData = async () => {
    try {
      const [kanbanRes, ticketsRes] = await Promise.all([
        crmAPI.getKanban(),
        crmAPI.getTickets()
      ]);
      setKanbanData(kanbanRes.data);
      setTickets(ticketsRes.data);
    } catch (error) {
      toast.error('Erro ao carregar dados do CRM');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  const columns = [
    { key: 'aberto', label: 'Aberto', color: 'bg-blue-500' },
    { key: 'em_cobranca', label: 'Em Cobrança', color: 'bg-yellow-500' },
    { key: 'pago', label: 'Pago', color: 'bg-green-500' },
    { key: 'bloqueado', label: 'Bloqueado', color: 'bg-red-500' },
    { key: 'proposta', label: 'Proposta', color: 'bg-purple-500' },
  ];

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      {/* Header */}
      <header className="glass border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold font-heading text-slate-900">{user?.company?.name}</h1>
            <p className="text-sm text-slate-600">CRM Dashboard</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-slate-900">{user?.name}</p>
              <p className="text-xs text-slate-600">{user?.email}</p>
            </div>
            <button
              onClick={logout}
              data-testid="logout-button"
              className="btn-secondary flex items-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              Sair
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h2 className="text-2xl font-bold font-heading text-slate-900 mb-2">Kanban de Atendimento</h2>
          <p className="text-slate-600">Gerencie seus tickets de atendimento</p>
        </div>

        {/* Kanban Board */}
        <div className="flex gap-4 overflow-x-auto pb-4">
          {columns.map((column) => (
            <div key={column.key} className="flex-shrink-0 w-80" data-testid={`kanban-column-${column.key}`}>
              <div className="card">
                <div className="flex items-center gap-2 mb-4">
                  <div className={`w-3 h-3 rounded-full ${column.color}`}></div>
                  <h3 className="font-semibold text-slate-900">{column.label}</h3>
                  <span className="ml-auto text-sm text-slate-600">
                    {kanbanData?.[column.key]?.length || 0}
                  </span>
                </div>
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {kanbanData?.[column.key]?.map((ticket) => (
                    <div
                      key={ticket.id}
                      className="p-4 bg-slate-50 rounded-lg border border-slate-200 hover:shadow-md transition-all cursor-pointer"
                      data-testid={`ticket-card-${ticket.id}`}
                    >
                      <p className="font-medium text-slate-900 mb-2">{ticket.customer_name}</p>
                      <p className="text-sm text-slate-600 mb-2">{ticket.customer_phone}</p>
                      {ticket.description && (
                        <p className="text-xs text-slate-500 line-clamp-2">{ticket.description}</p>
                      )}
                      <div className="mt-3 flex items-center gap-2">
                        <span className="text-xs px-2 py-1 rounded bg-white border border-slate-200">
                          {ticket.channel}
                        </span>
                        <span className={`text-xs px-2 py-1 rounded ${
                          ticket.priority === 'high' ? 'bg-red-100 text-red-700' :
                          ticket.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-green-100 text-green-700'
                        }`}>
                          {ticket.priority}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Quick Actions */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-4 gap-4">
          <QuickAction icon={<MessageSquare />} label="Novo Ticket" color="bg-blue-500" />
          <QuickAction icon={<Zap />} label="Respostas Rápidas" color="bg-yellow-500" />
          <QuickAction icon={<Users />} label="Campanhas" color="bg-green-500" />
          <QuickAction icon={<Tag />} label="Tags" color="bg-purple-500" />
        </div>
      </main>
    </div>
  );
};

const QuickAction = ({ icon, label, color }) => (
  <button className="card hover:shadow-lg transition-all group" data-testid={`quick-action-${label.toLowerCase().replace(/\s+/g, '-')}`}>
    <div className="flex items-center gap-3">
      <div className={`${color} p-3 rounded-lg text-white group-hover:scale-110 transition-transform`}>
        {React.cloneElement(icon, { className: 'w-5 h-5' })}
      </div>
      <span className="font-medium text-slate-900">{label}</span>
    </div>
  </button>
);

export default CRMDashboard;
