import { ReactNode } from "react";
import { cn } from "../lib/cn";

interface ContextMenuProps {
  x: number;
  y: number;
  children: ReactNode;
}

export function ContextMenu({ x, y, children }: ContextMenuProps) {
  return (
    <div
      className={cn(
        "fixed z-40 min-w-[180px] rounded-lg border border-border-bright bg-surface p-1 shadow-[0_12px_40px_rgba(0,0,0,0.45)]",
        "[&_button]:flex [&_button]:h-[30px] [&_button]:w-full [&_button]:cursor-pointer [&_button]:items-center [&_button]:gap-2 [&_button]:rounded-[5px] [&_button]:border-0 [&_button]:bg-transparent [&_button]:px-[9px] [&_button]:text-left [&_button]:text-[11px] [&_button]:text-[#c5cad3]",
        "[&_button:hover]:bg-panel-soft [&_button:hover]:text-white",
        "[&_button.danger]:text-danger",
        "[&_button.danger:hover]:bg-red/10",
      )}
      style={{ left: x, top: y }}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}
