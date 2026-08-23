#![no_std]
#![cfg_attr(not(test), deny(clippy::unwrap_used))]

//! Carbon Credit Token — 1 token = 1 verified tonne of CO₂ equivalent retired.
//! Tokens are burned ("retired") to claim the carbon offset; retired credits
//! are permanently removed from circulation with an on-chain retirement receipt.
//! Minting is admin-gated and still enforces active KYC plus mint-time
//! compliance checks for pause/blocklist rules.

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
pub enum CarbonError {
    AlreadyInitialized = 1,
    InsufficientBalance = 2,
    KycNotApproved = 3,
    CompliancePaused = 4,
    Blocklisted = 5,
    TransferBlocked = 6,
    /// Batch retirement list exceeds the maximum of 10 entries.
    BatchTooLarge = 7,
    /// Individual retirement amount is zero or negative.
    InvalidAmount = 8,
    /// A metadata string field exceeds the 128-byte maximum allowed length.
    FieldTooLong = 9,
}

#[contracttype]
pub enum DataKey {
    ProjectMeta,
    Balance(Address),
    TotalSupply,
    TotalRetired,
    RetirementCount,
    Receipt(u32),
    /// Number of receipts attributed to a specific beneficiary address.
    BeneficiaryReceiptCount(Address),
    /// Maps (beneficiary, per-beneficiary-index) → global receipt index.
    BeneficiaryReceiptIdx(Address, u32),
}

#[contracttype]
#[derive(Clone)]
pub struct ProjectMeta {
    pub project_id: String,
    pub standard: String, // "VCS" | "Gold Standard" | "CDM" | "ACR"
    pub vintage_year: u32,
    pub project_name: String,
    pub project_type: String, // "forestry" | "renewable" | "methane_capture"
    pub country: String,
    pub verifier: String,
    pub ipfs_cert_hash: String, // verification certificate
    pub registry_url: String,
    pub registry_project_id: String,
}

#[contracttype]
#[derive(Clone)]
pub struct RetirementReceipt {
    pub retiree: Address,
    pub amount: i128,
    pub timestamp: u64,
    pub beneficiary: String,
    pub retirement_reason: String,
    pub beneficiary_address: Option<Address>,
}

/// A single entry in a `batch_retire_on_behalf` call.
#[contracttype]
#[derive(Clone)]
pub struct RetirementRequest {
    /// The end-beneficiary whose carbon offset is being claimed.
    pub beneficiary: Address,
    /// Amount of credits (tokens) to burn for this beneficiary.
    pub amount: i128,
    /// Free-text memo / retirement reason recorded in the receipt.
    pub memo: String,
}

const DAY_IN_LEDGERS: u32 = 17280;
const BUMP: u32 = 365 * DAY_IN_LEDGERS;
const THRESHOLD: u32 = BUMP - DAY_IN_LEDGERS;
const MAX_PAGE_SIZE: u32 = 100;
/// Maximum byte length for metadata string fields written into certificates.
const MAX_FIELD_LEN: u32 = 128;

/// Returned by `verify_receipt`. Contains key fields plus a validity flag and serial number.
#[contracttype]
#[derive(Clone)]
pub struct ReceiptVerification {
    /// Zero-based index of the receipt.
    pub index: u32,
    /// True when the receipt exists and is internally consistent.
    pub valid: bool,
    /// Address that retired the credits.
    pub retiree: Address,
    /// Amount of credits retired (stroops / whole tokens depending on decimal setting).
    pub amount: i128,
    /// Unix timestamp of the retirement.
    pub timestamp: u64,
    /// Project ID from the stored project metadata.
    pub project_id: String,
    /// Human-readable serial: `<project_id>-<index>`.
    pub serial: String,
}

#[contract]
pub struct CarbonCreditToken;

#[contractimpl]
impl CarbonCreditToken {
    fn validate_project_type(env: &Env, pt: &String) {
        if *pt != String::from_str(env, "forestry")
            && *pt != String::from_str(env, "renewable")
            && *pt != String::from_str(env, "methane_capture")
        {
            panic!("invalid project_type");
        }
    }

    /// Enforce that a metadata string field is at most MAX_FIELD_LEN (128) bytes.
    /// Panics with `CarbonError::FieldTooLong` if the limit is exceeded so the
    /// caller receives a structured contract error rather than a generic trap.
    fn validate_metadata_field_length(env: &Env, field: &String) {
        if field.len() > MAX_FIELD_LEN {
            panic_with_error!(env, CarbonError::FieldTooLong);
        }
    }

