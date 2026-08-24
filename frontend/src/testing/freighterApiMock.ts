/**
 * Drop-in replacement for `@stellar/freighter-api`, used only when Vite runs
 * in `--mode e2e` (see vite.config.ts's conditional alias). Playwright's
 * `installFreighterWallet()` (tests/e2e/fixtures/freighter-shim.ts) injects
 * `window.__VERITOKEN_E2E_WALLET__` with a keypair before each test
 * navigates; this module signs locally with that keypair instead of talking
 * to a real Freighter extension over its private postMessage protocol.
 *
 * Exports the same named functions `frontend/src/lib/walletProvider.ts`
 * imports from the real package, so no application code changes between a
 * normal build and an E2E build — only the module resolution differs.
 */

import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";

interface InjectedWallet {
  publicKey: string;
  secret: string;
}

function injectedWallet(): InjectedWallet | undefined {
  return (window as unknown as { __VERITOKEN_E2E_WALLET__?: InjectedWallet })
    .__VERITOKEN_E2E_WALLET__;
}

function requireWallet(): InjectedWallet {
  const wallet = injectedWallet();
  if (!wallet) {
    throw new Error(
      "[freighterApiMock] no wallet injected — call installFreighterWallet(context, keypair) " +
        "before page.goto() in this test.",
    );
  }
  return wallet;
}

export const isConnected = async (): Promise<boolean> => Boolean(injectedWallet());

export const setAllowed = async (): Promise<boolean> => Boolean(injectedWallet());

export const getPublicKey = async (): Promise<string> => requireWallet().publicKey;

export const signTransaction = async (
  transactionXdr: string,
  opts?: { network?: string; networkPassphrase?: string; accountToSign?: string },
): Promise<string> => {
  const wallet = requireWallet();
  if (!opts?.networkPassphrase) {
    throw new Error("[freighterApiMock] signTransaction requires opts.networkPassphrase");
  }
  const tx = TransactionBuilder.fromXDR(transactionXdr, opts.networkPassphrase);
  tx.sign(Keypair.fromSecret(wallet.secret));
  return tx.toXDR();
};

export default { getPublicKey, signTransaction, setAllowed, isConnected };
