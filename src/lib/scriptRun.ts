import { QueryResult } from "../types/query";
import { SplitStatement } from "./splitStatements";

export type StatementStatus =
  | "pending"
  | "running"
  | "ok"
  | "error"
  | "skipped";

export interface StatementRun {
  sql: string;
  line: number;
  status: StatementStatus;
  result: QueryResult | null;
  error: string;
}

export function toStatementRuns(statements: SplitStatement[]): StatementRun[] {
  return statements.map((statement) => ({
    sql: statement.sql,
    line: statement.line,
    status: "pending" as const,
    result: null,
    error: "",
  }));
}

/** First words of a statement, for the run list. */
export function statementLabel(sql: string): string {
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length > 64 ? `${stripped.slice(0, 63)}…` : stripped;
}

export function summarize(run: StatementRun): string {
  if (run.status === "error") return run.error;
  if (!run.result) return "";
  const { columns, rows, affectedRows, elapsedMs } = run.result;
  const count = columns.length
    ? `${rows.length} row${rows.length === 1 ? "" : "s"}`
    : `${affectedRows} affected`;
  return `${count} · ${elapsedMs} ms`;
}
