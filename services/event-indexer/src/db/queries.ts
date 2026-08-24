/**
 * Typed query helpers for the four indexer tables.
 *
 * All write paths use ON CONFLICT … DO NOTHING / DO UPDATE so callers
 * can be safely retried without producing duplicates.
 */

import type { PoolClient } from "pg";
import { pool } from "./pool.js";
import type {
  DbEvent,
  DbComplianceViolation,
  DbKycChange,
  DbCursor,
} from "../types.js";

// ── Cursors ───────────────────────────────────────────────────────────────────

export async function getCursor(contractId: string): Promise<string> {
  const { rows } = await pool.query<{ last_cursor: string }>(
    "SELECT last_cursor FROM cursors WHERE contract_id = $1",
    [contractId],
  );
  return rows[0]?.last_cursor ?? "";
}

export async function upsertCursor(
  client: PoolClient,
  contractId: string,
  cursor: string,
): Promise<void> {
  await client.query(
    `INSERT INTO cursors (contract_id, last_cursor, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (contract_id)
     DO UPDATE SET last_cursor = EXCLUDED.last_cursor, updated_at = NOW()`,
    [contractId, cursor],
  );
}

export async function getAllCursors(): Promise<DbCursor[]> {
  const { rows } = await pool.query<DbCursor>(
    "SELECT contract_id, last_cursor, updated_at FROM cursors",
  );
  return rows;
}

// ── Events ────────────────────────────────────────────────────────────────────

export async function upsertEvent(
  client: PoolClient,
  event: Omit<DbEvent, "id">,
): Promise<void> {
  await client.query(
    `INSERT INTO events
       (contract_id, event_type, ledger_sequence, timestamp, topics, value, paging_token)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (paging_token) DO NOTHING`,
    [
      event.contract_id,
      event.event_type,
      event.ledger_sequence,
      event.timestamp,
      JSON.stringify(event.topics),
      JSON.stringify(event.value),
      event.paging_token,
    ],
  );
}

export interface EventQueryParams {
  contractId?: string;
  type?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export async function queryEvents(
  params: EventQueryParams,
): Promise<PaginatedResult<DbEvent>> {
  const {
    contractId,
    type,
    from,
    to,
    page = 1,
    pageSize = 50,
  } = params;
  const capped = Math.min(pageSize, 200);
  const offset = (page - 1) * capped;

  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (contractId) {
    conditions.push(`contract_id = $${idx++}`);
    values.push(contractId);
  }
  if (type) {
    conditions.push(`event_type = $${idx++}`);
    values.push(type);
  }
  if (from) {
    conditions.push(`timestamp >= $${idx++}`);
    values.push(from);
  }
  if (to) {
    conditions.push(`timestamp <= $${idx++}`);
    values.push(to);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRes = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM events ${where}`,
    values,
  );
  const total = parseInt(countRes.rows[0].count, 10);

  const dataRes = await pool.query<DbEvent>(
    `SELECT * FROM events ${where}
     ORDER BY ledger_sequence DESC, id DESC
     LIMIT $${idx++} OFFSET $${idx}`,
    [...values, capped, offset],
  );

  return { data: dataRes.rows, total, page, pageSize: capped };
}

// ── Compliance violations ─────────────────────────────────────────────────────

export async function insertViolation(
  client: PoolClient,
  v: Omit<DbComplianceViolation, "id">,
): Promise<void> {
  await client.query(
    `INSERT INTO compliance_violations
       (contract_id, from_addr, to_addr, deny_reason, ledger_sequence, timestamp)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [v.contract_id, v.from_addr, v.to_addr, v.deny_reason, v.ledger_sequence, v.timestamp],
  );
}

export interface ViolationQueryParams {
  contractId?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

export async function queryViolations(
  params: ViolationQueryParams,
): Promise<PaginatedResult<DbComplianceViolation>> {
  const { contractId, from, to, page = 1, pageSize = 50 } = params;
  const capped = Math.min(pageSize, 200);
  const offset = (page - 1) * capped;

  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (contractId) { conditions.push(`contract_id = $${idx++}`); values.push(contractId); }
  if (from)       { conditions.push(`timestamp >= $${idx++}`);  values.push(from); }
  if (to)         { conditions.push(`timestamp <= $${idx++}`);  values.push(to); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRes = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM compliance_violations ${where}`,
    values,
  );
  const total = parseInt(countRes.rows[0].count, 10);

  const dataRes = await pool.query<DbComplianceViolation>(
    `SELECT * FROM compliance_violations ${where}
     ORDER BY ledger_sequence DESC, id DESC
     LIMIT $${idx++} OFFSET $${idx}`,
    [...values, capped, offset],
  );

  return { data: dataRes.rows, total, page, pageSize: capped };
}

// ── KYC changes ───────────────────────────────────────────────────────────────

export async function insertKycChange(
  client: PoolClient,
  k: Omit<DbKycChange, "id">,
): Promise<void> {
  await client.query(
    `INSERT INTO kyc_changes
       (subject, verifier, new_status, tier, jurisdiction, expiry, ledger_sequence, timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [k.subject, k.verifier, k.new_status, k.tier, k.jurisdiction, k.expiry, k.ledger_sequence, k.timestamp],
  );
}

export async function queryPendingExpiry(
  withinSeconds: number,
): Promise<DbKycChange[]> {
  // Find the most recent KYC change per subject whose expiry falls within
  // the next `withinSeconds` seconds. expiry = 0 means no expiry set.
  const nowSec = Math.floor(Date.now() / 1000);
  const limitSec = nowSec + withinSeconds;

  const { rows } = await pool.query<DbKycChange>(
    `SELECT DISTINCT ON (subject) *
     FROM kyc_changes
     WHERE expiry > 0
       AND expiry >= $1
       AND expiry <= $2
       AND new_status = 'Approved'
     ORDER BY subject, ledger_sequence DESC, id DESC`,
    [nowSec, limitSec],
  );
  return rows;
}
