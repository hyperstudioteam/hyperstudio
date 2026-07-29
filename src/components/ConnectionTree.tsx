import { DragEvent, MouseEvent, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  Lock,
  ShieldAlert,
} from "lucide-react";
import { cn } from "../lib/cn";
import { colorDot, safetyOf } from "../lib/connectionGuard";
import {
  DragPayload,
  DropPosition,
  Selection,
  TreeNode,
} from "../types/connection";
import { DriverIcon, driverIconShellClass } from "./DriverIcon";

interface ConnectionTreeProps {
  nodes: TreeNode[];
  selection: Selection;
  expanded: Set<string>;
  liveConnectionIds: ReadonlySet<string>;
  onSelect: (selection: Selection) => void;
  onToggle: (key: string) => void;
  onConnect: (id: string) => void;
  onContextMenu: (event: MouseEvent, selection: Selection) => void;
  onMove: (dragId: string, targetId: string, position: DropPosition) => void;
}

/** WebKit/Tauri often blocks custom MIME getData(); keep payload in memory. */
let activeDrag: DragPayload | null = null;

function readDrag(event: DragEvent): DragPayload | null {
  if (activeDrag) return activeDrag;
  try {
    const raw =
      event.dataTransfer.getData("text/plain") ||
      event.dataTransfer.getData("application/x-hyperstudio-node");
    if (!raw) return null;
    return JSON.parse(raw) as DragPayload;
  } catch {
    return null;
  }
}

function dropPositionFor(
  event: DragEvent,
  kind: "folder" | "connection",
): DropPosition {
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const offset = event.clientY - bounds.top;
  const ratio = offset / Math.max(bounds.height, 1);
  if (kind === "folder") {
    // Thin edges reorder; most of the row nests into the folder.
    if (ratio < 0.18) return "before";
    if (ratio > 0.82) return "after";
    return "into";
  }
  return ratio < 0.5 ? "before" : "after";
}

function connectionRowClass({
  selected,
  drop,
  folder,
}: {
  selected: boolean;
  drop: DropPosition | null;
  folder?: boolean;
}) {
  return cn(
    "w-full border-0 rounded-md py-1 px-[7px] flex items-center gap-2 bg-transparent text-left cursor-default select-none hover:bg-white/[0.025]",
    folder ? "min-h-9" : "min-h-[42px]",
    selected && "bg-panel-soft",
    drop === "before" && "shadow-[inset_0_2px_0] shadow-blue",
    drop === "after" && "shadow-[inset_0_-2px_0] shadow-blue",
    drop === "into" &&
      "outline outline-1 outline-blue/85 bg-blue/15",
    "[&[draggable=true]]:cursor-grab [&[draggable=true]:active]:cursor-grabbing",
  );
}

