import {
  DEFAULT_THEME_ID,
  THEME_STORAGE_KEY,
  THEME_VARS_STORAGE_KEY,
  getThemeDefinition,
  resolveThemeTokens,
  themeInfo,
} from "./registry";
import { applyCssVars, tokensToCssVars } from "./cssVars";
import type { CssVarMap } from "./cssVars";
import type { ThemeDefinition } from "./types";

/** Read the persisted theme id, falling back to the built-in default. */
export function loadThemeId(): string {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (typeof raw === "string" && getThemeDefinition(raw)) return raw;
  } catch {
    /* ignore */
  }
  return DEFAULT_THEME_ID;
}

export function saveThemeId(id: string) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

function cacheThemeVars(vars: CssVarMap, colorScheme: "dark" | "light") {
  try {
    localStorage.setItem(
      THEME_VARS_STORAGE_KEY,
      JSON.stringify({ colorScheme, vars }),
    );
  } catch {
    /* ignore */
  }
}

/**
 * Apply a resolved theme document to `<html>`.
 * Sets CSS variables from the palette (plus token overrides).
 */
export function applyThemeDefinition(theme: ThemeDefinition) {
  const root = document.documentElement;
  const tokens = resolveThemeTokens(theme);
  const vars = tokensToCssVars(tokens);
  applyCssVars(root, vars);
  root.dataset.theme = theme.id;
  root.style.colorScheme = theme.colorScheme;
  cacheThemeVars(vars, theme.colorScheme);
}

/**
 * Apply a registered theme by id.
 * Safe to call before React mounts (avoids a flash of the wrong palette).
 */
export function applyTheme(id: string) {
  const theme = getThemeDefinition(id) ?? getThemeDefinition(DEFAULT_THEME_ID)!;
  applyThemeDefinition(theme);
}

export function initTheme(): string {
  const id = loadThemeId();
  applyTheme(id);
  return id;
}

/** Used by Settings / extensions for display metadata. */
export function activeThemeInfo() {
  return themeInfo(loadThemeId());
}
