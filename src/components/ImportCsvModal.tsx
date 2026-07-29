import { useMemo, useRef, useState } from "react";
import { FileSpreadsheet, LoaderCircle, X } from "lucide-react";
import { cn } from "../lib/cn";
import { CSV_DELIMITERS, CsvDelimiter, headerNames, parseCsv, sniffDelimiter } from "../lib/csv";
import { ImportMapping, autoMap, buildInsertBatches } from "../lib/csvImport";
import { errorMessage } from "../lib/format";
import { ConnectionProfile } from "../types/connection";
import { QueryResult } from "../types/query";
import { ColumnNode } from "../types/schema";

interface ImportCsvModalProps {
  profile: ConnectionProfile;
  schema: string;
  table: string;
  columns: ColumnNode[];
  execute: (sql: string) => Promise<QueryResult>;
  onClose: () => void;
  /** Called after a successful import so the caller can refresh its view. */
  onImported?: (rows: number) => void;
}

const PREVIEW_ROWS = 8;
const BATCH_SIZE = 200;

const labelClass = "flex flex-col gap-[5px] text-muted text-[10px] font-[540]";
const inputClass =
  "w-full h-[30px] px-[9px] border border-border-bright rounded-[5px] text-text bg-surface-input text-[11px] focus:border-accent placeholder:text-subtle";

