import { open, save } from "@tauri-apps/plugin-dialog";
import { databaseApi } from "../api/database";
import {
  ConnectionProfile,
  SshTunnelSettings,
  TreeNode,
} from "../types/connection";
import {
  normalizeLoadedProfile,
  sanitizeTreeForDisk,
} from "./storage";
import { collectConnections } from "./tree";
import {
  sshPassphraseVaultKey,
  sshVaultKey,
  VaultLockedError,
  VaultMissingError,
} from "./passwords";
import {
  getVaultSecret,
  isVaultUnlocked,
  setVaultSecret,
  vaultExists,
} from "./vault";

export const CONNECTION_EXPORT_KIND = "hyperstudio.connections";
export const CONNECTION_EXPORT_VERSION = 1 as const;

export interface ConnectionExportDocument {
  version: typeof CONNECTION_EXPORT_VERSION;
  kind: typeof CONNECTION_EXPORT_KIND;
  exportedAt: string;
  tree: TreeNode[];
}

export interface ExportResult {
  path: string;
  connectionCount: number;
  keychainSkipped: number;
  vaultSkipped: number;
}

export type ImportMode = "merge" | "replace";

export interface ImportResult {
  tree: TreeNode[];
  connectionCount: number;
  keychainWithoutPassword: number;
}

function stripSshSecrets(
  ssh: SshTunnelSettings | undefined,
): SshTunnelSettings | undefined {
  if (!ssh) return undefined;
  return { ...ssh, password: "", passphrase: "" };
}

/** Embed exportable secrets on the profile; keychain secrets are never included. */
function prepareProfileForExport(profile: ConnectionProfile): {
  profile: ConnectionProfile;
  keychainSkipped: boolean;
  vaultSkipped: boolean;
} {
  if (profile.passwordStorage === "keychain") {
    return {
      profile: {
        ...profile,
        password: "",
        ssh: stripSshSecrets(profile.ssh),
      },
      keychainSkipped: true,
      vaultSkipped: false,
    };
  }

  if (profile.passwordStorage === "vault") {
    if (!isVaultUnlocked()) {
      return {
        profile: {
          ...profile,
          password: "",
          ssh: stripSshSecrets(profile.ssh),
        },
        keychainSkipped: false,
        vaultSkipped: true,
      };
    }
    const password = getVaultSecret(profile.id) || profile.password || "";
    const ssh = profile.ssh
      ? {
          ...profile.ssh,
          password:
            profile.ssh.password ||
            getVaultSecret(sshVaultKey(profile.id)) ||
            "",
          passphrase:
            profile.ssh.passphrase ||
            getVaultSecret(sshPassphraseVaultKey(profile.id)) ||
            "",
        }
      : undefined;
    return {
      profile: { ...profile, password, ssh },
      keychainSkipped: false,
      vaultSkipped: false,
    };
  }

  // raw / none — use whatever is already on the profile
  return {
    profile: { ...profile },
    keychainSkipped: false,
    vaultSkipped: false,
  };
}

function prepareTreeForExport(nodes: TreeNode[]): {
  tree: TreeNode[];
  keychainSkipped: number;
  vaultSkipped: number;
} {
  let keychainSkipped = 0;
  let vaultSkipped = 0;
  const tree = nodes.map((node) => {
    if (node.kind === "folder") {
      const nested = prepareTreeForExport(node.children);
      keychainSkipped += nested.keychainSkipped;
      vaultSkipped += nested.vaultSkipped;
      return { ...node, children: nested.tree };
    }
    const prepared = prepareProfileForExport(node.profile);
    if (prepared.keychainSkipped) keychainSkipped += 1;
    if (prepared.vaultSkipped) vaultSkipped += 1;
    return { kind: "connection" as const, profile: prepared.profile };
  });
  return { tree, keychainSkipped, vaultSkipped };
}

export function buildExportDocument(nodes: TreeNode[]): {
  document: ConnectionExportDocument;
  keychainSkipped: number;
  vaultSkipped: number;
} {
  const prepared = prepareTreeForExport(nodes);
  return {
    document: {
      version: CONNECTION_EXPORT_VERSION,
      kind: CONNECTION_EXPORT_KIND,
      exportedAt: new Date().toISOString(),
      tree: prepared.tree,
    },
    keychainSkipped: prepared.keychainSkipped,
    vaultSkipped: prepared.vaultSkipped,
  };
}

