export interface ConnectionInfo {
  serverVersion: string;
  database: string;
}

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  affectedRows: number;
  elapsedMs: number;
  truncated: boolean;
}
