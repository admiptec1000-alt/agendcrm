import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { schedulingAPI } from '../../services/api';
import api from '../../services/api';
import { toast } from 'sonner';
import {
  ChevronLeft, ChevronRight, Plus, X, Search, Calendar, Users,
  Lock, Check, DollarSign, User, Phone, Clock, Trash2, CheckCircle2
} from 'lucide-react';

/**
 * AgendaProPage — Google-Calendar-style scheduling grid.
 *
 * Modernized 2026-05-07:
 *  - Instagram-stories-style horizontal "professional carousel" at top — each
 *    avatar is small, circular, with active ring. Clicking switches the day's
 *    visible agenda to that single professional's column (filter mode).
 *  - QuickBookModal upgraded:
 *    • Toggle "Agendamento" / "Bloqueio" — bloqueio cria slot reservado sem
 *      cliente/serviço, indo direto para `is_block: true`.
 *    • Cliente search com autocomplete sobre `schedulingAPI.getClients`.
 *    • Quando editing existing appointment, mostra botão "Concluir & cobrar"
 *      que abre a forma de pagamento (alimenta financeiro automaticamente).
 *
 * Same source-of-truth as legacy "Agenda": both pull from the `appointments`
 * collection via `schedulingAPI`, so changes here surface there too.
 */

const SLOT_MIN = 30;
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 22;

const STATUS_COLORS = {
  pendente:    { bg: 'bg-amber-100',   bd: 'border-amber-400',   tx: 'text-amber-900' },
  confirmado:  { bg: 'bg-emerald-100', bd: 'border-emerald-400', tx: 'text-emerald-900' },
  em_atendimento: { bg: 'bg-blue-100', bd: 'border-blue-400',    tx: 'text-blue-900' },
  concluido:   { bg: 'bg-slate-200',   bd: 'border-slate-400',   tx: 'text-slate-700' },
  cancelado:   { bg: 'bg-rose-100',    bd: 'border-rose-400',    tx: 'text-rose-900 line-through' },
};
const BLOCK_STYLE = { bg: 'bg-slate-300/70', bd: 'border-slate-500 border-dashed', tx: 'text-slate-700' };

const isoDate = (d) => d.toISOString().split('T')[0];
const addDays = (d, n) => { const c = new Date(d); c.setDate(c.getDate() + n); return c; };
const startOfWeek = (d) => { const c = new Date(d); c.setDate(c.getDate() - c.getDay()); return c; };
const initials = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase();

