import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Filter,
  Hash,
  KeyRound,
  LoaderCircle,
  Minus,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
  Settings,
  ArrowDownUp,
  Type,
  ToggleLeft,
} from "lucide-react";
import { cn } from "../lib/cn";
import { CopyAsMenu, ExtractorToolbar, copySelection } from "./CopyAsMenu";
import { ContextMenu, ContextMenuSeparator } from "./ContextMenu";
import { CellViewer } from "./CellViewer";
import { errorMessage } from "../lib/format";
import { presentCell } from "../plugins/contributions";
import { useExtensionMenu } from "../extensions/hooks";
import { extensionRegistry } from "../extensions/registry";
import {
  CellRange,
  ExtractorId,
  isCellInRange,
  normalizeRange,
  parseClipboardMatrix,
  planPaste,
  selectionStats,
} from "../lib/extractors";
import {
  buildDeleteSql,
  buildInsertSql,
  buildTableSelect,
  buildUpdateSql,
  columnTypeIcon,
  primaryKeyColumns,
} from "../lib/sql";
import { safetyOf } from "../lib/connectionGuard";
import {
  ColumnFilter,
  ColumnSort,
  buildOrderByClause,
  buildWhereClause,
  nextSort,
} from "../lib/gridFilter";
import { ColumnHeader } from "./grid/ColumnHeader";
import { ConnectionProfile } from "../types/connection";
import { QueryResult } from "../types/query";
import { ColumnNode, TableNode } from "../types/schema";

type RowStatus = "clean" | "modified" | "inserted" | "deleted";

interface EditorRow {
  id: string;
  status: RowStatus;
  original: unknown[];
  values: unknown[];
}

interface TableDataEditorProps {
  profile: ConnectionProfile;
  schema: string;
  table: string;
  tableMeta: TableNode | null;
  /** Rows per page; defaults to driver max (500). */
  pageSize?: number;
  execute: (sql: string, confirmedWrite?: boolean) => Promise<QueryResult>;
  /** Present when the driver can commit a batch atomically. */
  executeBatch?: (statements: string[]) => Promise<number[]>;
  /** Asks the user to approve a batch on a guarded connection. */
  confirmWrites?: (preview: string) => Promise<boolean>;
}

function parseCellInput(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "<null>") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return raw;
}

