/**
 * ContractPoller — polls a single Soroban contract for new events every
 * `pollIntervalMs` milliseconds and persists them to PostgreSQL.
 *
 * Algorithm per poll cycle:
 *   1. Read the last committed cursor from the `cursors` table.
 *   2. Call `getEvents({ contractId, cursor, limit: 200 })` on the RPC.
 *   3. Parse each raw event into a typed AnyParsedEvent.
 *   4. Detect ledger-sequence gaps (jump > 1) and log a warning.
 *   5. Within a single DB transaction:
 *        a. Upsert each event into `events` (conflict on paging_token → skip).
 *        b. Write to `compliance_violations` / `kyc_changes` for typed events.
 *        c. Update the cursor to the last event's paging_token.
 *   6. Repeat after `pollIntervalMs`.
 *
 * The poller is intentionally simple — no back-pressure or exponential
 * back-off on RPC errors; a single missed cycle is logged and skipped.
 */

import { rpc, scValToNative } from "@stellar/stellar-sdk";
import { pool } from "./db/pool.js";
import {
  getCursor,
  upsertCursor,
  upsertEvent,
  insertViolation,
  insertKycChange,
} from "./db/queries.js";
import { parseEvents } from "./eventParser.js";
import type {
  ContractConfig,
  ParsedComplianceViolation,
  ParsedKycChange,
} from "./types.js";
import type { RawSorobanEvent } from "./eventParser.js";

const POLL_LIMIT = 200;

// ── Helpers ───────────────────────────────────────────────────────────────────

function toRaw(event: rpc.Api.EventResponse): RawSorobanEvent {
  // The Stellar SDK returns topics as ScVal objects; pass them through
  // scValToNative lazily inside parseEvent — pass as-is here.
  return {
    contractId: typeof event.contractId === "string"
      ? event.contractId
      : tryGetContractId(event.contractId),
    ledger: event.ledger,
    ledgerClosedAt: event.ledgerClosedAt,
    pagingToken: event.pagingToken,
    topic: event.topic,
    value: event.value,
    inSuccessfulContractCall: event.inSuccessfulContractCall,
  };
}

function tryGetContractId(contractId: unknown): string {
  if (!contractId) return "";
  if (typeof contractId === "string") return contractId;
  try {
    return scValToNative(contractId as never) as string ?? "";
  } catch {
    return String(contractId);
  }
}

// ── ContractPoller ────────────────────────────────────────────────────────────

export class ContractPoller {
  private readonly server: rpc.Server;
  private readonly contract: ContractConfig;
  private readonly pollIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** Ledger sequence of the last successfully processed event batch. */
  private lastProcessedLedger = 0;

  constructor(
    server: rpc.Server,
    contract: ContractConfig,
    pollIntervalMs: number,
  ) {
    this.server = server;
    this.contract = contract;
    this.pollIntervalMs = pollIntervalMs;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext(0);
    console.log(`[poller:${this.contract.label}] Started (interval=${this.pollIntervalMs}ms)`);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log(`[poller:${this.contract.label}] Stopped`);
  }

  private scheduleNext(delayMs: number): void {
    this.timer = setTimeout(() => {
      void this.poll().finally(() => {
        if (this.running) this.scheduleNext(this.pollIntervalMs);
      });
    }, delayMs);
  }

  // ── Core poll cycle ───────────────────────────────────────────────────────

  async poll(): Promise<void> {
    const { contractId, label } = this.contract;

    // 1. Fetch cursor
    const cursor = await getCursor(contractId);

    // 2. Build RPC request
    const request: rpc.Server.GetEventsRequest = {
      limit: POLL_LIMIT,
      filters: [{ type: "contract", contractIds: [contractId] }],
    };

    if (cursor) {
      request.cursor = cursor;
    } else {
      // First run — start from the latest ledger (no historical back-fill).
      try {
        const latest = await this.server.getLatestLedger();
        request.startLedger = Math.max(0, latest.sequence - 100);
      } catch {
        request.startLedger = 0;
      }
    }

    // 3. Fetch events from RPC
    let response: rpc.Api.GetEventsResponse;
    try {
      response = await this.server.getEvents(request);
    } catch (err) {
      console.warn(`[poller:${label}] RPC error — skipping cycle:`, (err as Error).message);
      return;
    }

    const rawEvents = response.events ?? [];
    if (rawEvents.length === 0) return;

    // 4. Parse
    const parsed = parseEvents(rawEvents.map(toRaw));

    // 5. Detect ledger gaps
    const sequences = rawEvents.map((e) => e.ledger);
    for (let i = 1; i < sequences.length; i++) {
      const gap = sequences[i] - sequences[i - 1];
      if (gap > 1) {
        console.warn(
          `[poller:${label}] Ledger gap detected: ${sequences[i - 1]} → ${sequences[i]} (gap=${gap})`,
        );
      }
    }

    // 6. Persist in a single transaction
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      for (let i = 0; i < rawEvents.length; i++) {
        const raw = rawEvents[i];
        const p = parsed[i];

        await upsertEvent(client, {
          contract_id:     p.contractId,
          event_type:      p.kind,
          ledger_sequence: BigInt(p.ledgerSequence),
          timestamp:       p.timestamp,
          topics:          Array.isArray(p.topics) ? p.topics : [],
          value:           p.value,
          paging_token:    raw.pagingToken,
        });

        if (p.kind === "compliance_violation") {
          const cv = p as ParsedComplianceViolation;
          await insertViolation(client, {
            contract_id:    p.contractId,
            from_addr:      cv.fromAddr,
            to_addr:        cv.toAddr,
            deny_reason:    cv.denyReason,
            ledger_sequence: BigInt(p.ledgerSequence),
            timestamp:      p.timestamp,
          });
        }

        if (p.kind === "kyc_change") {
          const kc = p as ParsedKycChange;
          await insertKycChange(client, {
            subject:         kc.subject,
            verifier:        kc.verifier,
            new_status:      kc.newStatus,
            tier:            kc.tier,
            jurisdiction:    kc.jurisdiction,
            expiry:          BigInt(kc.expiry),
            ledger_sequence: BigInt(p.ledgerSequence),
            timestamp:       p.timestamp,
          });
        }
      }

      // Update cursor to last event's paging token
      const lastEvent = rawEvents[rawEvents.length - 1];
      await upsertCursor(client, contractId, lastEvent.pagingToken);

      await client.query("COMMIT");

      const lastLedger = rawEvents[rawEvents.length - 1].ledger;
      if (this.lastProcessedLedger > 0 && lastLedger - this.lastProcessedLedger > 1) {
        console.warn(`[poller:${label}] Processed up to ledger ${lastLedger} (gap from ${this.lastProcessedLedger})`);
      }
      this.lastProcessedLedger = lastLedger;

      console.log(`[poller:${label}] Indexed ${parsed.length} events up to ledger ${lastLedger}`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`[poller:${label}] DB error — rolled back:`, (err as Error).message);
    } finally {
      client.release();
    }
  }

  /** Return the ledger sequence of the last successfully processed batch. */
  getLastProcessedLedger(): number {
    return this.lastProcessedLedger;
  }
}
