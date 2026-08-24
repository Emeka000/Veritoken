//! Cross-contract integration tests for the Veritoken contract suite.
//!
//! These tests instantiate the complete contract stack in the Soroban test
//! environment and exercise realistic end-to-end workflows.  They are
//! intentionally different from the per-contract unit tests, which mock
//! cross-contract calls.  Here every cross-contract call is a real call into
//! a real deployed contract instance.
//!
//! # Workflows covered
//!
//! | Test | Contracts | Scenario |
//! |---|---|---|
//! | `workflow_holder_onboarding_and_rwa_transfer` | KYC + CE + RWA | Full onboarding → transfer |
//! | `workflow_compliance_pause_blocks_all_asset_types` | KYC + CE + RWA + property + carbon | Pause/unpause across three token types |
//! | `workflow_blocklist_prevents_transfer` | KYC + CE + RWA | Blocklist mid-flight |
//! | `workflow_kyc_expiry_blocks_transfer` | KYC + CE + RWA | Expired KYC is rejected |
//! | `workflow_invoice_full_lifecycle` | KYC + CE + invoice | Create → issue → settle → redeem |
//! | `workflow_invoice_lifecycle_pause_blocks_settle` | KYC + CE + invoice | Lifecycle pause guard |
//! | `workflow_property_dividend_end_to_end` | KYC + CE + property | Mint → distribute → claim |
//! | `workflow_carbon_mint_transfer_retire` | KYC + CE + carbon | Mint → transfer → retire |
//! | `workflow_carbon_retire_receipt_is_permanent` | KYC + CE + carbon | On-chain retirement receipt |
//! | `workflow_compliance_rule_propagation` | KYC + CE + RWA | Rule update propagates |
//! | `workflow_max_holders_cap_enforced` | KYC + CE + property | max_holders cap |
//! | `workflow_holding_period_enforced_cross_contract` | KYC + CE + RWA | min_holding_period |
//! | `workflow_kyc_registry_admin_verifier_management` | KYC | Verifier add/remove lifecycle |

#![cfg(test)]

extern crate alloc;

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Env, String,
};

use carbon_credit_token::{CarbonCreditToken, CarbonCreditTokenClient, ProjectMeta};
use compliance_engine::{ComplianceEngine, ComplianceEngineClient, ComplianceRules};
use invoice_token::{InvoiceMeta, InvoiceToken, InvoiceTokenClient};
use kyc_registry::{KycRegistry, KycRegistryClient};
use property_token::{PropertyMeta, PropertyToken, PropertyTokenClient};
use rwa_token::{ComplianceMetadata, RwaToken, RwaTokenClient};

// ── Shared setup helpers ──────────────────────────────────────────────────────

struct Stack {
    env: Env,
    kyc: KycRegistryClient<'static>,
    ce: ComplianceEngineClient<'static>,
    admin: Address,
    verifier: Address,
    kyc_id: Address,
    ce_id: Address,
}

fn build_stack() -> Stack {
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

    Stack {
        env,
        kyc,
        ce,
        admin,
        verifier,
        kyc_id,
        ce_id,
    }
}

impl Stack {
    /// Approve `addr` in the KYC registry with tier 1 (Accredited) and jurisdiction "US".
    fn onboard(&self, addr: &Address) {
        self.kyc.approve(
            &self.verifier,
            addr,
            &1,
            &0,
            &String::from_str(&self.env, "US"),
        );
    }