export async function exportConnections(
  nodes: TreeNode[],
): Promise<ExportResult | null> {
  const { document, keychainSkipped, vaultSkipped } = buildExportDocument(nodes);
  const suggested = `hyperstudio-connections-${new Date()
    .toISOString()
    .slice(0, 10)}.json`;

  const path = await save({
    defaultPath: suggested,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!path) return null;

  await databaseApi.writeTextFile(
    path,
    `${JSON.stringify(document, null, 2)}\n`,
  );

  return {
    path,
    connectionCount: collectConnections(document.tree).length,
    keychainSkipped,
    vaultSkipped,
  };
}

/**
 * Keep passwords from the file on the profile temporarily. Keychain entries
 * never carry a password across machines.
 */
function normalizeImportedProfile(
  raw: Partial<ConnectionProfile>,
): ConnectionProfile {
  const storage =
    raw.passwordStorage === "raw" ||
    raw.passwordStorage === "vault" ||
    raw.passwordStorage === "keychain" ||
    raw.passwordStorage === "none"
      ? raw.passwordStorage
      : "none";

  // Force "raw" during normalize so password / SSH secrets survive the strip.
  const withSecrets = normalizeLoadedProfile({
    ...raw,
    passwordStorage: "raw",
  });

  if (storage === "keychain") {
    return {
      ...withSecrets,
      passwordStorage: "keychain",
      password: "",
      ssh: stripSshSecrets(withSecrets.ssh),
    };
  }

  return { ...withSecrets, passwordStorage: storage };
}

function normalizeImportedTree(nodes: unknown): TreeNode[] {
  if (!Array.isArray(nodes)) {
    throw new Error("Import file does not contain a connection tree.");
  }
  return nodes.map((node) => {
    if (!node || typeof node !== "object") {
      throw new Error("Import file contains an invalid tree node.");
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
        children: normalizeImportedTree(folder.children ?? []),
      };
    }
    if (item.kind === "connection" || item.profile) {
      return {
        kind: "connection" as const,
        profile: normalizeImportedProfile(item.profile ?? {}),
      };
    }
    throw new Error("Import file contains an unrecognized tree node.");
  });
}

export function parseConnectionExport(raw: string): TreeNode[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Import file is not valid JSON.");
  }

  // Accept either the versioned document or a bare tree array.
  if (Array.isArray(parsed)) {
    return normalizeImportedTree(parsed);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Import file has an unexpected shape.");
  }

  const doc = parsed as Partial<ConnectionExportDocument>;
  if (doc.kind && doc.kind !== CONNECTION_EXPORT_KIND) {
    throw new Error("This file is not a HyperStudio connections export.");
  }
  if (
    doc.version != null &&
    doc.version !== CONNECTION_EXPORT_VERSION
  ) {
    throw new Error(
      `Unsupported connections export version (${String(doc.version)}).`,
    );
  }
  return normalizeImportedTree(doc.tree);
}

/** Assign fresh ids so a merge cannot collide with existing connections. */
export function remapTreeIds(nodes: TreeNode[]): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind === "folder") {
      return {
        ...node,
        id: crypto.randomUUID(),
        children: remapTreeIds(node.children),
      };
    }
    return {
      kind: "connection",
      profile: { ...node.profile, id: crypto.randomUUID() },
    };
  });
}

/**
 * Write vault secrets from imported profiles, then return a disk-safe tree
 * (vault/keychain passwords cleared from the profile objects).
 */
export async function applyImportedSecrets(
  nodes: TreeNode[],
): Promise<ImportResult> {
  const connections = collectConnections(nodes);
  const needsVault = connections.some(
    (profile) =>
      profile.passwordStorage === "vault" &&
      (Boolean(profile.password) ||
        Boolean(profile.ssh?.password) ||
        Boolean(profile.ssh?.passphrase)),
  );

  if (needsVault) {
    if (!vaultExists()) throw new VaultMissingError();
    if (!isVaultUnlocked()) throw new VaultLockedError();
  }

  let keychainWithoutPassword = 0;

  async function walk(list: TreeNode[]): Promise<TreeNode[]> {
    const next: TreeNode[] = [];
    for (const node of list) {
      if (node.kind === "folder") {
        next.push({
          ...node,
          children: await walk(node.children),
        });
        continue;
      }

      const profile = node.profile;
      if (profile.passwordStorage === "keychain") {
        keychainWithoutPassword += 1;
        next.push({
          kind: "connection",
          profile: {
            ...profile,
            password: "",
            ssh: stripSshSecrets(profile.ssh),
          },
        });
        continue;
      }

      if (profile.passwordStorage === "vault") {
        if (profile.password) {
          await setVaultSecret(profile.id, profile.password);
        }
        if (profile.ssh?.enabled) {
          if (profile.ssh.auth === "password" && profile.ssh.password) {
            await setVaultSecret(sshVaultKey(profile.id), profile.ssh.password);
          }
          if (profile.ssh.auth === "key" && profile.ssh.passphrase) {
            await setVaultSecret(
              sshPassphraseVaultKey(profile.id),
              profile.ssh.passphrase,
            );
          }
        }
      }

      next.push({ kind: "connection", profile });
    }
    return next;
  }

  const withSecretsApplied = await walk(nodes);
  return {
    tree: sanitizeTreeForDisk(withSecretsApplied),
    connectionCount: connections.length,
    keychainWithoutPassword,
  };
}

export async function pickAndReadImportFile(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!selected || Array.isArray(selected)) return null;
  return databaseApi.readTextFile(selected);
}

export function summarizeExport(result: ExportResult): string {
  const parts = [
    `Exported ${result.connectionCount} connection${result.connectionCount === 1 ? "" : "s"}.`,
  ];
  if (result.keychainSkipped > 0) {
    parts.push(
      `${result.keychainSkipped} keychain password${result.keychainSkipped === 1 ? " was" : "s were"} omitted (OS credential store cannot be exported).`,
    );
  }
  if (result.vaultSkipped > 0) {
    parts.push(
      `${result.vaultSkipped} vault password${result.vaultSkipped === 1 ? " was" : "s were"} omitted because the vault is locked.`,
    );
  }
  return parts.join(" ");
}
