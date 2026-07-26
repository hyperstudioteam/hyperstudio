import { useEffect, useMemo, useState } from "react";
import { cn } from "../../lib/cn";
import { ExplainPlan, PlanNode } from "../../lib/explain";
import { JsonTree } from "../viewers/JsonTree";
import { PlanNodeDetail } from "./PlanNodeDetail";
import { PlanTree } from "./PlanTree";

interface ExplainPlanViewProps {
  plan: ExplainPlan;
}

function formatNum(n: number | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

function findNode(root: PlanNode, id: string): PlanNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

export function ExplainPlanView({ plan }: ExplainPlanViewProps) {
  const [selectedId, setSelectedId] = useState(plan.root.id);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    setSelectedId(plan.root.id);
    setShowRaw(false);
  }, [plan]);

  const selected = useMemo(
    () => findNode(plan.root, selectedId) ?? plan.root,
    [plan.root, selectedId],
  );

  const costDenom = Math.max(plan.root.totalCost ?? 0, 1e-9);
  const timeDenom = Math.max(
    plan.executionMs ?? plan.root.actualTotalMs ?? 0,
    1e-9,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg">
      <div className="flex h-8 shrink-0 items-center gap-3 border-b border-border bg-[#14171b] px-3 text-[10px] text-subtle">
        <span
          className={cn(
            "rounded-[3px] px-1.5 py-0.5 font-semibold uppercase tracking-wide",
            plan.analyzed
              ? "bg-[rgba(73,201,137,.12)] text-green"
              : "bg-accent-soft text-[#c9c2ff]",
          )}
        >
          {plan.analyzed ? "ANALYZE" : "EXPLAIN"}
        </span>
        <span className="capitalize text-muted">{plan.driver}</span>
        <span className="h-3 w-px bg-border" />
        {plan.analyzed ? (
          <>
            <span>
              Execution{" "}
              <span className="font-mono text-[#d5dae3]">
                {formatNum(plan.executionMs ?? plan.root.actualTotalMs)} ms
              </span>
            </span>
            {plan.planningMs != null && (
              <span>
                Planning{" "}
                <span className="font-mono text-[#d5dae3]">
                  {formatNum(plan.planningMs)} ms
                </span>
              </span>
            )}
          </>
        ) : (
          <span>
            Total cost{" "}
            <span className="font-mono text-[#d5dae3]">
              {formatNum(plan.root.totalCost)}
            </span>
          </span>
        )}
        <span>
          Est. rows{" "}
          <span className="font-mono text-[#d5dae3]">
            {formatNum(plan.root.planRows, 0)}
          </span>
        </span>
        <button
          type="button"
          className={cn(
            "ml-auto cursor-pointer rounded-[4px] border border-border bg-transparent px-2 py-0.5 text-[10px] text-muted hover:border-border-bright hover:text-text",
            showRaw && "border-accent text-[#c9c2ff]",
          )}
          onClick={() => setShowRaw((v) => !v)}
        >
          {showRaw ? "Hide raw" : "Raw JSON"}
        </button>
      </div>

      {showRaw ? (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <JsonTree
            value={
              typeof plan.raw === "string"
                ? (() => {
                    try {
                      return JSON.parse(plan.raw);
                    } catch {
                      return plan.raw;
                    }
                  })()
                : plan.raw
            }
          />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.4fr)_minmax(220px,0.85fr)] overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-col border-r border-border">
            <PlanTree
              root={plan.root}
              analyzed={plan.analyzed}
              selectedId={selectedId}
              onSelect={(node) => setSelectedId(node.id)}
              costDenom={costDenom}
              timeDenom={timeDenom}
            />
          </div>
          <div className="flex min-h-0 min-w-0 flex-col bg-[#13161b]">
            <div className="shrink-0 border-b border-border px-3 py-1.5 text-[10px] font-semibold tracking-wide text-muted uppercase">
              Node details
            </div>
            <PlanNodeDetail node={selected} analyzed={plan.analyzed} />
          </div>
        </div>
      )}
    </div>
  );
}
