#![no_std]
#![cfg_attr(not(test), deny(clippy::unwrap_used))]

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, panic_with_error, symbol_short,
    Address, Env, String, Vec,
};

/// The reason a transfer was denied by the compliance engine.
///
/// Returned inside [`TransferDecision`] by [`ComplianceEngine::evaluate_transfer`].
/// Callers can match on this to surface a precise error to the user, e.g.
/// mapping KYC-related variants to a `KycNotApproved` contract error and
/// the rest to `TransferBlocked`.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum DenyReason {
    CompliancePaused,
    FromBlocklisted,
    ToBlocklisted,
    FromKycMissing,
    ToKycMissing,
    FromKycExpired,
    ToKycExpired,
    FromKycRevoked,
    ToKycRevoked,
    FromKycRejected,
    ToKycRejected,
    FromKycPending,
    ToKycPending,
    FromJurisdictionBlocked,
    ToJurisdictionBlocked,
    SameJurisdictionRequired,
    AmountExceeded,
    HoldingPeriodNotMet,
    MaxHoldersReached,
    RecipientHoldingPeriodExceeded,
    TierPolicyBlocked,
    TierFromBelowMin,
    TierToBelowMin,
    TierAmountExceeded,
    RiskScoreTooHigh,
}

/// The outcome of a compliance transfer evaluation.
///
/// Returned by [`ComplianceEngine::evaluate_transfer`].
/// `Allow` means the transfer may proceed.
/// `Deny(reason)` carries the specific rule that blocked the transfer.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum TransferDecision {
    Allow,
    Deny(DenyReason),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ComplianceError {
    AlreadyInitialized = 1,
    MinHoldingPeriodExceeds365Days = 2,
    NegativeMaxTransferAmount = 3,
    MaxHoldersBelowCurrentCount = 4,
    NoRulesPending = 5,
    TooEarlyToActivate = 6,
    /// Risk score value is out of the valid range [0, 100].
    InvalidRiskScore = 7,
    /// `max_score` in `RiskConfig` is out of the valid range [0, 100].
    InvalidRiskConfig = 8,
    /// Migration target version equals the current schema version.
    AlreadyAtSchemaVersion = 9,
    /// Migration must increment schema version by exactly one.
    MigrationVersionNotSequential = 10,
}

// ── Tier-based policy types ───────────────────────────────────────────────────

/// Composite key identifying a tier-to-tier transfer policy entry.
/// `from_tier` is the sender's KYC tier; `to_tier` is the recipient's KYC tier.
/// Use `u32::MAX` (0xFFFFFFFF) as a wildcard to match any tier.
#[contracttype]
#[derive(Clone)]
pub struct TierPolicyKey {
    pub from_tier: u32,
    pub to_tier: u32,
}

/// Constraints applied when a transfer matches a specific tier pair.
///
/// All constraints in this struct are evaluated **in addition to** the global
/// `ComplianceRules`.  The most restrictive of global + tier-specific limits applies.
///
/// ## Tier conventions
/// - `0` = Basic KYC
/// - `1` = Accredited investor
/// - `2` = Institutional investor
///
/// ## Wildcard tier
/// Set `from_tier` or `to_tier` to `u32::MAX` in `TierPolicyKey` to match any tier.
/// More-specific policies (exact tier match) take precedence over wildcards.
///
/// ## Example policy: block retail → institutional
/// ```ignore
/// key = TierPolicyKey { from_tier: 0, to_tier: 2 }
/// policy = TierPolicy { blocked: true, .. }
/// ```
///
/// ## Example policy: higher transfer cap for institutional senders
/// ```ignore
/// key = TierPolicyKey { from_tier: 2, to_tier: u32::MAX }
/// policy = TierPolicy {
///     max_transfer_amount: 10_000_000_0000000, // 10 M tokens
///     min_from_tier: 2, min_to_tier: 0, blocked: false
/// }
/// ```
#[contracttype]
#[derive(Clone)]
pub struct TierPolicy {
    /// When `true`, all transfers matching this tier pair are unconditionally blocked.
    pub blocked: bool,
    /// Per-tier-pair maximum single-transfer amount.  0 = inherit global limit.
    /// When both global and tier-pair limits are set the stricter one (lower) applies.
    pub max_transfer_amount: i128,
    /// Minimum required KYC tier for the sender.  Transfers where the sender's tier
    /// is below this value are blocked.
    pub min_from_tier: u32,
    /// Minimum required KYC tier for the recipient.  Transfers where the recipient's
    /// tier is below this value are blocked.
    pub min_to_tier: u32,
}

// ── Jurisdiction risk scoring ─────────────────────────────────────────────────

