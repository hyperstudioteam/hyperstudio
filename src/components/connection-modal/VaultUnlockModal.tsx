import { FormEvent, useState } from "react";
import { LockKeyhole, X } from "lucide-react";
import { unlockVault, applyPendingVaultRemovals } from "../../lib/vault";
import { errorMessage } from "../../lib/format";

interface VaultUnlockModalProps {
  title?: string;
  onUnlocked: () => void;
  onClose: () => void;
}

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
      className="modal-backdrop nested"
      onMouseDown={(event) =>
        event.target === event.currentTarget && onClose()
      }
    >
      <form className="connection-modal vault-modal" onSubmit={handleSubmit}>
        <div className="modal-heading">
          <div>
            <span className="db-icon postgres">
              <LockKeyhole size={17} />
            </span>
            <h2>{title}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>

        <p className="vault-copy">
          Enter your master password to decrypt saved connection passwords.
        </p>

        <div className="form-grid">
          <label className="full">
            Master password
            <input
              type="password"
              required
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
        </div>

        {error && <div className="test-status">{error}</div>}

        <div className="modal-actions">
          <span />
          <div>
            <button type="button" className="ghost-button" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="primary-button"
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
