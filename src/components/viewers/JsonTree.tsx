import { useMemo, useState } from "react";

interface JsonTreeProps {
  value: unknown;
}

export function JsonTree({ value }: JsonTreeProps) {
  return (
    <div className="json-tree">
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
      <div className="json-row" style={{ paddingLeft: depth * 14 }}>
        {name !== null && <span className="json-key">{name}:</span>}
        <span className={`json-scalar ${scalarClass(value)}`}>
          {scalarText(value)}
        </span>
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const summary = isArray ? `[${entries.length}]` : `{${entries.length}}`;

  return (
    <div className="json-branch">
      <div
        className="json-row json-toggle"
        style={{ paddingLeft: depth * 14 }}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="json-caret">{open ? "▾" : "▸"}</span>
        {name !== null && <span className="json-key">{name}:</span>}
        <span className="json-summary">{summary}</span>
      </div>
      {open &&
        entries.map(([key, child]) => (
          <JsonNode key={key} name={key} value={child} depth={depth + 1} />
        ))}
    </div>
  );
}

function scalarClass(value: unknown): string {
  if (value === null) return "json-null";
  if (typeof value === "number") return "json-number";
  if (typeof value === "boolean") return "json-bool";
  return "json-string";
}

function scalarText(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return `"${value}"`;
  return String(value);
}
