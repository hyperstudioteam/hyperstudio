import { FormEvent, useEffect, useState } from "react";
import { Braces, Play, X } from "lucide-react";
import {
  coerceParamValue,
  ParamValueEntry,
  QueryParam,
  recallParamEntries,
  rememberParamEntries,
} from "../lib/queryParams";

interface QueryParamsPanelProps {
  params: QueryParam[];
  busy?: boolean;
  onConfirm: (values: unknown[], entries: ParamValueEntry[]) => void;
  onClose: () => void;
}

const formLabelClass =
  "flex flex-col gap-[5px] text-[#9199a7] text-[10px] font-[540]";
const formInputClass =
  "w-full h-[30px] px-[9px] border border-border rounded-[4px] text-[#d2d7df] bg-surface-input text-[11px] focus:border-accent placeholder:text-[#4e5663] disabled:opacity-40";

function entriesSignature(params: QueryParam[]): string {
  return params.map((param) => `${param.index}:${param.label}`).join("|");
}

export function QueryParamsPanel({
  params,
  busy = false,
  onConfirm,
  onClose,
}: QueryParamsPanelProps) {
  const [entries, setEntries] = useState<ParamValueEntry[]>(() =>
    recallParamEntries(params),
  );
  const [error, setError] = useState("");
  const signature = entriesSignature(params);

  useEffect(() => {
    setEntries(recallParamEntries(params));
    setError("");
    // Re-load when the param set changes, not on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  function update(index: number, patch: Partial<ParamValueEntry>) {
    setEntries((current) =>
      current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)),
    );
    setError("");
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    try {
      const values = entries.map((entry) =>
        coerceParamValue(entry.text, entry.isNull),
      );
      rememberParamEntries(params, entries);
      onConfirm(values, entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-l border-border bg-panel">
      <header className="flex h-9 shrink-0 items-center justify-between border-b border-border bg-[#14171b] px-3">
        <div className="flex items-center gap-1.5 text-[10px] text-[#d5dae3]">
          <Braces size={12} className="text-accent" />
          Parameters
        </div>
        <button
          type="button"
          className="grid size-5 cursor-pointer place-items-center rounded-[3px] border-0 bg-transparent p-0 text-subtle hover:text-text"
          aria-label="Close parameters"
          onClick={onClose}
        >
          <X size={12} />
        </button>
      </header>

      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={handleSubmit}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">

          {params.map((param, index) => (
            <label key={`${param.index}:${param.label}`} className={formLabelClass}>
              {param.label}
              <div className="flex items-center gap-2">
                <input
                  autoFocus={index === 0}
                  disabled={busy || entries[index]?.isNull}
                  className={formInputClass}
                  value={entries[index]?.isNull ? "" : entries[index]?.text ?? ""}
                  placeholder={entries[index]?.isNull ? "NULL" : "Value"}
                  spellCheck={false}
                  onChange={(event) =>
                    update(index, { text: event.target.value })
                  }
                />
                <label className="flex shrink-0 cursor-pointer select-none items-center gap-1 text-[10px] text-[#9199a7]">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={entries[index]?.isNull ?? false}
                    onChange={(event) =>
                      update(index, { isNull: event.target.checked })
                    }
                  />
                  NULL
                </label>
              </div>
            </label>
          ))}

          {error ? (
            <p className="m-0 text-[10px] text-danger">{error}</p>
          ) : null}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-1.5 border-t border-border px-3 py-2">
          <button
            type="button"
            className="h-7 cursor-pointer rounded-[4px] border-0 bg-transparent px-2.5 text-[10px] text-muted hover:bg-panel-soft hover:text-text"
            onClick={onClose}
          >
            Close
          </button>
          <button
            type="submit"
            disabled={busy}
            className="flex h-7 cursor-pointer items-center gap-1 rounded-[4px] border border-[#7667e7] bg-[#6959da] px-2.5 text-[10px] font-semibold text-white hover:bg-[#7767e7] disabled:opacity-50"
          >
            <Play size={11} />
            Run
          </button>
        </footer>
      </form>
    </aside>
  );
}
