export interface ErColumn {
  name: string;
  dataType: string;
  primaryKey: boolean;
}

export interface ErTable {
  name: string;
  columns: ErColumn[];
}

export interface ErEdge {
  name: string;
  fromTable: string;
  fromColumns: string[];
  toSchema: string;
  toTable: string;
  toColumns: string[];
  onUpdate: string;
  onDelete: string;
}

export interface ErDiagram {
  schema: string;
  tables: ErTable[];
  edges: ErEdge[];
}

export interface ErNodeLayout {
  table: ErTable;
  x: number;
  y: number;
  width: number;
  height: number;
}

const CARD_WIDTH = 200;
const ROW_HEIGHT = 18;
const HEADER_HEIGHT = 28;
const H_GAP = 56;
const V_GAP = 40;
const COLS = 3;

/** Simple grid layout ordered by inbound FK count so hubs sit near the top. */
export function layoutErDiagram(diagram: ErDiagram): ErNodeLayout[] {
  const inbound = new Map<string, number>();
  for (const edge of diagram.edges) {
    inbound.set(edge.toTable, (inbound.get(edge.toTable) ?? 0) + 1);
  }
  const tables = [...diagram.tables].sort((a, b) => {
    const diff = (inbound.get(b.name) ?? 0) - (inbound.get(a.name) ?? 0);
    return diff !== 0 ? diff : a.name.localeCompare(b.name);
  });

  return tables.map((table, index) => {
    const col = index % COLS;
    const row = Math.floor(index / COLS);
    const height = HEADER_HEIGHT + Math.max(1, table.columns.length) * ROW_HEIGHT + 8;
    // Stagger rows so vertical edges have room between cards.
    const y =
      Array.from({ length: row }, (_, r) => {
        const start = r * COLS;
        const slice = tables.slice(start, start + COLS);
        const tallest = Math.max(
          ...slice.map(
            (item) =>
              HEADER_HEIGHT + Math.max(1, item.columns.length) * ROW_HEIGHT + 8,
          ),
          HEADER_HEIGHT + ROW_HEIGHT,
        );
        return tallest + V_GAP;
      }).reduce((sum, value) => sum + value, 24);
    return {
      table,
      x: 24 + col * (CARD_WIDTH + H_GAP),
      y,
      width: CARD_WIDTH,
      height,
    };
  });
}

export function erCanvasSize(nodes: ErNodeLayout[]): { width: number; height: number } {
  if (nodes.length === 0) return { width: 400, height: 240 };
  const width = Math.max(...nodes.map((node) => node.x + node.width)) + 24;
  const height = Math.max(...nodes.map((node) => node.y + node.height)) + 24;
  return { width, height };
}

export { CARD_WIDTH, HEADER_HEIGHT, ROW_HEIGHT };
