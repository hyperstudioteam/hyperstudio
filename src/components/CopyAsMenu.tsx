import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ClipboardCopy } from "lucide-react";
import { cn } from "../lib/cn";
import {
  COPY_AS_OPTIONS,
  ExtractorId,
  extractSelection,
  CellRange,
  copyText,
} from "../lib/extractors";
import { ConnectionProfile } from "../types/connection";

interface ExtractorMenuBodyProps {
  activeExtractor: ExtractorId;
  includeHeader: boolean;
  onSelect: (id: ExtractorId) => void;
  onIncludeHeaderChange: (value: boolean) => void;
}

const menuButtonClass =
  "flex h-7 w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 text-left text-[11px] text-[#c4cad4] hover:bg-[#2a3344] hover:text-white";

function ExtractorMenuBody({
  activeExtractor,
  includeHeader,
  onSelect,
  onIncludeHeaderChange,
}: ExtractorMenuBodyProps) {
  return (
    <>
      <div className="px-3 pt-1 pb-2 text-[11px] font-semibold text-[#d5dae3]">
        Data Extractors
      </div>
      {(["built-in", "csv", "scripted"] as const).map((groupId) => {
        const options = COPY_AS_OPTIONS.filter(
          (option) => option.group === groupId,
        );
        const labelText =
          groupId === "built-in"
            ? "Built-in"
            : groupId === "csv"
              ? "CSV"
              : "Scripted";
        return (
          <div key={groupId}>
            <div className="px-3 pt-2 pb-1 text-[9px] font-semibold tracking-[0.04em] text-[#6f7785] uppercase">
              {labelText}
            </div>
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                className={cn(
                  menuButtonClass,
                  option.id === activeExtractor && "bg-[#2a3344] text-white",
                )}
                onClick={() => onSelect(option.id)}
              >
                <span className="grid w-3.5 place-items-center text-[#72c99d]">
                  {option.id === activeExtractor ? <Check size={12} /> : null}
                </span>
                {option.label}
              </button>
            ))}
            {groupId === "csv" && (
              <button
                type="button"
                className={cn(menuButtonClass, "text-[#9aa3b0]")}
                onClick={(event) => {
                  event.stopPropagation();
                  onIncludeHeaderChange(!includeHeader);
                }}
              >
                <span className="grid w-3.5 place-items-center text-[#72c99d]">
                  {includeHeader ? <Check size={12} /> : null}
                </span>
                Include header
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}

interface CopyAsMenuProps {
  open: boolean;
  x: number;
  y: number;
  activeExtractor: ExtractorId;
  includeHeader: boolean;
  onSelect: (id: ExtractorId) => void;
  onIncludeHeaderChange: (value: boolean) => void;
  onClose: () => void;
}

const menuPanelClass =
  "z-40 max-h-[min(420px,70vh)] min-w-[220px] overflow-auto rounded-md border border-border-bright bg-[#1c2028] py-1.5 shadow-[0_12px_40px_rgba(0,0,0,.45)]";

export function CopyAsMenu({
  open,
  x,
  y,
  activeExtractor,
  includeHeader,
  onSelect,
  onIncludeHeaderChange,
  onClose,
}: CopyAsMenuProps) {
  useEffect(() => {
    if (!open) return;
    const close = () => onClose();
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={cn(menuPanelClass, "fixed")}
      style={{ left: x, top: y }}
      onClick={(event) => event.stopPropagation()}
    >
      <ExtractorMenuBody
        activeExtractor={activeExtractor}
        includeHeader={includeHeader}
        onSelect={(id) => {
          onSelect(id);
          onClose();
        }}
        onIncludeHeaderChange={onIncludeHeaderChange}
      />
    </div>
  );
}

interface ExtractorToolbarProps {
  activeExtractor: ExtractorId;
  includeHeader: boolean;
  disabled?: boolean;
  onChange: (id: ExtractorId) => void;
  onIncludeHeaderChange: (value: boolean) => void;
  onCopy: () => void;
}

export function ExtractorToolbar({
  activeExtractor,
  includeHeader,
  disabled,
  onChange,
  onIncludeHeaderChange,
  onCopy,
}: ExtractorToolbarProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const label =
    COPY_AS_OPTIONS.find((option) => option.id === activeExtractor)?.label ??
    activeExtractor.toUpperCase();

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="relative flex items-center gap-0.5" ref={rootRef}>
      <button
        type="button"
        className="inline-flex h-6 cursor-pointer items-center gap-1 rounded border border-border-bright bg-[#1a1e25] px-[7px] text-[10px] text-[#b8bfca] hover:text-white disabled:cursor-default disabled:opacity-50"
        disabled={disabled}
        title={includeHeader ? "Include header: on" : "Include header: off"}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
        {includeHeader ? " · H" : ""}
        <ChevronDown size={12} />
      </button>
      <button
        type="button"
        className="grid size-7 cursor-pointer place-items-center rounded-[5px] border-0 bg-transparent text-muted hover:bg-panel-soft hover:text-text disabled:cursor-default disabled:opacity-40"
        title="Copy selection"
        disabled={disabled}
        onClick={onCopy}
      >
        <ClipboardCopy size={14} />
      </button>
      {open && (
        <div className={cn(menuPanelClass, "absolute top-[calc(100%+4px)] right-0 left-auto")}>
          <ExtractorMenuBody
            activeExtractor={activeExtractor}
            includeHeader={includeHeader}
            onSelect={(id) => {
              onChange(id);
              setOpen(false);
            }}
            onIncludeHeaderChange={onIncludeHeaderChange}
          />
        </div>
      )}
    </div>
  );
}

export async function copySelection(options: {
  extractor: ExtractorId;
  driver: ConnectionProfile["driver"];
  schema?: string;
  table?: string;
  columns: string[];
  matrix: unknown[][];
  range: CellRange;
  pkColumns?: string[];
  includeHeader?: boolean;
}) {
  const text = extractSelection({
    ...options,
    includeHeader: options.includeHeader ?? false,
  });
  await copyText(text);
  return text;
}
