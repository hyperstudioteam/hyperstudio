import { MouseEvent, useEffect, useRef, useState } from "react";
import { Group, Panel, useDefaultLayout } from "react-resizable-panels";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CirclePlus,
  Download,
  Ellipsis,
  FolderPlus,
  Pencil,
  Plug,
  Puzzle,
  RefreshCw,
  Settings2,
  Trash2,
  Upload,
} from "lucide-react";
import { ConnectionTree } from "./ConnectionTree";
import { SchemaBrowser } from "./SchemaBrowser";
import { ContextMenu, ContextMenuSeparator } from "./ContextMenu";
import { PanelResizeHandle } from "./PanelResizeHandle";
import {
  ConnectionProfile,
  DropPosition,
  Selection,
  TreeNode,
} from "../types/connection";
import { useExtensionMenu } from "../extensions/hooks";
import { extensionRegistry } from "../extensions/registry";
import { cn } from "../lib/cn";

interface ConnectionSidebarProps {
  tree: TreeNode[];
  selection: Selection;
  expanded: Set<string>;
  connectedId: string | null;
  /** Connection ids with an open pool (may be more than one). */
  liveConnectionIds: ReadonlySet<string>;
  selected: ConnectionProfile | null;
  busy: "connect" | "query" | "schema" | null;
  busyDetail: Parameters<typeof SchemaBrowser>[0]["busyDetail"];
  schemas: Parameters<typeof SchemaBrowser>[0]["schemas"];
  schemasByDatabase: Parameters<typeof SchemaBrowser>[0]["schemasByDatabase"];
  objectSubgroups: Parameters<typeof SchemaBrowser>[0]["objectSubgroups"];
  availableDatabases: Parameters<typeof SchemaBrowser>[0]["availableDatabases"];
  schemaExpanded: Set<string>;
  hasSchemaCache: boolean;
  syncBusy?: boolean;
  onSelect: (selection: Selection) => void;
  onToggleFolder: (key: string) => void;
  onToggleSchema: (key: string) => void;
  onConnect: (profile: ConnectionProfile) => void;
  onRefreshDatabase: (profile: ConnectionProfile) => void;
  onSwitchDatabase: (profile: ConnectionProfile, database: string) => void;
  onRefreshSchema: (profile: ConnectionProfile, schema: string) => void;
  onRefreshGroup: (
    profile: ConnectionProfile,
    schema: string,
    group: string,
  ) => void;
  onMove: (dragId: string, targetId: string, position: DropPosition) => void;
  onNewConnection: (folderId: string | null) => void;
  onEditConnection: (profile: ConnectionProfile) => void;
  onNewFolder: (parentId: string | null) => void;
  onEditFolder: (id: string, name: string, parentId: string | null) => void;
  onDelete: (id: string) => void;
  onExportConnections: () => void;
  onImportConnections: () => void;
  onGithubPull: () => void;
  onGithubPush: () => void;
  onGithubSyncSettings: () => void;
  onViewTable: (schema: string, table: string) => void;
  onEditTable: (schema: string, table: string) => void;
  onShowEr: (schema: string) => void;
  onNewConsole: () => void;
  onImportCsv: Parameters<typeof SchemaBrowser>[0]["onImportCsv"];
  schemaReadonly?: boolean;
  findConnection: (id: string) => ConnectionProfile | null;
  findFolder: (
    id: string,
  ) => Extract<TreeNode, { kind: "folder" }> | null;
  parentOf: (id: string) => string | null;
}

const iconButtonClass =
  "size-7 grid place-items-center p-0 border-0 rounded-[5px] text-muted bg-transparent cursor-pointer hover:enabled:text-text hover:enabled:bg-panel-soft disabled:cursor-default disabled:opacity-40";

const contextDangerClass =
  "text-danger hover:bg-red/10";

