/**
 * MarketplacePage — Issue #439
 *
 * Asset Marketplace Readiness Layer.
 *
 * Surfaces tokenised assets available for discovery with indicative pricing,
 * listing status, and compliance readiness signals.  All data is read-only;
 * no marketplace smart-contract is required.  The page is intentionally
 * designed as a readiness layer — it shows what is already on-chain and flags
 * gaps that would block a full trading workflow.
 */

import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { PageHeader, Card, Icon, Skeleton } from "../components/ui";
import HelpPanel from "../components/HelpPanel";
import { readApi } from "../lib/readApi";
import { CONTRACT_IDS } from "../lib/stellar";
import type { TokenSnapshot, ComplianceSnapshot } from "../lib/readApi";

// ── Types ─────────────────────────────────────────────────────────────────────

type ReadinessLevel = "ready" | "partial" | "not-ready";

interface AssetListing {
  id: string;
  name: string;
  symbol: string;
  assetType: string;
  totalSupply: bigint;
  maxSupply: bigint;
  contractId: string | undefined;
  readiness: ReadinessLevel;
  readinessReasons: string[];
  kycRequired: boolean;
  compliancePaused: boolean;
  holderCount: number;
}

interface MarketplaceState {
  listings: AssetListing[];
  loading: boolean;
  error: string | null;
  fetchedAt: string | null;
}

// ── Help items ────────────────────────────────────────────────────────────────

