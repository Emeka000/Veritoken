/**
 * OperatorDashboard — real-time monitoring panel for Veritoken operators.
 *
 * Surfaces key contract signals in one place:
 *   - Global pause / unpaused state
 *   - Per-contract recent events (transfers, mints, KYC approvals, admin actions)
 *   - KYC approval and revocation counts
 *   - Blocklist size
 *   - Carbon retirement totals
 *   - Automatic refresh every 30 s with manual override
 *
 * Intended for daily operational checks and incident triage.
 * See docs/incident-response.md for how to use this view during incidents.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { fetchContractEvents, CONTRACT_IDS } from "../lib/stellar";
import { contracts } from "../lib/contracts/index";
import { Card, Icon, Skeleton } from "../components/ui";
import { EventFeed } from "../components/EventFeed";
import { startComplianceAlertMonitor } from "../lib/alertMonitor";
import type { ContractEvent } from "../types";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ContractHealthSignal {
  /** Human-readable contract label. */
  label: string;
  /** Whether the contract ID is configured in the current environment. */
  configured: boolean;
  /** Whether the contract is currently paused (null = unknown / not applicable). */
  paused: boolean | null;
  /** Latest 10 events from this contract. */
  events: ContractEvent[];
  /** Error message if the last fetch failed. */
  error: string | null;
  /** True while data is being fetched. */
  loading: boolean;
}

interface KycSummary {
  blocklistCount: number | null;
  loading: boolean;
  error: string | null;
}

interface CarbonSummary {
  totalRetired: bigint | null;
  retirementCount: number | null;
  loading: boolean;
  error: string | null;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PauseBadge({ paused }: { paused: boolean | null }) {
  if (paused === null) {
    return (
      <span
        style={{
          display: "inline-block",
          padding: "0.2rem 0.65rem",
          borderRadius: 99,
          fontSize: "0.75rem",
          fontWeight: 700,
          background: "var(--surface-2)",
          color: "var(--muted)",
          border: "1px solid var(--border)",
        }}
      >
        —
      </span>
    );
  }

  return (
    <span
      role="status"
      aria-label={paused ? "Paused" : "Active"}
      style={{
        display: "inline-block",
        padding: "0.2rem 0.65rem",
        borderRadius: 99,
        fontSize: "0.75rem",
        fontWeight: 700,
        background: paused ? "rgba(239,68,68,0.12)" : "rgba(52,211,153,0.12)",
        color: paused ? "#ef4444" : "var(--success, #34d399)",
        border: `1px solid ${paused ? "rgba(239,68,68,0.3)" : "rgba(52,211,153,0.3)"}`,
      }}
    >
      {paused ? "⏸ Paused" : "▶ Active"}
    </span>
  );
}

function MetricCell({
  label,
  value,
  loading,
  warn,
}: {
  label: string;
  value: string | number | null;
  loading: boolean;
  warn?: boolean;
}) {
  return (
    <div
      style={{
        padding: "0.75rem 1rem",
        borderRadius: 10,
        background: "var(--surface-2)",
        border: `1px solid ${warn ? "rgba(239,68,68,0.4)" : "var(--border)"}`,
      }}
    >
      <div
        className="muted"
        style={{
          fontSize: "0.72rem",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: "0.35rem",
        }}
      >
        {label}
      </div>
      {loading ? (
        <Skeleton height="1.4rem" width="60%" />
      ) : (
        <div
          style={{
            fontSize: "1.3rem",
            fontWeight: 700,
            color: warn ? "#ef4444" : undefined,
          }}
        >
          {value ?? "—"}
        </div>
      )}
    </div>
  );
}

function ContractStatusRow({
  signal,
  onRefresh,
}: {
  signal: ContractHealthSignal;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        borderBottom: "1px solid var(--border)",
        paddingBottom: "1rem",
        marginBottom: "1rem",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          flexWrap: "wrap",
        }}
      >
        {/* Configured dot */}
        <span
          aria-label={signal.configured ? "Configured" : "Not configured"}
          title={signal.configured ? "Contract ID configured" : "Contract ID not set in .env"}
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            flexShrink: 0,
            background: signal.configured ? "var(--success, #34d399)" : "var(--muted, #666)",
          }}
        />
        <span style={{ fontWeight: 600, fontSize: "0.9rem", minWidth: 160 }}>
          {signal.label}
        </span>
        <PauseBadge paused={signal.paused} />
        {signal.error && (
          <span
            role="alert"
            style={{ fontSize: "0.78rem", color: "#f59e0b", flex: 1 }}
          >
            ⚠ {signal.error}
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
          <button
            className="btn-ghost"
            style={{ fontSize: "0.75rem", padding: "0.2rem 0.6rem" }}
            onClick={() => setExpanded((x) => !x)}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Hide" : "Show"} events for ${signal.label}`}
          >
            {expanded ? "Hide events" : `Events (${signal.events.length})`}
          </button>
          <button
            className="btn-ghost"
            style={{ fontSize: "0.75rem", padding: "0.2rem 0.6rem" }}
            onClick={onRefresh}
            disabled={signal.loading}
            aria-label={`Refresh ${signal.label}`}
          >
            ↻
          </button>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: "0.75rem" }}>
          <EventFeed
            events={signal.events}
            loading={signal.loading}
            title={`${signal.label} — Recent Events`}
            compact
          />
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const AUTO_REFRESH_MS = 30_000;

