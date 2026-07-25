import { useCallback, useEffect, useState } from "react";
import { FolderOpen, LoaderCircle, Puzzle, Trash2, X } from "lucide-react";
import { pluginsApi } from "../api/database";
import { errorMessage } from "../lib/format";
import { InstalledPluginInfo } from "../types/connection";

interface PluginsPanelProps {
  onClose: () => void;
  onDriversChanged?: () => void;
}

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
      className="modal-backdrop"
      onMouseDown={(event) =>
        event.target === event.currentTarget && onClose()
      }
    >
      <div className="connection-modal wide plugins-panel">
        <div className="modal-heading">
          <div>
            <span className="db-icon">
              <Puzzle size={17} />
            </span>
            <h2>Plugins</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>

        <p className="plugins-intro">
          Install driver plugins from a local folder or zip. Plugins speak
          JSON-RPC over stdin/stdout and appear in the connection form
          immediately. Built-in Postgres and MySQL cannot be shadowed.
        </p>

        <div className="plugins-install">
          <label className="full">
            Plugin path
            <input
              value={sourcePath}
              placeholder="/path/to/plugin or plugin.zip"
              onChange={(event) => setSourcePath(event.target.value)}
              disabled={busy}
            />
          </label>
          <button
            type="button"
            className="primary-button"
            disabled={busy}
            onClick={() => void install()}
          >
            {busy ? (
              <LoaderCircle className="spin" size={14} />
            ) : (
              <FolderOpen size={14} />
            )}
            Install
          </button>
        </div>

        <div className="plugins-list">
          {plugins.length === 0 ? (
            <div className="plugins-empty">No plugins installed yet.</div>
          ) : (
            plugins.map((plugin) => (
              <div key={plugin.id} className="plugin-row">
                <div>
                  <strong>
                    {plugin.name}{" "}
                    <span className="plugin-version">v{plugin.version}</span>
                  </strong>
                  <em>{plugin.description || plugin.id}</em>
                  <code>{plugin.path}</code>
                </div>
                <div className="plugin-actions">
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={plugin.enabled}
                      disabled={busy}
                      onChange={() => void toggle(plugin)}
                    />
                    <span>Enabled</span>
                  </label>
                  <button
                    type="button"
                    className="ghost-button danger"
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

        {status && <div className="test-status">{status}</div>}

        <div className="modal-actions">
          <div />
          <button type="button" className="ghost-button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
