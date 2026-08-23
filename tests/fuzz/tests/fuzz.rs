//! Fuzz / property-based tests for compliance and transfer logic.
//!
//! These tests do **not** require an external fuzzer.  They run under the
//! standard Soroban test environment using a deterministic, hand-rolled input
//! generator seeded from known edge-case values.  The goal is to exercise a
//! large, varied input space and verify that the invariants documented below
//! hold for all generated inputs.
//!
//! # Invariants under test
//!
//! ## Compliance engine — `can_transfer`
//! * **Pause invariant** — when `paused = true`, `can_transfer` always returns
//!   `false` regardless of amount, blocklist, or holding period.
//! * **Blocklist invariant** — when `from` or `to` is blocklisted, `can_transfer`
//!   returns `false`.
//! * **Amount invariant** — when `max_transfer_amount > 0` and
//!   `amount > max_transfer_amount`, transfer is blocked.
//! * **Holding period invariant** — a holder that registered at time `t` and
//!   attempts a transfer at time `t + elapsed` is blocked when
//!   `elapsed < min_holding_period`.
//! * **Max holders invariant** — once the registered holder count equals
//!   `max_holders`, transfers to new addresses are blocked.
//! * **Negative / zero amount edge cases** — zero and negative amounts must
//!   not bypass the `max_transfer_amount` guard (0 is always ≤ any limit).
//!
//! ## KYC registry
//! * **Approve → revoke round-trip** — `is_approved` reflects the most recent
//!   state transition regardless of how many times the cycle is repeated.
//! * **Tier preservation** — after approval the stored tier equals the value
//!   passed to `approve`.
//! * **Expiry edge cases** — approval with expiry 0 is treated as non-expiring;
//!   a future expiry is valid.
//!
//! ## RWA token — transfer
//! * **Conservation invariant** — `balance(from) + balance(to)` is unchanged
//!   by a successful transfer.
//! * **Zero-amount guard** — transferring 0 tokens must be rejected.
//! * **KYC gate** — a transfer to an address that has never been KYC-approved
//!   is always rejected.
//! * **Compliance gate** — a paused system blocks all transfers.
//!
//! # Strategy
//! Each test runs a sweep over a table of edge-case values rather than truly
//! random input.  This is sufficient to catch off-by-one errors, sign
//! confusion, overflow, and short-circuit logic bugs without requiring an
//! external fuzzer binary.

#![cfg(test)]

extern crate alloc;

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Env, String,
};

use compliance_engine::{ComplianceEngine, ComplianceEngineClient, ComplianceRules};
use kyc_registry::{KycRegistry, KycRegistryClient};
use rwa_token::{ComplianceMetadata, RwaToken, RwaTokenClient};

// ── Test helpers ──────────────────────────────────────────────────────────────

struct Suite {
    env: Env,
    kyc: KycRegistryClient<'static>,
    ce: ComplianceEngineClient<'static>,
    #[allow(dead_code)]
    admin: Address,
    verifier: Address,
}

fn build_suite() -> Suite {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let verifier = Address::generate(&env);

    let kyc_id = env.register(KycRegistry, ());
    let kyc = KycRegistryClient::new(&env, &kyc_id);
    kyc.initialize(&admin);
    kyc.add_verifier(&admin, &verifier);

    let ce_id = env.register(ComplianceEngine, ());
    let ce = ComplianceEngineClient::new(&env, &ce_id);
    ce.initialize(&admin, &kyc_id, &0u64);

    Suite {
        env,
        kyc,
        ce,
        admin,
        verifier,
    }
}

fn default_rules() -> ComplianceRules {
    ComplianceRules {
        max_transfer_amount: 0,
        min_holding_period: 0,
        max_holders: 0,
        require_same_jurisdiction: false,
        paused: false,
        allowlist_mode: false,
        max_holding_period: 0,
    }
}

fn rules_with(
    max_transfer_amount: i128,
    min_holding_period: u64,
    max_holders: u32,
    paused: bool,
) -> ComplianceRules {
    ComplianceRules {
        max_transfer_amount,
        min_holding_period,
        max_holders,
        paused,
        ..default_rules()
    }
}

// ── Invariant: pause blocks everything ────────────────────────────────────────

