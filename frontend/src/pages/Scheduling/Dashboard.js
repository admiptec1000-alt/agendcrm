import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { schedulingAPI } from '../../services/api';
import { LogOut, Calendar, Users, Scissors, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const SchedulingDashboard = () => {
  const { user, logout } = useAuth();
  const [appointments, setAppointments] = useState([]);
  const [services, setServices] = useState([]);
  const [professionals, setProfessionals] = useState([]);
  const [bookingPage, setBookingPage] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSchedulingData();
  }, []);

  const loadSchedulingData = async () => {
    try {
      const [appointmentsRes, servicesRes, professionalsRes, pageRes] = await Promise.all([
        schedulingAPI.getAppointments(),
        schedulingAPI.getServices(),
        schedulingAPI.getProfessionals(),
        schedulingAPI.getBookingPage()
      ]);
      setAppointments(appointmentsRes.data);
      setServices(servicesRes.data);
      setProfessionals(professionalsRes.data);
      setBookingPage(pageRes.data);
    } catch (error) {
      toast.error('Erro ao carregar dados de agendamento');
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

  const todayAppointments = appointments.filter(apt => apt.date === format(new Date(), 'yyyy-MM-dd'));

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      {/* Header */}
      <header className="glass border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold font-heading text-slate-900">{user?.company?.name}</h1>
            <p className="text-sm text-slate-600">Sistema de Agendamento</p>
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
            title="Agendamentos Hoje"
            value={todayAppointments.length}
            icon={<Calendar className="w-6 h-6" />}
            color="bg-blue-500"
          />
          <StatsCard
            title="Total Agendamentos"
            value={appointments.length}
            icon={<Clock className="w-6 h-6" />}
            color="bg-green-500"
          />
          <StatsCard
            title="Serviços"
            value={services.length}
            icon={<Scissors className="w-6 h-6" />}
            color="bg-purple-500"
          />
          <StatsCard
            title="Profissionais"
            value={professionals.length}
            icon={<Users className="w-6 h-6" />}
            color="bg-orange-500"
          />
        </div>

        {/* Booking Page Link */}
        {bookingPage?.slug && (
          <div className="card mb-8 bg-gradient-to-r from-primary/10 to-secondary/10 border-primary/20">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 mb-1">Página de Agendamento</h3>
                <p className="text-sm text-slate-600 mb-3">
                  Compartilhe este link com seus clientes para eles agendarem
                </p>
                <code className="text-sm bg-white px-3 py-1.5 rounded border border-slate-200">
                  {window.location.origin}/booking/{bookingPage.slug}
                </code>
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(`${window.location.origin}/booking/${bookingPage.slug}`);
                  toast.success('Link copiado!');
                }}
                className="btn-primary"
                data-testid="copy-booking-link-button"
              >
                Copiar Link
              </button>
            </div>
          </div>
        )}

        {/* Today's Appointments */}
        <div className="card">
          <h2 className="text-xl font-bold font-heading text-slate-900 mb-6">Agendamentos de Hoje</h2>
          <div className="space-y-3">
            {todayAppointments.length > 0 ? (
              todayAppointments.map((appointment) => (
                <div
                  key={appointment.id}
                  className="p-4 bg-slate-50 rounded-lg border border-slate-200 hover:shadow-md transition-all"
                  data-testid={`appointment-${appointment.id}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="font-medium text-slate-900">{appointment.customer_name}</p>
                      <p className="text-sm text-slate-600 mt-1">
                        {appointment.service_name} • {appointment.professional_name}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-primary">{appointment.time}</p>
                      <span className={`inline-block mt-1 px-2 py-1 rounded text-xs font-medium ${
                        appointment.status === 'confirmado' ? 'bg-green-100 text-green-700' :
                        appointment.status === 'pendente' ? 'bg-yellow-100 text-yellow-700' :
                        appointment.status === 'cancelado' ? 'bg-red-100 text-red-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {appointment.status}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-center text-slate-500 py-8">Nenhum agendamento para hoje</p>
            )}
          </div>
        </div>

        {/* Services & Professionals */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
          {/* Services */}
          <div className="card">
            <h3 className="text-lg font-bold font-heading text-slate-900 mb-4">Serviços</h3>
            <div className="space-y-2">
              {services.slice(0, 5).map((service) => (
                <div key={service.id} className="flex items-center justify-between p-3 bg-slate-50 rounded" data-testid={`service-${service.id}`}>
                  <span className="text-sm text-slate-900">{service.name}</span>
                  <span className="text-sm font-medium text-primary">
                    R$ {service.price.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Professionals */}
          <div className="card">
            <h3 className="text-lg font-bold font-heading text-slate-900 mb-4">Profissionais</h3>
            <div className="space-y-2">
              {professionals.map((professional) => (
                <div key={professional.id} className="flex items-center justify-between p-3 bg-slate-50 rounded" data-testid={`professional-${professional.id}`}>
                  <span className="text-sm text-slate-900">{professional.name}</span>
                  <span className={`text-xs px-2 py-1 rounded ${
                    professional.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                  }`}>
                    {professional.is_active ? 'Ativo' : 'Inativo'}
                  </span>
                </div>
              ))}
            </div>
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

export default SchedulingDashboard;
