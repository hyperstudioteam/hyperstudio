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
  RefreshCw,
  Search,
  Settings,
  ArrowDownUp,
  Type,
  ToggleLeft,
} from "lucide-react";
import { CopyAsMenu, ExtractorToolbar, copySelection } from "./CopyAsMenu";
import { ContextMenu } from "./ContextMenu";
import { CellViewer } from "./CellViewer";
import { errorMessage } from "../lib/format";
import { presentCell } from "../plugins/contributions";
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
  execute: (sql: string) => Promise<QueryResult>;
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

export function TableDataEditor({
  profile,
  schema,
  table,
  tableMeta,
  pageSize = 500,
  execute,
}: TableDataEditorProps) {
  const [where, setWhere] = useState("");
  const [orderBy, setOrderBy] = useState("");
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

  async function load(nextPage = page) {
    setBusy(true);
    setError("");
    setEditing(null);
    setCellRange(null);
    try {
      const sql = buildTableSelect({
        driver: profile.driver,
        schema,
        table,
        where,
        orderBy,
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
    void load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema, table, profile.id]);

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

    setBusy(true);
    setError("");
    try {
      for (const row of rows) {
        if (row.status === "inserted") {
          await execute(
            buildInsertSql({
              driver: profile.driver,
              schema,
              table,
              columns,
              values: row.values,
            }),
          );
        } else if (row.status === "deleted") {
          await execute(
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
          if (sql) await execute(sql);
        }
      }
      await load(page);
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="table-editor">
      <div className="data-toolbar">
        <div className="data-toolbar-group">
          <span className="page-range">
            {loadedCount === 0 && dirtyCount === 0
              ? "0 of 0"
              : `${rangeStart}-${Math.max(rangeStart, displayEnd)}${hasMore ? "+" : ""}`}
          </span>
          <button
            type="button"
            className="icon-button"
            title="First page"
            disabled={busy || page === 0}
            onClick={() => void load(0)}
          >
            <ChevronsLeft size={14} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Previous page"
            disabled={busy || page === 0}
            onClick={() => void load(page - 1)}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Next page"
            disabled={busy || !hasMore}
            onClick={() => void load(page + 1)}
          >
            <ChevronRight size={14} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Last page"
            disabled
          >
            <ChevronsRight size={14} />
          </button>
        </div>

        <span className="toolbar-separator" />

        <div className="data-toolbar-group">
          <button
            type="button"
            className="icon-button"
            title="Refresh"
            disabled={busy}
            onClick={() => void load(page)}
          >
            <RefreshCw size={14} className={busy ? "spin" : ""} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Add row"
            disabled={busy || columns.length === 0}
            onClick={addRow}
          >
            <Plus size={14} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Delete selected"
            disabled={busy || (selected.size === 0 && !cellRange)}
            onClick={deleteSelected}
          >
            <Minus size={14} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Submit changes"
            disabled={busy || dirtyCount === 0}
            onClick={() => void commit()}
          >
            <ArrowUpFromLine size={14} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Revert changes"
            disabled={busy || dirtyCount === 0}
            onClick={revertAll}
          >
            <ArrowDownToLine size={14} />
          </button>
        </div>

        <span className="toolbar-separator" />
        <span className="tx-badge">Tx: Auto</span>
        {pkNames.length === 0 && columns.length > 0 && (
          <span className="muted-meta">No primary key · update/delete limited</span>
        )}

        <div className="data-toolbar-right">
          {dirtyCount > 0 && (
            <span className="dirty-badge">
              {dirtyCount} change{dirtyCount === 1 ? "" : "s"}
            </span>
          )}
          {elapsedMs != null && (
            <span className="muted-meta">{elapsedMs} ms</span>
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
          <button type="button" className="icon-button" title="Search" disabled>
            <Search size={14} />
          </button>
          <button type="button" className="icon-button" title="Settings" disabled>
            <Settings size={14} />
          </button>
        </div>
      </div>

      <div className="filter-bar">
        <label className="filter-field">
          <Filter size={13} />
          <span>WHERE</span>
          <input
            value={where}
            placeholder="condition"
            spellCheck={false}
            onChange={(event) => setWhere(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void load(0);
            }}
          />
        </label>
        <label className="filter-field">
          <ArrowDownUp size={13} />
          <span>ORDER BY</span>
          <input
            value={orderBy}
            placeholder="column"
            spellCheck={false}
            onChange={(event) => setOrderBy(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void load(0);
            }}
          />
        </label>
      </div>

      {error && (
        <div className="error-state table-editor-error">
          <div>
            <strong>Edit Data failed</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      <div
        className="grid-scroll edit-grid"
        ref={gridRef}
        onMouseLeave={() => {
          dragging.current = false;
        }}
      >
        {busy && rows.length === 0 ? (
          <div className="result-placeholder">
            <LoaderCircle className="spin" size={16} /> Loading…
          </div>
        ) : columns.length === 0 ? (
          <div className="result-placeholder">No data</div>
        ) : (
          <table className="selectable-grid">
            <thead>
              <tr>
                <th className="row-number">#</th>
                {columns.map((column, index) => {
                  const meta = columnMeta[index];
                  return (
                    <th key={`${column}-${index}`}>
                      <span className="col-head">
                        <TypeIcon dataType={meta?.dataType ?? ""} />
                        {meta?.primaryKey && (
                          <KeyRound size={11} className="pk-icon" />
                        )}
                        {column}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, rowIndex) => (
                <tr
                  key={row.id}
                  className={[
                    selected.has(row.id) ? "selected-row" : "",
                    row.status === "modified" ? "dirty-row" : "",
                    row.status === "inserted" ? "inserted-row" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <td
                    className="row-number"
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
                        className={[
                          value === null ? "null-value" : "",
                          cell.className,
                          `align-${cell.align}`,
                          dirty ? "dirty-cell" : "",
                          inSelection ? "cell-selected" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
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
                            className="cell-editor"
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

      <div className="selection-statusbar">
        {copyFlash && <span className="copy-flash">{copyFlash}</span>}
        {stats.cells > 0 ? (
          <>
            {stats.sum != null && <span>SUM: {stats.sum}</span>}
            <span>
              {stats.cells} cell{stats.cells === 1 ? "" : "s"}, {stats.rows} row
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
