/**
 * rateLimit.ts — Issue #449
 *
 * A reusable cooldown/throttle hook for transaction-triggering UI actions.
 * Unlike a debounce (which delays the first call), this fires the action
 * immediately on the first invocation and then suppresses further calls
 * until `cooldownMs` has elapsed — the right shape for "don't let the user
 * accidentally double-submit a transaction", as opposed to "wait for typing
 * to settle".
 */

import { useCallback, useEffect, useRef, useState } from "react";

export const DEFAULT_COOLDOWN_MS = 3000;

export interface RateLimitedAction<Args extends unknown[]> {
  /** Invoke the action if not cooling down; otherwise this call is suppressed. */
  run: (...args: Args) => void;
  /** True while suppressing further calls. */
  isCoolingDown: boolean;
  /** Milliseconds remaining in the current cooldown window (0 when not cooling down). */
  remainingMs: number;
}

export function useRateLimitedAction<Args extends unknown[]>(
  action: (...args: Args) => unknown,
  opts: { cooldownMs?: number; onSuppressed?: () => void } = {},
): RateLimitedAction<Args> {
  const cooldownMs = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const actionRef = useRef(action);
  actionRef.current = action;
  const onSuppressedRef = useRef(opts.onSuppressed);
  onSuppressedRef.current = opts.onSuppressed;

  const readyAtRef = useRef(0);
  const [remainingMs, setRemainingMs] = useState(0);

  useEffect(() => {
    if (remainingMs <= 0) return;
    const interval = setInterval(() => {
      setRemainingMs(Math.max(0, readyAtRef.current - Date.now()));
    }, 200);
    return () => clearInterval(interval);
  }, [remainingMs > 0]);

  const run = useCallback(
    (...args: Args) => {
      const now = Date.now();
      if (now < readyAtRef.current) {
        onSuppressedRef.current?.();
        return;
      }
      readyAtRef.current = now + cooldownMs;
      setRemainingMs(cooldownMs);
      actionRef.current(...args);
    },
    [cooldownMs],
  );

  return { run, isCoolingDown: remainingMs > 0, remainingMs };
}
