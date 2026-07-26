import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { LoaderCircle, X } from "lucide-react";
import { pluginsApi } from "../api/database";
import { errorMessage } from "../lib/format";
import { cn } from "../lib/cn";
import { extensionRegistry } from "./registry";
import type { ExtensionCommandContext, RegisteredView } from "./types";

const PROTOCOL = "hyperstudio-extension-v1";

interface ExtensionViewProps {
  view: RegisteredView;
  context: ExtensionCommandContext;
  onClose: () => void;
  getEditorSql: () => string;
  getSelectedSql: () => string;
  insertEditorSql: (sql: string) => void;
  replaceSelection: (sql: string) => void;
}

interface ExtensionRequest {
  protocol: typeof PROTOCOL;
  type: "request";
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export function ExtensionView({
  view,
  context,
  onClose,
  getEditorSql,
  getSelectedSql,
  insertEditorSql,
  replaceSelection,
}: ExtensionViewProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [src, setSrc] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  useEffect(() => {
    let active = true;
    setSrc("");
    setError("");
    void pluginsApi
      .resolveAsset(view.source, view.entry)
      .then((path) => {
        if (active) setSrc(convertFileSrc(path));
      })
      .catch((reason) => {
        if (active) setError(errorMessage(reason));
      });
    return () => {
      active = false;
    };
  }, [view.entry, view.source]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const request = event.data as Partial<ExtensionRequest>;
      if (
        request.protocol !== PROTOCOL ||
        request.type !== "request" ||
        typeof request.id !== "string" ||
        typeof request.method !== "string"
      ) {
        return;
      }
      const respond = (result?: unknown, requestError?: string) => {
        frameRef.current?.contentWindow?.postMessage(
          {
            protocol: PROTOCOL,
            type: "response",
            id: request.id,
            result,
            error: requestError,
          },
          "*",
        );
      };

      try {
        switch (request.method) {
          case "getEditorSql":
            respond(getEditorSql());
            break;
          case "getSelectedSql":
            respond(getSelectedSql());
            break;
          case "insertEditorSql":
            insertEditorSql(String(request.params?.sql ?? ""));
            respond(true);
            break;
          case "replaceSelection":
            replaceSelection(String(request.params?.sql ?? ""));
            respond(true);
            break;
          case "executeCommand":
            respond(
              extensionRegistry.executeCommand(
                String(request.params?.command ?? ""),
                context,
              ),
            );
            break;
          case "showToast":
            setToast(String(request.params?.message ?? ""));
            respond(true);
            break;
          case "rpc": {
            const { method, params } = request.params ?? {};
            void pluginsApi
              .rpc(
                view.source,
                String(method ?? ""),
                (params as Record<string, unknown> | undefined) ?? {},
              )
              .then((result) => respond(result))
              .catch((reason) => respond(undefined, errorMessage(reason)));
            break;
          }
          case "closeView":
            respond(true);
            onClose();
            break;
          default:
            respond(undefined, `Unsupported host method: ${request.method}`);
        }
      } catch (reason) {
        respond(undefined, errorMessage(reason));
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [
    context,
    getEditorSql,
    getSelectedSql,
    insertEditorSql,
    onClose,
    replaceSelection,
    view.source,
  ]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  function initialize() {
    frameRef.current?.contentWindow?.postMessage(
      {
        protocol: PROTOCOL,
        type: "event",
        event: "init",
        payload: {
          viewId: view.id,
          extensionId: view.source,
          context,
          theme: document.documentElement.dataset.theme ?? "dark",
        },
      },
      "*",
    );
  }

  return (
    <aside
      className={cn(
        "relative flex w-[340px] shrink-0 flex-col border-l border-border bg-panel",
        view.location === "panel.modal" &&
          "fixed left-1/2 top-1/2 z-30 h-[min(680px,calc(100vh-48px))] w-[min(520px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 rounded-lg border shadow-2xl",
      )}
    >
      <header className="flex h-9 shrink-0 items-center justify-between border-b border-border bg-[#14171b] px-3">
        <strong className="truncate text-[11px] font-semibold text-text-bright">
          {view.name}
        </strong>
        <button
          type="button"
          className="grid h-7 w-7 place-items-center rounded-[5px] border-0 bg-transparent text-muted hover:bg-panel-soft hover:text-text"
          aria-label={`Close ${view.name}`}
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </header>
      {error ? (
        <div className="p-4 text-xs leading-relaxed text-danger">{error}</div>
      ) : src ? (
        <iframe
          ref={frameRef}
          title={view.name}
          src={src}
          sandbox="allow-scripts allow-forms"
          className="min-h-0 flex-1 border-0 bg-transparent"
          onLoad={initialize}
        />
      ) : (
        <div className="grid flex-1 place-items-center text-muted">
          <LoaderCircle className="animate-spin-slow" size={18} />
        </div>
      )}
      {toast && (
        <div className="absolute inset-x-3 bottom-3 rounded-md border border-border-bright bg-surface px-3 py-2 text-[11px] text-text shadow-lg">
          {toast}
        </div>
      )}
    </aside>
  );
}
