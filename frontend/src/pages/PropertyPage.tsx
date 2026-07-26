import { useState, useEffect, useCallback } from "react";
import { useWallet } from "../lib/wallet";
import { contracts } from "../lib/contracts/index";
import { CONTRACT_IDS, fetchContractEvents } from "../lib/stellar";
import { useAmountValidation } from "../lib/validation";
import { PageHeader, Card, Field, Icon, Skeleton } from "../components/ui";
import WalletGuard from "../components/WalletGuard";
import ConfirmDialog from "../components/ConfirmDialog";
import { useToast } from "../lib/toast";
import type { PropertyMeta, ContractEvent } from "../types";

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

const KYC_TIER_LABELS: Record<number, string> = {
  0: "Basic",
  1: "Accredited",
  2: "Institutional",
};

export default function PropertyPage() {
  const { connected, address, signTx } = useWallet();
  const { addToast } = useToast();

  const [tab, setTab] = useState<"mint" | "dividends">("mint");

  // ── On-chain state ───────────────────────────────────────────────────────
  const [meta, setMeta] = useState<PropertyMeta | null>(null);
  const [totalShares, setTotalShares] = useState<bigint | null>(null);
  const [pendingDiv, setPendingDiv] = useState<bigint | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);

  // ── Mint form ────────────────────────────────────────────────────────────
  const [mintTo, setMintTo] = useState("");
  const [mintShares, setMintShares] = useState("");
  const [mintLoading, setMintLoading] = useState(false);

  // ── Deposit dividend form ────────────────────────────────────────────────
  const [depositAmount, setDepositAmount] = useState("");
  const [depositLoading, setDepositLoading] = useState(false);

  // ── Claim dividend ───────────────────────────────────────────────────────
  const [claimLoading, setClaimLoading] = useState(false);

  // ── Confirm dialog ────────────────────────────────────────────────────────
  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    onConfirm: () => void;
  } | null>(null);

  // ── Events ───────────────────────────────────────────────────────────────
  const [events, setEvents] = useState<ContractEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [_holderCount, setHolderCount] = useState<number | null>(null);
  const [_holderSlotsRemaining, setHolderSlotsRemaining] = useState<number | null>(null);

  // Validations
  const mintSharesValidation = useAmountValidation(mintShares);
  const depositValidation = useAmountValidation(depositAmount);

  // ── Load on-chain metadata ───────────────────────────────────────────────
  const loadMeta = useCallback(async () => {
    if (!CONTRACT_IDS.propertyToken) return;
    setMetaLoading(true);
    setMetaError(null);
    try {
      const [fetchedMeta, shares] = await Promise.all([
        contracts.property.getMeta(),
        contracts.property.totalShares(),
      ]);
      setMeta(fetchedMeta);
      setTotalShares(shares);
    } catch (err) {
      setMetaError(
        err instanceof Error ? err.message : "Failed to load property metadata.",
      );
    } finally {
      setMetaLoading(false);
    }
  }, []);

  // ── Load pending dividend for connected wallet ───────────────────────────
  const loadPendingDividend = useCallback(async () => {
    if (!connected || !address || !CONTRACT_IDS.propertyToken) return;
    try {
      const pending = await contracts.property.pendingDividend(address);
      setPendingDiv(pending);
    } catch {
      // Non-fatal — the wallet may not be a holder yet
      setPendingDiv(BigInt(0));
    }
  }, [connected, address]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    loadPendingDividend();
  }, [loadPendingDividend]);

  useEffect(() => {
    if (!CONTRACT_IDS.propertyToken) return;
    setEventsLoading(true);
    fetchContractEvents(CONTRACT_IDS.propertyToken, 10)
      .then(setEvents)
      .catch(() => {})
      .finally(() => setEventsLoading(false));

    Promise.all([
      contracts.property.holderCount(),
      contracts.property.holderSlotsRemaining(),
    ])
      .then(([count, slots]) => {
        setHolderCount(count);
        setHolderSlotsRemaining(slots);
      })
      .catch(() => {});
  }, []);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleMint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected || !address) return;
    if (!mintSharesValidation.isValid) {
      addToast(mintSharesValidation.error || "Invalid share count", "error");
      return;
    }
    setMintLoading(true);
    try {
      await contracts.property.mint(
        address,
        mintTo || address,
        BigInt(mintShares),
        signTx,
      );
      addToast("Shares minted successfully.", "success");
      setMintShares("");
      setMintTo("");
      await loadMeta();
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setMintLoading(false);
    }
  };

  const handleDepositDividend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected || !address) return;
    if (!depositValidation.isValid) {
      addToast(depositValidation.error || "Invalid amount", "error");
      return;
    }
    setDepositLoading(true);
    try {
      await contracts.property.depositDividend(
        address,
        BigInt(depositAmount),
        signTx,
      );
      addToast("Dividend deposited successfully.", "success");
      setDepositAmount("");
      await loadPendingDividend();
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setDepositLoading(false);
    }
  };

  const handleClaimDividend = async () => {
    if (!connected || !address) return;
    setClaimLoading(true);
    try {
      const claimed = await contracts.property.claimDividend(address, signTx);
      addToast(
        `Dividend claimed: ${Number(claimed).toLocaleString()} stroops.`,
        "success",
      );
      setPendingDiv(BigInt(0));
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setClaimLoading(false);
    }
  };

  const hasMintSharesError =
    mintShares.length > 0 && !mintSharesValidation.isValid;
  const hasDepositError =
    depositAmount.length > 0 && !depositValidation.isValid;

  return (
    <div className="form-narrow">
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <PageHeader
        eyebrow="Asset Module"
        icon={<Icon.property size={22} />}
        title="Property Token"
        description="Fractionalize real estate. Each share equals one unit of ownership, and dividends distribute pro-rata on-chain."
      />

      {/* ── Metadata panel ─────────────────────────────────────────────── */}
      <Card title="Property Metadata" style={{ marginBottom: "1.25rem" }}>
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
          <dl style={styles.dl}>
            <dt style={styles.dt}>Property ID</dt>
            <dd style={styles.dd}>{meta.property_id}</dd>

            <dt style={styles.dt}>Legal Name</dt>
            <dd style={styles.dd}>{meta.legal_name}</dd>

            <dt style={styles.dt}>Jurisdiction</dt>
            <dd style={styles.dd}>{meta.jurisdiction}</dd>

            <dt style={styles.dt}>Physical Address</dt>
            <dd style={styles.dd}>{meta.address}</dd>

            <dt style={styles.dt}>Total Valuation</dt>
            <dd style={styles.dd}>
              ${Number(meta.total_valuation_usd).toLocaleString()} USD
            </dd>

            <dt style={styles.dt}>Total Shares</dt>
            <dd style={styles.dd}>
              {totalShares !== null
                ? Number(totalShares).toLocaleString()
                : Number(meta.total_shares).toLocaleString()}
            </dd>

            <dt style={styles.dt}>Property Type</dt>
            <dd style={{ ...styles.dd, textTransform: "capitalize" }}>
              {meta.property_type}
            </dd>

            <dt style={styles.dt}>Required KYC Tier</dt>
            <dd style={styles.dd}>
              {meta.kyc_tier_required} —{" "}
              {KYC_TIER_LABELS[meta.kyc_tier_required] ?? "Unknown"}
            </dd>

            {meta.ipfs_title_hash && (
              <>
                <dt style={styles.dt}>IPFS Title Hash</dt>
                <dd style={{ ...styles.dd, fontFamily: "monospace", fontSize: "0.78rem", wordBreak: "break-all" }}>
                  {meta.ipfs_title_hash}
                </dd>
              </>
            )}
          </dl>
        ) : (
          <p className="muted" style={{ fontSize: "0.875rem" }}>
            No contract deployed or contract ID not configured.
          </p>
        )}
      </Card>

      {/* ── Pending dividend panel ──────────────────────────────────────── */}
      {connected && address && (
        <Card title="Your Pending Dividend" style={{ marginBottom: "1.25rem" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "1rem",
            }}
          >
            <div>
              {pendingDiv === null ? (
                <Skeleton height="1.5rem" width="120px" />
              ) : (
                <span style={{ fontSize: "1.35rem", fontWeight: 700 }}>
                  {Number(pendingDiv).toLocaleString()}{" "}
                  <span className="muted" style={{ fontSize: "0.85rem", fontWeight: 400 }}>
                    stroops
                  </span>
                </span>
              )}
              <p className="muted" style={{ fontSize: "0.78rem", marginTop: "0.2rem" }}>
                Unclaimed dividend accrued for your share balance.
              </p>
            </div>
            <button
              className="btn-ghost"
              onClick={handleClaimDividend}
              disabled={
                claimLoading || pendingDiv === null || pendingDiv === BigInt(0)
              }
              style={{ flexShrink: 0 }}
            >
              {claimLoading && <Spinner />}
              {claimLoading ? "Claiming…" : "Claim Dividend"}
            </button>
          </div>
        </Card>
      )}

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <div style={styles.tabs}>
        <button
          onClick={() => setTab("mint")}
          className={tab === "mint" ? "" : "btn-ghost"}
          style={styles.tab}
        >
          Mint Shares
        </button>
        <button
          onClick={() => setTab("dividends")}
          className={tab === "dividends" ? "" : "btn-ghost"}
          style={styles.tab}
        >
          Deposit Dividend
        </button>
      </div>

      {/* ── Mint tab ───────────────────────────────────────────────────── */}
      {tab === "mint" && (
        <WalletGuard>
          <Card>
            <form onSubmit={handleMint}>
              <Field
                label="Recipient Address"
                value={mintTo}
                onChange={(e) => setMintTo(e.target.value)}
                placeholder={address ?? "G…"}
              />
              <Field
                label="Shares to Mint"
                type="number"
                value={mintShares}
                onChange={(e) => setMintShares(e.target.value)}
                required
                error={mintSharesValidation.error}
              />
              <button
                type="submit"
                className="btn-block"
                style={{ marginTop: "0.75rem" }}
                disabled={mintLoading || hasMintSharesError}
              >
                {mintLoading && <Spinner />}
                {mintLoading ? "Minting…" : "Mint Shares"}
              </button>
            </form>
          </Card>
        </WalletGuard>
      )}

      {/* ── Deposit dividend tab ───────────────────────────────────────── */}
      {tab === "dividends" && (
        <WalletGuard>
          <Card>
            <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "1rem" }}>
              Deposit a dividend amount in stroops. It will be distributed
              pro-rata to all current shareholders based on their share balance.
            </p>
            <form onSubmit={handleDepositDividend}>
              <Field
                label="Dividend Amount (stroops)"
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                required
                error={depositValidation.error}
              />
              <button
                type="submit"
                className="btn-block"
                style={{ marginTop: "0.75rem" }}
                disabled={depositLoading || hasDepositError}
              >
                {depositLoading && <Spinner />}
                {depositLoading ? "Depositing…" : "Deposit Dividend"}
              </button>
            </form>
          </Card>
        </WalletGuard>
      )}

      <RecentTransactions events={events} loading={eventsLoading} />

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

