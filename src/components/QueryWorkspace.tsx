import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  CirclePlus,
  Clock,
  Download,
  GitBranch,
  ListOrdered,
  LoaderCircle,
  Network,
  Play,
  Square,
  Star,
  Table2,
  Undo2,
  WandSparkles,
  X,
} from "lucide-react";
import { errorMessage } from "../lib/format";
import { ErDiagram } from "../lib/erDiagram";
import { save } from "@tauri-apps/plugin-dialog";
import {
  buildCompletionSchema,
  defaultSchemaFor,
  hasCompletionData,
} from "../lib/completionSchema";
import {
  ExplainPlan,
  canVisualizeExplain,
  explainHasAnalyze,
  isExplainSql,
  parseExplainResult,
  wrapExplainSql,
} from "../lib/explain";
import { getSchemaCache, toSchemaNodes } from "../lib/schemaCache";
import {
  buildTableQuery,
  defaultMaxRows,
  planPagedQuery,
  PagedQueryPlan,
  sqlForPage,
} from "../lib/sql";
import { ConnectionProfile, DriverInfo } from "../types/connection";
import { ConnectionInfo, QueryResult } from "../types/query";
import {
  SchemaNode,
  TABLES_GROUP,
  TableNode,
  tableFromObject,
} from "../types/schema";
import { cn } from "../lib/cn";
import { ErDiagramView } from "./ErDiagramView";
import { StatementRun, toStatementRuns } from "../lib/scriptRun";
import { splitStatements } from "../lib/splitStatements";
import {
  HistoryEntry,
  SavedQuery,
  clearHistory,
  loadHistory,
  loadSavedQueries,
  recordHistory,
  removeHistoryEntry,
  removeSavedQuery,
  saveQuery,
} from "../lib/queryHistory";
import {
  ExportFormat,
  exportResultSet,
  extensionFor,
} from "../lib/exportResults";
import { ExplainPlanView } from "./explain/ExplainPlanView";
import { ExportModal, ExportOptions } from "./ExportModal";
import { QueryParamsPanel } from "./QueryParamsPanel";
import { SaveQueryModal } from "./SaveQueryModal";
import { QueryHistoryPanel } from "./QueryHistoryPanel";
import { ResultGrid } from "./ResultGrid";
import { ScriptResults } from "./ScriptResults";
import { SqlEditor, SqlEditorHandle } from "./SqlEditor";
import { TableDataEditor } from "./TableDataEditor";
import { ExtensionView } from "../extensions/ExtensionView";
import {
  useActiveExtensionView,
  useExtensionStatusItems,
} from "../extensions/hooks";
import { extensionRegistry } from "../extensions/registry";
import {
  bindQueryParams,
  findQueryParams,
  ParamValueEntry,
  QueryParam,
  coerceParamValue,
  recallParamEntries,
  rememberParamEntries,
} from "../lib/queryParams";

type ResultPanel = "results" | "plan" | "messages";

type PendingParamAction = {
  kind: "run" | "explain" | "script";
  sql: string;
  connectionId: string;
  params: QueryParam[];
  analyze?: boolean;
};

function openParamsPanel(
  kind: PendingParamAction["kind"],
  sql: string,
  connectionId: string,
  setPendingParams: (action: PendingParamAction) => void,
  extra: { analyze?: boolean } = {},
): boolean {
  const params = findQueryParams(sql);
  if (params.length === 0) return false;
  setPendingParams({ kind, sql, connectionId, params, ...extra });
  return true;
}

/** If remembered values cover every param, bind and return SQL; else null. */
function tryBindRemembered(sql: string, params: QueryParam[]): string | null {
  const entries = recallParamEntries(params);
  try {
    const values = entries.map((entry) =>
      coerceParamValue(entry.text, entry.isNull),
    );
    return bindQueryParams(sql, values);
  } catch {
    return null;
  }
}

const STARTER_QUERY = `SELECT *
FROM users
ORDER BY created_at DESC
LIMIT 100;`;

export type WorkspaceOpen =
  | { kind: "view"; schema: string; table: string; nonce: number }
  | { kind: "edit"; schema: string; table: string; nonce: number }
  | { kind: "er"; schema: string; nonce: number }
  | { kind: "console"; nonce: number }
  | null;

type QueryTab = {
  id: string;
  kind: "query";
  title: string;
  sql: string;
  /** Connection this console was created on; user may switch later. */
  connectionId: string;
};

type EditTab = {
  id: string;
  kind: "edit";
  title: string;
  schema: string;
  table: string;
  /** Connection this editor was opened on; does not follow sidebar selection. */
  connectionId: string;
};

type ErTab = {
  id: string;
  kind: "er";
  title: string;
  schema: string;
};

type WorkspaceTab = QueryTab | EditTab | ErTab;

interface QueryWorkspaceProps {
  selected: ConnectionProfile | null;
  /** All saved connections, for the per-console picker. */
  connections: ConnectionProfile[];
  /** Connection ids with an open pool. */
  liveConnectionIds: ReadonlySet<string>;
  connectedId: string | null;
  connectionInfo: ConnectionInfo | null;
  busy: "connect" | "query" | "schema" | null;
  result: QueryResult | null;
  error: string;
  /** Cached metadata for the sidebar-selected connection. */
  schemas: SchemaNode[];
  drivers: DriverInfo[];
  openRequest: WorkspaceOpen;
  txnOpenById: Record<string, boolean>;
  onRun: (sql: string, connectionId: string) => void;
  onExecute: (
    sql: string,
    connectionId: string,
    confirmedWrite?: boolean,
  ) => Promise<QueryResult>;
  onLoadEr: (schema: string) => Promise<ErDiagram>;
  onCancel?: (connectionId: string) => void;
  onBeginTransaction?: (connectionId: string) => void;
  onEndTransaction?: (connectionId: string, commit: boolean) => void;
  /** Set only when the driver can commit a batch atomically. */
  onExecuteBatch?: (
    connectionId: string,
    statements: string[],
  ) => Promise<number[]>;
  /** Prompts for a guarded connection; resolves true when the user agrees. */
  onConfirmWrites?: (
    connectionId: string,
    preview: string,
  ) => Promise<boolean>;
}