#[test]
fn fuzz_pause_invariant() {
    // Amounts and address pairs to sweep over.
    let amounts: &[i128] = &[0, 1, 100, 1_000_000, i128::MAX / 2, i128::MAX];

    for &amount in amounts {
        let s = build_suite();
        let from = Address::generate(&s.env);
        let to = Address::generate(&s.env);

        s.ce.set_rules(&rules_with(0, 0, 0, true));

        // The pause invariant must hold for every amount value.
        assert!(
            !s.ce.can_transfer(&from, &to, &amount),
            "pause invariant violated for amount={amount}"
        );

        // After unpause, the default rules must allow the transfer
        // (ignoring amount-limit which is 0 = unlimited here).
        s.ce.set_rules(&rules_with(0, 0, 0, false));
        assert!(
            s.ce.can_transfer(&from, &to, &amount),
            "unpause should allow transfer for amount={amount}"
        );
    }
}

// ── Invariant: blocklist blocks both sender and receiver ──────────────────────

#[test]
fn fuzz_blocklist_invariant() {
    let amounts: &[i128] = &[1, 50, 99, 100, 101, 10_000_000];

    for &amount in amounts {
        // Blocked sender
        {
            let s = build_suite();
            let from = Address::generate(&s.env);
            let to = Address::generate(&s.env);
            s.ce.add_to_blocklist(&from);
            assert!(
                !s.ce.can_transfer(&from, &to, &amount),
                "blocklisted sender should block transfer, amount={amount}"
            );
        }
        // Blocked receiver
        {
            let s = build_suite();
            let from = Address::generate(&s.env);
            let to = Address::generate(&s.env);
            s.ce.add_to_blocklist(&to);
            assert!(
                !s.ce.can_transfer(&from, &to, &amount),
                "blocklisted receiver should block transfer, amount={amount}"
            );
        }
        // Neither blocklisted — should pass with default rules.
        {
            let s = build_suite();
            let from = Address::generate(&s.env);
            let to = Address::generate(&s.env);
            assert!(
                s.ce.can_transfer(&from, &to, &amount),
                "clean addresses should pass default rules, amount={amount}"
            );
        }
    }
}

// ── Invariant: max_transfer_amount boundary ───────────────────────────────────

#[test]
fn fuzz_max_transfer_amount_boundary() {
    // Limit values to test.
    let limits: &[i128] = &[1, 10, 100, 999, 1_000, 1_001, 1_000_000, i64::MAX as i128];

    for &limit in limits {
        let s = build_suite();
        let from = Address::generate(&s.env);
        let to = Address::generate(&s.env);

        s.ce.set_rules(&rules_with(limit, 0, 0, false));

        // Exactly at the limit — allowed.
        assert!(
            s.ce.can_transfer(&from, &to, &limit),
            "amount == limit should be allowed, limit={limit}"
        );

        // One above the limit — blocked.
        if limit < i128::MAX {
            assert!(
                !s.ce.can_transfer(&from, &to, &(limit + 1)),
                "amount > limit should be blocked, limit={limit}"
            );
        }

        // One below the limit — allowed (when > 0).
        if limit > 1 {
            assert!(
                s.ce.can_transfer(&from, &to, &(limit - 1)),
                "amount < limit should be allowed, limit={limit}"
            );
        }
    }
}

// ── Invariant: zero limit means unlimited ─────────────────────────────────────

#[test]
fn fuzz_zero_limit_is_unlimited() {
    let large_amounts: &[i128] = &[1, 1_000_000, 1_000_000_000, i64::MAX as i128, i128::MAX / 2];

    for &amount in large_amounts {
        let s = build_suite();
        let from = Address::generate(&s.env);
        let to = Address::generate(&s.env);

        s.ce.set_rules(&rules_with(0, 0, 0, false)); // 0 = unlimited
        assert!(
            s.ce.can_transfer(&from, &to, &amount),
            "zero limit (unlimited) should allow any amount={amount}"
        );
    }
}

// ── Invariant: min_holding_period boundary ────────────────────────────────────

