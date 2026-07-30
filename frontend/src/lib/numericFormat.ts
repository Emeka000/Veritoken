/**
 * Consistent numeric formatting and parsing for token amounts and large values.
 *
 * Soroban tokens use integer arithmetic in their smallest unit (stroops for
 * XLM-denominated assets, 1e-7 per display unit). These helpers centralise
 * the conversion so that every part of the UI shows values the same way and
 * BigInt precision is preserved until the last moment before display.
 */

// ── Formatting ────────────────────────────────────────────────────────────────

/**
 * Format a bigint token amount (in smallest units) as a human-readable string.
 *
 * @param value       Amount in smallest units (e.g. stroops).
 * @param decimals    Decimal places the token uses (default 7, matching Stellar).
 * @param options.maxFractionDigits  Max digits after the decimal point in output.
 * @param options.symbol  Optional currency / token symbol appended after a space.
 */
export function formatTokenAmount(
  value: bigint,
  decimals = 7,
  options?: { maxFractionDigits?: number; symbol?: string },
): string {
  const { maxFractionDigits = decimals, symbol } = options ?? {};
  const divisor = BigInt(10 ** decimals);

  const whole = value / divisor;
  const frac = value % divisor;

  const wholeStr = whole.toLocaleString("en-US");
  const fracStr = frac.toString().padStart(decimals, "0");
  const trimmed = fracStr.replace(/0+$/, "").slice(0, maxFractionDigits);

  const display = trimmed.length > 0 ? `${wholeStr}.${trimmed}` : wholeStr;
  return symbol ? `${display} ${symbol}` : display;
}

/**
 * Convenience wrapper for XLM stroop values (1 XLM = 10,000,000 stroops).
 */
export function formatStroops(stroops: bigint, symbol = "XLM"): string {
  return formatTokenAmount(stroops, 7, { symbol });
}

/**
 * Format a raw bigint for display without decimal conversion (e.g. whole-unit
 * token balances that the contract already stores in display units).
 * Adds locale-aware thousand separators.
 */
export function formatWholeTokens(value: bigint): string {
  return value.toLocaleString("en-US");
}

// ── Parsing ───────────────────────────────────────────────────────────────────

export type ParseResult =
  | { ok: true; value: bigint }
  | { ok: false; error: string };

/**
 * Parse a user-entered decimal string into a bigint in smallest units.
 *
 * Accepts optional thousand separators (commas). Rejects NaN, negative, zero,
 * excessively precise, or overflow inputs with a descriptive error message.
 *
 * @param input    Raw user input (e.g. "1,234.56").
 * @param decimals Decimal places expected by the contract (default 7).
 */
export function parseTokenAmount(input: string, decimals = 7): ParseResult {
  const cleaned = (input ?? "").trim().replace(/,/g, "");

  if (!cleaned) {
    return { ok: false, error: "Amount is required" };
  }

  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    return { ok: false, error: "Amount must be a positive number" };
  }

  const [wholePart, fracPart = ""] = cleaned.split(".");

  if (fracPart.length > decimals) {
    return {
      ok: false,
      error: `At most ${decimals} decimal place${decimals === 1 ? "" : "s"} allowed`,
    };
  }

  const paddedFrac = fracPart.padEnd(decimals, "0");
  const raw = `${wholePart}${paddedFrac}`;

  let result: bigint;
  try {
    result = BigInt(raw);
  } catch {
    return { ok: false, error: "Amount is too large to represent" };
  }

  if (result === 0n) {
    return { ok: false, error: "Amount must be greater than zero" };
  }

  return { ok: true, value: result };
}

// ── Precision warnings ────────────────────────────────────────────────────────

/**
 * Return a human-readable warning when a bigint value approaches limits that
 * could cause silent precision loss if cast to a JavaScript number.
 *
 * Returns null when the value is within safe bounds.
 */
export function getPrecisionWarning(value: bigint): string | null {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    return (
      "Value exceeds JavaScript's safe integer range " +
      `(${Number.MAX_SAFE_INTEGER.toLocaleString()}). ` +
      "Keep it as BigInt for further arithmetic to avoid silent precision loss."
    );
  }
  return null;
}