    fn deploy_rwa(&self, name: &str, symbol: &str) -> RwaTokenClient<'static> {
        let id = self.env.register(
            RwaToken,
            (
                self.admin.clone(),
                7u32,
                String::from_str(&self.env, name),
                String::from_str(&self.env, symbol),
                String::from_str(&self.env, "property"),
                self.kyc_id.clone(),
                self.ce_id.clone(),
                Option::<ComplianceMetadata>::None,
                0i128,
            ),
        );
        RwaTokenClient::new(&self.env, &id)
    }

    fn deploy_property(&self, total_shares: i128) -> PropertyTokenClient<'static> {
        let meta = PropertyMeta {
            property_id: String::from_str(&self.env, "PROP-INT-1"),
            legal_name: String::from_str(&self.env, "Integration Property LLC"),
            jurisdiction: String::from_str(&self.env, "US"),
            address: String::from_str(&self.env, "1 Integration Ave"),
            total_valuation_usd: 10_000_000_000_000,
            total_shares,
            property_type: String::from_str(&self.env, "residential"),
            ipfs_title_hash: String::from_str(&self.env, ""),
            kyc_tier_required: 0,
        };
        let id = self.env.register(
            PropertyToken,
            (
                self.admin.clone(),
                self.kyc_id.clone(),
                self.ce_id.clone(),
                meta,
            ),
        );
        PropertyTokenClient::new(&self.env, &id)
    }

    fn deploy_invoice(&self, face_value: i128) -> InvoiceTokenClient<'static> {
        let meta = InvoiceMeta {
            invoice_id: String::from_str(&self.env, "INV-INT-001"),
            issuer: String::from_str(&self.env, "Acme Corp"),
            debtor: String::from_str(&self.env, "Beta Inc"),
            face_value_usd: face_value,
            discount_rate_bps: 500,
            due_date: 9_999_999_999,
            currency: String::from_str(&self.env, "USD"),
            ipfs_doc_hash: String::from_str(&self.env, ""),
            transfer_fee_bps: 0,
            fee_recipient: None,
            notification_webhook: String::from_str(&self.env, ""),
        };
        let id = self.env.register(
            InvoiceToken,
            (
                self.admin.clone(),
                self.kyc_id.clone(),
                self.ce_id.clone(),
                meta,
            ),
        );
        InvoiceTokenClient::new(&self.env, &id)
    }

    fn deploy_carbon(&self) -> CarbonCreditTokenClient<'static> {
        let meta = ProjectMeta {
            project_id: String::from_str(&self.env, "VCS-INT-001"),
            standard: String::from_str(&self.env, "VCS"),
            vintage_year: 2023,
            project_name: String::from_str(&self.env, "Integration Forest"),
            project_type: String::from_str(&self.env, "forestry"),
            country: String::from_str(&self.env, "BR"),
            verifier: String::from_str(&self.env, "Verra"),
            ipfs_cert_hash: String::from_str(&self.env, ""),
            registry_url: String::from_str(&self.env, "https://registry.verra.org"),
            registry_project_id: String::from_str(&self.env, "VCS-999"),
        };
        let id = self.env.register(
            CarbonCreditToken,
            (
                self.admin.clone(),
                self.kyc_id.clone(),
                self.ce_id.clone(),
                meta,
            ),
        );
        CarbonCreditTokenClient::new(&self.env, &id)
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
}

// ── Workflow 1: holder onboarding and RWA transfer ────────────────────────────

/// Full cross-contract flow: onboard two addresses via the KYC registry,
/// then mint and transfer RWA tokens.  The token contract must call the KYC
/// registry on every transfer.
#[test]
fn workflow_holder_onboarding_and_rwa_transfer() {
    let s = build_stack();
    let token = s.deploy_rwa("Integration RWA", "IRWA");
    let alice = Address::generate(&s.env);
    let bob = Address::generate(&s.env);

    // Alice and Bob are not yet approved — transfers must fail.
    assert!(!s.kyc.is_approved(&alice));
    assert!(!s.kyc.is_approved(&bob));

    // Onboard Alice.
    s.onboard(&alice);
    assert!(s.kyc.is_approved(&alice));

    // Mint to Alice — Bob is not yet approved, so direct mint to Alice is fine.
    token.mint(&s.admin, &alice, &1_000);
    assert_eq!(token.balance(&alice), 1_000);

    // Transfer to unapproved Bob must fail.
    assert!(token.try_transfer(&alice, &bob, &100).is_err());

    // Onboard Bob, then the transfer must succeed.
    s.onboard(&bob);
    token.transfer(&alice, &bob, &100);

    assert_eq!(token.balance(&alice), 900);
    assert_eq!(token.balance(&bob), 100);
    assert_eq!(token.total_supply(), 1_000);
}

// ── Workflow 2: pause blocks all asset types ──────────────────────────────────

/// A single compliance engine pause blocks transfers across all asset types
/// that share the engine.
#[test]
fn workflow_compliance_pause_blocks_all_asset_types() {
    let s = build_stack();
    let rwa = s.deploy_rwa("Pause RWA", "PRWA");
    let prop = s.deploy_property(1_000);
    let carbon = s.deploy_carbon();

    let alice = Address::generate(&s.env);
    let bob = Address::generate(&s.env);
    s.onboard(&alice);
    s.onboard(&bob);

    // Setup initial state.
    rwa.mint(&s.admin, &alice, &500);
    prop.mint(&alice, &200);
    carbon.mint(&alice, &50);

    // Pre-pause: all transfers succeed.
    rwa.transfer(&alice, &bob, &10);
    prop.transfer(&alice, &bob, &10);
    carbon.transfer(&alice, &bob, &5);

    // Pause the shared compliance engine.
    s.ce.pause();

    // Post-pause: all asset transfers must be blocked.
    assert!(rwa.try_transfer(&alice, &bob, &1).is_err());
    assert!(prop.try_transfer(&alice, &bob, &1).is_err());
    assert!(carbon.try_transfer(&alice, &bob, &1).is_err());

    // Unpause — transfers must succeed again.
    s.ce.unpause();
    rwa.transfer(&alice, &bob, &1);
    prop.transfer(&alice, &bob, &1);
    carbon.transfer(&alice, &bob, &1);
}

