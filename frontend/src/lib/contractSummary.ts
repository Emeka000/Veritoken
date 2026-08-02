/**
 * contractSummary.ts — #438 AI-Assisted Summary of Contract State
 *
 * Generates plain-language summaries from on-chain snapshots without
 * calling any external AI API. The "AI-assisted" framing refers to
 * structured natural-language generation driven by the live state data.
 */

import type { GlobalSnapshot, HolderSnapshot, PolicySnapshot } from "./readApi";
import type { ComplianceRules } from "../types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: bigint | number, decimals = 7): string {
  const value = typeof n === "bigint" ? Number(n) / 10 ** decimals : n;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

function fmtSeconds(s: number): string {
  if (s === 0) return "none";
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  if (days > 0) return `${days}d ${hours > 0 ? `${hours}h` : ""}`.trim();
  const mins = Math.floor(s / 60);
  if (hours > 0) return `${hours}h ${mins % 60 > 0 ? `${mins % 60}m` : ""}`.trim();
  return `${mins}m`;
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface SummaryLine {
  level: "ok" | "warn" | "critical" | "info";
  text: string;
}

export interface ContractSummary {
  headline: string;
  lines: SummaryLine[];
  generatedAt: string;
}

// ── Generators ────────────────────────────────────────────────────────────────

export function summariseCompliance(rules: ComplianceRules): SummaryLine[] {
  const lines: SummaryLine[] = [];

  if (rules.paused) {
    lines.push({ level: "critical", text: "All transfers are currently PAUSED — no movement is possible." });
  } else {
    lines.push({ level: "ok", text: "Transfers are live and accepting new transactions." });
  }

  if (rules.allowlist_mode) {
    lines.push({ level: "warn", text: "Allowlist mode is active: only explicitly permitted addresses may transact." });
  }

  if (rules.max_holders > 0) {
    lines.push({ level: "info", text: `Holder cap is set to ${rules.max_holders.toLocaleString()} unique addresses.` });
  } else {
    lines.push({ level: "info", text: "No holder cap — unlimited addresses may hold tokens." });
  }

  const maxAmt = Number(rules.max_transfer_amount);
  if (maxAmt > 0) {
    lines.push({ level: "info", text: `Maximum single transfer is limited to ${fmt(rules.max_transfer_amount)} tokens.` });
  } else {
    lines.push({ level: "info", text: "No per-transfer amount ceiling is in place." });
  }

  if (rules.min_holding_period > 0) {
    lines.push({ level: "warn", text: `Tokens must be held for at least ${fmtSeconds(Number(rules.min_holding_period))} before transfer.` });
  }

  if (rules.max_holding_period > 0) {
    lines.push({ level: "warn", text: `Tokens must be transferred within ${fmtSeconds(Number(rules.max_holding_period))} of acquisition.` });
  }

  if (rules.require_same_jurisdiction) {
    lines.push({ level: "warn", text: "Cross-jurisdiction transfers are blocked — both parties must share the same jurisdiction." });
  }

  return lines;
}

export function summariseGlobalSnapshot(snap: GlobalSnapshot): ContractSummary {
  const lines: SummaryLine[] = [];
  const { compliance, rwaToken } = snap;

  // Token overview
  if (rwaToken) {
    const supply = fmt(rwaToken.totalSupply);
    const max = rwaToken.maxSupply > 0n ? ` of ${fmt(rwaToken.maxSupply)} maximum` : "";
    lines.push({ level: "info", text: `${rwaToken.name} (${rwaToken.symbol}) has ${supply} tokens in circulation${max}.` });
    lines.push({ level: "info", text: `Asset type: ${rwaToken.assetType || "unspecified"}.` });
  } else {
    lines.push({ level: "warn", text: "No RWA token contract is configured." });
  }

  // Holder count
  if (compliance.holderCount > 0) {
    lines.push({ level: "info", text: `${compliance.holderCount.toLocaleString()} registered holder${compliance.holderCount !== 1 ? "s" : ""} on the compliance registry.` });
  } else {
    lines.push({ level: "warn", text: "No holders are registered yet." });
  }

  // Blocklist
  if (compliance.blocklistCount > 0) {
    lines.push({ level: "warn", text: `${compliance.blocklistCount} address${compliance.blocklistCount !== 1 ? "es are" : " is"} currently blocklisted.` });
  }

  // Rules summary
  if (compliance.rules) {
    lines.push(...summariseCompliance(compliance.rules));
  }

  // Pending rule change
  if (compliance.pendingRules) {
    const eta = new Date(compliance.pendingRules.activateAt * 1000).toLocaleString();
    lines.push({ level: "warn", text: `A rule change is scheduled and will activate after ${eta}.` });
  }

  // Rule change delay
  if (compliance.ruleChangeDelay > 0) {
    lines.push({ level: "info", text: `Rule changes require a ${fmtSeconds(compliance.ruleChangeDelay)} time-lock before taking effect.` });
  }

  const criticals = lines.filter((l) => l.level === "critical").length;
  const warns = lines.filter((l) => l.level === "warn").length;

  let headline: string;
  if (criticals > 0) {
    headline = "System is paused — immediate attention required.";
  } else if (warns >= 3) {
    headline = "Multiple compliance constraints are active. Review carefully before transacting.";
  } else if (warns > 0) {
    headline = "Transfers are live with some active restrictions in place.";
  } else {
    headline = "All systems nominal — transfers are open with no active restrictions.";
  }

  return { headline, lines, generatedAt: snap.fetchedAt };
}

export function summariseHolder(snap: HolderSnapshot): ContractSummary {
  const lines: SummaryLine[] = [];

  if (!snap.kycRecord) {
    lines.push({ level: "critical", text: "No KYC record found — this address cannot transact." });
  } else {
    const { status, tier, jurisdiction } = snap.kycRecord;
    const expiry = Number(snap.kycRecord.expiry);
    const tierLabel = ["Basic", "Accredited", "Institutional"][tier] ?? `Tier ${tier}`;

    if (status === "Approved" && snap.kycActive) {
      lines.push({ level: "ok", text: `KYC is active at ${tierLabel} level in jurisdiction ${jurisdiction || "unknown"}.` });
    } else if (status === "Approved" && !snap.kycActive) {
      lines.push({ level: "critical", text: `KYC approval has expired — ${tierLabel}, ${jurisdiction}. Renewal required.` });
    } else {
      lines.push({ level: "warn", text: `KYC status is ${status} (${tierLabel}, ${jurisdiction}).` });
    }

    if (expiry > 0) {
      const expiryDate = new Date(expiry * 1000).toLocaleDateString();
      const daysLeft = Math.floor((expiry - Date.now() / 1000) / 86400);
      if (daysLeft < 30 && daysLeft >= 0) {
        lines.push({ level: "warn", text: `KYC expires in ${daysLeft} day${daysLeft !== 1 ? "s" : ""} (${expiryDate}). Renew soon.` });
      } else if (daysLeft < 0) {
        lines.push({ level: "critical", text: `KYC expired on ${expiryDate}.` });
      } else {
        lines.push({ level: "info", text: `KYC valid until ${expiryDate} (${daysLeft} days remaining).` });
      }
    }
  }

  if (snap.rwaFrozen) {
    lines.push({ level: "critical", text: "This address is frozen — transfers are blocked by the admin." });
  }

  lines.push({ level: "info", text: `Token balance: ${fmt(snap.rwaBalance)} tokens.` });

  const criticals = lines.filter((l) => l.level === "critical").length;
  const warns = lines.filter((l) => l.level === "warn").length;

  const headline =
    criticals > 0 ? "This address cannot currently transact." :
    warns > 0 ? "This address can transact with some caveats." :
    "This address is in good standing and may transact freely.";

  return { headline, lines, generatedAt: snap.fetchedAt };
}

export function summarisePolicies(snap: PolicySnapshot): ContractSummary {
  const lines: SummaryLine[] = [];

  if (snap.riskConfig) {
    if (snap.riskConfig.max_score === 0) {
      lines.push({ level: "info", text: "Jurisdiction risk scoring is disabled." });
    } else {
      lines.push({ level: "info", text: `Risk scoring is active — max allowed score is ${snap.riskConfig.max_score}, default is ${snap.riskConfig.default_score}.` });
    }
  }

  if (snap.blockedJurisdictions.length > 0) {
    lines.push({ level: "warn", text: `${snap.blockedJurisdictions.length} jurisdiction${snap.blockedJurisdictions.length !== 1 ? "s are" : " is"} explicitly blocked: ${snap.blockedJurisdictions.join(", ")}.` });
  }

  const blockedPairs = snap.tierPolicies.filter((p) => p.policy?.blocked);
  if (blockedPairs.length > 0) {
    const label = blockedPairs.map((p) => `Tier ${p.fromTier}→${p.toTier}`).join(", ");
    lines.push({ level: "warn", text: `${blockedPairs.length} tier pair${blockedPairs.length !== 1 ? "s are" : " is"} blocked: ${label}.` });
  } else {
    lines.push({ level: "ok", text: "No tier-pair routes are unconditionally blocked." });
  }

  const withLimits = snap.tierPolicies.filter(
    (p) => p.policy && p.policy.max_transfer_amount > 0n,
  );
  if (withLimits.length > 0) {
    lines.push({ level: "info", text: `${withLimits.length} tier pair${withLimits.length !== 1 ? "s have" : " has"} per-route transfer limits applied.` });
  }

  const warns = lines.filter((l) => l.level === "warn").length;
  const headline = warns > 0
    ? `${warns} policy restriction${warns !== 1 ? "s are" : " is"} currently in effect.`
    : "Policy matrix is open — all tier routes are permitted without restriction.";

  return { headline, lines, generatedAt: snap.fetchedAt };
}