/// Configuration for the jurisdiction-based risk scoring system.
///
/// Risk scores are integers in `[0, 100]`.  When a transfer involves a
/// jurisdiction whose score exceeds `max_score`, the transfer is blocked.
///
/// `default_score` is used when a jurisdiction has no explicit score configured.
/// Setting it to `0` makes the system permissive by default; setting it to `100`
/// makes the system restrictive by default (unknown = high-risk).
///
/// ## Score conventions
/// - `0`  — No risk; transfers always allowed regardless of jurisdiction.
/// - `1–49` — Low-to-medium risk; allowed under normal rules.
/// - `50–74` — Elevated risk; often corresponds to FATF grey-list jurisdictions.
/// - `75–99` — High risk; typically sanctioned or highly scrutinised.
/// - `100` — Blocked; equivalent to adding the jurisdiction to the blocklist.
#[contracttype]
#[derive(Clone)]
pub struct RiskConfig {
    /// Maximum combined risk score allowed.  Transfers where either party's
    /// jurisdiction score exceeds this value are blocked.
    /// Set to 0 to disable risk-score enforcement (risk scoring is inactive).
    pub max_score: u32,
    /// Score applied to jurisdictions with no explicit entry. Range: 0–100.
    /// Values above `max_score` with `max_score > 0` will block all unknown jurisdictions.
    pub default_score: u32,
}

#[contracttype]
pub enum DataKey {
    Admin,
    PendingAdmin,
    KycRegistry,
    Rules,
    PendingRules,
    PendingRulesActivateAt,
    RuleChangeDelay,
    Blocklist,
    BlocklistCount,
    BlockedJurisdictions,
    MaxTransfer,
    MinHoldingPeriod,
    MaxHolders,
    HolderCount,
    HolderSince(Address),
    Allowlist,
    // ── Tier-based policy ────────────────────────────────────────────────────
    /// Stores a `TierPolicy` for a given (from_tier, to_tier) pair.
    TierPolicy(TierPolicyKey),
    /// Count of distinct tier-policy entries (for enumeration).
    TierPolicyCount,
    // ── Jurisdiction risk scoring ─────────────────────────────────────────────
    /// Risk score (0–100) stored per 2-letter ISO-3166-1 alpha-2 jurisdiction code.
    JurisdictionRisk(String),
    /// Global risk configuration.
    RiskConfig,
    // ── Storage versioning ────────────────────────────────────────────────────
    /// Current schema version.  Written to 1 on `initialize`; incremented by
    /// each `migrate_schema` call.  Missing = legacy pre-versioned deployment.
    StorageVersion,
    /// Number of migration records stored.
    MigrationCount,
    /// Indexed migration history; key is the zero-based migration index.
    Migration(u32),
}

/// On-chain record of a single admin-initiated schema migration.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ComplianceMigrationRecord {
    pub from_version: u32,
    pub to_version: u32,
    pub timestamp: u64,
    pub description: String,
}

#[contracttype]
#[derive(Clone)]
pub struct ComplianceRules {
    pub max_transfer_amount: i128, // 0 = unlimited
    pub min_holding_period: u64,   // seconds; 0 = none
    pub max_holders: u32,          // 0 = unlimited
    pub require_same_jurisdiction: bool,
    pub paused: bool,
    pub allowlist_mode: bool,      // true = only allowlisted addresses may transfer
    /// Maximum duration (in seconds) an address may hold tokens before being
    /// required to exit.  0 = no maximum (unlimited holding).
    ///
    /// **Advanced feature — forced-exit / liquidation window.**
    ///
    /// When `max_holding_period > 0`:
    /// - An address whose `HolderSince` timestamp plus `max_holding_period`
    ///   is less than or equal to the current ledger timestamp is considered
    ///   "over-held".
    /// - Over-held addresses MAY still *send* tokens (forced exit is always
    ///   allowed so they can liquidate their position).
    /// - Over-held addresses may NOT *receive* additional tokens.  Any
    ///   incoming transfer to an address that has already exceeded its
    ///   maximum holding window is blocked.
    ///
    /// Use-case: REIT regulations that require periodic portfolio rebalancing,
    /// or any fund structure that must enforce a mandatory exit date.
    pub max_holding_period: u64,   // seconds; 0 = unlimited
}

const DAY_IN_LEDGERS: u32 = 17280;
const BUMP: u32 = 30 * DAY_IN_LEDGERS;
const THRESHOLD: u32 = BUMP - DAY_IN_LEDGERS;

#[contract]
pub struct ComplianceEngine;

