#![cfg(test)]

use crate::{ComplianceMetadata, RecipientEntry, RwaToken, RwaTokenClient};
use compliance_engine::{ComplianceEngine, ComplianceEngineClient};
use kyc_registry::{KycRegistry, KycRegistryClient};
use soroban_sdk::{testutils::{Address as _, Ledger as _}, vec, Address, Env, String};

/// Test harness for SEP-41 compliance tests
#[allow(dead_code)]
struct Sep41Harness {
    env: Env,
    token: RwaTokenClient<'static>,
    kyc: KycRegistryClient<'static>,
    compliance: ComplianceEngineClient<'static>,
    verifier: Address,
    admin: Address,
}

fn setup_sep41() -> Sep41Harness {
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

    // RWA token
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
        ),
    );
    let token = RwaTokenClient::new(&env, &token_id);

    Sep41Harness {
        env,
        token,
        kyc,
        compliance,
        verifier,
        admin,
    }
}

impl Sep41Harness {
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

// ── name ──────────────────────────────────────────────────────────────

#[test]
fn sep41_name() {
    let h = setup_sep41();
    assert_eq!(
        h.token.name(),
        String::from_str(&h.env, "Veritoken RWA")
    );
}

// ── symbol ────────────────────────────────────────────────────────────

#[test]
fn sep41_symbol() {
    let h = setup_sep41();
    assert_eq!(h.token.symbol(), String::from_str(&h.env, "VTRWA"));
}

// ── decimals ──────────────────────────────────────────────────────────

#[test]
fn sep41_decimals() {
    let h = setup_sep41();
    assert_eq!(h.token.decimals(), 7);
}

// ── total_supply ──────────────────────────────────────────────────────

#[test]
fn sep41_total_supply_initial() {
    let h = setup_sep41();
    assert_eq!(h.token.total_supply(), 0);
}

#[test]
fn sep41_total_supply_after_mint() {
    let h = setup_sep41();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);

    h.token.mint(&alice, &1_000);
    assert_eq!(h.token.total_supply(), 1_000);

    h.token.mint(&alice, &500);
    assert_eq!(h.token.total_supply(), 1_500);
}

#[test]
fn sep41_total_supply_after_transfer() {
    let h = setup_sep41();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);

    h.token.mint(&alice, &1_000);
    assert_eq!(h.token.total_supply(), 1_000);

    h.token.transfer(&alice, &bob, &600);
    assert_eq!(h.token.total_supply(), 1_000);
}

#[test]
fn sep41_total_supply_after_burn() {
    let h = setup_sep41();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);

    h.token.mint(&alice, &1_000);
    assert_eq!(h.token.total_supply(), 1_000);

    h.token.burn(&alice, &300);
    assert_eq!(h.token.total_supply(), 700);
}

// ── balance ────────────────────────────────────────────────────────────

#[test]
fn sep41_balance_of_nonexistent_account() {
    let h = setup_sep41();
    let unknown = Address::generate(&h.env);
    assert_eq!(h.token.balance(&unknown), 0);
}

#[test]
fn sep41_balance_after_mint() {
    let h = setup_sep41();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);

    h.token.mint(&alice, &1_000);
    assert_eq!(h.token.balance(&alice), 1_000);
}

#[test]
fn sep41_balance_after_transfer() {
    let h = setup_sep41();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);

    h.token.mint(&alice, &1_000);
    h.token.transfer(&alice, &bob, &400);

    assert_eq!(h.token.balance(&alice), 600);
    assert_eq!(h.token.balance(&bob), 400);
}

// ── transfer ──────────────────────────────────────────────────────────

#[test]
fn sep41_transfer_happy_path() {
    let h = setup_sep41();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);

    h.token.mint(&alice, &1_000);
    h.token.transfer(&alice, &bob, &350);

    assert_eq!(h.token.balance(&alice), 650);
    assert_eq!(h.token.balance(&bob), 350);
}

#[test]
fn sep41_transfer_insufficient_balance() {
    let h = setup_sep41();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);

    h.token.mint(&alice, &500);
    let res = h.token.try_transfer(&alice, &bob, &600);
    assert!(res.is_err());
}