const buildSlots = () => {
  const out = [];
  for (let h = DAY_START_HOUR; h < DAY_END_HOUR; h++) {
    for (let m = 0; m < 60; m += SLOT_MIN) {
      out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return out;
};
const minutesFromHHMM = (hhmm) => {
  if (!hhmm) return 0;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export default function AgendaProPage() {
  const [view, setView] = useState('day');
  const [date, setDate] = useState(new Date());
  const [professionals, setProfessionals] = useState([]);
  const [services, setServices] = useState([]);
  const [activeProfId, setActiveProfId] = useState('');   // '' = ALL pros (day view shows all columns); set = filter
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [openModal, setOpenModal] = useState(null);

  const slots = useMemo(buildSlots, []);

  useEffect(() => {
    Promise.all([
      schedulingAPI.getProfessionals().catch(() => ({ data: [] })),
      schedulingAPI.getServices().catch(() => ({ data: [] })),
    ]).then(([p, s]) => {
      setProfessionals(p.data || []);
      setServices(s.data || []);
    });
  }, []);

  const loadAppts = useCallback(async () => {
    setLoading(true);
    try {
      let start, end;
      if (view === 'day') { start = end = isoDate(date); }
      else {
        const w0 = startOfWeek(date);
        start = isoDate(w0);
        end = isoDate(addDays(w0, 6));
      }
      const r = await schedulingAPI.getAppointments({ start_date: start, end_date: end });
      setAppointments(r.data || []);
    } catch { toast.error('Erro ao carregar agendamentos'); }
    finally { setLoading(false); }
  }, [view, date]);
  useEffect(() => { loadAppts(); }, [loadAppts]);

  const goPrev = () => setDate(addDays(date, view === 'day' ? -1 : -7));
  const goNext = () => setDate(addDays(date, view === 'day' ? 1 : 7));
  const goToday = () => setDate(new Date());

  const apptsByCol = useMemo(() => {
    const map = {};
    for (const a of appointments) {
      if (view === 'day') {
        if (a.date !== isoDate(date)) continue;
        if (activeProfId && a.professional_id !== activeProfId) continue;
        const k = a.professional_id || '_';
        (map[k] = map[k] || []).push(a);
      } else {
        if (activeProfId && a.professional_id !== activeProfId) continue;
        const k = a.date;
        (map[k] = map[k] || []).push(a);
      }
    }
    return map;
  }, [appointments, view, date, activeProfId]);

  const columns = useMemo(() => {
    if (view === 'day') {
      const list = activeProfId ? professionals.filter(p => p.id === activeProfId) : professionals;
      return list.map(p => ({ id: p.id, label: p.name, photo: p.photo_url }));
    }
    const w0 = startOfWeek(date);
    const wd = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(w0, i);
      return {
        id: isoDate(d),
        label: `${wd[i]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`,
        isToday: isoDate(d) === isoDate(new Date()),
      };
    });
  }, [view, date, professionals, activeProfId]);

  const headerLabel = useMemo(() => {
    if (view === 'day') {
      return date.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
    }
    const w0 = startOfWeek(date);
    const w6 = addDays(w0, 6);
    return `${String(w0.getDate()).padStart(2, '0')}/${String(w0.getMonth() + 1).padStart(2, '0')} → ${String(w6.getDate()).padStart(2, '0')}/${String(w6.getMonth() + 1).padStart(2, '0')}`;
  }, [view, date]);

  const handleSlotClick = (col, slot) => {
    if (view === 'day') {
      setOpenModal({ date: isoDate(date), time: slot, professional_id: col.id });
    } else {
      setOpenModal({ date: col.id, time: slot, professional_id: activeProfId || (professionals[0]?.id || '') });
    }
  };

  const handleAptClick = (a) => setOpenModal({ apt: a });

  const onDropApt = async (apt, col, slot) => {
    if (!apt) return;
    const newDate = view === 'day' ? isoDate(date) : col.id;
    const newProfId = view === 'day' ? col.id : (apt.professional_id || activeProfId);
    if (apt.date === newDate && apt.time === slot && apt.professional_id === newProfId) return;
    try {
      await schedulingAPI.updateAppointment(apt.id, {
        date: newDate, time: slot, professional_id: newProfId,
      });
      toast.success('Agendamento movido');
      loadAppts();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Falha ao mover');
    }
  };

  return (
    <div className="animate-fade-in" data-testid="agenda-pro-page">
      {/* Instagram-style professional carousel */}
      <div className="bg-white rounded-xl border border-slate-200 px-3 py-3 mb-3 overflow-x-auto" data-testid="agendapro-prof-carousel">
        <div className="flex items-center gap-3 min-w-max">
          {/* "Todos" / Equipe completa */}
          <button
            onClick={() => setActiveProfId('')}
            className="flex flex-col items-center gap-1 group"
            data-testid="agendapro-prof-all"
          >
            <div className={`w-14 h-14 rounded-full flex items-center justify-center transition ${activeProfId === '' ? 'ring-2 ring-offset-2 ring-blue-500' : 'ring-1 ring-slate-200'}`}>
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center text-white">
                <Users className="w-5 h-5" />
              </div>
            </div>
            <span className={`text-[10px] font-medium ${activeProfId === '' ? 'text-blue-600' : 'text-slate-500'}`}>Equipe</span>
          </button>

          {professionals.map(p => {
            const isActive = activeProfId === p.id;
            return (
              <button
                key={p.id}
                onClick={() => setActiveProfId(isActive ? '' : p.id)}
                className="flex flex-col items-center gap-1 group"
                data-testid={`agendapro-prof-${p.id}`}
              >
                <div className={`w-14 h-14 rounded-full flex items-center justify-center transition ${isActive ? 'ring-2 ring-offset-2 ring-blue-500' : 'ring-1 ring-slate-200 group-hover:ring-slate-400'}`}>
                  {p.photo_url ? (
                    <img src={p.photo_url} alt={p.name} className="w-12 h-12 rounded-full object-cover" />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center text-white text-xs font-bold">
                      {initials(p.name)}
                    </div>
                  )}
                </div>
                <span className={`text-[10px] font-medium max-w-[60px] truncate ${isActive ? 'text-blue-600' : 'text-slate-600'}`}>{p.name.split(' ')[0]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <div className="flex items-center gap-2">
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            <button onClick={() => setView('day')} className={`px-3 py-1.5 rounded-md text-xs font-semibold ${view === 'day' ? 'bg-white shadow text-slate-900' : 'text-slate-500'}`} data-testid="agendapro-view-day">
              <Calendar className="w-4 h-4 inline mr-1" /> Dia
            </button>
            <button onClick={() => setView('week')} className={`px-3 py-1.5 rounded-md text-xs font-semibold ${view === 'week' ? 'bg-white shadow text-slate-900' : 'text-slate-500'}`} data-testid="agendapro-view-week">
              <Users className="w-4 h-4 inline mr-1" /> Semana
            </button>
          </div>
          <button onClick={goPrev} className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50" data-testid="agendapro-prev"><ChevronLeft className="w-4 h-4" /></button>
          <button onClick={goToday} className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold hover:bg-slate-50" data-testid="agendapro-today">Hoje</button>
          <button onClick={goNext} className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50" data-testid="agendapro-next"><ChevronRight className="w-4 h-4" /></button>
          <span className="text-sm font-semibold text-slate-700 capitalize" data-testid="agendapro-header-label">{headerLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOpenModal({ date: isoDate(date), time: '', professional_id: activeProfId || (professionals[0]?.id || ''), is_block: true })}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 flex items-center gap-1.5 text-slate-700"
            data-testid="agendapro-block-btn"
          >
            <Lock className="w-3.5 h-3.5" /> Bloquear
          </button>
          <button
            onClick={() => setOpenModal({ date: isoDate(date), time: '', professional_id: activeProfId || (professionals[0]?.id || '') })}
            className="btn-primary text-xs flex items-center gap-1.5"
            data-testid="agendapro-new-btn"
          >
            <Plus className="w-4 h-4" /> Novo
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
        <div className="grid" style={{ gridTemplateColumns: `60px repeat(${columns.length || 1}, minmax(120px, 1fr))` }}>
          <div className="bg-slate-50 border-b border-slate-200 p-2"></div>
          {columns.map(col => (
            <div key={col.id} className={`bg-slate-50 border-b border-l border-slate-200 p-2 text-center ${col.isToday ? 'bg-primary/5' : ''}`}>
              {col.photo && <img src={col.photo} alt="" className="w-6 h-6 rounded-full inline mr-1" />}
              <span className="text-xs font-semibold text-slate-700">{col.label}</span>
            </div>
          ))}

          {slots.map((slot) => (
            <React.Fragment key={slot}>
              <div className="border-b border-slate-100 p-1 text-[10px] text-slate-400 text-right pr-2 sticky left-0 bg-white">
                {slot.endsWith(':00') ? slot : ''}
              </div>
              {columns.map(col => {
                const colKey = view === 'day' ? col.id : col.id;
                const colAppts = apptsByCol[colKey] || [];
                const slotMin = minutesFromHHMM(slot);
                const aptHere = colAppts.find(a => {
                  const am = minutesFromHHMM(a.time);
                  return am >= slotMin && am < slotMin + SLOT_MIN;
                });
                if (aptHere) {
                  const isBlock = !!aptHere.is_block;
                  const c = isBlock ? BLOCK_STYLE : (STATUS_COLORS[aptHere.status] || STATUS_COLORS.pendente);
                  const span = Math.max(1, Math.round((aptHere.duration || 30) / SLOT_MIN));
                  return (
                    <div
                      key={col.id + slot}
                      className={`border-b border-l border-slate-100 p-1 cursor-pointer hover:opacity-90 ${c.bg} ${c.bd} border-l-4`}
                      style={{ gridRow: `span ${span}` }}
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData('text/plain', aptHere.id); }}
                      onClick={() => handleAptClick(aptHere)}
                      data-testid={`agendapro-apt-${aptHere.id}`}
                    >
                      <div className={`text-[11px] font-bold leading-tight ${c.tx}`}>
                        {isBlock ? <Lock className="w-3 h-3 inline mr-1" /> : null}
                        {aptHere.time} {aptHere.customer_name}
                      </div>
                      <div className={`text-[10px] truncate ${c.tx}`}>{aptHere.service_name}</div>
                    </div>
                  );
                }
                return (
                  <div
                    key={col.id + slot}
                    className="border-b border-l border-slate-100 hover:bg-blue-50/50 cursor-pointer transition"
                    onClick={() => handleSlotClick(col, slot)}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const aptId = e.dataTransfer.getData('text/plain');
                      const draggedApt = appointments.find(x => x.id === aptId);
                      if (draggedApt) onDropApt(draggedApt, col, slot);
                    }}
                    data-testid={`agendapro-slot-${col.id}-${slot}`}
                  />
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>

      {loading && <div className="text-center text-xs text-slate-400 mt-3">Carregando…</div>}

      {openModal && (
        <QuickBookModal
          initial={openModal}
          professionals={professionals}
          services={services}
          onClose={() => setOpenModal(null)}
          onSaved={() => { setOpenModal(null); loadAppts(); }}
        />
      )}
    </div>
  );
}

// === Modal ==================================================================
const QuickBookModal = ({ initial, professionals, services, onClose, onSaved }) => {
  const editing = !!initial.apt;
  const apt = initial.apt || {};
  const [mode, setMode] = useState(initial.is_block || apt.is_block ? 'block' : 'apt'); // 'apt' | 'block'
  const [form, setForm] = useState({
    customer_name: apt.customer_name || '',
    customer_phone: apt.customer_phone || '',
    service_id: apt.service_id || (services[0]?.id || ''),
    professional_id: apt.professional_id || initial.professional_id || (professionals[0]?.id || ''),
    date: apt.date || initial.date || isoDate(new Date()),
    time: apt.time || initial.time || '',
    notes: apt.notes || '',
    status: apt.status || 'pendente',
    block_duration: apt.duration || 30,
    block_reason: apt.block_reason || '',
  });
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  // Client search autocomplete
  const [clientQuery, setClientQuery] = useState('');
  const [clientList, setClientList] = useState([]);
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const searchRef = useRef(null);

  useEffect(() => {
    if (mode !== 'apt' || !clientQuery || clientQuery.length < 2) { setClientList([]); return; }
    let active = true;
    const t = setTimeout(() => {
      schedulingAPI.getClients({ search: clientQuery })
        .then(r => { if (active) setClientList((r.data || []).slice(0, 8)); })
        .catch(() => { if (active) setClientList([]); });
    }, 200);
    return () => { active = false; clearTimeout(t); };
  }, [clientQuery, mode]);

  const pickClient = (c) => {
    setForm(f => ({ ...f, customer_name: c.name, customer_phone: c.phone || '' }));
    setClientQuery('');
    setShowClientDropdown(false);
  };

  // Conclude / payment state
  const [showConclude, setShowConclude] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [finalPrice, setFinalPrice] = useState(String((apt.price || 0).toFixed(2)));
  const [discountPct, setDiscountPct] = useState('');

  const openConclude = async () => {
    try {
      const r = await api.get('/scheduling/financial/payment-methods');
      setPaymentMethods((r.data || []).filter(m => m.enabled));
    } catch { setPaymentMethods([]); }
    setShowConclude(true);
  };
  const handleConclude = async () => {
    if (!paymentMethodId) return toast.error('Selecione a forma de pagamento');
    const selected = paymentMethods.find(m => m.id === paymentMethodId);
    try {
      const payload = { payment_method: selected?.type || 'outros', payment_method_id: paymentMethodId, is_courtesy: !!selected?.is_courtesy };
      const fp = parseFloat(finalPrice);
      if (!isNaN(fp) && fp !== (apt.price || 0)) payload.final_price = fp;
      const dp = parseFloat(discountPct);
      if (!isNaN(dp) && dp > 0) payload.discount_pct = dp;
      await schedulingAPI.concludeAppointment(apt.id, payload);
      toast.success('Atendimento concluido — financeiro atualizado');
      onSaved();
    } catch (e) { toast.error(e.response?.data?.detail || 'Erro ao concluir'); }
  };

  const save = async () => {
    if (mode === 'block') {
      if (!form.professional_id) return toast.error('Selecione o profissional');
      if (!form.time) return toast.error('Informe o horário');
      setSaving(true);
      try {
        await schedulingAPI.createAppointment({
          customer_name: form.block_reason || 'Bloqueio',
          customer_phone: '',
          professional_id: form.professional_id,
          date: form.date, time: form.time,
          notes: form.block_reason || '',
          is_block: true, block_duration: parseInt(form.block_duration, 10) || 30,
          block_reason: form.block_reason || 'Indisponivel',
        });
        toast.success('Horario bloqueado');
        onSaved();
      } catch (e) { toast.error(e.response?.data?.detail || 'Erro ao bloquear'); }
      finally { setSaving(false); }
      return;
    }
    if (!form.customer_name.trim()) return toast.error('Informe o nome do cliente');
    if (!form.service_id) return toast.error('Selecione o serviço');
    if (!form.professional_id) return toast.error('Selecione o profissional');
    if (!form.time) return toast.error('Informe o horário');
    setSaving(true);
    try {
      if (editing) {
        await schedulingAPI.updateAppointment(apt.id, form);
        toast.success('Atualizado');
      } else {
        await schedulingAPI.createAppointment(form);
        toast.success('Agendamento criado');
      }
      onSaved();
    } catch (e) { toast.error(e.response?.data?.detail || 'Erro ao salvar'); }
    finally { setSaving(false); }
  };

  const del = async () => {
    try {
      await api.delete(`/scheduling/appointments/${apt.id}`);
      toast.success(apt.is_block ? 'Bloqueio removido' : 'Excluido');
      onSaved();
    } catch (e) { toast.error(e.response?.data?.detail || 'Erro ao excluir'); }
  };

  const isBlocking = mode === 'block' || apt.is_block;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-2 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-xl shadow-2xl" onClick={e => e.stopPropagation()} data-testid="agendapro-modal">
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h3 className="font-bold text-slate-900 flex items-center gap-2">
            {isBlocking ? <Lock className="w-4 h-4 text-slate-500" /> : <Calendar className="w-4 h-4 text-blue-500" />}
            {editing ? (apt.is_block ? 'Editar Bloqueio' : 'Editar Agendamento') : (mode === 'block' ? 'Bloquear Horário' : 'Novo Agendamento')}
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
        </div>

        {/* Toggle Agendamento ↔ Bloqueio (only when creating new) */}
        {!editing && (
          <div className="px-4 pt-3">
            <div className="flex bg-slate-100 rounded-lg p-0.5" data-testid="agendapro-mode-toggle">
              <button
                onClick={() => setMode('apt')}
                className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition ${mode === 'apt' ? 'bg-white shadow text-blue-700' : 'text-slate-500'}`}
                data-testid="agendapro-mode-apt"
              >
                <Calendar className="w-3.5 h-3.5 inline mr-1" /> Agendamento
              </button>
              <button
                onClick={() => setMode('block')}
                className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition ${mode === 'block' ? 'bg-white shadow text-slate-700' : 'text-slate-500'}`}
                data-testid="agendapro-mode-block"
              >
                <Lock className="w-3.5 h-3.5 inline mr-1" /> Bloqueio
              </button>
            </div>
          </div>
        )}

        <div className="p-4 space-y-3 max-h-[65vh] overflow-y-auto">
          {/* Cliente: somente em mode='apt' */}
          {mode === 'apt' && !apt.is_block && (
            <>
              {!editing && (
                <div className="relative" ref={searchRef}>
                  <label className="text-[10px] font-bold uppercase text-slate-400 flex items-center gap-1"><Search className="w-3 h-3" /> Buscar cliente existente</label>
                  <input
                    value={clientQuery}
                    onChange={e => { setClientQuery(e.target.value); setShowClientDropdown(true); }}
                    onFocus={() => setShowClientDropdown(true)}
                    placeholder="Nome ou telefone..."
                    className="input-field text-sm"
                    data-testid="agendapro-client-search"
                  />
                  {showClientDropdown && clientList.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto" data-testid="agendapro-client-dropdown">
                      {clientList.map(c => (
                        <button
                          key={c.id}
                          onClick={() => pickClient(c)}
                          className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-slate-100 last:border-0"
                          data-testid={`agendapro-client-pick-${c.id}`}
                        >
                          <div className="text-sm font-medium text-slate-800">{c.name}</div>
                          <div className="text-[11px] text-slate-500 flex items-center gap-1"><Phone className="w-3 h-3" />{c.phone}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-400">Cliente</label>
                  <input value={form.customer_name} onChange={e => setForm({ ...form, customer_name: e.target.value })} className="input-field text-sm" data-testid="agendapro-customer-name" />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-400">Telefone</label>
                  <input value={form.customer_phone} onChange={e => setForm({ ...form, customer_phone: e.target.value })} className="input-field text-sm" data-testid="agendapro-customer-phone" />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400">Serviço</label>
                <select value={form.service_id} onChange={e => setForm({ ...form, service_id: e.target.value })} className="input-field text-sm" data-testid="agendapro-service">
                  <option value="">— Selecione —</option>
                  {services.map(s => {
                    const dur = s.duration || s.duration_min || 30;
                    return (
                      <option key={s.id} value={s.id}>{s.name} ({dur} min) — R$ {Number(s.price || 0).toFixed(2)}</option>
                    );
                  })}
                </select>
              </div>
            </>
          )}

          {/* Bloqueio fields */}
          {mode === 'block' && (
            <>
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400">Motivo do bloqueio</label>
                <input
                  value={form.block_reason}
                  onChange={e => setForm({ ...form, block_reason: e.target.value })}
                  placeholder="Ex.: Almoço, Reunião, Pessoal..."
                  className="input-field text-sm"
                  data-testid="agendapro-block-reason"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400">Duração (min)</label>
                <select value={form.block_duration} onChange={e => setForm({ ...form, block_duration: e.target.value })} className="input-field text-sm" data-testid="agendapro-block-duration">
                  {[15, 30, 45, 60, 90, 120, 180, 240].map(m => <option key={m} value={m}>{m} min</option>)}
                </select>
              </div>
            </>
          )}

          {/* Comum a ambos */}
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400">Profissional</label>
            <select value={form.professional_id} onChange={e => setForm({ ...form, professional_id: e.target.value })} className="input-field text-sm" data-testid="agendapro-professional">
              <option value="">— Selecione —</option>
              {professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-400">Data</label>
              <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="input-field text-sm" data-testid="agendapro-date" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-400">Hora</label>
              <input type="time" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} className="input-field text-sm" data-testid="agendapro-time" />
            </div>
          </div>

          {editing && !apt.is_block && (
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-400">Status</label>
              <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} className="input-field text-sm" data-testid="agendapro-status">
                <option value="pendente">Pendente</option>
                <option value="confirmado">Confirmado</option>
                <option value="em_atendimento">Em atendimento</option>
                <option value="concluido">Concluído</option>
                <option value="cancelado">Cancelado</option>
              </select>
            </div>
          )}

          {mode === 'apt' && (
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-400">Observações</label>
              <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="input-field text-sm" data-testid="agendapro-notes" />
            </div>
          )}

          {/* Conclude inline panel */}
          {showConclude && editing && !apt.is_block && (
            <div className="border-t pt-3 mt-2 space-y-2 bg-emerald-50/50 -mx-4 px-4 pb-2 rounded-b" data-testid="agendapro-conclude-panel">
              <h4 className="text-xs font-bold text-emerald-700 flex items-center gap-1"><DollarSign className="w-3.5 h-3.5" /> Concluir & cobrar</h4>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-400">Valor final</label>
                  <input value={finalPrice} onChange={e => setFinalPrice(e.target.value)} className="input-field text-sm" data-testid="agendapro-final-price" />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-400">Desconto (%)</label>
                  <input value={discountPct} onChange={e => setDiscountPct(e.target.value)} placeholder="0" className="input-field text-sm" data-testid="agendapro-discount-pct" />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400">Forma de pagamento *</label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {paymentMethods.length === 0 && <p className="text-[11px] text-slate-500 col-span-2">Nenhuma forma de pagamento ativa. Cadastre em Financeiro → Formas de pagamento.</p>}
                  {paymentMethods.map(m => (
                    <button
                      key={m.id}
                      onClick={() => setPaymentMethodId(m.id)}
                      className={`text-left px-2 py-1.5 rounded-lg border text-xs transition ${paymentMethodId === m.id ? 'border-emerald-500 bg-emerald-100 text-emerald-900 font-semibold' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                      data-testid={`agendapro-pm-${m.id}`}
                    >
                      <div>{m.name}</div>
                      <div className="text-[10px] text-slate-500">{m.type}</div>
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={handleConclude}
                disabled={!paymentMethodId}
                className="w-full bg-emerald-600 text-white py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
                data-testid="agendapro-confirm-conclude"
              >
                <CheckCircle2 className="w-4 h-4" /> Concluir atendimento
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 p-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl sm:rounded-b-xl">
          {editing ? (
            confirmDel ? (
              <button onClick={del} className="text-xs text-rose-600 font-semibold flex items-center gap-1" data-testid="agendapro-confirm-delete">
                <Trash2 className="w-3.5 h-3.5" /> Confirmar exclusão?
              </button>
            ) : (
              <button onClick={() => setConfirmDel(true)} className="text-xs text-rose-500 flex items-center gap-1" data-testid="agendapro-delete-btn">
                <Trash2 className="w-3.5 h-3.5" /> Excluir
              </button>
            )
          ) : <span />}
          <div className="flex gap-2 flex-wrap justify-end">
            {editing && !apt.is_block && !showConclude && apt.status !== 'concluido' && (
              <button onClick={openConclude} className="px-3 py-2 text-xs rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 flex items-center gap-1" data-testid="agendapro-open-conclude">
                <DollarSign className="w-3.5 h-3.5" /> Concluir
              </button>
            )}
            <button onClick={onClose} className="px-3 py-2 text-sm rounded border border-slate-300 hover:bg-white">Cancelar</button>
            {!showConclude && (
              <button onClick={save} disabled={saving} className="btn-primary text-sm" data-testid="agendapro-save-btn">{saving ? 'Salvando…' : (mode === 'block' ? 'Bloquear' : 'Salvar')}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
