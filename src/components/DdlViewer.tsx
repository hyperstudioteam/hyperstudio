import { useEffect, useState } from "react";
import { Check, Copy, LoaderCircle, X } from "lucide-react";
import { databaseApi } from "../api/database";
import { errorMessage } from "../lib/format";

interface DdlViewerProps {
  connectionId: string;
  schema: string;
  table: string;
  onClose: () => void;
}

export function DdlViewer({
  connectionId,
  schema,
  table,
  onClose,
}: DdlViewerProps) {
  const [ddl, setDdl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError("");
    databaseApi
      .tableDdl(connectionId, schema, table)
      .then((text) => {
        if (!cancelled) setDdl(text);
      })
      .catch((nextError) => {
        if (!cancelled) setError(errorMessage(nextError));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, schema, table]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(ddl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch (nextError) {
      setError(errorMessage(nextError));
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="flex h-[70vh] w-[720px] max-w-[92vw] flex-col rounded-lg border border-border bg-panel shadow-[0_24px_60px_rgba(0,0,0,.5)]"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-border px-3.5 py-2.5">
          <h2 className="m-0 min-w-0 truncate text-[12px] font-semibold text-text-bright">
            DDL · {schema}.{table}
          </h2>
          <button
            type="button"
            className="ml-auto flex cursor-pointer items-center gap-1.5 rounded-[5px] border border-border bg-transparent px-2 py-1 text-[10px] text-muted hover:border-border-bright hover:text-text disabled:opacity-40"
            disabled={busy || !ddl}
            onClick={() => void copy()}
          >
            {copied ? (
              <Check size={12} className="text-green" />
            ) : (
              <Copy size={12} />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            className="grid size-6 cursor-pointer place-items-center rounded-[4px] border-0 bg-transparent text-subtle hover:bg-panel-soft hover:text-text"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </header>

        <div className="scrollbar-thin-app min-h-0 flex-1 overflow-auto p-3">
          {busy ? (
            <div className="flex h-full items-center justify-center gap-2 text-[11px] text-subtle">
              <LoaderCircle className="animate-spin-slow" size={16} />
              Reading DDL…
            </div>
          ) : error ? (
            <div className="rounded-md border border-red/20 bg-red/5 p-3 text-[11px] text-red">
              <strong className="text-[11px]">Could not read DDL</strong>
              <p className="mt-[3px] mb-0 font-mono text-[10px] leading-normal whitespace-pre-wrap text-danger">
                {error}
              </p>
            </div>
          ) : (
            <pre className="m-0 font-mono text-[11px] leading-[1.55] whitespace-pre text-text">
              {ddl}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
