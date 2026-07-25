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
      className="modal-backdrop"
      onMouseDown={(event) =>
        event.target === event.currentTarget && onClose()
      }
    >
      <form className="connection-modal folder-modal" onSubmit={handleSubmit}>
        <div className="modal-heading">
          <div>
            <span className="folder-icon large">
              <Folder size={17} />
            </span>
            <h2>{initial?.id ? "Rename folder" : "New folder"}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
        <div className="form-grid">
          <label className="full">
            Folder name
            <input
              required
              autoFocus
              value={name}
              placeholder="Production"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="full">
            Parent folder
            <select
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
        <div className="modal-actions">
          <div />
          <div>
            <button type="button" className="ghost-button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-button">
              Save folder
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
