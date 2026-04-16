import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { publicAPI } from '../../services/api';
import { Clock, User, Scissors } from 'lucide-react';

const IndoorDisplay = () => {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [showMedia, setShowMedia] = useState(false);
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);

  const load = useCallback(() => {
    publicAPI.getIndoorDisplay(slug).then(r => setData(r.data)).catch(() => {});
  }, [slug]);

  // Auto-refresh every 10s
  useEffect(() => { load(); const i = setInterval(load, 10000); return () => clearInterval(i); }, [load]);

  // Alternate between appointments and media
  useEffect(() => {
    if (!data?.indoor_settings?.media_links?.length) return;
    const dur = (data.indoor_settings.slide_duration || 10) * 1000;
    const interval = setInterval(() => {
      setShowMedia(prev => {
        if (!prev) {
          setCurrentMediaIndex(0);
          return true;
        }
        const links = data.indoor_settings.media_links;
        if (currentMediaIndex < links.length - 1) {
          setCurrentMediaIndex(i => i + 1);
          return true;
        }
        return false;
      });
    }, dur);
    return () => clearInterval(interval);
  }, [data, currentMediaIndex]);

  if (!data) return <div className="min-h-screen bg-slate-900 flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white" /></div>;

  const mediaLinks = data.indoor_settings?.media_links || [];
  const currentMedia = mediaLinks[currentMediaIndex];
  const isVideo = currentMedia && (currentMedia.includes('.mp4') || currentMedia.includes('youtube') || currentMedia.includes('vimeo'));

  if (showMedia && currentMedia) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        {isVideo ? (
          <video src={currentMedia} autoPlay muted loop className="w-full h-screen object-cover" />
        ) : (
          <img src={currentMedia} alt="Propaganda" className="w-full h-screen object-cover" />
        )}
      </div>
    );
  }

  const now = new Date();
  const currentTime = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-8" data-testid="indoor-display">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-4xl font-bold font-heading tracking-tight">{data.company_name}</h1>
          <p className="text-lg text-slate-400 mt-1">Agenda do Dia - {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
        <div className="text-right">
          <p className="text-5xl font-bold font-heading tabular-nums">{currentTime}</p>
          <p className="text-sm text-slate-400">{data.appointments.length} agendamentos</p>
        </div>
      </div>

      {/* Appointments Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.appointments.map((apt, i) => {
          const isPast = apt.time < currentTime;
          const isCurrent = apt.time <= currentTime && !isPast;
          return (
            <div key={apt.id || i} className={`rounded-2xl p-5 transition-all ${
              isCurrent ? 'bg-emerald-600/20 border-2 border-emerald-500 ring-2 ring-emerald-500/30' :
              isPast ? 'bg-white/5 opacity-60' :
              'bg-white/10 border border-white/10'
            }`}>
              <div className="flex items-center justify-between mb-3">
                <span className={`text-2xl font-bold font-heading tabular-nums ${isCurrent ? 'text-emerald-400' : 'text-white'}`}>{apt.time}</span>
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                  apt.status === 'confirmado' ? 'bg-emerald-500/20 text-emerald-400' :
                  apt.status === 'concluido' ? 'bg-blue-500/20 text-blue-400' :
                  'bg-amber-500/20 text-amber-400'
                }`}>{apt.status}</span>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-slate-400" />
                  <span className="font-medium">{apt.customer_name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Scissors className="w-4 h-4 text-slate-400" />
                  <span className="text-sm text-slate-300">{apt.service_name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-slate-400" />
                  <span className="text-sm text-slate-300">{apt.professional_name} - {apt.duration}min</span>
                </div>
              </div>
            </div>
          );
        })}
        {data.appointments.length === 0 && (
          <div className="col-span-full text-center py-20">
            <p className="text-2xl text-slate-500">Nenhum agendamento para hoje</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default IndoorDisplay;
