#![no_std]
#![cfg_attr(not(test), deny(clippy::unwrap_used))]

//! Shared helpers used by every Veritoken asset contract.
//!
//! ## Storage key compatibility
//! [`SharedDataKey`] uses unit variant names as XDR discriminants (e.g. `"Admin"`).
//! Existing contracts stored the same data under identically-named local variants,
//! so the encoding is transparent — no on-chain migration is required.

use soroban_sdk::{contracttype, Address, Env, symbol_short};

// ── Shared storage keys ───────────────────────────────────────────────────────

/// Canonical storage keys for state shared across all token contracts.
/// Variant names map 1-to-1 to their XDR symbol encoding; renaming any
/// variant is a breaking on-chain storage change.
#[contracttype]
pub enum SharedDataKey {
    Admin,
    PendingAdmin,
    KycRegistry,
    ComplianceEngine,
}

// ── Compliance rule types ─────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct ComplianceRules {
    pub max_transfer_amount: i128,
    pub min_holding_period: u64,
    pub max_holders: u32,
    pub require_same_jurisdiction: bool,
    pub paused: bool,
    pub allowlist_mode: bool,
    pub max_holding_period: u64,
}

// ── External contract interfaces ──────────────────────────────────────────────

mod kyc_iface {
    use soroban_sdk::{contractclient, Address};
    #[contractclient(name = "KycRegistryClient")]
    #[allow(dead_code)]
    pub trait KycRegistry {
        fn is_approved(env: soroban_sdk::Env, addr: Address) -> bool;
        fn get_tier(env: soroban_sdk::Env, addr: Address) -> u32;
    }
}

mod compliance_iface {
    use soroban_sdk::{contractclient, Address};
    #[contractclient(name = "ComplianceEngineClient")]
    #[allow(dead_code)]
    pub trait ComplianceEngine {
        fn get_rules(env: soroban_sdk::Env) -> super::ComplianceRules;
        fn is_blocklisted(env: soroban_sdk::Env, addr: Address) -> bool;
        fn can_transfer(env: soroban_sdk::Env, from: Address, to: Address, amount: i128) -> bool;
        fn register_holder(env: soroban_sdk::Env, addr: Address);
        fn holder_count(env: soroban_sdk::Env) -> u32;
    }
}

pub use compliance_iface::ComplianceEngineClient;
pub use kyc_iface::KycRegistryClient;

// ── Admin helpers ─────────────────────────────────────────────────────────────

pub fn read_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&SharedDataKey::Admin)
        .expect("admin must be set")
}

pub fn write_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&SharedDataKey::Admin, admin);
}

/// Requires the stored admin to have signed the current transaction.
pub fn require_admin(env: &Env) {
    read_admin(env).require_auth();
}

/// Admin proposes a successor; the successor must call [`accept_admin`] to confirm.
pub fn propose_admin(env: &Env, new_admin: Address) {
    require_admin(env);
    env.storage()
        .instance()
        .set(&SharedDataKey::PendingAdmin, &new_admin);
    env.events().publish((symbol_short!("proposed"),), new_admin);
}

/// Pending admin confirms the handover; replaces the active admin atomically.
pub fn accept_admin(env: &Env) {
    let pending: Address = env
        .storage()
        .instance()
        .get(&SharedDataKey::PendingAdmin)
        .expect("no pending admin");
    pending.require_auth();
    let old_admin = read_admin(env);
    write_admin(env, &pending);
    env.storage().instance().remove(&SharedDataKey::PendingAdmin);
    env.events()
        .publish((symbol_short!("admin_set"),), (old_admin, pending));
}

// ── KYC registry helpers ──────────────────────────────────────────────────────

pub fn read_kyc_registry(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&SharedDataKey::KycRegistry)
        .expect("kyc registry must be set")
}

pub fn write_kyc_registry(env: &Env, registry: &Address) {
    env.storage()
        .instance()
        .set(&SharedDataKey::KycRegistry, registry);
}

/// Admin-only: swap the KYC registry address and emit an event.
pub fn update_kyc_registry(env: &Env, new_registry: Address) {
    require_admin(env);
    write_kyc_registry(env, &new_registry);
    env.events()
        .publish((symbol_short!("upd_kyc"),), new_registry);
}

/// Returns `true` when `addr` has been approved by the KYC registry.
pub fn is_kyc_approved(env: &Env, addr: &Address) -> bool {
    let registry = read_kyc_registry(env);
    KycRegistryClient::new(env, &registry).is_approved(addr)
}

/// Returns the KYC tier of `addr` (0 = unapproved or no tier assigned).
pub fn get_kyc_tier(env: &Env, addr: &Address) -> u32 {
    let registry = read_kyc_registry(env);
    KycRegistryClient::new(env, &registry).get_tier(addr)
}

