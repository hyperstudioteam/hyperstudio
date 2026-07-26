const HISTORY_KEY = "hyperstudio.query-history.v1";
const SAVED_KEY = "hyperstudio.saved-queries.v1";

/** Keeps localStorage bounded; oldest entries are dropped first. */
const HISTORY_LIMIT = 200;

export interface HistoryEntry {
  id: string;
  sql: string;
  connectionId: string;
  /** Epoch milliseconds of the most recent run. */
  ranAt: number;
  /** How many times this exact statement has been run. */
  runCount: number;
  succeeded: boolean;
  elapsedMs?: number;
  rowCount?: number;
}

export interface SavedQuery {
  id: string;
  name: string;
  sql: string;
  connectionId: string | null;
  savedAt: number;
}

function read<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function write<T>(key: string, items: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // Storage full or unavailable; history is best-effort.
  }
}

export function loadHistory(): HistoryEntry[] {
  return read<HistoryEntry>(HISTORY_KEY);
}

export function loadSavedQueries(): SavedQuery[] {
  return read<SavedQuery>(SAVED_KEY);
}

/**
 * Record a run, collapsing repeats of the same statement on the same
 * connection into a single entry with a bumped count and timestamp.
 */
export function recordHistory(entry: {
  sql: string;
  connectionId: string;
  succeeded: boolean;
  elapsedMs?: number;
  rowCount?: number;
}): HistoryEntry[] {
  const sql = entry.sql.trim();
  if (!sql) return loadHistory();

  const current = loadHistory();
  const existing = current.find(
    (item) => item.sql === sql && item.connectionId === entry.connectionId,
  );

  const updated: HistoryEntry = {
    id: existing?.id ?? crypto.randomUUID(),
    sql,
    connectionId: entry.connectionId,
    ranAt: Date.now(),
    runCount: (existing?.runCount ?? 0) + 1,
    succeeded: entry.succeeded,
    elapsedMs: entry.elapsedMs,
    rowCount: entry.rowCount,
  };

  const next = [
    updated,
    ...current.filter((item) => item.id !== updated.id),
  ].slice(0, HISTORY_LIMIT);
  write(HISTORY_KEY, next);
  return next;
}

export function clearHistory(): HistoryEntry[] {
  write<HistoryEntry>(HISTORY_KEY, []);
  return [];
}

export function removeHistoryEntry(id: string): HistoryEntry[] {
  const next = loadHistory().filter((item) => item.id !== id);
  write(HISTORY_KEY, next);
  return next;
}

export function saveQuery(input: {
  name: string;
  sql: string;
  connectionId: string | null;
}): SavedQuery[] {
  const name = input.name.trim();
  const sql = input.sql.trim();
  if (!name || !sql) return loadSavedQueries();

  const current = loadSavedQueries();
  const existing = current.find((item) => item.name === name);
  const entry: SavedQuery = {
    id: existing?.id ?? crypto.randomUUID(),
    name,
    sql,
    connectionId: input.connectionId,
    savedAt: Date.now(),
  };

  const next = [entry, ...current.filter((item) => item.id !== entry.id)];
  write(SAVED_KEY, next);
  return next;
}

export function removeSavedQuery(id: string): SavedQuery[] {
  const next = loadSavedQueries().filter((item) => item.id !== id);
  write(SAVED_KEY, next);
  return next;
}

/** Collapse whitespace so long statements fit on one line in a list. */
export function previewSql(sql: string, max = 120): string {
  const flat = sql.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}
