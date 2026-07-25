import { ComponentType, MouseEvent, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Columns3,
  Eye,
  FunctionSquare,
  Hash,
  KeyRound,
  Layers,
  LoaderCircle,
  MoreHorizontal,
  Plug,
  RefreshCw,
  Server,
  Table2,
  Zap,
} from "lucide-react";
import { objectGroupsFor } from "../lib/driverGroups";
import { treeKeys } from "../hooks/useDatabaseSession";
import { ConnectionProfile } from "../types/connection";
import {
  ObjectGroupDef,
  ObjectNode,
  SchemaNode,
  TABLES_GROUP,
} from "../types/schema";
import { ContextMenu } from "./ContextMenu";

type BusyDetail =
  | { kind: "connect" }
  | { kind: "query" }
  | { kind: "schemas" }
  | { kind: "objects"; schema: string; group: string }
  | null;

type BrowserMenu =
  | { kind: "database"; x: number; y: number }
  | { kind: "schema"; name: string; x: number; y: number }
  | { kind: "group"; schema: string; group: ObjectGroupDef; x: number; y: number }
  | {
      kind: "object";
      schema: string;
      group: ObjectGroupDef;
      object: ObjectNode;
      x: number;
      y: number;
    };

interface SchemaBrowserProps {
  profile: ConnectionProfile;
  live: boolean;
  hasCache: boolean;
  busy: "connect" | "query" | "schema" | null;
  busyDetail: BusyDetail;
  schemas: SchemaNode[];
  expanded: Set<string>;
  onConnect: () => void;
  onRefreshDatabase: () => void;
  onRefreshSchema: (schema: string) => void;
  onRefreshGroup: (schema: string, group: string) => void;
  onEdit: () => void;
  onToggle: (key: string) => void;
  onViewTable: (schema: string, table: string) => void;
  onEditTable: (schema: string, table: string) => void;
}

const ICON_MAP: Record<string, ComponentType<{ size?: number }>> = {
  table: Table2,
  eye: Eye,
  function: FunctionSquare,
  zap: Zap,
  hash: Hash,
  clock: Clock,
  layers: Layers,
  key: KeyRound,
};

function GroupIcon({ name, size = 14 }: { name?: string | null; size?: number }) {
  const Icon = (name && ICON_MAP[name]) || Layers;
  return <Icon size={size} />;
}

function objectActions(group: ObjectGroupDef, object: ObjectNode): string[] {
  return object.actions ?? group.actions ?? [];
}

