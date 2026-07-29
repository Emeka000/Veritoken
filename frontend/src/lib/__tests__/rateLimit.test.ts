import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRateLimitedAction } from "../rateLimit";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useRateLimitedAction", () => {
  it("runs the action immediately on the first call", () => {
    const action = vi.fn();
    const { result } = renderHook(() => useRateLimitedAction(action, { cooldownMs: 3000 }));

    act(() => result.current.run("a"));

    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith("a");
    expect(result.current.isCoolingDown).toBe(true);
  });

  it("suppresses a call made during the cooldown window", () => {
    const action = vi.fn();
    const onSuppressed = vi.fn();
    const { result } = renderHook(() =>
      useRateLimitedAction(action, { cooldownMs: 3000, onSuppressed }),
    );

    act(() => result.current.run());
    act(() => result.current.run());

    expect(action).toHaveBeenCalledTimes(1);
    expect(onSuppressed).toHaveBeenCalledTimes(1);
  });

  it("allows the action to run again once the cooldown has elapsed", () => {
    const action = vi.fn();
    const { result } = renderHook(() => useRateLimitedAction(action, { cooldownMs: 3000 }));

    act(() => result.current.run());
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    act(() => result.current.run());

    expect(action).toHaveBeenCalledTimes(2);
  });

  it("counts remainingMs down to 0 as the cooldown elapses", () => {
    const { result } = renderHook(() => useRateLimitedAction(vi.fn(), { cooldownMs: 1000 }));

    act(() => result.current.run());
    expect(result.current.remainingMs).toBeGreaterThan(0);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.remainingMs).toBe(0);
    expect(result.current.isCoolingDown).toBe(false);
  });

  it("defaults to a non-zero cooldown when none is specified", () => {
    const action = vi.fn();
    const { result } = renderHook(() => useRateLimitedAction(action));

    act(() => result.current.run());
    act(() => result.current.run());

    expect(action).toHaveBeenCalledTimes(1);
  });
});