export function ImportCsvModal({
  profile,
  schema,
  table,
  columns,
  execute,
  onClose,
  onImported,
}: ImportCsvModalProps) {
  const [fileName, setFileName] = useState("");
  const [text, setText] = useState("");
  const [delimiter, setDelimiter] = useState<CsvDelimiter>(",");
  const [hasHeader, setHasHeader] = useState(true);
  const [nullToken, setNullToken] = useState("");
  const [mappings, setMappings] = useState<ImportMapping[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [done, setDone] = useState(0);
  const cancelled = useRef(false);

  const grid = useMemo(
    () => (text ? parseCsv(text, delimiter) : []),
    [text, delimiter],
  );
  const headers = useMemo(
    () =>
      hasHeader && grid[0]
        ? headerNames(grid[0])
        : (grid[0] ?? []).map((_, index) => `Column ${index + 1}`),
    [grid, hasHeader],
  );
  const dataRows = hasHeader ? grid.slice(1) : grid;
  const mapped = mappings.filter((item) => item.sourceIndex >= 0);

  async function readFile(file: File) {
    setError("");
    setDone(0);
    const content = await file.text();
    const guessed = sniffDelimiter(content.slice(0, 8000));
    const parsed = parseCsv(content, guessed);
    const firstRow = parsed[0] ?? [];
    setFileName(file.name);
    setText(content);
    setDelimiter(guessed);
    setMappings(autoMap(columns, headerNames(firstRow)));
  }

  function remap(columnName: string, sourceIndex: number) {
    setMappings((current) =>
      current.map((item) =>
        item.column.name === columnName ? { ...item, sourceIndex } : item,
      ),
    );
  }

  async function runImport() {
    if (mapped.length === 0 || dataRows.length === 0) return;
    const statements = buildInsertBatches(dataRows, {
      driver: profile.driver,
      schema,
      table,
      mappings,
      nullToken,
      batchSize: BATCH_SIZE,
    });

    cancelled.current = false;
    setBusy(true);
    setError("");
    setProgress(0);
    setDone(0);

    let inserted = 0;
    try {
      for (let index = 0; index < statements.length; index += 1) {
        if (cancelled.current) break;
        await execute(statements[index]);
        inserted = Math.min((index + 1) * BATCH_SIZE, dataRows.length);
        setProgress(inserted / dataRows.length);
        setDone(inserted);
      }
      if (!cancelled.current) {
        onImported?.(inserted);
      }
    } catch (nextError) {
      setError(
        `${errorMessage(nextError)}\n${inserted} row${inserted === 1 ? "" : "s"} were inserted before this failure.`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-20 grid place-items-center bg-black/70 p-5 backdrop-blur-[4px]"
      onMouseDown={(event) =>
        event.target === event.currentTarget && !busy && onClose()
      }
    >
      <div className="flex max-h-full w-[min(780px,100%)] flex-col overflow-hidden rounded-[10px] border border-border-bright bg-surface shadow-[0_24px_70px_rgba(0,0,0,.48)]">
        <div className="flex items-center justify-between border-b border-border px-[18px] py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-green/15 text-green">
              <FileSpreadsheet size={17} />
            </span>
            <div>
              <h2 className="m-0 text-sm font-[630] text-text-bright">
                Import CSV
              </h2>
              <p className="m-0 font-mono text-[10px] text-subtle">
                {schema}.{table}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="grid size-7 cursor-pointer place-items-center rounded-[5px] border-0 bg-transparent text-muted hover:bg-panel-soft hover:text-text"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-[18px] py-3.5">
          <div className="grid grid-cols-[1fr_130px_130px] items-end gap-3">
            <label className={labelClass}>
              CSV file
              <input
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/plain"
                className="text-[10px] text-muted file:mr-2 file:cursor-pointer file:rounded-[5px] file:border file:border-border-bright file:bg-surface-input file:px-2 file:py-1 file:text-[10px] file:text-text"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void readFile(file);
                }}
              />
            </label>
            <label className={labelClass}>
              Delimiter
              <select
                className={inputClass}
                value={delimiter}
                onChange={(event) =>
                  setDelimiter(event.target.value as CsvDelimiter)
                }
              >
                {CSV_DELIMITERS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              NULL when value is
              <input
                className={inputClass}
                value={nullToken}
                placeholder="(empty only)"
                onChange={(event) => setNullToken(event.target.value)}
              />
            </label>
          </div>

          {text && (
            <>
              <label className="mt-2.5 flex cursor-pointer items-center gap-1.5 text-[10px] text-muted">
                <input
                  type="checkbox"
                  className="size-3 cursor-pointer accent-accent"
                  checked={hasHeader}
                  onChange={(event) => {
                    setHasHeader(event.target.checked);
                    const first = grid[0] ?? [];
                    setMappings(
                      event.target.checked
                        ? autoMap(columns, headerNames(first))
                        : columns.map((column, index) => ({
                            column,
                            sourceIndex: index < first.length ? index : -1,
                          })),
                    );
                  }}
                />
                First row is a header
                <span className="ml-2 text-subtle">
                  {fileName} · {dataRows.length.toLocaleString()} data row
                  {dataRows.length === 1 ? "" : "s"}
                </span>
              </label>

              <h3 className="mt-3.5 mb-1.5 text-[10px] font-semibold tracking-[0.04em] text-subtle uppercase">
                Preview
              </h3>
              <div className="overflow-auto rounded-[6px] border border-border">
                <table className="min-w-full border-separate border-spacing-0 font-mono text-[10px]">
                  <thead>
                    <tr>
                      {headers.map((header, index) => (
                        <th
                          key={index}
                          className="sticky top-0 border-r border-b border-grid-line bg-grid-head px-2 py-1 text-left font-semibold whitespace-nowrap text-muted"
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dataRows.slice(0, PREVIEW_ROWS).map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {headers.map((_, colIndex) => (
                          <td
                            key={colIndex}
                            className="max-w-[220px] overflow-hidden border-r border-b border-grid-line bg-grid-row px-2 py-1 text-ellipsis whitespace-nowrap text-text"
                          >
                            {row[colIndex] ?? ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h3 className="mt-3.5 mb-1.5 text-[10px] font-semibold tracking-[0.04em] text-subtle uppercase">
                Column mapping
              </h3>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {mappings.map((item) => (
                  <label
                    key={item.column.name}
                    className="flex items-center gap-2 text-[10px] text-muted"
                  >
                    <span className="w-[42%] shrink-0 truncate font-mono text-[10px] text-text">
                      {item.column.name}
                      <span className="ml-1 text-subtle">
                        {item.column.dataType}
                      </span>
                    </span>
                    <select
                      className={cn(inputClass, "h-[26px] flex-1")}
                      value={item.sourceIndex}
                      onChange={(event) =>
                        remap(item.column.name, Number(event.target.value))
                      }
                    >
                      <option value={-1}>— skip —</option>
                      {headers.map((header, index) => (
                        <option key={index} value={index}>
                          {header}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </>
          )}

          {error && (
            <p className="mt-3 mb-0 rounded-md border border-red/20 bg-red/5 p-2.5 font-mono text-[10px] whitespace-pre-wrap text-danger">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-[18px] py-3">
          <span className="text-[10px] text-subtle">
            {busy
              ? `Inserting… ${Math.round(progress * 100)}%`
              : done > 0 && !error
                ? `Inserted ${done.toLocaleString()} rows`
                : mapped.length > 0
                  ? `${mapped.length} of ${columns.length} columns mapped · ${BATCH_SIZE} rows per statement`
                  : "Choose a file to begin"}
          </span>
          <div className="flex gap-[7px]">
            <button
              type="button"
              className="h-[31px] cursor-pointer rounded-[5px] border-0 bg-transparent px-[11px] text-[10px] font-semibold text-muted hover:bg-panel-soft hover:text-white"
              onClick={() => {
                if (busy) cancelled.current = true;
                else onClose();
              }}
            >
              {busy ? "Stop" : "Close"}
            </button>
            <button
              type="button"
              className="flex h-[31px] cursor-pointer items-center gap-1.5 rounded-[5px] border border-accent bg-accent px-[11px] text-[10px] font-semibold text-white hover:bg-accent-bright disabled:cursor-default disabled:opacity-50"
              disabled={busy || mapped.length === 0 || dataRows.length === 0}
              onClick={() => void runImport()}
            >
              {busy && <LoaderCircle className="animate-spin-slow" size={13} />}
              Import {dataRows.length > 0 ? dataRows.length.toLocaleString() : ""} rows
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
