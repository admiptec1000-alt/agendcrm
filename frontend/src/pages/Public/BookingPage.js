import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { publicAPI } from '../../services/api';
import { useCompanyBranding } from '../../hooks/useCompanyBranding';
import { toast } from 'sonner';
import { Calendar, Clock, User, Phone, Mail, CheckCircle2, Star, ArrowLeft, Sparkles, Scissors, ClipboardList, X, Ban } from 'lucide-react';

const PublicBooking = () => {
  const { slug } = useParams();
  const [step, setStep] = useState(1);
  const [pageData, setPageData] = useState(null);
  const [services, setServices] = useState([]);
  const [professionals, setProfessionals] = useState([]);
  const [showMyAppointments, setShowMyAppointments] = useState(false);
  const [availableSlots, setAvailableSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [clientLookup, setClientLookup] = useState(null);
  const [lookupDone, setLookupDone] = useState(false);
  const [subscription, setSubscription] = useState(null);
  const [useCredits, setUseCredits] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [bookingDone, setBookingDone] = useState(false);
  const [selectedService, setSelectedService] = useState(null);

  useCompanyBranding({
    slug,
    name: pageData?.company?.name,
    logoUrl: pageData?.page?.logo_url,
    themeColor: pageData?.page?.primary_color,
  });

  const [formData, setFormData] = useState({
    service_id: '', professional_id: '', date: '', time: '',
    customer_name: '', customer_phone: '', customer_email: ''
  });

  // Pre-fill name/phone from URL query params (?name=...&phone=...)
  // Used by retorno reminder so the customer lands ready-to-book.
  useEffect(() => {
    try {
      const qs = new URLSearchParams(window.location.search);
      const name = qs.get('name');
      const phone = qs.get('phone');
      if (name || phone) {
        setFormData(f => ({
          ...f,
          customer_name: name || f.customer_name,
          customer_phone: phone || f.customer_phone,
        }));
        if (phone && phone.length >= 8) {
          // Trigger client lookup once data is ready
          setTimeout(() => { try { handlePhoneLookup(phone); } catch { /* ignore */ } }, 600);
        }
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (phone.length < 8) { setLookupDone(false); setClientLookup(null); setSubscription(null); return; }
    try {
      const [cRes, sRes] = await Promise.all([
        publicAPI.lookupClient(slug, phone),
        publicAPI.getSubscription(slug, phone).catch(() => ({ data: { has_subscription: false } }))
      ]);
      if (cRes.data.found) {
        setClientLookup(cRes.data);
        setFormData(f => ({ ...f, customer_name: cRes.data.client.name, customer_email: cRes.data.client.email || '' }));
        toast.success(`Cliente encontrado: ${cRes.data.client.name}`);
      } else {
        setClientLookup(null);
      }
      setSubscription(sRes.data.has_subscription ? sRes.data : null);
      if (sRes.data.has_subscription && sRes.data.status === 'active') {
        toast.success(`Assinatura ativa: ${sRes.data.credits_remaining} créditos disponíveis`);
      }
      setLookupDone(true);
    } catch (e) { setClientLookup(null); setSubscription(null); setLookupDone(true); }
  };

  // Cost in credits for the currently selected service, if covered by the plan
  const serviceCreditCost = useMemo(() => {
    if (!subscription || subscription.status !== 'active' || !formData.service_id) return null;
    const cost = subscription.service_costs?.[formData.service_id];
    if (cost == null) return null;
    if (subscription.credits_remaining < cost) return null;
    return cost;
  }, [subscription, formData.service_id]);

  const willUseCredits = !!serviceCreditCost && useCredits;
  const finalPrice = willUseCredits ? 0 : (selectedService?.price || 0);

  // Helper: display price for a service card; 0/incluso if covered by active subscription
  const getServicePrice = (svc) => {
    if (!svc) return 0;
    if (subscription && subscription.status === 'active') {
      const cost = subscription.service_costs?.[svc.id];
      if (cost != null && (subscription.credits_remaining ?? 0) >= cost) return 0;
    }
    return svc.price || 0;
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const payload = { ...formData, use_subscription: willUseCredits };
      if (!payload.customer_email) delete payload.customer_email;
      await publicAPI.createBooking(slug, payload);
      setBookingDone(true);
      toast.success('Agendamento realizado!');
    } catch (e) {
      const detail = e.response?.data?.detail;
      const msg = typeof detail === 'string' ? detail : 'Erro ao agendar';
      toast.error(msg);
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
            <p><strong>Serviço:</strong> {selectedService?.name}</p>
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

  // 2026-02-28 — Inversao da ordem de etapas controlada pela empresa
  // (Configuracao Agenda). Quando true, Step 1 vira Profissional e Step
  // 2 vira Servico. Default false = comportamento original.
  const invertOrder = !!pageData?.invert_service_professional;

  const steps = [
    { n: 1, label: invertOrder ? 'Profissional' : 'Serviço' },
    { n: 2, label: invertOrder ? 'Serviço' : 'Profissional' },
    { n: 3, label: 'Data & Hora' },
    { n: 4, label: 'Dados' },
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
          <button onClick={() => setShowMyAppointments(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors" style={{ color: primaryColor }} data-testid="my-appointments-btn">
            <ClipboardList className="w-4 h-4" /> <span className="hidden sm:inline">Meus Agendamentos</span>
          </button>
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
          {/* Step 1: Service OR Professional (depending on invertOrder) */}
          {((step === 1 && !invertOrder) || (step === 2 && invertOrder)) && (
            <div data-testid="step-service">
              <h2 className="text-xl font-bold font-heading mb-1" style={{ color: primaryColor }}>Escolha seu Serviço ou Produto</h2>
              <p className="text-sm text-slate-500 mb-6">Selecione o que voce deseja agendar</p>
              <div className="space-y-3">
                {services.map(svc => {
                  const price = getServicePrice(svc);
                  const isIncluded = clientLookup?.included_service_ids?.includes(svc.id);
                  return (
                    <button key={svc.id} type="button" onClick={() => { setFormData({...formData, service_id: svc.id}); setSelectedService(svc); setStep(invertOrder ? 3 : 2); }}
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
                {services.length === 0 && <p className="text-center py-8 text-slate-500">Nenhum serviço disponível</p>}
              </div>
              {invertOrder && (
                <button onClick={() => setStep(1)} className="btn-secondary mt-4 flex items-center gap-1 text-sm" data-testid="back-from-service"><ArrowLeft className="w-4 h-4" /> Voltar</button>
              )}
            </div>
          )}

          {/* Step 2: Professional OR Service (depending on invertOrder) */}
          {((step === 2 && !invertOrder) || (step === 1 && invertOrder)) && (
            <div data-testid="step-professional">
              <h2 className="text-xl font-bold font-heading mb-1" style={{ color: primaryColor }}>Escolha o Profissional</h2>
              <p className="text-sm text-slate-500 mb-6">Selecione quem vai te atender</p>
              <div className="space-y-3">
                {professionals.map(prof => (
                  <button key={prof.id} type="button" onClick={() => { setFormData({...formData, professional_id: prof.id}); setStep(invertOrder ? 2 : 3); }}
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
                        <div className="flex gap-1 mt-1 flex-wrap">{prof.specialties.slice(0, 3).map((s, i) => <span key={`spec-${s}-${i}`} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{s}</span>)}</div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
              {!invertOrder && (
                <button onClick={() => setStep(1)} className="btn-secondary mt-4 flex items-center gap-1 text-sm"><ArrowLeft className="w-4 h-4" /> Voltar</button>
              )}
            </div>
          )}

          {/* Step 3: Date + Time (combined) */}
          {step === 3 && (
            <div data-testid="step-date">
              <h2 className="text-xl font-bold font-heading mb-1" style={{ color: primaryColor }}>Escolha Data e Horario</h2>
              <p className="text-sm text-slate-500 mb-4">Horarios disponiveis — use as setas ou clique na data</p>
              <DateHourPicker
                formData={formData}
                setFormData={setFormData}
                availableSlots={availableSlots}
                loadSlots={loadSlots}
                primaryColor={primaryColor}
                onPicked={(slot) => { setFormData(f => ({...f, time: slot})); setStep(4); }}
              />
              <button onClick={() => setStep(2)} className="btn-secondary mt-4 text-sm flex items-center gap-1" data-testid="back-from-date"><ArrowLeft className="w-4 h-4" /> Voltar</button>
            </div>
          )}

          {/* Step 4: Customer Data */}
          {step === 4 && (
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
                  {subscription && (
                    <div className={`mt-2 p-3 rounded-xl border ${
                      subscription.status === 'active'
                        ? 'bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-200'
                        : 'bg-amber-50 border-amber-200'
                    }`} data-testid="subscription-banner">
                      <div className="flex items-center gap-2 mb-1">
                        <Sparkles className={`w-4 h-4 ${subscription.status === 'active' ? 'text-emerald-600' : 'text-amber-600'}`} />
                        <p className={`text-xs font-bold ${subscription.status === 'active' ? 'text-emerald-800' : 'text-amber-800'}`}>
                          {subscription.status === 'active' ? 'Assinante Ativo' : 'Assinatura Vencida'}
                        </p>
                      </div>
                      <p className="text-xs text-slate-700">{subscription.plan_name}</p>
                      {subscription.status === 'active' ? (
                        <p className="text-xs text-slate-600">
                          <b>{subscription.credits_remaining}</b> créditos disponíveis · válido até{' '}
                          {subscription.end_date ? new Date(subscription.end_date).toLocaleDateString('pt-BR') : '-'}
                        </p>
                      ) : (
                        <p className="text-xs text-slate-600">Os serviços serão cobrados no valor normal.</p>
                      )}
                    </div>
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

                {pageData?.page?.show_email_field !== false && (
                  <div>
                    <label className="text-sm font-medium text-slate-700 mb-1 block">Email (opcional)</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                      <input type="email" value={formData.customer_email} onChange={e => setFormData({...formData, customer_email: e.target.value})}
                        className="input-field pl-10" placeholder="seu@email.com" data-testid="email-input" />
                    </div>
                  </div>
                )}

                {/* Summary */}
                <div className="bg-slate-50 rounded-xl p-4 space-y-2">
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Resumo do Agendamento</p>
                  <div className="flex justify-between text-sm"><span className="text-slate-600">Serviço</span><span className="font-medium">{selectedService?.name}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-slate-600">Data</span><span className="font-medium">{formData.date}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-slate-600">Horario</span><span className="font-medium">{formData.time}</span></div>
                  {serviceCreditCost && subscription?.status === 'active' && (
                    <div className="flex items-center gap-2 p-2 bg-emerald-50 rounded-lg border border-emerald-200 mt-1" data-testid="use-credits-toggle">
                      <input type="checkbox" id="use-credits" checked={useCredits} onChange={e => setUseCredits(e.target.checked)} className="w-4 h-4" />
                      <label htmlFor="use-credits" className="text-xs text-emerald-800 flex-1 cursor-pointer">
                        Usar <b>{serviceCreditCost}</b> crédito{serviceCreditCost > 1 ? 's' : ''} da assinatura
                      </label>
                    </div>
                  )}
                  <div className="flex justify-between text-sm border-t border-slate-200 pt-2 mt-2">
                    <span className="text-slate-600 font-medium">Valor</span>
                    <span className="font-bold text-lg" style={{ color: primaryColor }}>
                      {willUseCredits
                        ? <span className="text-emerald-600">Incluso no Plano</span>
                        : `R$ ${finalPrice.toFixed(2)}`}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 mt-6">
                <button onClick={() => setStep(3)} className="btn-secondary text-sm flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Voltar</button>
                <button onClick={handleSubmit} disabled={!formData.customer_name || !formData.customer_phone || submitting}
                  className="btn-primary flex-1 text-sm" style={{ background: primaryColor }} data-testid="confirm-booking-btn">
                  {submitting ? 'Agendando...' : 'Confirmar Agendamento'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Meus Agendamentos Modal */}
      {showMyAppointments && <MyAppointmentsModal slug={slug} primaryColor={primaryColor} onClose={() => setShowMyAppointments(false)} />}
    </div>
  );
};

const MyAppointmentsModal = ({ slug, primaryColor, onClose }) => {
  const [phone, setPhone] = useState('');
  const [appointments, setAppointments] = useState([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    if (phone.length < 8) { toast.error('Digite um telefone valido'); return; }
    setLoading(true);
    try {
      const res = await publicAPI.getMyAppointments(slug, phone);
      setAppointments(res.data);
      setSearched(true);
    } catch (e) { toast.error('Erro ao buscar'); }
    finally { setLoading(false); }
  };

  const handleCancel = async (id) => {
    try {
      await publicAPI.cancelMyAppointment(slug, id);
      setAppointments(a => a.map(apt => apt.id === id ? { ...apt, status: 'cancelado' } : apt));
      toast.success('Agendamento cancelado!');
    } catch (e) { toast.error(e.response?.data?.detail || 'Erro ao cancelar'); }
  };

  const handleConfirm = async (id) => {
    try {
      await publicAPI.confirmMyAppointment(slug, id);
      setAppointments(a => a.map(apt => apt.id === id ? { ...apt, status: 'confirmado' } : apt));
      toast.success('Agendamento confirmado!');
    } catch (e) { toast.error(e.response?.data?.detail || 'Erro ao confirmar'); }
  };

  const STATUS = { confirmado: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Confirmado' }, pendente: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Pendente' }, cancelado: { bg: 'bg-red-100', text: 'text-red-700', label: 'Cancelado' }, concluido: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Concluido' } };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[85vh] overflow-hidden" onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-200">
          <div>
            <h3 className="text-lg font-bold font-heading">Meus Agendamentos</h3>
            <p className="text-xs text-slate-500">Busque pelo seu numero de telefone</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5">
          <div className="flex gap-2 mb-4">
            <div className="relative flex-1">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder="(62) 99999-0000" className="input-field pl-10" data-testid="my-apt-phone" />
            </div>
            <button onClick={handleSearch} disabled={loading} className="px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ background: primaryColor }} data-testid="my-apt-search-btn">
              {loading ? '...' : 'Buscar'}
            </button>
          </div>

          <div className="max-h-[50vh] overflow-y-auto space-y-2">
            {searched && appointments.length === 0 && (
              <div className="text-center py-8">
                <ClipboardList className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-500">Nenhum agendamento encontrado</p>
              </div>
            )}
            {appointments.map(apt => {
              const st = STATUS[apt.status] || STATUS.pendente;
              const isPending = apt.status === 'pendente';
              return (
                <div key={apt.id} className="p-4 border border-slate-200 rounded-xl" data-testid={`my-apt-${apt.id}`}>
                  <div className="flex items-start justify-between mb-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold" style={{ color: primaryColor }}>{apt.date?.split('-').reverse().join('/')} - {apt.time}</p>
                      <p className="text-sm font-medium text-slate-900">{apt.service_name}</p>
                      <p className="text-xs text-slate-500">{apt.professional_name}</p>
                    </div>
                    {isPending ? (
                      <button
                        onClick={() => handleConfirm(apt.id)}
                        className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
                        style={{ background: primaryColor }}
                        data-testid={`confirm-my-apt-${apt.id}`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Confirmar
                      </button>
                    ) : (
                      <span className={`flex-shrink-0 text-[10px] px-2 py-0.5 rounded-full font-medium ${st.bg} ${st.text}`}>{st.label}</span>
                    )}
                  </div>
                  {apt.price > 0 && <p className="text-xs text-slate-500">R$ {apt.price.toFixed(2)}</p>}
                  {apt.status !== 'cancelado' && apt.status !== 'concluido' && (
                    <button onClick={() => handleCancel(apt.id)} className="mt-2 flex items-center gap-1 text-xs text-red-500 hover:text-red-700 font-medium" data-testid={`cancel-my-apt-${apt.id}`}>
                      <Ban className="w-3 h-3" /> Cancelar agendamento
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

const DateHourPicker = ({ formData, setFormData, availableSlots, loadSlots, primaryColor, onPicked }) => {
  const today = new Date().toISOString().split('T')[0];
  const current = formData.date || today;
  const [showNative, setShowNative] = React.useState(false);
  const nativeRef = React.useRef(null);

  // On mount: if no date set, preload today and fetch slots
  React.useEffect(() => {
    if (!formData.date) {
      setFormData(f => ({ ...f, date: today, time: '' }));
      loadSlots(today);
    } else {
      loadSlots(formData.date);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shift = (days) => {
    const d = new Date(current + 'T00:00:00');
    d.setDate(d.getDate() + days);
    const iso = d.toISOString().split('T')[0];
    if (iso < today) return; // can't go before today
    setFormData(f => ({ ...f, date: iso, time: '' }));
    loadSlots(iso);
  };

  const onDateChange = (iso) => {
    if (!iso) return;
    setFormData(f => ({ ...f, date: iso, time: '' }));
    loadSlots(iso);
    setShowNative(false);
  };

  const prettyDate = React.useMemo(() => {
    const d = new Date(current + 'T00:00:00');
    // Compact format: dd/mm/aa
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    const weekdayShort = d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
    return `${weekdayShort} ${dd}/${mm}/${yy}`;
  }, [current]);

  // Filter out past time slots when selected date is today
  const displayedSlots = React.useMemo(() => {
    if (current !== today) return availableSlots;
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    return availableSlots.filter(slot => {
      const parts = (slot || '').split(':');
      if (parts.length < 2) return true;
      const slotMinutes = (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
      return slotMinutes > nowMinutes;
    });
  }, [availableSlots, current, today]);

  const openPicker = () => {
    // Prefer native picker on mobile via showPicker API, fallback to input
    try {
      if (nativeRef.current?.showPicker) { nativeRef.current.showPicker(); return; }
    } catch { /* ignore */ }
    setShowNative(s => !s);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100">
        <button
          onClick={() => shift(-1)}
          disabled={current <= today}
          className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed"
          data-testid="date-prev"
          aria-label="Dia anterior"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <button
          onClick={openPicker}
          className="flex-1 px-3 py-1.5 rounded-lg hover:bg-slate-50 flex items-center justify-center gap-2 text-slate-800 font-semibold"
          data-testid="date-opener"
        >
          <span className="capitalize">{prettyDate}</span>
          <Calendar className="w-4 h-4 text-slate-400" />
        </button>
        <button
          onClick={() => shift(1)}
          className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"
          data-testid="date-next"
          aria-label="Proximo dia"
        >
          <ArrowLeft className="w-5 h-5 rotate-180" />
        </button>
      </div>
      {/* hidden native date input for showPicker */}
      <input
        ref={nativeRef}
        type="date"
        value={current}
        min={today}
        onChange={e => onDateChange(e.target.value)}
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        data-testid="date-native"
      />
      {/* Fallback visible picker for browsers without showPicker */}
      {showNative && (
        <div className="px-3 pt-2">
          <input
            type="date"
            value={current}
            min={today}
            onChange={e => onDateChange(e.target.value)}
            className="input-field text-sm"
            autoFocus
          />
        </div>
      )}
      <div className="p-3">
        {displayedSlots.length === 0 ? (
          <p className="text-center py-10 text-sm text-slate-500">Nenhum horario disponivel neste dia</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2" data-testid="slot-grid">
            {displayedSlots.map(slot => (
              <button
                key={slot}
                onClick={() => onPicked(slot)}
                className={`py-3 rounded-xl text-sm font-bold transition-all ${
                  formData.time === slot ? 'text-white' : 'bg-slate-900 text-white hover:opacity-90'
                }`}
                style={formData.time === slot ? { background: primaryColor } : {}}
                data-testid={`slot-${slot}`}
              >
                {slot}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default PublicBooking;
