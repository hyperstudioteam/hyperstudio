import { FormEvent, useEffect, useMemo, useState } from "react";
import { CloudSync, X } from "lucide-react";
import {
  clearGithubAccessToken,
  isGithubSignedIn,
  listGithubRepos,
  startDeviceFlow,
  type DeviceCodeResponse,
  type GithubRepoOption,
} from "../../lib/githubAuth";
import {
  DEFAULT_SYNC_PATH,
  GithubSyncSettings,
  loadGithubSyncSettings,
  resolveGithubClientId,
  saveGithubSyncSettings,
} from "../../lib/githubSyncSettings";
import { errorMessage } from "../../lib/format";
import { GithubDeviceFlowModal } from "./GithubDeviceFlowModal";

interface GithubSyncSettingsModalProps {
  onClose: () => void;
  onSettingsChanged?: (settings: GithubSyncSettings) => void;
}

const formLabelClass =
  "flex flex-col gap-[5px] text-muted text-[10px] font-[540]";
const formInputClass =
  "w-full h-[34px] px-[9px] border border-border-bright rounded-[5px] text-text bg-surface-input text-[11px] focus:border-accent placeholder:text-subtle";

export function GithubSyncSettingsModal({
  onClose,
  onSettingsChanged,
}: GithubSyncSettingsModalProps) {
  const [settings, setSettings] = useState(() => loadGithubSyncSettings());
  const [signedIn, setSignedIn] = useState(false);
  const [repos, setRepos] = useState<GithubRepoOption[]>([]);
  const [selectedFullName, setSelectedFullName] = useState("");
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [device, setDevice] = useState<DeviceCodeResponse | null>(null);

  const filteredRepos = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter((repo) => repo.fullName.toLowerCase().includes(q));
  }, [filter, repos]);

  async function loadRepos(preferredFullName?: string) {
    setLoadingRepos(true);
    setError("");
    try {
      const list = await listGithubRepos();
      setRepos(list);
      const preferred =
        preferredFullName ||
        (settings.owner && settings.repo
          ? `${settings.owner}/${settings.repo}`
          : "");
      if (preferred && list.some((repo) => repo.fullName === preferred)) {
        setSelectedFullName(preferred);
      } else if (list.length === 1) {
        setSelectedFullName(list[0].fullName);
      }
    } catch (err) {
      setRepos([]);
      setError(errorMessage(err));
      const stillSignedIn = await isGithubSignedIn();
      setSignedIn(stillSignedIn);
      if (!stillSignedIn) {
        setSelectedFullName("");
      }
    } finally {
      setLoadingRepos(false);
    }
  }

  useEffect(() => {
    void isGithubSignedIn().then((ok) => {
      setSignedIn(ok);
      if (ok) void loadRepos();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleDone(event: FormEvent) {
    event.preventDefault();
    const selected = repos.find((repo) => repo.fullName === selectedFullName);
    if (!selected) {
      setError("Select a repository.");
      return;
    }

    const repoChanged =
      settings.owner !== selected.owner || settings.repo !== selected.name;
    const next: GithubSyncSettings = {
      ...settings,
      owner: selected.owner,
      repo: selected.name,
      path: DEFAULT_SYNC_PATH,
      branch: selected.defaultBranch,
      lastSha: repoChanged ? null : settings.lastSha,
    };
    saveGithubSyncSettings(next);
    setSettings(next);
    onSettingsChanged?.(next);
    onClose();
  }

  async function handleConnect() {
    setBusy(true);
    setError("");
    try {
      const clientId = resolveGithubClientId();
      const next = await startDeviceFlow(clientId);
      setDevice(next);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    setError("");
    try {
      await clearGithubAccessToken();
      setSignedIn(false);
      setRepos([]);
      setSelectedFullName("");
      setFilter("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-20 grid place-items-center p-5 bg-black/70 backdrop-blur-[4px]"
        onMouseDown={(event) =>
          event.target === event.currentTarget && onClose()
        }
      >
        <form
          className="w-[min(440px,100%)] max-h-full overflow-auto p-[18px] border border-border-bright rounded-[10px] bg-surface shadow-[0_24px_70px_rgba(0,0,0,.48)]"
          onSubmit={handleDone}
        >
          <div className="flex items-center justify-between mb-[17px]">
            <div className="flex items-center gap-2.5">
              <span className="w-7 h-7 shrink-0 rounded-md grid place-items-center text-accent bg-accent-soft">
                <CloudSync size={17} />
              </span>
              <h2 className="m-0 text-text-bright text-sm font-[630]">
                GitHub sync
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
            Connect GitHub, pick a repository, and sync. Vault passwords sync as
            ciphertext; raw and keychain secrets stay local.
          </p>

          {!signedIn ? (
            <div className="mb-3.5 rounded-[7px] border border-border bg-panel-soft px-3 py-4 flex flex-col items-center gap-2.5">
              <p className="m-0 text-[11px] text-muted text-center">
                Sign in to choose a repository.
              </p>
              <button
                type="button"
                disabled={busy}
                className="h-[32px] px-3 border-0 rounded-[5px] text-[11px] font-semibold cursor-pointer text-white bg-accent hover:brightness-110 disabled:opacity-40"
                onClick={() => void handleConnect()}
              >
                Connect with GitHub
              </button>
            </div>
          ) : (
            <div className="mb-3.5 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted">
                  Signed in to GitHub
                </span>
                <button
                  type="button"
                  disabled={busy}
                  className="h-[28px] px-2.5 border border-border-bright rounded-[5px] text-[10px] font-semibold cursor-pointer text-text bg-transparent hover:text-text hover:bg-panel-soft disabled:opacity-40"
                  onClick={() => void handleDisconnect()}
                >
                  Sign out
                </button>
              </div>

              <label className={formLabelClass}>
                Filter repositories
                <input
                  className={formInputClass}
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="Search owner/name"
                  disabled={loadingRepos || repos.length === 0}
                />
              </label>

              <label className={formLabelClass}>
                Repository
                <select
                  className={formInputClass}
                  required
                  value={selectedFullName}
                  disabled={loadingRepos || filteredRepos.length === 0}
                  onChange={(event) => setSelectedFullName(event.target.value)}
                >
                  <option value="">
                    {loadingRepos
                      ? "Loading repositories…"
                      : filteredRepos.length === 0
                        ? "No repositories found"
                        : "Select a repository"}
                  </option>
                  {filteredRepos.map((repo) => (
                    <option key={repo.fullName} value={repo.fullName}>
                      {repo.fullName}
                      {repo.private ? " (private)" : ""}
                    </option>
                  ))}
                </select>
              </label>

              {selectedFullName && (
                <p className="m-0 text-[11px] text-muted">
                  Syncs to{" "}
                  <code className="text-text">{DEFAULT_SYNC_PATH}</code> on
                  the default branch.
                </p>
              )}
            </div>
          )}

          {error && (
            <div className="mb-3 px-2.5 py-2 rounded-[5px] text-[10px] [overflow-wrap:anywhere] text-danger bg-red/10">
              {error}
            </div>
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
              disabled={!signedIn || !selectedFullName || loadingRepos}
              className="h-[32px] px-3 border-0 rounded-[5px] text-white bg-accent text-[11px] font-[600] cursor-pointer hover:brightness-110 disabled:opacity-40 disabled:cursor-default"
            >
              Done
            </button>
          </div>
        </form>
      </div>

      {device && (
        <GithubDeviceFlowModal
          clientId={resolveGithubClientId()}
          device={device}
          onAuthorized={() => {
            setDevice(null);
            setSignedIn(true);
            void loadRepos();
          }}
          onClose={() => setDevice(null)}
        />
      )}
    </>
  );
}
