import { luminance, mix, withAlpha } from "./color";
import type { ThemeColorScheme, ThemePalette, ThemeTokens } from "./types";

/**
 * Derive the full HyperStudio token set from a terminal palette.
 * Optional `overrides` win after derivation (for hand-tuned builtins).
 */
export function deriveTokens(
  palette: ThemePalette,
  colorScheme: ThemeColorScheme,
  overrides: Partial<ThemeTokens> = {},
): ThemeTokens {
  const dark = colorScheme === "dark";
  const bg = palette.background;
  const fg = palette.foreground;
  const bright = palette.ansi[8] ?? mix(bg, fg, dark ? 0.22 : 0.35);
  const black = palette.ansi[0] ?? bg;
  const red = palette.ansi[1]!;
  const green = palette.ansi[2]!;
  const yellow = palette.ansi[3]!;
  const blue = palette.ansi[4]!;
  const purple = palette.ansi[5]!;
  const cyan = palette.ansi[6]!;
  const white = palette.ansi[7] ?? fg;

  const panel = dark ? mix(bg, white, 0.05) : mix(bg, black, 0.04);
  const panelRaised = dark ? mix(bg, white, 0.08) : mix(bg, black, 0.02);
  const panelSoft = dark ? mix(bg, white, 0.12) : mix(bg, black, 0.08);
  const surface = panel;
  const surfaceDeep = dark ? mix(bg, black, 0.25) : mix(bg, black, 0.03);
  const surfaceInput = dark ? mix(bg, black, 0.35) : mix(bg, black, 0.02);
  const titlebar = dark ? mix(bg, black, 0.2) : mix(bg, black, 0.05);
  const activity = dark ? mix(bg, black, 0.3) : mix(bg, black, 0.08);
  const border = dark ? mix(bg, white, 0.14) : mix(bg, black, 0.14);
  const borderBright = bright;
  const muted = mix(fg, bg, dark ? 0.45 : 0.42);
  const subtle = mix(fg, bg, dark ? 0.58 : 0.55);

  const derived: ThemeTokens = {
    bg,
    panel,
    panelRaised,
    panelSoft,
    titlebar,
    activity,
    surface,
    surfaceDeep,
    surfaceInput,
    border,
    borderBright,
    text: fg,
    textBright: white,
    muted,
    subtle,
    accent: purple,
    accentBright: purple,
    accentSoft: withAlpha(purple, dark ? 0.14 : 0.1),
    green,
    red,
    danger: red,
    warn: yellow,
    blue,
    folder: yellow,
    pk: yellow,
    cellSelect: palette.selectionBackground,
    gridHead: panel,
    gridRow: bg,
    gridAlt: surfaceDeep,
    gridHover: panelSoft,
    gridLine: border,
    rowNum: surfaceDeep,
    scrollbar: bright,
    scrollbarHover: mix(bright, fg, 0.25),
    syntaxFg: fg,
    syntaxKeyword: purple,
    syntaxOperator: cyan,
    syntaxString: green,
    syntaxNumber: yellow,
    syntaxComment: muted,
    syntaxType: yellow,
    syntaxFunction: blue,
    syntaxProperty: cyan,
    syntaxPunctuation: muted,
    syntaxInvalid: red,
    editorCaret: palette.cursor,
    editorSelection: palette.selectionBackground,
    editorSelectionFg: palette.selectionForeground,
    editorGutter: subtle,
    editorGutterActive: muted,
    editorGutterBorder: border,
    editorActiveLine: withAlpha(purple, dark ? 0.07 : 0.06),
    editorMatch: withAlpha(purple, dark ? 0.24 : 0.16),
    editorTooltipBg: panel,
    editorTooltipBorder: borderBright,
    editorTooltipFg: fg,
    editorTooltipSelected: palette.selectionBackground,
    editorPlaceholder: subtle,
  };

  // Prefer matching text-bright to foreground on near-white neon themes.
  if (dark && luminance(fg) > 0.9) {
    derived.textBright = fg;
  }

  return { ...derived, ...overrides };
}
