import {
  asNumber,
  asRecord,
  asString,
  deriveExclusive,
  nextPlanId,
  parseJsonCell,
  resetPlanIds,
} from "./derive";
import { ExplainPlan, PlanNode } from "./types";

const FILTER_KEYS = [
  "Filter",
  "Join Filter",
  "Index Cond",
  "Recheck Cond",
  "Hash Cond",
  "Merge Cond",
  "TID Cond",
  "One-Time Filter",
] as const;

const KNOWN = new Set([
  "Node Type",
  "Parent Relationship",
  "Parallel Aware",
  "Async Capable",
  "Relation Name",
  "Schema",
  "Alias",
  "Startup Cost",
  "Total Cost",
  "Plan Rows",
  "Plan Width",
  "Actual Startup Time",
  "Actual Total Time",
  "Actual Rows",
  "Actual Loops",
  "Plans",
  "Workers",
  "Workers Planned",
  "Workers Launched",
  "Shared Hit Blocks",
  "Shared Read Blocks",
  "Shared Dirtied Blocks",
  "Shared Written Blocks",
  "Local Hit Blocks",
  "Local Read Blocks",
  "Local Dirtied Blocks",
  "Local Written Blocks",
  "Temp Read Blocks",
  "Temp Written Blocks",
  ...FILTER_KEYS,
]);

function buffersFrom(raw: Record<string, unknown>): Record<string, number> | undefined {
  const buffers: Record<string, number> = {};
  const keys = [
    "Shared Hit Blocks",
    "Shared Read Blocks",
    "Shared Dirtied Blocks",
    "Shared Written Blocks",
    "Local Hit Blocks",
    "Local Read Blocks",
    "Local Dirtied Blocks",
    "Local Written Blocks",
    "Temp Read Blocks",
    "Temp Written Blocks",
  ];
  for (const key of keys) {
    const n = asNumber(raw[key]);
    if (n != null && n !== 0) buffers[key] = n;
  }
  return Object.keys(buffers).length > 0 ? buffers : undefined;
}

function filtersFrom(raw: Record<string, unknown>): string[] | undefined {
  const filters: string[] = [];
  for (const key of FILTER_KEYS) {
    const value = asString(raw[key]);
    if (value) filters.push(`${key}: ${value}`);
  }
  return filters.length > 0 ? filters : undefined;
}

function extraFrom(raw: Record<string, unknown>): Record<string, unknown> | undefined {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (KNOWN.has(key) || key === "Plans") continue;
    if (value == null) continue;
    extra[key] = value;
  }
  return Object.keys(extra).length > 0 ? extra : undefined;
}

function parseNode(raw: Record<string, unknown>): PlanNode {
  const childrenRaw = raw.Plans;
  const children: PlanNode[] = [];
  if (Array.isArray(childrenRaw)) {
    for (const child of childrenRaw) {
      const rec = asRecord(child);
      if (rec) children.push(parseNode(rec));
    }
  }

  return {
    id: nextPlanId("pg"),
    nodeType: asString(raw["Node Type"]) ?? "Node",
    relationName: asString(raw["Relation Name"]),
    alias: asString(raw.Alias),
    schema: asString(raw.Schema),
    startupCost: asNumber(raw["Startup Cost"]),
    totalCost: asNumber(raw["Total Cost"]),
    planRows: asNumber(raw["Plan Rows"]),
    planWidth: asNumber(raw["Plan Width"]),
    actualStartupMs: asNumber(raw["Actual Startup Time"]),
    actualTotalMs: asNumber(raw["Actual Total Time"]),
    actualRows: asNumber(raw["Actual Rows"]),
    actualLoops: asNumber(raw["Actual Loops"]),
    filters: filtersFrom(raw),
    buffers: buffersFrom(raw),
    extra: extraFrom(raw),
    children,
  };
}

function unwrapPlanRoot(payload: unknown): {
  plan: Record<string, unknown>;
  planningMs?: number;
  executionMs?: number;
} | null {
  let value = payload;
  if (typeof value === "string") {
    value = parseJsonCell(value);
  }

  // Postgres returns a JSON array: [{ "Plan": {...}, "Planning Time": … }]
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    value = value[0];
  }

  const top = asRecord(value);
  if (!top) return null;

  const plan = asRecord(top.Plan);
  if (!plan) {
    // Sometimes the cell is the Plan object itself.
    if (top["Node Type"] != null) {
      return { plan: top };
    }
    return null;
  }

  return {
    plan,
    planningMs: asNumber(top["Planning Time"]),
    executionMs: asNumber(top["Execution Time"]),
  };
}

export function parsePostgresExplain(
  cell: unknown,
  options?: { analyzed?: boolean },
): ExplainPlan | null {
  resetPlanIds();
  const unwrapped = unwrapPlanRoot(cell);
  if (!unwrapped) return null;

  const root = parseNode(unwrapped.plan);
  deriveExclusive(root);

  const analyzed =
    options?.analyzed === true ||
    root.actualTotalMs != null ||
    unwrapped.executionMs != null;

  return {
    driver: "postgres",
    analyzed,
    root,
    planningMs: unwrapped.planningMs,
    executionMs: unwrapped.executionMs,
    raw: cell,
  };
}
