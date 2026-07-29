import { useMemo, useState } from "react";
import { LoaderCircle, RefreshCw, Search, Zap } from "lucide-react";
import { cn } from "../../lib/cn";
import { syncActiveDatabase } from "../../lib/databases";
import { ConnectionProfile } from "../../types/connection";
import { SchemaInfo } from "../../types/schema";

interface DatabasesTabProps {
  profile: ConnectionProfile;
  availableDatabases: SchemaInfo[];
  loading: boolean;
  onChange: (patch: Partial<ConnectionProfile>) => void;
  onRefresh: () => void;
}

export function DatabasesTab({
  profile,
  availableDatabases,
  loading,
  onChange,
  onRefresh,
}: DatabasesTabProps) {
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return availableDatabases;
    return availableDatabases.filter((database) =>
      database.name.toLowerCase().includes(query),
    );
  }, [availableDatabases, filter]);

  const selected = new Set(profile.databases);
  const allChecked = profile.allDatabases;

  function apply(patch: Partial<ConnectionProfile>) {
    const next = { ...profile, ...patch };
    onChange({ ...patch, ...syncActiveDatabase(next) });
  }

  function toggleAll(checked: boolean) {
    apply({
      allDatabases: checked,
      databases: checked ? [] : [...profile.databases],
    });
  }

  function toggleDatabase(name: string) {
    if (allChecked) {
      apply({
        allDatabases: false,
        databases: [name],
        database: name,
      });
      return;
    }

    const next = selected.has(name)
      ? profile.databases.filter((database) => database !== name)
      : [...profile.databases, name];

    apply({
      allDatabases: false,
      databases: next,
      ...(next.includes(profile.database)
        ? {}
        : next[0]
          ? { database: next[0] }
          : {}),
    });
  }

  return (
    <div className="min-h-[280px] flex flex-col gap-2.5">
      <p className="m-0 text-subtle text-[10px] leading-[1.45]">
        Select which databases this connection can switch between. The active
        database on the General tab is used when connecting.
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="w-7 h-7 grid place-items-center p-0 border-0 rounded-[5px] text-muted bg-transparent cursor-pointer enabled:hover:text-text enabled:hover:bg-panel-soft disabled:cursor-default disabled:opacity-40"
          aria-label="Refresh databases"
          disabled={loading}
          onClick={onRefresh}
          title="Refresh databases (requires valid credentials)"
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
            placeholder="Filter databases"
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>
      </div>

      {loading && availableDatabases.length === 0 ? (
        <div className="flex-1 min-h-[180px] flex items-center justify-center gap-2 p-5 text-subtle text-center text-[11px] leading-normal border border-dashed border-border-bright rounded-md">
          <LoaderCircle className="animate-spin-slow" size={16} />
          Loading databases…
        </div>
      ) : availableDatabases.length === 0 ? (
        <div className="flex-1 min-h-[180px] flex items-center justify-center gap-2 p-5 text-subtle text-center text-[11px] leading-normal border border-dashed border-border-bright rounded-md">
          Test the connection to load available databases, or leave “All
          databases” enabled to browse every accessible database.
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
            <span>All databases</span>
          </label>
          <div className="h-px my-0.5 bg-border" />
          {filtered.map((database) => (
            <label
              key={database.name}
              className="min-h-[30px] px-2.5 flex items-center gap-2 text-text text-[11px] cursor-pointer hover:bg-panel-soft"
            >
              <input
                type="checkbox"
                className="w-3.5 h-3.5 accent-blue cursor-pointer"
                checked={allChecked || selected.has(database.name)}
                ref={(element) => {
                  if (element) element.indeterminate = allChecked;
                }}
                onChange={() => toggleDatabase(database.name)}
              />
              <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                {database.name}
              </span>
              {database.name === profile.database && (
                <span className="text-[9px] text-accent shrink-0">active</span>
              )}
              {database.isSystem && (
                <Zap
                  size={12}
                  className="text-muted shrink-0"
                  aria-label="System database"
                />
              )}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
