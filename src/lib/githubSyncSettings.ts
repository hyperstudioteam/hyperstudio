const SETTINGS_KEY = "hyperstudio.github-sync.v1";

export const DEFAULT_SYNC_PATH = "hyperstudio.connections.json";
export const DEFAULT_SYNC_BRANCH = "main";

export interface GithubSyncSettings {
  owner: string;
  repo: string;
  path: string;
  branch: string;
  /** Optional override; falls back to VITE_GITHUB_CLIENT_ID. */
  clientId: string;
  lastSha: string | null;
  lastSyncedAt: string | null;
}

export function defaultGithubSyncSettings(): GithubSyncSettings {
  return {
    owner: "",
    repo: "",
    path: DEFAULT_SYNC_PATH,
    branch: DEFAULT_SYNC_BRANCH,
    clientId: "",
    lastSha: null,
    lastSyncedAt: null,
  };
}

export function loadGithubSyncSettings(): GithubSyncSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultGithubSyncSettings();
    const parsed = JSON.parse(raw) as Partial<GithubSyncSettings>;
    const defaults = defaultGithubSyncSettings();
    return {
      owner: typeof parsed.owner === "string" ? parsed.owner : defaults.owner,
      repo: typeof parsed.repo === "string" ? parsed.repo : defaults.repo,
      path:
        typeof parsed.path === "string" && parsed.path.trim()
          ? parsed.path.trim()
          : defaults.path,
      branch:
        typeof parsed.branch === "string" && parsed.branch.trim()
          ? parsed.branch.trim()
          : defaults.branch,
      clientId:
        typeof parsed.clientId === "string" ? parsed.clientId : defaults.clientId,
      lastSha: typeof parsed.lastSha === "string" ? parsed.lastSha : null,
      lastSyncedAt:
        typeof parsed.lastSyncedAt === "string" ? parsed.lastSyncedAt : null,
    };
  } catch {
    return defaultGithubSyncSettings();
  }
}

export function saveGithubSyncSettings(settings: GithubSyncSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function resolveGithubClientId(
  settings?: Pick<GithubSyncSettings, "clientId"> | null,
): string {
  const override = settings?.clientId?.trim();
  if (override) return override;
  return (import.meta.env.VITE_GITHUB_CLIENT_ID as string | undefined)?.trim() || "";
}

export function settingsReady(settings: GithubSyncSettings): boolean {
  return Boolean(
    settings.owner.trim() &&
      settings.repo.trim() &&
      settings.path.trim() &&
      settings.branch.trim(),
  );
}
