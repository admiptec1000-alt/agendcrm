// 2026-08-11 — Parametros anti-bloqueio do WhatsApp.
// Antes era exclusivo da tela de Campanhas (agora removido dali). Agora
// vive dentro de Conexoes → Parametros e passa a valer pra TODOS os envios
// automaticos NAO-bot (campanhas, notificacoes de cobranca, aniversario,
// lembretes). Envios manuais no atendimento humano + fluxos do bot ficam
// de fora (o bot ja tem sua propria dinamica humana em wa_humanize).
//
// Escopo: por empresa (todas as conexoes daquela empresa herdam os mesmos
// parametros). Confirmado com o usuario em 2026-08-11.
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { crmAPI } from '../services/api';

const NumField = ({ label, value, onChange, min = 0, step = 1, hint, testId }) => (
  <div>
    <label className="text-[10px] font-bold uppercase text-slate-400">{label}</label>
    <input
      type="number"
      min={min}
      step={step}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="input-field w-full text-sm"
      data-testid={testId}
    />
    {hint && <p className="text-[10px] text-slate-400 mt-0.5">{hint}</p>}
  </div>
);

export const SendParamsCard = () => {
  const [ab, setAb] = useState(null);
  const [saving, setSaving] = useState(false);

  const numeric = (v, def) => {
    const n = parseFloat(v);
    return isNaN(n) ? def : n;
  };
  const upd = (k, v) => setAb((prev) => ({ ...(prev || {}), [k]: v }));

  useEffect(() => {
    crmAPI.getCampaignSettings()
      .then((r) => setAb(r.data?.anti_block || {}))
      .catch(() => setAb({}));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await crmAPI.updateCampaignSettings({ anti_block: ab });
      toast.success('Parametros salvos — valem para envios automaticos (campanhas, cobrancas, aniversario, lembretes).');
    } catch (_e) {
      toast.error('Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  if (!ab) {
    return <div className="text-center py-12 text-slate-400 text-sm">Carregando...</div>;
  }

  return (
    <div data-testid="send-params-card">
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <p className="text-sm text-slate-600 max-w-3xl leading-relaxed">
          <span className="font-semibold">Blindagem anti-bloqueio</span> aplicada a{' '}
          <span className="font-semibold">todos os envios automaticos</span> desta empresa:
          campanhas, notificacoes de cobranca, mensagens de aniversario e lembretes.{' '}
          <span className="text-slate-500">
            Nao afeta o bot (que ja tem sua propria dinamica) nem mensagens enviadas manualmente por um atendente.
          </span>
        </p>
        <button
          onClick={save}
          disabled={saving}
          className="btn-primary text-sm"
          data-testid="save-send-params-btn"
        >
          {saving ? 'Salvando...' : 'Salvar Parametros'}
        </button>
      </div>

      <div className="card max-w-3xl p-5 space-y-4">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-[11px] font-bold text-amber-900 mb-1">⚠ Politicas anti-bloqueio do WhatsApp</p>
          <p className="text-[11px] text-amber-800 leading-relaxed">
            Estas configuracoes simulam comportamento humano para reduzir o risco do seu numero ser
            <strong> restringido/bloqueado</strong>. Para numeros nao-Business API oficial recomendamos:
            maximo 250 msgs/dia, 50/hora e intervalos randomicos entre 40-120 segundos.
          </p>
        </div>

        <label className="flex items-start gap-2 p-3 rounded-lg border border-slate-200 cursor-pointer">
          <input
            type="checkbox"
            checked={!!ab.enabled}
            onChange={(e) => upd('enabled', e.target.checked)}
            className="mt-1"
            data-testid="sp-enabled"
          />
          <div className="flex-1">
            <p className="text-sm font-semibold">Ativar protecao anti-bloqueio</p>
            <p className="text-[11px] text-slate-500">
              Recomendado. Aplica delays randomicos e pausas entre lotes em <strong>todos</strong> envios automaticos.
            </p>
          </div>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <NumField label="Intervalo minimo (s)" value={ab.interval_min_seconds ?? 40}
            onChange={(v) => upd('interval_min_seconds', numeric(v, 40))} testId="sp-min" />
          <NumField label="Intervalo maximo (s)" value={ab.interval_max_seconds ?? 120}
            onChange={(v) => upd('interval_max_seconds', numeric(v, 120))} testId="sp-max" />
        </div>

        <div className="bg-slate-50 rounded-lg p-3 space-y-3">
          <p className="text-[11px] font-bold text-slate-700">Pausa entre lotes</p>
          <div className="grid grid-cols-2 gap-3">
            <NumField label="A cada (msgs)" value={ab.burst_size ?? 20} min={1}
              onChange={(v) => upd('burst_size', numeric(v, 20))} testId="sp-burst" />
            <NumField label="Pausa de (s)" value={ab.burst_pause_seconds ?? 300}
              onChange={(v) => upd('burst_pause_seconds', numeric(v, 300))} testId="sp-burst-pause" />
          </div>
          <p className="text-[10px] text-slate-500">Ex: a cada 20 mensagens, pausa 5 minutos. Simula descanso humano.</p>
        </div>

        <div className="bg-slate-50 rounded-lg p-3 space-y-3">
          <p className="text-[11px] font-bold text-slate-700">Escalonamento progressivo</p>
          <div className="grid grid-cols-2 gap-3">
            <NumField label="Apos N mensagens" value={ab.escalate_after ?? 100}
              onChange={(v) => upd('escalate_after', numeric(v, 100))} testId="sp-escalate-after" />
            <NumField label="Multiplicador" value={ab.escalate_factor ?? 1.5} min={1} step={0.1}
              onChange={(v) => upd('escalate_factor', numeric(v, 1.5))} testId="sp-escalate-factor" />
          </div>
          <p className="text-[10px] text-slate-500">Ex: apos 100 envios, multiplica intervalos por 1.5x (40-120s vira 60-180s).</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <NumField label="Limite por dia" value={ab.daily_limit ?? 250} min={1}
            onChange={(v) => upd('daily_limit', numeric(v, 250))} testId="sp-daily"
            hint="Numero nao-Business: ate 250" />
          <NumField label="Limite por hora" value={ab.hourly_limit ?? 50} min={1}
            onChange={(v) => upd('hourly_limit', numeric(v, 50))} testId="sp-hourly" />
        </div>

        <label className="flex items-start gap-2 p-2 rounded-md cursor-pointer">
          <input
            type="checkbox"
            checked={!!ab.only_with_phone_validated}
            onChange={(e) => upd('only_with_phone_validated', e.target.checked)}
            className="mt-0.5"
            data-testid="sp-only-validated"
          />
          <div>
            <p className="text-xs font-semibold">Enviar apenas para numeros validados</p>
            <p className="text-[10px] text-slate-500">Verifica se o numero existe no WhatsApp antes de enviar (recomendado).</p>
          </div>
        </label>
      </div>
    </div>
  );
};

export default SendParamsCard;
