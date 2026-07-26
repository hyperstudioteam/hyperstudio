import { MouseEvent, useEffect, useState } from "react";
import {
  CirclePlus,
  FolderPlus,
  Pencil,
  Plug,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { ConnectionTree } from "./ConnectionTree";
import { SchemaBrowser } from "./SchemaBrowser";
import { ContextMenu } from "./ContextMenu";
import {
  ConnectionProfile,
  DropPosition,
  Selection,
  TreeNode,
} from "../types/connection";

interface ConnectionSidebarProps {
  tree: TreeNode[];
  selection: Selection;
  expanded: Set<string>;
  connectedId: string | null;
  selected: ConnectionProfile | null;
  busy: "connect" | "query" | "schema" | null;
  busyDetail: Parameters<typeof SchemaBrowser>[0]["busyDetail"];
  schemas: Parameters<typeof SchemaBrowser>[0]["schemas"];
  objectSubgroups: Parameters<typeof SchemaBrowser>[0]["objectSubgroups"];
  schemaExpanded: Set<string>;
  hasSchemaCache: boolean;
  onSelect: (selection: Selection) => void;
  onToggleFolder: (key: string) => void;
  onToggleSchema: (key: string) => void;
  onConnect: (profile: ConnectionProfile) => void;
  onRefreshDatabase: (profile: ConnectionProfile) => void;
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
  onViewTable: (schema: string, table: string) => void;
  onEditTable: (schema: string, table: string) => void;
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
  "text-danger hover:bg-[rgba(239,107,115,0.1)]";

export function ConnectionSidebar(props: ConnectionSidebarProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    target: Selection;
  } | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  function openContextMenu(event: MouseEvent, target: Selection) {
    event.preventDefault();
    event.stopPropagation();
    if (!target) return;
    setContextMenu({ x: event.clientX, y: event.clientY, target });
    props.onSelect(target);
  }

  return (
    <aside className="min-w-0 flex flex-col bg-panel border-r border-border overflow-hidden">
      <div className="h-11 px-[11px] pl-3.5 flex items-center justify-between text-[#aab1be] text-[10px] font-bold tracking-[0.08em] uppercase">
        <span>Connections</span>
        <div className="flex gap-0.5">
          <button
            className={iconButtonClass}
            aria-label="New folder"
            title="New folder"
            onClick={() =>
              props.onNewFolder(
                props.selection?.kind === "folder"
                  ? props.selection.id
                  : null,
              )
            }
          >
            <FolderPlus size={16} />
          </button>
          <button
            className={iconButtonClass}
            aria-label="New connection"
            title="New connection"
            onClick={() =>
              props.onNewConnection(
                props.selection?.kind === "folder"
                  ? props.selection.id
                  : null,
              )
            }
          >
            <CirclePlus size={16} />
          </button>
        </div>
      </div>

      {props.tree.length === 0 ? (
        <div className="px-[7px] pb-[5px] max-h-[42%] overflow-auto scrollbar-thin-app">
          <button
            className="w-full py-[18px] px-2 border border-dashed border-border-bright text-muted rounded-[7px] bg-transparent flex flex-col items-center gap-[7px] cursor-pointer text-[11px] hover:text-text hover:border-accent hover:bg-accent-soft"
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
          connectedId={props.connectedId}
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

      {props.selected && (
        <SchemaBrowser
          profile={props.selected}
          live={props.connectedId === props.selected.id}
          hasCache={props.hasSchemaCache}
          busy={props.busy}
          busyDetail={props.busyDetail}
          schemas={props.schemas}
          objectSubgroups={props.objectSubgroups}
          expanded={props.schemaExpanded}
          onConnect={() => props.onConnect(props.selected!)}
          onRefreshDatabase={() => props.onRefreshDatabase(props.selected!)}
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
          onImportCsv={props.onImportCsv}
          readonly={props.schemaReadonly}
        />
      )}

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
              {props.connectedId === contextMenu.target.id && (
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
        </ContextMenu>
      )}
    </aside>
  );
}
