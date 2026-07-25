import { DragEvent, MouseEvent, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Database,
  Folder,
} from "lucide-react";
import {
  DragPayload,
  DropPosition,
  Selection,
  TreeNode,
} from "../types/connection";

interface ConnectionTreeProps {
  nodes: TreeNode[];
  selection: Selection;
  expanded: Set<string>;
  connectedId: string | null;
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
      event.dataTransfer.getData("application/x-hypergrid-node");
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

export function ConnectionTree({
  nodes,
  selection,
  expanded,
  connectedId,
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
    event.dataTransfer.setData("application/x-hypergrid-node", serialized);
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
          <div key={node.id} className="tree-branch">
            <div
              draggable
              role="button"
              tabIndex={0}
              className={`connection folder-row ${selected ? "selected" : ""} ${isDrop ? `drop-${isDrop}` : ""}`}
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
              <span className="folder-icon">
                <Folder size={15} />
              </span>
              <span className="connection-copy">
                <strong>{node.name}</strong>
                <small>{node.children.length} items</small>
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
          className={`connection ${selected ? "selected" : ""} ${isDrop ? `drop-${isDrop}` : ""}`}
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
          <span className={`db-icon ${profile.driver}`}>
            <Database size={15} />
          </span>
          <span className="connection-copy">
            <strong>{profile.name || profile.database || "Untitled"}</strong>
            <small>
              {profile.host}:{profile.port}
              {!profile.allSchemas && profile.schemas.length
                ? ` · ${profile.schemas.length} schema${profile.schemas.length > 1 ? "s" : ""}`
                : ""}
            </small>
          </span>
          <span
            className={`status-dot ${connectedId === profile.id ? "online" : ""}`}
          />
        </div>
      );
    });
  }

  return (
    <div
      className="connections"
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
        if ((event.target as HTMLElement).closest(".connection")) return;
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
