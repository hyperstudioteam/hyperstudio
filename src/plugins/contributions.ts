import { ReactNode } from "react";

/**
 * Contribution system for column types and data viewers.
 *
 * Everything is a contribution: even HyperStudio's built-in cell rendering and
 * viewers register through this same API. Driver plugins can add column types
 * declaratively (via manifest `contributes.columnTypes`), and future UI
 * plugins can register custom viewers at runtime.
 */

export type CellAlign = "left" | "right" | "center";

/** Context passed to contributions when rendering or matching a cell. */
export interface CellContext {
  /** Raw cell value from the query result. */
  value: unknown;
  /** SQL type name for the column, when known (e.g. "jsonb", "int4"). */
  typeName?: string;
  /** Column name, when known. */
  columnName?: string;
  /** Active driver id (e.g. "postgres", or a plugin id). */
  driver?: string;
}

/**
 * A column type contribution controls how a cell is displayed inline and which
 * viewer opens by default when the user inspects it.
 */
export interface ColumnTypeContribution {
  id: string;
  /** Source of the contribution: built-in, or a plugin id. */
  source: string;
  /** SQL type names this handles (lowercased, exact or prefix via `matchPrefix`). */
  typeNames?: string[];
  /** Treat `typeNames` as prefixes (e.g. "varchar" matches "varchar(255)"). */
  matchPrefix?: boolean;
  /** Fallback predicate on the raw JS value when type name is unknown. */
  matchValue?: (value: unknown) => boolean;
  /** Inline text rendering. Defaults to a JSON/string stringify. */
  format?: (ctx: CellContext) => string;
  /** Cell horizontal alignment. */
  align?: CellAlign;
  /** Extra CSS class applied to the cell. */
  className?: string;
  /** Default viewer id to open for this type. */
  defaultViewer?: string;
  /** Sort priority; higher wins when multiple match. Default 0. */
  priority?: number;
}

/** A data viewer renders a rich panel for a single cell value. */
export interface DataViewerContribution {
  id: string;
  label: string;
  source: string;
  /** Whether this viewer can render the given cell. */
  canView: (ctx: CellContext) => boolean;
  /** The React component rendering the value. */
  render: (ctx: CellContext) => ReactNode;
  /** Sort priority; higher appears first. Default 0. */
  priority?: number;
}

type Listener = () => void;

class ContributionRegistry {
  private columnTypes = new Map<string, ColumnTypeContribution>();
  private viewers = new Map<string, DataViewerContribution>();
  private listeners = new Set<Listener>();

  registerColumnType(contribution: ColumnTypeContribution) {
    this.columnTypes.set(contribution.id, contribution);
    this.emit();
  }

  registerDataViewer(contribution: DataViewerContribution) {
    this.viewers.set(contribution.id, contribution);
    this.emit();
  }

  /** Remove every contribution from a given source (e.g. on plugin uninstall). */
  removeSource(source: string) {
    let changed = false;
    for (const [id, contribution] of this.columnTypes) {
      if (contribution.source === source) {
        this.columnTypes.delete(id);
        changed = true;
      }
    }
    for (const [id, contribution] of this.viewers) {
      if (contribution.source === source) {
        this.viewers.delete(id);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  listColumnTypes(): ColumnTypeContribution[] {
    return [...this.columnTypes.values()];
  }

  listViewers(): DataViewerContribution[] {
    return [...this.viewers.values()];
  }

  /** The best-matching column type for a cell, if any. */
  resolveColumnType(ctx: CellContext): ColumnTypeContribution | null {
    const type = ctx.typeName?.toLowerCase();
    let best: ColumnTypeContribution | null = null;
    let bestScore = -Infinity;
    for (const contribution of this.columnTypes.values()) {
      const score = this.scoreColumnType(contribution, ctx, type);
      if (score === null) continue;
      const priority = contribution.priority ?? 0;
      const total = score + priority;
      if (total > bestScore) {
        bestScore = total;
        best = contribution;
      }
    }
    return best;
  }

  private scoreColumnType(
    contribution: ColumnTypeContribution,
    ctx: CellContext,
    type: string | undefined,
  ): number | null {
    if (contribution.typeNames && type) {
      for (const name of contribution.typeNames) {
        const needle = name.toLowerCase();
        if (contribution.matchPrefix ? type.startsWith(needle) : type === needle) {
          // Exact type match is a strong signal.
          return 100;
        }
      }
    }
    if (contribution.matchValue && contribution.matchValue(ctx.value)) {
      return 10;
    }
    return null;
  }

  /** All viewers that can render a cell, best first. */
  resolveViewers(ctx: CellContext): DataViewerContribution[] {
    return this.listViewers()
      .filter((viewer) => {
        try {
          return viewer.canView(ctx);
        } catch {
          return false;
        }
      })
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }
}

export const contributions = new ContributionRegistry();

/** Format a cell for inline display using the matching column type. */
export function formatCell(ctx: CellContext): string {
  const contribution = contributions.resolveColumnType(ctx);
  if (contribution?.format) return contribution.format(ctx);
  return defaultFormat(ctx.value);
}

/** Inline cell presentation (text + class + alignment) resolved from the registry. */
export function presentCell(ctx: CellContext): {
  text: string;
  className: string;
  align: CellAlign;
  defaultViewer?: string;
} {
  const contribution = contributions.resolveColumnType(ctx);
  return {
    text: contribution?.format ? contribution.format(ctx) : defaultFormat(ctx.value),
    className: contribution?.className ?? "",
    align: contribution?.align ?? "left",
    defaultViewer: contribution?.defaultViewer,
  };
}

export function defaultFormat(value: unknown): string {
  if (value === null || value === undefined) return "<null>";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
