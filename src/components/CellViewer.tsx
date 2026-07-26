import { useEffect, useMemo, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { cn } from "../lib/cn";
import { CellContext, defaultFormat } from "../plugins/contributions";
import { useCellViewers } from "../plugins/useContributions";

interface CellViewerProps {
  context: CellContext;
  /** Preferred viewer id to select first (from the column type). */
  preferredViewer?: string;
  onClose: () => void;
}

export function CellViewer({
  context,
  preferredViewer,
  onClose,
}: CellViewerProps) {
  const viewers = useCellViewers(context);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const active = useMemo(() => {
    if (viewers.length === 0) return null;
    const byActive = activeId
      ? viewers.find((viewer) => viewer.id === activeId)
      : undefined;
    const byPreferred = preferredViewer
      ? viewers.find((viewer) => viewer.id === preferredViewer)
      : undefined;
    return byActive ?? byPreferred ?? viewers[0];
  }, [viewers, activeId, preferredViewer]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copyRaw() {
    try {
      await navigator.clipboard.writeText(defaultFormat(context.value));
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 grid place-items-center bg-[rgba(5,7,10,.55)] p-5 backdrop-blur-[4px]"
      onMouseDown={(event) =>
        event.target === event.currentTarget && onClose()
      }
    >
      <div className="flex max-h-[min(560px,100%)] w-[min(680px,100%)] flex-col overflow-hidden rounded-[10px] border border-border-bright bg-surface shadow-[0_24px_70px_rgba(0,0,0,.5)]">
        <div className="flex items-center justify-between gap-2.5 border-b border-border px-2.5 py-2">
          <div className="flex flex-wrap gap-1">
            {viewers.map((viewer) => (
              <button
                key={viewer.id}
                type="button"
                className={cn(
                  "h-[26px] cursor-pointer rounded-[5px] border border-border bg-[#15181e] px-2.5 text-[11px] text-muted hover:border-border-bright hover:text-text",
                  active?.id === viewer.id &&
                    "border-[rgba(139,124,246,.6)] bg-accent-soft text-[#d5d0ff]",
                )}
                onClick={() => setActiveId(viewer.id)}
                title={
                  viewer.source === "built-in"
                    ? "Built-in viewer"
                    : `From plugin: ${viewer.source}`
                }
              >
                {viewer.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              className="grid size-7 cursor-pointer place-items-center rounded-[5px] border-0 bg-transparent text-muted hover:bg-panel-soft hover:text-text"
              aria-label="Copy raw value"
              onClick={() => void copyRaw()}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
            <button
              type="button"
              className="grid size-7 cursor-pointer place-items-center rounded-[5px] border-0 bg-transparent text-muted hover:bg-panel-soft hover:text-text"
              aria-label="Close viewer"
              onClick={onClose}
            >
              <X size={15} />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-[11px] text-muted">
          {context.columnName && <span>{context.columnName}</span>}
          {context.typeName && (
            <code className="text-[10px] text-subtle">{context.typeName}</code>
          )}
        </div>
        <div className="flex-1 overflow-auto p-3">
          {active ? (
            active.render(context)
          ) : (
            <div className="p-5 text-center text-[12px] text-muted">
              No viewer.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
