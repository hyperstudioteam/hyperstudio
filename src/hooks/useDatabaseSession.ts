import { useCallback, useState } from "react";
import { databaseApi } from "../api/database";
import { errorMessage } from "../lib/format";
import {
  VaultLockedError,
  VaultMissingError,
  withResolvedPassword,
} from "../lib/passwords";
import {
  clearConnectionCache,
  clearSchemaTables,
  filterSchemasForProfile,
  getSchemaCache,
  setSchemaList,
  setSchemaTables,
  toSchemaNodes,
} from "../lib/schemaCache";
import { ConnectionProfile } from "../types/connection";
import { ConnectionInfo, QueryResult } from "../types/query";
import { SchemaInfo, SchemaNode } from "../types/schema";

export type SessionBusy =
  | { kind: "connect" }
  | { kind: "query" }
  | { kind: "schemas" }
  | { kind: "tables"; schema: string }
  | null;

export function useDatabaseSession() {
  /** Currently selected connection in the UI. */
  const [activeId, setActiveId] = useState<string | null>(null);
  /** Connection with a live DB pool. */
  const [liveId, setLiveId] = useState<string | null>(null);
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo | null>(
    null,
  );
  const [schemas, setSchemas] = useState<SchemaNode[]>([]);
  const [availableSchemas, setAvailableSchemas] = useState<SchemaInfo[]>([]);
  const [schemaExpanded, setSchemaExpanded] = useState<Set<string>>(new Set());
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
    setResult(null);
  }

  /** Show cached schemas without opening a DB pool. */
  function activate(profile: ConnectionProfile) {
    setActiveId(profile.id);
    setError("");
    setSchemaExpanded(new Set());
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
        clearSchemaTables(profile.id);
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

  async function loadSchemaTables(
    profile: ConnectionProfile,
    schema: string,
    options: { force?: boolean } = {},
  ) {
    const cached = getSchemaCache(profile.id);
    if (
      !options.force &&
      cached &&
      Object.prototype.hasOwnProperty.call(cached.tablesBySchema, schema)
    ) {
      syncFromCache(profile.id);
      return;
    }

    setBusy({ kind: "tables", schema });
    setError("");
    try {
      await ensureLive(profile);
      const tables = await databaseApi.listTables(profile.id, schema);
      setSchemaTables(profile.id, schema, tables);
      syncFromCache(profile.id);
    } catch (nextError) {
      if (isVaultAuthError(nextError)) throw nextError;
      setError(errorMessage(nextError));
    } finally {
      setBusy(null);
    }
  }

  async function refreshDatabase(profile: ConnectionProfile) {
    await loadSchemaList(profile, { force: true });
  }

  async function refreshSchema(profile: ConnectionProfile, schema: string) {
    clearSchemaTables(profile.id, schema);
    syncFromCache(profile.id);
    await loadSchemaTables(profile, schema, { force: true });
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

  async function toggleSchemaExpanded(
    profile: ConnectionProfile,
    key: string,
  ) {
    const isSchema = key.startsWith("schema:");
    const schemaName = isSchema ? key.slice("schema:".length) : null;
    const opening = !schemaExpanded.has(key);

    setSchemaExpanded((current) => {
      const next = new Set(current);
      if (opening) next.add(key);
      else next.delete(key);
      return next;
    });

    if (opening && schemaName) {
      const cached = getSchemaCache(profile.id);
      const hasTables =
        cached &&
        Object.prototype.hasOwnProperty.call(cached.tablesBySchema, schemaName);
      if (!hasTables) {
        await loadSchemaTables(profile, schemaName);
      }
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
        : busy?.kind === "schemas" || busy?.kind === "tables"
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
    runQuery,
    executeSql,
    onDeleted,
    clearSession,
  };
}
