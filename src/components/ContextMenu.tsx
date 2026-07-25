import { ReactNode } from "react";

interface ContextMenuProps {
  x: number;
  y: number;
  children: ReactNode;
}

export function ContextMenu({ x, y, children }: ContextMenuProps) {
  return (
    <div
      className="context-menu"
      style={{ left: x, top: y }}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}