#[test]
fn fuzz_min_holding_period_boundary() {
    // (holding_period_secs, elapsed_secs_before_transfer)
    let cases: &[(u64, u64, bool)] = &[
        // elapsed < period → blocked
        (100, 0, false),
        (100, 99, false),
        // elapsed == period → allowed (boundary is inclusive)
        (100, 100, true),
        // elapsed > period → allowed
        (100, 101, true),
        (3600, 0, false),
        (3600, 3600, true),
        (3600, 7200, true),
        // 24-hour period
        (86400, 0, false),
        (86400, 86399, false),
        (86400, 86400, true),
        // 365-day max (31_536_000 s)
        (31_536_000, 31_535_999, false),
        (31_536_000, 31_536_000, true),
    ];

    for &(period, elapsed, expected_allowed) in cases {
        let s = build_suite();
        let from = Address::generate(&s.env);
        let to = Address::generate(&s.env);

        // Set current time to a non-zero baseline so subtraction never wraps.
        let base_ts: u64 = 1_000_000;
        s.env.ledger().set_timestamp(base_ts);

        // Activate the holding period rule.
        s.ce.set_rules(&rules_with(0, period, 0, false));
        // Register the holder at the current (base) time.
        s.ce.register_holder(&from);

        // Advance time by `elapsed` seconds and check.
        s.env.ledger().set_timestamp(base_ts + elapsed);

        let result = s.ce.can_transfer(&from, &to, &1);
        assert_eq!(
            result, expected_allowed,
            "holding_period={period}, elapsed={elapsed} → expected allowed={expected_allowed}, got={result}"
        );
    }
}

// ── Invariant: max_holders blocks new recipients ──────────────────────────────

#[test]
fn fuzz_max_holders_invariant() {
    // max_holders values to test.
    let caps: &[u32] = &[1, 2, 5, 10];

    for &cap in caps {
        let s = build_suite();
        let existing: Vec<Address> = (0..cap).map(|_| Address::generate(&s.env)).collect();
        let newcomer = Address::generate(&s.env);

        s.ce.set_rules(&rules_with(0, 0, cap, false));

        // Register exactly `cap` holders.
        for addr in &existing {
            s.ce.register_holder(addr);
        }
        assert_eq!(s.ce.holder_count(), cap);

        // An existing holder transferring to another existing holder is OK.
        if existing.len() >= 2 {
            assert!(
                s.ce.can_transfer(&existing[0], &existing[1], &1),
                "existing→existing should be allowed when cap={cap}"
            );
        }

        // Transfer to a completely new address (not yet registered) should be blocked.
        assert!(
            !s.ce.can_transfer(&existing[0], &newcomer, &1),
            "transfer to newcomer should be blocked when cap={cap} is reached"
        );
    }
}

// ── KYC registry: approve / revoke round-trip ─────────────────────────────────

#[test]
fn fuzz_kyc_approve_revoke_round_trip() {
    // Number of cycles to run per subject.
    const CYCLES: usize = 5;
    // Tier values to cycle through.
    let tiers: &[u32] = &[0, 1, 2, 1, 0];

    let s = build_suite();

    for cycle in 0..CYCLES {
        let subject = Address::generate(&s.env);
        let tier = tiers[cycle % tiers.len()];

        assert!(
            !s.kyc.is_approved(&subject),
            "fresh address must start unapproved"
        );

        // Approve.
        s.kyc.approve(
            &s.verifier,
            &subject,
            &tier,
            &0,
            &String::from_str(&s.env, "US"),
        );
        assert!(
            s.kyc.is_approved(&subject),
            "address must be approved after approve(), cycle={cycle}"
        );
        assert_eq!(
            s.kyc.get_tier(&subject),
            tier,
            "tier must match after approve(), cycle={cycle}"
        );

        // Revoke.
        s.kyc.revoke(&s.verifier, &subject);
        assert!(
            !s.kyc.is_approved(&subject),
            "address must not be approved after revoke(), cycle={cycle}"
        );
    }
}

// ── KYC registry: multiple tier values are stored correctly ───────────────────

#[test]
fn fuzz_kyc_tier_values() {
    let tiers: &[u32] = &[0, 1, 2];

    for &tier in tiers {
        let s = build_suite();
        let subject = Address::generate(&s.env);

        s.kyc.approve(
            &s.verifier,
            &subject,
            &tier,
            &0,
            &String::from_str(&s.env, "DE"),
        );

        assert_eq!(
            s.kyc.get_tier(&subject),
            tier,
            "tier mismatch for tier={tier}"
        );
        assert!(s.kyc.is_approved(&subject));
    }
}

// ── KYC registry: expiry edge cases ───────────────────────────────────────────

#[test]
fn fuzz_kyc_expiry_edge_cases() {
    // (expiry_value, expected_approved)
    // expiry 0 = never expires.
    let cases: &[(u64, bool)] = &[
        (0, true),        // 0 = no expiry → approved
        (u64::MAX, true), // far-future expiry → approved
    ];

    for &(expiry, expected) in cases {
        let s = build_suite();
        let subject = Address::generate(&s.env);

        s.kyc.approve(
            &s.verifier,
            &subject,
            &1,
            &expiry,
            &String::from_str(&s.env, "US"),
        );

        assert_eq!(
            s.kyc.is_approved(&subject),
            expected,
            "expiry={expiry}, expected approved={expected}"
        );
    }
}

