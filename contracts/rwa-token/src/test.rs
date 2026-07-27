#![cfg(test)]

use crate::{ComplianceMetadata, RecipientEntry, RwaToken, RwaTokenClient, META_ISIN, META_LEGAL_ENTITY};
use compliance_engine::{ComplianceEngine, ComplianceEngineClient, ComplianceRules};
use kyc_registry::{KycRegistry, KycRegistryClient};
use soroban_sdk::{testutils::{Address as _, Events as _, Ledger as _}, vec, Address, Env, String, TryFromVal, symbol_short};

#[allow(dead_code)]
struct Harness {
    env: Env,
    token: RwaTokenClient<'static>,
    kyc: KycRegistryClient<'static>,
    compliance: ComplianceEngineClient<'static>,
    verifier: Address,
    admin: Address,
}

fn setup() -> Harness {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);

    // KYC registry
    let kyc_id = env.register(KycRegistry, ());
    let kyc = KycRegistryClient::new(&env, &kyc_id);
    kyc.initialize(&admin);
    let verifier = Address::generate(&env);
    kyc.add_verifier(&admin, &verifier);

    // Compliance engine
    let compliance_id = env.register(ComplianceEngine, ());
    let compliance = ComplianceEngineClient::new(&env, &compliance_id);
    compliance.initialize(&admin, &kyc_id, &0u64);

    // RWA token — constructor args passed atomically at register time
    let token_id = env.register(
        RwaToken,
        (
            admin.clone(),
            7u32,
            String::from_str(&env, "Veritoken RWA"),
            String::from_str(&env, "VTRWA"),
            String::from_str(&env, "property"),
            kyc_id.clone(),
            compliance_id.clone(),
            Option::<ComplianceMetadata>::None,
            0i128, // max_supply: 0 = unlimited
        ),
    );
    let token = RwaTokenClient::new(&env, &token_id);

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
    assert_eq!(h.token.decimals(), 7);
    assert_eq!(h.token.name(), String::from_str(&h.env, "Veritoken RWA"));
    assert_eq!(h.token.symbol(), String::from_str(&h.env, "VTRWA"));
    assert_eq!(h.token.asset_type(), String::from_str(&h.env, "property"));
    assert_eq!(h.token.total_supply(), 0);
}

#[test]
fn test_mint_requires_kyc() {
    let h = setup();
    let user = Address::generate(&h.env);

    // Without KYC, mint should fail
    let res = h.token.try_mint(&user, &1_000);
    assert!(res.is_err());

    // With KYC, mint succeeds
    h.approve_kyc(&user);
    h.token.mint(&user, &1_000);
    assert_eq!(h.token.balance(&user), 1_000);
    assert_eq!(h.token.total_supply(), 1_000);
}

#[test]
fn test_transfer_happy_path() {
    let h = setup();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);

    h.token.mint(&alice, &1_000);
    h.token.transfer(&alice, &bob, &400);

    assert_eq!(h.token.balance(&alice), 600);
    assert_eq!(h.token.balance(&bob), 400);

}

#[test]
fn test_transfer_blocked_without_kyc_on_receiver() {
    let h = setup();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env); // no KYC
    h.approve_kyc(&alice);
    h.token.mint(&alice, &1_000);

    let res = h.token.try_transfer(&alice, &bob, &100);
    assert!(res.is_err());
}

#[test]
fn test_transfer_blocked_when_compliance_paused() {
    let h = setup();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);
    h.token.mint(&alice, &1_000);

    h.compliance.pause();
    let res = h.token.try_transfer(&alice, &bob, &100);
    assert!(res.is_err());

    h.compliance.unpause();
    h.token.transfer(&alice, &bob, &100);
    assert_eq!(h.token.balance(&bob), 100);
}

#[test]
fn test_transfer_blocked_by_max_amount() {
    let h = setup();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);
    h.token.mint(&alice, &1_000);

    h.compliance.set_rules(&ComplianceRules {
        max_transfer_amount: 50,
        min_holding_period: 0,
        max_holders: 0,
        require_same_jurisdiction: false,
        paused: false,
        allowlist_mode: false,
        max_holding_period: 0,
    });

    assert!(h.token.try_transfer(&alice, &bob, &51).is_err());
    h.token.transfer(&alice, &bob, &50);
    assert_eq!(h.token.balance(&bob), 50);
}

