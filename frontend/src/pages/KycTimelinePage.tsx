import { useState } from "react";
import { useAddressValidation } from "../lib/useAddressValidation";
import { PageHeader, Card, Field, Icon } from "../components/ui";
import { useToast } from "../lib/toast";

// ── Types ─────────────────────────────────────────────────────────────────────

type TransitionKind = "Approve" | "Reject" | "Revoke" | "TierUpdate";

interface KycTransition {
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
  if (!ts) return "No expiry";
  return new Date(ts * 1000).toLocaleString();
}

// Mock data — replace with contract.kyc.getLifecycleHistory(address) when wired
function mockHistory(address: string): KycTransition[] {
  if (!address) return [];
  const base = address.charCodeAt(5) % 3;
  const now = Math.floor(Date.now() / 1000);
  const entries: KycTransition[] = [
    { seq: 0, kind: "Approve",    verifier: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN", timestamp: now - 86400 * 60, tier: 0, expiry: now + 86400 * 305, jurisdiction: "US" },
    { seq: 1, kind: "TierUpdate", verifier: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN", timestamp: now - 86400 * 30, tier: 1, expiry: now + 86400 * 335, jurisdiction: "US" },
  ];
  if (base === 0) entries.push({ seq: 2, kind: "Revoke", verifier: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN", timestamp: now - 86400 * 5, tier: 1, expiry: 0, jurisdiction: "US" });
  if (base === 1) entries.push({ seq: 2, kind: "Approve", verifier: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN", timestamp: now - 86400 * 2, tier: 2, expiry: now + 86400 * 363, jurisdiction: "EU" });
  return entries;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function KycTimelinePage() {
  const { addToast } = useToast();
  const [address, setAddress] = useState("");
  const [history, setHistory] = useState<KycTransition[] | null>(null);
  const [loading, setLoading] = useState(false);

  const validation = useAddressValidation(address);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validation.isValid) {
      addToast("Please enter a valid Stellar address", "error");
      return;
    }
    setLoading(true);
    try {
      // TODO: replace with contracts.kyc.getLifecycleHistory(address, 0, 50)
      await new Promise((r) => setTimeout(r, 400));
      setHistory(mockHistory(address));
    } catch {
      addToast("Failed to fetch KYC history", "error");
    } finally {
      setLoading(false);
    }
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
              onChange={(e) => { setAddress(e.target.value); setHistory(null); }}
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
                <Stat label="Expiry" value={formatTs(latest.expiry)} />
                <Stat label="Total transitions" value={String(history.length)} />
              </div>
            ) : null}
          </Card>

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
                            Expiry snapshot: {formatTs(entry.expiry)}
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
