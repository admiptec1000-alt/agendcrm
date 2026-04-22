import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { publicAPI } from '../../services/api';
import { Clock, User, Scissors } from 'lucide-react';

/** Detect kind of media URL to know how to render it. */
function detectMediaKind(url) {
  if (!url) return { kind: 'unknown' };
  const u = String(url);
  // YouTube
  const ytMatch = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{6,})/);
  if (ytMatch) {
    const id = ytMatch[1];
    return {
      kind: 'iframe',
      // enablejsapi=1 lets us postMessage play commands to force autoplay
      src: `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&controls=0&rel=0&modestbranding=1&playsinline=1&loop=1&playlist=${id}&enablejsapi=1`,
      provider: 'youtube',
    };
  }
  // Vimeo
  const vmMatch = u.match(/vimeo\.com\/(\d+)/);
  if (vmMatch) {
    return {
      kind: 'iframe',
      src: `https://player.vimeo.com/video/${vmMatch[1]}?autoplay=1&muted=1&loop=1&background=1`,
      provider: 'vimeo',
    };
  }
  // Google Drive: convert /view to /preview
  if (u.includes('drive.google.com')) {
    const idMatch = u.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (idMatch) {
      return { kind: 'iframe', src: `https://drive.google.com/file/d/${idMatch[1]}/preview`, provider: 'drive' };
    }
    return { kind: 'iframe', src: u.replace(/\/view.*/, '/preview'), provider: 'drive' };
  }
  // Direct video file
  if (/\.(mp4|webm|ogg|mov)(\?|$)/i.test(u)) {
    return { kind: 'video', src: u };
  }
  // Fallback: image
  return { kind: 'image', src: u };
}

const MediaSlide = ({ url }) => {
  const m = detectMediaKind(url);
  const iframeRef = React.useRef(null);

  // Force-start playback once the iframe loads — works around browser autoplay
  // policies that sometimes ignore the URL param `autoplay=1`.
  React.useEffect(() => {
    if (m.kind !== 'iframe' || !iframeRef.current) return;
    const iframe = iframeRef.current;
    const send = () => {
      try {
        if (m.provider === 'youtube') {
          iframe.contentWindow?.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
        } else if (m.provider === 'vimeo') {
          iframe.contentWindow?.postMessage(JSON.stringify({ method: 'play' }), '*');
        }
      } catch { /* silent */ }
    };
    const onLoad = () => {
      // send immediately and twice more to cover the Ready event race
      send();
      setTimeout(send, 400);
      setTimeout(send, 1200);
    };
    iframe.addEventListener('load', onLoad);
    return () => iframe.removeEventListener('load', onLoad);
  }, [m.kind, m.provider, m.src]);

  if (m.kind === 'video') {
    return <video src={m.src} autoPlay muted loop playsInline className="w-full h-screen object-cover" />;
  }
  if (m.kind === 'iframe') {
    return (
      <iframe
        ref={iframeRef}
        src={m.src}
        title="Media"
        className="w-full h-screen"
        frameBorder="0"
        allow="autoplay; encrypted-media; fullscreen; accelerometer; gyroscope"
        allowFullScreen
      />
    );
  }
  if (m.kind === 'image') {
    return <img src={m.src} alt="Propaganda" className="w-full h-screen object-cover" />;
  }
  return <div className="text-white text-2xl p-8">Midia invalida: {url}</div>;
};

const AppointmentCard = ({ apt, currentTime, variant = 'full' }) => {
  const isPast = apt.time < currentTime;
  const isCurrent = apt.time <= currentTime && !isPast;
  const baseClass = isCurrent
    ? 'bg-emerald-600/20 border-2 border-emerald-500 ring-2 ring-emerald-500/30'
    : isPast
    ? 'bg-white/5 opacity-60'
    : 'bg-white/10 border border-white/10';
  const timeClass = isCurrent ? 'text-emerald-400' : 'text-white';
  return (
    <div className={`rounded-2xl p-4 transition-all ${baseClass}`}>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-2xl font-bold font-heading tabular-nums ${timeClass}`}>{apt.time}</span>
        <span
          className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
            apt.status === 'confirmado'
              ? 'bg-emerald-500/20 text-emerald-400'
              : apt.status === 'concluido'
              ? 'bg-blue-500/20 text-blue-400'
              : 'bg-amber-500/20 text-amber-400'
          }`}
        >
          {apt.status}
        </span>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <User className="w-4 h-4 text-slate-400" />
          <span className="font-medium truncate">{apt.customer_name}</span>
        </div>
        <div className="flex items-center gap-2">
          <Scissors className="w-4 h-4 text-slate-400" />
          <span className="text-sm text-slate-300 truncate">{apt.service_name}</span>
        </div>
        {variant === 'full' && (
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-400" />
            <span className="text-sm text-slate-300 truncate">{apt.professional_name} - {apt.duration}min</span>
          </div>
        )}
      </div>
    </div>
  );
};

