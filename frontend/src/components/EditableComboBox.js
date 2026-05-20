import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, X, Plus, Check } from 'lucide-react';

/**
 * EditableComboBox — a select-like dropdown that also accepts new entries.
 *
 * Looks like a native <select> (with ChevronDown), but on click expands a
 * popover where the operator can: pick an existing option, type a new one
 * (with "+ Add") and delete custom options. The `permanent` list cannot
 * be deleted (built-in defaults like "Padrao", "Boleto").
 *
 * Persistence is delegated to the parent via `customOptions` + handlers —
 * could be backend-backed (BD field) or localStorage (Forma de Pagamento).
 *
 * Props:
 *   value             — current selected value (controlled)
 *   onChange(v)       — fired when selection changes
 *   permanentOptions  — list of strings ALWAYS shown, cannot be deleted
 *   customOptions     — list of strings shown after permanent; can be deleted
 *   onAddCustom(v)    — async, called when user adds new option (return promise)
 *   onDeleteCustom(v) — async, called when user deletes a custom option
 *   placeholder       — input placeholder
 *   testid            — data-testid prefix
 */
export const EditableComboBox = ({
  value,
  onChange,
  permanentOptions = [],
  customOptions = [],
  onAddCustom,
  onDeleteCustom,
  placeholder = 'Selecione...',
  testid = 'combobox',
}) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const wrapperRef = useRef(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const allOptions = [...permanentOptions, ...customOptions];
  const isPermanent = (opt) => permanentOptions.includes(opt);

  const handlePick = (opt) => {
    onChange(opt);
    setOpen(false);
    setDraft('');
  };

  const handleAdd = async () => {
    const v = draft.trim();
    if (!v) return;
    if (allOptions.includes(v)) { handlePick(v); return; }
    if (onAddCustom) {
      try { await onAddCustom(v); } catch (_) {/* parent handles toast */}
    }
    onChange(v);
    setDraft('');
    setOpen(false);
  };

  const handleDelete = async (e, opt) => {
    e.stopPropagation();
    if (isPermanent(opt)) return;
    if (!window.confirm(`Excluir a opcao "${opt}"?`)) return;
    if (onDeleteCustom) {
      try { await onDeleteCustom(opt); } catch (_) {/* parent handles toast */}
    }
    if (value === opt && permanentOptions.length > 0) onChange(permanentOptions[0]);
  };

  return (
    <div className="relative" ref={wrapperRef} data-testid={`${testid}-wrapper`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="input-field w-full flex items-center justify-between text-left"
        data-testid={`${testid}-trigger`}
      >
        <span className={value ? 'text-slate-900' : 'text-slate-400'}>
          {value || placeholder}
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-80 overflow-y-auto" data-testid={`${testid}-popover`}>
          {allOptions.length === 0 && (
            <p className="px-3 py-2 text-sm text-slate-400">Nenhuma opcao cadastrada.</p>
          )}
          {allOptions.map(opt => (
            <div
              key={opt}
              onClick={() => handlePick(opt)}
              className={`flex items-center justify-between px-3 py-2 text-sm cursor-pointer hover:bg-slate-50 ${value === opt ? 'bg-indigo-50' : ''}`}
              data-testid={`${testid}-option-${opt}`}
            >
              <span className="flex items-center gap-2 min-w-0">
                {value === opt && <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                <span className="truncate">{opt}</span>
                {isPermanent(opt) && (
                  <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 ml-1">padrao</span>
                )}
              </span>
              {!isPermanent(opt) && (
                <button
                  type="button"
                  onClick={(e) => handleDelete(e, opt)}
                  className="p-1 rounded hover:bg-rose-100 text-rose-500 shrink-0"
                  title="Excluir esta opcao"
                  data-testid={`${testid}-delete-${opt}`}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
          <div className="flex items-center gap-2 p-2 border-t border-slate-200 bg-slate-50">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
              placeholder="Adicionar nova opcao..."
              className="flex-1 px-2 py-1 text-sm border border-slate-200 rounded focus:outline-none focus:border-indigo-400"
              data-testid={`${testid}-add-input`}
            />
            <button
              type="button"
              onClick={handleAdd}
              disabled={!draft.trim()}
              className="p-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-300"
              data-testid={`${testid}-add-btn`}
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default EditableComboBox;
