import { useState } from "react";
import { Keypair } from "@stellar/stellar-sdk";
import { useWallet } from "../lib/wallet";
import { useAddressValidation } from "../lib/useAddressValidation";
import { PageHeader, Card, Field, Select, Icon } from "../components/ui";
import WalletGuard from "../components/WalletGuard";
import ConfirmDialog from "../components/ConfirmDialog";
import { useToast } from "../lib/toast";
import {
  useSubmitWithFeeBump,
  feeBumpStatusLabel,
  isFeeBumpInFlight,
} from "../lib/useSubmitWithFeeBump";
import { DEFAULT_FEE_BUMP_CONFIG } from "../lib/feeBump";

// ── Types ─────────────────────────────────────────────────────────────────────

type OpType = "transfer" | "kyc_approve" | "kyc_revoke" | "blocklist_add" | "blocklist_remove";

interface BatchOp {
  id: string;
  type: OpType;
  target: string;
  amount?: string;
  tier?: string;
  jurisdiction?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const OP_LABELS: Record<OpType, string> = {
  transfer:         "Token Transfer",
  kyc_approve:      "KYC Approve",
  kyc_revoke:       "KYC Revoke",
  blocklist_add:    "Add to Blocklist",
  blocklist_remove: "Remove from Blocklist",
};

let opCounter = 1;
function newId() { return `op-${opCounter++}`; }

const MAX_BATCH = 10;

// ── Component ─────────────────────────────────────────────────────────────────

export default function BatchPage() {
  const { address, signTx } = useWallet();
  const { addToast } = useToast();

  const [ops, setOps] = useState<BatchOp[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    type: "transfer" as OpType,
    target: "",
    amount: "",
    tier: "0",
    jurisdiction: "",
  });

  const [confirm, setConfirm] = useState<{
    title: string; description: string; onConfirm: () => void;
  } | null>(null);

  // ── Fee-bump hook ──────────────────────────────────────────────────────────
  // feeBumpSource is a per-session ephemeral keypair that pays the bump fee.
  // In a real deployment this would come from a funded operator account stored
  // in the wallet or environment config.  For now we derive it from the
  // connected wallet address so each address gets a deterministic key in dev.
  const [feeBumpKeypair] = useState(() => Keypair.random());

  const feeBumpConfig = {
    ...DEFAULT_FEE_BUMP_CONFIG,
    feeBumpSource: feeBumpKeypair,
  };

  const {
    submit: feeBumpSubmit,
    status: feeBumpStatus,
    retries: feeBumpRetries,
    error: feeBumpError,
    reset: feeBumpReset,
  } = useSubmitWithFeeBump(feeBumpConfig);

  const isFeeBumpActive = isFeeBumpInFlight(feeBumpStatus);

  // ── Form helpers ───────────────────────────────────────────────────────────

  const targetValidation = useAddressValidation(form.target);