#[contractimpl]
impl ComplianceEngine {
    /// `rule_change_delay` is the minimum number of seconds that must pass
    /// between a `propose_rules` call and a successful `activate_rules` call.
    /// Use 0 to disable the time-lock (immediate activation).
    pub fn initialize(env: Env, admin: Address, kyc_registry: Address, rule_change_delay: u64) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(env, ComplianceError::AlreadyInitialized);
        }
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::KycRegistry, &kyc_registry);
        env.storage()
            .instance()
            .set(&DataKey::RuleChangeDelay, &rule_change_delay);
        let default_rules = ComplianceRules {
            max_transfer_amount: 0,
            min_holding_period: 0,
            max_holders: 0,
            require_same_jurisdiction: false,
            paused: false,
            allowlist_mode: false,
            max_holding_period: 0,
        };
        env.storage()
            .instance()
            .set(&DataKey::Rules, &default_rules);
        env.storage().instance().set(&DataKey::HolderCount, &0u32);
        // Set the initial schema version so new deployments start at v1.
        env.storage().instance().set(&DataKey::StorageVersion, &1u32);
        env.storage().instance().set(&DataKey::MigrationCount, &0u32);
    }

    pub fn propose_admin(env: Env, new_admin: Address) {
        Self::require_admin(&env);
        env.storage().instance().set(&DataKey::PendingAdmin, &new_admin);
        env.events().publish((symbol_short!("proposed"),), new_admin);
    }

    pub fn accept_admin(env: Env) {
        let pending: Address = env.storage().instance().get(&DataKey::PendingAdmin).expect("no pending admin");
        pending.require_auth();
        let old_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        env.storage().instance().set(&DataKey::Admin, &pending);
        env.storage().instance().remove(&DataKey::PendingAdmin);
        env.events().publish((symbol_short!("admin_set"),), (old_admin, pending));
    }

    // ── Rule management ──────────────────────────────────────────────────────

    /// Propose new compliance rules with a time-lock delay.
    /// The rules do not take effect until `activate_rules` is called after
    /// the configured `rule_change_delay` has elapsed.
    pub fn propose_rules(env: Env, new_rules: ComplianceRules) {
        Self::require_admin(&env);
        Self::validate_rules(&env, &new_rules);
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let delay: u64 = env
            .storage()
            .instance()
            .get(&DataKey::RuleChangeDelay)
            .unwrap_or(0);
        let activate_at = env.ledger().timestamp() + delay;
        env.storage().instance().set(&DataKey::PendingRules, &new_rules);
        env.storage().instance().set(&DataKey::PendingRulesActivateAt, &activate_at);
        env.events().publish((symbol_short!("rules_prp"),), activate_at);
    }

    /// Activate previously proposed rules after the time-lock delay has passed.
    /// Can be called by anyone once the delay has elapsed.
    pub fn activate_rules(env: Env) {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let activate_at: u64 = env
            .storage()
            .instance()
            .get(&DataKey::PendingRulesActivateAt)
            .unwrap_or_else(|| panic_with_error!(env, ComplianceError::NoRulesPending));
        let now = env.ledger().timestamp();
        if now < activate_at {
            panic_with_error!(env, ComplianceError::TooEarlyToActivate);
        }
        let pending: ComplianceRules = env
            .storage()
            .instance()
            .get(&DataKey::PendingRules)
            .unwrap_or_else(|| panic_with_error!(env, ComplianceError::NoRulesPending));
        env.storage().instance().set(&DataKey::Rules, &pending);
        env.storage().instance().remove(&DataKey::PendingRules);
        env.storage().instance().remove(&DataKey::PendingRulesActivateAt);
        env.events().publish((symbol_short!("rules_act"),), ());
    }

    /// Emergency immediate rule update. Admin-only. Emits a warning event.
    pub fn set_rules(env: Env, rules: ComplianceRules) {
        Self::require_admin(&env);
        Self::validate_rules(&env, &rules);
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage().instance().set(&DataKey::Rules, &rules);
        // Warning: bypasses the time-lock delay
        env.events().publish((symbol_short!("rules_wrn"),), ());
        env.events().publish((symbol_short!("rules_set"),), ());
    }

    pub fn get_rules(env: Env) -> ComplianceRules {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage().instance().get(&DataKey::Rules).unwrap()
    }

    pub fn add_to_blocklist(env: Env, addr: Address) {
        Self::require_admin(&env);
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let mut list = Self::blocklist(&env);
        if !list.contains(&addr) {
            list.push_back(addr.clone());
            let count: u32 = env
                .storage()
                .instance()
                .get(&DataKey::BlocklistCount)
                .unwrap_or(0);
            env.storage()
                .instance()
                .set(&DataKey::BlocklistCount, &(count + 1));
        }
        env.storage().instance().set(&DataKey::Blocklist, &list);
        env.events().publish((symbol_short!("blocked"),), addr);
    }

    pub fn remove_from_blocklist(env: Env, addr: Address) {
        Self::require_admin(&env);
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let list = Self::blocklist(&env);
        let mut new_list: Vec<Address> = Vec::new(&env);
        let mut removed = false;
        for a in list.iter() {
            if a != addr {
                new_list.push_back(a);
            } else {
                removed = true;
            }
        }
        env.storage().instance().set(&DataKey::Blocklist, &new_list);
        if removed {
            let count: u32 = env
                .storage()
                .instance()
                .get(&DataKey::BlocklistCount)
                .unwrap_or(0);
            env.storage()
                .instance()
                .set(&DataKey::BlocklistCount, &count.saturating_sub(1));
        }
    }

    pub fn is_blocklisted(env: Env, addr: Address) -> bool {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        Self::blocklist(&env).contains(&addr)
    }

    pub fn blocklist_count(env: Env) -> u32 {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage()
            .instance()
            .get(&DataKey::BlocklistCount)
            .unwrap_or(0)
    }

    pub fn get_blocklist(env: Env, start: u32, limit: u32) -> Vec<Address> {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let all = Self::blocklist(&env);
        let total = all.len();
        let mut result: Vec<Address> = Vec::new(&env);
        let end = (start + limit).min(total);
        for i in start..end {
            if let Some(addr) = all.get(i) {
                result.push_back(addr);
            }
        }
        result
    }

    // ── Allowlist ────────────────────────────────────────────────────────────

    pub fn add_to_allowlist(env: Env, addr: Address) {
        Self::require_admin(&env);
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let mut list = Self::allowlist(&env);
        if !list.contains(&addr) {
            list.push_back(addr.clone());
        }
        env.storage().instance().set(&DataKey::Allowlist, &list);
        env.events().publish((symbol_short!("al_add"),), addr);
    }

    pub fn remove_from_allowlist(env: Env, addr: Address) {
        Self::require_admin(&env);
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let list = Self::allowlist(&env);
        let mut new_list: Vec<Address> = Vec::new(&env);
        for a in list.iter() {
            if a != addr {
                new_list.push_back(a);
            }
        }
        env.storage().instance().set(&DataKey::Allowlist, &new_list);
        env.events().publish((symbol_short!("al_rem"),), addr);
    }

    pub fn is_allowlisted(env: Env, addr: Address) -> bool {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        Self::allowlist(&env).contains(&addr)
    }

    // ── Jurisdiction blocklist ───────────────────────────────────────────────

    pub fn add_blocked_jurisdiction(env: Env, jurisdiction: String) {
        Self::require_admin(&env);
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let mut list = Self::get_blocked_jurisdictions(env.clone());
        if !list.contains(&jurisdiction) {
            list.push_back(jurisdiction.clone());
        }
        env.storage()
            .instance()
            .set(&DataKey::BlockedJurisdictions, &list);
        env.events()
            .publish((symbol_short!("jur_add"),), jurisdiction);
    }

    pub fn remove_blocked_jurisdiction(env: Env, jurisdiction: String) {
        Self::require_admin(&env);
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let list = Self::get_blocked_jurisdictions(env.clone());
        let mut new_list: Vec<String> = Vec::new(&env);
        for j in list.iter() {
            if j != jurisdiction {
                new_list.push_back(j);
            }
        }
        env.storage()
            .instance()
            .set(&DataKey::BlockedJurisdictions, &new_list);
        env.events()
            .publish((symbol_short!("jur_rem"),), jurisdiction);
    }

    pub fn get_blocked_jurisdictions(env: Env) -> Vec<String> {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage()
            .instance()
            .get(&DataKey::BlockedJurisdictions)
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn pause(env: Env) {
        Self::require_admin(&env);
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let mut rules: ComplianceRules = env.storage().instance().get(&DataKey::Rules).unwrap();
        rules.paused = true;
        env.storage().instance().set(&DataKey::Rules, &rules);
        env.events().publish((symbol_short!("paused"),), ());
    }

    pub fn unpause(env: Env) {
        Self::require_admin(&env);
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let mut rules: ComplianceRules = env.storage().instance().get(&DataKey::Rules).unwrap();
        rules.paused = false;
        env.storage().instance().set(&DataKey::Rules, &rules);
        env.events().publish((symbol_short!("unpaused"),), ());
    }

    // ── Transfer validation ──────────────────────────────────────────────────

    /// Returns `true` when the compliance rules permit a transfer.
    ///
    /// This function does **not** validate KYC state — callers are expected to
    /// check KYC separately before invoking it (as the legacy token contracts do).
    /// Panic-prone `get_record` / `get_tier` calls have been replaced with safe
    /// `get_record_opt` / `get_tier` (which returns 0 for missing records) so
    /// that a missing KYC record never causes a host trap: it results in a
    /// deterministic `false` instead.
    ///
    /// For a single call that validates both KYC state and all compliance rules
    /// use [`evaluate_transfer`].
    pub fn can_transfer(env: Env, from: Address, to: Address, amount: i128) -> bool {
        matches!(Self::evaluate_transfer_inner(&env, &from, &to, amount, false), TransferDecision::Allow)
    }

    /// Evaluates a transfer against both KYC state and all compliance rules.
    ///
    /// Unlike [`can_transfer`], this function explicitly resolves the KYC state
    /// for both parties first and returns a deterministic deny for missing,
    /// expired, revoked, rejected, or pending records — no host traps.
    ///
    /// Returns a [`TransferDecision`] whose `deny_reason` field identifies the
    /// first failing rule, enabling callers to surface a precise error.
    pub fn evaluate_transfer(env: Env, from: Address, to: Address, amount: i128) -> TransferDecision {
        Self::evaluate_transfer_inner(&env, &from, &to, amount, true)
    }

    /// Shared implementation for both `can_transfer` and `evaluate_transfer`.
    ///
    /// When `check_kyc` is `true` the function validates the KYC state of both
    /// parties before any other rule; when `false` it skips the KYC check
    /// (preserving the legacy `can_transfer` semantics for backward compat).
    fn evaluate_transfer_inner(
        env: &Env,
        from: &Address,
        to: &Address,
        amount: i128,
        check_kyc: bool,
    ) -> TransferDecision {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let rules: ComplianceRules = env.storage().instance().get(&DataKey::Rules).unwrap();

        if rules.paused {
            return TransferDecision::Deny(DenyReason::CompliancePaused);
        }

        let blocklist = Self::blocklist(env);
        if blocklist.contains(from) {
            return TransferDecision::Deny(DenyReason::FromBlocklisted);
        }
        if blocklist.contains(to) {
            return TransferDecision::Deny(DenyReason::ToBlocklisted);
        }

        // ── KYC state validation (evaluate_transfer only) ─────────────────────
        if check_kyc {
            let kyc_registry: Address =
                env.storage().instance().get(&DataKey::KycRegistry).unwrap();
            let kyc = kyc_iface::KycRegistryClient::new(env, &kyc_registry);

            let from_state = kyc.get_kyc_state(from);
            match from_state {
                kyc_iface::KycState::Missing  => return TransferDecision::Deny(DenyReason::FromKycMissing),
                kyc_iface::KycState::Expired  => return TransferDecision::Deny(DenyReason::FromKycExpired),
                kyc_iface::KycState::Revoked  => return TransferDecision::Deny(DenyReason::FromKycRevoked),
                kyc_iface::KycState::Rejected => return TransferDecision::Deny(DenyReason::FromKycRejected),
                kyc_iface::KycState::Pending  => return TransferDecision::Deny(DenyReason::FromKycPending),
                kyc_iface::KycState::Approved => {}
            }

            let to_state = kyc.get_kyc_state(to);
            match to_state {
                kyc_iface::KycState::Missing  => return TransferDecision::Deny(DenyReason::ToKycMissing),
                kyc_iface::KycState::Expired  => return TransferDecision::Deny(DenyReason::ToKycExpired),
                kyc_iface::KycState::Revoked  => return TransferDecision::Deny(DenyReason::ToKycRevoked),
                kyc_iface::KycState::Rejected => return TransferDecision::Deny(DenyReason::ToKycRejected),
                kyc_iface::KycState::Pending  => return TransferDecision::Deny(DenyReason::ToKycPending),
                kyc_iface::KycState::Approved => {}
            }
        }

        // ── Jurisdiction checks ───────────────────────────────────────────────
        // Use get_record_opt so missing KYC records never trap; a missing record
        // returns false for any active jurisdiction rule.
        let blocked_jurisdictions = Self::get_blocked_jurisdictions(env.clone());
        if !blocked_jurisdictions.is_empty() {
            let kyc_registry: Address =
                env.storage().instance().get(&DataKey::KycRegistry).unwrap();
            let kyc = kyc_iface::KycRegistryClient::new(env, &kyc_registry);
            match kyc.get_record_opt(from) {
                Some(r) if blocked_jurisdictions.contains(&r.jurisdiction) => {
                    return TransferDecision::Deny(DenyReason::FromJurisdictionBlocked);
                }
                None => return TransferDecision::Deny(DenyReason::FromJurisdictionBlocked),
                _ => {}
            }
            match kyc.get_record_opt(to) {
                Some(r) if blocked_jurisdictions.contains(&r.jurisdiction) => {
                    return TransferDecision::Deny(DenyReason::ToJurisdictionBlocked);
                }
                None => return TransferDecision::Deny(DenyReason::ToJurisdictionBlocked),
                _ => {}
            }
        }

        if rules.require_same_jurisdiction {
            let kyc_registry: Address =
                env.storage().instance().get(&DataKey::KycRegistry).unwrap();
            let kyc = kyc_iface::KycRegistryClient::new(env, &kyc_registry);
            match (kyc.get_record_opt(from), kyc.get_record_opt(to)) {
                (Some(fr), Some(tr)) if fr.jurisdiction != tr.jurisdiction => {
                    return TransferDecision::Deny(DenyReason::SameJurisdictionRequired);
                }
                (None, _) | (_, None) => {
                    return TransferDecision::Deny(DenyReason::SameJurisdictionRequired);
                }
                _ => {}
            }
        }

        // ── Amount / holding period / holder count ────────────────────────────

        if rules.max_transfer_amount > 0 && amount > rules.max_transfer_amount {
            return TransferDecision::Deny(DenyReason::AmountExceeded);
        }

        if rules.min_holding_period > 0 {
            let key = DataKey::HolderSince(from.clone());
            if let Some(since) = env.storage().persistent().get::<DataKey, u64>(&key) {
                let elapsed = env.ledger().timestamp().saturating_sub(since);
                if elapsed < rules.min_holding_period {
                    return TransferDecision::Deny(DenyReason::HoldingPeriodNotMet);
                }
            }
        }

        // If max_holding_period > 0, block the *recipient* from receiving more
        // tokens once they have exceeded their maximum holding window.
        // The *sender* is still allowed to transfer out (forced exit).
        if rules.max_holding_period > 0 {
            let key = DataKey::HolderSince(to.clone());
            if let Some(since) = env.storage().persistent().get::<DataKey, u64>(&key) {
                let elapsed = env.ledger().timestamp().saturating_sub(since);
                if elapsed >= rules.max_holding_period {
                    return TransferDecision::Deny(DenyReason::RecipientHoldingPeriodExceeded);
                }
            }
        }

        if rules.max_holders > 0 {
            let key = DataKey::HolderSince(to.clone());
            if !env.storage().persistent().has(&key) {
                let count = Self::holder_count(env.clone());
                if count >= rules.max_holders {
                    return TransferDecision::Deny(DenyReason::MaxHoldersReached);
                }
            }
        }

        // ── Tier-based policy evaluation ──────────────────────────────────────
        // Only perform the cross-contract KYC tier lookup when at least one tier
        // policy has been configured, to keep the no-policy path gas-free.
        // get_tier() now returns 0 for missing records — no host trap possible.
        let policy_count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::TierPolicyCount)
            .unwrap_or(0);
        if policy_count > 0 {
            let kyc_registry: Address =
                env.storage().instance().get(&DataKey::KycRegistry).unwrap();
            let kyc = kyc_iface::KycRegistryClient::new(env, &kyc_registry);
            let from_tier = kyc.get_tier(from);
            let to_tier = kyc.get_tier(to);

            // Resolution order: exact match > wildcard-from > wildcard-to > wildcard-both.
            let wildcard: u32 = u32::MAX;
            let policy: Option<TierPolicy> = env
                .storage()
                .instance()
                .get(&DataKey::TierPolicy(TierPolicyKey { from_tier, to_tier }))
                .or_else(|| {
                    env.storage().instance().get(&DataKey::TierPolicy(
                        TierPolicyKey { from_tier: wildcard, to_tier },
                    ))
                })
                .or_else(|| {
                    env.storage().instance().get(&DataKey::TierPolicy(
                        TierPolicyKey { from_tier, to_tier: wildcard },
                    ))
                })
                .or_else(|| {
                    env.storage().instance().get(&DataKey::TierPolicy(
                        TierPolicyKey { from_tier: wildcard, to_tier: wildcard },
                    ))
                });

            if let Some(p) = policy {
                if p.blocked {
                    return TransferDecision::Deny(DenyReason::TierPolicyBlocked);
                }
                if from_tier < p.min_from_tier {
                    return TransferDecision::Deny(DenyReason::TierFromBelowMin);
                }
                if to_tier < p.min_to_tier {
                    return TransferDecision::Deny(DenyReason::TierToBelowMin);
                }
                if p.max_transfer_amount > 0 {
                    let effective_max = if rules.max_transfer_amount > 0 {
                        p.max_transfer_amount.min(rules.max_transfer_amount)
                    } else {
                        p.max_transfer_amount
                    };
                    if amount > effective_max {
                        return TransferDecision::Deny(DenyReason::TierAmountExceeded);
                    }
                }
            }
        }

        // ── Jurisdiction risk scoring ──────────────────────────────────────────
        // Only active when a `RiskConfig` with `max_score > 0` has been set.
        // Uses get_record_opt so missing records get the default risk score
        // rather than trapping.
        if let Some(risk_cfg) = env
            .storage()
            .instance()
            .get::<DataKey, RiskConfig>(&DataKey::RiskConfig)
        {
            if risk_cfg.max_score > 0 {
                let kyc_registry: Address =
                    env.storage().instance().get(&DataKey::KycRegistry).unwrap();
                let kyc = kyc_iface::KycRegistryClient::new(env, &kyc_registry);

                let from_jur = kyc
                    .get_record_opt(from)
                    .map(|r| r.jurisdiction)
                    .unwrap_or_else(|| String::from_str(env, ""));
                let to_jur = kyc
                    .get_record_opt(to)
                    .map(|r| r.jurisdiction)
                    .unwrap_or_else(|| String::from_str(env, ""));

                let from_score: u32 = env
                    .storage()
                    .instance()
                    .get(&DataKey::JurisdictionRisk(from_jur))
                    .unwrap_or(risk_cfg.default_score);
                let to_score: u32 = env
                    .storage()
                    .instance()
                    .get(&DataKey::JurisdictionRisk(to_jur))
                    .unwrap_or(risk_cfg.default_score);

                if from_score > risk_cfg.max_score || to_score > risk_cfg.max_score {
                    return TransferDecision::Deny(DenyReason::RiskScoreTooHigh);
                }
            }
        }

        TransferDecision::Allow
    }

    pub fn register_holder(env: Env, addr: Address) {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let key = DataKey::HolderSince(addr.clone());
        let is_new = !env.storage().persistent().has(&key);
        env.storage()
            .persistent()
            .set(&key, &env.ledger().timestamp());
        env.storage().persistent().extend_ttl(&key, THRESHOLD, BUMP);
        if is_new {
            let count: u32 = env
                .storage()
                .instance()
                .get(&DataKey::HolderCount)
                .unwrap_or(0);
            env.storage()
                .instance()
                .set(&DataKey::HolderCount, &(count + 1));
        }
    }

    pub fn unregister_holder(env: Env, addr: Address) {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let key = DataKey::HolderSince(addr.clone());
        if env.storage().persistent().has(&key) {
            env.storage().persistent().remove(&key);
            let count: u32 = env
                .storage()
                .instance()
                .get(&DataKey::HolderCount)
                .unwrap_or(0);
            let new_count = if count > 0 { count - 1 } else { 0 };
            env.storage()
                .instance()
                .set(&DataKey::HolderCount, &new_count);
        }
    }

    pub fn holder_count(env: Env) -> u32 {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage()
            .instance()
            .get(&DataKey::HolderCount)
            .unwrap_or(0)
    }

    // ── Internals ────────────────────────────────────────────────────────────

    fn require_admin(env: &Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin must be set");
        admin.require_auth();
    }

    fn validate_rules(env: &Env, rules: &ComplianceRules) {
        if rules.min_holding_period > 31_536_000 {
            panic_with_error!(env, ComplianceError::MinHoldingPeriodExceeds365Days);
        }
        if rules.max_transfer_amount < 0 {
            panic_with_error!(env, ComplianceError::NegativeMaxTransferAmount);
        }
        if rules.max_holders > 0 {
            let count: u32 = env
                .storage()
                .instance()
                .get(&DataKey::HolderCount)
                .unwrap_or(0);
            if rules.max_holders < count {
                panic_with_error!(env, ComplianceError::MaxHoldersBelowCurrentCount);
            }
        }
    }

    fn blocklist(env: &Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::Blocklist)
            .unwrap_or_else(|| Vec::new(env))
    }

    fn allowlist(env: &Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::Allowlist)
            .unwrap_or_else(|| Vec::new(env))
    }

    pub fn version(env: Env) -> soroban_sdk::String {
        soroban_sdk::String::from_str(&env, env!("CARGO_PKG_VERSION"))
    }

    // ── Storage versioning / migration ────────────────────────────────────────

    /// Returns the current numeric schema version.
    ///
    /// Returns `0` for legacy deployments initialized before schema versioning
    /// was introduced.  New deployments start at `1` via `initialize`.
    pub fn schema_version(env: Env) -> u32 {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage()
            .instance()
            .get(&DataKey::StorageVersion)
            .unwrap_or(0)
    }

    /// Returns the number of schema migrations that have been applied.
    pub fn migration_count(env: Env) -> u32 {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage()
            .instance()
            .get(&DataKey::MigrationCount)
            .unwrap_or(0)
    }

    /// Returns the migration record at `index`, or panics if out of range.
    pub fn get_migration_record(env: Env, index: u32) -> ComplianceMigrationRecord {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage()
            .instance()
            .get(&DataKey::Migration(index))
            .expect("migration record not found")
    }

    /// Admin-only upgrade hook.  Advances the schema version by exactly one.
    ///
    /// Rules:
    /// - Caller must be the registered admin.
    /// - `to_version` must equal `current_schema_version + 1`.
    /// - For legacy deployments without a `StorageVersion` key, the current
    ///   version is treated as `0`, so the first valid call is
    ///   `migrate_schema(1, ...)` (the bootstrap migration).
    ///
    /// Add a new `to_version =>` match arm here when the storage schema changes.
    pub fn migrate_schema(env: Env, to_version: u32, description: String) {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        Self::require_admin(&env);

        let current: u32 = env
            .storage()
            .instance()
            .get(&DataKey::StorageVersion)
            .unwrap_or(0);

        if to_version == current {
            panic_with_error!(env, ComplianceError::AlreadyAtSchemaVersion);
        }
        if to_version != current + 1 {
            panic_with_error!(env, ComplianceError::MigrationVersionNotSequential);
        }

        // ── Per-version migration hooks ────────────────────────────────────
        // Add a new `to_version =>` arm here when the storage schema changes.
        match to_version {
            1 => {
                // Bootstrap: record that this deployment is now at schema v1.
                // The v0 and v1 layouts are identical; no data transformation.
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
        let record = ComplianceMigrationRecord {
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

    // ── Tier-based policy ─────────────────────────────────────────────────────

    /// Admin-only: set or update the transfer policy for a specific KYC tier pair.
    ///
    /// `from_tier` is the sender's KYC tier; `to_tier` is the recipient's KYC tier.
    /// Use `u32::MAX` as a wildcard to match any tier on either side.
    ///
    /// Tier policies are evaluated in `can_transfer` after the global rule-set
    /// checks.  Exact (from_tier, to_tier) matches take precedence over wildcards.
    ///
    /// Emits a `tier_pol` event containing the `(from_tier, to_tier)` key.
    pub fn set_tier_policy(env: Env, from_tier: u32, to_tier: u32, policy: TierPolicy) {
        Self::require_admin(&env);
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let key = DataKey::TierPolicy(TierPolicyKey { from_tier, to_tier });
        let is_new = !env.storage().instance().has(&key);
        env.storage().instance().set(&key, &policy);
        if is_new {
            let count: u32 = env
                .storage()
                .instance()
                .get(&DataKey::TierPolicyCount)
                .unwrap_or(0);
            env.storage()
                .instance()
                .set(&DataKey::TierPolicyCount, &(count + 1));
        }
        env.events()
            .publish((symbol_short!("tier_pol"),), (from_tier, to_tier));
    }

    /// Returns the tier policy for the given tier pair, or `None` if unset.
    pub fn get_tier_policy(env: Env, from_tier: u32, to_tier: u32) -> Option<TierPolicy> {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let key = DataKey::TierPolicy(TierPolicyKey { from_tier, to_tier });
        env.storage().instance().get(&key)
    }

    /// Admin-only: remove the tier policy for the given tier pair.
    pub fn clear_tier_policy(env: Env, from_tier: u32, to_tier: u32) {
        Self::require_admin(&env);
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let key = DataKey::TierPolicy(TierPolicyKey { from_tier, to_tier });
        if env.storage().instance().has(&key) {
            env.storage().instance().remove(&key);
            let count: u32 = env
                .storage()
                .instance()
                .get(&DataKey::TierPolicyCount)
                .unwrap_or(0);
            env.storage()
                .instance()
                .set(&DataKey::TierPolicyCount, &count.saturating_sub(1));
        }
        env.events()
            .publish((symbol_short!("tier_clr"),), (from_tier, to_tier));
    }

    /// Returns the total number of configured tier policies.
    pub fn tier_policy_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::TierPolicyCount)
            .unwrap_or(0)
    }

    // ── Jurisdiction risk scoring ─────────────────────────────────────────────

    /// Admin-only: set the risk configuration.
    ///
    /// - `max_score`: Maximum score allowed for either party's jurisdiction.
    ///   Transfers where any party exceeds this score are blocked.
    ///   Set to `0` to **disable** risk-score enforcement entirely.
    /// - `default_score`: Score applied to jurisdictions without an explicit entry.
    ///   Range: 0–100.
    ///
    /// ## Validation
    /// - `max_score` must be in `[0, 100]`.
    /// - `default_score` must be in `[0, 100]`.
    ///
    /// ## Quick-disable
    /// ```bash
    /// stellar contract invoke -- set_risk_config --max-score 0 --default-score 0
    /// ```
    pub fn set_risk_config(env: Env, config: RiskConfig) {
        Self::require_admin(&env);
        if config.max_score > 100 {
            panic_with_error!(env, ComplianceError::InvalidRiskConfig);
        }
        if config.default_score > 100 {
            panic_with_error!(env, ComplianceError::InvalidRiskConfig);
        }
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage().instance().set(&DataKey::RiskConfig, &config);
        env.events()
            .publish((symbol_short!("risk_cfg"),), (config.max_score, config.default_score));
    }

    /// Returns the current risk configuration, or `None` if never set
    /// (meaning risk scoring is inactive).
    pub fn get_risk_config(env: Env) -> Option<RiskConfig> {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage().instance().get(&DataKey::RiskConfig)
    }

    /// Admin-only: assign a risk score to a jurisdiction.
    ///
    /// `jurisdiction` must be a 2-letter ISO-3166-1 alpha-2 code (e.g. `"US"`, `"KP"`).
    /// `score` must be in `[0, 100]`.
    ///
    /// ## Example: mark North Korea as maximum risk
    /// ```bash
    /// stellar contract invoke -- set_jurisdiction_risk_score --jurisdiction KP --score 100
    /// ```
    pub fn set_jurisdiction_risk_score(env: Env, jurisdiction: String, score: u32) {
        Self::require_admin(&env);
        if score > 100 {
            panic_with_error!(env, ComplianceError::InvalidRiskScore);
        }
        // Validate ISO-3166-1 alpha-2: exactly 2 uppercase ASCII letters.
        if jurisdiction.len() != 2 {
            panic_with_error!(env, ComplianceError::InvalidRiskScore);
        }
        let mut bytes = [0u8; 2];
        jurisdiction.copy_into_slice(&mut bytes);
        if bytes[0] < b'A' || bytes[0] > b'Z' || bytes[1] < b'A' || bytes[1] > b'Z' {
            panic_with_error!(env, ComplianceError::InvalidRiskScore);
        }
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage()
            .instance()
            .set(&DataKey::JurisdictionRisk(jurisdiction.clone()), &score);
        env.events()
            .publish((symbol_short!("risk_jur"),), (jurisdiction, score));
    }

    /// Returns the explicit risk score for a jurisdiction, or `None` if unset.
    /// When unset the `default_score` from `RiskConfig` applies.
    pub fn get_jurisdiction_risk_score(env: Env, jurisdiction: String) -> Option<u32> {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage()
            .instance()
            .get(&DataKey::JurisdictionRisk(jurisdiction))
    }

    /// Admin-only: remove an explicit risk score for a jurisdiction.
    /// After removal the `default_score` from `RiskConfig` applies again.
    pub fn clear_jurisdiction_risk_score(env: Env, jurisdiction: String) {
        Self::require_admin(&env);
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage()
            .instance()
            .remove(&DataKey::JurisdictionRisk(jurisdiction.clone()));
        env.events()
            .publish((symbol_short!("risk_clr"),), jurisdiction);
    }

    /// Read-only: compute the effective risk scores for a transfer's parties.
    ///
    /// Returns `(from_score, to_score, blocked)`.
    /// `blocked` is `true` when either score exceeds the configured `max_score`.
    /// Returns `(0, 0, false)` when risk scoring is not configured (`max_score == 0`).
    pub fn evaluate_transfer_risk(env: Env, from_jurisdiction: String, to_jurisdiction: String) -> (u32, u32, bool) {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let config: Option<RiskConfig> = env
            .storage()
            .instance()
            .get(&DataKey::RiskConfig);

        match config {
            None => (0, 0, false),
            Some(cfg) if cfg.max_score == 0 => (0, 0, false),
            Some(cfg) => {
                let from_score: u32 = env
                    .storage()
                    .instance()
                    .get(&DataKey::JurisdictionRisk(from_jurisdiction))
                    .unwrap_or(cfg.default_score);
                let to_score: u32 = env
                    .storage()
                    .instance()
                    .get(&DataKey::JurisdictionRisk(to_jurisdiction))
                    .unwrap_or(cfg.default_score);
                let blocked = from_score > cfg.max_score || to_score > cfg.max_score;
                (from_score, to_score, blocked)
            }
        }
    }
}

mod kyc_iface {
    use soroban_sdk::{contractclient, contracttype, Address, String};

    /// Mirrors `kyc_registry::KycState` — variant names must stay identical
    /// for the XDR encoding to round-trip correctly across the contract boundary.
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
    pub trait KycRegistry {
        /// Returns the resolved KYC state without panicking on missing records.
        fn get_kyc_state(env: soroban_sdk::Env, addr: Address) -> KycState;
        /// Returns the KYC record or `None` — never panics.
        fn get_record_opt(env: soroban_sdk::Env, addr: Address) -> Option<KycRecord>;
        /// Returns the tier (0 when no record exists — never panics).
        fn get_tier(env: soroban_sdk::Env, addr: Address) -> u32;
    }
}
