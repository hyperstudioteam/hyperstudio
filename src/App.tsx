import { useEffect, useRef, useState } from "react";
import { Group, Panel, useDefaultLayout } from "react-resizable-panels";
import { X } from "lucide-react";
import { TitleBar } from "./components/TitleBar";
import { ActivityBar } from "./components/ActivityBar";
import { ConnectionSidebar } from "./components/ConnectionSidebar";
import { PanelResizeHandle } from "./components/PanelResizeHandle";
import {
  QueryWorkspace,
  WorkspaceOpen,
} from "./components/QueryWorkspace";
import { ConnectionModal } from "./components/connection-modal/ConnectionModal";
import { FolderModal } from "./components/connection-modal/FolderModal";
import { VaultCreateModal } from "./components/connection-modal/VaultCreateModal";
import { VaultUnlockModal } from "./components/connection-modal/VaultUnlockModal";
import { PluginsPanel } from "./components/PluginsPanel";
import { SettingsModal } from "./components/SettingsModal";
import { WriteConfirmModal } from "./components/WriteConfirmModal";
import { useConnectionTree } from "./hooks/useConnectionTree";
import { useDatabaseSession } from "./hooks/useDatabaseSession";
import {
  VaultLockedError,
  VaultMissingError,
} from "./lib/passwords";
import {
  ReadOnlyConnectionError,
  WriteConfirmationRequiredError,
  safetyOf,
} from "./lib/connectionGuard";
import { errorMessage } from "./lib/format";
import { isPrimaryModifier } from "./lib/platform";
import { completionGroupsFor } from "./lib/completionSchema";
import { hasSchemaCache, hydrateSchemaCache } from "./lib/schemaCache";
import { onConnectionDeleted } from "./lib/storage";
import { VaultSettingsModal } from "./components/connection-modal/VaultSettingsModal";
import { ConnectionProfile, DriverInfo, TreeNode } from "./types/connection";
import { ColumnNode, SchemaInfo } from "./types/schema";
import { ImportCsvModal } from "./components/ImportCsvModal";
import { ImportConnectionsModal } from "./components/connection-modal/ImportConnectionsModal";
import { GithubSyncSettingsModal } from "./components/connection-modal/GithubSyncSettingsModal";
import { GithubPullConfirmModal } from "./components/connection-modal/GithubPullConfirmModal";
import { collectConnections, collectFolderOptions } from "./lib/tree";
import {
  applyImportedSecrets,
  exportConnections,
  ImportMode,
  parseConnectionExport,
  pickAndReadImportFile,
  remapTreeIds,
  summarizeExport,
} from "./lib/connectionTransfer";
import {
  demoteVaultConnections,
  VaultApplyChoice,
} from "./lib/connectionSyncDocument";
import {
  GithubAuthRequiredError,
  GithubSyncConflictError,
  pullConnectionsFromGithub,
  pushConnectionsToGithub,
  rememberPulledSha,
} from "./lib/githubSync";
import {
  GithubSyncSettings,
  loadGithubSyncSettings,
  settingsReady,
} from "./lib/githubSyncSettings";
import {
  getVaultSecret,
  isVaultUnlocked,
  onVaultLocked,
  readStoredVault,
  touchVaultActivity,
  vaultExists,
  writeStoredVault,
} from "./lib/vault";
import { databaseApi, pluginsApi } from "./api/database";
import { cacheDriverGroups } from "./lib/driverGroups";
import { syncPluginColumnTypes } from "./plugins/init";
import { extensionRegistry } from "./extensions/registry";
import "./styles/app.css";

