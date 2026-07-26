import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Columns3,
  KeyRound,
  ListTree,
  LoaderCircle,
  Minus,
  Plus,
  Table2,
  X,
} from "lucide-react";
import { databaseApi } from "../../api/database";
import { ConnectionProfile } from "../../types/connection";
import {
  AlterTableRequest,
  ColumnNode,
  ObjectNode,
  TableIndexChange,
  TableKeyChange,
} from "../../types/schema";
import {
  COMMON_DATA_TYPES,
  blankDraftColumn,
  buildAlterTablePreview,
  columnToDraft,
  diffColumns,
  type DraftColumn,
} from "../../lib/alterSql";
import { columnTypeIcon } from "../../lib/sql";

type Section = "columns" | "keys" | "indexes";
type Selection = { section: Section; id: string };

type DraftKey = {
  id: string;
  originalName: string | null;
  name: string;
  kind: "PRIMARY KEY" | "UNIQUE";
  columns: string[];
  removed?: boolean;
};

type DraftIndex = {
  id: string;
  originalName: string | null;
  name: string;
  unique: boolean;
  method: string;
  columns: string[];
  removed?: boolean;
};

interface EditTableModalProps {
  connectionId: string;
  schema: string;
  table: string;
  columns: ColumnNode[];
  driver: ConnectionProfile["driver"];
  initialSection?: Section;
  initialName?: string;
  busy?: boolean;
  error?: string | null;
  onSave: (request: AlterTableRequest) => void;
  onClose: () => void;
}

let draftSeq = 0;
function nextId(prefix: string) {
  draftSeq += 1;
  return `${prefix}-${draftSeq}`;
}

