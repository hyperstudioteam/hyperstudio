import { Braces, Settings } from "lucide-react";
import { cn } from "../lib/cn";

const iconButtonClass = cn(
  "grid h-7 w-7 cursor-pointer place-items-center rounded-[5px] border-0 bg-transparent p-0 text-muted",
  "enabled:hover:bg-panel-soft enabled:hover:text-text",
  "disabled:cursor-default disabled:opacity-40",
);

interface TitleBarProps {
  onOpenSettings?: () => void;
}

export function TitleBar({ onOpenSettings }: TitleBarProps) {
  return (
    <header
      className="flex h-[38px] select-none items-center justify-between border-b border-border bg-titlebar py-0 pl-[76px] pr-2.5 max-[760px]:pl-[66px]"
      data-tauri-drag-region
    >
      <div className="flex items-center gap-2 text-xs font-[650] tracking-[0.01em]">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-[linear-gradient(145deg,var(--color-accent-bright),var(--color-accent))] text-white">
          <Braces size={17} />
        </span>
        <span>HyperStudio</span>
        <span className="rounded border border-border-bright px-[5px] text-[9px] uppercase leading-4 tracking-[0.06em] text-muted">
          alpha
        </span>
      </div>
      <div className="flex">
        <button
          type="button"
          className={iconButtonClass}
          aria-label="Settings"
          title="Settings"
          onClick={onOpenSettings}
        >
          <Settings size={16} />
        </button>
      </div>
    </header>
  );
}
