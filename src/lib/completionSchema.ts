import { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import {
  MSSQL,
  MySQL,
  PostgreSQL,
  SQLDialect,
  SQLNamespace,
  SQLite,
  StandardSQL,
} from "@codemirror/lang-sql";
import { ConnectionProfile } from "../types/connection";
import { ObjectNode, SchemaNode, TABLES_GROUP } from "../types/schema";
import { objectGroupsFor } from "./driverGroups";

/** Object groups whose members can appear in a FROM clause. */
const QUERYABLE_GROUPS = [TABLES_GROUP, "views", "materialized_views"];

/** The queryable groups this driver actually exposes. */
export function completionGroupsFor(driver: string): string[] {
  const available = new Set(objectGroupsFor(driver).map((group) => group.id));
  return QUERYABLE_GROUPS.filter((group) => available.has(group));
}

export function dialectFor(driver: string): SQLDialect {
  switch (driver) {
    case "postgres":
    case "postgresql":
    case "redshift":
    case "cockroach":
      return PostgreSQL;
    case "mysql":
    case "mariadb":
      return MySQL;
    case "sqlite":
      return SQLite;
    case "mssql":
    case "sqlserver":
      return MSSQL;
    default:
      return StandardSQL;
  }
}

function columnCompletion(column: ObjectNode["children"][number]): Completion {
  const parts = [column.dataType];
  if (column.primaryKey) parts.push("PK");
  else if (!column.nullable) parts.push("not null");
  return {
    label: column.name,
    type: column.primaryKey ? "constant" : "property",
    detail: parts.filter(Boolean).join(" · "),
  };
}

function objectCompletion(object: ObjectNode, kindLabel: string): Completion {
  return {
    label: object.name,
    type: kindLabel === "view" ? "class" : "type",
    detail: object.detail || object.kind || kindLabel,
  };
}

function queryableObjects(schema: SchemaNode): Array<[ObjectNode, string]> {
  const found: Array<[ObjectNode, string]> = [];
  for (const group of QUERYABLE_GROUPS) {
    const objects = schema.objects[group];
    if (!objects) continue;
    const kindLabel = group === TABLES_GROUP ? "table" : "view";
    for (const object of objects) found.push([object, kindLabel]);
  }
  return found;
}

/**
 * The schema a bare table name resolves to, so `users` completes without
 * requiring a `public.` prefix.
 */
export function defaultSchemaFor(
  profile: ConnectionProfile,
  schemas: SchemaNode[],
): string | undefined {
  const names = schemas.map((schema) => schema.name);
  if (names.length === 0) return undefined;
  if (names.includes(profile.database)) return profile.database;
  if (profile.driver === "postgres" && names.includes("public")) return "public";
  const firstUserSchema = schemas.find((schema) => !schema.isSystem);
  return (firstUserSchema ?? schemas[0]).name;
}

/**
 * Convert cached schema metadata into the nested namespace CodeMirror's SQL
 * completion expects: schema -> table -> columns.
 *
 * Schemas whose objects have not been loaded yet still contribute their name,
 * so typing `analytics.` at least resolves the prefix.
 *
 * Table names are also registered under lowercase keys so MySQL-style
 * case-insensitive matching still resolves `OfferLetter` / `offerletter`.
 */
export function buildCompletionSchema(schemas: SchemaNode[]): SQLNamespace {
  const namespace: Record<string, SQLNamespace> = {};

  for (const schema of schemas) {
    const tables: Record<string, SQLNamespace> = {};

    for (const [object, kindLabel] of queryableObjects(schema)) {
      const entry = {
        self: objectCompletion(object, kindLabel),
        children: object.children.map(columnCompletion),
      };
      tables[object.name] = entry;
      const lower = object.name.toLowerCase();
      if (lower !== object.name && !tables[lower]) {
        tables[lower] = entry;
      }
    }

    namespace[schema.name] = {
      self: {
        label: schema.name,
        type: "namespace",
        detail: schema.isSystem ? "system schema" : "schema",
      },
      children: tables,
    };
    const lowerSchema = schema.name.toLowerCase();
    if (lowerSchema !== schema.name && !namespace[lowerSchema]) {
      namespace[lowerSchema] = namespace[schema.name];
    }
  }

  return namespace;
}

/** True when at least one table with columns is available to complete. */
export function hasCompletionData(schemas: SchemaNode[]): boolean {
  return schemas.some((schema) => queryableObjects(schema).length > 0);
}

function findTable(
  schemas: SchemaNode[],
  tableName: string,
  schemaName: string | undefined,
  defaultSchema: string | undefined,
): ObjectNode | null {
  const needle = tableName.toLowerCase();
  const schemaNeedle = schemaName?.toLowerCase();
  const candidates = schemaNeedle
    ? schemas.filter((schema) => schema.name.toLowerCase() === schemaNeedle)
    : defaultSchema
      ? [
          ...schemas.filter(
            (schema) => schema.name.toLowerCase() === defaultSchema.toLowerCase(),
          ),
          ...schemas,
        ]
      : schemas;

  for (const schema of candidates) {
    for (const [object] of queryableObjects(schema)) {
      if (object.name.toLowerCase() === needle) return object;
    }
  }
  return null;
}

/**
 * Collect table references from the FROM clause of the statement that
 * contains `pos`. Handles `schema.table`, aliases, and comma / JOIN lists.
 */
export function tablesInFromClause(
  doc: string,
  pos: number,
): Array<{ schema?: string; table: string }> {
  const statementStart = doc.lastIndexOf(";", pos - 1) + 1;
  const nextSemi = doc.indexOf(";", pos);
  const statement = doc.slice(
    statementStart,
    nextSemi === -1 ? doc.length : nextSemi,
  );
  const fromMatch = statement.match(
    /\bfrom\b([\s\S]*?)(?=\bwhere\b|\bgroup\s+by\b|\bhaving\b|\border\s+by\b|\blimit\b|\bunion\b|\bfor\b|\breturning\b|$)/i,
  );
  if (!fromMatch) return [];

  const fromClause = fromMatch[1];
  const tables: Array<{ schema?: string; table: string }> = [];
  const seen = new Set<string>();
  const pattern =
    /(?:`([^`]+)`|"([^"]+)"|\[([^\]]+)\]|([A-Za-z_][\w$]*))(?:\s*\.\s*(?:`([^`]+)`|"([^"]+)"|\[([^\]]+)\]|([A-Za-z_][\w$]*)))?/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(fromClause))) {
    const first = match[1] ?? match[2] ?? match[3] ?? match[4];
    const second = match[5] ?? match[6] ?? match[7] ?? match[8];
    if (!first) continue;
    const keyword = first.toLowerCase();
    if (
      keyword === "as" ||
      keyword === "on" ||
      keyword === "join" ||
      keyword === "inner" ||
      keyword === "left" ||
      keyword === "right" ||
      keyword === "full" ||
      keyword === "cross" ||
      keyword === "outer" ||
      keyword === "and" ||
      keyword === "or" ||
      keyword === "using"
    ) {
      continue;
    }
    const table = second ? { schema: first, table: second } : { table: first };
    const key = `${table.schema ?? ""}.${table.table}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tables.push(table);
  }
  return tables;
}

/**
 * Suggest columns from tables referenced in the current FROM clause as bare
 * identifiers (CodeMirror's built-in schema completion only offers them after
 * `table.` / `alias.`).
 */
export function fromClauseColumnCompletionSource(
  schemas: SchemaNode[],
  defaultSchema?: string,
) {
  return (context: CompletionContext): CompletionResult | null => {
    if (context.matchBefore(/(\.|`|"|\[)\w*$/)) return null;
    const typed = context.matchBefore(/[A-Za-z_][\w$]*$/);
    if (!typed && !context.explicit) return null;

    const tables = tablesInFromClause(context.state.doc.toString(), context.pos);
    if (tables.length === 0) return null;

    const options: Completion[] = [];
    const seen = new Set<string>();
    for (const ref of tables) {
      const object = findTable(schemas, ref.table, ref.schema, defaultSchema);
      if (!object) continue;
      for (const column of object.children) {
        const key = column.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        options.push({
          ...columnCompletion(column),
          boost: 2,
        });
      }
    }
    if (options.length === 0) return null;
    return {
      from: typed?.from ?? context.pos,
      options,
      validFor: /^[\w$]*$/,
    };
  };
}
