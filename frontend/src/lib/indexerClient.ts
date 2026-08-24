/**
 * indexerClient — typed fetch wrappers for the event indexer REST API.
 *
 * Issue #542 — Off-Chain Soroban Contract Event Indexer Service
 *
 * Usage:
 *   Set VITE_INDEXER_URL in frontend/.env to the indexer base URL.
 *   If unset (empty string), all functions return null and the UI falls back
 *   to direct RPC polling via fetchContractEvents.
 *
 * Example:
 *   VITE_INDEXER_URL=http://localhost:3001
 */

import type { ContractEvent } from "../types";

// ── Config ────────────────────────────────────────────────────────────────────

const INDEXER_URL: string = (import.meta.env.VITE_INDEXER_URL as string | undefined) ?? "";

/** Returns true when the indexer URL is configured in the environment. */
export function isIndexerConfigured(): boolean {
  return INDEXER_URL.trim().length > 0;
}

// ── Response shapes ───────────────────────────────────────────────────────────

export interface IndexerPaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface IndexerEvent {
  id: string;
  contract_id: string;
  event_type: string;
  ledger_sequence: number;
  timestamp: string;
  topics: unknown[];
  value: unknown;
  paging_token: string;
}

export interface IndexerViolation {
  id: string;
  contract_id: string;
  from_addr: string;
  to_addr: string;
  deny_reason: string;
  ledger_sequence: number;
  timestamp: string;
}

export interface IndexerKycExpiry {
  id: string;
  subject: string;
  verifier: string;
  new_status: string;
  tier: number;
  jurisdiction: string;
  expiry: number;
  ledger_sequence: number;
  timestamp: string;
}

export interface IndexerHealth {
  status: "ok" | "error";
  lag_seconds: number;
  cursors: Record<string, string>;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const url = new URL(path, INDEXER_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  const resp = await fetch(url.toString());
  if (!resp.ok) {
    throw new Error(`Indexer API error ${resp.status}: ${await resp.text()}`);
  }
  return resp.json() as Promise<T>;
}

// ── Query functions ───────────────────────────────────────────────────────────

export interface GetEventsParams {
  contractId?: string;
  type?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Fetch paginated events from the indexer.
 * Returns null when the indexer is not configured.
 */
export async function getIndexerEvents(
  params: GetEventsParams = {},
): Promise<IndexerPaginatedResponse<IndexerEvent> | null> {
  if (!isIndexerConfigured()) return null;
  return get<IndexerPaginatedResponse<IndexerEvent>>("/events", {
    contractId: params.contractId,
    type:       params.type,
    from:       params.from,
    to:         params.to,
    page:       params.page,
    pageSize:   params.pageSize,
  });
}

export interface GetViolationsParams {
  contractId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Fetch paginated compliance violations.
 * Returns null when the indexer is not configured.
 */
export async function getComplianceViolations(
  params: GetViolationsParams = {},
): Promise<IndexerPaginatedResponse<IndexerViolation> | null> {
  if (!isIndexerConfigured()) return null;
  return get<IndexerPaginatedResponse<IndexerViolation>>("/compliance/violations", {
    contractId: params.contractId,
    from:       params.from,
    to:         params.to,
    page:       params.page,
    pageSize:   params.pageSize,
  });
}

export interface GetPendingExpiryParams {
  within_seconds?: number;
}

/**
 * Fetch KYC subjects expiring within a given window.
 * Returns null when the indexer is not configured.
 */
export async function getKycPendingExpiry(
  params: GetPendingExpiryParams = {},
): Promise<{ data: IndexerKycExpiry[]; count: number } | null> {
  if (!isIndexerConfigured()) return null;
  return get<{ data: IndexerKycExpiry[]; count: number }>("/kyc/pending-expiry", {
    within_seconds: params.within_seconds,
  });
}

/**
 * Fetch indexer health status.
 * Returns null when the indexer is not configured.
 */
export async function getIndexerHealth(): Promise<IndexerHealth | null> {
  if (!isIndexerConfigured()) return null;
  return get<IndexerHealth>("/health");
}

// ── Normalise helper ──────────────────────────────────────────────────────────

/**
 * Convert an `IndexerEvent` row into the `ContractEvent` shape used by the
 * frontend so existing components need no changes.
 */
export function normalizeIndexerEvent(e: IndexerEvent): ContractEvent {
  const topics = Array.isArray(e.topics)
    ? e.topics.map((t) => (typeof t === "string" ? t : JSON.stringify(t)))
    : [];
  const type = e.event_type ?? topics[0] ?? "unknown";
  const value = e.value;
  const amount = (value && typeof value === "object" && "amount" in (value as object))
    ? String((value as Record<string, unknown>)["amount"])
    : "—";
  const counterparty = (value && typeof value === "object" && "to" in (value as object))
    ? String((value as Record<string, unknown>)["to"])
    : "—";

  return {
    id:           String(e.id),
    type,
    amount,
    counterparty,
    timestamp:    e.timestamp,
    contractId:   e.contract_id,
    pagingToken:  e.paging_token,
    topics,
    value,
  };
}
