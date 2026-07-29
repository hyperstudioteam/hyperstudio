import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/cn";
import { PlanNode } from "../../lib/explain";
import { CostBar } from "./CostBar";

interface PlanTreeProps {
  root: PlanNode;
  analyzed: boolean;
  selectedId: string | null;
  onSelect: (node: PlanNode) => void;
  costDenom: number;
  timeDenom: number;
}

function formatNum(n: number | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return n.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

function nodeLabel(node: PlanNode): string {
  const rel = node.relationName
    ? node.schema
      ? `${node.schema}.${node.relationName}`
      : node.relationName
    : null;
  if (rel && node.alias && node.alias !== node.relationName) {
    return `${node.nodeType} · ${rel} as ${node.alias}`;
  }
  if (rel) return `${node.nodeType} · ${rel}`;
  return node.nodeType;
}

export function PlanTree({
  root,
  analyzed,
  selectedId,
  onSelect,
  costDenom,
  timeDenom,
}: PlanTreeProps) {
  return (
    <div className="min-h-0 flex-1 overflow-auto px-1 py-1.5 font-mono text-[11px]">
      <PlanTreeNode
        node={root}
        depth={0}
        analyzed={analyzed}
        selectedId={selectedId}
        onSelect={onSelect}
        costDenom={costDenom}
        timeDenom={timeDenom}
        defaultOpen
      />
    </div>
  );
}

interface PlanTreeNodeProps {
  node: PlanNode;
  depth: number;
  analyzed: boolean;
  selectedId: string | null;
  onSelect: (node: PlanNode) => void;
  costDenom: number;
  timeDenom: number;
  defaultOpen?: boolean;
}

function PlanTreeNode({
  node,
  depth,
  analyzed,
  selectedId,
  onSelect,
  costDenom,
  timeDenom,
  defaultOpen,
}: PlanTreeNodeProps) {
  const [open, setOpen] = useState(defaultOpen ?? depth < 3);
  const hasChildren = node.children.length > 0;
  const selected = node.id === selectedId;
  const ratio = analyzed
    ? timeDenom > 0
      ? (node.exclusiveMs ?? 0) / timeDenom
      : 0
    : costDenom > 0
      ? (node.exclusiveCost ?? 0) / costDenom
      : 0;

  return (
    <div>
      <button
        type="button"
        className={cn(
          "flex w-full cursor-pointer items-center gap-1.5 rounded-[4px] border-0 px-1.5 py-1 text-left hover:bg-panel-soft",
          selected && "bg-accent-soft hover:bg-accent-soft",
        )}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={() => onSelect(node)}
      >
        <span
          className={cn(
            "grid size-3.5 shrink-0 place-items-center text-subtle",
            !hasChildren && "opacity-0",
          )}
          onClick={(event) => {
            if (!hasChildren) return;
            event.stopPropagation();
            setOpen((v) => !v);
          }}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                "min-w-0 truncate font-semibold text-text-bright",
                selected && "text-white",
              )}
            >
              {nodeLabel(node)}
            </span>
            <span className="shrink-0 text-[10px] text-subtle tabular-nums">
              {analyzed ? (
                <>
                  {formatNum(node.actualTotalMs)} ms · rows{" "}
                  {formatNum(node.actualRows, 0)}
                  {node.planRows != null && (
                    <span className="text-subtle">
                      {" "}
                      / est {formatNum(node.planRows, 0)}
                    </span>
                  )}
                </>
              ) : (
                <>
                  cost {formatNum(node.totalCost)} · rows{" "}
                  {formatNum(node.planRows, 0)}
                </>
              )}
            </span>
          </div>
          <CostBar
            ratio={ratio}
            analyzed={analyzed}
            className="mt-1 max-w-[220px]"
          />
        </div>
      </button>

      {hasChildren && open && (
        <div>
          {node.children.map((child) => (
            <PlanTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              analyzed={analyzed}
              selectedId={selectedId}
              onSelect={onSelect}
              costDenom={costDenom}
              timeDenom={timeDenom}
            />
          ))}
        </div>
      )}
    </div>
  );
}