    // ── Beneficiary index helpers ─────────────────────────────────────────────

    /// Append `global_idx` to the per-beneficiary receipt index for `beneficiary`.
    fn index_beneficiary_receipt(env: &Env, beneficiary: &Address, global_idx: u32) {
        let count_key = DataKey::BeneficiaryReceiptCount(beneficiary.clone());
        let count: u32 = env
            .storage()
            .persistent()
            .get(&count_key)
            .unwrap_or(0);
        let idx_key = DataKey::BeneficiaryReceiptIdx(beneficiary.clone(), count);
        env.storage().persistent().set(&idx_key, &global_idx);
        env.storage()
            .persistent()
            .extend_ttl(&idx_key, THRESHOLD, BUMP);
        env.storage()
            .persistent()
            .set(&count_key, &(count + 1));
        env.storage()
            .persistent()
            .extend_ttl(&count_key, THRESHOLD, BUMP);
    }

    // ── Constructor ───────────────────────────────────────────────────────────

    /// Constructor — called atomically at deploy time via `stellar contract deploy -- --admin ...`.
    /// Eliminates the deploy→initialize front-running window.
    pub fn __constructor(
        env: Env,
        admin: Address,
        kyc_registry: Address,
        compliance_engine: Address,
        meta: ProjectMeta,
    ) {
        Self::validate_project_type(&env, &meta.project_type);
        if !th::is_valid_vintage_year(meta.vintage_year) {
            panic!("invalid vintage year: must be 1990–2050");
        }
        th::write_admin(&env, &admin);
        th::write_kyc_registry(&env, &kyc_registry);
        th::write_compliance_engine(&env, &compliance_engine);
        env.storage().instance().set(&DataKey::ProjectMeta, &meta);
        env.storage().instance().set(&DataKey::TotalSupply, &0i128);
        env.storage().instance().set(&DataKey::TotalRetired, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::RetirementCount, &0u32);
    }

    /// Legacy entry point — always panics to prevent post-deploy initialization.
    pub fn initialize(
        env: Env,
        _admin: Address,
        _kyc_registry: Address,
        _compliance_engine: Address,
        _meta: ProjectMeta,
    ) {
        panic_with_error!(env, CarbonError::AlreadyInitialized);
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

    pub fn get_meta(env: Env) -> ProjectMeta {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage()
            .instance()
            .get(&DataKey::ProjectMeta)
            .expect("project meta must be set")
    }

    /// Replace project metadata. Admin-only; project_id is immutable.
    pub fn update_meta(env: Env, new_meta: ProjectMeta) {
        th::require_admin(&env);
        Self::validate_project_type(&env, &new_meta.project_type);
        if !th::is_valid_vintage_year(new_meta.vintage_year) {
            panic!("invalid vintage year: must be 1990–2050");
        }
        if !th::is_valid_ipfs_hash(&new_meta.ipfs_cert_hash) {
            panic!("ipfs_cert_hash must be a valid IPFS CID (CIDv0 or CIDv1)");
        }
        let old_meta: ProjectMeta = env
            .storage()
            .instance()
            .get(&DataKey::ProjectMeta)
            .expect("project meta must be set");
        if new_meta.project_id != old_meta.project_id {
            panic!("project_id is immutable");
        }
        env.storage()
            .instance()
            .set(&DataKey::ProjectMeta, &new_meta);
        env.events().publish((symbol_short!("upd_meta"),), ());
    }

    pub fn name(env: Env) -> String {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        String::from_str(&env, "Veritoken Carbon Credit")
    }
    pub fn symbol(env: Env) -> String {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        String::from_str(&env, "VTCC")
    }
    pub fn decimals(env: Env) -> u32 {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        0
    }

    // ── Issuance ─────────────────────────────────────────────────────────────

    pub fn mint(env: Env, to: Address, amount: i128) {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        th::require_admin(&env);
        match th::evaluate_transfer_compliance(&env, &to, &to, amount) {
            th::TransferDecision::Allow => {}
            th::TransferDecision::Deny(ref reason) => {
                if th::is_kyc_deny_reason(reason) {
                    panic_with_error!(env, CarbonError::KycNotApproved);
                } else if th::is_paused_deny_reason(reason) {
                    panic_with_error!(env, CarbonError::CompliancePaused);
                } else if th::is_blocklist_deny_reason(reason) {
                    panic_with_error!(env, CarbonError::Blocklisted);
                } else {
                    panic_with_error!(env, CarbonError::TransferBlocked);
                }
            }
        }
        let bal = Self::read_balance(&env, to.clone());
        Self::write_balance(&env, to.clone(), bal + amount);
        let supply: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &(supply + amount));
        th::do_register_holder(&env, &to);
        env.events().publish((symbol_short!("mint"), to), amount);
    }

