import React, { useEffect, useState, useCallback } from 'react';
import api from '../../services/api';
import { toast } from 'sonner';
import {
  Copy, ExternalLink, Users, DollarSign, Clock, CheckCircle2,
  Share2, TrendingUp, Gift, Building
} from 'lucide-react';

/** Partner / Indications page — visible inside a company panel only when
 *  the company is flagged `is_partner=true` by the SuperAdmin.
 *  Shows the partner's stable referral link + commission stats + referral
 *  list. Recurring commission % is set per-partner by the SuperAdmin. */
const PartnerPage = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/partner/dashboard');
      setData(r.data);
    } catch (e) {
      if (e.response?.status === 403) {
        toast.error('Sua empresa nao e parceira. Solicite ao admin da plataforma.');
      } else { toast.error('Erro ao carregar dashboard de parceiro'); }
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copiado para area de transferencia');
    } catch { toast.error('Falha ao copiar'); }
  };

  const share = async () => {
    if (!data?.referral_link) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Conheça o AgentCRM',
          text: 'Use meu link de indicacao e ganhe descontos:',
          url: data.referral_link,
        });
      } catch {}
    } else {
      copy(data.referral_link);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-sm text-slate-400">Carregando...</div>;
  }
  if (!data) return null;

  const { referral_link, referral_code, commission_pct, commission_recurring, stats, referrals, commissions } = data;

  return (
    <div className="space-y-4 animate-fade-in" data-testid="partner-page">
      {/* Hero card */}
      <div className="rounded-2xl bg-gradient-to-br from-violet-600 via-fuchsia-500 to-pink-500 p-5 text-white shadow-xl">
        <div className="flex items-center gap-2 mb-2">
          <Gift className="w-5 h-5" />
          <h2 className="font-bold text-lg">Programa de Parceiros</h2>
        </div>
        <p className="text-sm opacity-90 mb-4">
          Voce ganha <strong>{commission_pct}%</strong> de comissao
          {commission_recurring ? ' recorrente todo mes' : ' (pagamento unico)'} para cada cliente que assinar pelo seu link.
        </p>
        <div className="bg-white/15 backdrop-blur rounded-xl p-3 flex items-center gap-2 flex-wrap">
          <code className="flex-1 min-w-[180px] text-xs sm:text-sm font-mono break-all" data-testid="partner-link-display">{referral_link}</code>
          <button onClick={() => copy(referral_link)} className="bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5" data-testid="partner-copy-btn">
            <Copy className="w-3.5 h-3.5" /> Copiar
          </button>
          <button onClick={share} className="bg-white text-violet-700 hover:bg-slate-100 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5" data-testid="partner-share-btn">
            <Share2 className="w-3.5 h-3.5" /> Compartilhar
          </button>
        </div>
        <p className="text-[11px] opacity-80 mt-2">
          Codigo: <code className="font-mono">{referral_code}</code> — esse link e fixo, voce pode usar sempre.
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Indicacoes" value={stats.total_referrals} icon={Users} color="blue" testid="partner-kpi-total" />
        <Stat label="Ativas" value={stats.active_referrals} icon={CheckCircle2} color="emerald" testid="partner-kpi-active" />
        <Stat label="A receber" value={`R$ ${(stats.total_pending || 0).toFixed(2)}`} icon={Clock} color="amber" testid="partner-kpi-pending" />
        <Stat label="Recebido" value={`R$ ${(stats.total_received || 0).toFixed(2)}`} icon={DollarSign} color="violet" testid="partner-kpi-received" />
      </div>

      {/* Monthly chart */}
      {Object.keys(stats.by_month || {}).length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-violet-500" /> Comissoes por mes
          </h3>
          <div className="space-y-1.5">
            {Object.entries(stats.by_month).sort().reverse().slice(0, 6).map(([ym, v]) => {
              const max = Math.max(...Object.values(stats.by_month));
              const pct = max ? (v / max) * 100 : 0;
              return (
                <div key={ym} className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-16">{ym}</span>
                  <div className="flex-1 bg-slate-100 rounded-full h-5 relative overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-violet-500 to-pink-500 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs font-bold text-slate-700 w-20 text-right">R$ {v.toFixed(2)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Referrals list */}
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-bold text-slate-800 flex items-center gap-2">
            <Building className="w-4 h-4 text-blue-500" /> Empresas indicadas
          </h3>
          <span className="text-xs text-slate-500">{referrals.length} indicada(s)</span>
        </div>
        {referrals.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-400">
            Nenhuma indicacao ainda. Compartilhe seu link para comecar a ganhar comissoes.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {referrals.map(r => (
              <div key={r.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-slate-800">{r.name}</div>
                  <div className="text-[11px] text-slate-500">{r.email}</div>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${r.status === 'active' ? 'bg-emerald-100 text-emerald-700' : r.status === 'trial' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
                  {r.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent commissions */}
      {commissions && commissions.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="px-4 py-3 border-b border-slate-200">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-emerald-500" /> Historico de comissoes
            </h3>
          </div>
          <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
            {commissions.slice(0, 30).map(c => (
              <div key={c.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-medium text-slate-800">{c.referred_company_name}</div>
                  <div className="text-[10px] text-slate-500">{(c.created_at || '').slice(0, 10)} — fatura R$ {(c.invoice_amount || 0).toFixed(2)}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-emerald-600">+ R$ {(c.amount || 0).toFixed(2)}</div>
                  <div className="text-[10px] text-slate-500">{c.paid_to_partner ? 'Pago' : 'Pendente'}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const Stat = ({ label, value, icon: Icon, color, testid }) => (
  <div className="bg-white rounded-xl border border-slate-200 p-3" data-testid={testid}>
    <div className={`text-[10px] uppercase font-bold text-${color}-500 flex items-center gap-1`}>
      <Icon className="w-3 h-3" /> {label}
    </div>
    <div className="text-xl font-bold text-slate-800 mt-1">{value}</div>
  </div>
);

export default PartnerPage;
