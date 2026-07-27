#![cfg(test)]

use crate::{ComplianceEngine, ComplianceEngineClient, ComplianceError, ComplianceRules};
use kyc_registry::{KycRegistry, KycRegistryClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, Error, String,
};

fn setup() -> (Env, ComplianceEngineClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);

    // A dummy KYC registry address suffices for tests that don't use jurisdiction checks.
    let kyc_id = env.register(KycRegistry, ());
    let kyc = KycRegistryClient::new(&env, &kyc_id);
    kyc.initialize(&admin);

    let contract_id = env.register(ComplianceEngine, ());
    let client = ComplianceEngineClient::new(&env, &contract_id);
    // rule_change_delay=0 so set_rules / propose_rules tests remain synchronous
    client.initialize(&admin, &kyc_id, &0u64);
    (env, client, admin)
}

fn rules(
    max_transfer_amount: i128,
    min_holding_period: u64,
    max_holders: u32,
    paused: bool,
) -> ComplianceRules {
    ComplianceRules {
        max_transfer_amount,
        min_holding_period,
        max_holders,
        require_same_jurisdiction: false,
        paused,
        allowlist_mode: false,
        max_holding_period: 0,
    }
}

#[test]
fn test_default_rules_allow_transfer() {
    let (env, client, _admin) = setup();
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    assert!(client.can_transfer(&from, &to, &1_000));
}

#[test]
fn test_pause_blocks_all_transfers() {
    let (env, client, _admin) = setup();
    let from = Address::generate(&env);
    let to = Address::generate(&env);

    client.pause();
    assert!(!client.can_transfer(&from, &to, &1));

    client.unpause();
    assert!(client.can_transfer(&from, &to, &1));
}

#[test]
fn test_blocklist() {
    let (env, client, _admin) = setup();
    let from = Address::generate(&env);
    let to = Address::generate(&env);

    assert!(!client.is_blocklisted(&from));
    client.add_to_blocklist(&from);
    assert!(client.is_blocklisted(&from));
    assert!(!client.can_transfer(&from, &to, &1));
    // The receiver being blocked also blocks
    assert!(!client.can_transfer(&to, &from, &1));

    client.remove_from_blocklist(&from);
    assert!(!client.is_blocklisted(&from));
    assert!(client.can_transfer(&from, &to, &1));
}

#[test]
fn test_max_transfer_amount() {
    let (env, client, _admin) = setup();
    let from = Address::generate(&env);
    let to = Address::generate(&env);

    client.set_rules(&rules(100, 0, 0, false));
    assert!(client.can_transfer(&from, &to, &100));
    assert!(!client.can_transfer(&from, &to, &101));
}

#[test]
fn test_min_holding_period() {
    let (env, client, _admin) = setup();
    let from = Address::generate(&env);
    let to = Address::generate(&env);

    client.set_rules(&rules(0, 1_000, 0, false));

    env.ledger().set_timestamp(5_000);
    client.register_holder(&from);
    assert_eq!(client.holder_count(), 1);

    // Not enough time elapsed
    env.ledger().set_timestamp(5_500);
    assert!(!client.can_transfer(&from, &to, &1));

    // Past holding period
    env.ledger().set_timestamp(6_001);
    assert!(client.can_transfer(&from, &to, &1));
}

#[test]
fn test_register_holder_is_idempotent() {
    let (env, client, _admin) = setup();
    let holder = Address::generate(&env);
    client.register_holder(&holder);
    client.register_holder(&holder);
    assert_eq!(client.holder_count(), 1);
}

#[test]
fn test_unregister_holder_decrements_count() {
    let (env, client, _admin) = setup();
    let holder = Address::generate(&env);
    client.register_holder(&holder);
    assert_eq!(client.holder_count(), 1);

    client.unregister_holder(&holder);
    assert_eq!(client.holder_count(), 0);
}

#[test]
fn test_max_holders_blocks_new_holder_but_allows_existing_holder() {
    let (env, client, _admin) = setup();
    let holder1 = Address::generate(&env);
    let holder2 = Address::generate(&env);
    let new_holder = Address::generate(&env);

    client.set_rules(&rules(0, 0, 2, false));
    client.register_holder(&holder1);
    client.register_holder(&holder2);
    assert_eq!(client.holder_count(), 2);

    assert!(!client.can_transfer(&holder1, &new_holder, &1));
    assert!(client.can_transfer(&holder1, &holder2, &1));
}

#[test]
fn test_set_rules_rejects_min_holding_period_exceeding_365_days() {
    let (_env, client, _admin) = setup();
    let res = client.try_set_rules(&rules(0, 31_536_001, 0, false));
    assert_eq!(
        res,
        Err(Ok(Error::from(ComplianceError::MinHoldingPeriodExceeds365Days)))
    );
}

#[test]
fn test_set_rules_rejects_negative_max_transfer_amount() {
    let (_env, client, _admin) = setup();
    let res = client.try_set_rules(&rules(-1, 0, 0, false));
    assert_eq!(res, Err(Ok(Error::from(ComplianceError::NegativeMaxTransferAmount))));
}