export function ConnectionSidebar(props: ConnectionSidebarProps) {
  const extensionMenu = useExtensionMenu("connection/context");
  const sidebarLayout = useDefaultLayout({
    id: "connection-sidebar",
    storage: localStorage,
    panelIds: props.selected
      ? ["connection-tree", "schema-browser"]
      : ["connection-tree"],
  });
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    target: Selection;
  } | null>(null);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  useEffect(() => {
    if (!actionsMenuOpen) return;
    const close = (event: Event) => {
      if (
        actionsMenuRef.current &&
        event.target instanceof Node &&
        actionsMenuRef.current.contains(event.target)
      ) {
        return;
      }
      setActionsMenuOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [actionsMenuOpen]);

  function openContextMenu(event: MouseEvent, target: Selection) {
    event.preventDefault();
    event.stopPropagation();
    if (!target) return;
    setContextMenu({ x: event.clientX, y: event.clientY, target });
    props.onSelect(target);
  }

  const menuItemClass =
    "flex h-[30px] w-full cursor-pointer items-center gap-2 rounded-[5px] border-0 bg-transparent px-[9px] text-left text-[11px] text-text hover:bg-panel-soft hover:text-white disabled:cursor-default disabled:opacity-40";

  const selectedFolderId =
    props.selection?.kind === "folder" ? props.selection.id : null;

  return (
    <aside className="flex h-full min-w-0 flex-col overflow-hidden bg-panel">
      <div className="flex h-11 shrink-0 items-center justify-between px-[11px] pl-3.5 text-[10px] font-bold tracking-[0.08em] text-muted uppercase">
        <span>Connections</span>
        <div className="flex gap-0.5">
          <div className="relative" ref={actionsMenuRef}>
            <button
              className={cn(
                iconButtonClass,
                actionsMenuOpen && "text-text bg-panel-soft",
              )}
              aria-label="Connection actions"
              title="Connection actions"
              aria-expanded={actionsMenuOpen}
              onClick={() => setActionsMenuOpen((open) => !open)}
            >
              <Ellipsis size={15} />
            </button>
            {actionsMenuOpen && (
              <div
                className={cn(
                  "absolute right-0 top-[calc(100%+4px)] z-30 min-w-[180px]",
                  "rounded-lg border border-border-bright bg-surface p-1",
                  "shadow-[0_12px_40px_rgba(0,0,0,0.45)]",
                )}
              >
                <button
                  type="button"
                  className={menuItemClass}
                  onClick={() => {
                    setActionsMenuOpen(false);
                    props.onNewFolder(selectedFolderId);
                  }}
                >
                  <FolderPlus size={14} />
                  New folder
                </button>
                <div className="my-1 h-px bg-border" />
                <button
                  type="button"
                  className={menuItemClass}
                  onClick={() => {
                    setActionsMenuOpen(false);
                    props.onImportConnections();
                  }}
                >
                  <Upload size={14} />
                  Import…
                </button>
                <button
                  type="button"
                  className={menuItemClass}
                  disabled={props.tree.length === 0}
                  onClick={() => {
                    setActionsMenuOpen(false);
                    props.onExportConnections();
                  }}
                >
                  <Download size={14} />
                  Export…
                </button>
                <div className="my-1 h-px bg-border" />
                <button
                  type="button"
                  className={menuItemClass}
                  disabled={props.syncBusy}
                  onClick={() => {
                    setActionsMenuOpen(false);
                    props.onGithubPull();
                  }}
                >
                  <ArrowDownToLine size={14} />
                  Pull from GitHub
                </button>
                <button
                  type="button"
                  className={menuItemClass}
                  disabled={props.syncBusy || props.tree.length === 0}
                  onClick={() => {
                    setActionsMenuOpen(false);
                    props.onGithubPush();
                  }}
                >
                  <ArrowUpFromLine size={14} />
                  Push to GitHub
                </button>
                <button
                  type="button"
                  className={menuItemClass}
                  onClick={() => {
                    setActionsMenuOpen(false);
                    props.onGithubSyncSettings();
                  }}
                >
                  <Settings2 size={14} />
                  Sync settings…
                </button>
              </div>
            )}
          </div>
          <button
            className={iconButtonClass}
            aria-label="New connection"
            title="New connection"
            onClick={() => props.onNewConnection(selectedFolderId)}
          >
            <CirclePlus size={16} />
          </button>
        </div>
      </div>

      <Group
        id="connection-sidebar"
        orientation="vertical"
        className="min-h-0 flex-1"
        defaultLayout={sidebarLayout.defaultLayout}
        onLayoutChanged={sidebarLayout.onLayoutChanged}
      >
        <Panel id="connection-tree" defaultSize="42%" minSize={100}>
          {props.tree.length === 0 ? (
            <div className="h-full min-h-0 overflow-auto px-[7px] pb-[5px] scrollbar-thin-app">
              <button
                className="flex w-full cursor-pointer flex-col items-center gap-[7px] rounded-[7px] border border-dashed border-border-bright bg-transparent px-2 py-[18px] text-[11px] text-muted hover:border-accent hover:bg-accent-soft hover:text-text"
                onClick={() => props.onNewConnection(null)}
              >
                <CirclePlus size={18} />
                <span>Add your first database</span>
              </button>
            </div>
          ) : (
            <ConnectionTree
              nodes={props.tree}
              selection={props.selection}
              expanded={props.expanded}
              liveConnectionIds={props.liveConnectionIds}
              onSelect={props.onSelect}
              onToggle={props.onToggleFolder}
              onConnect={(id) => {
                const profile = props.findConnection(id);
                if (profile) props.onConnect(profile);
              }}
              onContextMenu={openContextMenu}
              onMove={props.onMove}
            />
          )}
        </Panel>
        {props.selected && (
          <>
            <PanelResizeHandle />
            <Panel id="schema-browser" minSize={140}>
              <div className="flex h-full min-h-0 flex-col overflow-hidden">
                <SchemaBrowser
                  profile={props.selected}
                  live={props.liveConnectionIds.has(props.selected.id)}
                  hasCache={props.hasSchemaCache}
                  busy={props.busy}
                  busyDetail={props.busyDetail}
                  schemas={props.schemas}
                  schemasByDatabase={props.schemasByDatabase}
                  objectSubgroups={props.objectSubgroups}
                  availableDatabases={props.availableDatabases}
                  expanded={props.schemaExpanded}
                  onConnect={() => props.onConnect(props.selected!)}
                  onRefreshDatabase={() =>
                    props.onRefreshDatabase(props.selected!)
                  }
                  onSwitchDatabase={(database) =>
                    props.onSwitchDatabase(props.selected!, database)
                  }
                  onRefreshSchema={(schema) =>
                    props.onRefreshSchema(props.selected!, schema)
                  }
                  onRefreshGroup={(schema, group) =>
                    props.onRefreshGroup(props.selected!, schema, group)
                  }
                  onEdit={() => props.onEditConnection(props.selected!)}
                  onToggle={props.onToggleSchema}
                  onViewTable={props.onViewTable}
                  onEditTable={props.onEditTable}
                  onShowEr={props.onShowEr}
                  onNewConsole={props.onNewConsole}
                  onImportCsv={props.onImportCsv}
                  readonly={props.schemaReadonly}
                />
              </div>
            </Panel>
          </>
        )}
      </Group>
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y}>
          {contextMenu.target?.kind === "folder" && (
            <>
              <button
                type="button"
                onClick={() => {
                  props.onNewConnection(contextMenu.target!.id);
                  setContextMenu(null);
                }}
              >
                <CirclePlus size={14} /> New connection
              </button>
              <button
                type="button"
                onClick={() => {
                  props.onNewFolder(contextMenu.target!.id);
                  setContextMenu(null);
                }}
              >
                <FolderPlus size={14} /> New nested folder
              </button>
              <button
                type="button"
                onClick={() => {
                  const folder = props.findFolder(contextMenu.target!.id);
                  if (folder) {
                    props.onEditFolder(
                      folder.id,
                      folder.name,
                      props.parentOf(folder.id),
                    );
                  }
                  setContextMenu(null);
                }}
              >
                <Pencil size={14} /> Rename
              </button>
              <button
                type="button"
                className={contextDangerClass}
                onClick={() => {
                  props.onDelete(contextMenu.target!.id);
                  setContextMenu(null);
                }}
              >
                <Trash2 size={14} /> Delete folder
              </button>
            </>
          )}
          {contextMenu.target?.kind === "connection" && (
            <>
              <button
                type="button"
                onClick={() => {
                  const profile = props.findConnection(
                    contextMenu.target!.id,
                  );
                  if (profile) props.onConnect(profile);
                  setContextMenu(null);
                }}
              >
                <Plug size={14} /> Connect
              </button>
              {props.liveConnectionIds.has(contextMenu.target.id) && (
                <button
                  type="button"
                  onClick={() => {
                    const profile = props.findConnection(
                      contextMenu.target!.id,
                    );
                    if (profile) props.onRefreshDatabase(profile);
                    setContextMenu(null);
                  }}
                >
                  <RefreshCw size={14} /> Refresh schemas
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  const profile = props.findConnection(
                    contextMenu.target!.id,
                  );
                  if (profile) props.onEditConnection(profile);
                  setContextMenu(null);
                }}
              >
                <Pencil size={14} /> Edit
              </button>
              <button
                type="button"
                className={contextDangerClass}
                onClick={() => {
                  props.onDelete(contextMenu.target!.id);
                  setContextMenu(null);
                }}
              >
                <Trash2 size={14} /> Delete
              </button>
            </>
          )}
          {extensionMenu.length > 0 && <ContextMenuSeparator />}
          {extensionMenu.map((item) => (
            <button
              type="button"
              key={`${item.source}:${item.command}`}
              onClick={() => {
                extensionRegistry.executeCommand(item.command, {
                  connectionId:
                    contextMenu.target?.kind === "connection"
                      ? contextMenu.target.id
                      : null,
                });
                setContextMenu(null);
              }}
            >
              <Puzzle size={14} /> {item.title}
            </button>
          ))}
        </ContextMenu>
      )}
    </aside>
  );
}