export function ConnectionTree({
  nodes,
  selection,
  expanded,
  liveConnectionIds,
  onSelect,
  onToggle,
  onConnect,
  onContextMenu,
  onMove,
}: ConnectionTreeProps) {
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    position: DropPosition;
  } | null>(null);

  function beginDrag(event: DragEvent, payload: DragPayload) {
    activeDrag = payload;
    event.dataTransfer.effectAllowed = "move";
    const serialized = JSON.stringify(payload);
    // text/plain is reliable across WebKit; custom type as secondary.
    event.dataTransfer.setData("text/plain", serialized);
    event.dataTransfer.setData("application/x-hyperstudio-node", serialized);
  }

  function endDrag() {
    activeDrag = null;
    setDropTarget(null);
  }

  function renderNodes(list: TreeNode[], depth = 0) {
    return list.map((node) => {
      if (node.kind === "folder") {
        const key = `folder:${node.id}`;
        const open = expanded.has(key);
        const selected =
          selection?.kind === "folder" && selection.id === node.id;
        const isDrop =
          dropTarget?.id === node.id ? dropTarget.position : null;
        return (
          <div key={node.id} className="flex flex-col">
            <div
              draggable
              role="button"
              tabIndex={0}
              data-connection-row
              className={connectionRowClass({
                selected,
                drop: isDrop,
                folder: true,
              })}
              style={{ paddingLeft: 7 + depth * 12 }}
              onClick={() => {
                onSelect({ kind: "folder", id: node.id });
                onToggle(key);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect({ kind: "folder", id: node.id });
                  onToggle(key);
                }
              }}
              onContextMenu={(event) =>
                onContextMenu(event, { kind: "folder", id: node.id })
              }
              onDragStart={(event) =>
                beginDrag(event, { id: node.id, kind: "folder" })
              }
              onDragEnd={endDrag}
              onDragOver={(event) => {
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = "move";
                setDropTarget({
                  id: node.id,
                  position: dropPositionFor(event, "folder"),
                });
              }}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node)) {
                  return;
                }
                setDropTarget((current) =>
                  current?.id === node.id ? null : current,
                );
              }}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const payload = readDrag(event);
                const position = dropPositionFor(event, "folder");
                endDrag();
                if (!payload || payload.id === node.id) return;
                onMove(payload.id, node.id, position);
              }}
            >
              {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <span className="size-[27px] shrink-0 rounded-md grid place-items-center text-folder bg-folder/15">
                <Folder size={15} />
              </span>
              <span className="flex flex-1 min-w-0 flex-col gap-0.5">
                <strong className="text-text text-xs font-[560] truncate">
                  {node.name}
                </strong>
                <small className="text-subtle text-[10px] font-mono truncate">
                  {node.children.length} items
                </small>
              </span>
            </div>
            {open && renderNodes(node.children, depth + 1)}
          </div>
        );
      }

      const profile = node.profile;
      const selected =
        selection?.kind === "connection" && selection.id === profile.id;
      const isDrop =
        dropTarget?.id === profile.id ? dropTarget.position : null;

      return (
        <div
          key={profile.id}
          draggable
          role="button"
          tabIndex={0}
          data-connection-row
          className={connectionRowClass({ selected, drop: isDrop })}
          style={{ paddingLeft: 7 + depth * 12 }}
          onClick={() => onSelect({ kind: "connection", id: profile.id })}
          onDoubleClick={() => onConnect(profile.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelect({ kind: "connection", id: profile.id });
            }
          }}
          onContextMenu={(event) =>
            onContextMenu(event, {
              kind: "connection",
              id: profile.id,
            })
          }
          onDragStart={(event) =>
            beginDrag(event, { id: profile.id, kind: "connection" })
          }
          onDragEnd={endDrag}
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
            setDropTarget({
              id: profile.id,
              position: dropPositionFor(event, "connection"),
            });
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node)) {
              return;
            }
            setDropTarget((current) =>
              current?.id === profile.id ? null : current,
            );
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const payload = readDrag(event);
            const position = dropPositionFor(event, "connection");
            endDrag();
            if (!payload || payload.id === profile.id) return;
            onMove(payload.id, profile.id, position);
          }}
        >
          <span
            className={cn(
              "size-[27px]",
              driverIconShellClass(profile.driver),
            )}
          >
            <DriverIcon driver={profile.driver} size={15} />
          </span>
          <span className="flex flex-1 min-w-0 flex-col gap-0.5">
            <strong className="flex items-center gap-1.5 text-text text-xs font-[560]">
              {colorDot(profile.color) && (
                <span
                  className="size-[7px] shrink-0 rounded-full"
                  style={{ backgroundColor: colorDot(profile.color)! }}
                  aria-hidden
                />
              )}
              <span className="truncate">
                {profile.name || profile.database || "Untitled"}
              </span>
              {safetyOf(profile) === "readOnly" && (
                <Lock size={10} className="shrink-0 text-subtle" />
              )}
              {safetyOf(profile) === "confirm" && (
                <ShieldAlert size={10} className="shrink-0 text-warn" />
              )}
            </strong>
            <small className="text-subtle text-[10px] font-mono truncate">
              {profile.host}:{profile.port}
              {profile.driver === "postgres" &&
              !profile.allDatabases &&
              profile.databases.length
                ? ` · ${profile.databases.length} database${profile.databases.length > 1 ? "s" : ""}`
                : !profile.allSchemas && profile.schemas.length
                  ? ` · ${profile.schemas.length} schema${profile.schemas.length > 1 ? "s" : ""}`
                  : ""}
            </small>
          </span>
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              liveConnectionIds.has(profile.id)
                ? "bg-green shadow-[0_0_7px_var(--hs-green)]"
                : "bg-subtle",
            )}
          />
        </div>
      );
    });
  }

  return (
    <div
      className="h-full min-h-0 overflow-auto px-[7px] pb-[5px] scrollbar-thin-app"
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        event.preventDefault();
        const payload = readDrag(event);
        endDrag();
        if (!payload || nodes.length === 0) return;
        // Only treat as root append when not dropped onto a child target.
        if ((event.target as HTMLElement).closest("[data-connection-row]")) {
          return;
        }
        const last = nodes[nodes.length - 1];
        const lastId = last.kind === "folder" ? last.id : last.profile.id;
        onMove(payload.id, lastId, "after");
      }}
      onDragEnd={endDrag}
    >
      {renderNodes(nodes)}
    </div>
  );
}