#[test]
fn sep41_transfer_zero_amount() {
    let h = setup_sep41();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);

    h.token.mint(&alice, &1_000);
    let res = h.token.try_transfer(&alice, &bob, &0);
    assert!(res.is_err());
}

#[test]
fn sep41_transfer_requires_kyc_sender() {
    let h = setup_sep41();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &1_000);

    let res = h.token.try_transfer(&alice, &bob, &100);
    assert!(res.is_err());
}

#[test]
fn sep41_transfer_requires_kyc_receiver() {
    let h = setup_sep41();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.token.mint(&alice, &1_000);

    let res = h.token.try_transfer(&alice, &bob, &100);
    assert!(res.is_err());
}

// ── transfer_from ─────────────────────────────────────────────────────

#[test]
fn sep41_transfer_from_with_valid_allowance() {
    let h = setup_sep41();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    let spender = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);

    h.token.mint(&alice, &1_000);
    let expiration = h.env.ledger().sequence() + 1_000;
    h.token.approve(&alice, &spender, &400, &expiration);
    h.token.transfer_from(&spender, &alice, &bob, &250);

    assert_eq!(h.token.balance(&alice), 750);
    assert_eq!(h.token.balance(&bob), 250);
}

#[test]
fn sep41_transfer_from_with_expired_allowance() {
    let h = setup_sep41();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    let spender = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);

    h.token.mint(&alice, &1_000);
    let expiration = h.env.ledger().sequence() + 10;
    h.token.approve(&alice, &spender, &400, &expiration);

    // Advance ledger past expiration
    h.env.ledger().set_sequence_number(expiration + 1);

    let res = h.token.try_transfer_from(&spender, &alice, &bob, &100);
    assert!(res.is_err());
}

#[test]
fn sep41_transfer_from_insufficient_allowance() {
    let h = setup_sep41();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    let spender = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);

    h.token.mint(&alice, &1_000);
    let expiration = h.env.ledger().sequence() + 1_000;
    h.token.approve(&alice, &spender, &200, &expiration);

    let res = h.token.try_transfer_from(&spender, &alice, &bob, &300);
    assert!(res.is_err());
}

// ── approve ───────────────────────────────────────────────────────────

#[test]
fn sep41_approve_new() {
    let h = setup_sep41();
    let alice = Address::generate(&h.env);
    let spender = Address::generate(&h.env);

    let expiration = h.env.ledger().sequence() + 500;
    h.token.approve(&alice, &spender, &1_000, &expiration);
    assert_eq!(h.token.allowance(&alice, &spender), 1_000);
}

#[test]
fn sep41_approve_update() {
    let h = setup_sep41();
    let alice = Address::generate(&h.env);
    let spender = Address::generate(&h.env);

    let expiration = h.env.ledger().sequence() + 500;
    h.token.approve(&alice, &spender, &1_000, &expiration);
    assert_eq!(h.token.allowance(&alice, &spender), 1_000);

    h.token.approve(&alice, &spender, &2_000, &expiration);
    assert_eq!(h.token.allowance(&alice, &spender), 2_000);
}

#[test]
fn sep41_approve_revoke_with_zero() {
    let h = setup_sep41();
    let alice = Address::generate(&h.env);
    let spender = Address::generate(&h.env);

    let expiration = h.env.ledger().sequence() + 500;
    h.token.approve(&alice, &spender, &1_000, &expiration);
    assert_eq!(h.token.allowance(&alice, &spender), 1_000);

    h.token.approve(&alice, &spender, &0, &expiration);
    assert_eq!(h.token.allowance(&alice, &spender), 0);
}

// ── allowance ─────────────────────────────────────────────────────────

#[test]
fn sep41_allowance_active() {
    let h = setup_sep41();
    let alice = Address::generate(&h.env);
    let spender = Address::generate(&h.env);

    let expiration = h.env.ledger().sequence() + 1_000;
    h.token.approve(&alice, &spender, &500, &expiration);
    assert_eq!(h.token.allowance(&alice, &spender), 500);
}

#[test]
fn sep41_allowance_expired() {
    let h = setup_sep41();
    let alice = Address::generate(&h.env);
    let spender = Address::generate(&h.env);

    let expiration = h.env.ledger().sequence() + 50;
    h.token.approve(&alice, &spender, &500, &expiration);
    assert_eq!(h.token.allowance(&alice, &spender), 500);

    h.env.ledger().set_sequence_number(expiration + 1);
    assert_eq!(h.token.allowance(&alice, &spender), 0);
}

