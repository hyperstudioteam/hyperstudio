import { useMemo, useState } from "react";
import { LoaderCircle, RefreshCw, Search, Zap } from "lucide-react";
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
    <div className="schemas-tab">
      <div className="schemas-toolbar">
        <button
          type="button"
          className="icon-button"
          aria-label="Refresh schemas"
          disabled={loading}
          onClick={onRefresh}
          title="Refresh schemas (requires valid credentials)"
        >
          <RefreshCw size={14} className={loading ? "spin" : ""} />
        </button>
        <div className="schemas-search">
          <Search size={13} />
          <input
            value={filter}
            placeholder="Filter schemas"
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>
      </div>

      {loading && availableSchemas.length === 0 ? (
        <div className="schemas-empty">
          <LoaderCircle className="spin" size={16} />
          Loading schemas…
        </div>
      ) : availableSchemas.length === 0 ? (
        <div className="schemas-empty">
          Test the connection to load available schemas, or leave “All schemas”
          enabled to fetch the default set.
        </div>
      ) : (
        <div className="schemas-list">
          <label className="schema-row master">
            <input
              type="checkbox"
              checked={allChecked}
              onChange={(event) => toggleAll(event.target.checked)}
            />
            <span>All schemas</span>
          </label>
          <div className="schemas-separator" />
          {filtered.map((schema) => (
            <label key={schema.name} className="schema-row">
              <input
                type="checkbox"
                checked={allChecked || selected.has(schema.name)}
                ref={(element) => {
                  if (element) element.indeterminate = allChecked;
                }}
                onChange={() => toggleSchema(schema.name)}
              />
              <span className="schema-name">{schema.name}</span>
              {schema.isSystem && (
                <Zap
                  size={12}
                  className="system-schema"
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
