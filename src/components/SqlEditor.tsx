import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
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
import {
  ClipboardPaste,
  Copy,
  GitBranch,
  ListOrdered,
  Play,
  Scissors,
  WandSparkles,
} from "lucide-react";
import { dialectFor } from "../lib/completionSchema";
import { formatSql } from "../lib/sqlFormat";
import { ContextMenu } from "./ContextMenu";
import { useExtensionMenu } from "../extensions/hooks";
import { extensionRegistry } from "../extensions/registry";

export interface SqlEditorHandle {
  /** Selected text when there is a selection, otherwise the whole document. */
  getSqlToRun: () => string;
  getSql: () => string;
  getSelectedSql: () => string;
  insertSql: (sql: string) => void;
  replaceSelection: (sql: string) => void;
  /** Pretty-print the selection, or the whole buffer when nothing is selected. */
  format: () => void;
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
  /** Reports a formatter parse failure so the workspace can surface it. */
  onFormatError?: (message: string) => void;
  /** Disable Run / Format while a query is in flight. */
  actionsDisabled?: boolean;
  onExplain?: () => void;
  explainDisabled?: boolean;
  /** Shown only when the buffer has multiple statements. */
  onRunScript?: () => void;
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
    {
      value,
      driver,
      completionSchema,
      defaultSchema,
      onChange,
      onRun,
      onFormatError,
      actionsDisabled = false,
      onExplain,
      explainDisabled = false,
      onRunScript,
    },
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const extensionMenu = useExtensionMenu("editor/context");
    const languageRef = useRef(new Compartment());
    const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
    const [hasSelection, setHasSelection] = useState(false);
    // Keep callbacks current without tearing down the editor on every render.
    const onChangeRef = useRef(onChange);
    const onRunRef = useRef(onRun);
    const driverRef = useRef(driver);
    const onFormatErrorRef = useRef(onFormatError);
    const setMenuRef = useRef(setMenu);
    onChangeRef.current = onChange;
    onRunRef.current = onRun;
    driverRef.current = driver;
    onFormatErrorRef.current = onFormatError;
    setMenuRef.current = setMenu;

    function sqlToRun(view: EditorView) {
      const { from, to } = view.state.selection.main;
      return from === to
        ? view.state.doc.toString()
        : view.state.sliceDoc(from, to);
    }

    function formatDoc(view: EditorView) {
      const { from, to } = view.state.selection.main;
      const wholeDoc = from === to;
      const source = wholeDoc
        ? view.state.doc.toString()
        : view.state.sliceDoc(from, to);
      if (!source.trim()) return;

      let formatted: string;
      try {
        formatted = formatSql(source, driverRef.current);
      } catch (error) {
        onFormatErrorRef.current?.(
          error instanceof Error ? error.message : String(error),
        );
        return;
      }
      if (formatted === source) return;

      const range = wholeDoc
        ? { from: 0, to: view.state.doc.length }
        : { from, to };
      view.dispatch({
        changes: { ...range, insert: formatted },
        selection: { anchor: range.from + formatted.length },
      });
    }

    function selectionText(view: EditorView) {
      const { from, to } = view.state.selection.main;
      return from === to ? "" : view.state.sliceDoc(from, to);
    }

    async function copySelection() {
      const view = viewRef.current;
      if (!view) return;
      const text = selectionText(view);
      if (!text) return;
      await navigator.clipboard.writeText(text);
    }

    async function cutSelection() {
      const view = viewRef.current;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      if (from === to) return;
      await navigator.clipboard.writeText(view.state.sliceDoc(from, to));
      view.dispatch({ changes: { from, to, insert: "" } });
      view.focus();
    }

