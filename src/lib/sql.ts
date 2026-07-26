import { ConnectionProfile } from "../types/connection";
import { ColumnNode } from "../types/schema";

export function quoteIdent(
  driver: ConnectionProfile["driver"],
  name: string,
): string {
  if (driver === "mysql") {
    return `\`${name.replace(/`/g, "``")}\``;
  }
  return `"${name.replace(/"/g, '""')}"`;
}

export function qualifyTable(
  driver: ConnectionProfile["driver"],
  schema: string,
  table: string,
): string {
  return `${quoteIdent(driver, schema)}.${quoteIdent(driver, table)}`;
}

export function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  const text =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  return `'${text.replace(/'/g, "''")}'`;
}

export function buildTableSelect(options: {
  driver: ConnectionProfile["driver"];
  schema: string;
  table: string;
  where: string;
  orderBy: string;
  limit: number;
  offset: number;
}): string {
  const from = qualifyTable(options.driver, options.schema, options.table);
  const where = options.where.trim()
    ? `\nWHERE ${options.where.trim()}`
    : "";
  const orderBy = options.orderBy.trim()
    ? `\nORDER BY ${options.orderBy.trim()}`
    : "";
  return `SELECT *\nFROM ${from}${where}${orderBy}\nLIMIT ${options.limit} OFFSET ${options.offset}`;
}

export function buildTableQuery(
  driver: ConnectionProfile["driver"],
  schema: string,
  table: string,
  limit = 100,
): string {
  return `${buildTableSelect({
    driver,
    schema,
    table,
    where: "",
    orderBy: "",
    limit,
    offset: 0,
  })};`;
}

const DEFAULT_MAX_ROWS = 500;

export function defaultMaxRows(maxRows?: number): number {
  return maxRows && maxRows > 0 ? maxRows : DEFAULT_MAX_ROWS;
}

function isRowQuery(sql: string): boolean {
  const statement = sql.trim().replace(/^;+/, "").trimStart().toLowerCase();
  return [
    "select",
    "with",
    "show",
    "describe",
    "desc",
    "explain",
    "values",
  ].some((keyword) => statement.startsWith(keyword));
}

/** EXPLAIN plans must not be rewritten with LIMIT/OFFSET paging. */
export function isExplainSql(sql: string): boolean {
  const statement = sql.trim().replace(/^;+/, "").trimStart().toLowerCase();
  return statement.startsWith("explain");
}

/** Strip a trailing LIMIT / OFFSET so the UI can re-apply paging. */
export function stripTrailingLimitOffset(sql: string): string {
  const trimmed = sql.trim();
  const hadSemi = trimmed.endsWith(";");
  let body = hadSemi ? trimmed.slice(0, -1).trimEnd() : trimmed;
  const lower = body.toLowerCase();

  const patterns = [
    /\s+limit\s+\d+\s+offset\s+\d+\s*$/i,
    /\s+offset\s+\d+\s+limit\s+\d+\s*$/i,
    /\s+limit\s+\d+\s*,\s*\d+\s*$/i,
    /\s+limit\s+\d+\s*$/i,
  ];
  for (const pattern of patterns) {
    if (pattern.test(lower)) {
      body = body.replace(pattern, "").trimEnd();
      break;
    }
  }
  return hadSemi ? `${body};` : body;
}

function trailingLimit(sql: string): number | null {
  const body = sql.trim().replace(/;$/, "").trimEnd();
  const match =
    body.match(/\blimit\s+(\d+)\s+offset\s+\d+\s*$/i) ||
    body.match(/\boffset\s+\d+\s+limit\s+(\d+)\s*$/i) ||
    body.match(/\blimit\s+\d+\s*,\s*(\d+)\s*$/i) ||
    body.match(/\blimit\s+(\d+)\s*$/i);
  return match ? Number(match[1]) : null;
}

export type PagedQueryPlan =
  | { pageable: false; sql: string }
  | { pageable: true; baseSql: string; limit: number };

