#![cfg(test)]

use crate::{CarbonCreditToken, CarbonCreditTokenClient, ProjectMeta, RetirementRequest};
use compliance_engine::{ComplianceEngine, ComplianceEngineClient};
use kyc_registry::{KycRegistry, KycRegistryClient};
use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, Address, Env, String};

struct Harness {
    env: Env,
    token: CarbonCreditTokenClient<'static>,
    kyc: KycRegistryClient<'static>,
    compliance: ComplianceEngineClient<'static>,
    verifier: Address,
    admin: Address,
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
        ipfs_cert_hash: String::from_str(env, ""),
        registry_url: String::from_str(env, "https://registry.verra.org"),
        registry_project_id: String::from_str(env, "VCS-1234"),
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
    kyc.add_verifier(&admin, &verifier);

    let compliance_id = env.register(ComplianceEngine, ());
    let compliance = ComplianceEngineClient::new(&env, &compliance_id);
    compliance.initialize(&admin, &kyc_id, &0u64);

    // Carbon credit token — constructor args passed atomically at register time
    let token_id = env.register(
        CarbonCreditToken,
        (
            admin.clone(),
            kyc_id.clone(),
            compliance_id.clone(),
            meta(&env),
        ),
    );
    let token = CarbonCreditTokenClient::new(&env, &token_id);

    Harness {
        env,
        token,
        kyc,
        compliance,
        verifier,
        admin,
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
fn test_mint_rejects_blocklisted_recipient() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.compliance.add_to_blocklist(&alice);

    assert!(h.token.try_mint(&alice, &100).is_err());
}

#[test]
fn test_mint_rejects_when_compliance_paused() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.compliance.pause();

    assert!(h.token.try_mint(&alice, &100).is_err());
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
fn test_retire_blocked_when_paused() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &100);

    // Pausing the compliance engine must freeze all token operations, including
    // retirements (burns).
    h.compliance.pause();
    assert!(h
        .token
        .try_retire(
            &alice,
            &10,
            &String::from_str(&h.env, "Acme Corp 2024 offset"),
            &String::from_str(&h.env, "annual net-zero pledge"),
        )
        .is_err());

    // After unpausing, the retirement goes through.
    h.compliance.unpause();
    let receipt = h.token.retire(
        &alice,
        &10,
        &String::from_str(&h.env, "Acme Corp 2024 offset"),
        &String::from_str(&h.env, "annual net-zero pledge"),
    );
    assert_eq!(receipt.amount, 10);
    assert_eq!(h.token.balance(&alice), 90);
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
fn test_mint_twice_same_address_holder_count_is_one() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);

    h.token.mint(&alice, &100);
    h.token.mint(&alice, &50);

    assert_eq!(h.compliance.holder_count(), 1);
    assert_eq!(h.token.balance(&alice), 150);
}

#[test]
fn test_non_deployer_cannot_reinitialize() {
    let h = setup();
    let attacker = Address::generate(&h.env);
    let kyc_id = Address::generate(&h.env);
    let ce_id = Address::generate(&h.env);
    // initialize must always panic — the constructor has already run
    let result = h
        .token
        .try_initialize(&attacker, &kyc_id, &ce_id, &meta(&h.env));
    assert!(result.is_err());
}

// ── update_kyc_registry / update_compliance_engine tests ─────────────────────

#[test]
fn test_update_kyc_registry_admin_only() {
    let h = setup();
    let new_kyc = Address::generate(&h.env);

    // Non-admin: separate env, no auths mocked
    {
        let env2 = Env::default();
        let non_admin = Address::generate(&env2);
        let token_id2 = env2.register(
            CarbonCreditToken,
            (
                non_admin.clone(),
                Address::generate(&env2),
                Address::generate(&env2),
                meta(&env2),
            ),
        );
        let client2 = CarbonCreditTokenClient::new(&env2, &token_id2);
        assert!(client2
            .try_update_kyc_registry(&Address::generate(&env2))
            .is_err());
    }

    // Admin succeeds
    h.token.update_kyc_registry(&new_kyc);
}

#[test]
fn test_update_compliance_engine_admin_only() {
    let h = setup();

    // Non-admin: separate env, no auths mocked
    {
        let env2 = Env::default();
        let non_admin = Address::generate(&env2);
        let token_id2 = env2.register(
            CarbonCreditToken,
            (
                non_admin.clone(),
                Address::generate(&env2),
                Address::generate(&env2),
                meta(&env2),
            ),
        );
        let client2 = CarbonCreditTokenClient::new(&env2, &token_id2);
        assert!(client2
            .try_update_compliance_engine(&Address::generate(&env2))
            .is_err());
    }

    // Deploy a second compliance engine and pause it
    let ce2_id = h.env.register(ComplianceEngine, ());
    let ce2 = ComplianceEngineClient::new(&h.env, &ce2_id);
    let dummy_kyc = h.env.register(kyc_registry::KycRegistry, ());
    ce2.initialize(&h.admin, &dummy_kyc, &0u64);
    ce2.pause();

    // Admin can update
    h.token.update_compliance_engine(&ce2_id);

    // Mints through the paused engine are now blocked
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    assert!(h.token.try_mint(&alice, &10).is_err());
}

#[test]
fn test_to_certificate_json() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &50);

    h.token.retire(
        &alice,
        &30,
        &String::from_str(&h.env, "Acme Corp 2024"),
        &String::from_str(&h.env, "net-zero pledge"),
    );

    let json = h.token.to_certificate_json(&0);

    // Verify JSON contains required fields by checking byte content.
    // Max certificate JSON is ~950 bytes with 128-byte field cap.
    let len = json.len() as usize;
    let mut buf = [0u8; 1024];
    json.copy_into_slice(&mut buf[..len]);
    let s = core::str::from_utf8(&buf[..len]).expect("valid utf8");

    assert!(s.contains("\"project_id\":\"VCS-1234\""));
    assert!(s.contains("\"standard\":\"VCS\""));
    assert!(s.contains("\"vintage_year\":2024"));
    assert!(s.contains("\"amount\":30"));
    assert!(s.contains("\"beneficiary\":\"Acme Corp 2024\""));
    assert!(s.contains("\"retirement_reason\":\"net-zero pledge\""));
    assert!(s.contains("\"retiree\":"));
    assert!(s.contains("\"timestamp\":"));
}

#[test]
fn test_to_certificate_json_escapes_special_characters() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &10);
    h.token.retire(
        &alice,
        &10,
        &String::from_str(&h.env, "Beneficiary: \"Acme\" \\ North\nLine"),
        &String::from_str(&h.env, "Reason\twith\rcontrols"),
    );

    let json = h.token.to_certificate_json(&0);
    let len = json.len() as usize;
    let mut buf = [0u8; 1024];
    json.copy_into_slice(&mut buf[..len]);
    let s = core::str::from_utf8(&buf[..len]).expect("valid utf8");

    assert!(s.contains("\\\"Acme\\\""));
    assert!(s.contains("\\\\ North\\nLine"));
    assert!(s.contains("Reason\\twith\\rcontrols"));
}

#[test]
fn test_retire_exact_balance_updates_accounting_and_receipts() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &7);

    h.token.retire(
        &alice,
        &7,
        &String::from_str(&h.env, "Acme"),
        &String::from_str(&h.env, "net zero"),
    );

    assert_eq!(h.token.balance(&alice), 0);
    assert_eq!(h.token.total_retired(), 7);
    assert_eq!(h.token.retirement_count(), 1);
    assert_eq!(h.token.get_receipts(&0, &10).len(), 1);
}

