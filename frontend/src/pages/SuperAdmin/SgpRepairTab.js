import React, { useState } from 'react';
import { toast } from 'sonner';
import api from '../../services/api';
import {
  Wrench, Search, AlertTriangle, CheckCircle2, Download,
  RefreshCw, Building, ChevronRight, Play, ScrollText,
} from 'lucide-react';

// Map issue codes returned by GET /audit-sgp-flow* to friendly Portuguese
// summaries shown on each report card. Add new entries here when the backend
// adds new diagnostic codes.
const ISSUE_LABELS = {
  missing_consultacliente: 'Nenhuma chamada SGP `consultacliente` no fluxo.',
  missing_contract_picker: 'Falta o menu dinamico para o cliente escolher o contrato.',
  second_via_template_poor: 'Mensagem da 2a via nao envia PDF + linha digitavel + Pix.',
  fatura2via_missing_contrato_placeholder: 'O HTTP fatura2via nao passa {{contrato_id}}.',
};

const ACTION_LABELS = {
  insert_contract_picker: 'Inserir menu de selecao de contrato',
  rewrite_second_via_message: 'Reescrever mensagem da 2a via (boleto + Pix + linha)',
  patch_fatura2via_body: 'Passar {{contrato_id}} no body do fatura2via',
  strip_dynamic_from_service_menu: 'Limpar metadado de contrato do menu de servicos',
  force_picker_text_mode: 'Forcar picker em modo texto + {{contratos_menu}}',
  fix_corrupt_http_body: 'Reparar body HTTP corrompido ([object Object])',
  clear_picker_static_options: 'Remover opcoes estaticas do picker dinamico',
  rewire_pix_to_fatura2via: 'Reaproveitar fatura2via para o caminho Pix',
  rewire_pix_to_fatura2via_and_attach_msg: 'Reaproveitar fatura2via + criar mensagem do Pix (copia-e-cola)',
};

