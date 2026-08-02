#![cfg_attr(not(test), deny(clippy::unwrap_used))]

//! Granular role-based permission layer (#347).
//!
//! # Roles
//!
//! | Role symbol  | Permitted operations                                      |
//! |--------------|-----------------------------------------------------------|
//! | `governance` | `propose_admin`, `assign_role`, `revoke_role`             |
//! | `compliance` | `freeze`, `unfreeze`, `set_compliance_metadata`           |
//! | `liquidity`  | `mint`                                                    |
//! | `registry`   | `update_kyc_registry`, `update_compliance_engine`        |
//!
//! The contract admin retains the ability to call every operation regardless
//! of role assignments (backward compatibility).  Roles are additive
//! delegations; the admin never loses their own authority.
//!
//! # Storage
//!
//! Each role is stored under `DataKey::RoleAssignment(role_symbol)` in
//! instance storage as an `Address`.  Assigning a role overwrites any prior
//! holder.  Revoking removes the key entirely.

use soroban_sdk::{panic_with_error, Address, Env, Symbol};

use crate::admin::read_admin;
use crate::storage_types::{DataKey, INSTANCE_BUMP_AMOUNT, INSTANCE_LIFETIME_THRESHOLD};
use crate::RwaError;

// ── Role name constants ───────────────────────────────────────────────────────

pub const ROLE_GOVERNANCE: &str = "governance";
pub const ROLE_COMPLIANCE: &str = "compliance";
pub const ROLE_LIQUIDITY: &str = "liquidity";
pub const ROLE_REGISTRY: &str = "registry";

// ── Storage helpers ───────────────────────────────────────────────────────────

/// Returns the current holder of `role`, or `None` if no holder is assigned.
pub fn read_role_holder(env: &Env, role: &Symbol) -> Option<Address> {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .get(&DataKey::RoleAssignment(role.clone()))
}

/// Stores `holder` as the role holder for `role`.
pub fn write_role_holder(env: &Env, role: &Symbol, holder: &Address) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .set(&DataKey::RoleAssignment(role.clone()), holder);
}

/// Removes the role holder for `role`.
pub fn remove_role_holder(env: &Env, role: &Symbol) {
    env.storage()
        .instance()
        .remove(&DataKey::RoleAssignment(role.clone()));
}

// ── Authorization helpers ─────────────────────────────────────────────────────

/// Asserts that `caller` has signed the transaction AND is either the contract
/// admin or the holder of `role`.  Panics with `UnauthorizedRole` otherwise.
///
/// This is the primary guard used by role-protected operations.  The admin
/// always passes regardless of role assignments.
pub fn require_admin_or_role(env: &Env, caller: &Address, role: &Symbol) {
    caller.require_auth();
    let admin = read_admin(env);
    if *caller == admin {
        return;
    }
    match read_role_holder(env, role) {
        Some(holder) if holder == *caller => {}
        _ => panic_with_error!(env, RwaError::UnauthorizedRole),
    }
}
