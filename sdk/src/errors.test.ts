import { describe, it, expect } from "vitest";
import {
  lookupError,
  parseContractError,
  formatContractError,
} from "./errors.js";

describe("lookupError", () => {
  it("returns the correct error for known RWA token codes", () => {
    const err = lookupError("rwa", 6);
    expect(err).toEqual({
      code: 6,
      name: "KycNotApproved",
      message: "Address has not passed KYC verification",
    });
  });

  it("returns the correct error for known KYC codes", () => {
    const err = lookupError("kyc", 3);
    expect(err).toEqual({
      code: 3,
      name: "Unauthorized",
      message: "Caller is not authorized to perform this action",
    });
  });

  it("returns the correct error for known compliance codes", () => {
    const err = lookupError("compliance", 4);
    expect(err).toEqual({
      code: 4,
      name: "RuleChangeTooSoon",
      message: "Compliance rule change is still in the timelock period",
    });
  });

  it("returns the correct error for known invoice codes", () => {
    const err = lookupError("invoice", 11);
    expect(err).toEqual({
      code: 11,
      name: "InvoiceNotFound",
      message: "Invoice record not found",
    });
  });

  it("returns the correct error for known property codes", () => {
    const err = lookupError("property", 5);
    expect(err).toEqual({
      code: 5,
      name: "KycTierInsufficient",
      message: "KYC tier is too low for this operation",
    });
  });

  it("returns the correct error for known carbon codes", () => {
    const err = lookupError("carbon", 4);
    expect(err).toEqual({
      code: 4,
      name: "InsufficientBalance",
      message: "Insufficient token balance for retirement",
    });
  });

  it("returns null for unrecognised codes", () => {
    expect(lookupError("rwa", 999)).toBeNull();
    expect(lookupError("kyc", 500)).toBeNull();
  });
});

describe("parseContractError", () => {
  it("parses a standard Soroban error string", () => {
    const parsed = parseContractError(
      "rwa",
      "Error(Contract, #6)"
    );
    expect(parsed).toEqual({
      code: 6,
      name: "KycNotApproved",
      message: "Address has not passed KYC verification",
    });
  });

  it("parses an error string with whitespace variations", () => {
    const parsed = parseContractError(
      "compliance",
      "Error(Contract,#2)"
    );
    expect(parsed).toEqual({
      code: 2,
      name: "AlreadyInitialized",
      message: "Compliance engine is already initialized",
    });
  });

  it("returns null for non-contract errors", () => {
    expect(parseContractError("rwa", "Some other error")).toBeNull();
    expect(parseContractError("kyc", "Timeout")).toBeNull();
  });

  it("returns null when the error code is not recognised", () => {
    expect(parseContractError("rwa", "Error(Contract, #9999)")).toBeNull();
  });
});

describe("formatContractError", () => {
  it("formats a recognised Soroban contract error", () => {
    const err = new Error("Transaction failed: Error(Contract, #7)");
    const formatted = formatContractError("rwa", err);
    expect(formatted).toContain("Compliance engine is currently paused");
    expect(formatted).toContain("CompliancePaused");
    expect(formatted).toContain("#7");
  });

  it("returns the raw message for unrecognised errors", () => {
    const err = new Error("Network timeout");
    const formatted = formatContractError("rwa", err);
    expect(formatted).toBe("Network timeout");
  });

  it("handles non-Error objects", () => {
    const formatted = formatContractError("kyc", "Plain string error");
    expect(formatted).toBe("Plain string error");
  });

  it("formats different contracts correctly", () => {
    const carbonErr = formatContractError(
      "carbon",
      new Error("Error(Contract, #10)")
    );
    expect(carbonErr).toContain("Amount must be greater than zero");
    expect(carbonErr).toContain("InvalidAmount");

    const invoiceErr = formatContractError(
      "invoice",
      new Error("Error(Contract, #12)")
    );
    expect(invoiceErr).toContain("Invoice has already been settled");
    expect(invoiceErr).toContain("InvoiceAlreadySettled");
  });
});