/**
 * Decide whether the query editor should page this statement with the driver
 * max row limit, or run the user's SQL as-is (mutations / intentional small LIMIT).
 */
export function planPagedQuery(sql: string, maxRows: number): PagedQueryPlan {
  const limit = defaultMaxRows(maxRows);
  if (!isRowQuery(sql) || isExplainSql(sql)) {
    return { pageable: false, sql };
  }
  const existing = trailingLimit(sql);
  if (existing != null && existing <= limit) {
    return { pageable: false, sql };
  }
  const base = stripTrailingLimitOffset(sql).replace(/;$/, "").trimEnd();
  return { pageable: true, baseSql: base, limit };
}

export function sqlForPage(plan: PagedQueryPlan, page: number): string {
  if (!plan.pageable) return plan.sql;
  const offset = Math.max(0, page) * plan.limit;
  return `${plan.baseSql}\nLIMIT ${plan.limit} OFFSET ${offset}`;
}

export function primaryKeyColumns(columns: ColumnNode[]): ColumnNode[] {
  return columns.filter((column) => column.primaryKey);
}

export function buildUpdateSql(options: {
  driver: ConnectionProfile["driver"];
  schema: string;
  table: string;
  columns: string[];
  pkColumns: string[];
  original: unknown[];
  next: unknown[];
}): string | null {
  const sets: string[] = [];
  for (let i = 0; i < options.columns.length; i += 1) {
    if (Object.is(options.original[i], options.next[i])) continue;
    if (
      String(options.original[i]) === String(options.next[i]) &&
      options.original[i] !== null &&
      options.next[i] !== null
    ) {
      continue;
    }
    sets.push(
      `${quoteIdent(options.driver, options.columns[i])} = ${sqlLiteral(options.next[i])}`,
    );
  }
  if (sets.length === 0) return null;

  const where = options.pkColumns
    .map((name) => {
      const index = options.columns.indexOf(name);
      return `${quoteIdent(options.driver, name)} = ${sqlLiteral(options.original[index])}`;
    })
    .join(" AND ");

  return `UPDATE ${qualifyTable(options.driver, options.schema, options.table)}\nSET ${sets.join(", ")}\nWHERE ${where}`;
}

export function buildInsertSql(options: {
  driver: ConnectionProfile["driver"];
  schema: string;
  table: string;
  columns: string[];
  values: unknown[];
}): string {
  const cols = options.columns
    .map((name) => quoteIdent(options.driver, name))
    .join(", ");
  const vals = options.values.map(sqlLiteral).join(", ");
  return `INSERT INTO ${qualifyTable(options.driver, options.schema, options.table)} (${cols})\nVALUES (${vals})`;
}

export function buildDeleteSql(options: {
  driver: ConnectionProfile["driver"];
  schema: string;
  table: string;
  columns: string[];
  pkColumns: string[];
  original: unknown[];
}): string {
  const where = options.pkColumns
    .map((name) => {
      const index = options.columns.indexOf(name);
      return `${quoteIdent(options.driver, name)} = ${sqlLiteral(options.original[index])}`;
    })
    .join(" AND ");
  return `DELETE FROM ${qualifyTable(options.driver, options.schema, options.table)}\nWHERE ${where}`;
}

export function columnTypeIcon(dataType: string): "number" | "date" | "text" | "bool" {
  const t = dataType.toLowerCase();
  if (
    t.includes("int") ||
    t.includes("decimal") ||
    t.includes("numeric") ||
    t.includes("float") ||
    t.includes("double") ||
    t.includes("real") ||
    t.includes("serial") ||
    t.includes("money")
  ) {
    return "number";
  }
  if (
    t.includes("date") ||
    t.includes("time") ||
    t.includes("timestamp") ||
    t.includes("year")
  ) {
    return "date";
  }
  if (t.includes("bool") || t === "bit(1)") return "bool";
  return "text";
}
