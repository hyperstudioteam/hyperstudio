import type { ThemeTokens } from "./types";

/** Map ThemeTokens → `--hs-*` CSS custom properties. */
export const TOKEN_TO_CSS_VAR: Record<keyof ThemeTokens, string> = {
  bg: "--hs-bg",
  panel: "--hs-panel",
  panelRaised: "--hs-panel-raised",
  panelSoft: "--hs-panel-soft",
  titlebar: "--hs-titlebar",
  activity: "--hs-activity",
  surface: "--hs-surface",
  surfaceDeep: "--hs-surface-deep",
  surfaceInput: "--hs-surface-input",
  border: "--hs-border",
  borderBright: "--hs-border-bright",
  text: "--hs-text",
  textBright: "--hs-text-bright",
  muted: "--hs-muted",
  subtle: "--hs-subtle",
  accent: "--hs-accent",
  accentBright: "--hs-accent-bright",
  accentSoft: "--hs-accent-soft",
  green: "--hs-green",
  red: "--hs-red",
  danger: "--hs-danger",
  warn: "--hs-warn",
  blue: "--hs-blue",
  folder: "--hs-folder",
  pk: "--hs-pk",
  cellSelect: "--hs-cell-select",
  gridHead: "--hs-grid-head",
  gridRow: "--hs-grid-row",
  gridAlt: "--hs-grid-alt",
  gridHover: "--hs-grid-hover",
  gridLine: "--hs-grid-line",
  rowNum: "--hs-row-num",
  scrollbar: "--hs-scrollbar",
  scrollbarHover: "--hs-scrollbar-hover",
  syntaxFg: "--hs-syntax-fg",
  syntaxKeyword: "--hs-syntax-keyword",
  syntaxOperator: "--hs-syntax-operator",
  syntaxString: "--hs-syntax-string",
  syntaxNumber: "--hs-syntax-number",
  syntaxComment: "--hs-syntax-comment",
  syntaxType: "--hs-syntax-type",
  syntaxFunction: "--hs-syntax-function",
  syntaxProperty: "--hs-syntax-property",
  syntaxPunctuation: "--hs-syntax-punctuation",
  syntaxInvalid: "--hs-syntax-invalid",
  editorCaret: "--hs-editor-caret",
  editorSelection: "--hs-editor-selection",
  editorSelectionFg: "--hs-editor-selection-fg",
  editorGutter: "--hs-editor-gutter",
  editorGutterActive: "--hs-editor-gutter-active",
  editorGutterBorder: "--hs-editor-gutter-border",
  editorActiveLine: "--hs-editor-active-line",
  editorMatch: "--hs-editor-match",
  editorTooltipBg: "--hs-editor-tooltip-bg",
  editorTooltipBorder: "--hs-editor-tooltip-border",
  editorTooltipFg: "--hs-editor-tooltip-fg",
  editorTooltipSelected: "--hs-editor-tooltip-selected",
  editorPlaceholder: "--hs-editor-placeholder",
};

export type CssVarMap = Record<string, string>;

export function tokensToCssVars(tokens: ThemeTokens): CssVarMap {
  const vars: CssVarMap = {};
  for (const key of Object.keys(TOKEN_TO_CSS_VAR) as (keyof ThemeTokens)[]) {
    vars[TOKEN_TO_CSS_VAR[key]] = tokens[key];
  }
  return vars;
}

export function applyCssVars(target: HTMLElement, vars: CssVarMap) {
  for (const [name, value] of Object.entries(vars)) {
    target.style.setProperty(name, value);
  }
}
