import { ObjectGroupDef } from "./schema";

export type Driver = string;

export type SslMode = "prefer" | "require" | "disable";

/** How the DB password is persisted. */
export type PasswordStorage = "none" | "raw" | "vault";

/** How aggressively writes are guarded on a connection. */
export type ConnectionSafety = "none" | "confirm" | "readOnly";

export interface DriverCapabilities {
  schemas: boolean;
  views: boolean;
  fileBased: boolean;
  folderBased: boolean;
  noConnectionRequired: boolean;
  readonly: boolean;
  identifierQuote: string;
  /** Max rows per SELECT page from the query editor. */
  maxRows?: number;
}

export interface ColumnTypeDeclaration {
  typeNames: string[];
  matchPrefix?: boolean;
  align?: string;
  className?: string;
  /** Viewer id to open by default (e.g. "builtin.json"). */
  viewer?: string;
  priority?: number;
}

export interface ConnectionFieldDef {
  /** Maps to ConnectionProfile: host | port | database | username | password | sslMode */
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  secret?: boolean;
  options?: string[];
  description?: string;
  /** "half" or "full" */
  width?: string;
}

export interface DriverInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  builtin: boolean;
  defaultPort: number | null;
  capabilities: DriverCapabilities;
  columnTypes?: ColumnTypeDeclaration[];
  /** When set, connection modal uses these instead of the SQL defaults. */
  connectionFields?: ConnectionFieldDef[];
  /** Object categories the schema tree should show under each schema. */
  objectGroups?: ObjectGroupDef[];
}

export interface InstalledPluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  path: string;
}

export interface ConnectionProfile {
  id: string;
  name: string;
  driver: Driver;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  /** none = session only; raw = plaintext on disk; vault = encrypted. */
  passwordStorage: PasswordStorage;
  sslMode: SslMode;
  /** When true, introspect every accessible schema. */
  allSchemas: boolean;
  /** Used when allSchemas is false. */
  schemas: string[];
  /** Swatch id used to tint the connection in the tree. */
  color?: string;
  /** Guard applied to statements that are not reads. */
  safety?: ConnectionSafety;
}

export type TreeNode =
  | { kind: "folder"; id: string; name: string; children: TreeNode[] }
  | { kind: "connection"; profile: ConnectionProfile };

export type Selection =
  | { kind: "connection"; id: string }
  | { kind: "folder"; id: string }
  | null;

export type DropPosition = "before" | "after" | "into";

export interface DragPayload {
  id: string;
  kind: "folder" | "connection";
}

export function blankProfile(driver: Driver = "postgres"): ConnectionProfile {
  return {
    id: crypto.randomUUID(),
    name: "",
    driver,
    host: "localhost",
    port: driver === "postgres" ? 5432 : driver === "mysql" ? 3306 : 0,
    database: "",
    username: driver === "postgres" ? "postgres" : driver === "mysql" ? "root" : "",
    password: "",
    passwordStorage: "none",
    sslMode: "prefer",
    allSchemas: true,
    schemas: [],
    color: "none",
    safety: "none",
  };
}

export function blankProfileFromDriver(driver: DriverInfo): ConnectionProfile {
  const profile = blankProfile(driver.id);
  profile.port = driver.defaultPort ?? 0;
  const fields = driver.connectionFields ?? [];
  if (fields.length > 0) {
    const keys = new Set(fields.map((field) => field.key));
    if (!keys.has("username")) profile.username = "";
    if (!keys.has("database")) {
      profile.database = "";
    } else {
      const dbField = fields.find((field) => field.key === "database");
      profile.database = dbField?.options?.[0] ?? "";
    }
    if (!keys.has("password")) profile.password = "";
    if (!keys.has("host")) profile.host = "";
    return profile;
  }
  if (driver.capabilities.fileBased || driver.capabilities.folderBased) {
    profile.host = "";
    profile.username = "";
    profile.port = 0;
  }
  if (driver.capabilities.noConnectionRequired) {
    profile.host = "";
    profile.port = 0;
    profile.database = driver.id;
    profile.username = "";
  }
  return profile;
}
