import React, { useState, useEffect } from 'react';
import { schedulingAPI } from '../../services/api';
import { toast } from 'sonner';
import {
  Plus, Search, Star, Phone, Mail, Pencil, Trash2, X, Users, DollarSign,
  Calendar, Clock, Scissors, CreditCard, CheckCircle2, MoreHorizontal, Grid3X3
} from 'lucide-react';

/* ========== PROFESSIONALS PAGE (ENHANCED) ========== */
export const ProfessionalsPageFull = () => {
  const [professionals, setProfessionals] = useState([]);
  const [stats, setStats] = useState({});
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [activeTab, setActiveTab] = useState('personal');

  useEffect(() => { load(); }, [search]);
  const load = async () => {
    const [p, s] = await Promise.all([
      schedulingAPI.getProfessionals({ search: search || undefined }),
      schedulingAPI.getProfessionalsStats()
    ]);
    setProfessionals(p.data);
    setStats(s.data);
  };

  return (
    <div className="animate-fade-in" data-testid="professionals-full-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold font-heading text-slate-900">Profissionais</h2>
          <p className="text-sm text-slate-600">Gerencie sua equipe de profissionais</p>
        </div>
        <button onClick={() => { setEditing(null); setShowModal(true); }} className="btn-primary flex items-center gap-2" data-testid="new-prof-btn">
          <Plus className="w-4 h-4" /> Novo Profissional
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Profissionais" value={stats.total || 0} icon={<Users className="w-5 h-5" />} />
        <StatCard label="Ativos" value={stats.active || 0} icon={<CheckCircle2 className="w-5 h-5" />} color="text-emerald-600" />
        <StatCard label="Receita do Mes" value={`R$ ${(stats.revenue || 0).toFixed(2)}`} icon={<DollarSign className="w-5 h-5" />} color="text-blue-600" />
        <StatCard label="Agend. Hoje" value={stats.appointments_today || 0} icon={<Calendar className="w-5 h-5" />} color="text-orange-600" />
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar profissionais..." className="input-field pl-10" data-testid="prof-search" />
      </div>

      <p className="text-sm text-slate-500 mb-4">{professionals.length} profissionais encontrados</p>

      {/* Professional Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {professionals.map(prof => (
          <div key={prof.id} className="card !p-0 overflow-hidden" data-testid={`prof-card-${prof.id}`}>
            <div className={`h-1.5 ${prof.is_active ? 'bg-gradient-to-r from-emerald-400 to-teal-500' : 'bg-gradient-to-r from-violet-400 to-purple-500'}`} />
            <div className="p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-14 h-14 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-bold text-lg relative">
                  {prof.name?.substring(0, 2).toUpperCase()}
                  <div className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-white ${prof.is_active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-slate-900">{prof.name}</p>
                  <div className="flex items-center gap-2">
                    <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                    <span className="text-xs text-slate-600">{prof.rating || 5.0}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${prof.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                      {prof.is_active ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>
                </div>
                <button onClick={() => { setEditing(prof); setActiveTab('personal'); setShowModal(true); }} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
                  <Pencil className="w-4 h-4" />
                </button>
              </div>

              {/* Specialties */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {(prof.specialties || []).slice(0, 3).map((s, i) => (
                  <span key={i} className="text-xs px-2 py-0.5 rounded-full border border-primary/30 text-primary">{s}</span>
                ))}
                {(prof.specialties || []).length > 3 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">+{prof.specialties.length - 3}</span>
                )}
              </div>

              {/* Contact */}
              <div className="space-y-1.5 mb-4 text-sm">
                <div className="flex items-center gap-2 text-slate-600">
                  <Phone className="w-3.5 h-3.5" /><span>{prof.phone || 'Nao informado'}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-600">
                  <Mail className="w-3.5 h-3.5" /><span className="truncate">{prof.email || 'Nao informado'}</span>
                </div>
              </div>

              {/* Footer metrics */}
              <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-100">
                <div className="text-center">
                  <p className="text-[10px] text-slate-400 uppercase">Comissao %</p>
                  <p className="text-sm font-bold text-slate-900">{prof.commission_percent || 0}%</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-slate-400 uppercase">Hoje</p>
                  <p className="text-sm font-bold text-slate-900">{prof.appointments_today || 0}</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-slate-400 uppercase">Comissao</p>
                  <p className="text-sm font-bold text-emerald-600">R$ {(prof.total_commission || 0).toFixed(2)}</p>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <ProfessionalModal
          professional={editing}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onClose={() => setShowModal(false)}
          onSave={() => { setShowModal(false); load(); }}
        />
      )}
    </div>
  );
};

