import { PlanNode } from "../../lib/explain";

interface PlanNodeDetailProps {
  node: PlanNode | null;
  analyzed: boolean;
}

function formatNum(n: number | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2 border-b border-grid-line py-1.5 last:border-0">
      <dt className="text-[10px] text-subtle">{label}</dt>
      <dd className="min-w-0 break-words font-mono text-[11px] text-text">
        {value}
      </dd>
    </div>
  );
}

export function PlanNodeDetail({ node, analyzed }: PlanNodeDetailProps) {
  if (!node) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-[11px] text-subtle">
        Select a plan node
      </div>
    );
  }

  const relation = node.relationName
    ? node.schema
      ? `${node.schema}.${node.relationName}`
      : node.relationName
    : null;

  return (
    <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
      <h3 className="mb-2 text-[12px] font-semibold text-text-bright">
        {node.nodeType}
      </h3>
      <dl>
        {relation && <Row label="Relation" value={relation} />}
        {node.alias && node.alias !== node.relationName && (
          <Row label="Alias" value={node.alias} />
        )}
        <Row label="Startup cost" value={formatNum(node.startupCost)} />
        <Row label="Total cost" value={formatNum(node.totalCost)} />
        <Row label="Exclusive cost" value={formatNum(node.exclusiveCost)} />
        <Row label="Est. rows" value={formatNum(node.planRows, 0)} />
        {node.planWidth != null && (
          <Row label="Width" value={formatNum(node.planWidth, 0)} />
        )}
        {analyzed && (
          <>
            <Row
              label="Actual startup"
              value={`${formatNum(node.actualStartupMs)} ms`}
            />
            <Row
              label="Actual total"
              value={`${formatNum(node.actualTotalMs)} ms`}
            />
            <Row
              label="Exclusive time"
              value={`${formatNum(node.exclusiveMs)} ms`}
            />
            <Row label="Actual rows" value={formatNum(node.actualRows, 0)} />
            <Row label="Loops" value={formatNum(node.actualLoops, 0)} />
          </>
        )}
      </dl>

      {node.filters && node.filters.length > 0 && (
        <section className="mt-3">
          <h4 className="mb-1 text-[10px] font-semibold tracking-wide text-muted uppercase">
            Conditions
          </h4>
          <ul className="space-y-1">
            {node.filters.map((filter) => (
              <li
                key={filter}
                className="rounded-[4px] bg-surface-deep px-2 py-1.5 font-mono text-[10px] leading-relaxed text-muted"
              >
                {filter}
              </li>
            ))}
          </ul>
        </section>
      )}

      {node.buffers && Object.keys(node.buffers).length > 0 && (
        <section className="mt-3">
          <h4 className="mb-1 text-[10px] font-semibold tracking-wide text-muted uppercase">
            Buffers
          </h4>
          <dl>
            {Object.entries(node.buffers).map(([key, value]) => (
              <Row key={key} label={key} value={formatNum(value, 0)} />
            ))}
          </dl>
        </section>
      )}

      {node.extra && Object.keys(node.extra).length > 0 && (
        <section className="mt-3">
          <h4 className="mb-1 text-[10px] font-semibold tracking-wide text-muted uppercase">
            Extra
          </h4>
          <dl>
            {Object.entries(node.extra).map(([key, value]) => (
              <Row
                key={key}
                label={key}
                value={
                  typeof value === "string"
                    ? value
                    : JSON.stringify(value, null, 0)
                }
              />
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
