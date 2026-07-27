import {
  ConnectionProfile,
  SshTunnelSettings,
  TreeNode,
} from "../types/connection";
import {
  CONNECTION_EXPORT_KIND,
  CONNECTION_EXPORT_VERSION,
} from "./connectionTransfer";
import {
  mapTreeProfiles,
  normalizeLoadedProfile,
  sanitizeTreeForDisk,
} from "./storage";
import { collectConnections } from "./tree";
import {
  isValidStoredVault,
  readStoredVault,
  StoredVault,
  vaultExists,
} from "./vault";

export interface ConnectionSyncDocument {
  version: typeof CONNECTION_EXPORT_VERSION;
  kind: typeof CONNECTION_EXPORT_KIND;
  exportedAt: string;
  tree: TreeNode[];
  vault?: StoredVault;
}

export type VaultApplyChoice = "replace" | "skip";

export interface ParsedSyncDocument {
  tree: TreeNode[];
  vault: StoredVault | null;
  connectionCount: number;
  vaultConnectionCount: number;
}

function stripSshSecrets(
  ssh: SshTunnelSettings | undefined,
): SshTunnelSettings | undefined {
  if (!ssh) return undefined;
  return { ...ssh, password: "", passphrase: "" };
}

/** Strip every plaintext secret; vault mode is preserved for ciphertext attach. */
function prepareProfileForSync(profile: ConnectionProfile): ConnectionProfile {
  return {
    ...profile,
    password: "",
    ssh: stripSshSecrets(profile.ssh),
  };
}

function prepareTreeForSync(nodes: TreeNode[]): TreeNode[] {
  return sanitizeTreeForDisk(
    mapTreeProfiles(nodes, prepareProfileForSync),
  );
}

export function buildSyncDocument(nodes: TreeNode[]): ConnectionSyncDocument {
  const tree = prepareTreeForSync(nodes);
  const hasVaultConnections = collectConnections(tree).some(
    (profile) => profile.passwordStorage === "vault",
  );
  const vault =
    hasVaultConnections && vaultExists()
      ? (readStoredVault() ?? undefined)
      : undefined;

  return {
    version: CONNECTION_EXPORT_VERSION,
    kind: CONNECTION_EXPORT_KIND,
    exportedAt: new Date().toISOString(),
    tree,
    ...(vault ? { vault } : {}),
  };
}

function normalizeSyncProfile(
  raw: Partial<ConnectionProfile>,
): ConnectionProfile {
  const storage =
    raw.passwordStorage === "raw" ||
    raw.passwordStorage === "vault" ||
    raw.passwordStorage === "keychain" ||
    raw.passwordStorage === "none"
      ? raw.passwordStorage
      : "none";

  // Force strip of any accidental plaintext in the remote file.
  return normalizeLoadedProfile({
    ...raw,
    passwordStorage: storage,
    password: "",
    ssh: stripSshSecrets(raw.ssh as SshTunnelSettings | undefined),
  });
}

function normalizeSyncTree(nodes: unknown): TreeNode[] {
  if (!Array.isArray(nodes)) {
    throw new Error("Sync file does not contain a connection tree.");
  }
  return nodes.map((node) => {
    if (!node || typeof node !== "object") {
      throw new Error("Sync file contains an invalid tree node.");
    }
    const item = node as { kind?: string; profile?: Partial<ConnectionProfile> };
    if (item.kind === "folder") {
      const folder = node as {
        id?: string;
        name?: string;
        children?: unknown;
      };
      return {
        kind: "folder" as const,
        id: typeof folder.id === "string" && folder.id
          ? folder.id
          : crypto.randomUUID(),
        name: typeof folder.name === "string" ? folder.name : "Folder",
        children: normalizeSyncTree(folder.children ?? []),
      };
    }
    if (item.kind === "connection" || item.profile) {
      return {
        kind: "connection" as const,
        profile: normalizeSyncProfile(item.profile ?? {}),
      };
    }
    throw new Error("Sync file contains an unrecognized tree node.");
  });
}

export function parseSyncDocument(raw: string): ParsedSyncDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Sync file is not valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Sync file has an unexpected shape.");
  }

  const doc = parsed as Partial<ConnectionSyncDocument>;
  if (doc.kind && doc.kind !== CONNECTION_EXPORT_KIND) {
    throw new Error("This file is not a HyperStudio connections document.");
  }
  if (doc.version != null && doc.version !== CONNECTION_EXPORT_VERSION) {
    throw new Error(
      `Unsupported connections document version (${String(doc.version)}).`,
    );
  }

  const tree = normalizeSyncTree(doc.tree);
  const vault = isValidStoredVault(doc.vault) ? doc.vault : null;
  const connections = collectConnections(tree);

  return {
    tree,
    vault,
    connectionCount: connections.length,
    vaultConnectionCount: connections.filter(
      (profile) => profile.passwordStorage === "vault",
    ).length,
  };
}

export function demoteVaultConnections(nodes: TreeNode[]): TreeNode[] {
  return mapTreeProfiles(nodes, (profile) =>
    profile.passwordStorage === "vault"
      ? { ...profile, passwordStorage: "none", password: "" }
      : profile,
  );
}

export function serializeSyncDocument(doc: ConnectionSyncDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}
