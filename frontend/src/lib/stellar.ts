import { Networks, TransactionBuilder, rpc, scValToNative } from "@stellar/stellar-sdk";
import { useNetworkStore, getNetworkRpcUrl } from "./networkStore";
import type { ContractEvent } from "../types";

export const getNetwork = () => useNetworkStore.getState().network;

/** Returns true if the given string is a valid Stellar Ed25519 public key (G…). */
export function validateStellarAddress(addr: string): boolean {
  if (!addr || typeof addr !== "string") return false;
  // Stellar public keys are 56-character base32 strings starting with 'G'
  return /^G[A-Z2-7]{55}$/.test(addr);
}

export const getRpcUrl = () => {
  const network = getNetwork();
  return getNetworkRpcUrl(network);
};

export const getNetworkPassphrase = () => {
  const network = getNetwork();
  return network === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
};

export const getServer = () => new rpc.Server(getRpcUrl(), { allowHttp: false });

// For backwards compatibility, export these as functions that return the current values
export const NETWORK = getNetwork();
export const RPC_URL = getRpcUrl();
export const NETWORK_PASSPHRASE = getNetworkPassphrase();
export const server = getServer();

export const CONTRACT_IDS = {
  kycRegistry: import.meta.env.VITE_KYC_REGISTRY_ID ?? "",
  complianceEngine: import.meta.env.VITE_COMPLIANCE_ENGINE_ID ?? "",
  invoiceToken: import.meta.env.VITE_INVOICE_TOKEN_ID ?? "",
  propertyToken: import.meta.env.VITE_PROPERTY_TOKEN_ID ?? "",
  carbonToken: import.meta.env.VITE_CARBON_TOKEN_ID ?? "",
  rwaToken: import.meta.env.VITE_RWA_TOKEN_ID ?? "",
};

/** Soroban contract IDs are 56-character strings starting with 'C'. */
export function isValidContractId(id: string): boolean {
  return typeof id === "string" && /^C[A-Z2-7]{55}$/.test(id);
}

export interface ContractIdVerificationResult {
  valid: boolean;
  /** IDs that are missing (empty string) for the selected network. */
  missing: string[];
  /** IDs present but not matching the expected Soroban format. */
  malformed: string[];
}

/**
 * Verify that every contract ID required for the active network is present and
 * well-formed before a transaction is prepared or signed.
 *
 * Pass an optional subset of keys to check only the contracts involved in a
 * specific operation. Omitting `keys` checks all registered contract IDs.
 */
export function verifyContractIds(
  keys?: (keyof typeof CONTRACT_IDS)[],
): ContractIdVerificationResult {
  const toCheck = keys ?? (Object.keys(CONTRACT_IDS) as (keyof typeof CONTRACT_IDS)[]);
  const missing: string[] = [];
  const malformed: string[] = [];

  for (const key of toCheck) {
    const id = CONTRACT_IDS[key];
    if (!id) {
      missing.push(key);
    } else if (!isValidContractId(id)) {
      malformed.push(key);
    }
  }

  return { valid: missing.length === 0 && malformed.length === 0, missing, malformed };
}

/**
 * Throws a descriptive error when required contract IDs are absent or malformed.
 * Call this at the top of any write path before building or signing a transaction.
 */
export function assertContractIds(keys?: (keyof typeof CONTRACT_IDS)[]): void {
  const result = verifyContractIds(keys);
  if (result.valid) return;

  const parts: string[] = [];
  if (result.missing.length > 0) {
    parts.push(`Missing contract IDs: ${result.missing.join(", ")}. Check your environment variables.`);
  }
  if (result.malformed.length > 0) {
    parts.push(`Malformed contract IDs: ${result.malformed.join(", ")}. IDs must be 56-character Soroban addresses starting with 'C'.`);
  }
  throw new Error(parts.join(" "));
}

// Error code tables matching each contract's #[contracterror] enum discriminants.
const KYC_ERRORS: Record<number, string> = {
  1: "Contract already initialized",
  2: "Not an authorized verifier",
  3: "KYC not approved",
  4: "No KYC record found",
};

const COMPLIANCE_ERRORS: Record<number, string> = {
  1: "Contract already initialized",
};

const INVOICE_ERRORS: Record<number, string> = {
  1: "Contract already initialized",
  2: "Invoice already settled",
  3: "Invoice not yet settled",
  4: "Insufficient balance",
  5: "Negative amount",
  6: "Insufficient allowance",
  7: "Allowance expired",
  8: "KYC not approved",
  9: "Redemption blocked: compliance paused",
  10: "Redemption blocked: holder is blocklisted",
  11: "Transfer blocked by compliance engine",
};

