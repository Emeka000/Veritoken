import { Skeleton } from "./ui";

export function SkeletonCard({ rows = 4 }: { rows?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <Skeleton height="1.25rem" width="40%" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} height="1rem" width={`${60 + (i % 3) * 15}%`} />
      ))}
    </div>
  );
}

export function SkeletonTableRows({ rows = 4, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap: "1rem",
            padding: "0.75rem 0",
          }}
        >
          {Array.from({ length: cols }).map((_, j) => (
            <Skeleton key={j} height="1.25rem" width={j === 0 ? "80%" : "60%"} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height="0.9rem" width={`${70 + (i % 3) * 10}%`} />
      ))}
    </div>
  );
}

export function SkeletonForm({ fields = 4 }: { fields?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <Skeleton height="0.8rem" width="30%" />
          <Skeleton height="2.5rem" width="100%" />
        </div>
      ))}
    </div>
  );
}
