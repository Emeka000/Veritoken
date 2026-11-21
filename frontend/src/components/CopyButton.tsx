import { useState } from "react";
import { useClipboard } from "../lib/clipboard";

interface CopyButtonProps {
  text: string;
  label?: string;
  className?: string;
  style?: React.CSSProperties;
  onCopy?: () => void;
}

export function CopyButton({ text, label, className, style, onCopy }: CopyButtonProps) {
  const { copied, copy } = useClipboard();
  const [announcement, setAnnouncement] = useState("");

  return (
    <>
    <button
      onClick={() =>
        copy(text).then((ok) => {
          if (!ok) {
            setAnnouncement("Copy failed — please copy manually");
            return;
          }
          setAnnouncement("Copied to clipboard");
          onCopy?.();
        })
      }
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
    <span
      role="status"
      aria-live="polite"
      style={{
        position: "absolute",
        width: 1,
        height: 1,
        padding: 0,
        margin: -1,
        overflow: "hidden",
        clip: "rect(0, 0, 0, 0)",
        whiteSpace: "nowrap",
        border: 0,
      }}
    >
      {announcement}
    </span>
    </>
  );
}