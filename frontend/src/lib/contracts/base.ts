/**
 * Shared helpers used by every frontend contract client.
 *
 * Reads:  build a dummy-source transaction → simulateTransaction → decode retval.
 * Writes: delegate to TxPipeline for the full lifecycle with retry and sequence cache.
 *
 * ScVal scalar encoders are kept here for backward compat with existing clients.
 */

import {
  Contract,
  TransactionBuilder,
  Account,
  xdr,
  scValToNative,
  nativeToScVal,
  type rpc,
} from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE, getServer } from "../stellar";
import { parseContractError, type ContractName } from "../contractErrors";
import { TxPipeline, SequenceCache } from "../txPipeline";

// Stable dummy address used only for read simulations (no auth needed).
const DUMMY_SOURCE = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

export type SignTx = (xdr: string) => Promise<string>;

// ── Lazy singleton pipeline (shared across all contract clients) ──────────────
// Using a getter so it picks up the live server from the network store.

let _pipeline: TxPipeline | null = null;
let _seqCache: SequenceCache | null = null;

/** Returns the shared TxPipeline instance, creating it if needed. */
export function getPipeline(): TxPipeline {
  if (!_pipeline) {
    _seqCache = new SequenceCache();
    _pipeline = new TxPipeline(getServer(), NETWORK_PASSPHRASE, {}, _seqCache);
  }
  return _pipeline;
}

/**
 * Reset the pipeline (call when the network or server changes).
 * The next call to getPipeline() will create a fresh instance.
 */
export function resetPipeline(): void {
  _pipeline = null;
  _seqCache = null;
}

// ── Transaction builder ───────────────────────────────────────────────────────

/** Build a single-operation transaction ready for simulation or submission. */
export function buildTx(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  source: string,
  sequence: string
): string {
  const account = new Account(source, sequence);
  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();
  return tx.toXDR();
}

// ── Read path ─────────────────────────────────────────────────────────────────

/** Simulate a read-only call and return the decoded native JS value. */
export async function readCall<T>(
  server: rpc.Server,
  contractId: string,
  method: string,
  args: xdr.ScVal[]
): Promise<T> {
  const xdrTx = buildTx(contractId, method, args, DUMMY_SOURCE, "0");
  const sim = await server.simulateTransaction(
    TransactionBuilder.fromXDR(xdrTx, NETWORK_PASSPHRASE)
  );

  if ("error" in sim && sim.error) {
    throw new Error(`Simulation error calling ${method}: ${sim.error}`);
  }

  const result = (sim as { result?: { retval: xdr.ScVal } }).result;
  if (!result?.retval) {
    throw new Error(`No return value from ${method}`);
  }
  return scValToNative(result.retval) as T;
}

// ── Write path ────────────────────────────────────────────────────────────────

/**
 * Full write pipeline via TxPipeline: sequence cache → simulate → assemble
 * → sign → submit → poll.  Retries transient failures automatically.
 */
export async function writeCall(
  _server: rpc.Server,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  senderAddress: string,
  _senderSequence: string, // kept for API compat; pipeline manages sequence internally
  signTx: SignTx
): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
  const { response } = await getPipeline().write(
    contractId, method, args, senderAddress, signTx,
  );
  return response;
}

// ── Account helpers ───────────────────────────────────────────────────────────

/** Fetch the current sequence number for a Stellar account. */
export async function fetchSequence(
  server: rpc.Server,
  address: string
): Promise<string> {
  const account = await server.getAccount(address);
  return (account as unknown as { sequence: string }).sequence;
}

// ── Error enrichment ──────────────────────────────────────────────────────────

export function enrichError(contract: ContractName, err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err);
  const parsed = parseContractError(contract, raw);
  if (parsed) {
    return new Error(`${parsed.message} (${parsed.name} #${parsed.code}): ${raw}`);
  }
  return err instanceof Error ? err : new Error(raw);
}

// ── ScVal scalar encoders (backward compat re-exports) ────────────────────────

export const toAddress = (addr: string): xdr.ScVal =>
  nativeToScVal(addr, { type: "address" });

export const toU32 = (n: number): xdr.ScVal =>
  nativeToScVal(n, { type: "u32" });

export const toU64 = (n: bigint | number): xdr.ScVal =>
  nativeToScVal(BigInt(n), { type: "u64" });

export const toI128 = (n: bigint | number): xdr.ScVal =>
  nativeToScVal(BigInt(n), { type: "i128" });

export const toString = (s: string): xdr.ScVal =>
  nativeToScVal(s, { type: "string" });

export const toBool = (b: boolean): xdr.ScVal =>
  nativeToScVal(b, { type: "bool" });
