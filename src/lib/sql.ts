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
): string {
  return `${buildTableSelect({
    driver,
    schema,
    table,
    where: "",
    orderBy: "",
    limit: 100,
    offset: 0,
  })};`;
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
