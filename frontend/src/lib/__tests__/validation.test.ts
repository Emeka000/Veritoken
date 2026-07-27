import { describe, it, expect } from "vitest";
import { useAmountValidation } from "../validation";
import { validateStellarAddress } from "../stellar";
import { useAddressValidation } from "../useAddressValidation";

// These hooks are pure functions (no useState/useEffect) and can be called
// directly without a React render context.

describe("useAmountValidation", () => {
  it("returns valid for empty string", () => {
    const result = useAmountValidation("");
    expect(result.isValid).toBe(true);
    expect(result.error).toBeNull();
  });

  it("returns valid for a whole number", () => {
    expect(useAmountValidation("100").isValid).toBe(true);
  });

  it("returns valid for a decimal within precision", () => {
    expect(useAmountValidation("1.1234567").isValid).toBe(true);
  });

  it("rejects non-numeric input", () => {
    const result = useAmountValidation("abc");
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/valid number/i);
  });

  it("rejects zero", () => {
    const result = useAmountValidation("0");
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/greater than zero/i);
  });

  it("rejects negative numbers", () => {
    const result = useAmountValidation("-5");
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/greater than zero/i);
  });

  it("rejects too many decimal places", () => {
    const result = useAmountValidation("1.12345678", 7);
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/decimal places/i);
  });

  it("rejects amounts that exceed MAX_SAFE_INTEGER in stroops", () => {
    const result = useAmountValidation("999999999999");
    expect(result.isValid).toBe(false);
  });
});

describe("validateStellarAddress", () => {
  it("returns true for a valid 56-char G address", () => {
    expect(validateStellarAddress("GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNA")).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(validateStellarAddress("")).toBe(false);
  });

  it("returns false for an address that is too short", () => {
    expect(validateStellarAddress("GABC")).toBe(false);
  });

  it("returns false for an address that does not start with G", () => {
    expect(validateStellarAddress("SAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN")).toBe(false);
  });

  it("returns false for an address with invalid characters", () => {
    // Contains '1' and '0' which are not in base32 alphabet
    expect(validateStellarAddress("G1AZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN")).toBe(false);
  });
});

describe("useAddressValidation", () => {
  it("treats empty string as valid (optional field)", () => {
    const result = useAddressValidation("");
    expect(result.isValid).toBe(true);
    expect(result.error).toBeNull();
  });

  it("returns valid for a well-formed Stellar address", () => {
    const result = useAddressValidation("GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNA");
    expect(result.isValid).toBe(true);
  });

  it("returns invalid for a malformed address", () => {
    const result = useAddressValidation("not-an-address");
    expect(result.isValid).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
