import { invoke } from "@tauri-apps/api/core";

export interface GithubHttpResult {
  status: number;
  body: string;
}

/** Proxied GitHub HTTP via Rust — avoids WKWebView CORS failures. */
export async function githubHttp(
  method: string,
  url: string,
  headers?: Record<string, string>,
  body?: string,
): Promise<GithubHttpResult> {
  return invoke<GithubHttpResult>("github_http", {
    request: {
      method,
      url,
      headers: headers ?? null,
      body: body ?? null,
    },
  });
}

export function parseGithubJsonBody(body: string): Record<string, unknown> {
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    const params = new URLSearchParams(body);
    const obj: Record<string, unknown> = {};
    for (const [key, value] of params.entries()) obj[key] = value;
    return obj;
  }
}
