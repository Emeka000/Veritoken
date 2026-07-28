import { describe, it, expect } from "vitest";
import { lookupError, parseContractError, formatContractError } from "./errors.js";

describe("lookupError", () => {
  it("rwa 6 = KycNotApproved", () => expect(lookupError("rwa", 6)).toMatchObject({ code: 6, name: "KycNotApproved" }));
  it("compliance 4 = RuleChangeTooSoon", () => expect(lookupError("compliance", 4)).toMatchObject({ code: 4, name: "RuleChangeTooSoon" }));
  it("kyc 3 = Unauthorized", () => expect(lookupError("kyc", 3)).toMatchObject({ code: 3, name: "Unauthorized" }));
  it("invoice 11 = InvoiceNotFound", () => expect(lookupError("invoice", 11)).toMatchObject({ code: 11, name: "InvoiceNotFound" }));
  it("property 5 = KycTierInsufficient", () => expect(lookupError("property", 5)).toMatchObject({ code: 5, name: "KycTierInsufficient" }));
  it("carbon 4 = InsufficientBalance", () => expect(lookupError("carbon", 4)).toMatchObject({ code: 4, name: "InsufficientBalance" }));
  it("returns null for unknown code", () => expect(lookupError("rwa", 999)).toBeNull());
});

describe("parseContractError", () => {
  it("parses standard error string", () => expect(parseContractError("rwa", "Error(Contract, #6)")).toMatchObject({ code: 6, name: "KycNotApproved" }));
  it("parses without whitespace", () => expect(parseContractError("compliance", "Error(Contract,#2)")).toMatchObject({ code: 2, name: "AlreadyInitialized" }));
  it("returns null for non-contract errors", () => { expect(parseContractError("rwa", "Timeout")).toBeNull(); expect(parseContractError("kyc", "Error(Auth, #1)")).toBeNull(); });
  it("returns null for unrecognised codes", () => expect(parseContractError("rwa", "Error(Contract, #9999)")).toBeNull());
});

describe("formatContractError", () => {
  it("formats with name and code", () => { const m = formatContractError("rwa", new Error("Error(Contract, #7)")); expect(m).toContain("CompliancePaused"); expect(m).toContain("#7"); });
  it("falls back to raw message", () => expect(formatContractError("rwa", new Error("Network timeout"))).toBe("Network timeout"));
  it("handles non-Error", () => expect(formatContractError("kyc", "plain")).toBe("plain"));
  it("formats across contracts", () => {
    expect(formatContractError("carbon", new Error("Error(Contract, #10)"))).toContain("InvalidAmount");
    expect(formatContractError("invoice", new Error("Error(Contract, #12)"))).toContain("InvoiceAlreadySettled");
  });
});