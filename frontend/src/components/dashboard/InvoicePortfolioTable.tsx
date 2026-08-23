/**
 * InvoicePortfolioTable — lists invoice positions where the wallet has a balance.
 * Issue #547
 */

import { Component, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, Skeleton } from "../ui";
import { contracts } from "../../lib/contracts/index";
import { CONTRACT_IDS } from "../../lib/stellar";
import type { InvoiceMeta } from "../../types";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  walletAddress: string | null;
}

interface InvoiceRow {
  invoiceId: string;
  status: number;
  faceValueUsd: bigint;
  balance: bigint;
  estimatedRedeemable: bigint;
  settled: boolean;
}

// Contract status enum mirrors invoice-token's InvoiceStatus
const STATUS_LABELS: Record<number, string> = {
  0: "Created",
  1: "Issued",
  2: "PartiallySettled",
  3: "FullySettled",
  4: "Redeemed",
};

const STATUS_COLORS: Record<number, string> = {
  0: "#6b7280",
  1: "#6366f1",
  2: "#f59e0b",
  3: "#10b981",
  4: "#8b5cf6",
};

// ── Error boundary ────────────────────────────────────────────────────────────

class InvoiceTableErrorBoundary extends Component<
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
        <Card title="Invoice Portfolio">
          <p style={{ color: "#ef4444", fontSize: "0.875rem" }}>
            Failed to load invoice portfolio.
          </p>
        </Card>
      );
    }
    return this.props.children;
  }
}

// ── Query ─────────────────────────────────────────────────────────────────────

async function fetchInvoiceRows(walletAddress: string): Promise<InvoiceRow[]> {
  if (!CONTRACT_IDS.invoiceToken) return [];

  let meta: InvoiceMeta;
  try {
    meta = await contracts.invoice.getMeta();
  } catch {
    return [];
  }

  const invoiceId = meta.invoice_id;
  const [balance, status, settled] = await Promise.all([
    contracts.invoice.balance(walletAddress).catch(() => 0n),
    contracts.invoice.invoiceStatus(invoiceId).catch(() => 0),
    contracts.invoice.isSettled().catch(() => false),
  ]);

  if (balance <= 0n) return [];

  // Estimated redeemable: face_value * balance / total_supply
  // Simplified: for settled invoices, redeemable ≈ balance (1:1 after discount);
  // for unsettled, show 0.
  const totalSupply = await contracts.invoice.totalSupply().catch(() => 0n);
  const estimatedRedeemable =
    settled && totalSupply > 0n
      ? (meta.face_value_usd * balance) / totalSupply
      : 0n;

  return [
    {
      invoiceId,
      status,
      faceValueUsd: meta.face_value_usd,
      balance,
      estimatedRedeemable,
      settled,
    },
  ];
}

// ── Inner component ───────────────────────────────────────────────────────────

function InvoicePortfolioTableInner({ walletAddress }: Props) {
  const { data: rows, isLoading, error } = useQuery({
    queryKey: ["invoicePortfolio", walletAddress],
    queryFn: () =>
      walletAddress ? fetchInvoiceRows(walletAddress) : Promise.resolve([]),
    enabled: !!walletAddress && !!CONTRACT_IDS.invoiceToken,
    staleTime: 30_000,
  });

  if (!CONTRACT_IDS.invoiceToken) {
    return (
      <Card title="Invoice Portfolio">
        <p className="muted" style={{ fontSize: "0.875rem" }}>
          Invoice token contract not configured.
        </p>
      </Card>
    );
  }

  if (!walletAddress) {
    return (
      <Card title="Invoice Portfolio">
        <p className="muted" style={{ fontSize: "0.875rem" }}>
          Connect wallet to view invoice positions.
        </p>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card title="Invoice Portfolio">
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <Skeleton height="2rem" />
          <Skeleton height="2rem" />
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card title="Invoice Portfolio">
        <p style={{ color: "#ef4444", fontSize: "0.875rem" }}>
          {error instanceof Error ? error.message : "Failed to load invoices."}
        </p>
      </Card>
    );
  }

  const data = rows ?? [];

  return (
    <Card title="Invoice Portfolio">
      {data.length === 0 ? (
        <p className="muted" style={{ fontSize: "0.875rem" }}>
          No invoice positions found for this wallet.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}
            aria-label="Invoice portfolio"
          >
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["Invoice ID", "Status", "Face Value", "Balance", "Est. Redeemable"].map(
                  (col) => (
                    <th
                      key={col}
                      scope="col"
                      style={{
                        padding: "0.5rem 0.75rem",
                        textAlign: "left",
                        fontWeight: 600,
                        color: "var(--text-muted)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {col}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr
                  key={row.invoiceId}
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  <td
                    style={{
                      padding: "0.55rem 0.75rem",
                      fontFamily: "monospace",
                      fontSize: "0.78rem",
                    }}
                  >
                    {row.invoiceId}
                  </td>
                  <td style={{ padding: "0.55rem 0.75rem" }}>
                    <span
                      style={{
                        padding: "0.2rem 0.55rem",
                        borderRadius: 999,
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        background: `${STATUS_COLORS[row.status]}20`,
                        color: STATUS_COLORS[row.status] ?? "#6b7280",
                      }}
                    >
                      {STATUS_LABELS[row.status] ?? `Status ${row.status}`}
                    </span>
                  </td>
                  <td style={{ padding: "0.55rem 0.75rem", whiteSpace: "nowrap" }}>
                    ${Number(row.faceValueUsd).toLocaleString()} USD
                  </td>
                  <td style={{ padding: "0.55rem 0.75rem", whiteSpace: "nowrap" }}>
                    {Number(row.balance).toLocaleString()}
                  </td>
                  <td style={{ padding: "0.55rem 0.75rem", whiteSpace: "nowrap" }}>
                    {row.settled
                      ? `${Number(row.estimatedRedeemable).toLocaleString()} USD`
                      : <span className="muted">Not yet settled</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function InvoicePortfolioTable(props: Props) {
  return (
    <InvoiceTableErrorBoundary>
      <InvoicePortfolioTableInner {...props} />
    </InvoiceTableErrorBoundary>
  );
}
