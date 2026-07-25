import { Database, Puzzle, Search, Settings } from "lucide-react";

interface ActivityBarProps {
  active: "databases" | "settings";
  onSelect: (view: "databases" | "settings") => void;
  onOpenPlugins: () => void;
}

export function ActivityBar({
  active,
  onSelect,
  onOpenPlugins,
}: ActivityBarProps) {
  return (
    <aside className="activitybar">
      <button
        className={`activity ${active === "databases" ? "active" : ""}`}
        aria-label="Databases"
        onClick={() => onSelect("databases")}
      >
        <Database size={19} />
      </button>
      <button className="activity" aria-label="Search" disabled title="Coming soon">
        <Search size={19} />
      </button>
      <div className="activity-spacer" />
      <button
        className="activity"
        aria-label="Plugins"
        title="Plugins"
        onClick={onOpenPlugins}
      >
        <Puzzle size={19} />
      </button>
      <button
        className={`activity ${active === "settings" ? "active" : ""}`}
        aria-label="Settings"
        title="Plugins & settings"
        onClick={onOpenPlugins}
      >
        <Settings size={19} />
      </button>
    </aside>
  );
}