export function SchemaBrowser({
  profile,
  live,
  hasCache,
  busy,
  busyDetail,
  schemas,
  expanded,
  onConnect,
  onRefreshDatabase,
  onRefreshSchema,
  onRefreshGroup,
  onEdit,
  onToggle,
  onViewTable,
  onEditTable,
}: SchemaBrowserProps) {
  const [menu, setMenu] = useState<BrowserMenu | null>(null);
  const groups = objectGroupsFor(profile.driver);
  const refreshingSchemas = busyDetail?.kind === "schemas";
  const refreshingObjects =
    busyDetail?.kind === "objects" ? busyDetail : null;
  const showConnect = !hasCache && !live;
  const canInteract = hasCache || live;
  const databaseLabel = profile.database || profile.host || profile.name;

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  function openMenu(event: MouseEvent, next: BrowserMenu) {
    event.preventDefault();
    event.stopPropagation();
    setMenu(next);
  }

  return (
    <>
      <div className="sidebar-divider" />
      <div className="database-header">
        <div>
          <small>Database</small>
          <strong>{databaseLabel}</strong>
          {!profile.allSchemas && profile.schemas.length > 0 && (
            <em className="schema-filter-hint">
              Schemas: {profile.schemas.join(", ")}
            </em>
          )}
          {profile.allSchemas && (
            <em className="schema-filter-hint">All schemas</em>
          )}
          {hasCache && !live && (
            <em className="schema-filter-hint">Cached · connects on use</em>
          )}
        </div>
        <div className="inline-actions">
          <button
            className="icon-button"
            aria-label="Refresh schemas"
            title="Refresh schemas"
            disabled={!canInteract || busy === "schema"}
            onClick={onRefreshDatabase}
          >
            <RefreshCw
              size={14}
              className={refreshingSchemas ? "spin" : ""}
            />
          </button>
          <button
            className="icon-button"
            aria-label="Connection settings"
            onClick={onEdit}
          >
            <MoreHorizontal size={15} />
          </button>
        </div>
      </div>

      <div
        className="tree"
        onContextMenu={(event) => {
          if (!canInteract) return;
          openMenu(event, {
            kind: "database",
            x: event.clientX,
            y: event.clientY,
          });
        }}
      >
        {showConnect ? (
          <button className="connect-prompt" onClick={onConnect}>
            {busy === "connect" ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <Plug size={15} />
            )}
            Connect
          </button>
        ) : schemas.length === 0 ? (
          <div className="tree-empty">
            {refreshingSchemas ? "Loading schemas…" : "No schemas found"}
          </div>
        ) : (
          schemas.map((schema) => {
            const schemaKey = treeKeys.schema(schema.name);
            const schemaOpen = expanded.has(schemaKey);
            return (
              <div key={schema.name}>
                <div
                  className={`tree-row db-schema-row ${schemaOpen ? "open" : ""}`}
                >
                  <button
                    type="button"
                    className="tree-row-main"
                    onClick={() => onToggle(schemaKey)}
                    onContextMenu={(event) =>
                      openMenu(event, {
                        kind: "schema",
                        name: schema.name,
                        x: event.clientX,
                        y: event.clientY,
                      })
                    }
                  >
                    {schemaOpen ? (
                      <ChevronDown size={13} />
                    ) : (
                      <ChevronRight size={13} />
                    )}
                    <Server size={14} />
                    <span>{schema.name}</span>
                    {schema.isSystem && (
                      <Zap size={11} className="system-schema" />
                    )}
                  </button>
                  <button
                    type="button"
                    className="icon-button tree-row-action"
                    aria-label={`Refresh ${schema.name}`}
                    title="Refresh schema"
                    disabled={busy === "schema"}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRefreshSchema(schema.name);
                    }}
                  >
                    <RefreshCw
                      size={12}
                      className={
                        refreshingObjects?.schema === schema.name ? "spin" : ""
                      }
                    />
                  </button>
                </div>
                {schemaOpen &&
                  groups.map((group) => (
                    <ObjectGroupBranch
                      key={group.id}
                      schema={schema}
                      group={group}
                      expanded={expanded}
                      busy={busy}
                      refreshing={
                        refreshingObjects?.schema === schema.name &&
                        refreshingObjects.group === group.id
                      }
                      onToggle={onToggle}
                      onRefreshGroup={onRefreshGroup}
                      onOpenMenu={openMenu}
                      onViewTable={onViewTable}
                      onEditTable={onEditTable}
                    />
                  ))}
              </div>
            );
          })
        )}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y}>
          {menu.kind === "database" && (
            <button
              type="button"
              onClick={() => {
                onRefreshDatabase();
                setMenu(null);
              }}
            >
              <RefreshCw size={14} /> Refresh schemas
            </button>
          )}
          {menu.kind === "schema" && (
            <button
              type="button"
              onClick={() => {
                onRefreshSchema(menu.name);
                setMenu(null);
              }}
            >
              <RefreshCw size={14} /> Refresh schema
            </button>
          )}
          {menu.kind === "group" && (
            <button
              type="button"
              onClick={() => {
                onRefreshGroup(menu.schema, menu.group.id);
                setMenu(null);
              }}
            >
              <RefreshCw size={14} /> Refresh {menu.group.label.toLowerCase()}
            </button>
          )}
          {menu.kind === "object" && (
            <>
              {objectActions(menu.group, menu.object).includes("editData") && (
                <button
                  type="button"
                  onClick={() => {
                    onEditTable(menu.schema, menu.object.name);
                    setMenu(null);
                  }}
                >
                  <Zap size={14} /> Edit Data
                </button>
              )}
              {objectActions(menu.group, menu.object).includes("viewData") && (
                <button
                  type="button"
                  onClick={() => {
                    onViewTable(menu.schema, menu.object.name);
                    setMenu(null);
                  }}
                >
                  <Table2 size={14} /> View Data
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  onRefreshGroup(menu.schema, menu.group.id);
                  setMenu(null);
                }}
              >
                <RefreshCw size={14} /> Refresh {menu.group.label.toLowerCase()}
              </button>
            </>
          )}
        </ContextMenu>
      )}
    </>
  );
}