// ── Workflow 3: blocklist prevents transfer ───────────────────────────────────

#[test]
fn workflow_blocklist_prevents_transfer() {
    let s = build_stack();
    let token = s.deploy_rwa("Blocklist RWA", "BRWA");
    let alice = Address::generate(&s.env);
    let bob = Address::generate(&s.env);
    s.onboard(&alice);
    s.onboard(&bob);

    token.mint(&s.admin, &alice, &1_000);

    // Blocklist alice mid-flight.
    s.ce.add_to_blocklist(&alice);

    // Alice as sender — blocked.
    assert!(token.try_transfer(&alice, &bob, &100).is_err());

    // Bob as sender, alice as receiver — also blocked (alice is blocklisted).
    token.mint(&s.admin, &bob, &100);
    assert!(token.try_transfer(&bob, &alice, &50).is_err());

    // Remove alice from blocklist — transfers succeed.
    s.ce.remove_from_blocklist(&alice);
    token.transfer(&alice, &bob, &100);
    assert_eq!(token.balance(&bob), 200); // 100 original + 100 transferred
}

// ── Workflow 4: KYC revocation blocks transfer ────────────────────────────────

#[test]
fn workflow_kyc_revocation_blocks_transfer() {
    let s = build_stack();
    let token = s.deploy_rwa("Revoke RWA", "RRWA");
    let alice = Address::generate(&s.env);
    let bob = Address::generate(&s.env);
    s.onboard(&alice);
    s.onboard(&bob);

    token.mint(&s.admin, &alice, &1_000);
    token.transfer(&alice, &bob, &100);
    assert_eq!(token.balance(&bob), 100);

    // Revoke alice's KYC.
    s.kyc.revoke(&s.verifier, &alice);
    assert!(!s.kyc.is_approved(&alice));

    // Alice can no longer transfer.
    assert!(token.try_transfer(&alice, &bob, &1).is_err());

    // Bob to alice also fails because alice is not approved.
    assert!(token.try_transfer(&bob, &alice, &10).is_err());

    // Re-approve alice; transfers resume.
    s.onboard(&alice);
    token.transfer(&alice, &bob, &50);
    assert_eq!(token.balance(&bob), 150);
}

// ── Workflow 5: invoice full lifecycle ───────────────────────────────────────

#[test]
fn workflow_invoice_full_lifecycle() {
    let s = build_stack();
    let face_value: i128 = 100_000_000_000; // 10 000 USD at 7 decimals
    let invoice_token = s.deploy_invoice(face_value);
    let alice = Address::generate(&s.env);
    s.onboard(&alice);

    let invoice_id = String::from_str(&s.env, "INV-INT-001");

    // Issue tokens to alice against the invoice.
    invoice_token.issue(&invoice_id, &alice, &face_value);
    assert_eq!(invoice_token.balance(&alice, &invoice_id), face_value);

    // Settle the invoice.
    invoice_token.settle(&invoice_id);
    let status = invoice_token.invoice_status(&invoice_id);
    assert_eq!(
        status,
        invoice_token::InvoiceStatus::FullySettled,
        "invoice must be FullySettled after settle()"
    );

    // Redeem alice's tokens.
    invoice_token.redeem(&invoice_id, &alice, &face_value);
    assert_eq!(invoice_token.balance(&alice, &invoice_id), 0);
    assert_eq!(invoice_token.total_supply(&invoice_id), 0);
}

// ── Workflow 6: invoice lifecycle pause blocks settle ─────────────────────────

#[test]
fn workflow_invoice_lifecycle_pause_blocks_settle() {
    let s = build_stack();
    let face_value: i128 = 50_000_000_000;
    let invoice_token = s.deploy_invoice(face_value);
    let alice = Address::generate(&s.env);
    s.onboard(&alice);

    let invoice_id = String::from_str(&s.env, "INV-INT-001");
    invoice_token.issue(&invoice_id, &alice, &face_value);

    // Pause the lifecycle.
    invoice_token.pause_lifecycle();
    assert!(invoice_token.lifecycle_paused());

    // Settle must be blocked.
    assert!(invoice_token.try_settle(&invoice_id).is_err());

    // Unpause, then settle succeeds.
    invoice_token.unpause_lifecycle();
    invoice_token.settle(&invoice_id);
    assert_eq!(
        invoice_token.invoice_status(&invoice_id),
        invoice_token::InvoiceStatus::FullySettled
    );
}

