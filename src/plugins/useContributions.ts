import { useSyncExternalStore } from "react";
import { CellContext, contributions } from "./contributions";

function subscribe(listener: () => void) {
  return contributions.subscribe(listener);
}

/** Re-render when contributions change (plugin install/uninstall, HMR). */
export function useContributionsVersion(): number {
  return useSyncExternalStore(
    subscribe,
    () => contributionsVersion,
    () => contributionsVersion,
  );
}

// A cheap monotonically-increasing version bumped on every change.
let contributionsVersion = 0;
contributions.subscribe(() => {
  contributionsVersion += 1;
});

/** Viewers that can render the given cell, best first. */
export function useCellViewers(ctx: CellContext) {
  useContributionsVersion();
  return contributions.resolveViewers(ctx);
}
