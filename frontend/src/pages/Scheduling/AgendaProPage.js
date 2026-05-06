import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { schedulingAPI } from '../../services/api';
import api from '../../services/api';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Plus, X, Search, Calendar, Users } from 'lucide-react';

/**
 * AgendaProPage — Google-Calendar-style scheduling grid.
 *
 * Two visualizations:
 *  - Day:  vertical timeline (08:00 → last open hour) with one column per
 *          professional. Empty slots are clickable → opens Quick-Book modal.
 *  - Week: 7 columns (Sun-Sat) for the active professional, same timeline.
 *
 * Reuses the existing `appointments` collection via `schedulingAPI` so any
 * change here surfaces in the legacy "Agenda" view too — same source of truth.
 */

const SLOT_MIN = 30;            // 30-minute slots
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 22;        // 07:00 → 22:00

const STATUS_COLORS = {
  pendente:    { bg: 'bg-amber-100',   bd: 'border-amber-400',   tx: 'text-amber-900' },
  confirmado:  { bg: 'bg-emerald-100', bd: 'border-emerald-400', tx: 'text-emerald-900' },
  em_atendimento: { bg: 'bg-blue-100', bd: 'border-blue-400',    tx: 'text-blue-900' },
  concluido:   { bg: 'bg-slate-200',   bd: 'border-slate-400',   tx: 'text-slate-700' },
  cancelado:   { bg: 'bg-rose-100',    bd: 'border-rose-400',    tx: 'text-rose-900 line-through' },
};

