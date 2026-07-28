import { useState, useEffect, useCallback, useRef } from "react";
import { Card } from "./ui";
import { SkeletonTableRows } from "./SkeletonPatterns";
import { CopyButton } from "./CopyButton";
import type { ContractEvent } from "../types";
import type { SortField, SortDirection } from "../lib/useEventQuery";

interface EventFeedProps {
  events: ContractEvent[];
  loading: boolean;
  onRefresh?: () => void;
  title?: string;
  autoRefreshInterval?: number;
  compact?: boolean;
  /** Pagination controls — provided by useEventQuery. */
  hasNextPage?: boolean;
  hasPrevPage?: boolean;
  onNextPage?: () => void;
  onFirstPage?: () => void;
  page?: number;
  /** Sorting — provided by useEventQuery. */
  sort?: { field: SortField; direction: SortDirection };
  onSortChange?: (field: SortField, direction: SortDirection) => void;
}

export function EventFeed({
  events,
  loading,
  onRefresh,
  title = "Recent Activity",
  autoRefreshInterval,
  compact,
  hasNextPage,
  hasPrevPage,
  onNextPage,
  onFirstPage,
  page,
  sort,
  onSortChange,
}: EventFeedProps) {
  const [refreshing, setRefreshing] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  const handleRefresh = useCallback(() => {
    if (!onRefresh || loading) return;
    setRefreshing(true);
    onRefresh();
    setTimeout(() => setRefreshing(false), 500);
  }, [onRefresh, loading]);

  useEffect(() => {
    if (autoRefreshInterval && autoRefreshInterval > 0 && onRefresh) {
      intervalRef.current = setInterval(onRefresh, autoRefreshInterval);
      return () => clearInterval(intervalRef.current);
    }
  }, [autoRefreshInterval, onRefresh]);

  /** Render a sortable column header. */
  const SortTh = ({ field, label }: { field: SortField; label: string }) => {
    if (!onSortChange || !sort) return <th style={th}>{label}</th>;
    const active = sort.field === field;
    const next: SortDirection = active && sort.direction === "asc" ? "desc" : "asc";
    return (
      <th style={{ ...th, cursor: "pointer", userSelect: "none" }} onClick={() => onSortChange(field, next)}>
        {label}
        {active && (
          <span aria-label={sort.direction === "asc" ? "sorted ascending" : "sorted descending"}
            style={{ marginLeft: "0.3rem", fontSize: "0.7rem" }}>
            {sort.direction === "asc" ? "▲" : "▼"}
          </span>
        )}
      </th>
    );
  };

  return (
    <Card title={title} style={{ marginTop: "1.25rem" }}>
      {onRefresh && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.75rem" }}>
          <button
            onClick={handleRefresh}
            disabled={loading}
            aria-label="Refresh events"
            style={{
              fontSize: "0.8rem",
              padding: "0.3rem 0.8rem",
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--text-muted)",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
            }}
          >
            <span
              style={{
                display: "inline-block",
                animation: refreshing ? "spin 0.7s linear infinite" : undefined,
              }}
            >
              ↻
            </span>
            Refresh
          </button>
        </div>
      )}

      {loading ? (
        <SkeletonTableRows rows={compact ? 3 : 5} cols={compact ? 3 : 4} />
      ) : events.length === 0 ? (
        <div
          role="status"
          style={{
            padding: "2rem 0",
            textAlign: "center",
            color: "var(--text-muted)",
            fontSize: "0.875rem",
          }}
        >
          <p style={{ marginBottom: "0.25rem" }}>No recent events found.</p>
          <p style={{ fontSize: "0.8rem" }}>
            Events will appear here once contract activity occurs.
          </p>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "0.82rem",
            }}
          >
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                <SortTh field="type" label="Type" />
                <SortTh field="amount" label="Amount" />
                {!compact && <th style={th}>Counterparty</th>}
                <SortTh field="timestamp" label="Time" />
                <th style={{ ...th, width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev, i) => (
                <tr
                  key={ev.id ?? i}
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  <td style={td}>{ev.type}</td>
                  <td style={td}>{ev.amount}</td>
                  {!compact && (
                    <td
                      style={{
                        ...td,
                        fontFamily: "monospace",
                        maxWidth: 140,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {ev.counterparty}
                    </td>
                  )}
                  <td style={td}>{ev.timestamp}</td>
                  <td style={td}>
                    {ev.counterparty && (
                      <CopyButton
                        text={ev.counterparty}
                        label="Copy counterparty address"
                        style={{
                          padding: "0.2rem 0.5rem",
                          fontSize: "0.7rem",
                          border: "none",
                          background: "var(--surface-2)",
                        }}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination controls */}
      {(hasNextPage || hasPrevPage) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.75rem", fontSize: "0.8rem", color: "var(--text-muted)" }}>
          <button
            onClick={onFirstPage}
            disabled={!hasPrevPage || loading}
            aria-label="First page"
            style={paginationBtn}
          >
            ← First
          </button>
          <span>Page {page ?? 1}</span>
          <button
            onClick={onNextPage}
            disabled={!hasNextPage || loading}
            aria-label="Next page"
            style={paginationBtn}
          >
            Next →
          </button>
        </div>
      )}
    </Card>
  );
}

const th: React.CSSProperties = {
  padding: "0.4rem 0.5rem",
  fontWeight: 600,
  color: "var(--muted)",
};
const td: React.CSSProperties = { padding: "0.4rem 0.5rem" };
const paginationBtn: React.CSSProperties = {
  background: "none",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "0.25rem 0.7rem",
  cursor: "pointer",
  color: "var(--text-muted)",
  fontSize: "0.8rem",
};
