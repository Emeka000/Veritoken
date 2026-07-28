import { useState } from "react";
import { useWallet } from "../lib/wallet";
import { useAddressValidation } from "../lib/useAddressValidation";
import { PageHeader, Card, Field, Select, Icon } from "../components/ui";
import WalletGuard from "../components/WalletGuard";
import ConfirmDialog from "../components/ConfirmDialog";
import { useToast } from "../lib/toast";

// ── Types ─────────────────────────────────────────────────────────────────────

type ExceptionStatus = "pending_review" | "approved" | "rejected" | "escalated";
type ExceptionCategory = "transfer_limit" | "jurisdiction" | "kyc_expiry" | "tier_mismatch" | "other";

interface ComplianceException {
  id: string;
  requester: string;
  subject: string;
  category: ExceptionCategory;
  status: ExceptionStatus;
  reason: string;
  reviewer?: string;
  reviewNote?: string;
  createdAt: number;
  updatedAt: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_META: Record<ExceptionStatus, { label: string; color: string }> = {
  pending_review: { label: "Pending Review", color: "#f59e0b" },
  approved:       { label: "Approved",        color: "#22c55e" },
  rejected:       { label: "Rejected",        color: "#ef4444" },
  escalated:      { label: "Escalated",       color: "#6366f1" },
};

const CATEGORY_LABELS: Record<ExceptionCategory, string> = {
  transfer_limit: "Transfer Limit Exceeded",
  jurisdiction:   "Jurisdiction Restriction",
  kyc_expiry:     "KYC Expiry",
  tier_mismatch:  "Tier Mismatch",
  other:          "Other",
};

function mockExceptions(): ComplianceException[] {
  const now = Math.floor(Date.now() / 1000);
  return [
    {
      id: "EXC-001", requester: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
      subject: "GBMW5KNQM7RFOVLYEZDJPBK7EFHK6FQJJVTUGPLDMPXCXQLXZS2PQGQ",
      category: "transfer_limit", status: "pending_review",
      reason: "One-time institutional settlement of 5M tokens exceeds daily limit. Pre-approved by legal team.",
      createdAt: now - 3600, updatedAt: now - 3600,
    },
    {
      id: "EXC-002", requester: "GBMW5KNQM7RFOVLYEZDJPBK7EFHK6FQJJVTUGPLDMPXCXQLXZS2PQGQ",
      subject: "GBMW5KNQM7RFOVLYEZDJPBK7EFHK6FQJJVTUGPLDMPXCXQLXZS2PQGQ",
      category: "kyc_expiry", status: "approved",
      reason: "KYC expired 2 days ago; renewal documents submitted and under review by verifier.",
      reviewer: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
      reviewNote: "Temporary grace period granted for 7 days pending re-verification.",
      createdAt: now - 86400, updatedAt: now - 43200,
    },
    {
      id: "EXC-003", requester: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
      subject: "GBMW5KNQM7RFOVLYEZDJPBK7EFHK6FQJJVTUGPLDMPXCXQLXZS2PQGQ",
      category: "jurisdiction", status: "escalated",
      reason: "Recipient jurisdiction (CN) blocked by default policy. Requires board-level approval.",
      createdAt: now - 172800, updatedAt: now - 7200,
    },
  ];
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ComplianceExceptionPage() {
  const { address } = useWallet();
  const { addToast } = useToast();

  const [exceptions] = useState<ComplianceException[]>(mockExceptions);
  const [activeTab, setActiveTab] = useState<"list" | "submit">("list");
  const [filterStatus, setFilterStatus] = useState<ExceptionStatus | "all">("all");

  const [form, setForm] = useState({
    subject: "",
    category: "transfer_limit" as ExceptionCategory,
    reason: "",
  });

  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    onConfirm: () => void;
  } | null>(null);

  const subjectValidation = useAddressValidation(form.subject);

  const set =
    (k: string) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const filtered = filterStatus === "all"
    ? exceptions
    : exceptions.filter((ex) => ex.status === filterStatus);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subjectValidation.isValid) {
      addToast("Please enter a valid subject address", "error");
      return;
    }
    if (form.reason.trim().length < 20) {
      addToast("Reason must be at least 20 characters", "error");
      return;
    }
    setConfirm({
      title: "Submit Compliance Exception",
      description: `Submit a ${CATEGORY_LABELS[form.category]} exception request for ${form.subject.slice(0, 8)}…? This will be queued for admin review.`,
      onConfirm: () => {
        addToast("Exception request submitted for review.", "success");
        setForm({ subject: "", category: "transfer_limit", reason: "" });
        setActiveTab("list");
        setConfirm(null);
      },
    });
  };

  const handleReview = (ex: ComplianceException, action: "approve" | "reject" | "escalate") => {
    const labels: Record<string, string> = { approve: "Approve", reject: "Reject", escalate: "Escalate" };
    setConfirm({
      title: `${labels[action]} Exception ${ex.id}`,
      description: `You are about to ${action} exception ${ex.id} (${CATEGORY_LABELS[ex.category]}) for ${ex.subject.slice(0, 8)}…`,
      onConfirm: () => {
        addToast(`Exception ${ex.id} ${action}d.`, action === "approve" ? "success" : "info");
        setConfirm(null);
      },
    });
  };

  return (
    <div className="form-narrow">
      <PageHeader
        eyebrow="Compliance"
        icon={<Icon.shield size={22} />}
        title="Exception Workflow"
        description="Request, review, and escalate compliance exceptions for transfers or onboarding actions that cannot proceed under default rules."
      />

      {/* Tabs */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem" }}>
        {(["list", "submit"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={activeTab === tab ? "btn-accent" : "btn-ghost"}
            style={{ fontSize: "0.875rem" }}
          >
            {tab === "list" ? `Exceptions (${exceptions.length})` : "Submit Request"}
          </button>
        ))}
      </div>

      {/* ── Exception list ── */}
      {activeTab === "list" && (
        <Card title="Exception Queue">
          {/* Filter */}
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
            {(["all", "pending_review", "approved", "rejected", "escalated"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={filterStatus === s ? "btn-accent" : "btn-ghost"}
                style={{ fontSize: "0.75rem", padding: "0.3rem 0.7rem" }}
              >
                {s === "all" ? "All" : STATUS_META[s].label}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <p className="muted" style={{ fontSize: "0.875rem" }}>No exceptions match this filter.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {filtered.map((ex) => {
                const meta = STATUS_META[ex.status];
                return (
                  <div
                    key={ex.id}
                    style={{
                      border: "1px solid var(--border)", borderRadius: 12, padding: "1rem",
                      background: "var(--surface-2)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700, fontFamily: "monospace", fontSize: "0.85rem" }}>{ex.id}</span>
                      <span style={{
                        padding: "0.2rem 0.65rem", borderRadius: 999, fontSize: "0.72rem", fontWeight: 600,
                        background: `color-mix(in srgb, ${meta.color} 15%, transparent)`,
                        border: `1px solid color-mix(in srgb, ${meta.color} 35%, transparent)`,
                        color: meta.color,
                      }}>
                        {meta.label}
                      </span>
                      <span className="badge" style={{ fontSize: "0.72rem" }}>{CATEGORY_LABELS[ex.category]}</span>
                      <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginLeft: "auto" }}>
                        {new Date(ex.createdAt * 1000).toLocaleDateString()}
                      </span>
                    </div>

                    <p style={{ fontSize: "0.82rem", margin: "0.6rem 0 0.4rem", lineHeight: 1.5 }}>{ex.reason}</p>

                    <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontFamily: "monospace", margin: 0 }}>
                      Subject: {ex.subject.slice(0, 8)}…{ex.subject.slice(-6)}
                    </p>

                    {ex.reviewNote && (
                      <p style={{
                        fontSize: "0.78rem", marginTop: "0.5rem", padding: "0.5rem 0.75rem",
                        background: "var(--surface)", borderRadius: 8, borderLeft: `3px solid ${meta.color}`,
                      }}>
                        Review note: {ex.reviewNote}
                      </p>
                    )}

                    {ex.status === "pending_review" && address && (
                      <WalletGuard>
                        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                          <button className="btn-success" style={{ fontSize: "0.8rem", padding: "0.35rem 0.85rem" }} onClick={() => handleReview(ex, "approve")}>Approve</button>
                          <button className="btn-danger"  style={{ fontSize: "0.8rem", padding: "0.35rem 0.85rem" }} onClick={() => handleReview(ex, "reject")}>Reject</button>
                          <button className="btn-ghost"   style={{ fontSize: "0.8rem", padding: "0.35rem 0.85rem" }} onClick={() => handleReview(ex, "escalate")}>Escalate</button>
                        </div>
                      </WalletGuard>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* ── Submit form ── */}
      {activeTab === "submit" && (
        <WalletGuard>
          <Card title="Submit Exception Request" subtitle="All requests are logged and require admin review before any rule is bypassed">
            <form onSubmit={handleSubmit}>
              <Field
                label="Subject Address"
                value={form.subject}
                onChange={set("subject")}
                placeholder="G… (investor or counterparty address)"
                required
                error={subjectValidation.error && form.subject.length > 0 ? subjectValidation.error : null}
              />
              <Select
                label="Exception Category"
                value={form.category}
                onChange={set("category") as (e: React.ChangeEvent<HTMLSelectElement>) => void}
                options={Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))}
                required
              />
              <div className="field">
                <label htmlFor="exception-reason">
                  Reason <span aria-hidden="true" style={{ color: "#ef4444" }}>*</span>
                </label>
                <textarea
                  id="exception-reason"
                  value={form.reason}
                  onChange={set("reason")}
                  placeholder="Describe why an exception is needed. Include any pre-approvals, supporting documents, or relevant context."
                  rows={5}
                  required
                  style={{ width: "100%", resize: "vertical", boxSizing: "border-box" }}
                />
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                  {form.reason.length} chars (min 20)
                </div>
              </div>
              <button type="submit" className="btn-block" style={{ marginTop: "0.5rem" }}>
                Submit for Review
              </button>
            </form>
          </Card>
        </WalletGuard>
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
