import {
  CellAlign,
  ColumnTypeContribution,
  contributions,
} from "./contributions";
import { registerBuiltinContributions } from "./builtins";
import { DriverInfo } from "../types/connection";

let initialized = false;

/** Register built-in contributions once at startup. */
export function initContributions() {
  if (initialized) return;
  initialized = true;
  registerBuiltinContributions();
}

/**
 * Apply column-type contributions declared by driver plugins in their manifest.
 * These are declarative (type name -> viewer/alignment) and run no plugin code.
 */
export function syncPluginColumnTypes(drivers: DriverInfo[]) {
  // Drop previously-synced plugin column types, then re-add from current drivers.
  const sources = new Set(drivers.map((driver) => `driver:${driver.id}`));
  for (const source of sources) {
    contributions.removeSource(source);
  }

  for (const driver of drivers) {
    if (driver.builtin) continue;
    for (const [index, declared] of (driver.columnTypes ?? []).entries()) {
      const contribution: ColumnTypeContribution = {
        id: `driver:${driver.id}:${index}`,
        source: `driver:${driver.id}`,
        typeNames: declared.typeNames.map((name) => name.toLowerCase()),
        matchPrefix: declared.matchPrefix ?? false,
        align: normalizeAlign(declared.align),
        className: declared.className,
        defaultViewer: declared.viewer,
        priority: declared.priority ?? 1,
      };
      contributions.registerColumnType(contribution);
    }
  }
}

function normalizeAlign(value?: string): CellAlign | undefined {
  if (value === "left" || value === "right" || value === "center") return value;
  return undefined;
}