function RecentTransactions({
  events,
  loading,
}: {
  events: ContractEvent[];
  loading: boolean;
}) {
  return (
    <Card title="Recent Transactions" style={{ marginTop: "1.25rem" }}>
      {loading ? (
        <p className="muted" style={{ fontSize: "0.875rem" }}>
          Loading…
        </p>
      ) : events.length === 0 ? (
        <p className="muted" style={{ fontSize: "0.875rem" }}>
          No recent events found.
        </p>
      ) : (
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "0.82rem",
          }}
        >
          <thead>
            <tr
              style={{
                borderBottom: "1px solid var(--border)",
                textAlign: "left",
              }}
            >
              <th style={th}>Type</th>
              <th style={th}>Amount</th>
              <th style={th}>Counterparty</th>
              <th style={th}>Time</th>
            </tr>
          </thead>
          <tbody>
            {events.map((ev, i) => (
              <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={td}>{ev.type}</td>
                <td style={td}>{ev.amount}</td>
                <td
                  style={{
                    ...td,
                    fontFamily: "monospace",
                    maxWidth: 140,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {ev.counterparty}
                </td>
                <td style={td}>{ev.timestamp}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

const th: React.CSSProperties = {
  padding: "0.4rem 0.5rem",
  fontWeight: 600,
  color: "var(--muted)",
};
const td: React.CSSProperties = { padding: "0.4rem 0.5rem" };

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
