import {
  ComponentType,
  MouseEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import { cn } from "../lib/cn";
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
  Link,
  ListTree,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plug,
  RefreshCw,
  Search,
  Server,
  Table2,
  X,
  Zap,
} from "lucide-react";
import { databaseApi } from "../api/database";
import { objectGroupsFor } from "../lib/driverGroups";
import { filterSchemaTree } from "../lib/schemaSearch";
import { treeKeys, type SessionBusy } from "../hooks/useDatabaseSession";
import { ConnectionProfile } from "../types/connection";
import {
  ColumnNode,
  ObjectGroupDef,
  ObjectNode,
  SchemaNode,
  TABLES_GROUP,
} from "../types/schema";
import { ContextMenu } from "./ContextMenu";
import { EditColumnModal } from "./schema-edit/EditColumnModal";
import { EditTableModal } from "./schema-edit/EditTableModal";

type BusyDetail = SessionBusy;

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
    }
  | {
      kind: "column";
      schema: string;
      group: ObjectGroupDef;
      object: ObjectNode;
      column: ColumnNode;
      x: number;
      y: number;
    }
  | {
      kind: "key";
      schema: string;
      group: ObjectGroupDef;
      object: ObjectNode;
      key: ObjectNode;
      x: number;
      y: number;
    }
  | {
      kind: "keysFolder";
      schema: string;
      group: ObjectGroupDef;
      object: ObjectNode;
      x: number;
      y: number;
    }
  | {
      kind: "index";
      schema: string;
      group: ObjectGroupDef;
      object: ObjectNode;
      index: ObjectNode;
      x: number;
      y: number;
    }
  | {
      kind: "indexesFolder";
      schema: string;
      group: ObjectGroupDef;
      object: ObjectNode;
      x: number;
      y: number;
    };

type SchemaEditDialog =
  | {
      kind: "table";
      schema: string;
      table: string;
      columns: ColumnNode[];
      initialSection?: "columns" | "keys" | "indexes";
      initialName?: string;
    }
  | {
      kind: "column";
      schema: string;
      table: string;
      column: ColumnNode;
      supportsDefault: boolean;
    };

interface SchemaBrowserProps {
  profile: ConnectionProfile;
  live: boolean;
  hasCache: boolean;
  readonly?: boolean;
  busy: "connect" | "query" | "schema" | null;
  busyDetail: BusyDetail;
  schemas: SchemaNode[];
  objectSubgroups: Record<string, ObjectNode[]>;
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
  columns: Columns3,
  link: Link,
  list: ListTree,
};

function GroupIcon({ name, size = 14 }: { name?: string | null; size?: number }) {
  const Icon = (name && ICON_MAP[name]) || Layers;
  return <Icon size={size} />;
}

function objectActions(group: ObjectGroupDef, object: ObjectNode): string[] {
  return object.actions ?? group.actions ?? [];
}

const iconButtonClass =
  "size-7 grid place-items-center p-0 border-0 rounded-[5px] text-muted bg-transparent cursor-pointer hover:enabled:text-text hover:enabled:bg-panel-soft disabled:cursor-default disabled:opacity-40";

const treeRowEmClass =
  "ml-auto text-subtle text-[9px] not-italic whitespace-nowrap";

const treeRowBaseClass =
  "w-full h-[26px] border-0 rounded flex items-center gap-[5px] px-1.5 bg-transparent text-[#aeb5c1] text-[11px] text-left cursor-default [&>span]:truncate";

const treeRowMainClass =
  "min-w-0 flex-1 h-[26px] border-0 rounded flex items-center gap-[5px] pr-1 pl-0 bg-transparent text-inherit text-[11px] text-left cursor-default hover:text-text [&>span]:truncate";

const treeRowActionClass =
  "size-[22px] shrink-0 opacity-0 grid place-items-center p-0 border-0 rounded-[5px] text-muted bg-transparent cursor-pointer hover:enabled:text-text hover:enabled:bg-panel-soft disabled:cursor-default disabled:opacity-40";