const RWA_ERRORS: Record<number, string> = {
  1: "Contract already initialized",
  2: "KYC not approved",
  3: "Transfer blocked by compliance engine",
  4: "Insufficient balance",
  5: "Allowance expiration ledger is in the past",
  6: "Insufficient allowance",
};

const PROPERTY_ERRORS: Record<number, string> = {
  1: "Contract already initialized",
  2: "Shares must be positive",
  3: "Insufficient shares",
  4: "No shares issued",
  5: "KYC not approved",
  6: "KYC tier below property requirement",
  7: "Mint blocked: compliance paused",
  8: "Mint recipient is blocklisted",
  9: "Transfer blocked by compliance engine",
};

const CARBON_ERRORS: Record<number, string> = {
  1: "Contract already initialized",
  2: "Insufficient balance",
  3: "KYC not approved",
  4: "Mint blocked: compliance paused",
  5: "Mint recipient is blocklisted",
  6: "Transfer blocked by compliance engine",
};

type ContractType =
  | "kyc"
  | "compliance"
  | "invoice"
  | "rwa"
  | "property"
  | "carbon";

const ERROR_TABLES: Record<ContractType, Record<number, string>> = {
  kyc: KYC_ERRORS,
  compliance: COMPLIANCE_ERRORS,
  invoice: INVOICE_ERRORS,
  rwa: RWA_ERRORS,
  property: PROPERTY_ERRORS,
  carbon: CARBON_ERRORS,
};

const DEFAULT_EVENT_LOOKBACK_LEDGERS = 10_000;

export interface FetchContractEventsOptions {
  limit?: number;
  /** Ledger to begin scanning from. Defaults to a recent bounded lookback. */
  startLedger?: number;
  /** Soroban RPC paging cursor returned as `pagingToken` on previous events. */
  cursor?: string;
  eventType?: rpc.Api.EventType;
  /** Optional Soroban RPC topic filters, encoded as RPC topic strings. */
  topicFilters?: string[][];
  successfulOnly?: boolean;
  lookbackLedgers?: number;
}

type NativeValue = string | number | boolean | null | NativeValue[] | { [key: string]: NativeValue };

/**
 * Decodes a numeric Soroban contract error code into a human-readable message.
 * The contractType identifies which contract's error table to look up.
 */
export function decodeContractError(
  contractType: ContractType,
  code: number,
): string {
  return (
    ERROR_TABLES[contractType]?.[code] ??
    `Unknown contract error (type=${contractType}, code=${code})`
  );
}

/**
 * Legacy entry point — delegates to the TxPipeline so callers immediately
 * benefit from retry logic, sequence caching, and structured errors.
 *
 * The XDR passed in is an already-built (but not yet simulated) transaction.
 * The pipeline simulates it, assembles, signs, submits, and polls.
 */
export async function simulateAndSend(
  xdrStr: string,
  signTx: (xdr: string) => Promise<string>,
): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
  // Decode the contract + method from the pre-built XDR so the pipeline can
  // rebuild it with the correct sequence number managed by the sequence cache.
  // For legacy callers that pass an already-built XDR we fall back to the
  // direct simulate-assemble-sign-submit path with a one-shot pipeline.
  const tx = TransactionBuilder.fromXDR(xdrStr, NETWORK_PASSPHRASE);
  const activeServer = getServer();

  // Simulate
  const simResult = await activeServer.simulateTransaction(tx);

  if (rpc.Api.isSimulationError(simResult)) {
    const errorMsg = simResult.error;
    const codeMatch = errorMsg.match(/\(code=(\d+)\)/);
    if (codeMatch) {
      const code = parseInt(codeMatch[1], 10);
      throw new Error(`Contract error: ${decodeContractError("rwa", code)}`);
    }
    throw new Error(`Simulation failed: ${errorMsg}`);
  }

  // Assemble
  const prepared = rpc
    .assembleTransaction(tx, simResult)
    .build()
    .toXDR();

  // Sign
  const signed = await signTx(prepared);
  if (!signed) throw new Error("Signing returned empty XDR");

  // Submit
  const result = await activeServer.sendTransaction(
    TransactionBuilder.fromXDR(signed, NETWORK_PASSPHRASE),
  );

  if (result.status === "ERROR") {
    throw new Error(`Transaction failed: ${JSON.stringify(result.errorResult)}`);
  }

  // Poll with timeout
  const deadline = Date.now() + 60_000;
  let getResult = await activeServer.getTransaction(result.hash);
  while (getResult.status === "NOT_FOUND") {
    if (Date.now() >= deadline) {
      throw new Error(`Confirmation of ${result.hash} timed out`);
    }
    await new Promise((r) => setTimeout(r, 1500));
    getResult = await activeServer.getTransaction(result.hash);
  }

  if (getResult.status !== "SUCCESS") {
    throw new Error(`Transaction not successful: ${getResult.status}`);
  }

  return getResult as rpc.Api.GetSuccessfulTransactionResponse;
}

