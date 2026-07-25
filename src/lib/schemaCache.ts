import { ConnectionProfile } from "../types/connection";
import { ConnectionSchemaCache, SchemaInfo, SchemaNode, TableNode } from "../types/schema";

const STORAGE_KEY = "hypergrid.schema-cache.v1";

const cacheByConnection = new Map<string, ConnectionSchemaCache>();

function hydrate() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, ConnectionSchemaCache>;
    if (!parsed || typeof parsed !== "object") return;
    for (const [connectionId, cache] of Object.entries(parsed)) {
      if (!cache || !Array.isArray(cache.schemas)) continue;
      cacheByConnection.set(connectionId, {
        schemas: cache.schemas,
        tablesBySchema:
          cache.tablesBySchema && typeof cache.tablesBySchema === "object"
            ? cache.tablesBySchema
            : {},
      });
    }
  } catch {
    // Ignore corrupt cache and start fresh.
  }
}

function persist() {
  const payload: Record<string, ConnectionSchemaCache> = {};
  for (const [connectionId, cache] of cacheByConnection.entries()) {
    payload[connectionId] = cache;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

hydrate();

export function getSchemaCache(
  connectionId: string,
): ConnectionSchemaCache | null {
  return cacheByConnection.get(connectionId) ?? null;
}

export function hasSchemaCache(connectionId: string): boolean {
  const cache = cacheByConnection.get(connectionId);
  return Boolean(cache && cache.schemas.length > 0);
}

export function setSchemaList(connectionId: string, schemas: SchemaInfo[]) {
  const existing = cacheByConnection.get(connectionId);
  const keptTables: Record<string, TableNode[]> = {};
  const names = new Set(schemas.map((schema) => schema.name));
  if (existing) {
    for (const [name, tables] of Object.entries(existing.tablesBySchema)) {
      if (names.has(name)) keptTables[name] = tables;
    }
  }
  cacheByConnection.set(connectionId, {
    schemas,
    tablesBySchema: keptTables,
  });
  persist();
}

export function setSchemaTables(
  connectionId: string,
  schema: string,
  tables: TableNode[],
) {
  const existing = cacheByConnection.get(connectionId) ?? {
    schemas: [],
    tablesBySchema: {},
  };
  cacheByConnection.set(connectionId, {
    ...existing,
    tablesBySchema: {
      ...existing.tablesBySchema,
      [schema]: tables,
    },
  });
  persist();
}

export function clearSchemaTables(connectionId: string, schema?: string) {
  const existing = cacheByConnection.get(connectionId);
  if (!existing) return;
  if (!schema) {
    cacheByConnection.set(connectionId, {
      schemas: existing.schemas,
      tablesBySchema: {},
    });
    persist();
    return;
  }
  const next = { ...existing.tablesBySchema };
  delete next[schema];
  cacheByConnection.set(connectionId, {
    schemas: existing.schemas,
    tablesBySchema: next,
  });
  persist();
}

export function clearConnectionCache(connectionId: string) {
  cacheByConnection.delete(connectionId);
  persist();
}

export function filterSchemasForProfile(
  schemas: SchemaInfo[],
  profile: ConnectionProfile,
): SchemaInfo[] {
  if (profile.allSchemas) return schemas;
  if (profile.schemas.length === 0) {
    const current = schemas.find((schema) => schema.name === profile.database);
    return current ? [current] : schemas.filter((schema) => !schema.isSystem);
  }
  const selected = new Set(profile.schemas);
  return schemas.filter((schema) => selected.has(schema.name));
}

export function toSchemaNodes(cache: ConnectionSchemaCache | null): SchemaNode[] {
  if (!cache) return [];
  return cache.schemas.map((schema) => ({
    name: schema.name,
    isSystem: schema.isSystem,
    tables: Object.prototype.hasOwnProperty.call(
      cache.tablesBySchema,
      schema.name,
    )
      ? cache.tablesBySchema[schema.name]
      : null,
  }));
}
