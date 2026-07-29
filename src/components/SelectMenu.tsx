import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../lib/cn";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectMenuProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  title?: string;
  className?: string;
  /** Menu alignment relative to the trigger. */
  align?: "left" | "right";
  /** Stretch the trigger to the parent width (e.g. grid cell edit). */
  fullWidth?: boolean;
  /** Open the menu on mount (e.g. cell edit). */
  defaultOpen?: boolean;
  /** Called when the menu closes without selecting (Escape / outside click). */
  onDismiss?: () => void;
  "aria-label"?: string;
}

/**
 * Dark-themed select that avoids native OS option menus
 * (Windows/WebView2 renders those with a bright white popup).
 */
export function SelectMenu({
  value,
  options,
  onChange,
  disabled = false,
  placeholder = "Select…",
  title,
  className,
  align = "right",
  fullWidth = false,
  defaultOpen = false,
  onDismiss,
  "aria-label": ariaLabel,
}: SelectMenuProps) {
  const [open, setOpen] = useState(defaultOpen);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (
        rootRef.current &&
        event.target instanceof Node &&
        rootRef.current.contains(event.target)
      ) {
        return;
      }
      setOpen(false);
      onDismissRef.current?.();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        onDismissRef.current?.();
      }
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <div className={cn("relative", className)} ref={rootRef}>
      <button
        type="button"
        className={cn(
          "flex h-[22px] cursor-pointer items-center gap-1 rounded-[5px] border border-border bg-surface-input px-1.5 text-[10px] text-text outline-none",
          "hover:border-border-bright hover:text-text",
          "focus-visible:border-accent",
          open && "border-accent",
          disabled && "cursor-default opacity-50",
          fullWidth ? "w-full max-w-none" : "max-w-[220px]",
        )}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        autoFocus={defaultOpen}
        onClick={() => setOpen((isOpen) => !isOpen)}
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          size={11}
          className={cn("shrink-0 text-subtle", open && "text-accent")}
        />
      </button>
      {open && (
        <div
          id={listId}
          role="listbox"
          className={cn(
            "absolute top-[calc(100%+4px)] z-40 max-h-[240px] min-w-full overflow-auto rounded-lg border border-border-bright bg-surface p-1",
            "shadow-[0_12px_40px_rgba(0,0,0,0.45)] scrollbar-thin-app",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {options.length === 0 ? (
            <div className="px-[9px] py-1.5 text-[11px] text-subtle">
              {placeholder}
            </div>
          ) : (
            options.map((option) => {
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={option.disabled}
                  className={cn(
                    "flex h-[28px] w-full cursor-pointer items-center gap-2 rounded-[5px] border-0 bg-transparent px-[9px] text-left text-[11px] text-text",
                    "hover:bg-panel-soft hover:text-white",
                    isSelected && "bg-accent-soft text-accent-bright",
                    option.disabled && "cursor-default opacity-40",
                  )}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {isSelected && (
                    <Check size={12} className="shrink-0 text-accent" />
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