#[test]
fn test_max_holder_cap_blocks_new_holder_and_maintains_count() {
    let h = setup();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    let charlie = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);
    h.approve_kyc(&charlie);

    h.compliance.set_rules(&ComplianceRules {
        max_transfer_amount: 0,
        min_holding_period: 0,
        max_holders: 2,
        require_same_jurisdiction: false,
        paused: false,
        allowlist_mode: false,
        max_holding_period: 0,
    });

    h.token.mint(&alice, &1_000);
    assert_eq!(h.compliance.holder_count(), 1);

    h.token.transfer(&alice, &bob, &400);
    assert_eq!(h.compliance.holder_count(), 2);
    assert!(h.token.try_transfer(&alice, &charlie, &1).is_err());

    h.token.transfer(&alice, &bob, &600);
    assert_eq!(h.token.balance(&alice), 0);
    assert_eq!(h.compliance.holder_count(), 1);

    h.token.transfer(&bob, &charlie, &1);
    assert_eq!(h.compliance.holder_count(), 2);
    assert_eq!(h.token.balance(&charlie), 1);
}

#[test]
fn test_max_holders_blocks_new_holders_via_token() {
    let h = setup();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    let charlie = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);
    h.approve_kyc(&charlie);

    h.compliance.set_rules(&ComplianceRules {
        max_transfer_amount: 0,
        min_holding_period: 0,
        max_holders: 2,
        require_same_jurisdiction: false,
        paused: false,
        allowlist_mode: false,
        max_holding_period: 0,
    });

    // First two distinct holders fill the cap.
    h.token.mint(&alice, &1_000);
    h.token.mint(&bob, &1_000);
    assert_eq!(h.compliance.holder_count(), 2);

    // A mint to a third distinct holder must be rejected by the compliance engine.
    assert!(h.token.try_mint(&charlie, &1_000).is_err());

    // The failed mint leaves the holder count unchanged.
    assert_eq!(h.compliance.holder_count(), 2);
    assert_eq!(h.token.balance(&charlie), 0);
}

#[test]
fn test_approve_and_transfer_from() {
    let h = setup();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    let spender = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);
    h.token.mint(&alice, &1_000);

    let expiration = h.env.ledger().sequence() + 1_000;
    h.token.approve(&alice, &spender, &300, &expiration);
    assert_eq!(h.token.allowance(&alice, &spender), 300);

    h.token.transfer_from(&spender, &alice, &bob, &200);
    assert_eq!(h.token.balance(&bob), 200);
    assert_eq!(h.token.balance(&alice), 800);
    assert_eq!(h.token.allowance(&alice, &spender), 100);
}

#[test]
fn test_burn_reduces_supply() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &1_000);

    h.token.burn(&alice, &400);
    assert_eq!(h.token.balance(&alice), 600);
    assert_eq!(h.token.total_supply(), 600);
}

#[test]
fn test_set_admin() {
    let h = setup();
    let new_admin = Address::generate(&h.env);
    h.token.set_admin(&new_admin);
    // New admin can mint after KYC approval of a holder
    let user = Address::generate(&h.env);
    h.approve_kyc(&user);
    h.token.mint(&user, &1);
    assert_eq!(h.token.balance(&user), 1);
    let _ = &h.admin;
}

#[test]
fn test_compliance_metadata() {
    let h = setup();
    let key = soroban_sdk::symbol_short!("legal");
    h.token
        .set_compliance_metadata(&key, &String::from_str(&h.env, "prospectus-v1"));
    assert_eq!(
        h.token.get_compliance_metadata(&key),
        String::from_str(&h.env, "prospectus-v1")
    );
}

#[test]
fn test_non_deployer_cannot_reinitialize() {
    let h = setup();
    let attacker = Address::generate(&h.env);
    let kyc_id = h.token.kyc_registry();
    let ce_id = h.token.compliance_engine();
    // initialize must always panic — the constructor has already run
    let result = h.token.try_initialize(
        &attacker,
        &7,
        &String::from_str(&h.env, "Evil Token"),
        &String::from_str(&h.env, "EVIL"),
        &String::from_str(&h.env, "property"),
        &kyc_id,
        &ce_id,
    );
    assert!(result.is_err());
}

#[test]
fn test_get_all_compliance_metadata_returns_empty_when_unset() {
    let h = setup();
    let meta = h.token.get_all_compliance_metadata();
    assert!(meta.legal_entity.is_none());
    assert!(meta.governing_law.is_none());
    assert!(meta.isin.is_none());
    assert!(meta.prospectus_hash.is_none());
}

#[test]
fn test_get_all_compliance_metadata_returns_set_fields() {
    let h = setup();
    let key_entity = soroban_sdk::Symbol::new(&h.env, META_LEGAL_ENTITY);
    let key_isin = soroban_sdk::Symbol::new(&h.env, META_ISIN);
    h.token
        .set_compliance_metadata(&key_entity, &String::from_str(&h.env, "Acme Corp"));
    h.token
        .set_compliance_metadata(&key_isin, &String::from_str(&h.env, "US1234567890"));
    let meta = h.token.get_all_compliance_metadata();
    assert_eq!(
        meta.legal_entity,
        Some(String::from_str(&h.env, "Acme Corp"))
    );
    assert_eq!(meta.isin, Some(String::from_str(&h.env, "US1234567890")));
    assert!(meta.governing_law.is_none());
    assert!(meta.prospectus_hash.is_none());
}

