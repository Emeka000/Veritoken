/**
 * Core contract client abstraction shared across the SDK and the frontend.
 *
 * Design goals
 * ────────────
 * 1. Single transaction builder used by every read and write call.
 * 2. Typed read path: simulate → decode retval → return native JS value.
 * 3. Typed write path: build tx → simulate → assemble → sign → submit → poll.
 * 4. Consistent error model using ContractError from sdk/errors.
 * 5. No duplicate ScVal wiring — all scalar helpers live here; struct
 *    encoders live in sdk/codec.ts.
 */

import {
  Contract,
  Account,
  Keypair,
  TransactionBuilder,
  scValToNative,
  xdr,
  rpc,
} from "@stellar/stellar-sdk";
import {
  parseContractError,
  formatContractError,
  type ContractName,
  type ContractError,
} from "../errors.js";

// ── Simulation dummy account ──────────────────────────────────────────────────

// A stable keypair used only for read-only simulations.  The network never
// validates its signature because simulations are not submitted.
const SIM_KEYPAIR = Keypair.random();
export const SIM_SOURCE = SIM_KEYPAIR.publicKey();

function makeSim(): Account {
  // Always sequence "0" — simulation doesn't increment the account.
  return new Account(SIM_SOURCE, "0");
}

// ── Transaction construction ──────────────────────────────────────────────────

export interface BuildTxOptions {
  fee?: string;
  timeoutSeconds?: number;
}

/**
 * Build a single-operation contract-call transaction and return its XDR string.
 *
 * When `source` + `sequence` are omitted the transaction is built against the
 * simulation dummy account, which is suitable for read-only simulation.
 */
export function buildContractTx(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  networkPassphrase: string,
  source?: string,
  sequence?: string,
  opts: BuildTxOptions = {},
): string {
  const account =
    source && sequence
      ? new Account(source, sequence)
      : makeSim();

  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(account, {
    fee: opts.fee ?? "100",
    networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(opts.timeoutSeconds ?? 30)
    .build();

  return tx.toXDR();
}

// ── Read path ─────────────────────────────────────────────────────────────────

/**
 * Simulate a read-only contract call and return the decoded native JS value.
 *
 * The simulation uses the stable dummy account and does not require a funded
 * source or a wallet connection.
 *
 * @throws Error with a human-readable message if the simulation fails.
 */
export async function simulateRead<T>(
  server: rpc.Server,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  networkPassphrase: string,
): Promise<T> {
  const xdrTx = buildContractTx(
    contractId,
    method,
    args,
    networkPassphrase,
  );
  const tx = TransactionBuilder.fromXDR(xdrTx, networkPassphrase);
  const sim = await server.simulateTransaction(tx);

  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation error calling ${method}: ${sim.error}`);
  }

  const result = (sim as rpc.Api.SimulateTransactionSuccessResponse).result;
  if (!result?.retval) {
    throw new Error(`No return value from ${method}`);
  }
  return scValToNative(result.retval) as T;
}

// ── Write path ────────────────────────────────────────────────────────────────

/** Callback type that wraps wallet signing (Freighter or any signer). */
export type SignTx = (xdrStr: string) => Promise<string>;

/**
 * Build, simulate, sign, submit, and poll a state-mutating contract call.
 *
 * Implements the standard Soroban write flow:
 *   build → simulateTransaction → assembleTransaction → sign → sendTransaction → poll
 *
 * @param assemble  Optional override for rpc.assembleTransaction — useful for testing.
 */
export async function submitContractTx(
  server: rpc.Server,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  senderAddress: string,
  sequence: string,
  signTx: SignTx,
  networkPassphrase: string,
  opts: BuildTxOptions = {},
  assemble: typeof rpc.assembleTransaction = rpc.assembleTransaction,
): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
  const xdrTx = buildContractTx(
    contractId,
    method,
    args,
    networkPassphrase,
    senderAddress,
    sequence,
    opts,
  );

  // Simulate to get the resource footprint needed for assembly.
  const tx = TransactionBuilder.fromXDR(xdrTx, networkPassphrase);
  const sim = await server.simulateTransaction(tx);

  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation failed for ${method}: ${sim.error}`);
  }

  // Assemble: injects the soroban resource extensions into the transaction.
  const prepared = assemble(
    TransactionBuilder.fromXDR(xdrTx, networkPassphrase),
    sim as rpc.Api.SimulateTransactionSuccessResponse,
    )
    .build()
    .toXDR();

  const signed = await signTx(prepared);

  const sendResult = await server.sendTransaction(
    TransactionBuilder.fromXDR(signed, networkPassphrase),
  );

  if (sendResult.status === "ERROR") {
    throw new Error(
      `Transaction rejected by network: ${JSON.stringify(sendResult.errorResult)}`,
    );
  }

  // Poll until the transaction is confirmed or fails.
  let getResult = await server.getTransaction(sendResult.hash);
  while (getResult.status === "NOT_FOUND") {
    await new Promise((r) => setTimeout(r, 1500));
    getResult = await server.getTransaction(sendResult.hash);
  }

  if (getResult.status !== "SUCCESS") {
    throw new Error(
      `Transaction ${sendResult.hash} did not succeed: ${getResult.status}`,
    );
  }

  return getResult as rpc.Api.GetSuccessfulTransactionResponse;
}

