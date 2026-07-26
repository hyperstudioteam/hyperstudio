import { ConnectionProfile } from "../types/connection";
import { getKeychainSecret } from "./keychain";
import {
  getVaultSecret,
  isVaultUnlocked,
  vaultExists,
} from "./vault";

export class VaultLockedError extends Error {
  constructor() {
    super("Unlock the password vault to continue.");
    this.name = "VaultLockedError";
  }
}

export class VaultMissingError extends Error {
  constructor() {
    super("Create a password vault to store encrypted passwords.");
    this.name = "VaultMissingError";
  }
}

/** Resolve the DB password for connect/query, consulting vault when needed. */
export function resolvePassword(profile: ConnectionProfile): string {
  if (profile.passwordStorage === "vault") {
    if (!vaultExists()) throw new VaultMissingError();
    if (!isVaultUnlocked()) throw new VaultLockedError();
    const fromVault = getVaultSecret(profile.id);
    if (fromVault != null && fromVault !== "") return fromVault;
    if (profile.password) return profile.password;
    throw new Error(
      "No password found in vault for this connection. Open settings and save it again.",
    );
  }

  if (profile.password) return profile.password;

  throw new Error(
    "Password is required. Open connection settings, enter the password, then try again.",
  );
}

/**
 * Same as `resolvePassword`, but able to reach the OS credential store, which
 * is only readable across the async command bridge.
 */
export async function resolvePasswordAsync(
  profile: ConnectionProfile,
): Promise<string> {
  if (profile.passwordStorage !== "keychain") {
    return resolvePassword(profile);
  }
  const stored = await getKeychainSecret(profile.id);
  if (stored) return stored;
  if (profile.password) return profile.password;
  throw new Error(
    "No password found in the OS credential store for this connection. Open settings and save it again.",
  );
}

export async function withResolvedPassword(
  profile: ConnectionProfile,
): Promise<ConnectionProfile> {
  return { ...profile, password: await resolvePasswordAsync(profile) };
}
