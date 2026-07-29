/**
 * Backward-compatible frontend exports for the SDK's canonical contract-error
 * model. Keeping a single table prevents the UI and SDK from decoding the same
 * Soroban error code differently.
 */
export {
  lookupError,
  parseContractError,
  formatContractError,
} from "@veritoken/sdk";

export type {
  ContractError,
  ContractName,
} from "@veritoken/sdk";
