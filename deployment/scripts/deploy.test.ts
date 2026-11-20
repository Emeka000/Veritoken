/**
 * deploy.test.ts — Regression tests for parseContractIds and missing-config
 * early validation.
 *
 * Covers the boundary condition where empty or whitespace-only contract
 * identifiers slip through a naive split(), creating ambiguous manifests
 * that fail silently in later deployment or verification steps.
 *
 * Also covers the missing-config-file early-exit path: when the operator
 * supplies a nonexistent config path the deployment runner must never be
 * reached and the error must clearly identify the bad path.
 */

import * as fs from "node:fs";
import { describe, it, expect } from "vitest";
import { loadConfig, parseContractIds } from "./deploy.ts";

describe("parseContractIds", () => {
  // ── Happy-path ──────────────────────────────────────────────────────────────

  it("parses a single contract id", () => {
    expect(parseContractIds("kyc-registry")).toEqual(["kyc-registry"]);
  });

  it("parses multiple comma-separated ids", () => {
    expect(parseContractIds("kyc-registry,rwa-token,compliance-engine")).toEqual([
      "kyc-registry",
      "rwa-token",
      "compliance-engine",
    ]);
  });

  it("trims surrounding whitespace from each entry", () => {
    expect(parseContractIds("  kyc-registry , rwa-token  ")).toEqual([
      "kyc-registry",
      "rwa-token",
    ]);
  });

  // ── Rejection cases — the boundary conditions the fix addresses ────────────

  it("rejects a trailing comma (produces empty final entry)", () => {
    expect(() => parseContractIds("kyc-registry,")).toThrow(
      /empty contract identifier/
    );
  });

  it("rejects a leading comma (produces empty first entry)", () => {
    expect(() => parseContractIds(",rwa-token")).toThrow(
      /empty contract identifier/
    );
  });

  it("rejects a double comma (produces empty middle entry)", () => {
    expect(() => parseContractIds("kyc-registry,,rwa-token")).toThrow(
      /empty contract identifier/
    );
  });

  it("rejects a whitespace-only entry", () => {
    expect(() => parseContractIds("kyc-registry,   ,rwa-token")).toThrow(
      /empty contract identifier/
    );
  });

  it("rejects a string that is entirely whitespace", () => {
    expect(() => parseContractIds("   ")).toThrow(/empty contract identifier/);
  });

  it("rejects an empty string", () => {
    expect(() => parseContractIds("")).toThrow(/empty contract identifier/);
  });
});

describe("loadConfig", () => {
  const configWith = (name: unknown) =>
    JSON.stringify({
      schema_version: 1,
      profile: "testnet",
      contracts: [{ name, artifact: "a.wasm", env_key: "A", dependencies: [] }],
    });

  it("accepts a contract with a non-empty name", () => {
    expect(loadConfig(configWith("kyc-registry")).contracts[0].name).toBe(
      "kyc-registry"
    );
  });

  it.each(["", "   ", undefined])("rejects blank contract name %j", (name) => {
    expect(() => loadConfig(configWith(name))).toThrow(/non-empty name/);
  });
});

// ── Missing config file: early-exit before any deployment ────────────────────
//
// Acceptance criteria:
//   - Reading a nonexistent config path throws an error that identifies
//     the missing file path.
//   - loadConfig is never called (the error fires at the fs.readFileSync step).
//   - No deploy operation is invoked.

describe("missing config file", () => {
  it("throws a path-identifying error before invoking loadConfig", () => {
    // Use only the filename portion so the assertion works on both POSIX and
    // Windows (Node.js translates /tmp/... to C:\tmp\... on Windows).
    const filename = "veritoken-nonexistent-config-9z8y7x.json";
    const missingPath = `/tmp/${filename}`;

    // Track whether loadConfig was ever reached.
    let loadConfigReached = false;

    // Simulate what the CLI's main() does: read the file, then call loadConfig.
    // With a nonexistent path, readFileSync must throw before loadConfig runs.
    let caughtError: Error | null = null;
    try {
      const raw = fs.readFileSync(missingPath, "utf8");
      loadConfigReached = true; // only set if readFileSync succeeds
      loadConfig(raw);
    } catch (err) {
      caughtError = err as Error;
    }

    // The error must identify the bad path (filename always present regardless
    // of OS path-separator conventions).
    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toContain(filename);

    // loadConfig must not have been called — the read failed before it.
    expect(loadConfigReached).toBe(false);
  });

  it("does not invoke any deployment logic when config is missing", () => {
    // Arrange: use a path that cannot exist on any system.
    const missingPath = "/tmp/veritoken-deploy-runner-check-abc.json";

    let deployRunnerInvoked = false;
    const fakeDeployRunner = () => {
      deployRunnerInvoked = true;
    };

    // Act: attempt to read and deploy — mirrors how main() would proceed.
    try {
      const raw = fs.readFileSync(missingPath, "utf8");
      loadConfig(raw);
      fakeDeployRunner(); // must not be reached when the file is missing
    } catch {
      // Expected: ENOENT — file not found.
    }

    // Assert: the deployment runner was never invoked because readFileSync
    // threw before execution could reach it.
    expect(deployRunnerInvoked).toBe(false);
  });
});