#[test]
fn test_constructor_sets_compliance_metadata() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);

    let kyc_id = env.register(KycRegistry, ());
    let kyc = KycRegistryClient::new(&env, &kyc_id);
    kyc.initialize(&admin);

    let compliance_id = env.register(ComplianceEngine, ());
    let compliance = ComplianceEngineClient::new(&env, &compliance_id);
    compliance.initialize(&admin, &kyc_id, &0u64);

    let token_id = env.register(
        RwaToken,
        (
            admin.clone(),
            7u32,
            String::from_str(&env, "Invoice Token"),
            String::from_str(&env, "IVTK"),
            String::from_str(&env, "invoice"),
            kyc_id.clone(),
            compliance_id.clone(),
            Some(ComplianceMetadata {
                legal_entity: Some(String::from_str(&env, "Issuer LLC")),
                governing_law: Some(String::from_str(&env, "New York")),
                isin: None,
                prospectus_hash: None,
            }),
            0i128, // max_supply: 0 = unlimited
        ),
    );
    let token = RwaTokenClient::new(&env, &token_id);
    let meta = token.get_all_compliance_metadata();
    assert_eq!(
        meta.legal_entity,
        Some(String::from_str(&env, "Issuer LLC"))
    );
    assert_eq!(
        meta.governing_law,
        Some(String::from_str(&env, "New York"))
    );
    assert!(meta.isin.is_none());
}

#[test]
fn test_mint_twice_same_address_holder_count_is_one() {
    let h = setup();
    let user = Address::generate(&h.env);
    h.approve_kyc(&user);

    h.token.mint(&user, &1_000);
    h.token.mint(&user, &500);

    assert_eq!(h.compliance.holder_count(), 1);
    assert_eq!(h.token.balance(&user), 1_500);
    assert_eq!(h.token.total_supply(), 1_500);
}

#[test]
#[should_panic(expected = "invalid asset_type: must be 'invoice', 'property', or 'carbon_credit'")]
fn test_invalid_asset_type() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let kyc_id = env.register(KycRegistry, ());
    let compliance_id = env.register(ComplianceEngine, ());

    // Try to register token with invalid asset type
    let _ = env.register(
        RwaToken,
        (
            admin,
            7u32,
            String::from_str(&env, "Bad Token"),
            String::from_str(&env, "BAD"),
            String::from_str(&env, "banana"),
            kyc_id,
            compliance_id,
            Option::<ComplianceMetadata>::None,
            0i128,
        ),
    );
}

#[test]
fn test_version_returns_nonempty() {
    let h = setup();
    let v = h.token.version();
    assert!(v.len() > 0);
}

// ── batch_transfer ────────────────────────────────────────────────────────────

#[test]
fn test_batch_transfer_two_recipients_success() {
    let h = setup();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    let carol = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);
    h.approve_kyc(&carol);
    h.token.mint(&alice, &1_000);

    let recipients = vec![
        &h.env,
        RecipientEntry { to: bob.clone(), amount: 300 },
        RecipientEntry { to: carol.clone(), amount: 200 },
    ];
    h.token.batch_transfer(&alice, &recipients);

    assert_eq!(h.token.balance(&alice), 500);
    assert_eq!(h.token.balance(&bob), 300);
    assert_eq!(h.token.balance(&carol), 200);
}

#[test]
fn test_batch_transfer_state_unchanged_on_kyc_failure() {
    let h = setup();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    let carol = Address::generate(&h.env); // no KYC
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);
    h.token.mint(&alice, &1_000);

    let recipients = vec![
        &h.env,
        RecipientEntry { to: bob.clone(), amount: 300 },
        RecipientEntry { to: carol.clone(), amount: 200 }, // fails here
    ];
    assert!(h.token.try_batch_transfer(&alice, &recipients).is_err());

    // No state changes: balances untouched
    assert_eq!(h.token.balance(&alice), 1_000);
    assert_eq!(h.token.balance(&bob), 0);
    assert_eq!(h.token.balance(&carol), 0);
}

