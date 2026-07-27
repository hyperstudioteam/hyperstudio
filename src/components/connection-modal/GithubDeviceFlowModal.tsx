import { useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, CloudSync, X } from "lucide-react";
import {
  DeviceCodeResponse,
  openDeviceVerification,
  waitForDeviceAuthorization,
} from "../../lib/githubAuth";
import { errorMessage } from "../../lib/format";

interface GithubDeviceFlowModalProps {
  clientId: string;
  device: DeviceCodeResponse;
  onAuthorized: () => void;
  onClose: () => void;
}

export function GithubDeviceFlowModal({
  clientId,
  device,
  onAuthorized,
  onClose,
}: GithubDeviceFlowModalProps) {
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState("Waiting for authorization…");
  const abortRef = useRef<AbortController | null>(null);
  const onAuthorizedRef = useRef(onAuthorized);
  onAuthorizedRef.current = onAuthorized;

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    setError("");
    setStatus("Waiting for authorization…");

    void waitForDeviceAuthorization(clientId, device, controller.signal)
      .then(() => {
        setStatus("Authorized.");
        onAuthorizedRef.current();
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(errorMessage(err));
        setStatus("Authorization failed.");
      });

    return () => {
      controller.abort();
      abortRef.current = null;
    };
  }, [clientId, device]);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(device.userCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  function handleClose() {
    abortRef.current?.abort();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center p-5 bg-[rgba(5,7,10,.72)] backdrop-blur-[4px]"
      onMouseDown={(event) =>
        event.target === event.currentTarget && handleClose()
      }
    >
      <div className="w-[min(420px,100%)] max-h-full overflow-auto p-[18px] border border-border-bright rounded-[10px] bg-surface shadow-[0_24px_70px_rgba(0,0,0,.48)]">
        <div className="flex items-center justify-between mb-[17px]">
          <div className="flex items-center gap-2.5">
            <span className="w-7 h-7 shrink-0 rounded-md grid place-items-center text-accent bg-accent-soft">
              <CloudSync size={17} />
            </span>
            <h2 className="m-0 text-text-bright text-sm font-[630]">
              Connect GitHub
            </h2>
          </div>
          <button
            type="button"
            className="w-7 h-7 grid place-items-center p-0 border-0 rounded-[5px] text-muted bg-transparent cursor-pointer enabled:hover:text-text enabled:hover:bg-panel-soft"
            aria-label="Close"
            onClick={handleClose}
          >
            <X size={17} />
          </button>
        </div>

        <p className="m-0 mb-3.5 text-[12px] leading-[1.45] text-[#aab1be]">
          Enter this code on GitHub, then approve access for HyperStudio.
        </p>

        <div className="mb-3.5 flex items-center justify-between gap-2 rounded-[7px] border border-border-bright bg-panel-soft px-3 py-2.5">
          <code className="text-[18px] font-[700] tracking-[0.18em] text-text-bright">
            {device.userCode}
          </code>
          <button
            type="button"
            className="h-[28px] px-2.5 border-0 rounded-[5px] text-[10px] font-semibold cursor-pointer text-[#c4cad4] bg-transparent hover:text-text hover:bg-surface flex items-center gap-1"
            onClick={() => void copyCode()}
          >
            <Copy size={13} />
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        <div className="flex flex-wrap gap-2 mb-3.5">
          <button
            type="button"
            className="h-[32px] px-3 border-0 rounded-[5px] text-white bg-accent text-[11px] font-[600] cursor-pointer hover:brightness-110 inline-flex items-center gap-1.5"
            onClick={() => void openDeviceVerification(device.verificationUri)}
          >
            <ExternalLink size={14} />
            Open GitHub
          </button>
        </div>

        <p className="m-0 text-[11px] text-[#8b93a1]">{status}</p>

        {error && (
          <div className="mt-3 px-2.5 py-2 rounded-[5px] text-[10px] [overflow-wrap:anywhere] text-[#d18b91] bg-[rgba(239,107,115,.08)]">
            {error}
          </div>
        )}

        <div className="mt-[18px] pt-3.5 border-t border-border flex justify-end">
          <button
            type="button"
            className="h-[32px] px-3 border border-border-bright rounded-[5px] text-[#c4cad4] bg-transparent text-[11px] cursor-pointer hover:text-text hover:bg-panel-soft"
            onClick={handleClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
