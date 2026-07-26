import { FormEvent, useState } from "react";
import { Columns3, X } from "lucide-react";
import { ColumnNode } from "../../types/schema";

interface EditColumnModalProps {
  schema: string;
  table: string;
  column: ColumnNode;
  /** When false, hide default controls (e.g. Typesense). */
  supportsDefault?: boolean;
  busy?: boolean;
  error?: string | null;
  onSave: (input: {
    newName: string;
    dataType: string;
    nullable: boolean;
    defaultValue: string;
    clearDefault: boolean;
  }) => void;
  onClose: () => void;
}

export function EditColumnModal({
  schema,
  table,
  column,
  supportsDefault = true,
  busy,
  error,
  onSave,
  onClose,
}: EditColumnModalProps) {
  const [name, setName] = useState(column.name);
  const [dataType, setDataType] = useState(column.dataType);
  const [nullable, setNullable] = useState(column.nullable);
  const [defaultValue, setDefaultValue] = useState(column.defaultValue ?? "");
  const [clearDefault, setClearDefault] = useState(false);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !dataType.trim() || busy) return;
    onSave({
      newName: name.trim(),
      dataType: dataType.trim(),
      nullable,
      defaultValue: defaultValue.trim(),
      clearDefault,
    });
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) =>
        event.target === event.currentTarget && !busy && onClose()
      }
    >
      <form className="connection-modal folder-modal" onSubmit={handleSubmit}>
        <div className="modal-heading">
          <div>
            <span className="folder-icon large">
              <Columns3 size={17} />
            </span>
            <h2>Edit column</h2>
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
        <p className="modal-subtitle">
          {schema}.{table}.{column.name}
        </p>
        <div className="form-grid">
          <label className="full">
            Name
            <input
              required
              autoFocus
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="full">
            Type
            <input
              required
              value={dataType}
              disabled={busy}
              onChange={(event) => setDataType(event.target.value)}
            />
          </label>
          <label className="full checkbox-row">
            <input
              type="checkbox"
              checked={nullable}
              disabled={busy}
              onChange={(event) => setNullable(event.target.checked)}
            />
            <span>Nullable</span>
          </label>
          {supportsDefault && (
            <>
              <label className="full">
                Default
                <input
                  value={defaultValue}
                  disabled={busy || clearDefault}
                  placeholder="e.g. CURRENT_TIMESTAMP or 'value'"
                  onChange={(event) => setDefaultValue(event.target.value)}
                />
              </label>
              <label className="full checkbox-row">
                <input
                  type="checkbox"
                  checked={clearDefault}
                  disabled={busy}
                  onChange={(event) => setClearDefault(event.target.checked)}
                />
                <span>Drop default</span>
              </label>
            </>
          )}
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
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
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