function toSerializable(value: unknown): NativeValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (["string", "number", "boolean"].includes(typeof value)) return value as NativeValue;
  if (Array.isArray(value)) return value.map(toSerializable);
  if (value instanceof Uint8Array) {
    return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, val]) => [
        key,
        toSerializable(val),
      ]),
    );
  }
  return String(value);
}

function decodeEventValue(value: unknown): NativeValue {
  try {
    return toSerializable(scValToNative(value as never));
  } catch {
    return toSerializable(value);
  }
}

function firstString(values: NativeValue[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
    if (Array.isArray(value)) {
      const found = firstString(value);
      if (found) return found;
    }
    if (value && typeof value === "object") {
      const found = firstString(Object.values(value));
      if (found) return found;
    }
  }
  return undefined;
}

function firstCounterparty(value: NativeValue): string | undefined {
  if (typeof value === "string" && /^G[A-Z2-7]{55}$/.test(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstCounterparty(item);
      if (found) return found;
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, NativeValue>;
    const preferredKeys = ["counterparty", "to", "from", "issuer", "debtor", "verifier", "retiree", "beneficiary"];
    for (const key of preferredKeys) {
      const found = firstCounterparty(record[key]);
      if (found) return found;
    }
    for (const item of Object.values(record)) {
      const found = firstCounterparty(item);
      if (found) return found;
    }
  }
  return undefined;
}

function firstAmount(value: NativeValue): string | undefined {
  if (typeof value === "number") return String(value);
  if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstAmount(item);
      if (found) return found;
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, NativeValue>;
    const preferredKeys = ["amount", "shares", "face_value", "faceValue", "value"];
    for (const key of preferredKeys) {
      const found = firstAmount(record[key]);
      if (found) return found;
    }
    for (const item of Object.values(record)) {
      const found = firstAmount(item);
      if (found) return found;
    }
  }
  return undefined;
}

function contractIdToString(contractId: unknown): string | undefined {
  if (!contractId) return undefined;
  if (typeof contractId === "string") return contractId;
  if (typeof contractId === "object" && "contractId" in contractId) {
    try {
      return (contractId as { contractId: () => string }).contractId();
    } catch {
      // fall through to toString
    }
  }
  return String(contractId);
}

export function normalizeContractEvent(event: rpc.Api.EventResponse): ContractEvent {
  const topics = event.topic.map(decodeEventValue);
  const value = decodeEventValue(event.value);
  const type = firstString(topics) ?? event.type;
  const args = Array.isArray(value) ? value : [value];

  return {
    id: event.id,
    type,
    amount: firstAmount(value) ?? "—",
    counterparty: firstCounterparty(value) ?? firstString(args) ?? "—",
    timestamp: event.ledgerClosedAt,
    contractId: contractIdToString(event.contractId),
    ledger: event.ledger,
    txHash: event.txHash,
    pagingToken: event.pagingToken,
    topics: topics.map((topic) =>
      typeof topic === "string" ? topic : JSON.stringify(topic),
    ),
    args,
    value,
    inSuccessfulContractCall: event.inSuccessfulContractCall,
  };
}

/**
 * Fetch recent Soroban contract events for a contract ID and normalize them for UI use.
 *
 * Existing pages can call `fetchContractEvents(contractId, 10)`. More specific
 * callers can pass a query object with ledger/cursor/topic filters for paginated
 * event-index views.
 */
export async function fetchContractEvents(
  contractId: string,
  limitOrOptions: number | FetchContractEventsOptions = 10,
): Promise<ContractEvent[]> {
  if (!contractId) return [];

  const options =
    typeof limitOrOptions === "number"
      ? { limit: limitOrOptions }
      : limitOrOptions;
  const eventLimit = Math.max(1, Math.min(options.limit ?? 10, 100));
  const successfulOnly = options.successfulOnly ?? true;
  const request: rpc.Server.GetEventsRequest = {
    limit: eventLimit,
    filters: [
      {
        type: options.eventType ?? "contract",
        contractIds: [contractId],
        ...(options.topicFilters ? { topics: options.topicFilters } : {}),
      },
    ],
  };

  if (options.cursor) {
    request.cursor = options.cursor;
  } else {
    const activeServer = getServer();
    const latestLedger = await activeServer.getLatestLedger();
    request.startLedger =
      options.startLedger ??
      Math.max(
        0,
        latestLedger.sequence -
          (options.lookbackLedgers ?? DEFAULT_EVENT_LOOKBACK_LEDGERS),
      );
  }

  const response = await getServer().getEvents(request);
  const events = successfulOnly
    ? response.events.filter((event) => event.inSuccessfulContractCall)
    : response.events;

  return events.slice(0, eventLimit).map(normalizeContractEvent);
}
