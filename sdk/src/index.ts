// ── Contract clients ──────────────────────────────────────────────────────────
export { KycRegistryClient } from "./clients/KycRegistryClient.js";
export { ComplianceEngineClient } from "./clients/ComplianceEngineClient.js";
export { InvoiceTokenClient } from "./clients/InvoiceTokenClient.js";
export { PropertyTokenClient } from "./clients/PropertyTokenClient.js";
export { CarbonTokenClient } from "./clients/CarbonTokenClient.js";
export { RwaTokenClient } from "./clients/RwaTokenClient.js";

// Core transaction builder and read/write primitives
export {
  buildContractTx,
  simulateRead,
  submitContractTx,
  fetchAccountSequence,
  BaseContractClient,
  decodeScVal,
  SIM_SOURCE,
} from "./clients/base.js";
export type { SignTx, BuildTxOptions } from "./clients/base.js";

// Scalar and struct ScVal encoders
export {
  encodeAddress,
  encodeU32,
  encodeU64,
  encodeI128,
  encodeString,
  encodeBool,
  encodeSymbol,
  encodeComplianceRules,
  encodeTierPolicy,
  encodeRiskConfig,
  encodeInvoiceMeta,
  encodePropertyMeta,
  encodeProjectMeta,
} from "./codec.js";

// Typed error model
export {
  lookupError,
  parseContractError,
  formatContractError,
} from "./errors.js";
export type { ContractError, ContractName } from "./errors.js";

// ── Multi-network configuration (#394) ──────────────────────────────────────────
export {
  createServer, RPC_URLS, NETWORK_PASSPHRASES, KNOWN_NETWORKS,
  isValidNetwork, resolveNetworkConfig, InvalidNetworkConfigError,
} from "./network.js";
export type { NetworkConfig, NetworkOverrides } from "./network.js";

// ── Domain types ──────────────────────────────────────────────────────────────
export type {
  KycStatus, KycRecord, InvoiceMeta, PropertyMeta, ProjectMeta,
  RetirementReceipt, ComplianceRules, TokenExportMetadata,
  TierPolicy, RiskConfig, KycStatusMirror, KycSyncStatus, Network,
} from "./types.js";

// ── Events ────────────────────────────────────────────────────────────────────
export {
  TOPIC_TRANSFER, TOPIC_MINT, TOPIC_BURN, TOPIC_APPROVE,
  TOPIC_FREEZE, TOPIC_UNFREEZE, TOPIC_ADMIN_PROPOSED, TOPIC_ADMIN_SET,
  TOPIC_KYC_UPDATED, TOPIC_CE_UPDATED, TOPIC_RULES_PROPOSED,
  TOPIC_RULES_ACTIVATED, TOPIC_RULES_SET, TOPIC_PAUSED, TOPIC_UNPAUSED,
  TOPIC_BLOCKED, TOPIC_JUR_ADDED, TOPIC_JUR_REMOVED,
  TOPIC_AL_ADDED, TOPIC_AL_REMOVED, TOPIC_KYC_APPROVED, TOPIC_KYC_REVOKED,
  TOPIC_VERIFIER_ADDED, TOPIC_VERIFIER_REMOVED, TOPIC_RETIRED,
  TOPIC_MIGRATED, TOPIC_RECOVERY_CONFIGURED, TOPIC_RECOVERY_PROPOSED,
  TOPIC_RECOVERY_APPROVED, TOPIC_RECOVERY_EXECUTED, TOPIC_RECOVERY_CANCELLED,
} from "./events.js";
export type {
  TransferEventData, MintEventData, BurnEventData, ApproveEventData,
  FreezeEventData, AdminProposedEventData, AdminSetEventData,
  KycUpdatedEventData, CeUpdatedEventData, RoleAssignedEventData,
  RoleRevokedEventData, KycStaleEventData, MigrationEventData,
  RecoveryApprovedEventData, RecoveryExecutedEventData,
} from "./events.js";

// ── Typed event parsing (#393) ──────────────────────────────────────────────────
export { parseEvent, parseEvents, filterByName } from "./eventParser.js";
export type {
  ParsedEvent, KnownParsedEvent, UnknownParsedEvent, EventDataMap, KnownEventName,
} from "./eventParser.js";
export type { GetContractEventsOptions } from "./clients/base.js";

// ── Auth helpers (#397) ─────────────────────────────────────────────────────────
export {
  isValidAddress, assertValidAddress, isUnauthorizedError,
  assertIsVerifier, assertIsAdmin, withAuth, AuthError,
} from "./auth.js";
export type { Role } from "./auth.js";

// ── Client factory & dependency injection (#395) ────────────────────────────────
export { createClients, ClientFactory } from "./factory.js";
export type { ClientMap, ClientKey, CreateClientsConfig } from "./factory.js";

// Note: the mock RPC test harness (#396, sdk/src/testing/mockRpc.ts) is
// intentionally NOT re-exported here. It imports `vi` from vitest (a
// devDependency), and this file is the package's public production entry
// point — exporting it here would pull vitest into every consumer's runtime
// dependency graph. It's used directly (via relative import) by the SDK's
// own test suite; see sdk/src/clients/*.test.ts for usage examples.
