import { useMemo, useState } from "react";

interface JsonTreeProps {
  value: unknown;
}

export function JsonTree({ value }: JsonTreeProps) {
  return (
    <div className="font-mono text-[12px] leading-normal text-text">
      <JsonNode name={null} value={value} depth={0} defaultOpen />
    </div>
  );
}

interface JsonNodeProps {
  name: string | null;
  value: unknown;
  depth: number;
  defaultOpen?: boolean;
}

function JsonNode({ name, value, depth, defaultOpen }: JsonNodeProps) {
  const [open, setOpen] = useState(defaultOpen ?? depth < 2);
  const isObject = value !== null && typeof value === "object";
  const entries = useMemo(() => {
    if (!isObject) return [];
    if (Array.isArray(value)) {
      return value.map((item, index) => [String(index), item] as const);
    }
    return Object.entries(value as Record<string, unknown>);
  }, [isObject, value]);

  if (!isObject) {
    return (
      <div
        className="flex items-baseline gap-1.5 whitespace-pre-wrap"
        style={{ paddingLeft: depth * 14 }}
      >
        {name !== null && (
          <span className="text-accent-bright">{name}:</span>
        )}
        <span className={scalarClass(value)}>{scalarText(value)}</span>
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const summary = isArray ? `[${entries.length}]` : `{${entries.length}}`;

  return (
    <div>
      <div
        className="flex cursor-pointer items-baseline gap-1.5 whitespace-pre-wrap select-none hover:bg-panel-soft"
        style={{ paddingLeft: depth * 14 }}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="inline-block w-2.5 text-muted">{open ? "▾" : "▸"}</span>
        {name !== null && (
          <span className="text-accent-bright">{name}:</span>
        )}
        <span className="text-muted">{summary}</span>
      </div>
      {open &&
        entries.map(([key, child]) => (
          <JsonNode key={key} name={key} value={child} depth={depth + 1} />
        ))}
    </div>
  );
}

function scalarClass(value: unknown): string {
  if (value === null) return "text-subtle italic";
  if (typeof value === "number") return "text-warn";
  if (typeof value === "boolean") return "text-warn";
  return "text-green";
}

function scalarText(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return `"${value}"`;
  return String(value);
}
