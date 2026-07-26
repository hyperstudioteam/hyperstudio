import {
  ReactNode,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "../lib/cn";

interface ContextMenuProps {
  x: number;
  y: number;
  children: ReactNode;
}

const menuPanelClass = cn(
  "min-w-[180px] rounded-lg border border-border-bright bg-surface p-1 shadow-[0_12px_40px_rgba(0,0,0,0.45)]",
  "[&_button]:flex [&_button]:h-[30px] [&_button]:w-full [&_button]:cursor-pointer [&_button]:items-center [&_button]:gap-2 [&_button]:rounded-[5px] [&_button]:border-0 [&_button]:bg-transparent [&_button]:px-[9px] [&_button]:text-left [&_button]:text-[11px] [&_button]:text-[#c5cad3]",
  "[&_button:hover]:bg-panel-soft [&_button:hover]:text-white",
  "[&_button:disabled]:cursor-default [&_button:disabled]:opacity-40 [&_button:disabled:hover]:bg-transparent [&_button:disabled:hover]:text-[#c5cad3]",
  "[&_button.danger]:text-danger",
  "[&_button.danger:hover]:bg-red/10",
);

export function ContextMenu({ x, y, children }: ContextMenuProps) {
  return (
    <div
      className={cn("fixed z-40", menuPanelClass)}
      style={{ left: x, top: y }}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}

export function ContextMenuSeparator() {
  return <div className="my-1 h-px bg-border" />;
}

interface ContextMenuSubmenuProps {
  label: string;
  icon?: ReactNode;
  children: ReactNode;
}

export function ContextMenuSubmenu({
  label,
  icon,
  children,
}: ContextMenuSubmenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    };
  }, []);

  function clearClose() {
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  function scheduleClose() {
    clearClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  }

  function openSubmenu() {
    clearClose();
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const submenuWidth = 180;
    const gap = 2;
    const spaceRight = window.innerWidth - rect.right;
    const left =
      spaceRight >= submenuWidth + gap
        ? rect.right + gap
        : Math.max(8, rect.left - submenuWidth - gap);
    const top = Math.min(rect.top, window.innerHeight - 8);
    setPos({ x: left, y: top });
    setOpen(true);
  }

  function onTriggerClick(event: ReactMouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    openSubmenu();
  }

  return (
    <div
      ref={rootRef}
      className="relative"
      onMouseEnter={openSubmenu}
      onMouseLeave={scheduleClose}
    >
      <button
        ref={triggerRef}
        type="button"
        className={open ? "bg-panel-soft text-white" : undefined}
        onClick={onTriggerClick}
      >
        {icon}
        {label}
        <ChevronRight size={12} className="ml-auto shrink-0 text-subtle" />
      </button>
      {open && (
        <div
          className={cn("fixed z-50", menuPanelClass)}
          style={{ left: pos.x, top: pos.y }}
          onMouseEnter={clearClose}
          onMouseLeave={scheduleClose}
          onClick={(event) => event.stopPropagation()}
        >
          {children}
        </div>
      )}
    </div>
  );
}
