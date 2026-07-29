import { useMemo, useState } from "react";
import { Clock, Search, Star, Trash2, X } from "lucide-react";
import { cn } from "../lib/cn";
import {
  HistoryEntry,
  SavedQuery,
  formatRelativeTime,
  previewSql,
} from "../lib/queryHistory";

type Tab = "history" | "saved";

interface QueryHistoryPanelProps {
  history: HistoryEntry[];
  saved: SavedQuery[];
  /** Limits the history list to the active connection when set. */
  connectionId: string | null;
  onClose: () => void;
  /** Load the statement into the active editor tab. */
  onUse: (sql: string) => void;
  onDeleteHistory: (id: string) => void;
  onClearHistory: () => void;
  onDeleteSaved: (id: string) => void;
}

export function QueryHistoryPanel({
  history,
  saved,
  connectionId,
  onClose,
  onUse,
  onDeleteHistory,
  onClearHistory,
  onDeleteSaved,
}: QueryHistoryPanelProps) {
  const [tab, setTab] = useState<Tab>("history");
  const [search, setSearch] = useState("");
  const [thisConnectionOnly, setThisConnectionOnly] = useState(true);

  const needle = search.trim().toLowerCase();

  const visibleHistory = useMemo(() => {
    return history.filter((entry) => {
      if (thisConnectionOnly && connectionId && entry.connectionId !== connectionId) {
        return false;
      }
      return !needle || entry.sql.toLowerCase().includes(needle);
    });
  }, [history, needle, thisConnectionOnly, connectionId]);

  const visibleSaved = useMemo(() => {
    return saved.filter(
      (entry) =>
        !needle ||
        entry.name.toLowerCase().includes(needle) ||
        entry.sql.toLowerCase().includes(needle),
    );
  }, [saved, needle]);

  return (
    <aside className="flex h-full min-w-0 flex-col bg-panel">
      <header className="flex h-9 shrink-0 items-center border-b border-border bg-surface-deep">
        <button
          type="button"
          className={cn(
            "flex h-full cursor-pointer items-center gap-1.5 border-0 border-b border-transparent bg-transparent px-3 text-[10px] text-muted",
            tab === "history" && "border-accent text-text-bright",
          )}
          onClick={() => setTab("history")}
        >
          <Clock size={12} />
          History
        </button>
        <button
          type="button"
          className={cn(
            "flex h-full cursor-pointer items-center gap-1.5 border-0 border-b border-transparent bg-transparent px-3 text-[10px] text-muted",
            tab === "saved" && "border-accent text-text-bright",
          )}
          onClick={() => setTab("saved")}
        >
          <Star size={12} />
          Saved
        </button>
        <button
          type="button"
          className="ml-auto mr-1.5 grid size-6 cursor-pointer place-items-center rounded-[4px] border-0 bg-transparent text-subtle hover:bg-panel-soft hover:text-text"
          aria-label="Close panel"
          onClick={onClose}
        >
          <X size={13} />
        </button>
      </header>

      <div className="shrink-0 border-b border-border px-2 py-2">
        <div className="flex h-[26px] items-center gap-1.5 rounded-[5px] border border-border bg-surface-input px-2 focus-within:border-accent">
          <Search size={12} className="shrink-0 text-subtle" />
          <input
            className="min-w-0 flex-1 border-0 bg-transparent text-[11px] text-text outline-none placeholder:text-subtle"
            placeholder={tab === "history" ? "Search history" : "Search saved"}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {tab === "history" && (
          <div className="mt-1.5 flex items-center justify-between">
            <label className="flex cursor-pointer items-center gap-1.5 text-[9px] text-subtle">
              <input
                type="checkbox"
                className="size-3 accent-accent"
                checked={thisConnectionOnly}
                onChange={(event) =>
                  setThisConnectionOnly(event.target.checked)
                }
              />
              This connection only
            </label>
            {history.length > 0 && (
              <button
                type="button"
                className="cursor-pointer border-0 bg-transparent p-0 text-[9px] text-subtle hover:text-danger"
                onClick={onClearHistory}
              >
                Clear all
              </button>
            )}
          </div>
        )}
      </div>

      <div className="scrollbar-thin-app min-h-0 flex-1 overflow-auto">
        {tab === "history" ? (
          visibleHistory.length === 0 ? (
            <EmptyState
              text={
                history.length === 0
                  ? "Queries you run will appear here."
                  : "No matching history."
              }
            />
          ) : (
            visibleHistory.map((entry) => (
              <EntryRow
                key={entry.id}
                title={previewSql(entry.sql)}
                meta={[
                  formatRelativeTime(entry.ranAt),
                  entry.runCount > 1 ? `${entry.runCount}×` : null,
                  entry.elapsedMs != null ? `${entry.elapsedMs} ms` : null,
                  entry.rowCount != null ? `${entry.rowCount} rows` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                failed={!entry.succeeded}
                onUse={() => onUse(entry.sql)}
                onDelete={() => onDeleteHistory(entry.id)}
              />
            ))
          )
        ) : visibleSaved.length === 0 ? (
          <EmptyState
            text={
              saved.length === 0
                ? "Save a query from the editor toolbar."
                : "No matching saved queries."
            }
          />
        ) : (
          visibleSaved.map((entry) => (
            <EntryRow
              key={entry.id}
              title={entry.name}
              subtitle={previewSql(entry.sql, 90)}
              meta={formatRelativeTime(entry.savedAt)}
              onUse={() => onUse(entry.sql)}
              onDelete={() => onDeleteSaved(entry.id)}
            />
          ))
        )}
      </div>
    </aside>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <p className="m-0 px-3 py-4 text-center text-[10px] text-subtle">{text}</p>
  );
}

interface EntryRowProps {
  title: string;
  subtitle?: string;
  meta: string;
  failed?: boolean;
  onUse: () => void;
  onDelete: () => void;
}

function EntryRow({
  title,
  subtitle,
  meta,
  failed,
  onUse,
  onDelete,
}: EntryRowProps) {
  return (
    <div className="group flex items-start gap-1 border-b border-grid-line px-2 py-1.5 hover:bg-panel-soft">
      <button
        type="button"
        className="min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 text-left"
        title="Load into the editor"
        onClick={onUse}
      >
        <div
          className={cn(
            "truncate font-mono text-[10px] text-text",
            failed && "text-danger",
          )}
        >
          {title}
        </div>
        {subtitle && (
          <div className="mt-0.5 truncate font-mono text-[9px] text-subtle">
            {subtitle}
          </div>
        )}
        <div className="mt-0.5 text-[9px] text-subtle">
          {failed && <span className="text-danger">failed · </span>}
          {meta}
        </div>
      </button>
      <button
        type="button"
        className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-[3px] border-0 bg-transparent p-0 text-subtle opacity-0 group-hover:opacity-100 hover:text-danger"
        aria-label="Remove"
        onClick={onDelete}
      >
        <Trash2 size={11} />
      </button>
    </div>
  );
}
