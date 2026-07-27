import { Separator } from "react-resizable-panels";
import { cn } from "../lib/cn";

/** Thin drag handle between resizable studio panels. */
export function PanelResizeHandle({ className }: { className?: string }) {
  return (
    <Separator
      className={cn(
        "relative z-[1] shrink-0 bg-border outline-none transition-colors",
        "aria-[orientation=vertical]:w-px aria-[orientation=horizontal]:h-px",
        // Expand the hit target without shifting layout.
        "after:absolute after:inset-0",
        "aria-[orientation=vertical]:after:-left-1 aria-[orientation=vertical]:after:-right-1",
        "aria-[orientation=horizontal]:after:-top-1 aria-[orientation=horizontal]:after:-bottom-1",
        "hover:bg-accent data-[separator=active]:bg-accent data-[separator=focus]:bg-accent",
        className,
      )}
    />
  );
}