// ── Compliance engine helpers ─────────────────────────────────────────────────

pub fn read_compliance_engine(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&SharedDataKey::ComplianceEngine)
        .expect("compliance engine must be set")
}

pub fn write_compliance_engine(env: &Env, engine: &Address) {
    env.storage()
        .instance()
        .set(&SharedDataKey::ComplianceEngine, engine);
}

/// Admin-only: swap the compliance engine address and emit an event.
pub fn update_compliance_engine(env: &Env, new_engine: Address) {
    require_admin(env);
    write_compliance_engine(env, &new_engine);
    env.events()
        .publish((symbol_short!("upd_ce"),), new_engine);
}

/// Fetches the active compliance rule set from the engine contract.
pub fn get_compliance_rules(env: &Env) -> ComplianceRules {
    let engine = read_compliance_engine(env);
    ComplianceEngineClient::new(env, &engine).get_rules()
}

/// Returns `true` when the compliance engine has the global pause flag set.
pub fn is_compliance_paused(env: &Env) -> bool {
    get_compliance_rules(env).paused
}

/// Returns `true` when `addr` is on the compliance blocklist.
pub fn is_compliance_blocklisted(env: &Env, addr: &Address) -> bool {
    let engine = read_compliance_engine(env);
    ComplianceEngineClient::new(env, &engine).is_blocklisted(addr)
}

/// Returns `true` when the compliance engine permits a transfer from `from` to `to`.
pub fn can_transfer_compliance(env: &Env, from: &Address, to: &Address, amount: i128) -> bool {
    let engine = read_compliance_engine(env);
    ComplianceEngineClient::new(env, &engine).can_transfer(from, to, &amount)
}

/// Registers `addr` as a token holder in the compliance engine.
pub fn do_register_holder(env: &Env, addr: &Address) {
    let engine = read_compliance_engine(env);
    ComplianceEngineClient::new(env, &engine).register_holder(addr);
}

/// Returns the current holder count from the compliance engine.
pub fn get_compliance_holder_count(env: &Env) -> u32 {
    let engine = read_compliance_engine(env);
    ComplianceEngineClient::new(env, &engine).holder_count()
}

// ── Metadata validation helpers ───────────────────────────────────────────────

/// Returns `true` when `isin` is a structurally valid ISIN:
/// exactly 12 characters — 2 uppercase country-code letters followed by
/// 10 uppercase letters or digits.
pub fn is_valid_isin(isin: &soroban_sdk::String) -> bool {
    if isin.len() != 12 {
        return false;
    }
    let mut buf = [0u8; 12];
    isin.copy_into_slice(&mut buf);
    for b in &buf[..2] {
        if *b < b'A' || *b > b'Z' {
            return false;
        }
    }
    for b in &buf[2..] {
        let is_upper = *b >= b'A' && *b <= b'Z';
        let is_digit = *b >= b'0' && *b <= b'9';
        if !is_upper && !is_digit {
            return false;
        }
    }
    true
}

/// Returns `true` when `hash` is empty (field not provided) or starts with a
/// recognised IPFS CID prefix: `"Qm"` (CIDv0, 46 chars) or `"baf"` (CIDv1, 59+ chars).
pub fn is_valid_ipfs_hash(hash: &soroban_sdk::String) -> bool {
    let len = hash.len();
    if len == 0 {
        return true;
    }
    if len < 46 || len > 128 {
        return false;
    }
    let buf_len = len as usize;
    let mut tmp = [0u8; 128];
    hash.copy_into_slice(&mut tmp[..buf_len]);
    // CIDv0
    if tmp[0] == b'Q' && tmp[1] == b'm' {
        return true;
    }
    // CIDv1
    if tmp[0] == b'b' && tmp[1] == b'a' && tmp[2] == b'f' {
        return true;
    }
    false
}

/// Returns `true` when `name` is a non-empty legal entity name (1–200 chars).
pub fn is_valid_legal_entity(name: &soroban_sdk::String) -> bool {
    let len = name.len();
    len > 0 && len <= 200
}

/// Returns `true` when `law` is a non-empty governing law string (1–100 chars).
pub fn is_valid_governing_law(law: &soroban_sdk::String) -> bool {
    let len = law.len();
    len > 0 && len <= 100
}

/// Returns `true` when `year` is a plausible carbon-credit vintage year (1990–2050).
pub fn is_valid_vintage_year(year: u32) -> bool {
    year >= 1990 && year <= 2050
}

/// Returns `true` when `currency` is a 3-letter ISO 4217 uppercase code.
pub fn is_valid_currency(currency: &soroban_sdk::String) -> bool {
    if currency.len() != 3 {
        return false;
    }
    let mut buf = [0u8; 3];
    currency.copy_into_slice(&mut buf);
    buf.iter().all(|b| *b >= b'A' && *b <= b'Z')
}