const ProfessionalModal = ({ professional, activeTab, setActiveTab, onClose, onSave }) => {
  const isEditing = !!professional;
  const [form, setForm] = useState({
    name: professional?.name || '',
    email: professional?.email || '',
    phone: professional?.phone || '',
    is_active: professional?.is_active ?? true,
    address: professional?.address || '',
    notes: professional?.notes || '',
    commission_percent: professional?.commission_percent || 0,
    specialties: professional?.specialties || [],
  });
  const [newSpecialty, setNewSpecialty] = useState('');

  const tabs = [
    { key: 'personal', label: 'Dados Pessoais' },
    { key: 'professional', label: 'Profissional' },
    { key: 'schedule', label: 'Horarios' },
  ];

  const handleSave = async () => {
    const payload = { name: form.name, phone: form.phone || undefined, specialties: form.specialties };
    if (form.email) payload.email = form.email;
    if (isEditing) {
      await schedulingAPI.updateProfessional(professional.id, { ...payload, is_active: form.is_active });
    } else {
      await schedulingAPI.createProfessional(payload);
    }
    toast.success(isEditing ? 'Profissional atualizado!' : 'Profissional criado!');
    onSave();
  };

  const addSpecialty = () => {
    if (newSpecialty.trim() && !form.specialties.includes(newSpecialty.trim())) {
      setForm({ ...form, specialties: [...form.specialties, newSpecialty.trim()] });
      setNewSpecialty('');
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-200 sticky top-0 bg-white z-10">
          <h3 className="text-lg font-bold font-heading">{isEditing ? 'Editar Profissional' : 'Novo Profissional'}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 px-5">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className={`py-2.5 px-4 text-sm font-medium relative transition-colors ${activeTab === t.key ? 'text-primary' : 'text-slate-500 hover:text-slate-700'}`}>
              {t.label}
              {activeTab === t.key && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
            </button>
          ))}
        </div>

        <div className="p-5 space-y-4">
          {activeTab === 'personal' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-sm font-medium text-slate-700 mb-1 block">Nome Completo</label>
                  <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="input-field" data-testid="prof-name" /></div>
                <div><label className="text-sm font-medium text-slate-700 mb-1 block">E-mail</label>
                  <input value={form.email} onChange={e => setForm({...form, email: e.target.value})} className="input-field" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-sm font-medium text-slate-700 mb-1 block">Telefone</label>
                  <input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} className="input-field" /></div>
                <div><label className="text-sm font-medium text-slate-700 mb-1 block">Status</label>
                  <select value={form.is_active ? 'true' : 'false'} onChange={e => setForm({...form, is_active: e.target.value === 'true'})} className="input-field">
                    <option value="true">Ativo</option><option value="false">Inativo</option>
                  </select></div>
              </div>
              <div><label className="text-sm font-medium text-slate-700 mb-1 block">Endereco</label>
                <input value={form.address} onChange={e => setForm({...form, address: e.target.value})} placeholder="Endereco completo" className="input-field" /></div>
              <div><label className="text-sm font-medium text-slate-700 mb-1 block">Observacoes</label>
                <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} placeholder="Observacoes sobre o profissional..." className="input-field" rows={3} /></div>
            </>
          )}
          {activeTab === 'professional' && (
            <>
              <div><label className="text-sm font-medium text-slate-700 mb-1 block">Comissao (%)</label>
                <input type="number" value={form.commission_percent} onChange={e => setForm({...form, commission_percent: parseInt(e.target.value) || 0})} className="input-field" min={0} max={100} /></div>
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1 block">Especialidades</label>
                <div className="flex gap-2 mb-2">
                  <input value={newSpecialty} onChange={e => setNewSpecialty(e.target.value)} onKeyDown={e => e.key === 'Enter' && addSpecialty()} placeholder="Ex: Corte Social" className="input-field flex-1" />
                  <button onClick={addSpecialty} className="btn-primary text-sm">Adicionar</button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {form.specialties.map((s, i) => (
                    <span key={i} className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary flex items-center gap-1">
                      {s} <button onClick={() => setForm({...form, specialties: form.specialties.filter((_, j) => j !== i)})} className="hover:text-red-500"><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                </div>
              </div>
            </>
          )}
          {activeTab === 'schedule' && (
            <p className="text-sm text-slate-500 py-4 text-center">Configuracao de horarios em breve</p>
          )}
        </div>

        <div className="flex justify-end gap-2 p-5 border-t border-slate-200 sticky bottom-0 bg-white">
          <button onClick={onClose} className="btn-secondary text-sm">Cancelar</button>
          <button onClick={handleSave} className="btn-primary text-sm" data-testid="save-prof-modal">Salvar</button>
        </div>
      </div>
    </div>
  );
};

/* ========== SERVICES PAGE (ENHANCED WITH SUBSCRIPTION) ========== */
export const ServicesPageFull = () => {
  const [services, setServices] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);

  useEffect(() => { load(); }, []);
  const load = async () => {
    const [s, c] = await Promise.all([schedulingAPI.getServices(), schedulingAPI.getCategories()]);
    setServices(s.data);
    setCategories(c.data);
  };

  const stats = {
    total: services.length,
    active: services.filter(s => s.is_active).length,
    avg_price: services.length ? (services.reduce((a, s) => a + (s.price || 0), 0) / services.length) : 0,
    avg_duration: services.length ? Math.round(services.reduce((a, s) => a + (s.duration || 0), 0) / services.length) : 0
  };

  const filtered = services.filter(s => s.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="animate-fade-in" data-testid="services-full-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold font-heading text-slate-900">Servicos e Produtos</h2>
          <p className="text-sm text-slate-600">Gerencie seu catalogo de servicos e produtos</p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2" data-testid="new-service-btn">
          <Plus className="w-4 h-4" /> Novo Item
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Servicos" value={stats.total} icon={<Scissors className="w-5 h-5" />} />
        <StatCard label="Ativos" value={stats.active} icon={<CheckCircle2 className="w-5 h-5" />} color="text-emerald-600" />
        <StatCard label="Preco Medio" value={`R$ ${stats.avg_price.toFixed(2)}`} icon={<DollarSign className="w-5 h-5" />} color="text-blue-600" />
        <StatCard label="Duracao Media" value={`${stats.avg_duration}min`} icon={<Clock className="w-5 h-5" />} color="text-orange-600" />
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar servicos e produtos..." className="input-field pl-10" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(s => (
          <div key={s.id} className="card !p-4" data-testid={`svc-card-${s.id}`}>
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="font-bold text-slate-900">{s.name}</p>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${s.type === 'service' ? 'bg-blue-100 text-blue-700' : s.type === 'product' ? 'bg-amber-100 text-amber-700' : 'bg-violet-100 text-violet-700'}`}>
                  {s.type === 'service' ? 'Servico' : s.type === 'product' ? 'Produto' : 'Assinatura'}
                </span>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full ${s.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                {s.is_active ? 'Ativo' : 'Inativo'}
              </span>
            </div>
            {s.description && <p className="text-xs text-slate-500 mb-3 line-clamp-2">{s.description}</p>}
            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <span className="text-lg font-bold text-primary">R$ {(s.price || 0).toFixed(2)}</span>
              <span className="text-xs text-slate-500 flex items-center gap-1"><Clock className="w-3 h-3" /> {s.duration} min</span>
            </div>
          </div>
        ))}
      </div>

      {showModal && <ServiceModal categories={categories} services={services} onClose={() => setShowModal(false)} onSave={() => { setShowModal(false); load(); }} />}
    </div>
  );
};

const ServiceModal = ({ categories, services, onClose, onSave }) => {
  const [isSubscription, setIsSubscription] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', price: '', duration: '', type: 'service', category_id: '' });
  const [subForm, setSubForm] = useState({ plan_name: '', plan_price: '', visits_per_month: '', included_service_ids: [] });

  const handleSave = async () => {
    if (isSubscription) {
      await schedulingAPI.createSubscriptionPlan({
        name: subForm.plan_name,
        price: parseFloat(subForm.plan_price),
        visits_per_month: parseInt(subForm.visits_per_month),
        included_service_ids: subForm.included_service_ids,
        description: form.description,
      });
      toast.success('Plano de assinatura criado!');
    } else {
      await schedulingAPI.createService({
        ...form,
        price: parseFloat(form.price),
        duration: parseInt(form.duration),
        category_id: form.category_id || undefined,
      });
      toast.success('Servico criado!');
    }
    onSave();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-200">
          <div>
            <h3 className="text-lg font-bold font-heading">{isSubscription ? 'Novo Plano' : 'Novo Servico'}</h3>
            <p className="text-xs text-slate-500">Preencha as informacoes do novo {isSubscription ? 'plano' : 'servico'}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Subscription toggle */}
          <label className="flex items-center gap-2 cursor-pointer" data-testid="subscription-toggle">
            <input type="checkbox" checked={isSubscription} onChange={e => setIsSubscription(e.target.checked)} className="w-4 h-4 text-primary rounded" />
            <span className="text-sm font-medium text-slate-700">Marcar como plano de assinatura</span>
          </label>

          {!isSubscription ? (
            <>
              <div><label className="text-sm font-medium text-slate-700 mb-1 block">Tipo</label>
                <select value={form.type} onChange={e => setForm({...form, type: e.target.value})} className="input-field">
                  <option value="service">Servico</option><option value="product">Produto</option>
                </select></div>
              <div><label className="text-sm font-medium text-slate-700 mb-1 block">Nome do Servico</label>
                <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Ex: Corte Feminino" className="input-field" data-testid="svc-name" /></div>
              <div><label className="text-sm font-medium text-slate-700 mb-1 block">Categoria</label>
                <select value={form.category_id} onChange={e => setForm({...form, category_id: e.target.value})} className="input-field">
                  <option value="">Selecione uma categoria</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-sm font-medium text-slate-700 mb-1 block">Preco (R$)</label>
                  <input type="number" value={form.price} onChange={e => setForm({...form, price: e.target.value})} className="input-field" data-testid="svc-price" /></div>
                <div><label className="text-sm font-medium text-slate-700 mb-1 block">Duracao (min)</label>
                  <input type="number" value={form.duration} onChange={e => setForm({...form, duration: e.target.value})} className="input-field" data-testid="svc-duration" /></div>
              </div>
              <div><label className="text-sm font-medium text-slate-700 mb-1 block">Descricao</label>
                <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Descreva o item..." className="input-field" rows={3} /></div>
            </>
          ) : (
            <>
              <div><label className="text-sm font-medium text-slate-700 mb-1 block">Nome do Plano</label>
                <input value={subForm.plan_name} onChange={e => setSubForm({...subForm, plan_name: e.target.value})} placeholder="Ex: Plano Mensal" className="input-field" data-testid="plan-name" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-sm font-medium text-slate-700 mb-1 block">Preco (R$)</label>
                  <input type="number" value={subForm.plan_price} onChange={e => setSubForm({...subForm, plan_price: e.target.value})} className="input-field" data-testid="plan-price" /></div>
                <div><label className="text-sm font-medium text-slate-700 mb-1 block">Visitas por Mes</label>
                  <input type="number" value={subForm.visits_per_month} onChange={e => setSubForm({...subForm, visits_per_month: e.target.value})} className="input-field" /></div>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1 block">Servicos Incluidos no Plano:</label>
                <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1">
                  {services.filter(s => s.type === 'service').map(s => (
                    <label key={s.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 cursor-pointer">
                      <input type="checkbox" checked={subForm.included_service_ids.includes(s.id)}
                        onChange={e => setSubForm({...subForm, included_service_ids: e.target.checked
                          ? [...subForm.included_service_ids, s.id]
                          : subForm.included_service_ids.filter(id => id !== s.id)})}
                        className="w-4 h-4 text-primary rounded" />
                      <span className="text-sm text-slate-700">{s.name} - R$ {(s.price || 0).toFixed(2)}</span>
                    </label>
                  ))}
                  {services.filter(s => s.type === 'service').length === 0 && (
                    <p className="text-xs text-slate-400 py-2 text-center">Cadastre servicos primeiro</p>
                  )}
                </div>
              </div>
              <div><label className="text-sm font-medium text-slate-700 mb-1 block">Descricao</label>
                <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Descreva o item..." className="input-field" rows={2} /></div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 p-5 border-t border-slate-200">
          <button onClick={onClose} className="btn-secondary text-sm">Cancelar</button>
          <button onClick={handleSave} className="btn-primary text-sm" data-testid="save-svc-modal">Criar {isSubscription ? 'Plano' : 'Servico'}</button>
        </div>
      </div>
    </div>
  );
};

/* ========== SUBSCRIPTIONS PAGE ========== */
export const SubscriptionsPageFull = () => {
  const [subs, setSubs] = useState([]);
  const [plans, setPlans] = useState([]);
  const [clients, setClients] = useState([]);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => { load(); }, []);
  const load = async () => {
    const [s, p, c] = await Promise.all([
      schedulingAPI.getSubscriptions(),
      schedulingAPI.getSubscriptionPlans(),
      schedulingAPI.getClients()
    ]);
    setSubs(s.data);
    setPlans(p.data);
    setClients(c.data);
  };

  return (
    <div className="animate-fade-in" data-testid="subscriptions-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold font-heading text-slate-900">Assinaturas dos Clientes</h2>
          <p className="text-sm text-slate-600">Gerencie assinaturas dos clientes da sua empresa</p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2" data-testid="add-sub-btn">
          <Plus className="w-4 h-4" /> Adicionar Assinatura
        </button>
      </div>

      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-slate-200">
              <th className="text-left py-2 px-3 text-xs font-bold uppercase tracking-widest text-slate-400">Cliente</th>
              <th className="text-left py-2 px-3 text-xs font-bold uppercase tracking-widest text-slate-400">Plano</th>
              <th className="text-left py-2 px-3 text-xs font-bold uppercase tracking-widest text-slate-400">Valor</th>
              <th className="text-left py-2 px-3 text-xs font-bold uppercase tracking-widest text-slate-400">Status</th>
              <th className="text-left py-2 px-3 text-xs font-bold uppercase tracking-widest text-slate-400">Creditos</th>
              <th className="text-left py-2 px-3 text-xs font-bold uppercase tracking-widest text-slate-400">Prox. Cobranca</th>
              <th className="text-left py-2 px-3 text-xs font-bold uppercase tracking-widest text-slate-400">Acoes</th>
            </tr></thead>
            <tbody>
              {subs.map(sub => (
                <tr key={sub.id} className="border-b border-slate-100 hover:bg-slate-50 text-sm">
                  <td className="py-2 px-3"><p className="font-medium">{sub.client_name}</p><p className="text-xs text-slate-500">{sub.client_phone}</p></td>
                  <td className="py-2 px-3">{sub.plan_name}</td>
                  <td className="py-2 px-3 font-medium">R$ {(sub.plan_price || 0).toFixed(2)}/mes<br /><span className="text-xs text-slate-500">{sub.visits_per_month} visitas/mes</span></td>
                  <td className="py-2 px-3"><span className={`text-xs px-2 py-0.5 rounded-full ${sub.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{sub.status === 'active' ? 'Ativa' : 'Cancelada'}</span></td>
                  <td className="py-2 px-3">{sub.credits_remaining} restantes</td>
                  <td className="py-2 px-3 text-xs">{sub.next_billing_date ? new Date(sub.next_billing_date).toLocaleDateString('pt-BR') : '-'}</td>
                  <td className="py-2 px-3">
                    {sub.status === 'active' && (
                      <button onClick={async () => { await schedulingAPI.cancelSubscription(sub.id); toast.success('Cancelada'); load(); }}
                        className="text-xs text-red-500 hover:underline">Cancelar</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {subs.length === 0 && <p className="text-center py-8 text-sm text-slate-500">Nenhuma assinatura</p>}
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold font-heading">Adicionar Assinatura Manualmente</h3>
              <button onClick={() => setShowModal(false)} className="p-1 rounded hover:bg-slate-100"><X className="w-5 h-5" /></button>
            </div>
            <AddSubForm clients={clients} plans={plans} onSave={() => { setShowModal(false); load(); }} />
          </div>
        </div>
      )}
    </div>
  );
};

const AddSubForm = ({ clients, plans, onSave }) => {
  const [clientPhone, setClientPhone] = useState('');
  const [planId, setPlanId] = useState('');

  const handleSave = async () => {
    if (!clientPhone || !planId) { toast.error('Selecione cliente e plano'); return; }
    try {
      await schedulingAPI.createSubscription({ client_phone: clientPhone, plan_id: planId });
      toast.success('Assinatura criada!');
      onSave();
    } catch (e) { toast.error(e.response?.data?.detail || 'Erro'); }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium text-slate-700 mb-1 block">Cliente *</label>
        <select value={clientPhone} onChange={e => setClientPhone(e.target.value)} className="input-field" data-testid="sub-client-select">
          <option value="">Selecione um cliente</option>
          {clients.map(c => <option key={c.phone} value={c.phone}>{c.name} - {c.phone}</option>)}
        </select>
      </div>
      <div>
        <label className="text-sm font-medium text-slate-700 mb-1 block">Plano *</label>
        <select value={planId} onChange={e => setPlanId(e.target.value)} className="input-field" data-testid="sub-plan-select">
          <option value="">Selecione um plano</option>
          {plans.map(p => (
            <option key={p.id} value={p.id}>{p.name} - R$ {p.price.toFixed(2)}/mes ({p.visits_per_month} visitas)</option>
          ))}
        </select>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={handleSave} className="btn-primary text-sm" data-testid="create-sub-btn">Criar Assinatura</button>
      </div>
    </div>
  );
};

/* ========== SHARED ========== */
const StatCard = ({ label, value, icon, color = 'text-slate-600' }) => (
  <div className="card !p-4">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-xs text-slate-500 mb-1">{label}</p>
        <p className="text-xl font-bold font-heading text-slate-900">{value}</p>
      </div>
      <div className={`${color}`}>{icon}</div>
    </div>
  </div>
);

export default { ProfessionalsPageFull, ServicesPageFull, SubscriptionsPageFull };
