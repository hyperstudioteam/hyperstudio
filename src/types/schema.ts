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

export interface SchemaNode {
  name: string;
  isSystem?: boolean;
  /** null means tables have not been loaded/cached yet. */
  tables: TableNode[] | null;
}

export interface ConnectionSchemaCache {
  schemas: SchemaInfo[];
  /** schema name -> tables (with columns) */
  tablesBySchema: Record<string, TableNode[]>;
}
