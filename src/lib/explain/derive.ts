import { PlanNode } from "./types";

let nextId = 0;

export function resetPlanIds() {
  nextId = 0;
}

export function nextPlanId(prefix = "n"): string {
  nextId += 1;
  return `${prefix}${nextId}`;
}

export function deriveExclusive(node: PlanNode): void {
  for (const child of node.children) {
    deriveExclusive(child);
  }

  const childCost = node.children.reduce(
    (sum, child) => sum + (child.totalCost ?? 0),
    0,
  );
  if (node.totalCost != null) {
    node.exclusiveCost = Math.max(0, node.totalCost - childCost);
  }

  const childMs = node.children.reduce(
    (sum, child) => sum + (child.actualTotalMs ?? 0),
    0,
  );
  if (node.actualTotalMs != null) {
    node.exclusiveMs = Math.max(0, node.actualTotalMs - childMs);
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

export function parseJsonCell(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}
