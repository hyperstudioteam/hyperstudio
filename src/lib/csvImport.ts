import { ConnectionProfile } from "../types/connection";
import { ColumnNode } from "../types/schema";
import { columnTypeIcon, qualifyTable, quoteIdent, sqlLiteral } from "./sql";

export interface ImportMapping {
  /** Target table column. */
  column: ColumnNode;
  /** Index into the CSV row, or -1 to leave the column out of the INSERT. */
  sourceIndex: number;
}

export interface ImportOptions {
  driver: ConnectionProfile["driver"];
  schema: string;
  table: string;
  mappings: ImportMapping[];
  /** Literal text treated as SQL NULL, in addition to empty fields. */
  nullToken: string;
  /** Rows per INSERT statement. */
  batchSize: number;
}

/**
 * Coerce a CSV field to the closest thing the target column wants. Anything we
 * cannot confidently convert stays a string and is left to the server to cast,
 * which keeps dates and enums working without guessing at their formats.
 */
export function coerceValue(raw: string, column: ColumnNode, nullToken: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "" || (nullToken !== "" && trimmed === nullToken)) {
    return null;
  }
  const kind = columnTypeIcon(column.dataType ?? "");
  if (kind === "number") {
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : raw;
  }
  if (kind === "bool") {
    const lower = trimmed.toLowerCase();
    if (["true", "t", "yes", "y", "1"].includes(lower)) return true;
    if (["false", "f", "no", "n", "0"].includes(lower)) return false;
    return raw;
  }
  return raw;
}

/** Group rows into multi-row INSERT statements. */
export function buildInsertBatches(
  rows: string[][],
  options: ImportOptions,
): string[] {
  const used = options.mappings.filter((item) => item.sourceIndex >= 0);
  if (used.length === 0 || rows.length === 0) return [];

  const target = qualifyTable(options.driver, options.schema, options.table);
  const columnList = used
    .map((item) => quoteIdent(options.driver, item.column.name))
    .join(", ");
  const size = Math.max(1, options.batchSize);
  const statements: string[] = [];

  for (let start = 0; start < rows.length; start += size) {
    const tuples = rows.slice(start, start + size).map((row) => {
      const values = used.map((item) =>
        sqlLiteral(
          coerceValue(row[item.sourceIndex] ?? "", item.column, options.nullToken),
        ),
      );
      return `(${values.join(", ")})`;
    });
    statements.push(
      `INSERT INTO ${target} (${columnList})\nVALUES ${tuples.join(",\n       ")}`,
    );
  }
  return statements;
}

/** Match CSV headers to table columns, case- and separator-insensitively. */
export function autoMap(
  columns: ColumnNode[],
  headers: string[],
): ImportMapping[] {
  const normalize = (name: string) => name.toLowerCase().replace(/[\s_-]/g, "");
  const lookup = new Map(
    headers.map((header, index) => [normalize(header), index] as const),
  );
  return columns.map((column) => ({
    column,
    sourceIndex: lookup.get(normalize(column.name)) ?? -1,
  }));
}
