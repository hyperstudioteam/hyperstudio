import { useState } from "react";

interface ImagePreviewProps {
  src: string;
}

export function ImagePreview({ src }: ImagePreviewProps) {
  const [errored, setErrored] = useState(false);

  if (errored) {
    return (
      <div className="p-5 text-center text-[12px] text-muted">
        Could not load image.
        <code className="mt-1.5 block break-all text-[10px] text-subtle">
          {src}
        </code>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <img
        className="max-h-[360px] max-w-full rounded-md border border-border bg-[#0c0e12]"
        src={src}
        alt="cell value"
        onError={() => setErrored(true)}
      />
      <code className="break-all text-[10px] text-subtle">{src}</code>
    </div>
  );
}
