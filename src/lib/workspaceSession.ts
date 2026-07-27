/** Persist open Query Console / Data Editor / ER tabs across app restarts. */

const STORAGE_KEY = "hyperstudio.workspace-session.v1";

export type QueryTab = {
  id: string;
  kind: "query";
  title: string;
  sql: string;
  /** Connection this console was created on; user may switch later. */
  connectionId: string;
};

export type EditTab = {
  id: string;
  kind: "edit";
  title: string;
  schema: string;
  table: string;
  /** Connection this editor was opened on; does not follow sidebar selection. */
  connectionId: string;
};

export type ErTab = {
  id: string;
  kind: "er";
  title: string;
  schema: string;
  /** Connection the diagram was opened against. */
  connectionId: string;
};

export type WorkspaceTab = QueryTab | EditTab | ErTab;

export interface WorkspaceSession {
  version: 1;
  activeId: string;
  tabs: WorkspaceTab[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isQueryTab(value: unknown): value is QueryTab {
  return (
    isRecord(value) &&
    value.kind === "query" &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.sql === "string" &&
    typeof value.connectionId === "string"
  );
}

function isEditTab(value: unknown): value is EditTab {
  return (
    isRecord(value) &&
    value.kind === "edit" &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.schema === "string" &&
    typeof value.table === "string" &&
    typeof value.connectionId === "string"
  );
}

function isErTab(value: unknown): value is ErTab {
  return (
    isRecord(value) &&
    value.kind === "er" &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.schema === "string" &&
    // connectionId was added later; tolerate missing and coerce to "".
    (typeof value.connectionId === "string" || value.connectionId == null)
  );
}

function normalizeTab(value: unknown): WorkspaceTab | null {
  if (isQueryTab(value)) return value;
  if (isEditTab(value)) return value;
  if (isErTab(value)) {
    return {
      id: value.id,
      kind: "er",
      title: value.title,
      schema: value.schema,
      connectionId:
        typeof value.connectionId === "string" ? value.connectionId : "",
    };
  }
  return null;
}

/** Highest `query-N` id so new tabs do not collide after restore. */
export function maxQueryCounter(tabs: WorkspaceTab[]): number {
  let max = 0;
  for (const tab of tabs) {
    if (tab.kind !== "query") continue;
    const match = /^query-(\d+)$/.exec(tab.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max;
}

export function loadWorkspaceSession(): WorkspaceSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1) return null;
    if (!Array.isArray(parsed.tabs) || typeof parsed.activeId !== "string") {
      return null;
    }
    const tabs = parsed.tabs
      .map(normalizeTab)
      .filter((tab): tab is WorkspaceTab => tab !== null);
    if (tabs.length === 0) return null;
    const activeId = tabs.some((tab) => tab.id === parsed.activeId)
      ? parsed.activeId
      : tabs[0].id;
    return { version: 1, activeId, tabs };
  } catch {
    return null;
  }
}

export function saveWorkspaceSession(session: WorkspaceSession): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        activeId: session.activeId,
        tabs: session.tabs,
      } satisfies WorkspaceSession),
    );
  } catch {
    // Storage full or unavailable; session is best-effort.
  }
}

/** Drop edit/er tabs whose connection no longer exists; keep query tabs. */
export function pruneWorkspaceTabs(
  tabs: WorkspaceTab[],
  connectionIds: ReadonlySet<string>,
): WorkspaceTab[] {
  return tabs.filter((tab) => {
    if (tab.kind === "query") return true;
    if (!tab.connectionId) return false;
    return connectionIds.has(tab.connectionId);
  });
}