// ── Workflow 7: property dividend end-to-end ─────────────────────────────────

#[test]
fn workflow_property_dividend_end_to_end() {
    let s = build_stack();
    let prop = s.deploy_property(1_000);
    let alice = Address::generate(&s.env);
    let bob = Address::generate(&s.env);
    s.onboard(&alice);
    s.onboard(&bob);

    // Mint shares.
    prop.mint(&alice, &600);
    prop.mint(&bob, &400);

    // Deposit a dividend.
    prop.deposit_dividend(&1_000, &2); // 2 = DistributionType::Other

    // Verify pro-rata split.
    assert_eq!(prop.pending_dividend(&alice), 600);
    assert_eq!(prop.pending_dividend(&bob), 400);

    // Claim dividends.
    let alice_claimed = prop.claim_dividend(&alice);
    let bob_claimed = prop.claim_dividend(&bob);
    assert_eq!(alice_claimed, 600);
    assert_eq!(bob_claimed, 400);

    // No double-claim.
    assert_eq!(prop.claim_dividend(&alice), 0);
    assert_eq!(prop.claim_dividend(&bob), 0);
}

// ── Workflow 8: carbon mint, transfer, retire ─────────────────────────────────

#[test]
fn workflow_carbon_mint_transfer_retire() {
    let s = build_stack();
    let carbon = s.deploy_carbon();
    let alice = Address::generate(&s.env);
    let bob = Address::generate(&s.env);
    s.onboard(&alice);
    s.onboard(&bob);

    carbon.mint(&alice, &100);
    assert_eq!(carbon.balance(&alice), 100);
    assert_eq!(carbon.total_supply(), 100);

    // Transfer 30 to bob.
    carbon.transfer(&alice, &bob, &30);
    assert_eq!(carbon.balance(&alice), 70);
    assert_eq!(carbon.balance(&bob), 30);

    // Bob retires 10 credits.
    let receipt = carbon.retire(
        &bob,
        &10,
        &String::from_str(&s.env, "My Organisation"),
        &String::from_str(&s.env, "offsetting 2024 emissions"),
    );

    assert_eq!(receipt.amount, 10);
    assert_eq!(receipt.retiree, bob);
    assert_eq!(carbon.total_retired(), 10);
    assert_eq!(carbon.total_supply(), 90);
    assert_eq!(carbon.balance(&bob), 20);
}

// ── Workflow 9: carbon retirement receipt is permanent ────────────────────────

#[test]
fn workflow_carbon_retire_receipt_is_permanent() {
    let s = build_stack();
    let carbon = s.deploy_carbon();
    let alice = Address::generate(&s.env);
    s.onboard(&alice);

    // Set a non-zero ledger timestamp so verify_receipt returns valid=true.
    s.env.ledger().with_mut(|li| li.timestamp = 1_700_000_000);
    carbon.mint(&alice, &50);
    carbon.retire(
        &alice,
        &50,
        &String::from_str(&s.env, "Entity A"),
        &String::from_str(&s.env, "net-zero commitment"),
    );

    // Verify the receipt is retrievable and valid.
    let verification = carbon.verify_receipt(&0);
    assert!(verification.valid);
    assert_eq!(verification.amount, 50);
    assert_eq!(verification.retiree, alice);
    assert_eq!(verification.index, 0);

    // Supply is zero; no further retirements possible.
    assert_eq!(carbon.total_supply(), 0);
    assert!(carbon
        .try_retire(
            &alice,
            &1,
            &String::from_str(&s.env, "anyone"),
            &String::from_str(&s.env, "reason"),
        )
        .is_err());
}

// ── Workflow 10: compliance rule update propagates to all assets ──────────────