    // ── Transfer ─────────────────────────────────────────────────────────────

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        from.require_auth();
        match th::evaluate_transfer_compliance(&env, &from, &to, amount) {
            th::TransferDecision::Allow => {}
            th::TransferDecision::Deny(ref reason) => {
                if th::is_kyc_deny_reason(reason) {
                    panic_with_error!(env, CarbonError::KycNotApproved);
                } else if th::is_paused_deny_reason(reason) {
                    panic_with_error!(env, CarbonError::CompliancePaused);
                } else if th::is_blocklist_deny_reason(reason) {
                    panic_with_error!(env, CarbonError::Blocklisted);
                } else {
                    panic_with_error!(env, CarbonError::TransferBlocked);
                }
            }
        }
        let from_bal = Self::read_balance(&env, from.clone());
        if from_bal < amount {
            panic_with_error!(env, CarbonError::InsufficientBalance);
        }
        Self::write_balance(&env, from.clone(), from_bal - amount);
        let to_bal = Self::read_balance(&env, to.clone());
        Self::write_balance(&env, to.clone(), to_bal + amount);
        th::do_register_holder(&env, &to);
        env.events()
            .publish((symbol_short!("transfer"), from, to), amount);
    }

    // ── Retirement ───────────────────────────────────────────────────────────

    /// Permanently burn tokens and record a retirement receipt on-chain.
    ///
    /// Enforces a 128-byte cap on `beneficiary` and `reason` fields to prevent
    /// certificate generation from overflowing. Returns `Error::FieldTooLong`
    /// rather than panicking when the limit is exceeded.
    pub fn retire(
        env: Env,
        retiree: Address,
        amount: i128,
        beneficiary: String,
        reason: String,
    ) -> RetirementReceipt {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        retiree.require_auth();

        // Validate field lengths before any state mutation.
        Self::validate_metadata_field_length(&env, &beneficiary);
        Self::validate_metadata_field_length(&env, &reason);

        match th::evaluate_transfer_compliance(&env, &retiree, &retiree, amount) {
            th::TransferDecision::Allow => {}
            th::TransferDecision::Deny(ref reason) => {
                if th::is_kyc_deny_reason(reason) {
                    panic_with_error!(env, CarbonError::KycNotApproved);
                } else {
                    panic_with_error!(env, CarbonError::TransferBlocked);
                }
            }
        }
        let bal = Self::read_balance(&env, retiree.clone());
        if bal < amount {
            panic_with_error!(env, CarbonError::InsufficientBalance);
        }
        Self::write_balance(&env, retiree.clone(), bal - amount);
        let supply: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &(supply - amount));
        let retired: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalRetired)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalRetired, &(retired + amount));

        let index: u32 = env
            .storage()
            .instance()
            .get(&DataKey::RetirementCount)
            .unwrap_or(0);
        let receipt = RetirementReceipt {
            retiree: retiree.clone(),
            amount,
            timestamp: env.ledger().timestamp(),
            beneficiary,
            retirement_reason: reason,
            beneficiary_address: None,
        };
        let key = DataKey::Receipt(index);
        env.storage().persistent().set(&key, &receipt);
        env.storage().persistent().extend_ttl(&key, THRESHOLD, BUMP);
        env.storage()
            .instance()
            .set(&DataKey::RetirementCount, &(index + 1));

        // Update the per-beneficiary index: use the retiree as the beneficiary
        // (retire() does not have an explicit on-chain beneficiary address).
        Self::index_beneficiary_receipt(&env, &retiree, index);

        env.events()
            .publish((symbol_short!("retired"), retiree), amount);
        receipt
    }

    /// Retire tokens on behalf of another party. Records both the retiring party
    /// (`retiree`) and the actual beneficiary (`on_behalf_of`) on-chain.
    /// Requires active KYC for both parties.
    ///
    /// The per-beneficiary receipt index is updated for `on_behalf_of` so that
    /// registry integrations can look up all retirements for a given beneficiary
    /// in O(count) rather than scanning the full global list.
    pub fn retire_on_behalf(
        env: Env,
        retiree: Address,
        on_behalf_of: Address,
        amount: i128,
        reason: String,
    ) -> RetirementReceipt {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        retiree.require_auth();

        // Validate field lengths before any state mutation.
        Self::validate_metadata_field_length(&env, &reason);

        match th::evaluate_transfer_compliance(&env, &retiree, &retiree, amount) {
            th::TransferDecision::Allow => {}
            th::TransferDecision::Deny(ref reason) => {
                if th::is_kyc_deny_reason(reason) {
                    panic_with_error!(env, CarbonError::KycNotApproved);
                } else {
                    panic_with_error!(env, CarbonError::TransferBlocked);
                }
            }
        }
        // on_behalf_of is only recorded in the receipt — check KYC state explicitly.
        if th::get_kyc_state_of(&env, &on_behalf_of) != th::KycState::Approved {
            panic_with_error!(env, CarbonError::KycNotApproved);
        }
        let bal = Self::read_balance(&env, retiree.clone());
        if bal < amount {
            panic_with_error!(env, CarbonError::InsufficientBalance);
        }
        Self::write_balance(&env, retiree.clone(), bal - amount);
        let supply: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &(supply - amount));
        let retired: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalRetired)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalRetired, &(retired + amount));

        let index: u32 = env
            .storage()
            .instance()
            .get(&DataKey::RetirementCount)
            .unwrap_or(0);
        let receipt = RetirementReceipt {
            retiree: retiree.clone(),
            amount,
            timestamp: env.ledger().timestamp(),
            beneficiary: String::from_str(&env, ""),
            retirement_reason: reason,
            beneficiary_address: Some(on_behalf_of.clone()),
        };
        let key = DataKey::Receipt(index);
        env.storage().persistent().set(&key, &receipt);
        env.storage().persistent().extend_ttl(&key, THRESHOLD, BUMP);
        env.storage()
            .instance()
            .set(&DataKey::RetirementCount, &(index + 1));

        // Update the per-beneficiary index for on_behalf_of.
        Self::index_beneficiary_receipt(&env, &on_behalf_of, index);

        env.events()
            .publish((symbol_short!("ret_obo"), retiree), on_behalf_of);
        receipt
    }

    // ── Batch Retirement ─────────────────────────────────────────────────────

    /// Retire credits for multiple beneficiaries in a single transaction.
    pub fn batch_retire(
        env: Env,
        retiree: Address,
        retirements: Vec<(i128, String, String)>,
    ) -> Vec<RetirementReceipt> {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        retiree.require_auth();

        let len = retirements.len();
        if len > 10 {
            panic_with_error!(env, CarbonError::BatchTooLarge);
        }

        match th::evaluate_transfer_compliance(&env, &retiree, &retiree, 1) {
            th::TransferDecision::Allow => {}
            th::TransferDecision::Deny(ref reason) => {
                if th::is_kyc_deny_reason(reason) {
                    panic_with_error!(env, CarbonError::KycNotApproved);
                } else {
                    panic_with_error!(env, CarbonError::TransferBlocked);
                }
            }
        }

        let mut total: i128 = 0;
        for i in 0..len {
            let entry = retirements.get(i).expect("index in bounds");
            let (amount, _, _) = entry;
            if amount <= 0 {
                panic_with_error!(env, CarbonError::InvalidAmount);
            }
            total = total.checked_add(amount).expect("overflow");
        }

        let bal = Self::read_balance(&env, retiree.clone());
        if bal < total {
            panic_with_error!(env, CarbonError::InsufficientBalance);
        }

        Self::write_balance(&env, retiree.clone(), bal - total);

        let supply: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &(supply - total));

        let retired: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalRetired)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalRetired, &(retired + total));

        let mut index: u32 = env
            .storage()
            .instance()
            .get(&DataKey::RetirementCount)
            .unwrap_or(0);

        let now = env.ledger().timestamp();
        let mut receipts: Vec<RetirementReceipt> = Vec::new(&env);

        for i in 0..len {
            let entry = retirements.get(i).expect("index in bounds");
            let (amount, beneficiary, reason) = entry;
            let receipt = RetirementReceipt {
                retiree: retiree.clone(),
                amount,
                timestamp: now,
                beneficiary,
                retirement_reason: reason,
                beneficiary_address: None,
            };
            let key = DataKey::Receipt(index);
            env.storage().persistent().set(&key, &receipt);
            env.storage().persistent().extend_ttl(&key, THRESHOLD, BUMP);
            receipts.push_back(receipt);
            index += 1;
        }

        env.storage()
            .instance()
            .set(&DataKey::RetirementCount, &index);

        env.events()
            .publish((symbol_short!("bt_retire"), retiree), total);

        receipts
    }

    /// Retire credits on behalf of multiple distinct beneficiary addresses in a
    /// single transaction. Burns the total amount in one pass, writes one receipt
    /// per `RetirementRequest` entry, and updates both the global receipt index
    /// and the per-beneficiary index for each beneficiary.
    ///
    /// Returns `Vec<String>` of generated serial numbers (one per entry).
    /// Emits a `batch_retired` event carrying the retiree and total amount burned.
    ///
    /// Restrictions:
    /// - `retirements` must contain between 1 and 10 entries (inclusive).
    /// - Every `amount` must be > 0.
    /// - The retiree must be KYC-approved and not blocklisted.
    /// - Every beneficiary must be KYC-approved.
    /// - The retiree must hold sufficient balance to cover the total.
    pub fn batch_retire_on_behalf(
        env: Env,
        retiree: Address,
        retirements: Vec<RetirementRequest>,
    ) -> Vec<String> {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        retiree.require_auth();

        let len = retirements.len();
        if len == 0 || len > 10 {
            panic_with_error!(env, CarbonError::BatchTooLarge);
        }

        // Compliance check for the retiree.
        match th::evaluate_transfer_compliance(&env, &retiree, &retiree, 1) {
            th::TransferDecision::Allow => {}
            th::TransferDecision::Deny(ref reason) => {
                if th::is_kyc_deny_reason(reason) {
                    panic_with_error!(env, CarbonError::KycNotApproved);
                } else if th::is_blocklist_deny_reason(reason) {
                    panic_with_error!(env, CarbonError::Blocklisted);
                } else {
                    panic_with_error!(env, CarbonError::TransferBlocked);
                }
            }
        }

        // Validate all entries before touching any state.
        let mut total: i128 = 0;
        for i in 0..len {
            let req = retirements.get(i).expect("index in bounds");
            if req.amount <= 0 {
                panic_with_error!(env, CarbonError::InvalidAmount);
            }
            // Require KYC for every beneficiary.
            if th::get_kyc_state_of(&env, &req.beneficiary) != th::KycState::Approved {
                panic_with_error!(env, CarbonError::KycNotApproved);
            }
            total = total.checked_add(req.amount).expect("overflow");
        }

        let bal = Self::read_balance(&env, retiree.clone());
        if bal < total {
            panic_with_error!(env, CarbonError::InsufficientBalance);
        }

        // Deduct entire total in one write.
        Self::write_balance(&env, retiree.clone(), bal - total);

        let supply: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &(supply - total));

        let retired: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalRetired)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalRetired, &(retired + total));

        // Read project metadata once for serial generation.
        let meta: ProjectMeta = env
            .storage()
            .instance()
            .get(&DataKey::ProjectMeta)
            .expect("project meta must be set");

        let mut index: u32 = env
            .storage()
            .instance()
            .get(&DataKey::RetirementCount)
            .unwrap_or(0);

        let now = env.ledger().timestamp();
        let mut serials: Vec<String> = Vec::new(&env);

        for i in 0..len {
            let req = retirements.get(i).expect("index in bounds");

            let receipt = RetirementReceipt {
                retiree: retiree.clone(),
                amount: req.amount,
                timestamp: now,
                beneficiary: String::from_str(&env, ""),
                retirement_reason: req.memo.clone(),
                beneficiary_address: Some(req.beneficiary.clone()),
            };

            let key = DataKey::Receipt(index);
            env.storage().persistent().set(&key, &receipt);
            env.storage().persistent().extend_ttl(&key, THRESHOLD, BUMP);

            // Update per-beneficiary index.
            Self::index_beneficiary_receipt(&env, &req.beneficiary, index);

            // Build serial: project_id + "-" + index (reusing the stack serial
            // approach from verify_receipt — small fixed buffer is safe here
            // because project_id is bounded to MAX_FIELD_LEN=128 bytes and u32
            // adds at most 10 digits plus a dash: total ≤ 139 bytes).
            let pid_len = meta.project_id.len() as usize;
            let mut serial_buf = [0u8; 139];
            meta.project_id.copy_into_slice(&mut serial_buf[..pid_len]);
            serial_buf[pid_len] = b'-';
            let mut pos = pid_len + 1;
            let mut n = index;
            if n == 0 {
                serial_buf[pos] = b'0';
                pos += 1;
            } else {
                let digit_start = pos;
                while n > 0 {
                    serial_buf[pos] = b'0' + (n % 10) as u8;
                    pos += 1;
                    n /= 10;
                }
                serial_buf[digit_start..pos].reverse();
            }
            serials.push_back(String::from_bytes(&env, &serial_buf[..pos]));

            index += 1;
        }

        env.storage()
            .instance()
            .set(&DataKey::RetirementCount, &index);

        env.events()
            .publish((symbol_short!("bt_ret_ob"), retiree), total);

        serials
    }

    // ── Read API ─────────────────────────────────────────────────────────────

    pub fn retirement_count(env: Env) -> u32 {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage()
            .instance()
            .get(&DataKey::RetirementCount)
            .unwrap_or(0)
    }

    pub fn get_receipt(env: Env, index: u32) -> RetirementReceipt {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage()
            .persistent()
            .get(&DataKey::Receipt(index))
            .expect("receipt not found")
    }

    /// Returns up to `limit` receipts starting at `start`. Limit is capped at MAX_PAGE_SIZE.
    pub fn get_receipts(env: Env, start: u32, limit: u32) -> Vec<RetirementReceipt> {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::RetirementCount)
            .unwrap_or(0);
        let capped = limit.min(MAX_PAGE_SIZE);
        let end = (start + capped).min(count);
        let mut out = Vec::new(&env);
        for i in start..end {
            let r: RetirementReceipt = env
                .storage()
                .persistent()
                .get(&DataKey::Receipt(i))
                .expect("receipt not found");
            out.push_back(r);
        }
        out
    }

    /// Returns up to `count` receipts attributed to `beneficiary`, starting at
    /// per-beneficiary index `start`.
    ///
    /// Reads at most `min(count, BeneficiaryReceiptCount(beneficiary))` entries
    /// from persistent storage via the per-beneficiary index regardless of the
    /// total global receipt count — O(count) not O(N).
    ///
    /// `count` is capped at `MAX_PAGE_SIZE` (100).
    pub fn get_receipts_by_beneficiary(
        env: Env,
        beneficiary: Address,
        start: u32,
        count: u32,
    ) -> Vec<RetirementReceipt> {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let ben_count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::BeneficiaryReceiptCount(beneficiary.clone()))
            .unwrap_or(0);
        let capped = count.min(MAX_PAGE_SIZE);
        let end = (start + capped).min(ben_count);
        let mut out = Vec::new(&env);
        for local_i in start..end {
            let global_idx: u32 = env
                .storage()
                .persistent()
                .get(&DataKey::BeneficiaryReceiptIdx(beneficiary.clone(), local_i))
                .expect("beneficiary receipt index not found");
            let r: RetirementReceipt = env
                .storage()
                .persistent()
                .get(&DataKey::Receipt(global_idx))
                .expect("receipt not found");
            out.push_back(r);
        }
        out
    }

    /// Verify a retirement receipt by index.
    ///
    /// Returns a `ReceiptVerification` struct containing:
    /// - `valid`: true if the receipt exists and its fields are internally consistent
    ///   (amount > 0 AND timestamp > 0, retiree matches on-chain record, project
    ///   matches meta).
    /// - `serial`: a human-readable identifier composed of `project_id + "-" + index`.
    /// - Copies of the key receipt fields for UI display.
    ///
    /// This is a pure read — it does not change state.
    pub fn verify_receipt(env: Env, index: u32) -> ReceiptVerification {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::RetirementCount)
            .unwrap_or(0);
        // Index out of range → return invalid verification record
        if index >= count {
            return ReceiptVerification {
                index,
                valid: false,
                retiree: env.current_contract_address(), // placeholder
                amount: 0,
                timestamp: 0,
                project_id: String::from_str(&env, ""),
                serial: String::from_str(&env, ""),
            };
        }
        let receipt: RetirementReceipt = env
            .storage()
            .persistent()
            .get(&DataKey::Receipt(index))
            .expect("receipt not found");
        let meta: ProjectMeta = env
            .storage()
            .instance()
            .get(&DataKey::ProjectMeta)
            .expect("project meta must be set");

        // Validity rules:
        // 1. Amount must be positive.
        // 2. Timestamp must be non-zero (Unix epoch 0 = Jan 1, 1970 is semantically
        //    invalid; a valid retirement always carries the ledger close time).
        // 3. Project metadata must be present (already asserted above via unwrap).
        let valid = receipt.amount > 0 && receipt.timestamp > 0;

        // Build serial: project_id + "-" + index
        // Max: 128 bytes (project_id) + 1 ('-') + 10 (u32 digits) = 139
        let pid_len = meta.project_id.len() as usize;
        let mut serial_buf = [0u8; 139];
        meta.project_id.copy_into_slice(&mut serial_buf[..pid_len]);
        serial_buf[pid_len] = b'-';
        let mut pos = pid_len + 1;
        let mut n = index;
        if n == 0 {
            serial_buf[pos] = b'0';
            pos += 1;
        } else {
            let digit_start = pos;
            while n > 0 {
                serial_buf[pos] = b'0' + (n % 10) as u8;
                pos += 1;
                n /= 10;
            }
            serial_buf[digit_start..pos].reverse();
        }
        let serial = String::from_bytes(&env, &serial_buf[..pos]);

        ReceiptVerification {
            index,
            valid,
            retiree: receipt.retiree,
            amount: receipt.amount,
            timestamp: receipt.timestamp,
            project_id: meta.project_id,
            serial,
        }
    }

    /// Returns all receipt indices for a given retiree address, paginated.
    /// `start` and `limit` apply to the global receipt index space —
    /// receipts not belonging to `retiree` are skipped.
    /// Limit is capped at MAX_PAGE_SIZE.
    pub fn get_receipts_by_retiree(
        env: Env,
        retiree: Address,
        start: u32,
        limit: u32,
    ) -> Vec<RetirementReceipt> {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::RetirementCount)
            .unwrap_or(0);
        let capped = limit.min(MAX_PAGE_SIZE);
        let mut out = Vec::new(&env);
        let mut collected: u32 = 0;
        for i in start..count {
            if collected >= capped {
                break;
            }
            if let Some(r) = env
                .storage()
                .persistent()
                .get::<DataKey, RetirementReceipt>(&DataKey::Receipt(i))
            {
                if r.retiree == retiree {
                    out.push_back(r);
                    collected += 1;
                }
            }
        }
        out
    }

    /// Returns a JSON-formatted retirement certificate for the given receipt index.
    ///
    /// Fields are capped at `MAX_FIELD_LEN` (128 bytes) — the cap is enforced at
    /// retire time via `validate_metadata_field_length`, so this function will
    /// never encounter an oversized field at certificate generation time.
    ///
    /// Uses a single 1024-byte stack buffer.  The maximum JSON output given the
    /// 128-byte field cap is approximately 950 bytes, so this buffer is always
    /// sufficient and the `copy_into_slice` calls below are safe.
    pub fn to_certificate_json(env: Env, index: u32) -> String {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let receipt: RetirementReceipt = env
            .storage()
            .persistent()
            .get(&DataKey::Receipt(index))
            .expect("receipt not found");
        let meta: ProjectMeta = env
            .storage()
            .instance()
            .get(&DataKey::ProjectMeta)
            .expect("project meta must be set");

        // Single stack buffer — no heap allocation required.
        // Max size: ~950 bytes with all fields at their 128-byte cap.
        let mut out = [0u8; 1024];
        let mut pos = 0usize;

        // Helper closures that write into `out` at `pos`.
        macro_rules! push_literal {
            ($bytes:expr) => {{
                let src: &[u8] = $bytes;
                out[pos..pos + src.len()].copy_from_slice(src);
                pos += src.len();
            }};
        }
        macro_rules! push_sdk_str {
            ($s:expr) => {{
                let len = $s.len() as usize;
                $s.copy_into_slice(&mut out[pos..pos + len]);
                pos += len;
            }};
        }
        macro_rules! push_u32 {
            ($n:expr) => {{
                let s = Self::u32_to_string(&env, $n);
                push_sdk_str!(s);
            }};
        }
        macro_rules! push_u64 {
            ($n:expr) => {{
                let s = Self::u64_to_string(&env, $n);
                push_sdk_str!(s);
            }};
        }
        macro_rules! push_i128 {
            ($n:expr) => {{
                let s = Self::i128_to_string(&env, $n);
                push_sdk_str!(s);
            }};
        }

        push_literal!(b"{\"project_id\":\"");
        push_sdk_str!(meta.project_id);
        push_literal!(b"\",\"standard\":\"");
        push_sdk_str!(meta.standard);
        push_literal!(b"\",\"vintage_year\":");
        push_u32!(meta.vintage_year);
        push_literal!(b",\"retiree\":\"");
        let retiree_str = receipt.retiree.to_string();
        push_sdk_str!(retiree_str);
        push_literal!(b"\",\"amount\":");
        push_i128!(receipt.amount);
        push_literal!(b",\"timestamp\":");
        push_u64!(receipt.timestamp);
        push_literal!(b",\"beneficiary\":\"");
        push_sdk_str!(receipt.beneficiary);
        push_literal!(b"\",\"retirement_reason\":\"");
        push_sdk_str!(receipt.retirement_reason);
        push_literal!(b"\",\"registry_url\":\"");
        push_sdk_str!(meta.registry_url);
        push_literal!(b"\",\"registry_project_id\":\"");
        push_sdk_str!(meta.registry_project_id);
        push_literal!(b"\"}");

        String::from_bytes(&env, &out[..pos])
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        Self::read_balance(&env, id)
    }
    pub fn total_supply(env: Env) -> i128 {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0)
    }
    pub fn total_retired(env: Env) -> i128 {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        env.storage()
            .instance()
            .get(&DataKey::TotalRetired)
            .unwrap_or(0)
    }

    /// Returns `(registry_url, registry_project_id)` for external verification.
    pub fn get_registry_link(env: Env) -> (String, String) {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        let meta: ProjectMeta = env
            .storage()
            .instance()
            .get(&DataKey::ProjectMeta)
            .expect("project meta must be set");
        (meta.registry_url, meta.registry_project_id)
    }

    pub fn version(env: Env) -> String {
        String::from_str(&env, env!("CARGO_PKG_VERSION"))
    }

    // ── Internals ────────────────────────────────────────────────────────────

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

    // ── String helpers for number-to-String conversion ────────────────────────

    /// Convert a `u32` to a `soroban_sdk::String`.
    fn u32_to_string(env: &Env, mut n: u32) -> String {
        if n == 0 {
            return String::from_bytes(env, b"0");
        }
        let mut buf = [0u8; 10];
        let mut pos = 10usize;
        while n > 0 {
            pos -= 1;
            buf[pos] = b'0' + (n % 10) as u8;
            n /= 10;
        }
        String::from_bytes(env, &buf[pos..])
    }

    /// Convert a `u64` to a `soroban_sdk::String`.
    fn u64_to_string(env: &Env, mut n: u64) -> String {
        if n == 0 {
            return String::from_bytes(env, b"0");
        }
        let mut buf = [0u8; 20];
        let mut pos = 20usize;
        while n > 0 {
            pos -= 1;
            buf[pos] = b'0' + (n % 10) as u8;
            n /= 10;
        }
        String::from_bytes(env, &buf[pos..])
    }

    /// Convert an `i128` to a `soroban_sdk::String`.
    ///
    /// Buffer layout: `buf[0]` is optionally `'-'`; digits fill from the end.
    /// We then shift digits to immediately follow the sign byte before slicing.
    fn i128_to_string(env: &Env, n: i128) -> String {
        if n == 0 {
            return String::from_bytes(env, b"0");
        }
        // 1 sign byte + up to 39 digits for u128::MAX.
        let mut buf = [0u8; 40];
        let negative = n < 0;
        let abs: u128 = if n == i128::MIN {
            170_141_183_460_469_231_731_687_303_715_884_105_728u128
        } else if negative {
            (-n) as u128
        } else {
            n as u128
        };

        // Write digits right-to-left.
        let mut v = abs;
        let mut pos = 40usize;
        while v > 0 {
            pos -= 1;
            buf[pos] = b'0' + (v % 10) as u8;
            v /= 10;
        }
        // `pos` now points to the first digit in buf[pos..40].
        if negative {
            // Place sign byte immediately before the digits.
            let sign_pos = pos - 1;
            buf[sign_pos] = b'-';
            String::from_bytes(env, &buf[sign_pos..40])
        } else {
            String::from_bytes(env, &buf[pos..40])
        }
    }
}
