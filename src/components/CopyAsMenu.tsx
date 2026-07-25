import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ClipboardCopy } from "lucide-react";
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

function ExtractorMenuBody({
  activeExtractor,
  includeHeader,
  onSelect,
  onIncludeHeaderChange,
}: ExtractorMenuBodyProps) {
  return (
    <>
      <div className="extractor-menu-title">Data Extractors</div>
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
          <div key={groupId} className="extractor-group">
            <div className="extractor-group-label">{labelText}</div>
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                className={option.id === activeExtractor ? "active" : ""}
                onClick={() => onSelect(option.id)}
              >
                <span className="extractor-check">
                  {option.id === activeExtractor ? <Check size={12} /> : null}
                </span>
                {option.label}
              </button>
            ))}
            {groupId === "csv" && (
              <button
                type="button"
                className="extractor-toggle"
                onClick={(event) => {
                  event.stopPropagation();
                  onIncludeHeaderChange(!includeHeader);
                }}
              >
                <span className="extractor-check">
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
      className="extractor-menu"
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
    <div className="extractor-toolbar" ref={rootRef}>
      <button
        type="button"
        className="extractor-trigger"
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
        className="icon-button"
        title="Copy selection"
        disabled={disabled}
        onClick={onCopy}
      >
        <ClipboardCopy size={14} />
      </button>
      {open && (
        <div className="extractor-menu anchored">
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