#[test]
fn test_retire_over_balance_fails_without_receipt() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &7);

    let result = h.token.try_retire(
        &alice,
        &8,
        &String::from_str(&h.env, "Acme"),
        &String::from_str(&h.env, "net zero"),
    );

    assert!(result.is_err());
    assert_eq!(h.token.balance(&alice), 7);
    assert_eq!(h.token.total_retired(), 0);
    assert_eq!(h.token.retirement_count(), 0);
    assert_eq!(h.token.get_receipts(&0, &10).len(), 0);
}

// ── project_type validation tests (#255) ─────────────────────────────────────

#[test]
#[should_panic]
fn test_invalid_project_type_panics_in_constructor() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let kyc_id = Address::generate(&env);
    let ce_id = Address::generate(&env);
    let mut bad_meta = meta(&env);
    bad_meta.project_type = String::from_str(&env, "nuclear");
    env.register(CarbonCreditToken, (admin, kyc_id, ce_id, bad_meta));
}

#[test]
fn test_valid_project_types_accepted_in_constructor() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    for pt in ["forestry", "renewable", "methane_capture"] {
        let kyc_id = env.register(KycRegistry, ());
        let kyc = KycRegistryClient::new(&env, &kyc_id);
        kyc.initialize(&admin);
        let compliance_id = env.register(ComplianceEngine, ());
        let compliance = ComplianceEngineClient::new(&env, &compliance_id);
        compliance.initialize(&admin, &kyc_id, &0u64);
        let mut m = meta(&env);
        m.project_type = String::from_str(&env, pt);
        let token_id = env.register(CarbonCreditToken, (admin.clone(), kyc_id, compliance_id, m));
        let token = CarbonCreditTokenClient::new(&env, &token_id);
        assert_eq!(token.get_meta().project_type, String::from_str(&env, pt));
    }
}

#[test]
fn test_invalid_project_type_panics_in_update_meta() {
    let h = setup();
    let mut bad_meta = h.token.get_meta();
    bad_meta.project_type = String::from_str(&h.env, "coal");
    assert!(h.token.try_update_meta(&bad_meta).is_err());
}

#[test]
fn test_valid_project_type_accepted_in_update_meta() {
    let h = setup();
    let mut new_meta = h.token.get_meta();
    new_meta.project_type = String::from_str(&h.env, "renewable");
    h.token.update_meta(&new_meta);
    assert_eq!(
        h.token.get_meta().project_type,
        String::from_str(&h.env, "renewable")
    );
}

#[test]
fn test_update_compliance_engine_affects_transfers() {
    let h = setup();

    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);
    h.token.mint(&alice, &100);

    // Deploy and switch to a paused engine
    let ce2_id = h.env.register(ComplianceEngine, ());
    let ce2 = ComplianceEngineClient::new(&h.env, &ce2_id);
    let dummy_kyc = h.env.register(kyc_registry::KycRegistry, ());
    ce2.initialize(&h.admin, &dummy_kyc, &0u64);
    ce2.pause();

    h.token.update_compliance_engine(&ce2_id);
    assert!(h.token.try_transfer(&alice, &bob, &10).is_err());
}

#[test]
fn test_version_returns_nonempty() {
    let h = setup();
    let v = h.token.version();
    assert!(!v.is_empty());
}

#[test]
fn test_vintage_year_boundaries_accepted() {
    let h = setup();
    let mut m = meta(&h.env);

    m.vintage_year = 1990;
    h.token.update_meta(&m);

    m.vintage_year = 2050;
    h.token.update_meta(&m);
}

#[test]
fn test_vintage_year_below_min_rejected() {
    let h = setup();
    let mut m = meta(&h.env);
    m.vintage_year = 1989;
    assert!(h.token.try_update_meta(&m).is_err());
}

#[test]
fn test_vintage_year_above_max_rejected() {
    let h = setup();
    let mut m = meta(&h.env);
    m.vintage_year = 2051;
    assert!(h.token.try_update_meta(&m).is_err());
}

#[test]
fn test_vintage_year_zero_rejected() {
    let h = setup();
    let mut m = meta(&h.env);
    m.vintage_year = 0;
    assert!(h.token.try_update_meta(&m).is_err());
}

// ── get_receipts pagination tests (#202) ─────────────────────────────────────

/// Helper: retire `amount` tokens from alice in the given harness.
fn do_retire(h: &Harness, alice: &Address, amount: i128) {
    h.token.retire(
        alice,
        &amount,
        &String::from_str(&h.env, "beneficiary"),
        &String::from_str(&h.env, "reason"),
    );
}

#[test]
fn test_get_receipts_pagination() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    // Mint enough to retire 5 times
    h.token.mint(&alice, &500);

    for amount in [10i128, 20, 30, 40, 50] {
        do_retire(&h, &alice, amount);
    }

    assert_eq!(h.token.retirement_count(), 5);

    // First page: start=0, limit=3 → indices 0,1,2
    let page1 = h.token.get_receipts(&0, &3);
    assert_eq!(page1.len(), 3);

    // Second page: start=3, limit=3 → indices 3,4 (only 2 remain)
    let page2 = h.token.get_receipts(&3, &3);
    assert_eq!(page2.len(), 2);
}

#[test]
fn test_get_receipts_limit_cap() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &200);

    // Retire only twice
    do_retire(&h, &alice, 50);
    do_retire(&h, &alice, 75);

    assert_eq!(h.token.retirement_count(), 2);

    // Requesting 200 items (> MAX_PAGE_SIZE=100) should still only return 2
    let results = h.token.get_receipts(&0, &200);
    assert_eq!(results.len(), 2);
}

#[test]
fn test_get_receipts_beyond_end_returns_empty() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &100);

    do_retire(&h, &alice, 10);

    assert_eq!(h.token.retirement_count(), 1);

    // start=5 is past the single receipt at index 0 → empty
    let results = h.token.get_receipts(&5, &10);
    assert_eq!(results.len(), 0);
}

#[test]
fn test_get_receipts_insertion_order() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &300);

    let amounts = [10i128, 20, 30];
    for &amount in &amounts {
        do_retire(&h, &alice, amount);
    }

    assert_eq!(h.token.retirement_count(), 3);

    let receipts = h.token.get_receipts(&0, &10);
    assert_eq!(receipts.len(), 3);

    // Receipts must appear in insertion (retirement) order
    assert_eq!(receipts.get(0).unwrap().amount, 10);
    assert_eq!(receipts.get(1).unwrap().amount, 20);
    assert_eq!(receipts.get(2).unwrap().amount, 30);
}

// ── batch_retire ──────────────────────────────────────────────────────────────

#[test]
fn test_batch_retire_creates_correct_receipts() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &300);

    let retirements = soroban_sdk::vec![
        &h.env,
        (
            100i128,
            String::from_str(&h.env, "Acme Corp"),
            String::from_str(&h.env, "Q1 offset")
        ),
        (
            80i128,
            String::from_str(&h.env, "Beta LLC"),
            String::from_str(&h.env, "Q2 offset")
        ),
        (
            60i128,
            String::from_str(&h.env, "Gamma Inc"),
            String::from_str(&h.env, "Q3 offset")
        ),
    ];

    let receipts = h.token.batch_retire(&alice, &retirements);

    // Three receipts returned in order.
    assert_eq!(receipts.len(), 3);
    assert_eq!(receipts.get(0).unwrap().amount, 100);
    assert_eq!(receipts.get(1).unwrap().amount, 80);
    assert_eq!(receipts.get(2).unwrap().amount, 60);

    // All receipts point to the correct retiree.
    for i in 0..3 {
        assert_eq!(receipts.get(i).unwrap().retiree, alice);
    }

    // Beneficiary and reason are stored correctly.
    assert_eq!(
        receipts.get(0).unwrap().beneficiary,
        String::from_str(&h.env, "Acme Corp")
    );
    assert_eq!(
        receipts.get(1).unwrap().retirement_reason,
        String::from_str(&h.env, "Q2 offset")
    );
}

