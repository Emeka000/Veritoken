/**
 * Playwright globalSetup — runs once, before any spec file runs.
 *
 * There is deliberately no `webServer` entry in playwright.config.ts — this
 * function starts the Vite dev server itself, as its own last step, instead.
 * Playwright's plugin/task order (see `createGlobalSetupTasks` in
 * `node_modules/playwright/lib/runner/index.js`) runs `webServer`'s setup
 * *before* `globalSetup`, not after or concurrently with it — the opposite
 * of what this suite needs (contracts deployed, and their IDs known, before
 * the dev server that reads them starts). Configuring `webServer` with a
 * command that blocks until this function has run creates a deadlock:
 * `webServer` never becomes healthy until `globalSetup` runs, and
 * `globalSetup` never gets a turn until `webServer`'s task finishes. Owning
 * the whole environment here — Docker, contracts, and the dev server —
 * sidesteps that ordering entirely.
 *
 * Steps:
 *   1. Verify Docker is reachable (fail fast with a clear message otherwise).
 *   2. Start a fresh Stellar standalone quickstart container.
 *   3. Wait for its RPC to report healthy.
 *   4. Deploy all six contracts via SorobanTransport, using the same fixture
 *      plans tests/integration uses (fullDeploymentPlan — see
 *      tests/integration/fixtures/fixture-plans.ts).
 *   5. Write the deployed IDs to fixtures/contract-ids.json (read at runtime
 *      by chain-helpers.ts) and to frontend/.env.e2e.local.
 *   6. Start `vite --mode e2e` (which loads that env file) and wait for it
 *      to answer on E2E_PORT.
 *
 * global-teardown.ts stops both the container and the dev server this starts.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execa } from "execa";
import { spawn } from "node:child_process";
import { Networks, rpc } from "./fixtures/stellar-sdk";

import { FixtureRunner } from "../integration/fixtures/fixture-runner";
import { SorobanTransport } from "../integration/fixtures/soroban-transport";
import { createFixtureAccounts, fullDeploymentPlan, WASM_DIR } from "../integration/fixtures/fixture-plans";
import { writeContractIds, type DeployedContractIds } from "./fixtures/contract-ids";

const CONTAINER_NAME = process.env.E2E_STANDALONE_CONTAINER ?? "veritoken-e2e-standalone";
const RPC_PORT = Number(process.env.E2E_RPC_PORT ?? 8000);
const RPC_URL = `http://localhost:${RPC_PORT}/soroban/rpc`;
const DEV_SERVER_PORT = Number(process.env.E2E_PORT ?? 5173);
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;
const FRONTEND_DIR = path.resolve(import.meta.dirname, "../../frontend");
const ENV_FILE = path.join(FRONTEND_DIR, ".env.e2e.local");
const CONTAINER_NAME_FILE = path.resolve(import.meta.dirname, ".standalone-container");
const DEV_SERVER_PID_FILE = path.resolve(import.meta.dirname, ".dev-server.pid");

const REQUIRED_WASMS = [
  "kyc_registry.wasm",
  "compliance_engine.wasm",
  "rwa_token.wasm",
  "invoice_token.wasm",
  "property_token.wasm",
  "carbon_credit_token.wasm",
];

async function assertDockerIsRunning(): Promise<void> {
  try {
    await execa("docker", ["info"], { timeout: 10_000 });
  } catch (cause) {
    throw new Error(
      "Docker does not appear to be running (`docker info` failed). " +
        "The E2E suite needs Docker to start a local Stellar standalone " +
        "node — start Docker Desktop (or your Docker daemon) and try again.\n" +
        `Underlying error: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

function assertWasmsBuilt(): void {
  const missing = REQUIRED_WASMS.filter((name) => !fs.existsSync(path.join(WASM_DIR, name)));
  if (missing.length > 0) {
    throw new Error(
      `Missing WASM artifacts in ${WASM_DIR}: ${missing.join(", ")}.\n` +
        "Build the contracts first, e.g.:\n" +
        "  cargo build --target wasm32v1-none --release " +
        "-p kyc-registry -p compliance-engine -p rwa-token " +
        "-p invoice-token -p property-token -p carbon-credit-token",
    );
  }
}

async function removeContainerIfPresent(): Promise<void> {
  await execa("docker", ["rm", "--force", "--volumes", CONTAINER_NAME], { reject: false });
}

async function startStandaloneNode(): Promise<void> {
  await removeContainerIfPresent();
  await execa("docker", [
    "run",
    "--detach",
    "--name",
    CONTAINER_NAME,
    "--publish",
    `${RPC_PORT}:8000`,
    "stellar/quickstart:latest",
    "--standalone",
    "--enable-soroban-rpc",
  ]);
  fs.writeFileSync(CONTAINER_NAME_FILE, CONTAINER_NAME);
}

async function waitForHealthy(): Promise<void> {
  const deadline = Date.now() + 120_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
      });
      const body = (await response.json()) as { result?: { status?: string } };
      if (body.result?.status === "healthy") return;
      lastError = JSON.stringify(body);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }

  let logs = "";
  try {
    logs = (await execa("docker", ["logs", CONTAINER_NAME])).stdout;
  } catch {
    // best-effort
  }
  throw new Error(
    `Stellar standalone RPC at ${RPC_URL} did not become healthy in time. ` +
      `Last response: ${lastError}\n--- docker logs ${CONTAINER_NAME} ---\n${logs}`,
  );
}

async function deployContracts(): Promise<DeployedContractIds> {
  const server = new rpc.Server(RPC_URL, { allowHttp: true });
  const transport = new SorobanTransport({
    networkPassphrase: Networks.STANDALONE,
    pollIntervalMs: 250,
    rpc: server,
    transactionTimeoutMs: 30_000,
  });
  const runner = new FixtureRunner(transport, { accounts: createFixtureAccounts() });
  const context = await runner.setup(fullDeploymentPlan());

  return {
    kycRegistry: context.contract("kyc"),
    complianceEngine: context.contract("compliance"),
    rwaToken: context.contract("rwa"),
    invoiceToken: context.contract("invoice"),
    propertyToken: context.contract("property"),
    carbonToken: context.contract("carbon"),
  };
}

function writeFrontendEnv(ids: DeployedContractIds): void {
  const lines = [
    "# Generated by tests/e2e/global-setup.ts — do not edit by hand.",
    "# Loaded by the `vite --mode e2e` dev server global-setup.ts starts.",
    "VITE_STELLAR_NETWORK=standalone",
    `VITE_SOROBAN_RPC_URL=${RPC_URL}`,
    `VITE_STELLAR_NETWORK_PASSPHRASE=${Networks.STANDALONE}`,
    "VITE_RPC_ALLOW_HTTP=true",
    `VITE_KYC_REGISTRY_ID=${ids.kycRegistry}`,
    `VITE_COMPLIANCE_ENGINE_ID=${ids.complianceEngine}`,
    `VITE_INVOICE_TOKEN_ID=${ids.invoiceToken}`,
    `VITE_PROPERTY_TOKEN_ID=${ids.propertyToken}`,
    `VITE_CARBON_TOKEN_ID=${ids.carbonToken}`,
    `VITE_RWA_TOKEN_ID=${ids.rwaToken}`,
    "",
  ];
  fs.writeFileSync(ENV_FILE, lines.join("\n"));
}

/** Best-effort kill of a dev server left running by an interrupted prior run. */
async function killExistingDevServer(): Promise<void> {
  if (!fs.existsSync(DEV_SERVER_PID_FILE)) return;
  const pid = Number(fs.readFileSync(DEV_SERVER_PID_FILE, "utf-8").trim());
  if (Number.isFinite(pid)) {
    try {
      process.kill(-pid, "SIGTERM"); // whole process group — see global-teardown.ts's stopDevServer
    } catch {
      // Already gone — fine.
    }
  }
  fs.rmSync(DEV_SERVER_PID_FILE, { force: true });
}

