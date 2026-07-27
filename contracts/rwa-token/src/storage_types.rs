#![allow(unused)]

use soroban_sdk::{contracttype, Address, Env, Symbol};

pub(crate) const DAY_IN_LEDGERS: u32 = 17280;
pub(crate) const INSTANCE_BUMP_AMOUNT: u32 = 7 * DAY_IN_LEDGERS;
pub(crate) const INSTANCE_LIFETIME_THRESHOLD: u32 = INSTANCE_BUMP_AMOUNT - DAY_IN_LEDGERS;
pub(crate) const BALANCE_BUMP_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
pub(crate) const BALANCE_LIFETIME_THRESHOLD: u32 = BALANCE_BUMP_AMOUNT - DAY_IN_LEDGERS;

/// Storage layout for rwa-token.
///
/// STABILITY POLICY (#346)
/// =======================
/// Keys marked [STABLE] must keep their XDR encoding unchanged across upgrades
/// because live ledger entries depend on them.  Keys marked [UNSTABLE] are safe
/// to rename or remove in a future migration — record the change in the
/// migration checklist at docs/storage-layout.md before shipping.
///
/// KEY NAMESPACING CONVENTIONS
/// ---------------------------
/// - Singleton config (instance storage): bare enum variant, e.g. `Admin`.
/// - Per-address data (persistent storage): tuple variant with Address,
///   e.g. `Balance(Address)`.
/// - Compound keys: use a dedicated `#[contracttype]` struct as the payload.
/// - Reserved namespace for future sub-modules: prefix with the module name
///   as a tuple variant, e.g. `ComplianceMeta(Symbol)`.
///
/// TTL HANDLING
/// ------------
/// - Instance keys: bump on every read to `INSTANCE_BUMP_AMOUNT` (7 days).
/// - Persistent keys: bump on write to `BALANCE_BUMP_AMOUNT` (30 days).
/// - Temporary keys: let the Soroban runtime expire them naturally.
///
/// MIGRATION PROTOCOL
/// ------------------
/// Before adding, renaming, or removing any key:
/// 1. Check docs/storage-layout.md for the canonical layout snapshot.
/// 2. Update STABILITY markers and the layout doc in the same PR.
/// 3. If renaming a STABLE key, write a one-time migration function that
///    reads the old key, writes the new key, and removes the old one.
/// 4. Gate the migration behind `migrate()` — never auto-run on every call.
#[contracttype]
pub enum DataKey {
    // ── Core admin (STABLE) ───────────────────────────────────────────────
    Admin,
    PendingAdmin,
    // ── Token supply (STABLE) ─────────────────────────────────────────────
    TotalSupply,
    MaxSupply,
    // ── Token metadata (STABLE) ───────────────────────────────────────────
    Metadata,
    AssetType,
    // ── Cross-contract addresses (STABLE) ─────────────────────────────────
    KycRegistry,
    ComplianceEngine,
    // ── Per-account data (STABLE) ─────────────────────────────────────────
    Balance(Address),
    Allowance(AllowanceKey),
    Frozen(Address),
    // ── Compliance metadata (STABLE) ──────────────────────────────────────
    ComplianceMeta(Symbol),
    // ── Versioning (#342) (STABLE) ────────────────────────────────────────
    ContractSemver,
    MigrationCount,
    Migration(u32),
    // ── Multi-admin recovery (#343) (STABLE) ──────────────────────────────
    RecoveryConfig,
    RecoveryMembers,
    RecoveryThreshold,
    ActiveRecovery,
    // ── Reentrancy guard (#345) (UNSTABLE — ephemeral per-invocation) ──────
    TransferLock,
    // ── Recovery config ──────────────────────────────────────────────────────
    RecoveryConfig,
    // ── Metadata export ───────────────────────────────────────────────────────
    ExternalUri,
}


#[contracttype]
#[derive(Clone)]
pub struct AllowanceKey {
    pub from: Address,
    pub spender: Address,
}

#[contracttype]
#[derive(Clone)]
pub struct AllowanceValue {
    pub amount: i128,
    pub expiration_ledger: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct TokenMetadata {
    pub decimal: u32,
    pub name: soroban_sdk::String,
    pub symbol: soroban_sdk::String,
}

pub fn has_admin(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Admin)
}

/// Canonical export snapshot returned by `get_token_export`.
///
/// All fields that may be unset are `Option<String>`.
/// This struct is the single source of truth for external integrations
/// (block explorers, dashboards, metadata APIs).
#[contracttype]
#[derive(Clone)]
pub struct TokenExportMetadata {
    // ── Core token fields ─────────────────────────────────────────────────────
    pub name: soroban_sdk::String,
    pub symbol: soroban_sdk::String,
    pub decimals: u32,
    pub asset_type: soroban_sdk::String,
    pub total_supply: i128,
    pub max_supply: i128,
    pub contract_version: soroban_sdk::String,
    // ── Linked contract addresses ─────────────────────────────────────────────
    pub kyc_registry: Address,
    pub compliance_engine: Address,
    // ── Compliance / legal metadata ───────────────────────────────────────────
    pub legal_entity: Option<soroban_sdk::String>,
    pub governing_law: Option<soroban_sdk::String>,
    pub isin: Option<soroban_sdk::String>,
    pub prospectus_hash: Option<soroban_sdk::String>,
    /// Optional URI pointing to an off-chain extended metadata document
    /// (e.g. an IPFS JSON-LD object or a REST endpoint).
    pub external_uri: Option<soroban_sdk::String>,
}
