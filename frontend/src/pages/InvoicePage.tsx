import { useState, useEffect, useCallback } from "react";
import { useWallet } from "../lib/wallet";
import { contracts } from "../lib/contracts/index";
import { CONTRACT_IDS, fetchContractEvents } from "../lib/stellar";
import { useAmountValidation } from "../lib/validation";
import { PageHeader, Card, Field, Icon, Skeleton } from "../components/ui";
import { EventFeed } from "../components/EventFeed";
import LockupStatusCard from "../components/LockupStatusCard";
import WalletGuard from "../components/WalletGuard";
import ConfirmDialog from "../components/ConfirmDialog";
import { useToast } from "../lib/toast";
import type { InvoiceMeta, ContractEvent, JournalEntry } from "../types";

function Spinner() {
  return (
    <span
      role="status"
      aria-label="Loading"
      style={{
        display: "inline-block",
        width: 16,
        height: 16,
        border: "2px solid currentColor",
        borderTopColor: "transparent",
        borderRadius: "50%",
        animation: "spin 0.7s linear infinite",
        verticalAlign: "middle",
        marginRight: 6,
      }}
    />
  );
}

export default function InvoicePage() {
  const { connected, address, signTx } = useWallet();
  const { addToast } = useToast();

  const [tab, setTab] = useState<"issue" | "redeem" | "timeline">("issue");

  // ── On-chain state ───────────────────────────────────────────────────────
  const [meta, setMeta] = useState<InvoiceMeta | null>(null);
  const [isSettled, setIsSettled] = useState<boolean | null>(null);
  const [totalSupply, setTotalSupply] = useState<bigint | null>(null);
  const [lifecyclePaused, setLifecyclePaused] = useState<boolean | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);

  // ── Issue form ───────────────────────────────────────────────────────────
  const [issueAmount, setIssueAmount] = useState("");
  const [issueTo, setIssueTo] = useState("");
  const [issueLoading, setIssueLoading] = useState(false);

  // ── Settle ───────────────────────────────────────────────────────────────
  const [settleLoading, setSettleLoading] = useState(false);
  const [pauseLifecycleLoading, setPauseLifecycleLoading] = useState(false);

  // ── Redeem form ──────────────────────────────────────────────────────────
  const [redeemAmount, setRedeemAmount] = useState("");
  const [redeemLoading, setRedeemLoading] = useState(false);

  // ── Events ───────────────────────────────────────────────────────────────
  const [events, setEvents] = useState<ContractEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  // ── Timeline ─────────────────────────────────────────────────────────────
  const [journal, setJournal] = useState<JournalEntry[] | null>(null);
  const [journalLoading, setJournalLoading] = useState(false);
  const [, setJournalError] = useState<string | null>(null);

  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    onConfirm: () => void;
  } | null>(null);

  // Validations
  const issueAmountValidation = useAmountValidation(issueAmount);
  const redeemAmountValidation = useAmountValidation(redeemAmount);

  // ── Load on-chain state ──────────────────────────────────────────────────
  const loadChainState = useCallback(async () => {
    if (!CONTRACT_IDS.invoiceToken) return;
    setMetaLoading(true);
    setMetaError(null);
    try {
      const [fetchedMeta, settled, supply, paused] = await Promise.all([
        contracts.invoice.getMeta(),
        contracts.invoice.isSettled(),
        contracts.invoice.totalSupply(),
        contracts.invoice.lifecyclePaused(),
      ]);
      setMeta(fetchedMeta);
      setIsSettled(settled);
      setTotalSupply(supply);
      setLifecyclePaused(paused);
    } catch (err) {
      setMetaError(err instanceof Error ? err.message : "Failed to load invoice metadata.");
    } finally {
      setMetaLoading(false);
    }
  }, []);

  useEffect(() => {
    loadChainState();
  }, [loadChainState]);

  const fetchEvents = async () => {
    if (!CONTRACT_IDS.invoiceToken) return;
    try {
      const fetched = await fetchContractEvents(CONTRACT_IDS.invoiceToken, 10);
      setEvents(fetched);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    setEventsLoading(true);
    fetchEvents().finally(() => setEventsLoading(false));
  }, []);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected || !address) return;
    if (!issueAmountValidation.isValid) {
      addToast(issueAmountValidation.error || "Invalid amount", "error");
      return;
    }
    setIssueLoading(true);
    try {
      await contracts.invoice.issue(
        address,
        issueTo || address,
        BigInt(issueAmount),
        signTx,
      );
      addToast("Invoice tokens issued successfully.", "success");
      setIssueAmount("");
      setIssueTo("");
      await loadChainState();
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setIssueLoading(false);
    }
  };

  const handleSettle = async () => {
    if (!connected || !address) return;
    setSettleLoading(true);
    try {
      await contracts.invoice.settle(address, signTx);
      addToast("Invoice settled. Redemption is now open.", "success");
      setIsSettled(true);
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSettleLoading(false);
    }
  };

  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected || !address) return;
    if (!redeemAmountValidation.isValid) {
      addToast(redeemAmountValidation.error || "Invalid amount", "error");
      return;
    }
    setRedeemLoading(true);
    try {
      await contracts.invoice.redeem(address, BigInt(redeemAmount), signTx);
      addToast("Tokens redeemed successfully.", "success");
      setRedeemAmount("");
      await loadChainState();
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setRedeemLoading(false);
    }
  };

  const hasIssueAmountError =
    issueAmount.length > 0 && !issueAmountValidation.isValid;
  const hasRedeemAmountError =
    redeemAmount.length > 0 && !redeemAmountValidation.isValid;

  const loadJournal = useCallback(async () => {
    if (!CONTRACT_IDS.invoiceToken || !meta) return;
    setJournalLoading(true);
    setJournalError(null);
    try {
      const entries = await contracts.invoice.getJournal(meta.invoice_id);
      setJournal(entries);
    } catch (err) {
      setJournalError(err instanceof Error ? err.message : "Failed to load timeline.");
    } finally {
      setJournalLoading(false);
    }
  }, [meta]);

  const handleTabTimeline = () => {
    setTab("timeline");
    if (!journal && !journalLoading) loadJournal();
  };

  const handleToggleLifecyclePause = async () => {
    if (!connected || !address) return;
    setPauseLifecycleLoading(true);
    try {
      if (lifecyclePaused) {
        await contracts.invoice.unpauseLifecycle(address, signTx);
        addToast("Invoice lifecycle resumed. Settlement and redemption are now open.", "success");
        setLifecyclePaused(false);
      } else {
        await contracts.invoice.pauseLifecycle(address, signTx);
        addToast("Invoice lifecycle paused. Settlement and redemption are blocked.", "info");
        setLifecyclePaused(true);
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setPauseLifecycleLoading(false);
    }
  };

  return (
    <div className="form-narrow">
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <PageHeader
        eyebrow="Asset Module"
        icon={<Icon.invoice size={22} />}
        title="Invoice Token"
        description="Tokenize an accounts-receivable invoice. Each token unit represents one stroop (10⁻⁷ USD) of face value."
      />

      {/* ── Lockup status panel ─────────────────────────────────────────── */}
      {connected && address && <LockupStatusCard address={address} />}

      {/* ── Invoice metadata panel ─────────────────────────────────────── */}
      <Card title="Invoice Details" style={{ marginBottom: "1.25rem" }}>
        {metaLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            <Skeleton height="1rem" width="60%" />
            <Skeleton height="1rem" width="80%" />
            <Skeleton height="1rem" width="50%" />
            <Skeleton height="1rem" width="70%" />
          </div>
        ) : metaError ? (
          <p style={{ color: "#ef4444", fontSize: "0.875rem" }}>{metaError}</p>
        ) : meta ? (
          <>
            {/* Status badges */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
              <span
                role="status"
                aria-live="polite"
                style={{
                  display: "inline-block", padding: "0.2rem 0.7rem", borderRadius: 99,
                  fontSize: "0.78rem", fontWeight: 700,
                  background: isSettled ? "var(--accent-soft)" : "var(--surface-2)",
                  color: isSettled ? "var(--accent-2)" : "var(--muted)",
                  border: "1px solid var(--border)",
                }}
              >
                {isSettled === null ? "Checking…" : isSettled ? "✓ Settled — Redemption Open" : "Pending Settlement"}
              </span>
              {lifecyclePaused !== null && (
                <span
                  role="status"
                  aria-live="polite"
                  aria-label={lifecyclePaused ? "Lifecycle paused" : "Lifecycle active"}
                  style={{
                    display: "inline-block", padding: "0.2rem 0.7rem", borderRadius: 99,
                    fontSize: "0.78rem", fontWeight: 700,
                    background: lifecyclePaused ? "rgba(239,68,68,0.12)" : "var(--success-soft)",
                    color: lifecyclePaused ? "#ef4444" : "var(--success)",
                    border: `1px solid ${lifecyclePaused ? "rgba(239,68,68,0.3)" : "rgba(52,211,153,0.3)"}`,
                  }}
                >
                  {lifecyclePaused ? "⏸ Lifecycle Paused" : "▶ Lifecycle Active"}
                </span>
              )}
            </div>

            <dl style={styles.dl}>
              <dt style={styles.dt}>Invoice ID</dt>
              <dd style={styles.dd}>{meta.invoice_id}</dd>

              <dt style={styles.dt}>Issuer</dt>
              <dd style={styles.dd}>{meta.issuer}</dd>

              <dt style={styles.dt}>Debtor</dt>
              <dd style={styles.dd}>{meta.debtor}</dd>

              <dt style={styles.dt}>Face Value</dt>
              <dd style={styles.dd}>
                {Number(meta.face_value_usd).toLocaleString()} {meta.currency}
              </dd>

              <dt style={styles.dt}>Discount Rate</dt>
              <dd style={styles.dd}>{meta.discount_rate_bps} bps</dd>

              <dt style={styles.dt}>Due Date</dt>
              <dd style={styles.dd}>
                {new Date(
                  (typeof meta.due_date === "bigint"
                    ? Number(meta.due_date)
                    : meta.due_date) * 1000,
                ).toLocaleDateString()}
              </dd>

              <dt style={styles.dt}>Total Supply</dt>
              <dd style={styles.dd}>
                {totalSupply !== null
                  ? Number(totalSupply).toLocaleString()
                  : "—"}{" "}
                tokens
              </dd>

              {meta.ipfs_doc_hash && (
                <>
                  <dt style={styles.dt}>IPFS Doc Hash</dt>
                  <dd
                    style={{
                      ...styles.dd,
                      fontFamily: "monospace",
                      fontSize: "0.78rem",
                      wordBreak: "break-all",
                    }}
                  >
                    {meta.ipfs_doc_hash}
                  </dd>
                </>
              )}

              {meta.transfer_fee_bps !== undefined && meta.transfer_fee_bps !== null && (
                <>
                  <dt style={styles.dt}>Transfer Fee</dt>
                  <dd style={styles.dd}>
                    {meta.transfer_fee_bps > 0
                      ? `${meta.transfer_fee_bps} bps (${(meta.transfer_fee_bps / 100).toFixed(2)}%)`
                      : "No fee"}
                  </dd>
                </>
              )}

              {meta.fee_recipient && (
                <>
                  <dt style={styles.dt}>Fee Recipient</dt>
                  <dd style={{ ...styles.dd, fontFamily: "monospace", fontSize: "0.78rem", wordBreak: "break-all" }}>
                    {meta.fee_recipient}
                  </dd>
                </>
              )}
            </dl>

            {/* Admin: settle button, visible only when not yet settled */}
            {connected && isSettled === false && (
              <div style={{ marginTop: "1.25rem" }}>
                <button className="btn-block" onClick={handleSettle} disabled={settleLoading}>
                  {settleLoading && <Spinner />}
                  {settleLoading ? "Settling…" : "Settle Invoice"}
                </button>
                <p className="muted" style={{ fontSize: "0.75rem", marginTop: "0.4rem" }}>
                  Admin only. Marks this invoice as settled and opens token redemption for all holders.
                </p>
              </div>
            )}

            {/* Admin: lifecycle pause controls */}
            {connected && (
              <div style={{ marginTop: "1.25rem", paddingTop: "1.25rem", borderTop: "1px solid var(--border)" }}>
                <p style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.6rem" }}>
                  Lifecycle Controls
                  <span className="muted" style={{ fontWeight: 400, marginLeft: "0.4rem" }}>— admin only</span>
                </p>
                <button
                  className={lifecyclePaused ? "btn-success btn-block" : "btn-block"}
                  style={lifecyclePaused ? undefined : { background: "rgba(239,68,68,0.15)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)" }}
                  onClick={handleToggleLifecyclePause}
                  disabled={pauseLifecycleLoading || lifecyclePaused === null}
                  aria-pressed={lifecyclePaused === true}
                >
                  {pauseLifecycleLoading && <Spinner />}
                  {pauseLifecycleLoading ? "Updating…" : lifecyclePaused ? "Resume Settlement & Redemption" : "Pause Settlement & Redemption"}
                </button>
                <p className="muted" style={{ fontSize: "0.75rem", marginTop: "0.4rem" }}>
                  Pausing blocks <code>settle()</code> and <code>redeem()</code>. Transfers in Issued state continue normally.
                </p>
              </div>
            )}
          </>
        ) : (
          <p className="muted" style={{ fontSize: "0.875rem" }}>
            No contract deployed or contract ID not configured.
          </p>
        )}
      </Card>

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <div style={styles.tabs}>
        <button
          onClick={() => setTab("issue")}
          className={tab === "issue" ? "" : "btn-ghost"}
          style={styles.tab}
        >
          Issue Tokens
        </button>
        <button
          onClick={() => setTab("redeem")}
          className={tab === "redeem" ? "" : "btn-ghost"}
          style={styles.tab}
        >
          Redeem
        </button>
        <button
          onClick={handleTabTimeline}
          className={tab === "timeline" ? "" : "btn-ghost"}
          style={styles.tab}
        >
          Timeline
        </button>
      </div>

      {/* ── Issue tab ──────────────────────────────────────────────────── */}
      {tab === "issue" && (
        <WalletGuard>
          <Card>
            <form onSubmit={handleIssue}>
              <Field
                label="Recipient Address"
                value={issueTo}
                onChange={(e) => setIssueTo(e.target.value)}
                placeholder={address ?? "G…"}
              />
              <Field
                label="Amount (stroops)"
                type="number"
                value={issueAmount}
                onChange={(e) => setIssueAmount(e.target.value)}
                required
                error={issueAmountValidation.error}
              />
              <button
                type="submit"
                className="btn-block"
                style={{ marginTop: "0.75rem" }}
                disabled={issueLoading || hasIssueAmountError}
              >
                {issueLoading && <Spinner />}
                {issueLoading ? "Issuing…" : "Issue Invoice Tokens"}
              </button>
            </form>
          </Card>
        </WalletGuard>
      )}

      {/* ── Redeem tab ─────────────────────────────────────────────────── */}
      {tab === "redeem" && (
        <WalletGuard>
          <Card>
            {isSettled === false && (
              <p style={{ color: "#f59e0b", fontSize: "0.85rem", marginBottom: "1rem", padding: "0.6rem 0.75rem", background: "var(--surface-2)", borderRadius: 8, border: "1px solid var(--border)" }}>
                ⚠ Redemption is only available after the invoice is settled by the admin.
              </p>
            )}
            {lifecyclePaused && (
              <p role="alert" style={{ color: "#ef4444", fontSize: "0.85rem", marginBottom: "1rem", padding: "0.6rem 0.75rem", background: "rgba(239,68,68,0.08)", borderRadius: 8, border: "1px solid rgba(239,68,68,0.25)" }}>
                ⏸ Redemption is currently paused by the admin. Please check back later.
              </p>
            )}
            <form onSubmit={handleRedeem}>
              <Field
                label="Amount to Redeem (stroops)"
                type="number"
                value={redeemAmount}
                onChange={(e) => setRedeemAmount(e.target.value)}
                required
                error={redeemAmountValidation.error}
              />
              <button
                type="submit"
                className="btn-block"
                style={{ marginTop: "0.75rem" }}
                disabled={redeemLoading || hasRedeemAmountError || !isSettled || !!lifecyclePaused}
              >
                {redeemLoading && <Spinner />}
                {redeemLoading ? "Redeeming…" : "Redeem Tokens"}
              </button>
            </form>
          </Card>
        </WalletGuard>
      )}

      <EventFeed
        events={events}
        loading={eventsLoading}
        onRefresh={fetchEvents}
        title="Recent Invoice Activity"
        autoRefreshInterval={30000}
      />

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
  dl: {
    display: "grid",
    gridTemplateColumns: "max-content 1fr",
    gap: "0.3rem 1rem",
    margin: 0,
    fontSize: "0.875rem",
  },
  dt: {
    color: "var(--muted)",
    fontWeight: 500,
  },
  dd: {
    margin: 0,
  },
};