interface ObjectGroupBranchProps {
  schema: SchemaNode;
  group: ObjectGroupDef;
  expanded: Set<string>;
  busy: "connect" | "query" | "schema" | null;
  refreshing: boolean;
  onToggle: (key: string) => void;
  onRefreshGroup: (schema: string, group: string) => void;
  onOpenMenu: (event: MouseEvent, next: BrowserMenu) => void;
  onViewTable: (schema: string, table: string) => void;
  onEditTable: (schema: string, table: string) => void;
}

function ObjectGroupBranch({
  schema,
  group,
  expanded,
  busy,
  refreshing,
  onToggle,
  onRefreshGroup,
  onOpenMenu,
  onViewTable,
  onEditTable,
}: ObjectGroupBranchProps) {
  const groupKey = treeKeys.group(schema.name, group.id);
  const open = expanded.has(groupKey);
  const loaded = Object.prototype.hasOwnProperty.call(schema.objects, group.id);
  const objects = schema.objects[group.id];
  const editable = group.id === TABLES_GROUP || group.actions.includes("editData");

  return (
    <div>
      <div className={`tree-row group-row ${open ? "open" : ""}`}>
        <button
          type="button"
          className="tree-row-main"
          onClick={() => onToggle(groupKey)}
          onContextMenu={(event) =>
            onOpenMenu(event, {
              kind: "group",
              schema: schema.name,
              group,
              x: event.clientX,
              y: event.clientY,
            })
          }
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <GroupIcon name={group.icon} />
          <span>{group.label}</span>
          <em>{refreshing ? "…" : loaded ? objects.length : ""}</em>
        </button>
        <button
          type="button"
          className="icon-button tree-row-action"
          aria-label={`Refresh ${group.label}`}
          title={`Refresh ${group.label.toLowerCase()}`}
          disabled={busy === "schema"}
          onClick={(event) => {
            event.stopPropagation();
            onRefreshGroup(schema.name, group.id);
          }}
        >
          <RefreshCw size={12} className={refreshing ? "spin" : ""} />
        </button>
      </div>

      {open && refreshing && !loaded && (
        <div className="tree-row column-row loading-row">
          <LoaderCircle className="spin" size={12} />
          <span>Loading {group.label.toLowerCase()}…</span>
        </div>
      )}

      {open &&
        objects?.map((object) => {
          const objectKey = treeKeys.object(schema.name, group.id, object.name);
          const objectOpen = expanded.has(objectKey);
          const hasChildren = object.children.length > 0;
          return (
            <div key={objectKey}>
              <button
                className="tree-row table-row"
                onClick={() => {
                  if (hasChildren) onToggle(objectKey);
                  else if (editable) onEditTable(schema.name, object.name);
                }}
                onDoubleClick={() => {
                  if (editable) onEditTable(schema.name, object.name);
                  else if (group.actions.includes("viewData")) {
                    onViewTable(schema.name, object.name);
                  }
                }}
                onContextMenu={(event) =>
                  onOpenMenu(event, {
                    kind: "object",
                    schema: schema.name,
                    group,
                    object,
                    x: event.clientX,
                    y: event.clientY,
                  })
                }
              >
                {hasChildren ? (
                  objectOpen ? (
                    <ChevronDown size={13} />
                  ) : (
                    <ChevronRight size={13} />
                  )
                ) : (
                  <span className="tree-spacer" />
                )}
                <GroupIcon name={group.icon} size={14} />
                <span>{object.name}</span>
                {object.detail && <em>{object.detail}</em>}
              </button>
              {objectOpen &&
                object.children.map((child) => (
                  <div
                    className="tree-row column-row"
                    key={`${objectKey}.${child.name}`}
                  >
                    <Columns3 size={12} />
                    <span>{child.name}</span>
                    <em>{child.dataType}</em>
                  </div>
                ))}
            </div>
          );
        })}
    </div>
  );
}