/** Starts `vite --mode e2e`, detached, and waits until it answers on DEV_SERVER_PORT. */
async function startDevServer(): Promise<void> {
  await killExistingDevServer();

  const child = spawn(
    "npm",
    ["run", "dev", "--", "--mode", "e2e", "--port", String(DEV_SERVER_PORT), "--strictPort"],
    { cwd: FRONTEND_DIR, detached: true, stdio: "ignore", shell: true },
  );
  child.unref();
  if (child.pid) fs.writeFileSync(DEV_SERVER_PID_FILE, String(child.pid));

  const deadline = Date.now() + 60_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(DEV_SERVER_URL);
      if (response.ok || response.status === 404) return; // any HTTP response means Vite is up
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Vite dev server at ${DEV_SERVER_URL} did not respond in time. Last error: ${lastError}`);
}

export default async function globalSetup(): Promise<void> {
  console.log("[e2e:global-setup] checking Docker...");
  await assertDockerIsRunning();

  console.log("[e2e:global-setup] checking contract WASM artifacts...");
  assertWasmsBuilt();

  console.log(`[e2e:global-setup] starting Stellar standalone node (container "${CONTAINER_NAME}")...`);
  await startStandaloneNode();

  console.log("[e2e:global-setup] waiting for RPC health...");
  await waitForHealthy();

  console.log("[e2e:global-setup] deploying contracts...");
  const ids = await deployContracts();
  console.log("[e2e:global-setup] deployed:", ids);

  writeContractIds(ids);
  writeFrontendEnv(ids);
  console.log(`[e2e:global-setup] wrote fixtures/contract-ids.json and ${ENV_FILE}`);

  console.log(`[e2e:global-setup] starting the Vite dev server on port ${DEV_SERVER_PORT}...`);
  await startDevServer();
  console.log(`[e2e:global-setup] dev server is up at ${DEV_SERVER_URL}`);
}
