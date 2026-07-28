/** True on macOS (including Mac Catalyst / iPhone UA edge cases we ignore). */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = navigator.platform || "";
  if (/Mac|iPhone|iPad|iPod/i.test(platform)) return true;
  // Chromium on Apple Silicon may report empty platform; fall back to UA data.
  const uaData = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData;
  return /mac/i.test(uaData?.platform ?? "");
}

/** Primary modifier for app shortcuts: ⌘ on macOS, Ctrl elsewhere. */
export function isPrimaryModifier(event: {
  metaKey: boolean;
  ctrlKey: boolean;
}): boolean {
  return isMacPlatform() ? event.metaKey : event.ctrlKey;
}

/** Display label for the primary modifier (e.g. "⌘" or "Ctrl"). */
export function primaryModifierLabel(): string {
  return isMacPlatform() ? "⌘" : "Ctrl";
}

/** Shortcut hint like "⌘R" or "Ctrl+R". */
export function shortcutLabel(key: string): string {
  const mod = primaryModifierLabel();
  return isMacPlatform() ? `${mod}${key}` : `${mod}+${key}`;
}