const isoDate = (d) => d.toISOString().split('T')[0];
const addDays = (d, n) => { const c = new Date(d); c.setDate(c.getDate() + n); return c; };
const startOfWeek = (d) => { const c = new Date(d); c.setDate(c.getDate() - c.getDay()); return c; };

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
  const [view, setView] = useState('day');     // 'day' | 'week'
  const [date, setDate] = useState(new Date());
  const [professionals, setProfessionals] = useState([]);
  const [services, setServices] = useState([]);
  const [activeProfId, setActiveProfId] = useState('');
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [openModal, setOpenModal] = useState(null); // { date, time, prof_id } | { apt }

  const slots = useMemo(buildSlots, []);

  // Load professionals + services once
  useEffect(() => {
    Promise.all([
      schedulingAPI.getProfessionals().catch(() => ({ data: [] })),
      schedulingAPI.getServices().catch(() => ({ data: [] })),
    ]).then(([p, s]) => {
      setProfessionals(p.data || []);
      setServices(s.data || []);
      if (!activeProfId && (p.data || []).length) setActiveProfId(p.data[0].id);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load appointments for the visible range
  const loadAppts = useCallback(async () => {
    setLoading(true);
    try {
      let start, end;
      if (view === 'day') {
        start = end = isoDate(date);
      } else {
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
    // Group: in DAY view → by professional_id; in WEEK view → by date string.
    const map = {};
    for (const a of appointments) {
      if (view === 'day') {
        if (a.date !== isoDate(date)) continue;
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

  // Columns for current view
  const columns = useMemo(() => {
    if (view === 'day') {
      return professionals.map(p => ({ id: p.id, label: p.name, photo: p.photo_url }));
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
  }, [view, date, professionals]);

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
      setOpenModal({ date: col.id, time: slot, professional_id: activeProfId });
    }
  };

  const handleAptClick = (a) => setOpenModal({ apt: a });

  // Drag & drop: when an event card is dropped on a slot, recompute its
  // (date, time, professional) target and PATCH the appointment via API.
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
          {view === 'week' && (
            <select value={activeProfId} onChange={e => setActiveProfId(e.target.value)} className="text-xs px-2 py-1.5 rounded-lg border border-slate-300" data-testid="agendapro-week-prof">
              {professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <button onClick={() => setOpenModal({ date: isoDate(date), time: '', professional_id: activeProfId })} className="btn-primary text-xs flex items-center gap-1.5" data-testid="agendapro-new-btn">
            <Plus className="w-4 h-4" /> Novo
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
        <div className="grid" style={{ gridTemplateColumns: `60px repeat(${columns.length || 1}, minmax(120px, 1fr))` }}>
          {/* Header row */}
          <div className="bg-slate-50 border-b border-slate-200 p-2"></div>
          {columns.map(col => (
            <div key={col.id} className={`bg-slate-50 border-b border-l border-slate-200 p-2 text-center ${col.isToday ? 'bg-primary/5' : ''}`}>
              {col.photo && <img src={col.photo} alt="" className="w-6 h-6 rounded-full inline mr-1" />}
              <span className="text-xs font-semibold text-slate-700">{col.label}</span>
            </div>
          ))}

          {/* Time rows */}
          {slots.map((slot, sIdx) => (
            <React.Fragment key={slot}>
              <div className="border-b border-slate-100 p-1 text-[10px] text-slate-400 text-right pr-2 sticky left-0 bg-white">
                {slot.endsWith(':00') ? slot : ''}
              </div>
              {columns.map(col => {
                const colKey = view === 'day' ? col.id : col.id;
                const colAppts = apptsByCol[colKey] || [];
                const slotMin = minutesFromHHMM(slot);
                // Show appt block ONLY at its starting slot
                const aptStarting = colAppts.find(a => minutesFromHHMM(a.time) === slotMin);
                // Is this slot covered (but not starting) by a longer appt?
                const aptCovering = colAppts.find(a => {
                  const aStart = minutesFromHHMM(a.time);
                  const aDur = a.duration_min || 30;
                  return aStart < slotMin && aStart + aDur > slotMin;
                });
                if (aptCovering) {
                  return <div key={col.id} className="border-b border-l border-slate-100 bg-transparent" />;
                }
                if (aptStarting) {
                  const c = STATUS_COLORS[aptStarting.status] || STATUS_COLORS.pendente;
                  const dur = aptStarting.duration_min || 30;
                  const span = Math.max(1, Math.ceil(dur / SLOT_MIN));
                  return (
                    <div
                      key={col.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', aptStarting.id);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      className={`border-l border-slate-100 ${c.bg} ${c.bd} ${c.tx} border-l-4 cursor-move hover:brightness-95 p-1 overflow-hidden`}
                      style={{ gridRow: `span ${span}` }}
                      onClick={() => handleAptClick(aptStarting)}
                      data-testid={`agendapro-apt-${aptStarting.id}`}
                    >
                      <p className="text-[10px] font-bold leading-tight">{aptStarting.time}-{aptStarting.end_time || ''}</p>
                      <p className="text-[11px] font-semibold leading-tight truncate">{aptStarting.customer_name}</p>
                      <p className="text-[10px] leading-tight truncate opacity-80">{aptStarting.service_name}</p>
                    </div>
                  );
                }
                return (
                  <div
                    key={col.id}
                    className="border-b border-l border-slate-100 hover:bg-primary/5 cursor-pointer transition-colors min-h-[18px]"
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

const QuickBookModal = ({ initial, professionals, services, onClose, onSaved }) => {
  const editing = !!initial.apt;
  const apt = initial.apt || {};
  const [form, setForm] = useState({
    customer_name: apt.customer_name || '',
    customer_phone: apt.customer_phone || '',
    service_id: apt.service_id || (services[0]?.id || ''),
    professional_id: apt.professional_id || initial.professional_id || (professionals[0]?.id || ''),
    date: apt.date || initial.date || isoDate(new Date()),
    time: apt.time || initial.time || '',
    notes: apt.notes || '',
    status: apt.status || 'pendente',
  });
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const save = async () => {
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
      toast.success('Excluido');
      onSaved();
    } catch (e) { toast.error(e.response?.data?.detail || 'Erro ao excluir'); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-2 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-xl shadow-2xl" onClick={e => e.stopPropagation()} data-testid="agendapro-modal">
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h3 className="font-bold text-slate-900">{editing ? 'Editar Agendamento' : 'Novo Agendamento'}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
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
              {services.map(s => <option key={s.id} value={s.id}>{s.name} ({s.duration_min || 30} min)</option>)}
            </select>
          </div>
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
          {editing && (
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
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400">Observações</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="input-field text-sm" data-testid="agendapro-notes" />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 p-4 border-t border-slate-200 bg-slate-50">
          {editing ? (
            confirmDel ? (
              <button onClick={del} className="text-xs text-rose-600 font-semibold" data-testid="agendapro-confirm-delete">Confirmar exclusão?</button>
            ) : (
              <button onClick={() => setConfirmDel(true)} className="text-xs text-rose-500" data-testid="agendapro-delete-btn">Excluir</button>
            )
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-2 text-sm rounded border border-slate-300 hover:bg-white">Cancelar</button>
            <button onClick={save} disabled={saving} className="btn-primary text-sm" data-testid="agendapro-save-btn">{saving ? 'Salvando…' : 'Salvar'}</button>
          </div>
        </div>
      </div>
    </div>
  );
};
