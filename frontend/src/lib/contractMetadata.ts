/**
 * Contract metadata discovery — frontend wrapper (#452).
 *
 * Thin adapter around the SDK's `discoverContracts` that plugs in this app's
 * configured contract IDs (`CONTRACT_IDS`) and active network, so the
 * dashboard can render "which contracts are deployed and what are they for"
 * without re-deriving the package/role table itself.
 */

import { discoverContracts, type ContractDiscoveryReport } from "@veritoken/sdk";
import { CONTRACT_IDS } from "./stellar";
import { useNetworkStore } from "./networkStore";

export function getContractDiscovery(): ContractDiscoveryReport {
  const network = useNetworkStore.getState().network;
  return discoverContracts(CONTRACT_IDS, network);
}