  const set =
    (k: string) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleAddOp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetValidation.isValid) {
      addToast("Please enter a valid Stellar address", "error");
      return;
    }
    if (ops.length >= MAX_BATCH) {
      addToast(`Maximum batch size is ${MAX_BATCH} operations`, "error");
      return;
    }
    const op: BatchOp = {
      id: newId(),
      type: form.type,
      target: form.target,
      amount: form.type === "transfer" ? form.amount : undefined,
      tier: form.type === "kyc_approve" ? form.tier : undefined,
      jurisdiction: form.type === "kyc_approve" ? form.jurisdiction : undefined,
    };
    setOps((prev) => [...prev, op]);
    setForm((f) => ({ ...f, target: "", amount: "", jurisdiction: "" }));
    addToast(`Operation added (${ops.length + 1}/${MAX_BATCH})`, "info");
  };

  const handleRemove = (id: string) => setOps((prev) => prev.filter((o) => o.id !== id));

  const handleExecute = () => {
    if (ops.length === 0) return;
    setConfirm({
      title: "Execute Batch",
      description: `You are about to execute ${ops.length} operation${ops.length > 1 ? "s" : ""} in sequence. Each will require a separate wallet signature.`,
      onConfirm: async () => {
        setConfirm(null);
        setSubmitting(true);
        feeBumpReset();
        try {
          // Iterate over each operation and submit via the fee-bump pipeline.
          // Each op builds its XDR, then delegates signing + submission to
          // feeBumpSubmit, which wraps every send in a fee-bump envelope and
          // retries with exponential back-off on transient failures.
          for (const op of ops) {
            // TODO: replace the placeholder XDR with real contract call XDR
            // produced by the appropriate contract client for each op.type.
            const placeholderXdr = `placeholder-xdr:${op.type}:${op.target}`;

            await feeBumpSubmit(placeholderXdr, async (xdr) => {
              if (!signTx) throw new Error("Wallet not connected");
              return signTx(xdr);
            });
          }

          addToast(`${ops.length} operations executed successfully.`, "success");
          setOps([]);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Batch execution failed";
          addToast(msg, "error");
        } finally {
          setSubmitting(false);
        }
      },
    });
  };

  const needsAmount = form.type === "transfer";
  const needsKyc    = form.type === "kyc_approve";

  // ── Derived UI state ───────────────────────────────────────────────────────

  const isBusy = submitting || isFeeBumpActive;

  /** Label shown on the execute button during submission. */
  const executeLabel = (() => {
    if (!isBusy) return `Execute ${ops.length} Operation${ops.length > 1 ? "s" : ""}`;
    if (feeBumpStatus.kind === "retrying") {
      return `Retrying (${feeBumpRetries})…`;
    }
    return feeBumpStatusLabel(feeBumpStatus);
  })();

  return (
    <div className="form-narrow">
      <PageHeader
        eyebrow="Operations"
        icon={<Icon.bolt size={22} />}
        title="Batch Operations"
        description="Group multiple contract operations into a single workflow. Each operation in the batch is submitted sequentially through the fee-bump pipeline, which retries with a higher fee on network congestion."
      />

      {/* Add operation form */}
      <WalletGuard>
        <Card title="Add Operation" subtitle={`${ops.length} / ${MAX_BATCH} added`}>
          <form onSubmit={handleAddOp}>
            <Select
              label="Operation type"
              value={form.type}
              onChange={set("type") as (e: React.ChangeEvent<HTMLSelectElement>) => void}
              options={Object.entries(OP_LABELS).map(([value, label]) => ({ value, label }))}
              required
            />
            <Field
              label="Target address"
              value={form.target}
              onChange={set("target")}
              placeholder="G… (Stellar address)"
              required
              error={targetValidation.error && form.target.length > 0 ? targetValidation.error : null}
            />
            {needsAmount && (
              <Field
                label="Amount (stroops)"
                type="number"
                value={form.amount}
                onChange={set("amount")}
                placeholder="1000000"
                required
              />
            )}
            {needsKyc && (
              <>
                <Select
                  label="KYC Tier"
                  value={form.tier}
                  onChange={set("tier") as (e: React.ChangeEvent<HTMLSelectElement>) => void}
                  options={[
                    { value: "0", label: "0 — Basic" },
                    { value: "1", label: "1 — Accredited Investor" },
                    { value: "2", label: "2 — Institutional" },
                  ]}
                />
                <Field
                  label="Jurisdiction"
                  value={form.jurisdiction}
                  onChange={set("jurisdiction")}
                  placeholder="US, EU, NG…"
                  required
                />
              </>
            )}
            <button
              type="submit"
              className="btn-block"
              style={{ marginTop: "0.5rem" }}
              disabled={ops.length >= MAX_BATCH || (form.target.length > 0 && !targetValidation.isValid)}
            >
              + Add to Batch
            </button>
          </form>
        </Card>
      </WalletGuard>

      {/* Batch queue */}
      {ops.length > 0 && (
        <Card title="Batch Queue" style={{ marginTop: "1.25rem" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", marginBottom: "1.25rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                <th style={th}>#</th>
                <th style={th}>Type</th>
                <th style={th}>Target</th>
                <th style={th}>Details</th>
                <th style={{ ...th, width: 60, textAlign: "right" }}>Remove</th>
              </tr>
            </thead>
            <tbody>
              {ops.map((op, i) => (
                <tr key={op.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ ...td, color: "var(--text-muted)" }}>{i + 1}</td>
                  <td style={td}>
                    <span className="badge" style={{ fontSize: "0.72rem" }}>{OP_LABELS[op.type]}</span>
                  </td>
                  <td style={{ ...td, fontFamily: "monospace" }}>{op.target.slice(0, 6)}…{op.target.slice(-4)}</td>
                  <td style={{ ...td, color: "var(--text-muted)" }}>
                    {op.amount && `${op.amount} stroops`}
                    {op.tier !== undefined && `Tier ${op.tier}${op.jurisdiction ? ` · ${op.jurisdiction}` : ""}`}
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <button
                      onClick={() => handleRemove(op.id)}
                      className="btn-ghost"
                      style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem", color: "#ef4444" }}
                      aria-label={`Remove operation ${i + 1}`}
                      disabled={isBusy}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Fee-bump status banner — visible while a submission is in-flight */}
          {isBusy && (
            <div
              role="status"
              aria-live="polite"
              aria-label="Transaction submission status"
              style={{
                background: "var(--surface-alt, #1e293b)",
                border: "1px solid var(--border)",
                borderRadius: "0.5rem",
                padding: "0.6rem 0.9rem",
                marginBottom: "0.75rem",
                fontSize: "0.82rem",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  display: "inline-block",
                  width: "0.55rem",
                  height: "0.55rem",
                  borderRadius: "50%",
                  background:
                    feeBumpStatus.kind === "retrying" ? "#f59e0b" : "#3b82f6",
                  animation: "pulse 1.4s infinite",
                }}
              />
              <span>
                {feeBumpStatus.kind === "retrying"
                  ? `retrying(${feeBumpStatus.attempt}) — fee escalated`
                  : feeBumpStatusLabel(feeBumpStatus)}
              </span>
              {feeBumpRetries > 0 && feeBumpStatus.kind !== "retrying" && (
                <span style={{ color: "var(--text-muted)" }}>
                  ({feeBumpRetries} {feeBumpRetries === 1 ? "retry" : "retries"})
                </span>
              )}
            </div>
          )}

          {/* Error banner — visible after a failed submission */}
          {feeBumpStatus.kind === "failed" && feeBumpError && (
            <div
              role="alert"
              style={{
                background: "#450a0a",
                border: "1px solid #ef4444",
                borderRadius: "0.5rem",
                padding: "0.6rem 0.9rem",
                marginBottom: "0.75rem",
                fontSize: "0.82rem",
                color: "#fca5a5",
              }}
            >
              {feeBumpError.message}
            </div>
          )}

          <WalletGuard>
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button
                onClick={handleExecute}
                disabled={isBusy || !address}
                className="btn-success"
                style={{ flex: 1 }}
                aria-busy={isBusy}
              >
                {executeLabel}
              </button>
              <button
                onClick={() => { setOps([]); feeBumpReset(); }}
                className="btn-ghost btn-danger"
                style={{ padding: "0.55rem 1rem" }}
                disabled={isBusy}
              >
                Clear
              </button>
            </div>
          </WalletGuard>
        </Card>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          description={confirm.description}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

const th: React.CSSProperties = { padding: "0.4rem 0.5rem", fontWeight: 600, color: "var(--muted)" };
const td: React.CSSProperties = { padding: "0.4rem 0.5rem" };
