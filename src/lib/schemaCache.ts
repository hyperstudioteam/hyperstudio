import { ConnectionProfile } from "../types/connection";
import {
  ConnectionSchemaCache,
  ObjectNode,
  ObjectsByGroup,
  SchemaInfo,
  SchemaNode,
  TABLES_GROUP,
} from "../types/schema";

const STORAGE_KEY = "hyperstudio.schema-cache.v2";
const LEGACY_STORAGE_KEY = "hyperstudio.schema-cache.v1";

const cacheByConnection = new Map<string, ConnectionSchemaCache>();

function hydrate() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, ConnectionSchemaCache>;
      if (parsed && typeof parsed === "object") {
        for (const [connectionId, cache] of Object.entries(parsed)) {
          if (!cache || !Array.isArray(cache.schemas)) continue;
          cacheByConnection.set(connectionId, {
            schemas: cache.schemas,
            objectsBySchema:
              cache.objectsBySchema && typeof cache.objectsBySchema === "object"
                ? cache.objectsBySchema
                : {},
          });
        }
      }
      return;
    }
    hydrateLegacy();
  } catch {
    // Ignore corrupt cache and start fresh.
  }
}

/** Fold the v1 shape (tables only) into the "tables" group. */
function hydrateLegacy() {
  const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return;
  const parsed = JSON.parse(raw) as Record<
    string,
    {
      schemas?: SchemaInfo[];
      tablesBySchema?: Record<
        string,
        Array<{ name: string; kind?: string; columns?: ObjectNode["children"] }>
      >;
    }
  >;
  if (!parsed || typeof parsed !== "object") return;
  for (const [connectionId, cache] of Object.entries(parsed)) {
    if (!cache || !Array.isArray(cache.schemas)) continue;
    const objectsBySchema: Record<string, ObjectsByGroup> = {};
    for (const [schema, tables] of Object.entries(cache.tablesBySchema ?? {})) {
      objectsBySchema[schema] = {
        [TABLES_GROUP]: (tables ?? []).map((table) => ({
          name: table.name,
          kind: table.kind ?? "BASE TABLE",
          children: table.columns ?? [],
        })),
      };
    }
    cacheByConnection.set(connectionId, {
      schemas: cache.schemas,
      objectsBySchema,
    });
  }
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  persist();
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
  const kept: Record<string, ObjectsByGroup> = {};
  const names = new Set(schemas.map((schema) => schema.name));
  if (existing) {
    for (const [name, groups] of Object.entries(existing.objectsBySchema)) {
      if (names.has(name)) kept[name] = groups;
    }
  }
  cacheByConnection.set(connectionId, { schemas, objectsBySchema: kept });
  persist();
}

export function setSchemaObjects(
  connectionId: string,
  schema: string,
  group: string,
  objects: ObjectNode[],
) {
  const existing = cacheByConnection.get(connectionId) ?? {
    schemas: [],
    objectsBySchema: {},
  };
  cacheByConnection.set(connectionId, {
    ...existing,
    objectsBySchema: {
      ...existing.objectsBySchema,
      [schema]: {
        ...(existing.objectsBySchema[schema] ?? {}),
        [group]: objects,
      },
    },
  });
  persist();
}

export function hasSchemaObjects(
  connectionId: string,
  schema: string,
  group: string,
): boolean {
  const cache = cacheByConnection.get(connectionId);
  const groups = cache?.objectsBySchema[schema];
  return Boolean(
    groups && Object.prototype.hasOwnProperty.call(groups, group),
  );
}

/** Drop cached objects for one schema, one group, or the whole connection. */
export function clearSchemaObjects(
  connectionId: string,
  schema?: string,
  group?: string,
) {
  const existing = cacheByConnection.get(connectionId);
  if (!existing) return;
  if (!schema) {
    cacheByConnection.set(connectionId, {
      schemas: existing.schemas,
      objectsBySchema: {},
    });
    persist();
    return;
  }
  const next = { ...existing.objectsBySchema };
  if (group) {
    const groups = { ...(next[schema] ?? {}) };
    delete groups[group];
    next[schema] = groups;
  } else {
    delete next[schema];
  }
  cacheByConnection.set(connectionId, {
    schemas: existing.schemas,
    objectsBySchema: next,
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

export function toSchemaNodes(
  cache: ConnectionSchemaCache | null,
): SchemaNode[] {
  if (!cache) return [];
  return cache.schemas.map((schema) => ({
    name: schema.name,
    isSystem: schema.isSystem,
    objects: cache.objectsBySchema[schema.name] ?? {},
  }));
}
