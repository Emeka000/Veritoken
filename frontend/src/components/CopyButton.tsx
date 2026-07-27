import { useClipboard } from "../lib/clipboard";

interface CopyButtonProps {
  text: string;
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function CopyButton({ text, label, className, style }: CopyButtonProps) {
  const { copied, copy } = useClipboard();

  return (
    <button
      onClick={() => copy(text)}
      aria-label={label ?? `Copy ${text}`}
      className={className}
      style={{
        fontSize: "0.75rem",
        padding: "0.3rem 0.75rem",
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: "var(--surface)",
        color: copied ? "var(--success)" : "var(--text)",
        cursor: "pointer",
        transition: "color 0.2s ease",
        flexShrink: 0,
        ...style,
      }}
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}
