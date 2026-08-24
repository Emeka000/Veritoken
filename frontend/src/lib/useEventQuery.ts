/**
 * useEventQuery — paginated, sortable event fetching hook.
 *
 * Issue #425 — Standardized Pagination and Sorting for Event Queries
 * Issue #542 — Off-Chain Soroban Contract Event Indexer Service
 *
 * When VITE_INDEXER_URL is configured, data is fetched from the off-chain
 * indexer REST API (GET /events) which provides persistent, gap-free history.
 * When the indexer is not configured (or unavailable), the hook falls back to
 * direct RPC polling via fetchContractEvents — the original behaviour.
 */

import { useState, useCallback, useRef } from "react";
import { fetchContractEvents, type FetchContractEventsOptions } from "./stellar";
import {
  isIndexerConfigured,
  getIndexerEvents,
  normalizeIndexerEvent,
} from "./indexerClient";
import type { ContractEvent } from "../types";

export type SortField = "timestamp" | "type" | "amount";
export type SortDirection = "asc" | "desc";

export interface EventQueryOptions {
  contractId: string;
  pageSize?: number;
  /** Initial sort configuration. */
  defaultSort?: { field: SortField; direction: SortDirection };
  lookbackLedgers?: number;
}

export interface EventQueryResult {
  events: ContractEvent[];
  loading: boolean;
  error: string | null;
  /** True when more pages are available in the forward direction. */
  hasNextPage: boolean;
  /** True when we are past the first page. */
  hasPrevPage: boolean;
  page: number;
  sort: { field: SortField; direction: SortDirection };
  /** Whether data is coming from the off-chain indexer (vs. direct RPC). */
  source: "indexer" | "rpc";
  /** Fetch or re-fetch from the beginning. */
  refresh: () => void;
  /** Advance to the next page using the cursor from the last event. */
  nextPage: () => void;
  /** Go back to page 1. */
  firstPage: () => void;
  /** Change sort and reset to page 1. */
  setSort: (field: SortField, direction: SortDirection) => void;
}

function sortEvents(
  events: ContractEvent[],
  field: SortField,
  direction: SortDirection,
): ContractEvent[] {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...events].sort((a, b) => {
    if (field === "timestamp") {
      return multiplier * (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0);
    }
    if (field === "type") {
      return multiplier * a.type.localeCompare(b.type);
    }
    if (field === "amount") {
      const aNum = parseFloat(a.amount) || 0;
      const bNum = parseFloat(b.amount) || 0;
      return multiplier * (aNum - bNum);
    }
    return 0;
  });
}

export function useEventQuery({
  contractId,
  pageSize = 10,
  defaultSort = { field: "timestamp", direction: "desc" },
  lookbackLedgers,
}: EventQueryOptions): EventQueryResult {
  const [events, setEvents] = useState<ContractEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [sort, setSortState] = useState(defaultSort);
  const [source, setSource] = useState<"indexer" | "rpc">("rpc");

  // Cursor stack for RPC fallback: index 0 = undefined (page 1)
  const cursorStack = useRef<(string | undefined)[]>([undefined]);

  // ── Indexer fetch ─────────────────────────────────────────────────────────

  const fetchFromIndexer = useCallback(
    async (pageNum: number, currentSort: typeof defaultSort) => {
      if (!contractId) return;
      setLoading(true);
      setError(null);
      setSource("indexer");
      try {
        const result = await getIndexerEvents({
          contractId,
          page:     pageNum,
          pageSize,
        });

        if (!result) {
          // Indexer returned null — fall back to RPC
          throw new Error("Indexer unavailable");
        }

        const normalized = result.data.map(normalizeIndexerEvent);
        const totalPages = Math.ceil(result.total / result.pageSize);

        setHasNextPage(pageNum < totalPages);
        setPage(pageNum);
        setEvents(sortEvents(normalized, currentSort.field, currentSort.direction));
      } catch {
        // Fall back to RPC on any indexer error
        setSource("rpc");
        await fetchFromRpc(undefined, 1, currentSort);
      } finally {
        setLoading(false);
      }
    },
    [contractId, pageSize],
  );

  // ── RPC fallback fetch ────────────────────────────────────────────────────

  const fetchFromRpc = useCallback(
    async (cursor: string | undefined, pageNum: number, currentSort: typeof defaultSort) => {
      if (!contractId) return;
      setLoading(true);
      setError(null);
      setSource("rpc");
      try {
        const options: FetchContractEventsOptions = {
          limit: pageSize + 1,
          ...(cursor ? { cursor } : {}),
          ...(lookbackLedgers ? { lookbackLedgers } : {}),
        };
        const fetched = await fetchContractEvents(contractId, options);
        const nextExists = fetched.length > pageSize;
        const pageEvents = fetched.slice(0, pageSize);

        const lastEvent = pageEvents[pageEvents.length - 1];
        if (nextExists && lastEvent?.pagingToken) {
          cursorStack.current[pageNum] = lastEvent.pagingToken;
        }

        setHasNextPage(nextExists);
        setPage(pageNum);
        setEvents(sortEvents(pageEvents, currentSort.field, currentSort.direction));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch events.");
      } finally {
        setLoading(false);
      }
    },
    [contractId, pageSize, lookbackLedgers],
  );

  // ── Public actions ────────────────────────────────────────────────────────

  const refresh = useCallback(() => {
    cursorStack.current = [undefined];
    if (isIndexerConfigured()) {
      void fetchFromIndexer(1, sort);
    } else {
      void fetchFromRpc(undefined, 1, sort);
    }
  }, [fetchFromIndexer, fetchFromRpc, sort]);

  const nextPage = useCallback(() => {
    if (!hasNextPage) return;
    if (isIndexerConfigured()) {
      void fetchFromIndexer(page + 1, sort);
    } else {
      const nextCursor = cursorStack.current[page - 1];
      void fetchFromRpc(nextCursor, page + 1, sort);
    }
  }, [fetchFromIndexer, fetchFromRpc, hasNextPage, page, sort]);

  const firstPage = useCallback(() => {
    cursorStack.current = [undefined];
    if (isIndexerConfigured()) {
      void fetchFromIndexer(1, sort);
    } else {
      void fetchFromRpc(undefined, 1, sort);
    }
  }, [fetchFromIndexer, fetchFromRpc, sort]);

  const setSort = useCallback(
    (field: SortField, direction: SortDirection) => {
      const newSort = { field, direction };
      setSortState(newSort);
      setEvents((prev) => sortEvents(prev, field, direction));
    },
    [],
  );

  return {
    events,
    loading,
    error,
    hasNextPage,
    hasPrevPage: page > 1,
    page,
    sort,
    source,
    refresh,
    nextPage,
    firstPage,
    setSort,
  };
}
