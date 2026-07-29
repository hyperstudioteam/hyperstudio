/** 16-color base palette (indices 0–15) used to derive app chrome tokens. */
export type AnsiPalette = readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

/**
 * Core theme palette. App chrome / editor tokens are derived from this
 * unless overridden in `ThemeDefinition.tokens`.
 */
export interface ThemePalette {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  selectionForeground: string;
  ansi: AnsiPalette;
}

/** Resolved HyperStudio CSS token values (without the `--hs-` prefix). */
export interface ThemeTokens {
  bg: string;
  panel: string;
  panelRaised: string;
  panelSoft: string;
  titlebar: string;
  activity: string;
  surface: string;
  surfaceDeep: string;
  surfaceInput: string;
  border: string;
  borderBright: string;
  text: string;
  textBright: string;
  muted: string;
  subtle: string;
  accent: string;
  accentBright: string;
  accentSoft: string;
  green: string;
  red: string;
  danger: string;
  warn: string;
  blue: string;
  folder: string;
  pk: string;
  cellSelect: string;
  gridHead: string;
  gridRow: string;
  gridAlt: string;
  gridHover: string;
  gridLine: string;
  rowNum: string;
  scrollbar: string;
  scrollbarHover: string;
  syntaxFg: string;
  syntaxKeyword: string;
  syntaxOperator: string;
  syntaxString: string;
  syntaxNumber: string;
  syntaxComment: string;
  syntaxType: string;
  syntaxFunction: string;
  syntaxProperty: string;
  syntaxPunctuation: string;
  syntaxInvalid: string;
  editorCaret: string;
  editorSelection: string;
  editorSelectionFg: string;
  editorGutter: string;
  editorGutterActive: string;
  editorGutterBorder: string;
  editorActiveLine: string;
  editorMatch: string;
  editorTooltipBg: string;
  editorTooltipBorder: string;
  editorTooltipFg: string;
  editorTooltipSelected: string;
  editorPlaceholder: string;
}

export type ThemeColorScheme = "dark" | "light";

/** Canonical HyperStudio theme document (JSON). */
export interface ThemeDefinition {
  id: string;
  name: string;
  /** Groups dark/light variants in Settings (e.g. "cyberdream"). */
  family: string;
  colorScheme: ThemeColorScheme;
  description?: string;
  palette: ThemePalette;
  /** Optional overrides after palette → token derivation. */
  tokens?: Partial<ThemeTokens>;
}

export interface ThemeFamily {
  id: string;
  label: string;
  description: string;
  dark: string;
  light: string;
  swatch: {
    dark: readonly [string, string, string, string];
    light: readonly [string, string, string, string];
  };
}

export type ThemeId = string;
export type ThemeFamilyId = string;

export interface ThemeInfo {
  id: string;
  family: string;
  label: string;
  description: string;
  colorScheme: ThemeColorScheme;
}
