/**
 * Authentication & authorization helpers for admin- and verifier-gated
 * Veritoken operations (#397).
 *
 * Every write on a Veritoken contract that is restricted to an admin or a
 * KYC verifier is enforced on-chain via `require_auth()` plus a role check —
 * an unauthorized caller's transaction simulation fails with a Soroban
 * `Unauthorized` (#3) contract error. That round trip (build → simulate →
 * fail) is slow and surfaces a raw, unfriendly error string.
 *
 * This module gives callers:
 * - A fast, local pre-flight check against the on-chain verifier/admin
 *   roster (`assertIsVerifier` / `assertIsAdmin`), so a wrong-caller mistake
 *   is caught before a transaction is even built.
 * - A consistent `AuthError` type distinguishing "not authorized" failures
 *   from other errors, with the role and offending address attached.
 * - `withAuth`, a single wrapper for building an authenticated call that
 *   validates the caller's address, runs an optional pre-check, executes
 *   the action, and normalizes any resulting Unauthorized error.
 *
 * On-chain enforcement always wins — nothing here replaces `require_auth()`.
 * It only saves a round trip and gives a clearer message for the common
 * "wrong caller" mistake.
 *
 * @example Host application usage
 * ```ts
 * import { KycRegistryClient, withAuth, assertIsVerifier } from "@veritoken/sdk";
 *
 * async function approveKyc(kyc: KycRegistryClient, verifier: string, subject: string, signTx: SignTx) {
 *   return withAuth("verifier", verifier, () => assertIsVerifier(kyc, verifier), () =>
 *     kyc.approve(verifier, subject, 1, 0n, "US", signTx),
 *   );
 * }
 * ```
 */

import type { KycRegistryClient } from "./clients/KycRegistryClient.js";

/** Roles recognised across Veritoken's admin/verifier workflows. */
export type Role = "admin" | "verifier";

/**
 * Thrown when a caller fails a local role pre-check, or when the underlying
 * action fails with an on-chain `Unauthorized` (#3) contract error.
 */
export class AuthError extends Error {
  constructor(
    message: string,
    /** The role the caller was expected to hold. */
    public readonly role: Role,
    /** The address that failed the check. */
    public readonly address: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/** Stellar account addresses are 56-character base32 strings starting with 'G'. */
export function isValidAddress(addr: string): boolean {
  return typeof addr === "string" && /^G[A-Z2-7]{55}$/.test(addr);
}

/** Throws `AuthError` if `addr` is not a well-formed Stellar account address. */
export function assertValidAddress(addr: string, role: Role): void {
  if (!isValidAddress(addr)) {
    throw new AuthError(`"${addr}" is not a valid Stellar address`, role, addr);
  }
}

/** Matches the Soroban `Unauthorized` (#3) contracterror shared by every Veritoken contract. */
const UNAUTHORIZED_PATTERN = /Unauthorized|Error\(Contract,\s*#3\)/;

/** True when `err`'s message looks like an on-chain Unauthorized contract error. */
export function isUnauthorizedError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  return UNAUTHORIZED_PATTERN.test(raw);
}

/**
 * Confirms `addr` is a registered KYC verifier before a verifier-gated
 * write is attempted. Reads the on-chain verifier roster via
 * `verifierListPub()` — a cheap simulation call, no signature required.
 */
export async function assertIsVerifier(
  kyc: KycRegistryClient,
  addr: string,
): Promise<void> {
  assertValidAddress(addr, "verifier");
  const verifiers = await kyc.verifierListPub();
  if (!verifiers.includes(addr)) {
    throw new AuthError(`${addr} is not a registered KYC verifier`, "verifier", addr);
  }
}

/**
 * Confirms `addr` is a registered contract admin before an admin-gated
 * write is attempted. Reads the on-chain admin roster via `getAdmins()`.
 */
export async function assertIsAdmin(
  kyc: KycRegistryClient,
  addr: string,
): Promise<void> {
  assertValidAddress(addr, "admin");
  const admins = await kyc.getAdmins();
  if (!admins.includes(addr)) {
    throw new AuthError(`${addr} is not a registered admin`, "admin", addr);
  }
}

/**
 * Runs an authenticated action with a consistent auth-checking shape:
 * 1. Validates `callerAddress` is a well-formed Stellar address.
 * 2. Runs `precheck()` if given (e.g. `assertIsVerifier`/`assertIsAdmin`) —
 *    any `AuthError` it throws propagates immediately, before touching the
 *    network.
 * 3. Runs `action()`. If it rejects with what looks like an on-chain
 *    Unauthorized error, it's re-thrown as an `AuthError` with `role` and
 *    `callerAddress` attached; any other error propagates unchanged.
 */
export async function withAuth<T>(
  role: Role,
  callerAddress: string,
  precheck: (() => Promise<void>) | undefined,
  action: () => Promise<T>,
): Promise<T> {
  assertValidAddress(callerAddress, role);
  if (precheck) await precheck();

  try {
    return await action();
  } catch (err) {
    if (isUnauthorizedError(err)) {
      const raw = err instanceof Error ? err.message : String(err);
      throw new AuthError(
        `${callerAddress} is not authorized to perform this ${role} action: ${raw}`,
        role,
        callerAddress,
      );
    }
    throw err;
  }
}
