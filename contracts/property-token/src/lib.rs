#![no_std]
#![cfg_attr(not(test), deny(clippy::unwrap_used))]

//! Property Token — fractional ownership of real estate.
//! Each token = 1 share out of total_shares. Dividends distributed in XLM/USDC.
//! Minting is admin-gated and still enforces active KYC, the configured minimum
//! KYC tier, and mint-time compliance checks for pause/blocklist rules.

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    Env, String, Vec,
};
use token_helpers as th;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PropertyError {
    AlreadyInitialized = 1,
    NegativeShares = 2,
    InsufficientShares = 3,
    NoShares = 4,
    KycNotApproved = 5,
    KycTierTooLow = 6,
    CompliancePaused = 7,
    Blocklisted = 8,
    TransferBlocked = 9,
    /// A required metadata field contains an invalid value.
    InvalidMetadata = 10,
    InvalidDividendAmount = 11,
    InvalidDistributionType = 12,
    DividendMathOverflow = 13,
    InsufficientDividendPool = 14,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum DistributionType {
    Rent = 0,
    Capital = 1,
    Other = 2,
}

#[contracttype]
pub enum DataKey {
    PropertyMeta,
    Balance(Address),
    TotalShares,
    DividendPool,
    ClaimedDividend(Address),
    Unclaimed(Address),
    DividendPerShare,
    /// SEP-41 delegated-transfer allowance: (owner, spender) → AllowanceValue.
    Allowance(AllowanceKey),
    HolderList,
    HolderCount,
    DividendDeposit(u32),
    DividendDepositCount,
    UnclaimedRent(Address),
    UnclaimedCapital(Address),
    DividendPerShareRent,
    DividendPerShareCapital,
    ClaimedDividendRent(Address),
    ClaimedDividendCapital(Address),
    MintedShares,
    ForcedTransferCount,
    ForcedTransferLog(u32),
    DividendAccountingVersion,
    DistributionCheckpoint(u32),
    HolderDividendCheckpoint(Address),
}

#[contracttype]
#[derive(Clone)]
pub struct DividendEvent {
    pub amount: i128,
    pub timestamp: u64,
    pub running_total_dps: i128,
    pub distribution_type: u32,
}

/// Immutable accounting record for one dividend distribution.
///
/// `allocated_amount + remainder == amount`. The remainder makes integer
/// division explicit instead of leaving an unauditable difference in the pool.
#[contracttype]
#[derive(Clone)]
pub struct DistributionCheckpoint {
    pub id: u32,
    pub amount: i128,
    pub allocated_amount: i128,
    pub remainder: i128,
    pub per_share: i128,
    pub cumulative_per_share: i128,
    pub rent_cumulative_per_share: i128,
    pub capital_cumulative_per_share: i128,
    pub other_cumulative_per_share: i128,
    pub type_cumulative_per_share: i128,
    pub total_shares: i128,
    pub timestamp: u64,
    pub distribution_type: u32,
}

/// Reconciled holder state at a distribution boundary.
///
/// The three typed amounts are subsets of `unclaimed_total`; keeping them in
/// one record lets a typed claim reduce the aggregate claimable amount and
/// prevents the same distribution from being withdrawn twice.
#[contracttype]
#[derive(Clone)]
pub struct HolderDividendCheckpoint {
    pub distribution_count: u32,
    pub balance: i128,
    pub total_index: i128,
    pub rent_index: i128,
    pub capital_index: i128,
    pub unclaimed_total: i128,
    pub unclaimed_rent: i128,
    pub unclaimed_capital: i128,
    pub claimed_total: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct UnclaimedBalance {
    pub total: i128,
    pub rent: i128,
    pub capital: i128,
    pub other: i128,
    pub distribution_count: u32,
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
pub struct ForcedTransferEntry {
    pub from: Address,
    pub to: Address,
    pub shares: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct PropertyMeta {
    pub property_id: String,
    pub legal_name: String,
    pub jurisdiction: String,
    pub address: String,
    pub total_valuation_usd: i128,
    pub total_shares: i128,
    pub property_type: String,   // "residential" | "commercial" | "land"
    pub ipfs_title_hash: String, // off-chain title document anchor
    pub kyc_tier_required: u32,  // minimum KYC tier for shareholders
}

const DAY_IN_LEDGERS: u32 = 17280;
const BUMP: u32 = 365 * DAY_IN_LEDGERS;
const THRESHOLD: u32 = BUMP - DAY_IN_LEDGERS;
const DIVIDEND_ACCOUNTING_VERSION: u32 = 1;

#[contract]
pub struct PropertyToken;

#[contractimpl]
impl PropertyToken {
    fn validate_property_type(env: &Env, pt: &String) {
        if *pt != String::from_str(env, "residential")
            && *pt != String::from_str(env, "commercial")
            && *pt != String::from_str(env, "land")
        {
            panic!("invalid property_type");
        }
    }

    fn validate_property_meta(env: &Env, meta: &PropertyMeta) {
        if !th::is_valid_legal_entity(&meta.legal_name) {
            panic_with_error!(env, PropertyError::InvalidMetadata);
        }
        if !th::is_valid_legal_entity(&meta.jurisdiction) {
            panic_with_error!(env, PropertyError::InvalidMetadata);
        }
        if !th::is_valid_ipfs_hash(&meta.ipfs_title_hash) {
            panic_with_error!(env, PropertyError::InvalidMetadata);
        }
    }

    /// Constructor — called atomically at deploy time via `stellar contract deploy -- --admin ...`.
    /// Eliminates the deploy→initialize front-running window.
    pub fn __constructor(
        env: Env,
        admin: Address,
        kyc_registry: Address,
        compliance_engine: Address,
        meta: PropertyMeta,
    ) {
        Self::validate_property_type(&env, &meta.property_type);
        Self::validate_property_meta(&env, &meta);
        th::write_admin(&env, &admin);
        th::write_kyc_registry(&env, &kyc_registry);
        th::write_compliance_engine(&env, &compliance_engine);
        env.storage()
            .instance()
            .set(&DataKey::TotalShares, &meta.total_shares);
        env.storage().instance().set(&DataKey::DividendPool, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::DividendPerShare, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::DividendPerShareRent, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::DividendPerShareCapital, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::DividendDepositCount, &0u32);
        env.storage().instance().set(
            &DataKey::DividendAccountingVersion,
            &DIVIDEND_ACCOUNTING_VERSION,
        );
        env.storage().instance().set(&DataKey::PropertyMeta, &meta);
    }

    /// Legacy entry point — always panics to prevent post-deploy initialization.
    pub fn initialize(
        env: Env,
        _admin: Address,
        _kyc_registry: Address,
        _compliance_engine: Address,
        _meta: PropertyMeta,
    ) {
        panic_with_error!(env, PropertyError::AlreadyInitialized);
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    pub fn update_kyc_registry(env: Env, new_registry: Address) {
        th::update_kyc_registry(&env, new_registry);
    }

    pub fn update_compliance_engine(env: Env, new_engine: Address) {
        th::update_compliance_engine(&env, new_engine);
    }

    pub fn propose_admin(env: Env, new_admin: Address) {
        th::propose_admin(&env, new_admin);
    }

    pub fn accept_admin(env: Env) {
        th::accept_admin(&env);
    }

    // ── Metadata ─────────────────────────────────────────────────────────────

    pub fn get_meta(env: Env) -> PropertyMeta {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage()
            .instance()
            .get(&DataKey::PropertyMeta)
            .expect("property meta must be set")
    }

    pub fn update_meta(env: Env, new_meta: PropertyMeta) {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        th::require_admin(&env);
        Self::validate_property_type(&env, &new_meta.property_type);
        Self::validate_property_meta(&env, &new_meta);
        let current: PropertyMeta = env
            .storage()
            .instance()
            .get(&DataKey::PropertyMeta)
            .expect("property meta must be set");
        if new_meta.property_id != current.property_id
            || new_meta.total_shares != current.total_shares
        {
            panic!("Cannot change property_id or total_shares");
        }
        env.storage()
            .instance()
            .set(&DataKey::PropertyMeta, &new_meta);
        env.events().publish((symbol_short!("meta_upd"),), ());
    }

    pub fn name(env: Env) -> String {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        String::from_str(&env, "Veritoken Property")
    }
    pub fn symbol(env: Env) -> String {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        String::from_str(&env, "VTPROP")
    }
    pub fn decimals(env: Env) -> u32 {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        0
    }

    // ── Share management ─────────────────────────────────────────────────────

    pub fn mint(env: Env, to: Address, shares: i128) {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        th::require_admin(&env);
        if !th::is_kyc_approved(&env, &to) {
            panic_with_error!(env, PropertyError::KycNotApproved);
        }
        Self::require_tier(&env, &to);
        let meta: PropertyMeta = env
            .storage()
            .instance()
            .get(&DataKey::PropertyMeta)
            .expect("property meta must be set");
        let admin = th::read_admin(&env);
        if !th::can_transfer_compliance(&env, &admin, &to, shares) {
            panic!("mint blocked by compliance");
        }
        if shares <= 0 {
            panic_with_error!(env, PropertyError::NegativeShares);
        }
        let total_shares: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalShares)
            .expect("total shares must be set");
        let mut outstanding: i128 = 0;
        let holders: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::HolderList)
            .unwrap_or_else(|| Vec::new(&env));
        for holder in holders.iter() {
            outstanding += Self::read_balance(&env, holder);
        }
        if outstanding + shares > total_shares {
            panic!("exceeds authorized share count");
        }
        let _ = meta; // validation used above
        Self::accrue(&env, to.clone());
        let bal = Self::read_balance(&env, to.clone());
        Self::write_balance(&env, to.clone(), bal + shares);
        Self::reset_debt(&env, to.clone());
        th::do_register_holder(&env, &to);
        Self::add_holder_local(&env, &to);
        let minted: i128 = env
            .storage()
            .instance()
            .get(&DataKey::MintedShares)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::MintedShares, &(minted + shares));
        env.events().publish((symbol_short!("mint"), to), shares);
    }

    pub fn transfer(env: Env, from: Address, to: Address, shares: i128) {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        from.require_auth();
        if !th::is_kyc_approved(&env, &from) {
            panic_with_error!(env, PropertyError::KycNotApproved);
        }
        if !th::is_kyc_approved(&env, &to) {
            panic_with_error!(env, PropertyError::KycNotApproved);
        }
        Self::require_tier(&env, &to);
        if !th::can_transfer_compliance(&env, &from, &to, shares) {
            panic_with_error!(env, PropertyError::TransferBlocked);
        }
        if shares <= 0 {
            panic_with_error!(env, PropertyError::NegativeShares);
        }
        Self::accrue(&env, from.clone());
        Self::accrue(&env, to.clone());
        let from_bal = Self::read_balance(&env, from.clone());
        if from_bal < shares {
            panic_with_error!(env, PropertyError::InsufficientShares);
        }
        Self::write_balance(&env, from.clone(), from_bal - shares);
        let to_bal = Self::read_balance(&env, to.clone());
        Self::write_balance(&env, to.clone(), to_bal + shares);
        Self::reset_debt(&env, from.clone());
        Self::reset_debt(&env, to.clone());
        th::do_register_holder(&env, &to);
        Self::add_holder_local(&env, &to);
        if from_bal == shares {
            Self::remove_holder_local(&env, &from);
        }
        env.events()
            .publish((symbol_short!("transfer"), from, to), shares);
    }

    /// Admin-initiated buyback (forced redemption) of shares from a holder.
    pub fn buyback(env: Env, from: Address, shares: i128) {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        th::require_admin(&env);
        if !th::is_kyc_approved(&env, &from) {
            panic_with_error!(env, PropertyError::KycNotApproved);
        }
        if shares <= 0 {
            panic_with_error!(env, PropertyError::NegativeShares);
        }
        Self::accrue(&env, from.clone());
        let balance = Self::read_balance(&env, from.clone());
        if balance < shares {
            panic_with_error!(env, PropertyError::InsufficientShares);
        }
        Self::write_balance(&env, from.clone(), balance - shares);
        let total: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalShares)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalShares, &(total - shares));
        Self::reset_debt(&env, from.clone());
        if balance == shares {
            Self::remove_holder_local(&env, &from);
        }
        let minted: i128 = env
            .storage()
            .instance()
            .get(&DataKey::MintedShares)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::MintedShares, &(minted - shares));
        env.events()
            .publish((symbol_short!("buyback"),), (from, shares));
    }

    // ── SEP-41 Allowance / Delegated Transfer ───────────────────────────────

    pub fn approve(
        env: Env,
        from: Address,
        spender: Address,
        amount: i128,
        expiration_ledger: u32,
    ) {
        from.require_auth();
        if amount > 0 && expiration_ledger < env.ledger().sequence() {
            panic!("expiration_ledger is in the past");
        }
        let key = DataKey::Allowance(AllowanceKey {
            from: from.clone(),
            spender: spender.clone(),
        });
        let value = AllowanceValue {
            amount,
            expiration_ledger,
        };
        env.storage().temporary().set(&key, &value);
        if amount > 0 {
            let ttl = expiration_ledger - env.ledger().sequence();
            env.storage().temporary().extend_ttl(&key, ttl, ttl);
        }
        env.events().publish(
            (symbol_short!("approve"), from, spender),
            (amount, expiration_ledger),
        );
    }

    pub fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        Self::read_allowance(&env, from, spender).amount
    }

    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, shares: i128) {
        spender.require_auth();
        if !th::is_kyc_approved(&env, &from) {
            panic_with_error!(env, PropertyError::KycNotApproved);
        }
        if !th::is_kyc_approved(&env, &to) {
            panic_with_error!(env, PropertyError::KycNotApproved);
        }
        Self::require_tier(&env, &to);
        if !th::can_transfer_compliance(&env, &from, &to, shares) {
            panic_with_error!(env, PropertyError::TransferBlocked);
        }
        if shares <= 0 {
            panic!("shares must be positive");
        }
        Self::spend_allowance(&env, from.clone(), spender, shares);
        Self::accrue(&env, from.clone());
        Self::accrue(&env, to.clone());
        let from_bal = Self::read_balance(&env, from.clone());
        if from_bal < shares {
            panic!("insufficient shares");
        }
        Self::write_balance(&env, from.clone(), from_bal - shares);
        let to_bal = Self::read_balance(&env, to.clone());
        Self::write_balance(&env, to.clone(), to_bal + shares);
        Self::reset_debt(&env, from.clone());
        Self::reset_debt(&env, to.clone());
        th::do_register_holder(&env, &to);
        Self::add_holder_local(&env, &to);
        if from_bal == shares {
            Self::remove_holder_local(&env, &from);
        }
        env.events()
            .publish((symbol_short!("transfer"), from, to), shares);
    }

    // ── Dividends ────────────────────────────────────────────────────────────

    pub fn deposit_dividend(env: Env, amount: i128, distribution_type: u32) {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        th::require_admin(&env);
        if amount <= 0 {
            panic_with_error!(env, PropertyError::InvalidDividendAmount);
        }
        if distribution_type > DistributionType::Other as u32 {
            panic_with_error!(env, PropertyError::InvalidDistributionType);
        }
        let total: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalShares)
            .expect("total shares must be set");
        if total <= 0 {
            panic_with_error!(env, PropertyError::NoShares);
        }
        let per_share = amount / total;
        let dps: i128 = env
            .storage()
            .instance()
            .get(&DataKey::DividendPerShare)
            .unwrap_or(0);
        let new_dps = Self::checked_add(&env, dps, per_share);
        env.storage()
            .instance()
            .set(&DataKey::DividendPerShare, &new_dps);

        let dps_rent = Self::rent_dps(&env);
        let dps_capital = Self::capital_dps(&env);
        let (rent_cumulative_per_share, capital_cumulative_per_share) =
            if distribution_type == DistributionType::Rent as u32 {
                let next = Self::checked_add(&env, dps_rent, per_share);
                env.storage()
                    .instance()
                    .set(&DataKey::DividendPerShareRent, &next);
                (next, dps_capital)
            } else if distribution_type == DistributionType::Capital as u32 {
                let next = Self::checked_add(&env, dps_capital, per_share);
                env.storage()
                    .instance()
                    .set(&DataKey::DividendPerShareCapital, &next);
                (dps_rent, next)
            } else {
                (dps_rent, dps_capital)
            };
        let other_cumulative_per_share = Self::checked_sub(
            &env,
            Self::checked_sub(&env, new_dps, rent_cumulative_per_share),
            capital_cumulative_per_share,
        );
        let type_cumulative_per_share = if distribution_type == DistributionType::Rent as u32 {
            rent_cumulative_per_share
        } else if distribution_type == DistributionType::Capital as u32 {
            capital_cumulative_per_share
        } else {
            other_cumulative_per_share
        };

        let pool: i128 = env
            .storage()
            .instance()
            .get(&DataKey::DividendPool)
            .unwrap_or(0);
        env.storage().instance().set(
            &DataKey::DividendPool,
            &Self::checked_add(&env, pool, amount),
        );

        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::DividendDepositCount)
            .unwrap_or(0);
        let allocated_amount = Self::checked_mul(&env, per_share, total);
        let checkpoint = DistributionCheckpoint {
            id: count,
            amount,
            allocated_amount,
            remainder: Self::checked_sub(&env, amount, allocated_amount),
            per_share,
            cumulative_per_share: new_dps,
            rent_cumulative_per_share,
            capital_cumulative_per_share,
            other_cumulative_per_share,
            type_cumulative_per_share,
            total_shares: total,
            timestamp: env.ledger().timestamp(),
            distribution_type,
        };
        let checkpoint_key = DataKey::DistributionCheckpoint(count);
        env.storage().persistent().set(&checkpoint_key, &checkpoint);
        env.storage()
            .persistent()
            .extend_ttl(&checkpoint_key, THRESHOLD, BUMP);

        let event = DividendEvent {
            amount,
            timestamp: checkpoint.timestamp,
            running_total_dps: new_dps,
            distribution_type,
        };
        let deposit_key = DataKey::DividendDeposit(count);
        env.storage().persistent().set(&deposit_key, &event);
        env.storage()
            .persistent()
            .extend_ttl(&deposit_key, THRESHOLD, BUMP);
        env.storage()
            .instance()
            .set(&DataKey::DividendDepositCount, &(count + 1));
        env.storage().instance().set(
            &DataKey::DividendAccountingVersion,
            &DIVIDEND_ACCOUNTING_VERSION,
        );

        // Preserve the existing event ABI and add a separate checkpoint event
        // for indexers that need reconciliation metadata.
        env.events()
            .publish((symbol_short!("div_dep"),), (amount, distribution_type));
        env.events().publish(
            (symbol_short!("dist_chk"), count),
            (allocated_amount, checkpoint.remainder, per_share),
        );
    }

    pub fn dividend_accounting_version(env: Env) -> u32 {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage()
            .instance()
            .get(&DataKey::DividendAccountingVersion)
            .unwrap_or(0)
    }

    pub fn dividend_deposit_count(env: Env) -> u32 {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage()
            .instance()
            .get(&DataKey::DividendDepositCount)
            .unwrap_or(0)
    }

    pub fn get_distribution(env: Env, id: u32) -> Option<DistributionCheckpoint> {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let key = DataKey::DistributionCheckpoint(id);
        let checkpoint = env
            .storage()
            .persistent()
            .get::<DataKey, DistributionCheckpoint>(&key);
        if checkpoint.is_some() {
            env.storage().persistent().extend_ttl(&key, THRESHOLD, BUMP);
        }
        checkpoint
    }

    pub fn get_distributions(env: Env, start: u32, limit: u32) -> Vec<DistributionCheckpoint> {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::DividendDepositCount)
            .unwrap_or(0);
        let capped = limit.min(50);
        let end = start.saturating_add(capped).min(count);
        let mut out = Vec::new(&env);
        for id in start..end {
            let key = DataKey::DistributionCheckpoint(id);
            if let Some(checkpoint) = env
                .storage()
                .persistent()
                .get::<DataKey, DistributionCheckpoint>(&key)
            {
                env.storage().persistent().extend_ttl(&key, THRESHOLD, BUMP);
                out.push_back(checkpoint);
            }
        }
        out
    }

    pub fn get_dividend_history(env: Env, start: u32, limit: u32) -> Vec<DividendEvent> {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::DividendDepositCount)
            .unwrap_or(0);
        let capped = limit.min(50);
        let end = (start + capped).min(count);
        let mut out = Vec::new(&env);
        for i in start..end {
            let event: DividendEvent = env
                .storage()
                .persistent()
                .get(&DataKey::DividendDeposit(i))
                .expect("dividend event not found");
            out.push_back(event);
        }
        out
    }

    pub fn claim_dividend(env: Env, holder: Address) -> i128 {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        holder.require_auth();
        let mut checkpoint = Self::settle_holder(&env, holder.clone());
        let amount = checkpoint.unclaimed_total;
        if amount <= 0 {
            return 0;
        }
        checkpoint.unclaimed_total = 0;
        checkpoint.unclaimed_rent = 0;
        checkpoint.unclaimed_capital = 0;
        checkpoint.claimed_total = Self::checked_add(&env, checkpoint.claimed_total, amount);
        Self::store_holder_checkpoint(&env, &holder, &checkpoint);
        Self::withdraw_dividend_pool(&env, amount);
        env.events()
            .publish((symbol_short!("div_claim"), holder), amount);
        amount
    }

    pub fn pending_dividend(env: Env, holder: Address) -> i128 {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        Self::preview_holder_checkpoint(&env, holder).unclaimed_total
    }

    pub fn unclaimed_balance(env: Env, holder: Address) -> UnclaimedBalance {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let checkpoint = Self::preview_holder_checkpoint(&env, holder);
        let typed = Self::checked_add(
            &env,
            checkpoint.unclaimed_rent,
            checkpoint.unclaimed_capital,
        );
        let other = if checkpoint.unclaimed_total > typed {
            checkpoint.unclaimed_total - typed
        } else {
            0
        };
        UnclaimedBalance {
            total: checkpoint.unclaimed_total,
            rent: checkpoint.unclaimed_rent,
            capital: checkpoint.unclaimed_capital,
            other,
            distribution_count: checkpoint.distribution_count,
        }
    }

    pub fn holder_dividend_checkpoint(env: Env, holder: Address) -> HolderDividendCheckpoint {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        Self::preview_holder_checkpoint(&env, holder)
    }

    pub fn dividend_pool(env: Env) -> i128 {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage()
            .instance()
            .get(&DataKey::DividendPool)
            .unwrap_or(0)
    }

    pub fn claim_rent_yield(env: Env, holder: Address) -> i128 {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        holder.require_auth();
        let mut checkpoint = Self::settle_holder(&env, holder.clone());
        let amount = checkpoint.unclaimed_rent;
        if amount <= 0 {
            return 0;
        }
        checkpoint.unclaimed_rent = 0;
        checkpoint.unclaimed_total = Self::checked_sub(&env, checkpoint.unclaimed_total, amount);
        checkpoint.claimed_total = Self::checked_add(&env, checkpoint.claimed_total, amount);
        Self::store_holder_checkpoint(&env, &holder, &checkpoint);
        Self::withdraw_dividend_pool(&env, amount);
        env.events()
            .publish((symbol_short!("rent_clm"), holder), amount);
        amount
    }

    pub fn claim_capital_return(env: Env, holder: Address) -> i128 {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        holder.require_auth();
        let mut checkpoint = Self::settle_holder(&env, holder.clone());
        let amount = checkpoint.unclaimed_capital;
        if amount <= 0 {
            return 0;
        }
        checkpoint.unclaimed_capital = 0;
        checkpoint.unclaimed_total = Self::checked_sub(&env, checkpoint.unclaimed_total, amount);
        checkpoint.claimed_total = Self::checked_add(&env, checkpoint.claimed_total, amount);
        Self::store_holder_checkpoint(&env, &holder, &checkpoint);
        Self::withdraw_dividend_pool(&env, amount);
        env.events()
            .publish((symbol_short!("cap_clm"), holder), amount);
        amount
    }

    pub fn get_holders(env: Env, start: u32, limit: u32) -> Vec<Address> {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let holders: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::HolderList)
            .unwrap_or_else(|| Vec::new(&env));
        let total = holders.len();
        let capped = limit.min(50);
        let end = (start + capped).min(total);
        let mut out = Vec::new(&env);
        for i in start..end {
            out.push_back(holders.get_unchecked(i));
        }
        out
    }

    pub fn holder_count(env: Env) -> u32 {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage()
            .instance()
            .get(&DataKey::HolderCount)
            .unwrap_or(0)
    }

    pub fn holder_slots_remaining(env: Env) -> u32 {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let rules = th::get_compliance_rules(&env);
        if rules.max_holders == 0 {
            return u32::MAX;
        }
        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::HolderCount)
            .unwrap_or(0);
        rules.max_holders.saturating_sub(count)
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        Self::read_balance(&env, id)
    }

    pub fn total_shares(env: Env) -> i128 {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage()
            .instance()
            .get(&DataKey::TotalShares)
            .unwrap_or(0)
    }

    /// Admin-initiated forced transfer for regulatory compliance (e.g. AML, court orders).
    pub fn forced_transfer(env: Env, from: Address, to: Address, shares: i128) {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        th::require_admin(&env);
        if shares <= 0 {
            panic_with_error!(env, PropertyError::NegativeShares);
        }
        if !th::is_kyc_approved(&env, &from) {
            panic_with_error!(env, PropertyError::KycNotApproved);
        }
        if !th::is_kyc_approved(&env, &to) {
            panic_with_error!(env, PropertyError::KycNotApproved);
        }
        Self::require_tier(&env, &to);
        // Forced transfer: only check pause and blocklist, not transfer rules.
        if th::is_compliance_paused(&env) {
            panic_with_error!(env, PropertyError::CompliancePaused);
        }
        if th::is_compliance_blocklisted(&env, &to) {
            panic_with_error!(env, PropertyError::Blocklisted);
        }
        let from_bal = Self::read_balance(&env, from.clone());
        if from_bal < shares {
            panic_with_error!(env, PropertyError::InsufficientShares);
        }
        Self::accrue(&env, from.clone());
        Self::accrue(&env, to.clone());
        Self::write_balance(&env, from.clone(), from_bal - shares);
        let to_bal = Self::read_balance(&env, to.clone());
        Self::write_balance(&env, to.clone(), to_bal + shares);
        Self::reset_debt(&env, from.clone());
        Self::reset_debt(&env, to.clone());
        th::do_register_holder(&env, &to);
        Self::add_holder_local(&env, &to);
        if from_bal == shares {
            Self::remove_holder_local(&env, &from);
        }
        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ForcedTransferCount)
            .unwrap_or(0);
        let log_entry = ForcedTransferEntry {
            from: from.clone(),
            to: to.clone(),
            shares,
            timestamp: env.ledger().timestamp(),
        };
        let log_key = DataKey::ForcedTransferLog(count);
        env.storage().persistent().set(&log_key, &log_entry);
        env.storage()
            .persistent()
            .extend_ttl(&log_key, THRESHOLD, BUMP);
        env.storage()
            .instance()
            .set(&DataKey::ForcedTransferCount, &(count + 1));
        env.events()
            .publish((symbol_short!("frc_xfer"), from, to), shares);
    }

    pub fn forced_transfer_count(env: Env) -> u32 {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage()
            .instance()
            .get(&DataKey::ForcedTransferCount)
            .unwrap_or(0)
    }

    pub fn get_forced_transfer_log(env: Env, start: u32, limit: u32) -> Vec<ForcedTransferEntry> {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ForcedTransferCount)
            .unwrap_or(0);
        let capped = limit.min(50);
        let end = (start + capped).min(count);
        let mut out = Vec::new(&env);
        for i in start..end {
            if let Some(entry) = env
                .storage()
                .persistent()
                .get::<DataKey, ForcedTransferEntry>(&DataKey::ForcedTransferLog(i))
            {
                out.push_back(entry);
            }
        }
        out
    }

    pub fn version(env: Env) -> String {
        String::from_str(&env, env!("CARGO_PKG_VERSION"))
    }

    // ── Internals ────────────────────────────────────────────────────────────

    fn require_tier(env: &Env, addr: &Address) {
        let meta: PropertyMeta = env
            .storage()
            .instance()
            .get(&DataKey::PropertyMeta)
            .expect("property meta must be set");
        let actual = th::get_kyc_tier(env, addr);
        if actual < meta.kyc_tier_required {
            panic_with_error!(env, PropertyError::KycTierTooLow);
        }
    }

    fn dps(env: &Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::DividendPerShare)
            .unwrap_or(0)
    }

    fn rent_dps(env: &Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::DividendPerShareRent)
            .unwrap_or(0)
    }

    fn capital_dps(env: &Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::DividendPerShareCapital)
            .unwrap_or(0)
    }

    fn distribution_count(env: &Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::DividendDepositCount)
            .unwrap_or(0)
    }

    fn load_holder_checkpoint(env: &Env, holder: &Address) -> HolderDividendCheckpoint {
        let key = DataKey::HolderDividendCheckpoint(holder.clone());
        if let Some(checkpoint) = env
            .storage()
            .persistent()
            .get::<DataKey, HolderDividendCheckpoint>(&key)
        {
            env.storage().persistent().extend_ttl(&key, THRESHOLD, BUMP);
            return checkpoint;
        }

        // Lazy compatibility bridge for state written by the pre-checkpoint
        // accounting model. Once settled, this holder uses only the reconciled
        // checkpoint record.
        let balance = Self::read_balance(env, holder.clone());
        let total_index = Self::dps(env);
        let rent_index = Self::rent_dps(env);
        let capital_index = Self::capital_dps(env);

        let legacy_total: i128 = env
            .storage()
            .instance()
            .get(&DataKey::Unclaimed(holder.clone()))
            .unwrap_or(0);
        let legacy_total_debt: i128 = env
            .storage()
            .instance()
            .get(&DataKey::ClaimedDividend(holder.clone()))
            .unwrap_or(0);
        let legacy_rent: i128 = env
            .storage()
            .instance()
            .get(&DataKey::UnclaimedRent(holder.clone()))
            .unwrap_or(0);
        let legacy_rent_debt: i128 = env
            .storage()
            .instance()
            .get(&DataKey::ClaimedDividendRent(holder.clone()))
            .unwrap_or(0);
        let legacy_capital: i128 = env
            .storage()
            .instance()
            .get(&DataKey::UnclaimedCapital(holder.clone()))
            .unwrap_or(0);
        let legacy_capital_debt: i128 = env
            .storage()
            .instance()
            .get(&DataKey::ClaimedDividendCapital(holder.clone()))
            .unwrap_or(0);

        let total_entitlement = Self::checked_mul(env, balance, total_index);
        let rent_entitlement = Self::checked_mul(env, balance, rent_index);
        let capital_entitlement = Self::checked_mul(env, balance, capital_index);

        let unclaimed_total = Self::checked_add(
            env,
            legacy_total,
            Self::positive_difference(env, total_entitlement, legacy_total_debt),
        );
        let unclaimed_rent = Self::checked_add(
            env,
            legacy_rent,
            Self::positive_difference(env, rent_entitlement, legacy_rent_debt),
        );
        let unclaimed_capital = Self::checked_add(
            env,
            legacy_capital,
            Self::positive_difference(env, capital_entitlement, legacy_capital_debt),
        );
        let typed_total = Self::checked_add(env, unclaimed_rent, unclaimed_capital);
        let (unclaimed_rent, unclaimed_capital) = if typed_total <= unclaimed_total {
            (unclaimed_rent, unclaimed_capital)
        } else {
            // The legacy claim-all path cleared only the aggregate counter,
            // leaving stale typed counters behind. The aggregate is
            // authoritative when those views disagree; preserving either
            // typed counter would make an already-paid amount claimable again.
            (0, 0)
        };

        HolderDividendCheckpoint {
            distribution_count: Self::distribution_count(env),
            balance,
            total_index,
            rent_index,
            capital_index,
            unclaimed_total,
            unclaimed_rent,
            unclaimed_capital,
            claimed_total: 0,
        }
    }

    fn preview_holder_checkpoint(env: &Env, holder: Address) -> HolderDividendCheckpoint {
        let mut checkpoint = Self::load_holder_checkpoint(env, &holder);
        let (distribution_count, total_index, rent_index, capital_index) =
            Self::latest_distribution_indexes(env);

        let total_delta = Self::positive_difference(env, total_index, checkpoint.total_index);
        let rent_delta = Self::positive_difference(env, rent_index, checkpoint.rent_index);
        let capital_delta = Self::positive_difference(env, capital_index, checkpoint.capital_index);

        checkpoint.unclaimed_total = Self::checked_add(
            env,
            checkpoint.unclaimed_total,
            Self::checked_mul(env, checkpoint.balance, total_delta),
        );
        checkpoint.unclaimed_rent = Self::checked_add(
            env,
            checkpoint.unclaimed_rent,
            Self::checked_mul(env, checkpoint.balance, rent_delta),
        );
        checkpoint.unclaimed_capital = Self::checked_add(
            env,
            checkpoint.unclaimed_capital,
            Self::checked_mul(env, checkpoint.balance, capital_delta),
        );
        checkpoint.total_index = total_index;
        checkpoint.rent_index = rent_index;
        checkpoint.capital_index = capital_index;
        checkpoint.distribution_count = distribution_count;
        checkpoint
    }

    fn latest_distribution_indexes(env: &Env) -> (u32, i128, i128, i128) {
        let distribution_count = Self::distribution_count(env);
        if distribution_count > 0 {
            let key = DataKey::DistributionCheckpoint(distribution_count - 1);
            if let Some(checkpoint) = env
                .storage()
                .persistent()
                .get::<DataKey, DistributionCheckpoint>(&key)
            {
                env.storage().persistent().extend_ttl(&key, THRESHOLD, BUMP);
                return (
                    distribution_count,
                    checkpoint.cumulative_per_share,
                    checkpoint.rent_cumulative_per_share,
                    checkpoint.capital_cumulative_per_share,
                );
            }
        }

        // Pre-upgrade distributions have only the legacy cumulative keys.
        // New distributions persist the journal entry atomically with the
        // cumulative keys, so this fallback is limited to legacy state or an
        // expired audit record.
        (
            distribution_count,
            Self::dps(env),
            Self::rent_dps(env),
            Self::capital_dps(env),
        )
    }

    fn settle_holder(env: &Env, holder: Address) -> HolderDividendCheckpoint {
        let checkpoint = Self::preview_holder_checkpoint(env, holder.clone());
        Self::store_holder_checkpoint(env, &holder, &checkpoint);
        checkpoint
    }

    fn store_holder_checkpoint(env: &Env, holder: &Address, checkpoint: &HolderDividendCheckpoint) {
        let key = DataKey::HolderDividendCheckpoint(holder.clone());
        env.storage().persistent().set(&key, checkpoint);
        env.storage().persistent().extend_ttl(&key, THRESHOLD, BUMP);

        // Keep the legacy debt keys synchronized. If a persistent checkpoint
        // expires while the instance remains active, lazy reconstruction must
        // not replay an already claimed distribution.
        env.storage().instance().set(
            &DataKey::Unclaimed(holder.clone()),
            &checkpoint.unclaimed_total,
        );
        env.storage().instance().set(
            &DataKey::UnclaimedRent(holder.clone()),
            &checkpoint.unclaimed_rent,
        );
        env.storage().instance().set(
            &DataKey::UnclaimedCapital(holder.clone()),
            &checkpoint.unclaimed_capital,
        );
        env.storage().instance().set(
            &DataKey::ClaimedDividend(holder.clone()),
            &Self::checked_mul(env, checkpoint.balance, checkpoint.total_index),
        );
        env.storage().instance().set(
            &DataKey::ClaimedDividendRent(holder.clone()),
            &Self::checked_mul(env, checkpoint.balance, checkpoint.rent_index),
        );
        env.storage().instance().set(
            &DataKey::ClaimedDividendCapital(holder.clone()),
            &Self::checked_mul(env, checkpoint.balance, checkpoint.capital_index),
        );
    }

    fn accrue(env: &Env, holder: Address) {
        Self::settle_holder(env, holder);
    }

    fn reset_debt(env: &Env, holder: Address) {
        let mut checkpoint = Self::preview_holder_checkpoint(env, holder.clone());
        checkpoint.balance = Self::read_balance(env, holder.clone());
        Self::store_holder_checkpoint(env, &holder, &checkpoint);
    }

    fn withdraw_dividend_pool(env: &Env, amount: i128) {
        let pool: i128 = env
            .storage()
            .instance()
            .get(&DataKey::DividendPool)
            .unwrap_or(0);
        if pool < amount {
            panic_with_error!(env, PropertyError::InsufficientDividendPool);
        }
        env.storage().instance().set(
            &DataKey::DividendPool,
            &Self::checked_sub(env, pool, amount),
        );
    }

    fn positive_difference(env: &Env, left: i128, right: i128) -> i128 {
        if left > right {
            Self::checked_sub(env, left, right)
        } else {
            0
        }
    }

    fn checked_add(env: &Env, left: i128, right: i128) -> i128 {
        if let Some(value) = left.checked_add(right) {
            value
        } else {
            panic_with_error!(env, PropertyError::DividendMathOverflow);
        }
    }

    fn checked_sub(env: &Env, left: i128, right: i128) -> i128 {
        if let Some(value) = left.checked_sub(right) {
            value
        } else {
            panic_with_error!(env, PropertyError::DividendMathOverflow);
        }
    }

    fn checked_mul(env: &Env, left: i128, right: i128) -> i128 {
        if let Some(value) = left.checked_mul(right) {
            value
        } else {
            panic_with_error!(env, PropertyError::DividendMathOverflow);
        }
    }

    fn add_holder_local(env: &Env, addr: &Address) {
        let mut holders: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::HolderList)
            .unwrap_or_else(|| Vec::new(env));
        for existing in holders.iter() {
            if existing == *addr {
                return;
            }
        }
        holders.push_back(addr.clone());
        env.storage()
            .persistent()
            .set(&DataKey::HolderList, &holders);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::HolderList, THRESHOLD, BUMP);
        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::HolderCount)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::HolderCount, &(count + 1));
    }

    fn remove_holder_local(env: &Env, addr: &Address) {
        let holders: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::HolderList)
            .unwrap_or_else(|| Vec::new(env));
        let mut new_holders = Vec::new(env);
        let mut found = false;
        for h in holders.iter() {
            if h == *addr {
                found = true;
            } else {
                new_holders.push_back(h);
            }
        }
        if found {
            env.storage()
                .persistent()
                .set(&DataKey::HolderList, &new_holders);
            env.storage()
                .persistent()
                .extend_ttl(&DataKey::HolderList, THRESHOLD, BUMP);
            let count: u32 = env
                .storage()
                .instance()
                .get(&DataKey::HolderCount)
                .unwrap_or(0);
            env.storage()
                .instance()
                .set(&DataKey::HolderCount, &count.saturating_sub(1));
        }
    }

    fn read_balance(env: &Env, addr: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(addr))
            .unwrap_or(0)
    }

    fn write_balance(env: &Env, addr: Address, amount: i128) {
        let key = DataKey::Balance(addr);
        env.storage().persistent().set(&key, &amount);
        env.storage().persistent().extend_ttl(&key, THRESHOLD, BUMP);
    }

    fn read_allowance(env: &Env, from: Address, spender: Address) -> AllowanceValue {
        let key = DataKey::Allowance(AllowanceKey {
            from: from.clone(),
            spender: spender.clone(),
        });
        if let Some(val) = env
            .storage()
            .temporary()
            .get::<DataKey, AllowanceValue>(&key)
        {
            if val.expiration_ledger < env.ledger().sequence() {
                AllowanceValue {
                    amount: 0,
                    expiration_ledger: val.expiration_ledger,
                }
            } else {
                val
            }
        } else {
            AllowanceValue {
                amount: 0,
                expiration_ledger: 0,
            }
        }
    }

    fn spend_allowance(env: &Env, from: Address, spender: Address, amount: i128) {
        let allowance = Self::read_allowance(env, from.clone(), spender.clone());
        if allowance.amount < amount {
            panic!("insufficient allowance");
        }
        let new_amount = allowance.amount - amount;
        let key = DataKey::Allowance(AllowanceKey {
            from: from.clone(),
            spender: spender.clone(),
        });
        let value = AllowanceValue {
            amount: new_amount,
            expiration_ledger: allowance.expiration_ledger,
        };
        env.storage().temporary().set(&key, &value);
        if new_amount > 0 {
            let current = env.ledger().sequence();
            if allowance.expiration_ledger > current {
                let ttl = allowance.expiration_ledger - current;
                env.storage().temporary().extend_ttl(&key, ttl, ttl);
            }
        }
    }
}