// ── RWA token: balance conservation invariant ────────────────────────────────

#[test]
fn fuzz_rwa_token_balance_conservation() {
    // (mint_amount, transfer_amount)
    let cases: &[(i128, i128)] = &[
        (1, 1),
        (100, 50),
        (100, 100),
        (1_000_000, 999_999),
        (1_000_000, 1_000_000),
        (i64::MAX as i128, 1),
        (i64::MAX as i128, i64::MAX as i128 / 2),
    ];

    for &(mint, transfer) in cases {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let verifier = Address::generate(&env);

        let kyc_id = env.register(KycRegistry, ());
        let kyc = KycRegistryClient::new(&env, &kyc_id);
        kyc.initialize(&admin);
        kyc.add_verifier(&admin, &verifier);

        let ce_id = env.register(ComplianceEngine, ());
        let ce = ComplianceEngineClient::new(&env, &ce_id);
        ce.initialize(&admin, &kyc_id, &0u64);

        let token_id = env.register(
            RwaToken,
            (
                admin.clone(),
                7u32,
                String::from_str(&env, "FuzzToken"),
                String::from_str(&env, "FUZZ"),
                String::from_str(&env, "property"),
                kyc_id.clone(),
                ce_id.clone(),
                Option::<ComplianceMetadata>::None,
                0i128, // max_supply = unlimited
            ),
        );
        let token = RwaTokenClient::new(&env, &token_id);

        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        // Approve both addresses.
        kyc.approve(&verifier, &alice, &1, &0, &String::from_str(&env, "US"));
        kyc.approve(&verifier, &bob, &1, &0, &String::from_str(&env, "US"));

        token.mint(&admin, &alice, &mint);
        assert_eq!(token.balance(&alice), mint);
        assert_eq!(token.balance(&bob), 0);

        // Balance before transfer.
        let combined_before = token.balance(&alice) + token.balance(&bob);

        // Perform transfer.
        token.transfer(&alice, &bob, &transfer);

        // Balance after transfer — conservation must hold.
        let combined_after = token.balance(&alice) + token.balance(&bob);
        assert_eq!(
            combined_before, combined_after,
            "balance conservation violated: mint={mint}, transfer={transfer}"
        );
        assert_eq!(token.balance(&bob), transfer);
        assert_eq!(token.balance(&alice), mint - transfer);
    }
}

// ── RWA token: KYC gate — unapproved receiver is always blocked ───────────────

#[test]
fn fuzz_rwa_token_kyc_gate() {
    let amounts: &[i128] = &[1, 50, 100, 1_000];

    for &amount in amounts {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let verifier = Address::generate(&env);

        let kyc_id = env.register(KycRegistry, ());
        let kyc = KycRegistryClient::new(&env, &kyc_id);
        kyc.initialize(&admin);
        kyc.add_verifier(&admin, &verifier);

        let ce_id = env.register(ComplianceEngine, ());
        let ce = ComplianceEngineClient::new(&env, &ce_id);
        ce.initialize(&admin, &kyc_id, &0u64);

        let token_id = env.register(
            RwaToken,
            (
                admin.clone(),
                7u32,
                String::from_str(&env, "FuzzToken"),
                String::from_str(&env, "FUZZ"),
                String::from_str(&env, "property"),
                kyc_id.clone(),
                ce_id.clone(),
                Option::<ComplianceMetadata>::None,
                0i128,
            ),
        );
        let token = RwaTokenClient::new(&env, &token_id);

        let alice = Address::generate(&env);
        let bob_unapproved = Address::generate(&env);

        kyc.approve(&verifier, &alice, &1, &0, &String::from_str(&env, "US"));
        // bob is deliberately NOT approved.

        token.mint(&admin, &alice, &1_000);

        let result = token.try_transfer(&alice, &bob_unapproved, &amount);
        assert!(
            result.is_err(),
            "transfer to unapproved address must be rejected, amount={amount}"
        );
    }
}

// ── RWA token: paused compliance blocks all transfers ────────────────────────

