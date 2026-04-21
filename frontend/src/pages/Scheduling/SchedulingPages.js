import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { schedulingAPI, uploadAPI } from '../../services/api';
import { toast } from 'sonner';
import {
  Plus, Search, Star, Phone, Mail, Pencil, Trash2, X, Users, DollarSign,
  Calendar, Clock, Scissors, CreditCard, CheckCircle2, Upload, Image,
  List, Grid3X3, ChevronLeft, ChevronRight, Tag
} from 'lucide-react';

const API_BASE = process.env.REACT_APP_BACKEND_URL;

/* ========== PROFESSIONALS PAGE ========== */
export const ProfessionalsPageFull = () => {
  const [professionals, setProfessionals] = useState([]);
  const [stats, setStats] = useState({});
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [suspendingProf, setSuspendingProf] = useState(null);

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
        <p className="text-sm text-slate-600">Gerencie sua equipe de profissionais</p>
        <button onClick={() => { setEditing(null); setShowModal(true); }} className="btn-primary flex items-center gap-2" data-testid="new-prof-btn">
          <Plus className="w-4 h-4" /> Novo Profissional
        </button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <SC label="Total" value={stats.total || 0} icon={<Users className="w-5 h-5" />} />
        <SC label="Ativos" value={stats.active || 0} icon={<CheckCircle2 className="w-5 h-5" />} color="text-emerald-600" />
        <SC label="Receita Mes" value={`R$ ${(stats.revenue || 0).toFixed(2)}`} icon={<DollarSign className="w-5 h-5" />} color="text-blue-600" />
        <SC label="Agend. Hoje" value={stats.appointments_today || 0} icon={<Calendar className="w-5 h-5" />} color="text-orange-600" />
      </div>
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar profissionais..." className="input-field pl-10" data-testid="prof-search" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {professionals.map(prof => (
          <div key={prof.id} className="card !p-0 overflow-hidden" data-testid={`prof-card-${prof.id}`}>
            <div className={`h-1.5 ${prof.is_active ? 'bg-gradient-to-r from-emerald-400 to-teal-500' : 'bg-gradient-to-r from-violet-400 to-purple-500'}`} />
            <div className="p-5">
              <div className="flex items-center gap-3 mb-3">
                {prof.image_url ? (
                  <img src={`${API_BASE}${prof.image_url}`} alt={prof.name} className="w-14 h-14 rounded-full object-cover" />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-bold text-lg relative">
                    {prof.name?.substring(0, 2).toUpperCase()}
                  </div>
                )}
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
                <button onClick={() => { setEditing(prof); setShowModal(true); }} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400" data-testid={`edit-prof-${prof.id}`}>
                  <Pencil className="w-4 h-4" />
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {(prof.specialties || []).slice(0, 3).map((s, i) => <span key={`spec-${s}-${i}`} className="text-xs px-2 py-0.5 rounded-full border border-primary/30 text-primary">{s}</span>)}
              </div>
              <div className="space-y-1 mb-3 text-sm text-slate-600">
                <div className="flex items-center gap-2"><Phone className="w-3.5 h-3.5" />{prof.phone || '-'}</div>
                <div className="flex items-center gap-2"><Mail className="w-3.5 h-3.5" /><span className="truncate">{prof.email || '-'}</span></div>
              </div>
              <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-100 text-center">
                <div><p className="text-[10px] text-slate-400 uppercase">Comissao</p><p className="text-sm font-bold">{prof.commission_percent || 0}%</p></div>
                <div><p className="text-[10px] text-slate-400 uppercase">Hoje</p><p className="text-sm font-bold">{prof.appointments_today || 0}</p></div>
                <div><p className="text-[10px] text-slate-400 uppercase">Ganhos</p><p className="text-sm font-bold text-emerald-600">R$ {(prof.total_commission || 0).toFixed(0)}</p></div>
              </div>
              <button
                onClick={() => setSuspendingProf(prof)}
                className="w-full mt-3 flex items-center justify-center gap-2 py-2 rounded-lg border border-amber-200 bg-amber-50/60 text-amber-700 hover:bg-amber-100 transition-all text-sm font-medium"
                data-testid={`suspend-prof-btn-${prof.id}`}
              >
                <Calendar className="w-4 h-4" /> Suspender Agenda
              </button>
            </div>
          </div>
        ))}
      </div>
      {showModal && <ProfessionalModal professional={editing} onClose={() => setShowModal(false)} onSave={() => { setShowModal(false); load(); }} />}
      {suspendingProf && <SuspensionModal professional={suspendingProf} onClose={() => setSuspendingProf(null)} onSaved={() => { setSuspendingProf(null); load(); }} />}
    </div>
  );
};
/* ========== SUSPENSION MODAL (dedicated) ========== */
const SuspensionModal = ({ professional, onClose, onSaved }) => {
  const today = new Date().toISOString().split('T')[0];
  const [mode, setMode] = useState('days'); // 'days' (several days) or 'hours' (period in a day)
  const [form, setForm] = useState({
    start_date: today,
    end_date: today,
    start_time: '08:00',
    end_time: '18:00',
    reason: '',
  });
  const [saving, setSaving] = useState(false);
  const existing = professional?.suspensions || [];

  const handleSave = async () => {
    if (!form.start_date || !form.end_date) { toast.error('Informe as datas'); return; }
    if (mode === 'hours' && (!form.start_time || !form.end_time)) { toast.error('Informe os horarios'); return; }
    const payload = {
      start_date: form.start_date,
      end_date: mode === 'hours' ? form.start_date : form.end_date,
      reason: form.reason || '',
    };
    if (mode === 'hours') {
      payload.start_time = form.start_time;
      payload.end_time = form.end_time;
    }
    setSaving(true);
    try {
      await schedulingAPI.addSuspension(professional.id, payload);
      toast.success('Agenda suspensa!');
      onSaved?.();
    } catch (e) { toast.error('Erro ao suspender'); }
    finally { setSaving(false); }
  };

  const handleRemove = async (susId) => {
    try {
      await schedulingAPI.removeSuspension(professional.id, susId);
      toast.success('Suspensao removida');
      onSaved?.();
    } catch (e) { toast.error('Erro ao remover'); }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()} data-testid="suspension-modal">
        <div className="flex items-center justify-between p-4 border-b border-slate-100 sticky top-0 bg-white">
          <div>
            <h3 className="text-xl font-page-title">Suspender Agenda</h3>
            <p className="text-xs text-slate-500">{professional?.name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100" data-testid="close-suspension-modal"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 space-y-4">
          {/* Mode selector */}
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            <button onClick={() => setMode('days')}
              className={`flex-1 py-2 rounded-md text-xs font-semibold transition-all ${mode==='days' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}
              data-testid="suspension-mode-days">
              Período de dias
            </button>
            <button onClick={() => setMode('hours')}
              className={`flex-1 py-2 rounded-md text-xs font-semibold transition-all ${mode==='hours' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}
              data-testid="suspension-mode-hours">
              Período do dia
            </button>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-400">Data Inicio</label>
              <input type="date" value={form.start_date}
                onChange={e => setForm({...form, start_date: e.target.value, ...(mode==='hours'?{end_date: e.target.value}:{})})}
                className="input-field text-sm !py-2 w-full" data-testid="suspension-start-date" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-400">Data Fim</label>
              <input type="date" value={form.end_date}
                disabled={mode==='hours'}
                onChange={e => setForm({...form, end_date: e.target.value})}
                className="input-field text-sm !py-2 w-full disabled:bg-slate-50 disabled:text-slate-400"
                data-testid="suspension-end-date" />
            </div>
          </div>

          {/* Times (for 'hours' mode) */}
          {mode === 'hours' && (
            <div className="grid grid-cols-2 gap-2" data-testid="suspension-time-row">
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400">Hora Inicio</label>
                <input type="time" value={form.start_time}
                  onChange={e => setForm({...form, start_time: e.target.value})}
                  className="input-field text-sm !py-2 w-full" data-testid="suspension-start-time" />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400">Hora Fim</label>
                <input type="time" value={form.end_time}
                  onChange={e => setForm({...form, end_time: e.target.value})}
                  className="input-field text-sm !py-2 w-full" data-testid="suspension-end-time" />
              </div>
            </div>
          )}

          {/* Reason */}
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400">Motivo (opcional)</label>
            <input value={form.reason} onChange={e => setForm({...form, reason: e.target.value})}
              placeholder="Ex: Ferias, consulta, compromisso..."
              className="input-field text-sm !py-2" data-testid="suspension-reason" />
          </div>

          {/* Existing suspensions */}
          {existing.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase text-slate-400 mb-2">Suspensoes Ativas</p>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {existing.map(sus => (
                  <div key={sus.id} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg" data-testid={`existing-sus-${sus.id}`}>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-slate-900 truncate">
                        {sus.start_date}{sus.end_date !== sus.start_date ? ` → ${sus.end_date}` : ''}
                        {sus.start_time && sus.end_time ? ` (${sus.start_time}-${sus.end_time})` : ''}
                      </p>
                      {sus.reason && <p className="text-[10px] text-slate-500 truncate">{sus.reason}</p>}
                    </div>
                    <button onClick={() => handleRemove(sus.id)} className="text-red-400 hover:text-red-600 p-1" data-testid={`remove-existing-sus-${sus.id}`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2 p-4 border-t border-slate-100 sticky bottom-0 bg-white">
          <button onClick={onClose} className="btn-secondary flex-1 text-sm">Cancelar</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary flex-1 text-sm" data-testid="confirm-suspension-btn">
            {saving ? 'Salvando...' : 'Suspender'}
          </button>
        </div>
      </div>
    </div>
  );
};



const ProfessionalModal = ({ professional, onClose, onSave }) => {
  const isEditing = !!professional;
  const [tab, setTab] = useState('personal');
  const [form, setForm] = useState({
    name: professional?.name || '', email: professional?.email || '', phone: professional?.phone || '',
    is_active: professional?.is_active ?? true, commission_percent: professional?.commission_percent || 0,
    specialties: professional?.specialties || [], image_url: professional?.image_url || '',
    working_hours: professional?.working_hours || {
      seg: { start: '08:00', end: '18:00', active: true },
      ter: { start: '08:00', end: '18:00', active: true },
      qua: { start: '08:00', end: '18:00', active: true },
      qui: { start: '08:00', end: '18:00', active: true },
      sex: { start: '08:00', end: '18:00', active: true },
      sab: { start: '08:00', end: '13:00', active: true },
      dom: { start: '00:00', end: '00:00', active: false },
    },
  });
  const [isUser, setIsUser] = useState(false);
  const [userForm, setUserForm] = useState({ password: '', permission_profile_id: '' });
  const [profiles, setProfiles] = useState([]);
  const [suspensions, setSuspensions] = useState(professional?.suspensions || []);
  const [newSuspension, setNewSuspension] = useState({ start_date: '', end_date: '', reason: '' });
  const [newSpec, setNewSpec] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    schedulingAPI.getPermissionProfiles().then(r => setProfiles(r.data)).catch(() => {});
    // If editing, check if there's a linked user
    if (isEditing && professional?.id) {
      schedulingAPI.getCompanyUsers().then(r => {
        const linked = (r.data || []).find(u => u.professional_id === professional.id);
        if (linked) {
          setIsUser(true);
          setUserForm({ password: '', permission_profile_id: linked.permission_profile_id || '' });
        }
      }).catch(() => {});
    }
  }, [isEditing, professional]);

  const DAY_LABELS = { seg: 'Segunda', ter: 'Terca', qua: 'Quarta', qui: 'Quinta', sex: 'Sexta', sab: 'Sabado', dom: 'Domingo' };

  const handleUpload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadAPI.uploadBookingImage(file);
      setForm(f => ({ ...f, image_url: res.data.url }));
      toast.success('Foto enviada!');
    } catch (e) { toast.error('Erro no upload'); }
    finally { setUploading(false); }
  };

  const handleAddSuspension = async () => {
    if (!newSuspension.start_date || !newSuspension.end_date) { toast.error('Informe as datas'); return; }
    if (isEditing) {
      try {
        const res = await schedulingAPI.addSuspension(professional.id, newSuspension);
        setSuspensions(s => [...s, res.data]);
        setNewSuspension({ start_date: '', end_date: '', reason: '' });
        toast.success('Suspensao adicionada!');
      } catch (e) { toast.error('Erro ao adicionar suspensao'); }
    } else {
      setSuspensions(s => [...s, { id: Date.now().toString(), ...newSuspension }]);
      setNewSuspension({ start_date: '', end_date: '', reason: '' });
    }
  };

  const handleRemoveSuspension = async (susId) => {
    if (isEditing) {
      try {
        await schedulingAPI.removeSuspension(professional.id, susId);
        setSuspensions(s => s.filter(x => x.id !== susId));
        toast.success('Suspensao removida!');
      } catch (e) { toast.error('Erro ao remover'); }
    } else {
      setSuspensions(s => s.filter(x => x.id !== susId));
    }
  };

  const handleSave = async () => {
    const payload = { name: form.name, specialties: form.specialties, image_url: form.image_url || undefined, working_hours: form.working_hours };
    if (form.phone) payload.phone = form.phone;
    if (form.email) payload.email = form.email;
    try {
      let profId = professional?.id;
      if (isEditing) {
        await schedulingAPI.updateProfessional(professional.id, { ...payload, is_active: form.is_active, commission_percent: form.commission_percent });
      } else {
        const res = await schedulingAPI.createProfessional(payload);
        profId = res.data.id;
      }

      // Handle linked user
      if (isUser) {
        if (!form.email) { toast.error('Email e obrigatorio para criar usuario'); return; }
        const allUsers = await schedulingAPI.getCompanyUsers();
        const existing = (allUsers.data || []).find(u => u.professional_id === profId);
        if (existing) {
          const upd = { permission_profile_id: userForm.permission_profile_id || null, email: form.email, name: form.name };
          if (userForm.password) upd.password = userForm.password;
          await schedulingAPI.updateCompanyUser(existing.id, upd);
        } else {
          if (!userForm.password) { toast.error('Informe a senha do usuario'); return; }
          await schedulingAPI.createCompanyUser({
            name: form.name,
            email: form.email,
            password: userForm.password,
            permission_profile_id: userForm.permission_profile_id || null,
            professional_id: profId,
          });
        }
      }

      toast.success(isEditing ? 'Atualizado!' : 'Criado!');
      onSave();
    } catch (e) { toast.error(e.response?.data?.detail || 'Erro ao salvar'); }
  };

  const updateDayHours = (day, field, value) => {
    setForm(f => ({
      ...f,
      working_hours: { ...f.working_hours, [day]: { ...f.working_hours[day], [field]: value } }
    }));
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-200 sticky top-0 bg-white z-10">
          <h3 className="text-xl font-page-title">{isEditing ? 'Editar Profissional' : 'Novo Profissional'}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex border-b border-slate-200 px-5 overflow-x-auto">
          {['personal', 'professional', 'hours', 'suspensions'].map(t => (
            <button key={t} onClick={() => setTab(t)} className={`py-2.5 px-4 text-sm font-medium relative whitespace-nowrap ${tab === t ? 'text-primary' : 'text-slate-500'}`}>
              {t === 'personal' ? 'Dados' : t === 'professional' ? 'Profissional' : t === 'hours' ? 'Horarios' : 'Folgas'}
              {tab === t && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
            </button>
          ))}
        </div>
        <div className="p-5 space-y-4">
          {tab === 'personal' && (
            <>
              {/* Photo upload */}
              <div className="flex items-center gap-4">
                <input type="file" ref={fileRef} className="hidden" accept="image/*" onChange={e => handleUpload(e.target.files[0])} />
                <div className="relative cursor-pointer" onClick={() => fileRef.current?.click()} data-testid="prof-photo-upload">
                  {form.image_url ? (
                    <img src={`${API_BASE}${form.image_url}`} alt="Foto" className="w-20 h-20 rounded-full object-cover" />
                  ) : (
                    <div className="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center"><Upload className="w-6 h-6 text-slate-400" /></div>
                  )}
                  {uploading && <div className="absolute inset-0 bg-white/70 rounded-full flex items-center justify-center"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" /></div>}
                </div>
                <div><p className="text-sm font-medium text-slate-700">Foto do Profissional</p><p className="text-xs text-slate-500">Clique para enviar (aparece no site publico)</p></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-sm font-medium text-slate-700 mb-1 block">Nome</label><input value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="input-field" data-testid="prof-name" /></div>
                <div><label className="text-sm font-medium text-slate-700 mb-1 block">Telefone</label><input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} className="input-field" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-sm font-medium text-slate-700 mb-1 block">Email</label><input value={form.email} onChange={e => setForm({...form, email: e.target.value})} className="input-field" /></div>
                <div><label className="text-sm font-medium text-slate-700 mb-1 block">Status</label>
                  <select value={form.is_active ? 'true' : 'false'} onChange={e => setForm({...form, is_active: e.target.value === 'true'})} className="input-field">
                    <option value="true">Ativo</option><option value="false">Inativo</option>
                  </select></div>
              </div>

              {/* Sistema de Usuario Toggle */}
              <div className="border border-slate-200 rounded-xl p-3 bg-slate-50" data-testid="user-toggle-section">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={isUser} onChange={e => setIsUser(e.target.checked)} className="w-4 h-4 rounded text-primary" data-testid="is-user-checkbox" />
                  <span className="text-sm font-medium text-slate-900">Este profissional e tambem um usuario do sistema</span>
                </label>
                {isUser && (
                  <div className="mt-3 space-y-2" data-testid="user-fields-section">
                    <p className="text-xs text-slate-500">Usara o email acima para fazer login.</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs font-medium text-slate-700 mb-1 block">Senha {isEditing ? '(opcional)' : '*'}</label>
                        <input type="password" value={userForm.password} onChange={e => setUserForm({...userForm, password: e.target.value})} className="input-field text-sm !py-2" placeholder={isEditing ? 'Deixe em branco para manter' : 'Senha do usuario'} data-testid="user-password-input" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-700 mb-1 block">Perfil de Acesso</label>
                        <select value={userForm.permission_profile_id} onChange={e => setUserForm({...userForm, permission_profile_id: e.target.value})} className="input-field text-sm !py-2" data-testid="user-profile-select">
                          <option value="">Sem perfil</option>
                          {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
          {tab === 'professional' && (
            <>
              <div><label className="text-sm font-medium text-slate-700 mb-1 block">Comissao (%)</label>
                <input type="number" value={form.commission_percent} onChange={e => setForm({...form, commission_percent: parseInt(e.target.value)||0})} className="input-field" min={0} max={100} /></div>
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1 block">Especialidades</label>
                <div className="flex gap-2 mb-2">
                  <input value={newSpec} onChange={e => setNewSpec(e.target.value)} onKeyDown={e => e.key==='Enter' && newSpec.trim() && (setForm({...form, specialties:[...form.specialties,newSpec.trim()]}),setNewSpec(''))} placeholder="Ex: Corte Social" className="input-field flex-1" />
                  <button onClick={() => newSpec.trim() && (setForm({...form, specialties:[...form.specialties,newSpec.trim()]}),setNewSpec(''))} className="btn-primary text-sm">Add</button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {form.specialties.map((s,i) => (
                    <span key={`spec-${s}-${i}`} className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary flex items-center gap-1">
                      {s} <button onClick={() => setForm({...form, specialties: form.specialties.filter((_,j)=>j!==i)})}><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                </div>
              </div>
            </>
          )}
          {tab === 'hours' && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500 mb-2">Defina os horarios de trabalho para cada dia. Se nao definido, usara o horario do estabelecimento.</p>
              {Object.entries(DAY_LABELS).map(([key, label]) => (
                <div key={key} className="flex items-center gap-3 p-2 bg-slate-50 rounded-lg" data-testid={`hours-${key}`}>
                  <label className="flex items-center gap-2 w-24 cursor-pointer">
                    <input type="checkbox" checked={form.working_hours[key]?.active ?? false}
                      onChange={e => updateDayHours(key, 'active', e.target.checked)}
                      className="w-4 h-4 text-primary rounded" />
                    <span className="text-sm font-medium text-slate-700">{label}</span>
                  </label>
                  {form.working_hours[key]?.active && (
                    <div className="flex items-center gap-2">
                      <input type="time" value={form.working_hours[key]?.start || '08:00'}
                        onChange={e => updateDayHours(key, 'start', e.target.value)}
                        className="input-field !py-1 text-sm" />
                      <span className="text-xs text-slate-400">ate</span>
                      <input type="time" value={form.working_hours[key]?.end || '18:00'}
                        onChange={e => updateDayHours(key, 'end', e.target.value)}
                        className="input-field !py-1 text-sm" />
                    </div>
                  )}
                  {!form.working_hours[key]?.active && <span className="text-xs text-slate-400">Folga</span>}
                </div>
              ))}
            </div>
          )}
          {tab === 'suspensions' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">Adicione periodos de folga ou suspensao (ferias, licenca, etc).</p>
              <div className="p-3 bg-slate-50 rounded-lg space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="text-xs font-medium text-slate-700">Data Inicio</label>
                    <input type="date" value={newSuspension.start_date} onChange={e => setNewSuspension({...newSuspension, start_date: e.target.value})} className="input-field text-sm" data-testid="suspension-start" /></div>
                  <div><label className="text-xs font-medium text-slate-700">Data Fim</label>
                    <input type="date" value={newSuspension.end_date} onChange={e => setNewSuspension({...newSuspension, end_date: e.target.value})} className="input-field text-sm" data-testid="suspension-end" /></div>
                </div>
                <input value={newSuspension.reason} onChange={e => setNewSuspension({...newSuspension, reason: e.target.value})} placeholder="Motivo (opcional)" className="input-field text-sm" />
                <button onClick={handleAddSuspension} className="btn-primary text-sm w-full" data-testid="add-suspension-btn">Adicionar Suspensao</button>
              </div>
              <div className="space-y-2">
                {suspensions.map(sus => (
                  <div key={sus.id} className="flex items-center justify-between p-3 border border-slate-200 rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{sus.start_date} - {sus.end_date}</p>
                      {sus.reason && <p className="text-xs text-slate-500">{sus.reason}</p>}
                    </div>
                    <button onClick={() => handleRemoveSuspension(sus.id)} className="text-red-500 hover:text-red-700 p-1" data-testid={`remove-sus-${sus.id}`}><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
                {suspensions.length === 0 && <p className="text-xs text-slate-400 text-center py-4">Nenhuma suspensao cadastrada</p>}
              </div>
            </div>
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

/* ========== SERVICES PAGE WITH EDIT + PHOTO ========== */
export const ServicesPageFull = () => {
  const [services, setServices] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);

  useEffect(() => { load(); }, []);
  const load = async () => {
    const [s, c] = await Promise.all([schedulingAPI.getServices(), schedulingAPI.getCategories()]);
    setServices(s.data); setCategories(c.data);
  };

  const stats = useMemo(() => ({ total: services.length, active: services.filter(s=>s.is_active).length,
    avg_price: services.length ? services.reduce((a,s)=>a+(s.price||0),0)/services.length : 0,
    avg_duration: services.length ? Math.round(services.reduce((a,s)=>a+(s.duration||0),0)/services.length) : 0 }), [services]);
  const filtered = useMemo(() => services.filter(s => s.name.toLowerCase().includes(search.toLowerCase())), [services, search]);

  return (
    <div className="animate-fade-in" data-testid="services-full-page">
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-slate-600">Gerencie seu catalogo</p>
        <button onClick={() => { setEditing(null); setShowModal(true); }} className="btn-primary flex items-center gap-2" data-testid="new-service-btn"><Plus className="w-4 h-4" /> Novo Item</button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <SC label="Total" value={stats.total} icon={<Scissors className="w-5 h-5" />} />
        <SC label="Ativos" value={stats.active} icon={<CheckCircle2 className="w-5 h-5" />} color="text-emerald-600" />
        <SC label="Preco Medio" value={`R$ ${stats.avg_price.toFixed(2)}`} icon={<DollarSign className="w-5 h-5" />} color="text-blue-600" />
        <SC label="Duracao Media" value={`${stats.avg_duration}min`} icon={<Clock className="w-5 h-5" />} color="text-orange-600" />
      </div>
      <div className="relative mb-4"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" /><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar..." className="input-field pl-10" /></div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(s => (
          <div key={s.id} className="card !p-0 overflow-hidden" data-testid={`svc-card-${s.id}`}>
            {s.image_url && <img src={`${API_BASE}${s.image_url}`} alt={s.name} className="w-full h-32 object-cover" />}
            <div className="p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="font-bold text-slate-900">{s.name}</p>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${s.type==='service'?'bg-blue-100 text-blue-700':s.type==='product'?'bg-amber-100 text-amber-700':'bg-violet-100 text-violet-700'}`}>
                    {s.type==='service'?'Servico':s.type==='product'?'Produto':'Assinatura'}
                  </span>
                </div>
                <button onClick={() => { setEditing(s); setShowModal(true); }} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400" data-testid={`edit-svc-${s.id}`}>
                  <Pencil className="w-4 h-4" />
                </button>
              </div>
              {s.description && <p className="text-xs text-slate-500 mb-3 line-clamp-2">{s.description}</p>}
              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <span className="text-lg font-bold text-primary">R$ {(s.price||0).toFixed(2)}</span>
                <span className="text-xs text-slate-500 flex items-center gap-1"><Clock className="w-3 h-3" /> {s.duration} min</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      {showModal && <ServiceModal service={editing} categories={categories} allServices={services} onClose={() => setShowModal(false)} onSave={() => { setShowModal(false); load(); }} />}
    </div>
  );
};

const ServiceModal = ({ service, categories, allServices, onClose, onSave }) => {
  const isEditing = !!service;
  const [isSubscription, setIsSubscription] = useState(false);
  const [form, setForm] = useState({
    name: service?.name || '', description: service?.description || '',
    price: service?.price?.toString() || '', duration: service?.duration?.toString() || '',
    type: service?.type || 'service', category_id: service?.category_id || '',
    image_url: service?.image_url || '', is_active: service?.is_active ?? true,
  });
  const [subForm, setSubForm] = useState({ plan_name: '', plan_price: '', visits_per_month: '', included_service_ids: [] });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const handleUpload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadAPI.uploadBookingImage(file);
      setForm(f => ({ ...f, image_url: res.data.url }));
      toast.success('Foto enviada!');
    } catch (e) { toast.error('Erro no upload'); }
    finally { setUploading(false); }
  };

  const handleSave = async () => {
    try {
      const svcData = { name: form.name, description: form.description, price: parseFloat(form.price), duration: parseInt(form.duration),
        type: form.type, category_id: form.category_id || undefined, image_url: form.image_url || undefined };
      if (isEditing) {
        await schedulingAPI.updateService(service.id, { ...svcData, is_active: form.is_active });
      } else {
        await schedulingAPI.createService(svcData);
      }
      if (isSubscription && subForm.plan_name) {
        await schedulingAPI.createSubscriptionPlan({
          name: subForm.plan_name, price: parseFloat(subForm.plan_price),
          visits_per_month: parseInt(subForm.visits_per_month),
          included_service_ids: subForm.included_service_ids, description: form.description,
        });
      }
      toast.success(isEditing ? 'Atualizado!' : 'Criado!');
      onSave();
    } catch (e) { toast.error('Erro ao salvar'); }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-200 sticky top-0 bg-white z-10">
          <h3 className="text-xl font-page-title">{isEditing ? 'Editar Servico' : 'Novo Servico'}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          {/* Photo */}
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1 block">Foto</label>
            <input type="file" ref={fileRef} className="hidden" accept="image/*" onChange={e => handleUpload(e.target.files[0])} />
            <div className="border-2 border-dashed border-slate-300 rounded-xl p-4 text-center cursor-pointer hover:border-primary transition-colors" onClick={() => fileRef.current?.click()} data-testid="svc-photo-upload">
              {form.image_url ? <img src={`${API_BASE}${form.image_url}`} alt="Foto" className="max-h-24 mx-auto rounded" /> :
                <div><Image className="w-8 h-8 text-slate-400 mx-auto mb-1" /><p className="text-xs text-slate-500">Clique para enviar foto</p></div>}
              {uploading && <p className="text-xs text-primary mt-1">Enviando...</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-sm font-medium text-slate-700 mb-1 block">Tipo</label>
              <select value={form.type} onChange={e => setForm({...form, type: e.target.value})} className="input-field">
                <option value="service">Servico</option><option value="product">Produto</option>
              </select></div>
            {isEditing && <div><label className="text-sm font-medium text-slate-700 mb-1 block">Status</label>
              <select value={form.is_active?'true':'false'} onChange={e => setForm({...form, is_active: e.target.value==='true'})} className="input-field">
                <option value="true">Ativo</option><option value="false">Inativo</option>
              </select></div>}
          </div>
          <div><label className="text-sm font-medium text-slate-700 mb-1 block">Nome</label>
            <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="input-field" data-testid="svc-name" /></div>
          <div><label className="text-sm font-medium text-slate-700 mb-1 block">Categoria</label>
            <select value={form.category_id} onChange={e => setForm({...form, category_id: e.target.value})} className="input-field">
              <option value="">Sem categoria</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-sm font-medium text-slate-700 mb-1 block">Preco (R$)</label>
              <input type="number" value={form.price} onChange={e => setForm({...form, price: e.target.value})} className="input-field" data-testid="svc-price" /></div>
            <div><label className="text-sm font-medium text-slate-700 mb-1 block">Duracao (min)</label>
              <input type="number" value={form.duration} onChange={e => setForm({...form, duration: e.target.value})} className="input-field" data-testid="svc-duration" /></div>
          </div>
          <div><label className="text-sm font-medium text-slate-700 mb-1 block">Descricao</label>
            <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="input-field" rows={2} /></div>

          {/* Subscription section - expands, doesn't hide service fields */}
          {!isEditing && (
            <>
              <label className="flex items-center gap-2 cursor-pointer p-3 bg-violet-50 rounded-lg" data-testid="subscription-toggle">
                <input type="checkbox" checked={isSubscription} onChange={e => setIsSubscription(e.target.checked)} className="w-4 h-4 text-primary rounded" />
                <span className="text-sm font-medium text-violet-700">Disponibilizar como plano de assinatura</span>
              </label>
              {isSubscription && (
                <div className="p-4 bg-violet-50/50 rounded-lg border border-violet-200 space-y-3">
                  <p className="text-xs font-bold uppercase tracking-widest text-violet-600 mb-2">Dados da Assinatura</p>
                  <div><label className="text-sm font-medium text-slate-700 mb-1 block">Nome do Plano</label>
                    <input value={subForm.plan_name} onChange={e => setSubForm({...subForm, plan_name: e.target.value})} className="input-field" data-testid="plan-name" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="text-sm font-medium text-slate-700 mb-1 block">Preco Mensal</label>
                      <input type="number" value={subForm.plan_price} onChange={e => setSubForm({...subForm, plan_price: e.target.value})} className="input-field" data-testid="plan-price" /></div>
                    <div><label className="text-sm font-medium text-slate-700 mb-1 block">Visitas/Mes</label>
                      <input type="number" value={subForm.visits_per_month} onChange={e => setSubForm({...subForm, visits_per_month: e.target.value})} className="input-field" /></div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-slate-700 mb-1 block">Servicos incluidos</label>
                    <div className="max-h-32 overflow-y-auto border border-slate-200 rounded-lg p-2 bg-white space-y-1">
                      {allServices.filter(s => s.type === 'service').map(s => (
                        <label key={s.id} className="flex items-center gap-2 p-1 rounded hover:bg-slate-50 cursor-pointer text-sm">
                          <input type="checkbox" checked={subForm.included_service_ids.includes(s.id)}
                            onChange={e => setSubForm({...subForm, included_service_ids: e.target.checked ? [...subForm.included_service_ids, s.id] : subForm.included_service_ids.filter(id => id !== s.id)})}
                            className="w-4 h-4 text-primary rounded" />
                          {s.name} - R$ {(s.price||0).toFixed(2)}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 p-5 border-t border-slate-200 sticky bottom-0 bg-white">
          <button onClick={onClose} className="btn-secondary text-sm">Cancelar</button>
          <button onClick={handleSave} className="btn-primary text-sm" data-testid="save-svc-modal">{isEditing ? 'Salvar' : 'Criar'}</button>
        </div>
      </div>
    </div>
  );
};

/* ========== SUBSCRIPTIONS PAGE (no changes needed, keep same) ========== */
export const SubscriptionsPageFull = () => {
  const [subs, setSubs] = useState([]);
  const [plans, setPlans] = useState([]);
  const [clients, setClients] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ client_phone: '', plan_id: '' });
  useEffect(() => { load(); }, []);
  const load = async () => {
    const [s,p,c] = await Promise.all([schedulingAPI.getSubscriptions(),schedulingAPI.getSubscriptionPlans(),schedulingAPI.getClients()]);
    setSubs(s.data); setPlans(p.data); setClients(c.data);
  };

  const selectedPlan = plans.find(p => p.id === form.plan_id);

  const handleCreate = async () => {
    if (!form.client_phone || !form.plan_id) { toast.error('Preencha todos'); return; }
    try {
      await schedulingAPI.createSubscription(form);
      toast.success('Assinatura criada!');
      setShowModal(false); setForm({ client_phone: '', plan_id: '' });
      load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Erro'); }
  };

  const formatDate = (iso) => {
    if (!iso) return '-';
    try { return new Date(iso).toLocaleDateString('pt-BR'); } catch (e) { return '-'; }
  };

  return (
    <div className="animate-fade-in" data-testid="subscriptions-page">
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-slate-600">{subs.length} assinaturas cadastradas</p>
        <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2" data-testid="add-sub-btn"><Plus className="w-4 h-4" /> Adicionar</button>
      </div>

      <div className="space-y-2">
        {subs.map(sub => {
          const isActive = sub.status === 'active';
          const isExpired = sub.status === 'expired';
          const credPct = sub.credits_total ? Math.round(((sub.credits_remaining || 0) / sub.credits_total) * 100) : 0;
          return (
            <div key={sub.id} className="card !p-4" data-testid={`sub-row-${sub.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex-1 min-w-[200px]">
                  <p className="text-sm font-semibold text-slate-900">{sub.client_name}</p>
                  <p className="text-xs text-slate-500">{sub.client_phone}</p>
                </div>
                <div className="flex-1 min-w-[180px]">
                  <p className="text-[10px] font-bold uppercase text-slate-400">Plano</p>
                  <p className="text-sm font-medium">{sub.plan_name}</p>
                </div>
                <div className="flex-1 min-w-[140px]">
                  <p className="text-[10px] font-bold uppercase text-slate-400">Vencimento</p>
                  <p className="text-sm font-medium">{formatDate(sub.end_date)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
                    isActive ? 'bg-emerald-100 text-emerald-700' :
                    isExpired ? 'bg-amber-100 text-amber-700' :
                    'bg-red-100 text-red-700'
                  }`}>
                    {isActive ? 'Ativa' : isExpired ? 'Vencida' : 'Cancelada'}
                  </span>
                  {isActive && (
                    <button onClick={async()=>{ if(!window.confirm('Cancelar assinatura?')) return; await schedulingAPI.cancelSubscription(sub.id); toast.success('Cancelada'); load(); }} className="p-1.5 rounded hover:bg-red-50 text-red-500" data-testid={`cancel-sub-${sub.id}`}><X className="w-4 h-4" /></button>
                  )}
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-100">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-500">Créditos</span>
                  <span className="font-bold">{sub.credits_remaining || 0} de {sub.credits_total || 0}</span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full transition-all ${isActive ? 'bg-emerald-500' : 'bg-slate-300'}`} style={{ width: `${credPct}%` }} />
                </div>
              </div>
            </div>
          );
        })}
        {subs.length === 0 && <div className="card text-center py-12"><CreditCard className="w-10 h-10 text-slate-300 mx-auto mb-2" /><p className="text-sm text-slate-500">Nenhuma assinatura</p></div>}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={()=>setShowModal(false)}>
          <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl p-5" onClick={e=>e.stopPropagation()} data-testid="add-sub-modal">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-page-title">Nova Assinatura</h3>
              <button onClick={()=>setShowModal(false)} className="p-1 rounded hover:bg-slate-100"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold uppercase text-slate-400">Cliente</label>
                <select value={form.client_phone} onChange={e => setForm({...form, client_phone: e.target.value})} className="input-field" data-testid="sub-client-select">
                  <option value="">Selecione</option>
                  {clients.map(c=><option key={c.phone} value={c.phone}>{c.name} - {c.phone}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-slate-400">Plano</label>
                <select value={form.plan_id} onChange={e => setForm({...form, plan_id: e.target.value})} className="input-field" data-testid="sub-plan-select">
                  <option value="">Selecione</option>
                  {plans.filter(p => p.is_active !== false).map(p => <option key={p.id} value={p.id}>{p.name} — R$ {p.price.toFixed(2)} · {p.total_credits || p.visits_per_month} créd · {p.cycle_days || 30}d</option>)}
                </select>
              </div>
              {selectedPlan && (
                <div className="p-3 bg-primary/5 rounded-xl text-xs space-y-1">
                  <p><b>Créditos:</b> {selectedPlan.total_credits || selectedPlan.visits_per_month}</p>
                  <p><b>Ciclo:</b> {selectedPlan.cycle_days || 30} dias</p>
                  <p><b>Valor:</b> R$ {selectedPlan.price.toFixed(2)}</p>
                  {selectedPlan.items?.length > 0 && (
                    <p className="text-slate-600"><b>Itens:</b> {selectedPlan.items.length} serviços configurados</p>
                  )}
                </div>
              )}
              <button onClick={handleCreate} className="btn-primary text-sm w-full" data-testid="create-sub-btn">Criar Assinatura</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ========== PLANOS PAGE (CRUD for SubscriptionPlan) ========== */
export const PlanosPageFull = () => {
  const [plans, setPlans] = useState([]);
  const [services, setServices] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);

  useEffect(() => { load(); }, []);
  const load = async () => {
    const [p, s] = await Promise.all([schedulingAPI.getSubscriptionPlans(), schedulingAPI.getServices()]);
    setPlans(p.data); setServices(s.data);
  };

  const handleSave = async (form) => {
    try {
      if (editing) {
        await schedulingAPI.updateSubscriptionPlan(editing.id, form);
        toast.success('Plano atualizado');
      } else {
        await schedulingAPI.createSubscriptionPlan(form);
        toast.success('Plano criado');
      }
      setShowModal(false); setEditing(null); load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Erro'); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Excluir este plano?')) return;
    try { await schedulingAPI.deleteSubscriptionPlan(id); toast.success('Excluido'); load(); }
    catch (e) { toast.error('Erro'); }
  };

  return (
    <div className="animate-fade-in" data-testid="planos-page">
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-slate-600">{plans.length} planos cadastrados</p>
        <button onClick={() => { setEditing(null); setShowModal(true); }} className="btn-primary flex items-center gap-2" data-testid="add-plan-btn">
          <Plus className="w-4 h-4" /> Novo Plano
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {plans.map(plan => (
          <div key={plan.id} className="card !p-4" data-testid={`plan-card-${plan.id}`}>
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="text-lg font-page-title text-slate-900">{plan.name}</p>
                <p className="text-xs text-slate-500">{plan.cycle_days || 30} dias · {plan.total_credits || plan.visits_per_month} créditos</p>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${plan.is_active !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                {plan.is_active !== false ? 'Ativo' : 'Inativo'}
              </span>
            </div>
            <p className="text-2xl font-bold text-primary mb-3">R$ {plan.price.toFixed(2)}</p>
            <div className="space-y-1 mb-3 max-h-28 overflow-y-auto text-xs">
              {(plan.items || []).map((it, i) => {
                const svc = services.find(s => s.id === it.service_id);
                return (
                  <div key={i} className="flex justify-between p-1.5 bg-slate-50 rounded">
                    <span className="truncate">{svc?.name || it.service_id}</span>
                    <span className="font-bold text-primary ml-2">{it.credits_per_use}c</span>
                  </div>
                );
              })}
              {(!plan.items || plan.items.length === 0) && <p className="text-[11px] text-slate-400 italic">Sem itens configurados</p>}
            </div>
            <div className="flex gap-2 pt-2 border-t border-slate-100">
              <button onClick={() => { setEditing(plan); setShowModal(true); }} className="flex-1 py-1.5 text-xs rounded-lg bg-slate-100 hover:bg-slate-200 font-medium" data-testid={`edit-plan-${plan.id}`}>
                <Pencil className="w-3 h-3 inline mr-1" /> Editar
              </button>
              <button onClick={() => handleDelete(plan.id)} className="py-1.5 px-3 text-xs rounded-lg border border-red-200 text-red-500 hover:bg-red-50" data-testid={`delete-plan-${plan.id}`}>
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))}
        {plans.length === 0 && <div className="col-span-full card text-center py-12"><Tag className="w-10 h-10 text-slate-300 mx-auto mb-2" /><p className="text-sm text-slate-500">Nenhum plano cadastrado</p><p className="text-xs text-slate-400 mt-1">Crie planos para oferecer assinaturas aos seus clientes</p></div>}
      </div>
      {showModal && <PlanoModal plan={editing} services={services} onClose={() => { setShowModal(false); setEditing(null); }} onSave={handleSave} />}
    </div>
  );
};

const PlanoModal = ({ plan, services, onClose, onSave }) => {
  const [form, setForm] = useState({
    name: plan?.name || '',
    price: plan?.price || 0,
    cycle_days: plan?.cycle_days || 30,
    total_credits: plan?.total_credits || plan?.visits_per_month || 0,
    description: plan?.description || '',
    is_active: plan?.is_active ?? true,
    items: plan?.items || [],
  });
  const [newSvc, setNewSvc] = useState({ service_id: '', credits_per_use: 1 });

  const addItem = () => {
    if (!newSvc.service_id) return;
    if (form.items.some(i => i.service_id === newSvc.service_id)) { toast.error('Serviço ja adicionado'); return; }
    setForm(f => ({ ...f, items: [...f.items, { service_id: newSvc.service_id, credits_per_use: Math.max(1, parseInt(newSvc.credits_per_use) || 1) }] }));
    setNewSvc({ service_id: '', credits_per_use: 1 });
  };

  const removeItem = (id) => setForm(f => ({ ...f, items: f.items.filter(i => i.service_id !== id) }));

  const updateItemCredits = (id, credits) => setForm(f => ({
    ...f,
    items: f.items.map(i => i.service_id === id ? { ...i, credits_per_use: Math.max(1, parseInt(credits) || 1) } : i)
  }));

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()} data-testid="plan-modal">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-xl font-page-title">{plan ? 'Editar Plano' : 'Novo Plano'}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400">Nome do Plano</label>
            <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Ex: Plano Mensal VIP" className="input-field text-sm" data-testid="plan-name-input" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-400">Valor (R$)</label>
              <input type="number" step="0.01" value={form.price} onChange={e => setForm({...form, price: parseFloat(e.target.value) || 0})} className="input-field text-sm" data-testid="plan-price-input" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-400">Ciclo (dias)</label>
              <input type="number" value={form.cycle_days} onChange={e => setForm({...form, cycle_days: parseInt(e.target.value) || 30})} className="input-field text-sm" data-testid="plan-cycle-input" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-400">Créditos</label>
              <input type="number" value={form.total_credits} onChange={e => setForm({...form, total_credits: parseInt(e.target.value) || 0})} className="input-field text-sm" data-testid="plan-credits-input" />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400">Descrição (opcional)</label>
            <input value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Ex: Inclui corte e barba ilimitados" className="input-field text-sm" />
          </div>

          <div className="border-t border-slate-100 pt-3">
            <label className="text-[10px] font-bold uppercase text-slate-400 block mb-2">Serviços/Produtos e Créditos por Uso</label>
            <div className="space-y-1.5 mb-2">
              {form.items.map(item => {
                const svc = services.find(s => s.id === item.service_id);
                return (
                  <div key={item.service_id} className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg" data-testid={`plan-item-${item.service_id}`}>
                    <span className="flex-1 text-sm truncate">{svc?.name || item.service_id}</span>
                    <input type="number" min="1" value={item.credits_per_use} onChange={e => updateItemCredits(item.service_id, e.target.value)} className="w-16 text-center text-sm input-field !py-1" data-testid={`plan-item-credits-${item.service_id}`} />
                    <span className="text-xs text-slate-500">créditos</span>
                    <button onClick={() => removeItem(item.service_id)} className="p-1 text-red-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
                  </div>
                );
              })}
              {form.items.length === 0 && <p className="text-[11px] text-slate-400 italic">Nenhum serviço adicionado</p>}
            </div>
            <div className="flex gap-2">
              <select value={newSvc.service_id} onChange={e => setNewSvc({...newSvc, service_id: e.target.value})} className="input-field text-sm flex-1" data-testid="plan-add-service">
                <option value="">Selecione um serviço/produto</option>
                {services.filter(s => !form.items.some(i => i.service_id === s.id)).map(s => <option key={s.id} value={s.id}>{s.name} — R$ {s.price.toFixed(2)}</option>)}
              </select>
              <input type="number" min="1" value={newSvc.credits_per_use} onChange={e => setNewSvc({...newSvc, credits_per_use: e.target.value})} className="w-16 text-center input-field text-sm" title="Creditos por uso" data-testid="plan-add-credits" />
              <button onClick={addItem} className="btn-secondary text-xs px-3" data-testid="plan-add-item-btn">Add</button>
            </div>
          </div>
        </div>
        <div className="p-4 border-t border-slate-100">
          <button onClick={() => form.name && form.total_credits > 0 && onSave(form)} className="btn-primary w-full text-sm" data-testid="save-plan-btn">
            Salvar Plano
          </button>
        </div>
      </div>
    </div>
  );
};

/* ========== CALENDAR PAGE (Monthly/Weekly/Daily views) ========== */
export const CalendarPageFull = () => {
  const [appointments, setAppointments] = useState([]);
  const [view, setView] = useState('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(null);

  useEffect(() => { load(); }, []);
  const load = async () => { const r = await schedulingAPI.getAppointments(); setAppointments(r.data); };

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const monthName = currentDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  const getAptsForDay = useCallback((day) => {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    return appointments.filter(a => a.date === dateStr);
  }, [appointments, year, month]);

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const todayApts = useMemo(() => appointments.filter(a => a.date === todayStr).sort((a,b) => a.time.localeCompare(b.time)), [appointments, todayStr]);

  const selectedDayApts = useMemo(() => {
    if (!selectedDay) return [];
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(selectedDay).padStart(2,'0')}`;
    return appointments.filter(a => a.date === dateStr).sort((a,b) => a.time.localeCompare(b.time));
  }, [selectedDay, appointments, year, month]);

  // Weekly view helpers
  const getWeekDates = useCallback(() => {
    const d = new Date(currentDate);
    const day = d.getDay();
    const start = new Date(d);
    start.setDate(d.getDate() - day);
    return Array.from({length: 7}, (_, i) => {
      const dt = new Date(start);
      dt.setDate(start.getDate() + i);
      return dt;
    });
  }, [currentDate]);

  const weekDates = getWeekDates();
  const HOURS = Array.from({length: 12}, (_, i) => i + 7); // 7-18

  const formatDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

  const getAptsForDateStr = useCallback((dateStr) => appointments.filter(a => a.date === dateStr), [appointments]);

  const STATUS_MAP = { confirmado: { bg: 'bg-emerald-500', text: 'Confirmado' }, pendente: { bg: 'bg-amber-500', text: 'Pendente' }, concluido: { bg: 'bg-blue-500', text: 'Concluido' }, cancelado: { bg: 'bg-red-500', text: 'Cancelado' } };

  const DayLabels = ['Dom','Seg','Ter','Qua','Qui','Sex','Sab'];

  return (
    <div className="animate-fade-in" data-testid="calendar-full-page">
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-slate-600">{appointments.length} agendamentos</p>
        <div className="flex items-center gap-2 bg-slate-100 rounded-lg p-1">
          {[{key:'month',label:'Mes'},{key:'week',label:'Semana'},{key:'day',label:'Dia'}].map(v => (
            <button key={v.key} onClick={() => setView(v.key)} className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${view===v.key?'bg-white text-slate-900 shadow-sm':'text-slate-500'}`} data-testid={`view-${v.key}`}>
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* === MONTH VIEW === */}
      {view === 'month' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 card">
            <div className="flex items-center justify-between mb-5">
              <button onClick={() => setCurrentDate(new Date(year, month-1, 1))} className="p-2 rounded-lg hover:bg-slate-100"><ChevronLeft className="w-5 h-5" /></button>
              <h3 className="text-lg font-semibold font-heading capitalize">{monthName}</h3>
              <button onClick={() => setCurrentDate(new Date(year, month+1, 1))} className="p-2 rounded-lg hover:bg-slate-100"><ChevronRight className="w-5 h-5" /></button>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {DayLabels.map(d => <div key={d} className="text-center text-[11px] font-bold text-slate-400 py-2 uppercase">{d}</div>)}
              {Array.from({length: firstDay}).map((_,i) => <div key={`e-${i}`} />)}
              {Array.from({length: daysInMonth}).map((_,i) => {
                const day = i + 1;
                const apts = getAptsForDay(day);
                const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
                const isSelected = day === selectedDay;
                return (
                  <button key={day} onClick={() => setSelectedDay(day === selectedDay ? null : day)}
                    className={`min-h-[72px] p-1.5 rounded-lg border text-xs transition-all text-left ${isSelected ? 'border-primary bg-primary/10 ring-1 ring-primary' : isToday ? 'border-primary/50 bg-primary/5' : 'border-slate-100 hover:bg-slate-50'}`}>
                    <p className={`font-bold mb-1 ${isToday||isSelected ? 'text-primary' : 'text-slate-700'}`}>{day}</p>
                    {apts.slice(0,2).map(a => (
                      <div key={a.id} className={`px-1 py-0.5 rounded text-[10px] mb-0.5 truncate font-medium ${a.status==='confirmado'?'bg-emerald-100 text-emerald-700':a.status==='pendente'?'bg-amber-100 text-amber-700':'bg-blue-100 text-blue-700'}`}>
                        {a.time} {a.customer_name?.split(' ')[0]}
                      </div>
                    ))}
                    {apts.length > 2 && <p className="text-[10px] text-primary font-medium">+{apts.length-2}</p>}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="card">
            <h3 className="font-semibold text-slate-900 mb-1">{selectedDay ? `Dia ${selectedDay}` : 'Hoje'}</h3>
            <p className="text-xs text-slate-500 mb-4">{(selectedDay ? selectedDayApts : todayApts).length} agendamentos</p>
            <div className="space-y-2">
              {(selectedDay ? selectedDayApts : todayApts).length === 0 && <p className="text-sm text-slate-400 py-8 text-center">Nenhum agendamento</p>}
              {(selectedDay ? selectedDayApts : todayApts).map(a => (
                <div key={a.id} className="flex items-center gap-2 p-2.5 bg-slate-50 rounded-lg">
                  <div className={`w-1 h-8 rounded-full ${STATUS_MAP[a.status]?.bg || 'bg-slate-300'}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-primary">{a.time}</p>
                    <p className="text-xs font-medium text-slate-900 truncate">{a.customer_name}</p>
                    <p className="text-[10px] text-slate-500 truncate">{a.service_name}</p>
                  </div>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full text-white ${STATUS_MAP[a.status]?.bg}`}>{STATUS_MAP[a.status]?.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* === WEEK VIEW === */}
      {view === 'week' && (
        <div className="card overflow-x-auto">
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => { const d = new Date(currentDate); d.setDate(d.getDate()-7); setCurrentDate(d); }} className="p-2 rounded-lg hover:bg-slate-100"><ChevronLeft className="w-5 h-5" /></button>
            <h3 className="text-sm font-semibold">
              {weekDates[0].toLocaleDateString('pt-BR',{day:'numeric',month:'short'})} - {weekDates[6].toLocaleDateString('pt-BR',{day:'numeric',month:'short',year:'numeric'})}
            </h3>
            <button onClick={() => { const d = new Date(currentDate); d.setDate(d.getDate()+7); setCurrentDate(d); }} className="p-2 rounded-lg hover:bg-slate-100"><ChevronRight className="w-5 h-5" /></button>
          </div>
          <div className="min-w-[700px]">
            <div className="grid grid-cols-8 gap-0 border-b border-slate-200">
              <div className="py-2 px-1 text-[10px] text-slate-400 font-bold">Hora</div>
              {weekDates.map((d,i) => {
                const ds = formatDateStr(d);
                const isToday = ds === todayStr;
                return <div key={i} className={`py-2 px-1 text-center ${isToday ? 'bg-primary/5' : ''}`}>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">{DayLabels[d.getDay()]}</p>
                  <p className={`text-sm font-bold ${isToday ? 'text-primary' : 'text-slate-700'}`}>{d.getDate()}</p>
                </div>;
              })}
            </div>
            {HOURS.map(hour => (
              <div key={hour} className="grid grid-cols-8 gap-0 border-b border-slate-50 min-h-[48px]">
                <div className="py-1 px-1 text-[10px] text-slate-400 font-mono">{String(hour).padStart(2,'0')}:00</div>
                {weekDates.map((d,i) => {
                  const ds = formatDateStr(d);
                  const hourApts = getAptsForDateStr(ds).filter(a => parseInt(a.time?.split(':')[0]) === hour);
                  return <div key={i} className="py-0.5 px-0.5 border-l border-slate-50">
                    {hourApts.map(a => (
                      <div key={a.id} className={`text-[9px] px-1 py-0.5 rounded mb-0.5 truncate ${a.status==='confirmado'?'bg-emerald-100 text-emerald-700':a.status==='pendente'?'bg-amber-100 text-amber-700':'bg-blue-100 text-blue-700'}`}>
                        {a.time} {a.customer_name?.split(' ')[0]}
                      </div>
                    ))}
                  </div>;
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* === DAY VIEW === */}
      {view === 'day' && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => { const d = new Date(currentDate); d.setDate(d.getDate()-1); setCurrentDate(d); }} className="p-2 rounded-lg hover:bg-slate-100"><ChevronLeft className="w-5 h-5" /></button>
            <h3 className="text-base font-semibold capitalize">
              {currentDate.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </h3>
            <button onClick={() => { const d = new Date(currentDate); d.setDate(d.getDate()+1); setCurrentDate(d); }} className="p-2 rounded-lg hover:bg-slate-100"><ChevronRight className="w-5 h-5" /></button>
          </div>
          <div className="space-y-0">
            {HOURS.map(hour => {
              const ds = formatDateStr(currentDate);
              const hourApts = getAptsForDateStr(ds).filter(a => parseInt(a.time?.split(':')[0]) === hour);
              return (
                <div key={hour} className="flex gap-3 border-b border-slate-50 min-h-[56px] py-1">
                  <div className="w-14 flex-shrink-0 text-right pr-2 pt-1">
                    <span className="text-xs font-mono text-slate-400">{String(hour).padStart(2,'0')}:00</span>
                  </div>
                  <div className="flex-1 space-y-1">
                    {hourApts.map(a => (
                      <div key={a.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg ${a.status==='confirmado'?'bg-emerald-50 border border-emerald-200':a.status==='pendente'?'bg-amber-50 border border-amber-200':'bg-blue-50 border border-blue-200'}`}>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900">{a.customer_name}</p>
                          <p className="text-xs text-slate-500">{a.service_name} • {a.professional_name}</p>
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full text-white ${STATUS_MAP[a.status]?.bg}`}>{a.time}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

/* ========== SHARED ========== */
const SC = ({ label, value, icon, color = 'text-slate-600' }) => (
  <div className="card !p-4"><div className="flex items-center justify-between"><div><p className="text-xs text-slate-500 mb-1">{label}</p><p className="text-xl font-bold font-heading text-slate-900">{value}</p></div><div className={color}>{icon}</div></div></div>
);

export default { ProfessionalsPageFull, ServicesPageFull, SubscriptionsPageFull, PlanosPageFull, CalendarPageFull };
