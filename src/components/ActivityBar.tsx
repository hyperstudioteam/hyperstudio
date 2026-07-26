import { Database, Puzzle, Search, Settings } from "lucide-react";
import { cn } from "../lib/cn";

interface ActivityBarProps {
  active: "databases" | "settings";
  onSelect: (view: "databases" | "settings") => void;
  onOpenPlugins: () => void;
}

const activityClass = cn(
  "relative grid h-[33px] w-[33px] cursor-pointer place-items-center rounded-md border-0 bg-transparent text-subtle",
  "hover:bg-panel-soft hover:text-text",
);

export function ActivityBar({
  active,
  onSelect,
  onOpenPlugins,
}: ActivityBarProps) {
  return (
    <aside className="flex flex-col items-center gap-[5px] border-r border-border bg-activity px-[5px] py-2">
      <button
        className={cn(
          activityClass,
          active === "databases" &&
            "bg-accent-soft text-accent-bright before:absolute before:-left-[5px] before:h-[19px] before:w-0.5 before:rounded-sm before:bg-accent before:content-['']",
        )}
        aria-label="Databases"
        onClick={() => onSelect("databases")}
      >
        <Database size={19} />
      </button>
      <button
        className={activityClass}
        aria-label="Search"
        disabled
        title="Coming soon"
      >
        <Search size={19} />
      </button>
      <div className="flex-1" />
      <button
        className={activityClass}
        aria-label="Plugins"
        title="Plugins"
        onClick={onOpenPlugins}
      >
        <Puzzle size={19} />
      </button>
      <button
        className={cn(
          activityClass,
          active === "settings" &&
            "bg-accent-soft text-accent-bright before:absolute before:-left-[5px] before:h-[19px] before:w-0.5 before:rounded-sm before:bg-accent before:content-['']",
        )}
        aria-label="Settings"
        title="Plugins & settings"
        onClick={onOpenPlugins}
      >
        <Settings size={19} />
      </button>
    </aside>
  );
}
