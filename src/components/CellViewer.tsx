import { useEffect, useMemo, useState } from "react";
import { Check, Copy, X } from "lucide-react";
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
      className="modal-backdrop nested"
      onMouseDown={(event) =>
        event.target === event.currentTarget && onClose()
      }
    >
      <div className="cell-viewer">
        <div className="cell-viewer-head">
          <div className="cell-viewer-tabs">
            {viewers.map((viewer) => (
              <button
                key={viewer.id}
                type="button"
                className={active?.id === viewer.id ? "active" : ""}
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
          <div className="cell-viewer-actions">
            <button
              type="button"
              className="icon-button"
              aria-label="Copy raw value"
              onClick={() => void copyRaw()}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Close viewer"
              onClick={onClose}
            >
              <X size={15} />
            </button>
          </div>
        </div>
        <div className="cell-viewer-meta">
          {context.columnName && <span>{context.columnName}</span>}
          {context.typeName && <code>{context.typeName}</code>}
        </div>
        <div className="cell-viewer-body">
          {active ? active.render(context) : <div className="viewer-empty">No viewer.</div>}
        </div>
      </div>
    </div>
  );
}