export default function OperatorDashboard() {
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  // Automated alerting for compliance rule violations and suspicious activity (#444)
  useEffect(() => startComplianceAlertMonitor(), []);

  // Per-contract health signals
  const [signals, setSignals] = useState<ContractHealthSignal[]>([
    {
      label: "Compliance Engine",
      configured: Boolean(CONTRACT_IDS.complianceEngine),
      paused: null,
      events: [],
      error: null,
      loading: false,
    },
    {
      label: "KYC Registry",
      configured: Boolean(CONTRACT_IDS.kycRegistry),
      paused: null,
      events: [],
      error: null,
      loading: false,
    },
    {
      label: "Invoice Token",
      configured: Boolean(CONTRACT_IDS.invoiceToken),
      paused: null,
      events: [],
      error: null,
      loading: false,
    },
    {
      label: "Property Token",
      configured: Boolean(CONTRACT_IDS.propertyToken),
      paused: null,
      events: [],
      error: null,
      loading: false,
    },
    {
      label: "Carbon Credit Token",
      configured: Boolean(CONTRACT_IDS.carbonToken),
      paused: null,
      events: [],
      error: null,
      loading: false,
    },
  ]);

  const [kycSummary, setKycSummary] = useState<KycSummary>({
    blocklistCount: null,
    loading: false,
    error: null,
  });

  const [carbonSummary, setCarbonSummary] = useState<CarbonSummary>({
    totalRetired: null,
    retirementCount: null,
    loading: false,
    error: null,
  });

  // Update one signal by label
  const patchSignal = useCallback(
    (label: string, patch: Partial<ContractHealthSignal>) => {
      setSignals((prev) =>
        prev.map((s) => (s.label === label ? { ...s, ...patch } : s)),
      );
    },
    [],
  );

  // ── Fetch compliance engine state ────────────────────────────────────────
  const fetchComplianceState = useCallback(async () => {
    if (!CONTRACT_IDS.complianceEngine) return;
    patchSignal("Compliance Engine", { loading: true, error: null });
    try {
      const [events, rules] = await Promise.all([
        fetchContractEvents(CONTRACT_IDS.complianceEngine, 10).catch(() => [] as ContractEvent[]),
        contracts.compliance.getRules().catch(() => null),
      ]);
      patchSignal("Compliance Engine", {
        events,
        paused: rules ? rules.paused : null,
        loading: false,
      });
    } catch (err) {
      patchSignal("Compliance Engine", {
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch",
      });
    }
  }, [patchSignal]);

  // ── Fetch KYC registry events ────────────────────────────────────────────
  const fetchKycState = useCallback(async () => {
    if (!CONTRACT_IDS.kycRegistry) return;
    patchSignal("KYC Registry", { loading: true, error: null });
    try {
      const events = await fetchContractEvents(CONTRACT_IDS.kycRegistry, 10).catch(
        () => [] as ContractEvent[],
      );
      patchSignal("KYC Registry", { events, loading: false });
    } catch (err) {
      patchSignal("KYC Registry", {
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch",
      });
    }
  }, [patchSignal]);

  // ── Fetch invoice token state ────────────────────────────────────────────
  const fetchInvoiceState = useCallback(async () => {
    if (!CONTRACT_IDS.invoiceToken) return;
    patchSignal("Invoice Token", { loading: true, error: null });
    try {
      const [events, paused] = await Promise.all([
        fetchContractEvents(CONTRACT_IDS.invoiceToken, 10).catch(() => [] as ContractEvent[]),
        contracts.invoice.lifecyclePaused().catch(() => null as boolean | null),
      ]);
      patchSignal("Invoice Token", { events, paused, loading: false });
    } catch (err) {
      patchSignal("Invoice Token", {
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch",
      });
    }
  }, [patchSignal]);

  // ── Fetch property token events ──────────────────────────────────────────
  const fetchPropertyState = useCallback(async () => {
    if (!CONTRACT_IDS.propertyToken) return;
    patchSignal("Property Token", { loading: true, error: null });
    try {
      const events = await fetchContractEvents(CONTRACT_IDS.propertyToken, 10).catch(
        () => [] as ContractEvent[],
      );
      patchSignal("Property Token", { events, loading: false });
    } catch (err) {
      patchSignal("Property Token", {
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch",
      });
    }
  }, [patchSignal]);

  // ── Fetch carbon token state ─────────────────────────────────────────────
  const fetchCarbonState = useCallback(async () => {
    if (!CONTRACT_IDS.carbonToken) return;
    patchSignal("Carbon Credit Token", { loading: true, error: null });
    setCarbonSummary((s) => ({ ...s, loading: true, error: null }));
    try {
      const [events, count] = await Promise.all([
        fetchContractEvents(CONTRACT_IDS.carbonToken, 10).catch(() => [] as ContractEvent[]),
        contracts.carbon.retirementCount().catch(() => null as number | null),
      ]);
      patchSignal("Carbon Credit Token", { events, loading: false });
      setCarbonSummary({
        totalRetired: null, // total_retired requires a wallet; skip for operator view
        retirementCount: count,
        loading: false,
        error: null,
      });
    } catch (err) {
      patchSignal("Carbon Credit Token", {
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch",
      });
      setCarbonSummary((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch",
      }));
    }
  }, [patchSignal]);

  // ── Fetch compliance blocklist count ─────────────────────────────────────
  const fetchBlocklistCount = useCallback(async () => {
    if (!CONTRACT_IDS.complianceEngine) return;
    setKycSummary((s) => ({ ...s, loading: true, error: null }));
    try {
      const count = await contracts.compliance.blocklistCount();
      setKycSummary({ blocklistCount: count, loading: false, error: null });
    } catch (err) {
      setKycSummary((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch blocklist count",
      }));
    }
  }, []);

  // ── Master refresh ───────────────────────────────────────────────────────
  const refreshAll = useCallback(() => {
    fetchComplianceState();
    fetchKycState();
    fetchInvoiceState();
    fetchPropertyState();
    fetchCarbonState();
    fetchBlocklistCount();
    setLastRefresh(new Date());
  }, [
    fetchComplianceState,
    fetchKycState,
    fetchInvoiceState,
    fetchPropertyState,
    fetchCarbonState,
    fetchBlocklistCount,
  ]);

  // Initial load + auto-refresh
  useEffect(() => {
    refreshAll();
    timerRef.current = setInterval(refreshAll, AUTO_REFRESH_MS);
    return () => clearInterval(timerRef.current);
  }, [refreshAll]);

  // ── Derived state ────────────────────────────────────────────────────────
  const globalPaused =
    signals.find((s) => s.label === "Compliance Engine")?.paused ?? null;
  const invoicePaused =
    signals.find((s) => s.label === "Invoice Token")?.paused ?? null;

  const anyPaused =
    (globalPaused === true) || (invoicePaused === true);

  const configuredCount = signals.filter((s) => s.configured).length;

  return (
    <div className="form-narrow">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header style={{ marginBottom: "1.75rem" }}>
        <span className="eyebrow" style={{ marginBottom: "0.7rem" }}>
          Governance
        </span>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.9rem",
            flexWrap: "wrap",
            marginTop: "0.6rem",
          }}
        >
          <div
            style={{ display: "flex", alignItems: "center", gap: "0.9rem" }}
          >
            <div
              style={{
                display: "grid",
                placeItems: "center",
                width: 46,
                height: 46,
                borderRadius: 13,
                background: "var(--accent-soft)",
                border: "1px solid var(--border)",
                color: "var(--accent-2)",
                flexShrink: 0,
              }}
            >
              <Icon.shield size={22} />
            </div>
            <h1 style={{ fontSize: "1.85rem", fontWeight: 800 }}>
              Operator Dashboard
            </h1>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
            }}
          >
            {lastRefresh && (
              <span className="muted" style={{ fontSize: "0.78rem" }}>
                Last refresh: {lastRefresh.toLocaleTimeString()}
              </span>
            )}
            <button
              className="btn-ghost"
              style={{ fontSize: "0.82rem" }}
              onClick={refreshAll}
              aria-label="Refresh all contract data"
            >
              ↻ Refresh all
            </button>
          </div>
        </div>
        <p
          className="muted"
          style={{ marginTop: "0.7rem", maxWidth: 620, fontSize: "0.95rem" }}
        >
          Monitor deployed contract health, recent activity, and critical
          state changes. Data refreshes automatically every{" "}
          {AUTO_REFRESH_MS / 1000} seconds.
        </p>
      </header>

      {/* ── Alert banner when anything is paused ───────────────────────── */}
      {anyPaused && (
        <div
          role="alert"
          style={{
            marginBottom: "1.25rem",
            padding: "0.85rem 1rem",
            borderRadius: 10,
            background: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.35)",
            color: "#ef4444",
            fontSize: "0.875rem",
            display: "flex",
            alignItems: "center",
            gap: "0.6rem",
          }}
        >
          <Icon.bolt size={16} style={{ flexShrink: 0 }} />
          <strong>
            {globalPaused
              ? "All token transfers are currently paused by the Compliance Engine."
              : "Invoice lifecycle (settlement & redemption) is currently paused."}
          </strong>
          {" "}Navigate to the Admin panel to unpause.
        </div>
      )}

      {/* ── Key metrics ────────────────────────────────────────────────── */}
      <Card title="Key Metrics" style={{ marginBottom: "1.25rem" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
            gap: "0.75rem",
          }}
        >
          <MetricCell
            label="Contracts configured"
            value={`${configuredCount} / ${signals.length}`}
            loading={false}
          />
          <MetricCell
            label="Global transfer state"
            value={
              globalPaused === null ? "—" : globalPaused ? "Paused ⏸" : "Active ▶"
            }
            loading={signals.find((s) => s.label === "Compliance Engine")?.loading ?? false}
            warn={globalPaused === true}
          />
          <MetricCell
            label="Invoice lifecycle"
            value={
              invoicePaused === null ? "—" : invoicePaused ? "Paused ⏸" : "Active ▶"
            }
            loading={signals.find((s) => s.label === "Invoice Token")?.loading ?? false}
            warn={invoicePaused === true}
          />
          <MetricCell
            label="Blocked addresses"
            value={kycSummary.blocklistCount}
            loading={kycSummary.loading}
            warn={(kycSummary.blocklistCount ?? 0) > 0}
          />
          <MetricCell
            label="Carbon retirements"
            value={carbonSummary.retirementCount}
            loading={carbonSummary.loading}
          />
        </div>
      </Card>

      {/* ── Per-contract status ─────────────────────────────────────────── */}
      <Card title="Contract Status" style={{ marginBottom: "1.25rem" }}>
        <p
          className="muted"
          style={{ fontSize: "0.8rem", marginBottom: "1.25rem" }}
        >
          A green dot means the contract ID is configured in this
          environment. Expand any row to inspect recent on-chain events.
        </p>
        {signals.map((sig) => (
          <ContractStatusRow
            key={sig.label}
            signal={sig}
            onRefresh={() => {
              if (sig.label === "Compliance Engine") fetchComplianceState();
              else if (sig.label === "KYC Registry") fetchKycState();
              else if (sig.label === "Invoice Token") fetchInvoiceState();
              else if (sig.label === "Property Token") fetchPropertyState();
              else if (sig.label === "Carbon Credit Token") fetchCarbonState();
            }}
          />
        ))}
      </Card>

      {/* ── Operational guidance ────────────────────────────────────────── */}
      <Card title="Operational Guidance">
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
            fontSize: "0.875rem",
          }}
        >
          <p>
            <strong>Routine checks:</strong> Confirm all contracts show{" "}
            <em>Active</em> and no addresses appear on the blocklist without a
            corresponding incident ticket.
          </p>
          <p>
            <strong>Incident response:</strong> If transfers are paused
            unexpectedly, navigate to <strong>Admin → Emergency Controls</strong>{" "}
            and follow the runbook in{" "}
            <code>docs/incident-response.md</code>.
          </p>
          <p>
            <strong>KYC expiry:</strong> Expired KYC records cause transfer
            failures for affected holders. Use the <strong>KYC</strong> page to
            re-approve or extend expiry.
          </p>
          <p>
            <strong>Carbon retirements:</strong> Each retirement is permanent.
            Verify the retirement count trend is consistent with expected
            activity before each reporting cycle.
          </p>
        </div>
      </Card>
    </div>
  );
}
