import { Completion } from "@codemirror/autocomplete";
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
 */
export function buildCompletionSchema(schemas: SchemaNode[]): SQLNamespace {
  const namespace: Record<string, SQLNamespace> = {};

  for (const schema of schemas) {
    const tables: Record<string, SQLNamespace> = {};

    for (const [object, kindLabel] of queryableObjects(schema)) {
      tables[object.name] = {
        self: objectCompletion(object, kindLabel),
        children: object.children.map(columnCompletion),
      };
    }

    namespace[schema.name] = {
      self: {
        label: schema.name,
        type: "namespace",
        detail: schema.isSystem ? "system schema" : "schema",
      },
      children: tables,
    };
  }

  return namespace;
}

/** True when at least one table with columns is available to complete. */
export function hasCompletionData(schemas: SchemaNode[]): boolean {
  return schemas.some((schema) => queryableObjects(schema).length > 0);
}
