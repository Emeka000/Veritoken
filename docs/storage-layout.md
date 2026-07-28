# Storage Layout Reference

This document is the canonical record of every persistent storage key used
across the Veritoken smart contracts.  It must be updated — in the same PR —
whenever a key is added, renamed, or removed.

---

## Stability policy

| Marker     | Meaning |
|------------|---------|
| **STABLE** | The XDR encoding of this key is fixed.  Live ledger entries depend on it.  Renaming requires a migration function. |
| **UNSTABLE** | The key is safe to rename or remove.  No live entries will be stranded. |

---

## rwa-token

Storage type reference: `contracts/rwa-token/src/storage_types.rs`

All instance-storage keys are bumped to 7 days on every read.
All persistent-storage keys are bumped to 30 days on write.

| Key | Storage tier | Stability | Description |
|-----|-------------|-----------|-------------|
| `Admin` | instance | **STABLE** | Current admin `Address`. |
| `PendingAdmin` | instance | **STABLE** | Proposed admin from `propose_admin`; removed on `accept_admin`. |
| `TotalSupply` | instance | **STABLE** | Running `i128` total of minted tokens minus burned tokens. |
| `MaxSupply` | instance | **STABLE** | Hard cap (`i128`); `0` = unlimited. |
| `Metadata` | instance | **STABLE** | `TokenMetadata` struct: decimal, name, symbol. |
| `AssetType` | instance | **STABLE** | `String` asset class tag (`"invoice"`, `"property"`, `"carbon_credit"`). |
| `KycRegistry` | instance | **STABLE** | `Address` of the deployed KYC registry contract. |
| `ComplianceEngine` | instance | **STABLE** | `Address` of the deployed compliance engine contract. |
| `Balance(Address)` | persistent | **STABLE** | `i128` token balance per holder. |
| `Allowance(AllowanceKey)` | temporary | **STABLE** | `AllowanceValue { amount, expiration_ledger }` per (owner, spender) pair. |
| `Frozen(Address)` | persistent | **STABLE** | `bool` freeze flag per address. |
| `ComplianceMeta(Symbol)` | instance | **STABLE** | Arbitrary compliance string fields keyed by a `Symbol` tag. |
| `ContractSemver` | instance | **STABLE** | Current semver string; updated by `migrate()`. |
| `MigrationCount` | instance | **STABLE** | `u32` monotonic count of completed migrations. |
| `Migration(u32)` | instance | **STABLE** | `MigrationRecord` at the given index; written once, never updated. |
| `RecoveryConfig` | instance | **STABLE** | `RecoveryConfig { members, threshold }`; written by recovery setup. |
| `RecoveryMembers` | instance | **STABLE** | Reserved for multi-admin recovery (#343). |
| `RecoveryThreshold` | instance | **STABLE** | Reserved for multi-admin recovery (#343). |
| `ActiveRecovery` | instance | **STABLE** | Reserved for multi-admin recovery (#343). |
| `TransferLock` | instance | **UNSTABLE** | Ephemeral `bool` reentrancy guard; cleared at the end of every transfer. |
| `AdminNonce` | instance | **STABLE** | `u64` monotonic counter consumed by every nonce-protected admin call (#349). |
| `RoleAssignment(Symbol)` | instance | **STABLE** | `Address` of the role holder for the given role symbol (#347). |

### Registered role symbols

| Symbol string | Role |
|---------------|------|
| `"governance"` | May call `propose_admin`. |
| `"compliance"` | May call `freeze`, `unfreeze`, `set_compliance_metadata`. |
| `"liquidity"` | May call `mint`. |
| `"registry"` | May call `update_kyc_registry`, `update_compliance_engine`. |

---

## kyc-registry

Storage type reference: `contracts/kyc-registry/src/lib.rs` (inline `DataKey`)

| Key | Storage tier | Stability | Description |
|-----|-------------|-----------|-------------|
| `AdminList` | instance | **STABLE** | `Vec<Address>` of current admins. |
| `PendingAdmin` | instance | **STABLE** | Proposed admin for two-step handover. |
| `KycStatus(Address)` | persistent | **STABLE** | `KycRecord` per subject. |
| `VerifierList` | instance | **STABLE** | `Vec<Address>` of authorized verifiers. |
| `VerifierCount` | instance | **STABLE** | `u32` count of all-time registered verifiers. |
| `ExpiryIndex(u32)` | instance | **STABLE** | Expiry index entries for scheduled revocations. |
| `ExpiryIndexCount` | instance | **STABLE** | `u32` count of expiry index entries. |
| `VerifierLog(u32)` | instance | **STABLE** | Audit log entries for verifier actions. |
| `VerifierLogCount` | instance | **STABLE** | `u32` count of verifier log entries. |
| `VerifierSubjects(Address)` | instance | **STABLE** | Per-verifier subject list for bulk-revoke. |
| `LifecycleEntry(HistoryKey)` | persistent | **STABLE** | Immutable `KycTransition` records; never updated. |
| `LifecycleCount(Address)` | persistent | **STABLE** | `u32` count of lifecycle transitions per subject. |

---

## compliance-engine

Storage type reference: `contracts/compliance-engine/src/lib.rs` (inline `DataKey`)

| Key | Storage tier | Stability | Description |
|-----|-------------|-----------|-------------|
| `Admin` | instance | **STABLE** | Current admin `Address`. |
| `PendingAdmin` | instance | **STABLE** | Proposed admin for two-step handover. |
| `KycRegistry` | instance | **STABLE** | Address of the KYC registry contract. |
| `Rules` | instance | **STABLE** | Active `ComplianceRules` struct. |
| `PendingRules` | instance | **STABLE** | Proposed rules awaiting time-lock expiry. |
| `PendingRulesActivateAt` | instance | **STABLE** | Ledger timestamp when pending rules may activate. |
| `RuleChangeDelay` | instance | **STABLE** | Minimum seconds between propose and activate. |
| `Blocklist` | instance | **STABLE** | `Vec<Address>` of blocked addresses. |
| `BlocklistCount` | instance | **STABLE** | `u32` count of blocklist entries. |
| `BlockedJurisdictions` | instance | **STABLE** | `Vec<String>` of blocked ISO-3166 jurisdiction codes. |
| `MaxTransfer` | instance | **STABLE** | `i128` per-transfer cap; `0` = unlimited. |
| `MinHoldingPeriod` | instance | **STABLE** | Minimum hold seconds; `0` = none. |
| `MaxHolders` | instance | **STABLE** | Maximum distinct holders; `0` = unlimited. |
| `HolderCount` | instance | **STABLE** | `u32` count of current token holders. |
| `HolderSince(Address)` | persistent | **STABLE** | Ledger timestamp when an address first received tokens. |
| `Allowlist` | instance | **STABLE** | `Vec<Address>` for allowlist-mode transfers. |

---

## Migration checklist

Before merging any PR that adds, renames, or removes a storage key:

1. **Identify stability** — is the affected key STABLE or UNSTABLE?
2. **Update this document** — add, rename, or remove the row in the table above.
3. **Update the `DataKey` enum** — match the new name in `storage_types.rs`.
4. **Write a migration function** (STABLE keys only) — a one-time function that
   reads the old key, writes the new key, and removes the old one.
5. **Gate behind `migrate()`** — never run migration logic on every contract
   call.  Wire it into the `migrate()` entry point with a version check.
6. **Add a test** — a `test_migrate_*` test that calls the migration function
   and confirms old data is correctly preserved under the new key.
7. **Update TTL handling** if the new key uses a different storage tier
   (instance vs persistent vs temporary).
