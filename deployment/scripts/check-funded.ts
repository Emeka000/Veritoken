#!/usr/bin/env tsx
/**
 * check-funded.ts — Verify the deployer account has sufficient XLM balance
 * before attempting deployment.
 *
 * Environment variables:
 *   DEPLOYER_SECRET           — Stellar secret key of the deployer account
 *   STELLAR_RPC_URL           — Soroban RPC endpoint
 *   STELLAR_NETWORK_PASSPHRASE — Network passphrase (optional, for validation)
 *   MIN_BALANCE_XLM           — Minimum required balance in XLM (default: 10)
 *
 * Usage:
 *   npx tsx check-funded.ts
 *
 * Local example against Docker standalone node:
 *   DEPLOYER_SECRET=S... \
 *   STELLAR_RPC_URL=http://localhost:8000/soroban/rpc \
 *   npx tsx check-funded.ts
 */

import { Keypair, SorobanRpc } from "@stellar/stellar-sdk";

const DEPLOYER_SECRET = requireEnv("DEPLOYER_SECRET");
const RPC_URL = requireEnv("STELLAR_RPC_URL");
const MIN_BALANCE_XLM = parseFloat(process.env.MIN_BALANCE_XLM ?? "10");

// Stellar uses stroops (1 XLM = 10_000_000 stroops)
const STROOPS_PER_XLM = 10_000_000;

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Required environment variable ${key} is not set.`);
  }
  return value;
}

async function main(): Promise<void> {
  const keypair = Keypair.fromSecret(DEPLOYER_SECRET);
  const publicKey = keypair.publicKey();
  const server = new SorobanRpc.Server(RPC_URL);

  console.log(`Checking balance for: ${publicKey}`);
  console.log(`RPC endpoint:         ${RPC_URL}`);
  console.log(`Minimum required:     ${MIN_BALANCE_XLM} XLM`);

  let account;
  try {
    account = await server.getAccount(publicKey);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("404") || message.includes("not found")) {
      console.error(
        `\nERROR: Account ${publicKey} does not exist on the network.`
      );
      console.error(
        "Fund the account via Friendbot (testnet) or send XLM from an existing account."
      );
      process.exit(1);
    }
    throw err;
  }

  // account.balances contains entries with asset_type and balance (string)
  const nativeBalance = account.balances.find(
    (b: { asset_type: string }) => b.asset_type === "native"
  );

  if (!nativeBalance) {
    console.error("\nERROR: No native XLM balance found for this account.");
    process.exit(1);
  }

  const balanceXlm = parseFloat(
    (nativeBalance as { balance: string }).balance
  );
  const minBalanceStroops = MIN_BALANCE_XLM * STROOPS_PER_XLM;

  console.log(`\nCurrent balance: ${balanceXlm.toFixed(7)} XLM`);

  if (balanceXlm < MIN_BALANCE_XLM) {
    console.error(
      `\nERROR: Insufficient balance. Have ${balanceXlm.toFixed(7)} XLM, need at least ${MIN_BALANCE_XLM} XLM.`
    );
    console.error(
      `Required minimum: ${minBalanceStroops.toLocaleString()} stroops`
    );
    process.exit(1);
  }

  console.log(
    `✓ Account is sufficiently funded (${balanceXlm.toFixed(7)} XLM ≥ ${MIN_BALANCE_XLM} XLM).`
  );
}

main().catch((err) => {
  console.error("check-funded failed:", err);
  process.exit(1);
});