#[test]
fn test_set_rules_rejects_max_holders_below_current_holder_count() {
    let (env, client, _admin) = setup();
    let holder1 = Address::generate(&env);
    let holder2 = Address::generate(&env);
    client.register_holder(&holder1);
    client.register_holder(&holder2);
    assert_eq!(client.holder_count(), 2);

    let res = client.try_set_rules(&rules(0, 0, 1, false));
    assert_eq!(res, Err(Ok(Error::from(ComplianceError::MaxHoldersBelowCurrentCount))));
}

#[test]
fn test_set_rules_accepts_valid_configurations() {
    let (_env, client, _admin) = setup();
    client.set_rules(&rules(1_000_000, 31_536_000, 0, false));
    let r = client.get_rules();
    assert_eq!(r.max_transfer_amount, 1_000_000);
    assert_eq!(r.min_holding_period, 31_536_000);
}

#[test]
fn test_only_admin_can_set_rules() {
    let env = Env::default();
    let admin = Address::generate(&env);

    let kyc_id = env.register(KycRegistry, ());
    let kyc = KycRegistryClient::new(&env, &kyc_id);
    // initialize KYC with admin auth
    env.mock_all_auths();
    kyc.initialize(&admin);

    let contract_id = env.register(ComplianceEngine, ());
    let client = ComplianceEngineClient::new(&env, &contract_id);
    client.initialize(&admin, &kyc_id, &0u64);

    // Remove blanket auth — subsequent calls have no auth, so require_admin should fail
    env.set_auths(&[]);
    let res = client.try_set_rules(&rules(0, 0, 0, true));
    assert!(res.is_err());
}

/// Deploys a mock KYC registry and a compliance engine linked to it, returning
/// handles for jurisdiction-based tests.
fn setup_with_kyc_registry() -> (
    Env,
    ComplianceEngineClient<'static>,
    KycRegistryClient<'static>,
    Address, // verifier
    Address, // admin
) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);

    let kyc_id = env.register(KycRegistry, ());
    let kyc = KycRegistryClient::new(&env, &kyc_id);
    kyc.initialize(&admin);
    let verifier = Address::generate(&env);
    kyc.add_verifier(&admin, &verifier);

    let ce_id = env.register(ComplianceEngine, ());
    let ce = ComplianceEngineClient::new(&env, &ce_id);
    ce.initialize(&admin, &kyc_id, &0u64);

    (env, ce, kyc, verifier, admin)
}

fn jurisdiction_rules(require_same_jurisdiction: bool) -> ComplianceRules {
    ComplianceRules {
        max_transfer_amount: 0,
        min_holding_period: 0,
        max_holders: 0,
        require_same_jurisdiction,
        paused: false,
        allowlist_mode: false,
        max_holding_period: 0,
    }
}

#[test]
fn test_same_jurisdiction_blocks_cross_border_transfer() {
    let (env, ce, kyc, verifier, _admin) = setup_with_kyc_registry();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // alice = US, bob = GB
    kyc.approve(&verifier, &alice, &1, &0, &String::from_str(&env, "US"));
    kyc.approve(&verifier, &bob, &1, &0, &String::from_str(&env, "GB"));

    ce.set_rules(&jurisdiction_rules(true));

    // Cross-border transfer is blocked.
    assert!(!ce.can_transfer(&alice, &bob, &100));
}

#[test]
fn test_same_jurisdiction_allows_matching_jurisdictions() {
    let (env, ce, kyc, verifier, _admin) = setup_with_kyc_registry();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // Both in the US.
    kyc.approve(&verifier, &alice, &1, &0, &String::from_str(&env, "US"));
    kyc.approve(&verifier, &bob, &1, &0, &String::from_str(&env, "US"));

    ce.set_rules(&jurisdiction_rules(true));

    // Same-jurisdiction transfer is allowed.
    assert!(ce.can_transfer(&alice, &bob, &100));
}

#[test]
fn test_same_jurisdiction_rule_disabled_allows_any() {
    let (env, ce, kyc, verifier, _admin) = setup_with_kyc_registry();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // Different jurisdictions, but the rule is disabled.
    kyc.approve(&verifier, &alice, &1, &0, &String::from_str(&env, "US"));
    kyc.approve(&verifier, &bob, &1, &0, &String::from_str(&env, "GB"));

    ce.set_rules(&jurisdiction_rules(false));

    // With the rule off, cross-border transfers are allowed.
    assert!(ce.can_transfer(&alice, &bob, &100));
}

#[test]
fn test_require_same_jurisdiction_blocks_cross_jurisdiction_transfer() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);

    let kyc_id = env.register(KycRegistry, ());
    let kyc = KycRegistryClient::new(&env, &kyc_id);
    kyc.initialize(&admin);
    let verifier = Address::generate(&env);
    kyc.add_verifier(&admin, &verifier);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // alice = US, bob = GB
    kyc.approve(&verifier, &alice, &1, &0, &String::from_str(&env, "US"));
    kyc.approve(&verifier, &bob, &1, &0, &String::from_str(&env, "GB"));

    let ce_id = env.register(ComplianceEngine, ());
    let ce = ComplianceEngineClient::new(&env, &ce_id);
    ce.initialize(&admin, &kyc_id, &0u64);

    ce.set_rules(&ComplianceRules {
        max_transfer_amount: 0,
        min_holding_period: 0,
        max_holders: 0,
        require_same_jurisdiction: true,
        paused: false,
        allowlist_mode: false,
        max_holding_period: 0,
    });

    // Cross-jurisdiction: blocked
    assert!(!ce.can_transfer(&alice, &bob, &100));

    // Same jurisdiction: allowed
    let carol = Address::generate(&env);
    kyc.approve(&verifier, &carol, &1, &0, &String::from_str(&env, "US"));
    assert!(ce.can_transfer(&alice, &carol, &100));
}

