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

// ── Tier-based policy tests ───────────────────────────────────────────────────

/// Helper: build a full KYC + compliance harness for tier tests.
fn setup_tier() -> (
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

#[test]
fn test_tier_policy_blocked_pair_blocks_transfer() {
    use crate::TierPolicy;
    let (env, ce, kyc, verifier, _admin) = setup_tier();
    let alice = Address::generate(&env); // tier 0 (basic)
    let bob = Address::generate(&env);   // tier 2 (institutional)

    kyc.approve(&verifier, &alice, &0, &0, &String::from_str(&env, "US"));
    kyc.approve(&verifier, &bob, &2, &0, &String::from_str(&env, "US"));

    // Block retail (tier=0) → institutional (tier=2) transfers.
    ce.set_tier_policy(
        &0u32,
        &2u32,
        &TierPolicy {
            blocked: true,
            max_transfer_amount: 0,
            min_from_tier: 0,
            min_to_tier: 0,
        },
    );

    // alice (tier 0) → bob (tier 2): blocked by tier policy.
    assert!(!ce.can_transfer(&alice, &bob, &100));
    // bob (tier 2) → alice (tier 0): different pair, NOT blocked.
    assert!(ce.can_transfer(&bob, &alice, &100));
}

#[test]
fn test_tier_policy_no_policies_allows_all() {
    let (env, ce, kyc, verifier, _admin) = setup_tier();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    kyc.approve(&verifier, &alice, &0, &0, &String::from_str(&env, "US"));
    kyc.approve(&verifier, &bob, &2, &0, &String::from_str(&env, "US"));

    // No tier policies set — transfers allowed regardless of tier.
    assert!(ce.can_transfer(&alice, &bob, &1_000));
    assert_eq!(ce.tier_policy_count(), 0);
}

#[test]
fn test_tier_policy_min_from_tier_blocks_low_tier_sender() {
    use crate::TierPolicy;
    let (env, ce, kyc, verifier, _admin) = setup_tier();
    let basic = Address::generate(&env);     // tier 0
    let accredited = Address::generate(&env); // tier 1
    let recipient = Address::generate(&env);  // tier 1

    kyc.approve(&verifier, &basic, &0, &0, &String::from_str(&env, "US"));
    kyc.approve(&verifier, &accredited, &1, &0, &String::from_str(&env, "US"));
    kyc.approve(&verifier, &recipient, &1, &0, &String::from_str(&env, "US"));

    // Wildcard recipient (u32::MAX), require sender tier >= 1.
    ce.set_tier_policy(
        &0u32,
        &u32::MAX,
        &TierPolicy {
            blocked: false,
            max_transfer_amount: 0,
            min_from_tier: 1,
            min_to_tier: 0,
        },
    );

    // basic (tier 0) fails min_from_tier check.
    assert!(!ce.can_transfer(&basic, &recipient, &100));
    // accredited (tier 1) meets min_from_tier.
    assert!(ce.can_transfer(&accredited, &recipient, &100));
}

#[test]
fn test_tier_policy_min_to_tier_blocks_low_tier_recipient() {
    use crate::TierPolicy;
    let (env, ce, kyc, verifier, _admin) = setup_tier();
    let sender = Address::generate(&env);     // tier 2
    let basic = Address::generate(&env);       // tier 0
    let accredited = Address::generate(&env);  // tier 1

    kyc.approve(&verifier, &sender, &2, &0, &String::from_str(&env, "US"));
    kyc.approve(&verifier, &basic, &0, &0, &String::from_str(&env, "US"));
    kyc.approve(&verifier, &accredited, &1, &0, &String::from_str(&env, "US"));

    // Any sender → any recipient must have to_tier >= 1.
    ce.set_tier_policy(
        &u32::MAX,
        &u32::MAX,
        &TierPolicy {
            blocked: false,
            max_transfer_amount: 0,
            min_from_tier: 0,
            min_to_tier: 1,
        },
    );

    // basic recipient (tier 0) fails min_to_tier check.
    assert!(!ce.can_transfer(&sender, &basic, &100));
    // accredited recipient (tier 1) passes.
    assert!(ce.can_transfer(&sender, &accredited, &100));
}

#[test]
fn test_tier_policy_max_transfer_amount_per_tier_pair() {
    use crate::TierPolicy;
    let (env, ce, kyc, verifier, _admin) = setup_tier();
    let alice = Address::generate(&env); // tier 1
    let bob = Address::generate(&env);   // tier 1

    kyc.approve(&verifier, &alice, &1, &0, &String::from_str(&env, "US"));
    kyc.approve(&verifier, &bob, &1, &0, &String::from_str(&env, "US"));

    // Per-tier-pair cap: tier-1 → tier-1 limited to 500.
    ce.set_tier_policy(
        &1u32,
        &1u32,
        &TierPolicy {
            blocked: false,
            max_transfer_amount: 500,
            min_from_tier: 0,
            min_to_tier: 0,
        },
    );

    assert!(ce.can_transfer(&alice, &bob, &500));
    assert!(!ce.can_transfer(&alice, &bob, &501));
}

#[test]
fn test_tier_policy_per_tier_cap_more_restrictive_than_global() {
    use crate::TierPolicy;
    let (env, ce, kyc, verifier, _admin) = setup_tier();
    let alice = Address::generate(&env); // tier 1
    let bob = Address::generate(&env);   // tier 1

    kyc.approve(&verifier, &alice, &1, &0, &String::from_str(&env, "US"));
    kyc.approve(&verifier, &bob, &1, &0, &String::from_str(&env, "US"));

    // Global cap = 1000, tier-pair cap = 300 (more restrictive).
    ce.set_rules(&ComplianceRules {
        max_transfer_amount: 1000,
        min_holding_period: 0,
        max_holders: 0,
        require_same_jurisdiction: false,
        paused: false,
        allowlist_mode: false,
        max_holding_period: 0,
    });
    ce.set_tier_policy(
        &1u32,
        &1u32,
        &TierPolicy {
            blocked: false,
            max_transfer_amount: 300,
            min_from_tier: 0,
            min_to_tier: 0,
        },
    );

    // Tier-pair cap is the binding constraint.
    assert!(ce.can_transfer(&alice, &bob, &300));
    assert!(!ce.can_transfer(&alice, &bob, &301));
}

#[test]
fn test_tier_policy_global_cap_more_restrictive_than_tier_pair() {
    use crate::TierPolicy;
    let (env, ce, kyc, verifier, _admin) = setup_tier();
    let alice = Address::generate(&env); // tier 2
    let bob = Address::generate(&env);   // tier 2

    kyc.approve(&verifier, &alice, &2, &0, &String::from_str(&env, "US"));
    kyc.approve(&verifier, &bob, &2, &0, &String::from_str(&env, "US"));

    // Global cap = 200, tier-pair cap = 1000 (less restrictive).
    ce.set_rules(&ComplianceRules {
        max_transfer_amount: 200,
        min_holding_period: 0,
        max_holders: 0,
        require_same_jurisdiction: false,
        paused: false,
        allowlist_mode: false,
        max_holding_period: 0,
    });
    ce.set_tier_policy(
        &2u32,
        &2u32,
        &TierPolicy {
            blocked: false,
            max_transfer_amount: 1000,
            min_from_tier: 0,
            min_to_tier: 0,
        },
    );

    // Global cap is the binding constraint.
    assert!(ce.can_transfer(&alice, &bob, &200));
    assert!(!ce.can_transfer(&alice, &bob, &201));
}

#[test]
fn test_tier_policy_exact_match_overrides_wildcard() {
    use crate::TierPolicy;
    let (env, ce, kyc, verifier, _admin) = setup_tier();
    let alice = Address::generate(&env); // tier 1
    let bob = Address::generate(&env);   // tier 1

    kyc.approve(&verifier, &alice, &1, &0, &String::from_str(&env, "US"));
    kyc.approve(&verifier, &bob, &1, &0, &String::from_str(&env, "US"));

    // Wildcard policy blocks all transfers.
    ce.set_tier_policy(
        &u32::MAX,
        &u32::MAX,
        &TierPolicy {
            blocked: true,
            max_transfer_amount: 0,
            min_from_tier: 0,
            min_to_tier: 0,
        },
    );
    // Exact policy for tier-1 → tier-1 is permissive (not blocked).
    ce.set_tier_policy(
        &1u32,
        &1u32,
        &TierPolicy {
            blocked: false,
            max_transfer_amount: 0,
            min_from_tier: 0,
            min_to_tier: 0,
        },
    );

    // Exact match takes precedence: transfer is allowed.
    assert!(ce.can_transfer(&alice, &bob, &100));
}

#[test]
fn test_tier_policy_set_and_get_round_trip() {
    use crate::TierPolicy;
    let (env, ce, _kyc, _verifier, _admin) = setup_tier();

    let policy = TierPolicy {
        blocked: false,
        max_transfer_amount: 5000,
        min_from_tier: 1,
        min_to_tier: 2,
    };
    ce.set_tier_policy(&1u32, &2u32, &policy);

    let retrieved = ce.get_tier_policy(&1u32, &2u32);
    assert!(retrieved.is_some());
    let p = retrieved.unwrap();
    assert!(!p.blocked);
    assert_eq!(p.max_transfer_amount, 5000);
    assert_eq!(p.min_from_tier, 1);
    assert_eq!(p.min_to_tier, 2);
}

#[test]
fn test_tier_policy_get_returns_none_when_unset() {
    let (_, ce, _, _, _) = setup_tier();
    assert!(ce.get_tier_policy(&0u32, &99u32).is_none());
}

#[test]
fn test_tier_policy_clear_removes_policy_and_decrements_count() {
    use crate::TierPolicy;
    let (_, ce, _, _, _) = setup_tier();

    ce.set_tier_policy(
        &0u32,
        &1u32,
        &TierPolicy { blocked: true, max_transfer_amount: 0, min_from_tier: 0, min_to_tier: 0 },
    );
    assert_eq!(ce.tier_policy_count(), 1);

    ce.clear_tier_policy(&0u32, &1u32);
    assert_eq!(ce.tier_policy_count(), 0);
    assert!(ce.get_tier_policy(&0u32, &1u32).is_none());
}

#[test]
fn test_tier_policy_count_increments_only_once_per_unique_key() {
    use crate::TierPolicy;
    let (_, ce, _, _, _) = setup_tier();

    let p = TierPolicy { blocked: false, max_transfer_amount: 0, min_from_tier: 0, min_to_tier: 0 };
    ce.set_tier_policy(&0u32, &1u32, &p.clone());
    ce.set_tier_policy(&0u32, &1u32, &p.clone()); // update, not new
    ce.set_tier_policy(&1u32, &2u32, &p.clone());

    // Two distinct keys, even though first was overwritten.
    assert_eq!(ce.tier_policy_count(), 2);
}

#[test]
fn test_tier_policy_paused_engine_ignores_tier_policies() {
    use crate::TierPolicy;
    let (env, ce, kyc, verifier, _admin) = setup_tier();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    kyc.approve(&verifier, &alice, &2, &0, &String::from_str(&env, "US"));
    kyc.approve(&verifier, &bob, &2, &0, &String::from_str(&env, "US"));

    // Permissive tier policy — but pause should block first.
    ce.set_tier_policy(
        &2u32,
        &2u32,
        &TierPolicy { blocked: false, max_transfer_amount: 0, min_from_tier: 0, min_to_tier: 0 },
    );
    ce.pause();

    assert!(!ce.can_transfer(&alice, &bob, &100));
}

// ── Jurisdiction risk scoring tests ──────────────────────────────────────────

fn setup_risk() -> (
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

#[test]
fn test_risk_scoring_inactive_by_default() {
    let (env, ce, kyc, verifier, _admin) = setup_risk();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    kyc.approve(&verifier, &alice, &0, &0, &String::from_str(&env, "KP")); // high-risk country
    kyc.approve(&verifier, &bob, &0, &0, &String::from_str(&env, "US"));

    // No RiskConfig set → risk scoring is inactive → transfer allowed
    assert!(ce.can_transfer(&alice, &bob, &100));
    assert!(ce.get_risk_config().is_none());
}

#[test]
fn test_risk_config_max_score_zero_disables_scoring() {
    use crate::RiskConfig;
    let (env, ce, kyc, verifier, _admin) = setup_risk();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    kyc.approve(&verifier, &alice, &0, &0, &String::from_str(&env, "KP"));
    kyc.approve(&verifier, &bob, &0, &0, &String::from_str(&env, "US"));

    // Set KP score to 100, but max_score = 0 disables enforcement
    ce.set_risk_config(&RiskConfig { max_score: 0, default_score: 0 });
    ce.set_jurisdiction_risk_score(&String::from_str(&env, "KP"), &100u32);

    assert!(ce.can_transfer(&alice, &bob, &100));
}

#[test]
fn test_high_risk_jurisdiction_blocks_sender() {
    use crate::RiskConfig;
    let (env, ce, kyc, verifier, _admin) = setup_risk();
    let alice = Address::generate(&env); // KP = 100 > max 49
    let bob = Address::generate(&env);   // US = 10
    kyc.approve(&verifier, &alice, &0, &0, &String::from_str(&env, "KP"));
    kyc.approve(&verifier, &bob, &0, &0, &String::from_str(&env, "US"));

    ce.set_risk_config(&RiskConfig { max_score: 49, default_score: 0 });
    ce.set_jurisdiction_risk_score(&String::from_str(&env, "KP"), &100u32);
    ce.set_jurisdiction_risk_score(&String::from_str(&env, "US"), &10u32);

    assert!(!ce.can_transfer(&alice, &bob, &100));
}

#[test]
fn test_high_risk_jurisdiction_blocks_recipient() {
    use crate::RiskConfig;
    let (env, ce, kyc, verifier, _admin) = setup_risk();
    let alice = Address::generate(&env); // US = 10
    let bob = Address::generate(&env);   // KP = 100 > max 49
    kyc.approve(&verifier, &alice, &0, &0, &String::from_str(&env, "US"));
    kyc.approve(&verifier, &bob, &0, &0, &String::from_str(&env, "KP"));

    ce.set_risk_config(&RiskConfig { max_score: 49, default_score: 0 });
    ce.set_jurisdiction_risk_score(&String::from_str(&env, "KP"), &100u32);
    ce.set_jurisdiction_risk_score(&String::from_str(&env, "US"), &10u32);

    assert!(!ce.can_transfer(&alice, &bob, &100));
}

#[test]
fn test_low_risk_jurisdictions_allowed() {
    use crate::RiskConfig;
    let (env, ce, kyc, verifier, _admin) = setup_risk();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    kyc.approve(&verifier, &alice, &0, &0, &String::from_str(&env, "US"));
    kyc.approve(&verifier, &bob, &0, &0, &String::from_str(&env, "DE"));

    ce.set_risk_config(&RiskConfig { max_score: 49, default_score: 0 });
    ce.set_jurisdiction_risk_score(&String::from_str(&env, "US"), &10u32);
    ce.set_jurisdiction_risk_score(&String::from_str(&env, "DE"), &5u32);

    assert!(ce.can_transfer(&alice, &bob, &100));
}

#[test]
fn test_default_score_applied_to_unknown_jurisdiction() {
    use crate::RiskConfig;
    let (env, ce, kyc, verifier, _admin) = setup_risk();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    // ZZ has no explicit score → default_score applies
    kyc.approve(&verifier, &alice, &0, &0, &String::from_str(&env, "ZZ"));
    kyc.approve(&verifier, &bob, &0, &0, &String::from_str(&env, "US"));

    // default_score = 75, max_score = 50 → ZZ exceeds limit → blocked
    ce.set_risk_config(&RiskConfig { max_score: 50, default_score: 75 });
    ce.set_jurisdiction_risk_score(&String::from_str(&env, "US"), &10u32);

    assert!(!ce.can_transfer(&alice, &bob, &100));
}

#[test]
fn test_default_score_zero_allows_unknown_jurisdiction() {
    use crate::RiskConfig;
    let (env, ce, kyc, verifier, _admin) = setup_risk();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    kyc.approve(&verifier, &alice, &0, &0, &String::from_str(&env, "ZZ")); // no explicit score
    kyc.approve(&verifier, &bob, &0, &0, &String::from_str(&env, "US"));

    // default_score = 0 → unknown jurisdictions are low-risk
    ce.set_risk_config(&RiskConfig { max_score: 50, default_score: 0 });

    assert!(ce.can_transfer(&alice, &bob, &100));
}

#[test]
fn test_score_at_exact_threshold_allowed() {
    use crate::RiskConfig;
    let (env, ce, kyc, verifier, _admin) = setup_risk();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    kyc.approve(&verifier, &alice, &0, &0, &String::from_str(&env, "US"));
    kyc.approve(&verifier, &bob, &0, &0, &String::from_str(&env, "DE"));

    ce.set_risk_config(&RiskConfig { max_score: 50, default_score: 0 });
    // Exactly at threshold: allowed (> max_score blocks, not >=)
    ce.set_jurisdiction_risk_score(&String::from_str(&env, "US"), &50u32);
    ce.set_jurisdiction_risk_score(&String::from_str(&env, "DE"), &50u32);

    assert!(ce.can_transfer(&alice, &bob, &100));
}

#[test]
fn test_score_one_above_threshold_blocked() {
    use crate::RiskConfig;
    let (env, ce, kyc, verifier, _admin) = setup_risk();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    kyc.approve(&verifier, &alice, &0, &0, &String::from_str(&env, "US"));
    kyc.approve(&verifier, &bob, &0, &0, &String::from_str(&env, "US"));

    ce.set_risk_config(&RiskConfig { max_score: 50, default_score: 0 });
    ce.set_jurisdiction_risk_score(&String::from_str(&env, "US"), &51u32); // one above

    assert!(!ce.can_transfer(&alice, &bob, &100));
}

#[test]
fn test_evaluate_transfer_risk_returns_scores_and_blocked() {
    use crate::RiskConfig;
    let (env, ce, _kyc, _verifier, _admin) = setup_risk();

    ce.set_risk_config(&RiskConfig { max_score: 49, default_score: 20 });
    ce.set_jurisdiction_risk_score(&String::from_str(&env, "KP"), &100u32);
    ce.set_jurisdiction_risk_score(&String::from_str(&env, "US"), &10u32);

    let (from_score, to_score, blocked) = ce.evaluate_transfer_risk(
        &String::from_str(&env, "KP"),
        &String::from_str(&env, "US"),
    );
    assert_eq!(from_score, 100);
    assert_eq!(to_score, 10);
    assert!(blocked);

    let (f2, t2, b2) = ce.evaluate_transfer_risk(
        &String::from_str(&env, "US"),
        &String::from_str(&env, "US"),
    );
    assert_eq!(f2, 10);
    assert_eq!(t2, 10);
    assert!(!b2);
}

#[test]
fn test_evaluate_transfer_risk_uses_default_for_unknown() {
    use crate::RiskConfig;
    let (env, ce, _kyc, _verifier, _admin) = setup_risk();

    ce.set_risk_config(&RiskConfig { max_score: 49, default_score: 60 });

    let (_f, _t, blocked) = ce.evaluate_transfer_risk(
        &String::from_str(&env, "ZZ"), // unknown → default 60 > max 49
        &String::from_str(&env, "US"),
    );
    assert!(blocked);
}

#[test]
fn test_evaluate_transfer_risk_inactive_when_max_score_zero() {
    use crate::RiskConfig;
    let (env, ce, _kyc, _verifier, _admin) = setup_risk();

    ce.set_risk_config(&RiskConfig { max_score: 0, default_score: 0 });
    ce.set_jurisdiction_risk_score(&String::from_str(&env, "KP"), &100u32);

    let (f, t, blocked) = ce.evaluate_transfer_risk(
        &String::from_str(&env, "KP"),
        &String::from_str(&env, "KP"),
    );
    assert_eq!(f, 0);
    assert_eq!(t, 0);
    assert!(!blocked);
}

#[test]
fn test_set_jurisdiction_risk_score_invalid_score_panics() {
    let (env, ce, _kyc, _verifier, _admin) = setup_risk();
    let res = ce.try_set_jurisdiction_risk_score(&String::from_str(&env, "US"), &101u32);
    assert!(res.is_err());
}

#[test]
fn test_set_jurisdiction_risk_score_invalid_jurisdiction_panics() {
    let (env, ce, _kyc, _verifier, _admin) = setup_risk();
    // Lowercase is invalid
    let res = ce.try_set_jurisdiction_risk_score(&String::from_str(&env, "us"), &50u32);
    assert!(res.is_err());
    // Too long
    let res2 = ce.try_set_jurisdiction_risk_score(&String::from_str(&env, "USA"), &50u32);
    assert!(res2.is_err());
}

#[test]
fn test_set_risk_config_invalid_max_score_panics() {
    use crate::RiskConfig;
    let (_env, ce, _kyc, _verifier, _admin) = setup_risk();
    let res = ce.try_set_risk_config(&RiskConfig { max_score: 101, default_score: 0 });
    assert!(res.is_err());
}

#[test]
fn test_set_risk_config_invalid_default_score_panics() {
    use crate::RiskConfig;
    let (_env, ce, _kyc, _verifier, _admin) = setup_risk();
    let res = ce.try_set_risk_config(&RiskConfig { max_score: 50, default_score: 101 });
    assert!(res.is_err());
}

#[test]
fn test_clear_jurisdiction_risk_score_reverts_to_default() {
    use crate::RiskConfig;
    let (env, ce, kyc, verifier, _admin) = setup_risk();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    kyc.approve(&verifier, &alice, &0, &0, &String::from_str(&env, "XX"));
    kyc.approve(&verifier, &bob, &0, &0, &String::from_str(&env, "US"));

    ce.set_risk_config(&RiskConfig { max_score: 49, default_score: 0 });
    ce.set_jurisdiction_risk_score(&String::from_str(&env, "XX"), &80u32); // high
    ce.set_jurisdiction_risk_score(&String::from_str(&env, "US"), &10u32);

    // Initially blocked
    assert!(!ce.can_transfer(&alice, &bob, &100));

    // Remove the explicit score → falls back to default_score = 0 → allowed
    ce.clear_jurisdiction_risk_score(&String::from_str(&env, "XX"));
    assert!(ce.can_transfer(&alice, &bob, &100));
    assert!(ce.get_jurisdiction_risk_score(&String::from_str(&env, "XX")).is_none());
}

#[test]
fn test_get_risk_config_round_trip() {
    use crate::RiskConfig;
    let (_env, ce, _kyc, _verifier, _admin) = setup_risk();

    ce.set_risk_config(&RiskConfig { max_score: 75, default_score: 30 });
    let cfg = ce.get_risk_config().expect("config must be set");
    assert_eq!(cfg.max_score, 75);
    assert_eq!(cfg.default_score, 30);
}

#[test]
fn test_risk_scoring_does_not_affect_paused_engine() {
    use crate::RiskConfig;
    let (env, ce, kyc, verifier, _admin) = setup_risk();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    kyc.approve(&verifier, &alice, &0, &0, &String::from_str(&env, "US"));
    kyc.approve(&verifier, &bob, &0, &0, &String::from_str(&env, "US"));

    ce.set_risk_config(&RiskConfig { max_score: 49, default_score: 0 });
    ce.set_jurisdiction_risk_score(&String::from_str(&env, "US"), &10u32);
    ce.pause();

    // Pause takes precedence; risk scores never evaluated
    assert!(!ce.can_transfer(&alice, &bob, &100));
}
