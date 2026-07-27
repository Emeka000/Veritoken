import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useClipboard } from "../clipboard";

vi.mock("@testing-library/react", async () => {
  const actual = await vi.importActual("@testing-library/react");
  return { ...actual };
});

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useClipboard", () => {
  it("copies text to clipboard successfully", async () => {
    const { result } = renderHook(() => useClipboard());

    let success = false;
    await act(async () => {
      success = await result.current.copy("hello world");
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("hello world");
    expect(success).toBe(true);
    expect(result.current.copied).toBe(true);
  });

  it("returns false when clipboard write fails", async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error("denied"));

    const { result } = renderHook(() => useClipboard());

    let success = true;
    await act(async () => {
      success = await result.current.copy("test");
    });

    expect(success).toBe(false);
    expect(result.current.copied).toBe(false);
  });

  it("resets copied state after the delay", async () => {
    const { result } = renderHook(() => useClipboard(1000));

    await act(async () => {
      await result.current.copy("test");
    });

    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.copied).toBe(false);
  });

  it("uses custom reset delay", async () => {
    const { result } = renderHook(() => useClipboard(3000));

    await act(async () => {
      await result.current.copy("test");
    });

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.copied).toBe(false);
  });

  it("cleans up timeout on unmount", async () => {
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const { result, unmount } = renderHook(() => useClipboard());

    await act(async () => {
      await result.current.copy("test");
    });

    unmount();

    expect(clearSpy).toHaveBeenCalled();
  });
});
