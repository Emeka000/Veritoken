import { describe, it, expect, vi } from "vitest";
import {
  isValidAddress, assertValidAddress, isUnauthorizedError,
  assertIsVerifier, assertIsAdmin, withAuth, AuthError,
} from "./auth.js";
import type { KycRegistryClient } from "./clients/KycRegistryClient.js";

const ALICE = "GBQG2SJ7MXUH34SI3MJ2I256I5UMGM2QSQZM77YFX5S6JOHXUQJEPC3A";
const VERIFIER = "GAQWW5UBJVPNKMM5NLAIBEL6QK24ODXABL7YAXBN6KNMH3OYNM5JXT35";

function stubKyc(overrides: Partial<KycRegistryClient> = {}): KycRegistryClient {
  return {
    verifierListPub: vi.fn().mockResolvedValue([VERIFIER]),
    getAdmins: vi.fn().mockResolvedValue([VERIFIER]),
    ...overrides,
  } as unknown as KycRegistryClient;
}

describe("isValidAddress / assertValidAddress", () => {
  it("accepts a well-formed G... address", () => expect(isValidAddress(ALICE)).toBe(true));
  it("rejects a contract (C...) address", () => expect(isValidAddress("CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA")).toBe(false));
  it("rejects garbage input", () => expect(isValidAddress("not-an-address")).toBe(false));
  it("assertValidAddress throws AuthError with role + address attached", () => {
    try {
      assertValidAddress("bad", "admin");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).role).toBe("admin");
      expect((err as AuthError).address).toBe("bad");
    }
  });
});

describe("isUnauthorizedError", () => {
  it("recognises the raw Soroban Unauthorized contract error", () => {
    expect(isUnauthorizedError(new Error("Error(Contract, #3)"))).toBe(true);
  });
  it("recognises an already-enriched message containing 'Unauthorized'", () => {
    expect(isUnauthorizedError(new Error("Caller is not authorized to perform this action (Unauthorized #3): Error(Contract, #3)"))).toBe(true);
  });
  it("does not flag unrelated errors", () => {
    expect(isUnauthorizedError(new Error("Insufficient token balance"))).toBe(false);
  });
});

describe("assertIsVerifier / assertIsAdmin", () => {
  it("resolves when the address is on the roster", async () => {
    await expect(assertIsVerifier(stubKyc(), VERIFIER)).resolves.toBeUndefined();
    await expect(assertIsAdmin(stubKyc(), VERIFIER)).resolves.toBeUndefined();
  });
  it("throws AuthError when the address is not on the roster", async () => {
    await expect(assertIsVerifier(stubKyc(), ALICE)).rejects.toThrow("is not a registered KYC verifier");
    await expect(assertIsAdmin(stubKyc(), ALICE)).rejects.toThrow("is not a registered admin");
  });
  it("throws AuthError before hitting the network for a malformed address", async () => {
    const kyc = stubKyc();
    await expect(assertIsVerifier(kyc, "bad")).rejects.toThrow(AuthError);
    expect(kyc.verifierListPub).not.toHaveBeenCalled();
  });
});

describe("withAuth", () => {
  it("runs the precheck then the action and returns its result", async () => {
    const precheck = vi.fn().mockResolvedValue(undefined);
    const action = vi.fn().mockResolvedValue("ok");
    await expect(withAuth("admin", ALICE, precheck, action)).resolves.toBe("ok");
    expect(precheck).toHaveBeenCalledOnce();
    expect(action).toHaveBeenCalledOnce();
  });

  it("rejects before running the action when the address is invalid", async () => {
    const action = vi.fn();
    await expect(withAuth("admin", "bad", undefined, action)).rejects.toThrow(AuthError);
    expect(action).not.toHaveBeenCalled();
  });

  it("propagates a precheck AuthError without calling the action", async () => {
    const precheck = vi.fn().mockRejectedValue(new AuthError("nope", "verifier", ALICE));
    const action = vi.fn();
    await expect(withAuth("verifier", ALICE, precheck, action)).rejects.toThrow("nope");
    expect(action).not.toHaveBeenCalled();
  });

  it("wraps an on-chain Unauthorized failure from the action into an AuthError", async () => {
    const action = vi.fn().mockRejectedValue(new Error("Error(Contract, #3)"));
    await expect(withAuth("admin", ALICE, undefined, action)).rejects.toThrow(AuthError);
    await expect(withAuth("admin", ALICE, undefined, action)).rejects.toThrow(/not authorized to perform this admin action/);
  });

  it("passes through unrelated action errors unchanged", async () => {
    const action = vi.fn().mockRejectedValue(new Error("Insufficient token balance"));
    await expect(withAuth("admin", ALICE, undefined, action)).rejects.toThrow("Insufficient token balance");
  });
});
