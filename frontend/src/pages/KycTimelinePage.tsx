import { useState } from "react";
import { useAddressValidation } from "../lib/useAddressValidation";
import { PageHeader, Card, Field, Icon } from "../components/ui";
import { useToast } from "../lib/toast";
import { formatKycExpiry } from "../lib/dateFormat";

// ── Types ─────────────────────────────────────────────────────────────────────

export type TransitionKind = "Approve" | "Reject" | "Revoke" | "TierUpdate";

export interface KycTransition {
  seq: number;
  kind: TransitionKind;
  verifier: string;
  timestamp: number;
  tier: number;
  expiry: number;
  jurisdiction: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TIER_LABELS: Record<number, string> = { 0: "Basic", 1: "Accredited", 2: "Institutional" };
const tierLabel = (t: number) => TIER_LABELS[t] ?? `Tier ${t}`;

const KIND_META: Record<TransitionKind, { label: string; color: string; dot: string }> = {
  Approve:    { label: "Approved",    color: "#22c55e", dot: "#22c55e" },
  Reject:     { label: "Rejected",    color: "#ef4444", dot: "#ef4444" },
  Revoke:     { label: "Revoked",     color: "#f97316", dot: "#f97316" },
  TierUpdate: { label: "Tier Update", color: "#6366f1", dot: "#6366f1" },
};

function formatTs(ts: number): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString();
}

/** Thrown when no lifecycle-history client is available to the page. */
export class KycHistoryUnavailableError extends Error {
  constructor() {
    super("KYC lifecycle history is not available from the connected client yet.");
    this.name = "KycHistoryUnavailableError";
  }
}

export type KycHistoryFetcher = (address: string) => Promise<KycTransition[]>;

// The KYC registry contract exposes `get_lifecycle_history`, but the SDK has no
// client method for it yet. Until one exists, report the gap explicitly instead
// of rendering placeholder data as if it were on-chain history.
const unavailableHistoryFetcher: KycHistoryFetcher = async () => {
  throw new KycHistoryUnavailableError();
};

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string; unavailable: boolean }
  | { status: "loaded"; history: KycTransition[] };

// ── Component ─────────────────────────────────────────────────────────────────

export interface KycTimelinePageProps {
  fetchHistory?: KycHistoryFetcher;
}

