import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  CirclePlus,
  LoaderCircle,
  Play,
  Table2,
  X,
} from "lucide-react";
import {
  buildCompletionSchema,
  defaultSchemaFor,
  hasCompletionData,
} from "../lib/completionSchema";
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
import { ResultGrid } from "./ResultGrid";
import { SqlEditor, SqlEditorHandle } from "./SqlEditor";
import { TableDataEditor } from "./TableDataEditor";

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
  onExecute: (sql: string) => Promise<QueryResult>;
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
}: QueryWorkspaceProps) {
  const pageSize = defaultMaxRows(maxRowsProp);
  const [tabs, setTabs] = useState<WorkspaceTab[]>([
    { id: "query-1", kind: "query", title: "Query 1", sql: STARTER_QUERY },
  ]);
  const [activeId, setActiveId] = useState("query-1");
  const [resultPage, setResultPage] = useState(0);
  const [pagePlan, setPagePlan] = useState<PagedQueryPlan | null>(null);
  const editorRef = useRef<SqlEditorHandle>(null);
  const queryCounter = useRef(1);

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

  function runSql(sql: string) {
    const plan = planPagedQuery(sql, pageSize);
    setPagePlan(plan);
    setResultPage(0);
    onRun(sqlForPage(plan, 0));
  }

  function run() {
    if (!active || active.kind !== "query") return;
    runSql(editorRef.current?.getSqlToRun() ?? query);
  }

  function loadPage(page: number) {
    if (!pagePlan?.pageable) return;
    setResultPage(page);
    onRun(sqlForPage(pagePlan, page));
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
    <main
      className={`workspace ${active?.kind === "edit" ? "table-edit-mode" : ""}`}
    >
      <div className="tabbar">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`editor-tab ${tab.id === activeId ? "active" : ""}`}
            onClick={() => setActiveId(tab.id)}
          >
            {tab.kind === "query" ? (
              <span className="sql-badge">SQL</span>
            ) : (
              <Table2 size={12} className="tab-table-icon" />
            )}
            <span className="tab-title">{tab.title}</span>
            <span
              className="tab-close"
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
          className="new-tab"
          aria-label="New query"
          type="button"
          onClick={addQueryTab}
        >
          <CirclePlus size={15} />
        </button>
        <div className="connection-context">
          <span
            className={`status-dot ${connectedId === selected?.id ? "online" : ""}`}
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
        />
      ) : (
        <>
          <section className="editor-pane">
            <div className="query-toolbar">
              <button
                className="run-button"
                disabled={busy === "query"}
                onClick={run}
              >
                {busy === "query" ? (
                  <LoaderCircle className="spin" size={14} />
                ) : (
                  <Play size={14} fill="currentColor" />
                )}
                Run
                <kbd>⌘↵</kbd>
              </button>
              <span className="toolbar-separator" />
              <span className="query-hint">Run selection or current query</span>
              <span className="completion-hint">
                {completionReady
                  ? "⌃Space for tables and columns"
                  : "Expand a schema to enable completions"}
              </span>
            </div>
            <div className="editor-wrap">
              <SqlEditor
                key={active?.id ?? "query"}
                ref={editorRef}
                value={query}
                driver={selected?.driver ?? "postgres"}
                completionSchema={completionSchema}
                defaultSchema={defaultSchema}
                onChange={setQuerySql}
                onRun={runSql}
              />
            </div>
          </section>

          <section className="results-pane">
            <div className="results-header">
              <div className="results-tabs">
                <button className="result-tab active">Results</button>
                <button className="result-tab">Messages</button>
              </div>
              {result && (
                <div className="result-meta">
                  {pageable && result.columns.length > 0 ? (
                    <div className="result-paging">
                      <span className="page-range">
                        {rangeStart === 0
                          ? "0 of 0"
                          : `${rangeStart}-${rangeEnd}${hasMore ? "+" : ""}`}
                      </span>
                      <button
                        type="button"
                        className="icon-button"
                        title="First page"
                        disabled={busy === "query" || resultPage === 0}
                        onClick={() => loadPage(0)}
                      >
                        <ChevronsLeft size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        title="Previous page"
                        disabled={busy === "query" || resultPage === 0}
                        onClick={() => loadPage(resultPage - 1)}
                      >
                        <ChevronLeft size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        title="Next page"
                        disabled={busy === "query" || !hasMore}
                        onClick={() => loadPage(resultPage + 1)}
                      >
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  ) : (
                    <span>
                      <Check size={13} />{" "}
                      {result.rows.length || result.affectedRows}{" "}
                      {result.columns.length ? "rows" : "affected"}
                    </span>
                  )}
                  <span>{result.elapsedMs} ms</span>
                  {result.truncated && (
                    <span>Limited to {pageSize.toLocaleString()} rows</span>
                  )}
                </div>
              )}
            </div>
            <ResultGrid
              result={result}
              error={error}
              driver={selected?.driver}
            />
          </section>
        </>
      )}

      <footer className="statusbar">
        <span>
          {active?.kind === "edit"
            ? `Edit Data · ${active.schema}.${active.table}`
            : (connectionInfo?.serverVersion ?? "Hypergrid local session")}
        </span>
        <span className="statusbar-right">
          UTF-8 <span>LF</span> SQL
        </span>
      </footer>
    </main>
  );
}

export { buildTableQuery } from "../lib/sql";
