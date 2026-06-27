import type { ReactNode, CSSProperties } from "react";

/* ── Icons ──────────────────────────────────────────────────────────────────
   Lightweight stroke icons (24x24). `currentColor` so they inherit text color.
*/

type IconProps = { size?: number; style?: CSSProperties };

const base = (size: number): CSSProperties => ({
  width: size,
  height: size,
  display: "block",
});

function svg(
  size: number,
  style: CSSProperties | undefined,
  children: ReactNode,
) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ ...base(size), ...style }}
    >
      {children}
    </svg>
  );
}

export const Icon = {
  invoice: ({ size = 24, style }: IconProps) =>
    svg(
      size,
      style,
      <>
        <path d="M5 3h9l5 5v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
        <path d="M14 3v5h5" />
        <path d="M8 13h8M8 17h5" />
      </>,
    ),
  property: ({ size = 24, style }: IconProps) =>
    svg(
      size,
      style,
      <>
        <path d="M3 21h18" />
        <path d="M5 21V8l7-4 7 4v13" />
        <path d="M9 21v-5h6v5" />
        <path d="M9 11h.01M15 11h.01" />
      </>,
    ),
  carbon: ({ size = 24, style }: IconProps) =>
    svg(
      size,
      style,
      <>
        <path d="M11 20A7 7 0 0 1 9.8 6.1C12 4 17 4 19 4c0 2 0 7-2.1 9.2A7 7 0 0 1 11 20Z" />
        <path d="M5 20c0-3 1.5-5.5 4-7.5" />
      </>,
    ),
  kyc: ({ size = 24, style }: IconProps) =>
    svg(
      size,
      style,
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="9" cy="11" r="2" />
        <path d="M6 16c.5-1.5 1.7-2.2 3-2.2s2.5.7 3 2.2" />
        <path d="M15 10h3M15 13h3" />
      </>,
    ),
  admin: ({ size = 24, style }: IconProps) =>
    svg(
      size,
      style,
      <>
        <path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h7M15 18h5" />
        <circle cx="16" cy="6" r="2" />
        <circle cx="8" cy="12" r="2" />
        <circle cx="13" cy="18" r="2" />
      </>,
    ),
  shield: ({ size = 24, style }: IconProps) =>
    svg(
      size,
      style,
      <>
        <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3Z" />
        <path d="M9 12l2 2 4-4" />
      </>,
    ),
  bolt: ({ size = 24, style }: IconProps) =>
    svg(size, style, <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />),
  link: ({ size = 24, style }: IconProps) =>
    svg(
      size,
      style,
      <>
        <path d="M9 15l6-6" />
        <path d="M11 6l1-1a4 4 0 0 1 6 6l-1 1" />
        <path d="M13 18l-1 1a4 4 0 0 1-6-6l1-1" />
      </>,
    ),
  arrow: ({ size = 24, style }: IconProps) =>
    svg(
      size,
      style,
      <>
        <path d="M5 12h14" />
        <path d="M13 6l6 6-6 6" />
      </>,
    ),
};

/* ── Page header ────────────────────────────────────────────────────────── */

export function PageHeader({
  eyebrow,
  title,
  description,
  icon,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  icon?: ReactNode;
}) {
  return (
    <header style={{ marginBottom: "1.75rem" }}>
      {eyebrow && (
        <span className="eyebrow" style={{ marginBottom: "0.7rem" }}>
          {eyebrow}
        </span>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.9rem",
          marginTop: eyebrow ? "0.6rem" : 0,
        }}
      >
        {icon && (
          <div
            style={{
              display: "grid",
              placeItems: "center",
              width: 46,
              height: 46,
              borderRadius: 13,
              background: "var(--accent-soft)",
              border: "1px solid var(--border)",
              color: "var(--accent-2)",
              flexShrink: 0,
            }}
          >
            {icon}
          </div>
        )}
        <h1 style={{ fontSize: "1.85rem", fontWeight: 800 }}>{title}</h1>
      </div>
      {description && (
        <p
          className="muted"
          style={{ marginTop: "0.7rem", maxWidth: 620, fontSize: "0.95rem" }}
        >
          {description}
        </p>
      )}
    </header>
  );
}

/* ── Card ───────────────────────────────────────────────────────────────── */

export function Card({
  title,
  subtitle,
  children,
  style,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section className="card" style={style}>
      {title && (
        <div style={{ marginBottom: "1.25rem" }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700 }}>{title}</h2>
          {subtitle && (
            <p
              className="muted"
              style={{ fontSize: "0.85rem", marginTop: "0.25rem" }}
            >
              {subtitle}
            </p>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

/* ── Form controls ──────────────────────────────────────────────────────── */

export function Field({
  label,
  name,
  type = "text",
  value,
  onChange,
  required,
  placeholder,
  error,
}: {
  label: string;
  name?: string;
  type?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  required?: boolean;
  placeholder?: string;
  error?: string | null;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <input
        name={name}
        type={type}
        value={value}
        onChange={onChange}
        required={required}
        placeholder={placeholder}
        style={error ? { borderColor: "#ef4444" } : undefined}
      />
      {error && (
        <div
          style={{ color: "#ef4444", fontSize: "0.8rem", marginTop: "0.25rem" }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

export function Select({
  label,
  name,
  value,
  onChange,
  options,
}: {
  label: string;
  name?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <select name={name} value={value} onChange={onChange}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ── Skeleton loader ────────────────────────────────────────────────────── */

export function Skeleton({
  width = "100%",
  height = "1rem",
  className,
}: {
  width?: string;
  height?: string;
  className?: string;
}) {
  return (
    <div
      className={className}
      style={{
        width,
        height,
        background: "var(--surface-2)",
        borderRadius: "0.5rem",
        animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      }}
    />
  );
}