const SgpRepairTab = ({ companies }) => {
  const [companyId, setCompanyId] = useState('');
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [appliedByFlow, setAppliedByFlow] = useState({}); // flow_id -> last apply result

  const runAudit = async (cid) => {
    if (!cid) {
      toast.error('Selecione uma empresa.');
      return;
    }
    setLoading(true);
    setReports([]);
    setAppliedByFlow({});
    try {
      const { data } = await api.get(`/super-admin/audit-sgp-flow-by-company/${cid}`);
      setReports(data.reports || []);
      if (!data.reports || data.reports.length === 0) {
        toast.info('Nenhum fluxo SGP encontrado para essa empresa.');
      } else {
        const broken = data.reports.filter(r => !r.ok).length;
        toast.success(`${data.reports.length} fluxo(s) auditado(s) - ${broken} com problemas.`);
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Falha ao auditar fluxos SGP');
    } finally {
      setLoading(false);
    }
  };

  const repair = async (flowId, dryRun) => {
    try {
      const { data } = await api.post(
        `/super-admin/repair-sgp-flow/${flowId}?dry_run=${dryRun}`
      );
      setAppliedByFlow(prev => ({ ...prev, [flowId]: { ...data, dry_run: dryRun } }));
      if (dryRun) {
        toast.info(`Pre-visualizacao: ${data.changes_count} mudanca(s) a aplicar.`);
      } else {
        toast.success(`Reparo aplicado: ${data.changes_count} mudanca(s).`);
        // Re-audit so the report card refreshes
        await runAudit(companyId);
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Erro ao reparar fluxo');
    }
  };

  const downloadFixed = async (flowId, flowName) => {
    try {
      const r = await api.get(
        `/super-admin/export-repaired-sgp-flow/${flowId}`,
        { responseType: 'blob' }
      );
      const url = window.URL.createObjectURL(new Blob([r.data], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(flowName || 'fluxo').replace(/\s+/g, '_')}_FIXED.json`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Arquivo corrigido baixado.');
    } catch (e) {
      toast.error('Falha ao gerar download');
    }
  };

  return (
    <div className="space-y-6" data-testid="sgp-repair-tab">
      {/* Header card */}
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-indigo-50 to-white p-5 flex items-start gap-4">
        <div className="p-3 rounded-xl bg-indigo-600 text-white shrink-0">
          <Wrench className="w-6 h-6" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-slate-900">Auditar / Reparar Fluxo SGP</h2>
          <p className="text-sm text-slate-600 mt-1">
            Diagnostica fluxos SGP que ficaram quebrados (sem menu de contratos, sem
            placeholders no fatura2via, body HTTP corrompido, etc) e aplica o reparo
            necessario com um clique. Operacao idempotente — pode rodar varias vezes
            sem risco.
          </p>
        </div>
      </div>

      {/* Company picker */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 block">
          Selecione a empresa
        </label>
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Building className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className="w-full pl-10 pr-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500"
              data-testid="sgp-repair-company-select"
            >
              <option value="">— escolha uma empresa —</option>
              {(companies || []).map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.subdomain})
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => runAudit(companyId)}
            disabled={!companyId || loading}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
            data-testid="sgp-repair-audit-btn"
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Auditar Fluxos SGP
          </button>
        </div>
      </div>

      {/* Reports */}
      {reports.length === 0 && !loading && (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white p-10 text-center">
          <ScrollText className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">
            Selecione uma empresa e clique em <strong>Auditar Fluxos SGP</strong> para
            ver o relatorio.
          </p>
        </div>
      )}

      {reports.map(rep => {
        const applied = appliedByFlow[rep.flow_id];
        const hasIssues = (rep.issues || []).length > 0;
        return (
          <div
            key={rep.flow_id}
            className="rounded-2xl border border-slate-200 bg-white overflow-hidden"
            data-testid={`sgp-flow-card-${rep.flow_id}`}
          >
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h3 className="font-bold text-slate-900 truncate">{rep.flow_name}</h3>
                <p className="text-xs text-slate-500 mt-0.5 font-mono">
                  {rep.flow_id} · {rep.nodes_count} nos · {rep.edges_count} conexoes
                </p>
              </div>
              <div className="shrink-0">
                {(() => {
                  // Audit returns `ok=true` when there are no DIAGNOSTIC
                  // issues — but the repair may still have ACTIONS to apply
                  // (force text mode, rewire Pix, etc) that are surfaced
                  // only via dry-run. We refresh the badge once a dry-run
                  // has been executed so the operator sees the real status.
                  const dr = appliedByFlow[rep.flow_id];
                  if (dr && dr.dry_run && dr.changes_count > 0) {
                    return (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-semibold">
                        <AlertTriangle className="w-3.5 h-3.5" /> {dr.changes_count} reparo(s) pendente(s)
                      </span>
                    );
                  }
                  if (rep.ok) {
                    return (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Sem problemas
                      </span>
                    );
                  }
                  return (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-semibold">
                      <AlertTriangle className="w-3.5 h-3.5" /> {(rep.issues || []).length} problema(s)
                    </span>
                  );
                })()}
              </div>
            </div>

            {hasIssues && (
              <ul className="divide-y divide-slate-100">
                {rep.issues.map((iss, idx) => (
                  <li key={idx} className="px-5 py-3 flex items-start gap-3" data-testid={`sgp-issue-${rep.flow_id}-${iss.code}`}>
                    <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800">
                        {ISSUE_LABELS[iss.code] || iss.code}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">{iss.message}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {applied && applied.dry_run && (
              <div className="px-5 py-3 bg-slate-50 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
                  Pre-visualizacao do reparo ({applied.changes_count} acao(oes))
                </p>
                <ul className="space-y-1">
                  {(applied.changes || []).map((c, i) => (
                    <li key={i} className="text-xs text-slate-600 flex items-center gap-2">
                      <ChevronRight className="w-3 h-3 text-slate-400" />
                      {ACTION_LABELS[c.action] || c.action}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="px-5 py-3 bg-white border-t border-slate-100 flex flex-wrap gap-2">
              <button
                onClick={() => repair(rep.flow_id, true)}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                data-testid={`sgp-dryrun-${rep.flow_id}`}
              >
                <Search className="w-3.5 h-3.5" /> Pre-visualizar reparo
              </button>
              <button
                onClick={() => {
                  if (window.confirm(`Aplicar reparo no fluxo "${rep.flow_name}"?\n\nA acao e idempotente: rodar de novo nao quebra nada.`)) {
                    repair(rep.flow_id, false);
                  }
                }}
                className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5"
                data-testid={`sgp-apply-${rep.flow_id}`}
              >
                <Play className="w-3.5 h-3.5" /> Aplicar reparo
              </button>
              <button
                onClick={() => downloadFixed(rep.flow_id, rep.flow_name)}
                className="px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 ml-auto"
                data-testid={`sgp-download-${rep.flow_id}`}
              >
                <Download className="w-3.5 h-3.5" /> Baixar JSON corrigido
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default SgpRepairTab;
