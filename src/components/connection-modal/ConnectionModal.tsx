import { FormEvent, useEffect, useState } from "react";
import { Database, LoaderCircle, X } from "lucide-react";
import { databaseApi } from "../../api/database";
import { errorMessage } from "../../lib/format";
import {
  sshPassphraseVaultKey,
  sshVaultKey,
  withResolvedPassword,
} from "../../lib/passwords";
import { cn } from "../../lib/cn";
import {
  getVaultSecret,
  isVaultUnlocked,
  removeVaultSecret,
  setVaultSecret,
  vaultExists,
} from "../../lib/vault";
import {
  ConnectionProfile,
  DriverInfo,
} from "../../types/connection";
import { SchemaInfo } from "../../types/schema";
import { cacheDriverGroups } from "../../lib/driverGroups";
import { syncPluginColumnTypes } from "../../plugins/init";
import { GeneralTab } from "./GeneralTab";
import { SchemasTab } from "./SchemasTab";
import { SshTab } from "./SshTab";
import { VaultCreateModal } from "./VaultCreateModal";
import { VaultUnlockModal } from "./VaultUnlockModal";

type ModalTab = "general" | "ssh" | "schemas";

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
  const [drivers, setDrivers] = useState<DriverInfo[]>([]);
  const [tab, setTab] = useState<ModalTab>("general");
  const [testing, setTesting] = useState(false);
  const [loadingSchemas, setLoadingSchemas] = useState(false);
  const [testStatus, setTestStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [vaultGate, setVaultGate] = useState<"create" | "unlock" | null>(null);

  useEffect(() => {
    void databaseApi
      .listDrivers()
      .then((list) => {
        setDrivers(list);
        syncPluginColumnTypes(list);
        cacheDriverGroups(list);
      })
      .catch(() => setDrivers([]));
  }, []);

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
    if (
      initial.passwordStorage === "vault" &&
      isVaultUnlocked() &&
      initial.ssh?.enabled
    ) {
      const sshPassword = getVaultSecret(sshVaultKey(initial.id));
      const passphrase = getVaultSecret(sshPassphraseVaultKey(initial.id));
      if (sshPassword || passphrase) {
        setProfile((current) => {
          const ssh = current.ssh;
          if (!ssh) return current;
          return {
            ...current,
            ssh: {
              ...ssh,
              password: ssh.password || sshPassword || "",
              passphrase: ssh.passphrase || passphrase || "",
            },
          };
        });
      }
    }
  }, [initial.id, initial.password, initial.passwordStorage, initial.ssh?.enabled]);

  const activeDriver = drivers.find((driver) => driver.id === profile.driver);
  const supportsSchemas = activeDriver?.capabilities.schemas ?? true;

  function update(patch: Partial<ConnectionProfile>) {
    setProfile((current) => ({ ...current, ...patch }));
  }

  function switchDriver(driverId: string) {
    const driver = drivers.find((item) => item.id === driverId);
    if (!driver) {
      update({ driver: driverId });
      return;
    }
    const caps = driver.capabilities;
    const fields = driver.connectionFields ?? [];
    const usesCustom = fields.length > 0;
    const keys = new Set(fields.map((field) => field.key));

    const protocolDefault =
      usesCustom && keys.has("database")
        ? fields.find((field) => field.key === "database")?.options?.[0] ||
          "http"
        : undefined;

    update({
      driver: driver.id,
      port: driver.defaultPort ?? 0,
      host:
        caps.fileBased || caps.folderBased || caps.noConnectionRequired
          ? ""
          : profile.host || "localhost",
      username: usesCustom
        ? keys.has("username")
          ? profile.username
          : ""
        : driver.id === "postgres"
          ? "postgres"
          : driver.id === "mysql"
            ? "root"
            : caps.noConnectionRequired
              ? ""
              : profile.username,
      database: usesCustom
        ? keys.has("database")
          ? protocolDefault || profile.database || ""
          : ""
        : caps.noConnectionRequired
          ? driver.id
          : profile.database,
      password: usesCustom && !keys.has("password") ? "" : profile.password,
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
      if (!supportsSchemas) return;
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

      if (next.ssh?.enabled) {
        if (next.ssh.auth === "password") {
          const sshPassword =
            next.ssh.password || getVaultSecret(sshVaultKey(next.id)) || "";
          if (!sshPassword) {
            throw new Error("Enter an SSH password to store in the vault.");
          }
          await setVaultSecret(sshVaultKey(next.id), sshPassword);
        } else {
          await removeVaultSecret(sshVaultKey(next.id));
        }
        if (next.ssh.auth === "key" && next.ssh.passphrase) {
          await setVaultSecret(
            sshPassphraseVaultKey(next.id),
            next.ssh.passphrase,
          );
        } else {
          await removeVaultSecret(sshPassphraseVaultKey(next.id));
        }
      } else {
        await removeVaultSecret(sshVaultKey(next.id));
        await removeVaultSecret(sshPassphraseVaultKey(next.id));
      }
      return;
    }

    if (vaultExists() && isVaultUnlocked()) {
      await removeVaultSecret(next.id);
      await removeVaultSecret(sshVaultKey(next.id));
      await removeVaultSecret(sshPassphraseVaultKey(next.id));
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
      className="fixed inset-0 z-20 grid place-items-center p-5 bg-[rgba(5,7,10,.72)] backdrop-blur-[4px]"
      onMouseDown={(event) =>
        event.target === event.currentTarget && onClose()
      }
    >
      <form
        className="w-[min(560px,100%)] max-h-full overflow-auto p-[18px] border border-border-bright rounded-[10px] bg-surface shadow-[0_24px_70px_rgba(0,0,0,.48)]"
        onSubmit={(e) => void handleSubmit(e)}
      >
        <div className="flex items-center justify-between mb-[17px]">
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                "w-[27px] h-[27px] shrink-0 rounded-md grid place-items-center",
                profile.driver === "postgres" &&
                  "text-[#8fb9e8] bg-[rgba(72,128,186,.16)]",
                profile.driver === "mysql" &&
                  "text-[#e0a367] bg-[rgba(216,132,55,.14)]",
              )}
            >
              <Database size={17} />
            </span>
            <h2 className="m-0 text-text-bright text-sm font-[630]">
              Database connection
            </h2>
          </div>
          <button
            type="button"
            className="w-7 h-7 grid place-items-center p-0 border-0 rounded-[5px] text-muted bg-transparent cursor-pointer enabled:hover:text-text enabled:hover:bg-panel-soft disabled:cursor-default disabled:opacity-40"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>

        <div className="flex gap-0.5 -mt-1 mb-4 border-b border-border">
          <button
            type="button"
            className={cn(
              "h-8 px-3.5 border-0 border-b-2 border-transparent text-muted bg-transparent text-[11px] cursor-pointer hover:text-text",
              tab === "general" && "text-[#d8dde6] border-b-blue",
            )}
            onClick={() => setTab("general")}
          >
            General
          </button>
          <button
            type="button"
            className={cn(
              "h-8 px-3.5 border-0 border-b-2 border-transparent text-muted bg-transparent text-[11px] cursor-pointer hover:text-text",
              tab === "ssh" && "text-[#d8dde6] border-b-blue",
            )}
            onClick={() => setTab("ssh")}
          >
            SSH
            {profile.ssh?.enabled ? (
              <span className="ml-1.5 text-[9px] text-green">on</span>
            ) : null}
          </button>
          {supportsSchemas && (
            <button
              type="button"
              className={cn(
                "h-8 px-3.5 border-0 border-b-2 border-transparent text-muted bg-transparent text-[11px] cursor-pointer hover:text-text",
                tab === "schemas" && "text-[#d8dde6] border-b-blue",
              )}
              onClick={() => setTab("schemas")}
            >
              Schemas
            </button>
          )}
        </div>

        {tab === "ssh" ? (
          <SshTab profile={profile} onChange={update} />
        ) : tab === "schemas" && supportsSchemas ? (
          <SchemasTab
            profile={profile}
            availableSchemas={availableSchemas}
            loading={loadingSchemas}
            onChange={update}
            onRefresh={() => void refreshSchemas()}
          />
        ) : (
          <GeneralTab
            profile={profile}
            drivers={drivers}
            folderId={folderId}
            folderOptions={folderOptions}
            onChange={update}
            onDriverChange={switchDriver}
            onFolderChange={onFolderChange}
          />
        )}

        {testStatus && (
          <div
            className={cn(
              "mt-3 px-2.5 py-2 rounded-[5px] text-[10px] [overflow-wrap:anywhere] text-[#d18b91] bg-[rgba(239,107,115,.08)]",
              testStatus.startsWith("Connected") &&
                "text-[#72c99d] bg-[rgba(73,201,137,.08)]",
            )}
          >
            {testStatus}
          </div>
        )}

        <div className="mt-[18px] pt-3.5 border-t border-border flex items-center justify-between gap-2">
          <button
            type="button"
            className="h-[31px] px-[11px] rounded-[5px] text-[10px] font-semibold cursor-pointer flex items-center gap-1.5 border border-border-bright text-[#b8bfca] bg-[#20242b] hover:text-white hover:border-[#4c5360] disabled:opacity-40 disabled:cursor-default"
            disabled={testing || loadingSchemas || saving}
            onClick={() => void testAndLoadSchemas()}
          >
            {(testing || loadingSchemas) && (
              <LoaderCircle className="animate-spin-slow" size={14} />
            )}
            Test connection
          </button>
          <div className="flex gap-[7px]">
            <button
              type="button"
              className="h-[31px] px-[11px] rounded-[5px] text-[10px] font-semibold cursor-pointer border-0 text-muted bg-transparent hover:text-white hover:bg-panel-soft"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="h-[31px] px-[11px] rounded-[5px] text-[10px] font-semibold cursor-pointer border border-[#7667e7] text-white bg-[#6959da] hover:bg-[#7767e7] disabled:opacity-40 disabled:cursor-default"
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