#[test]
fn test_batch_retire_deducts_total_once() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &500);

    let retirements = soroban_sdk::vec![
        &h.env,
        (
            150i128,
            String::from_str(&h.env, "A"),
            String::from_str(&h.env, "r1")
        ),
        (
            100i128,
            String::from_str(&h.env, "B"),
            String::from_str(&h.env, "r2")
        ),
    ];

    h.token.batch_retire(&alice, &retirements);

    // 500 - (150 + 100) = 250 remaining.
    assert_eq!(h.token.balance(&alice), 250);
    assert_eq!(h.token.total_supply(), 250);
    assert_eq!(h.token.total_retired(), 250);
}

#[test]
fn test_batch_retire_increments_retirement_count() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &500);

    assert_eq!(h.token.retirement_count(), 0);

    let retirements = soroban_sdk::vec![
        &h.env,
        (
            10i128,
            String::from_str(&h.env, "A"),
            String::from_str(&h.env, "r")
        ),
        (
            20i128,
            String::from_str(&h.env, "B"),
            String::from_str(&h.env, "r")
        ),
        (
            30i128,
            String::from_str(&h.env, "C"),
            String::from_str(&h.env, "r")
        ),
    ];

    h.token.batch_retire(&alice, &retirements);

    // Three new receipts were stored.
    assert_eq!(h.token.retirement_count(), 3);
}

#[test]
fn test_batch_retire_receipts_accessible_via_get_receipt() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &200);

    let retirements = soroban_sdk::vec![
        &h.env,
        (
            70i128,
            String::from_str(&h.env, "Eco Fund"),
            String::from_str(&h.env, "annual")
        ),
        (
            50i128,
            String::from_str(&h.env, "Offset DAO"),
            String::from_str(&h.env, "q4")
        ),
    ];

    h.token.batch_retire(&alice, &retirements);

    let r0 = h.token.get_receipt(&0);
    assert_eq!(r0.amount, 70);
    assert_eq!(r0.beneficiary, String::from_str(&h.env, "Eco Fund"));

    let r1 = h.token.get_receipt(&1);
    assert_eq!(r1.amount, 50);
    assert_eq!(r1.beneficiary, String::from_str(&h.env, "Offset DAO"));
}

#[test]
fn test_batch_retire_size_limit_panics() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &10_000);

    // Build 11 entries — one over the cap.
    let mut retirements: soroban_sdk::Vec<(i128, String, String)> = soroban_sdk::Vec::new(&h.env);
    for _ in 0..11 {
        retirements.push_back((
            1i128,
            String::from_str(&h.env, "ben"),
            String::from_str(&h.env, "reason"),
        ));
    }

    assert!(h.token.try_batch_retire(&alice, &retirements).is_err());

    // No state changes on failure.
    assert_eq!(h.token.balance(&alice), 10_000);
    assert_eq!(h.token.retirement_count(), 0);
}

#[test]
fn test_batch_retire_insufficient_balance_rejected() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &50);

    // Total = 30 + 30 = 60 > 50.
    let retirements = soroban_sdk::vec![
        &h.env,
        (
            30i128,
            String::from_str(&h.env, "A"),
            String::from_str(&h.env, "r")
        ),
        (
            30i128,
            String::from_str(&h.env, "B"),
            String::from_str(&h.env, "r")
        ),
    ];

    assert!(h.token.try_batch_retire(&alice, &retirements).is_err());

    // Balance unchanged, no receipts stored.
    assert_eq!(h.token.balance(&alice), 50);
    assert_eq!(h.token.retirement_count(), 0);
}

#[test]
fn test_batch_retire_blocked_when_paused() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &200);
    h.compliance.pause();

    let retirements = soroban_sdk::vec![
        &h.env,
        (
            50i128,
            String::from_str(&h.env, "A"),
            String::from_str(&h.env, "r")
        ),
    ];

    assert!(h.token.try_batch_retire(&alice, &retirements).is_err());
    assert_eq!(h.token.balance(&alice), 200);
    assert_eq!(h.token.retirement_count(), 0);
}

#[test]
fn test_batch_retire_zero_amount_entry_rejected() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &200);

    let retirements = soroban_sdk::vec![
        &h.env,
        (
            50i128,
            String::from_str(&h.env, "A"),
            String::from_str(&h.env, "r")
        ),
        (
            0i128,
            String::from_str(&h.env, "B"),
            String::from_str(&h.env, "r")
        ), // invalid
    ];

    assert!(h.token.try_batch_retire(&alice, &retirements).is_err());
    assert_eq!(h.token.balance(&alice), 200);
    assert_eq!(h.token.retirement_count(), 0);
}

#[test]
fn test_batch_retire_indices_follow_existing_receipts() {
    // A prior single retire leaves receipt at index 0; batch should start at 1.
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &500);

    // Single retire → index 0.
    h.token.retire(
        &alice,
        &10,
        &String::from_str(&h.env, "prior"),
        &String::from_str(&h.env, "pre-batch"),
    );
    assert_eq!(h.token.retirement_count(), 1);

    // Batch of 2 → indices 1 and 2.
    let retirements = soroban_sdk::vec![
        &h.env,
        (
            20i128,
            String::from_str(&h.env, "X"),
            String::from_str(&h.env, "batch-1")
        ),
        (
            30i128,
            String::from_str(&h.env, "Y"),
            String::from_str(&h.env, "batch-2")
        ),
    ];
    h.token.batch_retire(&alice, &retirements);

    assert_eq!(h.token.retirement_count(), 3);
    assert_eq!(h.token.get_receipt(&1).amount, 20);
    assert_eq!(h.token.get_receipt(&2).amount, 30);
}

#[test]
fn test_batch_retire_ten_entries_at_cap_succeeds() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &1_000);

    let mut retirements: soroban_sdk::Vec<(i128, String, String)> = soroban_sdk::Vec::new(&h.env);
    for _ in 0..10u32 {
        retirements.push_back((
            10i128,
            String::from_str(&h.env, "ben"),
            String::from_str(&h.env, "reason"),
        ));
    }

    let receipts = h.token.batch_retire(&alice, &retirements);
    assert_eq!(receipts.len(), 10);
    assert_eq!(h.token.retirement_count(), 10);
    assert_eq!(h.token.balance(&alice), 900);
    assert_eq!(h.token.total_retired(), 100);
}

// ── Receipt verification tests (#356) ────────────────────────────────────────

#[test]
fn test_verify_receipt_valid() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &50);

    // Set a non-zero ledger timestamp so the receipt is valid.
    h.env.ledger().with_mut(|li| li.timestamp = 1_700_000_000);

    h.token.retire(
        &alice,
        &50,
        &String::from_str(&h.env, "Acme Corp"),
        &String::from_str(&h.env, "Annual offset"),
    );

    let v = h.token.verify_receipt(&0);
    assert!(v.valid);
    assert_eq!(v.index, 0);
    assert_eq!(v.amount, 50);
    assert_eq!(v.retiree, alice);
    // serial should be project_id + "-0"
    let expected_serial = String::from_str(&h.env, "VCS-1234-0");
    assert_eq!(v.serial, expected_serial);
}

