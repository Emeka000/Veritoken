import { describe, expect, it, vi } from "vitest";
import { nativeToScVal, type rpc } from "@stellar/stellar-sdk";
import {
  ConfirmError as SdkConfirmError,
  SequenceCache as SdkSequenceCache,
  SimulationError,
  TxPipeline as SdkTxPipeline,
  buildContractTx,
  encodeAddress,
  encodeComplianceRules,
  encodeI128,
  formatContractError as sdkFormatContractError,
  parseContractError as sdkParseContractError,
  SIM_SOURCE,
  type ComplianceRules as SdkComplianceRules,
  type InvoiceMeta as SdkInvoiceMeta,
  type KycRecord as SdkKycRecord,
  type ProjectMeta as SdkProjectMeta,
  type PropertyMeta as SdkPropertyMeta,
  type RetirementReceipt as SdkRetirementReceipt,
} from "@veritoken/sdk";
import {
  ConfirmError as FrontendConfirmError,
  SequenceCache as FrontendSequenceCache,
  TxPipeline as FrontendTxPipeline,
} from "../txPipeline";
import {
  formatContractError as frontendFormatContractError,
  parseContractError as frontendParseContractError,
} from "../contractErrors";
import {
  buildTx,
  fetchSequence,
  getPipeline,
  readCall,
  resetPipeline,
  toAddress,
  toI128,
  writeCall,
} from "./base";
import { contracts } from "../contracts.ts";
import { NETWORK_PASSPHRASE } from "../stellar";
import type {
  ComplianceRules as FrontendComplianceRules,
  InvoiceMeta as FrontendInvoiceMeta,
  KycRecord as FrontendKycRecord,
  ProjectMeta as FrontendProjectMeta,
  PropertyMeta as FrontendPropertyMeta,
  RetirementReceipt as FrontendRetirementReceipt,
} from "../../types";

const CONTRACT_ID =
  "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const ALICE =
  "GBQG2SJ7MXUH34SI3MJ2I256I5UMGM2QSQZM77YFX5S6JOHXUQJEPC3A";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;

const domainTypeParity: [
  Equal<FrontendKycRecord, SdkKycRecord>,
  Equal<FrontendInvoiceMeta, SdkInvoiceMeta>,
  Equal<FrontendPropertyMeta, SdkPropertyMeta>,
  Equal<FrontendProjectMeta, SdkProjectMeta>,
  Equal<FrontendRetirementReceipt, SdkRetirementReceipt>,
  Equal<FrontendComplianceRules, SdkComplianceRules>,
] = [true, true, true, true, true, true];

function simulationServer(
  response: rpc.Api.SimulateTransactionResponse,
): rpc.Server {
  return {
    simulateTransaction: vi.fn().mockResolvedValue(response),
  } as unknown as rpc.Server;
}

