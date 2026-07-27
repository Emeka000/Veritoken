import { useState, useEffect } from "react";
import { useWallet } from "../lib/wallet";
import { contracts } from "../lib/contracts/index";
import { CONTRACT_IDS, fetchContractEvents } from "../lib/stellar";
import { useAddressValidation } from "../lib/useAddressValidation";
import { useAmountValidation } from "../lib/validation";
import { PageHeader, Card, Field, Icon } from "../components/ui";
import { EventFeed } from "../components/EventFeed";
import WalletGuard from "../components/WalletGuard";
import ConfirmDialog from "../components/ConfirmDialog";
import { useToast } from "../lib/toast";
import type { RetirementReceipt, ContractEvent, ReceiptVerification } from "../types";

const PAGE_SIZE = 10;

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

function ReceiptCard({
  receipt,
  index,
  highlight = false,
  verification,
  onVerify,
  verifying,
}: {
  receipt: RetirementReceipt;
  index: number;
  highlight?: boolean;
  verification?: ReceiptVerification | null;
  onVerify?: (index: number) => void;
  verifying?: boolean;
}) {
  const amount =
    typeof receipt.amount === "bigint"
      ? Number(receipt.amount)
      : (receipt.amount as number);
  return (
    <div
      style={{
        display: "flex",
        gap: "0.75rem",
        padding: "0.65rem 0",
        borderBottom: "1px solid var(--border)",
        background: highlight ? "var(--accent-soft)" : undefined,
        borderRadius: highlight ? 8 : undefined,
        paddingLeft: highlight ? "0.5rem" : undefined,
      }}
    >
      <div
        style={{
          minWidth: 36,
          color: "var(--muted)",
          fontSize: "0.8rem",
          paddingTop: 2,
        }}
      >
        #{index}
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: "0.15rem",
        }}
      >
        <div style={{ fontWeight: 500 }}>
          {amount.toLocaleString()} tCO₂e
          {receipt.beneficiary ? ` — ${receipt.beneficiary}` : ""}
        </div>
        <div className="muted" style={{ fontSize: "0.78rem" }}>
          {receipt.retiree} ·{" "}
          {new Date(
            (typeof receipt.timestamp === "bigint"
              ? Number(receipt.timestamp)
              : receipt.timestamp) * 1000,
          ).toLocaleDateString()}
        </div>
        {receipt.retirement_reason && (
          <div className="muted" style={{ fontSize: "0.78rem" }}>
            {receipt.retirement_reason}
          </div>
        )}
        {/* Verification badge */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.25rem" }}>
          {verification === undefined && onVerify && (
            <button
              className="btn-ghost"
              style={{ fontSize: "0.72rem", padding: "0.15rem 0.5rem" }}
              onClick={() => onVerify(index)}
              disabled={verifying}
            >
              {verifying ? "Verifying…" : "Verify"}
            </button>
          )}
          {verification === null && (
            <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>Verifying…</span>
          )}
          {verification && (
            <span
              role="status"
              aria-label={verification.valid ? "Receipt verified" : "Receipt invalid"}
              style={{
                display: "inline-flex", alignItems: "center", gap: "0.3rem",
                fontSize: "0.72rem", fontWeight: 700, padding: "0.15rem 0.5rem",
                borderRadius: 99,
                background: verification.valid ? "rgba(52,211,153,0.15)" : "rgba(239,68,68,0.12)",
                color: verification.valid ? "var(--success)" : "#ef4444",
                border: `1px solid ${verification.valid ? "rgba(52,211,153,0.35)" : "rgba(239,68,68,0.3)"}`,
              }}
            >
              {verification.valid ? "✓ Verified" : "✗ Invalid"}
              {verification.valid && verification.serial ? ` · ${verification.serial}` : ""}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CarbonPage() {
  const { connected, address, signTx } = useWallet();
  const { addToast } = useToast();
  const [tab, setTab] = useState<"issue" | "retire" | "receipts">("issue");

  const [mintTo, setMintTo] = useState("");
  const [mintAmount, setMintAmount] = useState("");
  const [mintLoading, _setMintLoading] = useState(false);

  const [transferTo, setTransferTo] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferLoading, _setTransferLoading] = useState(false);

  const [retireAmount, setRetireAmount] = useState("");
  const [retireBeneficiary, setRetireBeneficiary] = useState("");
  const [retireReason, setRetireReason] = useState("");
  const [retireLoading, setRetireLoading] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<RetirementReceipt | null>(
    null,
  );

  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    onConfirm: () => Promise<void>;
  } | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const [receipts, setReceipts] = useState<RetirementReceipt[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [receiptsLoading, setReceiptsLoading] = useState(false);

  // Map from global receipt index → ReceiptVerification (null = in-flight)
  const [verifications, setVerifications] = useState<Record<number, ReceiptVerification | null>>({});
  const [verifyingIndex, setVerifyingIndex] = useState<number | null>(null);

  const [events, setEvents] = useState<ContractEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  const [registryUrl, setRegistryUrl] = useState<string | null>(null);
  const [registryProjectId, setRegistryProjectId] = useState<string | null>(null);

  // Address validations
  const mintToValidation = useAddressValidation(mintTo);
  const transferToValidation = useAddressValidation(transferTo);

  // Amount validations
  const mintAmountValidation = useAmountValidation(mintAmount);
  const transferAmountValidation = useAmountValidation(transferAmount);
  const retireAmountValidation = useAmountValidation(retireAmount);

  const fetchEvents = async () => {
    if (!CONTRACT_IDS.carbonToken) return;
    try {
      const fetched = await fetchContractEvents(CONTRACT_IDS.carbonToken, 10);
      setEvents(fetched);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    setEventsLoading(true);
    fetchEvents().finally(() => setEventsLoading(false));
    contracts.carbon.getRegistryLink()
      .then(([url, pid]: [string, string]) => { setRegistryUrl(url); setRegistryProjectId(pid); })
      .catch(() => {});
  }, []);

  const runConfirmed = async (action: () => Promise<void>) => {
    setConfirmLoading(true);
    try {
      await action();
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setConfirmLoading(false);
      setConfirm(null);
    }
  };

  const handleMint = (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected || !address) return;
    if (mintTo && !mintToValidation.isValid) {
      addToast("Please enter a valid Stellar address for recipient", "error");
      return;
    }
    if (!mintAmountValidation.isValid) {
      addToast(mintAmountValidation.error || "Invalid amount", "error");
      return;
    }
    const recipient = mintTo || address;
    setConfirm({
      title: "Issue Carbon Credits",
      description: `You are about to mint ${mintAmount} tCO₂e to ${recipient.slice(0, 8)}…${recipient.slice(-4)}.`,
      onConfirm: async () => {
        await contracts.carbon.mint(address, recipient, BigInt(mintAmount), signTx);
        addToast("Credits issued successfully.", "success");
        setMintAmount("");
        setMintTo("");
      },
    });
  };

  const handleTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected || !address) return;
    if (!transferToValidation.isValid) {
      addToast("Please enter a valid Stellar address for recipient", "error");
      return;
    }
    if (!transferAmountValidation.isValid) {
      addToast(transferAmountValidation.error || "Invalid amount", "error");
      return;
    }
    setConfirm({
      title: "Transfer Carbon Credits",
      description: `You are about to transfer ${transferAmount} tCO₂e to ${transferTo.slice(0, 8)}…${transferTo.slice(-4)}.`,
      onConfirm: async () => {
        await contracts.carbon.transfer(address, transferTo, BigInt(transferAmount), signTx);
        addToast("Transfer sent successfully.", "success");
        setTransferAmount("");
        setTransferTo("");
      },
    });
  };

  const handleRetire = (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected || !address) return;
    if (!retireAmountValidation.isValid) {
      addToast(retireAmountValidation.error || "Invalid amount", "error");
      return;
    }
    setConfirm({
      title: "Retire Carbon Credits",
      description: `You are about to permanently retire ${retireAmount} tCO₂e${retireBeneficiary ? ` on behalf of ${retireBeneficiary}` : ""}.`,
      onConfirm: async () => {
        setRetireLoading(true);
        setLastReceipt(null);
        try {
          const receipt = await contracts.carbon.retire(
            address, BigInt(retireAmount), retireBeneficiary, retireReason, signTx,
          );
          setLastReceipt(receipt);
          addToast("Credits retired successfully.", "success");
          setRetireAmount("");
          setRetireBeneficiary("");
          setRetireReason("");
        } finally {
          setRetireLoading(false);
        }
      },
    });
  };

  const handleVerify = async (globalIndex: number) => {
    setVerifyingIndex(globalIndex);
    setVerifications((prev) => ({ ...prev, [globalIndex]: null }));
    try {
      const result = await contracts.carbon.verifyReceipt(globalIndex);
      setVerifications((prev) => ({ ...prev, [globalIndex]: result }));
    } catch {
      // On error remove the in-flight indicator so user can retry
      setVerifications((prev) => {
        const next = { ...prev };
        delete next[globalIndex];
        return next;
      });
      addToast("Failed to verify receipt.", "error");
    } finally {
      setVerifyingIndex(null);
    }
  };

  const loadReceipts = async (targetPage: number) => {
    if (!address) {
      addToast("Connect your wallet to load receipts.", "info");
      return;
    }
    setReceiptsLoading(true);
    try {
      const count = await contracts.carbon.retirementCount();
      setTotalCount(count);
      const fetched = await contracts.carbon.getReceipts(
        targetPage * PAGE_SIZE,
        PAGE_SIZE,
      );
      setReceipts(fetched);
      setPage(targetPage);
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setReceiptsLoading(false);
    }
  };

  const handleTabReceipts = () => {
    setTab("receipts");
    if (receipts.length === 0 && totalCount === null) loadReceipts(0);
  };

  const totalPages =
    totalCount !== null ? Math.ceil(totalCount / PAGE_SIZE) : null;

  // Check validation errors for button disabling
  const hasMintAddressError = mintTo.length > 0 && !mintToValidation.isValid;
  const hasMintAmountError =
    mintAmount.length > 0 && !mintAmountValidation.isValid;
  const hasTransferAddressError =
    !transferToValidation.isValid && transferTo.length > 0;
  const hasTransferAmountError =
    transferAmount.length > 0 && !transferAmountValidation.isValid;
  const hasRetireAmountError =
    retireAmount.length > 0 && !retireAmountValidation.isValid;

  return (
    <div className="form-narrow">
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <PageHeader
        eyebrow="Asset Module"
        icon={<Icon.carbon size={22} />}
        title="Carbon Credit Token"
        description="Issue verified carbon credits (1 token = 1 tonne CO₂e) and retire them with permanent on-chain receipts."
      />

      {registryUrl && (
        <div style={{ marginBottom: "1rem", fontSize: "0.85rem" }}>
          <span className="muted">Registry: </span>
          <a href={registryUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-2)" }}>
            {registryProjectId ? `${registryProjectId} ↗` : registryUrl}
          </a>
        </div>
      )}

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
        <WalletGuard>
          <Card>
            <form onSubmit={handleMint}>
              <Field
                label="Recipient Address"
                value={mintTo}
                onChange={(e) => setMintTo(e.target.value)}
                placeholder={address ?? "G…"}
                error={mintToValidation.error}
              />
              <Field
                label="Credits to Mint (tonnes CO₂e)"
                type="number"
                value={mintAmount}
                onChange={(e) => setMintAmount(e.target.value)}
                required
                error={mintAmountValidation.error}
              />
              <button
                type="submit"
                className="btn-block"
                style={{ marginTop: "0.75rem" }}
                disabled={
                  mintLoading || hasMintAddressError || hasMintAmountError
                }
              >
                {mintLoading && <Spinner />}
                {mintLoading ? "Issuing…" : "Issue Carbon Credits"}
              </button>
            </form>
            <hr style={{ margin: "1.5rem 0", borderColor: "var(--border)" }} />
            <h3
              style={{
                fontSize: "0.95rem",
                fontWeight: 700,
                marginBottom: "0.75rem",
              }}
            >
              Transfer Credits
            </h3>
            <form onSubmit={handleTransfer}>
              <Field
                label="Recipient Address"
                value={transferTo}
                onChange={(e) => setTransferTo(e.target.value)}
                placeholder="G…"
                required
                error={transferToValidation.error}
              />
              <Field
                label="Amount (tonnes CO₂e)"
                type="number"
                value={transferAmount}
                onChange={(e) => setTransferAmount(e.target.value)}
                required
                error={transferAmountValidation.error}
              />
              <button
                type="submit"
                className="btn-block btn-ghost"
                style={{ marginTop: "0.75rem" }}
                disabled={
                  transferLoading ||
                  hasTransferAddressError ||
                  hasTransferAmountError
                }
              >
                {transferLoading && <Spinner />}
                {transferLoading ? "Transferring…" : "Transfer Credits"}
              </button>
            </form>
          </Card>
        </WalletGuard>
      )}

      {tab === "retire" && (
        <WalletGuard>
          <Card>
            <form onSubmit={handleRetire}>
              <Field
                label="Amount to Retire (tonnes CO₂e)"
                type="number"
                value={retireAmount}
                onChange={(e) => setRetireAmount(e.target.value)}
                required
                error={retireAmountValidation.error}
              />
              <Field
                label="Beneficiary Name"
                value={retireBeneficiary}
                onChange={(e) => setRetireBeneficiary(e.target.value)}
                placeholder="Acme Corp 2024 offset"
              />
              <Field
                label="Retirement Reason"
                value={retireReason}
                onChange={(e) => setRetireReason(e.target.value)}
                placeholder="Annual Scope 1 offset"
              />
              <p
                className="muted"
                style={{ fontSize: "0.78rem", margin: "0.25rem 0 0.9rem" }}
              >
                Retirement is permanent — credits are burned and cannot be
                re-issued.
              </p>
              <button
                type="submit"
                className="btn-success btn-block"
                disabled={retireLoading || hasRetireAmountError}
              >
                {retireLoading && <Spinner />}
                {retireLoading ? "Retiring…" : "Retire Credits (Permanent)"}
              </button>
            </form>
            {lastReceipt && (
              <div
                style={{
                  marginTop: "1.25rem",
                  padding: "1rem",
                  borderRadius: 12,
                  background: "var(--accent-soft)",
                  border: "1px solid var(--border)",
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    marginBottom: "0.5rem",
                    fontSize: "0.95rem",
                  }}
                >
                  Retirement Receipt
                </div>
                <dl style={styles.receipt}>
                  <dt>Retiree</dt>
                  <dd style={styles.mono}>{lastReceipt.retiree}</dd>
                  <dt>Amount</dt>
                  <dd>
                    {(typeof lastReceipt.amount === "bigint"
                      ? Number(lastReceipt.amount)
                      : lastReceipt.amount
                    ).toLocaleString()}{" "}
                    tCO₂e
                  </dd>
                  {lastReceipt.beneficiary && (
                    <>
                      <dt>Beneficiary</dt>
                      <dd>{lastReceipt.beneficiary}</dd>
                    </>
                  )}
                  {lastReceipt.retirement_reason && (
                    <>
                      <dt>Reason</dt>
                      <dd>{lastReceipt.retirement_reason}</dd>
                    </>
                  )}
                  <dt>Timestamp</dt>
                  <dd>
                    {new Date(
                      (typeof lastReceipt.timestamp === "bigint"
                        ? Number(lastReceipt.timestamp)
                        : lastReceipt.timestamp) * 1000,
                    ).toLocaleString()}
                  </dd>
                </dl>
              </div>
            )}
          </Card>
        </WalletGuard>
      )}

      {tab === "receipts" && (
        <Card>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "0.75rem",
            }}
          >
            <span style={{ fontWeight: 600 }}>
              Retirement Receipts
              {totalCount !== null && (
                <span
                  className="muted"
                  style={{ fontWeight: 400, marginLeft: "0.4rem" }}
                >
                  ({totalCount} total)
                </span>
              )}
            </span>
            <button
              className="btn-ghost"
              style={{ fontSize: "0.8rem" }}
              onClick={() => loadReceipts(page)}
              disabled={receiptsLoading}
            >
              {receiptsLoading ? (
                <>
                  <Spinner />
                  Loading…
                </>
              ) : (
                "Refresh"
              )}
            </button>
          </div>
          {receipts.length === 0 && !receiptsLoading && (
            <p
              className="muted"
              style={{ fontSize: "0.85rem", margin: "1rem 0" }}
            >
              No receipts loaded. Connect your wallet and click Refresh.
            </p>
          )}
          {receipts.map((r, i) => (
            <ReceiptCard
              key={page * PAGE_SIZE + i}
              receipt={r}
              index={page * PAGE_SIZE + i}
              verification={verifications[page * PAGE_SIZE + i]}
              onVerify={handleVerify}
              verifying={verifyingIndex === page * PAGE_SIZE + i}
            />
          ))}
          {totalPages !== null && totalPages > 1 && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: "1rem",
              }}
            >
              <button
                className="btn-ghost"
                onClick={() => loadReceipts(page - 1)}
                disabled={page === 0 || receiptsLoading}
              >
                ← Prev
              </button>
              <span className="muted" style={{ fontSize: "0.85rem" }}>
                Page {page + 1} / {totalPages}
              </span>
              <button
                className="btn-ghost"
                onClick={() => loadReceipts(page + 1)}
                disabled={page >= totalPages - 1 || receiptsLoading}
              >
                Next →
              </button>
            </div>
          )}
        </Card>
      )}

      <EventFeed
        events={events}
        loading={eventsLoading}
        onRefresh={fetchEvents}
        title="Recent Carbon Activity"
        autoRefreshInterval={30000}
      />

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          description={confirm.description}
          onConfirm={() => runConfirmed(confirm.onConfirm)}
          onCancel={() => setConfirm(null)}
          loading={confirmLoading}
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
  receipt: {
    display: "grid",
    gridTemplateColumns: "max-content 1fr",
    gap: "0.25rem 0.75rem",
    fontSize: "0.85rem",
    margin: 0,
  },
  mono: {
    fontFamily: "monospace",
    fontSize: "0.75rem",
    wordBreak: "break-all" as const,
  },
};
