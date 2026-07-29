import { useMemo, useState } from "react";
import { KeyRound, LoaderCircle, RefreshCw } from "lucide-react";
import {
  ErDiagram as ErDiagramData,
  ErEdge,
  HEADER_HEIGHT,
  ROW_HEIGHT,
  erCanvasSize,
  layoutErDiagram,
} from "../lib/erDiagram";
import { cn } from "../lib/cn";

interface ErDiagramViewProps {
  diagram: ErDiagramData | null;
  busy: boolean;
  error: string;
  onRefresh: () => void;
}

function edgePath(
  from: { x: number; y: number; width: number; height: number },
  to: { x: number; y: number; width: number; height: number },
): string {
  const startX = from.x + from.width;
  const startY = from.y + from.height / 2;
  const endX = to.x;
  const endY = to.y + to.height / 2;
  const midX = (startX + endX) / 2;
  return `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`;
}

export function ErDiagramView({
  diagram,
  busy,
  error,
  onRefresh,
}: ErDiagramViewProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const nodes = useMemo(
    () => (diagram ? layoutErDiagram(diagram) : []),
    [diagram],
  );
  const byName = useMemo(
    () => new Map(nodes.map((node) => [node.table.name, node])),
    [nodes],
  );
  const size = erCanvasSize(nodes);

  const edges: ErEdge[] = diagram?.edges ?? [];

  return (
    <section className="flex min-h-0 flex-col overflow-hidden bg-bg">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-surface-deep px-2.5">
        <span className="text-[11px] text-text-bright">
          {diagram ? `${diagram.schema} · ER diagram` : "ER diagram"}
        </span>
        {diagram && (
          <span className="text-[9px] text-subtle">
            {diagram.tables.length} tables · {diagram.edges.length} relations
          </span>
        )}
        <button
          type="button"
          className="ml-auto grid size-7 cursor-pointer place-items-center rounded-[5px] border-0 bg-transparent text-muted hover:bg-panel-soft hover:text-text disabled:opacity-40"
          title="Refresh"
          disabled={busy}
          onClick={onRefresh}
        >
          <RefreshCw size={14} className={busy ? "animate-spin-slow" : ""} />
        </button>
      </div>

      {error && (
        <div className="m-2 rounded-md border border-red/20 bg-red/5 p-3 font-mono text-[10px] text-danger">
          {error}
        </div>
      )}

      {busy && !diagram ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-[11px] text-subtle">
          <LoaderCircle className="animate-spin-slow" size={16} /> Loading diagram…
        </div>
      ) : !diagram || nodes.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-[11px] text-subtle">
          No tables in this schema
        </div>
      ) : (
        <div className="scrollbar-thin-app min-h-0 flex-1 overflow-auto bg-surface-input">
          <svg
            width={size.width}
            height={size.height}
            className="block"
            role="img"
            aria-label={`ER diagram for ${diagram.schema}`}
          >
            <defs>
              <marker
                id="er-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--hs-subtle)" />
              </marker>
            </defs>

            {edges.map((edge) => {
              const from = byName.get(edge.fromTable);
              const to = byName.get(edge.toTable);
              if (!from || !to) return null;
              const active =
                selected === edge.fromTable || selected === edge.toTable;
              return (
                <g key={edge.name}>
                  <path
                    d={edgePath(from, to)}
                    fill="none"
                    stroke={
                      active ? "var(--hs-accent-bright)" : "var(--hs-border-bright)"
                    }
                    strokeWidth={active ? 1.6 : 1.2}
                    markerEnd="url(#er-arrow)"
                  />
                  <title>
                    {edge.name}: {edge.fromTable}({edge.fromColumns.join(", ")})
                    → {edge.toTable}({edge.toColumns.join(", ")})
                  </title>
                </g>
              );
            })}

            {nodes.map((node) => {
              const active = selected === node.table.name;
              return (
                <g
                  key={node.table.name}
                  transform={`translate(${node.x}, ${node.y})`}
                  className="cursor-pointer"
                  onClick={() =>
                    setSelected((current) =>
                      current === node.table.name ? null : node.table.name,
                    )
                  }
                >
                  <rect
                    width={node.width}
                    height={node.height}
                    rx={6}
                    fill={
                      active ? "var(--hs-panel-soft)" : "var(--hs-surface-deep)"
                    }
                    stroke={
                      active ? "var(--hs-accent)" : "var(--hs-border)"
                    }
                    strokeWidth={1}
                  />
                  <rect
                    width={node.width}
                    height={HEADER_HEIGHT}
                    rx={6}
                    fill={
                      active ? "var(--hs-panel-raised)" : "var(--hs-surface)"
                    }
                  />
                  <rect
                    y={HEADER_HEIGHT - 6}
                    width={node.width}
                    height={6}
                    fill={
                      active ? "var(--hs-panel-raised)" : "var(--hs-surface)"
                    }
                  />
                  <text
                    x={10}
                    y={18}
                    fill="var(--hs-text)"
                    fontSize={11}
                    fontFamily="SFMono-Regular, Consolas, monospace"
                    fontWeight={600}
                  >
                    {node.table.name}
                  </text>
                  {node.table.columns.map((column, index) => (
                    <g key={column.name}>
                      <text
                        x={10}
                        y={HEADER_HEIGHT + 14 + index * ROW_HEIGHT}
                        fill={
                          column.primaryKey
                            ? "var(--hs-pk)"
                            : "var(--hs-muted)"
                        }
                        fontSize={10}
                        fontFamily="SFMono-Regular, Consolas, monospace"
                      >
                        {column.primaryKey ? "◆ " : "  "}
                        {column.name}
                      </text>
                      <text
                        x={node.width - 10}
                        y={HEADER_HEIGHT + 14 + index * ROW_HEIGHT}
                        fill="var(--hs-subtle)"
                        fontSize={9}
                        fontFamily="SFMono-Regular, Consolas, monospace"
                        textAnchor="end"
                      >
                        {column.dataType.length > 14
                          ? `${column.dataType.slice(0, 13)}…`
                          : column.dataType}
                      </text>
                    </g>
                  ))}
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {selected && diagram && (
        <div className="flex shrink-0 items-center gap-2 border-t border-border bg-panel-soft px-2.5 py-1.5 text-[9px] text-muted">
          <KeyRound size={12} className="text-pk" />
          <span className={cn("font-mono text-text")}>{selected}</span>
          <span>
            {
              edges.filter(
                (edge) =>
                  edge.fromTable === selected || edge.toTable === selected,
              ).length
            }{" "}
            relations
          </span>
        </div>
      )}
    </section>
  );
}
