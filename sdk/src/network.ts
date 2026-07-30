/**
 * Multi-network configuration for the SDK (#394, custom networks #451).
 *
 * Host applications need to target different Stellar/Soroban networks
 * (testnet during development, mainnet in production, futurenet or a local
 * standalone node for contract work) — or a fully custom network/RPC of
 * their own (a private Soroban node, a forked testnet, CI infrastructure) —
 * without editing SDK call sites. This module resolves a full
 * `NetworkConfig` (RPC URL + passphrase + transport) from three layers, in
 * priority order:
 *
 *   1. Explicit overrides passed by the caller
 *   2. Environment variables (Node `process.env`, or Vite's `VITE_`-prefixed
 *      equivalents for frontend builds)
 *   3. Built-in defaults for the four known networks
 *
 * `resolveNetworkConfig` validates the result — plaintext-HTTP RPC URLs on a
 * network that doesn't expect them raise `InvalidNetworkConfigError`, and an
 * unrecognized network name is only accepted when both `rpcUrl` and
 * `networkPassphrase` are supplied explicitly (there's no built-in default to
 * fall back to for a name the SDK doesn't know) — so misconfiguration fails
 * fast instead of surfacing as an opaque RPC error later.
 *
 * @example Switch networks with no code changes
 * ```ts
 * // Reads VERITOKEN_NETWORK / STELLAR_NETWORK / VITE_STELLAR_NETWORK.
 * const config = resolveNetworkConfig();
 * const server = createServer(config);
 * ```
 *
 * @example Explicit override, e.g. a local standalone node
 * ```ts
 * const server = createServer({
 *   network: "standalone",
 *   rpcUrl: "http://localhost:8000/soroban/rpc",
 * });
 * ```
 *
 * @example A fully custom network (any name works, given rpcUrl + networkPassphrase)
 * ```ts
 * const server = createServer({
 *   network: "my-private-devnet",
 *   rpcUrl: "https://rpc.my-devnet.internal",
 *   networkPassphrase: "My Private Devnet ; 2026",
 * });
 * ```
 */

import { Networks, rpc } from "@stellar/stellar-sdk";
import type { KnownNetwork, Network } from "./types.js";

// ── Known networks and their defaults ───────────────────────────────────────────

/** Every network the SDK ships built-in defaults for. */
export const KNOWN_NETWORKS: readonly KnownNetwork[] = [
  "testnet",
  "mainnet",
  "futurenet",
  "standalone",
];

export const RPC_URLS: Record<KnownNetwork, string> = {
  testnet: "https://soroban-testnet.stellar.org",
  mainnet: "https://mainnet.sorobanrpc.com",
  futurenet: "https://rpc-futurenet.stellar.org",
  standalone: "http://localhost:8000/soroban/rpc",
};

export const NETWORK_PASSPHRASES: Record<KnownNetwork, string> = {
  testnet: Networks.TESTNET,
  mainnet: Networks.PUBLIC,
  futurenet: Networks.FUTURENET,
  standalone: Networks.STANDALONE,
};

/** Networks whose default RPC endpoint is a local/ephemeral node reached over plain HTTP. */
const ALLOW_HTTP_NETWORKS: ReadonlySet<KnownNetwork> = new Set(["standalone"]);

/** True if `value` is one of `KNOWN_NETWORKS`. Doubles as a type guard. */
export function isValidNetwork(value: string): value is KnownNetwork {
  return (KNOWN_NETWORKS as readonly string[]).includes(value);
}

// ── Errors ───────────────────────────────────────────────────────────────────

export class InvalidNetworkConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidNetworkConfigError";
  }
}

// ── Environment resolution ────────────────────────────────────────────────────

/**
 * Reads the first defined env var among `names`. Safe under bundlers/browsers
 * where `process` doesn't exist — `typeof process` never throws even when the
 * binding is entirely absent.
 */
function readEnv(...names: string[]): string | undefined {
  const env: Record<string, string | undefined> =
    typeof process !== "undefined" && process.env ? process.env : {};
  for (const name of names) {
    const value = env[name];
    if (value) return value;
  }
  return undefined;
}

// ── Config resolution ─────────────────────────────────────────────────────────

export interface NetworkOverrides {
  /** Network to target. @default env var, then "testnet" */
  network?: Network;
  /** Overrides the default RPC URL for the resolved network. */
  rpcUrl?: string;
  /** Overrides the default network passphrase for the resolved network. */
  networkPassphrase?: string;
  /** Allow plaintext HTTP to the RPC endpoint. @default true only for "standalone" */
  allowHttp?: boolean;
}

