#![no_std]

//! Carbon Credit Token — 1 token = 1 verified tonne of CO₂ equivalent retired.
//! Tokens are burned ("retired") to claim the carbon offset; retired credits
//! are permanently removed from circulation with an on-chain retirement receipt.
//! Minting is admin-gated and still enforces active KYC plus mint-time
//! compliance checks for pause/blocklist rules.

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, String, Vec};

#[contracttype]
pub enum DataKey {
    Admin,
    KycRegistry,
    ComplianceEngine,
    ProjectMeta,
    Balance(Address),
    TotalSupply,
    TotalRetired,
    RetirementReceipts,
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
}

#[contracttype]
#[derive(Clone)]
pub struct RetirementReceipt {
    pub retiree: Address,
    pub amount: i128,
    pub timestamp: u64,
    pub beneficiary: String, // optional free-text beneficiary name
    pub retirement_reason: String,
}

const DAY_IN_LEDGERS: u32 = 17280;
const BUMP: u32 = 365 * DAY_IN_LEDGERS;
const THRESHOLD: u32 = BUMP - DAY_IN_LEDGERS;

#[contract]
pub struct CarbonCreditToken;

#[contractimpl]
impl CarbonCreditToken {
    pub fn initialize(
        env: Env,
        admin: Address,
        kyc_registry: Address,
        compliance_engine: Address,
        meta: ProjectMeta,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::KycRegistry, &kyc_registry);
        env.storage()
            .instance()
            .set(&DataKey::ComplianceEngine, &compliance_engine);
        env.storage().instance().set(&DataKey::ProjectMeta, &meta);
        env.storage().instance().set(&DataKey::TotalSupply, &0i128);
        env.storage().instance().set(&DataKey::TotalRetired, &0i128);
        let receipts: Vec<RetirementReceipt> = Vec::new(&env);
        env.storage()
            .instance()
            .set(&DataKey::RetirementReceipts, &receipts);
    }

    // ── Metadata ─────────────────────────────────────────────────────────────

    pub fn get_meta(env: Env) -> ProjectMeta {
        env.storage().instance().get(&DataKey::ProjectMeta).unwrap()
    }

    pub fn name(env: Env) -> String {
        String::from_str(&env, "Veritoken Carbon Credit")
    }
    pub fn symbol(env: Env) -> String {
        String::from_str(&env, "VTCC")
    }
    pub fn decimals(_env: Env) -> u32 {
        0
    }

    // ── Issuance ─────────────────────────────────────────────────────────────

    pub fn mint(env: Env, to: Address, amount: i128) {
        Self::require_admin(&env);
        Self::require_kyc(&env, &to);
        Self::check_mint_compliance(&env, &to);
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
        env.events().publish((symbol_short!("mint"), to), amount);
    }

    // ── Transfer ─────────────────────────────────────────────────────────────

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        Self::require_kyc(&env, &from);
        Self::require_kyc(&env, &to);
        Self::check_compliance(&env, &from, &to, amount);
        let from_bal = Self::read_balance(&env, from.clone());
        if from_bal < amount {
            panic!("insufficient balance");
        }
        Self::write_balance(&env, from.clone(), from_bal - amount);
        let to_bal = Self::read_balance(&env, to.clone());
        Self::write_balance(&env, to.clone(), to_bal + amount);
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
        retiree.require_auth();
        let bal = Self::read_balance(&env, retiree.clone());
        if bal < amount {
            panic!("insufficient balance");
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
        let receipt = RetirementReceipt {
            retiree: retiree.clone(),
            amount,
            timestamp: env.ledger().timestamp(),
            beneficiary,
            retirement_reason: reason,
        };
        let mut receipts: Vec<RetirementReceipt> = env
            .storage()
            .instance()
            .get(&DataKey::RetirementReceipts)
            .unwrap_or_else(|| Vec::new(&env));
        receipts.push_back(receipt.clone());
        env.storage()
            .instance()
            .set(&DataKey::RetirementReceipts, &receipts);
        env.events()
            .publish((symbol_short!("retired"), retiree), amount);
        receipt
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        Self::read_balance(&env, id)
    }
    pub fn total_supply(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0)
    }
    pub fn total_retired(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalRetired)
            .unwrap_or(0)
    }
    pub fn retirement_receipts(env: Env) -> Vec<RetirementReceipt> {
        env.storage()
            .instance()
            .get(&DataKey::RetirementReceipts)
            .unwrap_or_else(|| Vec::new(&env))
    }

    // ── Internals ────────────────────────────────────────────────────────────

    fn require_admin(env: &Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
    }

    fn require_kyc(env: &Env, addr: &Address) {
        let registry: Address = env.storage().instance().get(&DataKey::KycRegistry).unwrap();
        let client = KycRegistryClient::new(env, &registry);
        if !client.is_approved(addr) {
            panic!("KYC not approved");
        }
    }

    fn check_mint_compliance(env: &Env, to: &Address) {
        let engine: Address = env
            .storage()
            .instance()
            .get(&DataKey::ComplianceEngine)
            .unwrap();
        let client = ComplianceEngineClient::new(env, &engine);
        if client.get_rules().paused {
            panic!("mint blocked by compliance pause");
        }
        if client.is_blocklisted(to) {
            panic!("mint recipient is blocklisted");
        }
    }

    fn check_compliance(env: &Env, from: &Address, to: &Address, amount: i128) {
        let engine: Address = env
            .storage()
            .instance()
            .get(&DataKey::ComplianceEngine)
            .unwrap();
        let client = ComplianceEngineClient::new(env, &engine);
        if !client.can_transfer(from, to, &amount) {
            panic!("transfer blocked by compliance engine");
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
}

mod kyc_iface {
    use soroban_sdk::{contractclient, Address};
    #[contractclient(name = "KycRegistryClient")]
    #[allow(dead_code)]
    pub trait KycRegistry {
        fn is_approved(env: soroban_sdk::Env, addr: Address) -> bool;
    }
}

mod compliance_iface {
    use soroban_sdk::{contractclient, Address};
    #[contractclient(name = "ComplianceEngineClient")]
    #[allow(dead_code)]
    pub trait ComplianceEngine {
        fn get_rules(env: soroban_sdk::Env) -> super::compliance_engine::ComplianceRules;
        fn is_blocklisted(env: soroban_sdk::Env, addr: Address) -> bool;
        fn can_transfer(env: soroban_sdk::Env, from: Address, to: Address, amount: i128) -> bool;
    }
}

mod compliance_engine {
    use soroban_sdk::contracttype;

    #[contracttype]
    #[derive(Clone)]
    pub struct ComplianceRules {
        pub max_transfer_amount: i128,
        pub min_holding_period: u64,
        pub max_holders: u32,
        pub require_same_jurisdiction: bool,
        pub paused: bool,
    }
}

use compliance_iface::ComplianceEngineClient;
use kyc_iface::KycRegistryClient;