function findTableMeta(
  connectionId: string,
  schema: string,
  table: string,
): TableNode | null {
  const cache = getSchemaCache(connectionId);
  const tables = cache?.objectsBySchema[schema]?.[TABLES_GROUP];
  const match = tables?.find((item) => item.name === table);
  return match ? tableFromObject(match) : null;
}

export function QueryWorkspace({
  selected,
  connections,
  liveConnectionIds,
  connectedId,
  connectionInfo,
  busy,
  result,
  error,
  schemas,
  drivers,
  openRequest,
  txnOpenById,
  onRun,
  onExecute,
  onLoadEr,
  onCancel,
  onBeginTransaction,
  onEndTransaction,
  onExecuteBatch,
  onConfirmWrites,
}: QueryWorkspaceProps) {
  const [tabs, setTabs] = useState<WorkspaceTab[]>([
    {
      id: "query-1",
      kind: "query",
      title: "Query 1",
      sql: STARTER_QUERY,
      connectionId: "",
    },
  ]);
  const [activeId, setActiveId] = useState("query-1");
  const [resultPage, setResultPage] = useState(0);
  const [pagePlan, setPagePlan] = useState<PagedQueryPlan | null>(null);
  const [erDiagram, setErDiagram] = useState<ErDiagram | null>(null);
  const [erBusy, setErBusy] = useState(false);
  const [erError, setErError] = useState("");
  const [scriptRuns, setScriptRuns] = useState<StatementRun[] | null>(null);
  const [scriptIndex, setScriptIndex] = useState(0);
  const [scriptBusy, setScriptBusy] = useState(false);
  const [stopOnError, setStopOnError] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());
  const [saved, setSaved] = useState<SavedQuery[]>(() => loadSavedQueries());
  const [exportOpen, setExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [exportError, setExportError] = useState("");
  const [saveQueryOpen, setSaveQueryOpen] = useState(false);
  const [pendingSaveSql, setPendingSaveSql] = useState("");
  const [pendingParams, setPendingParams] = useState<PendingParamAction | null>(
    null,
  );
  const [formatError, setFormatError] = useState("");
  const [resultPanel, setResultPanel] = useState<ResultPanel>("results");
  const [analyzeEnabled, setAnalyzeEnabled] = useState(false);
  const [explainPlan, setExplainPlan] = useState<ExplainPlan | null>(null);
  const pendingExplainRef = useRef<{
    analyzed: boolean;
    sql: string;
    driver: "postgres" | "mysql";
  } | null>(null);
  const editorRef = useRef<SqlEditorHandle>(null);
  const activeExtensionView = useActiveExtensionView();
  const extensionStatusItems = useExtensionStatusItems();
  const queryCounter = useRef(1);
  const cancelScript = useRef(false);
  /** SQL awaiting its result so the run can be recorded once it settles. */
  const pendingRunRef = useRef<string | null>(null);
  const pendingConnectionRef = useRef<string>("");

  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0] ?? null;
  const activeConnectionId =
    active?.kind === "query" || active?.kind === "edit"
      ? active.connectionId
      : selected?.id ?? "";
  const activeConnection =
    connections.find((item) => item.id === activeConnectionId) ??
    (selected?.id === activeConnectionId ? selected : null);
  const queryConnectionId = activeConnectionId;
  const queryConnection = activeConnection;
  const querySchemas = useMemo(() => {
    if (
      (active?.kind === "query" || active?.kind === "edit") &&
      active.connectionId
    ) {
      return toSchemaNodes(getSchemaCache(active.connectionId));
    }
    return schemas;
  }, [active, schemas]);
  const queryCaps = drivers.find(
    (driver) => driver.id === activeConnection?.driver,
  )?.capabilities;
  const pageSize = defaultMaxRows(queryCaps?.maxRows);
  const sessions = Boolean(queryCaps?.sessions);
  const txnOpen = Boolean(
    queryConnectionId && txnOpenById[queryConnectionId],
  );
  const queryLive = Boolean(
    queryConnectionId && liveConnectionIds.has(queryConnectionId),
  );

  const completionSchema = useMemo(
    () => buildCompletionSchema(querySchemas),
    [querySchemas],
  );
  const defaultSchema = useMemo(
    () =>
      queryConnection
        ? defaultSchemaFor(queryConnection, querySchemas)
        : undefined,
    [queryConnection, querySchemas],
  );
  const completionReady = useMemo(
    () => hasCompletionData(querySchemas),
    [querySchemas],
  );

  const query = active?.kind === "query" ? active.sql : STARTER_QUERY;
  const statementCount = useMemo(
    () => splitStatements(query).length,
    [query],
  );
  const explainCapable = canVisualizeExplain(queryConnection?.driver);
  const explainDisabled =
    busy === "query" || !queryConnection || !queryLive || !explainCapable;

  // Bind orphan tabs (created before a connection was selected) to the sidebar connection.
  useEffect(() => {
    if (!selected) return;
    setTabs((current) => {
      let changed = false;
      const next = current.map((tab) => {
        if (tab.kind === "query" && !tab.connectionId) {
          changed = true;
          return { ...tab, connectionId: selected.id };
        }
        return tab;
      });
      return changed ? next : current;
    });
  }, [selected?.id]);

  function setQueryConnectionId(connectionId: string) {
    if (!active || active.kind !== "query") return;
    setTabs((current) =>
      current.map((tab) =>
        tab.id === active.id && tab.kind === "query"
          ? { ...tab, connectionId }
          : tab,
      ),
    );
  }

  function addQueryTab() {
    queryCounter.current += 1;
    const id = `query-${queryCounter.current}`;
    setTabs((current) => [
      ...current,
      {
        id,
        kind: "query",
        title: `Query ${queryCounter.current}`,
        sql: STARTER_QUERY,
        connectionId: selected?.id ?? queryConnectionId,
      },
    ]);
    setActiveId(id);
  }

  const pageable = pagePlan?.pageable === true;
  const hasMore =
    pageable &&
    Boolean(result?.columns.length) &&
    (Boolean(result?.truncated) || (result?.rows.length ?? 0) >= pageSize);
  const rangeStart =
    !result?.columns.length || result.rows.length === 0
      ? 0
      : resultPage * pageSize + 1;
  const rangeEnd = resultPage * pageSize + (result?.rows.length ?? 0);

  // Record the run once its outcome is known, so failures are captured too.
  useEffect(() => {
    const sql = pendingRunRef.current;
    if (!sql || busy === "query") return;
    if (!result && !error) return;

    pendingRunRef.current = null;
    const connectionId = pendingConnectionRef.current;
    pendingConnectionRef.current = "";
    setHistory(
      recordHistory({
        sql,
        connectionId,
        succeeded: !error,
        elapsedMs: result?.elapsedMs,
        rowCount: result?.columns.length ? result.rows.length : undefined,
      }),
    );
    // Only react to a settled query; connection is snapshotted at run time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, error, busy]);

  useEffect(() => {
    const pending = pendingExplainRef.current;
    if (!pending) return;
    if (busy === "query") return;

    pendingExplainRef.current = null;
    if (error || !result) {
      setExplainPlan(null);
      setResultPanel(error ? "messages" : "results");
      return;
    }

    const plan = parseExplainResult(pending.driver, result, {
      analyzed: pending.analyzed,
      sql: pending.sql,
    });
    if (plan) {
      setExplainPlan(plan);
      setResultPanel("plan");
    } else {
      setExplainPlan(null);
      setResultPanel("results");
    }
  }, [result, error, busy]);

  useEffect(() => {
    if (!openRequest || !selected) return;

    if (openRequest.kind === "console") {
      queryCounter.current += 1;
      const id = `query-${queryCounter.current}`;
      setTabs((current) => [
        ...current,
        {
          id,
          kind: "query",
          title: `Console ${queryCounter.current}`,
          sql: "",
          connectionId: selected.id,
        },
      ]);
      setActiveId(id);
      return;
    }

    if (openRequest.kind === "view") {
      const sql = buildTableQuery(
        selected.driver,
        openRequest.schema,
        openRequest.table,
      );
      const existingQuery = tabs.find((tab) => tab.kind === "query");
      if (existingQuery) {
        setTabs((current) =>
          current.map((tab) =>
            tab.id === existingQuery.id && tab.kind === "query"
              ? { ...tab, sql, connectionId: selected.id }
              : tab,
          ),
        );
        setActiveId(existingQuery.id);
      } else {
        queryCounter.current += 1;
        const id = `query-${queryCounter.current}`;
        setTabs((current) => [
          ...current,
          {
            id,
            kind: "query",
            title: `Query ${queryCounter.current}`,
            sql,
            connectionId: selected.id,
          },
        ]);
        setActiveId(id);
      }
      runSql(sql, selected.id);
      return;
    }

    if (openRequest.kind === "er") {
      const id = `er-${openRequest.schema}`;
      setTabs((current) => {
        if (current.some((tab) => tab.id === id)) return current;
        return [
          ...current,
          {
            id,
            kind: "er",
            title: `${openRequest.schema} · ER`,
            schema: openRequest.schema,
          },
        ];
      });
      setActiveId(id);
      void loadErDiagram(openRequest.schema);
      return;
    }

    const id = `edit-${selected.id}:${openRequest.schema}.${openRequest.table}`;
    const title = `${openRequest.schema}.${openRequest.table}`;
    setTabs((current) => {
      if (current.some((tab) => tab.id === id)) return current;
      return [
        ...current,
        {
          id,
          kind: "edit",
          title,
          schema: openRequest.schema,
          table: openRequest.table,
          connectionId: selected.id,
        },
      ];
    });
    setActiveId(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest?.nonce]);

  async function loadErDiagram(schema: string) {
    setErBusy(true);
    setErError("");
    try {
      setErDiagram(await onLoadEr(schema));
    } catch (nextError) {
      setErDiagram(null);
      setErError(errorMessage(nextError));
    } finally {
      setErBusy(false);
    }
  }

  function setQuerySql(sql: string) {
    if (!active || active.kind !== "query") return;
    setTabs((current) =>
      current.map((tab) =>
        tab.id === active.id && tab.kind === "query" ? { ...tab, sql } : tab,
      ),
    );
  }

  function executeBoundExplain(
    sql: string,
    analyze: boolean,
    connectionId: string,
  ) {
    const profile =
      connections.find((item) => item.id === connectionId) ?? queryConnection;
    if (!profile || !canVisualizeExplain(profile.driver)) return;
    const wrapped = wrapExplainSql(profile.driver, sql, { analyze });
    pendingExplainRef.current = {
      analyzed: analyze,
      sql: wrapped,
      driver: profile.driver as "postgres" | "mysql",
    };
    setPagePlan({ pageable: false, sql: wrapped });
    setResultPage(0);
    setExplainPlan(null);
    pendingConnectionRef.current = connectionId;
    onRun(wrapped, connectionId);
  }

  function runExplainSql(
    sql: string,
    analyze: boolean,
    connectionId = queryConnectionId,
  ) {
    const params = findQueryParams(sql);
    if (params.length > 0) {
      const bound = tryBindRemembered(sql, params);
      if (bound) {
        // Keep the sidebar open with the same params so values can be edited.
        setPendingParams({ kind: "explain", sql, connectionId, params, analyze });
        executeBoundExplain(bound, analyze, connectionId);
        return;
      }
      openParamsPanel("explain", sql, connectionId, setPendingParams, {
        analyze,
      });
      return;
    }
    executeBoundExplain(sql, analyze, connectionId);
  }

  function executeBoundRun(sql: string, connectionId: string) {
    setScriptRuns(null);
    const profile =
      connections.find((item) => item.id === connectionId) ?? queryConnection;
    if (
      isExplainSql(sql) &&
      profile &&
      canVisualizeExplain(profile.driver)
    ) {
      const analyze = explainHasAnalyze(sql) || analyzeEnabled;
      executeBoundExplain(sql, analyze, connectionId);
      return;
    }

    pendingExplainRef.current = null;
    setExplainPlan(null);
    setResultPanel("results");
    const plan = planPagedQuery(sql, pageSize);
    setPagePlan(plan);
    setResultPage(0);
    pendingRunRef.current = sql;
    pendingConnectionRef.current = connectionId;
    onRun(sqlForPage(plan, 0), connectionId);
  }

  function runSql(sql: string, connectionId = queryConnectionId) {
    const params = findQueryParams(sql);
    if (params.length > 0) {
      const bound = tryBindRemembered(sql, params);
      if (bound) {
        setPendingParams({ kind: "run", sql, connectionId, params });
        executeBoundRun(bound, connectionId);
        return;
      }
      openParamsPanel("run", sql, connectionId, setPendingParams);
      return;
    }
    executeBoundRun(sql, connectionId);
  }

  function run() {
    if (!active || active.kind !== "query" || !queryConnectionId) return;
    runSql(editorRef.current?.getSqlToRun() ?? query, queryConnectionId);
  }

  async function executeBoundScript(sql: string, connectionId: string) {
    const statements = splitStatements(sql);
    if (statements.length === 0) return;

    const runs = toStatementRuns(statements);
    cancelScript.current = false;
    setScriptRuns(runs);
    setScriptIndex(0);
    setScriptBusy(true);

    // Mutate a local copy so each statement's outcome renders as it lands.
    const publish = () => setScriptRuns([...runs]);

    for (let index = 0; index < runs.length; index += 1) {
      if (cancelScript.current) {
        for (let rest = index; rest < runs.length; rest += 1) {
          runs[rest].status = "skipped";
        }
        publish();
        break;
      }
      runs[index].status = "running";
      setScriptIndex(index);
      publish();
      try {
        runs[index].result = await onExecute(runs[index].sql, connectionId);
        runs[index].status = "ok";
      } catch (error) {
        runs[index].status = "error";
        runs[index].error = errorMessage(error);
        publish();
        if (stopOnError) {
          for (let rest = index + 1; rest < runs.length; rest += 1) {
            runs[rest].status = "skipped";
          }
          publish();
          break;
        }
      }
      publish();
    }

    setScriptBusy(false);
    // Land on the first failure so it is not buried in a long script.
    const failure = runs.findIndex((item) => item.status === "error");
    if (failure >= 0) setScriptIndex(failure);
  }

  async function runScript() {
    if (
      !active ||
      active.kind !== "query" ||
      scriptBusy ||
      !queryConnectionId
    ) {
      return;
    }
    const sql = editorRef.current?.getSqlToRun() ?? query;
    const params = findQueryParams(sql);
    if (params.length > 0) {
      const bound = tryBindRemembered(sql, params);
      if (bound) {
        setPendingParams({
          kind: "script",
          sql,
          connectionId: queryConnectionId,
          params,
        });
        await executeBoundScript(bound, queryConnectionId);
        return;
      }
      openParamsPanel("script", sql, queryConnectionId, setPendingParams);
      return;
    }
    await executeBoundScript(sql, queryConnectionId);
  }

  function confirmQueryParams(
    values: unknown[],
    entries: ParamValueEntry[],
  ) {
    if (!pendingParams) return;
    const action = pendingParams;
    rememberParamEntries(action.params, entries);
    const bound = bindQueryParams(action.sql, values);
    // Keep the sidebar open so the same values can be re-run immediately.
    if (action.kind === "run") {
      executeBoundRun(bound, action.connectionId);
      return;
    }
    if (action.kind === "explain") {
      executeBoundExplain(bound, action.analyze ?? false, action.connectionId);
      return;
    }
    void executeBoundScript(bound, action.connectionId);
  }

  function formatQuery() {
    if (!active || active.kind !== "query") return;
    setFormatError("");
    editorRef.current?.format();
  }

  function explain() {
    if (!active || active.kind !== "query" || !queryConnectionId) return;
    const sql = editorRef.current?.getSqlToRun() ?? query;
    runExplainSql(sql, analyzeEnabled, queryConnectionId);
  }

  function loadPage(page: number) {
    if (!pagePlan?.pageable || !queryConnectionId) return;
    setResultPage(page);
    pendingConnectionRef.current = queryConnectionId;
    onRun(sqlForPage(pagePlan, page), queryConnectionId);
  }

  function useHistorySql(sql: string) {
    if (!active || active.kind !== "query") {
      queryCounter.current += 1;
      const id = `query-${queryCounter.current}`;
      setTabs((current) => [
        ...current,
        {
          id,
          kind: "query",
          title: `Query ${queryCounter.current}`,
          sql,
          connectionId: selected?.id ?? queryConnectionId,
        },
      ]);
      setActiveId(id);
      return;
    }
    setQuerySql(sql);
  }

  function saveCurrentQuery() {
    if (!active || active.kind !== "query") return;
    const sql = editorRef.current?.getSqlToRun() ?? query;
    if (!sql.trim()) return;
    setPendingSaveSql(sql);
    setSaveQueryOpen(true);
  }

  function confirmSaveQuery(name: string) {
    setSaved(
      saveQuery({
        name,
        sql: pendingSaveSql,
        connectionId: queryConnectionId || selected?.id || null,
      }),
    );
    setSaveQueryOpen(false);
    setPendingSaveSql("");
    setHistoryOpen(true);
  }

  async function runExport(options: ExportOptions) {
    if (!result || !queryConnection) return;

    const suggested = `export-${new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/[:T]/g, "-")}.${extensionFor(options.format as ExportFormat)}`;

    let path: string | null = null;
    try {
      path = await save({
        defaultPath: suggested,
        filters: [
          {
            name: options.format.toUpperCase(),
            extensions: [extensionFor(options.format)],
          },
        ],
      });
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
      return;
    }
    if (!path) return;

    setExportBusy(true);
    setExportError("");
    setExportProgress(0);

    const plan = pagePlan;
    const currentRows = result.rows;
    const connectionId = queryConnection.id;

    try {
      const outcome = await exportResultSet({
        path,
        format: options.format,
        driver: queryConnection.driver,
        target: "exported_rows",
        includeHeader: options.includeHeader,
        pageSize,
        fetchPage: async (page) => {
          if (!options.allRows || !plan?.pageable) {
            return page === 0
              ? { ...result, rows: currentRows }
              : null;
          }
          return onExecute(sqlForPage(plan, page), connectionId);
        },
        onProgress: setExportProgress,
      });
      setExportProgress(outcome.rows);
      setExportOpen(false);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
    } finally {
      setExportBusy(false);
    }
  }

  function closeTab(id: string) {
    setTabs((current) => {
      if (current.length === 1) return current;
      const next = current.filter((tab) => tab.id !== id);
      if (activeId === id) {
        setActiveId(next[next.length - 1]?.id ?? next[0].id);
      }
      return next;
    });
  }

  return (
    <div className="flex min-w-0 overflow-hidden">
    <main
      className={cn(
        "min-w-0 flex-1 grid overflow-hidden bg-bg",
        active?.kind === "edit" || active?.kind === "er"
          ? "grid-rows-[36px_1fr_23px]"
          : "grid-rows-[36px_minmax(190px,42%)_1fr_23px]",
      )}
    >
      <div className="flex items-stretch overflow-x-auto border-b border-border bg-titlebar">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={cn(
              "flex max-w-[200px] min-w-[120px] cursor-pointer items-center gap-[7px] border-0 border-r border-border bg-transparent px-2.5 pl-2.5 text-[11px] text-muted",
              tab.id === activeId &&
                "border-t border-accent bg-bg text-[#d8dde6]",
            )}
            onClick={() => setActiveId(tab.id)}
          >
            {tab.kind === "query" ? (
              <span className="text-[8px] font-extrabold tracking-[0.02em] text-accent-bright">
                SQL
              </span>
            ) : tab.kind === "er" ? (
              <Network size={12} className="shrink-0 text-[#9d90ff]" />
            ) : (
              <Table2 size={12} className="shrink-0 text-[#7db7ff]" />
            )}
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
              {tab.title}
            </span>
            <span
              className="ml-auto grid place-items-center rounded-[3px] text-subtle hover:bg-panel-soft hover:text-text"
              role="button"
              tabIndex={-1}
              aria-label={`Close ${tab.title}`}
              onClick={(event) => {
                event.stopPropagation();
                closeTab(tab.id);
              }}
            >
              <X size={13} />
            </span>
          </button>
        ))}
        <button
          className="grid w-[35px] cursor-pointer place-items-center border-0 bg-transparent text-subtle hover:bg-panel-soft hover:text-text"
          aria-label="New query"
          type="button"
          onClick={addQueryTab}
        >
          <CirclePlus size={15} />
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-[7px] px-[11px] text-[10px] text-muted">
          {active?.kind === "query" ? (
            <>
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full bg-[#4e5664]",
                  queryLive && "bg-green shadow-[0_0_7px_rgba(73,201,137,.4)]",
                )}
              />
              <label className="flex items-center gap-1.5 text-[10px] text-muted">
                <span className="sr-only">Connection</span>
                <select
                  className="h-[22px] max-w-[200px] cursor-pointer rounded-[5px] border border-border bg-transparent px-1.5 text-[10px] text-[#c4cad4] outline-none hover:border-border-bright focus:border-accent"
                  value={queryConnectionId}
                  disabled={connections.length === 0}
                  onChange={(event) => setQueryConnectionId(event.target.value)}
                  title="Run this console against this connection"
                >
                  {connections.length === 0 && (
                    <option value="">No connections</option>
                  )}
                  {connections.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name || profile.database || profile.host}
                      {liveConnectionIds.has(profile.id) ? "" : " · cached"}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <>
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full bg-[#4e5664]",
                  activeConnectionId &&
                    liveConnectionIds.has(activeConnectionId) &&
                    "bg-green shadow-[0_0_7px_rgba(73,201,137,.4)]",
                )}
              />
              {activeConnection
                ? `${activeConnection.name || activeConnection.database}${
                    liveConnectionIds.has(activeConnection.id) ? "" : " · cached"
                  }`
                : selected
                  ? `${selected.name || selected.database}${connectedId === selected.id ? "" : " · cached"}`
                  : "Not connected"}
            </>
          )}
        </div>
      </div>

      {active?.kind === "edit" && activeConnection ? (
        <TableDataEditor
          key={active.id}
          profile={activeConnection}
          schema={active.schema}
          table={active.table}
          tableMeta={findTableMeta(
            active.connectionId,
            active.schema,
            active.table,
          )}
          pageSize={pageSize}
          execute={(sql, confirmedWrite) =>
            onExecute(sql, active.connectionId, confirmedWrite)
          }
          executeBatch={
            onExecuteBatch &&
            drivers.find((driver) => driver.id === activeConnection.driver)
              ?.capabilities.transactions
              ? (statements) => onExecuteBatch(active.connectionId, statements)
              : undefined
          }
          confirmWrites={
            onConfirmWrites
              ? (preview) => onConfirmWrites(active.connectionId, preview)
              : undefined
          }
        />
      ) : active?.kind === "er" ? (
        <ErDiagramView
          key={active.id}
          diagram={erDiagram?.schema === active.schema ? erDiagram : null}
          busy={erBusy}
          error={erError}
          onRefresh={() => void loadErDiagram(active.schema)}
        />
      ) : (
        <>
          <section className="flex min-h-0 flex-col border-b border-border">
            <div className="flex h-9 shrink-0 items-center gap-[9px] border-b border-border bg-[#14171b] px-[9px]">
              <button
                className="flex h-[25px] cursor-pointer items-center gap-1.5 rounded-[5px] border border-[rgba(139,124,246,.45)] bg-accent-soft px-2 text-[10px] font-semibold text-[#c9c2ff] hover:border-accent hover:bg-[rgba(139,124,246,.22)] hover:text-white disabled:opacity-60"
                disabled={busy === "query"}
                onClick={run}
              >
                {busy === "query" ? (
                  <LoaderCircle className="animate-spin-slow" size={14} />
                ) : (
                  <Play size={14} fill="currentColor" />
                )}
                Run
                <kbd className="rounded-[3px] border border-[#403a67] bg-[rgba(0,0,0,.15)] px-1 py-px font-mono text-[8px] text-[#857cad]">
                  ⌘↵
                </kbd>
              </button>
              {busy === "query" && sessions && queryConnectionId && (
                <button
                  className="flex h-[25px] cursor-pointer items-center gap-1.5 rounded-[5px] border border-[rgba(239,107,115,.45)] bg-transparent px-2 text-[10px] text-red hover:bg-[rgba(239,107,115,.12)]"
                  onClick={() => onCancel?.(queryConnectionId)}
                  title="Ask the server to stop this statement"
                >
                  <Square size={11} fill="currentColor" />
                  Cancel
                </button>
              )}
              {sessions && (
                <>
                  <span className="h-4 w-px bg-border" />
                  {txnOpen ? (
                    <div className="flex items-center gap-1">
                      <span
                        className="rounded-[3px] border border-warn bg-[rgba(201,162,39,.12)] px-[7px] py-0.5 text-[10px] text-warn"
                        title="Statements run inside an open transaction"
                      >
                        Tx: Open
                      </span>
                      <button
                        className="flex h-[25px] cursor-pointer items-center gap-1 rounded-[5px] border border-border bg-transparent px-2 text-[10px] text-[#c4cad4] hover:border-green hover:text-white disabled:opacity-60"
                        disabled={busy === "query"}
                        onClick={() =>
                          onEndTransaction?.(queryConnectionId, true)
                        }
                      >
                        <Check size={12} />
                        Commit
                      </button>
                      <button
                        className="flex h-[25px] cursor-pointer items-center gap-1 rounded-[5px] border border-border bg-transparent px-2 text-[10px] text-[#c4cad4] hover:border-red hover:text-white disabled:opacity-60"
                        disabled={busy === "query"}
                        onClick={() =>
                          onEndTransaction?.(queryConnectionId, false)
                        }
                      >
                        <Undo2 size={12} />
                        Rollback
                      </button>
                    </div>
                  ) : (
                    <button
                      className="flex h-[25px] cursor-pointer items-center gap-1 rounded-[5px] border border-border bg-transparent px-2 text-[10px] text-[#c4cad4] hover:border-accent hover:text-white disabled:opacity-60"
                      disabled={busy === "query" || !queryConnection}
                      onClick={() => onBeginTransaction?.(queryConnectionId)}
                      title="Run the next statements inside a transaction"
                    >
                      Begin transaction
                    </button>
                  )}
                </>
              )}
              {statementCount > 1 && (
                <button
                  className="flex h-[25px] cursor-pointer items-center gap-1.5 rounded-[5px] border border-border bg-transparent px-2 text-[10px] text-[#c4cad4] hover:border-accent hover:text-white disabled:opacity-60"
                  disabled={busy === "query" || scriptBusy}
                  onClick={() => void runScript()}
                  title="Run every statement in order"
                >
                  <ListOrdered size={13} />
                  Run script
                  <span className="text-subtle">({statementCount})</span>
                </button>
              )}
              {scriptBusy && (
                <button
                  className="flex h-[25px] cursor-pointer items-center gap-1.5 rounded-[5px] border border-[rgba(239,107,115,.45)] bg-transparent px-2 text-[10px] text-red hover:bg-[rgba(239,107,115,.12)]"
                  onClick={() => {
                    cancelScript.current = true;
                  }}
                  title="Stop after the running statement"
                >
                  <Square size={11} fill="currentColor" />
                  Stop
                </button>
              )}
              <button
                type="button"
                className="flex h-[25px] cursor-pointer items-center gap-1.5 rounded-[5px] border border-border bg-transparent px-2 text-[10px] font-semibold text-[#c9d0db] hover:border-border-bright hover:bg-panel-soft hover:text-white disabled:opacity-60"
                disabled={busy === "query"}
                title="Format selection, or the whole query"
                onClick={formatQuery}
              >
                <WandSparkles size={14} />
                Format
                <kbd className="rounded-[3px] border border-border bg-[rgba(0,0,0,.15)] px-1 py-px font-mono text-[8px] text-subtle">
                  ⇧⌥F
                </kbd>
              </button>
              <button
                className="flex h-[25px] cursor-pointer items-center gap-1.5 rounded-[5px] border border-border bg-transparent px-2 text-[10px] font-semibold text-[#c9d0db] hover:border-border-bright hover:bg-panel-soft hover:text-white disabled:opacity-60"
                disabled={explainDisabled}
                title={
                  explainCapable
                    ? analyzeEnabled
                      ? "EXPLAIN ANALYZE — runs the query"
                      : "Explain query plan"
                    : "Explain is available for PostgreSQL and MySQL"
                }
                onClick={explain}
              >
                <GitBranch size={14} />
                Explain
              </button>
              <label
                className={cn(
                  "flex h-[25px] cursor-pointer items-center gap-1.5 rounded-[5px] border border-transparent px-1.5 text-[10px] text-muted",
                  explainDisabled && "cursor-default opacity-60",
                )}
                title="ANALYZE executes the statement and reports actual timings"
              >
                <input
                  type="checkbox"
                  className="size-3 accent-accent"
                  checked={analyzeEnabled}
                  disabled={explainDisabled}
                  onChange={(event) => setAnalyzeEnabled(event.target.checked)}
                />
                Analyze
              </label>
              {analyzeEnabled && explainCapable && (
                <span className="text-[9px] text-warn">runs the query</span>
              )}
              <button
                type="button"
                className="flex h-[25px] cursor-pointer items-center gap-1.5 rounded-[5px] border border-border bg-transparent px-2 text-[10px] text-[#c9d0db] hover:border-border-bright hover:bg-panel-soft hover:text-white disabled:opacity-60"
                title="Save this query"
                disabled={busy === "query"}
                onClick={saveCurrentQuery}
              >
                <Star size={13} />
                Save
              </button>
              <button
                type="button"
                className={cn(
                  "flex h-[25px] cursor-pointer items-center gap-1.5 rounded-[5px] border border-border bg-transparent px-2 text-[10px] text-[#c9d0db] hover:border-border-bright hover:bg-panel-soft hover:text-white",
                  historyOpen && "border-accent bg-accent-soft text-[#c9c2ff]",
                )}
                title="Query history and saved queries"
                onClick={() => setHistoryOpen((value) => !value)}
              >
                <Clock size={13} />
                History
              </button>
              <span className="h-4 w-px bg-border" />
              <span className="text-[9px] text-subtle">
                {formatError ? (
                  <span className="text-danger">
                    Cannot format: {formatError}
                  </span>
                ) : statementCount > 1 ? (
                  <label className="flex cursor-pointer items-center gap-1 text-[9px] text-subtle">
                    <input
                      type="checkbox"
                      className="size-3 cursor-pointer accent-accent"
                      checked={stopOnError}
                      onChange={(event) => setStopOnError(event.target.checked)}
                    />
                    Stop on error
                  </label>
                ) : (
                  "Run selection or current query"
                )}
              </span>
              <span className="ml-auto pr-1 text-[9px] text-subtle">
                {completionReady
                  ? "⌃Space for tables and columns"
                  : "Expand a schema to enable completions"}
              </span>
            </div>
            <div className="flex min-h-0 flex-1 overflow-hidden bg-bg">
              <SqlEditor
                key={active?.id ?? "query"}
                ref={editorRef}
                value={query}
                driver={queryConnection?.driver ?? "postgres"}
                completionSchema={completionSchema}
                schemas={querySchemas}
                defaultSchema={defaultSchema}
                onChange={setQuerySql}
                onRun={runSql}
                onFormatError={setFormatError}
                actionsDisabled={busy === "query" || scriptBusy}
                onExplain={explain}
                explainDisabled={explainDisabled}
                onRunScript={
                  statementCount > 1 ? () => void runScript() : undefined
                }
              />
            </div>
          </section>

          <section className="flex min-h-0 flex-col overflow-hidden">
            <div className="flex h-9 shrink-0 items-stretch justify-between border-b border-border bg-[#14171b]">
              <div className="flex">
                <button
                  type="button"
                  className={cn(
                    "cursor-pointer border-0 border-b border-transparent bg-transparent px-3.5 text-[10px] text-muted",
                    resultPanel === "results" && "border-accent text-[#d5dae3]",
                  )}
                  onClick={() => setResultPanel("results")}
                >
                  Results
                </button>
                {explainPlan && (
                  <button
                    type="button"
                    className={cn(
                      "cursor-pointer border-0 border-b border-transparent bg-transparent px-3.5 text-[10px] text-muted",
                      resultPanel === "plan" && "border-accent text-[#d5dae3]",
                    )}
                    onClick={() => setResultPanel("plan")}
                  >
                    Plan
                  </button>
                )}
                <button
                  type="button"
                  className={cn(
                    "cursor-pointer border-0 border-b border-transparent bg-transparent px-3.5 text-[10px] text-muted",
                    resultPanel === "messages" && "border-accent text-[#d5dae3]",
                  )}
                  onClick={() => setResultPanel("messages")}
                >
                  Messages
                </button>
              </div>
              {scriptRuns ? (
                <div className="flex items-center gap-[13px] px-[11px] text-[9px] text-subtle">
                  <span>
                    {scriptRuns.filter((item) => item.status === "ok").length} of{" "}
                    {scriptRuns.length} succeeded
                  </span>
                  {scriptRuns.some((item) => item.status === "error") && (
                    <span className="text-red">
                      {scriptRuns.filter((item) => item.status === "error").length}{" "}
                      failed
                    </span>
                  )}
                  <span>
                    {scriptRuns.reduce(
                      (total, item) => total + (item.result?.elapsedMs ?? 0),
                      0,
                    )}{" "}
                    ms
                  </span>
                </div>
              ) : (
                result &&
                resultPanel === "results" && (
                <div className="flex items-center gap-[13px] px-[11px] text-[9px] text-subtle [&>span]:flex [&>span]:items-center [&>span]:gap-1">
                  {pageable && result.columns.length > 0 ? (
                    <div className="flex items-center gap-0.5">
                      <span className="min-w-[72px] px-1 font-mono text-[10px] text-[#9aa3b0] tabular-nums">
                        {rangeStart === 0
                          ? "0 of 0"
                          : `${rangeStart}-${rangeEnd}${hasMore ? "+" : ""}`}
                      </span>
                      <button
                        type="button"
                        className="grid size-7 cursor-pointer place-items-center rounded-[5px] border-0 bg-transparent text-muted hover:bg-panel-soft hover:text-text disabled:cursor-default disabled:opacity-40"
                        title="First page"
                        disabled={busy === "query" || resultPage === 0}
                        onClick={() => loadPage(0)}
                      >
                        <ChevronsLeft size={14} />
                      </button>
                      <button
                        type="button"
                        className="grid size-7 cursor-pointer place-items-center rounded-[5px] border-0 bg-transparent text-muted hover:bg-panel-soft hover:text-text disabled:cursor-default disabled:opacity-40"
                        title="Previous page"
                        disabled={busy === "query" || resultPage === 0}
                        onClick={() => loadPage(resultPage - 1)}
                      >
                        <ChevronLeft size={14} />
                      </button>
                      <button
                        type="button"
                        className="grid size-7 cursor-pointer place-items-center rounded-[5px] border-0 bg-transparent text-muted hover:bg-panel-soft hover:text-text disabled:cursor-default disabled:opacity-40"
                        title="Next page"
                        disabled={busy === "query" || !hasMore}
                        onClick={() => loadPage(resultPage + 1)}
                      >
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  ) : (
                    <span className="!text-[#74cda0]">
                      <Check size={13} />{" "}
                      {result.rows.length || result.affectedRows}{" "}
                      {result.columns.length ? "rows" : "affected"}
                    </span>
                  )}
                  <span>{result.elapsedMs} ms</span>
                  {result.truncated && (
                    <span>Limited to {pageSize.toLocaleString()} rows</span>
                  )}
                  {result.columns.length > 0 && (
                    <button
                      type="button"
                      className="flex cursor-pointer items-center gap-1 rounded-[4px] border-0 bg-transparent px-1.5 py-1 !text-muted hover:bg-panel-soft hover:!text-text"
                      title="Export result set to a file"
                      onClick={() => {
                        setExportError("");
                        setExportProgress(null);
                        setExportOpen(true);
                      }}
                    >
                      <Download size={13} />
                      Export
                    </button>
                  )}
                </div>
                )
              )}
            </div>
            {scriptRuns ? (
              <ScriptResults
                runs={scriptRuns}
                activeIndex={scriptIndex}
                driver={queryConnection?.driver}
                onSelect={setScriptIndex}
              />
            ) : resultPanel === "plan" && explainPlan ? (
              <ExplainPlanView plan={explainPlan} />
            ) : resultPanel === "messages" ? (
              <div className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[11px] text-[#c9d0db]">
                {error ? (
                  <pre className="m-0 whitespace-pre-wrap text-danger">
                    {error}
                  </pre>
                ) : result ? (
                  <p className="m-0 text-muted">
                    Query finished in {result.elapsedMs} ms
                    {result.columns.length
                      ? ` · ${result.rows.length} row${result.rows.length === 1 ? "" : "s"}`
                      : ` · ${result.affectedRows} affected`}
                    {explainPlan
                      ? ` · plan: ${explainPlan.analyzed ? "ANALYZE" : "EXPLAIN"}`
                      : ""}
                    .
                  </p>
                ) : (
                  <p className="m-0 text-subtle">No messages yet.</p>
                )}
              </div>
            ) : (
              <ResultGrid
                result={result}
                error={error}
                driver={queryConnection?.driver}
              />
            )}
          </section>
        </>
      )}

      {exportOpen && result && (
        <ExportModal
          pageRows={result.rows.length}
          canExportAll={pagePlan?.pageable === true}
          busy={exportBusy}
          progress={exportProgress}
          error={exportError}
          onClose={() => setExportOpen(false)}
          onExport={(options) => void runExport(options)}
        />
      )}

      {saveQueryOpen && active?.kind === "query" && (
        <SaveQueryModal
          defaultName={active.title}
          onSave={confirmSaveQuery}
          onClose={() => {
            setSaveQueryOpen(false);
            setPendingSaveSql("");
          }}
        />
      )}

      <footer className="flex h-[23px] items-center overflow-hidden border-t border-border bg-[#171a20] px-[9px] text-[9px] whitespace-nowrap text-[#687181]">
        <span>
          {active?.kind === "edit"
            ? `Edit Data · ${active.schema}.${active.table}`
            : active?.kind === "er"
              ? `ER diagram · ${active.schema}`
              : (connectionInfo?.serverVersion ?? "HyperStudio local session")}
        </span>
        {txnOpen && (
          <span className="ml-2 text-warn">Transaction open · uncommitted</span>
        )}
        {extensionStatusItems
          .filter((item) => (item.alignment ?? "left") === "left")
          .map((item) => (
            <button
              type="button"
              key={`${item.source}:${item.id}`}
              className="ml-2 border-0 bg-transparent p-0 text-inherit hover:text-text"
              onClick={() =>
                item.command &&
                extensionRegistry.executeCommand(item.command, {
                  sql: editorRef.current?.getSql() ?? query,
                  selectedSql: editorRef.current?.getSelectedSql() ?? "",
                  driver: queryConnection?.driver,
                  connectionId: queryConnectionId || null,
                })
              }
            >
              {item.text}
            </button>
          ))}
        <span className="ml-auto flex gap-[13px]">
          {extensionStatusItems
            .filter((item) => item.alignment === "right")
            .map((item) => (
              <button
                type="button"
                key={`${item.source}:${item.id}`}
                className="border-0 bg-transparent p-0 text-inherit hover:text-text"
                onClick={() =>
                  item.command &&
                  extensionRegistry.executeCommand(item.command, {
                    sql: editorRef.current?.getSql() ?? query,
                    selectedSql: editorRef.current?.getSelectedSql() ?? "",
                    driver: queryConnection?.driver,
                    connectionId: queryConnectionId || null,
                  })
                }
              >
                {item.text}
              </button>
            ))}
          UTF-8 <span>LF</span> SQL
        </span>
      </footer>
    </main>

      {pendingParams && !activeExtensionView && (
        <QueryParamsPanel
          params={pendingParams.params}
          busy={busy === "query" || scriptBusy}
          onConfirm={confirmQueryParams}
          onClose={() => setPendingParams(null)}
        />
      )}
      {historyOpen && !activeExtensionView && !pendingParams && (
        <QueryHistoryPanel
          history={history}
          saved={saved}
          connectionId={queryConnectionId || selected?.id || null}
          onClose={() => setHistoryOpen(false)}
          onUse={useHistorySql}
          onDeleteHistory={(id) => setHistory(removeHistoryEntry(id))}
          onClearHistory={() => setHistory(clearHistory())}
          onDeleteSaved={(id) => setSaved(removeSavedQuery(id))}
        />
      )}
      {activeExtensionView && (
        <ExtensionView
          view={activeExtensionView.view}
          context={{
            ...activeExtensionView.context,
            sql: editorRef.current?.getSql() ?? query,
            selectedSql: editorRef.current?.getSelectedSql() ?? "",
            driver: queryConnection?.driver,
            connectionId: queryConnectionId || null,
          }}
          onClose={() => extensionRegistry.closeView()}
          getEditorSql={() => editorRef.current?.getSql() ?? query}
          getSelectedSql={() => editorRef.current?.getSelectedSql() ?? ""}
          insertEditorSql={(sql) => editorRef.current?.insertSql(sql)}
          replaceSelection={(sql) => editorRef.current?.replaceSelection(sql)}
        />
      )}
    </div>
  );
}

export { buildTableQuery } from "../lib/sql";
