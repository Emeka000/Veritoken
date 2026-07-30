import { describe, it, expect } from "vitest";
import {
  formatTokenAmount,
  formatStroops,
  formatWholeTokens,
  parseTokenAmount,
  getPrecisionWarning,
} from "../numericFormat";

describe("formatTokenAmount", () => {
  it("formats whole amounts with no trailing zeros", () => {
    expect(formatTokenAmount(10_000_000n, 7)).toBe("1");
  });

  it("formats fractional amounts", () => {
    expect(formatTokenAmount(10_000_001n, 7)).toBe("1.0000001");
  });

  it("trims trailing zeros from fractional part", () => {
    expect(formatTokenAmount(15_000_000n, 7)).toBe("1.5");
  });

  it("respects maxFractionDigits", () => {
    expect(formatTokenAmount(12_345_678n, 7, { maxFractionDigits: 2 })).toBe(
      "1.23",
    );
  });

  it("appends symbol when provided", () => {
    expect(formatTokenAmount(10_000_000n, 7, { symbol: "XLM" })).toBe("1 XLM");
  });

  it("adds thousand separators to large whole parts", () => {
    const oneThousandXlm = 10_000_000_000n;
    expect(formatTokenAmount(oneThousandXlm, 7)).toBe("1,000");
  });

  it("handles zero", () => {
    expect(formatTokenAmount(0n, 7)).toBe("0");
  });
});

describe("formatStroops", () => {
  it("formats 1 XLM (10,000,000 stroops)", () => {
    expect(formatStroops(10_000_000n)).toBe("1 XLM");
  });

  it("uses provided symbol", () => {
    expect(formatStroops(10_000_000n, "USDC")).toBe("1 USDC");
  });
});

describe("formatWholeTokens", () => {
  it("adds thousand separators", () => {
    expect(formatWholeTokens(1_000_000n)).toBe("1,000,000");
  });

  it("handles zero", () => {
    expect(formatWholeTokens(0n)).toBe("0");
  });
});

describe("parseTokenAmount", () => {
  it("parses a whole number", () => {
    const r = parseTokenAmount("1", 7);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(10_000_000n);
  });

  it("parses a decimal amount", () => {
    const r = parseTokenAmount("1.5", 7);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(15_000_000n);
  });

  it("accepts comma-separated thousands", () => {
    const r = parseTokenAmount("1,234", 7);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(12_340_000_000n);
  });

  it("rejects empty input", () => {
    const r = parseTokenAmount("", 7);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/required/i);
  });

  it("rejects zero", () => {
    const r = parseTokenAmount("0", 7);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/greater than zero/i);
  });

  it("rejects negative values", () => {
    const r = parseTokenAmount("-1", 7);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/positive/i);
  });

  it("rejects non-numeric input", () => {
    const r = parseTokenAmount("abc", 7);
    expect(r.ok).toBe(false);
  });

  it("rejects excessive decimal precision", () => {
    const r = parseTokenAmount("1.12345678", 7);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/decimal place/i);
  });

  it("accepts exactly the allowed decimal precision", () => {
    const r = parseTokenAmount("1.1234567", 7);
    expect(r.ok).toBe(true);
  });
});

describe("getPrecisionWarning", () => {
  it("returns null for values within safe range", () => {
    expect(getPrecisionWarning(10_000_000n)).toBeNull();
  });

  it("returns a warning for values exceeding MAX_SAFE_INTEGER", () => {
    const big = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    const warning = getPrecisionWarning(big);
    expect(warning).not.toBeNull();
    expect(warning).toMatch(/safe integer/i);
  });
});
