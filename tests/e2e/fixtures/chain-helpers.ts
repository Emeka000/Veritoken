/**
 * Direct on-chain setup helpers used by spec `beforeEach`/`beforeAll` blocks.
 *
 * The UI can't produce all the states a scenario needs to start from — most
 * visibly, the KYC "Approve" button and the Batch page's execute action are
 * unwired stubs (see tests/e2e/README.md, "Known frontend gaps"). Rather than
 * fake those flows through the UI, specs drive the underlying contract calls
 * directly with the deployed admin keypair, then load the page to assert on
 * the *real* read path the UI does implement.
 *
 * Every helper here uses a fresh, spec-scoped address (see fixtures/accounts.ts)
 * so tests never depend on another test's side effects, even though all
 * specs share the one set of contracts deployed once in global-setup.ts.
 */

import { Keypair, TransactionBuilder, rpc } from "./stellar-sdk";
import { SorobanTransport } from "../../integration/fixtures/soroban-transport";
import { adminKeypair } from "./accounts";
import { readContractIds, type DeployedContractIds } from "./contract-ids";

// Same E2E_RPC_PORT global-setup.ts reads (default 8000) so this file talks
// to the same standalone node regardless of who overrides the port.
const RPC_PORT = Number(process.env.E2E_RPC_PORT ?? 8000);
const RPC_URL = `http://localhost:${RPC_PORT}/soroban/rpc`;
const NETWORK_PASSPHRASE = "Standalone Network ; February 2017";
const FRIENDBOT_URL = `http://localhost:${RPC_PORT}/friendbot`;

let cachedTransport: SorobanTransport | undefined;
let cachedServer: rpc.Server | undefined;
let cachedIds: DeployedContractIds | undefined;

function server(): rpc.Server {
  if (!cachedServer) cachedServer = new rpc.Server(RPC_URL, { allowHttp: true });
  return cachedServer;
}

function transport(): SorobanTransport {
  if (!cachedTransport) {
    cachedTransport = new SorobanTransport({
      networkPassphrase: NETWORK_PASSPHRASE,
      rpc: server(),
      transactionTimeoutMs: 30_000,
    });
  }
  return cachedTransport;
}

export function contractIds(): DeployedContractIds {
  if (!cachedIds) cachedIds = readContractIds();
  return cachedIds;
}

/** Funds a brand-new keypair via the quickstart image's built-in friendbot. */
export async function fundAccount(keypair: Keypair): Promise<void> {
  const existing = await server()
    .getAccount(keypair.publicKey())
    .then(() => true)
    .catch(() => false);
  if (existing) return;

  const response = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(keypair.publicKey())}`);
  if (!response.ok && response.status !== 400) {
    throw new Error(
      `friendbot funding failed for ${keypair.publicKey()}: ${response.status} ${await response.text()}`,
    );
  }
}

async function invoke(
  contractId: string,
  method: string,
  args: Parameters<SorobanTransport["invokeContract"]>[0]["args"],
  source: Keypair,
): Promise<ReturnType<SorobanTransport["invokeContract"]>> {
  return transport().invokeContract({ args, contractId, label: `e2e/${method}`, method, source });
}

// ── Encoding helpers (kept local so this file has no dependency on the
// frontend's @veritoken/sdk encoders, matching tests/integration's style) ──

import { Address, xdr } from "./stellar-sdk";

const toAddress = (addr: string) => Address.fromString(addr).toScVal();
const toU32 = (n: number) => xdr.ScVal.scvU32(n);
const toU64 = (n: bigint) =>
  xdr.ScVal.scvU64(xdr.Uint64.fromString(n.toString()));
const toString_ = (s: string) => xdr.ScVal.scvString(s);
const toI128 = (n: bigint) =>
  xdr.ScVal.scvI128(
    new xdr.Int128Parts({ hi: xdr.Int64.fromString("0"), lo: xdr.Uint64.fromString(n.toString()) }),
  );

/**
 * KYC-approves `subject` at the given tier using the deployed admin account
 * (added as a verifier by the shared kyc fixture step). `expirySecondsFromNow`
 * of `0` means "no expiry".
 */
export async function approveKyc(
  subject: string,
  opts: { tier?: number; jurisdiction?: string; expirySecondsFromNow?: number } = {},
): Promise<void> {
  const ids = contractIds();
  const admin = adminKeypair();
  const expiry =
    opts.expirySecondsFromNow === undefined
      ? 0n
      : BigInt(Math.floor(Date.now() / 1000) + opts.expirySecondsFromNow);
  await invoke(
    ids.kycRegistry,
    "approve",
    [
      toAddress(admin.publicKey()),
      toAddress(subject),
      toU32(opts.tier ?? 0),
      toU64(expiry),
      toString_(opts.jurisdiction ?? "US"),
    ],
    admin,
  );
}

/** Adds `addr` to the compliance engine's transfer blocklist. */
export async function addToBlocklist(addr: string): Promise<void> {
  const ids = contractIds();
  const admin = adminKeypair();
  await invoke(ids.complianceEngine, "add_to_blocklist", [toAddress(addr)], admin);
}

/** Mints `amount` carbon credits to `to`. `to` must already be KYC-approved. */
export async function mintCarbon(to: string, amount: bigint): Promise<void> {
  const ids = contractIds();
  const admin = adminKeypair();
  await invoke(ids.carbonToken, "mint", [toAddress(to), toI128(amount)], admin);
}

/** Issues `amount` invoice tokens to `to`. */
export async function issueInvoice(to: string, amount: bigint): Promise<void> {
  const ids = contractIds();
  const admin = adminKeypair();
  await invoke(ids.invoiceToken, "issue", [toAddress(to), toI128(amount)], admin);
}

/** Marks the (single, globally-deployed) invoice as settled. Idempotent-safe: only invoice-lifecycle.spec.ts calls this. */
export async function settleInvoice(): Promise<void> {
  const ids = contractIds();
  const admin = adminKeypair();
  await invoke(ids.invoiceToken, "settle", [], admin);
}

/** Registers `verifier` as a second KYC verifier (used by no spec directly today, kept for parity with the KYC client's write surface). */
export async function addVerifier(verifier: string): Promise<void> {
  const ids = contractIds();
  const admin = adminKeypair();
  await invoke(ids.kycRegistry, "add_verifier", [toAddress(admin.publicKey()), toAddress(verifier)], admin);
}

export { TransactionBuilder, NETWORK_PASSPHRASE };
