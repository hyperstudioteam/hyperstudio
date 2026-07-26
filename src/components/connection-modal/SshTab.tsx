import {
  ConnectionProfile,
  SshAuth,
  SshTunnelSettings,
  blankSsh,
} from "../../types/connection";

interface SshTabProps {
  profile: ConnectionProfile;
  onChange: (patch: Partial<ConnectionProfile>) => void;
}

const formLabelClass =
  "flex flex-col gap-[5px] text-[#9199a7] text-[10px] font-[540]";
const formInputClass =
  "w-full h-[34px] px-[9px] border border-border-bright rounded-[5px] text-[#d2d7df] bg-surface-input text-[11px] focus:border-accent placeholder:text-[#4e5663]";
const checkboxRowClass =
  "flex flex-row items-center gap-2 text-[#b4bbc6] text-[11px] font-normal cursor-pointer";
const checkboxInputClass =
  "w-3.5 h-3.5 m-0 p-0 border-0 rounded-none bg-transparent shrink-0 accent-accent cursor-pointer";

export function SshTab({ profile, onChange }: SshTabProps) {
  const ssh = profile.ssh ?? blankSsh();

  function patchSsh(patch: Partial<SshTunnelSettings>) {
    onChange({ ssh: { ...ssh, ...patch } });
  }

  return (
    <div className="grid grid-cols-[1fr_110px] gap-3">
      <label className={`${checkboxRowClass} col-span-full`}>
        <input
          type="checkbox"
          className={checkboxInputClass}
          checked={ssh.enabled}
          onChange={(event) => patchSsh({ enabled: event.target.checked })}
        />
        <span>Connect through an SSH tunnel</span>
      </label>

      {!ssh.enabled ? (
        <p className="col-span-full m-0 text-[10px] leading-relaxed text-subtle">
          Use this when the database is only reachable from a bastion host. The
          app opens a local port forward and dials the database through it.
        </p>
      ) : (
        <>
          <label className={formLabelClass}>
            SSH host
            <input
              className={formInputClass}
              value={ssh.host}
              placeholder="bastion.example.com"
              required
              onChange={(event) => patchSsh({ host: event.target.value })}
            />
          </label>
          <label className={formLabelClass}>
            Port
            <input
              type="number"
              className={formInputClass}
              value={ssh.port}
              min={1}
              max={65535}
              onChange={(event) =>
                patchSsh({ port: Number(event.target.value) || 22 })
              }
            />
          </label>
          <label className={`${formLabelClass} col-span-full`}>
            SSH username
            <input
              className={formInputClass}
              value={ssh.username}
              placeholder="ubuntu"
              required
              onChange={(event) => patchSsh({ username: event.target.value })}
            />
          </label>

          <fieldset className="col-span-full m-0 flex flex-col gap-2 rounded-md border border-border bg-[#14171d] p-2.5 px-[11px]">
            <legend className="px-1 text-[10px] text-[#9199a7]">
              Authentication
            </legend>
            {(
              [
                ["password", "Password"],
                ["key", "Private key"],
                ["agent", "SSH agent"],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className="flex cursor-pointer items-center gap-2 text-[11px] text-[#b4bbc6]"
              >
                <input
                  type="radio"
                  name="ssh-auth"
                  className="m-0 size-3.5 shrink-0 cursor-pointer accent-accent"
                  checked={ssh.auth === value}
                  onChange={() => patchSsh({ auth: value as SshAuth })}
                />
                {label}
              </label>
            ))}
          </fieldset>

          {ssh.auth === "password" && (
            <label className={`${formLabelClass} col-span-full`}>
              SSH password
              <input
                type="password"
                className={formInputClass}
                value={ssh.password}
                placeholder="SSH password"
                autoComplete="off"
                onChange={(event) => patchSsh({ password: event.target.value })}
              />
            </label>
          )}

          {ssh.auth === "key" && (
            <>
              <label className={`${formLabelClass} col-span-full`}>
                Private key path
                <input
                  className={formInputClass}
                  value={ssh.privateKeyPath}
                  placeholder="~/.ssh/id_ed25519"
                  onChange={(event) =>
                    patchSsh({ privateKeyPath: event.target.value })
                  }
                />
              </label>
              <label className={`${formLabelClass} col-span-full`}>
                Key passphrase
                <input
                  type="password"
                  className={formInputClass}
                  value={ssh.passphrase}
                  placeholder="Optional"
                  autoComplete="off"
                  onChange={(event) =>
                    patchSsh({ passphrase: event.target.value })
                  }
                />
              </label>
            </>
          )}

          {ssh.auth === "agent" && (
            <p className="col-span-full m-0 text-[10px] leading-relaxed text-subtle">
              Uses the local SSH agent (Unix/macOS). Make sure your key is
              loaded with <code className="text-[#c4cad4]">ssh-add</code>.
            </p>
          )}

          <p className="col-span-full m-0 text-[10px] leading-relaxed text-subtle">
            Database host and port on the General tab are the address as seen
            from the SSH server (often a private IP or{" "}
            <code className="text-[#c4cad4]">localhost</code>).
          </p>
        </>
      )}
    </div>
  );
}
