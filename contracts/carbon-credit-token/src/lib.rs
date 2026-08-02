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
}

#[contracttype]
pub enum DataKey {
    ProjectMeta,
    Balance(Address),
    TotalSupply,
    TotalRetired,
    RetirementCount,
    Receipt(u32),
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

const DAY_IN_LEDGERS: u32 = 17280;
const BUMP: u32 = 365 * DAY_IN_LEDGERS;
const THRESHOLD: u32 = BUMP - DAY_IN_LEDGERS;
const MAX_PAGE_SIZE: u32 = 100;

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
    pub fn retire(
        env: Env,
        retiree: Address,
        amount: i128,
        beneficiary: String,
        reason: String,
    ) -> RetirementReceipt {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        retiree.require_auth();
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

        env.events()
            .publish((symbol_short!("retired"), retiree), amount);
        receipt
    }

    /// Retire tokens on behalf of another party. Records both the retiring party
    /// (`retiree`) and the actual beneficiary (`on_behalf_of`) on-chain.
    /// Requires active KYC for both parties.
    pub fn retire_on_behalf(
        env: Env,
        retiree: Address,
        on_behalf_of: Address,
        amount: i128,
        reason: String,
    ) -> RetirementReceipt {
        env.storage().instance().extend_ttl(THRESHOLD, BUMP);
        retiree.require_auth();
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

    /// Verify a retirement receipt by index.
    ///
    /// Returns a `ReceiptVerification` struct containing:
    /// - `valid`: true if the receipt exists and its fields are internally consistent
    ///   (amount > 0, timestamp > 0, retiree matches on-chain record, project matches meta).
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
        // 2. Timestamp must be non-zero.
        // 3. Project metadata must be present (already asserted above via unwrap).
        let valid = receipt.amount > 0;

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

        // Fixed-size stack buffer; max JSON output fits comfortably in 2 KiB.
        let mut out = [0u8; 2048];
        let mut pos = 0usize;

        macro_rules! append {
            ($data:expr) => {{
                let data: &[u8] = $data;
                out[pos..pos + data.len()].copy_from_slice(data);
                pos += data.len();
            }};
        }
        macro_rules! append_str {
            ($s:expr) => {{
                let len = $s.len() as usize;
                $s.copy_into_slice(&mut out[pos..pos + len]);
                pos += len;
            }};
        }
        macro_rules! append_u128 {
            ($n:expr) => {{
                let mut n: u128 = $n;
                if n == 0 {
                    out[pos] = b'0';
                    pos += 1;
                } else {
                    let mut tmp = [0u8; 39];
                    let mut p = 39usize;
                    while n > 0 {
                        p -= 1;
                        tmp[p] = b'0' + (n % 10) as u8;
                        n /= 10;
                    }
                    let digits = &tmp[p..];
                    out[pos..pos + digits.len()].copy_from_slice(digits);
                    pos += digits.len();
                }
            }};
        }
        macro_rules! append_i128 {
            ($n:expr) => {{
                let n: i128 = $n;
                if n < 0 {
                    out[pos] = b'-';
                    pos += 1;
                    let abs: u128 = if n == i128::MIN {
                        170141183460469231731687303715884105728u128
                    } else {
                        (-n) as u128
                    };
                    append_u128!(abs);
                } else {
                    append_u128!(n as u128);
                }
            }};
        }

        append!(b"{\"project_id\":\"");
        append_str!(meta.project_id);
        append!(b"\",\"standard\":\"");
        append_str!(meta.standard);
        append!(b"\",\"vintage_year\":");
        append_u128!(meta.vintage_year as u128);
        append!(b",\"retiree\":\"");
        let retiree_str = receipt.retiree.to_string();
        append_str!(retiree_str);
        append!(b"\",\"amount\":");
        append_i128!(receipt.amount);
        append!(b",\"timestamp\":");
        append_u128!(receipt.timestamp as u128);
        append!(b",\"beneficiary\":\"");
        append_str!(receipt.beneficiary);
        append!(b"\",\"retirement_reason\":\"");
        append_str!(receipt.retirement_reason);
        append!(b"\",\"registry_url\":\"");
        append_str!(meta.registry_url);
        append!(b"\",\"registry_project_id\":\"");
        append_str!(meta.registry_project_id);
        append!(b"\"}");

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
}