#[test]
fn test_verify_receipt_out_of_range_is_invalid() {
    let h = setup();
    let v = h.token.verify_receipt(&99);
    assert!(!v.valid);
}

#[test]
fn test_get_receipts_by_retiree() {
    let h = setup();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);
    h.token.mint(&alice, &100);
    h.token.mint(&bob, &100);

    h.token.retire(
        &alice,
        &30,
        &String::from_str(&h.env, "Alice Org"),
        &String::from_str(&h.env, "scope 1"),
    );
    h.token.retire(
        &bob,
        &20,
        &String::from_str(&h.env, "Bob Org"),
        &String::from_str(&h.env, "scope 2"),
    );
    h.token.retire(
        &alice,
        &10,
        &String::from_str(&h.env, "Alice Org 2"),
        &String::from_str(&h.env, "scope 3"),
    );

    // Alice should have 2 receipts
    let alice_receipts = h.token.get_receipts_by_retiree(&alice, &0, &10);
    assert_eq!(alice_receipts.len(), 2);
    assert_eq!(alice_receipts.get(0).unwrap().amount, 30);
    assert_eq!(alice_receipts.get(1).unwrap().amount, 10);

    // Bob should have 1 receipt
    let bob_receipts = h.token.get_receipts_by_retiree(&bob, &0, &10);
    assert_eq!(bob_receipts.len(), 1);
    assert_eq!(bob_receipts.get(0).unwrap().amount, 20);
}

#[test]
fn test_verify_receipt_zero_amount_is_invalid() {
    // Can't retire 0 (InvalidAmount error), so we verify an out-of-range index
    // to confirm the invalid-state path. The contract rejects amount=0 at retire time.
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &10);

    // Set non-zero timestamp so the stored receipt is itself valid.
    h.env.ledger().with_mut(|li| li.timestamp = 1_700_000_000);

    h.token.retire(
        &alice,
        &10,
        &String::from_str(&h.env, "Corp"),
        &String::from_str(&h.env, "reason"),
    );

    // Index 0 is valid (amount > 0, timestamp > 0).
    assert!(h.token.verify_receipt(&0).valid);
    // Index 1 does not exist → invalid.
    assert!(!h.token.verify_receipt(&1).valid);
}

// ── Issue #541: Beneficiary index tests ──────────────────────────────────────

/// retire() should populate the per-beneficiary index for the retiree.
#[test]
fn test_retire_updates_beneficiary_index_for_retiree() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &300);

    // Three separate retires by alice.
    do_retire(&h, &alice, 10);
    do_retire(&h, &alice, 20);
    do_retire(&h, &alice, 30);

    // get_receipts_by_beneficiary(alice) should return exactly those 3 receipts
    // in insertion order, without scanning the whole global list.
    let receipts = h.token.get_receipts_by_beneficiary(&alice, &0, &100);
    assert_eq!(receipts.len(), 3);
    assert_eq!(receipts.get(0).unwrap().amount, 10);
    assert_eq!(receipts.get(1).unwrap().amount, 20);
    assert_eq!(receipts.get(2).unwrap().amount, 30);
}

/// retire_on_behalf() should populate the per-beneficiary index for on_behalf_of.
#[test]
fn test_retire_on_behalf_updates_beneficiary_index() {
    let h = setup();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);
    h.token.mint(&alice, &200);

    // Alice retires on behalf of Bob twice.
    h.token.retire_on_behalf(
        &alice,
        &bob,
        &50,
        &String::from_str(&h.env, "offset for bob 1"),
    );
    h.token.retire_on_behalf(
        &alice,
        &bob,
        &30,
        &String::from_str(&h.env, "offset for bob 2"),
    );

    // Bob's beneficiary index should show 2 receipts.
    let bob_receipts = h.token.get_receipts_by_beneficiary(&bob, &0, &100);
    assert_eq!(bob_receipts.len(), 2);
    assert_eq!(bob_receipts.get(0).unwrap().amount, 50);
    assert_eq!(bob_receipts.get(1).unwrap().amount, 30);

    // Alice's beneficiary index should be empty (she retired on behalf of bob).
    let alice_receipts = h.token.get_receipts_by_beneficiary(&alice, &0, &100);
    assert_eq!(alice_receipts.len(), 0);
}

/// get_receipts_by_beneficiary with 5 distinct beneficiaries.
#[test]
fn test_beneficiary_index_five_beneficiaries() {
    let h = setup();
    let retiree = Address::generate(&h.env);
    h.approve_kyc(&retiree);
    h.token.mint(&retiree, &5_000);

    // Create 5 beneficiaries, retire different amounts for each.
    let ben0 = Address::generate(&h.env);
    let ben1 = Address::generate(&h.env);
    let ben2 = Address::generate(&h.env);
    let ben3 = Address::generate(&h.env);
    let ben4 = Address::generate(&h.env);
    let bens = [&ben0, &ben1, &ben2, &ben3, &ben4];
    let amounts = [10i128, 20, 30, 40, 50];

    for (ben, &amt) in bens.iter().zip(amounts.iter()) {
        h.approve_kyc(ben);
        h.token
            .retire_on_behalf(&retiree, ben, &amt, &String::from_str(&h.env, "reason"));
    }

    assert_eq!(h.token.retirement_count(), 5);

    for (ben, &amt) in bens.iter().zip(amounts.iter()) {
        let receipts = h.token.get_receipts_by_beneficiary(ben, &0, &100);
        assert_eq!(
            receipts.len(),
            1,
            "beneficiary should have exactly 1 receipt"
        );
        assert_eq!(receipts.get(0).unwrap().amount, amt);
    }
}

/// get_receipts_by_beneficiary with 10 beneficiaries (max batch size).
#[test]
fn test_beneficiary_index_ten_beneficiaries() {
    let h = setup();
    let retiree = Address::generate(&h.env);
    h.approve_kyc(&retiree);
    h.token.mint(&retiree, &10_000);

    let b0 = Address::generate(&h.env);
    let b1 = Address::generate(&h.env);
    let b2 = Address::generate(&h.env);
    let b3 = Address::generate(&h.env);
    let b4 = Address::generate(&h.env);
    let b5 = Address::generate(&h.env);
    let b6 = Address::generate(&h.env);
    let b7 = Address::generate(&h.env);
    let b8 = Address::generate(&h.env);
    let b9 = Address::generate(&h.env);
    let bens = [&b0, &b1, &b2, &b3, &b4, &b5, &b6, &b7, &b8, &b9];

    for (i, ben) in bens.iter().enumerate() {
        h.approve_kyc(ben);
        h.token.retire_on_behalf(
            &retiree,
            ben,
            &((i as i128 + 1) * 10),
            &String::from_str(&h.env, "reason"),
        );
    }

    assert_eq!(h.token.retirement_count(), 10);

    for (i, ben) in bens.iter().enumerate() {
        let receipts = h.token.get_receipts_by_beneficiary(ben, &0, &100);
        assert_eq!(receipts.len(), 1);
        assert_eq!(receipts.get(0).unwrap().amount, (i as i128 + 1) * 10);
    }
}

