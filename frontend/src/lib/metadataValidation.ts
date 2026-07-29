import { validateStellarAddress, isValidContractId } from "./stellar";

export interface ValidationResult {
  isValid: boolean;
  error: string | null;
}

const OK: ValidationResult = { isValid: true, error: null };
const fail = (error: string): ValidationResult => ({ isValid: false, error });

// ── Address / identity validators (moved from DeployPage.tsx, issue #426 /
// generalised for issue #447's contract-driven form schemas) ────────────────

export function validateAdminAddress(value: string): ValidationResult {
  if (!value) return fail("Admin address is required");
  if (!validateStellarAddress(value))
    return fail("Must be a valid Stellar address (G…, 56 chars)");
  return OK;
}

export function validateContractAddress(label: string) {
  return (value: string): ValidationResult => {
    if (!value) return fail(`${label} is required`);
    if (!isValidContractId(value))
      return fail("Must be a valid Soroban contract ID (C…, 56 chars)");
    return OK;
  };
}

export const validateKycRegistry = validateContractAddress("KYC registry");
export const validateComplianceEngine = validateContractAddress("Compliance engine");

export function validateTokenName(value: string): ValidationResult {
  if (!value?.trim()) return fail("Token name is required");
  if (value.trim().length > 32)
    return fail("Token name must be 32 characters or fewer");
  return OK;
}

export function validateTokenSymbol(value: string): ValidationResult {
  if (!value?.trim()) return fail("Symbol is required");
  if (!/^[A-Z0-9]{1,12}$/.test(value.trim()))
    return fail("Symbol must be 1–12 uppercase letters/digits");
  return OK;
}

/** ISIN: exactly 12 chars, 2-letter uppercase country code + 10 uppercase alphanumeric. */
export function validateIsin(value: string): ValidationResult {
  if (!value) return OK;
  if (value.length !== 12)
    return fail("ISIN must be exactly 12 characters (e.g. US1234567890)");
  if (!/^[A-Z]{2}/.test(value))
    return fail("ISIN must start with a 2-letter country code (e.g. US, GB)");
  if (!/^[A-Z0-9]{12}$/.test(value))
    return fail("ISIN must contain only uppercase letters and digits");
  return OK;
}

/**
 * IPFS hash: empty (not provided) OR a valid CIDv0 (starts with "Qm", ≥46 chars)
 * or CIDv1 (starts with "baf", ≥59 chars).
 */
export function validateIpfsHash(value: string): ValidationResult {
  if (!value) return OK;
  if (value.startsWith("Qm")) {
    if (value.length < 46)
      return fail("CIDv0 hashes must be at least 46 characters (starts with Qm)");
    return OK;
  }
  if (value.startsWith("baf")) {
    if (value.length < 59)
      return fail("CIDv1 hashes must be at least 59 characters (starts with baf)");
    return OK;
  }
  return fail('IPFS hash must start with "Qm" (CIDv0) or "baf" (CIDv1), or be left empty');
}

/** Legal entity name: 1–200 characters when provided. */
export function validateLegalEntity(value: string): ValidationResult {
  if (!value) return OK;
  if (value.length > 200)
    return fail("Legal entity name must be 200 characters or fewer");
  return OK;
}

/** Governing law / jurisdiction: 1–100 characters when provided. */
export function validateGoverningLaw(value: string): ValidationResult {
  if (!value) return OK;
  if (value.length > 100)
    return fail("Governing law must be 100 characters or fewer");
  return OK;
}

/** Vintage year: integer between 1990 and 2050. */
export function validateVintageYear(value: string): ValidationResult {
  if (!value) return OK;
  const n = parseInt(value, 10);
  if (isNaN(n) || String(n) !== value.trim())
    return fail("Vintage year must be a whole number");
  if (n < 1990 || n > 2050)
    return fail("Vintage year must be between 1990 and 2050");
  return OK;
}

/** ISO 4217 currency code: exactly 3 uppercase letters. */
export function validateCurrency(value: string): ValidationResult {
  if (!value) return OK;
  if (!/^[A-Z]{3}$/.test(value))
    return fail("Currency must be a 3-letter uppercase code (e.g. USD, EUR)");
  return OK;
}

/** Face value: positive number. */
export function validateFaceValue(value: string): ValidationResult {
  if (!value) return OK;
  const n = parseFloat(value);
  if (isNaN(n)) return fail("Face value must be a number");
  if (n <= 0) return fail("Face value must be greater than zero");
  return OK;
}
