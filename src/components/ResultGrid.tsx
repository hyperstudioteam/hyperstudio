import { useEffect, useMemo, useRef, useState } from "react";
import { Check, FilterX, Puzzle } from "lucide-react";
import { cn } from "../lib/cn";
import {
  ColumnFilter,
  ColumnSort,
  applyGridView,
  nextSort,
} from "../lib/gridFilter";
import { ColumnHeader } from "./grid/ColumnHeader";
import { CopyAsMenu, ExtractorToolbar, copySelection } from "./CopyAsMenu";
import { ContextMenu, ContextMenuSeparator } from "./ContextMenu";
import { CellViewer } from "./CellViewer";
import { errorMessage } from "../lib/format";
import { isPrimaryModifier } from "../lib/platform";
import { presentCell } from "../plugins/contributions";
import {
  CellRange,
  ExtractorId,
  extractSelection,
  isCellInRange,
  selectionStats,
} from "../lib/extractors";
import { QueryResult } from "../types/query";
import { useExtensionMenu } from "../extensions/hooks";
import { extensionRegistry } from "../extensions/registry";

interface ResultGridProps {
  result: QueryResult | null;
  error: string;
  driver?: string;
  /** Optional SQL type name per result column, aligned to `result.columns`. */
  columnTypes?: (string | undefined)[];
}

const thClass =
  "sticky top-0 z-[1] h-[29px] max-w-[300px] border-r border-b border-grid-line px-2.5 text-left font-semibold whitespace-nowrap overflow-hidden text-ellipsis text-muted bg-grid-head";
const tdClass =
  "h-[29px] max-w-[300px] border-r border-b border-grid-line px-2.5 text-left whitespace-nowrap overflow-hidden text-ellipsis text-text select-none cursor-cell";

