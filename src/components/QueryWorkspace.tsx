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
  Play,
  Square,
  Star,
  Table2,
  WandSparkles,
  X,
} from "lucide-react";
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
import { getSchemaCache } from "../lib/schemaCache";
import {
  buildTableQuery,
  defaultMaxRows,
  planPagedQuery,
  PagedQueryPlan,
  sqlForPage,
} from "../lib/sql";
import { ConnectionProfile } from "../types/connection";
import { ConnectionInfo, QueryResult } from "../types/query";
import {
  SchemaNode,
  TABLES_GROUP,
  TableNode,
  tableFromObject,
} from "../types/schema";
import { cn } from "../lib/cn";
import { errorMessage } from "../lib/format";
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
import { QueryHistoryPanel } from "./QueryHistoryPanel";
import { ResultGrid } from "./ResultGrid";
import { ScriptResults } from "./ScriptResults";
import { SqlEditor, SqlEditorHandle } from "./SqlEditor";
import { TableDataEditor } from "./TableDataEditor";

type ResultPanel = "results" | "plan" | "messages";

const STARTER_QUERY = `SELECT *
FROM users
ORDER BY created_at DESC
LIMIT 100;`;

export type WorkspaceOpen =
  | { kind: "view"; schema: string; table: string; nonce: number }
  | { kind: "edit"; schema: string; table: string; nonce: number }
  | null;

type QueryTab = {
  id: string;
  kind: "query";
  title: string;
  sql: string;
};

type EditTab = {
  id: string;
  kind: "edit";
  title: string;
  schema: string;
  table: string;
};

type WorkspaceTab = QueryTab | EditTab;

