import { useState } from "react";
import { ShieldAlert } from "lucide-react";

interface WriteConfirmModalProps {
  connectionName: string;
  sql: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Gate for connections marked "confirm writes".
 *
 * Typing the connection name is deliberate friction: it makes running a write
 * against production a decision rather than a reflex click.
 */
export function WriteConfirmModal({
  connectionName,
  sql,
  onCancel,
  onConfirm,
}: WriteConfirmModalProps) {
  const [typed, setTyped] = useState("");
  const matches = typed.trim() === connectionName.trim();

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-[rgba(0,0,0,.55)]"
      onClick={onCancel}
    >
      <div
        className="w-[460px] max-w-[92vw] rounded-lg border border-[rgba(229,72,77,.4)] bg-panel shadow-[0_24px_60px_rgba(0,0,0,.5)]"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
          <ShieldAlert size={15} className="text-danger" />
          <h2 className="m-0 text-[12px] font-semibold text-text-bright">
            Confirm write on “{connectionName}”
          </h2>
        </header>

        <div className="flex flex-col gap-2.5 px-3.5 py-3">
          <p className="m-0 text-[11px] leading-[1.5] text-[#c9d0db]">
            This connection is guarded. The statement below modifies data or
            schema.
          </p>

          <pre className="scrollbar-thin-app m-0 max-h-[160px] overflow-auto rounded-md border border-border bg-surface-deep p-2.5 font-mono text-[10px] leading-[1.5] whitespace-pre-wrap text-[#c4cbd6]">
            {sql}
          </pre>

          <label className="flex flex-col gap-[5px] text-[10px] font-[540] text-[#9199a7]">
            Type <strong className="text-[#d5dae3]">{connectionName}</strong> to
            continue
            <input
              className="h-[34px] w-full rounded-[5px] border border-border-bright bg-surface-input px-[9px] text-[11px] text-[#d2d7df] focus:border-accent"
              autoFocus
              value={typed}
              spellCheck={false}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && matches) onConfirm();
                if (event.key === "Escape") onCancel();
              }}
            />
          </label>
        </div>

        <footer className="flex justify-end gap-2 border-t border-border px-3.5 py-2.5">
          <button
            type="button"
            className="cursor-pointer rounded-[5px] border border-border bg-transparent px-3 py-1.5 text-[11px] text-muted hover:border-border-bright hover:text-text"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="cursor-pointer rounded-[5px] border border-[rgba(229,72,77,.5)] bg-[rgba(229,72,77,.12)] px-3 py-1.5 text-[11px] font-semibold text-[#f0a0a3] hover:border-danger hover:text-white disabled:opacity-40"
            disabled={!matches}
            onClick={onConfirm}
          >
            Run it
          </button>
        </footer>
      </div>
    </div>
  );
}