#[test]
fn sep41_allowance_nonexistent() {
    let h = setup_sep41();
    let alice = Address::generate(&h.env);
    let spender = Address::generate(&h.env);

    assert_eq!(h.token.allowance(&alice, &spender), 0);
}

// ── burn ──────────────────────────────────────────────────────────────

#[test]
fn sep41_burn() {
    let h = setup_sep41();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);

    h.token.mint(&alice, &1_000);
    assert_eq!(h.token.total_supply(), 1_000);

    h.token.burn(&alice, &250);
    assert_eq!(h.token.balance(&alice), 750);
    assert_eq!(h.token.total_supply(), 750);
}

#[test]
fn sep41_burn_insufficient_balance() {
    let h = setup_sep41();
    let alice = Address::generate(&h.env);
    h.approve_kyc(&alice);

    h.token.mint(&alice, &500);
    let res = h.token.try_burn(&alice, &600);
    assert!(res.is_err());
}

// ── burn_from ─────────────────────────────────────────────────────────

#[test]
fn sep41_burn_from_with_allowance() {
    let h = setup_sep41();
    let alice = Address::generate(&h.env);
    let spender = Address::generate(&h.env);
    h.approve_kyc(&alice);

    h.token.mint(&alice, &1_000);
    let expiration = h.env.ledger().sequence() + 1_000;
    h.token.approve(&alice, &spender, &400, &expiration);
    h.token.burn_from(&spender, &alice, &150);

    assert_eq!(h.token.balance(&alice), 850);
    assert_eq!(h.token.total_supply(), 850);
    assert_eq!(h.token.allowance(&alice, &spender), 250);
}

#[test]
fn sep41_burn_from_insufficient_allowance() {
    let h = setup_sep41();
    let alice = Address::generate(&h.env);
    let spender = Address::generate(&h.env);
    h.approve_kyc(&alice);

    h.token.mint(&alice, &1_000);
    let expiration = h.env.ledger().sequence() + 1_000;
    h.token.approve(&alice, &spender, &100, &expiration);

    let res = h.token.try_burn_from(&spender, &alice, &150);
    assert!(res.is_err());
}

// ── batch_transfer invariants ─────────────────────────────────────────────────

#[test]
fn sep41_batch_total_supply_unchanged_after_failure() {
    // A failed batch must leave total supply identical to its pre-call value.
    let h = setup_sep41();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    let carol = Address::generate(&h.env); // no KYC → batch fails
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);

    h.token.mint(&alice, &1_000);
    assert_eq!(h.token.total_supply(), 1_000);

    let recipients = vec![
        &h.env,
        RecipientEntry { to: bob.clone(), amount: 300 },
        RecipientEntry { to: carol.clone(), amount: 200 },
    ];
    assert!(h.token.try_batch_transfer(&alice, &recipients).is_err());

    // Batch transfer does not change total supply; only mint/burn do.
    assert_eq!(h.token.total_supply(), 1_000);
}

#[test]
fn sep41_batch_balances_unchanged_after_failure() {
    let h = setup_sep41();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    let carol = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);
    h.approve_kyc(&carol);

    h.token.mint(&alice, &300); // not enough for 200 + 200 = 400
    assert_eq!(h.token.balance(&alice), 300);

    let recipients = vec![
        &h.env,
        RecipientEntry { to: bob.clone(), amount: 200 },
        RecipientEntry { to: carol.clone(), amount: 200 },
    ];
    assert!(h.token.try_batch_transfer(&alice, &recipients).is_err());

    // All three balances must be untouched after the failed batch.
    assert_eq!(h.token.balance(&alice), 300);
    assert_eq!(h.token.balance(&bob), 0);
    assert_eq!(h.token.balance(&carol), 0);
}