interface QueryWorkspaceProps {
  selected: ConnectionProfile | null;
  connectedId: string | null;
  connectionInfo: ConnectionInfo | null;
  busy: "connect" | "query" | "schema" | null;
  result: QueryResult | null;
  error: string;
  /** Cached metadata for the active connection, used for autocompletion. */
  schemas: SchemaNode[];
  /** Driver max rows per SELECT page (from capabilities.maxRows). */
  maxRows?: number;
  openRequest: WorkspaceOpen;
  onRun: (sql: string) => void;
  onExecute: (sql: string, confirmedWrite?: boolean) => Promise<QueryResult>;
  /** Set only when the driver can commit a batch atomically. */
  onExecuteBatch?: (statements: string[]) => Promise<number[]>;
  /** Prompts for a guarded connection; resolves true when the user agrees. */
  onConfirmWrites?: (preview: string) => Promise<boolean>;
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
  connectedId,
  connectionInfo,
  busy,
  result,
  error,
  schemas,
  maxRows: maxRowsProp,
  openRequest,
  onRun,
  onExecute,
  onExecuteBatch,
  onConfirmWrites,
}: QueryWorkspaceProps) {
  const pageSize = defaultMaxRows(maxRowsProp);
  const [tabs, setTabs] = useState<WorkspaceTab[]>([
    { id: "query-1", kind: "query", title: "Query 1", sql: STARTER_QUERY },
  ]);
  const [activeId, setActiveId] = useState("query-1");
  const [resultPage, setResultPage] = useState(0);
  const [pagePlan, setPagePlan] = useState<PagedQueryPlan | null>(null);
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
  const queryCounter = useRef(1);
  const cancelScript = useRef(false);
  /** SQL awaiting its result so the run can be recorded once it settles. */
  const pendingRunRef = useRef<string | null>(null);

  const completionSchema = useMemo(
    () => buildCompletionSchema(schemas),
    [schemas],
  );
  const defaultSchema = useMemo(
    () => (selected ? defaultSchemaFor(selected, schemas) : undefined),
    [selected, schemas],
  );
  const completionReady = useMemo(
    () => hasCompletionData(schemas),
    [schemas],
  );

  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0] ?? null;
  const query = active?.kind === "query" ? active.sql : STARTER_QUERY;
  const statementCount = useMemo(
    () => splitStatements(query).length,
    [query],
  );
  const explainCapable = canVisualizeExplain(selected?.driver);
  const explainDisabled =
    busy === "query" || !selected || connectedId !== selected.id || !explainCapable;

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
    setHistory(
      recordHistory({
        sql,
        connectionId: selected?.id ?? "",
        succeeded: !error,
        elapsedMs: result?.elapsedMs,
        rowCount: result?.columns.length ? result.rows.length : undefined,
      }),
    );
    // Only react to a settled query; selected is read as a snapshot.
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
              ? { ...tab, sql }
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
          },
        ]);
        setActiveId(id);
      }
      runSql(sql);
      return;
    }

    const id = `edit-${openRequest.schema}.${openRequest.table}`;
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
        },
      ];
    });
    setActiveId(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest?.nonce]);

  function setQuerySql(sql: string) {
    if (!active || active.kind !== "query") return;
    setTabs((current) =>
      current.map((tab) =>
        tab.id === active.id && tab.kind === "query" ? { ...tab, sql } : tab,
      ),
    );
  }

  function runExplainSql(sql: string, analyze: boolean) {
    if (!selected || !canVisualizeExplain(selected.driver)) return;
    const wrapped = wrapExplainSql(selected.driver, sql, { analyze });
    pendingExplainRef.current = {
      analyzed: analyze,
      sql: wrapped,
      driver: selected.driver,
    };
    setPagePlan({ pageable: false, sql: wrapped });
    setResultPage(0);
    setExplainPlan(null);
    onRun(wrapped);
  }

  function runSql(sql: string) {
    setScriptRuns(null);
    if (isExplainSql(sql) && selected && canVisualizeExplain(selected.driver)) {
      const analyze = explainHasAnalyze(sql) || analyzeEnabled;
      runExplainSql(sql, analyze);
      return;
    }

    pendingExplainRef.current = null;
    setExplainPlan(null);
    setResultPanel("results");
    const plan = planPagedQuery(sql, pageSize);
    setPagePlan(plan);
    setResultPage(0);
    pendingRunRef.current = sql;
    onRun(sqlForPage(plan, 0));
  }

  function run() {
    if (!active || active.kind !== "query") return;
    runSql(editorRef.current?.getSqlToRun() ?? query);
  }

  async function runScript() {
    if (!active || active.kind !== "query" || scriptBusy) return;
    const statements = splitStatements(
      editorRef.current?.getSqlToRun() ?? query,
    );
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
        runs[index].result = await onExecute(runs[index].sql);
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

  function formatQuery() {
    if (!active || active.kind !== "query") return;
    setFormatError("");
    editorRef.current?.format();
  }

  function explain() {
    if (!active || active.kind !== "query") return;
    const sql = editorRef.current?.getSqlToRun() ?? query;
    runExplainSql(sql, analyzeEnabled);
  }

  function loadPage(page: number) {
    if (!pagePlan?.pageable) return;
    setResultPage(page);
    onRun(sqlForPage(pagePlan, page));
  }

  function useHistorySql(sql: string) {
    if (!active || active.kind !== "query") {
      queryCounter.current += 1;
      const id = `query-${queryCounter.current}`;
      setTabs((current) => [
        ...current,
        { id, kind: "query", title: `Query ${queryCounter.current}`, sql },
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
    const name = window.prompt("Save query as", active.title);
    if (!name) return;
    setSaved(saveQuery({ name, sql, connectionId: selected?.id ?? null }));
    setHistoryOpen(true);
  }

  async function runExport(options: ExportOptions) {
    if (!result || !selected) return;

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

    try {
      const outcome = await exportResultSet({
        path,
        format: options.format,
        driver: selected.driver,
        target: "exported_rows",
        includeHeader: options.includeHeader,
        pageSize,
        fetchPage: async (page) => {
          if (!options.allRows || !plan?.pageable) {
            return page === 0
              ? { ...result, rows: currentRows }
              : null;
          }
          return onExecute(sqlForPage(plan, page));
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
      },
    ]);
    setActiveId(id);
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
        active?.kind === "edit"
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
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full bg-[#4e5664]",
              connectedId === selected?.id &&
                "bg-green shadow-[0_0_7px_rgba(73,201,137,.4)]",
            )}
          />
          {selected
            ? `${selected.name || selected.database}${connectedId === selected.id ? "" : " · cached"}`
            : "Not connected"}
        </div>
      </div>

      {active?.kind === "edit" && selected ? (
        <TableDataEditor
          key={active.id}
          profile={selected}
          schema={active.schema}
          table={active.table}
          tableMeta={findTableMeta(selected.id, active.schema, active.table)}
          pageSize={pageSize}
          execute={onExecute}
          executeBatch={onExecuteBatch}
          confirmWrites={onConfirmWrites}
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
                driver={selected?.driver ?? "postgres"}
                completionSchema={completionSchema}
                defaultSchema={defaultSchema}
                onChange={setQuerySql}
                onRun={runSql}
                onFormatError={setFormatError}
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
                driver={selected?.driver}
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
                driver={selected?.driver}
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

      <footer className="flex h-[23px] items-center overflow-hidden border-t border-border bg-[#171a20] px-[9px] text-[9px] whitespace-nowrap text-[#687181]">
        <span>
          {active?.kind === "edit"
            ? `Edit Data · ${active.schema}.${active.table}`
            : (connectionInfo?.serverVersion ?? "HyperStudio local session")}
        </span>
        <span className="ml-auto flex gap-[13px]">
          UTF-8 <span>LF</span> SQL
        </span>
      </footer>
    </main>

      {historyOpen && (
        <QueryHistoryPanel
          history={history}
          saved={saved}
          connectionId={selected?.id ?? null}
          onClose={() => setHistoryOpen(false)}
          onUse={useHistorySql}
          onDeleteHistory={(id) => setHistory(removeHistoryEntry(id))}
          onClearHistory={() => setHistory(clearHistory())}
          onDeleteSaved={(id) => setSaved(removeSavedQuery(id))}
        />
      )}
    </div>
  );
}

export { buildTableQuery } from "../lib/sql";
