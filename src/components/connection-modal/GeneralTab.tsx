import {
  ConnectionFieldDef,
  ConnectionProfile,
  DriverInfo,
  PasswordStorage,
  SslMode,
} from "../../types/connection";
import { useEffect, useState } from "react";
import { cn } from "../../lib/cn";
import { keychainAvailable } from "../../lib/keychain";
import { CONNECTION_COLORS, SAFETY_OPTIONS } from "../../lib/connectionGuard";
import { vaultExists, isVaultUnlocked } from "../../lib/vault";

interface GeneralTabProps {
  profile: ConnectionProfile;
  drivers: DriverInfo[];
  folderId: string | null;
  folderOptions: { id: string | null; label: string }[];
  onChange: (patch: Partial<ConnectionProfile>) => void;
  onDriverChange: (driverId: string) => void;
  onFolderChange: (folderId: string | null) => void;
}

const PROFILE_KEYS = new Set([
  "host",
  "port",
  "database",
  "username",
  "password",
  "sslMode",
]);

const formLabelClass =
  "flex flex-col gap-[5px] text-muted text-[10px] font-[540]";
const formInputClass =
  "w-full h-[34px] px-[9px] border border-border-bright rounded-[5px] text-text bg-surface-input text-[11px] focus:border-accent placeholder:text-subtle";
const checkboxRowClass =
  "flex flex-row items-center gap-2 text-muted text-[11px] font-normal cursor-pointer";
const checkboxInputClass =
  "w-3.5 h-3.5 m-0 p-0 border-0 rounded-none bg-transparent shrink-0 accent-accent cursor-pointer";

