/**
 * AI-Assisted Contract State Summary — Issue #438
 *
 * Generates plain-language summaries of contract state snapshots entirely
 * client-side using deterministic rule-based narration. No external API calls
 * are made; all logic runs in the browser.
 */

import type { GlobalSnapshot, HolderSnapshot, PolicySnapshot } from "./readApi";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBigInt(value: bigint, decimals = 7): string {
  if (value === 0n) return "0";
  const divisor = BigInt(10 ** decimals);
  const whole = value / divisor;
  const frac = value % divisor;
  if (frac === 0n) return whole.toLocaleString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toLocaleString()}.${fracStr}`;
}

function tierLabel(tier: number): string {
  return ["Basic (Tier 0)", "Accredited (Tier 1)", "Institutional (Tier 2)"][tier] ?? `Tier ${tier}`;
}

// ── Global snapshot summary ───────────────────────────────────────────────────

export interface StateSummary {
  headline: string;
  status: "healthy" | "warning" | "critical";
  bullets: string[];
  /** ISO timestamp when the summary was generated. */
  generatedAt: string;
}

/**
 * Produce a plain-language summary of the global contract state.
 */
export function summariseGlobalSnapshot(snapshot: GlobalSnapshot): StateSummary {
  const bullets: string[] = [];
  let status: StateSummary["status"] = "healthy";

  // ── Token metadata ──────────────────────────────────────────────────────
  const token = snapshot.rwaToken;
  if (token) {
    const supply = formatBigInt(token.totalSupply);
    const max = formatBigInt(token.maxSupply);
    bullets.push(
      `Token: ${token.name || "—"} (${token.symbol || "—"}) · Asset type: ${token.assetType || "—"}`
    );
    bullets.push(
      max === "0"
        ? `Supply: ${supply} tokens in circulation (no cap set)`
        : `Supply: ${supply} of ${max} tokens minted (${
            token.maxSupply > 0n
              ? Math.round(Number((token.totalSupply * 10000n) / token.maxSupply) / 100) + "% utilised"
              : "—"
          })`
    );
  } else {
    bullets.push("RWA token contract not configured in this environment.");
  }

  // ── Compliance state ────────────────────────────────────────────────────
  const c = snapshot.compliance;

  if (c.paused) {
    status = "critical";
    bullets.push("⛔ All token transfers are currently PAUSED.");
  } else {
    bullets.push("✅ Token transfers are active — no global pause in effect.");
  }

  bullets.push(
    `Compliance engine: ${c.holderCount} registered holder${c.holderCount !== 1 ? "s" : ""}` +
      (c.blocklistCount > 0
        ? ` · ⚠ ${c.blocklistCount} address${c.blocklistCount !== 1 ? "es" : ""} on the blocklist`
        : " · no addresses on the blocklist")
  );

  if (c.rules) {
    const limit = c.rules.max_transfer_amount;
    if (limit > 0n) {
      bullets.push(`Transfer limit: max ${formatBigInt(limit)} per transaction.`);
    } else {
      bullets.push("Transfer limit: none (unlimited transfers permitted).");
    }

    const hold = c.rules.min_holding_period;
    if (hold > 0) {
      const days = Math.floor(hold / 86400);
      const hrs = Math.floor((hold % 86400) / 3600);
      bullets.push(
        `Minimum holding period: ${days > 0 ? `${days}d ` : ""}${hrs > 0 ? `${hrs}h` : ""}`.trim()
      );
    }

    if (c.rules.require_same_jurisdiction) {
      if (status === "healthy") status = "warning";
      bullets.push("⚠ Jurisdiction lock is ON — sender and receiver must share the same jurisdiction.");
    }

    if (c.rules.allowlist_mode) {
      bullets.push("ℹ Allowlist mode is active — only explicitly permitted addresses may transfer.");
    }
  }

  if (c.pendingRules) {
    const eta = new Date(c.pendingRules.activateAt * 1000);
    const now = Date.now();
    const diff = eta.getTime() - now;
    const ready = diff <= 0;
    if (status === "healthy") status = "warning";
    bullets.push(
      ready
        ? "⚠ Pending rule change is ready to activate — review before proceeding."
        : `⚠ Pending rule change scheduled to activate in ${Math.ceil(diff / 3600000)}h (${eta.toLocaleString()}).`
    );
  }

  if (c.riskConfig && c.riskConfig.max_score > 0) {
    bullets.push(
      `Jurisdiction risk scoring: max allowed score ${c.riskConfig.max_score} · default ${c.riskConfig.default_score}.`
    );
  }

  // ── Headline ────────────────────────────────────────────────────────────
  const headline =
    status === "critical"
      ? "Transfers are paused — immediate attention required."
      : status === "warning"
      ? "System is operational with one or more items requiring attention."
      : "All systems operational — no compliance issues detected.";

  return { headline, status, bullets, generatedAt: new Date().toISOString() };
}

/**
 * Produce a plain-language summary for a single holder address.
 */
export function summariseHolderSnapshot(snapshot: HolderSnapshot): StateSummary {
  const bullets: string[] = [];
  let status: StateSummary["status"] = "healthy";

  // KYC
  if (!snapshot.kycRecord) {
    status = "warning";
    bullets.push("No KYC record found for this address on the registry.");
  } else {
    const rec = snapshot.kycRecord;
    const active = snapshot.kycActive;
    if (!active) {
      status = "warning";
      bullets.push(`KYC status: ${rec.status} — transfers are currently blocked for this address.`);
    } else {
      bullets.push(`KYC status: Approved · ${tierLabel(snapshot.kycTier)} · jurisdiction: ${snapshot.kycJurisdiction || "—"}`);
    }

    if (snapshot.kycSyncStatus?.expiry && snapshot.kycSyncStatus.expiry > 0n) {
      const expTs = Number(snapshot.kycSyncStatus.expiry) * 1000;
      const daysLeft = Math.floor((expTs - Date.now()) / 86400000);
      if (daysLeft < 0) {
        status = "critical";
        bullets.push("⛔ KYC has expired — renewals required before transfers resume.");
      } else if (daysLeft <= 30) {
        if (status === "healthy") status = "warning";
        bullets.push(`⚠ KYC expires in ${daysLeft} day${daysLeft !== 1 ? "s" : ""} — renewal recommended.`);
      } else {
        bullets.push(`KYC valid for ${daysLeft} more days.`);
      }
    }
  }

  // Balance
  const bal = formatBigInt(snapshot.rwaBalance);
  bullets.push(`Token balance: ${bal}`);

  if (snapshot.rwaFrozen) {
    status = "critical";
    bullets.push("⛔ This account is frozen — no transfers are possible.");
  }

  const headline =
    status === "critical"
      ? "This holder cannot currently transact — immediate action required."
      : status === "warning"
      ? "Holder is active but has items requiring attention."
      : "Holder is in good standing with active KYC and no restrictions.";

  return { headline, status, bullets, generatedAt: new Date().toISOString() };
}

/**
 * Produce a plain-language summary of the compliance policy matrix.
 */
export function summarisePolicySnapshot(snapshot: PolicySnapshot): StateSummary {
  const bullets: string[] = [];
  let status: StateSummary["status"] = "healthy";

  const blocked = snapshot.tierPolicies.filter((p) => p.policy?.blocked);
  const open = snapshot.tierPolicies.filter((p) => p.policy && !p.policy.blocked);

  if (blocked.length === 0) {
    bullets.push("No tier-pair transfer paths are explicitly blocked.");
  } else {
    status = "warning";
    const pairs = blocked
      .map((p) => `${tierLabel(p.fromTier)} → ${tierLabel(p.toTier)}`)
      .join(", ");
    bullets.push(`⚠ ${blocked.length} blocked transfer path${blocked.length !== 1 ? "s" : ""}: ${pairs}.`);
  }

  if (open.length > 0) {
    bullets.push(`${open.length} transfer path${open.length !== 1 ? "s" : ""} explicitly permitted across tier pairs.`);
  }

  if (snapshot.blockedJurisdictions.length > 0) {
    status = status === "healthy" ? "warning" : status;
    bullets.push(
      `⚠ ${snapshot.blockedJurisdictions.length} jurisdiction${snapshot.blockedJurisdictions.length !== 1 ? "s" : ""} blocked: ${snapshot.blockedJurisdictions.join(", ")}.`
    );
  } else {
    bullets.push("No jurisdictions are currently blocked.");
  }

  if (snapshot.riskConfig && snapshot.riskConfig.max_score > 0) {
    bullets.push(
      `Risk scoring active: max score ${snapshot.riskConfig.max_score}, default ${snapshot.riskConfig.default_score}.`
    );
  } else {
    bullets.push("Jurisdiction risk scoring is disabled.");
  }

  const headline =
    status === "warning"
      ? "Policy matrix has restricted paths — review before onboarding new holders."
      : "Policy matrix is open — all tier pairs are permitted.";

  return { headline, status, bullets, generatedAt: new Date().toISOString() };
}
