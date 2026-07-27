import { openUrl } from "@tauri-apps/plugin-opener";
import {
  getKeychainSecret,
  keychainAvailable,
  removeKeychainSecret,
  setKeychainSecret,
} from "./keychain";
import { githubHttp, parseGithubJsonBody } from "./githubHttp";

const TOKEN_KEYCHAIN_ID = "__github_oauth_token__";
const TOKEN_STORAGE_KEY = "hyperstudio.github-token.v1";
const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const SCOPE = "repo";

export interface DeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export type DeviceFlowStatus =
  | { state: "pending" }
  | { state: "slow_down"; interval: number }
  | { state: "authorized"; token: string }
  | { state: "denied" }
  | { state: "expired" }
  | { state: "error"; message: string };

async function storeToken(token: string): Promise<void> {
  if (await keychainAvailable()) {
    await setKeychainSecret(TOKEN_KEYCHAIN_ID, token);
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    return;
  }
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

async function readToken(): Promise<string | null> {
  if (await keychainAvailable()) {
    const fromKeychain = await getKeychainSecret(TOKEN_KEYCHAIN_ID);
    if (fromKeychain) return fromKeychain;
  }
  const fromStorage = localStorage.getItem(TOKEN_STORAGE_KEY);
  return fromStorage && fromStorage.trim() ? fromStorage : null;
}

export async function getGithubAccessToken(): Promise<string | null> {
  return readToken();
}

export async function clearGithubAccessToken(): Promise<void> {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  if (await keychainAvailable()) {
    await removeKeychainSecret(TOKEN_KEYCHAIN_ID).catch(() => undefined);
  }
}

export async function isGithubSignedIn(): Promise<boolean> {
  return Boolean(await readToken());
}

export async function startDeviceFlow(
  clientId: string,
): Promise<DeviceCodeResponse> {
  if (!clientId.trim()) {
    throw new Error(
      "GitHub OAuth client ID is not configured. Set VITE_GITHUB_CLIENT_ID.",
    );
  }

  const response = await githubHttp(
    "POST",
    DEVICE_CODE_URL,
    {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    JSON.stringify({ client_id: clientId.trim(), scope: SCOPE }),
  );

  const data = parseGithubJsonBody(response.body);
  if (response.status < 200 || response.status >= 300) {
    const message =
      typeof data.error_description === "string"
        ? data.error_description
        : typeof data.message === "string"
          ? data.message
          : `Device code request failed (${response.status}).`;
    throw new Error(message);
  }

  const deviceCode = data.device_code;
  const userCode = data.user_code;
  const verificationUri =
    (typeof data.verification_uri === "string" && data.verification_uri) ||
    "https://github.com/login/device";
  const expiresIn = Number(data.expires_in);
  const interval = Number(data.interval);

  if (typeof deviceCode !== "string" || typeof userCode !== "string") {
    throw new Error("GitHub device code response was incomplete.");
  }

  return {
    deviceCode,
    userCode,
    verificationUri,
    expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 900,
    interval: Number.isFinite(interval) && interval > 0 ? interval : 5,
  };
}

export async function openDeviceVerification(uri: string): Promise<void> {
  await openUrl(uri);
}

/**
 * Single poll step. Call repeatedly until authorized / denied / expired.
 * Returns an updated interval when GitHub asks to slow down.
 */
export async function pollDeviceFlowOnce(
  clientId: string,
  deviceCode: string,
  intervalSeconds: number,
): Promise<DeviceFlowStatus> {
  const response = await githubHttp(
    "POST",
    ACCESS_TOKEN_URL,
    {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    JSON.stringify({
      client_id: clientId.trim(),
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  );

  const data = parseGithubJsonBody(response.body);
  const error = typeof data.error === "string" ? data.error : null;

  if (error === "authorization_pending") {
    return { state: "pending" };
  }
  if (error === "slow_down") {
    return { state: "slow_down", interval: intervalSeconds + 5 };
  }
  if (error === "access_denied") {
    return { state: "denied" };
  }
  if (error === "expired_token") {
    return { state: "expired" };
  }
  if (error) {
    const message =
      typeof data.error_description === "string"
        ? data.error_description
        : error;
    return { state: "error", message };
  }

  const token = data.access_token;
  if (typeof token !== "string" || !token) {
    return { state: "error", message: "GitHub did not return an access token." };
  }

  await storeToken(token);
  return { state: "authorized", token };
}

export async function waitForDeviceAuthorization(
  clientId: string,
  device: DeviceCodeResponse,
  signal?: AbortSignal,
): Promise<string> {
  let interval = device.interval;
  const deadline = Date.now() + device.expiresIn * 1000;

  while (Date.now() < deadline) {
    if (signal?.aborted) {
      throw new DOMException("Device authorization cancelled.", "AbortError");
    }

    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(resolve, interval * 1000);
      const onAbort = () => {
        window.clearTimeout(timer);
        reject(new DOMException("Device authorization cancelled.", "AbortError"));
      };
      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });

    if (signal?.aborted) {
      throw new DOMException("Device authorization cancelled.", "AbortError");
    }

    const status = await pollDeviceFlowOnce(
      clientId,
      device.deviceCode,
      interval,
    );

    if (status.state === "authorized") return status.token;
    if (status.state === "slow_down") {
      interval = status.interval;
      continue;
    }
    if (status.state === "pending") continue;
    if (status.state === "denied") {
      throw new Error("GitHub authorization was denied.");
    }
    if (status.state === "expired") {
      throw new Error("GitHub device code expired. Start again.");
    }
    throw new Error(status.message);
  }

  throw new Error("GitHub device code expired. Start again.");
}

export interface GithubRepoOption {
  fullName: string;
  owner: string;
  name: string;
  defaultBranch: string;
  private: boolean;
}

async function authApiHeaders(): Promise<Record<string, string>> {
  const token = await readToken();
  if (!token) {
    throw new Error("Sign in to GitHub first.");
  }
  return {
    Accept: "application/vnd.github+json",
    // OAuth user-to-server tokens use the classic `token` scheme.
    Authorization: `token ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function githubApiErrorMessage(status: number, body: string): string {
  const data = parseGithubJsonBody(body);
  const detail =
    typeof data.message === "string" && data.message
      ? data.message
      : typeof data.error_description === "string"
        ? data.error_description
        : "";
  if (status === 401 || status === 403) {
    return detail
      ? `GitHub rejected the token (${status}): ${detail}`
      : `GitHub rejected the token (${status}). Sign out and connect again.`;
  }
  return detail || `GitHub request failed (${status}).`;
}

/** Repos the signed-in user can write to, newest activity first. */
export async function listGithubRepos(): Promise<GithubRepoOption[]> {
  const headers = await authApiHeaders();

  // Cheap auth probe so failures are obvious before paging repos.
  const whoami = await githubHttp("GET", "https://api.github.com/user", headers);
  if (whoami.status === 401 || whoami.status === 403) {
    await clearGithubAccessToken();
    throw new Error(githubApiErrorMessage(whoami.status, whoami.body));
  }
  if (whoami.status < 200 || whoami.status >= 300) {
    throw new Error(githubApiErrorMessage(whoami.status, whoami.body));
  }

  const repos: GithubRepoOption[] = [];
  let page = 1;

  while (page <= 5) {
    const url =
      `https://api.github.com/user/repos?per_page=100&page=${page}` +
      `&sort=updated&direction=desc&affiliation=owner,organization_member`;
    const response = await githubHttp("GET", url, headers);
    if (response.status === 401 || response.status === 403) {
      await clearGithubAccessToken();
      throw new Error(githubApiErrorMessage(response.status, response.body));
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(githubApiErrorMessage(response.status, response.body));
    }

    let batch: Array<{
      full_name?: string;
      name?: string;
      private?: boolean;
      default_branch?: string;
      permissions?: { push?: boolean; admin?: boolean };
      owner?: { login?: string };
    }>;
    try {
      batch = JSON.parse(response.body) as typeof batch;
    } catch {
      throw new Error("GitHub returned an invalid repository list.");
    }

    if (!Array.isArray(batch) || batch.length === 0) break;

    for (const item of batch) {
      // permissions may be omitted for some tokens; keep those repos.
      const perms = item.permissions;
      if (perms && !perms.push && !perms.admin) continue;
      const owner = item.owner?.login;
      const name = item.name;
      const fullName = item.full_name;
      if (!owner || !name || !fullName) continue;
      repos.push({
        fullName,
        owner,
        name,
        defaultBranch:
          typeof item.default_branch === "string" && item.default_branch
            ? item.default_branch
            : "main",
        private: Boolean(item.private),
      });
    }

    if (batch.length < 100) break;
    page += 1;
  }

  return repos;
}
