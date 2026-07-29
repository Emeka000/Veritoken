#![no_std]
#![cfg_attr(not(test), deny(clippy::unwrap_used))]

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, panic_with_error, symbol_short,
    Address, Env, String, Vec,
};

// Version tag stored on every lifecycle transition so readers can detect
// schema changes across contract upgrades.
const LIFECYCLE_MODEL_VERSION: u32 = 1;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum KycError {
    AlreadyInitialized = 1,
    NotVerifier = 2,
    NotApproved = 3,
    NoRecord = 4,
    InvalidJurisdiction = 5,
    NotAdmin = 6,
    EmptyAdminList = 7,
    /// Caller is neither the subject nor an admin.
    NotAuthorized = 8,
    /// Migration target version equals the current schema version.
    AlreadyAtSchemaVersion = 9,
    /// Migration must increment schema version by exactly one.
    MigrationVersionNotSequential = 10,
}

/// Composite key for per-subject lifecycle history entries.
/// Stored as a `contracttype` struct so it serialises deterministically
/// as part of a `DataKey` enum variant.
#[contracttype]
#[derive(Clone)]
pub struct HistoryKey {
    pub subject: Address,
    pub seq: u32,
}

#[contracttype]
pub enum DataKey {
    AdminList,
    PendingAdmin,
    KycStatus(Address),
    VerifierList,
    VerifierCount,
    ExpiryIndex(u32),
    ExpiryIndexCount,
    VerifierLog(u32),
    VerifierLogCount,
    /// Subject address list per verifier, used by bulk-revoke and paged queries.
    VerifierSubjects(Address),
    /// A single lifecycle transition for a subject, keyed by (subject, seq).
    LifecycleEntry(HistoryKey),
    /// Monotonically increasing count of transitions recorded for a subject.
    LifecycleCount(Address),
    // ── Storage versioning ────────────────────────────────────────────────────
    /// Current schema version number.  Set to 1 on initialize; incremented by
    /// each successful `migrate_schema` call.  Missing = legacy pre-versioned
    /// deployment (treated as version 0 inside `migrate_schema`).
    StorageVersion,
    /// How many migrations have been applied (length of the migration log).
    MigrationCount,
    /// Indexed migration history; key is the zero-based migration index.
    Migration(u32),
}

/// On-chain record of a single admin-initiated schema migration.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct KycMigrationRecord {
    pub from_version: u32,
    pub to_version: u32,
    pub timestamp: u64,
    pub description: String,
}

// ── Lifecycle model ───────────────────────────────────────────────────────────

/// What kind of state change produced a lifecycle transition.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum KycTransitionKind {
    Approve,
    Reject,
    Revoke,
    TierUpdate,
}

/// An immutable, versioned record of a single KYC state change.
///
/// Every field is a snapshot captured at the moment of the transition, so
/// the full state at any point in history can be reconstructed by replaying
/// the sequence forward from seq 0.
#[contracttype]
#[derive(Clone)]
pub struct KycTransition {
    /// 0-based sequence number scoped to a single subject.
    pub seq: u32,
    /// Lifecycle model version; currently always `1`.
    pub model_version: u32,
    pub kind: KycTransitionKind,
    pub verifier: Address,
    pub timestamp: u64,
    /// Tier snapshot at this point in the lifecycle.
    pub tier: u32,
    /// Expiry snapshot (0 = no expiry).
    pub expiry: u64,
    /// ISO-3166-1 alpha-2 jurisdiction snapshot.
    pub jurisdiction: String,
}

// ── Supporting storage types ──────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct VerifierLogEntry {
    pub verifier: Address,
    pub subject: Address,
    pub action: String,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct ExpiryEntry {
    pub expiry: u64,
    pub addr: Address,
}

#[contracttype]
#[derive(Clone)]
pub struct ExpiringRecord {
    pub addr: Address,
    pub record: KycRecord,
}

/// A complete, structured snapshot of all on-chain data held about a single
/// address. Intended for GDPR / CCPA subject-access requests and regulatory
/// data-export requirements.
///
/// Fields:
/// - `record`      — the current canonical KYC record for the subject.
/// - `log_entries` — every verifier-log entry whose `subject` field matches
///                   the requested address, in ascending log-index order.
/// - `registry`    — the contract's own address, so the caller can anchor the
///                   export to a specific on-chain registry instance.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct KycFullRecord {
    pub record: KycRecord,
    pub log_entries: Vec<VerifierLogEntry>,
    pub registry: Address,
}