const HELP_ITEMS = [
  {
    heading: "What is the Marketplace Readiness Layer?",
    body: "This page shows all tokenised assets deployed on this network and evaluates whether each one is ready for secondary-market activity. It does not execute trades — it helps you identify what needs to be in place before listing on an exchange or offering OTC.",
  },
  {
    heading: "What does 'Ready' mean?",
    body: "A Ready asset has a configured contract, tokens in circulation, active compliance rules, and is not paused. Buyers and sellers with valid KYC can transfer tokens right now.",
  },
  {
    heading: "What does 'Partial' mean?",
    body: "The contract is deployed but one or more conditions aren't met — for example, no tokens have been minted yet, or compliance rules haven't been set. The asset is not yet tradeable.",
  },
  {
    heading: "How do I list an asset?",
    body: "Deploy the contract (Deploy page), mint initial supply (asset page), configure compliance rules (Admin page), and ensure KYC is available for participants (KYC page). Once all signals show Ready, the asset can be offered on secondary markets.",
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: bigint, decimals = 7): string {
  if (n === 0n) return "0";
  const whole = n / BigInt(10 ** decimals);
  return whole.toLocaleString();
}

function utilizationPct(supply: bigint, max: bigint): number | null {
  if (max === 0n) return null;
  return Math.round(Number((supply * 10000n) / max) / 100);
}

function ReadinessBadge({ level }: { level: ReadinessLevel }) {
  const map: Record<ReadinessLevel, { label: string; bg: string; color: string }> = {
    ready:     { label: "Ready",     bg: "rgba(52,211,153,0.12)", color: "#34d399" },
    partial:   { label: "Partial",   bg: "rgba(251,191,36,0.12)", color: "#fbbf24" },
    "not-ready": { label: "Not ready", bg: "rgba(248,113,113,0.12)", color: "#f87171" },
  };
  const s = map[level];
  return (
    <span
      role="status"
      style={{
        display: "inline-block",
        padding: "0.2rem 0.65rem",
        borderRadius: 99,
        fontSize: "0.72rem",
        fontWeight: 700,
        background: s.bg,
        color: s.color,
      }}
    >
      {s.label}
    </span>
  );
}

function SupplyBar({ supply, max }: { supply: bigint; max: bigint }) {
  const pct = utilizationPct(supply, max);
  if (pct === null) return <span className="muted" style={{ fontSize: "0.8rem" }}>No cap</span>;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
      <div style={{ flex: 1, height: 5, borderRadius: 99, background: "var(--surface-2)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: "var(--accent)", borderRadius: 99 }} />
      </div>
      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", minWidth: 32 }}>{pct}%</span>
    </div>
  );
}

function ListingCard({ listing }: { listing: AssetListing }) {
  const [expanded, setExpanded] = useState(false);

  const assetPageMap: Record<string, string> = {
    invoice: "/invoices",
    property: "/property",
    carbon_credit: "/carbon",
  };
  const href = assetPageMap[listing.assetType] ?? "/";

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontWeight: 700, fontSize: "1rem" }}>{listing.name || listing.symbol || "—"}</span>
            {listing.symbol && listing.name && (
              <span className="muted" style={{ fontSize: "0.8rem" }}>{listing.symbol}</span>
            )}
          </div>
          <span className="muted" style={{ fontSize: "0.78rem", textTransform: "capitalize" }}>
            {listing.assetType.replace(/_/g, " ")}
          </span>
        </div>
        <ReadinessBadge level={listing.readiness} />
      </div>

      {/* Metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
        <div>
          <p style={{ fontSize: "0.72rem", color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.15rem" }}>Circulating</p>
          <p style={{ fontSize: "0.925rem", fontWeight: 600 }}>{fmt(listing.totalSupply)}</p>
        </div>
        <div>
          <p style={{ fontSize: "0.72rem", color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.15rem" }}>Holders</p>
          <p style={{ fontSize: "0.925rem", fontWeight: 600 }}>{listing.holderCount || "—"}</p>
        </div>
      </div>

      {/* Supply bar */}
      <SupplyBar supply={listing.totalSupply} max={listing.maxSupply} />

      {/* Status flags */}
      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
        {listing.compliancePaused && (
          <span style={{ fontSize: "0.72rem", background: "rgba(248,113,113,0.1)", color: "#f87171", padding: "0.15rem 0.5rem", borderRadius: 99 }}>
            Paused
          </span>
        )}
        {listing.kycRequired && (
          <span style={{ fontSize: "0.72rem", background: "var(--accent-soft)", color: "var(--accent-2)", padding: "0.15rem 0.5rem", borderRadius: 99 }}>
            KYC required
          </span>
        )}
        {!listing.contractId && (
          <span style={{ fontSize: "0.72rem", background: "rgba(251,191,36,0.1)", color: "#fbbf24", padding: "0.15rem 0.5rem", borderRadius: 99 }}>
            Not deployed
          </span>
        )}
      </div>

      {/* Readiness reasons */}
      {listing.readinessReasons.length > 0 && (
        <div>
          <button
            onClick={() => setExpanded((x: boolean) => !x)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent-2)", fontSize: "0.78rem", padding: 0 }}
            aria-expanded={expanded}
          >
            {expanded ? "Hide details ▲" : "Show readiness details ▼"}
          </button>
          {expanded && (
            <ul style={{ marginTop: "0.5rem", paddingLeft: "1rem", listStyleType: "disc" }}>
              {listing.readinessReasons.map((r, i) => (
                <li key={i} style={{ fontSize: "0.8rem", color: "var(--text-muted)", lineHeight: 1.55 }}>{r}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* CTA */}
      <Link
        to={href}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.35rem",
          fontSize: "0.82rem",
          fontWeight: 600,
          color: "var(--accent-2)",
          textDecoration: "none",
          marginTop: "auto",
        }}
      >
        Open {listing.assetType.replace(/_/g, " ")} page
        <Icon.arrow size={13} />
      </Link>
    </div>
  );
}

// ── Build listing from snapshot ───────────────────────────────────────────────

function buildListings(
  rwaToken: TokenSnapshot | null,
  compliance: ComplianceSnapshot,
): AssetListing[] {
  const listings: AssetListing[] = [];

  // RWA / invoice token (primary)
  if (CONTRACT_IDS.rwaToken || rwaToken) {
    const reasons: string[] = [];
    let readiness: ReadinessLevel = "ready";

    if (!CONTRACT_IDS.rwaToken) {
      reasons.push("Contract not deployed in this environment.");
      readiness = "not-ready";
    } else if (rwaToken && rwaToken.totalSupply === 0n) {
      reasons.push("No tokens minted yet.");
      readiness = readiness === "ready" ? "partial" : readiness;
    }
    if (compliance.paused) {
      reasons.push("Compliance engine is paused — transfers blocked.");
      readiness = "not-ready";
    }
    if (!compliance.rules) {
      reasons.push("Compliance rules not configured.");
      readiness = readiness === "ready" ? "partial" : readiness;
    }
    if (compliance.holderCount === 0) {
      reasons.push("No registered holders — KYC approvals needed before trading.");
      readiness = readiness === "ready" ? "partial" : readiness;
    }

    listings.push({
      id: "rwa-token",
      name: rwaToken?.name ?? "RWA Token",
      symbol: rwaToken?.symbol ?? "",
      assetType: rwaToken?.assetType ?? "invoice",
      totalSupply: rwaToken?.totalSupply ?? 0n,
      maxSupply: rwaToken?.maxSupply ?? 0n,
      contractId: CONTRACT_IDS.rwaToken,
      readiness,
      readinessReasons: reasons,
      kycRequired: true,
      compliancePaused: compliance.paused,
      holderCount: compliance.holderCount,
    });
  }

  // Invoice token
  if (CONTRACT_IDS.invoiceToken) {
    const reasons: string[] = [];
    let readiness: ReadinessLevel = "partial";
    reasons.push("Invoice token tracks receivable lifecycle — readiness depends on individual invoices.");
    if (compliance.paused) {
      reasons.push("Compliance engine is paused.");
      readiness = "not-ready";
    }
    listings.push({
      id: "invoice-token",
      name: "Invoice Token",
      symbol: "INV",
      assetType: "invoice",
      totalSupply: 0n,
      maxSupply: 0n,
      contractId: CONTRACT_IDS.invoiceToken,
      readiness,
      readinessReasons: reasons,
      kycRequired: true,
      compliancePaused: compliance.paused,
      holderCount: 0,
    });
  }

  // Property token
  if (CONTRACT_IDS.propertyToken) {
    const reasons: string[] = [];
    let readiness: ReadinessLevel = "partial";
    reasons.push("Property token is configured. Verify total shares and legal metadata are set before listing.");
    if (compliance.paused) {
      reasons.push("Compliance engine is paused.");
      readiness = "not-ready";
    }
    listings.push({
      id: "property-token",
      name: "Property Token",
      symbol: "PROP",
      assetType: "property",
      totalSupply: 0n,
      maxSupply: 0n,
      contractId: CONTRACT_IDS.propertyToken,
      readiness,
      readinessReasons: reasons,
      kycRequired: true,
      compliancePaused: compliance.paused,
      holderCount: 0,
    });
  }

  // Carbon credit token
  if (CONTRACT_IDS.carbonToken) {
    const reasons: string[] = [];
    let readiness: ReadinessLevel = "partial";
    reasons.push("Carbon credit token configured. Ensure project metadata and verifier registry are set.");
    if (compliance.paused) {
      reasons.push("Compliance engine is paused.");
      readiness = "not-ready";
    }
    listings.push({
      id: "carbon-token",
      name: "Carbon Credit Token",
      symbol: "CCT",
      assetType: "carbon_credit",
      totalSupply: 0n,
      maxSupply: 0n,
      contractId: CONTRACT_IDS.carbonToken,
      readiness,
      readinessReasons: reasons,
      kycRequired: true,
      compliancePaused: compliance.paused,
      holderCount: 0,
    });
  }

  // Show a placeholder when nothing is deployed
  if (listings.length === 0) {
    listings.push({
      id: "placeholder",
      name: "No assets deployed",
      symbol: "",
      assetType: "invoice",
      totalSupply: 0n,
      maxSupply: 0n,
      contractId: undefined,
      readiness: "not-ready",
      readinessReasons: ["No contract IDs are configured. Deploy contracts first via the Deploy page."],
      kycRequired: false,
      compliancePaused: false,
      holderCount: 0,
    });
  }

  return listings;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MarketplacePage() {
  const [state, setState] = useState<MarketplaceState>({
    listings: [],
    loading: true,
    error: null,
    fetchedAt: null,
  });

  const [filter, setFilter] = useState<"all" | ReadinessLevel>("all");

  const load = async () => {
    setState((s: MarketplaceState) => ({ ...s, loading: true, error: null }));
    try {
      const snap = await readApi.globalSnapshot();
      const listings = buildListings(snap.rwaToken, snap.compliance);
      setState({ listings, loading: false, error: null, fetchedAt: snap.fetchedAt });
    } catch (err) {
      setState((s: MarketplaceState) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to load marketplace data.",
      }));
    }
  };

  useEffect(() => { load(); }, []);

  const visible = filter === "all"
    ? state.listings
    : state.listings.filter((l: AssetListing) => l.readiness === filter);

  const readyCounts = {
    ready:       state.listings.filter((l: AssetListing) => l.readiness === "ready").length,
    partial:     state.listings.filter((l: AssetListing) => l.readiness === "partial").length,
    "not-ready": state.listings.filter((l: AssetListing) => l.readiness === "not-ready").length,
  };

  const FILTERS: Array<{ key: "all" | ReadinessLevel; label: string }> = [
    { key: "all",       label: `All (${state.listings.length})` },
    { key: "ready",     label: `Ready (${readyCounts.ready})` },
    { key: "partial",   label: `Partial (${readyCounts.partial})` },
    { key: "not-ready", label: `Not ready (${readyCounts["not-ready"]})` },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Marketplace"
        title="Asset Marketplace"
        description="Discover tokenised assets on this network and check their secondary-market readiness before listing or trading."
        icon={<Icon.bolt size={22} />}
      />

      {/* Summary strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem", marginBottom: "1.75rem" }}>
        {[
          { label: "Total assets",  value: state.loading ? "—" : String(state.listings.length) },
          { label: "Ready",         value: state.loading ? "—" : String(readyCounts.ready),        color: "#34d399" },
          { label: "Partial",       value: state.loading ? "—" : String(readyCounts.partial),      color: "#fbbf24" },
          { label: "Not ready",     value: state.loading ? "—" : String(readyCounts["not-ready"]), color: "#f87171" },
        ].map((m) => (
          <div key={m.label} className="card" style={{ padding: "0.85rem 1rem" }}>
            <p style={{ fontSize: "0.72rem", color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.25rem" }}>{m.label}</p>
            <p style={{ fontSize: "1.4rem", fontWeight: 700, color: m.color }}>{m.value}</p>
          </div>
        ))}
      </div>

      {/* Filter tabs + refresh */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1.25rem" }}>
        <div role="group" aria-label="Filter assets" style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={filter === f.key ? "btn-accent" : "btn-ghost"}
              style={{ fontSize: "0.78rem", padding: "0.35rem 0.75rem" }}
              aria-pressed={filter === f.key}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          onClick={load}
          disabled={state.loading}
          className="btn-ghost"
          style={{ fontSize: "0.78rem" }}
          aria-label="Refresh listings"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Error */}
      {state.error && (
        <div role="alert" style={{ padding: "0.85rem 1rem", borderRadius: 10, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)", color: "#f87171", fontSize: "0.845rem", marginBottom: "1.25rem" }}>
          {state.error}
        </div>
      )}

      {/* Listings grid */}
      {state.loading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1.25rem" }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="card" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <Skeleton height="1.1rem" width="55%" />
              <Skeleton height="0.85rem" width="35%" />
              <Skeleton height="0.85rem" width="70%" />
              <Skeleton height="0.85rem" width="50%" />
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1.25rem" }}>
          {visible.map((l: AssetListing) => <ListingCard key={l.id} listing={l} />)}
        </div>
      )}

      {!state.loading && visible.length === 0 && (
        <Card>
          <p className="muted" style={{ textAlign: "center", padding: "2rem 0" }}>
            No assets match the selected filter.
          </p>
        </Card>
      )}

      {/* Checklist for getting to "Ready" */}
      <Card title="Marketplace readiness checklist" style={{ marginTop: "2rem" }}>
        {[
          { step: "1", label: "Deploy contracts", desc: "Use the Deploy page to initialise your token and compliance contracts on this network.", href: "/deploy" },
          { step: "2", label: "Configure compliance rules", desc: "Set transfer limits, holding periods, and tier policies in the Admin page.", href: "/admin" },
          { step: "3", label: "Register KYC holders", desc: "Approve at least one issuer/admin and your initial investor set via the KYC page.", href: "/kyc" },
          { step: "4", label: "Mint initial supply", desc: "Issue tokens to the designated holder(s) on the asset-specific page.", href: "/" },
          { step: "5", label: "Verify readiness", desc: "Return here and confirm all assets show the Ready badge before listing externally.", href: "/marketplace" },
        ].map((item) => (
          <div key={item.step} style={{ display: "flex", gap: "0.85rem", padding: "0.75rem 0", borderBottom: "1px solid var(--border)" }}>
            <span className="badge badge-accent" style={{ flexShrink: 0, alignSelf: "flex-start", marginTop: "0.1rem" }}>{item.step}</span>
            <div>
              <Link to={item.href} style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--text)" }}>{item.label}</Link>
              <p className="muted" style={{ fontSize: "0.82rem", marginTop: "0.2rem" }}>{item.desc}</p>
            </div>
          </div>
        ))}
      </Card>

      {/* Help */}
      <HelpPanel title="About the Marketplace layer" items={HELP_ITEMS} style={{ marginTop: "1.25rem" }} />

      {state.fetchedAt && (
        <p className="muted" style={{ fontSize: "0.75rem", textAlign: "right", marginTop: "1rem" }}>
          Last fetched: {new Date(state.fetchedAt).toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