export function GeneralTab({
  profile,
  drivers,
  folderId,
  folderOptions,
  onChange,
  onDriverChange,
  onFolderChange,
}: GeneralTabProps) {
  const savePassword = profile.passwordStorage !== "none";
  const vaultReady = vaultExists();
  const vaultOpen = isVaultUnlocked();
  const [keychainReady, setKeychainReady] = useState(false);

  useEffect(() => {
    void keychainAvailable().then(setKeychainReady);
  }, []);
  const active =
    drivers.find((driver) => driver.id === profile.driver) ?? null;
  const caps = active?.capabilities;
  const customFields = active?.connectionFields?.filter((field) =>
    PROFILE_KEYS.has(field.key),
  );
  const useCustomFields = Boolean(customFields && customFields.length > 0);
  const networkForm =
    !useCustomFields &&
    !(caps?.fileBased || caps?.folderBased || caps?.noConnectionRequired);

  function setSavePassword(enabled: boolean) {
    if (!enabled) {
      onChange({ passwordStorage: "none" });
      return;
    }
    onChange({ passwordStorage: "vault" });
  }

  function setStorage(passwordStorage: PasswordStorage) {
    onChange({ passwordStorage });
  }

  const passwordPlaceholder =
    profile.passwordStorage === "vault"
      ? vaultOpen
        ? "Stored in vault"
        : "Stored in vault (unlock to edit)"
      : profile.passwordStorage === "keychain"
        ? "Stored in the OS credential store"
        : profile.passwordStorage === "raw"
          ? "Stored as plain text"
          : "Not stored on disk";

  function fieldValue(key: string): string | number {
    switch (key) {
      case "host":
        return profile.host;
      case "port":
        return profile.port;
      case "database":
        return profile.database;
      case "username":
        return profile.username;
      case "password":
        return profile.password;
      case "sslMode":
        return profile.sslMode;
      default:
        return "";
    }
  }

  function setField(key: string, raw: string) {
    switch (key) {
      case "host":
        onChange({ host: raw });
        break;
      case "port":
        onChange({ port: Number(raw) || 0 });
        break;
      case "database":
        onChange({ database: raw });
        break;
      case "username":
        onChange({ username: raw });
        break;
      case "password":
        onChange({ password: raw });
        break;
      case "sslMode":
        onChange({ sslMode: raw as SslMode });
        break;
    }
  }

  const showSecretStorage =
    useCustomFields &&
    customFields!.some((field) => field.key === "password" || field.secret);

  return (
    <>
      <div className="grid grid-cols-[1fr_120px] gap-3">
        <label className={`${formLabelClass} col-span-full`}>
          Connection type
          <select
            className={formInputClass}
            value={profile.driver}
            title={active?.description}
            onChange={(event) => onDriverChange(event.target.value)}
          >
            {drivers.map((driver) => (
              <option key={driver.id} value={driver.id}>
                {driver.name}
              </option>
            ))}
          </select>
        </label>

        <label className={`${formLabelClass} col-span-full`}>
          Connection name
          <input
            required
            className={formInputClass}
            value={profile.name}
            placeholder="Production database"
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </label>
        <div className={`${formLabelClass} col-span-full`}>
          Colour
          <div className="flex gap-1.5">
            {CONNECTION_COLORS.map((swatch) => (
              <button
                type="button"
                key={swatch.id}
                aria-label={swatch.label}
                title={swatch.label}
                className={cn(
                  "size-[22px] cursor-pointer rounded-full border-2 bg-transparent",
                  (profile.color ?? "none") === swatch.id
                    ? "border-white"
                    : "border-transparent hover:border-border-bright",
                )}
                onClick={() => onChange({ color: swatch.id })}
              >
                <span
                  className="block size-full rounded-full border"
                  style={{
                    backgroundColor: swatch.dot,
                    borderColor: swatch.border,
                  }}
                />
              </button>
            ))}
          </div>
        </div>

        <div className={`${formLabelClass} col-span-full`}>
          Safety
          <div
            className="flex flex-col gap-2 rounded-md border border-border bg-surface-deep p-2.5 px-[11px]"
            role="radiogroup"
            aria-label="Safety"
          >
            {SAFETY_OPTIONS.map((option) => (
              <label
                key={option.id}
                className="flex cursor-pointer items-center gap-2 text-[11px] text-muted"
              >
                <input
                  type="radio"
                  name="connection-safety"
                  className="m-0 size-3.5 shrink-0 cursor-pointer accent-accent"
                  checked={(profile.safety ?? "none") === option.id}
                  onChange={() => onChange({ safety: option.id })}
                />
                <span className="flex flex-col gap-0.5">
                  <strong className="text-[11px] font-semibold text-text-bright">
                    {option.label}
                  </strong>
                  <em className="text-[10px] not-italic text-subtle">
                    {option.description}
                  </em>
                </span>
              </label>
            ))}
          </div>
        </div>

        <label className={`${formLabelClass} col-span-full`}>
          Folder
          <select
            className={formInputClass}
            value={folderId ?? ""}
            onChange={(event) =>
              onFolderChange(
                event.target.value === "" ? null : event.target.value,
              )
            }
          >
            {folderOptions.map((option) => (
              <option key={String(option.id)} value={option.id ?? ""}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {caps?.fileBased && (
          <label className={`${formLabelClass} col-span-full`}>
            Database file
            <input
              required
              className={formInputClass}
              value={profile.database}
              placeholder="/path/to/database.db"
              onChange={(event) => onChange({ database: event.target.value })}
            />
          </label>
        )}

        {caps?.folderBased && (
          <label className={`${formLabelClass} col-span-full`}>
            Data folder
            <input
              required
              className={formInputClass}
              value={profile.database}
              placeholder="/path/to/data"
              onChange={(event) => onChange({ database: event.target.value })}
            />
          </label>
        )}

        {useCustomFields &&
          customFields!.map((field) => (
            <CustomConnectionField
              key={field.key}
              field={field}
              value={fieldValue(field.key)}
              passwordPlaceholder={
                field.key === "password" || field.secret
                  ? passwordPlaceholder
                  : undefined
              }
              onChange={(raw) => setField(field.key, raw)}
            />
          ))}

        {useCustomFields && showSecretStorage && (
          <PasswordStorageBlock
            savePassword={savePassword}
            passwordStorage={profile.passwordStorage}
            vaultReady={vaultReady}
            vaultOpen={vaultOpen}
            keychainReady={keychainReady}
            onToggleSave={setSavePassword}
            onStorage={setStorage}
          />
        )}

        {networkForm && (
          <>
            <label className={formLabelClass}>
              Host
              <input
                required
                className={formInputClass}
                value={profile.host}
                onChange={(event) => onChange({ host: event.target.value })}
              />
            </label>
            <label className={formLabelClass}>
              Port
              <input
                required
                type="number"
                className={formInputClass}
                value={profile.port}
                onChange={(event) =>
                  onChange({ port: Number(event.target.value) })
                }
              />
            </label>
            <label className={`${formLabelClass} col-span-full`}>
              Database
              <input
                required
                className={formInputClass}
                value={profile.database}
                placeholder="database_name"
                onChange={(event) => onChange({ database: event.target.value })}
              />
            </label>
            <label className={formLabelClass}>
              Username
              <input
                required
                className={formInputClass}
                value={profile.username}
                onChange={(event) => onChange({ username: event.target.value })}
              />
            </label>
            <label className={formLabelClass}>
              Password
              <input
                type="password"
                className={formInputClass}
                value={profile.password}
                placeholder={passwordPlaceholder}
                onChange={(event) => onChange({ password: event.target.value })}
              />
            </label>

            <PasswordStorageBlock
              savePassword={savePassword}
              passwordStorage={profile.passwordStorage}
              vaultReady={vaultReady}
              vaultOpen={vaultOpen}
              keychainReady={keychainReady}
              onToggleSave={setSavePassword}
              onStorage={setStorage}
            />

            <label className={`${formLabelClass} col-span-full`}>
              SSL mode
              <select
                className={formInputClass}
                value={profile.sslMode}
                onChange={(event) =>
                  onChange({
                    sslMode: event.target.value as ConnectionProfile["sslMode"],
                  })
                }
              >
                <option value="prefer">Prefer</option>
                <option value="require">Require</option>
                <option value="disable">Disable</option>
              </select>
            </label>
          </>
        )}

        {caps?.noConnectionRequired && (
          <p className="m-0 text-muted text-xs leading-[1.45] col-span-full">
            This driver does not require host or credentials.
          </p>
        )}
      </div>
    </>
  );
}

function CustomConnectionField({
  field,
  value,
  passwordPlaceholder,
  onChange,
}: {
  field: ConnectionFieldDef;
  value: string | number;
  passwordPlaceholder?: string;
  onChange: (raw: string) => void;
}) {
  const full = field.width !== "half";
  const labelClass = cn(formLabelClass, full && "col-span-full");

  if (field.options && field.options.length > 0) {
    return (
      <label className={labelClass}>
        {field.label}
        <select
          required={field.required}
          className={formInputClass}
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
        >
          {!field.required && <option value="">—</option>}
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        {field.description && (
          <span className="block mt-1 text-subtle text-[10px] font-normal leading-[1.4]">
            {field.description}
          </span>
        )}
      </label>
    );
  }

  return (
    <label className={labelClass}>
      {field.label}
      <input
        required={field.required}
        className={formInputClass}
        type={
          field.key === "port"
            ? "number"
            : field.secret || field.key === "password"
              ? "password"
              : "text"
        }
        value={value}
        placeholder={
          field.secret || field.key === "password"
            ? passwordPlaceholder || field.placeholder
            : field.placeholder
        }
        onChange={(event) => onChange(event.target.value)}
      />
      {field.description && (
        <span className="block mt-1 text-subtle text-[10px] font-normal leading-[1.4]">
          {field.description}
        </span>
      )}
    </label>
  );
}

function PasswordStorageBlock({
  savePassword,
  passwordStorage,
  vaultReady,
  vaultOpen,
  keychainReady,
  onToggleSave,
  onStorage,
}: {
  savePassword: boolean;
  passwordStorage: PasswordStorage;
  vaultReady: boolean;
  vaultOpen: boolean;
  keychainReady: boolean;
  onToggleSave: (enabled: boolean) => void;
  onStorage: (mode: PasswordStorage) => void;
}) {
  return (
    <div className="col-span-full flex flex-col gap-2.5">
      <label className={checkboxRowClass}>
        <input
          type="checkbox"
          className={checkboxInputClass}
          checked={savePassword}
          onChange={(event) => onToggleSave(event.target.checked)}
        />
        <span>Save secret</span>
      </label>

      {savePassword && (
        <div
          className="flex flex-col gap-2 p-2.5 px-[11px] border border-border rounded-md bg-surface-deep"
          role="radiogroup"
          aria-label="Secret storage"
        >
          <label className="flex items-center gap-2 text-muted text-[11px] cursor-pointer">
            <input
              type="radio"
              name="password-storage"
              className="w-3.5 h-3.5 m-0 shrink-0 accent-accent cursor-pointer"
              checked={passwordStorage === "vault"}
              onChange={() => onStorage("vault")}
            />
            <span className="flex flex-col gap-0.5">
              <strong className="text-text-bright text-[11px] font-semibold">
                Into vault
              </strong>
              <em className="text-subtle text-[10px] not-italic">
                {vaultReady
                  ? vaultOpen
                    ? "Encrypted · vault unlocked"
                    : "Encrypted · unlock on save"
                  : "Encrypted · create a vault on save"}
              </em>
            </span>
          </label>
          <label
            className={cn(
              "flex items-center gap-2 text-muted text-[11px] cursor-pointer",
              !keychainReady && "opacity-50 cursor-default",
            )}
          >
            <input
              type="radio"
              name="password-storage"
              className="w-3.5 h-3.5 m-0 shrink-0 accent-accent cursor-pointer"
              checked={passwordStorage === "keychain"}
              disabled={!keychainReady}
              onChange={() => onStorage("keychain")}
            />
            <span className="flex flex-col gap-0.5">
              <strong className="text-text-bright text-[11px] font-semibold">
                OS credential store
              </strong>
              <em className="text-subtle text-[10px] not-italic">
                {keychainReady
                  ? "Managed by the system keychain · no master password"
                  : "Not available on this system"}
              </em>
            </span>
          </label>
          <label className="flex items-center gap-2 text-muted text-[11px] cursor-pointer">
            <input
              type="radio"
              name="password-storage"
              className="w-3.5 h-3.5 m-0 shrink-0 accent-accent cursor-pointer"
              checked={passwordStorage === "raw"}
              onChange={() => onStorage("raw")}
            />
            <span className="flex flex-col gap-0.5">
              <strong className="text-text-bright text-[11px] font-semibold">
                Raw
              </strong>
              <em className="text-subtle text-[10px] not-italic">
                Stored as plain text on this device
              </em>
            </span>
          </label>
        </div>
      )}
    </div>
  );
}
