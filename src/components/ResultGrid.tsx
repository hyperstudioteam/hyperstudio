import { useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { CopyAsMenu, ExtractorToolbar, copySelection } from "./CopyAsMenu";
import { ContextMenu } from "./ContextMenu";
import { CellViewer } from "./CellViewer";
import { errorMessage } from "../lib/format";
import { presentCell } from "../plugins/contributions";
import {
  CellRange,
  ExtractorId,
  isCellInRange,
  selectionStats,
} from "../lib/extractors";
import { QueryResult } from "../types/query";

interface ResultGridProps {
  result: QueryResult | null;
  error: string;
  driver?: string;
  /** Optional SQL type name per result column, aligned to `result.columns`. */
  columnTypes?: (string | undefined)[];
}

export function ResultGrid({
  result,
  error,
  driver = "postgres",
  columnTypes,
}: ResultGridProps) {
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
  const dragging = useRef(false);

  const matrix = result?.rows ?? [];
  const stats = useMemo(
    () => selectionStats(cellRange, matrix),
    [cellRange, matrix],
  );

  useEffect(() => {
    setCellRange(null);
  }, [result]);

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
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "c") {
        return;
      }
      if (!cellRange || !result) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      void handleCopy(extractor);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cellRange, extractor, includeHeader, result]);

  function beginSelect(row: number, col: number, extend: boolean) {
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
        matrix: result.rows,
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
      <div className="error-state">
        <div>
          <strong>Query failed</strong>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="result-placeholder">
        <span>Run a query to see results</span>
      </div>
    );
  }

  if (result.columns.length === 0) {
    return (
      <div className="success-state">
        <Check size={18} /> Query completed. {result.affectedRows} rows
        affected.
      </div>
    );
  }

  return (
    <div className="result-grid-shell">
      <div className="result-grid-tools">
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
        {copyFlash && <span className="copy-flash">{copyFlash}</span>}
        {copyError && <span className="copy-error">{copyError}</span>}
        {stats.cells > 0 && (
          <span className="selection-meta">
            {stats.sum != null && <>SUM: {stats.sum} · </>}
            {stats.cells} cells, {stats.rows} rows · {stats.coord}
          </span>
        )}
      </div>
      <div
        className="grid-scroll"
        onMouseLeave={() => {
          dragging.current = false;
        }}
      >
        <table className="selectable-grid">
          <thead>
            <tr>
              <th className="row-number">#</th>
              {result.columns.map((column, index) => (
                <th key={`${column}-${index}`}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <td className="row-number">{rowIndex + 1}</td>
                {row.map((value, columnIndex) => {
                  const cell = presentCell({
                    value,
                    typeName: columnTypes?.[columnIndex],
                    columnName: result.columns[columnIndex],
                    driver,
                  });
                  return (
                    <td
                      className={[
                        value === null ? "null-value" : "",
                        cell.className,
                        `align-${cell.align}`,
                        isCellInRange(rowIndex, columnIndex, cellRange)
                          ? "cell-selected"
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
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
            value: result.rows[viewerCell.row]?.[viewerCell.col],
            typeName: columnTypes?.[viewerCell.col],
            columnName: result.columns[viewerCell.col],
            driver,
          }}
          preferredViewer={
            presentCell({
              value: result.rows[viewerCell.row]?.[viewerCell.col],
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
