#![cfg_attr(not(test), deny(clippy::unwrap_used))]

use soroban_sdk::{contracttype, Address, Env, String};

use crate::storage_types::{DataKey, INSTANCE_BUMP_AMOUNT, INSTANCE_LIFETIME_THRESHOLD};
use crate::RwaError;

pub fn read_kyc_registry(env: &Env) -> Address {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .get(&DataKey::KycRegistry)
        .expect("kyc registry must be set")
}

pub fn write_kyc_registry(env: &Env, registry: &Address) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .set(&DataKey::KycRegistry, registry);
}

/// Cross-contract call to the KYC registry to verify a holder is approved.
/// Uses the registry's `is_approved` which evaluates both status and expiry.
pub fn require_kyc(env: &Env, addr: &Address) {
    let registry = read_kyc_registry(env);
    let client = KycRegistryClient::new(env, &registry);
    match client.try_is_approved(addr) {
        Ok(Ok(true)) => {}
        Ok(Ok(false)) => soroban_sdk::panic_with_error!(env, RwaError::KycNotApproved),
        Ok(Err(_)) | Err(_) => {
            soroban_sdk::panic_with_error!(env, RwaError::KycRegistryUnavailable)
        }
    }
}

/// Fetches the live KYC state snapshot for `addr` from the linked registry.
///
/// This builds a `KycSyncStatus` directly from the cross-contract `get_record`
/// call, incorporating expiry evaluation relative to the current ledger time.
pub fn fetch_kyc_sync_status(env: &Env, addr: &Address) -> KycSyncStatus {
    let registry = read_kyc_registry(env);
    let client = KycRegistryClient::new(env, &registry);
    let record = client.get_record(addr);
    let now = env.ledger().timestamp();

    // Map the registry's KycStatus to our local mirror enum.
    let status_mirror = match record.status {
        kyc_registry_interface::KycStatus::Approved  => KycStatusMirror::Approved,
        kyc_registry_interface::KycStatus::Revoked   => KycStatusMirror::Revoked,
        kyc_registry_interface::KycStatus::Rejected  => KycStatusMirror::Rejected,
        kyc_registry_interface::KycStatus::Pending   => KycStatusMirror::Pending,
    };

    let is_active = matches!(status_mirror, KycStatusMirror::Approved)
        && (record.expiry == 0 || record.expiry >= now);

    KycSyncStatus {
        status: status_mirror,
        is_active,
        expiry: record.expiry,
        tier: record.tier,
        jurisdiction: record.jurisdiction,
        checked_at: now,
    }
}

// ── KYC status types exposed to the token contract ───────────────────────────

/// Mirror of the KYC registry's `KycStatus` enum for cross-contract use.
/// Defined here so it is part of the token contract's ABI.
#[contracttype]
#[derive(Clone, PartialEq)]
pub enum KycStatusMirror {
    Pending,
    Approved,
    Rejected,
    Revoked,
}

/// Snapshot of an address's live KYC state as seen from the token contract.
///
/// Returned by `check_kyc_status`.  Gives frontends and external tools a
/// single read to determine whether an address can participate in token ops.
///
/// ## Fields
/// - `is_active`: `true` only when `status == Approved` AND not expired
/// - `expiry`: `0` means no expiry; otherwise a Unix timestamp
/// - `checked_at`: Ledger timestamp at the moment of this snapshot
#[contracttype]
#[derive(Clone)]
pub struct KycSyncStatus {
    pub status: KycStatusMirror,
    pub is_active: bool,
    pub expiry: u64,
    pub tier: u32,
    pub jurisdiction: String,
    pub checked_at: u64,
}

// ── Interface to the KYC registry contract ───────────────────────────────────

mod kyc_registry_interface {
    use soroban_sdk::{contractclient, contracttype, Address, String};

    #[contracttype]
    #[derive(Clone)]
    pub struct KycRecord {
        pub status: KycStatus,
        pub verifier: Address,
        pub tier: u32,
        pub expiry: u64,
        pub jurisdiction: String,
    }

    #[contracttype]
    #[derive(Clone)]
    pub enum KycStatus {
        Pending,
        Approved,
        Rejected,
        Revoked,
    }

    #[contractclient(name = "KycRegistryClient")]
    #[allow(dead_code)]
    pub trait KycRegistryInterface {
        fn is_approved(env: soroban_sdk::Env, addr: Address) -> bool;
        fn get_record(env: soroban_sdk::Env, addr: Address) -> KycRecord;
    }
}
use kyc_registry_interface::KycRegistryClient;
