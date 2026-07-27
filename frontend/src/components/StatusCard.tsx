import { useEffect, useState } from "react";
import { useWallet } from "../lib/wallet";
import { contracts } from "../lib/contracts/index";
import { CONTRACT_IDS } from "../lib/stellar";
import { Card, Skeleton } from "./ui";
import type { KycRecord } from "../types";

const THIRTY_DAYS_S = 30 * 24 * 60 * 60;

function kycBadgeStyle(status: string): React.CSSProperties {
  if (status === "Approved") return { background: "#22c55e22", color: "#16a34a", border: "1px solid #16a34a55" };
  if (status === "Revoked" || status === "Rejected") return { background: "#ef444422", color: "#dc2626", border: "1px solid #dc262655" };
  return { background: "#f59e0b22", color: "#d97706", border: "1px solid #d9770655" };
}

const TIER_LABELS: Record<number, string> = {
  0: "Basic",
  1: "Accredited",
  2: "Institutional",
};

function tierLabel(tier: number): string {
  return TIER_LABELS[tier] ?? `Tier ${tier}`;
}

interface StatusData {
  record: KycRecord | null;
  invoiceBalance: bigint;
  propertyBalance: bigint;
  carbonBalance: bigint;
  pendingDividend: bigint;
}

export default function StatusCard() {
  const { address, connected } = useWallet();
  const [status, setStatus] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connected || !address) {
      setStatus(null);
      return;
    }

    setLoading(true);
    setError(null);

    const fetchKyc = CONTRACT_IDS.kycRegistry
      ? contracts.kyc.getRecord(address).catch(() => null)
      : Promise.resolve(null);
    const fetchInvoice = CONTRACT_IDS.invoiceToken
      ? contracts.invoice.balance(address).catch(() => 0n)
      : Promise.resolve(0n);
    const fetchProperty = CONTRACT_IDS.propertyToken
      ? contracts.property.balance(address).catch(() => 0n)
      : Promise.resolve(0n);
    const fetchCarbon = CONTRACT_IDS.carbonToken
      ? contracts.carbon.balance(address).catch(() => 0n)
      : Promise.resolve(0n);
    const fetchDividend = CONTRACT_IDS.propertyToken
      ? contracts.property.pendingDividend(address).catch(() => 0n)
      : Promise.resolve(0n);

    Promise.all([fetchKyc, fetchInvoice, fetchProperty, fetchCarbon, fetchDividend])
      .then(([record, invoiceBalance, propertyBalance, carbonBalance, pendingDividend]) => {
        setStatus({ record, invoiceBalance, propertyBalance, carbonBalance, pendingDividend });
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load status");
      })
      .finally(() => setLoading(false));
  }, [address, connected]);

  if (!connected) return null;

  return (
    <Card title="My Status" style={{ marginBottom: "1.5rem" }}>
      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div>
            <div style={{ marginBottom: "0.5rem" }}><Skeleton height="0.8rem" width="30%" /></div>
            <Skeleton height="1rem" width="80%" />
          </div>
          <div>
            <div style={{ marginBottom: "0.5rem" }}><Skeleton height="0.8rem" width="30%" /></div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem" }}>
              <Skeleton height="3rem" width="100%" />
              <Skeleton height="3rem" width="100%" />
              <Skeleton height="3rem" width="100%" />
            </div>
          </div>
        </div>
      )}
      {error && !loading && (
        <p style={{ fontSize: "0.875rem", color: "var(--error, #f87171)" }}>{error}</p>
      )}
      {status && !loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {/* KYC status */}
          <div>
            <div className="muted" style={{ fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem" }}>
              KYC Status
            </div>
            {status.record ? (
              <div
                role="status"
                aria-live="polite"
                aria-label={`KYC status: ${status.record.status}`}
                style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}
              >
                <span style={{
                  ...kycBadgeStyle(status.record.status as string),
                  padding: "0.2rem 0.65rem",
                  borderRadius: 9999,
                  fontSize: "0.8rem",
                  fontWeight: 700,
                }}>
                  {status.record.status as string}
                </span>
                <span style={{ fontSize: "0.85rem" }}>
                  <strong>Tier:</strong> {tierLabel(status.record.tier)}
                </span>
                <span style={{ fontSize: "0.85rem" }}>
                  <strong>Jurisdiction:</strong> {status.record.jurisdiction}
                </span>
                {status.record.expiry > 0 && (() => {
                  const nowS = Math.floor(Date.now() / 1000);
                  const secondsLeft = status.record!.expiry - nowS;
                  const expiring = secondsLeft > 0 && secondsLeft < THIRTY_DAYS_S;
                  const expired = secondsLeft <= 0;
                  const expiryDate = new Date(status.record!.expiry * 1000).toLocaleDateString();
                  return (
                    <span style={{ fontSize: "0.85rem", color: expired || expiring ? "#f59e0b" : undefined }}>
                      <strong>Expires:</strong> {expiryDate}
                      {expiring && " ⚠ expiring soon"}
                      {expired && " ⚠ expired"}
                    </span>
                  );
                })()}
              </div>
            ) : (
              <span className="muted" style={{ fontSize: "0.875rem" }}>No KYC record found</span>
            )}
          </div>

          {/* Balances */}
          <div>
            <div className="muted" style={{ fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem" }}>
              Token Balances
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "0.75rem" }}>
              <BalanceCell label="Invoice" value={status.invoiceBalance} />
              <BalanceCell label="Property Shares" value={status.propertyBalance} />
              <BalanceCell label="Carbon Credits" value={status.carbonBalance} />
              {status.pendingDividend > 0n && (
                <BalanceCell label="Pending Dividends" value={status.pendingDividend} stroops />
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function BalanceCell({ label, value, stroops }: { label: string; value: bigint; stroops?: boolean }) {
  const display = stroops
    ? `${(Number(value) / 1e7).toFixed(7)} XLM`
    : value.toString();
  return (
    <div style={{ padding: "0.6rem 0.75rem", borderRadius: 10, background: "var(--surface-2)", border: "1px solid var(--border)" }}>
      <div className="muted" style={{ fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: "1.1rem", fontWeight: 700, marginTop: "0.25rem" }}>{display}</div>
    </div>
  );
}
