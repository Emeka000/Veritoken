import { describe, it, expect } from "vitest";
import {
  validateIsin,
  validateIpfsHash,
  validateLegalEntity,
  validateGoverningLaw,
  validateVintageYear,
  validateCurrency,
  validateFaceValue,
} from "../metadataValidation";

describe("validateIsin", () => {
  it("returns valid for empty string (optional field)", () => {
    expect(validateIsin("").isValid).toBe(true);
  });

  it("accepts a correctly formed ISIN", () => {
    expect(validateIsin("US1234567890").isValid).toBe(true);
  });

  it("rejects ISIN shorter than 12 characters", () => {
    const r = validateIsin("US12345");
    expect(r.isValid).toBe(false);
    expect(r.error).toMatch(/12 characters/i);
  });

  it("rejects ISIN longer than 12 characters", () => {
    const r = validateIsin("US12345678901");
    expect(r.isValid).toBe(false);
  });

  it("rejects ISIN without 2-letter country prefix", () => {
    const r = validateIsin("1S1234567890");
    expect(r.isValid).toBe(false);
    expect(r.error).toMatch(/country code/i);
  });

  it("rejects ISIN containing lowercase letters", () => {
    const r = validateIsin("us1234567890");
    expect(r.isValid).toBe(false);
  });
});

describe("validateIpfsHash", () => {
  it("returns valid for empty string (optional field)", () => {
    expect(validateIpfsHash("").isValid).toBe(true);
  });

  it("accepts a valid CIDv0 (starts with Qm, ≥46 chars)", () => {
    const cid = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
    expect(validateIpfsHash(cid).isValid).toBe(true);
  });

  it("rejects a CIDv0 that is too short", () => {
    const r = validateIpfsHash("QmShort");
    expect(r.isValid).toBe(false);
    expect(r.error).toMatch(/46 characters/i);
  });

  it("accepts a valid CIDv1 (starts with baf, ≥59 chars)", () => {
    const cid = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
    expect(validateIpfsHash(cid).isValid).toBe(true);
  });

  it("rejects a CIDv1 that is too short", () => {
    const r = validateIpfsHash("bafShort");
    expect(r.isValid).toBe(false);
    expect(r.error).toMatch(/59 characters/i);
  });

  it("rejects a hash that does not start with Qm or baf", () => {
    const r = validateIpfsHash("invalidhash123");
    expect(r.isValid).toBe(false);
    expect(r.error).toMatch(/Qm.*baf/i);
  });
});

describe("validateLegalEntity", () => {
  it("returns valid for empty string", () => {
    expect(validateLegalEntity("").isValid).toBe(true);
  });

  it("accepts a short name", () => {
    expect(validateLegalEntity("Acme Corp").isValid).toBe(true);
  });

  it("accepts a name exactly at the 200-char limit", () => {
    expect(validateLegalEntity("A".repeat(200)).isValid).toBe(true);
  });

  it("rejects a name over 200 characters", () => {
    const r = validateLegalEntity("A".repeat(201));
    expect(r.isValid).toBe(false);
    expect(r.error).toMatch(/200 characters/i);
  });
});

describe("validateGoverningLaw", () => {
  it("returns valid for empty string", () => {
    expect(validateGoverningLaw("").isValid).toBe(true);
  });

  it("accepts a short jurisdiction string", () => {
    expect(validateGoverningLaw("England and Wales").isValid).toBe(true);
  });

  it("accepts a string at exactly 100 characters", () => {
    expect(validateGoverningLaw("A".repeat(100)).isValid).toBe(true);
  });

  it("rejects a string over 100 characters", () => {
    const r = validateGoverningLaw("A".repeat(101));
    expect(r.isValid).toBe(false);
    expect(r.error).toMatch(/100 characters/i);
  });
});

describe("validateVintageYear", () => {
  it("returns valid for empty string", () => {
    expect(validateVintageYear("").isValid).toBe(true);
  });

  it("accepts years within the valid range", () => {
    expect(validateVintageYear("1990").isValid).toBe(true);
    expect(validateVintageYear("2024").isValid).toBe(true);
    expect(validateVintageYear("2050").isValid).toBe(true);
  });

  it("rejects a year before 1990", () => {
    const r = validateVintageYear("1989");
    expect(r.isValid).toBe(false);
    expect(r.error).toMatch(/1990.*2050/i);
  });

  it("rejects a year after 2050", () => {
    const r = validateVintageYear("2051");
    expect(r.isValid).toBe(false);
    expect(r.error).toMatch(/1990.*2050/i);
  });

  it("rejects non-integer input", () => {
    const r = validateVintageYear("20.24");
    expect(r.isValid).toBe(false);
    expect(r.error).toMatch(/whole number/i);
  });

  it("rejects non-numeric input", () => {
    const r = validateVintageYear("abc");
    expect(r.isValid).toBe(false);
  });
});

describe("validateCurrency", () => {
  it("returns valid for empty string", () => {
    expect(validateCurrency("").isValid).toBe(true);
  });

  it("accepts valid ISO 4217 codes", () => {
    expect(validateCurrency("USD").isValid).toBe(true);
    expect(validateCurrency("EUR").isValid).toBe(true);
    expect(validateCurrency("GBP").isValid).toBe(true);
  });

  it("rejects lowercase codes", () => {
    const r = validateCurrency("usd");
    expect(r.isValid).toBe(false);
    expect(r.error).toMatch(/uppercase/i);
  });

  it("rejects codes shorter than 3 characters", () => {
    const r = validateCurrency("US");
    expect(r.isValid).toBe(false);
  });

  it("rejects codes longer than 3 characters", () => {
    const r = validateCurrency("USDT");
    expect(r.isValid).toBe(false);
  });
});

describe("validateFaceValue", () => {
  it("returns valid for empty string", () => {
    expect(validateFaceValue("").isValid).toBe(true);
  });

  it("accepts positive integers", () => {
    expect(validateFaceValue("10000").isValid).toBe(true);
  });

  it("accepts positive decimals", () => {
    expect(validateFaceValue("1234.56").isValid).toBe(true);
  });

  it("rejects zero", () => {
    const r = validateFaceValue("0");
    expect(r.isValid).toBe(false);
    expect(r.error).toMatch(/greater than zero/i);
  });

  it("rejects negative values", () => {
    const r = validateFaceValue("-100");
    expect(r.isValid).toBe(false);
    expect(r.error).toMatch(/greater than zero/i);
  });

  it("rejects non-numeric input", () => {
    const r = validateFaceValue("ten");
    expect(r.isValid).toBe(false);
    expect(r.error).toMatch(/number/i);
  });
});