export default function KycTimelinePage({ fetchHistory = unavailableHistoryFetcher }: KycTimelinePageProps = {}) {
  const { addToast } = useToast();
  const [address, setAddress] = useState("");
  const [state, setState] = useState<FetchState>({ status: "idle" });

  const validation = useAddressValidation(address);
  const loading = state.status === "loading";
  const history = state.status === "loaded" ? state.history : null;

  const loadHistory = async () => {
    setState({ status: "loading" });
    try {
      const entries = await fetchHistory(address);
      setState({ status: "loaded", history: entries });
    } catch (err) {
      const unavailable = err instanceof KycHistoryUnavailableError;
      const message = unavailable
        ? (err as Error).message
        : "Failed to fetch KYC history. Check your connection and try again.";
      setState({ status: "error", message, unavailable });
      if (!unavailable) addToast("Failed to fetch KYC history", "error");
    }
  };

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validation.isValid) {
      addToast("Please enter a valid Stellar address", "error");
      return;
    }
    await loadHistory();
  };

  const latest = history?.[history.length - 1];

  return (
    <div className="form-narrow">
      <PageHeader
        eyebrow="Compliance"
        icon={<Icon.kyc size={22} />}
        title="KYC Status Timeline"
        description="Inspect the full lifecycle of KYC transitions for any investor address — approvals, tier upgrades, revocations, and expiries in chronological order."
      />

      <Card title="Look Up Address">
        <form onSubmit={handleLookup} style={{ display: "flex", gap: "0.75rem" }}>
          <div style={{ flex: 1 }}>
            <Field
              label="Investor address"
              value={address}
              onChange={(e) => { setAddress(e.target.value); setState({ status: "idle" }); }}
              placeholder="G… (Stellar address)"
              required
              error={validation.error && address.length > 0 ? validation.error : null}
            />
          </div>
          <button
            type="submit"
            disabled={loading || (address.length > 0 && !validation.isValid)}
            style={{ alignSelf: "flex-end", marginBottom: "1rem" }}
          >
            {loading ? "Loading…" : "View Timeline"}
          </button>
        </form>
      </Card>

      {state.status === "loading" && (
        <Card title="Transition History" style={{ marginTop: "1.25rem" }}>
          <p role="status" aria-live="polite" className="muted" style={{ fontSize: "0.875rem", margin: 0 }}>
            Loading KYC history…
          </p>
        </Card>
      )}

      {state.status === "error" && (
        <Card title="Transition History" style={{ marginTop: "1.25rem" }}>
          <div role="alert" style={{ padding: "0.85rem 1rem", borderRadius: 10, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)", color: "#f87171", fontSize: "0.845rem" }}>
            {state.message}
          </div>
          <button type="button" onClick={loadHistory} style={{ marginTop: "0.75rem" }}>
            Retry
          </button>
        </Card>
      )}

      {history !== null && (
        <>
          {/* Current status summary */}
          <Card title="Current Status" style={{ marginTop: "1.25rem" }}>
            {history.length === 0 ? (
              <p className="muted" style={{ fontSize: "0.875rem" }}>No KYC record found for this address.</p>
            ) : latest ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "1.25rem" }}>
                <StatusPill kind={latest.kind} />
                <Stat label="KYC Tier" value={tierLabel(latest.tier)} />
                <Stat label="Jurisdiction" value={latest.jurisdiction} />
                <Stat label="Expiry" value={formatKycExpiry(latest.expiry)} />
                <Stat label="Total transitions" value={String(history.length)} />
              </div>
            ) : null}
          </Card>

          {/* Empty timeline — the history source answered, with zero transitions.
              Kept distinct from the unavailable-source error above. */}
          {history.length === 0 && (
            <Card title="Transition History" style={{ marginTop: "1.25rem" }}>
              <div
                role="status"
                aria-label="No KYC transition history"
                style={{ padding: "0.85rem 1rem", borderRadius: 10, border: "1px dashed var(--border)", fontSize: "0.845rem" }}
              >
                <p style={{ fontWeight: 600, margin: 0 }}>No KYC transitions recorded yet</p>
                <p className="muted" style={{ margin: "0.3rem 0 0" }}>
                  The history source responded successfully, but this address has no
                  approvals, rejections, revocations, or tier updates on record. This is
                  expected for a subject that has not been reviewed yet.
                </p>
              </div>
            </Card>
          )}

          {/* Timeline */}
          {history.length > 0 && (
            <Card title="Transition History" style={{ marginTop: "1.25rem" }}>
              <ol
                aria-label="KYC transition timeline"
                style={{ listStyle: "none", margin: 0, padding: 0, position: "relative" }}
              >
                {/* Vertical connector line */}
                <div style={{
                  position: "absolute", left: 10, top: 16, bottom: 16,
                  width: 2, background: "var(--border)", borderRadius: 1,
                }} aria-hidden="true" />

                {[...history].reverse().map((entry) => {
                  const meta = KIND_META[entry.kind];
                  return (
                    <li
                      key={entry.seq}
                      style={{ display: "flex", gap: "1.25rem", position: "relative", marginBottom: "1.5rem" }}
                    >
                      {/* Timeline dot */}
                      <div style={{
                        width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                        background: meta.dot, border: "3px solid var(--surface)",
                        marginTop: 2, zIndex: 1,
                      }} aria-hidden="true" />

                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 700, color: meta.color, fontSize: "0.9rem" }}>
                            {meta.label}
                          </span>
                          <span className="badge" style={{ fontSize: "0.7rem" }}>
                            {tierLabel(entry.tier)}
                          </span>
                          <span className="badge badge-accent" style={{ fontSize: "0.7rem" }}>
                            {entry.jurisdiction}
                          </span>
                          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginLeft: "auto" }}>
                            #{entry.seq}
                          </span>
                        </div>

                        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0.3rem 0 0" }}>
                          {formatTs(entry.timestamp)}
                        </p>

                        <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: "0.15rem 0 0", fontFamily: "monospace" }}>
                          Verifier: {entry.verifier.slice(0, 8)}…{entry.verifier.slice(-6)}
                        </p>

                        {entry.expiry > 0 && (
                          <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: "0.15rem 0 0" }}>
                            Expiry snapshot: {formatKycExpiry(entry.expiry)}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusPill({ kind }: { kind: TransitionKind }) {
  const meta = KIND_META[kind];
  return (
    <div style={{
      padding: "0.35rem 0.85rem", borderRadius: 999, fontSize: "0.85rem", fontWeight: 600,
      background: `color-mix(in srgb, ${meta.color} 15%, transparent)`,
      border: `1px solid color-mix(in srgb, ${meta.color} 35%, transparent)`,
      color: meta.color,
    }}>
      {meta.label}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontWeight: 600, marginTop: "0.2rem" }}>{value}</div>
    </div>
  );
}
