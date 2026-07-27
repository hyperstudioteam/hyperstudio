import { sqlLiteral } from "./sql";

export interface QueryParam {
  /** 1-based index among top-level `?` placeholders. */
  index: number;
  /** Character offset of this `?` in the source SQL. */
  offset: number;
  /** Inferred field name, e.g. `id` from `WHERE id = ?`. */
  label: string;
}

const SQL_KEYWORDS = new Set([
  "and",
  "or",
  "not",
  "is",
  "in",
  "between",
  "like",
  "ilike",
  "null",
  "true",
  "false",
  "asc",
  "desc",
  "on",
  "as",
  "by",
  "from",
  "where",
  "having",
  "limit",
  "offset",
  "case",
  "when",
  "then",
  "else",
  "end",
  "exists",
  "any",
  "all",
  "some",
]);

const COMPARISON_OPS = ["<>", "!=", "<=", ">=", "||", "=", "<", ">"];

function readIdentifierEndingAt(sql: string, end: number): string | null {
  const char = sql[end];
  if (char === '"' || char === "`" || char === "'") {
    let cursor = end - 1;
    while (cursor >= 0) {
      if (sql[cursor] === char) {
        if (cursor > 0 && sql[cursor - 1] === char) {
          cursor -= 2;
          continue;
        }
        const name = sql.slice(cursor + 1, end);
        return name || null;
      }
      cursor -= 1;
    }
    return null;
  }

  if (!/[A-Za-z0-9_]/.test(char)) return null;

  let start = end;
  while (start >= 0 && /[A-Za-z0-9_.]/.test(sql[start])) start -= 1;
  start += 1;
  const raw = sql.slice(start, end + 1);
  const last = raw.split(".").pop() ?? "";
  return last || null;
}

function inferParamLabel(sql: string, offset: number): string {
  let cursor = offset - 1;
  while (cursor >= 0 && /\s/.test(sql[cursor])) cursor -= 1;
  if (cursor < 0) return "";

  for (const op of COMPARISON_OPS) {
    const start = cursor - op.length + 1;
    if (start >= 0 && sql.slice(start, cursor + 1) === op) {
      cursor = start - 1;
      break;
    }
  }

  while (cursor >= 0 && /\s/.test(sql[cursor])) cursor -= 1;
  if (cursor < 0) return "";

  const name = readIdentifierEndingAt(sql, cursor);
  if (!name || SQL_KEYWORDS.has(name.toLowerCase())) return "";
  return name;
}

function paramLabel(sql: string, offset: number, index: number): string {
  return inferParamLabel(sql, offset) || `Parameter ${index}`;
}

/**
 * Find top-level `?` placeholders, skipping strings, comments, and
 * dollar-quoted blocks (same rules as statement splitting).
 */
export function findQueryParams(sql: string): QueryParam[] {
  const params: QueryParam[] = [];
  let index = 0;
  const length = sql.length;

  while (index < length) {
    const char = sql[index];
    const next = sql[index + 1];

    if (char === "-" && next === "-") {
      const end = sql.indexOf("\n", index);
      index = end === -1 ? length : end;
      continue;
    }

    if (char === "/" && next === "*") {
      const end = sql.indexOf("*/", index + 2);
      index = end === -1 ? length : end + 2;
      continue;
    }

    if (char === "$") {
      const tagMatch = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(
        sql.slice(index),
      );
      if (tagMatch) {
        const tag = tagMatch[0];
        const end = sql.indexOf(tag, index + tag.length);
        index = end === -1 ? length : end + tag.length;
        continue;
      }
    }

    if (char === "'" || char === '"' || char === "`") {
      let cursor = index + 1;
      while (cursor < length) {
        const inner = sql[cursor];
        if (inner === "\\" && (char === "'" || char === '"')) {
          cursor += 2;
          continue;
        }
        if (inner === char) {
          if (sql[cursor + 1] === char) {
            cursor += 2;
            continue;
          }
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      index = cursor;
      continue;
    }

    if (char === "?") {
      const paramIndex = params.length + 1;
      params.push({
        index: paramIndex,
        offset: index,
        label: paramLabel(sql, index, paramIndex),
      });
      index += 1;
      continue;
    }

    index += 1;
  }

  return params;
}

/** Coerce a modal text value into a JS value for `sqlLiteral`. */
export function coerceParamValue(
  text: string,
  isNull: boolean,
): unknown {
  if (isNull) return null;
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Parameter value is required (or mark as NULL).");
  }
  if (/^true$/i.test(trimmed)) return true;
  if (/^false$/i.test(trimmed)) return false;
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    if (Number.isFinite(num)) return num;
  }
  return trimmed;
}

/**
 * Replace top-level `?` placeholders with SQL literals from `values`
 * (same order as `findQueryParams`).
 */
export function bindQueryParams(sql: string, values: unknown[]): string {
  const params = findQueryParams(sql);
  if (params.length === 0) return sql;
  if (values.length !== params.length) {
    throw new Error(
      `Expected ${params.length} parameter value(s), got ${values.length}.`,
    );
  }

  let result = "";
  let last = 0;
  for (let i = 0; i < params.length; i += 1) {
    const offset = params[i].offset;
    result += sql.slice(last, offset);
    result += sqlLiteral(values[i]);
    last = offset + 1;
  }
  result += sql.slice(last);
  return result;
}

export interface ParamValueEntry {
  text: string;
  isNull: boolean;
}

const PARAM_VALUES_KEY = "hyperstudio.query-param-values.v1";

function paramMemoryKey(param: QueryParam): string {
  return `${param.index}:${param.label.toLowerCase()}`;
}

function readParamMemory(): Record<string, ParamValueEntry> {
  try {
    const raw = localStorage.getItem(PARAM_VALUES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, ParamValueEntry>)
      : {};
  } catch {
    return {};
  }
}

function writeParamMemory(memory: Record<string, ParamValueEntry>) {
  try {
    localStorage.setItem(PARAM_VALUES_KEY, JSON.stringify(memory));
  } catch {
    // ignore quota / private-mode failures
  }
}

/** Restore remembered text/NULL flags for the given placeholders. */
export function recallParamEntries(params: QueryParam[]): ParamValueEntry[] {
  const memory = readParamMemory();
  return params.map((param) => {
    const saved = memory[paramMemoryKey(param)];
    if (!saved) return { text: "", isNull: false };
    return {
      text: typeof saved.text === "string" ? saved.text : "",
      isNull: Boolean(saved.isNull),
    };
  });
}

/** Persist the latest values so the next run of similar params is pre-filled. */
export function rememberParamEntries(
  params: QueryParam[],
  entries: ParamValueEntry[],
) {
  const memory = readParamMemory();
  for (let i = 0; i < params.length; i += 1) {
    const entry = entries[i];
    if (!entry) continue;
    memory[paramMemoryKey(params[i])] = {
      text: entry.text,
      isNull: entry.isNull,
    };
  }
  writeParamMemory(memory);
}
