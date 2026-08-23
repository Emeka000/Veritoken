/**
 * Veritoken Event Indexer — entry point.
 *
 * Startup sequence:
 *   1. Load config from env vars.
 *   2. Run database migrations.
 *   3. Start one ContractPoller per configured contract.
 *   4. Start Express REST API.
 *   5. Handle SIGTERM / SIGINT for graceful shutdown.
 */

import express from "express";
import { rpc } from "@stellar/stellar-sdk";
import { loadConfig } from "./config.js";
import { runMigrations } from "./db/migrate.js";
import { pool } from "./db/pool.js";
import { ContractPoller } from "./poller.js";
import { buildRouter } from "./api/routes.js";

async function main(): Promise<void> {
  const config = loadConfig();

  console.log("[indexer] Starting Veritoken Event Indexer");
  console.log(`[indexer] RPC URL:    ${config.rpcUrl}`);
  console.log(`[indexer] Network:    ${config.networkPassphrase.split(";")[0].trim()}`);
  console.log(`[indexer] Poll ms:    ${config.pollIntervalMs}`);
  console.log(`[indexer] Contracts:  ${config.contracts.length}`);

  // ── Migrations ────────────────────────────────────────────────────────────
  console.log("[indexer] Running migrations…");
  await runMigrations();

  // ── RPC server ────────────────────────────────────────────────────────────
  const server = new rpc.Server(config.rpcUrl, { allowHttp: true });

  // ── Pollers ───────────────────────────────────────────────────────────────
  const pollers = new Map<string, ContractPoller>();

  for (const contract of config.contracts) {
    const poller = new ContractPoller(server, contract, config.pollIntervalMs);
    pollers.set(contract.contractId, poller);
    poller.start();
  }

  if (config.contracts.length === 0) {
    console.warn("[indexer] No contracts configured — set CONTRACT_IDS env var");
  }

  // ── HTTP API ──────────────────────────────────────────────────────────────
  const app = express();
  app.use(express.json());
  app.use("/", buildRouter(pollers));

  const httpServer = app.listen(config.port, () => {
    console.log(`[indexer] REST API listening on port ${config.port}`);
  });

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[indexer] Received ${signal} — shutting down…`);
    for (const poller of pollers.values()) {
      poller.stop();
    }
    httpServer.close();
    await pool.end();
    console.log("[indexer] Shutdown complete.");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT",  () => void shutdown("SIGINT"));
}

main().catch((err: Error) => {
  console.error("[indexer] Fatal startup error:", err.message);
  process.exit(1);
});
