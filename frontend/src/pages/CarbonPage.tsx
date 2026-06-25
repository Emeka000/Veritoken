import { useState } from "react";
import { useWallet } from "../lib/wallet";
import { CONTRACT_IDS } from "../lib/stellar";
import { PageHeader, Card, Field, Select, Icon } from "../components/ui";

interface RetirementReceipt {
  index: number;
  retiree: string;
  amount: number;
  timestamp: number;
  beneficiary: string;
  retirement_reason: string;
}

const PAGE_SIZE = 10;

export default function CarbonPage() {
  const { connected } = useWallet();
  const [tab, setTab] = useState<"issue" | "retire" | "receipts">("issue");

  const [issueForm, setIssueForm] = useState({
    project_id: "",
    standard: "VCS",
    vintage_year: "2024",
    project_name: "",
    project_type: "forestry",
    country: "",
    verifier: "",
    ipfs_cert_hash: "",
    amount: "",
  });

  const [retireForm, setRetireForm] = useState({ amount: "", beneficiary: "", reason: "" });

  // Receipts pagination state
  const [receipts, setReceipts] = useState<RetirementReceipt[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [loadingReceipts, setLoadingReceipts] = useState(false);

  const issue = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setIssueForm((f) => ({ ...f, [k]: e.target.value }));
  const retire = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setRetireForm((f) => ({ ...f, [k]: e.target.value }));

  const handleIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected) return alert("Connect wallet first");
    alert(`Would mint ${issueForm.amount} carbon credits on ${CONTRACT_IDS.carbonToken || "<not configured>"}`);
  };

  const handleRetire = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected) return alert("Connect wallet first");
    alert(`Would retire ${retireForm.amount} credits for "${retireForm.beneficiary}"`);
  };

  const loadReceipts = async (targetPage: number) => {
    setLoadingReceipts(true);
    try {
      // In a real integration these would be contract view calls via the Stellar SDK.
      // For now we surface the call shape so wiring is straightforward.
      const start = targetPage * PAGE_SIZE;
      alert(
        `Would call retirement_count() then get_receipts(start=${start}, limit=${PAGE_SIZE}) ` +
          `on ${CONTRACT_IDS.carbonToken || "<not configured>"}`
      );
      setPage(targetPage);
    } finally {
      setLoadingReceipts(false);
    }
  };

  const handleTabReceipts = () => {
    setTab("receipts");
    if (receipts.length === 0 && totalCount === null) {
      loadReceipts(0);
    }
  };

  const totalPages = totalCount !== null ? Math.ceil(totalCount / PAGE_SIZE) : null;

  return (
    <div className="form-narrow">
      <PageHeader
        eyebrow="Asset Module"
        icon={<Icon.carbon size={22} />}
        title="Carbon Credit Token"
        description="Issue verified carbon credits (1 token = 1 tonne CO₂e) and retire them with permanent on-chain receipts."
      />

      <div style={styles.tabs}>
        <button
          onClick={() => setTab("issue")}
          className={tab === "issue" ? "" : "btn-ghost"}
          style={styles.tab}
        >
          Issue Credits
        </button>
        <button
          onClick={() => setTab("retire")}
          className={tab === "retire" ? "" : "btn-ghost"}
          style={styles.tab}
        >
          Retire Credits
        </button>
        <button
          onClick={handleTabReceipts}
          className={tab === "receipts" ? "" : "btn-ghost"}
          style={styles.tab}
        >
          Receipts
        </button>
      </div>

      {tab === "issue" && (
        <Card>
          <form onSubmit={handleIssue}>
            <Field label="Project ID" value={issueForm.project_id} onChange={issue("project_id")} required />
            <Select
              label="Standard"
              value={issueForm.standard}
              onChange={issue("standard")}
              options={["VCS", "Gold Standard", "CDM", "ACR"].map((s) => ({ value: s, label: s }))}
            />
            <Field label="Vintage Year" type="number" value={issueForm.vintage_year} onChange={issue("vintage_year")} required />
            <Field label="Project Name" value={issueForm.project_name} onChange={issue("project_name")} required />
            <Select
              label="Project Type"
              value={issueForm.project_type}
              onChange={issue("project_type")}
              options={[
                { value: "forestry", label: "Forestry" },
                { value: "renewable", label: "Renewable Energy" },
                { value: "methane_capture", label: "Methane Capture" },
              ]}
            />
            <Field label="Country" value={issueForm.country} onChange={issue("country")} required />
            <Field label="Verifier" value={issueForm.verifier} onChange={issue("verifier")} required />
            <Field label="IPFS Certificate Hash" value={issueForm.ipfs_cert_hash} onChange={issue("ipfs_cert_hash")} placeholder="bafyrei…" />
            <Field label="Credits to Mint (tonnes CO₂e)" type="number" value={issueForm.amount} onChange={issue("amount")} required />
            <button type="submit" className="btn-block" style={{ marginTop: "0.75rem" }}>
              Issue Carbon Credits
            </button>
          </form>
        </Card>
      )}

      {tab === "retire" && (
        <Card>
          <form onSubmit={handleRetire}>
            <Field label="Amount to Retire (tonnes CO₂e)" type="number" value={retireForm.amount} onChange={retire("amount")} required />
            <Field label="Beneficiary Name" value={retireForm.beneficiary} onChange={retire("beneficiary")} placeholder="Acme Corp 2024 offset" />
            <Field label="Retirement Reason" value={retireForm.reason} onChange={retire("reason")} placeholder="Annual Scope 1 offset" />
            <p className="muted" style={{ fontSize: "0.78rem", margin: "0.25rem 0 0.9rem" }}>
              Retirement is permanent — credits are burned and cannot be re-issued.
            </p>
            <button type="submit" className="btn-success btn-block">
              Retire Credits (Permanent)
            </button>
          </form>
        </Card>
      )}

      {tab === "receipts" && (
        <Card>
          <div style={styles.receiptsHeader}>
            <span style={{ fontWeight: 600 }}>
              Retirement Receipts
              {totalCount !== null && (
                <span className="muted" style={{ fontWeight: 400, marginLeft: "0.4rem" }}>
                  ({totalCount} total)
                </span>
              )}
            </span>
            <button
              className="btn-ghost"
              style={{ fontSize: "0.8rem" }}
              onClick={() => loadReceipts(page)}
              disabled={loadingReceipts}
            >
              {loadingReceipts ? "Loading…" : "Refresh"}
            </button>
          </div>

          {receipts.length === 0 && !loadingReceipts && (
            <p className="muted" style={{ fontSize: "0.85rem", margin: "1rem 0" }}>
              No receipts loaded. Connect your wallet and click Refresh.
            </p>
          )}

          {receipts.map((r) => (
            <div key={r.index} style={styles.receiptRow}>
              <div style={styles.receiptIndex}>#{r.index}</div>
              <div style={styles.receiptBody}>
                <div style={{ fontWeight: 500 }}>
                  {r.amount} tCO₂e — {r.beneficiary || "—"}
                </div>
                <div className="muted" style={{ fontSize: "0.78rem" }}>
                  {r.retiree} · {new Date(r.timestamp * 1000).toLocaleDateString()}
                </div>
                {r.retirement_reason && (
                  <div className="muted" style={{ fontSize: "0.78rem" }}>
                    {r.retirement_reason}
                  </div>
                )}
              </div>
            </div>
          ))}

          {totalPages !== null && totalPages > 1 && (
            <div style={styles.pagination}>
              <button
                className="btn-ghost"
                onClick={() => loadReceipts(page - 1)}
                disabled={page === 0 || loadingReceipts}
              >
                ← Prev
              </button>
              <span className="muted" style={{ fontSize: "0.85rem" }}>
                Page {page + 1} / {totalPages}
              </span>
              <button
                className="btn-ghost"
                onClick={() => loadReceipts(page + 1)}
                disabled={page >= totalPages - 1 || loadingReceipts}
              >
                Next →
              </button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  tabs: {
    display: "inline-flex",
    gap: "0.35rem",
    padding: "0.3rem",
    marginBottom: "1.5rem",
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    borderRadius: 12,
  },
  tab: { boxShadow: "none" },
  receiptsHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "0.75rem",
  },
  receiptRow: {
    display: "flex",
    gap: "0.75rem",
    padding: "0.6rem 0",
    borderBottom: "1px solid var(--border)",
  },
  receiptIndex: {
    minWidth: 36,
    color: "var(--muted)",
    fontSize: "0.8rem",
    paddingTop: 2,
  },
  receiptBody: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: "0.15rem",
  },
  pagination: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: "1rem",
  },
};
