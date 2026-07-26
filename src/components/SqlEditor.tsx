import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import {
  acceptCompletion,
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  HighlightStyle,
  bracketMatching,
  syntaxHighlighting,
} from "@codemirror/language";
import { SQLNamespace, sql } from "@codemirror/lang-sql";
import { Compartment, EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { dialectFor } from "../lib/completionSchema";

export interface SqlEditorHandle {
  /** Selected text when there is a selection, otherwise the whole document. */
  getSqlToRun: () => string;
  focus: () => void;
}

interface SqlEditorProps {
  value: string;
  driver: string;
  /** schema -> table -> columns, used for autocompletion. */
  completionSchema: SQLNamespace;
  /** Schema that bare table names resolve against. */
  defaultSchema?: string;
  onChange: (value: string) => void;
  onRun: (sql: string) => void;
}

const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#c792ea" },
  { tag: tags.operator, color: "#89ddff" },
  { tag: [tags.string, tags.special(tags.string)], color: "#c3e88d" },
  { tag: [tags.number, tags.bool, tags.null], color: "#f78c6c" },
  { tag: tags.comment, color: "#5c6470", fontStyle: "italic" },
  { tag: tags.typeName, color: "#ffcb6b" },
  { tag: tags.function(tags.variableName), color: "#82aaff" },
  { tag: tags.propertyName, color: "#d8dce5" },
  { tag: [tags.variableName, tags.name], color: "#d8dce5" },
  { tag: tags.punctuation, color: "#8b93a1" },
  { tag: tags.invalid, color: "#ef6b73" },
]);

const theme = EditorView.theme(
  {
    "&": {
      height: "100%",
      color: "#d8dce5",
      backgroundColor: "transparent",
      fontSize: "12px",
    },
    ".cm-scroller": {
      fontFamily: '"SFMono-Regular", Consolas, monospace',
      lineHeight: "22px",
      overflow: "auto",
    },
    ".cm-content": {
      padding: "11px 0",
      caretColor: "#9d90ff",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#9d90ff" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      { backgroundColor: "#2b3a55" },
    ".cm-gutters": {
      minWidth: "41px",
      padding: "11px 0",
      color: "#454d5a",
      backgroundColor: "transparent",
      borderRight: "1px solid #1d2129",
    },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 8px" },
    ".cm-activeLine": { backgroundColor: "rgba(139,124,246,.05)" },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
      color: "#7d8694",
    },
    ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
      backgroundColor: "rgba(139,124,246,.22)",
      outline: "none",
    },
    ".cm-tooltip": {
      border: "1px solid #363c48",
      borderRadius: "6px",
      backgroundColor: "#1c2028",
      boxShadow: "0 12px 40px rgba(0,0,0,.45)",
    },
    ".cm-tooltip.cm-tooltip-autocomplete": {
      padding: "4px 0",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul": {
      maxHeight: "16em",
      fontFamily: '"SFMono-Regular", Consolas, monospace',
      fontSize: "11px",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
      display: "flex",
      alignItems: "center",
      gap: "7px",
      padding: "0 10px",
      height: "24px",
      color: "#c4cad4",
    },
    ".cm-tooltip-autocomplete ul li[aria-selected]": {
      backgroundColor: "#2a3344",
      color: "#fff",
    },
    ".cm-completionLabel": { flex: "0 0 auto" },
    ".cm-completionMatchedText": {
      textDecoration: "none",
      color: "#9d90ff",
      fontWeight: "600",
    },
    ".cm-completionDetail": {
      marginLeft: "auto",
      paddingLeft: "14px",
      color: "#606979",
      fontStyle: "normal",
      fontSize: "10px",
    },
    ".cm-completionIcon": {
      width: "14px",
      paddingRight: "0",
      opacity: "0.75",
      fontSize: "11px",
    },
  },
  { dark: true },
);

export const SqlEditor = forwardRef<SqlEditorHandle, SqlEditorProps>(
  function SqlEditor(
    { value, driver, completionSchema, defaultSchema, onChange, onRun },
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const languageRef = useRef(new Compartment());
    // Keep callbacks current without tearing down the editor on every render.
    const onChangeRef = useRef(onChange);
    const onRunRef = useRef(onRun);
    onChangeRef.current = onChange;
    onRunRef.current = onRun;

    function sqlToRun(view: EditorView) {
      const { from, to } = view.state.selection.main;
      return from === to
        ? view.state.doc.toString()
        : view.state.sliceDoc(from, to);
    }

    useImperativeHandle(ref, () => ({
      getSqlToRun: () =>
        viewRef.current ? sqlToRun(viewRef.current) : "",
      focus: () => viewRef.current?.focus(),
    }));

    useEffect(() => {
      if (!hostRef.current) return;

      const view = new EditorView({
        parent: hostRef.current,
        state: EditorState.create({
          doc: value,
          extensions: [
            lineNumbers(),
            highlightActiveLineGutter(),
            highlightActiveLine(),
            highlightSpecialChars(),
            drawSelection(),
            history(),
            bracketMatching(),
            closeBrackets(),
            autocompletion({
              activateOnTyping: true,
              closeOnBlur: true,
              maxRenderedOptions: 200,
            }),
            syntaxHighlighting(highlight),
            keymap.of([
              {
                key: "Mod-Enter",
                preventDefault: true,
                run: (target) => {
                  onRunRef.current(sqlToRun(target));
                  return true;
                },
              },
              { key: "Tab", run: acceptCompletion },
              ...closeBracketsKeymap,
              ...completionKeymap,
              ...historyKeymap,
              ...defaultKeymap,
              indentWithTab,
            ]),
            languageRef.current.of([]),
            theme,
            EditorView.updateListener.of((update) => {
              if (update.docChanged) {
                onChangeRef.current(update.state.doc.toString());
              }
            }),
          ],
        }),
      });

      viewRef.current = view;
      return () => {
        view.destroy();
        viewRef.current = null;
      };
      // Mount once; content and language are synced by the effects below.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Reconfigure the dialect and completion data as metadata arrives.
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: languageRef.current.reconfigure(
          sql({
            dialect: dialectFor(driver),
            schema: completionSchema,
            defaultSchema,
            upperCaseKeywords: true,
          }),
        ),
      });
    }, [driver, completionSchema, defaultSchema]);

    // Pull in external edits, such as View Data replacing the buffer.
    useEffect(() => {
      const view = viewRef.current;
      if (!view || value === view.state.doc.toString()) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    }, [value]);

    return <div className="flex-1 min-w-0 overflow-hidden" ref={hostRef} />;
  },
);
