import { useState } from "react";
import { KeyRound, Lock, X } from "lucide-react";
import {
  AUTO_LOCK_CHOICES,
  changeMasterPassword,
  getAutoLockMinutes,
  isVaultUnlocked,
  lockVault,
  setAutoLockMinutes,
} from "../../lib/vault";
import { cn } from "../../lib/cn";

interface VaultSettingsModalProps {
  onClose: () => void;
}

const labelClass = "flex flex-col gap-[5px] text-[10px] font-[540] text-muted";
const inputClass =
  "h-[34px] w-full rounded-[5px] border border-border-bright bg-surface-input px-[9px] text-[11px] text-text focus:border-accent placeholder:text-subtle";

function autoLockLabel(minutes: number): string {
  return minutes === 0 ? "Never" : `${minutes} min`;
}

export function VaultSettingsModal({ onClose }: VaultSettingsModalProps) {
  const [minutes, setMinutes] = useState(() => getAutoLockMinutes());
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const unlocked = isVaultUnlocked();

  function applyAutoLock(value: number) {
    setMinutes(value);
    setAutoLockMinutes(value);
  }

  async function rotate() {
    setError("");
    setDone("");
    if (next !== confirm) {
      setError("New passwords do not match.");
      return;
    }
    if (!next.trim()) {
      setError("New master password is required.");
      return;
    }
    setBusy(true);
    try {
      await changeMasterPassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone("Master password changed. Existing secrets were re-encrypted.");
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-[420px] max-w-[92vw] rounded-lg border border-border bg-panel shadow-[0_24px_60px_rgba(0,0,0,.5)]"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
          <KeyRound size={14} className="text-accent-bright" />
          <h2 className="m-0 text-[12px] font-semibold text-text-bright">
            Vault settings
          </h2>
          <button
            type="button"
            className="ml-auto grid size-6 cursor-pointer place-items-center rounded-[4px] border-0 bg-transparent text-subtle hover:bg-panel-soft hover:text-text"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </header>

        <div className="flex flex-col gap-3.5 px-3.5 py-3">
          <div className={labelClass}>
            Auto-lock after inactivity
            <div className="flex gap-1.5">
              {AUTO_LOCK_CHOICES.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  className={cn(
                    "flex-1 cursor-pointer rounded-[5px] border border-border bg-transparent px-2 py-1.5 text-[10px] text-muted hover:border-border-bright hover:text-text",
                    minutes === choice &&
                      "border-accent bg-accent-soft text-accent-bright",
                  )}
                  onClick={() => applyAutoLock(choice)}
                >
                  {autoLockLabel(choice)}
                </button>
              ))}
            </div>
            <span className="text-[9px] font-normal text-subtle">
              The vault locks after this much time without activity. Locking
              clears decrypted secrets from memory; connections already open
              stay connected.
            </span>
          </div>

          <div className="h-px bg-border" />

          <div className="flex flex-col gap-2.5">
            <span className="text-[10px] font-[540] text-muted">
              Change master password
            </span>
            <label className={labelClass}>
              Current
              <input
                type="password"
                className={inputClass}
                value={current}
                autoComplete="current-password"
                onChange={(event) => setCurrent(event.target.value)}
              />
            </label>
            <label className={labelClass}>
              New
              <input
                type="password"
                className={inputClass}
                value={next}
                autoComplete="new-password"
                onChange={(event) => setNext(event.target.value)}
              />
            </label>
            <label className={labelClass}>
              Confirm new
              <input
                type="password"
                className={inputClass}
                value={confirm}
                autoComplete="new-password"
                onChange={(event) => setConfirm(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !busy) void rotate();
                }}
              />
            </label>

            {error && (
              <p className="m-0 text-[10px] text-danger">{error}</p>
            )}
            {done && (
              <p className="m-0 text-[10px] text-green">{done}</p>
            )}

            <button
              type="button"
              className="cursor-pointer self-start rounded-[5px] border border-accent/45 bg-accent-soft px-3 py-1.5 text-[11px] font-semibold text-accent-bright hover:border-accent hover:text-white disabled:opacity-40"
              disabled={busy}
              onClick={() => void rotate()}
            >
              {busy ? "Re-encrypting…" : "Change password"}
            </button>
          </div>
        </div>

        <footer className="flex items-center justify-between border-t border-border px-3.5 py-2.5">
          <button
            type="button"
            className="flex cursor-pointer items-center gap-1.5 rounded-[5px] border border-border bg-transparent px-3 py-1.5 text-[11px] text-muted hover:border-border-bright hover:text-text disabled:opacity-40"
            disabled={!unlocked || busy}
            title={unlocked ? "Lock the vault now" : "Vault is already locked"}
            onClick={() => {
              lockVault();
              onClose();
            }}
          >
            <Lock size={12} />
            Lock now
          </button>
          <button
            type="button"
            className="cursor-pointer rounded-[5px] border border-border bg-transparent px-3 py-1.5 text-[11px] text-muted hover:border-border-bright hover:text-text"
            onClick={onClose}
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
