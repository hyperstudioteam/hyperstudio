import {
  ConnectionFieldDef,
  ConnectionProfile,
  DriverInfo,
  PasswordStorage,
  SslMode,
} from "../../types/connection";
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
      <div className="driver-picker">
        {drivers.map((driver) => (
          <button
            type="button"
            key={driver.id}
            className={profile.driver === driver.id ? "active" : ""}
            onClick={() => onDriverChange(driver.id)}
            title={driver.description}
          >
            {driver.name}
          </button>
        ))}
      </div>

      <div className="form-grid">
        <label className="full">
          Connection name
          <input
            required
            value={profile.name}
            placeholder="Production database"
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </label>
        <label className="full">
          Folder
          <select
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
          <label className="full">
            Database file
            <input
              required
              value={profile.database}
              placeholder="/path/to/database.db"
              onChange={(event) => onChange({ database: event.target.value })}
            />
          </label>
        )}

        {caps?.folderBased && (
          <label className="full">
            Data folder
            <input
              required
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
            onToggleSave={setSavePassword}
            onStorage={setStorage}
          />
        )}

        {networkForm && (
          <>
            <label>
              Host
              <input
                required
                value={profile.host}
                onChange={(event) => onChange({ host: event.target.value })}
              />
            </label>
            <label>
              Port
              <input
                required
                type="number"
                value={profile.port}
                onChange={(event) =>
                  onChange({ port: Number(event.target.value) })
                }
              />
            </label>
            <label className="full">
              Database
              <input
                required
                value={profile.database}
                placeholder="database_name"
                onChange={(event) => onChange({ database: event.target.value })}
              />
            </label>
            <label>
              Username
              <input
                required
                value={profile.username}
                onChange={(event) => onChange({ username: event.target.value })}
              />
            </label>
            <label>
              Password
              <input
                type="password"
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
              onToggleSave={setSavePassword}
              onStorage={setStorage}
            />

            <label className="full">
              SSL mode
              <select
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
          <p className="full muted-hint">
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
  const className = full ? "full" : undefined;

  if (field.options && field.options.length > 0) {
    return (
      <label className={className}>
        {field.label}
        <select
          required={field.required}
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
          <span className="field-hint">{field.description}</span>
        )}
      </label>
    );
  }

  return (
    <label className={className}>
      {field.label}
      <input
        required={field.required}
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
        <span className="field-hint">{field.description}</span>
      )}
    </label>
  );
}

function PasswordStorageBlock({
  savePassword,
  passwordStorage,
  vaultReady,
  vaultOpen,
  onToggleSave,
  onStorage,
}: {
  savePassword: boolean;
  passwordStorage: PasswordStorage;
  vaultReady: boolean;
  vaultOpen: boolean;
  onToggleSave: (enabled: boolean) => void;
  onStorage: (mode: PasswordStorage) => void;
}) {
  return (
    <div className="full password-storage">
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={savePassword}
          onChange={(event) => onToggleSave(event.target.checked)}
        />
        <span>Save secret</span>
      </label>

      {savePassword && (
        <div
          className="storage-options"
          role="radiogroup"
          aria-label="Secret storage"
        >
          <label className="radio-row">
            <input
              type="radio"
              name="password-storage"
              checked={passwordStorage === "vault"}
              onChange={() => onStorage("vault")}
            />
            <span>
              <strong>Into vault</strong>
              <em>
                {vaultReady
                  ? vaultOpen
                    ? "Encrypted · vault unlocked"
                    : "Encrypted · unlock on save"
                  : "Encrypted · create a vault on save"}
              </em>
            </span>
          </label>
          <label className="radio-row">
            <input
              type="radio"
              name="password-storage"
              checked={passwordStorage === "raw"}
              onChange={() => onStorage("raw")}
            />
            <span>
              <strong>Raw</strong>
              <em>Stored as plain text on this device</em>
            </span>
          </label>
        </div>
      )}
    </div>
  );
}
