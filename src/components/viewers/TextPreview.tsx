interface TextPreviewProps {
  text: string;
  nullValue?: boolean;
}

export function TextPreview({ text, nullValue }: TextPreviewProps) {
  if (nullValue) {
    return <div className="viewer-empty">NULL</div>;
  }
  if (text === "") {
    return <div className="viewer-empty">Empty string</div>;
  }
  return <pre className="text-preview">{text}</pre>;
}
