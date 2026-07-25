import { FormEvent, useState } from "react";
import { Lock, X } from "lucide-react";
import { createVault } from "../../lib/vault";
import { errorMessage } from "../../lib/format";

interface VaultCreateModalProps {
  onCreated: () => void;
  onClose: () => void;
}

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
      className="modal-backdrop nested"
      onMouseDown={(event) =>
        event.target === event.currentTarget && onClose()
      }
    >
      <form className="connection-modal vault-modal" onSubmit={handleSubmit}>
        <div className="modal-heading">
          <div>
            <span className="db-icon postgres">
              <Lock size={17} />
            </span>
            <h2>Create password vault</h2>
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
          Connection passwords stored in the vault are encrypted with your
          master password. The master password is never saved.
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
          <label className="full">
            Confirm master password
            <input
              type="password"
              required
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
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
              Create vault
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