function App() {
  const tree = useConnectionTree();
  const session = useDatabaseSession();
  const [drivers, setDrivers] = useState<DriverInfo[]>([]);
  const [modalProfile, setModalProfile] = useState<ConnectionProfile | null>(
    null,
  );
  const [modalFolderId, setModalFolderId] = useState<string | null>(null);
  const [modalSchemas, setModalSchemas] = useState<SchemaInfo[]>([]);
  const [modalDatabases, setModalDatabases] = useState<SchemaInfo[]>([]);
  const [folderModal, setFolderModal] = useState<{
    id?: string;
    name: string;
    parentId: string | null;
  } | null>(null);
  const [openRequest, setOpenRequest] = useState<WorkspaceOpen>(null);
  const [vaultPrompt, setVaultPrompt] = useState<"unlock" | "create" | null>(
    null,
  );
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importTarget, setImportTarget] = useState<{
    schema: string;
    table: string;
    columns: ColumnNode[];
  } | null>(null);
  const [vaultSettingsOpen, setVaultSettingsOpen] = useState(false);
  const [vaultUnlocked, setVaultUnlocked] = useState(() => isVaultUnlocked());
  const [hasVault, setHasVault] = useState(() => vaultExists());
  const [writeGate, setWriteGate] = useState<{
    connectionName: string;
    sql: string;
    onConfirm: () => void;
    onCancel: () => void;
  } | null>(null);
  const [importPreview, setImportPreview] = useState<{
    tree: TreeNode[];
    connectionCount: number;
    keychainWithoutPassword: number;
  } | null>(null);
  const [transferNotice, setTransferNotice] = useState("");
  const [githubSettingsOpen, setGithubSettingsOpen] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [pullPreview, setPullPreview] = useState<{
    tree: TreeNode[];
    sha: string;
    connectionCount: number;
    vaultConnectionCount: number;
    hasRemoteVault: boolean;
    vaultConflict: boolean;
    settings: GithubSyncSettings;
    vault: ReturnType<typeof readStoredVault>;
  } | null>(null);

  // Any interaction defers auto-lock; locking flips the indicator.
  useEffect(() => {
    const events = ["mousedown", "keydown", "wheel"] as const;
    const onActivity = () => {
      if (isVaultUnlocked()) touchVaultActivity();
    };
    for (const event of events) {
      window.addEventListener(event, onActivity, { passive: true });
    }
    const stop = onVaultLocked(() => setVaultUnlocked(false));
    return () => {
      for (const event of events) {
        window.removeEventListener(event, onActivity);
      }
      stop();
    };
  }, []);

  // Suppress the native context menu except on editable fields (and opt-ins).
  useEffect(() => {
    const allowsNativeContextMenu = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      return Boolean(
        target.closest(
          'input, textarea, select, [contenteditable="true"], [contenteditable=""], [data-allow-context-menu]',
        ),
      );
    };
    const onContextMenu = (event: MouseEvent) => {
      if (!allowsNativeContextMenu(event.target)) {
        event.preventDefault();
      }
    };
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, []);

  // Keep Cmd/Ctrl+A from selecting the whole app chrome. Editable fields keep
  // native select-all; text opt-ins select their own contents; grids handle
  // select-all in their own key handlers.
  useEffect(() => {
    const editableSelector =
      'input, textarea, select, [contenteditable="true"], [contenteditable=""]';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "a" || !isPrimaryModifier(event)) return;
      if (event.altKey || event.shiftKey || event.repeat) return;

      const node =
        event.target instanceof Element
          ? event.target
          : event.target instanceof Node
            ? event.target.parentElement
            : null;
      if (!node) {
        event.preventDefault();
        return;
      }

      if (node.closest(editableSelector)) return;

      const textRoot = node.closest("[data-allow-select-all]");
      if (textRoot) {
        event.preventDefault();
        const selection = window.getSelection();
        if (!selection) return;
        const range = document.createRange();
        range.selectNodeContents(textRoot);
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }

      event.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  const vaultRetry = useRef<(() => void) | null>(null);
  const completionPrefetched = useRef<string | null>(null);

  const refreshDrivers = () => {
    void Promise.all([databaseApi.listDrivers(), pluginsApi.list()])
      .then(([driverList, pluginList]) => {
        setDrivers(driverList);
        syncPluginColumnTypes(driverList);
        cacheDriverGroups(driverList);
        extensionRegistry.sync(pluginList);
      })
      .catch(() => undefined);
  };

  useEffect(() => {
    refreshDrivers();
  }, []);

  useEffect(() => {
    if (tree.tree.length === 0 && !modalProfile && !folderModal) {
      setModalProfile(tree.createBlank());
      setModalFolderId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree.tree.length, modalProfile, folderModal]);

  useEffect(() => {
    let cancelled = false;
    void hydrateSchemaCache().then(() => {
      if (cancelled) return;
      if (tree.selected) {
        session.activate(tree.selected);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree.selected?.id]);

  // Once a pool is open anyway, quietly top up metadata so SQL completion
  // knows about tables the user has not expanded in the tree.
  useEffect(() => {
    const profile = tree.selected;
    if (!profile || session.liveId !== profile.id) return;
    if (completionPrefetched.current === profile.id) return;
    completionPrefetched.current = profile.id;
    void session.prefetchObjects(profile, completionGroupsFor(profile.driver));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.liveId, tree.selected?.id]);

  function openNewConnection(folderId: string | null) {
    setModalProfile(tree.createBlank());
    setModalFolderId(folderId);
    setModalSchemas([]);
    setModalDatabases([]);
  }

  async function handleExportConnections() {
    setTransferNotice("");
    const needsVault = collectConnections(tree.tree).some(
      (profile) => profile.passwordStorage === "vault",
    );
    if (needsVault && vaultExists() && !isVaultUnlocked()) {
      vaultRetry.current = () => void handleExportConnections();
      setVaultPrompt("unlock");
      return;
    }
    try {
      const result = await exportConnections(tree.tree);
      if (!result) return;
      setTransferNotice(summarizeExport(result));
    } catch (error) {
      setTransferNotice(errorMessage(error));
    }
  }

  async function handleImportConnections() {
    setTransferNotice("");
    try {
      const raw = await pickAndReadImportFile();
      if (!raw) return;
      const imported = parseConnectionExport(raw);
      const connections = collectConnections(imported);
      setImportPreview({
        tree: imported,
        connectionCount: connections.length,
        keychainWithoutPassword: connections.filter(
          (profile) => profile.passwordStorage === "keychain",
        ).length,
      });
    } catch (error) {
      setTransferNotice(errorMessage(error));
    }
  }

  async function confirmImport(mode: ImportMode) {
    if (!importPreview) return;
    const preview = importPreview;
    const run = async () => {
      const source =
        mode === "merge" ? remapTreeIds(preview.tree) : preview.tree;
      const applied = await applyImportedSecrets(source);
      if (mode === "replace") {
        for (const profile of collectConnections(tree.tree)) {
          onConnectionDeleted(profile.id);
          session.onDeleted(profile.id);
        }
        tree.replaceTree(applied.tree);
      } else {
        tree.mergeTree(applied.tree);
      }
      setImportPreview(null);
      const parts = [
        `Imported ${applied.connectionCount} connection${applied.connectionCount === 1 ? "" : "s"}.`,
      ];
      if (applied.keychainWithoutPassword > 0) {
        parts.push(
          `${applied.keychainWithoutPassword} keychain connection${applied.keychainWithoutPassword === 1 ? "" : "s"} need passwords saved again.`,
        );
      }
      setTransferNotice(parts.join(" "));
    };

    try {
      await run();
    } catch (error) {
      if (error instanceof VaultLockedError) {
        vaultRetry.current = () => void confirmImport(mode);
        setVaultPrompt("unlock");
        return;
      }
      if (error instanceof VaultMissingError) {
        vaultRetry.current = () => void confirmImport(mode);
        setVaultPrompt("create");
        return;
      }
      setTransferNotice(errorMessage(error));
      setImportPreview(null);
    }
  }

  function openGithubSettingsIfNeeded(): GithubSyncSettings | null {
    const settings = loadGithubSyncSettings();
    if (!settingsReady(settings)) {
      setGithubSettingsOpen(true);
      setTransferNotice("Configure GitHub sync settings first.");
      return null;
    }
    return settings;
  }

  async function handleGithubPush() {
    setTransferNotice("");
    const settings = openGithubSettingsIfNeeded();
    if (!settings) return;
    setSyncBusy(true);
    try {
      const result = await pushConnectionsToGithub(settings, tree.tree);
      const parts = [
        `Pushed ${result.connectionCount} connection${result.connectionCount === 1 ? "" : "s"} to GitHub.`,
      ];
      if (result.vaultAttached) {
        parts.push("Vault ciphertext included.");
      }
      setTransferNotice(parts.join(" "));
    } catch (error) {
      if (error instanceof GithubAuthRequiredError) {
        setGithubSettingsOpen(true);
        setTransferNotice(errorMessage(error));
        return;
      }
      if (error instanceof GithubSyncConflictError) {
        setTransferNotice(errorMessage(error));
        return;
      }
      setTransferNotice(errorMessage(error));
    } finally {
      setSyncBusy(false);
    }
  }

  async function handleGithubPull() {
    setTransferNotice("");
    const settings = openGithubSettingsIfNeeded();
    if (!settings) return;
    setSyncBusy(true);
    try {
      const result = await pullConnectionsFromGithub(settings);
      const localVault = readStoredVault();
      const remoteVault = result.document.vault;
      const vaultConflict = Boolean(
        localVault && remoteVault && localVault.salt !== remoteVault.salt,
      );
      setPullPreview({
        tree: result.document.tree,
        sha: result.sha,
        connectionCount: result.document.connectionCount,
        vaultConnectionCount: result.document.vaultConnectionCount,
        hasRemoteVault: Boolean(remoteVault),
        vaultConflict,
        settings,
        vault: remoteVault,
      });
    } catch (error) {
      if (error instanceof GithubAuthRequiredError) {
        setGithubSettingsOpen(true);
      }
      setTransferNotice(errorMessage(error));
    } finally {
      setSyncBusy(false);
    }
  }

  function confirmGithubPull(vaultChoice: VaultApplyChoice) {
    if (!pullPreview) return;
    const preview = pullPreview;
    let nextTree = preview.tree;
    const remoteVault = preview.vault;

    if (remoteVault) {
      if (preview.vaultConflict && vaultChoice === "skip") {
        nextTree = demoteVaultConnections(nextTree);
      } else {
        writeStoredVault(remoteVault);
        setVaultUnlocked(false);
        setHasVault(true);
      }
    }

    const nextIds = new Set(
      collectConnections(nextTree).map((profile) => profile.id),
    );
    for (const profile of collectConnections(tree.tree)) {
      session.onDeleted(profile.id);
      if (!nextIds.has(profile.id)) {
        onConnectionDeleted(profile.id);
      }
    }
    tree.replaceTree(nextTree);
    rememberPulledSha(preview.settings, preview.sha);
    setPullPreview(null);

    const parts = [
      `Pulled ${preview.connectionCount} connection${preview.connectionCount === 1 ? "" : "s"} from GitHub.`,
    ];
    if (remoteVault && !(preview.vaultConflict && vaultChoice === "skip")) {
      parts.push("Vault ciphertext imported — unlock to use vault passwords.");
    } else if (preview.vaultConflict && vaultChoice === "skip") {
      parts.push(
        "Kept local vault; vault-backed passwords need to be set again.",
      );
    }
    setTransferNotice(parts.join(" "));
  }

  function openEditConnection(profile: ConnectionProfile) {
    let next = { ...profile };
    if (
      profile.passwordStorage === "vault" &&
      isVaultUnlocked() &&
      !profile.password
    ) {
      const saved = getVaultSecret(profile.id);
      if (saved) next = { ...next, password: saved };
    }
    setModalProfile(next);
    setModalFolderId(tree.parentOf(profile.id));
    setModalSchemas(session.availableSchemas);
    setModalDatabases(session.availableDatabases);
  }

  async function withVaultGate(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      if (error instanceof VaultLockedError) {
        vaultRetry.current = () => void withVaultGate(action);
        setVaultPrompt("unlock");
        return;
      }
      if (error instanceof VaultMissingError) {
        vaultRetry.current = () => void withVaultGate(action);
        setVaultPrompt("create");
        return;
      }
    }
  }

  function executeWithVault(
    sql: string,
    connectionId: string,
    confirmedWrite = false,
  ): Promise<import("./types/query").QueryResult> {
    const profile = tree.findConnection(connectionId);
    if (!profile) {
      return Promise.reject(
        new Error("Select a connection before running a query."),
      );
    }
    return new Promise((resolve, reject) => {
      const attempt = (confirmed = confirmedWrite) => {
        void session
          .executeSql(profile, sql, confirmed)
          .then(resolve)
          .catch((error) => {
            if (error instanceof VaultLockedError) {
              vaultRetry.current = () => attempt(confirmed);
              setVaultPrompt("unlock");
              return;
            }
            if (error instanceof VaultMissingError) {
              vaultRetry.current = () => attempt(confirmed);
              setVaultPrompt("create");
              return;
            }
            if (error instanceof WriteConfirmationRequiredError) {
              setWriteGate({
                connectionName: error.connectionName,
                sql: error.sql,
                onConfirm: () => attempt(true),
                onCancel: () => reject(error),
              });
              return;
            }
            reject(error);
          });
      };
      attempt();
    });
  }

  function executeBatchWithVault(
    connectionId: string,
    statements: string[],
  ): Promise<number[]> {
    const profile = tree.findConnection(connectionId);
    if (!profile) {
      return Promise.reject(
        new Error("Select a connection before committing changes."),
      );
    }
    return new Promise((resolve, reject) => {
      const attempt = () => {
        void session
          .executeBatch(profile, statements)
          .then(resolve)
          .catch((error) => {
            if (error instanceof VaultLockedError) {
              vaultRetry.current = attempt;
              setVaultPrompt("unlock");
              return;
            }
            if (error instanceof VaultMissingError) {
              vaultRetry.current = attempt;
              setVaultPrompt("create");
              return;
            }
            reject(error);
          });
      };
      attempt();
    });
  }

  /** Show the write gate for a whole batch and report the user's answer. */
  function confirmWrites(
    connectionId: string,
    preview: string,
  ): Promise<boolean> {
    const profile = tree.findConnection(connectionId);
    if (!profile) return Promise.resolve(false);
    const name = profile.name || profile.database;
    return new Promise((resolve) => {
      setWriteGate({
        connectionName: name,
        sql: preview,
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  }

  /** Run a query from the editor, routing guard failures to the right prompt. */
  function runQueryGuarded(
    profile: ConnectionProfile,
    sql: string,
    confirmed = false,
  ) {
    void session.runQuery(profile, sql, confirmed).catch((error) => {
      if (error instanceof VaultLockedError) {
        vaultRetry.current = () => runQueryGuarded(profile, sql, confirmed);
        setVaultPrompt("unlock");
        return;
      }
      if (error instanceof VaultMissingError) {
        vaultRetry.current = () => runQueryGuarded(profile, sql, confirmed);
        setVaultPrompt("create");
        return;
      }
      if (error instanceof WriteConfirmationRequiredError) {
        setWriteGate({
          connectionName: error.connectionName,
          sql: error.sql,
          onConfirm: () => runQueryGuarded(profile, sql, true),
          onCancel: () => undefined,
        });
        return;
      }
      if (error instanceof ReadOnlyConnectionError) {
        session.setError(error.message);
        return;
      }
      session.setError(errorMessage(error));
    });
  }

  const hasSchemaCacheUi = tree.selected
    ? hasSchemaCache(tree.selected.id) ||
      (session.activeId === tree.selected.id && session.schemas.length > 0)
    : false;

  const shellLayout = useDefaultLayout({
    id: "studio-shell",
    storage: localStorage,
  });

  return (
    <div className="h-full w-full bg-bg">
      <TitleBar onOpenSettings={() => setSettingsOpen(true)} />
      <div className="flex h-[calc(100%-38px)] min-h-0 overflow-hidden">
        <ActivityBar
          active="databases"
          onSelect={() => undefined}
          onOpenPlugins={() => setPluginsOpen(true)}
          vaultUnlocked={hasVault ? vaultUnlocked : null}
          onOpenVault={() => setVaultSettingsOpen(true)}
        />
        <Group
          id="studio-shell"
          orientation="horizontal"
          className="min-w-0 flex-1"
          defaultLayout={shellLayout.defaultLayout}
          onLayoutChanged={shellLayout.onLayoutChanged}
        >
          <Panel
            id="connections"
            defaultSize={250}
            minSize={180}
            maxSize={480}
            className="min-w-0"
          >
          <ConnectionSidebar
            tree={tree.tree}
            selection={tree.selection}
            expanded={tree.expanded}
            connectedId={session.connectedId}
            liveConnectionIds={session.liveIds}
            selected={tree.selected}
            busy={session.busy}
            busyDetail={session.busyDetail}
            schemas={session.schemas}
            schemasByDatabase={session.schemasByDatabase}
            objectSubgroups={session.objectSubgroups}
            availableDatabases={session.availableDatabases}
            schemaExpanded={session.schemaExpanded}
            hasSchemaCache={hasSchemaCacheUi}
            onSelect={tree.setSelection}
            onToggleFolder={tree.toggleExpanded}
            onToggleSchema={(key) => {
              if (!tree.selected) return;
              void withVaultGate(() =>
                session.toggleSchemaExpanded(tree.selected!, key),
              );
            }}
            onConnect={(profile) => {
              tree.setSelection({ kind: "connection", id: profile.id });
              void withVaultGate(() => session.connect(profile));
            }}
            onRefreshDatabase={(profile) =>
              void withVaultGate(() => session.refreshDatabase(profile))
            }
            onSwitchDatabase={(profile, database) => {
              void withVaultGate(async () => {
                const next = await session.switchDatabase(profile, database);
                if (next && next.database !== profile.database) {
                  tree.saveConnection(next, tree.parentOf(profile.id));
                }
              });
            }}
            onRefreshSchema={(profile, schema) =>
              void withVaultGate(() => session.refreshSchema(profile, schema))
            }
            onRefreshGroup={(profile, schema, group) =>
              void withVaultGate(() =>
                session.refreshGroup(profile, schema, group),
              )
            }
            onMove={tree.moveNode}
            onNewConnection={openNewConnection}
            onEditConnection={openEditConnection}
            onNewFolder={(parentId) =>
              setFolderModal({ name: "", parentId })
            }
            onEditFolder={(id, name, parentId) =>
              setFolderModal({ id, name, parentId })
            }
            onDelete={(id) => {
              onConnectionDeleted(id);
              tree.deleteNode(id);
              session.onDeleted(id);
            }}
            onExportConnections={() => void handleExportConnections()}
            onImportConnections={() => void handleImportConnections()}
            syncBusy={syncBusy}
            onGithubPull={() => void handleGithubPull()}
            onGithubPush={() => void handleGithubPush()}
            onGithubSyncSettings={() => setGithubSettingsOpen(true)}
            onViewTable={(schema, table) => {
              setOpenRequest({
                kind: "view",
                schema,
                table,
                nonce: Date.now(),
              });
            }}
            onEditTable={(schema, table) => {
              setOpenRequest({
                kind: "edit",
                schema,
                table,
                nonce: Date.now(),
              });
            }}
            onShowEr={(schema) => {
              setOpenRequest({
                kind: "er",
                schema,
                nonce: Date.now(),
              });
            }}
            onNewConsole={() => {
              setOpenRequest({
                kind: "console",
                nonce: Date.now(),
              });
            }}
            onImportCsv={(schema, table, columns) =>
              setImportTarget({ schema, table, columns })
            }
            schemaReadonly={
              (drivers.find((driver) => driver.id === tree.selected?.driver)
                ?.capabilities.readonly ??
                false) ||
              (tree.selected ? safetyOf(tree.selected) === "readOnly" : false)
            }
            findConnection={tree.findConnection}
            findFolder={tree.findFolder}
            parentOf={tree.parentOf}
          />
          </Panel>
          <PanelResizeHandle />
          <Panel id="workspace" minSize={360} className="min-w-0">
          <QueryWorkspace
            selected={tree.selected}
            connections={collectConnections(tree.tree)}
            liveConnectionIds={session.liveIds}
            connectedId={session.connectedId}
            connectionInfo={session.connectionInfo}
            busy={session.busy}
            result={session.result}
            error={session.error}
            schemas={session.schemas}
            drivers={drivers}
            openRequest={openRequest}
            txnOpenById={session.txnOpenById}
            onCancel={(connectionId) => void session.cancelQuery(connectionId)}
            onBeginTransaction={(connectionId) => {
              const profile = tree.findConnection(connectionId);
              if (!profile) return;
              void withVaultGate(() => session.beginTransaction(profile));
            }}
            onEndTransaction={(connectionId, commit) => {
              const profile = tree.findConnection(connectionId);
              if (!profile) return;
              void session
                .endTransaction(profile, commit)
                .catch((error) => session.setError(errorMessage(error)));
            }}
            onRun={(sql, connectionId) => {
              const profile = tree.findConnection(connectionId);
              if (!profile) {
                session.setError("Select a connection before running a query.");
                return;
              }
              runQueryGuarded(profile, sql);
            }}
            onExecute={(sql, connectionId, confirmedWrite) =>
              executeWithVault(sql, connectionId, confirmedWrite)
            }
            onExecuteBatch={executeBatchWithVault}
            onConfirmWrites={confirmWrites}
            onLoadEr={(schema, connectionId) => {
              const profile =
                tree.findConnection(connectionId) ?? tree.selected;
              if (!profile) {
                return Promise.reject(
                  new Error(
                    "Select a connection before opening an ER diagram.",
                  ),
                );
              }
              return new Promise((resolve, reject) => {
                const attempt = () => {
                  void session
                    .loadErDiagram(profile, schema)
                    .then(resolve)
                    .catch((error) => {
                      if (error instanceof VaultLockedError) {
                        vaultRetry.current = attempt;
                        setVaultPrompt("unlock");
                        return;
                      }
                      if (error instanceof VaultMissingError) {
                        vaultRetry.current = attempt;
                        setVaultPrompt("create");
                        return;
                      }
                      reject(error);
                    });
                };
                attempt();
              });
            }}
          />
          </Panel>
        </Group>
      </div>

      {writeGate && (
        <WriteConfirmModal
          connectionName={writeGate.connectionName}
          sql={writeGate.sql}
          onCancel={() => {
            writeGate.onCancel();
            setWriteGate(null);
          }}
          onConfirm={() => {
            const confirm = writeGate.onConfirm;
            setWriteGate(null);
            confirm();
          }}
        />
      )}

      {modalProfile && (
        <ConnectionModal
          profile={modalProfile}
          folderId={modalFolderId}
          folderOptions={tree.folderOptions}
          availableSchemas={modalSchemas}
          availableDatabases={modalDatabases}
          onFolderChange={setModalFolderId}
          onAvailableSchemas={setModalSchemas}
          onAvailableDatabases={setModalDatabases}
          isAlreadyConnected={session.connectedId === modalProfile.id}
          onSave={(profile, folderId) => {
            tree.saveConnection(profile, folderId);
            setModalProfile(null);
          }}
          onClose={() => setModalProfile(null)}
        />
      )}

      {folderModal && (
        <FolderModal
          initial={folderModal}
          folderOptions={collectFolderOptions(
            tree.tree,
            0,
            folderModal.id,
          )}
          onSave={(input) => {
            tree.saveFolder(input);
            setFolderModal(null);
          }}
          onClose={() => setFolderModal(null)}
        />
      )}

      {importPreview && (
        <ImportConnectionsModal
          connectionCount={importPreview.connectionCount}
          keychainWithoutPassword={importPreview.keychainWithoutPassword}
          onConfirm={(mode) => void confirmImport(mode)}
          onClose={() => setImportPreview(null)}
        />
      )}

      {pullPreview && (
        <GithubPullConfirmModal
          connectionCount={pullPreview.connectionCount}
          vaultConnectionCount={pullPreview.vaultConnectionCount}
          hasRemoteVault={pullPreview.hasRemoteVault}
          vaultConflict={pullPreview.vaultConflict}
          onConfirm={(vaultChoice) => confirmGithubPull(vaultChoice)}
          onClose={() => setPullPreview(null)}
        />
      )}

      {githubSettingsOpen && (
        <GithubSyncSettingsModal
          onClose={() => setGithubSettingsOpen(false)}
        />
      )}

      {transferNotice && (
        <div
          className="fixed bottom-4 left-1/2 z-30 max-w-[min(520px,calc(100%-2rem))] -translate-x-1/2 px-3.5 py-2.5 border border-border-bright rounded-[8px] bg-surface text-[12px] leading-[1.4] text-text shadow-[0_16px_40px_rgba(0,0,0,.45)]"
          role="status"
        >
          <div className="flex items-start gap-3">
            <span className="flex-1">{transferNotice}</span>
            <button
              type="button"
              className="shrink-0 grid place-items-center border-0 bg-transparent text-muted cursor-pointer hover:text-text p-0"
              aria-label="Dismiss"
              onClick={() => setTransferNotice("")}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {vaultPrompt === "create" && (
        <VaultCreateModal
          onCreated={() => {
            setVaultPrompt(null);
            setVaultUnlocked(true);
            setHasVault(true);
            vaultRetry.current?.();
            vaultRetry.current = null;
          }}
          onClose={() => {
            setVaultPrompt(null);
            vaultRetry.current = null;
          }}
        />
      )}
      {vaultPrompt === "unlock" && (
        <VaultUnlockModal
          onUnlocked={() => {
            setVaultPrompt(null);
            setVaultUnlocked(true);
            setHasVault(true);
            vaultRetry.current?.();
            vaultRetry.current = null;
          }}
          onClose={() => {
            setVaultPrompt(null);
            vaultRetry.current = null;
          }}
        />
      )}

      {importTarget && tree.selected && (
        <ImportCsvModal
          profile={tree.selected}
          schema={importTarget.schema}
          table={importTarget.table}
          columns={importTarget.columns}
          execute={(sql) => executeWithVault(sql, tree.selected!.id)}
          onImported={() => {
            setOpenRequest({
              kind: "view",
              schema: importTarget.schema,
              table: importTarget.table,
              nonce: Date.now(),
            });
          }}
          onClose={() => setImportTarget(null)}
        />
      )}

      {vaultSettingsOpen && (
        <VaultSettingsModal
          onClose={() => {
            setVaultSettingsOpen(false);
            setVaultUnlocked(isVaultUnlocked());
            setHasVault(vaultExists());
          }}
        />
      )}

      {pluginsOpen && (
        <PluginsPanel
          onClose={() => setPluginsOpen(false)}
          onDriversChanged={refreshDrivers}
        />
      )}

      {settingsOpen && (
        <SettingsModal onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}

export default App;
