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
import { cn } from "../../lib/cn";
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
  /** Open with a blank draft already added in `initialSection`. */
  addNew?: boolean;
  busy?: boolean;
  error?: string | null;
  onSave: (request: AlterTableRequest) => void;
  onClose: () => void;
}

const iconButtonClass =
  "w-7 h-7 grid place-items-center p-0 border-0 rounded-[5px] text-muted bg-transparent cursor-pointer enabled:hover:text-text enabled:hover:bg-panel-soft disabled:cursor-default disabled:opacity-40";
const modifyFormLabelClass =
  "flex flex-col gap-[5px] text-muted text-[10px] font-[540]";
const modifyFormInputClass =
  "w-full h-[34px] px-[9px] border border-border-bright rounded-[5px] text-text bg-surface-input text-[11px] focus:border-accent";
const modifyFormTextareaClass =
  "w-full px-[9px] py-2 border border-border-bright rounded-[5px] text-text bg-surface-input text-[11px] focus:border-accent resize-y min-h-16 font-inherit";
const modifyCheckboxRowClass =
  "flex flex-row items-center gap-2 text-muted text-[11px] font-normal cursor-pointer";
const modifyCheckboxInputClass =
  "w-3.5 h-3.5 m-0 shrink-0 accent-accent cursor-pointer";

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
  addNew = false,
  busy,
  error,
  onSave,
  onClose,
}: EditTableModalProps) {
  const isMysql = driver === "mysql";
  const [tableName, setTableName] = useState(table);
  const [columnDrafts, setColumnDrafts] = useState<DraftColumn[]>(() => {
    const drafts = columns.map((column) =>
      columnToDraft(column, nextId("column")),
    );
    if (addNew && initialSection === "columns") {
      drafts.push(blankDraftColumn(nextId("column")));
    }
    return drafts;
  });
  const [originalKeys, setOriginalKeys] = useState<DraftKey[]>([]);
  const [keyDrafts, setKeyDrafts] = useState<DraftKey[]>([]);
  const [originalIndexes, setOriginalIndexes] = useState<DraftIndex[]>([]);
  const [indexDrafts, setIndexDrafts] = useState<DraftIndex[]>([]);
  const [selection, setSelection] = useState<Selection | null>(() => {
    if (initialSection !== "columns") return null;
    if (addNew) {
      const draft = columnDrafts[columnDrafts.length - 1];
      return draft ? { section: "columns", id: draft.id } : null;
    }
    const column =
      columnDrafts.find((item) => item.name === initialName) ?? columnDrafts[0];
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
        setOriginalIndexes(
          nextIndexes.map((item) => ({ ...item, columns: [...item.columns] })),
        );

        if (initialSection === "keys") {
          if (addNew) {
            const draft: DraftKey = {
              id: nextId("key"),
              originalName: null,
              name: "new_key",
              kind: "UNIQUE",
              columns: [],
            };
            setKeyDrafts([...nextKeys, draft]);
            setIndexDrafts(nextIndexes);
            setSelection({ section: "keys", id: draft.id });
            return;
          }
          setKeyDrafts(nextKeys);
          setIndexDrafts(nextIndexes);
          const item =
            nextKeys.find((key) => key.name === initialName) ?? nextKeys[0];
          setSelection({ section: "keys", id: item?.id ?? "" });
        } else if (initialSection === "indexes") {
          if (addNew) {
            const draft: DraftIndex = {
              id: nextId("index"),
              originalName: null,
              name: "new_index",
              unique: false,
              method: isMysql ? "BTREE" : "btree",
              columns: [],
            };
            setKeyDrafts(nextKeys);
            setIndexDrafts([...nextIndexes, draft]);
            setSelection({ section: "indexes", id: draft.id });
            return;
          }
          setKeyDrafts(nextKeys);
          setIndexDrafts(nextIndexes);
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
        } else {
          setKeyDrafts(nextKeys);
          setIndexDrafts(nextIndexes);
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
  }, [addNew, connectionId, initialName, initialSection, isMysql, schema, table]);

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
        className={cn(
          "w-full flex items-center gap-[7px] px-2.5 py-[7px] text-muted bg-panel-soft border-0 text-[11px] border-b border-border text-left cursor-pointer hover:text-text hover:bg-panel-soft",
          selection?.section === section && "text-text bg-panel-soft",
        )}
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
        <em className="ml-auto not-italic text-subtle">{count}</em>
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-20 grid place-items-center p-5 bg-black/70 backdrop-blur-[4px]"
      onMouseDown={(event) =>
        event.target === event.currentTarget && !busy && onClose()
      }
    >
      <form
        className="w-[min(920px,100%)] max-h-[min(720px,100%)] flex flex-col border border-border-bright rounded-[10px] bg-surface shadow-[0_24px_70px_rgba(0,0,0,.5)] overflow-hidden"
        onSubmit={handleSubmit}
      >
        <div className="flex items-center gap-2.5 px-2.5 py-2 border-b border-border bg-panel">
          <div className="flex gap-0.5">
            <button
              type="button"
              className={iconButtonClass}
              title="Add item"
              disabled={busy || metadataLoading}
              onClick={addItem}
            >
              <Plus size={15} />
            </button>
            <button
              type="button"
              className={iconButtonClass}
              title="Remove item"
              disabled={busy || !selection?.id}
              onClick={removeSelected}
            >
              <Minus size={15} />
            </button>
            <button
              type="button"
              className={iconButtonClass}
              title="Move column up"
              disabled={busy || !selectedColumn}
              onClick={() => moveColumn(-1)}
            >
              <ChevronUp size={15} />
            </button>
            <button
              type="button"
              className={iconButtonClass}
              title="Move column down"
              disabled={busy || !selectedColumn}
              onClick={() => moveColumn(1)}
            >
              <ChevronDown size={15} />
            </button>
          </div>
          <div className="flex-1 flex items-center gap-2 text-text text-xs">
            <Table2 size={15} />
            <strong>Modify</strong>
            <em className="text-muted not-italic text-[11px]">
              {schema}.{table}
            </em>
          </div>
          <button
            type="button"
            className={iconButtonClass}
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>

        <div className="flex-1 min-h-[360px] grid grid-cols-[240px_1fr] overflow-hidden">
          <aside className="border-r border-border bg-surface-deep flex flex-col overflow-hidden">
            <div className="flex items-center gap-[7px] px-2.5 py-2 border-b border-border text-text">
              <Table2 size={13} />
              <input
                className="flex-1 h-[26px] px-1.5 border border-transparent rounded text-text-bright bg-transparent text-xs font-semibold focus:border-accent focus:bg-surface-input"
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
            <div className="flex-[0_1_150px] min-h-0 overflow-auto py-1 border-b border-border">
              {visibleColumns.map((draft) => {
                const icon = columnTypeIcon(draft.dataType);
                return (
                  <button
                    key={draft.id}
                    type="button"
                    className={cn(
                      "w-full flex items-center gap-2 px-2.5 py-1.5 border-0 bg-transparent text-muted text-left cursor-pointer text-[11px] hover:bg-panel-soft",
                      selection?.section === "columns" &&
                        selection.id === draft.id &&
                        "bg-accent-soft text-text-bright",
                    )}
                    onClick={() =>
                      setSelection({ section: "columns", id: draft.id })
                    }
                  >
                    <span
                      className={cn(
                        "w-[18px] h-[18px] rounded-[3px] grid place-items-center text-[9px] font-bold shrink-0 bg-panel-raised text-muted",
                        icon === "number" && "text-warn",
                        icon === "date" && "text-green",
                        icon === "bool" && "text-warn",
                      )}
                    >
                      {icon === "number" ? "#" : icon === "date" ? "◷" : "Aa"}
                    </span>
                    <span className="flex flex-col gap-px min-w-0">
                      {draft.name || "unnamed"}
                      <em className="text-subtle not-italic text-[10px] overflow-hidden text-ellipsis whitespace-nowrap">
                        {draft.dataType}
                      </em>
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
            <div className="flex-[0_1_150px] min-h-0 overflow-auto py-1 border-b border-border">
              {visibleKeys.map((draft) => (
                <button
                  key={draft.id}
                  type="button"
                  className={cn(
                    "w-full flex items-center gap-2 px-2.5 py-1.5 border-0 bg-transparent text-muted text-left cursor-pointer text-[11px] hover:bg-panel-soft",
                    selection?.section === "keys" &&
                      selection.id === draft.id &&
                      "bg-accent-soft text-text-bright",
                  )}
                  onClick={() => setSelection({ section: "keys", id: draft.id })}
                >
                  <KeyRound size={13} />
                  <span className="flex flex-col gap-px min-w-0">
                    {draft.name || draft.kind}
                    <em className="text-subtle not-italic text-[10px] overflow-hidden text-ellipsis whitespace-nowrap">
                      {draft.kind}
                    </em>
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
            <div className="flex-[0_1_150px] min-h-0 overflow-auto py-1 border-b border-border">
              {visibleIndexes.map((draft) => (
                <button
                  key={draft.id}
                  type="button"
                  className={cn(
                    "w-full flex items-center gap-2 px-2.5 py-1.5 border-0 bg-transparent text-muted text-left cursor-pointer text-[11px] hover:bg-panel-soft",
                    selection?.section === "indexes" &&
                      selection.id === draft.id &&
                      "bg-accent-soft text-text-bright",
                  )}
                  onClick={() =>
                    setSelection({ section: "indexes", id: draft.id })
                  }
                >
                  <ListTree size={13} />
                  <span className="flex flex-col gap-px min-w-0">
                    {draft.name || "unnamed"}
                    <em className="text-subtle not-italic text-[10px] overflow-hidden text-ellipsis whitespace-nowrap">
                      {draft.unique ? "UNIQUE " : ""}
                      {draft.method}
                    </em>
                  </span>
                </button>
              ))}
            </div>

            {metadataLoading && (
              <div className="flex items-center gap-1.5 px-2.5 py-2 text-muted text-[10px]">
                <LoaderCircle className="animate-spin-slow" size={12} /> Loading metadata…
              </div>
            )}
          </aside>

          <section className="flex flex-col overflow-auto px-4 py-3.5">
            {selectedColumn && (
              <>
                <div className="flex items-center gap-2 mb-3.5 text-text-bright text-[13px]">
                  <Columns3 size={15} />
                  <strong>{selectedColumn.name || "Column"}</strong>
                </div>
                <div className="flex flex-col gap-3 max-w-[520px]">
                  <label className={modifyFormLabelClass}>
                    Name
                    <input
                      className={modifyFormInputClass}
                      value={selectedColumn.name}
                      disabled={busy}
                      onChange={(event) => updateColumn({ name: event.target.value })}
                    />
                  </label>
                  <label className={modifyFormLabelClass}>
                    Comment
                    <textarea
                      rows={3}
                      className={modifyFormTextareaClass}
                      value={selectedColumn.comment}
                      disabled={busy}
                      onChange={(event) =>
                        updateColumn({ comment: event.target.value })
                      }
                    />
                  </label>
                  <label className={modifyFormLabelClass}>
                    Data Type
                    <input
                      list="hyperstudio-column-types"
                      className={modifyFormInputClass}
                      value={selectedColumn.dataType}
                      disabled={busy}
                      onChange={(event) =>
                        updateColumn({ dataType: event.target.value })
                      }
                    />
                    <datalist id="hyperstudio-column-types">
                      {COMMON_DATA_TYPES.map((type) => (
                        <option key={type} value={type} />
                      ))}
                    </datalist>
                  </label>
                  <div className="flex flex-wrap gap-3.5">
                    <label className={modifyCheckboxRowClass}>
                      <input
                        type="checkbox"
                        className={modifyCheckboxInputClass}
                        checked={!selectedColumn.nullable}
                        disabled={busy}
                        onChange={(event) =>
                          updateColumn({ nullable: !event.target.checked })
                        }
                      />
                      <span>Not Null</span>
                    </label>
                    {isMysql && (
                      <label className={modifyCheckboxRowClass}>
                        <input
                          type="checkbox"
                          className={modifyCheckboxInputClass}
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
                  <label className={modifyFormLabelClass}>
                    Default Expression
                    <input
                      className={modifyFormInputClass}
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
                      <label className={modifyFormLabelClass}>
                        On Update
                        <input
                          className={modifyFormInputClass}
                          value={selectedColumn.onUpdate}
                          disabled={busy}
                          placeholder="e.g. CURRENT_TIMESTAMP"
                          onChange={(event) =>
                            updateColumn({ onUpdate: event.target.value })
                          }
                        />
                      </label>
                      <label className={modifyFormLabelClass}>
                        Collation
                        <input
                          className={modifyFormInputClass}
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
                <div className="flex items-center gap-2 mb-3.5 text-text-bright text-[13px]">
                  <KeyRound size={15} />
                  <strong>{selectedKey.name || "Key"}</strong>
                </div>
                <div className="flex flex-col gap-3 max-w-[520px]">
                  <label className={modifyFormLabelClass}>
                    Name
                    <input
                      className={modifyFormInputClass}
                      value={selectedKey.name}
                      disabled={busy}
                      onChange={(event) => updateKey({ name: event.target.value })}
                    />
                  </label>
                  <label className={modifyFormLabelClass}>
                    Kind
                    <select
                      className={modifyFormInputClass}
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
                <div className="flex items-center gap-2 mb-3.5 text-text-bright text-[13px]">
                  <ListTree size={15} />
                  <strong>{selectedIndex.name || "Index"}</strong>
                </div>
                <div className="flex flex-col gap-3 max-w-[520px]">
                  <label className={modifyFormLabelClass}>
                    Name
                    <input
                      className={modifyFormInputClass}
                      value={selectedIndex.name}
                      disabled={busy}
                      onChange={(event) =>
                        updateIndex({ name: event.target.value })
                      }
                    />
                  </label>
                  <label className={modifyFormLabelClass}>
                    Method
                    <select
                      className={modifyFormInputClass}
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
                  <label className={modifyCheckboxRowClass}>
                    <input
                      type="checkbox"
                      className={modifyCheckboxInputClass}
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
              <div className="m-auto text-muted text-xs">
                {metadataLoading
                  ? "Loading table structure…"
                  : "Select a column, key, or index"}
              </div>
            )}
          </section>
        </div>

        <div className="border-t border-border bg-grid-row">
          <button
            type="button"
            className="w-full h-7 flex items-center gap-1.5 px-3 border-0 bg-transparent text-muted text-[11px] cursor-pointer hover:text-text"
            onClick={() => setPreviewOpen((open) => !open)}
          >
            {previewOpen ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
            Preview
          </button>
          {previewOpen && (
            <pre className="m-0 px-3.5 pb-3 max-h-[140px] overflow-auto text-text font-mono text-[11px] leading-[1.55] whitespace-pre-wrap">
              {previewSql || "-- No changes"}
            </pre>
          )}
        </div>

        {(error || metadataError) && (
          <p className="mx-3.5 mb-0 mt-2.5 text-danger text-[11px] [overflow-wrap:anywhere]">
            {error || metadataError}
          </p>
        )}

        <div className="m-0 px-3.5 py-3 border-t border-border flex items-center justify-between gap-2">
          <div />
          <div className="flex gap-[7px]">
            <button
              type="button"
              className="h-[31px] px-[11px] rounded-[5px] text-[10px] font-semibold cursor-pointer border-0 text-muted bg-transparent hover:text-white hover:bg-panel-soft disabled:opacity-40 disabled:cursor-default"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="h-[31px] px-[11px] rounded-[5px] text-[10px] font-semibold cursor-pointer border border-accent text-white bg-accent hover:bg-accent-bright disabled:opacity-40 disabled:cursor-default"
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
    <fieldset className="m-0 p-2.5 px-[11px] border border-border rounded-md bg-surface-deep flex flex-col gap-1 max-h-[180px] overflow-auto">
      <legend className="px-1 text-muted text-[10px] font-[540]">
        Columns
      </legend>
      {columns.map((column) => (
        <label
          key={column}
          className="flex flex-row items-center gap-2 py-[3px] px-0.5 rounded text-muted text-[11px] font-normal cursor-pointer hover:bg-panel-soft"
        >
          <input
            type="checkbox"
            className={modifyCheckboxInputClass}
            checked={selected.includes(column)}
            onChange={() => onToggle(column)}
          />
          <span>{column}</span>
        </label>
      ))}
    </fieldset>
  );
}