export function ResultGrid({
  result,
  error,
  driver = "postgres",
  columnTypes,
}: ResultGridProps) {
  const extensionMenu = useExtensionMenu("result/context");
  const [viewerCell, setViewerCell] = useState<{
    row: number;
    col: number;
  } | null>(null);
  const [cellRange, setCellRange] = useState<CellRange | null>(null);
  const [extractor, setExtractor] = useState<ExtractorId>("tsv");
  const [includeHeader, setIncludeHeader] = useState(false);
  const [copyFlash, setCopyFlash] = useState("");
  const [copyError, setCopyError] = useState("");
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [copyAsOpen, setCopyAsOpen] = useState(false);
  const [sort, setSort] = useState<ColumnSort | null>(null);
  const [filters, setFilters] = useState<ColumnFilter[]>([]);
  const dragging = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);

  const columns = useMemo(() => result?.columns ?? [], [result]);
  const sourceRows = useMemo(() => result?.rows ?? [], [result]);
  // Sorting and filtering here reshape the loaded page only; they never re-query.
  const view = useMemo(
    () => applyGridView(columns, sourceRows, sort, filters),
    [columns, sourceRows, sort, filters],
  );
  const matrix = view.rows;
  const stats = useMemo(
    () => selectionStats(cellRange, matrix),
    [cellRange, matrix],
  );

  useEffect(() => {
    setCellRange(null);
    setSort(null);
    setFilters([]);
  }, [result]);

  function filterFor(column: string): ColumnFilter | null {
    return filters.find((item) => item.column === column) ?? null;
  }

  function setColumnFilter(column: string, filter: ColumnFilter | null) {
    setCellRange(null);
    setFilters((current) => {
      const rest = current.filter((item) => item.column !== column);
      return filter ? [...rest, filter] : rest;
    });
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

    function onCopy(event: ClipboardEvent) {
      if (!cellRange || !result || isEditingField(event.target)) return;
      try {
        const text = extractSelection({
          extractor,
          driver,
          columns: result.columns,
          matrix,
          range: cellRange,
          includeHeader,
        });
        event.preventDefault();
        event.clipboardData?.setData("text/plain", text);
        setCopyFlash("Copied");
        setCopyError("");
        window.setTimeout(() => setCopyFlash(""), 1200);
      } catch (nextError) {
        setCopyError(errorMessage(nextError));
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (isEditingField(event.target)) return;
      if (event.key.toLowerCase() !== "a" || !isPrimaryModifier(event)) return;
      if (event.altKey || event.shiftKey || event.repeat) return;
      if (!result || matrix.length === 0 || result.columns.length === 0) return;
      // Skip when this results panel is kept-alive but hidden.
      if (gridRef.current?.closest('[aria-hidden="true"]')) return;
      event.preventDefault();
      setCellRange({
        anchor: { row: 0, col: 0 },
        focus: {
          row: matrix.length - 1,
          col: result.columns.length - 1,
        },
      });
    }

    window.addEventListener("copy", onCopy);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("copy", onCopy);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [cellRange, extractor, includeHeader, result, matrix, driver]);

  function focusGrid() {
    gridRef.current?.focus({ preventScroll: true });
  }

  function beginSelect(row: number, col: number, extend: boolean) {
    focusGrid();
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
    if (!cellRange || !result) return;
    try {
      await copySelection({
        extractor: format,
        driver,
        columns: result.columns,
        matrix,
        range: cellRange,
        includeHeader,
      });
      setExtractor(format);
      setCopyError("");
      setCopyFlash("Copied");
      window.setTimeout(() => setCopyFlash(""), 1200);
    } catch (nextError) {
      setCopyError(errorMessage(nextError));
    }
  }

  if (error) {
    return (
      <div className="m-3 flex gap-[9px] rounded-md border border-red/20 bg-red/5 p-3 text-[11px] text-red">
        <div>
          <strong className="text-[11px]">Query failed</strong>
          <p className="mt-[3px] mb-0 font-mono text-[10px] leading-normal whitespace-pre-wrap text-danger">
            {error}
          </p>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-[11px] text-subtle">
        <span>Run a query to see results</span>
      </div>
    );
  }

  if (result.columns.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-[11px] text-green">
        <Check size={18} /> Query completed. {result.affectedRows} rows
        affected.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-7 shrink-0 items-center gap-2.5 border-b border-border bg-surface-deep px-2">
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
        {copyFlash && (
          <span className="text-green">{copyFlash}</span>
        )}
        {copyError && <span className="text-red">{copyError}</span>}
        <span className="ml-auto flex items-center gap-2.5 text-[10px] text-muted">
          {filters.length > 0 && (
            <>
              <span className="text-warn">
                {matrix.length} of {sourceRows.length} rows on this page
              </span>
              <button
                type="button"
                className="flex cursor-pointer items-center gap-1 rounded-[4px] border-0 bg-transparent px-1 py-0.5 text-muted hover:bg-panel-soft hover:text-text"
                title="Clear all column filters"
                onClick={() => {
                  setFilters([]);
                  setCellRange(null);
                }}
              >
                <FilterX size={12} />
                Clear filters
              </button>
            </>
          )}
          {stats.cells > 0 && (
            <span>
              {stats.sum != null && <>SUM: {stats.sum} · </>}
              {stats.cells} cells, {stats.rows} rows · {stats.coord}
            </span>
          )}
        </span>
      </div>
      <div
        ref={gridRef}
        tabIndex={0}
        className="scrollbar-thin-app flex-1 overflow-auto outline-none"
        onMouseLeave={() => {
          dragging.current = false;
        }}
      >
        <table className="min-w-full table-auto border-separate border-spacing-0 font-mono text-[10px] leading-[1.35]">
          <thead>
            <tr>
              <th className={cn(thClass, "w-[42px] min-w-[42px] text-right")}>
                #
              </th>
              {result.columns.map((column, index) => (
                <ColumnHeader
                  key={`${column}-${index}`}
                  column={column}
                  className={thClass}
                  sort={sort}
                  filter={filterFor(column)}
                  onSortToggle={() => {
                    setSort((current) => nextSort(current, column));
                    setCellRange(null);
                  }}
                  onFilterChange={(filter) => setColumnFilter(column, filter)}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, rowIndex) => (
              <tr key={rowIndex} className="group">
                <td
                  className={cn(
                    tdClass,
                    "w-[42px] min-w-[42px] bg-row-num! text-right text-subtle",
                  )}
                >
                  {(view.sourceIndex[rowIndex] ?? rowIndex) + 1}
                </td>
                {row.map((value, columnIndex) => {
                  const cell = presentCell({
                    value,
                    typeName: columnTypes?.[columnIndex],
                    columnName: result.columns[columnIndex],
                    driver,
                  });
                  const selected = isCellInRange(
                    rowIndex,
                    columnIndex,
                    cellRange,
                  );
                  return (
                    <td
                      className={cn(
                        tdClass,
                        rowIndex % 2 === 1 ? "bg-grid-alt" : "bg-grid-row",
                        "group-hover:bg-grid-hover",
                        value === null && "text-subtle italic",
                        cell.className,
                        cell.align === "right" && "text-right",
                        cell.align === "center" && "text-center",
                        selected &&
                          "bg-cell-select! text-text-bright ring-1 ring-inset ring-blue/50",
                      )}
                      key={columnIndex}
                      title={cell.text}
                      onMouseDown={(event) => {
                        if (event.button !== 0) return;
                        event.preventDefault();
                        beginSelect(rowIndex, columnIndex, event.shiftKey);
                      }}
                      onMouseEnter={() => extendSelect(rowIndex, columnIndex)}
                      onDoubleClick={() =>
                        setViewerCell({ row: rowIndex, col: columnIndex })
                      }
                      onContextMenu={(event) => {
                        event.preventDefault();
                        if (!isCellInRange(rowIndex, columnIndex, cellRange)) {
                          beginSelect(rowIndex, columnIndex, false);
                        }
                        setContextMenu({
                          x: event.clientX,
                          y: event.clientY,
                        });
                        setCopyAsOpen(false);
                      }}
                    >
                      {cell.text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y}>
          <button
            type="button"
            disabled={!cellRange}
            onClick={() => {
              if (cellRange) {
                setViewerCell({
                  row: cellRange.focus.row,
                  col: cellRange.focus.col,
                });
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
          {extensionMenu.length > 0 && <ContextMenuSeparator />}
          {extensionMenu.map((item) => (
            <button
              type="button"
              key={`${item.source}:${item.command}`}
              onClick={() => {
                const focus = cellRange?.focus;
                extensionRegistry.executeCommand(item.command, {
                  driver,
                  column: focus ? result?.columns[focus.col] : undefined,
                  value: focus ? result?.rows[focus.row]?.[focus.col] : undefined,
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
      {viewerCell && result && (
        <CellViewer
          context={{
            value: matrix[viewerCell.row]?.[viewerCell.col],
            typeName: columnTypes?.[viewerCell.col],
            columnName: result.columns[viewerCell.col],
            driver,
          }}
          preferredViewer={
            presentCell({
              value: matrix[viewerCell.row]?.[viewerCell.col],
              typeName: columnTypes?.[viewerCell.col],
              columnName: result.columns[viewerCell.col],
              driver,
            }).defaultViewer
          }
          onClose={() => setViewerCell(null)}
        />
      )}
    </div>
  );
}
