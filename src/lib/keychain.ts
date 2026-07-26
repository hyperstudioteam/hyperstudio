import { invoke } from "@tauri-apps/api/core";

/**
 * Connection passwords held by the OS credential store (macOS Keychain,
 * Windows Credential Manager, or Secret Service on Linux).
 *
 * Secrets are read on demand and cached only for the current session, so a
 * locked or missing store surfaces as a plain error at connect time rather
 * than silently falling back to something less safe.
 */

let availability: Promise<boolean> | null = null;
const cache = new Map<string, string>();

/** Cached across the session; the store does not appear or vanish at runtime. */
export function keychainAvailable(): Promise<boolean> {
  availability ??= invoke<boolean>("keychain_available").catch(() => false);
  return availability;
}

export async function setKeychainSecret(
  connectionId: string,
  password: string,
): Promise<void> {
  await invoke<void>("keychain_set", { connectionId, password });
  cache.set(connectionId, password);
}

export async function getKeychainSecret(
  connectionId: string,
): Promise<string | null> {
  const cached = cache.get(connectionId);
  if (cached != null) return cached;
  const stored = await invoke<string | null>("keychain_get", { connectionId });
  if (stored != null) cache.set(connectionId, stored);
  return stored;
}

export async function removeKeychainSecret(
  connectionId: string,
): Promise<void> {
  cache.delete(connectionId);
  await invoke<void>("keychain_delete", { connectionId });
}

/** Drop cached secrets, e.g. when a profile is deleted. */
export function forgetKeychainSecret(connectionId: string): void {
  cache.delete(connectionId);
}
