/**
 * Load and validate indexer configuration from environment variables.
 *
 * Required env vars:
 *   DATABASE_URL  or  PGHOST + PGDATABASE + PGUSER + PGPASSWORD
 *   RPC_URL          — Soroban RPC endpoint
 *
 * Optional:
 *   NETWORK_PASSPHRASE  — defaults to testnet
 *   POLL_INTERVAL_MS    — defaults to 5000
 *   PORT                — HTTP port, defaults to 3001
 *   CONTRACT_IDS        — comma-separated list of "label:contractId" pairs
 *                         e.g. "rwa:C…,kyc:C…"
 */

import type { IndexerConfig, ContractConfig } from "./types.js";

const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const MAINNET_PASSPHRASE = "Public Global Stellar Network ; September 2015";

function parseContracts(raw: string): ContractConfig[] {
  if (!raw.trim()) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const colonIdx = entry.indexOf(":");
      if (colonIdx === -1) {
        return { label: entry, contractId: entry };
      }
      return {
        label:      entry.slice(0, colonIdx).trim(),
        contractId: entry.slice(colonIdx + 1).trim(),
      };
    })
    .filter((c) => c.contractId.length > 0);
}

export function loadConfig(): IndexerConfig {
  const rpcUrl = process.env.RPC_URL ?? process.env.STELLAR_RPC_URL;
  if (!rpcUrl) {
    throw new Error("RPC_URL environment variable is required");
  }

  const rawPassphrase = process.env.NETWORK_PASSPHRASE ?? process.env.STELLAR_NETWORK_PASSPHRASE;
  let networkPassphrase: string;
  if (rawPassphrase) {
    networkPassphrase = rawPassphrase;
  } else {
    const network = (process.env.STELLAR_NETWORK ?? "testnet").toLowerCase();
    networkPassphrase = network === "mainnet" ? MAINNET_PASSPHRASE : TESTNET_PASSPHRASE;
  }

  const pollIntervalMs = parseInt(process.env.POLL_INTERVAL_MS ?? "5000", 10);
  const port           = parseInt(process.env.PORT ?? "3001", 10);
  const contracts      = parseContracts(process.env.CONTRACT_IDS ?? "");

  return { rpcUrl, networkPassphrase, pollIntervalMs, contracts, port };
}
