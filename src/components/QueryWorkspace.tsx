import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  CirclePlus,
  LoaderCircle,
  Network,
  Play,
  Table2,
  X,
} from "lucide-react";
import { errorMessage } from "../lib/format";
import { ErDiagram } from "../lib/erDiagram";
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
import { cn } from "../lib/cn";
import { ErDiagramView } from "./ErDiagramView";
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
  | { kind: "er"; schema: string; nonce: number }
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

type ErTab = {
  id: string;
  kind: "er";
  title: string;
  schema: string;
};

type WorkspaceTab = QueryTab | EditTab | ErTab;

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
  onLoadEr: (schema: string) => Promise<ErDiagram>;
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
  onLoadEr,
}: QueryWorkspaceProps) {
  const pageSize = defaultMaxRows(maxRowsProp);
  const [tabs, setTabs] = useState<WorkspaceTab[]>([
    { id: "query-1", kind: "query", title: "Query 1", sql: STARTER_QUERY },
  ]);
  const [activeId, setActiveId] = useState("query-1");
  const [resultPage, setResultPage] = useState(0);
  const [pagePlan, setPagePlan] = useState<PagedQueryPlan | null>(null);
  const [erDiagram, setErDiagram] = useState<ErDiagram | null>(null);
  const [erBusy, setErBusy] = useState(false);
  const [erError, setErError] = useState("");
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
      className={cn(
        "min-w-0 grid overflow-hidden bg-bg",
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
              <span className="h-4 w-px bg-border" />
              <span className="text-[9px] text-subtle">
                Run selection or current query
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
              />
            </div>
          </section>

          <section className="flex min-h-0 flex-col overflow-hidden">
            <div className="flex h-9 shrink-0 items-stretch justify-between border-b border-border bg-[#14171b]">
              <div className="flex">
                <button className="cursor-pointer border-0 border-b border-accent bg-transparent px-3.5 text-[10px] text-[#d5dae3]">
                  Results
                </button>
                <button className="cursor-pointer border-0 border-b border-transparent bg-transparent px-3.5 text-[10px] text-muted">
                  Messages
                </button>
              </div>
              {result && (
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

      <footer className="flex h-[23px] items-center overflow-hidden border-t border-border bg-[#171a20] px-[9px] text-[9px] whitespace-nowrap text-[#687181]">
        <span>
          {active?.kind === "edit"
            ? `Edit Data · ${active.schema}.${active.table}`
            : active?.kind === "er"
              ? `ER diagram · ${active.schema}`
              : (connectionInfo?.serverVersion ?? "HyperStudio local session")}
        </span>
        <span className="ml-auto flex gap-[13px]">
          UTF-8 <span>LF</span> SQL
        </span>
      </footer>
    </main>
  );
}

export { buildTableQuery } from "../lib/sql";