function cellDisplay(value: unknown): string {
  if (value === null) return "<null>";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function TypeIcon({ dataType }: { dataType: string }) {
  const kind = columnTypeIcon(dataType);
  if (kind === "number") return <Hash size={11} />;
  if (kind === "date") return <Calendar size={11} />;
  if (kind === "bool") return <ToggleLeft size={11} />;
  return <Type size={11} />;
}

const iconButtonClass =
  "grid size-7 cursor-pointer place-items-center rounded-[5px] border-0 bg-transparent text-muted hover:bg-panel-soft hover:text-text disabled:cursor-default disabled:opacity-40";
const thClass =
  "sticky top-0 z-[1] h-[29px] max-w-[300px] border-r border-b border-grid-line px-2.5 text-left font-semibold whitespace-nowrap overflow-hidden text-ellipsis text-[#aeb5c1] bg-grid-head";
const tdClass =
  "h-[29px] max-w-[300px] border-r border-b border-grid-line px-2.5 text-left whitespace-nowrap overflow-hidden text-ellipsis text-[#b9c0cb] select-none cursor-cell";

export function TableDataEditor({
  profile,
  schema,
  table,
  tableMeta,
  pageSize = 500,
  execute,
  executeBatch,
  confirmWrites,
}: TableDataEditorProps) {
  const extensionMenu = useExtensionMenu("tableData/context");
  const [where, setWhere] = useState("");
  const [orderBy, setOrderBy] = useState("");
  const [headerSort, setHeaderSort] = useState<ColumnSort | null>(null);
  const [headerFilters, setHeaderFilters] = useState<ColumnFilter[]>([]);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<EditorRow[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [columnMeta, setColumnMeta] = useState<ColumnNode[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cellRange, setCellRange] = useState<CellRange | null>(null);
  const [extractor, setExtractor] = useState<ExtractorId>("tsv");
  const [includeHeader, setIncludeHeader] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [copyFlash, setCopyFlash] = useState("");
  const [editing, setEditing] = useState<{
    rowId: string;
    col: number;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [copyAsOpen, setCopyAsOpen] = useState(false);
  const [transactional, setTransactional] = useState(Boolean(executeBatch));
  const [viewerCell, setViewerCell] = useState<{
    rowId: string;
    col: number;
  } | null>(null);
  const dragging = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);

  const pkNames = useMemo(
    () => primaryKeyColumns(columnMeta).map((column) => column.name),
    [columnMeta],
  );

  const visibleRows = rows.filter((row) => row.status !== "deleted");
  const matrix = useMemo(
    () => visibleRows.map((row) => row.values),
    [visibleRows],
  );
  const stats = useMemo(
    () => selectionStats(cellRange, matrix),
    [cellRange, matrix],
  );

  const dirtyCount = rows.filter((row) => row.status !== "clean").length;
  const rangeStart = rows.length === 0 ? 0 : page * pageSize + 1;
  const loadedCount = rows.filter((row) => row.status !== "inserted").length;
  const hasMore = truncated || loadedCount >= pageSize;
  const displayEnd = page * pageSize + loadedCount;

  /**
   * Header sort/filter changes call this with explicit overrides, since the
   * corresponding state updates have not been applied yet at that point.
   */
  async function load(
    nextPage = page,
    overrides?: {
      where?: string;
      orderBy?: string;
      filters?: ColumnFilter[];
    },
  ) {
    setBusy(true);
    setError("");
    setEditing(null);
    setCellRange(null);
    try {
      const manualWhere = overrides?.where ?? where;
      const activeFilters = overrides?.filters ?? headerFilters;
      const sql = buildTableSelect({
        driver: profile.driver,
        schema,
        table,
        where: buildWhereClause(profile.driver, activeFilters, manualWhere),
        orderBy: overrides?.orderBy ?? orderBy,
        limit: pageSize,
        offset: nextPage * pageSize,
      });
      const result = await execute(sql);
      const meta =
        tableMeta?.columns.map((column) => ({
          ...column,
          primaryKey: Boolean(column.primaryKey),
        })) ??
        result.columns.map((name) => ({
          name,
          dataType: "unknown",
          nullable: true,
          primaryKey: false,
        }));
      setColumns(result.columns);
      setColumnMeta(
        result.columns.map((name) => {
          const found = meta.find((column) => column.name === name);
          return (
            found ?? {
              name,
              dataType: "unknown",
              nullable: true,
              primaryKey: false,
            }
          );
        }),
      );
      setRows(
        result.rows.map((values, index) => ({
          id: `r-${nextPage}-${index}-${Date.now()}`,
          status: "clean" as const,
          original: [...values],
          values: [...values],
        })),
      );
      setSelected(new Set());
      setElapsedMs(result.elapsedMs);
      setTruncated(result.truncated);
      setPage(nextPage);
    } catch (nextError) {
      setError(errorMessage(nextError));
      setRows([]);
      setColumns([]);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    setHeaderSort(null);
    setHeaderFilters([]);
    void load(0, { filters: [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema, table, profile.id]);

  function toggleHeaderSort(column: string) {
    const next = nextSort(headerSort, column);
    const clause = buildOrderByClause(profile.driver, next);
    setHeaderSort(next);
    setOrderBy(clause);
    void load(0, { orderBy: clause });
  }

  function headerFilterFor(column: string): ColumnFilter | null {
    return headerFilters.find((item) => item.column === column) ?? null;
  }

  function setHeaderFilter(column: string, filter: ColumnFilter | null) {
    const rest = headerFilters.filter((item) => item.column !== column);
    const next = filter ? [...rest, filter] : rest;
    setHeaderFilters(next);
    void load(0, { filters: next });
  }

  useEffect(() => {
    function onMouseUp() {
      dragging.current = false;
    }
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => {
      setContextMenu(null);
      setCopyAsOpen(false);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  useEffect(() => {
    function isEditingField(target: EventTarget | null) {
      const el = target as HTMLElement | null;
      return Boolean(
        el &&
          (el.tagName === "INPUT" ||
            el.tagName === "TEXTAREA" ||
            el.isContentEditable),
      );
    }

    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "c") {
        if (!cellRange || editing || isEditingField(event.target)) return;
        event.preventDefault();
        void handleCopy(extractor);
      }
    }

    async function onPaste(event: ClipboardEvent) {
      if (!cellRange || editing || isEditingField(event.target)) return;
      const text = event.clipboardData?.getData("text/plain");
      if (text == null) return;
      event.preventDefault();
      applyPaste(text);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("paste", onPaste);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellRange, editing, extractor, includeHeader, matrix, columns, pkNames, visibleRows]);

  function beginSelect(row: number, col: number, extend: boolean) {
    setSelected(new Set());
    setEditing(null);
    setCellRange((current) => {
      if (extend && current) {
        return { anchor: current.anchor, focus: { row, col } };
      }
      return { anchor: { row, col }, focus: { row, col } };
    });
    dragging.current = !extend;
  }

  function extendSelect(row: number, col: number) {
    if (!dragging.current) return;
    setCellRange((current) =>
      current
        ? { ...current, focus: { row, col } }
        : { anchor: { row, col }, focus: { row, col } },
    );
  }

  async function handleCopy(format: ExtractorId = extractor) {
    if (!cellRange) return;
    try {
      await copySelection({
        extractor: format,
        driver: profile.driver,
        schema,
        table,
        columns,
        matrix,
        range: cellRange,
        pkColumns: pkNames,
        includeHeader,
      });
      setExtractor(format);
      setCopyFlash("Copied");
      window.setTimeout(() => setCopyFlash(""), 1200);
    } catch (nextError) {
      setError(errorMessage(nextError));
    }
  }

  function applyPaste(text: string) {
    if (!cellRange) return;
    const clipboard = parseClipboardMatrix(text);
    const plan = planPaste({
      clipboard,
      selection: cellRange,
      rowCount: visibleRows.length,
      colCount: columns.length,
    });

    const byRow = new Map<number, Array<{ col: number; raw: string }>>();
    for (const write of plan.writes) {
      const list = byRow.get(write.row) ?? [];
      list.push({ col: write.col, raw: write.raw });
      byRow.set(write.row, list);
    }

    setRows((current) => {
      const visibleIds = current
        .filter((row) => row.status !== "deleted")
        .map((row) => row.id);
      const idSet = new Set(visibleIds);

      return current.map((row) => {
        if (!idSet.has(row.id)) return row;
        const visibleIndex = visibleIds.indexOf(row.id);
        const patches = byRow.get(visibleIndex);
        if (!patches) return row;

        const values = [...row.values];
        for (const patch of patches) {
          values[patch.col] = parseCellInput(patch.raw);
        }
        if (row.status === "inserted") return { ...row, values };
        const changed = values.some(
          (cell, index) => !Object.is(cell, row.original[index]),
        );
        return {
          ...row,
          values,
          status: changed ? "modified" : "clean",
        };
      });
    });

    setCellRange(plan.range);
    setCopyFlash("Pasted");
    window.setTimeout(() => setCopyFlash(""), 1200);
  }

  async function handlePasteFromClipboard() {
    if (!cellRange) return;
    try {
      const text = await navigator.clipboard.readText();
      applyPaste(text);
    } catch (nextError) {
      setError(errorMessage(nextError));
    }
  }

  function updateCell(rowId: string, col: number, raw: string) {
    const value = parseCellInput(raw);
    setRows((current) =>
      current.map((row) => {
        if (row.id !== rowId) return row;
        const values = [...row.values];
        values[col] = value;
        if (row.status === "inserted") return { ...row, values };
        const changed = values.some(
          (cell, index) => !Object.is(cell, row.original[index]),
        );
        return {
          ...row,
          values,
          status: changed ? "modified" : "clean",
        };
      }),
    );
  }

  function addRow() {
    const empty = columns.map(() => null);
    const id = `new-${crypto.randomUUID()}`;
    setRows((current) => [
      {
        id,
        status: "inserted",
        original: [...empty],
        values: [...empty],
      },
      ...current,
    ]);
    setSelected(new Set([id]));
    setCellRange(null);
  }

  function rowsToDelete(): Set<string> {
    if (selected.size > 0) return selected;
    if (!cellRange) return new Set();
    const { r0, r1 } = normalizeRange(cellRange);
    const ids = new Set<string>();
    for (let r = r0; r <= r1; r += 1) {
      const row = visibleRows[r];
      if (row) ids.add(row.id);
    }
    return ids;
  }

  function deleteSelected() {
    const targets = rowsToDelete();
    if (targets.size === 0) return;
    setRows((current) =>
      current
        .map((row) => {
          if (!targets.has(row.id)) return row;
          if (row.status === "inserted") return null;
          return { ...row, status: "deleted" as const };
        })
        .filter((row): row is EditorRow => row !== null),
    );
    setSelected(new Set());
    setCellRange(null);
  }

  function revertAll() {
    setRows((current) =>
      current
        .filter((row) => row.status !== "inserted")
        .map((row) => ({
          ...row,
          status: "clean" as const,
          values: [...row.original],
        })),
    );
    setSelected(new Set());
    setCellRange(null);
    setEditing(null);
  }

  function pendingStatements(): string[] {
    const statements: string[] = [];
    for (const row of rows) {
      if (row.status === "inserted") {
        statements.push(
          buildInsertSql({
            driver: profile.driver,
            schema,
            table,
            columns,
            values: row.values,
          }),
        );
      } else if (row.status === "deleted") {
        statements.push(
          buildDeleteSql({
            driver: profile.driver,
            schema,
            table,
            columns,
            pkColumns: pkNames,
            original: row.original,
          }),
        );
      } else if (row.status === "modified") {
        const sql = buildUpdateSql({
          driver: profile.driver,
          schema,
          table,
          columns,
          pkColumns: pkNames,
          original: row.original,
          next: row.values,
        });
        if (sql) statements.push(sql);
      }
    }
    return statements;
  }

  async function commit() {
    if (dirtyCount === 0) return;
    const needsPk = rows.some(
      (row) => row.status === "modified" || row.status === "deleted",
    );
    if (needsPk && pkNames.length === 0) {
      setError(
        "Cannot commit updates/deletes without a primary key. Refresh the table schema and try again.",
      );
      return;
    }

    // Build the whole batch first so a guarded connection can approve it in
    // one prompt rather than once per row.
    const statements = pendingStatements();
    if (statements.length === 0) return;

    const safety = safetyOf(profile);
    if (safety === "readOnly") {
      setError(
        `“${profile.name}” is marked read-only. No changes were submitted.`,
      );
      return;
    }

    let approved = safety !== "confirm";
    if (!approved) {
      if (!confirmWrites) {
        setError("This connection requires confirmation, which is unavailable.");
        return;
      }
      approved = await confirmWrites(statements.join("\n"));
      if (!approved) return;
    }

    setBusy(true);
    setError("");
    try {
      if (transactional && executeBatch) {
        await executeBatch(statements);
      } else {
        for (const statement of statements) {
          await execute(statement, true);
        }
      }
      await load(page);
    } catch (nextError) {
      // A rolled-back batch leaves the staged edits intact so they can be
      // fixed and resubmitted; an auto-commit run may have applied a prefix,
      // which the reload below would hide, so keep the rows and let the user
      // refresh deliberately.
      setError(
        transactional
          ? `${errorMessage(nextError)}\nNothing was committed; the transaction rolled back.`
          : `${errorMessage(nextError)}\nEarlier statements in this batch may already be committed.`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="grid min-h-0 grid-rows-[34px_32px_auto_1fr_22px] overflow-hidden">
      <div className="flex items-center gap-1.5 border-b border-border bg-[#14171b] px-2">
        <div className="flex items-center gap-0.5">
          <span className="min-w-[72px] px-1 font-mono text-[10px] text-[#9aa3b0] tabular-nums">
            {loadedCount === 0 && dirtyCount === 0
              ? "0 of 0"
              : `${rangeStart}-${Math.max(rangeStart, displayEnd)}${hasMore ? "+" : ""}`}
          </span>
          <button
            type="button"
            className={iconButtonClass}
            title="First page"
            disabled={busy || page === 0}
            onClick={() => void load(0)}
          >
            <ChevronsLeft size={14} />
          </button>
          <button
            type="button"
            className={iconButtonClass}
            title="Previous page"
            disabled={busy || page === 0}
            onClick={() => void load(page - 1)}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            className={iconButtonClass}
            title="Next page"
            disabled={busy || !hasMore}
            onClick={() => void load(page + 1)}
          >
            <ChevronRight size={14} />
          </button>
          <button
            type="button"
            className={iconButtonClass}
            title="Last page"
            disabled
          >
            <ChevronsRight size={14} />
          </button>
        </div>

        <span className="h-4 w-px bg-border" />

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            className={iconButtonClass}
            title="Refresh"
            disabled={busy}
            onClick={() => void load(page)}
          >
            <RefreshCw size={14} className={busy ? "animate-spin-slow" : ""} />
          </button>
          <button
            type="button"
            className={iconButtonClass}
            title="Add row"
            disabled={busy || columns.length === 0}
            onClick={addRow}
          >
            <Plus size={14} />
          </button>
          <button
            type="button"
            className={iconButtonClass}
            title="Delete selected"
            disabled={busy || (selected.size === 0 && !cellRange)}
            onClick={deleteSelected}
          >
            <Minus size={14} />
          </button>
          <button
            type="button"
            className={iconButtonClass}
            title={
              transactional
                ? "Submit changes in one transaction"
                : "Submit changes, one statement at a time"
            }
            disabled={busy || dirtyCount === 0}
            onClick={() => void commit()}
          >
            <ArrowUpFromLine size={14} />
          </button>
          <button
            type="button"
            className={iconButtonClass}
            title="Revert changes"
            disabled={busy || dirtyCount === 0}
            onClick={revertAll}
          >
            <ArrowDownToLine size={14} />
          </button>
        </div>

        <span className="h-4 w-px bg-border" />
        <button
          type="button"
          className={cn(
            "cursor-pointer rounded-[3px] border border-border-bright bg-[#1a1e25] px-[7px] py-0.5 text-[10px] text-[#aeb6c3] disabled:cursor-default disabled:opacity-60",
            transactional && "border-accent text-[#c9c2ff]",
          )}
          disabled={!executeBatch || busy}
          title={
            executeBatch
              ? transactional
                ? "Changes commit as one transaction; click for auto-commit per statement"
                : "Each statement commits on its own; click to commit as one transaction"
              : `${profile.driver} does not support transactional commits`
          }
          onClick={() => setTransactional((current) => !current)}
        >
          Tx: {transactional ? "Atomic" : "Auto"}
        </button>
        {pkNames.length === 0 && columns.length > 0 && (
          <span className="text-[9px] text-subtle">
            No primary key · update/delete limited
          </span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {dirtyCount > 0 && (
            <span className="text-[10px] text-warn">
              {dirtyCount} change{dirtyCount === 1 ? "" : "s"}
            </span>
          )}
          {elapsedMs != null && (
            <span className="text-[9px] text-subtle">{elapsedMs} ms</span>
          )}
          <ExtractorToolbar
            activeExtractor={extractor}
            includeHeader={includeHeader}
            disabled={!cellRange}
            onChange={(id) => {
              setExtractor(id);
              void handleCopy(id);
            }}
            onIncludeHeaderChange={setIncludeHeader}
            onCopy={() => void handleCopy()}
          />
          <button
            type="button"
            className={iconButtonClass}
            title="Search"
            disabled
          >
            <Search size={14} />
          </button>
          <button
            type="button"
            className={iconButtonClass}
            title="Settings"
            disabled
          >
            <Settings size={14} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-[1.4fr_1fr] border-b border-border bg-grid-row">
        <label className="flex min-w-0 items-center gap-[7px] border-r border-border px-2.5 text-[10px] text-[#7d8694]">
          <Filter size={13} />
          <span className="shrink-0 font-semibold tracking-[0.02em]">WHERE</span>
          <input
            className="h-[30px] min-w-0 flex-1 border-0 bg-transparent font-mono text-[11px] leading-[1.3] text-[#d2d7df] outline-0 placeholder:text-[#4a5260]"
            value={where}
            placeholder="condition"
            spellCheck={false}
            onChange={(event) => setWhere(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void load(0);
            }}
          />
          {headerFilters.length > 0 && (
            <button
              type="button"
              className="shrink-0 cursor-pointer rounded-[3px] border border-[rgba(139,124,246,.45)] bg-accent-soft px-1.5 py-0.5 text-[9px] text-[#c9c2ff] hover:border-accent hover:text-white"
              title="Clear column filters"
              onClick={() => {
                setHeaderFilters([]);
                void load(0, { filters: [] });
              }}
            >
              +{headerFilters.length} column filter
              {headerFilters.length === 1 ? "" : "s"} ×
            </button>
          )}
        </label>
        <label className="flex min-w-0 items-center gap-[7px] px-2.5 text-[10px] text-[#7d8694]">
          <ArrowDownUp size={13} />
          <span className="shrink-0 font-semibold tracking-[0.02em]">
            ORDER BY
          </span>
          <input
            className="h-[30px] min-w-0 flex-1 border-0 bg-transparent font-mono text-[11px] leading-[1.3] text-[#d2d7df] outline-0 placeholder:text-[#4a5260]"
            value={orderBy}
            placeholder="column"
            spellCheck={false}
            onChange={(event) => {
              setOrderBy(event.target.value);
              setHeaderSort(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") void load(0);
            }}
          />
        </label>
      </div>

      {error && (
        <div className="m-2 flex gap-[9px] rounded-md border border-[rgba(239,107,115,.22)] bg-[rgba(239,107,115,.06)] p-3 text-[11px] text-red">
          <div>
            <strong className="text-[11px]">Edit Data failed</strong>
            <p className="mt-[3px] mb-0 font-mono text-[10px] leading-normal whitespace-pre-wrap text-[#c79599]">
              {error}
            </p>
          </div>
        </div>
      )}

      <div
        className="scrollbar-thin-app flex-1 overflow-auto bg-grid-row"
        ref={gridRef}
        onMouseLeave={() => {
          dragging.current = false;
        }}
      >
        {busy && rows.length === 0 ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-[11px] text-subtle">
            <LoaderCircle className="animate-spin-slow" size={16} /> Loading…
          </div>
        ) : columns.length === 0 ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-[11px] text-subtle">
            No data
          </div>
        ) : (
          <table className="min-w-full table-auto border-separate border-spacing-0 font-mono text-[10px] leading-[1.35]">
            <thead>
              <tr>
                <th className={cn(thClass, "w-[42px] min-w-[42px] text-right")}>
                  #
                </th>
                {columns.map((column, index) => {
                  const meta = columnMeta[index];
                  return (
                    <ColumnHeader
                      key={`${column}-${index}`}
                      column={column}
                      className={thClass}
                      sort={headerSort}
                      filter={headerFilterFor(column)}
                      adornment={
                        <>
                          <TypeIcon dataType={meta?.dataType ?? ""} />
                          {meta?.primaryKey && (
                            <KeyRound size={11} className="!text-pk" />
                          )}
                        </>
                      }
                      onSortToggle={() => toggleHeaderSort(column)}
                      onFilterChange={(filter) =>
                        setHeaderFilter(column, filter)
                      }
                    />
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, rowIndex) => (
                <tr
                  key={row.id}
                  className={cn(
                    "group",
                    selected.has(row.id) && "[&>td]:!bg-[#1d2430]",
                    row.status === "inserted" && "[&>td]:!bg-[#15241c]",
                  )}
                >
                  <td
                    className={cn(
                      tdClass,
                      "w-[42px] min-w-[42px] bg-row-num! text-right text-[#596272]",
                      row.status === "modified" && "text-pk",
                    )}
                    onClick={(event) => {
                      setCellRange(null);
                      setSelected((current) => {
                        const next = new Set(
                          event.metaKey || event.ctrlKey || event.shiftKey
                            ? current
                            : [],
                        );
                        if (next.has(row.id)) next.delete(row.id);
                        else next.add(row.id);
                        return next;
                      });
                    }}
                  >
                    {page * pageSize + rowIndex + 1}
                  </td>
                  {row.values.map((value, colIndex) => {
                    const isEditing =
                      editing?.rowId === row.id && editing.col === colIndex;
                    const dirty =
                      row.status === "inserted" ||
                      !Object.is(value, row.original[colIndex]);
                    const inSelection = isCellInRange(
                      rowIndex,
                      colIndex,
                      cellRange,
                    );
                    const cell = presentCell({
                      value,
                      typeName: columnMeta[colIndex]?.dataType,
                      columnName: columns[colIndex],
                      driver: profile.driver,
                    });
                    return (
                      <td
                        key={colIndex}
                        className={cn(
                          tdClass,
                          rowIndex % 2 === 1 ? "bg-grid-alt" : "bg-grid-row",
                          "group-hover:bg-grid-hover",
                          value === null && "text-[#686f7c] italic",
                          cell.className,
                          cell.align === "right" && "text-right",
                          cell.align === "center" && "text-center",
                          dirty &&
                            "shadow-[inset_2px_0_0_#c9a227]",
                          inSelection &&
                            "bg-cell-select! text-[#e8eef8] shadow-[inset_0_0_0_1px_rgba(96,150,230,.55)]",
                        )}
                        title={cell.text}
                        onMouseDown={(event) => {
                          if (event.button !== 0) return;
                          event.preventDefault();
                          beginSelect(rowIndex, colIndex, event.shiftKey);
                        }}
                        onMouseEnter={() => extendSelect(rowIndex, colIndex)}
                        onDoubleClick={() =>
                          setEditing({ rowId: row.id, col: colIndex })
                        }
                        onContextMenu={(event) => {
                          event.preventDefault();
                          if (!isCellInRange(rowIndex, colIndex, cellRange)) {
                            beginSelect(rowIndex, colIndex, false);
                          }
                          setContextMenu({
                            x: event.clientX,
                            y: event.clientY,
                          });
                          setCopyAsOpen(false);
                        }}
                      >
                        {isEditing ? (
                          <input
                            className="-mx-2.5 h-full min-h-[27px] w-full border border-accent bg-[#0f1218] px-2.5 text-[#e8ecf3] outline-0"
                            autoFocus
                            defaultValue={
                              value === null ? "" : cellDisplay(value)
                            }
                            onBlur={(event) => {
                              updateCell(row.id, colIndex, event.target.value);
                              setEditing(null);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                updateCell(
                                  row.id,
                                  colIndex,
                                  (event.target as HTMLInputElement).value,
                                );
                                setEditing(null);
                              }
                              if (event.key === "Escape") setEditing(null);
                            }}
                          />
                        ) : (
                          cell.text
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex h-[22px] items-center justify-end gap-3.5 border-t border-border bg-surface-deep px-2.5 text-[10px] text-[#8b93a1]">
        {copyFlash && <span className="text-[#72c99d]">{copyFlash}</span>}
        {stats.cells > 0 ? (
          <>
            {stats.sum != null && <span>SUM: {stats.sum}</span>}
            <span>
              {stats.cells} cell{stats.cells === 1 ? "" : "s"}, {stats.rows}{" "}
              row
              {stats.rows === 1 ? "" : "s"}
            </span>
            <span>{stats.coord}</span>
          </>
        ) : (
          <span>Select cells · ⌘C copy · ⌘V paste</span>
        )}
      </div>

      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y}>
          <button
            type="button"
            disabled={!cellRange}
            onClick={() => {
              if (cellRange) {
                const focusRow = visibleRows[cellRange.focus.row];
                if (focusRow) {
                  setViewerCell({
                    rowId: focusRow.id,
                    col: cellRange.focus.col,
                  });
                }
              }
              setContextMenu(null);
            }}
          >
            View value…
          </button>
          <button
            type="button"
            disabled={!cellRange}
            onClick={() => {
              void handleCopy();
              setContextMenu(null);
            }}
          >
            Copy
          </button>
          <button
            type="button"
            disabled={!cellRange}
            onClick={(event) => {
              event.stopPropagation();
              setCopyAsOpen(true);
            }}
          >
            Copy as…
          </button>
          <button
            type="button"
            disabled={!cellRange}
            onClick={() => {
              void handlePasteFromClipboard();
              setContextMenu(null);
            }}
          >
            Paste
          </button>
          {extensionMenu.length > 0 && <ContextMenuSeparator />}
          {extensionMenu.map((item) => (
            <button
              type="button"
              key={`${item.source}:${item.command}`}
              onClick={() => {
                const focus = cellRange?.focus;
                const row = focus ? visibleRows[focus.row] : undefined;
                extensionRegistry.executeCommand(item.command, {
                  connectionId: profile.id,
                  driver: profile.driver,
                  schema,
                  object: table,
                  column: focus ? columns[focus.col] : undefined,
                  value: focus && row ? row.values[focus.col] : undefined,
                });
                setContextMenu(null);
              }}
            >
              <Puzzle size={14} /> {item.title}
            </button>
          ))}
        </ContextMenu>
      )}
      <CopyAsMenu
        open={Boolean(contextMenu && copyAsOpen)}
        x={(contextMenu?.x ?? 0) + 140}
        y={contextMenu?.y ?? 0}
        activeExtractor={extractor}
        includeHeader={includeHeader}
        onSelect={(id) => void handleCopy(id)}
        onIncludeHeaderChange={setIncludeHeader}
        onClose={() => setCopyAsOpen(false)}
      />
      {viewerCell &&
        (() => {
          const row = rows.find((item) => item.id === viewerCell.rowId);
          if (!row) return null;
          const value = row.values[viewerCell.col];
          const ctx = {
            value,
            typeName: columnMeta[viewerCell.col]?.dataType,
            columnName: columns[viewerCell.col],
            driver: profile.driver,
          };
          return (
            <CellViewer
              context={ctx}
              preferredViewer={presentCell(ctx).defaultViewer}
              onClose={() => setViewerCell(null)}
            />
          );
        })()}
    </section>
  );
}