export interface NetworkConfig {
  network: Network;
  rpcUrl: string;
  networkPassphrase: string;
  allowHttp: boolean;
}

/**
 * Resolve a full `NetworkConfig` from explicit overrides, environment
 * variables, and built-in defaults, validating the result.
 *
 * Env vars consulted (first match wins), for each field:
 * - network: `VERITOKEN_NETWORK`, `STELLAR_NETWORK`, `VITE_STELLAR_NETWORK`
 * - rpcUrl: `VERITOKEN_RPC_URL`, `SOROBAN_RPC_URL`, `VITE_SOROBAN_RPC_URL`
 * - networkPassphrase: `VERITOKEN_NETWORK_PASSPHRASE`, `STELLAR_NETWORK_PASSPHRASE`, `VITE_STELLAR_NETWORK_PASSPHRASE`
 * - allowHttp: `VERITOKEN_RPC_ALLOW_HTTP` (`"true"` / `"false"`)
 *
 * @throws InvalidNetworkConfigError if the network name is unrecognized and
 * no explicit `rpcUrl` + `networkPassphrase` pair was supplied to configure
 * it as a custom network, if `rpcUrl`/`networkPassphrase` resolve to an
 * empty string, or if the resolved RPC URL is plain HTTP on a network that
 * doesn't allow it.
 */
export function resolveNetworkConfig(overrides: NetworkOverrides = {}): NetworkConfig {
  const networkName =
    overrides.network ??
    readEnv("VERITOKEN_NETWORK", "STELLAR_NETWORK", "VITE_STELLAR_NETWORK") ??
    "testnet";

  const explicitRpcUrl =
    overrides.rpcUrl ?? readEnv("VERITOKEN_RPC_URL", "SOROBAN_RPC_URL", "VITE_SOROBAN_RPC_URL");
  const explicitPassphrase =
    overrides.networkPassphrase ??
    readEnv("VERITOKEN_NETWORK_PASSPHRASE", "STELLAR_NETWORK_PASSPHRASE", "VITE_STELLAR_NETWORK_PASSPHRASE");

  const known = isValidNetwork(networkName);
  if (!known && !(explicitRpcUrl && explicitPassphrase)) {
    throw new InvalidNetworkConfigError(
      `Unknown network "${networkName}". Expected one of: ${KNOWN_NETWORKS.join(", ")}, ` +
        `or supply both rpcUrl and networkPassphrase to configure it as a custom network.`,
    );
  }

  const rpcUrl = explicitRpcUrl ?? RPC_URLS[networkName as KnownNetwork];
  const networkPassphrase = explicitPassphrase ?? NETWORK_PASSPHRASES[networkName as KnownNetwork];

  if (!rpcUrl.trim()) {
    throw new InvalidNetworkConfigError("rpcUrl cannot be empty.");
  }
  if (!networkPassphrase.trim()) {
    throw new InvalidNetworkConfigError("networkPassphrase cannot be empty.");
  }

  let allowHttp: boolean;
  if (overrides.allowHttp !== undefined) {
    allowHttp = overrides.allowHttp;
  } else {
    const envAllowHttp = readEnv("VERITOKEN_RPC_ALLOW_HTTP");
    allowHttp = envAllowHttp !== undefined ? envAllowHttp === "true" : known && ALLOW_HTTP_NETWORKS.has(networkName as KnownNetwork);
  }

  if (!allowHttp && rpcUrl.startsWith("http://")) {
    throw new InvalidNetworkConfigError(
      `RPC URL "${rpcUrl}" uses plain HTTP, which is rejected for network "${networkName}". ` +
        `Pass { allowHttp: true } (or set VERITOKEN_RPC_ALLOW_HTTP=true) if this is intentional, ` +
        `e.g. a local standalone node.`,
    );
  }

  return { network: networkName, rpcUrl, networkPassphrase, allowHttp };
}

/**
 * Build an `rpc.Server` for a network. Accepts either a bare `Network` name
 * (uses built-in defaults + env overrides) or a partial `NetworkOverrides`
 * object for full control.
 */
export function createServer(config: Network | NetworkOverrides = {}): rpc.Server {
  const resolved =
    typeof config === "string" ? resolveNetworkConfig({ network: config }) : resolveNetworkConfig(config);
  return new rpc.Server(resolved.rpcUrl, { allowHttp: resolved.allowHttp });
}