function detailColumns(detail?: string | null): string[] {
  if (!detail) return [];
  const start = detail.lastIndexOf("(");
  const end = detail.lastIndexOf(")");
  if (start < 0 || end <= start) return [];
  return detail
    .slice(start + 1, end)
    .split(",")
    .map((value) =>
      value
        .trim()
        .replace(/\s+(ASC|DESC)$/i, "")
        .replace(/\(\d+\)$/, "")
        .replace(/^["`]|["`]$/g, ""),
    )
    .filter(Boolean);
}

function keyDraft(node: ObjectNode): DraftKey {
  return {
    id: nextId("key"),
    originalName: node.name,
    name: node.name,
    kind: node.kind.toUpperCase().includes("PRIMARY")
      ? "PRIMARY KEY"
      : "UNIQUE",
    columns: detailColumns(node.detail),
  };
}

function indexDraft(node: ObjectNode): DraftIndex {
  const detail = node.detail ?? "";
  const pgMethod = detail.match(/\bUSING\s+(\w+)/i)?.[1];
  const mysqlMethod = detail.match(/^(?:UNIQUE\s+)?(\w+)/i)?.[1];
  return {
    id: nextId("index"),
    originalName: node.name,
    name: node.name,
    unique: /\bUNIQUE\b/i.test(detail),
    method: pgMethod ?? mysqlMethod ?? "BTREE",
    columns: detailColumns(detail),
  };
}

function diffKeys(original: DraftKey[], drafts: DraftKey[]): TableKeyChange[] {
  const changes: TableKeyChange[] = [];
  for (const draft of drafts) {
    if (draft.removed) {
      if (draft.originalName) {
        changes.push({
            action: "drop",
            name: draft.originalName,
            kind: draft.kind,
            columns: [],
        });
      }
      continue;
    }
    if (!draft.originalName) {
      changes.push({
        action: "add",
        name: null,
        newName: draft.name.trim() || null,
        kind: draft.kind,
        columns: draft.columns,
      });
      continue;
    }
    const base = original.find((item) => item.originalName === draft.originalName);
    if (
      base &&
      base.name === draft.name &&
      base.kind === draft.kind &&
      JSON.stringify(base.columns) === JSON.stringify(draft.columns)
    ) {
      continue;
    }
    changes.push({
      action: "modify",
      name: draft.originalName,
      newName: draft.name.trim() || null,
      kind: draft.kind,
      columns: draft.columns,
    });
  }
  return changes;
}

function diffIndexes(
  original: DraftIndex[],
  drafts: DraftIndex[],
): TableIndexChange[] {
  const changes: TableIndexChange[] = [];
  for (const draft of drafts) {
    if (draft.removed) {
      if (draft.originalName) {
        changes.push({
            action: "drop",
            name: draft.originalName,
            columns: [],
        });
      }
      continue;
    }
    if (!draft.originalName) {
      changes.push({
        action: "add",
        newName: draft.name.trim() || null,
        unique: draft.unique,
        method: draft.method,
        columns: draft.columns,
      });
      continue;
    }
    const base = original.find((item) => item.originalName === draft.originalName);
    if (
      base &&
      base.name === draft.name &&
      base.unique === draft.unique &&
      base.method === draft.method &&
      JSON.stringify(base.columns) === JSON.stringify(draft.columns)
    ) {
      continue;
    }
    changes.push({
      action: "modify",
      name: draft.originalName,
      newName: draft.name.trim() || null,
      unique: draft.unique,
      method: draft.method,
      columns: draft.columns,
    });
  }
  return changes;
}

export function EditTableModal({
  connectionId,
  schema,
  table,
  columns,
  driver,
  initialSection = "columns",
  initialName,
  busy,
  error,
  onSave,
  onClose,
}: EditTableModalProps) {
  const isMysql = driver === "mysql";
  const [tableName, setTableName] = useState(table);
  const [columnDrafts, setColumnDrafts] = useState<DraftColumn[]>(() =>
    columns.map((column) => columnToDraft(column, nextId("column"))),
  );
  const [originalKeys, setOriginalKeys] = useState<DraftKey[]>([]);
  const [keyDrafts, setKeyDrafts] = useState<DraftKey[]>([]);
  const [originalIndexes, setOriginalIndexes] = useState<DraftIndex[]>([]);
  const [indexDrafts, setIndexDrafts] = useState<DraftIndex[]>([]);
  const [selection, setSelection] = useState<Selection | null>(() => {
    const column = initialSection === "columns"
      ? columnDrafts.find((item) => item.name === initialName) ?? columnDrafts[0]
      : null;
    return column ? { section: "columns", id: column.id } : null;
  });
  const [metadataLoading, setMetadataLoading] = useState(true);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setMetadataLoading(true);
    void Promise.all([
      databaseApi.listObjectSubgroup(connectionId, schema, table, "keys"),
      databaseApi.listObjectSubgroup(connectionId, schema, table, "indexes"),
    ])
      .then(([keys, indexes]) => {
        if (cancelled) return;
        const nextKeys = keys.map(keyDraft);
        const keyNames = new Set(nextKeys.map((key) => key.name));
        // Constraint-backed indexes are edited through the Keys section.
        const nextIndexes = indexes
          .filter((index) => !keyNames.has(index.name))
          .map(indexDraft);
        setOriginalKeys(nextKeys.map((item) => ({ ...item, columns: [...item.columns] })));
        setKeyDrafts(nextKeys);
        setOriginalIndexes(
          nextIndexes.map((item) => ({ ...item, columns: [...item.columns] })),
        );
        setIndexDrafts(nextIndexes);
        if (initialSection === "keys") {
          const item =
            nextKeys.find((key) => key.name === initialName) ?? nextKeys[0];
          setSelection({ section: "keys", id: item?.id ?? "" });
        } else if (initialSection === "indexes") {
          const constraintIndex = nextKeys.find(
            (key) => key.name === initialName,
          );
          if (constraintIndex) {
            setSelection({ section: "keys", id: constraintIndex.id });
            return;
          }
          const item =
            nextIndexes.find((index) => index.name === initialName) ??
            nextIndexes[0];
          setSelection({ section: "indexes", id: item?.id ?? "" });
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setMetadataError(
            loadError instanceof Error ? loadError.message : String(loadError),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setMetadataLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, initialName, initialSection, schema, table]);

  const selectedColumn =
    selection?.section === "columns"
      ? columnDrafts.find(
          (draft) => !draft.removed && draft.id === selection.id,
        ) ?? null
      : null;
  const selectedKey =
    selection?.section === "keys"
      ? keyDrafts.find((draft) => !draft.removed && draft.id === selection.id) ??
        null
      : null;
  const selectedIndex =
    selection?.section === "indexes"
      ? indexDrafts.find(
          (draft) => !draft.removed && draft.id === selection.id,
        ) ?? null
      : null;
  const visibleColumns = columnDrafts.filter((draft) => !draft.removed);
  const visibleKeys = keyDrafts.filter((draft) => !draft.removed);
  const visibleIndexes = indexDrafts.filter((draft) => !draft.removed);
  const availableColumns = visibleColumns.map((column) => column.name).filter(Boolean);

  const columnChanges = useMemo(
    () => diffColumns(columns, columnDrafts),
    [columns, columnDrafts],
  );
  const keyChanges = useMemo(
    () => diffKeys(originalKeys, keyDrafts),
    [keyDrafts, originalKeys],
  );
  const indexChanges = useMemo(
    () => diffIndexes(originalIndexes, indexDrafts),
    [indexDrafts, originalIndexes],
  );
  const previewSql = useMemo(
    () =>
      buildAlterTablePreview({
        driver,
        schema,
        table,
        newName: tableName.trim() !== table ? tableName.trim() : null,
        changes: columnChanges,
        keyChanges,
        indexChanges,
      }),
    [
      columnChanges,
      driver,
      indexChanges,
      keyChanges,
      schema,
      table,
      tableName,
    ],
  );
  const hasChanges =
    columnChanges.length > 0 ||
    keyChanges.length > 0 ||
    indexChanges.length > 0 ||
    (tableName.trim() !== table && Boolean(tableName.trim()));
  const invalidStructure =
    !tableName.trim() ||
    visibleColumns.some(
      (column) => !column.name.trim() || !column.dataType.trim(),
    ) ||
    visibleKeys.some((key) => key.columns.length === 0) ||
    visibleIndexes.some(
      (index) => !index.name.trim() || index.columns.length === 0,
    );

  function addItem() {
    const section = selection?.section ?? "columns";
    if (section === "columns") {
      const draft = blankDraftColumn(nextId("column"));
      setColumnDrafts((current) => [...current, draft]);
      setSelection({ section, id: draft.id });
    } else if (section === "keys") {
      const draft: DraftKey = {
        id: nextId("key"),
        originalName: null,
        name: "new_key",
        kind: "UNIQUE",
        columns: [],
      };
      setKeyDrafts((current) => [...current, draft]);
      setSelection({ section, id: draft.id });
    } else {
      const draft: DraftIndex = {
        id: nextId("index"),
        originalName: null,
        name: "new_index",
        unique: false,
        method: isMysql ? "BTREE" : "btree",
        columns: [],
      };
      setIndexDrafts((current) => [...current, draft]);
      setSelection({ section, id: draft.id });
    }
  }

  function removeSelected() {
    if (!selection) return;
    if (selection.section === "columns") {
      setColumnDrafts((current) =>
        current
          .map((item) =>
            item.id === selection.id
              ? item.originalName
                ? { ...item, removed: true }
                : null
              : item,
          )
          .filter((item): item is DraftColumn => item != null),
      );
    } else if (selection.section === "keys") {
      setKeyDrafts((current) =>
        current
          .map((item) =>
            item.id === selection.id
              ? item.originalName
                ? { ...item, removed: true }
                : null
              : item,
          )
          .filter((item): item is DraftKey => item != null),
      );
    } else {
      setIndexDrafts((current) =>
        current
          .map((item) =>
            item.id === selection.id
              ? item.originalName
                ? { ...item, removed: true }
                : null
              : item,
          )
          .filter((item): item is DraftIndex => item != null),
      );
    }
    setSelection(null);
  }

  function moveColumn(delta: number) {
    if (!selectedColumn) return;
    setColumnDrafts((current) => {
      const visible = current.filter((item) => !item.removed);
      const index = visible.findIndex((item) => item.id === selectedColumn.id);
      const swapWith = index + delta;
      if (index < 0 || swapWith < 0 || swapWith >= visible.length) return current;
      const copy = [...current];
      const a = copy.findIndex((item) => item.id === visible[index].id);
      const b = copy.findIndex((item) => item.id === visible[swapWith].id);
      [copy[a], copy[b]] = [copy[b], copy[a]];
      return copy;
    });
  }

  function updateColumn(patch: Partial<DraftColumn>) {
    if (!selectedColumn) return;
    const previousName = selectedColumn.name;
    setColumnDrafts((current) =>
      current.map((item) =>
        item.id === selectedColumn.id ? { ...item, ...patch } : item,
      ),
    );
    if (patch.name && patch.name !== previousName) {
      setKeyDrafts((current) =>
        current.map((item) => ({
          ...item,
          columns: item.columns.map((column) =>
            column === previousName ? patch.name! : column,
          ),
        })),
      );
      setIndexDrafts((current) =>
        current.map((item) => ({
          ...item,
          columns: item.columns.map((column) =>
            column === previousName ? patch.name! : column,
          ),
        })),
      );
    }
  }

  function updateKey(patch: Partial<DraftKey>) {
    if (!selectedKey) return;
    setKeyDrafts((current) =>
      current.map((item) =>
        item.id === selectedKey.id ? { ...item, ...patch } : item,
      ),
    );
  }

  function updateIndex(patch: Partial<DraftIndex>) {
    if (!selectedIndex) return;
    setIndexDrafts((current) =>
      current.map((item) =>
        item.id === selectedIndex.id ? { ...item, ...patch } : item,
      ),
    );
  }

  function toggleMember(
    current: string[],
    column: string,
    update: (columns: string[]) => void,
  ) {
    update(
      current.includes(column)
        ? current.filter((item) => item !== column)
        : [...current, column],
    );
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!hasChanges || invalidStructure || busy) return;
    onSave({
      schema,
      table,
      newName: tableName.trim() !== table ? tableName.trim() : null,
      columns: columnChanges,
      keys: keyChanges,
      indexes: indexChanges,
    });
  }

  function sectionHeader(
    section: Section,
    label: string,
    count: number,
    icon: React.ReactNode,
  ) {
    return (
      <button
        type="button"
        className={`modify-folder ${selection?.section === section ? "active" : ""}`}
        onClick={() => {
          const first =
            section === "columns"
              ? visibleColumns[0]
              : section === "keys"
                ? visibleKeys[0]
                : visibleIndexes[0];
          setSelection(first ? { section, id: first.id } : { section, id: "" });
        }}
      >
        {icon}
        <span>{label}</span>
        <em>{count}</em>
      </button>
    );
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) =>
        event.target === event.currentTarget && !busy && onClose()
      }
    >
      <form className="modify-modal" onSubmit={handleSubmit}>
        <div className="modify-toolbar">
          <div className="modify-toolbar-left">
            <button
              type="button"
              className="icon-button"
              title="Add item"
              disabled={busy || metadataLoading}
              onClick={addItem}
            >
              <Plus size={15} />
            </button>
            <button
              type="button"
              className="icon-button"
              title="Remove item"
              disabled={busy || !selection?.id}
              onClick={removeSelected}
            >
              <Minus size={15} />
            </button>
            <button
              type="button"
              className="icon-button"
              title="Move column up"
              disabled={busy || !selectedColumn}
              onClick={() => moveColumn(-1)}
            >
              <ChevronUp size={15} />
            </button>
            <button
              type="button"
              className="icon-button"
              title="Move column down"
              disabled={busy || !selectedColumn}
              onClick={() => moveColumn(1)}
            >
              <ChevronDown size={15} />
            </button>
          </div>
          <div className="modify-toolbar-title">
            <Table2 size={15} />
            <strong>Modify</strong>
            <em>
              {schema}.{table}
            </em>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>

        <div className="modify-body">
          <aside className="modify-sidebar">
            <div className="modify-table-name">
              <Table2 size={13} />
              <input
                value={tableName}
                disabled={busy}
                aria-label="Table name"
                onChange={(event) => setTableName(event.target.value)}
              />
            </div>

            {sectionHeader(
              "columns",
              "Columns",
              visibleColumns.length,
              <Columns3 size={13} />,
            )}
            <div className="modify-column-list modify-group-list">
              {visibleColumns.map((draft) => {
                const icon = columnTypeIcon(draft.dataType);
                return (
                  <button
                    key={draft.id}
                    type="button"
                    className={`modify-column-item ${
                      selection?.section === "columns" &&
                      selection.id === draft.id
                        ? "active"
                        : ""
                    }`}
                    onClick={() =>
                      setSelection({ section: "columns", id: draft.id })
                    }
                  >
                    <span className={`type-badge type-${icon}`}>
                      {icon === "number" ? "#" : icon === "date" ? "◷" : "Aa"}
                    </span>
                    <span className="modify-column-label">
                      {draft.name || "unnamed"}
                      <em>{draft.dataType}</em>
                    </span>
                  </button>
                );
              })}
            </div>

            {sectionHeader(
              "keys",
              "Keys",
              visibleKeys.length,
              <KeyRound size={13} />,
            )}
            <div className="modify-column-list modify-group-list">
              {visibleKeys.map((draft) => (
                <button
                  key={draft.id}
                  type="button"
                  className={`modify-column-item ${
                    selection?.section === "keys" && selection.id === draft.id
                      ? "active"
                      : ""
                  }`}
                  onClick={() => setSelection({ section: "keys", id: draft.id })}
                >
                  <KeyRound size={13} />
                  <span className="modify-column-label">
                    {draft.name || draft.kind}
                    <em>{draft.kind}</em>
                  </span>
                </button>
              ))}
            </div>

            {sectionHeader(
              "indexes",
              "Indexes",
              visibleIndexes.length,
              <ListTree size={13} />,
            )}
            <div className="modify-column-list modify-group-list">
              {visibleIndexes.map((draft) => (
                <button
                  key={draft.id}
                  type="button"
                  className={`modify-column-item ${
                    selection?.section === "indexes" &&
                    selection.id === draft.id
                      ? "active"
                      : ""
                  }`}
                  onClick={() =>
                    setSelection({ section: "indexes", id: draft.id })
                  }
                >
                  <ListTree size={13} />
                  <span className="modify-column-label">
                    {draft.name || "unnamed"}
                    <em>
                      {draft.unique ? "UNIQUE " : ""}
                      {draft.method}
                    </em>
                  </span>
                </button>
              ))}
            </div>

            {metadataLoading && (
              <div className="modify-metadata-status">
                <LoaderCircle className="spin" size={12} /> Loading metadata…
              </div>
            )}
          </aside>

          <section className="modify-editor">
            {selectedColumn && (
              <>
                <div className="modify-editor-heading">
                  <Columns3 size={15} />
                  <strong>{selectedColumn.name || "Column"}</strong>
                </div>
                <div className="modify-form">
                  <label>
                    Name
                    <input
                      value={selectedColumn.name}
                      disabled={busy}
                      onChange={(event) => updateColumn({ name: event.target.value })}
                    />
                  </label>
                  <label>
                    Comment
                    <textarea
                      rows={3}
                      value={selectedColumn.comment}
                      disabled={busy}
                      onChange={(event) =>
                        updateColumn({ comment: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Data Type
                    <input
                      list="hypergrid-column-types"
                      value={selectedColumn.dataType}
                      disabled={busy}
                      onChange={(event) =>
                        updateColumn({ dataType: event.target.value })
                      }
                    />
                    <datalist id="hypergrid-column-types">
                      {COMMON_DATA_TYPES.map((type) => (
                        <option key={type} value={type} />
                      ))}
                    </datalist>
                  </label>
                  <div className="modify-checks">
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={!selectedColumn.nullable}
                        disabled={busy}
                        onChange={(event) =>
                          updateColumn({ nullable: !event.target.checked })
                        }
                      />
                      <span>Not Null</span>
                    </label>
                    {isMysql && (
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={selectedColumn.autoIncrement}
                          disabled={busy}
                          onChange={(event) =>
                            updateColumn({ autoIncrement: event.target.checked })
                          }
                        />
                        <span>Auto Increment</span>
                      </label>
                    )}
                  </div>
                  <label>
                    Default Expression
                    <input
                      value={selectedColumn.defaultValue}
                      disabled={busy}
                      placeholder="e.g. CURRENT_TIMESTAMP"
                      onChange={(event) =>
                        updateColumn({ defaultValue: event.target.value })
                      }
                    />
                  </label>
                  {isMysql && (
                    <>
                      <label>
                        On Update
                        <input
                          value={selectedColumn.onUpdate}
                          disabled={busy}
                          placeholder="e.g. CURRENT_TIMESTAMP"
                          onChange={(event) =>
                            updateColumn({ onUpdate: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        Collation
                        <input
                          value={selectedColumn.collation}
                          disabled={busy}
                          placeholder="e.g. utf8mb4_unicode_ci"
                          onChange={(event) =>
                            updateColumn({ collation: event.target.value })
                          }
                        />
                      </label>
                    </>
                  )}
                </div>
              </>
            )}

            {selectedKey && (
              <>
                <div className="modify-editor-heading">
                  <KeyRound size={15} />
                  <strong>{selectedKey.name || "Key"}</strong>
                </div>
                <div className="modify-form">
                  <label>
                    Name
                    <input
                      value={selectedKey.name}
                      disabled={busy}
                      onChange={(event) => updateKey({ name: event.target.value })}
                    />
                  </label>
                  <label>
                    Kind
                    <select
                      value={selectedKey.kind}
                      disabled={busy}
                      onChange={(event) =>
                        updateKey({
                          kind: event.target.value as DraftKey["kind"],
                        })
                      }
                    >
                      <option value="PRIMARY KEY">PRIMARY KEY</option>
                      <option value="UNIQUE">UNIQUE</option>
                    </select>
                  </label>
                  <ColumnPicker
                    columns={availableColumns}
                    selected={selectedKey.columns}
                    onToggle={(column) =>
                      toggleMember(selectedKey.columns, column, (next) =>
                        updateKey({ columns: next }),
                      )
                    }
                  />
                </div>
              </>
            )}

            {selectedIndex && (
              <>
                <div className="modify-editor-heading">
                  <ListTree size={15} />
                  <strong>{selectedIndex.name || "Index"}</strong>
                </div>
                <div className="modify-form">
                  <label>
                    Name
                    <input
                      value={selectedIndex.name}
                      disabled={busy}
                      onChange={(event) =>
                        updateIndex({ name: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Method
                    <select
                      value={selectedIndex.method}
                      disabled={busy}
                      onChange={(event) =>
                        updateIndex({ method: event.target.value })
                      }
                    >
                      {(isMysql
                        ? ["BTREE", "HASH", "FULLTEXT", "SPATIAL"]
                        : ["btree", "hash", "gist", "gin", "brin"]
                      ).map((method) => (
                        <option key={method} value={method}>
                          {method}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={selectedIndex.unique}
                      disabled={busy}
                      onChange={(event) =>
                        updateIndex({ unique: event.target.checked })
                      }
                    />
                    <span>Unique</span>
                  </label>
                  <ColumnPicker
                    columns={availableColumns}
                    selected={selectedIndex.columns}
                    onToggle={(column) =>
                      toggleMember(selectedIndex.columns, column, (next) =>
                        updateIndex({ columns: next }),
                      )
                    }
                  />
                </div>
              </>
            )}

            {!selectedColumn && !selectedKey && !selectedIndex && (
              <div className="modify-empty">
                {metadataLoading
                  ? "Loading table structure…"
                  : "Select a column, key, or index"}
              </div>
            )}
          </section>
        </div>

        <div className={`modify-preview ${previewOpen ? "open" : ""}`}>
          <button
            type="button"
            className="modify-preview-toggle"
            onClick={() => setPreviewOpen((open) => !open)}
          >
            {previewOpen ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
            Preview
          </button>
          {previewOpen && (
            <pre className="modify-preview-sql">
              {previewSql || "-- No changes"}
            </pre>
          )}
        </div>

        {(error || metadataError) && (
          <p className="form-error modify-error">{error || metadataError}</p>
        )}

        <div className="modal-actions modify-actions">
          <div />
          <div>
            <button
              type="button"
              className="ghost-button"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={busy || !hasChanges || invalidStructure}
            >
              {busy ? "Saving…" : "OK"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function ColumnPicker({
  columns,
  selected,
  onToggle,
}: {
  columns: string[];
  selected: string[];
  onToggle: (column: string) => void;
}) {
  return (
    <fieldset className="key-columns modify-column-picker">
      <legend>Columns</legend>
      {columns.map((column) => (
        <label key={column} className="checkbox-row">
          <input
            type="checkbox"
            checked={selected.includes(column)}
            onChange={() => onToggle(column)}
          />
          <span>{column}</span>
        </label>
      ))}
    </fieldset>
  );
}
