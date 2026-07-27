import {
  buildSyncDocument,
  ConnectionSyncDocument,
  parseSyncDocument,
  ParsedSyncDocument,
  serializeSyncDocument,
} from "./connectionSyncDocument";
import { getGithubAccessToken } from "./githubAuth";
import { githubHttp, parseGithubJsonBody } from "./githubHttp";
import {
  GithubSyncSettings,
  saveGithubSyncSettings,
  settingsReady,
} from "./githubSyncSettings";
import { collectConnections } from "./tree";
import { TreeNode } from "../types/connection";

export class GithubSyncConflictError extends Error {
  constructor(message = "Remote changed — pull first, then push again.") {
    super(message);
    this.name = "GithubSyncConflictError";
  }
}

export class GithubAuthRequiredError extends Error {
  constructor(message = "Sign in to GitHub to sync connections.") {
    super(message);
    this.name = "GithubAuthRequiredError";
  }
}

interface GithubContentFile {
  type: string;
  encoding?: string;
  content?: string;
  sha: string;
  path: string;
}

function apiBase(settings: GithubSyncSettings): string {
  const owner = encodeURIComponent(settings.owner.trim());
  const repo = encodeURIComponent(settings.repo.trim());
  const path = settings.path
    .trim()
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  return `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getGithubAccessToken();
  if (!token) throw new GithubAuthRequiredError();
  return {
    Accept: "application/vnd.github+json",
    Authorization: `token ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function decodeBase64Content(content: string): string {
  const normalized = content.replace(/\n/g, "");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function encodeBase64Content(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function readGithubError(status: number, body: string): string {
  const data = parseGithubJsonBody(body);
  if (typeof data.message === "string" && data.message) {
    return data.message;
  }
  return `GitHub request failed (${status}).`;
}

export interface PullResult {
  document: ParsedSyncDocument;
  sha: string;
  raw: string;
}

export async function pullConnectionsFromGithub(
  settings: GithubSyncSettings,
): Promise<PullResult> {
  if (!settingsReady(settings)) {
    throw new Error("Configure a repository in Sync Settings first.");
  }

  const headers = await authHeaders();
  const url = `${apiBase(settings)}?ref=${encodeURIComponent(settings.branch.trim())}`;
  const response = await githubHttp("GET", url, headers);

  if (response.status === 404) {
    throw new Error(
      `No sync file at ${settings.path} on ${settings.branch}. Push first to create it.`,
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new GithubAuthRequiredError(
      "GitHub rejected the token. Sign in again from Sync Settings.",
    );
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(readGithubError(response.status, response.body));
  }

  const file = JSON.parse(response.body) as GithubContentFile;
  if (file.type !== "file" || typeof file.content !== "string") {
    throw new Error("GitHub path does not point to a file.");
  }

  const raw = decodeBase64Content(file.content);
  const document = parseSyncDocument(raw);
  return { document, sha: file.sha, raw };
}

export interface PushResult {
  sha: string;
  connectionCount: number;
  vaultAttached: boolean;
}

export async function pushConnectionsToGithub(
  settings: GithubSyncSettings,
  nodes: TreeNode[],
): Promise<PushResult> {
  if (!settingsReady(settings)) {
    throw new Error("Configure a repository in Sync Settings first.");
  }

  const syncDoc: ConnectionSyncDocument = buildSyncDocument(nodes);
  const bodyText = serializeSyncDocument(syncDoc);
  const headers = {
    ...(await authHeaders()),
    "Content-Type": "application/json",
  };

  let sha = settings.lastSha;
  if (!sha) {
    const probe = await githubHttp(
      "GET",
      `${apiBase(settings)}?ref=${encodeURIComponent(settings.branch.trim())}`,
      await authHeaders(),
    );
    if (probe.status >= 200 && probe.status < 300) {
      const existing = JSON.parse(probe.body) as GithubContentFile;
      sha = existing.sha;
    } else if (probe.status !== 404) {
      if (probe.status === 401 || probe.status === 403) {
        throw new GithubAuthRequiredError(
          "GitHub rejected the token. Sign in again from Sync Settings.",
        );
      }
      throw new Error(readGithubError(probe.status, probe.body));
    }
  }

  const payload: Record<string, string> = {
    message: "HyperStudio: sync connections",
    content: encodeBase64Content(bodyText),
    branch: settings.branch.trim(),
  };
  if (sha) payload.sha = sha;

  const response = await githubHttp(
    "PUT",
    apiBase(settings),
    headers,
    JSON.stringify(payload),
  );

  if (response.status === 409 || response.status === 422) {
    const message = readGithubError(response.status, response.body);
    if (
      response.status === 409 ||
      /sha|conflict|does not match/i.test(message)
    ) {
      throw new GithubSyncConflictError();
    }
    throw new Error(message);
  }
  if (response.status === 401 || response.status === 403) {
    throw new GithubAuthRequiredError(
      "GitHub rejected the token. Sign in again from Sync Settings.",
    );
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(readGithubError(response.status, response.body));
  }

  const result = JSON.parse(response.body) as {
    content?: { sha?: string };
  };
  const nextSha = result.content?.sha;
  if (!nextSha) {
    throw new Error("GitHub did not return a content sha after push.");
  }

  saveGithubSyncSettings({
    ...settings,
    lastSha: nextSha,
    lastSyncedAt: new Date().toISOString(),
  });

  return {
    sha: nextSha,
    connectionCount: collectConnections(syncDoc.tree).length,
    vaultAttached: Boolean(syncDoc.vault),
  };
}

export function rememberPulledSha(
  settings: GithubSyncSettings,
  sha: string,
): GithubSyncSettings {
  const next = {
    ...settings,
    lastSha: sha,
    lastSyncedAt: new Date().toISOString(),
  };
  saveGithubSyncSettings(next);
  return next;
}
