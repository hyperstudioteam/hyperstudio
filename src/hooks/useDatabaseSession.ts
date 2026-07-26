import { useCallback, useRef, useState } from "react";
import { databaseApi } from "../api/database";
import { errorMessage } from "../lib/format";
import {
  VaultLockedError,
  VaultMissingError,
  withResolvedPassword,
} from "../lib/passwords";
import {
  clearConnectionCache,
  clearSchemaObjects,
  filterSchemasForProfile,
  getSchemaCache,
  hasSchemaObjects,
  setSchemaList,
  setSchemaObjects,
  toSchemaNodes,
} from "../lib/schemaCache";
import { objectGroupsFor } from "../lib/driverGroups";
import { ConnectionProfile } from "../types/connection";
import { ConnectionInfo, QueryResult } from "../types/query";
import { ObjectNode, SchemaInfo, SchemaNode } from "../types/schema";

export type SessionBusy =
  | { kind: "connect" }
  | { kind: "query" }
  | { kind: "schemas" }
  | { kind: "objects"; schema: string; group: string }
  | {
      kind: "subgroup";
      schema: string;
      object: string;
      subgroup: string;
    }
  | null;

/** Tree keys are stable strings so expansion state survives re-renders. */
export const treeKeys = {
  schema: (schema: string) => `schema:${schema}`,
  group: (schema: string, group: string) => `group:${schema}\u0000${group}`,
  object: (schema: string, group: string, name: string) =>
    `object:${schema}\u0000${group}\u0000${name}`,
  subgroup: (
    schema: string,
    group: string,
    object: string,
    subgroup: string,
  ) => `subgroup:${schema}\u0000${group}\u0000${object}\u0000${subgroup}`,
};

function parseGroupKey(key: string): { schema: string; group: string } | null {
  if (!key.startsWith("group:")) return null;
  const [schema, group] = key.slice("group:".length).split("\u0000");
  return schema && group ? { schema, group } : null;
}

function parseSubgroupKey(key: string) {
  if (!key.startsWith("subgroup:")) return null;
  const [schema, group, object, subgroup] = key
    .slice("subgroup:".length)
    .split("\u0000");
  return schema && group && object && subgroup
    ? { schema, group, object, subgroup }
    : null;
}

