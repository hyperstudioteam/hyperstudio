import { useMemo, useState } from "react";
import { LoaderCircle, RefreshCw, Search, Zap } from "lucide-react";
import { cn } from "../../lib/cn";
import { ConnectionProfile } from "../../types/connection";
import { SchemaInfo } from "../../types/schema";

interface SchemasTabProps {
  profile: ConnectionProfile;
  availableSchemas: SchemaInfo[];
  loading: boolean;
  onChange: (patch: Partial<ConnectionProfile>) => void;
  onRefresh: () => void;
}

export function SchemasTab({
  profile,
  availableSchemas,
  loading,
  onChange,
  onRefresh,
}: SchemasTabProps) {
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return availableSchemas;
    return availableSchemas.filter((schema) =>
      schema.name.toLowerCase().includes(query),
    );
  }, [availableSchemas, filter]);

  const selected = new Set(profile.schemas);
  const allChecked = profile.allSchemas;

  function toggleAll(checked: boolean) {
    onChange({
      allSchemas: checked,
      schemas: checked ? [] : [...profile.schemas],
    });
  }

  function toggleSchema(name: string) {
    if (allChecked) {
      onChange({
        allSchemas: false,
        schemas: [name],
      });
      return;
    }

    const next = selected.has(name)
      ? profile.schemas.filter((schema) => schema !== name)
      : [...profile.schemas, name];

    onChange({
      allSchemas: false,
      schemas: next,
    });
  }

  return (
    <div className="min-h-[280px] flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="w-7 h-7 grid place-items-center p-0 border-0 rounded-[5px] text-muted bg-transparent cursor-pointer enabled:hover:text-text enabled:hover:bg-panel-soft disabled:cursor-default disabled:opacity-40"
          aria-label="Refresh schemas"
          disabled={loading}
          onClick={onRefresh}
          title="Refresh schemas (requires valid credentials)"
        >
          <RefreshCw
            size={14}
            className={cn(loading && "animate-spin-slow")}
          />
        </button>
        <div className="flex-1 h-[30px] flex items-center gap-[7px] px-[9px] border border-border-bright rounded-[5px] text-subtle bg-surface-input">
          <Search size={13} />
          <input
            className="flex-1 min-w-0 border-0 outline-0 text-text bg-transparent text-[11px]"
            value={filter}
            placeholder="Filter schemas"
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>
      </div>

      {loading && availableSchemas.length === 0 ? (
        <div className="flex-1 min-h-[180px] flex items-center justify-center gap-2 p-5 text-subtle text-center text-[11px] leading-normal border border-dashed border-border-bright rounded-md">
          <LoaderCircle className="animate-spin-slow" size={16} />
          Loading schemas…
        </div>
      ) : availableSchemas.length === 0 ? (
        <div className="flex-1 min-h-[180px] flex items-center justify-center gap-2 p-5 text-subtle text-center text-[11px] leading-normal border border-dashed border-border-bright rounded-md">
          Test the connection to load available schemas, or leave “All schemas”
          enabled to fetch the default set.
        </div>
      ) : (
        <div className="flex-1 max-h-80 overflow-auto border border-border rounded-md bg-surface-deep scrollbar-thin-app">
          <label className="min-h-[30px] px-2.5 flex items-center gap-2 text-text text-[11px] font-[560] cursor-pointer hover:bg-panel-soft">
            <input
              type="checkbox"
              className="w-3.5 h-3.5 accent-blue cursor-pointer"
              checked={allChecked}
              onChange={(event) => toggleAll(event.target.checked)}
            />
            <span>All schemas</span>
          </label>
          <div className="h-px my-0.5 bg-border" />
          {filtered.map((schema) => (
            <label
              key={schema.name}
              className="min-h-[30px] px-2.5 flex items-center gap-2 text-text text-[11px] cursor-pointer hover:bg-panel-soft"
            >
              <input
                type="checkbox"
                className="w-3.5 h-3.5 accent-blue cursor-pointer"
                checked={allChecked || selected.has(schema.name)}
                ref={(element) => {
                  if (element) element.indeterminate = allChecked;
                }}
                onChange={() => toggleSchema(schema.name)}
              />
              <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                {schema.name}
              </span>
              {schema.isSystem && (
                <Zap
                  size={12}
                  className="text-muted shrink-0"
                  aria-label="System schema"
                />
              )}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
