/**
 * useSubmitWithFeeBump – React hook wrapping the fee-bump pipeline.
 *
 * Exposes { submit, status, retries, error } where status cycles through:
 *   idle → signing → submitting → retrying(N) → success | failed
 *
 * The hook is deliberately side-effect-free between calls: calling submit()
 * a second time resets all state before the new attempt starts.
 */

import { useCallback, useRef, useState } from "react";

import type { rpc } from "@stellar/stellar-sdk";

import {
  type FeeBumpConfig,
  type FeeBumpResult,
  submitWithFeeBump,
} from "./feeBump";

// ── Status type ────────────────────────────────────────────────────────────────

export type FeeBumpStatus =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "submitting" }
  | { kind: "retrying"; attempt: number }
  | { kind: "success"; result: FeeBumpResult }
  | { kind: "failed"; error: Error };

// ── Hook return type ───────────────────────────────────────────────────────────

export interface UseSubmitWithFeeBumpReturn {
  /**
   * Submit a signed inner XDR through the fee-bump pipeline.
   * Resolves with FeeBumpResult on success; rejects with FeeBumpExhaustedError
   * (or another Error) on exhaustion or unexpected failure.
   *
   * @param innerXdr - Signed Soroban inner transaction XDR (base64).
   * @param signXdr  - Async function that signs the prepared XDR and returns the
   *                   signed XDR string (wallet adapter callback).
   */
  submit(
    innerXdr: string,
    signXdr: (xdr: string) => Promise<string>,
  ): Promise<FeeBumpResult>;

  /** Current pipeline status. */
  status: FeeBumpStatus;

  /**
   * Convenience accessor: the number of retries made on the last (or current)
   * attempt.  0 while idle or when the first try succeeded.
   */
  retries: number;

  /** Set when status.kind === "failed", otherwise null. */
  error: Error | null;

  /** Reset all state back to idle without interrupting any in-flight call. */
  reset(): void;
}

// ── Hook implementation ────────────────────────────────────────────────────────

/**
 * @param config  - Fee-bump configuration passed through to submitWithFeeBump.
 * @param server  - Optional RPC server override (useful in tests).
 */
export function useSubmitWithFeeBump(
  config: FeeBumpConfig,
  server?: rpc.Server,
): UseSubmitWithFeeBumpReturn {
  const [status, setStatus] = useState<FeeBumpStatus>({ kind: "idle" });
  const [retries, setRetries] = useState(0);
  const [error, setError] = useState<Error | null>(null);

  // Keep a stable reference to config so we don't close over a stale copy
  // without triggering unnecessary re-renders on every config object change.
  const configRef = useRef(config);
  configRef.current = config;

  const serverRef = useRef(server);
  serverRef.current = server;

  const reset = useCallback(() => {
    setStatus({ kind: "idle" });
    setRetries(0);
    setError(null);
  }, []);

  const submit = useCallback(
    async (
      innerXdr: string,
      signXdr: (xdr: string) => Promise<string>,
    ): Promise<FeeBumpResult> => {
      // Reset before each fresh submission.
      setStatus({ kind: "signing" });
      setRetries(0);
      setError(null);

      let signedXdr: string;
      try {
        signedXdr = await signXdr(innerXdr);
      } catch (err) {
        const wrapped =
          err instanceof Error ? err : new Error(String(err));
        setStatus({ kind: "failed", error: wrapped });
        setError(wrapped);
        throw wrapped;
      }

      setStatus({ kind: "submitting" });

      // Wrap submitWithFeeBump so we can intercept retries and update status.
      // We do this by providing a custom sleep that sets the retrying(N) status
      // before each back-off wait.
      let attemptCount = 0;

      const trackingSleep = async (ms: number): Promise<void> => {
        attemptCount += 1;
        setRetries(attemptCount);
        setStatus({ kind: "retrying", attempt: attemptCount });
        await new Promise<void>((resolve) => setTimeout(resolve, ms));
        // Transition back to submitting while the retry request is in-flight.
        setStatus({ kind: "submitting" });
      };

      try {
        const result = await submitWithFeeBump(
          signedXdr,
          configRef.current,
          serverRef.current,
          trackingSleep,
        );

        setRetries(result.retries);
        setStatus({ kind: "success", result });
        return result;
      } catch (err) {
        const wrapped =
          err instanceof Error ? err : new Error(String(err));
        setStatus({ kind: "failed", error: wrapped });
        setError(wrapped);
        throw wrapped;
      }
    },
    [],
  );

  return { submit, status, retries, error, reset };
}

// ── Status label helper (UI convenience) ─────────────────────────────────────

/**
 * Returns a human-readable label for the current fee-bump status.
 * Import this in page components to render submission progress.
 *
 * Examples:
 *   idle       → "Submit"
 *   signing    → "Signing…"
 *   submitting → "Submitting…"
 *   retrying(2)→ "Retrying (attempt 2)…"
 *   success    → "Success"
 *   failed     → "Failed"
 */
export function feeBumpStatusLabel(status: FeeBumpStatus): string {
  switch (status.kind) {
    case "idle":
      return "Submit";
    case "signing":
      return "Signing\u2026";
    case "submitting":
      return "Submitting\u2026";
    case "retrying":
      return `Retrying (attempt ${status.attempt})\u2026`;
    case "success":
      return "Success";
    case "failed":
      return "Failed";
  }
}

/**
 * Returns true while a submission is actively in progress (any non-terminal
 * state other than idle/success/failed).
 */
export function isFeeBumpInFlight(status: FeeBumpStatus): boolean {
  return (
    status.kind === "signing" ||
    status.kind === "submitting" ||
    status.kind === "retrying"
  );
}
