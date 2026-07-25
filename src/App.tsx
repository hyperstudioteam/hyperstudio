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
import { useConnectionTree } from "./hooks/useConnectionTree";
import { useDatabaseSession } from "./hooks/useDatabaseSession";
import {
  VaultLockedError,
  VaultMissingError,
} from "./lib/passwords";
import { hasSchemaCache } from "./lib/schemaCache";
import { onConnectionDeleted } from "./lib/storage";
import { getVaultSecret, isVaultUnlocked } from "./lib/vault";
import { ConnectionProfile } from "./types/connection";
import { SchemaInfo } from "./types/schema";
import { collectFolderOptions } from "./lib/tree";
import "./styles/app.css";

function App() {
  const tree = useConnectionTree();
  const session = useDatabaseSession();
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
  const vaultRetry = useRef<(() => void) | null>(null);

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
    <div className="app-shell">
      <TitleBar />
      <div className="app-body">
        <ActivityBar />
        <ConnectionSidebar
          tree={tree.tree}
          selection={tree.selection}
          expanded={tree.expanded}
          connectedId={session.connectedId}
          selected={tree.selected}
          busy={session.busy}
          busyDetail={session.busyDetail}
          schemas={session.schemas}
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
    </div>
  );
}

export default App;
