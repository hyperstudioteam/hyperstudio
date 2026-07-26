import { databaseApi } from "../api/database";
import { ConnectionProfile } from "../types/connection";
import { QueryResult } from "../types/query";
import { quoteIdent, sqlLiteral } from "./sql";

export type ExportFormat = "csv" | "tsv" | "json" | "sql";

export const EXPORT_FORMATS: Array<{
  id: ExportFormat;
  label: string;
  extension: string;
}> = [
  { id: "csv", label: "CSV", extension: "csv" },
  { id: "tsv", label: "TSV", extension: "tsv" },
  { id: "json", label: "JSON", extension: "json" },
  { id: "sql", label: "SQL Inserts", extension: "sql" },
];

export function extensionFor(format: ExportFormat): string {
  return EXPORT_FORMATS.find((item) => item.id === format)?.extension ?? "txt";
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function escapeDelimited(value: string, delimiter: string): string {
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

function delimitedRows(rows: unknown[][], delimiter: string): string {
  return rows
    .map((row) =>
      row.map((cell) => escapeDelimited(cellText(cell), delimiter)).join(delimiter),
    )
    .join("\n");
}

function jsonRows(columns: string[], rows: unknown[][]): string {
  return rows
    .map((row) => {
      const item: Record<string, unknown> = {};
      columns.forEach((column, index) => {
        item[column] = row[index] ?? null;
      });
      return `  ${JSON.stringify(item)}`;
    })
    .join(",\n");
}

function insertRows(
  driver: ConnectionProfile["driver"],
  target: string,
  columns: string[],
  rows: unknown[][],
): string {
  const cols = columns.map((name) => quoteIdent(driver, name)).join(", ");
  return rows
    .map(
      (row) =>
        `INSERT INTO ${target} (${cols}) VALUES (${row.map(sqlLiteral).join(", ")});`,
    )
    .join("\n");
}

export interface ExportChunkContext {
  format: ExportFormat;
  driver: ConnectionProfile["driver"];
  /** Qualified table name used for SQL inserts. */
  target: string;
  includeHeader: boolean;
  columns: string[];
  /** True for the first written chunk, which owns headers and JSON's opening. */
  first: boolean;
}

/** Format one page of rows, including any separators it needs from the previous page. */
export function formatChunk(
  rows: unknown[][],
  context: ExportChunkContext,
): string {
  const { format, columns, first, includeHeader } = context;

  if (format === "csv" || format === "tsv") {
    const delimiter = format === "csv" ? "," : "\t";
    const parts: string[] = [];
    if (first && includeHeader) {
      parts.push(
        columns.map((col) => escapeDelimited(col, delimiter)).join(delimiter),
      );
    }
    if (rows.length > 0) parts.push(delimitedRows(rows, delimiter));
    const body = parts.join("\n");
    return first ? body : body ? `\n${body}` : "";
  }

  if (format === "json") {
    const body = jsonRows(columns, rows);
    if (first) return `[\n${body}`;
    return body ? `,\n${body}` : "";
  }

  const body = insertRows(context.driver, context.target, columns, rows);
  if (first) return body;
  return body ? `\n${body}` : "";
}

/** Trailing text needed to close the document, if any. */
export function closingChunk(format: ExportFormat): string {
  if (format === "json") return "\n]\n";
  return "\n";
}

export interface ExportRequest {
  path: string;
  format: ExportFormat;
  driver: ConnectionProfile["driver"];
  target: string;
  includeHeader: boolean;
  /** Runs one page and resolves with its rows; null means no more pages. */
  fetchPage: (page: number) => Promise<QueryResult | null>;
  /** Rows per page; the loop stops early when a page returns fewer. */
  pageSize: number;
  /** Hard ceiling so a runaway query cannot fill the disk. */
  maxRows?: number;
  onProgress?: (rowsWritten: number) => void;
}

export interface ExportOutcome {
  rows: number;
  truncated: boolean;
}

/**
 * Stream a result set to disk one page at a time.
 *
 * Rows never accumulate in memory beyond a single page, so exporting a large
 * table stays bounded regardless of its size.
 */
export async function exportResultSet(
  request: ExportRequest,
): Promise<ExportOutcome> {
  const limit = request.maxRows ?? Number.POSITIVE_INFINITY;
  let page = 0;
  let written = 0;
  let first = true;
  let columns: string[] = [];
  let truncated = false;

  for (;;) {
    const result = await request.fetchPage(page);
    if (!result) break;
    if (columns.length === 0) columns = result.columns;

    let rows = result.rows;
    if (written + rows.length > limit) {
      rows = rows.slice(0, Math.max(0, limit - written));
      truncated = true;
    }

    const chunk = formatChunk(rows, {
      format: request.format,
      driver: request.driver,
      target: request.target,
      includeHeader: request.includeHeader,
      columns,
      first,
    });

    if (chunk || first) {
      await databaseApi.writeExportChunk(request.path, chunk, !first);
      first = false;
    }

    written += rows.length;
    request.onProgress?.(written);

    if (truncated || result.rows.length < request.pageSize) break;
    page += 1;
  }

  if (first) {
    // Nothing was written yet, so the file does not exist. Create it empty.
    await databaseApi.writeExportChunk(
      request.path,
      formatChunk([], {
        format: request.format,
        driver: request.driver,
        target: request.target,
        includeHeader: request.includeHeader,
        columns,
        first: true,
      }),
      false,
    );
  }

  await databaseApi.writeExportChunk(
    request.path,
    closingChunk(request.format),
    true,
  );

  return { rows: written, truncated };
}
