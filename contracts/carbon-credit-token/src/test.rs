#![cfg(test)]

use crate::{CarbonCreditToken, CarbonCreditTokenClient, ProjectMeta};
use compliance_engine::{ComplianceEngine, ComplianceEngineClient};
use kyc_registry::{KycRegistry, KycRegistryClient};
use soroban_sdk::{testutils::Address as _, Address, Env, String};

struct Harness {
    env: Env,
    token: CarbonCreditTokenClient<'static>,
    kyc: KycRegistryClient<'static>,
    compliance: ComplianceEngineClient<'static>,
    verifier: Address,
}

fn meta(env: &Env) -> ProjectMeta {
    ProjectMeta {
        project_id: String::from_str(env, "VCS-1234"),
        standard: String::from_str(env, "VCS"),
        vintage_year: 2024,
        project_name: String::from_str(env, "Amazon Reforestation"),
        project_type: String::from_str(env, "forestry"),
        country: String::from_str(env, "BR"),
        verifier: String::from_str(env, "Verra"),
        ipfs_cert_hash: String::from_str(env, "Qm..."),
    }
}

fn setup() -> Harness {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);

    let kyc_id = env.register(KycRegistry, ());
    let kyc = KycRegistryClient::new(&env, &kyc_id);
    kyc.initialize(&admin);
    let verifier = Address::generate(&env);
    kyc.add_verifier(&verifier);

    let compliance_id = env.register(ComplianceEngine, ());
    let compliance = ComplianceEngineClient::new(&env, &compliance_id);
    compliance.initialize(&admin);

    let token_id = env.register(CarbonCreditToken, ());
    let token = CarbonCreditTokenClient::new(&env, &token_id);
    token.initialize(&admin, &kyc_id, &compliance_id, &meta(&env));

    Harness {
        env,
        token,
        kyc,
        compliance,
        verifier,
    }
}

impl Harness {
    fn approve_kyc(&self, addr: &Address) {
        self.kyc.approve(
            &self.verifier,
            addr,
            &1,
            &0,
            &String::from_str(&self.env, "US"),
        );
    }
}

#[test]
fn test_metadata() {
    let h = setup();
    assert_eq!(h.token.decimals(), 0);
    assert_eq!(h.token.symbol(), String::from_str(&h.env, "VTCC"));
    assert_eq!(h.token.get_meta().standard, String::from_str(&h.env, "VCS"));
    assert_eq!(h.token.total_supply(), 0);
    assert_eq!(h.token.total_retired(), 0);
}

#[test]
fn test_mint_and_transfer() {
    let h = setup();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);

    h.token.mint(&alice, &500);
    assert_eq!(h.token.balance(&alice), 500);
    assert_eq!(h.token.total_supply(), 500);

    h.token.transfer(&alice, &bob, &200);
    assert_eq!(h.token.balance(&alice), 300);
    assert_eq!(h.token.balance(&bob), 200);
}

#[test]
fn test_transfer_requires_kyc() {
    let h = setup();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env); // no KYC
    h.approve_kyc(&alice);
    h.token.mint(&alice, &100);
    assert!(h.token.try_transfer(&alice, &bob, &10).is_err());
}

#[test]
fn test_transfer_blocked_when_paused() {
    let h = setup();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);
    h.token.mint(&alice, &100);

    h.compliance.pause();
    assert!(h.token.try_transfer(&alice, &bob, &10).is_err());
}

#[test]
fn test_retire_records_receipt() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &100);

    let receipt = h.token.retire(
        &alice,
        &40,
        &String::from_str(&h.env, "Acme Corp 2024 offset"),
        &String::from_str(&h.env, "annual net-zero pledge"),
    );

    assert_eq!(receipt.amount, 40);
    assert_eq!(receipt.retiree, alice);
    assert_eq!(h.token.balance(&alice), 60);
    assert_eq!(h.token.total_supply(), 60);
    assert_eq!(h.token.total_retired(), 40);

    assert_eq!(h.token.retirement_count(), 1);
    let r = h.token.get_receipt(&0);
    assert_eq!(r.amount, 40);
    assert_eq!(r.retiree, alice);
}

#[test]
fn test_retire_insufficient_balance() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &10);
    assert!(h
        .token
        .try_retire(
            &alice,
            &11,
            &String::from_str(&h.env, "x"),
            &String::from_str(&h.env, "y"),
        )
        .is_err());
}

#[test]
fn test_get_receipts_pagination() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &50);

    for i in 0..5u32 {
        h.token.retire(
            &alice,
            &1,
            &String::from_str(&h.env, "beneficiary"),
            &String::from_str(&h.env, "reason"),
        );
        let _ = i;
    }

    assert_eq!(h.token.retirement_count(), 5);

    // page 0: items 0..2
    let page0 = h.token.get_receipts(&0, &2);
    assert_eq!(page0.len(), 2);
    // page 1: items 2..4
    let page1 = h.token.get_receipts(&2, &2);
    assert_eq!(page1.len(), 2);
    // page 2: item 4
    let page2 = h.token.get_receipts(&4, &2);
    assert_eq!(page2.len(), 1);
    // start past end: empty
    let empty = h.token.get_receipts(&5, &2);
    assert_eq!(empty.len(), 0);
}

#[test]
fn test_get_receipts_caps_limit() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &10);

    for _ in 0..10u32 {
        h.token.retire(
            &alice,
            &1,
            &String::from_str(&h.env, "b"),
            &String::from_str(&h.env, "r"),
        );
    }

    // requesting 200 should be capped to MAX_PAGE_SIZE (100), but we only have 10
    let page = h.token.get_receipts(&0, &200);
    assert_eq!(page.len(), 10);
}

#[test]
fn test_retire_1000_scale() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &1000);

    for _ in 0..1000u32 {
        h.token.retire(
            &alice,
            &1,
            &String::from_str(&h.env, "b"),
            &String::from_str(&h.env, "r"),
        );
    }

    assert_eq!(h.token.retirement_count(), 1000);
    assert_eq!(h.token.total_retired(), 1000);
    assert_eq!(h.token.balance(&alice), 0);

    // spot-check a few receipts at arbitrary indices
    assert_eq!(h.token.get_receipt(&0).amount, 1);
    assert_eq!(h.token.get_receipt(&499).amount, 1);
    assert_eq!(h.token.get_receipt(&999).amount, 1);

    // paginate the last page
    let last_page = h.token.get_receipts(&950, &100);
    assert_eq!(last_page.len(), 50);
}
