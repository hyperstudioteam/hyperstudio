export type ExplainDriver = "postgres" | "mysql";

export type PlanNode = {
  id: string;
  nodeType: string;
  relationName?: string;
  alias?: string;
  schema?: string;
  startupCost?: number;
  totalCost?: number;
  planRows?: number;
  planWidth?: number;
  actualStartupMs?: number;
  actualTotalMs?: number;
  actualRows?: number;
  actualLoops?: number;
  exclusiveCost?: number;
  exclusiveMs?: number;
  filters?: string[];
  buffers?: Record<string, number>;
  extra?: Record<string, unknown>;
  children: PlanNode[];
};

export type ExplainPlan = {
  driver: ExplainDriver;
  analyzed: boolean;
  root: PlanNode;
  planningMs?: number;
  executionMs?: number;
  raw: unknown;
};
