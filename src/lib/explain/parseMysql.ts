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

function tableNode(table: Record<string, unknown>): PlanNode {
  const access = asString(table.access_type) ?? "ALL";
  const name = asString(table.table_name) ?? asString(table.table);
  const nodeType =
    access === "const"
      ? "const"
      : access === "eq_ref" || access === "ref" || access === "range" || access === "index"
        ? `Index lookup (${access})`
        : access === "index_merge"
          ? "Index merge"
          : access === "ALL"
            ? "Table scan"
            : `Access (${access})`;

  const filters: string[] = [];
  const attached = asString(table.attached_condition);
  if (attached) filters.push(`Filter: ${attached}`);
  const key = asString(table.key);
  if (key) filters.push(`Key: ${key}`);
  const usedKeyParts = table.used_key_parts;
  if (Array.isArray(usedKeyParts) && usedKeyParts.length > 0) {
    filters.push(`Key parts: ${usedKeyParts.join(", ")}`);
  }

  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(table)) {
    if (
      [
        "table_name",
        "table",
        "access_type",
        "key",
        "used_key_parts",
        "attached_condition",
        "rows_examined_per_scan",
        "rows_produced_per_join",
        "filtered",
        "cost_info",
        "using_index",
        "using_temporary_table",
        "using_filesort",
      ].includes(k)
    ) {
      continue;
    }
    if (v != null) extra[k] = v;
  }

  const costInfo = asRecord(table.cost_info);
  const totalCost =
    asNumber(costInfo?.read_cost) != null || asNumber(costInfo?.eval_cost) != null
      ? (asNumber(costInfo?.read_cost) ?? 0) + (asNumber(costInfo?.eval_cost) ?? 0)
      : asNumber(costInfo?.query_cost);

  return {
    id: nextPlanId("my"),
    nodeType,
    relationName: name,
    alias: asString(table.table_name) ?? asString(table.table),
    totalCost,
    planRows:
      asNumber(table.rows_examined_per_scan) ??
      asNumber(table.rows_produced_per_join),
    filters: filters.length > 0 ? filters : undefined,
    extra: Object.keys(extra).length > 0 ? extra : undefined,
    children: [],
  };
}

function parseOrdering(operation: Record<string, unknown>): PlanNode | null {
  const ordering = asRecord(operation.ordering_operation);
  if (!ordering) return null;
  const nested = parseQueryBlockBody(ordering);
  const costInfo = asRecord(ordering.cost_info);
  return {
    id: nextPlanId("my"),
    nodeType: "Ordering",
    totalCost: asNumber(costInfo?.query_cost),
    children: nested ? [nested] : [],
  };
}

function parseGrouping(operation: Record<string, unknown>): PlanNode | null {
  const grouping = asRecord(operation.grouping_operation);
  if (!grouping) return null;
  const nested = parseQueryBlockBody(grouping);
  const costInfo = asRecord(grouping.cost_info);
  return {
    id: nextPlanId("my"),
    nodeType: "Grouping",
    totalCost: asNumber(costInfo?.query_cost),
    children: nested ? [nested] : [],
  };
}

function parseNestedLoop(block: Record<string, unknown>): PlanNode | null {
  const nested = block.nested_loop;
  if (!Array.isArray(nested) || nested.length === 0) return null;

  const children: PlanNode[] = [];
  for (const entry of nested) {
    const rec = asRecord(entry);
    if (!rec) continue;
    const table = asRecord(rec.table);
    if (table) {
      children.push(tableNode(table));
      continue;
    }
    const qb = asRecord(rec.query_block);
    if (qb) {
      const child = parseQueryBlock(qb);
      if (child) children.push(child);
    }
  }

  if (children.length === 0) return null;
  if (children.length === 1) return children[0];

  const totalCost = children.reduce((sum, c) => sum + (c.totalCost ?? 0), 0);
  return {
    id: nextPlanId("my"),
    nodeType: "Nested loop",
    totalCost: totalCost || undefined,
    children,
  };
}

function parseQueryBlockBody(block: Record<string, unknown>): PlanNode | null {
  const ordering = parseOrdering(block);
  if (ordering) return ordering;
  const grouping = parseGrouping(block);
  if (grouping) return grouping;

  const nested = parseNestedLoop(block);
  if (nested) return nested;

  const table = asRecord(block.table);
  if (table) return tableNode(table);

  const union = block.union_result;
  if (asRecord(union)) {
    return {
      id: nextPlanId("my"),
      nodeType: "Union",
      children: [],
    };
  }

  return null;
}

function parseQueryBlock(block: Record<string, unknown>): PlanNode | null {
  const costInfo = asRecord(block.cost_info);
  const body = parseQueryBlockBody(block);
  const selectId = asNumber(block.select_id);
  const nodeType =
    selectId != null ? `Query block #${selectId}` : "Query block";

  if (!body) {
    return {
      id: nextPlanId("my"),
      nodeType,
      totalCost: asNumber(costInfo?.query_cost),
      children: [],
    };
  }

  // Promote body when it's already a useful root and block adds little.
  if (body.nodeType.startsWith("Query block")) {
    return body;
  }

  return {
    id: nextPlanId("my"),
    nodeType,
    totalCost: asNumber(costInfo?.query_cost) ?? body.totalCost,
    children: [body],
  };
}

