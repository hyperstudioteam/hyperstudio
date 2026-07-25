import { FormEvent, useEffect, useState } from "react";
import { Database, LoaderCircle, X } from "lucide-react";
import { databaseApi } from "../../api/database";
import { errorMessage } from "../../lib/format";
import { withResolvedPassword } from "../../lib/passwords";
import {
  getVaultSecret,
  isVaultUnlocked,
  removeVaultSecret,
  setVaultSecret,
  vaultExists,
} from "../../lib/vault";
import {
  ConnectionProfile,
  Driver,
} from "../../types/connection";
import { SchemaInfo } from "../../types/schema";
import { GeneralTab } from "./GeneralTab";
import { SchemasTab } from "./SchemasTab";
import { VaultCreateModal } from "./VaultCreateModal";
import { VaultUnlockModal } from "./VaultUnlockModal";

type ModalTab = "general" | "schemas";

interface ConnectionModalProps {
  profile: ConnectionProfile;
  folderId: string | null;
  folderOptions: { id: string | null; label: string }[];
  availableSchemas: SchemaInfo[];
  onFolderChange: (folderId: string | null) => void;
  onAvailableSchemas: (schemas: SchemaInfo[]) => void;
  onSave: (profile: ConnectionProfile, folderId: string | null) => void;
  onClose: () => void;
  isAlreadyConnected: boolean;
}

export function ConnectionModal({
  profile: initial,
  folderId,
  folderOptions,
  availableSchemas,
  onFolderChange,
  onAvailableSchemas,
  onSave,
  onClose,
  isAlreadyConnected,
}: ConnectionModalProps) {
  const [profile, setProfile] = useState(initial);
  const [tab, setTab] = useState<ModalTab>("general");
  const [testing, setTesting] = useState(false);
  const [loadingSchemas, setLoadingSchemas] = useState(false);
  const [testStatus, setTestStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [vaultGate, setVaultGate] = useState<"create" | "unlock" | null>(null);

  useEffect(() => {
    if (
      initial.passwordStorage === "vault" &&
      isVaultUnlocked() &&
      !initial.password
    ) {
      const saved = getVaultSecret(initial.id);
      if (saved) {
        setProfile((current) =>
          current.password ? current : { ...current, password: saved },
        );
      }
    }
  }, [initial.id, initial.password, initial.passwordStorage]);

  function update(patch: Partial<ConnectionProfile>) {
    setProfile((current) => ({ ...current, ...patch }));
  }

  function switchDriver(driver: Driver) {
    update({
      driver,
      port: driver === "postgres" ? 5432 : 3306,
      username: driver === "postgres" ? "postgres" : "root",
    });
  }

  function profileForConnect(): ConnectionProfile {
    try {
      return withResolvedPassword(profile);
    } catch {
      return profile;
    }
  }

  async function testAndLoadSchemas() {
    setTesting(true);
    setTestStatus("");
    try {
      const ready = profileForConnect();
      const info = await databaseApi.testConnection(ready);
      setTestStatus(`Connected to ${info.database}`);
      setLoadingSchemas(true);
      await databaseApi.connect(ready);
      try {
        const listed = await databaseApi.listSchemas(profile.id);
        onAvailableSchemas(listed);
        setTab("schemas");
      } finally {
        if (!isAlreadyConnected) {
          await databaseApi.disconnect(profile.id);
        }
      }
    } catch (nextError) {
      setTestStatus(errorMessage(nextError));
    } finally {
      setTesting(false);
      setLoadingSchemas(false);
    }
  }

  async function refreshSchemas() {
    setLoadingSchemas(true);
    setTestStatus("");
    try {
      const ready = profileForConnect();
      await databaseApi.connect(ready);
      try {
        const listed = await databaseApi.listSchemas(profile.id);
        onAvailableSchemas(listed);
      } finally {
        if (!isAlreadyConnected) {
          await databaseApi.disconnect(profile.id);
        }
      }
    } catch (nextError) {
      setTestStatus(errorMessage(nextError));
    } finally {
      setLoadingSchemas(false);
    }
  }

  async function persistPasswordSideEffects(next: ConnectionProfile) {
    if (next.passwordStorage === "vault") {
      const password = next.password || getVaultSecret(next.id) || "";
      if (!password) {
        throw new Error("Enter a password to store in the vault.");
      }
      await setVaultSecret(next.id, password);
      return;
    }

    if (vaultExists() && isVaultUnlocked()) {
      await removeVaultSecret(next.id);
    }
  }

  async function commitSave(nextProfile: ConnectionProfile = profile) {
    setSaving(true);
    setTestStatus("");
    try {
      await persistPasswordSideEffects(nextProfile);
      onSave(nextProfile, folderId);
    } catch (nextError) {
      setTestStatus(errorMessage(nextError));
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (profile.passwordStorage === "vault") {
      if (!vaultExists()) {
        setVaultGate("create");
        return;
      }
      if (!isVaultUnlocked()) {
        setVaultGate("unlock");
        return;
      }
    }

    await commitSave();
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) =>
        event.target === event.currentTarget && onClose()
      }
    >
      <form className="connection-modal wide" onSubmit={(e) => void handleSubmit(e)}>
        <div className="modal-heading">
          <div>
            <span className={`db-icon ${profile.driver}`}>
              <Database size={17} />
            </span>
            <h2>Database connection</h2>
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

        <div className="modal-tabs">
          <button
            type="button"
            className={tab === "general" ? "active" : ""}
            onClick={() => setTab("general")}
          >
            General
          </button>
          <button
            type="button"
            className={tab === "schemas" ? "active" : ""}
            onClick={() => setTab("schemas")}
          >
            Schemas
          </button>
        </div>

        {tab === "general" ? (
          <GeneralTab
            profile={profile}
            folderId={folderId}
            folderOptions={folderOptions}
            onChange={update}
            onDriverChange={switchDriver}
            onFolderChange={onFolderChange}
          />
        ) : (
          <SchemasTab
            profile={profile}
            availableSchemas={availableSchemas}
            loading={loadingSchemas}
            onChange={update}
            onRefresh={() => void refreshSchemas()}
          />
        )}

        {testStatus && (
          <div
            className={`test-status ${testStatus.startsWith("Connected") ? "ok" : ""}`}
          >
            {testStatus}
          </div>
        )}

        <div className="modal-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={testing || loadingSchemas || saving}
            onClick={() => void testAndLoadSchemas()}
          >
            {(testing || loadingSchemas) && (
              <LoaderCircle className="spin" size={14} />
            )}
            Test connection
          </button>
          <div>
            <button type="button" className="ghost-button" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={saving}
            >
              {saving ? "Saving…" : "Save connection"}
            </button>
          </div>
        </div>
      </form>

      {vaultGate === "create" && (
        <VaultCreateModal
          onCreated={() => {
            setVaultGate(null);
            void commitSave();
          }}
          onClose={() => setVaultGate(null)}
        />
      )}
      {vaultGate === "unlock" && (
        <VaultUnlockModal
          onUnlocked={() => {
            setVaultGate(null);
            const saved = getVaultSecret(profile.id);
            const next =
              saved && !profile.password
                ? { ...profile, password: saved }
                : profile;
            setProfile(next);
            void commitSave(next);
          }}
          onClose={() => setVaultGate(null)}
        />
      )}
    </div>
  );
}