#[test]
fn test_version_returns_nonempty() {
    let (_, client, _) = setup();
    let v = client.version();
    assert!(v.len() > 0);
}

#[test]
fn test_blocklist_count_stays_accurate() {
    let (env, client, _admin) = setup();
    let addr1 = Address::generate(&env);
    let addr2 = Address::generate(&env);

    assert_eq!(client.blocklist_count(), 0);

    client.add_to_blocklist(&addr1);
    assert_eq!(client.blocklist_count(), 1);

    client.add_to_blocklist(&addr2);
    assert_eq!(client.blocklist_count(), 2);

    // Duplicate add must not increment count
    client.add_to_blocklist(&addr1);
    assert_eq!(client.blocklist_count(), 2);

    client.remove_from_blocklist(&addr1);
    assert_eq!(client.blocklist_count(), 1);

    // Remove of an address not on the list must not decrement count
    client.remove_from_blocklist(&addr1);
    assert_eq!(client.blocklist_count(), 1);
}

#[test]
fn test_get_blocklist_pagination() {
    let (env, client, _admin) = setup();
    let addr1 = Address::generate(&env);
    let addr2 = Address::generate(&env);
    let addr3 = Address::generate(&env);

    client.add_to_blocklist(&addr1);
    client.add_to_blocklist(&addr2);
    client.add_to_blocklist(&addr3);

    // Fetch all
    let all = client.get_blocklist(&0, &10);
    assert_eq!(all.len(), 3);

    // First page (2 items)
    let page1 = client.get_blocklist(&0, &2);
    assert_eq!(page1.len(), 2);

    // Second page (1 item)
    let page2 = client.get_blocklist(&2, &2);
    assert_eq!(page2.len(), 1);

    // Start beyond length returns empty
    let empty = client.get_blocklist(&10, &5);
    assert_eq!(empty.len(), 0);
}

#[test]
fn test_max_holding_period_blocks_over_held_receiver() {
    let (env, client, _admin) = setup();
    let sender = Address::generate(&env);
    let over_held = Address::generate(&env);
    let fresh = Address::generate(&env);

    // max_holding_period = 1_000 seconds
    client.set_rules(&ComplianceRules {
        max_transfer_amount: 0,
        min_holding_period: 0,
        max_holders: 0,
        require_same_jurisdiction: false,
        paused: false,
        allowlist_mode: false,
        max_holding_period: 1_000,
    });

    // Register over_held at t=1_000
    env.ledger().set_timestamp(1_000);
    client.register_holder(&over_held);

    // At t=2_001 the over_held address has held for 1_001 seconds (>= 1_000).
    env.ledger().set_timestamp(2_001);

    // Sending FROM over_held is still allowed (forced-exit is always permitted).
    assert!(client.can_transfer(&over_held, &fresh, &1));

    // Sending TO over_held is blocked (they may not receive more tokens).
    assert!(!client.can_transfer(&sender, &over_held, &1));
}

#[test]
fn test_max_holding_period_zero_means_unlimited() {
    let (env, client, _admin) = setup();
    let sender = Address::generate(&env);
    let long_holder = Address::generate(&env);

    // No max holding period (0 = unlimited)
    client.set_rules(&ComplianceRules {
        max_transfer_amount: 0,
        min_holding_period: 0,
        max_holders: 0,
        require_same_jurisdiction: false,
        paused: false,
        allowlist_mode: false,
        max_holding_period: 0,
    });

    // Register at t=0; jump far into the future
    env.ledger().set_timestamp(0);
    client.register_holder(&long_holder);
    env.ledger().set_timestamp(u64::MAX / 2);

    // Even after an astronomically long hold, receiving is still allowed when max=0.
    assert!(client.can_transfer(&sender, &long_holder, &1));
}

#[test]
fn test_max_holding_period_new_holder_not_blocked() {
    let (env, client, _admin) = setup();
    let sender = Address::generate(&env);
    let new_holder = Address::generate(&env);

    client.set_rules(&ComplianceRules {
        max_transfer_amount: 0,
        min_holding_period: 0,
        max_holders: 0,
        require_same_jurisdiction: false,
        paused: false,
        allowlist_mode: false,
        max_holding_period: 500,
    });

    env.ledger().set_timestamp(10_000);

    // new_holder has never held any tokens (no HolderSince entry), so they
    // cannot possibly be over-held.  The transfer should be allowed.
    assert!(client.can_transfer(&sender, &new_holder, &1));
}