#[test]
fn test_batch_transfer_state_unchanged_on_insufficient_balance() {
    let h = setup();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    let carol = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);
    h.approve_kyc(&carol);
    h.token.mint(&alice, &400); // only 400, but batch asks for 300 + 200 = 500

    let recipients = vec![
        &h.env,
        RecipientEntry { to: bob.clone(), amount: 300 },
        RecipientEntry { to: carol.clone(), amount: 200 },
    ];
    assert!(h.token.try_batch_transfer(&alice, &recipients).is_err());

    // State must be fully unchanged
    assert_eq!(h.token.balance(&alice), 400);
    assert_eq!(h.token.balance(&bob), 0);
    assert_eq!(h.token.balance(&carol), 0);
}

#[test]
fn test_batch_transfer_state_unchanged_on_frozen_recipient() {
    let h = setup();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    let carol = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);
    h.approve_kyc(&carol);
    h.token.mint(&alice, &1_000);
    h.token.freeze(&carol);

    let recipients = vec![
        &h.env,
        RecipientEntry { to: bob.clone(), amount: 300 },
        RecipientEntry { to: carol.clone(), amount: 200 }, // frozen → validation fails
    ];
    assert!(h.token.try_batch_transfer(&alice, &recipients).is_err());

    assert_eq!(h.token.balance(&alice), 1_000);
    assert_eq!(h.token.balance(&bob), 0);
    assert_eq!(h.token.balance(&carol), 0);
}

#[test]
fn test_batch_transfer_frozen_sender_rejected() {
    let h = setup();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);
    h.token.mint(&alice, &1_000);
    h.token.freeze(&alice);

    let recipients = vec![
        &h.env,
        RecipientEntry { to: bob.clone(), amount: 100 },
    ];
    assert!(h.token.try_batch_transfer(&alice, &recipients).is_err());
    assert_eq!(h.token.balance(&alice), 1_000);
}

#[test]
fn test_batch_transfer_exceeds_max_recipients() {
    let h = setup();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &10_000);

    // Build 11 recipients — must be rejected before any transfer
    let mut recipients = soroban_sdk::Vec::new(&h.env);
    for _ in 0..11 {
        let addr = Address::generate(&h.env);
        h.approve_kyc(&addr);
        recipients.push_back(RecipientEntry { to: addr, amount: 1 });
    }
    assert!(h.token.try_batch_transfer(&alice, &recipients).is_err());
    assert_eq!(h.token.balance(&alice), 10_000);
}

#[test]
fn test_batch_transfer_zero_amount_entry_rejected() {
    let h = setup();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);
    h.token.mint(&alice, &1_000);

    let recipients = vec![
        &h.env,
        RecipientEntry { to: bob.clone(), amount: 0 }, // invalid
    ];
    assert!(h.token.try_batch_transfer(&alice, &recipients).is_err());
    assert_eq!(h.token.balance(&alice), 1_000);
    assert_eq!(h.token.balance(&bob), 0);
}

#[test]
fn test_batch_transfer_sender_unregistered_when_balance_drained() {
    let h = setup();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);
    h.token.mint(&alice, &500);
    assert_eq!(h.compliance.holder_count(), 1);

    let recipients = vec![
        &h.env,
        RecipientEntry { to: bob.clone(), amount: 500 }, // drains alice
    ];
    h.token.batch_transfer(&alice, &recipients);

    assert_eq!(h.token.balance(&alice), 0);
    assert_eq!(h.token.balance(&bob), 500);
    // alice deregistered, bob registered → still 1 holder
    assert_eq!(h.compliance.holder_count(), 1);
}

#[test]
fn test_batch_transfer_holder_count_correct_after_batch() {
    let h = setup();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    let carol = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);
    h.approve_kyc(&carol);
    h.token.mint(&alice, &1_000);
    assert_eq!(h.compliance.holder_count(), 1);

    let recipients = vec![
        &h.env,
        RecipientEntry { to: bob.clone(), amount: 400 },
        RecipientEntry { to: carol.clone(), amount: 300 },
    ];
    h.token.batch_transfer(&alice, &recipients);

    // alice (300 remaining), bob (400), carol (300) → 3 holders
    assert_eq!(h.compliance.holder_count(), 3);
    assert_eq!(h.token.balance(&alice), 300);
}

#[test]
fn test_batch_transfer_compliance_paused_state_unchanged() {
    let h = setup();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);
    h.token.mint(&alice, &1_000);
    h.compliance.pause();

    let recipients = vec![
        &h.env,
        RecipientEntry { to: bob.clone(), amount: 100 },
    ];
    assert!(h.token.try_batch_transfer(&alice, &recipients).is_err());
    assert_eq!(h.token.balance(&alice), 1_000);
    assert_eq!(h.token.balance(&bob), 0);
}

