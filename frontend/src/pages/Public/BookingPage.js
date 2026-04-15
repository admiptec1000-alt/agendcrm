import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { publicAPI } from '../../services/api';
import { toast } from 'sonner';
import { Calendar, Clock, User, Phone, Mail } from 'lucide-react';

const PublicBooking = () => {
  const { slug } = useParams();
  const [step, setStep] = useState(1);
  const [pageData, setPageData] = useState(null);
  const [services, setServices] = useState([]);
  const [professionals, setProfessionals] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const [formData, setFormData] = useState({
    service_id: '',
    professional_id: '',
    date: '',
    time: '',
    customer_name: '',
    customer_phone: '',
    customer_email: ''
  });

  useEffect(() => {
    loadPageData();
  }, [slug]);

  const loadPageData = async () => {
    try {
      const [pageRes, servicesRes, professionalsRes] = await Promise.all([
        publicAPI.getBookingPage(slug),
        publicAPI.getServices(slug),
        publicAPI.getProfessionals(slug)
      ]);
      setPageData(pageRes.data);
      setServices(servicesRes.data.services);
      setProfessionals(professionalsRes.data);
    } catch (error) {
      toast.error('Página de agendamento não encontrada');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await publicAPI.createBooking(slug, formData);
      toast.success('Agendamento realizado com sucesso!');
      // Reset form
      setFormData({
        service_id: '',
        professional_id: '',
        date: '',
        time: '',
        customer_name: '',
        customer_phone: '',
        customer_email: ''
      });
      setStep(1);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao realizar agendamento');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!pageData) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-slate-600">Página não encontrada</p>
      </div>
    );
  }

  const steps = [
    { number: 1, label: 'Serviço' },
    { number: 2, label: 'Profissional' },
    { number: 3, label: 'Data e Hora' },
    { number: 4, label: 'Seus Dados' }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      {/* Header */}
      <header className="glass border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <h1 className="text-3xl font-bold font-heading text-slate-900 mb-2">
            {pageData.company.name}
          </h1>
          <p className="text-slate-600">Agende seu horário</p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12">
        {/* Progress Steps */}
        <div className="flex items-center justify-center mb-12">
          {steps.map((s, idx) => (
            <React.Fragment key={s.number}>
              <div className="flex flex-col items-center">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold ${
                  step >= s.number ? 'bg-primary text-white' : 'bg-slate-200 text-slate-600'
                }`} data-testid={`step-indicator-${s.number}`}>
                  {s.number}
                </div>
                <span className="text-xs mt-2 text-slate-600">{s.label}</span>
              </div>
              {idx < steps.length - 1 && (
                <div className={`h-1 w-16 mx-4 ${
                  step > s.number ? 'bg-primary' : 'bg-slate-200'
                }`} />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="card max-w-2xl mx-auto">
          {step === 1 && (
            <div data-testid="step-service">
              <h2 className="text-2xl font-bold font-heading mb-6">Escolha o Serviço</h2>
              <div className="grid gap-4">
                {services.map((service) => (
                  <button
                    key={service.id}
                    type="button"
                    onClick={() => {
                      setFormData({ ...formData, service_id: service.id });
                      setStep(2);
                    }}
                    data-testid={`service-option-${service.id}`}
                    className="p-4 border-2 border-slate-200 rounded-lg hover:border-primary hover:bg-primary/5 transition-all text-left"
                  >
                    <p className="font-semibold text-slate-900">{service.name}</p>
                    <p className="text-sm text-slate-600 mt-1">{service.description}</p>
                    <div className="flex items-center gap-4 mt-3 text-sm">
                      <span className="text-primary font-medium">R$ {service.price.toFixed(2)}</span>
                      <span className="text-slate-500">{service.duration} min</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div data-testid="step-professional">
              <h2 className="text-2xl font-bold font-heading mb-6">Escolha o Profissional</h2>
              <div className="grid gap-4">
                {professionals.map((professional) => (
                  <button
                    key={professional.id}
                    type="button"
                    onClick={() => {
                      setFormData({ ...formData, professional_id: professional.id });
                      setStep(3);
                    }}
                    data-testid={`professional-option-${professional.id}`}
                    className="p-4 border-2 border-slate-200 rounded-lg hover:border-primary hover:bg-primary/5 transition-all text-left"
                  >
                    <p className="font-semibold text-slate-900">{professional.name}</p>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="btn-secondary mt-6"
              >
                Voltar
              </button>
            </div>
          )}

          {step === 3 && (
            <div data-testid="step-datetime">
              <h2 className="text-2xl font-bold font-heading mb-6">Escolha Data e Hora</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Data
                  </label>
                  <input
                    type="date"
                    data-testid="date-input"
                    value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                    className="input-field"
                    required
                    min={new Date().toISOString().split('T')[0]}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Horário
                  </label>
                  <input
                    type="time"
                    data-testid="time-input"
                    value={formData.time}
                    onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                    className="input-field"
                    required
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="btn-secondary"
                >
                  Voltar
                </button>
                <button
                  type="button"
                  onClick={() => setStep(4)}
                  disabled={!formData.date || !formData.time}
                  className="btn-primary"
                >
                  Próximo
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div data-testid="step-customer-info">
              <h2 className="text-2xl font-bold font-heading mb-6">Seus Dados</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Nome Completo
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                      type="text"
                      data-testid="customer-name-input"
                      value={formData.customer_name}
                      onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
                      className="input-field pl-10"
                      placeholder="Seu nome"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Telefone
                  </label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                      type="tel"
                      data-testid="customer-phone-input"
                      value={formData.customer_phone}
                      onChange={(e) => setFormData({ ...formData, customer_phone: e.target.value })}
                      className="input-field pl-10"
                      placeholder="(11) 99999-9999"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Email (opcional)
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                      type="email"
                      data-testid="customer-email-input"
                      value={formData.customer_email}
                      onChange={(e) => setFormData({ ...formData, customer_email: e.target.value })}
                      className="input-field pl-10"
                      placeholder="seu@email.com"
                    />
                  </div>
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="btn-secondary"
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  data-testid="submit-booking-button"
                  className="btn-primary"
                >
                  Confirmar Agendamento
                </button>
              </div>
            </div>
          )}
        </form>
      </main>
    </div>
  );
};

export default PublicBooking;