describe("frontend and SDK shared contract core", () => {
  it("re-exports the exact SDK runtime classes and error helpers", () => {
    expect(FrontendTxPipeline).toBe(SdkTxPipeline);
    expect(FrontendSequenceCache).toBe(SdkSequenceCache);
    expect(FrontendConfirmError).toBe(SdkConfirmError);
    expect(frontendParseContractError).toBe(sdkParseContractError);
    expect(frontendFormatContractError).toBe(sdkFormatContractError);
  });

  it("uses one set of domain types and scalar encoders", () => {
    expect(domainTypeParity).toEqual([true, true, true, true, true, true]);
    expect(toAddress).toBe(encodeAddress);
    expect(toI128).toBe(encodeI128);
    expect(toAddress(ALICE).toXDR("base64")).toBe(
      encodeAddress(ALICE).toXDR("base64"),
    );
  });

  it("builds byte-identical operation payloads with the active passphrase", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T12:00:00Z"));
    try {
      const args = [encodeAddress(ALICE), encodeI128(2n ** 126n)];
      expect(buildTx(CONTRACT_ID, "mint", args, ALICE, "41")).toBe(
        buildContractTx(
          CONTRACT_ID,
          "mint",
          args,
          NETWORK_PASSPHRASE,
          ALICE,
          "41",
        ),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("decodes nested structures and maximum i128 values identically", async () => {
    const rules: SdkComplianceRules = {
      max_transfer_amount: 170141183460469231731687303715884105727n,
      min_holding_period: 86_400n,
      max_holders: 1_000,
      require_same_jurisdiction: true,
      paused: false,
      allowlist_mode: true,
      max_holding_period: 31_536_000n,
    };
    const nestedResponse = {
      result: { retval: encodeComplianceRules(rules) },
      latestLedger: 1,
    } as unknown as rpc.Api.SimulateTransactionResponse;
    const server = simulationServer(nestedResponse);

    const frontendValue = await readCall<SdkComplianceRules>(
      server,
      CONTRACT_ID,
      "get_rules",
      [],
    );
    const { value: sdkValue } = await new SdkTxPipeline(
      server,
      NETWORK_PASSPHRASE,
    ).read<SdkComplianceRules>(CONTRACT_ID, "get_rules", [], SIM_SOURCE);

    expect(frontendValue).toEqual(rules);
    expect(sdkValue).toEqual(rules);

    const maxI128 = rules.max_transfer_amount;
    const integerServer = simulationServer({
      result: {
        retval: nativeToScVal(maxI128, { type: "i128" }),
      },
      latestLedger: 1,
    } as unknown as rpc.Api.SimulateTransactionResponse);
    await expect(
      readCall<bigint>(
        integerServer,
        CONTRACT_ID,
        "total_supply",
        [],
      ),
    ).resolves.toBe(maxI128);
  });

  it("surfaces malformed and contract-error responses through one error class", async () => {
    const malformed = simulationServer({
      latestLedger: 1,
    } as unknown as rpc.Api.SimulateTransactionResponse);
    await expect(
      readCall(malformed, CONTRACT_ID, "get_meta", []),
    ).rejects.toBeInstanceOf(SimulationError);

    const contractFailure = simulationServer({
      error: "Error(Contract, #6)",
      latestLedger: 1,
    } as unknown as rpc.Api.SimulateTransactionResponse);
    await expect(
      readCall(contractFailure, CONTRACT_ID, "balance", []),
    ).rejects.toMatchObject({
      name: "SimulationError",
      kind: "simulation",
      detail: "Error(Contract, #6)",
    });
  });

  it("shares one server-scoped pipeline for sequence and signed-write flows", async () => {
    resetPipeline();
    const server = {
      getAccount: vi.fn().mockResolvedValue({ sequence: "17" }),
    } as unknown as rpc.Server;

    const first = getPipeline(server);
    expect(getPipeline(server)).toBe(first);
    await expect(fetchSequence(server, ALICE)).resolves.toBe("17");
    expect(first.sequenceCache.peek(ALICE)).toBe("17");

    const confirmed = {
      status: "SUCCESS",
    } as rpc.Api.GetSuccessfulTransactionResponse;
    const write = vi.spyOn(first, "write").mockResolvedValue({
      response: confirmed,
      txHash: "abc",
      confirmedInMs: 1,
      retries: 0,
    });

    await expect(
      writeCall(
        server,
        CONTRACT_ID,
        "mint",
        [encodeAddress(ALICE), encodeI128(1n)],
        ALICE,
        "17",
        async (xdr) => xdr,
      ),
    ).resolves.toBe(confirmed);
    expect(write).toHaveBeenCalledOnce();

    resetPipeline();
    expect(getPipeline(server)).not.toBe(first);
  });

  it("keeps all six frontend contract clients on the canonical facade", () => {
    expect(Object.keys(contracts).sort()).toEqual([
      "carbon",
      "compliance",
      "invoice",
      "kyc",
      "property",
      "rwa",
    ]);
  });
});
