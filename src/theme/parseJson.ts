import { isHexColor, normalizeHex } from "./color";
import type {
  AnsiPalette,
  ThemeColorScheme,
  ThemeDefinition,
  ThemePalette,
  ThemeTokens,
} from "./types";

function requireHex(value: unknown, field: string): string {
  if (!isHexColor(value)) {
    throw new Error(`Theme JSON missing/invalid color: ${field}`);
  }
  return normalizeHex(value);
}

function parseAnsi(raw: unknown): AnsiPalette {
  if (Array.isArray(raw)) {
    if (raw.length !== 16) {
      throw new Error("Theme JSON palette array must have 16 colors");
    }
    return raw.map((color, index) =>
      requireHex(color, `palette[${index}]`),
    ) as unknown as AnsiPalette;
  }
  if (raw && typeof raw === "object") {
    const map = raw as Record<string, unknown>;
    const colors: string[] = [];
    for (let i = 0; i < 16; i += 1) {
      colors.push(requireHex(map[String(i)], `palette.${i}`));
    }
    return colors as unknown as AnsiPalette;
  }
  throw new Error("Theme JSON requires palette as array[16] or map 0–15");
}

function readColor(
  data: Record<string, unknown>,
  keys: string[],
  field: string,
  fallback?: string,
): string {
  for (const key of keys) {
    if (data[key] != null) return requireHex(data[key], field);
  }
  if (fallback) return normalizeHex(fallback);
  throw new Error(`Theme JSON missing/invalid color: ${field}`);
}

function parsePalette(data: Record<string, unknown>): ThemePalette {
  const ansi = parseAnsi(data.palette ?? data.ansi);
  const background = readColor(data, ["background", "bg"], "background");
  const foreground = readColor(data, ["foreground", "fg"], "foreground");
  const cursor = readColor(data, ["cursor"], "cursor", foreground);
  const selectionBackground = readColor(
    data,
    ["selectionBackground", "selection"],
    "selectionBackground",
    ansi[8],
  );
  const selectionForeground = readColor(
    data,
    ["selectionForeground"],
    "selectionForeground",
    foreground,
  );

  return {
    background,
    foreground,
    cursor,
    selectionBackground,
    selectionForeground,
    ansi,
  };
}

function parseTokenOverrides(
  raw: unknown,
): Partial<ThemeTokens> | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Theme JSON tokens must be an object");
  }
  const out: Partial<ThemeTokens> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "string") {
      throw new Error(`Theme token ${key} must be a string color`);
    }
    (out as Record<string, string>)[key] = value.trim();
  }
  return out;
}

/**
 * Parse a HyperStudio theme JSON document.
 *
 * ```json
 * {
 *   "id": "cyberdream",
 *   "name": "Cyberdream Dark",
 *   "family": "cyberdream",
 *   "colorScheme": "dark",
 *   "background": "#16181a",
 *   "foreground": "#ffffff",
 *   "cursor": "#ffffff",
 *   "selectionBackground": "#3c4048",
 *   "selectionForeground": "#ffffff",
 *   "palette": ["#16181a", "#ff6e5e", "..."],
 *   "tokens": { "panel": "#1e2124" }
 * }
 * ```
 */
export function parseThemeJson(source: string | unknown): ThemeDefinition {
  const data =
    typeof source === "string"
      ? (JSON.parse(source) as Record<string, unknown>)
      : (source as Record<string, unknown>);

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Theme JSON must be an object");
  }

  const id = typeof data.id === "string" ? data.id.trim() : "";
  if (!id) throw new Error("Theme JSON requires string id");

  const name =
    typeof data.name === "string" && data.name.trim()
      ? data.name.trim()
      : id;
  const family =
    typeof data.family === "string" && data.family.trim()
      ? data.family.trim()
      : id;
  const colorScheme = data.colorScheme ?? data.scheme;
  if (colorScheme !== "dark" && colorScheme !== "light") {
    throw new Error('Theme JSON requires colorScheme "dark" or "light"');
  }

  return {
    id,
    name,
    family,
    colorScheme: colorScheme as ThemeColorScheme,
    description:
      typeof data.description === "string" ? data.description : undefined,
    palette: parsePalette(data),
    tokens: parseTokenOverrides(data.tokens),
  };
}