#[test]
fn workflow_compliance_rule_propagation() {
    let s = build_stack();
    let rwa = s.deploy_rwa("Limit RWA", "LRWA");
    let alice = Address::generate(&s.env);
    let bob = Address::generate(&s.env);
    s.onboard(&alice);
    s.onboard(&bob);

    rwa.mint(&s.admin, &alice, &10_000);

    // No rule yet — large transfer is fine.
    rwa.transfer(&alice, &bob, &5_000);
    assert_eq!(rwa.balance(&bob), 5_000);

    // Set a 100-unit cap via the compliance engine.
    s.ce.set_rules(&ComplianceRules {
        max_transfer_amount: 100,
        ..Stack::default_rules()
    });

    // Transfer of 101 must fail.
    assert!(rwa.try_transfer(&alice, &bob, &101).is_err());

    // Transfer of exactly 100 must succeed.
    rwa.transfer(&alice, &bob, &100);
    assert_eq!(rwa.balance(&bob), 5_100);

    // Remove the cap.
    s.ce.set_rules(&Stack::default_rules());
    rwa.transfer(&alice, &bob, &1_000);
    assert_eq!(rwa.balance(&bob), 6_100);
}

// ── Workflow 11: max_holders cap is enforced across contracts ─────────────────

#[test]
fn workflow_max_holders_cap_enforced() {
    let s = build_stack();
    let prop = s.deploy_property(1_000);
    let alice = Address::generate(&s.env);
    let bob = Address::generate(&s.env);
    let carol = Address::generate(&s.env);
    s.onboard(&alice);
    s.onboard(&bob);
    s.onboard(&carol);

    // Set a cap of 2 holders.
    s.ce.set_rules(&ComplianceRules {
        max_holders: 2,
        ..Stack::default_rules()
    });

    prop.mint(&alice, &400);
    prop.mint(&bob, &400);
    // Carol would be the 3rd holder — must be blocked.
    assert!(prop.try_transfer(&alice, &carol, &100).is_err());

    // Alice can still transfer to bob (existing holder).
    prop.transfer(&alice, &bob, &100);
    assert_eq!(prop.balance(&bob), 500);
}

// ── Workflow 12: min_holding_period enforced cross-contract ───────────────────

#[test]
fn workflow_holding_period_enforced_cross_contract() {
    let s = build_stack();
    let rwa = s.deploy_rwa("Hold RWA", "HRWA");
    let alice = Address::generate(&s.env);
    let bob = Address::generate(&s.env);
    s.onboard(&alice);
    s.onboard(&bob);

    let base_ts: u64 = 1_000_000;
    s.env.ledger().set_timestamp(base_ts);

    // Set a 1-hour holding period.
    s.ce.set_rules(&ComplianceRules {
        min_holding_period: 3600,
        ..Stack::default_rules()
    });

    rwa.mint(&s.admin, &alice, &1_000);
    // The rwa-token registers alice as holder at mint time.

    // Immediate transfer must be blocked.
    assert!(rwa.try_transfer(&alice, &bob, &100).is_err());

    // Advance time past the holding period.
    s.env.ledger().set_timestamp(base_ts + 3601);
    rwa.transfer(&alice, &bob, &100);
    assert_eq!(rwa.balance(&bob), 100);
}

// ── Workflow 13: KYC verifier management lifecycle ───────────────────────────

#[test]
fn workflow_kyc_registry_admin_verifier_management() {
    let s = build_stack();
    let rwa = s.deploy_rwa("Verifier RWA", "VRWA");
    let alice = Address::generate(&s.env);
    let second_verifier = Address::generate(&s.env);

    // Only the original verifier is present.
    assert_eq!(s.kyc.verifier_count(), 1);

    // Add a second verifier.
    s.kyc.add_verifier(&s.admin, &second_verifier);
    assert_eq!(s.kyc.verifier_count(), 2);

    // Second verifier approves alice.
    s.kyc.approve(
        &second_verifier,
        &alice,
        &1,
        &0,
        &String::from_str(&s.env, "US"),
    );
    assert!(s.kyc.is_approved(&alice));

    // Mint succeeds because alice is approved.
    rwa.mint(&s.admin, &alice, &500);
    assert_eq!(rwa.balance(&alice), 500);

    // Remove the second verifier — alice's existing approval is unaffected.
    s.kyc.remove_verifier(&s.admin, &second_verifier);
    assert_eq!(s.kyc.verifier_count(), 1);
    assert!(s.kyc.is_approved(&alice)); // approval persists

    // Revoke alice via original verifier.
    s.kyc.revoke(&s.verifier, &alice);
    assert!(!s.kyc.is_approved(&alice));
}

// ── Workflow 14: new asset shares KYC + compliance with existing assets ────────

