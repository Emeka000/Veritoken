/**
 * LockupStatusCard — issue #443: shows whether a wallet's balance is
 * currently subject to a compliance-engine holding period, and how much
 * time remains before the restriction lifts.
 */

import { useEffect, useState } from "react";
import { contracts } from "../lib/contracts/index";
import { Card, Skeleton } from "./ui";
import type { LockupStatus } from "../types";

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0m";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (days === 0 && minutes > 0) parts.push(`${minutes}m`);
  return parts.length ? parts.join(" ") : "<1m";
}

export default function LockupStatusCard({ address }: { address: string }) {
  const [status, setStatus] = useState<LockupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    contracts.compliance
      .getLockupStatus(address)
      .then((result) => {
        if (!cancelled) setStatus(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  if (loading) {
    return (
      <Card title="Lockup Status" style={{ marginBottom: "1.25rem" }}>
        <Skeleton height="1.5rem" width="220px" />
      </Card>
    );
  }

  // Silently omit the card if the contract can't be reached or doesn't yet
  // expose lockup_status — this is a supplementary indicator, not core state.
  if (failed || !status) return null;

  if (!status.is_holder) {
    return (
      <Card title="Lockup Status" style={{ marginBottom: "1.25rem" }}>
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          You don't currently hold a balance, so no holding period applies.
        </p>
      </Card>
    );
  }

  const minPeriod = Number(status.min_holding_period);
  const remaining = Number(status.seconds_until_unlock);
  const totalWindow = minPeriod > 0 ? minPeriod : 1;
  const elapsedPct = status.locked
    ? Math.max(0, Math.min(100, ((totalWindow - remaining) / totalWindow) * 100))
    : 100;

  return (
    <Card title="Lockup Status" style={{ marginBottom: "1.25rem" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
          marginBottom: status.locked ? "0.6rem" : 0,
        }}
      >
        <span
          style={{
            fontWeight: 700,
            fontSize: "0.95rem",
            color: status.locked ? "var(--warning)" : "var(--success)",
          }}
        >
          {status.locked
            ? `Locked · ${formatDuration(remaining)} remaining`
            : "Transferable now"}
        </span>
      </div>
      {status.locked && (
        <div
          role="progressbar"
          aria-label="Holding period progress"
          aria-valuenow={Math.round(elapsedPct)}
          aria-valuemin={0}
          aria-valuemax={100}
          style={{
            width: "100%",
            height: 8,
            borderRadius: 999,
            background: "var(--surface-2)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${elapsedPct}%`,
              height: "100%",
              borderRadius: 999,
              background: "var(--warning)",
              transition: "width 0.3s ease",
            }}
          />
        </div>
      )}
      <p className="muted" style={{ fontSize: "0.78rem", marginTop: "0.5rem" }}>
        {minPeriod > 0
          ? `Held since ${new Date(Number(status.holder_since) * 1000).toLocaleString()}. Minimum holding period: ${formatDuration(minPeriod)}.`
          : "No minimum holding period is currently enforced."}
        {status.max_holding_period > 0n && (
          <>
            {" "}
            Must transfer out by{" "}
            {new Date(Number(status.max_release_at) * 1000).toLocaleString()}.
          </>
        )}
      </p>
    </Card>
  );
}
