import { FormEvent, useState } from "react";
import { Folder, X } from "lucide-react";

interface FolderModalProps {
  initial?: { id?: string; name: string; parentId: string | null };
  folderOptions: { id: string | null; label: string }[];
  onSave: (input: {
    id?: string;
    name: string;
    parentId: string | null;
  }) => void;
  onClose: () => void;
}

const formLabelClass =
  "flex flex-col gap-[5px] text-muted text-[10px] font-[540]";
const formInputClass =
  "w-full h-[34px] px-[9px] border border-border-bright rounded-[5px] text-text bg-surface-input text-[11px] focus:border-accent placeholder:text-subtle";

export function FolderModal({
  initial,
  folderOptions,
  onSave,
  onClose,
}: FolderModalProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [parentId, setParentId] = useState<string | null>(
    initial?.parentId ?? null,
  );

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    onSave({ id: initial?.id, name: name.trim(), parentId });
  }

  return (
    <div
      className="fixed inset-0 z-20 grid place-items-center p-5 bg-black/70 backdrop-blur-[4px]"
      onMouseDown={(event) =>
        event.target === event.currentTarget && onClose()
      }
    >
      <form
        className="w-[min(420px,100%)] max-h-full overflow-auto p-[18px] border border-border-bright rounded-[10px] bg-surface shadow-[0_24px_70px_rgba(0,0,0,.48)]"
        onSubmit={handleSubmit}
      >
        <div className="flex items-center justify-between mb-[17px]">
          <div className="flex items-center gap-2.5">
            <span className="w-7 h-7 shrink-0 rounded-md grid place-items-center text-folder bg-folder/15">
              <Folder size={17} />
            </span>
            <h2 className="m-0 text-text-bright text-sm font-[630]">
              {initial?.id ? "Rename folder" : "New folder"}
            </h2>
          </div>
          <button
            type="button"
            className="w-7 h-7 grid place-items-center p-0 border-0 rounded-[5px] text-muted bg-transparent cursor-pointer enabled:hover:text-text enabled:hover:bg-panel-soft disabled:cursor-default disabled:opacity-40"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
        <div className="grid grid-cols-[1fr_120px] gap-3">
          <label className={`${formLabelClass} col-span-full`}>
            Folder name
            <input
              required
              autoFocus
              className={formInputClass}
              value={name}
              placeholder="Production"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className={`${formLabelClass} col-span-full`}>
            Parent folder
            <select
              className={formInputClass}
              value={parentId ?? ""}
              onChange={(event) =>
                setParentId(
                  event.target.value === "" ? null : event.target.value,
                )
              }
            >
              {folderOptions.map((option) => (
                <option key={String(option.id)} value={option.id ?? ""}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-[18px] pt-3.5 border-t border-border flex items-center justify-between gap-2">
          <div />
          <div className="flex gap-[7px]">
            <button
              type="button"
              className="h-[31px] px-[11px] rounded-[5px] text-[10px] font-semibold cursor-pointer border-0 text-muted bg-transparent hover:text-white hover:bg-panel-soft"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="h-[31px] px-[11px] rounded-[5px] text-[10px] font-semibold cursor-pointer border border-accent text-white bg-accent hover:bg-accent-bright"
            >
              Save folder
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