/// Verify that two independently deployed RWA tokens that share the same KYC
/// registry and compliance engine see the same rule updates.
#[test]
fn workflow_shared_compliance_engine_two_tokens() {
    let s = build_stack();
    let token_a = s.deploy_rwa("Token A", "TKNA");
    let token_b = s.deploy_rwa("Token B", "TKNB");

    let alice = Address::generate(&s.env);
    let bob = Address::generate(&s.env);
    s.onboard(&alice);
    s.onboard(&bob);

    token_a.mint(&s.admin, &alice, &1_000);
    token_b.mint(&s.admin, &alice, &1_000);

    // Both tokens share the same compliance engine — pause it once.
    s.ce.pause();

    assert!(token_a.try_transfer(&alice, &bob, &100).is_err());
    assert!(token_b.try_transfer(&alice, &bob, &100).is_err());

    s.ce.unpause();

    token_a.transfer(&alice, &bob, &100);
    token_b.transfer(&alice, &bob, &100);
    assert_eq!(token_a.balance(&bob), 100);
    assert_eq!(token_b.balance(&bob), 100);
}

// ── Invoice: partial settle → transfer → dual redeem ─────────────────────────

/// Integration test: deploy invoice token, partial settle at 50%, transfer half
/// of position, both parties redeem their entitlements, verify total ≤ settlement.
///
/// Uses realistic face values (1T stroops) where settlement >> token count,
/// so the conservation invariant holds: total_tokens_redeemed ≤ settlement_stroops.
#[test]
fn workflow_invoice_partial_settle_transfer_redeem_conservation() {
    let s = build_stack();

    // Realistic scale: face = 1T stroops, issue 1_000 tokens.
    let face = 1_000_000_000_000i128;
    let token_supply = 1_000i128;
    let token = s.deploy_invoice(face);
    let inv = String::from_str(&s.env, "INV-INT-001");

    let alice = Address::generate(&s.env);
    let bob = Address::generate(&s.env);
    s.onboard(&alice);
    s.onboard(&bob);

    // Issue all tokens to Alice.
    token.issue(&inv, &alice, &token_supply);
    assert_eq!(token.total_supply(&inv), token_supply);

    // Partial settle at 50% of face value.
    let settlement = face / 2; // 500_000_000_000 stroops
    token.partial_settle(&inv, &settlement);
    assert_eq!(token.settlement_amount(&inv), settlement);
    assert_eq!(
        token.invoice_status(&inv),
        invoice_token::InvoiceStatus::PartiallySettled
    );

    // Transfer half of Alice's position to Bob while PartiallySettled.
    // This must succeed — PartiallySettled no longer blocks transfers.
    let transfer_amt = token_supply / 2; // 500 tokens
    token.transfer(&inv, &alice, &bob, &transfer_amt);
    assert_eq!(token.balance(&alice, &inv), 500);
    assert_eq!(token.balance(&bob, &inv), 500);

    // Alice's SettledEntitlement = floor(1000 * 500B / 1000) = 500B stroops.
    // Alice has 500 tokens, max_redeemable = min(500, 500B) = 500 tokens.
    let alice_before = token.balance(&alice, &inv);
    token.redeem(&inv, &alice, &alice_before);
    assert_eq!(token.balance(&alice, &inv), 0);

    // Bob has 500 tokens. No SettledEntitlement — uses formula.
    // After Alice's redeem: total_supply = 500, settlement = 500B.
    // max_redeemable for bob = floor(500 * 500B / 500) = 500B ≫ 500 tokens.
    // max = min(500, 500B) = 500 tokens. Bob redeems all.
    let bob_before = token.balance(&bob, &inv);
    token.redeem(&inv, &bob, &bob_before);
    assert_eq!(token.balance(&bob, &inv), 0);

    // Conservation: total_tokens_redeemed ≤ settlement_amount (in stroops).
    // With realistic scale (settlement = 500B, tokens = 1000), this always holds.
    let total_redeemed_tokens = alice_before + bob_before;
    assert!(
        total_redeemed_tokens <= settlement,
        "conservation violated: {total_redeemed_tokens} tokens redeemed > {settlement} settlement"
    );

    // Dust = settlement - total_tokens_redeemed = 500B - 1000 ≈ 500B (rounding error).
    let dust = token.collect_redemption_dust(&inv);
    assert!(dust >= 0, "dust must be non-negative");
    assert_eq!(dust, settlement - total_redeemed_tokens);

    // All tokens burned — invoice transitions to Redeemed.
    assert_eq!(token.total_supply(&inv), 0);
    assert_eq!(
        token.invoice_status(&inv),
        invoice_token::InvoiceStatus::Redeemed
    );
}

