export interface SchemaInfo {
  name: string;
  isSystem: boolean;
}

export interface ColumnNode {
  name: string;
  dataType: string;
  nullable: boolean;
  primaryKey?: boolean;
  defaultValue?: string | null;
  comment?: string | null;
  autoIncrement?: boolean;
}

export interface TableColumnChange {
  action: "add" | "modify" | "drop" | string;
  name: string;
  newName?: string | null;
  dataType?: string | null;
  nullable?: boolean | null;
  defaultValue?: string | null;
  clearDefault?: boolean;
  comment?: string | null;
  autoIncrement?: boolean | null;
  onUpdate?: string | null;
  collation?: string | null;
}

export interface TableKeyChange {
  action: "add" | "modify" | "drop" | string;
  name?: string | null;
  newName?: string | null;
  kind: "PRIMARY KEY" | "UNIQUE" | string;
  columns: string[];
}

export interface TableIndexChange {
  action: "add" | "modify" | "drop" | string;
  name?: string | null;
  newName?: string | null;
  unique?: boolean;
  method?: string | null;
  columns: string[];
}

export interface AlterTableRequest {
  schema: string;
  table: string;
  newName?: string | null;
  columns?: TableColumnChange[];
  keys?: TableKeyChange[];
  indexes?: TableIndexChange[];
}

export interface AlterColumnRequest {
  schema: string;
  table: string;
  column: string;
  newName?: string | null;
  dataType?: string | null;
  nullable?: boolean | null;
  defaultValue?: string | null;
  clearDefault?: boolean;
  comment?: string | null;
  autoIncrement?: boolean | null;
  onUpdate?: string | null;
  collation?: string | null;
}

export interface AlterKeyRequest {
  schema: string;
  table: string;
  name?: string | null;
  newName?: string | null;
  kind?: string | null;
  columns?: string[] | null;
  drop?: boolean;
}

export interface TableNode {
  name: string;
  kind: string;
  columns: ColumnNode[];
}

export interface ObjectSubgroupDef {
  id: string;
  label: string;
  icon?: string | null;
}

/**
 * A category of objects a driver exposes under a schema. Drivers declare
 * their own set, so the tree can show routines and triggers for MySQL or
 * synonyms and aliases for Typesense without the UI knowing what those are.
 */
export interface ObjectGroupDef {
  id: string;
  label: string;
  icon?: string | null;
  /** Heading for an object's children, e.g. "Columns" or "Parameters". */
  childLabel?: string | null;
  actions: string[];
  defaultOpen: boolean;
  /** Lazily loaded folders beneath each object in this group. */
  objectSubgroups?: ObjectSubgroupDef[];
}

export interface ObjectNode {
  name: string;
  kind: string;
  detail?: string | null;
  children: ColumnNode[];
  /** Overrides the group's actions when present. */
  actions?: string[] | null;
}

/** Objects keyed by group id. A missing key means "not loaded yet". */
export type ObjectsByGroup = Record<string, ObjectNode[]>;

export interface SchemaNode {
  name: string;
  isSystem?: boolean;
  objects: ObjectsByGroup;
}

export interface ConnectionSchemaCache {
  schemas: SchemaInfo[];
  /** schema name -> group id -> objects */
  objectsBySchema: Record<string, ObjectsByGroup>;
  /** Postgres: databases known for this connection (for offline/cached tree). */
  databases?: SchemaInfo[];
  /** Database that `schemas` / objects currently describe. */
  activeDatabase?: string;
}

export const TABLES_GROUP = "tables";

export function tableFromObject(object: ObjectNode): TableNode {
  return {
    name: object.name,
    kind: object.kind || "BASE TABLE",
    columns: object.children,
  };
}