/**
 * Fetch the current sequence number for a Stellar account.
 * Must be called before each write — sequence numbers are single-use.
 */
export async function fetchAccountSequence(
  server: rpc.Server,
  address: string,
): Promise<string> {
  const account = await server.getAccount(address);
  return (account as unknown as { sequence: string }).sequence;
}

// ── Abstract base class ───────────────────────────────────────────────────────

/**
 * BaseContractClient wires together the contract ID, RPC server, and network
 * passphrase and exposes protected `read` and `write` methods for subclasses.
 *
 * Subclasses should NOT call buildContractTx / simulateRead / submitContractTx
 * directly — use `this.read()` and `this.write()` so the contract name is
 * always available for error enrichment.
 */
export abstract class BaseContractClient {
  protected readonly contract: Contract;

  constructor(
    protected readonly contractId: string,
    protected readonly server: rpc.Server,
    protected readonly networkPassphrase: string,
    /** Used for error message enrichment; must match ContractName in errors.ts */
    protected readonly contractName: ContractName,
  ) {
    this.contract = new Contract(contractId);
  }

  /** Simulate a read-only call and return decoded value `T`. */
  protected async read<T>(
    method: string,
    args: xdr.ScVal[],
  ): Promise<T> {
    try {
      return await simulateRead<T>(
        this.server,
        this.contractId,
        method,
        args,
        this.networkPassphrase,
      );
    } catch (err) {
      throw this.enrichError(err);
    }
  }

  /** Build, sign, submit, and confirm a state-mutating call. */
  protected async write(
    method: string,
    args: xdr.ScVal[],
    senderAddress: string,
    signTx: SignTx,
    opts?: BuildTxOptions,
    assemble: typeof rpc.assembleTransaction = rpc.assembleTransaction,
  ): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
    try {
      const sequence = await fetchAccountSequence(this.server, senderAddress);
      return await submitContractTx(
        this.server,
        this.contractId,
        method,
        args,
        senderAddress,
        sequence,
        signTx,
        this.networkPassphrase,
        opts,
        assemble,
      );
    } catch (err) {
      throw this.enrichError(err);
    }
  }

  /**
   * Re-throw `err` with a human-readable message prepended.
   * If the raw error contains a Soroban contract error code, the code is
   * resolved to a ContractError and formatted as: "Message (Name #N): original".
   */
  protected enrichError(err: unknown): Error {
    const raw = err instanceof Error ? err.message : String(err);
    const parsed = parseContractError(this.contractName, raw);
    if (parsed) {
      return new Error(
        `${parsed.message} (${parsed.name} #${parsed.code}): ${raw}`,
      );
    }
    return err instanceof Error ? err : new Error(raw);
  }

  /**
   * Look up a parsed ContractError by raw error string.
   * Returns null if the string does not contain a recognised error code.
   */
  parseError(rawError: string): ContractError | null {
    return parseContractError(this.contractName, rawError);
  }

  /** Format any caught error as a display string. */
  formatError(err: unknown): string {
    return formatContractError(
      this.contractName,
      err instanceof Error ? err.message : String(err),
    );
  }
}

// ── Convenience re-export ─────────────────────────────────────────────────────

/** Decode an ScVal to its native JS counterpart. */
export { scValToNative as decodeScVal } from "@stellar/stellar-sdk";
