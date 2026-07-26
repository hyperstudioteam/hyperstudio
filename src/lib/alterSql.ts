import { ConnectionProfile } from "../types/connection";
import {
  ColumnNode,
  TableColumnChange,
  TableIndexChange,
  TableKeyChange,
} from "../types/schema";
import { qualifyTable, quoteIdent, sqlLiteral } from "./sql";

export type DraftColumn = {
  id: string;
  /** Original name when loaded from DB; empty for newly added columns. */
  originalName: string | null;
  name: string;
  dataType: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue: string;
  comment: string;
  autoIncrement: boolean;
  onUpdate: string;
  collation: string;
  kind: "NORMAL" | "PRIMARY";
  removed?: boolean;
};

export function columnToDraft(column: ColumnNode, id: string): DraftColumn {
  return {
    id,
    originalName: column.name,
    name: column.name,
    dataType: column.dataType,
    nullable: column.nullable,
    primaryKey: Boolean(column.primaryKey),
    defaultValue: column.defaultValue ?? "",
    comment: column.comment ?? "",
    autoIncrement: Boolean(column.autoIncrement),
    onUpdate: "",
    collation: "",
    kind: column.primaryKey ? "PRIMARY" : "NORMAL",
  };
}

export function blankDraftColumn(id: string): DraftColumn {
  return {
    id,
    originalName: null,
    name: "new_column",
    dataType: "varchar(255)",
    nullable: true,
    primaryKey: false,
    defaultValue: "",
    comment: "",
    autoIncrement: false,
    onUpdate: "",
    collation: "",
    kind: "NORMAL",
  };
}

function sameDefault(a: string, b: string | null | undefined) {
  return (a || "") === (b || "");
}

export function diffColumns(
  original: ColumnNode[],
  drafts: DraftColumn[],
): TableColumnChange[] {
  const changes: TableColumnChange[] = [];
  const byOriginal = new Map(original.map((column) => [column.name, column]));
  const keptOriginals = new Set<string>();

  for (const draft of drafts) {
    if (draft.removed) {
      if (draft.originalName) {
        changes.push({ action: "drop", name: draft.originalName });
      }
      continue;
    }

    if (!draft.originalName) {
      changes.push({
        action: "add",
        name: draft.name.trim(),
        newName: draft.name.trim(),
        dataType: draft.dataType.trim(),
        nullable: draft.nullable,
        defaultValue: draft.defaultValue.trim() || null,
        clearDefault: false,
        comment: draft.comment,
        autoIncrement: draft.autoIncrement,
        onUpdate: draft.onUpdate.trim() || null,
        collation: draft.collation.trim() || null,
      });
      continue;
    }

    keptOriginals.add(draft.originalName);
    const base = byOriginal.get(draft.originalName);
    if (!base) continue;

    const renamed = draft.name.trim() !== draft.originalName;
    const typeChanged = draft.dataType.trim() !== base.dataType;
    const nullChanged = draft.nullable !== base.nullable;
    const defaultChanged = !sameDefault(draft.defaultValue, base.defaultValue);
    const commentChanged = (draft.comment || "") !== (base.comment || "");
    const autoChanged = draft.autoIncrement !== Boolean(base.autoIncrement);
    const onUpdateChanged = Boolean(draft.onUpdate.trim());
    const collationChanged = Boolean(draft.collation.trim());

    if (
      !renamed &&
      !typeChanged &&
      !nullChanged &&
      !defaultChanged &&
      !commentChanged &&
      !autoChanged &&
      !onUpdateChanged &&
      !collationChanged
    ) {
      continue;
    }

    changes.push({
      action: "modify",
      name: draft.originalName,
      newName: renamed ? draft.name.trim() : null,
      dataType: draft.dataType.trim(),
      nullable: draft.nullable,
      defaultValue: draft.defaultValue.trim() || null,
      clearDefault: !draft.defaultValue.trim() && Boolean(base.defaultValue),
      comment: draft.comment,
      autoIncrement: draft.autoIncrement,
      onUpdate: draft.onUpdate.trim() || null,
      collation: draft.collation.trim() || null,
    });
  }

  for (const column of original) {
    if (!keptOriginals.has(column.name)) {
      // Already handled via removed drafts; skip if still present.
      const stillPresent = drafts.some(
        (draft) => !draft.removed && draft.originalName === column.name,
      );
      if (!stillPresent && !changes.some((c) => c.action === "drop" && c.name === column.name)) {
        changes.push({ action: "drop", name: column.name });
      }
    }
  }

  return changes;
}

