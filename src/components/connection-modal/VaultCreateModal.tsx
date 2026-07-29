import { FormEvent, useState } from "react";
import { Lock, X } from "lucide-react";
import { createVault } from "../../lib/vault";
import { errorMessage } from "../../lib/format";

interface VaultCreateModalProps {
  onCreated: () => void;
  onClose: () => void;
}

const formLabelClass =
  "flex flex-col gap-[5px] text-muted text-[10px] font-[540] col-span-full";
const formInputClass =
  "w-full h-[34px] px-[9px] border border-border-bright rounded-[5px] text-text bg-surface-input text-[11px] focus:border-accent placeholder:text-subtle";

export function VaultCreateModal({ onCreated, onClose }: VaultCreateModalProps) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 8) {
      setError("Master password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await createVault(password);
      onCreated();
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 grid place-items-center p-5 bg-black/55 backdrop-blur-[4px]"
      onMouseDown={(event) =>
        event.target === event.currentTarget && onClose()
      }
    >
      <form
        className="w-[min(420px,100%)] max-h-full overflow-auto p-[18px] border border-border-bright rounded-[10px] bg-surface shadow-[0_24px_70px_rgba(0,0,0,.48)]"
        onSubmit={handleSubmit}
      >
        <div className="flex items-center justify-between mb-[17px]">
          <div className="flex items-center gap-2.5">
            <span className="w-[27px] h-[27px] shrink-0 rounded-md grid place-items-center text-blue bg-blue/15">
              <Lock size={17} />
            </span>
            <h2 className="m-0 text-text-bright text-sm font-[630]">
              Create password vault
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

        <p className="m-0 mb-3.5 text-muted text-[11px] leading-[1.45]">
          Connection passwords stored in the vault are encrypted with your
          master password. The master password is never saved.
        </p>

        <div className="grid grid-cols-[1fr_120px] gap-3">
          <label className={formLabelClass}>
            Master password
            <input
              type="password"
              required
              autoFocus
              className={formInputClass}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label className={formLabelClass}>
            Confirm master password
            <input
              type="password"
              required
              className={formInputClass}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </label>
        </div>

        {error && (
          <div className="mt-3 px-2.5 py-2 rounded-[5px] text-[10px] [overflow-wrap:anywhere] text-danger bg-red/10">
            {error}
          </div>
        )}

        <div className="mt-[18px] pt-3.5 border-t border-border flex items-center justify-between gap-2">
          <span />
          <div className="flex gap-[7px]">
            <button
              type="button"
              className="h-[31px] px-[11px] rounded-[5px] text-[10px] font-semibold cursor-pointer border-0 text-muted bg-transparent hover:text-white hover:bg-panel-soft"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="h-[31px] px-[11px] rounded-[5px] text-[10px] font-semibold cursor-pointer border border-accent text-white bg-accent hover:bg-accent-bright disabled:opacity-40 disabled:cursor-default"
              disabled={busy}
            >
              Create vault
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