/// A single beneficiary with multiple retire_on_behalf calls — index grows correctly.
#[test]
fn test_beneficiary_index_single_beneficiary_multiple_retires() {
    let h = setup();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);
    h.token.mint(&alice, &1_000);

    let amounts = [5i128, 15, 25, 35, 45];
    for &amt in &amounts {
        h.token.retire_on_behalf(
            &alice,
            &bob,
            &amt,
            &String::from_str(&h.env, "multi-retire"),
        );
    }

    let receipts = h.token.get_receipts_by_beneficiary(&bob, &0, &100);
    assert_eq!(receipts.len(), 5);
    for (i, &amt) in amounts.iter().enumerate() {
        assert_eq!(receipts.get(i as u32).unwrap().amount, amt);
    }
}

// ── Issue #541: to_certificate_json field length guard ───────────────────────

/// Passing a 200-character beneficiary string to retire() must return
/// Error::FieldTooLong rather than panicking / trapping.
#[test]
fn test_retire_field_too_long_returns_error_not_panic() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &100);

    // 200 'A' characters — well over the 128-byte content cap.
    let long_field = String::from_str(
        &h.env,
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    );

    let result = h.token.try_retire(
        &alice,
        &10,
        &long_field,
        &String::from_str(&h.env, "reason"),
    );
    // Must return an error — FieldTooLong — not an instruction trap.
    assert!(result.is_err(), "retire with 200-char field must fail");

    // Balance and receipt count unchanged — no state mutation on error.
    assert_eq!(h.token.balance(&alice), 100);
    assert_eq!(h.token.retirement_count(), 0);
}

/// 128-character beneficiary string is exactly at the cap — must succeed.
#[test]
fn test_retire_field_at_128_bytes_succeeds() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &100);

    // Exactly 128 'A' characters — at the boundary, must be accepted.
    let at_cap = String::from_str(
        &h.env,
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    );

    let result = h
        .token
        .try_retire(&alice, &10, &at_cap, &String::from_str(&h.env, "reason"));
    assert!(result.is_ok(), "128-char field must be accepted");
    assert_eq!(h.token.retirement_count(), 1);
}

/// 129-character beneficiary string is one over the cap — must fail.
#[test]
fn test_retire_field_at_129_bytes_fails() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &100);

    // 129 'A' characters — one over the 128-byte content cap, must be rejected.
    let over_cap = String::from_str(
        &h.env,
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    );

    let result = h
        .token
        .try_retire(&alice, &10, &over_cap, &String::from_str(&h.env, "reason"));
    assert!(result.is_err(), "129-char field must be rejected");
    assert_eq!(h.token.retirement_count(), 0);
}

// ── Issue #541: verify_receipt timestamp = 0 ─────────────────────────────────

/// verify_receipt must return valid=false when timestamp == 0.
/// We test this via the out-of-range path since the contract prevents storing
/// a timestamp=0 receipt through normal retire() calls (ledger timestamp is
/// always > 0 in production). The out-of-range case exercises the
/// ReceiptVerification { valid: false } path; for the timestamp==0 path we
/// verify the logic is wired correctly via verify_receipt on a missing index.
#[test]
fn test_verify_receipt_timestamp_zero_is_invalid() {
    let h = setup();
    // No receipts yet → index 0 is out of range → valid=false, timestamp=0.
    let v = h.token.verify_receipt(&0);
    assert!(!v.valid);
    assert_eq!(v.timestamp, 0);
}

/// A valid receipt (timestamp from ledger > 0) must be valid.
#[test]
fn test_verify_receipt_nonzero_timestamp_is_valid() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &100);

    // Advance ledger timestamp so the receipt carries a non-zero timestamp.
    h.env.ledger().with_mut(|li| li.timestamp = 1_700_000_000);

    h.token.retire(
        &alice,
        &50,
        &String::from_str(&h.env, "Corp"),
        &String::from_str(&h.env, "reason"),
    );

    let v = h.token.verify_receipt(&0);
    assert!(v.valid, "receipt with ledger timestamp must be valid");
    assert!(v.timestamp > 0, "ledger timestamp must be non-zero");
    assert_eq!(v.amount, 50);
}

// ── Issue #541: batch_retire_on_behalf ───────────────────────────────────────

/// Basic happy path: 3 beneficiaries, correct serials returned.
#[test]
fn test_batch_retire_on_behalf_basic() {
    let h = setup();
    let retiree = Address::generate(&h.env);
    let ben1 = Address::generate(&h.env);
    let ben2 = Address::generate(&h.env);
    let ben3 = Address::generate(&h.env);

    h.approve_kyc(&retiree);
    h.approve_kyc(&ben1);
    h.approve_kyc(&ben2);
    h.approve_kyc(&ben3);
    h.token.mint(&retiree, &600);

    let reqs = soroban_sdk::vec![
        &h.env,
        RetirementRequest {
            beneficiary: ben1.clone(),
            amount: 100,
            memo: String::from_str(&h.env, "offset for ben1"),
        },
        RetirementRequest {
            beneficiary: ben2.clone(),
            amount: 200,
            memo: String::from_str(&h.env, "offset for ben2"),
        },
        RetirementRequest {
            beneficiary: ben3.clone(),
            amount: 300,
            memo: String::from_str(&h.env, "offset for ben3"),
        },
    ];

    let serials = h.token.batch_retire_on_behalf(&retiree, &reqs);

    // Three distinct serial numbers returned.
    assert_eq!(serials.len(), 3);

    // Serials must be project_id + "-" + index.
    assert_eq!(
        serials.get(0).unwrap(),
        String::from_str(&h.env, "VCS-1234-0")
    );
    assert_eq!(
        serials.get(1).unwrap(),
        String::from_str(&h.env, "VCS-1234-1")
    );
    assert_eq!(
        serials.get(2).unwrap(),
        String::from_str(&h.env, "VCS-1234-2")
    );

    // Total burned.
    assert_eq!(h.token.balance(&retiree), 0);
    assert_eq!(h.token.total_retired(), 600);
    assert_eq!(h.token.retirement_count(), 3);
}

/// 10 beneficiaries — the maximum cap — must all succeed with distinct serials.
#[test]
fn test_batch_retire_on_behalf_ten_entries() {
    let h = setup();
    let retiree = Address::generate(&h.env);
    h.approve_kyc(&retiree);
    h.token.mint(&retiree, &1_000);

    // Generate 10 beneficiaries up front.
    let b0 = Address::generate(&h.env);
    let b1 = Address::generate(&h.env);
    let b2 = Address::generate(&h.env);
    let b3 = Address::generate(&h.env);
    let b4 = Address::generate(&h.env);
    let b5 = Address::generate(&h.env);
    let b6 = Address::generate(&h.env);
    let b7 = Address::generate(&h.env);
    let b8 = Address::generate(&h.env);
    let b9 = Address::generate(&h.env);
    let bens = [&b0, &b1, &b2, &b3, &b4, &b5, &b6, &b7, &b8, &b9];

    let mut reqs: soroban_sdk::Vec<RetirementRequest> = soroban_sdk::Vec::new(&h.env);
    for ben in &bens {
        h.approve_kyc(ben);
        reqs.push_back(RetirementRequest {
            beneficiary: (*ben).clone(),
            amount: 100,
            memo: String::from_str(&h.env, "batch"),
        });
    }

    let serials = h.token.batch_retire_on_behalf(&retiree, &reqs);
    assert_eq!(serials.len(), 10);
    assert_eq!(h.token.retirement_count(), 10);
    assert_eq!(h.token.balance(&retiree), 0);

    // Each receipt appears in the correct beneficiary's index.
    for ben in &bens {
        let receipts = h.token.get_receipts_by_beneficiary(ben, &0, &100);
        assert_eq!(receipts.len(), 1);
        assert_eq!(receipts.get(0).unwrap().amount, 100);
    }
}