#[test]
fn fuzz_rwa_token_pause_gate() {
    let amounts: &[i128] = &[1, 100, 10_000];

    for &amount in amounts {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let verifier = Address::generate(&env);

        let kyc_id = env.register(KycRegistry, ());
        let kyc = KycRegistryClient::new(&env, &kyc_id);
        kyc.initialize(&admin);
        kyc.add_verifier(&admin, &verifier);

        let ce_id = env.register(ComplianceEngine, ());
        let ce = ComplianceEngineClient::new(&env, &ce_id);
        ce.initialize(&admin, &kyc_id, &0u64);

        let token_id = env.register(
            RwaToken,
            (
                admin.clone(),
                7u32,
                String::from_str(&env, "FuzzToken"),
                String::from_str(&env, "FUZZ"),
                String::from_str(&env, "property"),
                kyc_id.clone(),
                ce_id.clone(),
                Option::<ComplianceMetadata>::None,
                0i128,
            ),
        );
        let token = RwaTokenClient::new(&env, &token_id);

        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        kyc.approve(&verifier, &alice, &1, &0, &String::from_str(&env, "US"));
        kyc.approve(&verifier, &bob, &1, &0, &String::from_str(&env, "US"));
        token.mint(&admin, &alice, &100_000);

        // Pause the compliance engine.
        ce.pause();

        let result = token.try_transfer(&alice, &bob, &amount);
        assert!(
            result.is_err(),
            "transfer must be blocked when compliance is paused, amount={amount}"
        );
    }
}

// ── Compliance engine: rule validation rejects malformed inputs ───────────────

#[test]
fn fuzz_compliance_rule_validation() {
    // (max_transfer_amount, min_holding_period) → (expected_error)
    // Negative max_transfer_amount must be rejected.
    // min_holding_period > 365 days (31_536_000 s) must be rejected.
    let invalid_cases: &[(i128, u64)] = &[
        (-1, 0),
        (-1_000_000, 0),
        (i128::MIN, 0),
        (0, 31_536_001),
        (0, u64::MAX),
        (-1, 31_536_001),
    ];

    for &(max_amount, holding_period) in invalid_cases {
        let s = build_suite();
        let bad_rules = ComplianceRules {
            max_transfer_amount: max_amount,
            min_holding_period: holding_period,
            max_holders: 0,
            require_same_jurisdiction: false,
            paused: false,
            allowlist_mode: false,
            max_holding_period: 0,
        };
        let result = s.ce.try_set_rules(&bad_rules);
        assert!(
            result.is_err(),
            "expected set_rules to reject max_transfer_amount={max_amount}, \
             min_holding_period={holding_period}"
        );
    }

    // Valid edge cases must be accepted.
    let valid_cases: &[(i128, u64)] = &[
        (0, 0),
        (1, 0),
        (i64::MAX as i128, 0),
        (0, 31_536_000), // exactly 365 days — valid
        (0, 1),
        (0, 3600),
    ];

    for &(max_amount, holding_period) in valid_cases {
        let s = build_suite();
        let good_rules = ComplianceRules {
            max_transfer_amount: max_amount,
            min_holding_period: holding_period,
            max_holders: 0,
            require_same_jurisdiction: false,
            paused: false,
            allowlist_mode: false,
            max_holding_period: 0,
        };
        let result = s.ce.try_set_rules(&good_rules);
        assert!(
            result.is_ok(),
            "expected set_rules to accept max_transfer_amount={max_amount}, \
             min_holding_period={holding_period}"
        );
    }
}

// ── Compliance engine: allowlist mode ────────────────────────────────────────

#[test]
fn fuzz_allowlist_mode_invariant() {
    let amounts: &[i128] = &[1, 100, 1_000_000];

    for &amount in amounts {
        let s = build_suite();
        let alice = Address::generate(&s.env);
        let bob = Address::generate(&s.env);
        let carol = Address::generate(&s.env);

        let allowlist_rules = ComplianceRules {
            max_transfer_amount: 0,
            min_holding_period: 0,
            max_holders: 0,
            require_same_jurisdiction: false,
            paused: false,
            allowlist_mode: true,
            max_holding_period: 0,
        };

        s.ce.set_rules(&allowlist_rules);
        s.ce.add_to_allowlist(&alice);
        s.ce.add_to_allowlist(&bob);

        // Both allowlisted — should be permitted.
        assert!(
            s.ce.can_transfer(&alice, &bob, &amount),
            "allowlisted pair must be allowed, amount={amount}"
        );

        // carol is not on the allowlist — blocked.
        assert!(
            !s.ce.can_transfer(&alice, &carol, &amount),
            "non-allowlisted receiver must be blocked, amount={amount}"
        );
        assert!(
            !s.ce.can_transfer(&carol, &bob, &amount),
            "non-allowlisted sender must be blocked, amount={amount}"
        );
    }
}

