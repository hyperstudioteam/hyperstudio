import { useState } from "react";
import { Download, LoaderCircle, X } from "lucide-react";
import { cn } from "../lib/cn";
import { EXPORT_FORMATS, ExportFormat } from "../lib/exportResults";

export interface ExportOptions {
  format: ExportFormat;
  includeHeader: boolean;
  allRows: boolean;
}

interface ExportModalProps {
  /** Rows already fetched for the visible page. */
  pageRows: number;
  /** False when the query cannot be re-paged, so only the page can be exported. */
  canExportAll: boolean;
  busy: boolean;
  progress: number | null;
  error: string;
  onClose: () => void;
  onExport: (options: ExportOptions) => void;
}

export function ExportModal({
  pageRows,
  canExportAll,
  busy,
  progress,
  error,
  onClose,
  onExport,
}: ExportModalProps) {
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [includeHeader, setIncludeHeader] = useState(true);
  const [allRows, setAllRows] = useState(canExportAll);

  const supportsHeader = format === "csv" || format === "tsv";

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[rgba(0,0,0,.5)]"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-[380px] rounded-lg border border-border bg-panel shadow-[0_24px_60px_rgba(0,0,0,.5)]"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border px-3.5 py-2.5">
          <h2 className="m-0 text-[12px] font-semibold text-text-bright">
            Export result set
          </h2>
          <button
            type="button"
            className="grid size-6 cursor-pointer place-items-center rounded-[4px] border-0 bg-transparent text-subtle hover:bg-panel-soft hover:text-text disabled:opacity-40"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </header>

        <div className="flex flex-col gap-3 px-3.5 py-3">
          <div>
            <label className="mb-1.5 block text-[10px] tracking-wide text-muted uppercase">
              Format
            </label>
            <div className="flex gap-1.5">
              {EXPORT_FORMATS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={cn(
                    "flex-1 cursor-pointer rounded-[5px] border border-border bg-transparent px-2 py-1.5 text-[10px] text-muted hover:border-border-bright hover:text-text",
                    format === item.id &&
                      "border-accent bg-accent-soft text-[#c9c2ff]",
                  )}
                  disabled={busy}
                  onClick={() => setFormat(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <label
            className={cn(
              "flex cursor-pointer items-center gap-2 text-[11px] text-[#c9d0db]",
              !supportsHeader && "cursor-default opacity-40",
            )}
          >
            <input
              type="checkbox"
              className="size-3 accent-accent"
              checked={supportsHeader && includeHeader}
              disabled={busy || !supportsHeader}
              onChange={(event) => setIncludeHeader(event.target.checked)}
            />
            Include header row
          </label>

          <label
            className={cn(
              "flex cursor-pointer items-start gap-2 text-[11px] text-[#c9d0db]",
              !canExportAll && "cursor-default opacity-40",
            )}
          >
            <input
              type="checkbox"
              className="mt-0.5 size-3 accent-accent"
              checked={canExportAll && allRows}
              disabled={busy || !canExportAll}
              onChange={(event) => setAllRows(event.target.checked)}
            />
            <span>
              Export every row
              <span className="mt-0.5 block text-[9px] text-subtle">
                {canExportAll
                  ? "Re-runs the query page by page until it is exhausted."
                  : "Unavailable: this statement cannot be re-paged safely."}
              </span>
            </span>
          </label>

          {!allRows && (
            <p className="m-0 text-[9px] text-subtle">
              Exports the {pageRows.toLocaleString()} row
              {pageRows === 1 ? "" : "s"} currently loaded.
            </p>
          )}

          {progress != null && (
            <p className="m-0 text-[10px] text-muted">
              {progress.toLocaleString()} rows written…
            </p>
          )}

          {error && (
            <p className="m-0 text-[10px] break-words text-danger">{error}</p>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-border px-3.5 py-2.5">
          <button
            type="button"
            className="cursor-pointer rounded-[5px] border border-border bg-transparent px-3 py-1.5 text-[11px] text-muted hover:border-border-bright hover:text-text disabled:opacity-40"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="flex cursor-pointer items-center gap-1.5 rounded-[5px] border border-[rgba(139,124,246,.45)] bg-accent-soft px-3 py-1.5 text-[11px] font-semibold text-[#c9c2ff] hover:border-accent hover:text-white disabled:opacity-60"
            disabled={busy}
            onClick={() => onExport({ format, includeHeader, allRows })}
          >
            {busy ? (
              <LoaderCircle className="animate-spin-slow" size={13} />
            ) : (
              <Download size={13} />
            )}
            Export
          </button>
        </footer>
      </div>
    </div>
  );
}