function mysqlColumnDef(change: TableColumnChange, fallbackType = "varchar(255)"): string {
  const dataType = (change.dataType || fallbackType).trim();
  const parts = [dataType];
  if (change.collation?.trim()) parts.push(`COLLATE ${change.collation.trim()}`);
  if (change.nullable === false) parts.push("NOT NULL");
  else if (change.nullable === true) parts.push("NULL");
  if (change.clearDefault) {
    // no default
  } else if (change.defaultValue?.trim()) {
    parts.push(`DEFAULT ${change.defaultValue.trim()}`);
  }
  if (change.onUpdate?.trim()) parts.push(`ON UPDATE ${change.onUpdate.trim()}`);
  if (change.autoIncrement) parts.push("AUTO_INCREMENT");
  if (change.comment != null) parts.push(`COMMENT ${sqlLiteral(change.comment)}`);
  return parts.join(" ");
}

/** Live SQL preview for the Modify dialog. */
export function buildAlterTablePreview(options: {
  driver: ConnectionProfile["driver"];
  schema: string;
  table: string;
  newName?: string | null;
  changes: TableColumnChange[];
  keyChanges?: TableKeyChange[];
  indexChanges?: TableIndexChange[];
}): string {
  const {
    driver,
    schema,
    table,
    newName,
    changes,
    keyChanges = [],
    indexChanges = [],
  } = options;
  const lines: string[] = [];
  const target = qualifyTable(driver, schema, table);

  if (driver === "mysql") {
    for (const change of changes) {
      if (change.action === "drop") {
        lines.push(
          `alter table ${target}\n  drop column ${quoteIdent(driver, change.name)};`,
        );
      } else if (change.action === "add") {
        const name = change.newName || change.name;
        lines.push(
          `alter table ${target}\n  add column ${quoteIdent(driver, name)} ${mysqlColumnDef(change)};`,
        );
      } else if (change.action === "modify") {
        const name = change.newName || change.name;
        // Preview uses MODIFY when name unchanged, CHANGE when renamed.
        if (change.newName && change.newName !== change.name) {
          lines.push(
            `alter table ${target}\n  change ${quoteIdent(driver, change.name)} ${quoteIdent(driver, name)} ${mysqlColumnDef(change)};`,
          );
        } else {
          lines.push(
            `alter table ${target}\n  modify ${quoteIdent(driver, change.name)} ${mysqlColumnDef(change)};`,
          );
        }
      }
    }
  } else {
    for (const change of changes) {
      if (change.action === "drop") {
        lines.push(
          `ALTER TABLE ${target}\n  DROP COLUMN ${quoteIdent(driver, change.name)};`,
        );
      } else if (change.action === "add") {
        const name = change.newName || change.name;
        let sql = `ALTER TABLE ${target}\n  ADD COLUMN ${quoteIdent(driver, name)} ${(change.dataType || "text").trim()}`;
        if (change.nullable === false) sql += " NOT NULL";
        if (change.defaultValue?.trim()) sql += ` DEFAULT ${change.defaultValue.trim()}`;
        sql += ";";
        lines.push(sql);
        if (change.comment != null) {
          lines.push(
            `COMMENT ON COLUMN ${target}.${quoteIdent(driver, name)} IS ${sqlLiteral(change.comment)};`,
          );
        }
      } else if (change.action === "modify") {
        const stmts: string[] = [];
        let current = change.name;
        if (change.newName && change.newName !== change.name) {
          stmts.push(
            `ALTER TABLE ${target}\n  RENAME COLUMN ${quoteIdent(driver, change.name)} TO ${quoteIdent(driver, change.newName)};`,
          );
          current = change.newName;
        }
        if (change.dataType?.trim()) {
          stmts.push(
            `ALTER TABLE ${target}\n  ALTER COLUMN ${quoteIdent(driver, current)} TYPE ${change.dataType.trim()};`,
          );
        }
        if (change.nullable === true) {
          stmts.push(
            `ALTER TABLE ${target}\n  ALTER COLUMN ${quoteIdent(driver, current)} DROP NOT NULL;`,
          );
        } else if (change.nullable === false) {
          stmts.push(
            `ALTER TABLE ${target}\n  ALTER COLUMN ${quoteIdent(driver, current)} SET NOT NULL;`,
          );
        }
        if (change.clearDefault) {
          stmts.push(
            `ALTER TABLE ${target}\n  ALTER COLUMN ${quoteIdent(driver, current)} DROP DEFAULT;`,
          );
        } else if (change.defaultValue?.trim()) {
          stmts.push(
            `ALTER TABLE ${target}\n  ALTER COLUMN ${quoteIdent(driver, current)} SET DEFAULT ${change.defaultValue.trim()};`,
          );
        }
        if (change.comment != null) {
          stmts.push(
            `COMMENT ON COLUMN ${target}.${quoteIdent(driver, current)} IS ${sqlLiteral(change.comment)};`,
          );
        }
        lines.push(...stmts);
      }
    }
  }

  for (const change of keyChanges) {
    const columns = change.columns
      .map((column) => quoteIdent(driver, column))
      .join(", ");
    if (driver === "mysql") {
      if (change.action === "drop" || change.action === "modify") {
        lines.push(
          change.kind.toUpperCase().includes("PRIMARY")
            ? `ALTER TABLE ${target}\n  DROP PRIMARY KEY;`
            : `ALTER TABLE ${target}\n  DROP INDEX ${quoteIdent(driver, change.name || "")};`,
        );
      }
      if (change.action === "add" || change.action === "modify") {
        const name = change.newName || change.name;
        lines.push(
          change.kind.toUpperCase().includes("PRIMARY")
            ? `ALTER TABLE ${target}\n  ADD PRIMARY KEY (${columns});`
            : `ALTER TABLE ${target}\n  ADD UNIQUE ${name ? quoteIdent(driver, name) + " " : ""}(${columns});`,
        );
      }
    } else {
      if (change.action === "drop" || change.action === "modify") {
        lines.push(
          `ALTER TABLE ${target}\n  DROP CONSTRAINT ${quoteIdent(driver, change.name || "")};`,
        );
      }
      if (change.action === "add" || change.action === "modify") {
        const name = change.newName || change.name;
        lines.push(
          `ALTER TABLE ${target}\n  ADD${name ? ` CONSTRAINT ${quoteIdent(driver, name)}` : ""} ${change.kind} (${columns});`,
        );
      }
    }
  }

  for (const change of indexChanges) {
    const columns = change.columns
      .map((column) => quoteIdent(driver, column))
      .join(", ");
    const name = change.newName || change.name || "";
    const unique = change.unique ? "UNIQUE " : "";
    const method = change.method?.trim() || (driver === "mysql" ? "BTREE" : "btree");
    if (driver === "mysql") {
      if (change.action === "drop" || change.action === "modify") {
        lines.push(
          `ALTER TABLE ${target}\n  DROP INDEX ${quoteIdent(driver, change.name || "")};`,
        );
      }
      if (change.action === "add" || change.action === "modify") {
        const definition =
          method === "FULLTEXT" || method === "SPATIAL"
            ? `${method} INDEX ${quoteIdent(driver, name)} (${columns})`
            : `${unique}INDEX ${quoteIdent(driver, name)} USING ${method} (${columns})`;
        lines.push(
          `ALTER TABLE ${target}\n  ADD ${definition};`,
        );
      }
    } else {
      if (change.action === "drop" || change.action === "modify") {
        lines.push(
          `DROP INDEX ${quoteIdent(driver, schema)}.${quoteIdent(driver, change.name || "")};`,
        );
      }
      if (change.action === "add" || change.action === "modify") {
        lines.push(
          `CREATE ${unique}INDEX ${quoteIdent(driver, name)} ON ${target} USING ${method} (${columns});`,
        );
      }
    }
  }

  if (newName?.trim() && newName.trim() !== table) {
    lines.push(
      driver === "mysql"
        ? `rename table ${target} to ${qualifyTable(driver, schema, newName.trim())};`
        : `ALTER TABLE ${target}\n  RENAME TO ${quoteIdent(driver, newName.trim())};`,
    );
  }

  return lines.join("\n\n");
}

export const COMMON_DATA_TYPES = [
  "int",
  "bigint",
  "smallint",
  "tinyint",
  "varchar(255)",
  "varchar(20)",
  "char(1)",
  "text",
  "longtext",
  "boolean",
  "bool",
  "decimal(10,2)",
  "float",
  "double",
  "date",
  "datetime",
  "timestamp",
  "time",
  "json",
  "uuid",
  "bytea",
  "blob",
];