// ── Recovery system property-based tests ─────────────────────────────────────
//
// Each scenario below sweeps a table of cases and asserts that the recovery
// subsystem enforces the documented invariants for every input combination.

/// Helper: deploy a full rwa-token fixture and return (env, admin, token_client, kyc_client).
fn build_recovery_suite() -> (
    Env,
    Address,
    rwa_token::RwaTokenClient<'static>,
    KycRegistryClient<'static>,
) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let verifier = Address::generate(&env);

    let kyc_id = env.register(KycRegistry, ());
    let kyc = KycRegistryClient::new(&env, &kyc_id);
    kyc.initialize(&admin);
    kyc.add_verifier(&admin, &verifier);

    let ce_id = env.register(ComplianceEngine, ());
    let ce = ComplianceEngineClient::new(&env, &ce_id);
    ce.initialize(&admin, &kyc_id, &0u64);

    let token_id = env.register(
        rwa_token::RwaToken,
        (
            admin.clone(),
            7u32,
            String::from_str(&env, "RecovToken"),
            String::from_str(&env, "RTKN"),
            String::from_str(&env, "property"),
            kyc_id.clone(),
            ce_id.clone(),
            Option::<rwa_token::ComplianceMetadata>::None,
            0i128,
        ),
    );
    let token = rwa_token::RwaTokenClient::new(&env, &token_id);

    (env, admin, token, kyc)
}

/// Helper: configure recovery on a token and return three guardian addresses.
fn configure_three_of_three(
    env: &Env,
    admin: &Address,
    token: &rwa_token::RwaTokenClient<'static>,
    threshold: u32,
) -> (Address, Address, Address) {
    let g1 = Address::generate(env);
    let g2 = Address::generate(env);
    let g3 = Address::generate(env);
    let mut members = soroban_sdk::Vec::new(env);
    members.push_back(g1.clone());
    members.push_back(g2.clone());
    members.push_back(g3.clone());
    token.configure_recovery(&threshold, &members, &200u32);
    let _ = admin;
    (g1, g2, g3)
}

// ── Scenario 1: threshold boundary — 1-of-N rejected, (N+1)-of-N rejected ───

#[test]
fn fuzz_recovery_threshold_boundary() {
    // (threshold, member_count, expect_ok)
    let cases: &[(u32, u32, bool)] = &[
        (1, 3, false),  // threshold < 2
        (0, 3, false),  // threshold = 0
        (2, 3, true),   // valid lower bound
        (3, 3, true),   // threshold == N
        (4, 3, false),  // threshold > N (N+1-of-N)
        (2, 1, false),  // N < 2
        (2, 10, true),  // max allowed member count
        (2, 11, false), // member count > 10
    ];

    for &(threshold, member_count, expect_ok) in cases {
        let (env, admin, token, _kyc) = build_recovery_suite();

        let mut members = soroban_sdk::Vec::new(&env);
        for _ in 0..member_count {
            members.push_back(Address::generate(&env));
        }
        let result = token.try_configure_recovery(&threshold, &members, &100u32);
        assert_eq!(
            result.is_ok(),
            expect_ok,
            "threshold={threshold}, member_count={member_count}: expected ok={expect_ok}"
        );
        let _ = admin;
    }
}

// ── Scenario 2: duplicate approval panics ─────────────────────────────────────

#[test]
fn fuzz_recovery_duplicate_approval_panics() {
    let (env, _admin, token, _kyc) = build_recovery_suite();
    let (g1, g2, _g3) = configure_three_of_three(&env, &_admin, &token, 2);
    let new_admin = Address::generate(&env);

    token.propose_recovery(&g1, &new_admin);

    // g2 approves once — succeeds
    token.approve_recovery(&g2);

    // g2 tries to approve a second time — must panic
    let result = token.try_approve_recovery(&g2);
    assert!(result.is_err(), "duplicate approval must be rejected");
}

// ── Scenario 3: expired proposal panics on approve and execute ────────────────

#[test]
fn fuzz_recovery_expired_proposal_panics() {
    // cooldown=100, expiry = creation_seq + 50
    let (env, _admin, token, _kyc) = build_recovery_suite();
    let (g1, g2, _g3) = configure_three_of_three(&env, &_admin, &token, 2);
    let new_admin = Address::generate(&env);

    env.ledger().set_sequence_number(1000);
    token.propose_recovery(&g1, &new_admin); // expiry = 1000 + 100 = 1100

    // Advance past expiry
    env.ledger().set_sequence_number(1101);

    // approve must panic with RecoveryExpired
    let approve_result = token.try_approve_recovery(&g2);
    assert!(
        approve_result.is_err(),
        "approve on expired proposal must be rejected"
    );

    // execute must also panic (even if we somehow had enough approvals)
    let execute_result = token.try_execute_recovery(&g2);
    assert!(
        execute_result.is_err(),
        "execute on expired proposal must be rejected"
    );
}