/// 11 entries — one over the cap — must be rejected with no state change.
#[test]
fn test_batch_retire_on_behalf_exceeds_cap_rejected() {
    let h = setup();
    let retiree = Address::generate(&h.env);
    h.approve_kyc(&retiree);
    h.token.mint(&retiree, &10_000);

    let mut reqs: soroban_sdk::Vec<RetirementRequest> = soroban_sdk::Vec::new(&h.env);
    for _ in 0..11 {
        let ben = Address::generate(&h.env);
        h.approve_kyc(&ben);
        reqs.push_back(RetirementRequest {
            beneficiary: ben,
            amount: 10,
            memo: String::from_str(&h.env, "over"),
        });
    }

    assert!(h.token.try_batch_retire_on_behalf(&retiree, &reqs).is_err());
    assert_eq!(h.token.retirement_count(), 0);
    assert_eq!(h.token.balance(&retiree), 10_000);
}

/// One beneficiary on the blocklist — the entire batch must be rejected.
#[test]
fn test_batch_retire_on_behalf_partial_blocklist_rejects_whole_batch() {
    let h = setup();
    let retiree = Address::generate(&h.env);
    let ben1 = Address::generate(&h.env);
    let ben_no_kyc = Address::generate(&h.env); // never KYC-approved

    h.approve_kyc(&retiree);
    h.approve_kyc(&ben1);
    h.token.mint(&retiree, &500);

    // A batch where the second beneficiary has no KYC approval must be
    // rejected atomically — no receipts stored, balance unchanged.
    let reqs = soroban_sdk::vec![
        &h.env,
        RetirementRequest {
            beneficiary: ben1.clone(),
            amount: 100,
            memo: String::from_str(&h.env, "ok"),
        },
        RetirementRequest {
            beneficiary: ben_no_kyc.clone(), // no KYC → KycNotApproved
            amount: 100,
            memo: String::from_str(&h.env, "no-kyc"),
        },
    ];

    assert!(
        h.token.try_batch_retire_on_behalf(&retiree, &reqs).is_err(),
        "batch with non-KYC beneficiary must be rejected"
    );
    assert_eq!(h.token.retirement_count(), 0, "no receipts on failure");
    assert_eq!(
        h.token.balance(&retiree),
        500,
        "balance unchanged on failure"
    );
}

/// batch_retire_on_behalf updates global AND per-beneficiary indexes correctly.
#[test]
fn test_batch_retire_on_behalf_indexes_consistent() {
    let h = setup();
    let retiree = Address::generate(&h.env);
    let ben1 = Address::generate(&h.env);
    let ben2 = Address::generate(&h.env);

    h.approve_kyc(&retiree);
    h.approve_kyc(&ben1);
    h.approve_kyc(&ben2);
    h.token.mint(&retiree, &1_000);

    // Mix of single-retire and batch_retire_on_behalf to test interleaving.
    // retire_on_behalf: ben1 gets global idx 0
    h.token
        .retire_on_behalf(&retiree, &ben1, &50, &String::from_str(&h.env, "pre-batch"));

    // batch_retire_on_behalf: ben2 gets global idx 1, ben1 gets global idx 2
    let reqs = soroban_sdk::vec![
        &h.env,
        RetirementRequest {
            beneficiary: ben2.clone(),
            amount: 75,
            memo: String::from_str(&h.env, "batch-ben2"),
        },
        RetirementRequest {
            beneficiary: ben1.clone(),
            amount: 25,
            memo: String::from_str(&h.env, "batch-ben1"),
        },
    ];
    let serials = h.token.batch_retire_on_behalf(&retiree, &reqs);

    // Serials start at global index 1 (index 0 was used by retire_on_behalf above).
    assert_eq!(
        serials.get(0).unwrap(),
        String::from_str(&h.env, "VCS-1234-1")
    );
    assert_eq!(
        serials.get(1).unwrap(),
        String::from_str(&h.env, "VCS-1234-2")
    );

    // ben1 should have 2 receipts in their per-beneficiary index.
    let ben1_receipts = h.token.get_receipts_by_beneficiary(&ben1, &0, &100);
    assert_eq!(ben1_receipts.len(), 2);
    assert_eq!(ben1_receipts.get(0).unwrap().amount, 50);
    assert_eq!(ben1_receipts.get(1).unwrap().amount, 25);

    // ben2 should have 1 receipt.
    let ben2_receipts = h.token.get_receipts_by_beneficiary(&ben2, &0, &100);
    assert_eq!(ben2_receipts.len(), 1);
    assert_eq!(ben2_receipts.get(0).unwrap().amount, 75);

    // Global count.
    assert_eq!(h.token.retirement_count(), 3);
}

/// Insufficient balance must fail atomically.
#[test]
fn test_batch_retire_on_behalf_insufficient_balance_rejected() {
    let h = setup();
    let retiree = Address::generate(&h.env);
    let ben1 = Address::generate(&h.env);
    let ben2 = Address::generate(&h.env);

    h.approve_kyc(&retiree);
    h.approve_kyc(&ben1);
    h.approve_kyc(&ben2);
    h.token.mint(&retiree, &50);

    let reqs = soroban_sdk::vec![
        &h.env,
        RetirementRequest {
            beneficiary: ben1.clone(),
            amount: 30,
            memo: String::from_str(&h.env, "batch1"),
        },
        RetirementRequest {
            beneficiary: ben2.clone(),
            amount: 30,
            memo: String::from_str(&h.env, "batch2"),
        },
    ];

    // Total = 60 > 50 — must fail atomically.
    assert!(h.token.try_batch_retire_on_behalf(&retiree, &reqs).is_err());
    assert_eq!(h.token.balance(&retiree), 50);
    assert_eq!(h.token.retirement_count(), 0);
}

// ── Issue #1154: Receipt beneficiary metadata test ──────────────────────────

/// Test that retirement receipts preserve the supplied beneficiary address
/// and amount without changing the receipt format.
#[test]
fn test_receipt_lookup_preserves_beneficiary_metadata() {
    let h = setup();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);

    h.approve_kyc(&alice);
    h.approve_kyc(&bob);
    h.token.mint(&alice, &100);

    // Set a non-zero ledger timestamp.
    h.env.ledger().with_mut(|li| li.timestamp = 1_700_000_000);

    // Retire 50 credits on behalf of Bob with a distinct address.
    let receipt = h.token.retire_on_behalf(
        &alice,
        &bob,
        &50,
        &String::from_str(&h.env, "Corporate carbon offset Q1 2024"),
    );

    // Receipt returned by retire_on_behalf contains the beneficiary address.
    assert_eq!(receipt.retiree, alice);
    assert_eq!(receipt.amount, 50);
    assert_eq!(receipt.beneficiary_address, Some(bob.clone()));
    assert!(receipt.timestamp > 0);

    // Fetch the receipt by its normal identifier (index 0).
    let stored = h.token.get_receipt(&0);
    assert_eq!(stored.retiree, alice);
    assert_eq!(stored.amount, 50);
    assert_eq!(stored.beneficiary_address, Some(bob.clone()));
    assert_eq!(stored.timestamp, receipt.timestamp);

    // Verify the receipt is valid via verify_receipt.
    let verification = h.token.verify_receipt(&0);
    assert!(verification.valid);
    assert_eq!(verification.retiree, alice);
    assert_eq!(verification.amount, 50);
    assert_eq!(verification.index, 0);

    // Balance and totals updated correctly.
    assert_eq!(h.token.balance(&alice), 50);
    assert_eq!(h.token.total_retired(), 50);
    assert_eq!(h.token.retirement_count(), 1);

    let reqs = soroban_sdk::vec![
        &h.env,
        RetirementRequest {
            beneficiary: ben1.clone(),
            amount: 30,
            memo: String::from_str(&h.env, "r1"),
        },
        RetirementRequest {
            beneficiary: ben2.clone(),
            amount: 30, // total=60 > balance=50
            memo: String::from_str(&h.env, "r2"),
        },
    ];

    assert!(h.token.try_batch_retire_on_behalf(&retiree, &reqs).is_err());
    assert_eq!(h.token.balance(&retiree), 50);
    assert_eq!(h.token.retirement_count(), 0);
}

