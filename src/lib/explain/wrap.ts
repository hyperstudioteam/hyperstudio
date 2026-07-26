import { ConnectionProfile } from "../../types/connection";
import { ExplainDriver } from "./types";

export function isExplainSupported(
  driver: ConnectionProfile["driver"] | undefined,
): driver is ExplainDriver {
  return driver === "postgres" || driver === "mysql";
}

/** Detect ANALYZE in a hand-written EXPLAIN prefix. */
export function explainHasAnalyze(sql: string): boolean {
  const statement = sql.trim().replace(/^;+/, "").trimStart();
  if (!/^explain\b/i.test(statement)) return false;
  const after = statement.slice(7).trimStart();
  if (/^analyze\b/i.test(after)) return true;
  const paren = after.match(/^\(([^)]*)\)/i);
  if (!paren) return false;
  return /\banalyze\b/i.test(paren[1]);
}

/**
 * Strip a leading EXPLAIN [ANALYZE] [(…)] / FORMAT=… prefix so we can re-wrap
 * with a dialect-specific visualizable format.
 */
export function stripExplainPrefix(sql: string): string {
  let body = sql.trim().replace(/^;+/, "").trimStart();
  const hadSemi = body.endsWith(";");
  if (hadSemi) body = body.slice(0, -1).trimEnd();

  if (!/^explain\b/i.test(body)) {
    return hadSemi ? `${body};` : body;
  }

  body = body.slice(7).trimStart();

  // MySQL / Postgres: EXPLAIN ANALYZE …
  if (/^analyze\b/i.test(body)) {
    body = body.slice(7).trimStart();
  }

  // Postgres: EXPLAIN (ANALYZE, FORMAT JSON) …
  if (body.startsWith("(")) {
    const close = body.indexOf(")");
    if (close >= 0) {
      body = body.slice(close + 1).trimStart();
    }
  }

  // MySQL: EXPLAIN FORMAT=JSON / FORMAT = TREE …
  if (/^format\s*=/i.test(body)) {
    body = body.replace(/^format\s*=\s*\w+\s*/i, "").trimStart();
  }

  return hadSemi ? `${body};` : body;
}

export function wrapExplainSql(
  driver: ExplainDriver,
  sql: string,
  options: { analyze: boolean },
): string {
  const inner = stripExplainPrefix(sql).replace(/;$/, "").trimEnd();
  if (!inner) return sql;

  if (driver === "postgres") {
    const opts = options.analyze
      ? "ANALYZE, BUFFERS, FORMAT JSON"
      : "FORMAT JSON";
    return `EXPLAIN (${opts})\n${inner}`;
  }

  if (options.analyze) {
    return `EXPLAIN ANALYZE\n${inner}`;
  }
  return `EXPLAIN FORMAT=JSON\n${inner}`;
}
