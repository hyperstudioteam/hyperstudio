import {
  Check,
  CircleAlert,
  CircleDashed,
  LoaderCircle,
  MinusCircle,
} from "lucide-react";
import { Group, Panel, useDefaultLayout } from "react-resizable-panels";
import { cn } from "../lib/cn";
import { StatementRun, statementLabel, summarize } from "../lib/scriptRun";
import { ConnectionProfile } from "../types/connection";
import { PanelResizeHandle } from "./PanelResizeHandle";
import { ResultGrid } from "./ResultGrid";

interface ScriptResultsProps {
  runs: StatementRun[];
  activeIndex: number;
  driver?: ConnectionProfile["driver"];
  onSelect: (index: number) => void;
}

function StatusIcon({ status }: { status: StatementRun["status"] }) {
  if (status === "running") {
    return (
      <LoaderCircle size={12} className="animate-spin-slow text-accent-bright" />
    );
  }
  if (status === "ok") return <Check size={12} className="text-green" />;
  if (status === "error") return <CircleAlert size={12} className="text-red" />;
  if (status === "skipped")
    return <MinusCircle size={12} className="text-subtle" />;
  return <CircleDashed size={12} className="text-subtle" />;
}

export function ScriptResults({
  runs,
  activeIndex,
  driver,
  onSelect,
}: ScriptResultsProps) {
  const active = runs[activeIndex] ?? null;
  const layout = useDefaultLayout({
    id: "script-results",
    storage: localStorage,
  });

  return (
    <Group
      id="script-results"
      orientation="horizontal"
      className="min-h-0 flex-1"
      defaultLayout={layout.defaultLayout}
      onLayoutChanged={layout.onLayoutChanged}
    >
      <Panel id="script-list" defaultSize={240} minSize={160} maxSize={420}>
        <ol className="m-0 h-full min-h-0 list-none overflow-y-auto bg-[#12151a] p-0">
          {runs.map((run, index) => (
            <li key={`${index}-${run.line}`}>
              <button
                type="button"
                className={cn(
                  "flex w-full cursor-pointer items-start gap-1.5 border-0 border-b border-border bg-transparent px-2 py-1.5 text-left hover:bg-panel-soft",
                  index === activeIndex && "bg-accent-soft",
                )}
                onClick={() => onSelect(index)}
              >
                <span className="mt-px shrink-0">
                  <StatusIcon status={run.status} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[10px] text-[#c4cad4]">
                    {statementLabel(run.sql)}
                  </span>
                  <span
                    className={cn(
                      "block truncate text-[9px] text-subtle",
                      run.status === "error" && "text-red",
                    )}
                  >
                    {summarize(run) || `line ${run.line}`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </Panel>
      <PanelResizeHandle />
      <Panel id="script-result" minSize={200}>
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <ResultGrid
            result={active?.status === "ok" ? active.result : null}
            error={active?.status === "error" ? active.error : ""}
            driver={driver}
          />
        </div>
      </Panel>
    </Group>
  );
}