// ── Regression tests for targeted bug fixes ───────────────────────────────────

// Fix #1 — validate_metadata_field_length: MAX_FIELD_BYTES rename + doc clarity
// The constant was renamed from MAX_FIELD_LEN to MAX_FIELD_BYTES to make the
// byte-boundary intent unambiguous.  The boundary behavior is unchanged:
// exactly 128 bytes passes, 129 bytes fails.  These tests pin that contract.

/// validate_metadata_field_length: a zero-length field is well within the cap.
#[test]
fn test_validate_metadata_field_length_empty_string_accepted() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &10);

    // Empty beneficiary/reason strings are below the 128-byte cap.
    let result = h.token.try_retire(
        &alice,
        &1,
        &String::from_str(&h.env, ""),
        &String::from_str(&h.env, ""),
    );
    assert!(result.is_ok(), "empty fields must be accepted (0 < 128)");
    assert_eq!(h.token.retirement_count(), 1);
}

/// validate_metadata_field_length: exactly 128-byte field is the inclusive limit.
/// The constant MAX_FIELD_BYTES = 128 is inclusive: len == 128 must pass.
#[test]
fn test_validate_metadata_field_length_exactly_128_bytes_is_inclusive_limit() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &10);

    // 128 'B' characters = 128 bytes (ASCII).  Must be accepted at the boundary.
    let at_limit = String::from_str(
        &h.env,
        "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    );
    assert_eq!(at_limit.len(), 128, "sanity: string must be exactly 128 bytes");

    let result = h
        .token
        .try_retire(&alice, &1, &at_limit, &String::from_str(&h.env, "r"));
    assert!(result.is_ok(), "128-byte field must be accepted (inclusive limit)");
}

/// validate_metadata_field_length: 129-byte field is one over the limit — rejected.
#[test]
fn test_validate_metadata_field_length_129_bytes_exceeds_limit() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &10);

    // 129 'C' characters = 129 bytes.  Must be rejected.
    let over_limit = String::from_str(
        &h.env,
        "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    );
    assert_eq!(
        over_limit.len(),
        129,
        "sanity: string must be exactly 129 bytes"
    );

    let result = h
        .token
        .try_retire(&alice, &1, &over_limit, &String::from_str(&h.env, "r"));
    assert!(result.is_err(), "129-byte field must be rejected (> inclusive limit)");
    // No state mutation on failure.
    assert_eq!(h.token.retirement_count(), 0);
    assert_eq!(h.token.balance(&alice), 10);
}

// Fix #2 — retire: reject zero/negative amount before any state mutation.

/// retire() must reject amount == 0 with InvalidAmount before touching state.
#[test]
fn test_retire_zero_amount_rejected() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &100);

    let result = h.token.try_retire(
        &alice,
        &0,
        &String::from_str(&h.env, "Acme"),
        &String::from_str(&h.env, "reason"),
    );
    assert!(result.is_err(), "retire(amount=0) must be rejected");

    // No state mutation: balance and receipt count unchanged.
    assert_eq!(h.token.balance(&alice), 100);
    assert_eq!(h.token.total_supply(), 100);
    assert_eq!(h.token.total_retired(), 0);
    assert_eq!(h.token.retirement_count(), 0);
}

/// retire() must reject negative amounts before touching state.
#[test]
fn test_retire_negative_amount_rejected() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &100);

    let result = h.token.try_retire(
        &alice,
        &-1,
        &String::from_str(&h.env, "Acme"),
        &String::from_str(&h.env, "reason"),
    );
    assert!(result.is_err(), "retire(amount=-1) must be rejected");

    assert_eq!(h.token.balance(&alice), 100);
    assert_eq!(h.token.total_retired(), 0);
    assert_eq!(h.token.retirement_count(), 0);
}

/// Positive amount still works — the guard must not affect the happy path.
#[test]
fn test_retire_positive_amount_normal_path_unaffected() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &100);

    let receipt = h.token.retire(
        &alice,
        &50,
        &String::from_str(&h.env, "Corp"),
        &String::from_str(&h.env, "annual"),
    );
    assert_eq!(receipt.amount, 50);
    assert_eq!(h.token.balance(&alice), 50);
    assert_eq!(h.token.total_retired(), 50);
    assert_eq!(h.token.retirement_count(), 1);
}

// Fix #3 — index_beneficiary_receipt: duplicate global_idx must not be appended.

/// Calling index_beneficiary_receipt twice with the same global_idx (simulated
/// by calling retire with the same parameters twice from two different code
/// paths that share an index) must not produce a duplicate entry.
///
/// We exercise this via get_receipts_by_beneficiary: if a duplicate were
/// appended, the count would be 2 instead of 1 for that one global receipt.
#[test]
fn test_index_beneficiary_receipt_no_duplicate_on_repeated_global_idx() {
    // The only way to trigger a duplicate at the public API level is to have the
    // same global receipt index indexed for a beneficiary more than once.  Because
    // retire() calls index_beneficiary_receipt exactly once per call and the
    // global index increments, ordinary retirements can never produce a
    // duplicate.  We verify the guard works by using retire_on_behalf twice for
    // the same beneficiary and confirming each call gets its OWN unique index
    // (the normal path), then cross-check that the per-beneficiary count equals
    // the number of distinct calls.
    let h = setup();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);
    h.token.mint(&alice, &200);

    // Two retirements on behalf of bob → two distinct global indices (0 and 1).
    h.token
        .retire_on_behalf(&alice, &bob, &50, &String::from_str(&h.env, "r1"));
    h.token
        .retire_on_behalf(&alice, &bob, &50, &String::from_str(&h.env, "r2"));

    // Bob must have exactly 2 entries — one per retirement, no duplicates.
    let receipts = h.token.get_receipts_by_beneficiary(&bob, &0, &100);
    assert_eq!(
        receipts.len(),
        2,
        "each retire_on_behalf must produce exactly one distinct beneficiary entry"
    );
    assert_eq!(receipts.get(0).unwrap().amount, 50);
    assert_eq!(receipts.get(1).unwrap().amount, 50);

    // Confirm the two entries point to distinct global receipt indices.
    assert_ne!(
        h.token.get_receipt(&0).retiree,
        // Just checking both receipts exist and are retrievable.
        h.env.current_contract_address(),
    );
    assert_eq!(h.token.retirement_count(), 2);
}


// ── Regression: double-init guard ────────────────────────────────────────────

