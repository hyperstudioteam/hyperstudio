import { FormEvent, useState } from "react";
import { Star, X } from "lucide-react";

interface SaveQueryModalProps {
  defaultName: string;
  onSave: (name: string) => void;
  onClose: () => void;
}

const formLabelClass =
  "flex flex-col gap-[5px] text-[#9199a7] text-[10px] font-[540]";
const formInputClass =
  "w-full h-[34px] px-[9px] border border-border-bright rounded-[5px] text-[#d2d7df] bg-surface-input text-[11px] focus:border-accent placeholder:text-[#4e5663]";

export function SaveQueryModal({
  defaultName,
  onSave,
  onClose,
}: SaveQueryModalProps) {
  const [name, setName] = useState(defaultName);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed);
  }

  return (
    <div
      className="fixed inset-0 z-20 grid place-items-center p-5 bg-[rgba(5,7,10,.72)] backdrop-blur-[4px]"
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
            <span className="w-7 h-7 shrink-0 rounded-md grid place-items-center text-accent bg-accent-soft">
              <Star size={17} />
            </span>
            <h2 className="m-0 text-text-bright text-sm font-[630]">
              Save query
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
        <label className={formLabelClass}>
          Name
          <input
            required
            autoFocus
            className={formInputClass}
            value={name}
            placeholder="My query"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
            }}
          />
        </label>
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
              disabled={!name.trim()}
              className="h-[31px] px-[11px] rounded-[5px] text-[10px] font-semibold cursor-pointer border border-[#7667e7] text-white bg-[#6959da] hover:bg-[#7767e7] disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