const IndoorDisplay = () => {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [showMedia, setShowMedia] = useState(false);
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  // Some browsers (especially mobile/TV Safari) block iframe autoplay until the
  // user has interacted once with the page. We show a one-time overlay that
  // satisfies that gesture requirement, then all subsequent slides autoplay.
  const [unlocked, setUnlocked] = useState(() => {
    try { return sessionStorage.getItem('indoor_unlocked') === '1'; } catch { return false; }
  });
  const unlockPlayback = () => {
    try { sessionStorage.setItem('indoor_unlocked', '1'); } catch { /* ignore */ }
    // Try to request fullscreen which doubles as the user gesture for autoplay
    try { document.documentElement.requestFullscreen?.(); } catch { /* ignore */ }
    setUnlocked(true);
  };

  const load = useCallback(() => {
    publicAPI.getIndoorDisplay(slug).then(r => setData(r.data)).catch(() => {});
  }, [slug]);

  // Auto-refresh every 30s (don't refresh mid-slide)
  useEffect(() => { load(); const i = setInterval(load, 30000); return () => clearInterval(i); }, [load]);

  const allLinks = React.useMemo(() => {
    const local = data?.indoor_settings?.media_links || [];
    const global = data?.global_media_links || [];
    return [...local, ...global];
  }, [data]);

  // Alternate between appointments and media
  useEffect(() => {
    if (!allLinks.length) return;
    const dur = (data?.indoor_settings?.slide_duration || 10) * 1000;
    const interval = setInterval(() => {
      setShowMedia(prev => {
        if (!prev) {
          setCurrentMediaIndex(0);
          return true;
        }
        if (currentMediaIndex < allLinks.length - 1) {
          setCurrentMediaIndex(i => i + 1);
          return true;
        }
        return false;
      });
    }, dur);
    return () => clearInterval(interval);
  }, [data, currentMediaIndex, allLinks]);

  if (!data) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white" />
      </div>
    );
  }

  // First-time unlock overlay — required by mobile/TV Safari autoplay policies.
  if (!unlocked) {
    return (
      <div
        className="min-h-screen bg-slate-900 text-white flex items-center justify-center cursor-pointer p-6"
        onClick={unlockPlayback}
        data-testid="indoor-unlock"
      >
        <div className="text-center max-w-lg">
          <div className="w-20 h-20 mx-auto rounded-full bg-white/10 flex items-center justify-center mb-6">
            <svg className="w-10 h-10 text-white ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          </div>
          <h1 className="text-3xl font-bold font-heading mb-3">Iniciar Apresentacao</h1>
          <p className="text-slate-400 mb-6">Toque em qualquer lugar da tela para comecar. A partir daqui, os videos e imagens alternarao automaticamente sem pausa.</p>
          <button
            onClick={unlockPlayback}
            className="px-8 py-3 bg-primary text-white rounded-full font-semibold hover:bg-primary/90 transition"
          >
            Iniciar agora
          </button>
        </div>
      </div>
    );
  }

  const currentMedia = allLinks[currentMediaIndex];
  if (showMedia && currentMedia) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center" data-testid="indoor-media">
        <MediaSlide url={currentMedia} />
      </div>
    );
  }

  const now = new Date();
  const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  const layout = data.indoor_settings?.layout || 'grid'; // 'grid' | 'columns'

  // Group by professional for columns layout
  const byProfessional = {};
  data.appointments.forEach(apt => {
    const key = apt.professional_name || 'Sem profissional';
    if (!byProfessional[key]) byProfessional[key] = [];
    byProfessional[key].push(apt);
  });
  const profNames = Object.keys(byProfessional);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-8" data-testid="indoor-display">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-4xl font-bold font-heading tracking-tight">{data.company_name}</h1>
          <p className="text-lg text-slate-400 mt-1">
            Agenda do Dia - {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        <div className="text-right">
          <p className="text-5xl font-bold font-heading tabular-nums">{currentTime}</p>
          <p className="text-sm text-slate-400">{data.appointments.length} agendamentos</p>
        </div>
      </div>

      {/* Appointments */}
      {data.appointments.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-2xl text-slate-500">Nenhum agendamento para hoje</p>
        </div>
      ) : layout === 'columns' ? (
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.min(profNames.length, 4))}, minmax(0, 1fr))` }}
          data-testid="indoor-columns"
        >
          {profNames.map(prof => (
            <div key={prof} className="space-y-3">
              <div className="pb-2 border-b border-white/10">
                <p className="text-[11px] uppercase tracking-widest text-slate-400">Profissional</p>
                <h3 className="text-lg font-bold font-heading">{prof}</h3>
                <p className="text-xs text-slate-500">{byProfessional[prof].length} agendamentos</p>
              </div>
              <div className="space-y-2">
                {byProfessional[prof]
                  .sort((a, b) => a.time.localeCompare(b.time))
                  .map((apt, i) => (
                    <AppointmentCard key={apt.id || i} apt={apt} currentTime={currentTime} variant="compact" />
                  ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="indoor-grid">
          {data.appointments.map((apt, i) => (
            <AppointmentCard key={apt.id || i} apt={apt} currentTime={currentTime} variant="full" />
          ))}
        </div>
      )}
    </div>
  );
};

export default IndoorDisplay;
