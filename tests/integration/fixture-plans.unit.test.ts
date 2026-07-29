import { createHash } from "node:crypto";

import { Address, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import {
  FixtureRunner,
  type DeployContractRequest,
  type FixtureTransport,
  type InvokeContractRequest,
  type UploadWasmRequest,
} from "./fixtures/fixture-runner";
import {
  complianceFixturePlan,
  createFixtureAccounts,
  invoiceFixturePlan,
  kycFixturePlan,
  rwaFixturePlan,
} from "./fixtures/fixture-plans";

class PlanTransport implements FixtureTransport {
  readonly deployments: DeployContractRequest[] = [];
  readonly invocations: InvokeContractRequest[] = [];

  async uploadWasm(request: UploadWasmRequest): Promise<string> {
    return createHash("sha256").update(request.wasmPath).digest("hex");
  }

  async deployContract(request: DeployContractRequest): Promise<string> {
    this.deployments.push(request);
    return Address.contract(
      createHash("sha256").update(request.label).digest(),
    ).toString();
  }

  async invokeContract(request: InvokeContractRequest): Promise<xdr.ScVal> {
    this.invocations.push(request);
    return xdr.ScVal.scvVoid();
  }
}

const setupPlan = async (
  plan: ReturnType<typeof kycFixturePlan>,
): Promise<{
  contextOrder: string[];
  transport: PlanTransport;
}> => {
  const transport = new PlanTransport();
  const runner = new FixtureRunner(transport, {
    accounts: createFixtureAccounts(),
    idFactory: (name) => `${name}-test`,
    logger: {
      error: () => undefined,
      info: () => undefined,
    },
  });
  const context = await runner.setup(plan);
  return {
    contextOrder: [...context.deployedOrder],
    transport,
  };
};

describe("integration fixture plans", () => {
  it("initializes a KYC fixture with one reusable verifier account", async () => {
    const { contextOrder, transport } = await setupPlan(kycFixturePlan());

    expect(contextOrder).toEqual(["kyc"]);
    expect(transport.invocations).toHaveLength(1);
    expect(transport.invocations[0]).toMatchObject({
      label: "kyc-lifecycle/kyc.add_verifier",
      method: "add_verifier",
    });
  });

  it("deploys compliance only after KYC", async () => {
    const { contextOrder, transport } = await setupPlan(
      complianceFixturePlan(),
    );

    expect(contextOrder).toEqual(["kyc", "compliance"]);
    expect(transport.deployments[1].constructorArgs).toHaveLength(2);
  });

  it("deploys the complete RWA dependency chain with typed constructor args", async () => {
    const { contextOrder, transport } = await setupPlan(rwaFixturePlan());

    expect(contextOrder).toEqual(["kyc", "compliance", "rwa"]);
    expect(transport.deployments[2].constructorArgs).toHaveLength(8);
    expect(transport.deployments[2].constructorArgs[2].str().toString()).toBe(
      "Veritoken RWA",
    );
  });

  it("deploys invoice after KYC and compliance with initial metadata", async () => {
    const { contextOrder, transport } = await setupPlan(invoiceFixturePlan());

    expect(contextOrder).toEqual(["kyc", "compliance", "invoice"]);
    const invoiceArgs = transport.deployments[2].constructorArgs;
    expect(invoiceArgs).toHaveLength(4);
    expect(invoiceArgs[3].map()).toHaveLength(10);
  });
});
