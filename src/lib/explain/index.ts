import { QueryResult } from "../../types/query";
import { parseMysqlExplain } from "./parseMysql";
import { parsePostgresExplain } from "./parsePostgres";
import { ExplainDriver, ExplainPlan } from "./types";
import { parseJsonCell } from "./derive";
import { explainHasAnalyze, isExplainSupported } from "./wrap";

export type { ExplainDriver, ExplainPlan, PlanNode } from "./types";
export {
  explainHasAnalyze,
  isExplainSupported,
  stripExplainPrefix,
  wrapExplainSql,
} from "./wrap";
export { isExplainSql } from "../sql";

function firstCell(result: QueryResult): unknown {
  if (!result.rows.length || !result.rows[0]?.length) return null;
  return result.rows[0][0];
}

function findJsonCell(result: QueryResult): unknown {
  for (const row of result.rows) {
    for (const cell of row) {
      const parsed = parseJsonCell(cell);
      if (parsed && typeof parsed === "object") return parsed;
      if (typeof cell === "string") {
        const t = cell.trim();
        if (t.startsWith("{") || t.startsWith("[")) {
          const again = parseJsonCell(cell);
          if (again && typeof again === "object") return again;
        }
      }
    }
  }
  return firstCell(result);
}

/**
 * Parse a query result produced by EXPLAIN into a normalized plan tree.
 * Returns null when the result is not a recognizable plan (fall back to grid).
 */
export function parseExplainResult(
  driver: ExplainDriver,
  result: QueryResult,
  options?: { analyzed?: boolean; sql?: string },
): ExplainPlan | null {
  if (!result.columns.length || result.rows.length === 0) return null;

  const analyzed =
    options?.analyzed === true ||
    (options?.sql != null && explainHasAnalyze(options.sql));

  try {
    if (driver === "postgres") {
      const cell = findJsonCell(result);
      return parsePostgresExplain(cell, { analyzed });
    }

    // MySQL ANALYZE returns a TREE in a single column (often "EXPLAIN").
    if (analyzed) {
      const cell = firstCell(result);
      return parseMysqlExplain(cell, { analyzed: true });
    }

    const cell = findJsonCell(result);
    return parseMysqlExplain(cell, { analyzed: false });
  } catch {
    return null;
  }
}

export function canVisualizeExplain(
  driver: string | undefined,
): driver is ExplainDriver {
  return isExplainSupported(driver);
}
