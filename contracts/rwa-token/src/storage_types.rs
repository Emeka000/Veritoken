#![allow(unused)]

use soroban_sdk::{contracttype, Address, Env, Symbol};

pub(crate) const DAY_IN_LEDGERS: u32 = 17280;
pub(crate) const INSTANCE_BUMP_AMOUNT: u32 = 7 * DAY_IN_LEDGERS;
pub(crate) const INSTANCE_LIFETIME_THRESHOLD: u32 = INSTANCE_BUMP_AMOUNT - DAY_IN_LEDGERS;
pub(crate) const BALANCE_BUMP_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
pub(crate) const BALANCE_LIFETIME_THRESHOLD: u32 = BALANCE_BUMP_AMOUNT - DAY_IN_LEDGERS;

#[contracttype]
pub enum DataKey {
    Admin,
    PendingAdmin,
    TotalSupply,
    MaxSupply,
    Metadata,
    AssetType,
    KycRegistry,
    ComplianceEngine,
    Balance(Address),
    Allowance(AllowanceKey),
    ComplianceMeta(Symbol),
    Frozen(Address),
    // ── Versioning (#342) ────────────────────────────────────────────────────
    ContractSemver,
    MigrationCount,
    Migration(u32),
    // ── Multi-admin recovery (#343) ──────────────────────────────────────────
    RecoveryMembers,
    RecoveryThreshold,
    ActiveRecovery,
    // ── Reentrancy guard (#345) ──────────────────────────────────────────────
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