export function useDatabaseSession() {
  /** Currently selected connection in the UI. */
  const [activeId, setActiveId] = useState<string | null>(null);
  /** Connection with a live DB pool. */
  const [liveId, setLiveId] = useState<string | null>(null);
  /** Mirrors liveId so long-running background work can observe disconnects. */
  const liveIdRef = useRef(liveId);
  liveIdRef.current = liveId;
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo | null>(
    null,
  );
  const [schemas, setSchemas] = useState<SchemaNode[]>([]);
  const [availableSchemas, setAvailableSchemas] = useState<SchemaInfo[]>([]);
  const [schemaExpanded, setSchemaExpanded] = useState<Set<string>>(new Set());
  const [objectSubgroups, setObjectSubgroups] = useState<
    Record<string, ObjectNode[]>
  >({});
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<SessionBusy>(null);

  const syncFromCache = useCallback((connectionId: string) => {
    setSchemas(toSchemaNodes(getSchemaCache(connectionId)));
  }, []);

  function clearSession() {
    setActiveId(null);
    setLiveId(null);
    setConnectionInfo(null);
    setSchemas([]);
    setAvailableSchemas([]);
    setSchemaExpanded(new Set());
    setObjectSubgroups({});
    setResult(null);
  }

  /** Show cached schemas without opening a DB pool. */
  function activate(profile: ConnectionProfile) {
    setActiveId(profile.id);
    setError("");
    setSchemaExpanded(new Set());
    setObjectSubgroups({});
    const cache = getSchemaCache(profile.id);
    if (cache) {
      setAvailableSchemas(cache.schemas);
      setSchemas(toSchemaNodes(cache));
    } else {
      setAvailableSchemas([]);
      setSchemas([]);
    }
    if (liveId !== profile.id) {
      setConnectionInfo(null);
    }
  }

  async function ensureLive(profile: ConnectionProfile) {
    if (liveId === profile.id) return;
    const ready = withResolvedPassword(profile);
    const info = await databaseApi.connect(ready);
    setLiveId(profile.id);
    setActiveId(profile.id);
    setConnectionInfo(info);
  }

  function isVaultAuthError(error: unknown) {
    return (
      error instanceof VaultLockedError || error instanceof VaultMissingError
    );
  }

  async function loadSchemaList(
    profile: ConnectionProfile,
    options: { force?: boolean } = {},
  ) {
    const cached = getSchemaCache(profile.id);
    if (!options.force && cached) {
      setAvailableSchemas(cached.schemas);
      setSchemas(toSchemaNodes(cached));
      return;
    }

    setBusy({ kind: "schemas" });
    setError("");
    try {
      await ensureLive(profile);
      const listed = await databaseApi.listSchemas(profile.id);
      const filtered = filterSchemasForProfile(listed, profile);
      if (options.force) {
        clearSchemaObjects(profile.id);
      }
      setSchemaList(profile.id, filtered);
      setAvailableSchemas(listed);
      setSchemas(toSchemaNodes(getSchemaCache(profile.id)));
      if (options.force) {
        setSchemaExpanded(new Set());
      }
    } catch (nextError) {
      if (isVaultAuthError(nextError)) throw nextError;
      setError(errorMessage(nextError));
    } finally {
      setBusy(null);
    }
  }

  async function loadSchemaObjects(
    profile: ConnectionProfile,
    schema: string,
    group: string,
    options: { force?: boolean } = {},
  ) {
    if (!options.force && hasSchemaObjects(profile.id, schema, group)) {
      syncFromCache(profile.id);
      return;
    }

    setBusy({ kind: "objects", schema, group });
    setError("");
    try {
      await ensureLive(profile);
      const objects = await databaseApi.listObjects(profile.id, schema, group);
      setSchemaObjects(profile.id, schema, group, objects);
      syncFromCache(profile.id);
    } catch (nextError) {
      if (isVaultAuthError(nextError)) throw nextError;
      setError(errorMessage(nextError));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Fill in object metadata for SQL autocompletion. Best-effort: it never
   * opens a pool, never blocks the UI, and stays quiet about failures.
   */
  async function prefetchObjects(
    profile: ConnectionProfile,
    groups: string[],
    schemaLimit = 25,
  ) {
    if (liveIdRef.current !== profile.id || groups.length === 0) return;
    const cache = getSchemaCache(profile.id);
    if (!cache) return;

    const pending: Array<{ schema: string; group: string }> = [];
    const candidates = cache.schemas
      .filter((schema) => !schema.isSystem)
      .slice(0, schemaLimit);
    for (const schema of candidates) {
      for (const group of groups) {
        if (!hasSchemaObjects(profile.id, schema.name, group)) {
          pending.push({ schema: schema.name, group });
        }
      }
    }
    if (pending.length === 0) return;

    let loaded = false;
    for (const item of pending) {
      if (liveIdRef.current !== profile.id) break;
      try {
        const objects = await databaseApi.listObjects(
          profile.id,
          item.schema,
          item.group,
        );
        setSchemaObjects(profile.id, item.schema, item.group, objects);
        loaded = true;
      } catch {
        // Completion data is optional; a failed group just stays unlisted.
      }
    }
    if (loaded) syncFromCache(profile.id);
  }

  async function refreshDatabase(profile: ConnectionProfile) {
    setObjectSubgroups({});
    await loadSchemaList(profile, { force: true });
  }

  async function refreshSchema(profile: ConnectionProfile, schema: string) {
    setObjectSubgroups({});
    clearSchemaObjects(profile.id, schema);
    syncFromCache(profile.id);
    const groups = objectGroupsFor(profile.driver);
    await Promise.all(
      groups.map((group) =>
        loadSchemaObjects(profile, schema, group.id, { force: true }),
      ),
    );
  }

  async function refreshGroup(
    profile: ConnectionProfile,
    schema: string,
    group: string,
  ) {
    setObjectSubgroups({});
    clearSchemaObjects(profile.id, schema, group);
    syncFromCache(profile.id);
    await loadSchemaObjects(profile, schema, group, { force: true });
  }

  /** First-time fetch when there is no schema cache yet. */
  async function connect(profile: ConnectionProfile) {
    setBusy({ kind: "connect" });
    setError("");
    setActiveId(profile.id);
    try {
      await ensureLive(profile);
      setBusy(null);
      await loadSchemaList(profile, { force: true });
    } catch (nextError) {
      if (isVaultAuthError(nextError)) {
        setBusy(null);
        throw nextError;
      }
      setError(errorMessage(nextError));
      setBusy(null);
    }
  }

  async function runQuery(profile: ConnectionProfile, sql: string) {
    setBusy({ kind: "query" });
    setError("");
    try {
      await ensureLive(profile);
      setResult(await databaseApi.executeQuery(profile.id, sql));
    } catch (nextError) {
      if (isVaultAuthError(nextError)) {
        setBusy(null);
        throw nextError;
      }
      setResult(null);
      setError(errorMessage(nextError));
    } finally {
      setBusy(null);
    }
  }

  /** Run SQL and return the result (for table editor). Still updates shared result state for query tabs. */
  async function executeSql(
    profile: ConnectionProfile,
    sql: string,
  ): Promise<QueryResult> {
    await ensureLive(profile);
    const next = await databaseApi.executeQuery(profile.id, sql);
    return next;
  }

  async function loadErDiagram(
    profile: ConnectionProfile,
    schema: string,
  ): Promise<import("../lib/erDiagram").ErDiagram> {
    await ensureLive(profile);
    return databaseApi.erDiagram(profile.id, schema);
  }

  async function toggleSchemaExpanded(
    profile: ConnectionProfile,
    key: string,
  ) {
    const opening = !schemaExpanded.has(key);

    setSchemaExpanded((current) => {
      const next = new Set(current);
      if (opening) next.add(key);
      else next.delete(key);
      return next;
    });

    if (!opening) return;

    const subgroup = parseSubgroupKey(key);
    if (subgroup) {
      if (subgroup.subgroup === "columns" || objectSubgroups[key]) return;
      setBusy({
        kind: "subgroup",
        schema: subgroup.schema,
        object: subgroup.object,
        subgroup: subgroup.subgroup,
      });
      setError("");
      try {
        await ensureLive(profile);
        const items = await databaseApi.listObjectSubgroup(
          profile.id,
          subgroup.schema,
          subgroup.object,
          subgroup.subgroup,
        );
        setObjectSubgroups((current) => ({ ...current, [key]: items }));
      } catch (nextError) {
        if (isVaultAuthError(nextError)) throw nextError;
        setError(errorMessage(nextError));
      } finally {
        setBusy(null);
      }
      return;
    }

    const schemaKey = key.startsWith("schema:")
      ? key.slice("schema:".length)
      : null;
    if (schemaKey) {
      // Opening a schema auto-loads and expands groups marked defaultOpen.
      const groups = objectGroupsFor(profile.driver).filter(
        (group) => group.defaultOpen,
      );
      if (groups.length > 0) {
        setSchemaExpanded((current) => {
          const next = new Set(current);
          for (const group of groups) {
            next.add(treeKeys.group(schemaKey, group.id));
          }
          return next;
        });
      }
      await Promise.all(
        groups.map(async (group) => {
          if (!hasSchemaObjects(profile.id, schemaKey, group.id)) {
            await loadSchemaObjects(profile, schemaKey, group.id);
          }
        }),
      );
      return;
    }

    const parsed = parseGroupKey(key);
    if (parsed && !hasSchemaObjects(profile.id, parsed.schema, parsed.group)) {
      await loadSchemaObjects(profile, parsed.schema, parsed.group);
    }
  }

  function onDeleted(id: string) {
    clearConnectionCache(id);
    if (activeId === id || liveId === id) clearSession();
  }

  const busyKind =
    busy?.kind === "connect"
      ? "connect"
      : busy?.kind === "query"
        ? "query"
        : busy?.kind === "schemas" ||
            busy?.kind === "objects" ||
            busy?.kind === "subgroup"
          ? "schema"
          : null;

  return {
    /** @deprecated use liveId — kept for status-dot compatibility */
    connectedId: liveId,
    activeId,
    liveId,
    connectionInfo,
    schemas,
    availableSchemas,
    setAvailableSchemas,
    schemaExpanded,
    objectSubgroups,
    toggleSchemaExpanded,
    result,
    error,
    setError,
    busy: busyKind as "connect" | "query" | "schema" | null,
    busyDetail: busy,
    activate,
    connect,
    refreshDatabase,
    refreshSchema,
    refreshGroup,
    prefetchObjects,
    runQuery,
    executeSql,
    loadErDiagram,
    onDeleted,
    clearSession,
  };
}
