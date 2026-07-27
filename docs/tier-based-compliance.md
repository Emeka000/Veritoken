# Tier-Based Compliance Engine

This guide covers the tier-based policy system in the compliance engine, which lets administrators configure transfer rules based on KYC tiers.

---

## Overview

The KYC registry assigns every holder a numeric **tier** at approval time:

| Tier | Label | Typical use |
|---|---|---|
| `0` | Basic | Retail / individual investors |
| `1` | Accredited | Accredited investors (e.g. SEC Rule 501) |
| `2` | Institutional | Banks, funds, and institutional counterparties |

The compliance engine's tier-based policy system allows administrators to define transfer constraints that depend on the **sender's tier** and the **recipient's tier**.  Tier policies are evaluated in addition to the global `ComplianceRules` — the most restrictive limit always wins.

---

## Policy Model

A `TierPolicy` is keyed by `(from_tier, to_tier)` and contains:

| Field | Type | Description |
|---|---|---|
| `blocked` | `bool` | When `true`, unconditionally block all transfers matching this tier pair |
| `max_transfer_amount` | `i128` | Per-pair transfer cap (`0` = inherit global limit) |
| `min_from_tier` | `u32` | Minimum tier the sender must hold |
| `min_to_tier` | `u32` | Minimum tier the recipient must hold |

### Wildcards

Use `u32::MAX` (`4294967295`) as a wildcard to match **any tier** on either side.

**Resolution order** (most-specific wins):

1. Exact match `(from_tier, to_tier)`
2. Wildcard sender `(MAX, to_tier)`
3. Wildcard recipient `(from_tier, MAX)`
4. Full wildcard `(MAX, MAX)`

---

## Common Policy Patterns

### Block retail → institutional transfers

Prevent basic-KYC holders from sending tokens to institutional accounts:

```bash
stellar contract invoke \
  --source-account "$IDENTITY" --network testnet \
  --id "$CE_ID" -- set_tier_policy \
  --from-tier 0 --to-tier 2 \
  --policy '{
    "blocked": true,
    "max_transfer_amount": 0,
    "min_from_tier": 0,
    "min_to_tier": 0
  }'
```

### Require accredited status for all recipients

Block transfers to any holder below tier 1:

```bash
stellar contract invoke \
  --source-account "$IDENTITY" --network testnet \
  --id "$CE_ID" -- set_tier_policy \
  --from-tier 4294967295 --to-tier 4294967295 \
  --policy '{
    "blocked": false,
    "max_transfer_amount": 0,
    "min_from_tier": 0,
    "min_to_tier": 1
  }'
```

### Higher transfer cap for institutional senders

Allow institutional (tier 2) accounts to transfer up to 10 M tokens, overriding the global cap:

```bash
stellar contract invoke \
  --source-account "$IDENTITY" --network testnet \
  --id "$CE_ID" -- set_tier_policy \
  --from-tier 2 --to-tier 4294967295 \
  --policy '{
    "blocked": false,
    "max_transfer_amount": 100000000000000,
    "min_from_tier": 2,
    "min_to_tier": 0
  }'
```

Note: the global cap remains binding when it is lower than the tier-pair cap.

---

## SDK Usage

### TypeScript SDK

```ts
import { ComplianceEngineClient, createServer, NETWORK_PASSPHRASES } from "@veritoken/sdk";

const server = createServer("testnet");
const ce = new ComplianceEngineClient(ceId, server, NETWORK_PASSPHRASES.testnet);

// Read a policy
const policy = await ce.getTierPolicy(0, 2);
console.log(policy?.blocked); // true if set

// Count all policies
const count = await ce.tierPolicyCount();

// Build XDR to set a policy (admin signs and submits)
const xdr = ce.buildSetTierPolicyXdr(0, 2, {
  blocked: true,
  max_transfer_amount: 0n,
  min_from_tier: 0,
  min_to_tier: 0,
});

// Build XDR to remove a policy
const clearXdr = ce.buildClearTierPolicyXdr(0, 2);
```

### Frontend SDK

```ts
import { contracts } from "../lib/contracts";

// Admin: block basic → institutional
await contracts.compliance.setTierPolicy(
  adminAddress,
  0,   // from_tier: basic
  2,   // to_tier: institutional
  { blocked: true, max_transfer_amount: 0n, min_from_tier: 0, min_to_tier: 0 },
  signTx
);

// Check a policy
const policy = await contracts.compliance.getTierPolicy(0, 2);

// Remove a policy
await contracts.compliance.clearTierPolicy(adminAddress, 0, 2, signTx);
```

---

## Interaction with Global Rules

Tier policies are evaluated **after** all global `ComplianceRules` checks.  The engine evaluates in this order:

1. `paused` — if `true`, all transfers are blocked regardless of tier policies
2. Blocklist check (`from` and `to`)
3. Blocked jurisdictions
4. `require_same_jurisdiction`
5. Global `max_transfer_amount`
6. `min_holding_period`
7. `max_holding_period` (forced-exit window)
8. `max_holders` cap
9. **Tier policy evaluation** (new)
   - Look up the applicable `TierPolicy` by tier pair (with wildcard fallback)
   - Check `blocked`
   - Check `min_from_tier`
   - Check `min_to_tier`
   - Apply `max_transfer_amount` (the stricter of global and per-tier cap)

When **no tier policies** are configured (`tier_policy_count == 0`), no cross-contract KYC tier lookup is performed — the no-policy path adds zero gas overhead.

---

## Updating KYC Tiers

The KYC registry's `update_tier` function lets verifiers upgrade or downgrade a holder's tier without revoking and re-approving:

```bash
stellar contract invoke \
  --source-account "verifier-identity" \
  --network testnet \
  --id "$KYC_ID" -- update_tier \
  --verifier "G...VERIFIER" \
  --subject "G...HOLDER" \
  --new-tier 2
```

The updated tier takes effect on the next transfer — no token contract action is needed.

---

## Operational Runbook

### View all effective policies

```bash
# Count policies
stellar contract invoke --network testnet --id "$CE_ID" -- tier_policy_count

# Read a specific pair (e.g. basic → institutional)
stellar contract invoke --network testnet --id "$CE_ID" -- get_tier_policy \
  --from-tier 0 --to-tier 2
```

### Emergency: remove a restrictive policy

```bash
stellar contract invoke \
  --source-account "$IDENTITY" --network testnet \
  --id "$CE_ID" -- clear_tier_policy \
  --from-tier 0 --to-tier 2
```

### Check if a specific transfer will pass

```bash
stellar contract invoke --network testnet --id "$CE_ID" -- can_transfer \
  --from "G...SENDER" \
  --to "G...RECIPIENT" \
  --amount 1000000000
```

Returns `true` when the transfer passes all global rules and tier policies.
