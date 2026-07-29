import { FormEvent, useState } from "react";
import { CloudDownload, X } from "lucide-react";
import { VaultApplyChoice } from "../../lib/connectionSyncDocument";

interface GithubPullConfirmModalProps {
  connectionCount: number;
  vaultConnectionCount: number;
  hasRemoteVault: boolean;
  vaultConflict: boolean;
  onConfirm: (vaultChoice: VaultApplyChoice) => void;
  onClose: () => void;
}

const formLabelClass =
  "flex flex-col gap-[5px] text-muted text-[10px] font-[540]";

export function GithubPullConfirmModal({
  connectionCount,
  vaultConnectionCount,
  hasRemoteVault,
  vaultConflict,
  onConfirm,
  onClose,
}: GithubPullConfirmModalProps) {
  const [vaultChoice, setVaultChoice] = useState<VaultApplyChoice>(
    vaultConflict ? "skip" : "replace",
  );

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onConfirm(vaultConflict ? vaultChoice : "replace");
  }

  return (
    <div
      className="fixed inset-0 z-20 grid place-items-center p-5 bg-black/70 backdrop-blur-[4px]"
      onMouseDown={(event) =>
        event.target === event.currentTarget && onClose()
      }
    >
      <form
        className="w-[min(460px,100%)] max-h-full overflow-auto p-[18px] border border-border-bright rounded-[10px] bg-surface shadow-[0_24px_70px_rgba(0,0,0,.48)]"
        onSubmit={handleSubmit}
      >
        <div className="flex items-center justify-between mb-[17px]">
          <div className="flex items-center gap-2.5">
            <span className="w-7 h-7 shrink-0 rounded-md grid place-items-center text-accent bg-accent-soft">
              <CloudDownload size={17} />
            </span>
            <h2 className="m-0 text-text-bright text-sm font-[630]">
              Pull from GitHub
            </h2>
          </div>
          <button
            type="button"
            className="w-7 h-7 grid place-items-center p-0 border-0 rounded-[5px] text-muted bg-transparent cursor-pointer enabled:hover:text-text enabled:hover:bg-panel-soft"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>

        <p className="m-0 mb-3.5 text-[12px] leading-[1.45] text-muted">
          Replace your local connection tree with {connectionCount} connection
          {connectionCount === 1 ? "" : "s"} from the repository
          {vaultConnectionCount > 0
            ? ` (${vaultConnectionCount} vault-backed)`
            : ""}
          . This cannot be undone.
        </p>

        {hasRemoteVault && !vaultConflict && (
          <p className="m-0 mb-3.5 text-[11px] leading-[1.45] text-muted">
            Remote vault ciphertext will be imported. Unlock with your shared
            master password afterward.
          </p>
        )}

        {vaultConflict && (
          <fieldset className={`${formLabelClass} mb-4 border-0 p-0 m-0`}>
            <legend className="px-0 mb-[7px] text-muted text-[10px] font-[540]">
              Vault conflict
            </legend>
            <p className="m-0 mb-2.5 text-[11px] leading-[1.45] text-muted">
              The remote vault uses a different salt than your local vault.
            </p>
            <label className="flex items-start gap-2 mb-2 text-[12px] text-text cursor-pointer">
              <input
                type="radio"
                className="mt-[3px]"
                name="vault-choice"
                checked={vaultChoice === "replace"}
                onChange={() => setVaultChoice("replace")}
              />
              <span>
                <strong className="font-[600] text-text-bright">
                  Replace local vault
                </strong>
                <span className="block text-muted text-[11px] mt-0.5">
                  Overwrite local vault ciphertext with the remote one.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-[12px] text-text cursor-pointer">
              <input
                type="radio"
                className="mt-[3px]"
                name="vault-choice"
                checked={vaultChoice === "skip"}
                onChange={() => setVaultChoice("skip")}
              />
              <span>
                <strong className="font-[600] text-text-bright">
                  Keep local vault
                </strong>
                <span className="block text-muted text-[11px] mt-0.5">
                  Skip remote secrets and demote vault connections to unsaved
                  passwords.
                </span>
              </span>
            </label>
          </fieldset>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="h-[32px] px-3 border border-border-bright rounded-[5px] text-text bg-transparent text-[11px] cursor-pointer hover:text-text hover:bg-panel-soft"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="h-[32px] px-3 border-0 rounded-[5px] text-white bg-accent text-[11px] font-[600] cursor-pointer hover:brightness-110"
          >
            Pull and replace
          </button>
        </div>
      </form>
    </div>
  );
}
