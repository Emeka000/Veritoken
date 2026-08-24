/**
 * Deterministic test-wallet keypairs for the E2E suite.
 *
 * Each spec gets its own labelled keypair so tests never share mutable
 * per-account state (KYC record, token balance, blocklist membership) —
 * see the "Test independence" note in tests/e2e/README.md. Keypairs are
 * derived the same way tests/integration/fixtures/fixture-plans.ts derives
 * its investor/subject/unknown accounts, so the whole repo has one
 * convention for reproducible test identities.
 */

import { createHash } from "node:crypto";
import { Keypair } from "./stellar-sdk";

export function deterministicKeypair(label: string): Keypair {
  return Keypair.fromRawEd25519Seed(
    createHash("sha256").update(`veritoken-e2e:${label}`).digest(),
  );
}

/** The quickstart standalone network's pre-funded genesis/root account. */
export const QUICKSTART_ADMIN_SECRET =
  "SC5O7VZUXDJ6JBDSZ74DSERXL7W3Y5LTOAMRF7RQRL3TAGAPS7LUVG3L";

export const adminKeypair = (): Keypair => Keypair.fromSecret(QUICKSTART_ADMIN_SECRET);

/** Labelled per-spec wallets. Each is a distinct address never reused across specs. */
export const E2E_WALLET_LABELS = {
  walletConnect: "wallet-connect",
  walletReconnect: "wallet-reconnect",
  kycApproved: "kyc-approved",
  kycUnknown: "kyc-unknown",
  complianceSender: "compliance-sender",
  complianceRecipient: "compliance-recipient",
  complianceBlockedSender: "compliance-blocked-sender",
  batchOperator: "batch-operator",
  invoiceHolder: "invoice-holder",
  carbonRetiree: "carbon-retiree",
  adminRoleHolder: "admin-role-holder",
  adminRoleDenied: "admin-role-denied",
  visualDashboard: "visual-dashboard",
  visualKyc: "visual-kyc",
  visualCompliance: "visual-compliance",
} as const;

export type E2EWalletLabel = (typeof E2E_WALLET_LABELS)[keyof typeof E2E_WALLET_LABELS];

export function e2eKeypair(label: E2EWalletLabel): Keypair {
  return deterministicKeypair(label);
}
