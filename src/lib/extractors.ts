import { ConnectionProfile } from "../types/connection";
import { quoteIdent, qualifyTable, sqlLiteral } from "./sql";

export type ExtractorId =
  | "tsv"
  | "csv"
  | "pipe"
  | "json"
  | "markdown"
  | "sql-inserts"
  | "sql-updates"
  | "where-clause"
  | "one-row";

export interface ExtractorOption {
  id: ExtractorId;
  label: string;
  group: "built-in" | "csv" | "scripted";
}

export const COPY_AS_OPTIONS: ExtractorOption[] = [
  { id: "sql-inserts", label: "SQL Inserts", group: "built-in" },
  { id: "sql-updates", label: "SQL Updates", group: "built-in" },
  { id: "where-clause", label: "Where Clause", group: "built-in" },
  { id: "csv", label: "CSV", group: "csv" },
  { id: "tsv", label: "TSV", group: "csv" },
  { id: "pipe", label: "Pipe-separated", group: "csv" },
  { id: "json", label: "JSON", group: "scripted" },
  { id: "markdown", label: "Markdown", group: "scripted" },
  { id: "one-row", label: "One-row", group: "scripted" },
];

export interface CellPos {
  row: number;
  col: number;
}

export interface CellRange {
  anchor: CellPos;
  focus: CellPos;
}

export interface NormalizedRange {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}

export function normalizeRange(range: CellRange): NormalizedRange {
  return {
    r0: Math.min(range.anchor.row, range.focus.row),
    r1: Math.max(range.anchor.row, range.focus.row),
    c0: Math.min(range.anchor.col, range.focus.col),
    c1: Math.max(range.anchor.col, range.focus.col),
  };
}

export function isCellInRange(
  row: number,
  col: number,
  range: CellRange | null,
): boolean {
  if (!range) return false;
  const { r0, r1, c0, c1 } = normalizeRange(range);
  return row >= r0 && row <= r1 && col >= c0 && col <= c1;
}

export function selectionStats(range: CellRange | null, matrix: unknown[][]) {
  if (!range || matrix.length === 0) {
    return { cells: 0, rows: 0, cols: 0, sum: null as number | null, coord: "" };
  }
  const { r0, r1, c0, c1 } = normalizeRange(range);
  const rows = r1 - r0 + 1;
  const cols = c1 - c0 + 1;
  const cells = rows * cols;
  let sum = 0;
  let numeric = 0;
  for (let r = r0; r <= r1; r += 1) {
    for (let c = c0; c <= c1; c += 1) {
      const value = matrix[r]?.[c];
      if (typeof value === "number" && Number.isFinite(value)) {
        sum += value;
        numeric += 1;
      } else if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) {
        sum += Number(value);
        numeric += 1;
      }
    }
  }
  return {
    cells,
    rows,
    cols,
    sum: numeric > 0 ? sum : null,
    coord: `${r0 + 1}:${c0 + 1}`,
  };
}

