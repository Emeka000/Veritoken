import { useState, useEffect, useCallback } from "react";
import { useWallet } from "../lib/wallet";
import { CONTRACT_IDS, fetchContractEvents } from "../lib/stellar";
import { PageHeader, Card, Field, Icon } from "../components/ui";
import { EventFeed } from "../components/EventFeed";
import { CopyButton } from "../components/CopyButton";
import { SkeletonCard, SkeletonForm } from "../components/SkeletonPatterns";
import { AddressInput } from "../components/AddressInput";
import WalletGuard from "../components/WalletGuard";
import ConfirmDialog from "../components/ConfirmDialog";
import { useToast } from "../lib/toast";
import { contracts } from "../lib/contracts/index";
import { GovernanceLog, recordGovernanceAction } from "../components/GovernanceLog";
import { SessionHistory } from "../components/SessionHistory";
import type { ComplianceRules, ContractEvent } from "../types";

interface RulesFormState {
  max_transfer_amount: string;
  min_holding_period: string;
  max_holders: string;
  require_same_jurisdiction: boolean;
  paused: boolean;
}

const DEFAULT_RULES: RulesFormState = {
  max_transfer_amount: "0",
  min_holding_period: "0",
  max_holders: "0",
  require_same_jurisdiction: false,
  paused: false,
};

// Asset contracts affected by a coordinated pause
const PAUSE_SCOPE = [
  { label: "Compliance Engine", key: "complianceEngine" },
  { label: "RWA Base Token", key: "rwaToken" },
  { label: "Invoice Token", key: "invoiceToken" },
  { label: "Property Token", key: "propertyToken" },
  { label: "Carbon Credit Token", key: "carbonToken" },
] as const;

function formatDelay(seconds: number): string {
  if (seconds === 0) return "0 — immediate activation";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m > 0 ? `${m}m` : ""}`.trim();
  return `${m}m`;
}

function formatCountdown(activateAt: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = activateAt - now;
  if (diff <= 0) return "Ready to activate";
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h remaining`;
  if (h > 0) return `${h}h ${m}m remaining`;
  return `${m}m remaining`;
}

