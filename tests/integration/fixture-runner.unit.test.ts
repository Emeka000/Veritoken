import { Keypair, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import {
  FixtureRunner,
  FixtureSetupError,
  type DeployContractRequest,
  type FixturePlan,
  type FixtureTransport,
  type InvokeContractRequest,
  type UploadWasmRequest,
} from "./fixtures/fixture-runner";

class RecordingTransport implements FixtureTransport {
  readonly deployments: DeployContractRequest[] = [];
  readonly events: string[] = [];
  readonly salts: Buffer[] = [];
  failDeployment?: string;

  async uploadWasm(request: UploadWasmRequest): Promise<string> {
    this.events.push(`upload:${request.label}`);
    return `hash-${request.label}`;
  }

  async deployContract(request: DeployContractRequest): Promise<string> {
    this.deployments.push(request);
    this.events.push(`deploy:${request.label}`);
    this.salts.push(request.salt);
    if (request.label.endsWith(`/${this.failDeployment}`)) {
      throw new Error(`simulated deployment error for ${this.failDeployment}`);
    }
    return Buffer.from(request.salt).toString("hex");
  }

  async invokeContract(request: InvokeContractRequest): Promise<xdr.ScVal> {
    this.events.push(`invoke:${request.label}`);
    return xdr.ScVal.scvVoid();
  }
}

const threeContractPlan = (): FixturePlan => ({
  name: "ordered-stack",
  steps: [
    {
      name: "kyc",
      wasmPath: "kyc.wasm",
    },
    {
      constructorArgs: (context) => {
        expect(context.contract("kyc")).toBeTruthy();
        return [];
      },
      dependsOn: ["kyc"],
      name: "compliance",
      wasmPath: "compliance.wasm",
    },
    {
      afterDeploy: async (context) => {
        await context.invoke("asset", "initialize", []);
      },
      constructorArgs: (context) => {
        expect(context.contract("compliance")).toBeTruthy();
        return [];
      },
      dependsOn: ["compliance"],
      name: "asset",
      wasmPath: "asset.wasm",
    },
  ],
});

const createRunner = (
  transport: FixtureTransport,
): FixtureRunner =>
  new FixtureRunner(transport, {
    accounts: { admin: Keypair.random() },
    idFactory: (name, sequence) => `${name}-${sequence}`,
    logger: {
      error: () => undefined,
      info: () => undefined,
    },
  });

describe("FixtureRunner", () => {
  it("deploys a plan in dependency order and exposes the resulting contracts", async () => {
    const transport = new RecordingTransport();
    const context = await createRunner(transport).setup(threeContractPlan());

    expect(context.deployedOrder).toEqual(["kyc", "compliance", "asset"]);
    expect(context.contract("asset")).toHaveLength(64);
    expect(transport.events).toEqual([
      "upload:ordered-stack/kyc",
      "deploy:ordered-stack/kyc",
      "upload:ordered-stack/compliance",
      "deploy:ordered-stack/compliance",
      "upload:ordered-stack/asset",
      "deploy:ordered-stack/asset",
      "invoke:ordered-stack/asset.initialize",
    ]);
    expect(transport.salts).toHaveLength(3);
    expect(transport.deployments[0].constructorArgs).toBeUndefined();
    expect(transport.salts.every((salt) => salt.length === 32)).toBe(true);
    expect(new Set(transport.salts.map((salt) => salt.toString("hex"))).size).toBe(
      3,
    );
  });

  it("tears down fixture state and makes teardown idempotent", async () => {
    const transport = new RecordingTransport();
    const runner = createRunner(transport);
    const context = await runner.setup(threeContractPlan());

    await runner.teardown(context);
    await runner.teardown(context);

    expect(context.isActive).toBe(false);
    expect(context.deployedOrder).toEqual([]);
    expect(() => context.contract("kyc")).toThrow("already been torn down");
  });

  it("recovers after a deployment error and can run the same plan again", async () => {
    const transport = new RecordingTransport();
    const runner = createRunner(transport);
    transport.failDeployment = "compliance";

    await expect(runner.setup(threeContractPlan())).rejects.toMatchObject({
      fixtureName: "ordered-stack",
      name: "FixtureSetupError",
      stepName: "compliance",
    });
    await expect(runner.setup(threeContractPlan())).rejects.toThrow(
      "simulated deployment error",
    );

    transport.failDeployment = undefined;
    const recovered = await runner.setup(threeContractPlan());
    expect(recovered.deployedOrder).toEqual(["kyc", "compliance", "asset"]);
  });

  it("rejects a plan whose dependency is not declared earlier", async () => {
    const runner = createRunner(new RecordingTransport());
    const invalidPlan: FixturePlan = {
      name: "invalid-order",
      steps: [
        {
          constructorArgs: () => [],
          dependsOn: ["kyc"],
          name: "compliance",
          wasmPath: "compliance.wasm",
        },
        {
          constructorArgs: () => [],
          name: "kyc",
          wasmPath: "kyc.wasm",
        },
      ],
    };

    await expect(runner.setup(invalidPlan)).rejects.toBeInstanceOf(
      FixtureSetupError,
    );
    await expect(runner.setup(invalidPlan)).rejects.toThrow(
      'Dependency "kyc" must appear before "compliance"',
    );
  });
});
