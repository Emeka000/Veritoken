import { useState, type CSSProperties } from "react";
import { Icon } from "./ui";

export interface HelpItem {
  heading: string;
  body: string;
}

interface HelpPanelProps {
  title: string;
  items: HelpItem[];
  style?: CSSProperties;
}

export default function HelpPanel({ title, items, style }: HelpPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <section className="card" style={style}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
          textAlign: "left",
        }}
      >
        <span style={{ fontSize: "0.95rem", fontWeight: 700 }}>{title}</span>
        <Icon.arrow
          size={14}
          style={{
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.18s ease",
            flexShrink: 0,
          }}
        />
      </button>

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem", marginTop: "1.1rem" }}>
          {items.map((item) => (
            <div key={item.heading}>
              <p style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.25rem" }}>{item.heading}</p>
              <p className="muted" style={{ fontSize: "0.82rem", lineHeight: 1.55 }}>
                {item.body}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
