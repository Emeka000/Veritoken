/**
 * SDK health and analytics helpers (#400).
 *
 * `checkHealth` gathers basic operational signals for a deployed contract
 * without requiring a wallet or write access. All reads are simulated
 * (read-only) and safe to call from monitoring scripts or dashboards.
 *
 * Signals collected:
 * - `reachable`         — RPC responded without a network error
 * - `paused`            — compliance engine pause state (where applicable)
 * - `latestLedger`      — current ledger sequence from the RPC node
 * - `recentEventCount`  — number of contract events in the last `lookbackLedgers` ledgers
 * - `checkedAt`         — ISO timestamp of the check
 *
 * Per-contract extensions (e.g. `holderCount`, `verifierCount`) are added
 * by the individual client `health()` methods.
 */

import type { rpc } from "@stellar/stellar-sdk";

export interface ContractHealth {
  /** True when the RPC node responded without a network-level error. */
  reachable: boolean;
  /** Current ledger sequence at the time of the check. null when unreachable. */
  latestLedger: number | null;
  /** Number of contract events emitted in the lookback window. */
  recentEventCount: number;
  /** ISO 8601 timestamp of when this snapshot was taken. */
  checkedAt: string;
  /** Any error message captured during the check. */
  error?: string;
}

export interface HealthCheckOptions {
  /** How many ledgers back to scan for recent events. @default 1000 */
  lookbackLedgers?: number;
}

/**
 * Collect base health signals for any contract.
 * Called internally by each client's `health()` method.
 */
export async function checkHealth(
  server: rpc.Server,
  contractId: string,
  opts: HealthCheckOptions = {},
): Promise<ContractHealth> {
  const lookback = opts.lookbackLedgers ?? 1_000;
  const checkedAt = new Date().toISOString();

  let latestLedger: number | null = null;
  let recentEventCount = 0;
  let error: string | undefined;

  try {
    const ledgerInfo = await server.getLatestLedger();
    latestLedger = ledgerInfo.sequence;

    const startLedger = Math.max(0, latestLedger - lookback);
    const eventsResp = await server.getEvents({
      filters: [{ type: "contract", contractIds: [contractId] }],
      startLedger,
    });
    recentEventCount = eventsResp.events.length;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    return { reachable: false, latestLedger: null, recentEventCount: 0, checkedAt, error };
  }

  return { reachable: true, latestLedger, recentEventCount, checkedAt, ...(error ? { error } : {}) };
}
