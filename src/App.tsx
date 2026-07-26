import { useEffect, useRef, useState } from "react";
import { TitleBar } from "./components/TitleBar";
import { ActivityBar } from "./components/ActivityBar";
import { ConnectionSidebar } from "./components/ConnectionSidebar";
import {
  QueryWorkspace,
  WorkspaceOpen,
} from "./components/QueryWorkspace";
import { ConnectionModal } from "./components/connection-modal/ConnectionModal";
import { FolderModal } from "./components/connection-modal/FolderModal";
import { VaultCreateModal } from "./components/connection-modal/VaultCreateModal";
import { VaultUnlockModal } from "./components/connection-modal/VaultUnlockModal";
import { PluginsPanel } from "./components/PluginsPanel";
import { useConnectionTree } from "./hooks/useConnectionTree";
import { useDatabaseSession } from "./hooks/useDatabaseSession";
import {
  VaultLockedError,
  VaultMissingError,
} from "./lib/passwords";
import { completionGroupsFor } from "./lib/completionSchema";
import { hasSchemaCache } from "./lib/schemaCache";
import { onConnectionDeleted } from "./lib/storage";
import { getVaultSecret, isVaultUnlocked } from "./lib/vault";
import { ConnectionProfile, DriverInfo } from "./types/connection";
import { SchemaInfo } from "./types/schema";
import { collectFolderOptions } from "./lib/tree";
import { databaseApi } from "./api/database";
import { cacheDriverGroups } from "./lib/driverGroups";
import { syncPluginColumnTypes } from "./plugins/init";
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
  const vaultRetry = useRef<(() => void) | null>(null);
  const completionPrefetched = useRef<string | null>(null);

  const refreshDrivers = () => {
    void databaseApi
      .listDrivers()
      .then((list) => {
        setDrivers(list);
        syncPluginColumnTypes(list);
        cacheDriverGroups(list);
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
    if (tree.selected) {
      session.activate(tree.selected);
    }
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

  function executeWithVault(sql: string): Promise<import("./types/query").QueryResult> {
    if (!tree.selected) {
      return Promise.reject(
        new Error("Select a connection before running a query."),
      );
    }
    const profile = tree.selected;
    return new Promise((resolve, reject) => {
      const attempt = () => {
        void session
          .executeSql(profile, sql)
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

  const hasSchemaCacheUi = tree.selected
    ? hasSchemaCache(tree.selected.id) ||
      (session.activeId === tree.selected.id && session.schemas.length > 0)
    : false;

  return (
    <div className="h-full w-full bg-bg">
      <TitleBar />
      <div className="grid h-[calc(100%-38px)] grid-cols-[44px_250px_minmax(0,1fr)] max-[760px]:grid-cols-[42px_210px_minmax(420px,1fr)]">
        <ActivityBar
          active="databases"
          onSelect={() => undefined}
          onOpenPlugins={() => setPluginsOpen(true)}
        />
        <ConnectionSidebar
          tree={tree.tree}
          selection={tree.selection}
          expanded={tree.expanded}
          connectedId={session.connectedId}
          selected={tree.selected}
          busy={session.busy}
          busyDetail={session.busyDetail}
          schemas={session.schemas}
          objectSubgroups={session.objectSubgroups}
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
          schemaReadonly={
            drivers.find((driver) => driver.id === tree.selected?.driver)
              ?.capabilities.readonly ?? false
          }
          findConnection={tree.findConnection}
          findFolder={tree.findFolder}
          parentOf={tree.parentOf}
        />
        <QueryWorkspace
          selected={tree.selected}
          connectedId={session.connectedId}
          connectionInfo={session.connectionInfo}
          busy={session.busy}
          result={session.result}
          error={session.error}
          schemas={session.schemas}
          maxRows={
            drivers.find((driver) => driver.id === tree.selected?.driver)
              ?.capabilities.maxRows
          }
          openRequest={openRequest}
          onRun={(sql) => {
            if (!tree.selected) {
              session.setError("Select a connection before running a query.");
              return;
            }
            void withVaultGate(() => session.runQuery(tree.selected!, sql));
          }}
          onExecute={(sql) => executeWithVault(sql)}
        />
      </div>

      {modalProfile && (
        <ConnectionModal
          profile={modalProfile}
          folderId={modalFolderId}
          folderOptions={tree.folderOptions}
          availableSchemas={modalSchemas}
          onFolderChange={setModalFolderId}
          onAvailableSchemas={setModalSchemas}
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

      {vaultPrompt === "create" && (
        <VaultCreateModal
          onCreated={() => {
            setVaultPrompt(null);
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
            vaultRetry.current?.();
            vaultRetry.current = null;
          }}
          onClose={() => {
            setVaultPrompt(null);
            vaultRetry.current = null;
          }}
        />
      )}

      {pluginsOpen && (
        <PluginsPanel
          onClose={() => setPluginsOpen(false)}
          onDriversChanged={refreshDrivers}
        />
      )}
    </div>
  );
}

export default App;