/// Integration test: fee recipient compliance — blocklisted recipient blocks the transfer.
#[test]
fn workflow_invoice_fee_recipient_blocklist_blocks_transfer() {
    let s = build_stack();

    let fee_recipient = Address::generate(&s.env);
    s.onboard(&fee_recipient);

    // Deploy invoice with 1% transfer fee.
    let face = 10_000i128;
    let meta = invoice_token::InvoiceMeta {
        invoice_id: String::from_str(&s.env, "INV-INT-001"),
        issuer: String::from_str(&s.env, "Acme Corp"),
        debtor: String::from_str(&s.env, "Beta Inc"),
        face_value_usd: face,
        discount_rate_bps: 0,
        due_date: 9_999_999_999,
        currency: String::from_str(&s.env, "USD"),
        ipfs_doc_hash: String::from_str(&s.env, ""),
        transfer_fee_bps: 100, // 1%
        fee_recipient: Some(fee_recipient.clone()),
        notification_webhook: String::from_str(&s.env, ""),
    };
    let token_id = s.env.register(
        invoice_token::InvoiceToken,
        (s.admin.clone(), s.kyc_id.clone(), s.ce_id.clone(), meta),
    );
    let token = invoice_token::InvoiceTokenClient::new(&s.env, &token_id);
    let inv = String::from_str(&s.env, "INV-INT-001");

    let alice = Address::generate(&s.env);
    let bob = Address::generate(&s.env);
    s.onboard(&alice);
    s.onboard(&bob);

    token.issue(&inv, &alice, &face);

    // Blocklist the fee recipient.
    s.ce.add_to_blocklist(&fee_recipient);

    // Transfer must fail because fee_recipient is blocklisted and FeeRecipientExempt = false.
    assert!(
        token.try_transfer(&inv, &alice, &bob, &1_000).is_err(),
        "transfer to blocklisted fee recipient must fail"
    );

    // Set exempt — now transfer should succeed.
    token.set_fee_recipient_exempt(&true);
    token.transfer(&inv, &alice, &bob, &1_000);
    assert_eq!(token.balance(&alice, &inv), 9_000);
    assert_eq!(token.balance(&bob, &inv), 990);
    // Fee still goes to the recipient despite blocklist (exempt path).
    assert_eq!(token.balance(&fee_recipient, &inv), 10);
}

// ── Issue #541: batch_retire_on_behalf integration test ──────────────────────

use carbon_credit_token::RetirementRequest;

/// Integration test: batch retire 5 credits on behalf of 3 beneficiaries,
/// then call get_receipts_by_beneficiary for each and verify amounts.
///
/// This exercises the full cross-contract stack:
/// - KYC registry must approve the retiree and all beneficiaries.
/// - Compliance engine must allow the burn.
/// - Receipt index must be consistent after batch operation.
#[test]
fn workflow_carbon_batch_retire_on_behalf_three_beneficiaries() {
    let s = build_stack();
    let carbon = s.deploy_carbon();

    let retiree = Address::generate(&s.env);
    let ben1 = Address::generate(&s.env);
    let ben2 = Address::generate(&s.env);
    let ben3 = Address::generate(&s.env);

    // Onboard all parties through the real KYC registry.
    s.onboard(&retiree);
    s.onboard(&ben1);
    s.onboard(&ben2);
    s.onboard(&ben3);

    // Mint 5 credits total to the retiree.
    // Advance timestamp so receipts carry a non-zero timestamp (valid=true).
    s.env.ledger().with_mut(|li| li.timestamp = 1_700_000_000);
    carbon.mint(&retiree, &5);
    assert_eq!(carbon.total_supply(), 5);
    assert_eq!(carbon.balance(&retiree), 5);

    // Build the batch: ben1 gets 1, ben2 gets 2, ben3 gets 2 (total = 5).
    let reqs = soroban_sdk::vec![
        &s.env,
        RetirementRequest {
            beneficiary: ben1.clone(),
            amount: 1,
            memo: String::from_str(&s.env, "offset for ben1"),
        },
        RetirementRequest {
            beneficiary: ben2.clone(),
            amount: 2,
            memo: String::from_str(&s.env, "offset for ben2"),
        },
        RetirementRequest {
            beneficiary: ben3.clone(),
            amount: 2,
            memo: String::from_str(&s.env, "offset for ben3"),
        },
    ];

    let serials = carbon.batch_retire_on_behalf(&retiree, &reqs);

    // Three serials returned with correct project prefix.
    assert_eq!(serials.len(), 3);
    assert_eq!(
        serials.get(0).unwrap(),
        String::from_str(&s.env, "VCS-INT-001-0")
    );
    assert_eq!(
        serials.get(1).unwrap(),
        String::from_str(&s.env, "VCS-INT-001-1")
    );
    assert_eq!(
        serials.get(2).unwrap(),
        String::from_str(&s.env, "VCS-INT-001-2")
    );

    // Balance fully burned.
    assert_eq!(carbon.balance(&retiree), 0);
    assert_eq!(carbon.total_supply(), 0);
    assert_eq!(carbon.total_retired(), 5);
    assert_eq!(carbon.retirement_count(), 3);

    // Per-beneficiary index: ben1 has 1 receipt, amount=1.
    let ben1_receipts = carbon.get_receipts_by_beneficiary(&ben1, &0, &100);
    assert_eq!(ben1_receipts.len(), 1);
    assert_eq!(ben1_receipts.get(0).unwrap().amount, 1);
    assert_eq!(
        ben1_receipts.get(0).unwrap().beneficiary_address,
        Some(ben1.clone())
    );

    // Per-beneficiary index: ben2 has 1 receipt, amount=2.
    let ben2_receipts = carbon.get_receipts_by_beneficiary(&ben2, &0, &100);
    assert_eq!(ben2_receipts.len(), 1);
    assert_eq!(ben2_receipts.get(0).unwrap().amount, 2);
    assert_eq!(
        ben2_receipts.get(0).unwrap().beneficiary_address,
        Some(ben2.clone())
    );

    // Per-beneficiary index: ben3 has 1 receipt, amount=2.
    let ben3_receipts = carbon.get_receipts_by_beneficiary(&ben3, &0, &100);
    assert_eq!(ben3_receipts.len(), 1);
    assert_eq!(ben3_receipts.get(0).unwrap().amount, 2);
    assert_eq!(
        ben3_receipts.get(0).unwrap().beneficiary_address,
        Some(ben3.clone())
    );

    // Verify all 3 receipts are globally accessible and valid.
    for i in 0u32..3 {
        let v = carbon.verify_receipt(&i);
        assert!(v.valid, "receipt {i} must be valid");
        assert_eq!(v.retiree, retiree, "retiree must be the retiring party");
    }
}

