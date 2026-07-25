export interface SchemaInfo {
  name: string;
  isSystem: boolean;
}

export interface ColumnNode {
  name: string;
  dataType: string;
  nullable: boolean;
  primaryKey?: boolean;
}

export interface TableNode {
  name: string;
  kind: string;
  columns: ColumnNode[];
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
}

export const TABLES_GROUP = "tables";

export function tableFromObject(object: ObjectNode): TableNode {
  return {
    name: object.name,
    kind: object.kind || "BASE TABLE",
    columns: object.children,
  };
}
