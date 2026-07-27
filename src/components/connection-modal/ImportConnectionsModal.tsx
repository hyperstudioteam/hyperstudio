import { FormEvent, useState } from "react";
import { FileInput, X } from "lucide-react";
import { ImportMode } from "../../lib/connectionTransfer";

interface ImportConnectionsModalProps {
  connectionCount: number;
  keychainWithoutPassword: number;
  onConfirm: (mode: ImportMode) => void;
  onClose: () => void;
}

const formLabelClass =
  "flex flex-col gap-[5px] text-[#9199a7] text-[10px] font-[540]";

export function ImportConnectionsModal({
  connectionCount,
  keychainWithoutPassword,
  onConfirm,
  onClose,
}: ImportConnectionsModalProps) {
  const [mode, setMode] = useState<ImportMode>("merge");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onConfirm(mode);
  }

  return (
    <div
      className="fixed inset-0 z-20 grid place-items-center p-5 bg-[rgba(5,7,10,.72)] backdrop-blur-[4px]"
      onMouseDown={(event) =>
        event.target === event.currentTarget && onClose()
      }
    >
      <form
        className="w-[min(440px,100%)] max-h-full overflow-auto p-[18px] border border-border-bright rounded-[10px] bg-surface shadow-[0_24px_70px_rgba(0,0,0,.48)]"
        onSubmit={handleSubmit}
      >
        <div className="flex items-center justify-between mb-[17px]">
          <div className="flex items-center gap-2.5">
            <span className="w-7 h-7 shrink-0 rounded-md grid place-items-center text-accent bg-accent-soft">
              <FileInput size={17} />
            </span>
            <h2 className="m-0 text-text-bright text-sm font-[630]">
              Import connections
            </h2>
          </div>
          <button
            type="button"
            className="w-7 h-7 grid place-items-center p-0 border-0 rounded-[5px] text-muted bg-transparent cursor-pointer enabled:hover:text-text enabled:hover:bg-panel-soft disabled:cursor-default disabled:opacity-40"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>

        <p className="m-0 mb-3.5 text-[12px] leading-[1.45] text-[#aab1be]">
          Found {connectionCount} connection
          {connectionCount === 1 ? "" : "s"}
          {keychainWithoutPassword > 0
            ? `. ${keychainWithoutPassword} used the OS keychain and will need passwords entered again.`
            : "."}{" "}
          Passwords from the file (except keychain) will be restored.
        </p>

        <fieldset className={`${formLabelClass} mb-4 border-0 p-0 m-0`}>
          <legend className="px-0 mb-[7px] text-[#9199a7] text-[10px] font-[540]">
            How to import
          </legend>
          <label className="flex items-start gap-2 mb-2 text-[12px] text-[#d2d7df] cursor-pointer">
            <input
              type="radio"
              className="mt-[3px]"
              name="import-mode"
              checked={mode === "merge"}
              onChange={() => setMode("merge")}
            />
            <span>
              <strong className="font-[600] text-text-bright">
                Add to existing
              </strong>
              <span className="block text-[#9199a7] text-[11px] mt-0.5">
                Keep current connections and append the imported tree.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-[12px] text-[#d2d7df] cursor-pointer">
            <input
              type="radio"
              className="mt-[3px]"
              name="import-mode"
              checked={mode === "replace"}
              onChange={() => setMode("replace")}
            />
            <span>
              <strong className="font-[600] text-text-bright">
                Replace all
              </strong>
              <span className="block text-[#9199a7] text-[11px] mt-0.5">
                Remove current connections and folders, then import.
              </span>
            </span>
          </label>
        </fieldset>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="h-[32px] px-3 border border-border-bright rounded-[5px] text-[#c4cad4] bg-transparent text-[11px] cursor-pointer hover:text-text hover:bg-panel-soft"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="h-[32px] px-3 border-0 rounded-[5px] text-white bg-accent text-[11px] font-[600] cursor-pointer hover:brightness-110"
          >
            Import
          </button>
        </div>
      </form>
    </div>
  );
}