#[test]
fn test_batch_transfer_max_amount_rule_per_entry() {
    let h = setup();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);
    h.token.mint(&alice, &1_000);

    h.compliance.set_rules(&ComplianceRules {
        max_transfer_amount: 50,
        min_holding_period: 0,
        max_holders: 0,
        require_same_jurisdiction: false,
        paused: false,
        allowlist_mode: false,
        max_holding_period: 0,
    });

    // Single entry of 51 exceeds per-transfer cap
    let recipients_over = vec![
        &h.env,
        RecipientEntry { to: bob.clone(), amount: 51 },
    ];
    assert!(h.token.try_batch_transfer(&alice, &recipients_over).is_err());

    // Single entry within cap succeeds
    let recipients_ok = vec![
        &h.env,
        RecipientEntry { to: bob.clone(), amount: 50 },
    ];
    h.token.batch_transfer(&alice, &recipients_ok);
    assert_eq!(h.token.balance(&bob), 50);
}

// ── batch_transfer_from ───────────────────────────────────────────────────────

#[test]
fn test_batch_transfer_from_success() {
    let h = setup();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    let carol = Address::generate(&h.env);
    let spender = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);
    h.approve_kyc(&carol);
    h.token.mint(&alice, &1_000);

    let expiration = h.env.ledger().sequence() + 1_000;
    h.token.approve(&alice, &spender, &600, &expiration);

    let recipients = vec![
        &h.env,
        RecipientEntry { to: bob.clone(), amount: 300 },
        RecipientEntry { to: carol.clone(), amount: 200 },
    ];
    h.token.batch_transfer_from(&spender, &alice, &recipients);

    assert_eq!(h.token.balance(&alice), 500);
    assert_eq!(h.token.balance(&bob), 300);
    assert_eq!(h.token.balance(&carol), 200);
    // Allowance reduced by total = 500; 600 - 500 = 100 remaining
    assert_eq!(h.token.allowance(&alice, &spender), 100);
}

#[test]
fn test_batch_transfer_from_insufficient_allowance() {
    let h = setup();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    let spender = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);
    h.token.mint(&alice, &1_000);

    let expiration = h.env.ledger().sequence() + 1_000;
    h.token.approve(&alice, &spender, &100, &expiration); // only 100

    let recipients = vec![
        &h.env,
        RecipientEntry { to: bob.clone(), amount: 200 }, // needs 200
    ];
    assert!(h.token.try_batch_transfer_from(&spender, &alice, &recipients).is_err());

    assert_eq!(h.token.balance(&alice), 1_000);
    assert_eq!(h.token.balance(&bob), 0);
    assert_eq!(h.token.allowance(&alice, &spender), 100); // unchanged
}

#[test]
fn test_batch_transfer_from_expired_allowance() {
    let h = setup();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    let spender = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);
    h.token.mint(&alice, &1_000);

    let expiration = h.env.ledger().sequence() + 10;
    h.token.approve(&alice, &spender, &500, &expiration);

    h.env.ledger().set_sequence_number(expiration + 1);

    let recipients = vec![
        &h.env,
        RecipientEntry { to: bob.clone(), amount: 100 },
    ];
    assert!(h.token.try_batch_transfer_from(&spender, &alice, &recipients).is_err());
    assert_eq!(h.token.balance(&alice), 1_000);
    assert_eq!(h.token.balance(&bob), 0);
}

#[test]
fn test_batch_transfer_from_state_unchanged_on_kyc_failure() {
    let h = setup();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    let carol = Address::generate(&h.env); // no KYC
    let spender = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);
    h.token.mint(&alice, &1_000);

    let expiration = h.env.ledger().sequence() + 1_000;
    h.token.approve(&alice, &spender, &600, &expiration);

    let recipients = vec![
        &h.env,
        RecipientEntry { to: bob.clone(), amount: 300 },
        RecipientEntry { to: carol.clone(), amount: 200 }, // KYC fails
    ];
    assert!(h.token.try_batch_transfer_from(&spender, &alice, &recipients).is_err());

    assert_eq!(h.token.balance(&alice), 1_000);
    assert_eq!(h.token.balance(&bob), 0);
    // Allowance must also be unchanged (consumed only after validation pass)
    assert_eq!(h.token.allowance(&alice, &spender), 600);
}

#[test]
fn test_batch_transfer_from_allowance_consumed_atomically() {
    // Ensure allowance is consumed for the full batch total, not incrementally
    let h = setup();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    let carol = Address::generate(&h.env);
    let spender = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);
    h.approve_kyc(&carol);
    h.token.mint(&alice, &1_000);

    let expiration = h.env.ledger().sequence() + 1_000;
    h.token.approve(&alice, &spender, &500, &expiration);

    let recipients = vec![
        &h.env,
        RecipientEntry { to: bob.clone(), amount: 250 },
        RecipientEntry { to: carol.clone(), amount: 250 },
    ];
    h.token.batch_transfer_from(&spender, &alice, &recipients);

    assert_eq!(h.token.allowance(&alice, &spender), 0);
    assert_eq!(h.token.balance(&alice), 500);
    assert_eq!(h.token.balance(&bob), 250);
    assert_eq!(h.token.balance(&carol), 250);
}

