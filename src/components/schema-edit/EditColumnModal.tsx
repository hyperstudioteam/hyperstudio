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

const formLabelClass =
  "flex flex-col gap-[5px] text-muted text-[10px] font-[540]";
const formInputClass =
  "w-full h-[34px] px-[9px] border border-border-bright rounded-[5px] text-text bg-surface-input text-[11px] focus:border-accent placeholder:text-subtle";
const checkboxRowClass =
  "flex flex-row items-center gap-2 text-muted text-[11px] font-normal cursor-pointer col-span-full";
const checkboxInputClass =
  "w-3.5 h-3.5 m-0 p-0 border-0 rounded-none bg-transparent shrink-0 accent-accent cursor-pointer";

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
      className="fixed inset-0 z-20 grid place-items-center p-5 bg-black/70 backdrop-blur-[4px]"
      onMouseDown={(event) =>
        event.target === event.currentTarget && !busy && onClose()
      }
    >
      <form
        className="w-[min(420px,100%)] max-h-full overflow-auto p-[18px] border border-border-bright rounded-[10px] bg-surface shadow-[0_24px_70px_rgba(0,0,0,.48)]"
        onSubmit={handleSubmit}
      >
        <div className="flex items-center justify-between mb-[17px]">
          <div className="flex items-center gap-2.5">
            <span className="w-7 h-7 shrink-0 rounded-md grid place-items-center text-folder bg-folder/15">
              <Columns3 size={17} />
            </span>
            <h2 className="m-0 text-text-bright text-sm font-[630]">
              Edit column
            </h2>
          </div>
          <button
            type="button"
            className="w-7 h-7 grid place-items-center p-0 border-0 rounded-[5px] text-muted bg-transparent cursor-pointer enabled:hover:text-text enabled:hover:bg-panel-soft disabled:cursor-default disabled:opacity-40"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
        <p className="-mt-2 mb-3.5 text-muted text-[11px]">
          {schema}.{table}.{column.name}
        </p>
        <div className="grid grid-cols-[1fr_120px] gap-3">
          <label className={`${formLabelClass} col-span-full`}>
            Name
            <input
              required
              autoFocus
              className={formInputClass}
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className={`${formLabelClass} col-span-full`}>
            Type
            <input
              required
              className={formInputClass}
              value={dataType}
              disabled={busy}
              onChange={(event) => setDataType(event.target.value)}
            />
          </label>
          <label className={checkboxRowClass}>
            <input
              type="checkbox"
              className={checkboxInputClass}
              checked={nullable}
              disabled={busy}
              onChange={(event) => setNullable(event.target.checked)}
            />
            <span>Nullable</span>
          </label>
          {supportsDefault && (
            <>
              <label className={`${formLabelClass} col-span-full`}>
                Default
                <input
                  className={formInputClass}
                  value={defaultValue}
                  disabled={busy || clearDefault}
                  placeholder="e.g. CURRENT_TIMESTAMP or 'value'"
                  onChange={(event) => setDefaultValue(event.target.value)}
                />
              </label>
              <label className={checkboxRowClass}>
                <input
                  type="checkbox"
                  className={checkboxInputClass}
                  checked={clearDefault}
                  disabled={busy}
                  onChange={(event) => setClearDefault(event.target.checked)}
                />
                <span>Drop default</span>
              </label>
            </>
          )}
        </div>
        {error && (
          <p className="mt-2.5 mb-0 text-danger text-[11px] [overflow-wrap:anywhere]">
            {error}
          </p>
        )}
        <div className="mt-[18px] pt-3.5 border-t border-border flex items-center justify-between gap-2">
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
              disabled={busy}
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