export function SchemaBrowser({
  profile,
  live,
  hasCache,
  readonly = false,
  busy,
  busyDetail,
  schemas,
  objectSubgroups,
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
  const [editDialog, setEditDialog] = useState<SchemaEditDialog | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const groups = objectGroupsFor(profile.driver);
  const refreshingSchemas = busyDetail?.kind === "schemas";
  const refreshingObjects =
    busyDetail?.kind === "objects" ? busyDetail : null;
  const showConnect = !hasCache && !live;
  const canInteract = hasCache || live;
  const canMutate = live && !readonly;
  const databaseLabel = profile.database || profile.host || profile.name;

  const filtered = useMemo(
    () => filterSchemaTree(schemas, groups, search),
    [schemas, groups, search],
  );

  // While searching, matches drive expansion so hits are visible immediately.
  const visibleSchemas = filtered ? filtered.schemas : schemas;
  const effectiveExpanded = useMemo(() => {
    if (!filtered) return expanded;
    const keys = new Set<string>();
    for (const name of filtered.openSchemas) keys.add(treeKeys.schema(name));
    for (const item of filtered.openGroups) {
      keys.add(treeKeys.group(item.schema, item.group));
    }
    for (const item of filtered.openObjects) {
      keys.add(treeKeys.object(item.schema, item.group, item.object));
    }
    return keys;
  }, [filtered, expanded]);

  // Expansion is derived from the query, so toggling is inert until it clears.
  const handleToggle = filtered ? () => {} : onToggle;

  useEffect(() => setSearch(""), [profile.id]);

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

  function openEdit(dialog: SchemaEditDialog) {
    setEditError(null);
    setEditBusy(false);
    setEditDialog(dialog);
    setMenu(null);
  }

  async function runAlter(
    action: () => Promise<void>,
    schema: string,
    group: string,
  ) {
    setEditBusy(true);
    setEditError(null);
    try {
      await action();
      setEditDialog(null);
      onRefreshGroup(schema, group);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : String(error));
    } finally {
      setEditBusy(false);
    }
  }

  return (
    <>
      <div className="h-px mt-[3px] mx-2.5 bg-border" />
      <div className="min-h-[52px] py-2 pr-[9px] pl-3.5 flex items-start justify-between gap-2">
        <div className="min-w-0 flex flex-col gap-px">
          <small className="text-subtle text-[9px] uppercase tracking-[0.06em]">
            Database
          </small>
          <strong className="text-[#c8ced8] text-[11px] font-[590] overflow-hidden text-ellipsis">
            {databaseLabel}
          </strong>
          {!profile.allSchemas && profile.schemas.length > 0 && (
            <em className="text-subtle text-[9px] not-italic mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap">
              Schemas: {profile.schemas.join(", ")}
            </em>
          )}
          {profile.allSchemas && (
            <em className="text-subtle text-[9px] not-italic mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap">
              All schemas
            </em>
          )}
          {hasCache && !live && (
            <em className="text-subtle text-[9px] not-italic mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap">
              Cached · connects on use
            </em>
          )}
        </div>
        <div className="flex shrink-0">
          <button
            className={iconButtonClass}
            aria-label="Refresh schemas"
            title="Refresh schemas"
            disabled={!canInteract || busy === "schema"}
            onClick={onRefreshDatabase}
          >
            <RefreshCw
              size={14}
              className={refreshingSchemas ? "animate-spin-slow" : ""}
            />
          </button>
          <button
            className={iconButtonClass}
            aria-label="Connection settings"
            onClick={onEdit}
          >
            <MoreHorizontal size={15} />
          </button>
        </div>
      </div>

      {!showConnect && (
        <div className="px-2.5 pb-2">
          <div className="flex h-[26px] items-center gap-1.5 rounded-[5px] border border-border bg-surface-input px-2 focus-within:border-accent">
            <Search size={12} className="shrink-0 text-subtle" />
            <input
              className="min-w-0 flex-1 border-0 bg-transparent text-[11px] text-text outline-none placeholder:text-subtle"
              placeholder="Filter tables and columns"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setSearch("");
              }}
            />
            {search && (
              <button
                type="button"
                className="grid size-4 shrink-0 cursor-pointer place-items-center rounded-[3px] border-0 bg-transparent p-0 text-subtle hover:text-text"
                aria-label="Clear filter"
                onClick={() => setSearch("")}
              >
                <X size={11} />
              </button>
            )}
          </div>
          {filtered && (
            <div className="mt-1 text-[9px] text-subtle">
              {filtered.matches === 0
                ? "No matches in loaded metadata"
                : `${filtered.matches} match${filtered.matches === 1 ? "" : "es"} · expand a group to search more`}
            </div>
          )}
        </div>
      )}

      <div
        className="flex-1 overflow-auto py-px px-1.5 pb-3.5 scrollbar-thin-app"
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
          <button
            className="mx-[7px] my-[7px] py-[7px] px-2.5 w-[calc(100%-14px)] flex justify-center items-center gap-1.5 border border-border-bright rounded-md bg-panel-soft text-[#bac1cc] text-[11px] cursor-pointer hover:border-accent hover:text-white"
            onClick={onConnect}
          >
            {busy === "connect" ? (
              <LoaderCircle className="animate-spin-slow" size={15} />
            ) : (
              <Plug size={15} />
            )}
            Connect
          </button>
        ) : visibleSchemas.length === 0 ? (
          <div className="p-3 text-center text-subtle text-[11px]">
            {filtered
              ? `No matches for “${search.trim()}”`
              : refreshingSchemas
                ? "Loading schemas…"
                : "No schemas found"}
          </div>
        ) : (
          visibleSchemas.map((schema) => {
            const schemaKey = treeKeys.schema(schema.name);
            const schemaOpen = effectiveExpanded.has(schemaKey);
            return (
              <div key={schema.name}>
                <div
                  className={cn(
                    treeRowBaseClass,
                    "pr-0.5 gap-0 group/db-schema",
                    schemaOpen && "open",
                  )}
                >
                  <button
                    type="button"
                    className={treeRowMainClass}
                    onClick={() => handleToggle(schemaKey)}
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
                      <Zap size={11} className="text-[#8ea0b8] shrink-0" />
                    )}
                  </button>
                  <button
                    type="button"
                    className={cn(
                      treeRowActionClass,
                      "group-hover/db-schema:opacity-100 group-[.open]/db-schema:opacity-100",
                    )}
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
                        refreshingObjects?.schema === schema.name
                          ? "animate-spin-slow"
                          : ""
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
                      expanded={effectiveExpanded}
                      objectSubgroups={objectSubgroups}
                      busyDetail={busyDetail}
                      busy={busy}
                      refreshing={
                        refreshingObjects?.schema === schema.name &&
                        refreshingObjects.group === group.id
                      }
                      canMutate={canMutate}
                      onToggle={handleToggle}
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
              {canMutate &&
                objectActions(menu.group, menu.object).includes("editTable") && (
                  <button
                    type="button"
                    onClick={() =>
                      openEdit({
                        kind: "table",
                        schema: menu.schema,
                        table: menu.object.name,
                        columns: menu.object.children ?? [],
                      })
                    }
                  >
                    <Pencil size={14} /> Edit Table…
                  </button>
                )}
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
          {menu.kind === "column" &&
            canMutate &&
            objectActions(menu.group, menu.object).includes("editColumn") && (
              <button
                type="button"
                onClick={() =>
                  openEdit({
                    kind: "column",
                    schema: menu.schema,
                    table: menu.object.name,
                    column: menu.column,
                    supportsDefault: profile.driver !== "typesense",
                  })
                }
              >
                <Pencil size={14} /> Edit Column…
              </button>
            )}
          {menu.kind === "keysFolder" &&
            canMutate &&
            objectActions(menu.group, menu.object).includes("editKey") && (
              <button
                type="button"
                onClick={() =>
                  openEdit({
                    kind: "table",
                    schema: menu.schema,
                    table: menu.object.name,
                    columns: menu.object.children,
                    initialSection: "keys",
                  })
                }
              >
                <Pencil size={14} /> Modify Keys…
              </button>
            )}
          {menu.kind === "key" &&
            canMutate &&
            objectActions(menu.group, menu.object).includes("editKey") && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    openEdit({
                      kind: "table",
                      schema: menu.schema,
                      table: menu.object.name,
                      columns: menu.object.children,
                      initialSection: "keys",
                      initialName: menu.key.name,
                    })
                  }
                >
                  <Pencil size={14} /> Edit Key…
                </button>
              </>
            )}
          {menu.kind === "indexesFolder" && canMutate && (
            <button
              type="button"
              onClick={() =>
                openEdit({
                  kind: "table",
                  schema: menu.schema,
                  table: menu.object.name,
                  columns: menu.object.children,
                  initialSection: "indexes",
                })
              }
            >
              <Pencil size={14} /> Modify Indexes…
            </button>
          )}
          {menu.kind === "index" && canMutate && (
            <button
              type="button"
              onClick={() =>
                openEdit({
                  kind: "table",
                  schema: menu.schema,
                  table: menu.object.name,
                  columns: menu.object.children,
                  initialSection: "indexes",
                  initialName: menu.index.name,
                })
              }
            >
              <Pencil size={14} /> Edit Index…
            </button>
          )}
        </ContextMenu>
      )}

      {editDialog?.kind === "table" && (
        <EditTableModal
          connectionId={profile.id}
          schema={editDialog.schema}
          table={editDialog.table}
          columns={editDialog.columns}
          driver={profile.driver}
          initialSection={editDialog.initialSection}
          initialName={editDialog.initialName}
          busy={editBusy}
          error={editError}
          onClose={() => !editBusy && setEditDialog(null)}
          onSave={(request) =>
            void runAlter(
              () => databaseApi.alterTable(profile.id, request),
              editDialog.schema,
              TABLES_GROUP,
            )
          }
        />
      )}

      {editDialog?.kind === "column" && (
        <EditColumnModal
          schema={editDialog.schema}
          table={editDialog.table}
          column={editDialog.column}
          supportsDefault={editDialog.supportsDefault}
          busy={editBusy}
          error={editError}
          onClose={() => !editBusy && setEditDialog(null)}
          onSave={(input) =>
            void runAlter(
              () =>
                databaseApi.alterColumn(profile.id, {
                  schema: editDialog.schema,
                  table: editDialog.table,
                  column: editDialog.column.name,
                  newName:
                    input.newName !== editDialog.column.name
                      ? input.newName
                      : null,
                  dataType:
                    input.dataType !== editDialog.column.dataType
                      ? input.dataType
                      : null,
                  nullable:
                    input.nullable !== editDialog.column.nullable
                      ? input.nullable
                      : null,
                  defaultValue: input.clearDefault
                    ? null
                    : input.defaultValue || null,
                  clearDefault: input.clearDefault,
                }),
              editDialog.schema,
              TABLES_GROUP,
            )
          }
        />
      )}

    </>
  );
}

