import catppuccinLatteJson from "./builtins/catppuccin-latte.json";
import catppuccinMochaJson from "./builtins/catppuccin-mocha.json";
import cyberdreamJson from "./builtins/cyberdream.json";
import cyberdreamLightJson from "./builtins/cyberdream-light.json";
import defaultJson from "./builtins/default.json";
import defaultLightJson from "./builtins/default-light.json";
import draculaJson from "./builtins/dracula.json";
import draculaAlucardJson from "./builtins/dracula-alucard.json";
import nordJson from "./builtins/nord.json";
import nordLightJson from "./builtins/nord-light.json";
import oneDarkJson from "./builtins/one-dark.json";
import oneLightJson from "./builtins/one-light.json";
import { deriveTokens } from "./derive";
import { parseThemeJson } from "./parseJson";
import type { ThemeDefinition, ThemeFamily, ThemeInfo, ThemeTokens } from "./types";

export const THEME_STORAGE_KEY = "hyperstudio.theme.v1";
export const THEME_VARS_STORAGE_KEY = "hyperstudio.theme.vars.v1";
export const CUSTOM_THEMES_STORAGE_KEY = "hyperstudio.themes.custom.v1";

export const DEFAULT_THEME_ID = "default";

/** Display order for built-in families in Settings. */
const FAMILY_ORDER = [
  "default",
  "one",
  "catppuccin",
  "dracula",
  "nord",
  "cyberdream",
] as const;

const FAMILY_LABELS: Record<string, string> = {
  default: "HyperStudio",
  one: "One Dark / Light",
  catppuccin: "Catppuccin",
  dracula: "Dracula",
  nord: "Nord",
  cyberdream: "Cyberdream",
};

const BUILTIN_DEFINITIONS: ThemeDefinition[] = [
  parseThemeJson(defaultJson),
  parseThemeJson(defaultLightJson),
  parseThemeJson(oneDarkJson),
  parseThemeJson(oneLightJson),
  parseThemeJson(catppuccinMochaJson),
  parseThemeJson(catppuccinLatteJson),
  parseThemeJson(draculaJson),
  parseThemeJson(draculaAlucardJson),
  parseThemeJson(nordJson),
  parseThemeJson(nordLightJson),
  parseThemeJson(cyberdreamJson),
  parseThemeJson(cyberdreamLightJson),
];

export const BUILTIN_THEME_IDS = new Set(
  BUILTIN_DEFINITIONS.map((theme) => theme.id),
);

const customThemes = new Map<string, ThemeDefinition>();

function loadCustomThemesFromStorage() {
  try {
    const raw = localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return;
    for (const entry of parsed) {
      const theme = parseThemeJson(entry);
      customThemes.set(theme.id, theme);
    }
  } catch {
    /* ignore corrupt custom theme storage */
  }
}

let customsLoaded = false;

function ensureCustomsLoaded() {
  if (customsLoaded) return;
  customsLoaded = true;
  if (typeof localStorage !== "undefined") {
    loadCustomThemesFromStorage();
  }
}

function persistCustomThemes() {
  const list = [...customThemes.values()];
  localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(list));
}

export function listThemeDefinitions(): ThemeDefinition[] {
  ensureCustomsLoaded();
  const builtins = BUILTIN_DEFINITIONS;
  const customs = [...customThemes.values()].filter(
    (theme) => !builtins.some((builtin) => builtin.id === theme.id),
  );
  return [...builtins, ...customs];
}

export function getThemeDefinition(id: string): ThemeDefinition | undefined {
  ensureCustomsLoaded();
  return (
    BUILTIN_DEFINITIONS.find((theme) => theme.id === id) ??
    customThemes.get(id)
  );
}

export function resolveThemeTokens(theme: ThemeDefinition): ThemeTokens {
  return deriveTokens(theme.palette, theme.colorScheme, theme.tokens);
}

export function isThemeId(value: unknown): value is string {
  return typeof value === "string" && Boolean(getThemeDefinition(value));
}

export function themeInfo(id: string): ThemeInfo {
  const theme = getThemeDefinition(id) ?? BUILTIN_DEFINITIONS[0]!;
  return {
    id: theme.id,
    family: theme.family,
    label: theme.name,
    description: theme.description ?? "",
    colorScheme: theme.colorScheme,
  };
}

export function listThemeInfos(): ThemeInfo[] {
  return listThemeDefinitions().map((theme) => ({
    id: theme.id,
    family: theme.family,
    label: theme.name,
    description: theme.description ?? "",
    colorScheme: theme.colorScheme,
  }));
}

export function listThemeFamilies(): ThemeFamily[] {
  const themes = listThemeDefinitions();
  const byFamily = new Map<string, ThemeDefinition[]>();
  for (const theme of themes) {
    const list = byFamily.get(theme.family) ?? [];
    list.push(theme);
    byFamily.set(theme.family, list);
  }

  const families: ThemeFamily[] = [];
  for (const [id, variants] of byFamily) {
    const dark =
      variants.find((theme) => theme.colorScheme === "dark") ?? variants[0]!;
    const light =
      variants.find((theme) => theme.colorScheme === "light") ?? dark;
    const label =
      FAMILY_LABELS[id] ??
      dark.name.replace(/\s+(Dark|Light|Mocha|Latte|Alucard)$/i, "").trim();
    families.push({
      id,
      label,
      description:
        dark.description ??
        light.description ??
        `${label} color theme.`,
      dark: dark.id,
      light: light.id,
      swatch: {
        dark: [
          dark.palette.background,
          dark.palette.ansi[5],
          dark.palette.ansi[6],
          dark.palette.ansi[2],
        ],
        light: [
          light.palette.background,
          light.palette.ansi[5],
          light.palette.ansi[6],
          light.palette.ansi[2],
        ],
      },
    });
  }

  return families.sort((a, b) => {
    const ai = FAMILY_ORDER.indexOf(a.id as (typeof FAMILY_ORDER)[number]);
    const bi = FAMILY_ORDER.indexOf(b.id as (typeof FAMILY_ORDER)[number]);
    const ao = ai === -1 ? FAMILY_ORDER.length : ai;
    const bo = bi === -1 ? FAMILY_ORDER.length : bi;
    if (ao !== bo) return ao - bo;
    return a.label.localeCompare(b.label);
  });
}

export function themeFamily(id: string): ThemeFamily {
  return (
    listThemeFamilies().find((family) => family.id === id) ??
    listThemeFamilies()[0]!
  );
}

export function themeIdFor(
  family: string,
  colorScheme: "dark" | "light",
): string {
  const info = themeFamily(family);
  return colorScheme === "light" ? info.light : info.dark;
}

/** Register a custom theme from HyperStudio theme JSON. */
export function registerThemeFromJson(
  source: string | unknown,
): ThemeDefinition {
  ensureCustomsLoaded();
  const theme = parseThemeJson(source);
  if (BUILTIN_THEME_IDS.has(theme.id)) {
    throw new Error(`Cannot overwrite built-in theme “${theme.id}”`);
  }
  customThemes.set(theme.id, theme);
  persistCustomThemes();
  return theme;
}

export function registerTheme(definition: ThemeDefinition): ThemeDefinition {
  return registerThemeFromJson(definition);
}

export function unregisterTheme(id: string): boolean {
  ensureCustomsLoaded();
  if (BUILTIN_THEME_IDS.has(id)) return false;
  const removed = customThemes.delete(id);
  if (removed) persistCustomThemes();
  return removed;
}

export function isBuiltinThemeId(id: string): boolean {
  return BUILTIN_THEME_IDS.has(id);
}
