/**
 * useEventQuery — paginated, sortable event fetching hook.
 *
 * Wraps fetchContractEvents with cursor-based forward pagination and
 * client-side sort/filter controls so any page can easily browse the
 * full event history of a contract without re-implementing the logic.
 *
 * Issue #425 — Standardized Pagination and Sorting for Event Queries
 */

import { useState, useCallback, useRef } from "react";
import { fetchContractEvents, type FetchContractEventsOptions } from "./stellar";
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
  /** True when we are past the first page (backwards not yet supported by RPC). */
  hasPrevPage: boolean;
  page: number;
  sort: { field: SortField; direction: SortDirection };
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

  // Cursor stack: index 0 = undefined (page 1), index N = cursor for page N+1
  const cursorStack = useRef<(string | undefined)[]>([undefined]);

  const fetchPage = useCallback(
    async (cursor: string | undefined, pageNum: number, currentSort: typeof defaultSort) => {
      if (!contractId) return;
      setLoading(true);
      setError(null);
      try {
        const options: FetchContractEventsOptions = {
          limit: pageSize + 1, // fetch one extra to detect next page
          ...(cursor ? { cursor } : {}),
          ...(lookbackLedgers ? { lookbackLedgers } : {}),
        };
        const fetched = await fetchContractEvents(contractId, options);
        const nextExists = fetched.length > pageSize;
        const pageEvents = fetched.slice(0, pageSize);

        // If the next-page cursor hasn't been saved yet, record it.
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

  const refresh = useCallback(() => {
    cursorStack.current = [undefined];
    fetchPage(undefined, 1, sort);
  }, [fetchPage, sort]);

  const nextPage = useCallback(() => {
    if (!hasNextPage) return;
    const nextCursor = cursorStack.current[page - 1];
    fetchPage(nextCursor, page + 1, sort);
  }, [fetchPage, hasNextPage, page, sort]);

  const firstPage = useCallback(() => {
    cursorStack.current = [undefined];
    fetchPage(undefined, 1, sort);
  }, [fetchPage, sort]);

  const setSort = useCallback(
    (field: SortField, direction: SortDirection) => {
      const newSort = { field, direction };
      setSortState(newSort);
      // Apply new sort to already-loaded events without re-fetching.
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
    refresh,
    nextPage,
    firstPage,
    setSort,
  };
}