function extractMatrix(
  matrix: unknown[][],
  columns: string[],
  range: CellRange,
): { columns: string[]; rows: unknown[][] } {
  const { r0, r1, c0, c1 } = normalizeRange(range);
  const selectedColumns = columns.slice(c0, c1 + 1);
  const rows: unknown[][] = [];
  for (let r = r0; r <= r1; r += 1) {
    rows.push((matrix[r] ?? []).slice(c0, c1 + 1));
  }
  return { columns: selectedColumns, rows };
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function escapeCsv(value: string, delimiter: string): string {
  if (
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r") ||
    value.includes(delimiter)
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function delimited(
  columns: string[],
  rows: unknown[][],
  delimiter: string,
  includeHeader: boolean,
): string {
  const lines: string[] = [];
  if (includeHeader) {
    lines.push(columns.map((col) => escapeCsv(col, delimiter)).join(delimiter));
  }
  for (const row of rows) {
    lines.push(
      row
        .map((cell) => escapeCsv(formatCell(cell), delimiter))
        .join(delimiter),
    );
  }
  return lines.join("\n");
}

function asJson(columns: string[], rows: unknown[][]): string {
  const objects = rows.map((row) => {
    const item: Record<string, unknown> = {};
    columns.forEach((column, index) => {
      item[column] = row[index] ?? null;
    });
    return item;
  });
  return JSON.stringify(objects, null, 2);
}

function asMarkdown(
  columns: string[],
  rows: unknown[][],
  includeHeader: boolean,
): string {
  const body = rows.map(
    (row) =>
      `| ${row.map((cell) => formatCell(cell).replace(/\|/g, "\\|")).join(" | ")} |`,
  );
  if (!includeHeader) return body.join("\n");
  const header = `| ${columns.join(" | ")} |`;
  const sep = `| ${columns.map(() => "---").join(" | ")} |`;
  return [header, sep, ...body].join("\n");
}

function asOneRow(rows: unknown[][]): string {
  const values: string[] = [];
  for (const row of rows) {
    for (const cell of row) values.push(formatCell(cell));
  }
  return values.join(", ");
}

function asSqlInserts(options: {
  driver: ConnectionProfile["driver"];
  schema?: string;
  table?: string;
  columns: string[];
  rows: unknown[][];
}): string {
  const table =
    options.schema && options.table
      ? qualifyTable(options.driver, options.schema, options.table)
      : quoteIdent(options.driver, options.table || "table");
  const cols = options.columns
    .map((name) => quoteIdent(options.driver, name))
    .join(", ");
  return options.rows
    .map((row) => {
      const vals = row.map(sqlLiteral).join(", ");
      return `INSERT INTO ${table} (${cols}) VALUES (${vals});`;
    })
    .join("\n");
}

function asSqlUpdates(options: {
  driver: ConnectionProfile["driver"];
  schema?: string;
  table?: string;
  columns: string[];
  allColumns: string[];
  fullRows: unknown[][];
  range: NormalizedRange;
  pkColumns: string[];
}): string {
  const table =
    options.schema && options.table
      ? qualifyTable(options.driver, options.schema, options.table)
      : quoteIdent(options.driver, options.table || "table");

  const statements: string[] = [];
  for (let r = options.range.r0; r <= options.range.r1; r += 1) {
    const full = options.fullRows[r] ?? [];
    const sets = options.columns
      .map((name, offset) => {
        const colIndex = options.range.c0 + offset;
        return `${quoteIdent(options.driver, name)} = ${sqlLiteral(full[colIndex])}`;
      })
      .join(", ");

    let where: string;
    if (options.pkColumns.length > 0) {
      where = options.pkColumns
        .map((name) => {
          const index = options.allColumns.indexOf(name);
          return `${quoteIdent(options.driver, name)} = ${sqlLiteral(full[index])}`;
        })
        .join(" AND ");
    } else {
      // Fallback: WHERE on all non-selected columns if possible, else selected.
      where = options.allColumns
        .map((name, index) => {
          if (index >= options.range.c0 && index <= options.range.c1) return null;
          return `${quoteIdent(options.driver, name)} = ${sqlLiteral(full[index])}`;
        })
        .filter(Boolean)
        .join(" AND ");
      if (!where) {
        where = options.columns
          .map((name, offset) => {
            const colIndex = options.range.c0 + offset;
            return `${quoteIdent(options.driver, name)} = ${sqlLiteral(full[colIndex])}`;
          })
          .join(" AND ");
      }
    }
    statements.push(`UPDATE ${table} SET ${sets} WHERE ${where};`);
  }
  return statements.join("\n");
}

function asWhereClause(options: {
  driver: ConnectionProfile["driver"];
  columns: string[];
  rows: unknown[][];
}): string {
  if (options.columns.length === 1) {
    const values = [
      ...new Set(options.rows.map((row) => sqlLiteral(row[0]))),
    ];
    const col = quoteIdent(options.driver, options.columns[0]);
    if (values.length === 1) return `${col} = ${values[0]}`;
    return `${col} IN (${values.join(", ")})`;
  }

  const parts = options.rows.map((row) => {
    const ands = options.columns
      .map(
        (name, index) =>
          `${quoteIdent(options.driver, name)} = ${sqlLiteral(row[index])}`,
      )
      .join(" AND ");
    return `(${ands})`;
  });
  return parts.join("\nOR ");
}

export function extractSelection(options: {
  extractor: ExtractorId;
  driver: ConnectionProfile["driver"];
  schema?: string;
  table?: string;
  columns: string[];
  matrix: unknown[][];
  range: CellRange;
  pkColumns?: string[];
  includeHeader?: boolean;
}): string {
  const extracted = extractMatrix(options.matrix, options.columns, options.range);
  const includeHeader = options.includeHeader ?? false;

  switch (options.extractor) {
    case "csv":
      return delimited(extracted.columns, extracted.rows, ",", includeHeader);
    case "tsv":
      return delimited(extracted.columns, extracted.rows, "\t", includeHeader);
    case "pipe":
      return delimited(extracted.columns, extracted.rows, "|", includeHeader);
    case "json":
      return asJson(extracted.columns, extracted.rows);
    case "markdown":
      return asMarkdown(extracted.columns, extracted.rows, includeHeader);
    case "one-row":
      return asOneRow(extracted.rows);
    case "sql-inserts":
      return asSqlInserts({
        driver: options.driver,
        schema: options.schema,
        table: options.table,
        columns: extracted.columns,
        rows: extracted.rows,
      });
    case "sql-updates":
      return asSqlUpdates({
        driver: options.driver,
        schema: options.schema,
        table: options.table,
        columns: extracted.columns,
        allColumns: options.columns,
        fullRows: options.matrix,
        range: normalizeRange(options.range),
        pkColumns: options.pkColumns ?? [],
      });
    case "where-clause":
      return asWhereClause({
        driver: options.driver,
        columns: extracted.columns,
        rows: extracted.rows,
      });
    default:
      return delimited(extracted.columns, extracted.rows, "\t", includeHeader);
  }
}

export async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

/** Parse spreadsheet clipboard text (TSV preferred, CSV fallback). */
export function parseClipboardMatrix(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const trimmed = normalized.replace(/\n+$/, "");
  if (!trimmed) return [[""]];

  const useTabs = trimmed.includes("\t");
  const lines = trimmed.split("\n");
  return lines.map((line) => {
    if (useTabs) return line.split("\t");
    return splitCsvLine(line);
  });
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      cells.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells;
}

export interface PastePlan {
  /** Values to write: list of {row, col, raw} in visible-matrix coordinates. */
  writes: Array<{ row: number; col: number; raw: string }>;
  /** Selection covering the written area. */
  range: CellRange;
}

/**
 * Build paste writes for a selection.
 * - Single clipboard cell → fills every selected cell
 * - Multi-cell clipboard into multi-cell selection → tiles across the selection
 * - Multi-cell clipboard into a single cell → expands down/right from that cell
 */
export function planPaste(options: {
  clipboard: string[][];
  selection: CellRange;
  rowCount: number;
  colCount: number;
}): PastePlan {
  const paste = options.clipboard.length
    ? options.clipboard
    : [[""]];
  const pasteRows = Math.max(1, paste.length);
  const pasteCols = Math.max(1, ...paste.map((row) => row.length));
  const normalized = normalizeRange(options.selection);
  const selRows = normalized.r1 - normalized.r0 + 1;
  const selCols = normalized.c1 - normalized.c0 + 1;
  const singleClipboard = pasteRows === 1 && pasteCols === 1;
  const singleSelection = selRows === 1 && selCols === 1;

  let r0 = normalized.r0;
  let c0 = normalized.c0;
  let r1: number;
  let c1: number;

  if (singleSelection && !singleClipboard) {
    r1 = Math.min(options.rowCount - 1, r0 + pasteRows - 1);
    c1 = Math.min(options.colCount - 1, c0 + pasteCols - 1);
  } else {
    r1 = normalized.r1;
    c1 = normalized.c1;
  }

  const writes: PastePlan["writes"] = [];
  for (let r = r0; r <= r1; r += 1) {
    for (let c = c0; c <= c1; c += 1) {
      const pr = (r - r0) % pasteRows;
      const pc = (c - c0) % pasteCols;
      const raw = paste[pr]?.[pc] ?? "";
      writes.push({ row: r, col: c, raw });
    }
  }

  return {
    writes,
    range: {
      anchor: { row: r0, col: c0 },
      focus: { row: r1, col: c1 },
    },
  };
}