/// Resolved KYC state for an address, distinguishing all non-approved cases.
///
/// Returned by [`KycRegistry::get_kyc_state`] — never panics regardless of
/// whether a record exists.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum KycState {
    /// No record exists for this address.
    Missing,
    /// Record exists, status = Approved, and the expiry has not passed.
    Approved,
    /// Record exists, status = Approved, but the expiry timestamp has passed.
    Expired,
    /// Record exists, status = Revoked.
    Revoked,
    /// Record exists, status = Rejected.
    Rejected,
    /// Record exists, status = Pending (not yet reviewed).
    Pending,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum KycStatus {
    Pending,
    Approved,
    Rejected,
    Revoked,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct KycRecord {
    pub status: KycStatus,
    pub verifier: Address,
    pub tier: u32,   // 0=basic, 1=accredited, 2=institutional
    pub expiry: u64, // ledger timestamp; 0 = no expiry
    pub jurisdiction: String,
}

// ── TTL constants ─────────────────────────────────────────────────────────────

const DAY_IN_LEDGERS: u32 = 17280;
const BUMP: u32 = 30 * DAY_IN_LEDGERS;
const THRESHOLD: u32 = BUMP - DAY_IN_LEDGERS;

// ─────────────────────────────────────────────────────────────────────────────

#[contract]
pub struct KycRegistry;

#[contractimpl]
impl KycRegistry {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::AdminList) {
            panic_with_error!(env, KycError::AlreadyInitialized);
        }
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let mut list: Vec<Address> = Vec::new(&env);
        list.push_back(admin);
        env.storage().instance().set(&DataKey::AdminList, &list);
        // Set the initial schema version so new deployments start at v1.
        env.storage().instance().set(&DataKey::StorageVersion, &1u32);
        env.storage().instance().set(&DataKey::MigrationCount, &0u32);
    }

    // ── Admin management ─────────────────────────────────────────────────────

    /// Propose a new admin (two-step handover). Requires existing admin auth.
    pub fn propose_admin(env: Env, caller: Address, new_admin: Address) {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        caller.require_auth();
        Self::require_admin(&env, &caller);
        env.storage().instance().set(&DataKey::PendingAdmin, &new_admin);
        env.events().publish((symbol_short!("proposed"),), new_admin);
    }

    /// The pending admin accepts and is added to the AdminList.
    pub fn accept_admin(env: Env) {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let pending: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .expect("no pending admin");
        pending.require_auth();
        let mut list = Self::admin_list(&env);
        if !list.contains(&pending) {
            list.push_back(pending.clone());
            env.storage().instance().set(&DataKey::AdminList, &list);
        }
        env.storage().instance().remove(&DataKey::PendingAdmin);
        env.events().publish((symbol_short!("admin_add"),), pending);
    }

    /// Immediately add a new admin. Requires existing admin auth.
    pub fn add_admin(env: Env, caller: Address, new_admin: Address) {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        caller.require_auth();
        Self::require_admin(&env, &caller);
        let mut list = Self::admin_list(&env);
        if !list.contains(&new_admin) {
            list.push_back(new_admin.clone());
            env.storage().instance().set(&DataKey::AdminList, &list);
        }
        env.events().publish((symbol_short!("admin_add"),), new_admin);
    }

    /// Remove an admin from the list. Panics if it would leave the list empty.
    pub fn remove_admin(env: Env, caller: Address, admin_to_remove: Address) {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        caller.require_auth();
        Self::require_admin(&env, &caller);
        let list = Self::admin_list(&env);
        if list.len() <= 1 {
            panic_with_error!(env, KycError::EmptyAdminList);
        }
        let mut new_list: Vec<Address> = Vec::new(&env);
        for a in list.iter() {
            if a != admin_to_remove {
                new_list.push_back(a);
            }
        }
        env.storage().instance().set(&DataKey::AdminList, &new_list);
        env.events()
            .publish((symbol_short!("admin_rem"),), admin_to_remove);
    }

    /// Returns the list of current admins.
    pub fn get_admins(env: Env) -> Vec<Address> {
        Self::admin_list(&env)
    }

    // ── Verifier management ──────────────────────────────────────────────────

    pub fn add_verifier(env: Env, caller: Address, verifier: Address) {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        caller.require_auth();
        Self::require_admin(&env, &caller);
        let mut list = Self::verifier_list(&env);
        if !list.contains(&verifier) {
            list.push_back(verifier.clone());
            env.storage().instance().set(&DataKey::VerifierList, &list);
            let count: u32 = env
                .storage()
                .instance()
                .get(&DataKey::VerifierCount)
                .unwrap_or(0);
            env.storage()
                .instance()
                .set(&DataKey::VerifierCount, &(count + 1));
        } else {
            env.storage().instance().set(&DataKey::VerifierList, &list);
        }
        env.events().publish((symbol_short!("add_vrf"),), verifier);
    }

    pub fn remove_verifier(env: Env, caller: Address, verifier: Address) {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        caller.require_auth();
        Self::require_admin(&env, &caller);
        let list = Self::verifier_list(&env);
        let mut new_list: Vec<Address> = Vec::new(&env);
        let mut removed = false;
        for v in list.iter() {
            if v != verifier {
                new_list.push_back(v);
            } else {
                removed = true;
            }
        }
        env.storage()
            .instance()
            .set(&DataKey::VerifierList, &new_list);
        if removed {
            let count: u32 = env
                .storage()
                .instance()
                .get(&DataKey::VerifierCount)
                .unwrap_or(0);
            let new_count = if count > 0 { count - 1 } else { 0 };
            env.storage()
                .instance()
                .set(&DataKey::VerifierCount, &new_count);
        }
    }

    /// Returns the total number of registered verifiers.
    pub fn verifier_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::VerifierCount)
            .unwrap_or(0)
    }

    /// Returns the full verifier list.
    pub fn verifier_list_pub(env: Env) -> Vec<Address> {
        Self::verifier_list(&env)
    }

    /// Paged verifier query. `start` is a zero-based offset; `limit` is capped at 20.
    pub fn get_verifiers(env: Env, start: u32, limit: u32) -> Vec<Address> {
        let cap: u32 = 20;
        let effective_limit = if limit > cap { cap } else { limit };
        let list = Self::verifier_list(&env);
        let total = list.len();
        let mut result: Vec<Address> = Vec::new(&env);
        if start >= total {
            return result;
        }
        let end = (start + effective_limit).min(total);
        for i in start..end {
            result.push_back(list.get(i).unwrap());
        }
        result
    }

    // ── KYC operations ───────────────────────────────────────────────────────

    pub fn approve(
        env: Env,
        verifier: Address,
        subject: Address,
        tier: u32,
        expiry: u64,
        jurisdiction: String,
    ) {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        verifier.require_auth();
        Self::require_verifier(&env, &verifier);
        Self::validate_jurisdiction(&env, &jurisdiction);
        Self::record_transition(
            &env,
            &subject,
            KycTransitionKind::Approve,
            &verifier,
            tier,
            expiry,
            jurisdiction.clone(),
        );
        let record = KycRecord {
            status: KycStatus::Approved,
            verifier: verifier.clone(),
            tier,
            expiry,
            jurisdiction,
        };
        Self::write_record(&env, subject.clone(), record);
        Self::append_log(&env, &verifier, &subject, "approve");
        env.events()
            .publish((symbol_short!("approved"), subject), verifier);
    }

    pub fn approve_batch(
        env: Env,
        verifier: Address,
        subjects: Vec<(Address, u32, u64, String)>,
    ) {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        verifier.require_auth();
        Self::require_verifier(&env, &verifier);
        if subjects.len() > 20 {
            panic!("batch too large");
        }
        for (subject, tier, expiry, jurisdiction) in subjects.iter() {
            Self::validate_jurisdiction(&env, &jurisdiction);
            Self::record_transition(
                &env,
                &subject,
                KycTransitionKind::Approve,
                &verifier,
                tier,
                expiry,
                jurisdiction.clone(),
            );
            let record = KycRecord {
                status: KycStatus::Approved,
                verifier: verifier.clone(),
                tier,
                expiry,
                jurisdiction: jurisdiction.clone(),
            };
            Self::write_record(&env, subject.clone(), record);
            Self::append_log(&env, &verifier, &subject, "approve");
            env.events()
                .publish((symbol_short!("approved"), subject.clone()), verifier.clone());
        }
    }

    pub fn reject(env: Env, verifier: Address, subject: Address) {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        verifier.require_auth();
        Self::require_verifier(&env, &verifier);
        let mut record = Self::get_record_or_default(&env, subject.clone(), &verifier);
        record.status = KycStatus::Rejected;
        Self::record_transition(
            &env,
            &subject,
            KycTransitionKind::Reject,
            &verifier,
            record.tier,
            record.expiry,
            record.jurisdiction.clone(),
        );
        Self::write_record(&env, subject.clone(), record);
        Self::append_log(&env, &verifier, &subject, "reject");
        env.events()
            .publish((symbol_short!("rejected"), subject), verifier);
    }

    pub fn revoke(env: Env, verifier: Address, subject: Address) {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        verifier.require_auth();
        Self::require_verifier(&env, &verifier);
        let mut record = Self::get_record_or_default(&env, subject.clone(), &verifier);
        record.status = KycStatus::Revoked;
        Self::record_transition(
            &env,
            &subject,
            KycTransitionKind::Revoke,
            &verifier,
            record.tier,
            record.expiry,
            record.jurisdiction.clone(),
        );
        Self::write_record(&env, subject.clone(), record);
        Self::append_log(&env, &verifier, &subject, "revoke");
        env.events()
            .publish((symbol_short!("revoked"), subject), verifier);
    }

    pub fn revoke_batch(env: Env, verifier: Address, subjects: Vec<Address>) {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        verifier.require_auth();
        Self::require_verifier(&env, &verifier);
        if subjects.len() > 20 {
            panic!("batch too large");
        }
        for subject in subjects.iter() {
            let mut record = Self::get_record_or_default(&env, subject.clone(), &verifier);
            record.status = KycStatus::Revoked;
            Self::record_transition(
                &env,
                &subject,
                KycTransitionKind::Revoke,
                &verifier,
                record.tier,
                record.expiry,
                record.jurisdiction.clone(),
            );
            Self::write_record(&env, subject.clone(), record);
            Self::append_log(&env, &verifier, &subject, "revoke");
            env.events()
                .publish((symbol_short!("revoked"), subject.clone()), verifier.clone());
        }
    }

    /// Update only the `tier` field of an existing, Approved KYC record.
    /// Requires verifier auth and the subject must currently be Approved.
    pub fn update_tier(env: Env, verifier: Address, subject: Address, new_tier: u32) {
        verifier.require_auth();
        Self::require_verifier(&env, &verifier);
        let mut record = env
            .storage()
            .persistent()
            .get::<DataKey, KycRecord>(&DataKey::KycStatus(subject.clone()))
            .expect("no KYC record for subject");
        if record.status != KycStatus::Approved {
            panic!("subject is not currently approved");
        }
        record.tier = new_tier;
        Self::record_transition(
            &env,
            &subject,
            KycTransitionKind::TierUpdate,
            &verifier,
            new_tier,
            record.expiry,
            record.jurisdiction.clone(),
        );
        Self::write_record(&env, subject.clone(), record);
        env.events()
            .publish((symbol_short!("tier_upd"), subject), new_tier);
    }

    /// Bulk-revoke all subjects approved by a specific verifier. Admin-only.
    /// Capped at 50 subjects per call; call again if more subjects remain.
    pub fn revoke_all_by_verifier(env: Env, caller: Address, verifier: Address) {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        caller.require_auth();
        Self::require_admin(&env, &caller);
        let key = DataKey::VerifierSubjects(verifier.clone());
        let subjects: Vec<Address> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));
        let cap: u32 = 50;
        let count = subjects.len().min(cap);
        let mut revoked: u32 = 0;
        for i in 0..count {
            let subject = subjects.get(i).unwrap();
            let sk = DataKey::KycStatus(subject.clone());
            if let Some(mut record) =
                env.storage().persistent().get::<DataKey, KycRecord>(&sk)
            {
                if record.status == KycStatus::Approved {
                    record.status = KycStatus::Revoked;
                    Self::record_transition(
                        &env,
                        &subject,
                        KycTransitionKind::Revoke,
                        &verifier,
                        record.tier,
                        record.expiry,
                        record.jurisdiction.clone(),
                    );
                    env.storage().persistent().set(&sk, &record);
                    env.storage().persistent().extend_ttl(&sk, THRESHOLD, BUMP);
                    env.events()
                        .publish((symbol_short!("revoked"), subject), verifier.clone());
                    revoked += 1;
                }
            }
        }
        env.events()
            .publish((symbol_short!("bulk_rvkd"),), (verifier, revoked));
    }

    // ── Queries ──────────────────────────────────────────────────────────────

    /// Returns true if the address has an active, non-expired KYC approval.
    pub fn is_approved(env: Env, addr: Address) -> bool {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let key = DataKey::KycStatus(addr);
        if let Some(record) = env.storage().persistent().get::<DataKey, KycRecord>(&key) {
            if record.status != KycStatus::Approved {
                return false;
            }
            if record.expiry != 0 && record.expiry < env.ledger().timestamp() {
                return false;
            }
            true
        } else {
            false
        }
    }

    /// Returns the current canonical KYC record for a subject.
    ///
    /// Panics with `expect` when no record exists. Callers that need a
    /// non-panicking variant should use [`get_record_opt`].
    pub fn get_record(env: Env, addr: Address) -> KycRecord {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        Self::fetch_record(&env, addr)
    }

    /// Returns the KYC record for an address, or `None` if no record exists.
    ///
    /// Unlike [`get_record`] this never panics. Named `get_record_opt` rather
    /// than `try_get_record` to avoid colliding with the `try_` prefix that the
    /// Soroban SDK auto-generates for every contract method's client wrapper.
    pub fn get_record_opt(env: Env, addr: Address) -> Option<KycRecord> {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage()
            .persistent()
            .get::<DataKey, KycRecord>(&DataKey::KycStatus(addr))
    }

    /// Resolves the full KYC state for an address without panicking.
    ///
    /// Returns [`KycState::Missing`] when no record exists,
    /// [`KycState::Expired`] when the record has passed its expiry timestamp,
    /// and the appropriately named state otherwise.
    pub fn get_kyc_state(env: Env, addr: Address) -> KycState {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let key = DataKey::KycStatus(addr);
        match env
            .storage()
            .persistent()
            .get::<DataKey, KycRecord>(&key)
        {
            None => KycState::Missing,
            Some(record) => match record.status {
                KycStatus::Approved => {
                    if record.expiry != 0 && record.expiry < env.ledger().timestamp() {
                        KycState::Expired
                    } else {
                        KycState::Approved
                    }
                }
                KycStatus::Revoked => KycState::Revoked,
                KycStatus::Rejected => KycState::Rejected,
                KycStatus::Pending => KycState::Pending,
            },
        }
    }

    /// Returns the KYC tier of `addr`, or `0` when no record exists.
    pub fn get_tier(env: Env, addr: Address) -> u32 {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage()
            .persistent()
            .get::<DataKey, KycRecord>(&DataKey::KycStatus(addr))
            .map(|r| r.tier)
            .unwrap_or(0)
    }

    /// Paged query of subjects approved by a given verifier.
    /// `start` is a zero-based offset; `limit` is capped at 50.
    pub fn get_subjects_by_verifier(
        env: Env,
        verifier: Address,
        start: u32,
        limit: u32,
    ) -> Vec<Address> {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let cap: u32 = 50;
        let effective_limit = if limit > cap { cap } else { limit };
        let key = DataKey::VerifierSubjects(verifier);
        let subjects = env
            .storage()
            .persistent()
            .get::<DataKey, Vec<Address>>(&key)
            .unwrap_or_else(|| Vec::new(&env));
        let total = subjects.len();
        let mut result: Vec<Address> = Vec::new(&env);
        if start >= total {
            return result;
        }
        let end = (start + effective_limit).min(total);
        for i in start..end {
            result.push_back(subjects.get(i).unwrap());
        }
        result
    }

    // ── Lifecycle history queries ─────────────────────────────────────────────

    /// Returns the number of lifecycle transitions recorded for a subject.
    pub fn get_lifecycle_count(env: Env, subject: Address) -> u32 {
        env.storage()
            .persistent()
            .get::<DataKey, u32>(&DataKey::LifecycleCount(subject))
            .unwrap_or(0)
    }

    /// Paged lifecycle history for a subject. `start` is a zero-based seq offset;
    /// `limit` is capped at 50. Entries are ordered by ascending seq number.
    pub fn get_lifecycle_history(
        env: Env,
        subject: Address,
        start: u32,
        limit: u32,
    ) -> Vec<KycTransition> {
        let count: u32 = env
            .storage()
            .persistent()
            .get::<DataKey, u32>(&DataKey::LifecycleCount(subject.clone()))
            .unwrap_or(0);
        let cap: u32 = 50;
        let effective_limit = if limit > cap { cap } else { limit };
        let end = (start + effective_limit).min(count);
        let mut result: Vec<KycTransition> = Vec::new(&env);
        for seq in start..end {
            let key = DataKey::LifecycleEntry(HistoryKey {
                subject: subject.clone(),
                seq,
            });
            if let Some(entry) = env
                .storage()
                .persistent()
                .get::<DataKey, KycTransition>(&key)
            {
                result.push_back(entry);
            }
        }
        result
    }

    // ── Expiring records ──────────────────────────────────────────────────────

    pub fn get_expiring_soon(
        env: Env,
        within_seconds: u64,
        start: u32,
        limit: u32,
    ) -> Vec<ExpiringRecord> {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ExpiryIndexCount)
            .unwrap_or(0);
        let now = env.ledger().timestamp();
        let capped = limit.min(50);
        let mut out: Vec<ExpiringRecord> = Vec::new(&env);
        let mut i = start;
        while i < count && out.len() < capped {
            if let Some(entry) = env
                .storage()
                .persistent()
                .get::<DataKey, ExpiryEntry>(&DataKey::ExpiryIndex(i))
            {
                if entry.expiry > now && entry.expiry <= now + within_seconds {
                    if let Some(record) = env.storage().persistent().get::<DataKey, KycRecord>(
                        &DataKey::KycStatus(entry.addr.clone()),
                    ) {
                        if record.status == KycStatus::Approved {
                            out.push_back(ExpiringRecord {
                                addr: entry.addr,
                                record,
                            });
                        }
                    }
                }
            }
            i += 1;
        }
        out
    }

    // ── Verifier log ─────────────────────────────────────────────────────────

    pub fn verifier_log_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::VerifierLogCount)
            .unwrap_or(0)
    }

    /// Paged verifier log. `start` is a zero-based offset; `limit` is capped at 50.
    pub fn get_verifier_log(env: Env, start: u32, limit: u32) -> Vec<VerifierLogEntry> {
        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::VerifierLogCount)
            .unwrap_or(0);
        let capped = limit.min(50);
        let end = (start + capped).min(count);
        let mut out = Vec::new(&env);
        for i in start..end {
            if let Some(entry) = env
                .storage()
                .persistent()
                .get::<DataKey, VerifierLogEntry>(&DataKey::VerifierLog(i))
            {
                out.push_back(entry);
            }
        }
        out
    }

    // ── Full-record export (GDPR / CCPA subject-access) ──────────────────────

    /// Returns all on-chain data held about `subject` in a single structured
    /// value, supporting GDPR / CCPA subject-access requests.
    ///
    /// Access control: `requester` must be either the subject themselves or an
    /// admin. Any other caller causes the transaction to panic with
    /// `KycError::NotAuthorized`.
    ///
    /// The returned [`KycFullRecord`] contains:
    /// - the current `KycRecord` for `subject` (panics with `KycError::NoRecord`
    ///   if no record exists),
    /// - every global verifier-log entry whose `subject` field matches the
    ///   requested address, collected in ascending log-index order, and
    /// - the address of this registry contract so the export can be anchored
    ///   to a specific on-chain instance.
    pub fn get_full_record(env: Env, requester: Address, subject: Address) -> KycFullRecord {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);

        // Require auth from the requester first, then authorisation check.
        requester.require_auth();

        // The requester must be the subject themselves OR an admin.
        let is_subject = requester == subject;
        let is_admin = Self::admin_list(&env).contains(&requester);
        if !is_subject && !is_admin {
            panic_with_error!(env, KycError::NotAuthorized);
        }

        // Fetch the canonical KYC record — panics if none exists.
        let record: KycRecord = env
            .storage()
            .persistent()
            .get(&DataKey::KycStatus(subject.clone()))
            .unwrap_or_else(|| panic_with_error!(env, KycError::NoRecord));

        // Collect every global verifier-log entry that references `subject`.
        let log_count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::VerifierLogCount)
            .unwrap_or(0);

        let mut log_entries: Vec<VerifierLogEntry> = Vec::new(&env);
        for i in 0..log_count {
            if let Some(entry) = env
                .storage()
                .persistent()
                .get::<DataKey, VerifierLogEntry>(&DataKey::VerifierLog(i))
            {
                if entry.subject == subject {
                    log_entries.push_back(entry);
                }
            }
        }

        KycFullRecord {
            record,
            log_entries,
            registry: env.current_contract_address(),
        }
    }

    pub fn version(env: Env) -> String {
        String::from_str(&env, env!("CARGO_PKG_VERSION"))
    }

    // ── Storage versioning / migration ────────────────────────────────────────

    /// Returns the current numeric schema version.
    ///
    /// Returns `0` for legacy deployments that were initialized before schema
    /// versioning was introduced (i.e. where the `StorageVersion` key is absent).
    /// New deployments set this to `1` during `initialize`.
    pub fn schema_version(env: Env) -> u32 {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage()
            .instance()
            .get(&DataKey::StorageVersion)
            .unwrap_or(0)
    }

    /// Returns the number of migrations that have been applied.
    pub fn migration_count(env: Env) -> u32 {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage()
            .instance()
            .get(&DataKey::MigrationCount)
            .unwrap_or(0)
    }

    /// Returns the migration record at `index`, or panics if out of range.
    pub fn get_migration_record(env: Env, index: u32) -> KycMigrationRecord {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage()
            .instance()
            .get(&DataKey::Migration(index))
            .expect("migration record not found")
    }

    /// Admin-only upgrade hook.  Advances the schema from `current + 1` to
    /// `to_version` and appends an immutable migration record.
    ///
    /// Rules:
    /// - Caller must be a registered admin.
    /// - `to_version` must equal `current_schema_version + 1` (no skipping,
    ///   no repeating).
    /// - For legacy deployments where no `StorageVersion` key exists, the
    ///   current version is treated as `0`, so the first valid call is
    ///   `migrate_schema(caller, 1, ...)` (the bootstrap migration).
    ///
    /// After all data-structure changes for this version have been applied in
    /// the body below, add the new schema number to this function's match arm.
    pub fn migrate_schema(
        env: Env,
        caller: Address,
        to_version: u32,
        description: String,
    ) {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        caller.require_auth();
        Self::require_admin(&env, &caller);

        let current: u32 = env
            .storage()
            .instance()
            .get(&DataKey::StorageVersion)
            .unwrap_or(0);

        if to_version == current {
            panic_with_error!(env, KycError::AlreadyAtSchemaVersion);
        }
        if to_version != current + 1 {
            panic_with_error!(env, KycError::MigrationVersionNotSequential);
        }

        // ── Per-version migration hooks ────────────────────────────────────
        // Add a new `to_version =>` arm here when the storage schema changes.
        // Keep completed arms for auditability; they will never re-execute.
        match to_version {
            1 => {
                // Bootstrap: record that this deployment is now at schema v1.
                // No data transformation needed — v0 layout == v1 layout.
            }
            _ => {
                // Future versions: implement data migrations here.
            }
        }

        // Record the migration.
        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MigrationCount)
            .unwrap_or(0);
        let record = KycMigrationRecord {
            from_version: current,
            to_version,
            timestamp: env.ledger().timestamp(),
            description,
        };
        env.storage()
            .instance()
            .set(&DataKey::Migration(count), &record);
        env.storage()
            .instance()
            .set(&DataKey::MigrationCount, &(count + 1));
        env.storage()
            .instance()
            .set(&DataKey::StorageVersion, &to_version);

        env.events()
            .publish((symbol_short!("migrated"),), (current, to_version));
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn validate_jurisdiction(env: &Env, jurisdiction: &String) {
        if jurisdiction.len() != 2 {
            panic_with_error!(env, KycError::InvalidJurisdiction);
        }
        let mut bytes = [0u8; 2];
        jurisdiction.copy_into_slice(&mut bytes);
        if bytes[0] < b'A'
            || bytes[0] > b'Z'
            || bytes[1] < b'A'
            || bytes[1] > b'Z'
        {
            panic_with_error!(env, KycError::InvalidJurisdiction);
        }
    }

    fn admin_list(env: &Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::AdminList)
            .unwrap_or_else(|| Vec::new(env))
    }

    fn require_admin(env: &Env, caller: &Address) {
        let list = Self::admin_list(env);
        if !list.contains(caller) {
            panic_with_error!(env, KycError::NotAdmin);
        }
    }

    fn require_verifier(env: &Env, verifier: &Address) {
        let list = Self::verifier_list(env);
        if !list.contains(verifier) {
            panic_with_error!(env, KycError::NotVerifier);
        }
    }

    fn verifier_list(env: &Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::VerifierList)
            .unwrap_or_else(|| Vec::new(env))
    }

    fn get_record_or_default(env: &Env, addr: Address, verifier: &Address) -> KycRecord {
        env.storage()
            .persistent()
            .get(&DataKey::KycStatus(addr))
            .unwrap_or_else(|| KycRecord {
                status: KycStatus::Pending,
                verifier: verifier.clone(),
                tier: 0,
                expiry: 0,
                jurisdiction: String::from_str(env, ""),
            })
    }

    /// Internal fetch that panics when no record exists.
    fn fetch_record(env: &Env, addr: Address) -> KycRecord {
        env.storage()
            .persistent()
            .get(&DataKey::KycStatus(addr))
            .expect("no KYC record")
    }

    /// Append a human-readable action to the global verifier log.
    fn append_log(env: &Env, verifier: &Address, subject: &Address, action: &str) {
        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::VerifierLogCount)
            .unwrap_or(0);
        let entry = VerifierLogEntry {
            verifier: verifier.clone(),
            subject: subject.clone(),
            action: String::from_str(env, action),
            timestamp: env.ledger().timestamp(),
        };
        let key = DataKey::VerifierLog(count);
        env.storage().persistent().set(&key, &entry);
        env.storage().persistent().extend_ttl(&key, THRESHOLD, BUMP);
        env.storage()
            .instance()
            .set(&DataKey::VerifierLogCount, &(count + 1));
    }

    /// Append a structured lifecycle transition entry for a subject.
    ///
    /// Each call increments the per-subject sequence counter atomically and
    /// stores the entry under `DataKey::LifecycleEntry` so that history is
    /// deterministically replayable from seq 0.
    fn record_transition(
        env: &Env,
        subject: &Address,
        kind: KycTransitionKind,
        verifier: &Address,
        tier: u32,
        expiry: u64,
        jurisdiction: String,
    ) {
        let count_key = DataKey::LifecycleCount(subject.clone());
        let seq: u32 = env
            .storage()
            .persistent()
            .get::<DataKey, u32>(&count_key)
            .unwrap_or(0);

        let transition = KycTransition {
            seq,
            model_version: LIFECYCLE_MODEL_VERSION,
            kind,
            verifier: verifier.clone(),
            timestamp: env.ledger().timestamp(),
            tier,
            expiry,
            jurisdiction,
        };

        let entry_key = DataKey::LifecycleEntry(HistoryKey {
            subject: subject.clone(),
            seq,
        });
        env.storage().persistent().set(&entry_key, &transition);
        env.storage()
            .persistent()
            .extend_ttl(&entry_key, THRESHOLD, BUMP);

        env.storage().persistent().set(&count_key, &(seq + 1));
        env.storage()
            .persistent()
            .extend_ttl(&count_key, THRESHOLD, BUMP);
    }

    /// Persist a KYC record and maintain the expiry index and
    /// verifier-to-subjects index as side effects.
    fn write_record(env: &Env, addr: Address, record: KycRecord) {
        if record.status == KycStatus::Approved && record.expiry != 0 {
            let idx: u32 = env
                .storage()
                .instance()
                .get(&DataKey::ExpiryIndexCount)
                .unwrap_or(0);
            let entry = ExpiryEntry {
                expiry: record.expiry,
                addr: addr.clone(),
            };
            let ik = DataKey::ExpiryIndex(idx);
            env.storage().persistent().set(&ik, &entry);
            env.storage().persistent().extend_ttl(&ik, THRESHOLD, BUMP);
            env.storage()
                .instance()
                .set(&DataKey::ExpiryIndexCount, &(idx + 1));
        }

        let key = DataKey::KycStatus(addr.clone());
        env.storage().persistent().set(&key, &record);
        env.storage().persistent().extend_ttl(&key, THRESHOLD, BUMP);

        // Keep the verifier-to-subjects reverse index up to date.
        let verifier_key = DataKey::VerifierSubjects(record.verifier.clone());
        let mut subjects = env
            .storage()
            .persistent()
            .get::<DataKey, Vec<Address>>(&verifier_key)
            .unwrap_or_else(|| Vec::new(env));
        if !subjects.contains(&addr) {
            subjects.push_back(addr);
            env.storage().persistent().set(&verifier_key, &subjects);
            env.storage()
                .persistent()
                .extend_ttl(&verifier_key, THRESHOLD, BUMP);
        }
    }
}
