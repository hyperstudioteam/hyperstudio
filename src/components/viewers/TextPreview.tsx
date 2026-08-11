interface TextPreviewProps {
  text: string;
  nullValue?: boolean;
}

const emptyClass = "p-5 text-center text-[12px] text-muted";

export function TextPreview({ text, nullValue }: TextPreviewProps) {
  if (nullValue) {
    return <div className={emptyClass}>NULL</div>;
  }
  if (text === "") {
    return <div className={emptyClass}>Empty string</div>;
  }
  return (
    <pre
      data-allow-select-all
      className="m-0 font-mono text-[12px] leading-[1.55] whitespace-pre-wrap break-words text-text"
    >
      {text}
    </pre>
  );
}
