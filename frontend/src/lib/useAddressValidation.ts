import { validateStellarAddress } from "./stellar";

interface AddressValidationResult {
  isValid: boolean;
  error: string | null;
}

/**
 * Hook for validating Stellar addresses.
 * Validates on input and returns validation state.
 * @param value - The address string to validate
 * @returns { isValid: boolean, error: string | null }
 */
export function useAddressValidation(value: string): AddressValidationResult {
  // Empty values are considered valid (optional field)
  if (!value) {
    return { isValid: true, error: null };
  }

  // Check if it's a valid Stellar address
  const isValid = validateStellarAddress(value);

  if (!isValid) {
    return { isValid: false, error: "Invalid Stellar address" };
  }

  return { isValid: true, error: null };
}
