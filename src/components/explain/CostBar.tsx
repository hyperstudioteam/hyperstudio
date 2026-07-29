import { cn } from "../../lib/cn";

interface CostBarProps {
  /** 0–1 share of root cost/time. */
  ratio: number;
  analyzed?: boolean;
  className?: string;
}

export function CostBar({ ratio, analyzed, className }: CostBarProps) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  const hot = pct >= 40;
  const warm = pct >= 15 && pct < 40;

  return (
    <div
      className={cn(
        "h-1.5 w-full overflow-hidden rounded-sm bg-panel-soft",
        className,
      )}
      title={`${pct.toFixed(1)}%`}
    >
      <div
        className={cn(
          "h-full rounded-sm transition-[width] duration-200",
          analyzed
            ? hot
              ? "bg-red"
              : warm
                ? "bg-warn"
                : "bg-blue"
            : hot
              ? "bg-warn"
              : warm
                ? "bg-accent"
                : "bg-accent/50",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
