/**
 * Client factory and dependency-injection pattern for the SDK (#395).
 *
 * Until now, host applications constructed each contract client directly:
 * `new RwaTokenClient(id, server, passphrase)`, repeated per contract, per
 * app. That's fine for a single script but awkward to compose (six near-
 * identical constructor calls sharing the same server/passphrase) and hard
 * to test (every consumer needs its own way to substitute a mock client).
 *
 * `createClients` builds every configured client from one config object,
 * sharing a single `rpc.Server` + network passphrase. `overrides` is the
 * escape hatch for dependency injection: pass a pre-built or mock client
 * instead of letting the factory construct one — useful for tests, or for
 * an application that wants a custom client subclass.
 *
 * @example Basic usage
 * ```ts
 * const clients = createClients({
 *   network: "testnet",
 *   contractIds: { rwaToken: "C...", kycRegistry: "C..." },
 * });
 * await clients.rwaToken?.balance(addr);
 * ```
 *
 * @example Dependency injection (testing / custom implementations)
 * ```ts
 * const fakeKyc = { isApproved: async () => true } as unknown as KycRegistryClient;
 * const clients = createClients({
 *   contractIds: { kycRegistry: "C..." },
 *   overrides: { kycRegistry: fakeKyc },
 * });
 * // clients.kycRegistry is the injected fake, never constructed for real.
 * ```
 *
 * @example ClientFactory — typed getters that throw on misconfiguration
 * ```ts
 * const factory = new ClientFactory({ network: "testnet", contractIds: { rwaToken: "C..." } });
 * const rwa = factory.get("rwaToken"); // throws a clear error if not configured
 * ```
 */

import type { rpc } from "@stellar/stellar-sdk";
import { KycRegistryClient } from "./clients/KycRegistryClient.js";
import { ComplianceEngineClient } from "./clients/ComplianceEngineClient.js";
import { InvoiceTokenClient } from "./clients/InvoiceTokenClient.js";
import { PropertyTokenClient } from "./clients/PropertyTokenClient.js";
import { CarbonTokenClient } from "./clients/CarbonTokenClient.js";
import { RwaTokenClient } from "./clients/RwaTokenClient.js";
import { createServer, NETWORK_PASSPHRASES } from "./network.js";
import type { Network } from "./types.js";

/** Every contract client the factory knows how to build, keyed by a short name. */
export interface ClientMap {
  kycRegistry: KycRegistryClient;
  complianceEngine: ComplianceEngineClient;
  invoiceToken: InvoiceTokenClient;
  propertyToken: PropertyTokenClient;
  carbonToken: CarbonTokenClient;
  rwaToken: RwaTokenClient;
}

export type ClientKey = keyof ClientMap;

type ClientCtor<K extends ClientKey> = new (
  contractId: string,
  server: rpc.Server,
  networkPassphrase: string,
) => ClientMap[K];

const CTORS: { [K in ClientKey]: ClientCtor<K> } = {
  kycRegistry: KycRegistryClient,
  complianceEngine: ComplianceEngineClient,
  invoiceToken: InvoiceTokenClient,
  propertyToken: PropertyTokenClient,
  carbonToken: CarbonTokenClient,
  rwaToken: RwaTokenClient,
};

export interface CreateClientsConfig {
  /** Used to pick a default RPC URL + passphrase when `server`/`networkPassphrase` are omitted. @default "testnet" */
  network?: Network;
  /** Inject a pre-built (or mock) RPC server instead of letting the factory create one. */
  server?: rpc.Server;
  /** Overrides the passphrase implied by `network` — needed when pairing a custom `server` with a non-standard network. */
  networkPassphrase?: string;
  /** Contract IDs to build clients for. A client is only built when its ID is present. */
  contractIds: Partial<Record<ClientKey, string>>;
  /**
   * Dependency injection escape hatch: supply a pre-built or mock client
   * instead of constructing one from `contractIds`. Takes priority over
   * `contractIds` for the same key.
   */
  overrides?: Partial<ClientMap>;
}

/**
 * Build every contract client implied by `config.contractIds` (or supplied
 * via `config.overrides`), sharing one RPC server and network passphrase.
 * Keys absent from both `contractIds` and `overrides` are omitted from the
 * result.
 */
export function createClients(config: CreateClientsConfig): Partial<ClientMap> {
  const network = config.network ?? "testnet";
  const server = config.server ?? createServer(network);
  const networkPassphrase = config.networkPassphrase ?? NETWORK_PASSPHRASES[network];

  const clients: Partial<ClientMap> = {};

  for (const key of Object.keys(CTORS) as ClientKey[]) {
    const override = config.overrides?.[key];
    if (override) {
      (clients as Record<ClientKey, unknown>)[key] = override;
      continue;
    }
    const contractId = config.contractIds[key];
    if (!contractId) continue;
    const Ctor = CTORS[key];
    (clients as Record<ClientKey, unknown>)[key] = new Ctor(contractId, server, networkPassphrase);
  }

  return clients;
}

/**
 * Thin wrapper around `createClients` offering typed, fail-fast accessors.
 * Prefer this over the raw `createClients` map when a missing client should
 * be a loud error rather than `undefined`.
 */
export class ClientFactory {
  private readonly clients: Partial<ClientMap>;

  constructor(config: CreateClientsConfig) {
    this.clients = createClients(config);
  }

  /** Returns the client for `key`, or throws if it wasn't configured. */
  get<K extends ClientKey>(key: K): ClientMap[K] {
    const client = this.clients[key];
    if (!client) {
      throw new Error(
        `Client "${key}" was not configured — pass a contract ID under contractIds.${key} ` +
          `or an instance under overrides.${key}.`,
      );
    }
    return client;
  }

  /** True when `key` was configured (via contractIds or overrides). */
  has(key: ClientKey): boolean {
    return this.clients[key] !== undefined;
  }
}
