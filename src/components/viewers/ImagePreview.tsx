import { useState } from "react";

interface ImagePreviewProps {
  src: string;
}

export function ImagePreview({ src }: ImagePreviewProps) {
  const [errored, setErrored] = useState(false);

  if (errored) {
    return (
      <div className="viewer-empty">
        Could not load image.
        <code>{src}</code>
      </div>
    );
  }

  return (
    <div className="image-preview">
      <img src={src} alt="cell value" onError={() => setErrored(true)} />
      <code className="image-src">{src}</code>
    </div>
  );
}
