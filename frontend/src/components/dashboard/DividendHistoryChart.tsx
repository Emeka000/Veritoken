/**
 * DividendHistoryChart — AreaChart of dividend distributions for property tokens.
 * Issue #547
 */

import { Component, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, Skeleton } from "../ui";
import { contracts } from "../../lib/contracts/index";
import { CONTRACT_IDS } from "../../lib/stellar";
import type { DividendEvent } from "../../types";

// ── Types ─────────────────────────────────────────────────────────────────────

type Range = "all" | "90d";

interface ChartPoint {
  ts: number;
  dateLabel: string;
  amount: number;
  unclaimed: boolean;
}

interface Props {
  walletAddress: string | null;
}

// ── Error boundary ────────────────────────────────────────────────────────────

class DividendErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <Card title="Dividend History">
          <p style={{ color: "#ef4444", fontSize: "0.875rem" }}>
            Failed to load dividend history.
          </p>
        </Card>
      );
    }
    return this.props.children;
  }
}

// ── Query ─────────────────────────────────────────────────────────────────────

async function fetchDividendData(walletAddress: string): Promise<{
  events: DividendEvent[];
  pendingDps: bigint;
}> {
  if (!CONTRACT_IDS.propertyToken) return { events: [], pendingDps: 0n };

  const count = await contracts.property.dividendDepositCount().catch(() => 0);
  if (count === 0) return { events: [], pendingDps: 0n };

  const start = count > 50 ? count - 50 : 0;
  const [events, pending] = await Promise.all([
    contracts.property.getDividendHistory(start, 50).catch(() => [] as DividendEvent[]),
    contracts.property.pendingDividend(walletAddress).catch(() => 0n),
  ]);

  return { events: [...events].reverse(), pendingDps: pending };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toChartPoints(
  events: DividendEvent[],
  pendingDps: bigint,
  range: Range
): ChartPoint[] {
  const now = Date.now() / 1000;
  const cutoff = range === "90d" ? now - 90 * 86400 : 0;

  return events
    .filter((e) => e.timestamp >= cutoff)
    .map((e) => ({
      ts: e.timestamp,
      dateLabel: new Date(e.timestamp * 1000).toLocaleDateString(),
      amount: Number(e.amount),
      unclaimed: pendingDps > 0n,
    }));
}

// ── Inner component ───────────────────────────────────────────────────────────

function DividendHistoryChartInner({ walletAddress }: Props) {
  const [range, setRange] = useState<Range>("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["dividendHistory", walletAddress],
    queryFn: () =>
      walletAddress
        ? fetchDividendData(walletAddress)
        : Promise.resolve({ events: [], pendingDps: 0n }),
    enabled: !!walletAddress && !!CONTRACT_IDS.propertyToken,
    staleTime: 30_000,
  });

  if (!CONTRACT_IDS.propertyToken) {
    return (
      <Card title="Dividend History">
        <p className="muted" style={{ fontSize: "0.875rem" }}>
          Property token contract not configured.
        </p>
      </Card>
    );
  }

  if (!walletAddress) {
    return (
      <Card title="Dividend History">
        <p className="muted" style={{ fontSize: "0.875rem" }}>
          Connect wallet to view dividend history.
        </p>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card title="Dividend History">
        <Skeleton height="180px" />
      </Card>
    );
  }

  if (error) {
    return (
      <Card title="Dividend History">
        <p style={{ color: "#ef4444", fontSize: "0.875rem" }}>
          {error instanceof Error ? error.message : "Failed to load data."}
        </p>
      </Card>
    );
  }

  const { events = [], pendingDps = 0n } = data ?? {};
  const points = toChartPoints(events, pendingDps, range);

  return (
    <Card title="Dividend History">
      {/* Range toggle */}
      <div
        style={{ display: "flex", gap: "0.35rem", marginBottom: "1rem" }}
        role="group"
        aria-label="Time range"
      >
        {(["all", "90d"] as Range[]).map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            onKeyDown={(e) => e.key === "Enter" && setRange(r)}
            className={range === r ? "" : "btn-ghost"}
            style={{ fontSize: "0.78rem", padding: "0.3rem 0.7rem" }}
            aria-pressed={range === r}
          >
            {r === "all" ? "All time" : "Last 90 days"}
          </button>
        ))}
      </div>

      {points.length === 0 ? (
        <p className="muted" style={{ fontSize: "0.875rem" }}>
          No dividend distributions found for the selected range.
        </p>
      ) : (
        <div
          role="img"
          aria-label={`Dividend history chart with ${points.length} data points`}
          style={{ width: "100%", height: 200 }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="dateLabel"
                tick={{ fontSize: 11, fill: "var(--text-muted)" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--text-muted)" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => v.toLocaleString()}
              />
              <Tooltip formatter={(v: number) => [`${v.toLocaleString()} stroops`, "Amount"]} />
              <Area
                type="monotone"
                dataKey="amount"
                stroke="#10b981"
                fill="rgba(16,185,129,0.15)"
                strokeWidth={2}
                dot={(dotProps) => {
                  const { cx, cy, payload } = dotProps as { cx: number; cy: number; payload: ChartPoint };
                  return (
                    <circle
                      key={`dot-${payload.ts}`}
                      cx={cx}
                      cy={cy}
                      r={4}
                      fill={payload.unclaimed ? "#f59e0b" : "#10b981"}
                      stroke="none"
                    />
                  );
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {pendingDps > 0n && (
        <p
          style={{
            fontSize: "0.78rem",
            marginTop: "0.5rem",
            color: "#f59e0b",
          }}
        >
          ● Highlighted points indicate distributions with unclaimed dividends
        </p>
      )}
    </Card>
  );
}

export function DividendHistoryChart(props: Props) {
  return (
    <DividendErrorBoundary>
      <DividendHistoryChartInner {...props} />
    </DividendErrorBoundary>
  );
}
