import { ConnectionProfile, Driver, PasswordStorage } from "../../types/connection";
import { vaultExists, isVaultUnlocked } from "../../lib/vault";

interface GeneralTabProps {
  profile: ConnectionProfile;
  folderId: string | null;
  folderOptions: { id: string | null; label: string }[];
  onChange: (patch: Partial<ConnectionProfile>) => void;
  onDriverChange: (driver: Driver) => void;
  onFolderChange: (folderId: string | null) => void;
}

export function GeneralTab({
  profile,
  folderId,
  folderOptions,
  onChange,
  onDriverChange,
  onFolderChange,
}: GeneralTabProps) {
  const savePassword = profile.passwordStorage !== "none";
  const vaultReady = vaultExists();
  const vaultOpen = isVaultUnlocked();

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

  return (
    <>
      <div className="driver-picker">
        {(["postgres", "mysql"] as Driver[]).map((driver) => (
          <button
            type="button"
            key={driver}
            className={profile.driver === driver ? "active" : ""}
            onClick={() => onDriverChange(driver)}
          >
            {driver === "postgres" ? "PostgreSQL" : "MySQL"}
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

        <div className="full password-storage">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={savePassword}
              onChange={(event) => setSavePassword(event.target.checked)}
            />
            <span>Save password</span>
          </label>

          {savePassword && (
            <div className="storage-options" role="radiogroup" aria-label="Password storage">
              <label className="radio-row">
                <input
                  type="radio"
                  name="password-storage"
                  checked={profile.passwordStorage === "vault"}
                  onChange={() => setStorage("vault")}
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
                  checked={profile.passwordStorage === "raw"}
                  onChange={() => setStorage("raw")}
                />
                <span>
                  <strong>Raw password</strong>
                  <em>Stored as plain text on this device</em>
                </span>
              </label>
            </div>
          )}
        </div>

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
      </div>
    </>
  );
}
