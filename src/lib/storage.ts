import {
  blankProfile,
  blankSsh,
  ConnectionProfile,
  ConnectionSafety,
  PasswordStorage,
  SshTunnelSettings,
  TreeNode,
} from "../types/connection";
import { removeKeychainSecret } from "./keychain";
import { queueVaultSecretRemoval } from "./vault";

const STORAGE_KEY = "hyperstudio.connections.v2";
const LEGACY_STORAGE_KEY = "hyperstudio.connections.v1";

function normalizeStorage(value: unknown): PasswordStorage {
  if (
    value === "raw" ||
    value === "vault" ||
    value === "keychain" ||
    value === "none"
  ) {
    return value;
  }
  return "none";
}

function normalizeSafety(value: unknown): ConnectionSafety {
  if (value === "confirm" || value === "readOnly" || value === "none") {
    return value;
  }
  return "none";
}

function prepareSshForDisk(
  ssh: SshTunnelSettings | undefined,
  passwordStorage: PasswordStorage,
): SshTunnelSettings | undefined {
  if (!ssh) return undefined;
  const keepSecrets = passwordStorage === "raw";
  return {
    ...ssh,
    password: keepSecrets ? ssh.password : "",
    passphrase: keepSecrets ? ssh.passphrase : "",
  };
}

function prepareProfileForDisk(profile: ConnectionProfile): ConnectionProfile {
  const passwordStorage = normalizeStorage(profile.passwordStorage);
  return {
    ...profile,
    passwordStorage,
    password: passwordStorage === "raw" ? profile.password : "",
    allSchemas: profile.allSchemas ?? true,
    schemas: profile.schemas ?? [],
    ssh: prepareSshForDisk(profile.ssh, passwordStorage),
    color: profile.color ?? "none",
    safety: normalizeSafety(profile.safety),
  };
}

function prepareTreeForDisk(nodes: TreeNode[]): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind === "folder") {
      return { ...node, children: prepareTreeForDisk(node.children) };
    }
    return {
      kind: "connection",
      profile: prepareProfileForDisk(node.profile),
    };
  });
}

export function normalizeLoadedProfile(
  profile: Partial<ConnectionProfile>,
): ConnectionProfile {
  const passwordStorage = normalizeStorage(profile.passwordStorage);
  const base = blankProfile(
    typeof profile.driver === "string" && profile.driver
      ? profile.driver
      : "postgres",
  );
  const keepSecrets = passwordStorage === "raw";
  const sshIn = profile.ssh;
  return {
    ...base,
    ...profile,
    passwordStorage,
    password: keepSecrets ? (profile.password ?? "") : "",
    allSchemas: profile.allSchemas ?? !(profile.schemas?.length),
    schemas: Array.isArray(profile.schemas) ? profile.schemas : [],
    color: profile.color ?? "none",
    safety: normalizeSafety(profile.safety),
    id: profile.id || crypto.randomUUID(),
    ssh: sshIn
      ? {
          ...blankSsh(),
          ...sshIn,
          password: keepSecrets ? (sshIn.password ?? "") : "",
          passphrase: keepSecrets ? (sshIn.passphrase ?? "") : "",
        }
      : blankSsh(),
  };
}

export function normalizeTree(nodes: TreeNode[]): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind === "folder") {
      return { ...node, children: normalizeTree(node.children) };
    }
    return {
      kind: "connection",
      profile: normalizeLoadedProfile(node.profile),
    };
  });
}

/** Strip managed secrets the same way local persistence does. */
export function sanitizeTreeForDisk(nodes: TreeNode[]): TreeNode[] {
  return prepareTreeForDisk(nodes);
}

function migrateLegacyProfiles(raw: unknown): TreeNode[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const profile = item as Partial<ConnectionProfile>;
    return {
      kind: "connection" as const,
      profile: normalizeLoadedProfile({
        ...profile,
        password: "",
        passwordStorage: "none",
      }),
    };
  });
}

export function loadTree(): TreeNode[] {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current) {
      const parsed = JSON.parse(current);
      return Array.isArray(parsed) ? normalizeTree(parsed) : [];
    }
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      return migrateLegacyProfiles(JSON.parse(legacy));
    }
    return [];
  } catch {
    return [];
  }
}

export function saveTree(nodes: TreeNode[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prepareTreeForDisk(nodes)));
}

export function onConnectionDeleted(connectionId: string) {
  queueVaultSecretRemoval(connectionId);
  // Best effort: a locked or unavailable credential store must not block
  // deleting the profile itself.
  void removeKeychainSecret(connectionId).catch(() => undefined);
}

export function mapTreeProfiles(
  nodes: TreeNode[],
  map: (profile: ConnectionProfile) => ConnectionProfile,
): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind === "folder") {
      return { ...node, children: mapTreeProfiles(node.children, map) };
    }
    return { kind: "connection", profile: map(node.profile) };
  });
}
