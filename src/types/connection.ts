export type Driver = "postgres" | "mysql";

export type SslMode = "prefer" | "require" | "disable";

/** How the DB password is persisted. */
export type PasswordStorage = "none" | "raw" | "vault";

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
    port: driver === "postgres" ? 5432 : 3306,
    database: "",
    username: driver === "postgres" ? "postgres" : "root",
    password: "",
    passwordStorage: "none",
    sslMode: "prefer",
    allSchemas: true,
    schemas: [],
  };
}