export default function AdminPage() {
  const { address, signTx } = useWallet();
  const { addToast } = useToast();

  const [rules, setRules] = useState<RulesFormState>(DEFAULT_RULES);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [events, setEvents] = useState<ContractEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  // Rule-change delay state (#368)
  const [ruleChangeDelay, setRuleChangeDelay] = useState<number>(0);
  const [pendingRules, setPendingRules] = useState<{ rules: ComplianceRules; activateAt: number } | null>(null);
  const [activateLoading, setActivateLoading] = useState(false);
  const [proposeMode, setProposeMode] = useState(false);

  // Pause state (#369)
  const [isPaused, setIsPaused] = useState(false);
  const [pauseLoading, setPauseLoading] = useState(false);

  // Blocklist state
  const [blocklist, setBlocklist] = useState<string[]>([]);
  const [blocklistCount, setBlocklistCount] = useState(0);
  const [blocklistLoading, setBlocklistLoading] = useState(false);
  const [addAddress, setAddAddress] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [removeLoading, setRemoveLoading] = useState<string | null>(null);

  const fetchRules = useCallback(async () => {
    if (!CONTRACT_IDS.complianceEngine) return;
    setLoading(true);
    setFetchError(null);
    try {
      const decoded = await contracts.compliance.getRules();
      setRules({
        max_transfer_amount: String(decoded.max_transfer_amount ?? 0),
        min_holding_period: String(decoded.min_holding_period ?? 0),
        max_holders: String(decoded.max_holders ?? 0),
        require_same_jurisdiction: Boolean(decoded.require_same_jurisdiction),
        paused: Boolean(decoded.paused),
      });
      setIsPaused(Boolean(decoded.paused));
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to fetch compliance rules.");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchEvents = useCallback(async () => {
    if (!CONTRACT_IDS.complianceEngine) return;
    try {
      const fetched = await fetchContractEvents(CONTRACT_IDS.complianceEngine, 10);
      setEvents(fetched);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!CONTRACT_IDS.complianceEngine) return;
    let cancelled = false;

    fetchRules();

    async function fetchMeta() {
      try {
        const [delay, pending] = await Promise.all([
          contracts.compliance.getRuleChangeDelay(),
          contracts.compliance.getPendingRules(),
        ]);
        if (!cancelled) {
          setRuleChangeDelay(delay);
          setPendingRules(pending);
        }
      } catch {
        // non-fatal
      }
    }

    async function fetchBlocklist() {
      if (!cancelled) setBlocklistLoading(true);
      try {
        const [list, count] = await Promise.all([
          contracts.compliance.getBlocklist(0, 50),
          contracts.compliance.blocklistCount(),
        ]);
        if (!cancelled) {
          setBlocklist(list);
          setBlocklistCount(count);
        }
      } catch {
        // Non-fatal
      } finally {
        if (!cancelled) setBlocklistLoading(false);
      }
    }

    fetchMeta();
    fetchBlocklist();

    setEventsLoading(true);
    fetchEvents().finally(() => {
      if (!cancelled) setEventsLoading(false);
    });

    return () => { cancelled = true; };
  }, [fetchRules, fetchEvents]);

  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    onConfirm: () => void;
  } | null>(null);

  const handleSaveRules = (e: React.FormEvent) => {
    e.preventDefault();
    const actionLabel = proposeMode && ruleChangeDelay > 0 ? "Propose Rule Change" : "Save Rules (Immediate)";
    const delayNote = proposeMode && ruleChangeDelay > 0
      ? ` Rules will enter a ${formatDelay(ruleChangeDelay)} time-lock before activation.`
      : " This bypasses the time-lock and takes effect immediately (admin override).";
    setConfirm({
      title: actionLabel,
      description: `Max transfer: ${rules.max_transfer_amount}, Min holding: ${rules.min_holding_period}s, Max holders: ${rules.max_holders}.${delayNote}`,
      onConfirm: async () => {
        setConfirm(null);
        try {
          const newRules: ComplianceRules = {
            max_transfer_amount: BigInt(rules.max_transfer_amount),
            min_holding_period: BigInt(rules.min_holding_period),
            max_holders: Number(rules.max_holders),
            require_same_jurisdiction: rules.require_same_jurisdiction,
            paused: rules.paused,
            allowlist_mode: false,
            max_holding_period: 0n,
          };
          if (proposeMode && ruleChangeDelay > 0 && address) {
            await contracts.compliance.proposeRules(address, newRules, signTx);
            recordGovernanceAction("rules_updated", address, `Proposed rule change: max transfer ${rules.max_transfer_amount}, min holding ${rules.min_holding_period}s, max holders ${rules.max_holders}.`);
            addToast(`Rule change proposed. Activates in ${formatDelay(ruleChangeDelay)}.`, "info");
            const pending = await contracts.compliance.getPendingRules();
            setPendingRules(pending);
          } else if (address) {
            await contracts.compliance.setRules(address, newRules, signTx);
            recordGovernanceAction("rules_updated", address, `Saved rules: max transfer ${rules.max_transfer_amount}, min holding ${rules.min_holding_period}s, max holders ${rules.max_holders}.`);
            addToast("Compliance rules saved successfully.", "success");
            await fetchRules();
          }
        } catch (err) {
          addToast(err instanceof Error ? err.message : "Failed to save rules.", "error");
        }
      },
    });
  };

  const handleActivateRules = () => {
    setConfirm({
      title: "Activate Pending Rules",
      description: "The time-lock delay has elapsed. Pending rules will now become the active ruleset.",
      onConfirm: async () => {
        setConfirm(null);
        setActivateLoading(true);
        try {
          if (address) await contracts.compliance.activateRules(address, signTx);
          addToast("Pending rules activated successfully.", "success");
          setPendingRules(null);
          await fetchRules();
        } catch (err) {
          addToast(err instanceof Error ? err.message : "Failed to activate rules.", "error");
        } finally {
          setActivateLoading(false);
        }
      },
    });
  };

  const handlePause = () =>
    setConfirm({
      title: "Pause All Transfers",
      description: "This will immediately halt every token transfer across all asset contracts. The pause state is coordinated through the compliance engine — all contracts check it before allowing transfers.",
      onConfirm: async () => {
        setConfirm(null);
        setPauseLoading(true);
        try {
          if (address) {
            await contracts.compliance.pause(address, signTx);
            recordGovernanceAction("pause", address, "All transfers paused across every asset contract.");
          }
          setIsPaused(true);
          addToast("All transfers paused.", "info");
          await fetchRules();
        } catch (err) {
          addToast(err instanceof Error ? err.message : "Failed to pause transfers.", "error");
        } finally {
          setPauseLoading(false);
        }
      },
    });

  const handleUnpause = () =>
    setConfirm({
      title: "Unpause Transfers",
      description: "This will re-enable token transfers across all asset contracts.",
      onConfirm: async () => {
        setConfirm(null);
        setPauseLoading(true);
        try {
          if (address) {
            await contracts.compliance.unpause(address, signTx);
            recordGovernanceAction("unpause", address, "Transfers re-enabled across every asset contract.");
          }
          setIsPaused(false);
          addToast("Transfers unpaused.", "success");
          await fetchRules();
        } catch (err) {
          addToast(err instanceof Error ? err.message : "Failed to unpause transfers.", "error");
        } finally {
          setPauseLoading(false);
        }
      },
    });

  const refreshBlocklist = async () => {
    try {
      const [list, count] = await Promise.all([
        contracts.compliance.getBlocklist(0, 50),
        contracts.compliance.blocklistCount(),
      ]);
      setBlocklist(list);
      setBlocklistCount(count);
    } catch {
      // ignore refresh errors
    }
  };

  const handleAddToBlocklist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addAddress || !address) return;
    setAddLoading(true);
    try {
      await contracts.compliance.addToBlocklist(address, addAddress, signTx);
      recordGovernanceAction("blocklist_add", address, `Added ${addAddress} to blocklist.`);
      setAddAddress("");
      addToast(`${addAddress.slice(0, 8)}… added to blocklist.`, "success");
      await refreshBlocklist();
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to add address.", "error");
    } finally {
      setAddLoading(false);
    }
  };

  const handleRemoveFromBlocklist = async (target: string) => {
    if (!address) return;
    setRemoveLoading(target);
    try {
      await contracts.compliance.removeFromBlocklist(address, target, signTx);
      recordGovernanceAction("blocklist_remove", address, `Removed ${target} from blocklist.`);
      addToast(`${target.slice(0, 8)}… removed from blocklist.`, "success");
      await refreshBlocklist();
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to remove address.", "error");
    } finally {
      setRemoveLoading(null);
    }
  };

  const canActivateNow = pendingRules !== null &&
    Math.floor(Date.now() / 1000) >= pendingRules.activateAt;

  return (
    <div className="form-narrow">
      <PageHeader
        eyebrow="Governance"
        icon={<Icon.admin size={22} />}
        title="Admin Panel"
        description="Configure global compliance rules. Only the contract admin can call these functions."
      />

      {/* #369 — Global pause status banner */}
      {isPaused && (
        <div style={styles.pauseBanner} role="alert">
          <Icon.bolt size={16} style={{ display: "inline", verticalAlign: "-3px", marginRight: 8 }} />
          <strong>All transfers are currently PAUSED</strong> — token movements are blocked across all asset contracts until an admin unpauses.
        </div>
      )}

      {fetchError && (
        <div style={styles.errorBanner} role="alert">
          <strong>Failed to load current rules:</strong> {fetchError}
        </div>
      )}

      {/* #369 — Emergency controls with coordinated scope */}
      <WalletGuard>
        <Card
          title="Emergency Controls"
          subtitle="Pause coordinates across all asset contracts via the compliance engine"
          style={{ marginBottom: "1.25rem" }}
        >
          <div style={{ display: "flex", gap: "1rem", marginBottom: "1.25rem" }}>
            <button
              onClick={handlePause}
              className="btn-danger"
              style={{ flex: 1 }}
              disabled={isPaused || pauseLoading}
            >
              <Icon.bolt size={15} style={{ display: "inline", verticalAlign: "-2px", marginRight: 6 }} />
              {pauseLoading && !isPaused ? "Pausing…" : "Pause All Transfers"}
            </button>
            <button
              onClick={handleUnpause}
              className="btn-success"
              style={{ flex: 1 }}
              disabled={!isPaused || pauseLoading}
            >
              {pauseLoading && isPaused ? "Unpausing…" : "Unpause Transfers"}
            </button>
          </div>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
            Contracts checked by the pause state:
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            {PAUSE_SCOPE.map((c) => (
              <div key={c.key} style={styles.pauseRow}>
                <span style={{
                  ...styles.pauseDot,
                  background: isPaused ? "var(--danger)" : "var(--success)",
                  boxShadow: isPaused ? "0 0 0 3px var(--danger-soft)" : "0 0 0 3px var(--success-soft)",
                }} />
                <span style={{ fontSize: "0.85rem" }}>{c.label}</span>
                <span className="badge" style={{
                  marginLeft: "auto",
                  background: isPaused ? "var(--danger-soft)" : "var(--success-soft)",
                  color: isPaused ? "var(--danger)" : "var(--success)",
                }}>
                  {isPaused ? "Paused" : "Active"}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </WalletGuard>

      {/* #368 — Pending rules panel */}
      {pendingRules && (
        <Card
          title="Pending Rule Change"
          subtitle={formatCountdown(pendingRules.activateAt)}
          style={{ marginBottom: "1.25rem", border: "1px solid var(--warning)", background: "var(--warning-soft)" }}
        >
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
            These rules were proposed and are in the time-lock period. They will replace the current active rules once activated.
          </p>
          <div style={styles.ruleCompare}>
            <div>
              <p style={styles.ruleLabel}>Max Transfer</p>
              <p style={styles.ruleVal}>{String(pendingRules.rules.max_transfer_amount) === "0" ? "Unlimited" : String(pendingRules.rules.max_transfer_amount)}</p>
            </div>
            <div>
              <p style={styles.ruleLabel}>Min Holding Period</p>
              <p style={styles.ruleVal}>{pendingRules.rules.min_holding_period === 0n ? "None" : `${pendingRules.rules.min_holding_period}s`}</p>
            </div>
            <div>
              <p style={styles.ruleLabel}>Max Holders</p>
              <p style={styles.ruleVal}>{pendingRules.rules.max_holders === 0 ? "Unlimited" : String(pendingRules.rules.max_holders)}</p>
            </div>
            <div>
              <p style={styles.ruleLabel}>Same Jurisdiction</p>
              <p style={styles.ruleVal}>{pendingRules.rules.require_same_jurisdiction ? "Required" : "Not required"}</p>
            </div>
          </div>
          {canActivateNow && (
            <WalletGuard>
              <button
                className="btn-block"
                style={{ marginTop: "1rem" }}
                onClick={handleActivateRules}
                disabled={activateLoading}
              >
                {activateLoading ? "Activating…" : "Activate Pending Rules"}
              </button>
            </WalletGuard>
          )}
        </Card>
      )}

      <Card title="Compliance Rules">
        {/* #368 — rule-change delay info + mode toggle */}
        <div style={styles.delayInfo}>
          <span style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>
            Rule-change delay: <strong style={{ color: "var(--text)" }}>{formatDelay(ruleChangeDelay)}</strong>
          </span>
          {ruleChangeDelay > 0 && (
            <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
              <button
                type="button"
                className={!proposeMode ? "btn-accent" : "btn-ghost"}
                style={{ fontSize: "0.75rem", padding: "0.35rem 0.7rem" }}
                onClick={() => setProposeMode(false)}
              >
                Immediate (Override)
              </button>
              <button
                type="button"
                className={proposeMode ? "btn-accent" : "btn-ghost"}
                style={{ fontSize: "0.75rem", padding: "0.35rem 0.7rem" }}
                onClick={() => setProposeMode(true)}
              >
                Propose (Time-lock)
              </button>
            </div>
          )}
        </div>
        {ruleChangeDelay > 0 && (
          <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "1rem", lineHeight: 1.5 }}>
            {proposeMode
              ? `Proposed rules enter a ${formatDelay(ruleChangeDelay)} time-lock before taking effect. Use the Activate button once the delay elapses.`
              : "Immediate save bypasses the time-lock (emergency admin override). Use Propose for normal governance."}
          </p>
        )}
        {loading ? (
          <div aria-label="Loading compliance rules">
            <SkeletonForm fields={5} />
          </div>
        ) : (
          <form onSubmit={handleSaveRules}>
            <Field
              label="Max Transfer Amount (0 = unlimited, in stroops)"
              type="number"
              value={rules.max_transfer_amount}
              onChange={(e) => setRules((r) => ({ ...r, max_transfer_amount: e.target.value }))}
            />
            <Field
              label="Min Holding Period (seconds, 0 = none)"
              type="number"
              value={rules.min_holding_period}
              onChange={(e) => setRules((r) => ({ ...r, min_holding_period: e.target.value }))}
            />
            <Field
              label="Max Holders (0 = unlimited)"
              type="number"
              value={rules.max_holders}
              onChange={(e) => setRules((r) => ({ ...r, max_holders: e.target.value }))}
            />
            <label style={styles.checkboxRow}>
              <input
                type="checkbox"
                style={{ width: "auto" }}
                checked={rules.require_same_jurisdiction}
                onChange={(e) => setRules((r) => ({ ...r, require_same_jurisdiction: e.target.checked }))}
              />
              <span style={{ fontSize: "0.875rem", color: "var(--text)" }}>
                Require same jurisdiction for transfers
              </span>
            </label>
            <WalletGuard>
              <button type="submit" className="btn-block">
                {proposeMode && ruleChangeDelay > 0 ? "Propose Rule Change" : "Save Rules"}
              </button>
            </WalletGuard>
          </form>
        )}
      </Card>

      <Card
        title="Blocklist Management"
        subtitle={`${blocklistCount} address${blocklistCount === 1 ? "" : "es"} blocked`}
        style={{ marginTop: "1.25rem" }}
      >
        {blocklistLoading ? (
          <div aria-label="Loading blocklist">
            <SkeletonCard rows={3} />
          </div>
        ) : (
          <>
            {blocklist.length === 0 ? (
              <p className="muted" style={{ fontSize: "0.875rem", marginBottom: "1.25rem" }}>
                No addresses are currently blocked.
              </p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", marginBottom: "1.25rem" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                    <th style={th}>Address</th>
                    <th style={{ ...th, width: 80, textAlign: "right" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {blocklist.map((addr) => (
                    <tr key={addr} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ ...td, fontFamily: "monospace", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        <span>{addr.slice(0, 8)}…{addr.slice(-8)}</span>
                        <CopyButton text={addr} label="Copy blocked address" style={{ padding: "0.15rem 0.4rem", fontSize: "0.65rem", border: "none" }} />
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>
                        <WalletGuard>
                          <button
                            className="btn-danger"
                            style={{ padding: "0.25rem 0.6rem", fontSize: "0.8rem" }}
                            disabled={removeLoading === addr}
                            onClick={() => handleRemoveFromBlocklist(addr)}
                          >
                            {removeLoading === addr ? "Removing…" : "Remove"}
                          </button>
                        </WalletGuard>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <WalletGuard>
              <form onSubmit={handleAddToBlocklist} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <AddressInput
                  label="Add address to blocklist"
                  value={addAddress}
                  onChange={setAddAddress}
                  placeholder="G… (Stellar address)"
                  required
                />
                <button
                  type="submit"
                  className="btn-danger"
                  disabled={addLoading || !addAddress}
                  style={{ alignSelf: "flex-start" }}
                >
                  {addLoading ? "Adding…" : "Add to Blocklist"}
                </button>
              </form>
            </WalletGuard>
          </>
        )}
      </Card>

      <GovernanceLog />

      <SessionHistory />

      <EventFeed
        events={events}
        loading={eventsLoading}
        onRefresh={fetchEvents}
        title="Recent Compliance Activity"
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

const th: React.CSSProperties = { padding: "0.4rem 0.5rem", fontWeight: 600, color: "var(--muted)" };
const td: React.CSSProperties = { padding: "0.4rem 0.5rem" };

const styles: Record<string, React.CSSProperties> = {
  checkboxRow: { display: "flex", alignItems: "center", gap: "0.6rem", margin: "0.25rem 0 1.1rem", cursor: "pointer" },
  errorBanner: { marginBottom: "1.25rem", padding: "0.85rem 1rem", borderRadius: 10, background: "color-mix(in srgb, #ef4444 12%, transparent)", border: "1px solid color-mix(in srgb, #ef4444 35%, transparent)", color: "#ef4444", fontSize: "0.875rem", lineHeight: 1.5 },
  // #369 pause banner
  pauseBanner: { marginBottom: "1.25rem", padding: "0.85rem 1rem", borderRadius: 10, background: "color-mix(in srgb, #f87171 14%, transparent)", border: "1px solid color-mix(in srgb, #f87171 40%, transparent)", color: "#f87171", fontSize: "0.875rem", lineHeight: 1.5 },
  pauseRow: { display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.45rem 0.5rem", borderRadius: 8, background: "var(--surface-2)" },
  pauseDot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 },
  // #368 delay info bar
  delayInfo: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem", padding: "0.6rem 0.75rem", borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)" },
  // #368 pending rule compare grid
  ruleCompare: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginTop: "0.5rem" },
  ruleLabel: { fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.2rem" },
  ruleVal: { fontSize: "0.9rem", fontWeight: 600 },
};
