const VAULT_KEY = "hyperstudio.vault.v1";
const VERIFIER_PLAINTEXT = "hyperstudio-vault-ok";
const PBKDF2_ITERATIONS = 310_000;

interface StoredVault {
  version: 1;
  salt: string;
  iterations: number;
  verifierIv: string;
  verifierCipher: string;
  secretsIv: string;
  secretsCipher: string;
}

type SecretsMap = Record<string, string>;

let sessionKey: CryptoKey | null = null;
let sessionSecrets: SecretsMap = {};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function readStored(): StoredVault | null {
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredVault;
    if (parsed?.version !== 1 || !parsed.salt) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStored(vault: StoredVault) {
  localStorage.setItem(VAULT_KEY, JSON.stringify(vault));
}

async function deriveKey(
  masterPassword: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(masterPassword),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encrypt(
  key: CryptoKey,
  plaintext: string,
): Promise<{ iv: string; cipher: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return {
    iv: bytesToBase64(iv),
    cipher: bytesToBase64(new Uint8Array(cipherBuf)),
  };
}

async function decrypt(
  key: CryptoKey,
  iv: string,
  cipher: string,
): Promise<string> {
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv) },
    key,
    base64ToBytes(cipher),
  );
  return new TextDecoder().decode(plainBuf);
}

async function persistSecrets(key: CryptoKey, secrets: SecretsMap) {
  const stored = readStored();
  if (!stored) throw new Error("Vault does not exist.");
  const sealed = await encrypt(key, JSON.stringify(secrets));
  writeStored({
    ...stored,
    secretsIv: sealed.iv,
    secretsCipher: sealed.cipher,
  });
}

export function vaultExists(): boolean {
  return readStored() !== null;
}

export function isVaultUnlocked(): boolean {
  return sessionKey !== null;
}

export function lockVault() {
  sessionKey = null;
  sessionSecrets = {};
}

export async function createVault(masterPassword: string): Promise<void> {
  if (!masterPassword.trim()) {
    throw new Error("Master password is required.");
  }
  if (vaultExists()) {
    throw new Error("A vault already exists.");
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(masterPassword, salt, PBKDF2_ITERATIONS);
  const verifier = await encrypt(key, VERIFIER_PLAINTEXT);
  const secrets = await encrypt(key, JSON.stringify({}));

  writeStored({
    version: 1,
    salt: bytesToBase64(salt),
    iterations: PBKDF2_ITERATIONS,
    verifierIv: verifier.iv,
    verifierCipher: verifier.cipher,
    secretsIv: secrets.iv,
    secretsCipher: secrets.cipher,
  });

  sessionKey = key;
  sessionSecrets = {};
}

export async function unlockVault(masterPassword: string): Promise<void> {
  const stored = readStored();
  if (!stored) throw new Error("No vault found. Create one first.");

  const key = await deriveKey(
    masterPassword,
    base64ToBytes(stored.salt),
    stored.iterations || PBKDF2_ITERATIONS,
  );

  try {
    const verified = await decrypt(
      key,
      stored.verifierIv,
      stored.verifierCipher,
    );
    if (verified !== VERIFIER_PLAINTEXT) {
      throw new Error("Invalid master password.");
    }
    const secretsJson = await decrypt(
      key,
      stored.secretsIv,
      stored.secretsCipher,
    );
    const secrets = JSON.parse(secretsJson) as SecretsMap;
    sessionKey = key;
    sessionSecrets = secrets && typeof secrets === "object" ? secrets : {};
  } catch {
    throw new Error("Invalid master password.");
  }
}

export function getVaultSecret(connectionId: string): string | null {
  if (!sessionKey) return null;
  return sessionSecrets[connectionId] ?? null;
}

export async function setVaultSecret(
  connectionId: string,
  password: string,
): Promise<void> {
  if (!sessionKey) throw new Error("Vault is locked.");
  sessionSecrets = { ...sessionSecrets, [connectionId]: password };
  await persistSecrets(sessionKey, sessionSecrets);
}

export async function removeVaultSecret(connectionId: string): Promise<void> {
  if (!sessionKey) {
    // Defer removal until unlock if vault exists but is locked.
    return;
  }
  if (!(connectionId in sessionSecrets)) return;
  const next = { ...sessionSecrets };
  delete next[connectionId];
  sessionSecrets = next;
  await persistSecrets(sessionKey, sessionSecrets);
}

/** Pending removals while vault was locked. Applied on next unlock+save. */
const pendingRemovals = new Set<string>();

export function queueVaultSecretRemoval(connectionId: string) {
  pendingRemovals.add(connectionId);
  pendingRemovals.add(`${connectionId}:ssh`);
  pendingRemovals.add(`${connectionId}:ssh-passphrase`);
  if (sessionKey) {
    void removeVaultSecret(connectionId).then(() => {
      pendingRemovals.delete(connectionId);
    });
    void removeVaultSecret(`${connectionId}:ssh`).then(() => {
      pendingRemovals.delete(`${connectionId}:ssh`);
    });
    void removeVaultSecret(`${connectionId}:ssh-passphrase`).then(() => {
      pendingRemovals.delete(`${connectionId}:ssh-passphrase`);
    });
  }
}

export async function applyPendingVaultRemovals(): Promise<void> {
  if (!sessionKey || pendingRemovals.size === 0) return;
  const ids = [...pendingRemovals];
  pendingRemovals.clear();
  for (const id of ids) {
    await removeVaultSecret(id);
  }
}

export function deleteVault() {
  localStorage.removeItem(VAULT_KEY);
  lockVault();
  pendingRemovals.clear();
}