#[test]
fn sep41_batch_balances_correct_after_success() {
    let h = setup_sep41();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    let carol = Address::generate(&h.env);
    let dave = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);
    h.approve_kyc(&carol);
    h.approve_kyc(&dave);

    h.token.mint(&alice, &1_000);

    let recipients = vec![
        &h.env,
        RecipientEntry { to: bob.clone(), amount: 100 },
        RecipientEntry { to: carol.clone(), amount: 250 },
        RecipientEntry { to: dave.clone(), amount: 350 },
    ];
    h.token.batch_transfer(&alice, &recipients);

    assert_eq!(h.token.balance(&alice), 300);
    assert_eq!(h.token.balance(&bob), 100);
    assert_eq!(h.token.balance(&carol), 250);
    assert_eq!(h.token.balance(&dave), 350);
    // Transfer does not affect total supply
    assert_eq!(h.token.total_supply(), 1_000);
}

#[test]
fn sep41_batch_from_total_supply_unchanged_after_failure() {
    let h = setup_sep41();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    let spender = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);

    h.token.mint(&alice, &1_000);
    let expiration = h.env.ledger().sequence() + 1_000;
    h.token.approve(&alice, &spender, &50, &expiration); // only 50 approved

    let recipients = vec![
        &h.env,
        RecipientEntry { to: bob.clone(), amount: 100 }, // exceeds allowance
    ];
    assert!(h.token.try_batch_transfer_from(&spender, &alice, &recipients).is_err());

    assert_eq!(h.token.total_supply(), 1_000);
    assert_eq!(h.token.balance(&alice), 1_000);
    assert_eq!(h.token.balance(&bob), 0);
    assert_eq!(h.token.allowance(&alice, &spender), 50); // unchanged
}

#[test]
fn sep41_batch_from_balances_correct_after_success() {
    let h = setup_sep41();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    let carol = Address::generate(&h.env);
    let spender = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);
    h.approve_kyc(&carol);

    h.token.mint(&alice, &1_000);
    let expiration = h.env.ledger().sequence() + 1_000;
    h.token.approve(&alice, &spender, &700, &expiration);

    let recipients = vec![
        &h.env,
        RecipientEntry { to: bob.clone(), amount: 400 },
        RecipientEntry { to: carol.clone(), amount: 300 },
    ];
    h.token.batch_transfer_from(&spender, &alice, &recipients);

    assert_eq!(h.token.balance(&alice), 300);
    assert_eq!(h.token.balance(&bob), 400);
    assert_eq!(h.token.balance(&carol), 300);
    assert_eq!(h.token.allowance(&alice, &spender), 0);
    assert_eq!(h.token.total_supply(), 1_000);
}

#[test]
fn sep41_batch_failure_in_middle_of_list_leaves_no_partial_state() {
    // Recipient 2 of 3 is not KYC-approved.
    // No recipient should receive any tokens.
    let h = setup_sep41();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    let eve = Address::generate(&h.env); // no KYC — sits in the middle
    let carol = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);
    h.approve_kyc(&carol);

    h.token.mint(&alice, &1_000);

    let recipients = vec![
        &h.env,
        RecipientEntry { to: bob.clone(), amount: 200 },
        RecipientEntry { to: eve.clone(), amount: 100 },   // fails validation
        RecipientEntry { to: carol.clone(), amount: 300 },
    ];
    assert!(h.token.try_batch_transfer(&alice, &recipients).is_err());

    assert_eq!(h.token.balance(&alice), 1_000);
    assert_eq!(h.token.balance(&bob), 0);
    assert_eq!(h.token.balance(&eve), 0);
    assert_eq!(h.token.balance(&carol), 0);
}

#[test]
fn sep41_single_and_batch_transfer_enforce_same_freeze_check() {
    // Both `transfer` and `batch_transfer` should reject a frozen sender.
    let h = setup_sep41();
    let alice = Address::generate(&h.env);
    let bob = Address::generate(&h.env);
    h.approve_kyc(&alice);
    h.approve_kyc(&bob);
    h.token.mint(&alice, &500);

    // Freeze alice
    let admin = h.admin.clone();
    let _ = admin;
    h.token.freeze(&alice);

    assert!(h.token.try_transfer(&alice, &bob, &100).is_err());

    let recipients = vec![
        &h.env,
        RecipientEntry { to: bob.clone(), amount: 100 },
    ];
    assert!(h.token.try_batch_transfer(&alice, &recipients).is_err());

    // After unfreezing, both paths work
    h.token.unfreeze(&alice);
    h.token.transfer(&alice, &bob, &100);
    assert_eq!(h.token.balance(&bob), 100);
}
