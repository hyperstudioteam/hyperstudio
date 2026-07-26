import { useCallback, useEffect, useState } from "react";
import { FolderOpen, LoaderCircle, Puzzle, Trash2, X } from "lucide-react";
import { pluginsApi } from "../api/database";
import { errorMessage } from "../lib/format";
import { cn } from "../lib/cn";
import { InstalledPluginInfo } from "../types/connection";

interface PluginsPanelProps {
  onClose: () => void;
  onDriversChanged?: () => void;
}

const iconButtonClass = cn(
  "grid h-7 w-7 cursor-pointer place-items-center rounded-[5px] border-0 bg-transparent p-0 text-muted",
  "enabled:hover:bg-panel-soft enabled:hover:text-text",
  "disabled:cursor-default disabled:opacity-40",
);

export function PluginsPanel({ onClose, onDriversChanged }: PluginsPanelProps) {
  const [plugins, setPlugins] = useState<InstalledPluginInfo[]>([]);
  const [sourcePath, setSourcePath] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const refresh = useCallback(async () => {
    const listed = await pluginsApi.list();
    setPlugins(listed);
  }, []);

  useEffect(() => {
    void refresh().catch((error) => setStatus(errorMessage(error)));
  }, [refresh]);

  async function install() {
    const path = sourcePath.trim();
    if (!path) {
      setStatus("Enter a plugin folder or .zip path.");
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const installed = await pluginsApi.install(path);
      setSourcePath("");
      await refresh();
      onDriversChanged?.();
      setStatus(`Installed ${installed.name} v${installed.version}`);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(plugin: InstalledPluginInfo) {
    setBusy(true);
    setStatus("");
    try {
      await pluginsApi.setEnabled(plugin.id, !plugin.enabled);
      await refresh();
      onDriversChanged?.();
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function remove(plugin: InstalledPluginInfo) {
    if (!window.confirm(`Uninstall plugin “${plugin.name}”?`)) return;
    setBusy(true);
    setStatus("");
    try {
      await pluginsApi.uninstall(plugin.id);
      await refresh();
      onDriversChanged?.();
      setStatus(`Uninstalled ${plugin.name}`);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-20 grid place-items-center bg-[rgba(5,7,10,0.72)] p-5 backdrop-blur-sm"
      onMouseDown={(event) =>
        event.target === event.currentTarget && onClose()
      }
    >
      <div className="max-h-full w-[min(560px,100%)] overflow-auto rounded-[10px] border border-border-bright bg-surface p-[18px] shadow-[0_24px_70px_rgba(0,0,0,0.48)]">
        <div className="mb-[17px] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="grid h-[27px] w-[27px] shrink-0 place-items-center rounded-md">
              <Puzzle size={17} />
            </span>
            <h2 className="m-0 text-sm font-[630] text-text-bright">Plugins</h2>
          </div>
          <button
            type="button"
            className={iconButtonClass}
            aria-label="Close"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>

        <p className="mb-3.5 text-xs leading-normal text-muted">
          Install driver plugins from a local folder or zip. Plugins speak
          JSON-RPC over stdin/stdout and appear in the connection form
          immediately. Built-in Postgres and MySQL cannot be shadowed.
        </p>

        <div className="mb-4 grid grid-cols-[1fr_auto] items-end gap-2.5">
          <label className="flex flex-col gap-1.5 text-[11px] text-muted">
            Plugin path
            <input
              className="h-[34px] w-full rounded-[5px] border border-border-bright bg-surface-input px-[9px] text-[11px] text-[#d2d7df] focus:border-accent"
              value={sourcePath}
              placeholder="/path/to/plugin or plugin.zip"
              onChange={(event) => setSourcePath(event.target.value)}
              disabled={busy}
            />
          </label>
          <button
            type="button"
            className="inline-flex h-[31px] cursor-pointer items-center gap-1.5 rounded-[5px] border border-[#7667e7] bg-[#6959da] px-[11px] text-[10px] font-[580] text-white hover:bg-[#7767e7] disabled:opacity-50"
            disabled={busy}
            onClick={() => void install()}
          >
            {busy ? (
              <LoaderCircle className="animate-spin-slow" size={14} />
            ) : (
              <FolderOpen size={14} />
            )}
            Install
          </button>
        </div>

        <div className="mb-3 flex max-h-80 flex-col gap-2.5 overflow-auto">
          {plugins.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-[18px] text-center text-xs text-muted">
              No plugins installed yet.
            </div>
          ) : (
            plugins.map((plugin) => (
              <div
                key={plugin.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface-deep p-3"
              >
                <div>
                  <strong className="block text-[13px]">
                    {plugin.name}{" "}
                    <span className="text-[11px] font-medium text-muted">
                      v{plugin.version}
                    </span>
                  </strong>
                  <em className="mt-1 block text-xs not-italic text-muted">
                    {plugin.description || plugin.id}
                  </em>
                  <code className="mt-1.5 block break-all font-mono text-[10px] text-subtle">
                    {plugin.path}
                  </code>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <label className="flex cursor-pointer items-center gap-2 text-[11px] text-[#b4bbc6]">
                    <input
                      type="checkbox"
                      className="m-0 h-3.5 w-3.5 shrink-0 cursor-pointer accent-accent"
                      checked={plugin.enabled}
                      disabled={busy}
                      onChange={() => void toggle(plugin)}
                    />
                    <span>Enabled</span>
                  </label>
                  <button
                    type="button"
                    className="inline-flex h-[31px] cursor-pointer items-center rounded-[5px] border-0 bg-transparent px-[11px] text-[10px] font-[580] text-red hover:bg-panel-soft hover:text-white disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void remove(plugin)}
                    aria-label={`Uninstall ${plugin.name}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {status && (
          <div className="mt-3 rounded-[5px] bg-[rgba(239,107,115,0.08)] px-2.5 py-2 text-[10px] [overflow-wrap:anywhere] text-[#d18b91]">
            {status}
          </div>
        )}

        <div className="mt-[18px] flex items-center justify-between gap-2 border-t border-border pt-3.5">
          <div />
          <button
            type="button"
            className="inline-flex h-[31px] cursor-pointer items-center rounded-[5px] border-0 bg-transparent px-[11px] text-[10px] font-[580] text-muted hover:bg-panel-soft hover:text-white"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
