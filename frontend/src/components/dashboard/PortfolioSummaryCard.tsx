/**
 * PortfolioSummaryCard — shows per-asset-type balance breakdown and a pie chart.
 * Issue #547
 */

import { Component, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Card, Skeleton } from "../ui";
import { contracts } from "../../lib/contracts/index";
import { CONTRACT_IDS } from "../../lib/stellar";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AssetBalance {
  assetType: string;
  label: string;
  balance: bigint;
  contractId: string;
}

interface Props {
  walletAddress: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const COLORS: Record<string, string> = {
  Invoice: "#6366f1",
  Property: "#10b981",
  Carbon: "#f59e0b",
};

const ASSET_CONTRACTS: Array<{
  key: keyof typeof CONTRACT_IDS;
  label: string;
  assetType: string;
  getBalance: (addr: string) => Promise<bigint>;
}> = [
  {
    key: "invoiceToken",
    label: "Invoice",
    assetType: "invoice",
    getBalance: (addr) => contracts.invoice.balance(addr),
  },
  {
    key: "propertyToken",
    label: "Property",
    assetType: "property",
    getBalance: (addr) => contracts.property.balance(addr),
  },
  {
    key: "carbonToken",
    label: "Carbon",
    assetType: "carbon",
    getBalance: (addr) => contracts.carbon.balance(addr),
  },
];

// ── Error boundary for this card ──────────────────────────────────────────────

class PortfolioErrorBoundary extends Component<
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
        <Card title="Portfolio Summary">
          <p style={{ color: "#ef4444", fontSize: "0.875rem" }}>
            Failed to load portfolio data.
          </p>
        </Card>
      );
    }
    return this.props.children;
  }
}

// ── Query function ────────────────────────────────────────────────────────────

async function fetchPortfolioBalances(walletAddress: string): Promise<AssetBalance[]> {
  const results = await Promise.allSettled(
    ASSET_CONTRACTS.filter((a) => CONTRACT_IDS[a.key]).map(async (asset) => ({
      assetType: asset.assetType,
      label: asset.label,
      balance: await asset.getBalance(walletAddress),
      contractId: CONTRACT_IDS[asset.key],
    }))
  );

  return results
    .filter(
      (r): r is PromiseFulfilledResult<AssetBalance> => r.status === "fulfilled"
    )
    .map((r) => r.value);
}

// ── Component ─────────────────────────────────────────────────────────────────

function PortfolioSummaryCardInner({ walletAddress }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["portfolioBalances", walletAddress],
    queryFn: () =>
      walletAddress ? fetchPortfolioBalances(walletAddress) : Promise.resolve([]),
    enabled: !!walletAddress,
    staleTime: 30_000,
  });

  if (!walletAddress) {
    return (
      <Card title="Portfolio Summary">
        <p className="muted" style={{ fontSize: "0.875rem" }}>
          Connect wallet to view your portfolio.
        </p>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card title="Portfolio Summary">
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          <Skeleton height="1rem" width="60%" />
          <Skeleton height="1rem" width="80%" />
          <Skeleton height="180px" />
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card title="Portfolio Summary">
        <p style={{ color: "#ef4444", fontSize: "0.875rem" }}>
          {error instanceof Error ? error.message : "Failed to load balances."}
        </p>
      </Card>
    );
  }

  const balances = data ?? [];
  const nonZero = balances.filter((b) => b.balance > 0n);
  const totalPositions = nonZero.length;

  const pieData = nonZero.map((b) => ({
    name: b.label,
    value: Number(b.balance),
  }));

  return (
    <Card title="Portfolio Summary">
      <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <div>
          <p className="muted" style={{ fontSize: "0.78rem", marginBottom: "0.2rem" }}>
            Active positions
          </p>
          <p style={{ fontSize: "1.5rem", fontWeight: 700 }}>{totalPositions}</p>
        </div>
        {nonZero.map((b) => (
          <div key={b.assetType}>
            <p className="muted" style={{ fontSize: "0.78rem", marginBottom: "0.2rem" }}>
              {b.label}
            </p>
            <p style={{ fontSize: "1.1rem", fontWeight: 600 }}>
              {Number(b.balance).toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      {pieData.length > 0 ? (
        <div
          role="img"
          aria-label={`Portfolio breakdown: ${pieData.map((d) => `${d.name} ${d.value}`).join(", ")}`}
          style={{ width: "100%", height: 200 }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={70}
                label={({ name }) => name}
              >
                {pieData.map((entry) => (
                  <Cell
                    key={entry.name}
                    fill={COLORS[entry.name] ?? "#8884d8"}
                  />
                ))}
              </Pie>
              <Tooltip formatter={(value: number) => value.toLocaleString()} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="muted" style={{ fontSize: "0.875rem" }}>
          No token positions found for this wallet.
        </p>
      )}
    </Card>
  );
}

export function PortfolioSummaryCard(props: Props) {
  return (
    <PortfolioErrorBoundary>
      <PortfolioSummaryCardInner {...props} />
    </PortfolioErrorBoundary>
  );
}