interface ObjectGroupBranchProps {
  schema: SchemaNode;
  group: ObjectGroupDef;
  expanded: Set<string>;
  objectSubgroups: Record<string, ObjectNode[]>;
  busyDetail: BusyDetail;
  busy: "connect" | "query" | "schema" | null;
  canMutate: boolean;
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
  objectSubgroups,
  busyDetail,
  busy,
  canMutate,
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
  const actions = group.actions ?? [];

  return (
    <div>
      <div
        className={cn(
          treeRowBaseClass,
          "pl-[18px] pr-0.5 gap-0 group/group-row",
          open && "open",
        )}
      >
        <button
          type="button"
          className={cn(treeRowMainClass, "pl-1 [&>span]:text-[#9aa3b2] [&>span]:font-medium")}
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
          <em className={treeRowEmClass}>
            {refreshing ? "…" : loaded ? objects.length : ""}
          </em>
        </button>
        <button
          type="button"
          className={cn(
            treeRowActionClass,
            "group-hover/group-row:opacity-100 group-[.open]/group-row:opacity-100",
          )}
          aria-label={`Refresh ${group.label}`}
          title={`Refresh ${group.label.toLowerCase()}`}
          disabled={busy === "schema"}
          onClick={(event) => {
            event.stopPropagation();
            onRefreshGroup(schema.name, group.id);
          }}
        >
          <RefreshCw size={12} className={refreshing ? "animate-spin-slow" : ""} />
        </button>
      </div>

      {open && refreshing && !loaded && (
        <div
          className={cn(
            treeRowBaseClass,
            "text-subtle gap-[7px] pl-7",
          )}
        >
          <LoaderCircle className="animate-spin-slow" size={12} />
          <span>Loading {group.label.toLowerCase()}…</span>
        </div>
      )}

      {open &&
        objects?.map((object) => {
          const objectKey = treeKeys.object(schema.name, group.id, object.name);
          const objectOpen = expanded.has(objectKey);
          const subgroupDefs = group.objectSubgroups ?? [];
          const hasChildren =
            subgroupDefs.length > 0 || object.children.length > 0;
          const objectActs = objectActions(group, object);
          return (
            <div key={objectKey}>
              <button
                className={cn(
                  treeRowBaseClass,
                  "pl-9 hover:bg-panel-soft hover:text-text [&>svg:nth-child(2)]:text-[#b2a7f9]",
                )}
                onClick={() => {
                  if (hasChildren) onToggle(objectKey);
                  else if (editable) onEditTable(schema.name, object.name);
                }}
                onDoubleClick={() => {
                  if (editable) onEditTable(schema.name, object.name);
                  else if (actions.includes("viewData")) {
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
                  <span className="w-[13px] shrink-0" />
                )}
                <GroupIcon name={group.icon} size={14} />
                <span>{object.name}</span>
                {object.detail && <em className={treeRowEmClass}>{object.detail}</em>}
              </button>
              {objectOpen &&
                (subgroupDefs.length > 0
                  ? subgroupDefs.map((subgroup) => {
                      const subgroupKey = treeKeys.subgroup(
                        schema.name,
                        group.id,
                        object.name,
                        subgroup.id,
                      );
                      const subgroupOpen = expanded.has(subgroupKey);
                      const isColumns = subgroup.id === "columns";
                      const isKeys = subgroup.id === "keys";
                      const isIndexes = subgroup.id === "indexes";
                      const loadedSub =
                        isColumns ||
                        Object.prototype.hasOwnProperty.call(
                          objectSubgroups,
                          subgroupKey,
                        );
                      const items = objectSubgroups[subgroupKey] ?? [];
                      const count = isColumns
                        ? object.children.length
                        : loadedSub
                          ? items.length
                          : null;
                      const loading =
                        busyDetail?.kind === "subgroup" &&
                        busyDetail.schema === schema.name &&
                        busyDetail.object === object.name &&
                        busyDetail.subgroup === subgroup.id;
                      return (
                        <div key={subgroupKey}>
                          <button
                            type="button"
                            className={cn(
                              treeRowBaseClass,
                              "pl-[54px] text-[#9aa3b2] [&>svg:nth-child(2)]:text-blue [&>em]:text-[#6f7784]",
                            )}
                            onClick={() => onToggle(subgroupKey)}
                            onContextMenu={(event) => {
                              if (canMutate) {
                                if (
                                  isKeys &&
                                  objectActs.includes("editKey")
                                ) {
                                  onOpenMenu(event, {
                                    kind: "keysFolder",
                                    schema: schema.name,
                                    group,
                                    object,
                                    x: event.clientX,
                                    y: event.clientY,
                                  });
                                } else if (isIndexes) {
                                  onOpenMenu(event, {
                                    kind: "indexesFolder",
                                    schema: schema.name,
                                    group,
                                    object,
                                    x: event.clientX,
                                    y: event.clientY,
                                  });
                                }
                              }
                            }}
                          >
                            {subgroupOpen ? (
                              <ChevronDown size={13} />
                            ) : (
                              <ChevronRight size={13} />
                            )}
                            <GroupIcon name={subgroup.icon} size={13} />
                            <span>{subgroup.label}</span>
                            <em className={treeRowEmClass}>
                              {loading ? "…" : count ?? ""}
                            </em>
                          </button>
                          {subgroupOpen &&
                            (loading && !loadedSub ? (
                              <div
                                className={cn(
                                  treeRowBaseClass,
                                  "text-subtle gap-[7px] pl-7",
                                )}
                              >
                                <LoaderCircle className="animate-spin-slow" size={12} />
                                <span>Loading…</span>
                              </div>
                            ) : isColumns ? (
                              object.children.map((child) => (
                                <div
                                  className={cn(
                                    treeRowBaseClass,
                                    "pl-20 text-[#818a99] [&>span]:min-w-0 [&>em]:max-w-[110px] [&>em]:truncate",
                                  )}
                                  key={`${subgroupKey}.${child.name}`}
                                  onContextMenu={(event) => {
                                    if (
                                      canMutate &&
                                      objectActs.includes("editColumn")
                                    ) {
                                      onOpenMenu(event, {
                                        kind: "column",
                                        schema: schema.name,
                                        group,
                                        object,
                                        column: child,
                                        x: event.clientX,
                                        y: event.clientY,
                                      });
                                    }
                                  }}
                                >
                                  <Columns3 size={12} />
                                  <span>{child.name}</span>
                                  <em className={treeRowEmClass}>{child.dataType}</em>
                                </div>
                              ))
                            ) : (
                              items.map((item) => (
                                <div
                                  className={cn(
                                    treeRowBaseClass,
                                    "pl-20 text-[#818a99] [&>span]:min-w-0 [&>em]:max-w-[110px] [&>em]:truncate",
                                  )}
                                  key={`${subgroupKey}.${item.name}`}
                                  title={item.detail ?? undefined}
                                  onContextMenu={(event) => {
                                    if (canMutate) {
                                      if (
                                        isKeys &&
                                        objectActs.includes("editKey")
                                      ) {
                                        onOpenMenu(event, {
                                          kind: "key",
                                          schema: schema.name,
                                          group,
                                          object,
                                          key: item,
                                          x: event.clientX,
                                          y: event.clientY,
                                        });
                                      } else if (isIndexes) {
                                        onOpenMenu(event, {
                                          kind: "index",
                                          schema: schema.name,
                                          group,
                                          object,
                                          index: item,
                                          x: event.clientX,
                                          y: event.clientY,
                                        });
                                      }
                                    }
                                  }}
                                >
                                  <GroupIcon name={subgroup.icon} size={12} />
                                  <span>{item.name}</span>
                                  <em className={treeRowEmClass}>
                                    {item.detail || item.kind}
                                  </em>
                                </div>
                              ))
                            ))}
                        </div>
                      );
                    })
                  : object.children.map((child) => (
                      <div
                        className={cn(
                          treeRowBaseClass,
                          "pl-16 text-[#818a99] [&>em]:max-w-[74px] [&>em]:truncate",
                        )}
                        key={`${objectKey}.${child.name}`}
                        onContextMenu={(event) => {
                          if (
                            canMutate &&
                            objectActs.includes("editColumn")
                          ) {
                            onOpenMenu(event, {
                              kind: "column",
                              schema: schema.name,
                              group,
                              object,
                              column: child,
                              x: event.clientX,
                              y: event.clientY,
                            });
                          }
                        }}
                      >
                        <Columns3 size={12} />
                        <span>{child.name}</span>
                        <em className={treeRowEmClass}>{child.dataType}</em>
                      </div>
                    )))}
            </div>
          );
        })}
    </div>
  );
}
