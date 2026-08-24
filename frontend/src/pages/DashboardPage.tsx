/**
 * DashboardPage — Cross-asset portfolio analytics dashboard.
 *
 * Route: /dashboard
 * Issue #547
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useWallet } from "../lib/wallet";
import { PageHeader, Icon } from "../components/ui";
import { PortfolioSummaryCard } from "../components/dashboard/PortfolioSummaryCard";
import { DividendHistoryChart } from "../components/dashboard/DividendHistoryChart";
import { KycExpiryPanel } from "../components/dashboard/KycExpiryPanel";
import { ComplianceAlertTimeline } from "../components/dashboard/ComplianceAlertTimeline";
import { InvoicePortfolioTable } from "../components/dashboard/InvoicePortfolioTable";

// ── Query client ──────────────────────────────────────────────────────────────
// Provide a local QueryClient so this page can also be rendered standalone in
// tests without needing the root-level provider.

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

// ── Layout helpers ────────────────────────────────────────────────────────────

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  gap: "1.25rem",
};

// ── Page ──────────────────────────────────────────────────────────────────────

function DashboardContent() {
  const { address } = useWallet();

  return (
    <div>
      <PageHeader
        eyebrow="Analytics"
        icon={<Icon.bolt size={22} />}
        title="Portfolio Dashboard"
        description="Aggregated view across all your token positions — balances, dividends, KYC status, and compliance alerts."
      />

      {/* Row 1: Portfolio summary + KYC */}
      <div style={{ ...gridStyle, marginBottom: "1.25rem" }}>
        <PortfolioSummaryCard walletAddress={address ?? null} />
        <KycExpiryPanel walletAddress={address ?? null} />
      </div>

      {/* Row 2: Dividend chart + Compliance alerts */}
      <div style={{ ...gridStyle, marginBottom: "1.25rem" }}>
        <DividendHistoryChart walletAddress={address ?? null} />
        <ComplianceAlertTimeline />
      </div>

      {/* Row 3: Invoice portfolio (full-width) */}
      <InvoicePortfolioTable walletAddress={address ?? null} />
    </div>
  );
}

export default function DashboardPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <DashboardContent />
    </QueryClientProvider>
  );
}