#[test]
fn test_batch_transfer_from_exceeds_max_recipients() {
    let h = setup();
    let alice = Address::generate(&h.env);
    let spender = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &10_000);

    let expiration = h.env.ledger().sequence() + 1_000;
    h.token.approve(&alice, &spender, &10_000, &expiration);

    let mut recipients = soroban_sdk::Vec::new(&h.env);
    for _ in 0..11 {
        let addr = Address::generate(&h.env);
        h.approve_kyc(&addr);
        recipients.push_back(RecipientEntry { to: addr, amount: 1 });
    }
    assert!(h.token.try_batch_transfer_from(&spender, &alice, &recipients).is_err());
    assert_eq!(h.token.balance(&alice), 10_000);
}

// ── versioning (#342) ─────────────────────────────────────────────────────────

#[test]
fn test_contract_version_info_initialized_at_deploy() {
    let h = setup();
    let (ver, count, last_ts) = h.token.contract_version_info();
    // Version is set to Cargo.toml version at deploy; migration count starts at 0.
    assert!(ver.len() > 0);
    assert_eq!(count, 0);
    assert_eq!(last_ts, 0);
}

#[test]
fn test_migrate_records_version_bump() {
    let h = setup();
    let new_ver = String::from_str(&h.env, "0.2.0");
    let desc = String::from_str(&h.env, "first upgrade");
    h.token.migrate(&new_ver, &desc);

    let (ver, count, _ts) = h.token.contract_version_info();
    assert_eq!(ver, new_ver);
    assert_eq!(count, 1);
}

#[test]
fn test_migrate_increments_count_on_each_call() {
    let h = setup();
    h.token.migrate(
        &String::from_str(&h.env, "0.2.0"),
        &String::from_str(&h.env, "add recovery"),
    );
    h.token.migrate(
        &String::from_str(&h.env, "0.3.0"),
        &String::from_str(&h.env, "add events"),
    );

    let (_ver, count, _ts) = h.token.contract_version_info();
    assert_eq!(count, 2);
}

#[test]
fn test_get_migration_record_returns_correct_entry() {
    let h = setup();
    let v1 = String::from_str(&h.env, "0.2.0");
    let d1 = String::from_str(&h.env, "first upgrade");
    h.token.migrate(&v1, &d1);

    let v2 = String::from_str(&h.env, "0.3.0");
    let d2 = String::from_str(&h.env, "second upgrade");
    h.token.migrate(&v2, &d2);

    let rec0 = h.token.get_migration_record(&0);
    assert_eq!(rec0.to_version, v1);
    assert_eq!(rec0.description, d1);

    let rec1 = h.token.get_migration_record(&1);
    assert_eq!(rec1.to_version, v2);
    assert_eq!(rec1.description, d2);
}

#[test]
fn test_migrate_last_ts_reflects_ledger_timestamp() {
    let h = setup();
    h.env.ledger().set_timestamp(1_700_000_000);
    h.token.migrate(
        &String::from_str(&h.env, "0.2.0"),
        &String::from_str(&h.env, "timed upgrade"),
    );
    let (_ver, _count, last_ts) = h.token.contract_version_info();
    assert_eq!(last_ts, 1_700_000_000);
}

// ── Metadata export (get_token_export / set_external_uri) ────────────────────

#[test]
fn test_get_token_export_basic_fields() {
    let h = setup();
    let export = h.token.get_token_export();

    assert_eq!(export.name, String::from_str(&h.env, "Veritoken RWA"));
    assert_eq!(export.symbol, String::from_str(&h.env, "VTRWA"));
    assert_eq!(export.decimals, 7u32);
    assert_eq!(export.asset_type, String::from_str(&h.env, "property"));
    assert_eq!(export.total_supply, 0i128);
    assert_eq!(export.max_supply, 0i128);
    assert!(export.contract_version.len() > 0);
}

#[test]
fn test_get_token_export_linked_addresses() {
    let h = setup();
    let export = h.token.get_token_export();

    assert_eq!(export.kyc_registry, h.token.kyc_registry());
    assert_eq!(export.compliance_engine, h.token.compliance_engine());
}

#[test]
fn test_get_token_export_compliance_fields_empty_by_default() {
    let h = setup();
    let export = h.token.get_token_export();

    assert!(export.legal_entity.is_none());
    assert!(export.governing_law.is_none());
    assert!(export.isin.is_none());
    assert!(export.prospectus_hash.is_none());
    assert!(export.external_uri.is_none());
}

