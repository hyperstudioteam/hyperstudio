import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Filter, X } from "lucide-react";
import { cn } from "../../lib/cn";
import {
  ColumnFilter,
  ColumnSort,
  FILTER_OPERATORS,
  FilterOperator,
  isUnary,
} from "../../lib/gridFilter";

interface ColumnHeaderProps {
  column: string;
  className: string;
  sort: ColumnSort | null;
  filter: ColumnFilter | null;
  /** Rendered before the label, e.g. a type or primary-key icon. */
  adornment?: React.ReactNode;
  onSortToggle: () => void;
  onFilterChange: (filter: ColumnFilter | null) => void;
}

export function ColumnHeader({
  column,
  className,
  sort,
  filter,
  adornment,
  onSortToggle,
  onFilterChange,
}: ColumnHeaderProps) {
  const [open, setOpen] = useState(false);
  const cellRef = useRef<HTMLTableCellElement>(null);
  const sorted = sort?.column === column ? sort.direction : null;
  const filtered = filter !== null;

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(event: MouseEvent) {
      if (!cellRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onDocMouseDown);
    return () => window.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  return (
    <th ref={cellRef} className={cn(className, "relative group/col")}>
      <span className="flex items-center gap-[5px]">
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-[5px] border-0 bg-transparent p-0 text-left text-inherit [&>svg]:text-subtle"
          title={`Sort by ${column}`}
          onClick={onSortToggle}
        >
          {adornment}
          <span className="min-w-0 truncate">{column}</span>
          {sorted === "asc" && (
            <ArrowUp size={11} className="shrink-0 !text-accent-bright" />
          )}
          {sorted === "desc" && (
            <ArrowDown size={11} className="shrink-0 !text-accent-bright" />
          )}
        </button>
        <button
          type="button"
          className={cn(
            "grid size-4 shrink-0 cursor-pointer place-items-center rounded-[3px] border-0 bg-transparent p-0 text-subtle opacity-0 group-hover/col:opacity-100 hover:text-text",
            (filtered || open) && "!text-accent-bright opacity-100",
          )}
          aria-label={`Filter ${column}`}
          title={`Filter ${column}`}
          onClick={(event) => {
            event.stopPropagation();
            setOpen((value) => !value);
          }}
        >
          <Filter size={10} />
        </button>
      </span>

      {open && (
        <FilterPopover
          column={column}
          filter={filter}
          onApply={(next) => {
            onFilterChange(next);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </th>
  );
}

interface FilterPopoverProps {
  column: string;
  filter: ColumnFilter | null;
  onApply: (filter: ColumnFilter | null) => void;
  onClose: () => void;
}

function FilterPopover({
  column,
  filter,
  onApply,
  onClose,
}: FilterPopoverProps) {
  const [operator, setOperator] = useState<FilterOperator>(
    filter?.operator ?? "contains",
  );
  const [value, setValue] = useState(filter?.value ?? "");
  const unary = isUnary(operator);

  function apply() {
    if (!unary && value === "") {
      onApply(null);
      return;
    }
    onApply({ column, operator, value: unary ? "" : value });
  }

  return (
    <div
      className="absolute top-full left-0 z-20 mt-1 w-[212px] rounded-md border border-border bg-panel-raised p-2 font-sans text-[10px] font-normal shadow-[0_14px_40px_rgba(0,0,0,.5)]"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <span className="truncate text-subtle">{column}</span>
        <button
          type="button"
          className="grid size-4 cursor-pointer place-items-center rounded-[3px] border-0 bg-transparent p-0 text-subtle hover:text-text"
          aria-label="Close filter"
          onClick={onClose}
        >
          <X size={10} />
        </button>
      </div>

      <select
        className="mb-1.5 h-6 w-full rounded-[4px] border border-border bg-surface-input px-1.5 text-[10px] text-text outline-none focus:border-accent"
        value={operator}
        onChange={(event) =>
          setOperator(event.target.value as FilterOperator)
        }
      >
        {FILTER_OPERATORS.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>

      {!unary && (
        <input
          className="mb-1.5 h-6 w-full rounded-[4px] border border-border bg-surface-input px-1.5 font-mono text-[10px] text-text outline-none focus:border-accent"
          placeholder="value"
          autoFocus
          value={value}
          spellCheck={false}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") apply();
            if (event.key === "Escape") onClose();
          }}
        />
      )}

      <div className="flex gap-1.5">
        <button
          type="button"
          className="flex-1 cursor-pointer rounded-[4px] border border-border bg-transparent px-2 py-1 text-[10px] text-muted hover:border-border-bright hover:text-text"
          onClick={() => onApply(null)}
        >
          Clear
        </button>
        <button
          type="button"
          className="flex-1 cursor-pointer rounded-[4px] border border-accent/45 bg-accent-soft px-2 py-1 text-[10px] font-semibold text-accent-bright hover:border-accent hover:text-white"
          onClick={apply}
        >
          Apply
        </button>
      </div>
    </div>
  );
}