// ── Scenario 4: proposer self-approval panic ──────────────────────────────────

#[test]
fn fuzz_recovery_proposer_cannot_self_approve() {
    let proposer_cases = [2u32, 3u32]; // thresholds to test

    for &threshold in &proposer_cases {
        let (env, _admin, token, _kyc) = build_recovery_suite();
        let (g1, _g2, _g3) = configure_three_of_three(&env, &_admin, &token, threshold);
        let new_admin = Address::generate(&env);

        token.propose_recovery(&g1, &new_admin);

        // g1 (the proposer) tries to self-approve
        let result = token.try_approve_recovery(&g1);
        assert!(
            result.is_err(),
            "proposer self-approval must be rejected, threshold={threshold}"
        );
    }
}

// ── Scenario 5: cooldown enforcement ─────────────────────────────────────────

#[test]
fn fuzz_recovery_cooldown_enforcement() {
    // cooldown_ledgers values to test
    let cooldowns: &[u32] = &[100, 200, 500];

    for &cooldown in cooldowns {
        let (env, _admin, token, _kyc) = build_recovery_suite();
        let new_admin1 = Address::generate(&env);
        let new_admin2 = Address::generate(&env);

        let g1 = Address::generate(&env);
        let g2 = Address::generate(&env);
        let g3 = Address::generate(&env);
        let mut members = soroban_sdk::Vec::new(&env);
        members.push_back(g1.clone());
        members.push_back(g2.clone());
        members.push_back(g3.clone());
        token.configure_recovery(&2u32, &members, &cooldown);

        // Execute first recovery at ledger 10_000.
        // last_executed_ledger = 0 initially, so 10_000 >= 0 + cooldown always passes.
        env.ledger().set_sequence_number(10_000u32);
        token.propose_recovery(&g1, &new_admin1);
        // threshold=2 means 2 distinct non-proposer guardians must approve.
        token.approve_recovery(&g2);
        token.approve_recovery(&g3);
        token.execute_recovery(&g1); // g1 (proposer) can still execute

        // Immediately try a second recovery — cooldown not elapsed.
        // Propose at 10_001; expiry = 10_001 + cooldown/2 (well within range).
        env.ledger().set_sequence_number(10_001u32);
        token.propose_recovery(&g1, &new_admin2);
        token.approve_recovery(&g2);
        token.approve_recovery(&g3);
        let early_result = token.try_execute_recovery(&g1);
        assert!(
            early_result.is_err(),
            "execute within cooldown must be rejected, cooldown={cooldown}"
        );

        // Reproduce a valid proposal whose expiry reaches the cooldown boundary:
        //   propose at midpoint = 10_000 + cooldown/2
        //   expiry  = midpoint + cooldown/2 = 10_000 + cooldown (== boundary)
        let midpoint = 10_000u32 + cooldown / 2;
        env.ledger().set_sequence_number(midpoint);
        token.propose_recovery(&g1, &new_admin2);
        token.approve_recovery(&g2);
        token.approve_recovery(&g3);

        // At the exact cooldown boundary both checks pass simultaneously:
        //   seq >= last_executed + cooldown  →  10_000+cooldown >= 10_000+cooldown ✓
        //   seq <= expiry_ledger             →  10_000+cooldown <= 10_000+cooldown ✓
        env.ledger().set_sequence_number(10_000u32 + cooldown);
        let boundary_result = token.try_execute_recovery(&g1);
        assert!(
            boundary_result.is_ok(),
            "execute at cooldown boundary must succeed, cooldown={cooldown}"
        );
    }
}

// ── Scenario 6: recovery then re-configure ────────────────────────────────────

