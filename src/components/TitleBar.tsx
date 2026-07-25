import { Braces, Settings } from "lucide-react";

export function TitleBar() {
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="brand">
        <span className="brand-mark">
          <Braces size={17} />
        </span>
        <span>Hypergrid</span>
        <span className="alpha">alpha</span>
      </div>
      <div className="title-actions">
        <button className="icon-button" aria-label="Settings">
          <Settings size={16} />
        </button>
      </div>
    </header>
  );
}
