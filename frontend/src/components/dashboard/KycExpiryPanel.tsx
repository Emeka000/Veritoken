/**
 * KycExpiryPanel — shows KYC status, expiry countdown, and CTA.
 * Issue #547
 */

import { Component, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, Skeleton } from "../ui";
import { contracts } from "../../lib/contracts/index";
import { CONTRACT_IDS } from "../../lib/stellar";
import type { KycRecord } from "../../types";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  walletAddress: string | null;
}

const THIRTY_DAYS_S = 30 * 24 * 60 * 60;

// ── Error boundary ────────────────────────────────────────────────────────────

class KycExpiryErrorBoundary extends Component<
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
        <Card title="KYC Status">
          <p style={{ color: "#ef4444", fontSize: "0.875rem" }}>
            Failed to load KYC status.
          </p>
        </Card>
      );
    }
    return this.props.children;
  }
}

// ── Query ─────────────────────────────────────────────────────────────────────

async function fetchKycRecord(address: string): Promise<KycRecord | null> {
  if (!CONTRACT_IDS.kycRegistry) return null;
  try {
    return await contracts.kyc.getRecord(address);
  } catch {
    return null;
  }
}

// ── Inner component ───────────────────────────────────────────────────────────

function KycExpiryPanelInner({ walletAddress }: Props) {
  const { data: record, isLoading, error } = useQuery({
    queryKey: ["kycRecord", walletAddress],
    queryFn: () =>
      walletAddress ? fetchKycRecord(walletAddress) : Promise.resolve(null),
    enabled: !!walletAddress,
    staleTime: 30_000,
  });

  if (!walletAddress) {
    return (
      <Card title="KYC Status">
        <p className="muted" style={{ fontSize: "0.875rem" }}>
          Connect wallet to view KYC status.
        </p>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card title="KYC Status">
        <Skeleton height="3rem" />
      </Card>
    );
  }

  if (error || !record) {
    return (
      <Card title="KYC Status">
        <div
          role="alert"
          style={{
            padding: "0.75rem 1rem",
            borderRadius: 8,
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.25)",
          }}
        >
          <p style={{ fontWeight: 600, fontSize: "0.875rem", marginBottom: "0.35rem" }}>
            Not KYC approved
          </p>
          <p className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.5rem" }}>
            No KYC record found for this wallet. Complete verification to participate in token operations.
          </p>
          <Link
            to="/kyc"
            style={{
              fontSize: "0.8rem",
              color: "var(--accent-2)",
              textDecoration: "underline",
            }}
          >
            Go to KYC Registry →
          </Link>
        </div>
      </Card>
    );
  }

  const isApproved = record.status === "Approved";
  const nowS = Math.floor(Date.now() / 1000);
  const expiry = typeof record.expiry === "bigint" ? Number(record.expiry) : record.expiry;
  const hasExpiry = expiry > 0;
  const daysRemaining = hasExpiry ? Math.ceil((expiry - nowS) / 86400) : null;
  const expiresWithin30 = hasExpiry && expiry - nowS < THIRTY_DAYS_S;

  if (!isApproved) {
    return (
      <Card title="KYC Status">
        <div
          role="alert"
          style={{
            padding: "0.75rem 1rem",
            borderRadius: 8,
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.25)",
          }}
        >
          <p style={{ fontWeight: 600, fontSize: "0.875rem", marginBottom: "0.35rem" }}>
            Not KYC approved
          </p>
          <p className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.5rem" }}>
            Status: <strong>{record.status}</strong>. Contact your verifier to update your KYC record.
          </p>
          <Link
            to="/kyc"
            style={{ fontSize: "0.8rem", color: "var(--accent-2)", textDecoration: "underline" }}
          >
            Go to KYC Registry →
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <Card title="KYC Status">
      {expiresWithin30 && (
        <div
          role="alert"
          aria-live="polite"
          style={{
            padding: "0.75rem 1rem",
            borderRadius: 8,
            background: "rgba(245,158,11,0.08)",
            border: "1px solid rgba(245,158,11,0.35)",
            marginBottom: "0.75rem",
          }}
        >
          <p style={{ fontWeight: 600, fontSize: "0.875rem", color: "#f59e0b", marginBottom: "0.25rem" }}>
            ⚠ KYC expiring soon
          </p>
          <p className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.5rem" }}>
            {daysRemaining !== null && daysRemaining > 0
              ? `${daysRemaining} day${daysRemaining !== 1 ? "s" : ""} remaining`
              : "Expired"}
            . Renew your KYC before it lapses to avoid transfer restrictions.
          </p>
          <Link
            to="/kyc"
            style={{ fontSize: "0.8rem", color: "#f59e0b", textDecoration: "underline" }}
          >
            Renew KYC →
          </Link>
        </div>
      )}

      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "max-content 1fr",
          gap: "0.3rem 1rem",
          fontSize: "0.875rem",
          margin: 0,
        }}
      >
        <dt className="muted">Status</dt>
        <dd style={{ margin: 0 }}>
          <span
            style={{
              padding: "0.15rem 0.5rem",
              borderRadius: 999,
              fontSize: "0.75rem",
              fontWeight: 600,
              background: "rgba(16,185,129,0.12)",
              color: "#10b981",
            }}
          >
            {record.status}
          </span>
        </dd>

        <dt className="muted">Tier</dt>
        <dd style={{ margin: 0 }}>{record.tier}</dd>

        <dt className="muted">Jurisdiction</dt>
        <dd style={{ margin: 0 }}>{record.jurisdiction || "—"}</dd>

        <dt className="muted">Expiry</dt>
        <dd style={{ margin: 0 }}>
          {!hasExpiry ? (
            <span className="muted">No expiry set</span>
          ) : (
            <span style={{ color: expiresWithin30 ? "#f59e0b" : undefined }}>
              {new Date(expiry * 1000).toLocaleDateString()}
              {daysRemaining !== null && daysRemaining > 0 && (
                <span className="muted" style={{ marginLeft: "0.4rem", fontSize: "0.78rem" }}>
                  ({daysRemaining}d remaining)
                </span>
              )}
            </span>
          )}
        </dd>
      </dl>
    </Card>
  );
}

export function KycExpiryPanel(props: Props) {
  return (
    <KycExpiryErrorBoundary>
      <KycExpiryPanelInner {...props} />
    </KycExpiryErrorBoundary>
  );
}