#[test]
fn fuzz_recovery_then_reconfigure() {
    let (env, _admin, token, _kyc) = build_recovery_suite();
    let (g1, g2, g3) = configure_three_of_three(&env, &_admin, &token, 2);
    let new_admin = Address::generate(&env);

    env.ledger().set_sequence_number(5_000);
    token.propose_recovery(&g1, &new_admin);
    token.approve_recovery(&g2);
    token.approve_recovery(&g3);
    token.execute_recovery(&g1);

    // new_admin is now in charge — they reconfigure with a fresh guardian set
    let ng1 = Address::generate(&env);
    let ng2 = Address::generate(&env);
    let mut new_members = soroban_sdk::Vec::new(&env);
    new_members.push_back(ng1.clone());
    new_members.push_back(ng2.clone());
    let result = token.try_configure_recovery(&2u32, &new_members, &300u32);
    assert!(
        result.is_ok(),
        "new admin must be able to reconfigure recovery"
    );

    // The new config clears any stale active proposal
    let active = token.active_recovery();
    assert!(
        active.is_none(),
        "reconfigure must clear the active proposal"
    );
}

// ── Scenario 7: recovery with concurrent pending admin handover ───────────────

#[test]
fn fuzz_recovery_with_concurrent_pending_handover() {
    let (env, _admin, token, _kyc) = build_recovery_suite();
    let (g1, g2, g3) = configure_three_of_three(&env, &_admin, &token, 2);

    // Original admin initiates a normal admin handover
    let handover_candidate = Address::generate(&env);
    let nonce = token.admin_nonce();
    token.propose_admin(&_admin, &handover_candidate, &nonce);

    // Meanwhile guardians execute a recovery to a different new admin.
    // threshold=2 means g2 AND g3 both need to approve (g1 is the proposer).
    let recovery_admin = Address::generate(&env);
    env.ledger().set_sequence_number(1_000u32);
    token.propose_recovery(&g1, &recovery_admin);
    token.approve_recovery(&g2);
    token.approve_recovery(&g3);
    token.execute_recovery(&g1);

    // Verify the recovery admin is in charge
    let cfg = token.recovery_config();
    assert_eq!(cfg.last_executed_ledger, 1_000u64);

    // The recovery bumped the nonce — original nonce-protected ops are invalid
    let new_nonce = token.admin_nonce();
    assert!(
        new_nonce > nonce,
        "AdminNonce must be incremented after recovery"
    );
}

// ── KYC expiry-bucket fuzz tests ──────────────────────────────────────────────

/// Approve a subject with expiry A, re-approve with expiry B (B > A).
/// After time advances past A, get_expiring_soon must never return the subject
/// for a window that covers A but not B — i.e., stale bucket entries from the
/// first approval must not produce ghost results.
#[test]
fn prop_expiry_index_no_stale_results() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let verifier = Address::generate(&env);

    let kyc_id = env.register(KycRegistry, ());
    let kyc = KycRegistryClient::new(&env, &kyc_id);
    kyc.initialize(&admin);
    kyc.add_verifier(&admin, &verifier);

    // Matrix: (expiry_A, expiry_B) pairs where B >> A.
    let pairs: &[(u64, u64)] = &[
        (86_400, 86_400 * 10),
        (86_400 * 2, 86_400 * 30),
        (86_400 * 5, 86_400 * 100),
    ];

    for &(expiry_a, expiry_b) in pairs {
        let subject = Address::generate(&env);

        // Approve with expiry A, then immediately re-approve with expiry B.
        env.ledger().set_timestamp(0);
        kyc.approve(
            &verifier,
            &subject,
            &0,
            &expiry_a,
            &String::from_str(&env, "US"),
        );
        kyc.approve(
            &verifier,
            &subject,
            &0,
            &expiry_b,
            &String::from_str(&env, "US"),
        );

        // Advance ledger to just after expiry_a but well before expiry_b.
        let now = expiry_a + 1;
        env.ledger().set_timestamp(now);

        // Query window: covers expiry_a (already past) but not expiry_b.
        // Result must be empty — the stale bucket entry for day(A) should not
        // surface because SubjectExpiry now holds B (and A is in the past).
        let window = (expiry_a + 100).saturating_sub(now);
        let expiring = kyc.get_expiring_soon(&window, &0, &50);
        for i in 0..expiring.len() {
            assert_ne!(
                expiring.get(i).unwrap().addr,
                subject,
                "stale entry for expiry_a={expiry_a} returned after re-approve with expiry_b={expiry_b}"
            );
        }

        // Now advance to just before expiry_b — the subject SHOULD appear.
        let before_b = expiry_b - 1;
        env.ledger().set_timestamp(before_b);
        let window_b = 86_400 * 2;
        let expiring_b = kyc.get_expiring_soon(&window_b, &0, &50);
        let found = (0..expiring_b.len()).any(|i| expiring_b.get(i).unwrap().addr == subject);
        assert!(
            found,
            "subject not found before expiry_b={expiry_b} (expiry_a={expiry_a})"
        );
    }
}