    async function pasteClipboard() {
      const view = viewRef.current;
      if (!view) return;
      const text = await navigator.clipboard.readText();
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
      });
      view.focus();
    }

    useImperativeHandle(ref, () => ({
      getSqlToRun: () =>
        viewRef.current ? sqlToRun(viewRef.current) : "",
      getSql: () => viewRef.current?.state.doc.toString() ?? "",
      getSelectedSql: () => {
        const view = viewRef.current;
        if (!view) return "";
        const { from, to } = view.state.selection.main;
        return from === to ? "" : view.state.sliceDoc(from, to);
      },
      insertSql: (sql) => {
        const view = viewRef.current;
        if (!view) return;
        const position = view.state.selection.main.to;
        view.dispatch({
          changes: { from: position, insert: sql },
          selection: { anchor: position + sql.length },
        });
        view.focus();
      },
      replaceSelection: (sql) => {
        const view = viewRef.current;
        if (!view) return;
        const { from, to } = view.state.selection.main;
        view.dispatch({
          changes: { from, to, insert: sql },
          selection: { anchor: from + sql.length },
        });
        view.focus();
      },
      format: () => {
        if (viewRef.current) formatDoc(viewRef.current);
      },
      focus: () => viewRef.current?.focus(),
    }));

    useEffect(() => {
      if (!menu) return;
      const close = () => setMenu(null);
      window.addEventListener("click", close);
      window.addEventListener("blur", close);
      return () => {
        window.removeEventListener("click", close);
        window.removeEventListener("blur", close);
      };
    }, [menu]);

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
              {
                key: "Shift-Alt-f",
                preventDefault: true,
                run: (target) => {
                  formatDoc(target);
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
            EditorView.domEventHandlers({
              contextmenu(event) {
                event.preventDefault();
                const target = viewRef.current;
                if (target) {
                  const { from, to } = target.state.selection.main;
                  setHasSelection(from !== to);
                }
                setMenuRef.current({ x: event.clientX, y: event.clientY });
                return true;
              },
            }),
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

    function closeMenu() {
      setMenu(null);
    }

    return (
      <>
        <div className="flex-1 min-w-0 overflow-hidden" ref={hostRef} />
        {menu && (
          <ContextMenu x={menu.x} y={menu.y}>
            <button
              type="button"
              disabled={!hasSelection}
              onClick={() => {
                void cutSelection();
                closeMenu();
              }}
            >
              <Scissors size={14} />
              Cut
              <kbd className="ml-auto rounded-[3px] border border-border bg-[rgba(0,0,0,.15)] px-1 py-px font-mono text-[8px] text-subtle">
                ⌘X
              </kbd>
            </button>
            <button
              type="button"
              disabled={!hasSelection}
              onClick={() => {
                void copySelection();
                closeMenu();
              }}
            >
              <Copy size={14} />
              Copy
              <kbd className="ml-auto rounded-[3px] border border-border bg-[rgba(0,0,0,.15)] px-1 py-px font-mono text-[8px] text-subtle">
                ⌘C
              </kbd>
            </button>
            <button
              type="button"
              onClick={() => {
                void pasteClipboard();
                closeMenu();
              }}
            >
              <ClipboardPaste size={14} />
              Paste
              <kbd className="ml-auto rounded-[3px] border border-border bg-[rgba(0,0,0,.15)] px-1 py-px font-mono text-[8px] text-subtle">
                ⌘V
              </kbd>
            </button>

            <div className="my-1 h-px bg-border" />

            <button
              type="button"
              disabled={actionsDisabled}
              onClick={() => {
                if (viewRef.current) formatDoc(viewRef.current);
                closeMenu();
              }}
            >
              <WandSparkles size={14} />
              Format
              <kbd className="ml-auto rounded-[3px] border border-border bg-[rgba(0,0,0,.15)] px-1 py-px font-mono text-[8px] text-subtle">
                ⇧⌥F
              </kbd>
            </button>

            <div className="my-1 h-px bg-border" />

            {onExplain && (
              <button
                type="button"
                disabled={explainDisabled}
                onClick={() => {
                  onExplain();
                  closeMenu();
                }}
              >
                <GitBranch size={14} />
                Explain
              </button>
            )}
            <button
              type="button"
              disabled={actionsDisabled}
              onClick={() => {
                if (viewRef.current) onRun(sqlToRun(viewRef.current));
                closeMenu();
              }}
            >
              <Play size={14} fill="currentColor" />
              Run
              <kbd className="ml-auto rounded-[3px] border border-border bg-[rgba(0,0,0,.15)] px-1 py-px font-mono text-[8px] text-subtle">
                ⌘↵
              </kbd>
            </button>
            {onRunScript && (
              <button
                type="button"
                disabled={actionsDisabled}
                onClick={() => {
                  onRunScript();
                  closeMenu();
                }}
              >
                <ListOrdered size={14} />
                Run script
              </button>
            )}
            {extensionMenu.length > 0 && (
              <div className="my-1 h-px bg-border" />
            )}
            {extensionMenu.map((item) => (
              <button
                type="button"
                key={`${item.source}:${item.command}`}
                onClick={() => {
                  const view = viewRef.current;
                  const selectedSql = view
                    ? (() => {
                        const { from, to } = view.state.selection.main;
                        return from === to ? "" : view.state.sliceDoc(from, to);
                      })()
                    : "";
                  extensionRegistry.executeCommand(item.command, {
                    sql: view?.state.doc.toString() ?? "",
                    selectedSql,
                    driver,
                  });
                  closeMenu();
                }}
              >
                <WandSparkles size={14} />
                {item.title}
              </button>
            ))}
          </ContextMenu>
        )}
      </>
    );
  },
);