#[test]
fn test_get_token_export_reflects_set_compliance_metadata() {
    let h = setup();
    let key_entity = soroban_sdk::Symbol::new(&h.env, META_LEGAL_ENTITY);
    let key_isin   = soroban_sdk::Symbol::new(&h.env, META_ISIN);
    h.token.set_compliance_metadata(&key_entity, &String::from_str(&h.env, "Acme Corp"));
    h.token.set_compliance_metadata(&key_isin,   &String::from_str(&h.env, "US0231351067"));

    let export = h.token.get_token_export();
    assert_eq!(export.legal_entity, Some(String::from_str(&h.env, "Acme Corp")));
    assert_eq!(export.isin, Some(String::from_str(&h.env, "US0231351067")));
    assert!(export.governing_law.is_none());
    assert!(export.prospectus_hash.is_none());
}

#[test]
fn test_get_token_export_reflects_total_supply_after_mint() {
    let h = setup();
    let user = Address::generate(&h.env);
    h.approve_kyc(&user);
    h.token.mint(&user, &5_000);

    let export = h.token.get_token_export();
    assert_eq!(export.total_supply, 5_000i128);
}

#[test]
fn test_set_and_get_external_uri() {
    let h = setup();
    assert_eq!(h.token.get_external_uri(), String::from_str(&h.env, ""));

    let uri = String::from_str(&h.env, "ipfs://QmTestHash");
    h.token.set_external_uri(&uri);

    assert_eq!(h.token.get_external_uri(), uri);
    let export = h.token.get_token_export();
    assert_eq!(export.external_uri, Some(uri));
}

#[test]
fn test_set_external_uri_empty_string_clears_value() {
    let h = setup();
    h.token.set_external_uri(&String::from_str(&h.env, "https://example.com/meta"));
    h.token.set_external_uri(&String::from_str(&h.env, ""));

    assert_eq!(h.token.get_external_uri(), String::from_str(&h.env, ""));
    let export = h.token.get_token_export();
    assert!(export.external_uri.is_none());
}

#[test]
fn test_get_token_export_max_supply_set_at_constructor() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);

    let kyc_id = env.register(kyc_registry::KycRegistry, ());
    let kyc = KycRegistryClient::new(&env, &kyc_id);
    kyc.initialize(&admin);

    let compliance_id = env.register(compliance_engine::ComplianceEngine, ());
    let compliance = ComplianceEngineClient::new(&env, &compliance_id);
    compliance.initialize(&admin, &kyc_id, &0u64);

    let token_id = env.register(
        RwaToken,
        (
            admin.clone(),
            7u32,
            String::from_str(&env, "Cap Token"),
            String::from_str(&env, "CAP"),
            String::from_str(&env, "invoice"),
            kyc_id.clone(),
            compliance_id.clone(),
            Option::<ComplianceMetadata>::None,
            1_000_000i128, // max_supply = 1 million
        ),
    );
    let token = RwaTokenClient::new(&env, &token_id);
    let export = token.get_token_export();
    assert_eq!(export.max_supply, 1_000_000i128);
}

// ── KYC synchronization layer tests ──────────────────────────────────────────

#[test]
fn test_check_kyc_status_active_for_approved_holder() {
    let h = setup();
    let user = Address::generate(&h.env);
    h.approve_kyc(&user);

    let snap = h.token.check_kyc_status(&user);
    assert!(snap.is_active);
    assert_eq!(snap.tier, 1u32);
    assert_eq!(snap.jurisdiction, String::from_str(&h.env, "US"));
    assert_eq!(snap.expiry, 0u64); // no expiry set
}

#[test]
fn test_check_kyc_status_inactive_for_revoked() {
    let h = setup();
    let user = Address::generate(&h.env);
    h.approve_kyc(&user);
    h.kyc.revoke(&h.verifier, &user);

    let snap = h.token.check_kyc_status(&user);
    assert!(!snap.is_active);
}

#[test]
fn test_check_kyc_status_inactive_for_expired_approval() {
    let h = setup();
    let user = Address::generate(&h.env);

    // Approve with expiry in the past
    h.env.ledger().set_timestamp(1_000);
    h.kyc.approve(
        &h.verifier,
        &user,
        &1,
        &500, // expiry = 500 < current 1000
        &String::from_str(&h.env, "US"),
    );

    let snap = h.token.check_kyc_status(&user);
    assert!(!snap.is_active);
    assert_eq!(snap.expiry, 500u64);
}

