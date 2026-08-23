#![no_std]
#![cfg_attr(not(test), deny(clippy::unwrap_used))]

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    Env, String, Vec,
};

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
#[contracttype]
#[derive(Clone)]
pub struct HistoryKey {
    pub subject: Address,
    pub seq: u32,
}

/// Composite key for per-subject verifier log entries.
#[contracttype]
#[derive(Clone)]
pub struct SubjectLogKey {
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
    // Legacy: kept for migration reads; no longer written by new code paths.
    ExpiryIndex(u32),
    ExpiryIndexCount,
    VerifierLog(u32),
    VerifierLogCount,
    VerifierSubjects(Address),
    LifecycleEntry(HistoryKey),
    LifecycleCount(Address),
    StorageVersion,
    MigrationCount,
    Migration(u32),
    // ── v2 additions ─────────────────────────────────────────────────────────
    /// O(1) per-subject expiry key. Present = subject has a current expiry.
    SubjectExpiry(Address),
    /// Epoch-day bucket: addresses whose approved expiry falls on this day.
    /// epoch_day = expiry_timestamp / 86_400.
    ExpiryBucket(u32),
    /// Per-subject verifier log entry.
    SubjectVerifierLog(SubjectLogKey),
    /// Number of per-subject verifier log entries recorded.
    SubjectVerifierLogCount(Address),
    /// Cursor used by compact_expiry_buckets to resume across calls.
    EarliestBucketDay,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct KycMigrationRecord {
    pub from_version: u32,
    pub to_version: u32,
    pub timestamp: u64,
    pub description: String,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum KycTransitionKind {
    Approve,
    Reject,
    Revoke,
    TierUpdate,
}

#[contracttype]
#[derive(Clone)]
pub struct KycTransition {
    pub seq: u32,
    pub model_version: u32,
    pub kind: KycTransitionKind,
    pub verifier: Address,
    pub timestamp: u64,
    pub tier: u32,
    pub expiry: u64,
    pub jurisdiction: String,
}

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

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct KycFullRecord {
    pub record: KycRecord,
    pub log_entries: Vec<VerifierLogEntry>,
    pub registry: Address,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum KycState {
    Missing,
    Approved,
    Expired,
    Revoked,
    Rejected,
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
    pub tier: u32,
    pub expiry: u64,
    pub jurisdiction: String,
}

const DAY_IN_LEDGERS: u32 = 17280;
const BUMP: u32 = 30 * DAY_IN_LEDGERS;
const THRESHOLD: u32 = BUMP - DAY_IN_LEDGERS;

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
        env.storage()
            .instance()
            .set(&DataKey::StorageVersion, &1u32);
        env.storage()
            .instance()
            .set(&DataKey::MigrationCount, &0u32);
    }

    // ── Admin management ─────────────────────────────────────────────────────

    pub fn propose_admin(env: Env, caller: Address, new_admin: Address) {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        caller.require_auth();
        Self::require_admin(&env, &caller);
        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &new_admin);
        env.events()
            .publish((symbol_short!("proposed"),), new_admin);
    }

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

    pub fn add_admin(env: Env, caller: Address, new_admin: Address) {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        caller.require_auth();
        Self::require_admin(&env, &caller);
        let mut list = Self::admin_list(&env);
        if !list.contains(&new_admin) {
            list.push_back(new_admin.clone());
            env.storage().instance().set(&DataKey::AdminList, &list);
        }
        env.events()
            .publish((symbol_short!("admin_add"),), new_admin);
    }

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

