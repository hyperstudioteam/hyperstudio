import { FormEvent, useState } from "react";
import { LockKeyhole, X } from "lucide-react";
import { unlockVault, applyPendingVaultRemovals } from "../../lib/vault";
import { errorMessage } from "../../lib/format";

interface VaultUnlockModalProps {
  title?: string;
  onUnlocked: () => void;
  onClose: () => void;
}

const formLabelClass =
  "flex flex-col gap-[5px] text-[#9199a7] text-[10px] font-[540] col-span-full";
const formInputClass =
  "w-full h-[34px] px-[9px] border border-border-bright rounded-[5px] text-[#d2d7df] bg-surface-input text-[11px] focus:border-accent placeholder:text-[#4e5663]";

export function VaultUnlockModal({
  title = "Unlock password vault",
  onUnlocked,
  onClose,
}: VaultUnlockModalProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await unlockVault(password);
      await applyPendingVaultRemovals();
      onUnlocked();
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 grid place-items-center p-5 bg-[rgba(5,7,10,.55)] backdrop-blur-[4px]"
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
            <span className="w-[27px] h-[27px] shrink-0 rounded-md grid place-items-center text-[#8fb9e8] bg-[rgba(72,128,186,.16)]">
              <LockKeyhole size={17} />
            </span>
            <h2 className="m-0 text-text-bright text-sm font-[630]">{title}</h2>
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

        <p className="m-0 mb-3.5 text-[#8b93a1] text-[11px] leading-[1.45]">
          Enter your master password to decrypt saved connection passwords.
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
        </div>

        {error && (
          <div className="mt-3 px-2.5 py-2 rounded-[5px] text-[10px] [overflow-wrap:anywhere] text-[#d18b91] bg-[rgba(239,107,115,.08)]">
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
              className="h-[31px] px-[11px] rounded-[5px] text-[10px] font-semibold cursor-pointer border border-[#7667e7] text-white bg-[#6959da] hover:bg-[#7767e7] disabled:opacity-40 disabled:cursor-default"
              disabled={busy}
            >
              Unlock
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