function unwrapMysqlJson(payload: unknown): Record<string, unknown> | null {
  let value = payload;
  if (typeof value === "string") {
    value = parseJsonCell(value);
  }
  const top = asRecord(value);
  if (!top) return null;
  const qb = asRecord(top.query_block);
  return qb ?? top;
}

export function parseMysqlJsonExplain(cell: unknown): ExplainPlan | null {
  resetPlanIds();
  const block = unwrapMysqlJson(cell);
  if (!block) return null;

  const root = parseQueryBlock(block) ?? {
    id: nextPlanId("my"),
    nodeType: "Query",
    children: [],
  };
  deriveExclusive(root);

  return {
    driver: "mysql",
    analyzed: false,
    root,
    raw: cell,
  };
}

/** Parse MySQL EXPLAIN ANALYZE TREE text into a plan tree. */
export function parseMysqlAnalyzeTree(text: string): ExplainPlan | null {
  resetPlanIds();
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\t/g, "    "))
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) return null;

  type StackItem = { indent: number; node: PlanNode };
  const roots: PlanNode[] = [];
  const stack: StackItem[] = [];

  for (const line of lines) {
    const match = line.match(/^(\s*)(.*)$/);
    if (!match) continue;
    const indent = match[1].length;
    const content = match[2].replace(/^->\s*/, "").trim();
    if (!content) continue;

    const node = parseTreeLine(content);
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].node.children.push(node);
    }
    stack.push({ indent, node });
  }

  if (roots.length === 0) return null;

  const root =
    roots.length === 1
      ? roots[0]
      : {
          id: nextPlanId("my"),
          nodeType: "Query",
          children: roots,
        };

  deriveExclusive(root);

  return {
    driver: "mysql",
    analyzed: true,
    root,
    executionMs: root.actualTotalMs,
    raw: text,
  };
}

function parseTreeLine(content: string): PlanNode {
  // Examples:
  // Table scan on users  (cost=0.35 rows=1) (actual time=0.020..0.021 rows=1 loops=1)
  // Nested loop inner join  (cost=1.10 rows=1) (actual time=0.040..0.041 rows=1 loops=1)
  const costMatch = content.match(
    /\(cost=([\d.]+)\s+rows=([\d.]+)\)(?:\s+\(actual time=([\d.]+)\.\.([\d.]+)\s+rows=([\d.]+)\s+loops=([\d.]+)\))?/,
  );

  let nodeType = content;
  let totalCost: number | undefined;
  let planRows: number | undefined;
  let actualStartupMs: number | undefined;
  let actualTotalMs: number | undefined;
  let actualRows: number | undefined;
  let actualLoops: number | undefined;

  if (costMatch) {
    nodeType = content.slice(0, costMatch.index).trim();
    totalCost = Number(costMatch[1]);
    planRows = Number(costMatch[2]);
    if (costMatch[3] != null) {
      actualStartupMs = Number(costMatch[3]);
      actualTotalMs = Number(costMatch[4]);
      actualRows = Number(costMatch[5]);
      actualLoops = Number(costMatch[6]);
    }
  }

  let relationName: string | undefined;
  const onMatch = nodeType.match(/\bon\s+([`"]?)([\w.]+)\1\s*$/i);
  if (onMatch) {
    relationName = onMatch[2];
  }

  return {
    id: nextPlanId("my"),
    nodeType: nodeType || "Node",
    relationName,
    totalCost: Number.isFinite(totalCost) ? totalCost : undefined,
    planRows: Number.isFinite(planRows) ? planRows : undefined,
    actualStartupMs: Number.isFinite(actualStartupMs)
      ? actualStartupMs
      : undefined,
    actualTotalMs: Number.isFinite(actualTotalMs) ? actualTotalMs : undefined,
    actualRows: Number.isFinite(actualRows) ? actualRows : undefined,
    actualLoops: Number.isFinite(actualLoops) ? actualLoops : undefined,
    children: [],
  };
}

export function parseMysqlExplain(
  cell: unknown,
  options?: { analyzed?: boolean },
): ExplainPlan | null {
  if (options?.analyzed || (typeof cell === "string" && !looksLikeJson(cell))) {
    const text = typeof cell === "string" ? cell : String(cell ?? "");
    const tree = parseMysqlAnalyzeTree(text);
    if (tree) return tree;
  }

  const json = parseMysqlJsonExplain(cell);
  if (json) return json;

  if (typeof cell === "string") {
    return parseMysqlAnalyzeTree(cell);
  }
  return null;
}

function looksLikeJson(text: string): boolean {
  const t = text.trim();
  return t.startsWith("{") || t.startsWith("[");
}
