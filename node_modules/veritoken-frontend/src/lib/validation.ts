/**
 * Validates amount input for token transactions.
 * Checks for positive numbers, safe integer ranges, and decimal precision.
 */

interface AmountValidationResult {
  isValid: boolean;
  error: string | null;
}

/**
 * Validate an amount string for token transactions.
 * @param value - The amount string to validate
 * @param decimals - Number of decimal places the token supports (default: 7 for Stellar)
 * @returns { isValid: boolean, error: string | null }
 */
export function useAmountValidation(
  value: string,
  decimals: number = 7,
): AmountValidationResult {
  // Empty values are considered valid (will be caught by required field validation)
  if (!value || value.trim() === "") {
    return { isValid: true, error: null };
  }

  // Try to parse as number
  const num = parseFloat(value);
  if (isNaN(num)) {
    return { isValid: false, error: "Amount must be a valid number" };
  }

  // Check if it's a positive number
  if (num <= 0) {
    return { isValid: false, error: "Amount must be greater than zero" };
  }

  // Check if it's finite
  if (!isFinite(num)) {
    return { isValid: false, error: "Amount must be a finite number" };
  }

  // Check decimal places
  const decimalParts = value.split(".");
  if (decimalParts[1] && decimalParts[1].length > decimals) {
    return {
      isValid: false,
      error: `Amount can have at most ${decimals} decimal places`,
    };
  }

  // Convert to smallest unit (stroops for Stellar = multiply by 10^7)
  const multiplier = Math.pow(10, decimals);
  const stroopsAmount = num * multiplier;

  // Check if it exceeds JavaScript's safe integer range
  if (stroopsAmount > Number.MAX_SAFE_INTEGER) {
    return {
      isValid: false,
      error: `Amount exceeds maximum allowed value (${(Number.MAX_SAFE_INTEGER / multiplier).toLocaleString()})`,
    };
  }

  // Check if it's an integer when converted (to prevent fractional stroops)
  if (!Number.isInteger(stroopsAmount)) {
    return {
      isValid: false,
      error: `Amount precision too high (exceeds ${decimals} decimal places)`,
    };
  }

  return { isValid: true, error: null };
}