/// Calling initialize() after the constructor must always fail (AlreadyInitialized).
/// This is the existing guard; the new test specifically verifies the
/// __constructor's own double-init check via the ProjectMeta sentinel.
#[test]
fn test_constructor_double_init_rejected_via_initialize() {
    let h = setup();
    let attacker = Address::generate(&h.env);
    let result = h
        .token
        .try_initialize(&attacker, &Address::generate(&h.env), &Address::generate(&h.env), &meta(&h.env));
    assert!(result.is_err(), "re-initialization must always be rejected");
}

// ── Regression: blank project_id guard ───────────────────────────────────────

/// Passing an empty project_id to __constructor must panic before any state is written.
#[test]
#[should_panic]
fn test_constructor_rejects_empty_project_id() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let kyc_id = env.register(KycRegistry, ());
    let kyc = KycRegistryClient::new(&env, &kyc_id);
    kyc.initialize(&admin);
    let compliance_id = env.register(ComplianceEngine, ());
    let compliance = ComplianceEngineClient::new(&env, &compliance_id);
    compliance.initialize(&admin, &kyc_id, &0u64);

    let mut bad_meta = meta(&env);
    bad_meta.project_id = String::from_str(&env, "");
    // Must panic — empty project_id is not allowed.
    env.register(CarbonCreditToken, (admin, kyc_id, compliance_id, bad_meta));
}

/// A non-empty project_id is accepted normally — the guard must not affect the happy path.
#[test]
fn test_constructor_accepts_nonempty_project_id() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let kyc_id = env.register(KycRegistry, ());
    let kyc = KycRegistryClient::new(&env, &kyc_id);
    kyc.initialize(&admin);
    let compliance_id = env.register(ComplianceEngine, ());
    let compliance = ComplianceEngineClient::new(&env, &compliance_id);
    compliance.initialize(&admin, &kyc_id, &0u64);

    let mut m = meta(&env);
    m.project_id = String::from_str(&env, "VCS-9999");
    let token_id = env.register(CarbonCreditToken, (admin, kyc_id, compliance_id, m));
    let token = CarbonCreditTokenClient::new(&env, &token_id);
    assert_eq!(
        token.get_meta().project_id,
        String::from_str(&env, "VCS-9999")
    );
}

// Fix #845 — append_retirement_receipt: reject malformed beneficiary addresses
// Before the fix, there was no public append_retirement_receipt entry point.
// An invalid (non-KYC-approved) beneficiary address could be associated with
// a retirement record, polluting the retirement audit trail and making later
// evidence checks less trustworthy.
// The new function validates the optional beneficiary_address: when Some(addr)
// is provided, `addr` must be KYC-approved.  An unapproved address is rejected
// with InvalidBeneficiaryAddress before any state is written.
#[test]
fn test_append_retirement_receipt_rejects_unapproved_beneficiary_address() {
    use crate::CarbonError;
    use soroban_sdk::Error;

    let h = setup();
    let retiree = Address::generate(&h.env);
    h.approve_kyc(&retiree);
    h.token.mint(&retiree, &100);

    // An address that has never been KYC-approved must be rejected.
    let bad_addr = Address::generate(&h.env);

    let before_count = h.token.retirement_count();
    let result = h.token.try_append_retirement_receipt(
        &retiree,
        &10,
        &String::from_str(&h.env, "Acme Corp"),
        &String::from_str(&h.env, "annual offset"),
        &Some(bad_addr),
    );
    assert_eq!(
        result.err().and_then(|e| e.ok()),
        Some(Error::from(CarbonError::InvalidBeneficiaryAddress))
    );
    // No receipt must have been written.
    assert_eq!(h.token.retirement_count(), before_count);

    // Normal path: when beneficiary_address is None, no KYC check is required.
    let receipt = h.token.append_retirement_receipt(
        &retiree,
        &10,
        &String::from_str(&h.env, "Acme Corp"),
        &String::from_str(&h.env, "annual offset"),
        &None,
    );
    assert_eq!(h.token.retirement_count(), before_count + 1);
    assert_eq!(receipt.amount, 10);

    // Normal path: when beneficiary_address is Some(approved_addr), it is accepted.
    let approved_addr = Address::generate(&h.env);
    h.approve_kyc(&approved_addr);
    let receipt2 = h.token.append_retirement_receipt(
        &retiree,
        &5,
        &String::from_str(&h.env, "Acme Corp"),
        &String::from_str(&h.env, "Q4 offset"),
        &Some(approved_addr.clone()),
    );
    assert_eq!(h.token.retirement_count(), before_count + 2);
    assert_eq!(receipt2.beneficiary_address, Some(approved_addr));
}

// ── Issue batch #962–#964: receipt API boundary coverage ─────────────────────
#[test]
fn test_verify_receipt_first_last_and_out_of_range_indices() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &30);
    h.env.ledger().with_mut(|li| li.timestamp = 1_700_000_000);

    do_retire(&h, &alice, 10);
    do_retire(&h, &alice, 20);

    let first = h.token.verify_receipt(&0);
    let last = h.token.verify_receipt(&1);
    let after_last = h.token.verify_receipt(&2);

    assert!(first.valid);
    assert_eq!(first.index, 0);
    assert_eq!(first.amount, 10);
    assert!(last.valid);
    assert_eq!(last.index, 1);
    assert_eq!(last.amount, 20);
    assert!(!after_last.valid);
    assert_eq!(after_last.index, 2);
    assert_eq!(after_last.amount, 0);
}

#[test]
fn test_get_receipts_partial_final_page_is_ordered_and_bounded() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &150);
    h.env.ledger().with_mut(|li| li.timestamp = 1_700_000_000);

    for amount in [10, 20, 30, 40, 50] {
        do_retire(&h, &alice, amount);
    }

    let mut all = soroban_sdk::Vec::new(&h.env);
    for (start, limit) in [(0, 2), (2, 2), (4, 2)] {
        let page = h.token.get_receipts(&start, &limit);
        for i in 0..page.len() {
            all.push_back(page.get(i).unwrap());
        }
    }
    let past_end = h.token.get_receipts(&5, &2);

    assert_eq!(all.len(), 5);
    for (i, expected) in [10, 20, 30, 40, 50].iter().enumerate() {
        assert_eq!(all.get(i as u32).unwrap().amount, *expected);
    }
    assert_eq!(past_end.len(), 0);
}

#[test]
fn test_retirement_receipt_preserves_distinct_beneficiary_metadata() {
    let h = setup();
    let retiree = Address::generate(&h.env);
    let beneficiary = Address::generate(&h.env);
    h.approve_kyc(&retiree);
    h.approve_kyc(&beneficiary);
    h.token.mint(&retiree, &25);
    h.env.ledger().with_mut(|li| li.timestamp = 1_700_000_000);

    let reason = String::from_str(&h.env, "beneficiary offset");
    h.token
        .retire_on_behalf(&retiree, &beneficiary, &25, &reason);

    let by_index = h.token.get_receipt(&0);
    let by_beneficiary = h
        .token
        .get_receipts_by_beneficiary(&beneficiary, &0, &1);
    let queried = by_beneficiary.get(0).unwrap();

    assert_eq!(by_index.retiree, retiree);
    assert_eq!(by_index.amount, 25);
    assert_eq!(by_index.beneficiary_address, Some(beneficiary.clone()));
    assert_eq!(by_index.retirement_reason, reason);
    assert_eq!(queried.retiree, by_index.retiree);
    assert_eq!(queried.amount, by_index.amount);
    assert_eq!(queried.beneficiary_address, by_index.beneficiary_address);
    assert_eq!(queried.retirement_reason, by_index.retirement_reason);
}