#[test]
fn test_check_kyc_status_active_at_expiry_boundary() {
    let h = setup();
    let user = Address::generate(&h.env);

    h.env.ledger().set_timestamp(1_000);
    // expiry == now → still active (expiry >= now)
    h.kyc.approve(
        &h.verifier,
        &user,
        &1,
        &1_000,
        &String::from_str(&h.env, "US"),
    );

    let snap = h.token.check_kyc_status(&user);
    assert!(snap.is_active);
}

#[test]
fn test_check_kyc_status_inactive_one_second_past_expiry() {
    let h = setup();
    let user = Address::generate(&h.env);

    h.env.ledger().set_timestamp(999);
    h.kyc.approve(
        &h.verifier,
        &user,
        &1,
        &1_000,
        &String::from_str(&h.env, "US"),
    );

    h.env.ledger().set_timestamp(1_001);
    let snap = h.token.check_kyc_status(&user);
    assert!(!snap.is_active);
}

#[test]
fn test_check_kyc_status_checked_at_reflects_current_timestamp() {
    let h = setup();
    let user = Address::generate(&h.env);
    h.approve_kyc(&user);

    h.env.ledger().set_timestamp(9_999_000);
    let snap = h.token.check_kyc_status(&user);
    assert_eq!(snap.checked_at, 9_999_000u64);
}

#[test]
fn test_sync_kyc_status_returns_true_for_active() {
    let h = setup();
    let user = Address::generate(&h.env);
    h.approve_kyc(&user);

    let is_active = h.token.sync_kyc_status(&user);
    assert!(is_active);
}

#[test]
fn test_sync_kyc_status_returns_false_after_revocation() {
    let h = setup();
    let user = Address::generate(&h.env);
    h.approve_kyc(&user);
    h.kyc.revoke(&h.verifier, &user);

    let is_active = h.token.sync_kyc_status(&user);
    assert!(!is_active);
}

#[test]
fn test_sync_kyc_status_returns_false_for_expired_approval() {
    let h = setup();
    let user = Address::generate(&h.env);

    h.env.ledger().set_timestamp(500);
    h.kyc.approve(
        &h.verifier,
        &user,
        &1,
        &600, // expires at 600
        &String::from_str(&h.env, "US"),
    );

    h.env.ledger().set_timestamp(700); // past expiry
    let is_active = h.token.sync_kyc_status(&user);
    assert!(!is_active);
}

#[test]
fn test_transfer_blocked_after_revocation() {
    // Verifies that revocation is immediately effective on the next transfer attempt.
    let h = setup();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);
    h.token.mint(&alice, &1_000);

    // Transfer works before revocation
    h.token.transfer(&alice, &bob, &100);
    assert_eq!(h.token.balance(&bob), 100);

    // Revoke alice's KYC
    h.kyc.revoke(&h.verifier, &alice);

    // Next transfer must fail — KYC check catches the revocation
    assert!(h.token.try_transfer(&alice, &bob, &100).is_err());
}

#[test]
fn test_transfer_blocked_after_expiry() {
    let h = setup();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);

    h.env.ledger().set_timestamp(1_000);
    h.kyc.approve(
        &h.verifier,
        &alice,
        &1,
        &2_000, // expires at t=2000
        &String::from_str(&h.env, "US"),
    );
    h.approve_kyc(&bob);

    h.token.mint(&alice, &1_000);

    // Transfer works before expiry
    h.token.transfer(&alice, &bob, &100);

    // Jump past alice's expiry
    h.env.ledger().set_timestamp(2_001);

    // Transfer now blocked — alice's KYC has expired
    assert!(h.token.try_transfer(&alice, &bob, &100).is_err());
}

#[test]
fn test_mint_blocked_after_recipient_kyc_expires() {
    let h = setup();
    let user = Address::generate(&h.env);

    h.env.ledger().set_timestamp(1_000);
    h.kyc.approve(
        &h.verifier,
        &user,
        &1,
        &1_500, // expires at t=1500
        &String::from_str(&h.env, "US"),
    );

    h.token.mint(&user, &500); // works before expiry

    h.env.ledger().set_timestamp(1_600); // past expiry

    assert!(h.token.try_mint(&user, &500).is_err());
}

#[test]
fn test_check_kyc_status_tier_reflects_update() {
    let h = setup();
    let user = Address::generate(&h.env);

    h.kyc.approve(
        &h.verifier,
        &user,
        &1, // tier 1
        &0,
        &String::from_str(&h.env, "US"),
    );
    let snap1 = h.token.check_kyc_status(&user);
    assert_eq!(snap1.tier, 1u32);

    // Upgrade tier to 2
    h.kyc.update_tier(&h.verifier, &user, &2);
    let snap2 = h.token.check_kyc_status(&user);
    assert_eq!(snap2.tier, 2u32);
    assert!(snap2.is_active);
}
