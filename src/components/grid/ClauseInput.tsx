import { useEffect, useRef } from "react";
import {
  acceptCompletion,
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  completionStatus,
  startCompletion,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  HighlightStyle,
  bracketMatching,
  syntaxHighlighting,
} from "@codemirror/language";
import { SQLNamespace, sql } from "@codemirror/lang-sql";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import {
  EditorView,
  keymap,
  placeholder as placeholderExt,
  tooltips,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import {
  dialectFor,
  fromClauseColumnCompletionSource,
  tableClauseCompletionSource,
} from "../../lib/completionSchema";
import { ColumnNode, SchemaNode } from "../../types/schema";

export interface ClauseInputProps {
  value: string;
  columns: ColumnNode[];
  driver: string;
  mode: "where" | "orderBy";
  /** Schema -> table -> columns for subquery / qualified completions. */
  completionSchema?: SQLNamespace;
  schemas?: SchemaNode[];
  defaultSchema?: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  className?: string;
}

const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#c792ea" },
  { tag: tags.operator, color: "#89ddff" },
  { tag: [tags.string, tags.special(tags.string)], color: "#c3e88d" },
  { tag: [tags.number, tags.bool, tags.null], color: "#f78c6c" },
  { tag: tags.comment, color: "#5c6470", fontStyle: "italic" },
  { tag: tags.typeName, color: "#ffcb6b" },
  { tag: tags.propertyName, color: "#d8dce5" },
  { tag: [tags.variableName, tags.name], color: "#d8dce5" },
  { tag: tags.punctuation, color: "#8b93a1" },
]);

const theme = EditorView.theme(
  {
    "&": {
      height: "30px",
      flex: "1 1 0%",
      minWidth: "0",
      color: "#d2d7df",
      backgroundColor: "transparent",
      fontSize: "11px",
    },
    ".cm-scroller": {
      fontFamily: '"SFMono-Regular", Consolas, monospace',
      lineHeight: "30px",
      overflow: "hidden",
    },
    ".cm-content": {
      padding: "0",
      caretColor: "#9d90ff",
    },
    ".cm-line": {
      padding: "0",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#9d90ff" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      { backgroundColor: "#2b3a55" },
    ".cm-placeholder": {
      color: "#4a5260",
      fontStyle: "normal",
    },
    ".cm-tooltip": {
      border: "1px solid #363c48",
      borderRadius: "6px",
      backgroundColor: "#1c2028",
      boxShadow: "0 12px 40px rgba(0,0,0,.45)",
      zIndex: "50",
    },
    ".cm-tooltip.cm-tooltip-autocomplete": {
      padding: "4px 0",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul": {
      maxHeight: "14em",
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

/** Single-line CodeMirror field with column + subquery schema autocomplete. */
export function ClauseInput({
  value,
  columns,
  driver,
  mode,
  completionSchema = {},
  schemas = [],
  defaultSchema,
  placeholder = "",
  onChange,
  onSubmit,
  className,
}: ClauseInputProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageRef = useRef(new Compartment());
  const placeholderRef = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onSubmitRef = useRef(onSubmit);
  const syncingRef = useRef(false);
  onChangeRef.current = onChange;
  onSubmitRef.current = onSubmit;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          bracketMatching(),
          closeBrackets(),
          // Avoid clipping under overflow:hidden ancestors.
          tooltips({ parent: document.body }),
          autocompletion({
            activateOnTyping: true,
            closeOnBlur: true,
            maxRenderedOptions: 100,
          }),
          syntaxHighlighting(highlight),
          theme,
          EditorView.lineWrapping,
          EditorState.transactionFilter.of((tr) => {
            if (!tr.docChanged) return tr;
            const text = tr.newDoc.toString();
            if (!/[\r\n]/.test(text)) return tr;
            return {
              changes: {
                from: 0,
                to: tr.startState.doc.length,
                insert: text.replace(/[\r\n]+/g, " "),
              },
              selection: tr.newSelection,
            };
          }),
          Prec.highest(
            keymap.of([
              {
                key: "Enter",
                run: (target) => {
                  if (completionStatus(target.state) === "active") {
                    return acceptCompletion(target);
                  }
                  onSubmitRef.current();
                  return true;
                },
              },
              {
                key: "Mod-Space",
                run: startCompletion,
              },
            ]),
          ),
          keymap.of([
            { key: "Tab", run: acceptCompletion },
            ...closeBracketsKeymap,
            ...completionKeymap,
            ...historyKeymap,
            ...defaultKeymap.filter(
              (binding) =>
                binding.key !== "Enter" && binding.key !== "Mod-Enter",
            ),
          ]),
          languageRef.current.of([]),
          placeholderRef.current.of(placeholderExt(placeholder)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !syncingRef.current) {
              onChangeRef.current(update.state.doc.toString());
            }
            if (
              update.docChanged &&
              !syncingRef.current &&
              update.transactions.some((transaction) =>
                transaction.isUserEvent("input.type"),
              )
            ) {
              const cursor = update.state.selection.main.head;
              const beforeCursor = update.state.doc.sliceString(0, cursor);
              if (
                /\b(?:where|and|or|on|having|from|join|select|in)\s$/i.test(
                  beforeCursor,
                )
              ) {
                queueMicrotask(() => startCompletion(update.view));
              }
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
    // Mount once; value/language synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    syncingRef.current = true;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
    syncingRef.current = false;
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const support = sql({
      dialect: dialectFor(driver),
      schema: completionSchema,
      defaultSchema,
      upperCaseKeywords: true,
    });
    view.dispatch({
      effects: languageRef.current.reconfigure([
        support,
        // Each source must be its own language-data entry. An array here is
        // treated as completeFromList() options and breaks all completions.
        support.language.data.of({
          autocomplete: tableClauseCompletionSource(columns, mode),
        }),
        support.language.data.of({
          autocomplete: fromClauseColumnCompletionSource(
            schemas,
            defaultSchema,
          ),
        }),
      ]),
    });
  }, [columns, driver, mode, completionSchema, schemas, defaultSchema]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: placeholderRef.current.reconfigure(placeholderExt(placeholder)),
    });
  }, [placeholder]);

  return <div ref={hostRef} className={className} />;
}
