import {
  blankProfile,
  ConnectionProfile,
  PasswordStorage,
  TreeNode,
} from "../types/connection";
import { queueVaultSecretRemoval } from "./vault";

const STORAGE_KEY = "hypergrid.connections.v2";
const LEGACY_STORAGE_KEY = "hypergrid.connections.v1";

function normalizeStorage(value: unknown): PasswordStorage {
  if (value === "raw" || value === "vault" || value === "none") return value;
  return "none";
}

function prepareProfileForDisk(profile: ConnectionProfile): ConnectionProfile {
  const passwordStorage = normalizeStorage(profile.passwordStorage);
  return {
    ...profile,
    passwordStorage,
    password: passwordStorage === "raw" ? profile.password : "",
    allSchemas: profile.allSchemas ?? true,
    schemas: profile.schemas ?? [],
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

function normalizeLoadedProfile(
  profile: Partial<ConnectionProfile>,
): ConnectionProfile {
  const passwordStorage = normalizeStorage(profile.passwordStorage);
  return {
    ...blankProfile(profile.driver === "mysql" ? "mysql" : "postgres"),
    ...profile,
    passwordStorage,
    password: passwordStorage === "raw" ? (profile.password ?? "") : "",
    allSchemas: profile.allSchemas ?? !(profile.schemas?.length),
    schemas: Array.isArray(profile.schemas) ? profile.schemas : [],
    id: profile.id || crypto.randomUUID(),
  };
}

function normalizeTree(nodes: TreeNode[]): TreeNode[] {
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
