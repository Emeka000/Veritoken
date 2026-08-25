#![cfg_attr(not(test), deny(clippy::unwrap_used))]

use soroban_sdk::{Address, Env};

use crate::storage_types::{DataKey, INSTANCE_BUMP_AMOUNT, INSTANCE_LIFETIME_THRESHOLD};
use crate::RwaError;

pub fn read_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    match env.storage().instance().get(&DataKey::Admin) {
        Some(addr) => addr,
        None => soroban_sdk::panic_with_error!(env, RwaError::NotInitialized),
    }
}

pub fn write_admin(env: &Env, admin: &Address) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn read_pending_admin(env: &Env) -> Option<Address> {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage().instance().get(&DataKey::PendingAdmin)
}

pub fn write_pending_admin(env: &Env, pending_admin: &Address) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .set(&DataKey::PendingAdmin, pending_admin);
}

pub fn remove_pending_admin(env: &Env) {
    env.storage().instance().remove(&DataKey::PendingAdmin);
}

// ── Admin nonce (#349) ────────────────────────────────────────────────────────

/// Returns the current admin operation nonce.  Starts at 0; incremented by
/// every nonce-protected admin call so that repeated submissions are rejected.
pub fn read_admin_nonce(env: &Env) -> u64 {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .get(&DataKey::AdminNonce)
        .unwrap_or(0)
}

/// Validates that `nonce` matches the stored nonce, then atomically increments
/// the counter.  Panics with `InvalidNonce` on mismatch.
pub fn consume_nonce(env: &Env, nonce: u64) {
    let current = read_admin_nonce(env);
    if nonce != current {
        soroban_sdk::panic_with_error!(env, RwaError::InvalidNonce);
    }
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .set(&DataKey::AdminNonce, &(current + 1));
}