/// Integration test: interleave single retire_on_behalf with batch_retire_on_behalf
/// and verify all per-beneficiary indexes remain consistent with the global list.
#[test]
fn workflow_carbon_mixed_retire_beneficiary_index_consistency() {
    let s = build_stack();
    let carbon = s.deploy_carbon();

    let retiree = Address::generate(&s.env);
    let ben1 = Address::generate(&s.env);
    let ben2 = Address::generate(&s.env);

    s.onboard(&retiree);
    s.onboard(&ben1);
    s.onboard(&ben2);

    carbon.mint(&retiree, &100);

    // 1. Single retire_on_behalf: ben1 gets global idx 0, amount=10.
    carbon.retire_on_behalf(&retiree, &ben1, &10, &String::from_str(&s.env, "single-1"));

    // 2. Batch: ben2 gets global idx 1 (amount=20), ben1 gets global idx 2 (amount=30).
    let reqs = soroban_sdk::vec![
        &s.env,
        RetirementRequest {
            beneficiary: ben2.clone(),
            amount: 20,
            memo: String::from_str(&s.env, "batch-ben2"),
        },
        RetirementRequest {
            beneficiary: ben1.clone(),
            amount: 30,
            memo: String::from_str(&s.env, "batch-ben1"),
        },
    ];
    carbon.batch_retire_on_behalf(&retiree, &reqs);

    // 3. Another single retire_on_behalf: ben2 gets global idx 3, amount=15.
    carbon.retire_on_behalf(&retiree, &ben2, &15, &String::from_str(&s.env, "single-2"));

    assert_eq!(carbon.retirement_count(), 4);
    assert_eq!(carbon.total_retired(), 75);

    // ben1 should have 2 receipts: amounts 10 (global 0) and 30 (global 2).
    let ben1_rs = carbon.get_receipts_by_beneficiary(&ben1, &0, &100);
    assert_eq!(ben1_rs.len(), 2);
    assert_eq!(ben1_rs.get(0).unwrap().amount, 10);
    assert_eq!(ben1_rs.get(1).unwrap().amount, 30);

    // ben2 should have 2 receipts: amounts 20 (global 1) and 15 (global 3).
    let ben2_rs = carbon.get_receipts_by_beneficiary(&ben2, &0, &100);
    assert_eq!(ben2_rs.len(), 2);
    assert_eq!(ben2_rs.get(0).unwrap().amount, 20);
    assert_eq!(ben2_rs.get(1).unwrap().amount, 15);
}