    pub fn verifier_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::VerifierCount)
            .unwrap_or(0)
    }

    pub fn verifier_list_pub(env: Env) -> Vec<Address> {
        Self::verifier_list(&env)
    }

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
            result.push_back(list.get(i).expect("index in bounds"));
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

    pub fn approve_batch(env: Env, verifier: Address, subjects: Vec<(Address, u32, u64, String)>) {
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
            env.events().publish(
                (symbol_short!("approved"), subject.clone()),
                verifier.clone(),
            );
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
            env.events().publish(
                (symbol_short!("revoked"), subject.clone()),
                verifier.clone(),
            );
        }
    }

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
    /// Capped at 50 subjects per call.
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
            let subject = subjects.get(i).expect("index in bounds");
            let sk = DataKey::KycStatus(subject.clone());
            if let Some(mut record) = env.storage().persistent().get::<DataKey, KycRecord>(&sk) {
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

    pub fn get_record(env: Env, addr: Address) -> KycRecord {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        Self::fetch_record(&env, addr)
    }

    pub fn get_record_opt(env: Env, addr: Address) -> Option<KycRecord> {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage()
            .persistent()
            .get::<DataKey, KycRecord>(&DataKey::KycStatus(addr))
    }

    pub fn get_kyc_state(env: Env, addr: Address) -> KycState {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let key = DataKey::KycStatus(addr);
        match env.storage().persistent().get::<DataKey, KycRecord>(&key) {
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

    pub fn get_tier(env: Env, addr: Address) -> u32 {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage()
            .persistent()
            .get::<DataKey, KycRecord>(&DataKey::KycStatus(addr))
            .map(|r| r.tier)
            .unwrap_or(0)
    }

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
            result.push_back(subjects.get(i).expect("index in bounds"));
        }
        result
    }

    // ── Lifecycle history queries ─────────────────────────────────────────────

    pub fn get_lifecycle_count(env: Env, subject: Address) -> u32 {
        env.storage()
            .persistent()
            .get::<DataKey, u32>(&DataKey::LifecycleCount(subject))
            .unwrap_or(0)
    }

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

    // ── Expiry queries (epoch-bucket based) ───────────────────────────────────

    /// Returns subjects whose stored expiry falls within `[now, now + within_seconds]`.
    ///
    /// Reads only the buckets covering `[now_day, end_day]` — at most
    /// `within_seconds / 86_400 + 2` bucket keys regardless of total subjects.
    /// `start` skips the first N matching results (pagination).  `limit` ≤ 50.
    pub fn get_expiring_soon(
        env: Env,
        within_seconds: u64,
        start: u32,
        limit: u32,
    ) -> Vec<ExpiringRecord> {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let now = env.ledger().timestamp();
        let now_day = (now / 86_400) as u32;
        let end_day = ((now + within_seconds) / 86_400 + 1) as u32;
        let capped = limit.min(50);
        let mut out: Vec<ExpiringRecord> = Vec::new(&env);
        let mut skipped: u32 = 0;

        let mut day = now_day;
        while day <= end_day && out.len() < capped {
            let bucket_key = DataKey::ExpiryBucket(day);
            let bucket: Vec<Address> = env
                .storage()
                .persistent()
                .get(&bucket_key)
                .unwrap_or_else(|| Vec::new(&env));

            for addr in bucket.iter() {
                if out.len() >= capped {
                    break;
                }
                // Use per-subject expiry key for O(1) check before loading full record.
                let expiry_opt: Option<u64> = env
                    .storage()
                    .persistent()
                    .get(&DataKey::SubjectExpiry(addr.clone()));
                if let Some(expiry) = expiry_opt {
                    // Guard: only include the subject from the bucket that matches
                    // their CURRENT expiry day.  Stale bucket entries left from
                    // earlier approvals have a different epoch_day and are skipped,
                    // preventing duplicate results after re-approvals.
                    let expiry_day = (expiry / 86_400) as u32;
                    if expiry_day == day && expiry > now && expiry <= now + within_seconds {
                        if let Some(record) = env
                            .storage()
                            .persistent()
                            .get::<DataKey, KycRecord>(&DataKey::KycStatus(addr.clone()))
                        {
                            if record.status == KycStatus::Approved {
                                if skipped < start {
                                    skipped += 1;
                                } else {
                                    out.push_back(ExpiringRecord {
                                        addr: addr.clone(),
                                        record,
                                    });
                                }
                            }
                        }
                    }
                }
            }
            day += 1;
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

    // ── Full-record export (GDPR / CCPA) ──────────────────────────────────────

    /// Returns all on-chain data held about `subject` in a single structured value.
    ///
    /// Reads exactly `SubjectVerifierLogCount(subject)` storage entries regardless
    /// of the total number of KYC operations performed across all subjects.
    pub fn get_full_record(env: Env, requester: Address, subject: Address) -> KycFullRecord {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        requester.require_auth();

        let is_subject = requester == subject;
        let is_admin = Self::admin_list(&env).contains(&requester);
        if !is_subject && !is_admin {
            panic_with_error!(env, KycError::NotAuthorized);
        }

        let record: KycRecord = env
            .storage()
            .persistent()
            .get(&DataKey::KycStatus(subject.clone()))
            .unwrap_or_else(|| panic_with_error!(env, KycError::NoRecord));

        // O(N_subject) — reads only this subject's log entries.
        let scount: u32 = env
            .storage()
            .persistent()
            .get::<DataKey, u32>(&DataKey::SubjectVerifierLogCount(subject.clone()))
            .unwrap_or(0);

        let mut log_entries: Vec<VerifierLogEntry> = Vec::new(&env);
        for seq in 0..scount {
            let skey = DataKey::SubjectVerifierLog(SubjectLogKey {
                subject: subject.clone(),
                seq,
            });
            if let Some(entry) = env
                .storage()
                .persistent()
                .get::<DataKey, VerifierLogEntry>(&skey)
            {
                log_entries.push_back(entry);
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

    // ── Expiry bucket compaction ───────────────────────────────────────────────

    /// Admin-only: delete stale expiry buckets whose epoch_day < `before_day`.
    ///
    /// Iterates forward from the stored `EarliestBucketDay` cursor, deleting up
    /// to `max_buckets` buckets per call.  Call repeatedly to compact in chunks.
    pub fn compact_expiry_buckets(env: Env, caller: Address, before_day: u32, max_buckets: u32) {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        caller.require_auth();
        Self::require_admin(&env, &caller);

        let capped = max_buckets.min(100);
        let start_day: u32 = env
            .storage()
            .instance()
            .get(&DataKey::EarliestBucketDay)
            .unwrap_or(0);

        let mut day = start_day;
        let mut deleted: u32 = 0;

        while day < before_day && deleted < capped {
            let bucket_key = DataKey::ExpiryBucket(day);
            if env.storage().persistent().has(&bucket_key) {
                env.storage().persistent().remove(&bucket_key);
                deleted += 1;
            }
            day += 1;
        }

        // Advance cursor past the last day we checked.
        if day > start_day {
            env.storage()
                .instance()
                .set(&DataKey::EarliestBucketDay, &day);
        }

        env.events()
            .publish((symbol_short!("cpct_bkt"),), (before_day, deleted));
    }

    // ── Storage versioning / migration ────────────────────────────────────────

    pub fn schema_version(env: Env) -> u32 {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage()
            .instance()
            .get(&DataKey::StorageVersion)
            .unwrap_or(0)
    }

    pub fn migration_count(env: Env) -> u32 {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage()
            .instance()
            .get(&DataKey::MigrationCount)
            .unwrap_or(0)
    }

    pub fn get_migration_record(env: Env, index: u32) -> KycMigrationRecord {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage()
            .instance()
            .get(&DataKey::Migration(index))
            .expect("migration record not found")
    }

    /// Admin-only schema migration hook.
    ///
    /// `batch_size` controls how many log / expiry-index entries the v2 arm
    /// processes in a single call.  Pass `0` to process all entries at once.
    pub fn migrate_schema(
        env: Env,
        caller: Address,
        to_version: u32,
        description: String,
        batch_size: u32,
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

        match to_version {
            1 => {
                // v0 → v1 bootstrap: first deployed version needs no data migration.
                // The storage layout of v0 and v1 are identical; this arm simply
                // records that the deployment is now at schema v1.
            }
            2 => {
                // v1 → v2: backfill per-subject verifier logs and SubjectExpiry keys
                // from existing global indexes.  Safe to call on both old deployments
                // (no SubjectVerifierLog yet) and new deployments (idempotent: resets
                // counts then rebuilds from the global log).

                // ── Rebuild SubjectVerifierLog ─────────────────────────────────
                let log_count: u32 = env
                    .storage()
                    .instance()
                    .get(&DataKey::VerifierLogCount)
                    .unwrap_or(0);
                let log_batch = if batch_size == 0 {
                    log_count
                } else {
                    log_count.min(batch_size)
                };

                // Collect unique subjects touched in this batch to reset their
                // per-subject log counts before the rebuild pass.
                let mut seen: Vec<Address> = Vec::new(&env);
                for i in 0..log_batch {
                    if let Some(entry) = env
                        .storage()
                        .persistent()
                        .get::<DataKey, VerifierLogEntry>(&DataKey::VerifierLog(i))
                    {
                        if !seen.contains(&entry.subject) {
                            seen.push_back(entry.subject.clone());
                        }
                    }
                }
                for subject in seen.iter() {
                    env.storage()
                        .persistent()
                        .set(&DataKey::SubjectVerifierLogCount(subject.clone()), &0u32);
                }

                // Rebuild per-subject log entries in global-log order.
                for i in 0..log_batch {
                    if let Some(entry) = env
                        .storage()
                        .persistent()
                        .get::<DataKey, VerifierLogEntry>(&DataKey::VerifierLog(i))
                    {
                        let subject = entry.subject.clone();
                        let scount_key = DataKey::SubjectVerifierLogCount(subject.clone());
                        let scount: u32 = env.storage().persistent().get(&scount_key).unwrap_or(0);
                        let skey = DataKey::SubjectVerifierLog(SubjectLogKey {
                            subject: subject.clone(),
                            seq: scount,
                        });
                        env.storage().persistent().set(&skey, &entry);
                        env.storage()
                            .persistent()
                            .extend_ttl(&skey, THRESHOLD, BUMP);
                        env.storage().persistent().set(&scount_key, &(scount + 1));
                        env.storage()
                            .persistent()
                            .extend_ttl(&scount_key, THRESHOLD, BUMP);
                    }
                }

                // ── Rebuild SubjectExpiry + ExpiryBucket from old ExpiryIndex ──
                let expiry_count: u32 = env
                    .storage()
                    .instance()
                    .get(&DataKey::ExpiryIndexCount)
                    .unwrap_or(0);
                let exp_batch = if batch_size == 0 {
                    expiry_count
                } else {
                    expiry_count.min(batch_size)
                };

                // Iterating in ascending order means higher-index entries (later
                // approvals) overwrite earlier ones — "last wins" per subject.
                for i in 0..exp_batch {
                    if let Some(entry) = env
                        .storage()
                        .persistent()
                        .get::<DataKey, ExpiryEntry>(&DataKey::ExpiryIndex(i))
                    {
                        let expiry_key = DataKey::SubjectExpiry(entry.addr.clone());
                        env.storage().persistent().set(&expiry_key, &entry.expiry);
                        env.storage()
                            .persistent()
                            .extend_ttl(&expiry_key, THRESHOLD, BUMP);

                        let epoch_day = (entry.expiry / 86_400) as u32;
                        let bucket_key = DataKey::ExpiryBucket(epoch_day);
                        let mut bucket: Vec<Address> = env
                            .storage()
                            .persistent()
                            .get(&bucket_key)
                            .unwrap_or_else(|| Vec::new(&env));
                        if !bucket.contains(&entry.addr) {
                            bucket.push_back(entry.addr.clone());
                            env.storage().persistent().set(&bucket_key, &bucket);
                            env.storage()
                                .persistent()
                                .extend_ttl(&bucket_key, THRESHOLD, BUMP);
                        }
                    }
                }
            }
            _ => {
                // Future versions: implement data migrations here.
            }
        }

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
        if bytes[0] < b'A' || bytes[0] > b'Z' || bytes[1] < b'A' || bytes[1] > b'Z' {
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

    fn fetch_record(env: &Env, addr: Address) -> KycRecord {
        env.storage()
            .persistent()
            .get(&DataKey::KycStatus(addr))
            .expect("no KYC record")
    }

    /// Append to the global verifier log AND the per-subject verifier log.
    ///
    /// The global log is retained for `revoke_all_by_verifier` queries.
    /// The per-subject log is the O(N_subject) source for `get_full_record`.
    fn append_log(env: &Env, verifier: &Address, subject: &Address, action: &str) {
        let entry = VerifierLogEntry {
            verifier: verifier.clone(),
            subject: subject.clone(),
            action: String::from_str(env, action),
            timestamp: env.ledger().timestamp(),
        };

        // Global log (unchanged, required by revoke_all_by_verifier).
        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::VerifierLogCount)
            .unwrap_or(0);
        let gkey = DataKey::VerifierLog(count);
        env.storage().persistent().set(&gkey, &entry);
        env.storage()
            .persistent()
            .extend_ttl(&gkey, THRESHOLD, BUMP);
        env.storage()
            .instance()
            .set(&DataKey::VerifierLogCount, &(count + 1));

        // Per-subject log — O(1) append.
        let scount_key = DataKey::SubjectVerifierLogCount(subject.clone());
        let scount: u32 = env.storage().persistent().get(&scount_key).unwrap_or(0);
        let skey = DataKey::SubjectVerifierLog(SubjectLogKey {
            subject: subject.clone(),
            seq: scount,
        });
        env.storage().persistent().set(&skey, &entry);
        env.storage()
            .persistent()
            .extend_ttl(&skey, THRESHOLD, BUMP);
        env.storage().persistent().set(&scount_key, &(scount + 1));
        env.storage()
            .persistent()
            .extend_ttl(&scount_key, THRESHOLD, BUMP);
    }

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

    /// Persist a KYC record and update the SubjectExpiry key, ExpiryBucket, and
    /// verifier-to-subjects index.  No longer writes to the legacy ExpiryIndex.
    fn write_record(env: &Env, addr: Address, record: KycRecord) {
        // ── Per-subject expiry key (O(1) lookup) ──────────────────────────────
        let expiry_key = DataKey::SubjectExpiry(addr.clone());
        if record.status == KycStatus::Approved && record.expiry != 0 {
            // Write / overwrite the single expiry key for this subject.
            env.storage().persistent().set(&expiry_key, &record.expiry);
            env.storage()
                .persistent()
                .extend_ttl(&expiry_key, THRESHOLD, BUMP);

            // Append to epoch-day bucket (deduplicated).
            let epoch_day = (record.expiry / 86_400) as u32;
            let bucket_key = DataKey::ExpiryBucket(epoch_day);
            let mut bucket: Vec<Address> = env
                .storage()
                .persistent()
                .get(&bucket_key)
                .unwrap_or_else(|| Vec::new(env));
            if !bucket.contains(&addr) {
                bucket.push_back(addr.clone());
                env.storage().persistent().set(&bucket_key, &bucket);
                env.storage()
                    .persistent()
                    .extend_ttl(&bucket_key, THRESHOLD, BUMP);
            }
        } else {
            // Revoked, rejected, or approved with no expiry — remove the key.
            env.storage().persistent().remove(&expiry_key);
        }

        // ── Main KYC record ───────────────────────────────────────────────────
        let key = DataKey::KycStatus(addr.clone());
        env.storage().persistent().set(&key, &record);
        env.storage().persistent().extend_ttl(&key, THRESHOLD, BUMP);

        // ── Verifier-to-subjects reverse index ───────────────────────────────
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
