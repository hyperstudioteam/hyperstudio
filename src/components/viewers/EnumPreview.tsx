import { cn } from "../../lib/cn";

interface EnumPreviewProps {
  value: unknown;
  labels: string[];
}

export function EnumPreview({ value, labels }: EnumPreviewProps) {
  const current =
    value === null || value === undefined ? null : String(value);
  const known = current !== null && labels.includes(current);

  if (labels.length === 0 && current === null) {
    return (
      <div className="p-5 text-center text-[12px] text-muted">NULL</div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      {current === null ? (
        <div className="rounded-[6px] border border-dashed border-border px-3 py-2 text-[12px] italic text-muted">
          NULL
        </div>
      ) : !known ? (
        <div className="rounded-[6px] border border-border bg-surface-deep px-3 py-2 font-mono text-[12px] text-text">
          {current}
          <span className="ml-2 text-[11px] text-subtle">(not in enum)</span>
        </div>
      ) : null}
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {labels.map((label) => {
          const selected = label === current;
          return (
            <li
              key={label}
              className={cn(
                "rounded-[5px] px-2.5 py-1.5 font-mono text-[12px] text-text",
                selected &&
                  "bg-pk/15 text-pk ring-1 ring-pk/35",
              )}
            >
              {label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
