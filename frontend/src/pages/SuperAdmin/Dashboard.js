import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { superAdminAPI } from '../../services/api';
import { LogOut, Users, TrendingUp, Building, DollarSign } from 'lucide-react';
import { toast } from 'sonner';

const SuperAdminDashboard = () => {
  const { user, logout } = useAuth();
  const [stats, setStats] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      const [statsRes, companiesRes] = await Promise.all([
        superAdminAPI.getDashboard(),
        superAdminAPI.getCompanies()
      ]);
      setStats(statsRes.data);
      setCompanies(companiesRes.data);
    } catch (error) {
      toast.error('Erro ao carregar dados');
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

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      {/* Header */}
      <header className="glass border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold font-heading text-slate-900">AgentCRM</h1>
            <p className="text-sm text-slate-600">Super Admin Dashboard</p>
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
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatsCard
            title="Total de Empresas"
            value={stats?.total_companies || 0}
            icon={<Building className="w-6 h-6" />}
            color="bg-blue-500"
          />
          <StatsCard
            title="Empresas Ativas"
            value={stats?.active_companies || 0}
            icon={<TrendingUp className="w-6 h-6" />}
            color="bg-green-500"
          />
          <StatsCard
            title="Planos CRM"
            value={stats?.crm_plans || 0}
            icon={<Users className="w-6 h-6" />}
            color="bg-purple-500"
          />
          <StatsCard
            title="Planos Agendamento"
            value={stats?.scheduling_plans || 0}
            icon={<DollarSign className="w-6 h-6" />}
            color="bg-orange-500"
          />
        </div>

        {/* Companies Table */}
        <div className="card">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold font-heading text-slate-900">Empresas</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-3 px-4 text-sm font-medium text-slate-700">Empresa</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-slate-700">Email</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-slate-700">Plano</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-slate-700">Status</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((company) => (
                  <tr key={company.id} className="border-b border-slate-100 hover:bg-slate-50" data-testid={`company-row-${company.id}`}>
                    <td className="py-3 px-4 text-sm text-slate-900 font-medium">{company.name}</td>
                    <td className="py-3 px-4 text-sm text-slate-600">{company.email}</td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                        {company.plan_type}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        company.status === 'active' ? 'bg-green-100 text-green-700' :
                        company.status === 'trial' ? 'bg-blue-100 text-blue-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {company.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
};

const StatsCard = ({ title, value, icon, color }) => (
  <div className="card" data-testid={`stats-${title.toLowerCase().replace(/\s+/g, '-')}`}>
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm text-slate-600 mb-1">{title}</p>
        <p className="text-3xl font-bold font-heading text-slate-900">{value}</p>
      </div>
      <div className={`${color} p-3 rounded-lg text-white`}>
        {icon}
      </div>
    </div>
  </div>
);

export default SuperAdminDashboard;
