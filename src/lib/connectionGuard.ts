import { ConnectionProfile, ConnectionSafety } from "../types/connection";

export const CONNECTION_COLORS = [
  { id: "none", label: "None", dot: "transparent", border: "#3a414d" },
  { id: "red", label: "Red", dot: "#e5484d", border: "#e5484d" },
  { id: "amber", label: "Amber", dot: "#e5a13a", border: "#e5a13a" },
  { id: "green", label: "Green", dot: "#4cc38a", border: "#4cc38a" },
  { id: "blue", label: "Blue", dot: "#5b9df9", border: "#5b9df9" },
  { id: "purple", label: "Purple", dot: "#9d90ff", border: "#9d90ff" },
] as const;

export type ConnectionColorId = (typeof CONNECTION_COLORS)[number]["id"];

export function colorDot(color: string | undefined): string | null {
  if (!color || color === "none") return null;
  return CONNECTION_COLORS.find((item) => item.id === color)?.dot ?? null;
}

export const SAFETY_OPTIONS: Array<{
  id: ConnectionSafety;
  label: string;
  description: string;
}> = [
  {
    id: "none",
    label: "Unrestricted",
    description: "Run anything without extra prompts.",
  },
  {
    id: "confirm",
    label: "Confirm writes",
    description:
      "Ask before anything that could modify data or schema. Use for production.",
  },
  {
    id: "readOnly",
    label: "Read-only",
    description: "Refuse to run anything that is not a read.",
  },
];

/**
 * Statements known to only read.
 *
 * Anything not on this list counts as a write, so an unrecognised or novel
 * statement fails closed rather than slipping past a guard.
 */
const READ_KEYWORDS = [
  "select",
  "with",
  "show",
  "describe",
  "desc",
  "explain",
  "values",
  "table",
];

/** Strip comments and leading noise so the first real keyword is visible. */
function firstKeyword(sql: string): string {
  let text = sql;
  // Remove block and line comments, which can legally precede a statement.
  text = text.replace(/\/\*[\s\S]*?\*\//g, " ");
  text = text.replace(/--[^\n]*/g, " ");
  text = text.replace(/^[\s;(]+/, "");
  const match = text.match(/^[a-zA-Z_]+/);
  return match ? match[0].toLowerCase() : "";
}

export function isReadOnlyStatement(sql: string): boolean {
  const keyword = firstKeyword(sql);
  if (!keyword) return true;
  if (!READ_KEYWORDS.includes(keyword)) return false;

  // A CTE or EXPLAIN can still wrap a write.
  if (keyword === "with" || keyword === "explain") {
    return !/\b(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke)\b/i.test(
      sql,
    );
  }
  return true;
}

export class ReadOnlyConnectionError extends Error {
  constructor(connectionName: string) {
    super(
      `“${connectionName}” is marked read-only. This statement was not run because it is not a read.`,
    );
    this.name = "ReadOnlyConnectionError";
  }
}

/** Thrown so the UI can prompt; resolving the prompt re-runs the action. */
export class WriteConfirmationRequiredError extends Error {
  readonly profileId: string;
  readonly connectionName: string;
  readonly sql: string;

  constructor(profile: ConnectionProfile, sql: string) {
    super(`“${profile.name}” requires confirmation before writes.`);
    this.name = "WriteConfirmationRequiredError";
    this.profileId = profile.id;
    this.connectionName = profile.name;
    this.sql = sql;
  }
}

export function safetyOf(profile: ConnectionProfile): ConnectionSafety {
  return profile.safety ?? "none";
}

/**
 * Enforce a connection's safety mode before a statement runs.
 *
 * `confirmed` is set once the user has acknowledged the prompt for this exact
 * statement, so the retry is allowed through.
 */
export function assertStatementAllowed(
  profile: ConnectionProfile,
  sql: string,
  confirmed = false,
): void {
  const safety = safetyOf(profile);
  if (safety === "none") return;
  if (isReadOnlyStatement(sql)) return;

  if (safety === "readOnly") {
    throw new ReadOnlyConnectionError(profile.name || profile.database);
  }
  if (safety === "confirm" && !confirmed) {
    throw new WriteConfirmationRequiredError(profile, sql);
  }
}
