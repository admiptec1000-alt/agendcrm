import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { publicAPI } from '../../services/api';
import { toast } from 'sonner';
import { Calendar, Clock, User, Phone, Mail, CheckCircle2, Star, ArrowLeft, Sparkles, Scissors } from 'lucide-react';

const PublicBooking = () => {
  const { slug } = useParams();
  const [step, setStep] = useState(1);
  const [pageData, setPageData] = useState(null);
  const [services, setServices] = useState([]);
  const [professionals, setProfessionals] = useState([]);
  const [availableSlots, setAvailableSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [clientLookup, setClientLookup] = useState(null);
  const [lookupDone, setLookupDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [bookingDone, setBookingDone] = useState(false);
  const [selectedService, setSelectedService] = useState(null);

  const [formData, setFormData] = useState({
    service_id: '', professional_id: '', date: '', time: '',
    customer_name: '', customer_phone: '', customer_email: ''
  });

  useEffect(() => {
    Promise.all([
      publicAPI.getBookingPage(slug),
      publicAPI.getServices(slug),
      publicAPI.getProfessionals(slug)
    ]).then(([p, s, pr]) => {
      setPageData(p.data);
      setServices(s.data.services);
      setProfessionals(pr.data);
    }).catch(() => toast.error('Pagina nao encontrada')).finally(() => setLoading(false));
  }, [slug]);

  const loadSlots = useCallback(async (date) => {
    if (!formData.professional_id || !date) return;
    try {
      const res = await publicAPI.getAvailability(slug, { professional_id: formData.professional_id, date });
      setAvailableSlots(res.data.available_slots || []);
    } catch (e) { setAvailableSlots([]); }
  }, [slug, formData.professional_id]);

  const handlePhoneLookup = async (phone) => {
    if (phone.length < 8) { setLookupDone(false); setClientLookup(null); return; }
    try {
      const res = await publicAPI.lookupClient(slug, phone);
      if (res.data.found) {
        setClientLookup(res.data);
        setFormData(f => ({ ...f, customer_name: res.data.client.name, customer_email: res.data.client.email || '' }));
        setLookupDone(true);
        toast.success(`Cliente encontrado: ${res.data.client.name}`);
      } else {
        setClientLookup(null);
        setLookupDone(true);
      }
    } catch (e) { setClientLookup(null); setLookupDone(true); }
  };

  const getServicePrice = (service) => {
    if (clientLookup?.subscription && clientLookup.included_service_ids?.includes(service.id)) {
      return 0;
    }
    return service.price;
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await publicAPI.createBooking(slug, formData);
      setBookingDone(true);
      toast.success('Agendamento realizado!');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao agendar');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div></div>;
  if (!pageData) return <div className="min-h-screen flex items-center justify-center"><p className="text-slate-600">Pagina nao encontrada</p></div>;

  const primaryColor = pageData.page?.primary_color || '#4F46E5';
  const API_BASE = process.env.REACT_APP_BACKEND_URL;

  if (bookingDone) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="card max-w-md text-center p-8">
          <CheckCircle2 className="w-16 h-16 mx-auto mb-4" style={{ color: primaryColor }} />
          <h2 className="text-2xl font-bold font-heading mb-2">Agendamento Confirmado!</h2>
          <p className="text-sm text-slate-600 mb-6">Voce recebera uma confirmacao no seu WhatsApp.</p>
          <div className="bg-slate-50 rounded-lg p-4 text-left space-y-2 text-sm">
            <p><strong>Servico:</strong> {selectedService?.name}</p>
            <p><strong>Data:</strong> {formData.date}</p>
            <p><strong>Hora:</strong> {formData.time}</p>
          </div>
          <button onClick={() => { setBookingDone(false); setStep(1); setFormData({ service_id:'',professional_id:'',date:'',time:'',customer_name:'',customer_phone:'',customer_email:'' }); setClientLookup(null); setLookupDone(false); }}
            className="btn-primary w-full mt-6" style={{ background: primaryColor }}>
            Novo Agendamento
          </button>
        </div>
      </div>
    );
  }

  const steps = [
    { n: 1, label: 'Servico' },
    { n: 2, label: 'Profissional' },
    { n: 3, label: 'Data' },
    { n: 4, label: 'Horario' },
    { n: 5, label: 'Dados' },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {pageData.page?.logo_url && <img src={`${API_BASE}${pageData.page.logo_url}`} alt="Logo" className="h-10 w-10 rounded-lg object-cover" />}
            <div>
              <h1 className="text-lg font-bold font-heading text-slate-900">{pageData.company.name}</h1>
              <p className="text-xs text-slate-500">Agende seu horario</p>
            </div>
          </div>
        </div>
      </header>

      {/* Banner */}
      {pageData.page?.banner_url && (
        <div className="max-w-2xl mx-auto mt-4 px-4">
          <img src={`${API_BASE}${pageData.page.banner_url}`} alt="Banner" className="w-full h-48 object-cover rounded-xl" />
        </div>
      )}

      {/* Steps Indicator */}
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="flex items-center justify-center">
          {steps.map((s, i) => (
            <React.Fragment key={s.n}>
              <div className="flex flex-col items-center">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all ${
                  step >= s.n ? 'text-white border-transparent' : 'bg-white text-slate-400 border-slate-200'
                }`} style={step >= s.n ? { background: primaryColor, borderColor: primaryColor } : {}} data-testid={`step-${s.n}`}>
                  {step > s.n ? <CheckCircle2 className="w-4 h-4" /> : s.n}
                </div>
                <span className="text-[10px] mt-1 text-slate-500">{s.label}</span>
              </div>
              {i < steps.length - 1 && <div className={`h-0.5 w-10 mx-1 ${step > s.n ? '' : 'bg-slate-200'}`} style={step > s.n ? { background: primaryColor } : {}} />}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-4 pb-12">
        <div className="card">
          {/* Step 1: Service */}
          {step === 1 && (
            <div data-testid="step-service">
              <h2 className="text-xl font-bold font-heading mb-1" style={{ color: primaryColor }}>Escolha seu Servico ou Produto</h2>
              <p className="text-sm text-slate-500 mb-6">Selecione o que voce deseja agendar</p>
              <div className="space-y-3">
                {services.map(svc => {
                  const price = getServicePrice(svc);
                  const isIncluded = clientLookup?.included_service_ids?.includes(svc.id);
                  return (
                    <button key={svc.id} type="button" onClick={() => { setFormData({...formData, service_id: svc.id}); setSelectedService(svc); setStep(2); }}
                      data-testid={`svc-${svc.id}`}
                      className="w-full p-4 border-2 border-slate-200 rounded-xl hover:border-primary/50 hover:bg-primary/5 transition-all text-left group">
                      <div className="flex items-center gap-4">
                        {svc.image_url ? (
                          <img src={`${API_BASE}${svc.image_url}`} alt={svc.name} className="w-16 h-16 rounded-lg object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-16 h-16 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                            <Scissors className="w-6 h-6 text-slate-400" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-900 group-hover:text-primary transition-colors">{svc.name}</p>
                          {svc.description && <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{svc.description}</p>}
                          <p className="text-xs text-slate-400 mt-1">{svc.duration} min</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          {isIncluded ? (
                            <div>
                              <p className="text-xs line-through text-slate-400">R$ {svc.price.toFixed(2)}</p>
                              <p className="font-bold text-emerald-600 text-sm">Incluso no Plano</p>
                            </div>
                          ) : (
                            <p className="font-bold text-lg" style={{ color: primaryColor }}>R$ {price.toFixed(2)}</p>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
                {services.length === 0 && <p className="text-center py-8 text-slate-500">Nenhum servico disponivel</p>}
              </div>
            </div>
          )}

          {/* Step 2: Professional */}
          {step === 2 && (
            <div data-testid="step-professional">
              <h2 className="text-xl font-bold font-heading mb-1" style={{ color: primaryColor }}>Escolha o Profissional</h2>
              <p className="text-sm text-slate-500 mb-6">Selecione quem vai te atender</p>
              <div className="space-y-3">
                {professionals.map(prof => (
                  <button key={prof.id} type="button" onClick={() => { setFormData({...formData, professional_id: prof.id}); setStep(3); }}
                    data-testid={`prof-${prof.id}`}
                    className="w-full p-4 border-2 border-slate-200 rounded-xl hover:border-primary/50 transition-all text-left flex items-center gap-4">
                    {prof.image_url ? (
                      <img src={`${API_BASE}${prof.image_url}`} alt={prof.name} className="w-14 h-14 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-14 h-14 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-bold text-lg flex-shrink-0">
                        {prof.name?.substring(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p className="font-semibold text-slate-900">{prof.name}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
                        <span className="text-xs text-slate-500">{prof.rating || 5.0}</span>
                      </div>
                      {prof.specialties?.length > 0 && (
                        <div className="flex gap-1 mt-1 flex-wrap">{prof.specialties.slice(0, 3).map((s, i) => <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{s}</span>)}</div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
              <button onClick={() => setStep(1)} className="btn-secondary mt-4 flex items-center gap-1 text-sm"><ArrowLeft className="w-4 h-4" /> Voltar</button>
            </div>
          )}

          {/* Step 3: Date */}
          {step === 3 && (
            <div data-testid="step-date">
              <h2 className="text-xl font-bold font-heading mb-1" style={{ color: primaryColor }}>Escolha a Data</h2>
              <p className="text-sm text-slate-500 mb-6">Selecione o dia do agendamento</p>
              <input type="date" value={formData.date} onChange={e => { setFormData({...formData, date: e.target.value, time: ''}); loadSlots(e.target.value); }}
                min={new Date().toISOString().split('T')[0]}
                className="input-field text-lg" data-testid="date-picker" />
              <div className="flex gap-2 mt-6">
                <button onClick={() => setStep(2)} className="btn-secondary text-sm flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Voltar</button>
                <button onClick={() => formData.date && setStep(4)} disabled={!formData.date} className="btn-primary text-sm" style={{ background: primaryColor }}>Proximo</button>
              </div>
            </div>
          )}

          {/* Step 4: Time */}
          {step === 4 && (
            <div data-testid="step-time">
              <h2 className="text-xl font-bold font-heading mb-1" style={{ color: primaryColor }}>Escolha o Horario</h2>
              <p className="text-sm text-slate-500 mb-6">Horarios disponiveis para {formData.date}</p>
              <div className="grid grid-cols-4 gap-2">
                {availableSlots.map(slot => (
                  <button key={slot} onClick={() => { setFormData({...formData, time: slot}); setStep(5); }}
                    data-testid={`slot-${slot}`}
                    className={`py-2.5 rounded-lg text-sm font-medium border-2 transition-all ${
                      formData.time === slot ? 'text-white border-transparent' : 'border-slate-200 text-slate-700 hover:border-primary/50'
                    }`} style={formData.time === slot ? { background: primaryColor } : {}}>
                    {slot}
                  </button>
                ))}
                {availableSlots.length === 0 && <p className="col-span-4 text-center py-8 text-slate-500">Nenhum horario disponivel</p>}
              </div>
              <button onClick={() => setStep(3)} className="btn-secondary mt-4 text-sm flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Voltar</button>
            </div>
          )}

          {/* Step 5: Customer Data */}
          {step === 5 && (
            <div data-testid="step-data">
              <h2 className="text-xl font-bold font-heading mb-1" style={{ color: primaryColor }}>Seus Dados</h2>
              <p className="text-sm text-slate-500 mb-6">Informe seu telefone para identificacao</p>
              <div className="space-y-4">
                {/* Phone first - key identifier */}
                <div>
                  <label className="text-sm font-medium text-slate-700 mb-1 block">Telefone (WhatsApp)</label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input type="tel" value={formData.customer_phone}
                      onChange={e => { const v = e.target.value; setFormData({...formData, customer_phone: v}); if (v.length >= 10) handlePhoneLookup(v); }}
                      className="input-field pl-10" placeholder="(62) 99999-9999" data-testid="phone-input" />
                  </div>
                  {lookupDone && clientLookup && (
                    <div className="mt-2 p-3 bg-emerald-50 rounded-lg border border-emerald-200 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-emerald-600" />
                      <div>
                        <p className="text-sm font-medium text-emerald-800">Cliente identificado: {clientLookup.client.name}</p>
                        {clientLookup.subscription && <p className="text-xs text-emerald-600">Plano ativo: {clientLookup.subscription.plan?.name} ({clientLookup.subscription.credits_remaining} creditos)</p>}
                      </div>
                    </div>
                  )}
                  {lookupDone && !clientLookup && formData.customer_phone.length >= 10 && (
                    <p className="text-xs text-slate-500 mt-1">Novo cliente - preencha seus dados abaixo</p>
                  )}
                </div>

                <div>
                  <label className="text-sm font-medium text-slate-700 mb-1 block">Nome Completo</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input type="text" value={formData.customer_name} onChange={e => setFormData({...formData, customer_name: e.target.value})}
                      className="input-field pl-10" placeholder="Seu nome" data-testid="name-input" />
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-slate-700 mb-1 block">Email (opcional)</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input type="email" value={formData.customer_email} onChange={e => setFormData({...formData, customer_email: e.target.value})}
                      className="input-field pl-10" placeholder="seu@email.com" data-testid="email-input" />
                  </div>
                </div>

                {/* Summary */}
                <div className="bg-slate-50 rounded-xl p-4 space-y-2">
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Resumo do Agendamento</p>
                  <div className="flex justify-between text-sm"><span className="text-slate-600">Servico</span><span className="font-medium">{selectedService?.name}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-slate-600">Data</span><span className="font-medium">{formData.date}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-slate-600">Horario</span><span className="font-medium">{formData.time}</span></div>
                  <div className="flex justify-between text-sm border-t border-slate-200 pt-2 mt-2">
                    <span className="text-slate-600 font-medium">Valor</span>
                    <span className="font-bold text-lg" style={{ color: primaryColor }}>
                      {selectedService && getServicePrice(selectedService) === 0
                        ? <span className="text-emerald-600">Incluso no Plano</span>
                        : `R$ ${(selectedService?.price || 0).toFixed(2)}`}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 mt-6">
                <button onClick={() => setStep(4)} className="btn-secondary text-sm flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Voltar</button>
                <button onClick={handleSubmit} disabled={!formData.customer_name || !formData.customer_phone || submitting}
                  className="btn-primary flex-1 text-sm" style={{ background: primaryColor }} data-testid="confirm-booking-btn">
                  {submitting ? 'Agendando...' : 'Confirmar Agendamento'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PublicBooking;
