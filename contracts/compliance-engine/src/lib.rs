#![no_std]
#![cfg_attr(not(test), deny(clippy::unwrap_used))]

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, panic_with_error, symbol_short,
    Address, Env, String, Vec,
};

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

    pub fn can_transfer(env: Env, from: Address, to: Address, amount: i128) -> bool {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let rules: ComplianceRules = env.storage().instance().get(&DataKey::Rules).unwrap();

        if rules.paused {
            return false;
        }

        let blocklist = Self::blocklist(&env);
        if blocklist.contains(&from) || blocklist.contains(&to) {
            return false;
        }

        let blocked_jurisdictions = Self::get_blocked_jurisdictions(env.clone());
        if !blocked_jurisdictions.is_empty() {
            let kyc_registry: Address = env
                .storage()
                .instance()
                .get(&DataKey::KycRegistry)
                .unwrap();
            let kyc = kyc_iface::KycRegistryClient::new(&env, &kyc_registry);
            let from_record = kyc.get_record(&from);
            let to_record = kyc.get_record(&to);
            if blocked_jurisdictions.contains(&from_record.jurisdiction)
                || blocked_jurisdictions.contains(&to_record.jurisdiction)
            {
                return false;
            }
        }

        if rules.require_same_jurisdiction {
            let kyc_registry: Address = env
                .storage()
                .instance()
                .get(&DataKey::KycRegistry)
                .unwrap();
            let kyc = kyc_iface::KycRegistryClient::new(&env, &kyc_registry);
            let from_record = kyc.get_record(&from);
            let to_record = kyc.get_record(&to);
            if from_record.jurisdiction != to_record.jurisdiction {
                return false;
            }
        }

        if rules.max_transfer_amount > 0 && amount > rules.max_transfer_amount {
            return false;
        }

        if rules.min_holding_period > 0 {
            let key = DataKey::HolderSince(from.clone());
            if let Some(since) = env.storage().persistent().get::<DataKey, u64>(&key) {
                let elapsed = env.ledger().timestamp().saturating_sub(since);
                if elapsed < rules.min_holding_period {
                    return false;
                }
            }
        }

        // ── Max holding period (forced-exit window) ───────────────────────────
        // If max_holding_period > 0, block the *recipient* (`to`) from receiving
        // more tokens once they have already exceeded their maximum holding window.
        // The *sender* (`from`) is still allowed to transfer out (forced exit).
        if rules.max_holding_period > 0 {
            let key = DataKey::HolderSince(to.clone());
            if let Some(since) = env.storage().persistent().get::<DataKey, u64>(&key) {
                let elapsed = env.ledger().timestamp().saturating_sub(since);
                if elapsed >= rules.max_holding_period {
                    return false;
                }
            }
        }

        if rules.max_holders > 0 {
            let key = DataKey::HolderSince(to.clone());
            if !env.storage().persistent().has(&key) {
                let count = Self::holder_count(env);
                if count >= rules.max_holders {
                    return false;
                }
            }
        }

        true
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
}

mod kyc_iface {
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
    pub trait KycRegistry {
        fn get_record(env: soroban_sdk::Env, addr: Address) -> KycRecord;
    }
}
