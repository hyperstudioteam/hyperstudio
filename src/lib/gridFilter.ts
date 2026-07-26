import { ConnectionProfile } from "../types/connection";
import { quoteIdent, sqlLiteral } from "./sql";

export type SortDirection = "asc" | "desc";

export interface ColumnSort {
  column: string;
  direction: SortDirection;
}

export type FilterOperator =
  | "contains"
  | "equals"
  | "notEquals"
  | "gt"
  | "lt"
  | "isNull"
  | "notNull";

export interface ColumnFilter {
  column: string;
  operator: FilterOperator;
  value: string;
}

export const FILTER_OPERATORS: Array<{
  id: FilterOperator;
  label: string;
  /** Operators that ignore the value input. */
  unary?: boolean;
}> = [
  { id: "contains", label: "contains" },
  { id: "equals", label: "=" },
  { id: "notEquals", label: "≠" },
  { id: "gt", label: ">" },
  { id: "lt", label: "<" },
  { id: "isNull", label: "is null", unary: true },
  { id: "notNull", label: "is not null", unary: true },
];

export function isUnary(operator: FilterOperator): boolean {
  return operator === "isNull" || operator === "notNull";
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function asComparable(value: unknown): number | string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  const text = cellText(value);
  if (text.trim() !== "" && !Number.isNaN(Number(text))) return Number(text);
  return text.toLowerCase();
}

function matchesFilter(value: unknown, filter: ColumnFilter): boolean {
  if (filter.operator === "isNull") return value === null || value === undefined;
  if (filter.operator === "notNull") return value !== null && value !== undefined;

  const needle = filter.value;
  if (needle === "") return true;

  const text = cellText(value).toLowerCase();
  const lowerNeedle = needle.toLowerCase();

  switch (filter.operator) {
    case "contains":
      return text.includes(lowerNeedle);
    case "equals":
      return text === lowerNeedle;
    case "notEquals":
      return text !== lowerNeedle;
    case "gt":
    case "lt": {
      const left = asComparable(value);
      const right = asComparable(needle);
      if (left === null || right === null) return false;
      if (typeof left === "number" && typeof right === "number") {
        return filter.operator === "gt" ? left > right : left < right;
      }
      const l = String(left);
      const r = String(right);
      return filter.operator === "gt" ? l > r : l < r;
    }
    default:
      return true;
  }
}

export interface GridView {
  rows: unknown[][];
  /** Index of each visible row in the source array, for edits and selection. */
  sourceIndex: number[];
}

/**
 * Apply filters and sorting to already-loaded rows.
 *
 * This is a view over the current page only; it does not re-query the server.
 */
export function applyGridView(
  columns: string[],
  rows: unknown[][],
  sort: ColumnSort | null,
  filters: ColumnFilter[],
): GridView {
  const active = filters.filter(
    (filter) => isUnary(filter.operator) || filter.value !== "",
  );

  let indexed = rows.map((row, index) => ({ row, index }));

  if (active.length > 0) {
    indexed = indexed.filter(({ row }) =>
      active.every((filter) => {
        const column = columns.indexOf(filter.column);
        if (column < 0) return true;
        return matchesFilter(row[column], filter);
      }),
    );
  }

  if (sort) {
    const column = columns.indexOf(sort.column);
    if (column >= 0) {
      const factor = sort.direction === "asc" ? 1 : -1;
      indexed = [...indexed].sort((a, b) => {
        const left = asComparable(a.row[column]);
        const right = asComparable(b.row[column]);
        // Nulls sort last regardless of direction.
        if (left === null && right === null) return 0;
        if (left === null) return 1;
        if (right === null) return -1;
        if (typeof left === "number" && typeof right === "number") {
          return (left - right) * factor;
        }
        return String(left).localeCompare(String(right)) * factor;
      });
    }
  }

  return {
    rows: indexed.map((item) => item.row),
    sourceIndex: indexed.map((item) => item.index),
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Render one filter as a SQL predicate for server-side filtering. */
export function filterToSql(
  driver: ConnectionProfile["driver"],
  filter: ColumnFilter,
): string | null {
  const column = quoteIdent(driver, filter.column);
  if (filter.operator === "isNull") return `${column} IS NULL`;
  if (filter.operator === "notNull") return `${column} IS NOT NULL`;
  if (filter.value === "") return null;

  switch (filter.operator) {
    case "contains":
      return `${column} LIKE ${sqlLiteral(`%${escapeLike(filter.value)}%`)} ESCAPE '\\'`;
    case "equals":
      return `${column} = ${sqlLiteral(filter.value)}`;
    case "notEquals":
      return `${column} <> ${sqlLiteral(filter.value)}`;
    case "gt":
      return `${column} > ${sqlLiteral(filter.value)}`;
    case "lt":
      return `${column} < ${sqlLiteral(filter.value)}`;
    default:
      return null;
  }
}

/** Combine header filters into a WHERE body, preserving any manual condition. */
export function buildWhereClause(
  driver: ConnectionProfile["driver"],
  filters: ColumnFilter[],
  manual: string,
): string {
  const parts = filters
    .map((filter) => filterToSql(driver, filter))
    .filter((part): part is string => part !== null);
  const trimmedManual = manual.trim();
  if (trimmedManual) parts.unshift(`(${trimmedManual})`);
  return parts.join(" AND ");
}

export function buildOrderByClause(
  driver: ConnectionProfile["driver"],
  sort: ColumnSort | null,
): string {
  if (!sort) return "";
  return `${quoteIdent(driver, sort.column)} ${sort.direction.toUpperCase()}`;
}

/** Cycle a header click: none -> asc -> desc -> none. */
export function nextSort(
  current: ColumnSort | null,
  column: string,
): ColumnSort | null {
  if (!current || current.column !== column) return { column, direction: "asc" };
  if (current.direction === "asc") return { column, direction: "desc" };
  return null;
}
