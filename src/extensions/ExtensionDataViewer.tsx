import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { pluginsApi } from "../api/database";
import { errorMessage } from "../lib/format";
import type { CellContext } from "../plugins/contributions";
import type { RegisteredViewer } from "./types";

export function ExtensionDataViewer({
  viewer,
  context,
}: {
  viewer: RegisteredViewer;
  context: CellContext;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [src, setSrc] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void pluginsApi
      .resolveAsset(viewer.source, viewer.entry)
      .then((path) => active && setSrc(convertFileSrc(path)))
      .catch((reason) => active && setError(errorMessage(reason)));
    return () => {
      active = false;
    };
  }, [viewer.entry, viewer.source]);

  if (error) return <div className="text-xs text-danger">{error}</div>;
  if (!src) {
    return (
      <div className="grid min-h-40 place-items-center text-muted">
        <LoaderCircle className="animate-spin-slow" size={18} />
      </div>
    );
  }
  return (
    <iframe
      ref={frame}
      title={viewer.label}
      src={src}
      sandbox="allow-scripts allow-forms"
      className="h-[420px] w-full border-0"
      onLoad={() =>
        frame.current?.contentWindow?.postMessage(
          {
            protocol: "hyperstudio-extension-v1",
            type: "event",
            event: "init",
            payload: { viewerId: viewer.id, context },
          },
          "*",
        )
      }
    />
  );
}
