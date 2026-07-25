import { Database, Search, Settings } from "lucide-react";

export function ActivityBar() {
  return (
    <aside className="activitybar">
      <button className="activity active" aria-label="Databases">
        <Database size={19} />
      </button>
      <button className="activity" aria-label="Search">
        <Search size={19} />
      </button>
      <div className="activity-spacer" />
      <button className="activity" aria-label="Settings">
        <Settings size={19} />
      </button>
    </aside>
  );
}
