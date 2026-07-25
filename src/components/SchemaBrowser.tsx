import { MouseEvent, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Columns3,
  LoaderCircle,
  MoreHorizontal,
  Plug,
  RefreshCw,
  Server,
  Table2,
  Zap,
} from "lucide-react";
import { ConnectionProfile } from "../types/connection";
import { SchemaNode } from "../types/schema";
import { ContextMenu } from "./ContextMenu";

type BusyDetail =
  | { kind: "connect" }
  | { kind: "query" }
  | { kind: "schemas" }
  | { kind: "tables"; schema: string }
  | null;

type BrowserMenu =
  | { kind: "database"; x: number; y: number }
  | { kind: "schema"; name: string; x: number; y: number }
  | { kind: "table"; schema: string; table: string; x: number; y: number };

interface SchemaBrowserProps {
  profile: ConnectionProfile;
  /** Live DB pool is open for this connection. */
  live: boolean;
  /** Cached schema list exists (or already loaded into UI). */
  hasCache: boolean;
  busy: "connect" | "query" | "schema" | null;
  busyDetail: BusyDetail;
  schemas: SchemaNode[];
  expanded: Set<string>;
  onConnect: () => void;
  onRefreshDatabase: () => void;
  onRefreshSchema: (schema: string) => void;
  onEdit: () => void;
  onToggle: (key: string) => void;
  onViewTable: (schema: string, table: string) => void;
  onEditTable: (schema: string, table: string) => void;
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
  onEdit,
  onToggle,
  onViewTable,
  onEditTable,
}: SchemaBrowserProps) {
  const [menu, setMenu] = useState<BrowserMenu | null>(null);
  const refreshingSchemas = busyDetail?.kind === "schemas";
  const refreshingTableSchema =
    busyDetail?.kind === "tables" ? busyDetail.schema : null;
  const showConnect = !hasCache && !live;
  const canInteract = hasCache || live;

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
          <strong>{profile.database}</strong>
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
            const schemaKey = `schema:${schema.name}`;
            const schemaOpen = expanded.has(schemaKey);
            const tables = schema.tables;
            const loadingTables = refreshingTableSchema === schema.name;
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
                    <em>
                      {loadingTables
                        ? "…"
                        : tables
                          ? tables.length
                          : ""}
                    </em>
                  </button>
                  <button
                    type="button"
                    className="icon-button tree-row-action"
                    aria-label={`Refresh ${schema.name}`}
                    title="Refresh tables"
                    disabled={busy === "schema"}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRefreshSchema(schema.name);
                    }}
                  >
                    <RefreshCw
                      size={12}
                      className={loadingTables ? "spin" : ""}
                    />
                  </button>
                </div>
                {schemaOpen && loadingTables && tables === null && (
                  <div className="tree-row column-row loading-row">
                    <LoaderCircle className="spin" size={12} />
                    <span>Loading tables…</span>
                  </div>
                )}
                {schemaOpen &&
                  tables?.map((table) => {
                    const tableKey = `table:${schema.name}.${table.name}`;
                    const tableOpen = expanded.has(tableKey);
                    return (
                      <div key={tableKey}>
                        <button
                          className="tree-row table-row"
                          onClick={() => onToggle(tableKey)}
                          onDoubleClick={() =>
                            onEditTable(schema.name, table.name)
                          }
                          onContextMenu={(event) =>
                            openMenu(event, {
                              kind: "table",
                              schema: schema.name,
                              table: table.name,
                              x: event.clientX,
                              y: event.clientY,
                            })
                          }
                        >
                          {tableOpen ? (
                            <ChevronDown size={13} />
                          ) : (
                            <ChevronRight size={13} />
                          )}
                          <Table2 size={14} />
                          <span>{table.name}</span>
                        </button>
                        {tableOpen &&
                          table.columns.map((column) => (
                            <div
                              className="tree-row column-row"
                              key={`${tableKey}.${column.name}`}
                            >
                              <Columns3 size={12} />
                              <span>{column.name}</span>
                              <em>{column.dataType}</em>
                            </div>
                          ))}
                      </div>
                    );
                  })}
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
              <RefreshCw size={14} /> Refresh tables
            </button>
          )}
          {menu.kind === "table" && (
            <>
              <button
                type="button"
                onClick={() => {
                  onEditTable(menu.schema, menu.table);
                  setMenu(null);
                }}
              >
                <Zap size={14} /> Edit Data
              </button>
              <button
                type="button"
                onClick={() => {
                  onViewTable(menu.schema, menu.table);
                  setMenu(null);
                }}
              >
                <Table2 size={14} /> View Data
              </button>
              <button
                type="button"
                onClick={() => {
                  onRefreshSchema(menu.schema);
                  setMenu(null);
                }}
              >
                <RefreshCw size={14} /> Refresh schema
              </button>
            </>
          )}
        </ContextMenu>
      )}
    </>
  );
}
