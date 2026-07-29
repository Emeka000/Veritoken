import { createHash } from "node:crypto";

import type { Keypair, xdr } from "@stellar/stellar-sdk";

export interface UploadWasmRequest {
  label: string;
  source: Keypair;
  wasmPath: string;
}

export interface DeployContractRequest {
  constructorArgs?: xdr.ScVal[];
  label: string;
  salt: Buffer;
  source: Keypair;
  wasmHash: string;
}

export interface InvokeContractRequest {
  args: xdr.ScVal[];
  contractId: string;
  label: string;
  method: string;
  source: Keypair;
}

export interface FixtureTransport {
  uploadWasm(request: UploadWasmRequest): Promise<string>;
  deployContract(request: DeployContractRequest): Promise<string>;
  invokeContract(request: InvokeContractRequest): Promise<xdr.ScVal>;
}

export interface FixtureStep {
  afterDeploy?(context: FixtureContext): Promise<void>;
  constructorArgs?(context: FixtureContext): xdr.ScVal[];
  dependsOn?: string[];
  name: string;
  sourceAccount?: string;
  wasmPath: string;
}

export interface FixturePlan {
  name: string;
  steps: FixtureStep[];
}

export type FixtureAccounts = Record<string, Keypair>;

export interface FixtureLogger {
  error(message: string): void;
  info(message: string): void;
}

const consoleFixtureLogger: FixtureLogger = {
  error: (message) => console.error(message),
  info: (message) => console.info(message),
};

export class FixtureSetupError extends Error {
  readonly fixtureName: string;
  readonly stepName?: string;

  constructor(fixtureName: string, stepName: string | undefined, cause: unknown) {
    const location = stepName ? ` at step "${stepName}"` : "";
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Fixture "${fixtureName}" failed${location}: ${detail}`, { cause });
    this.name = "FixtureSetupError";
    this.fixtureName = fixtureName;
    this.stepName = stepName;
  }
}

export class FixtureContext {
  readonly deployedOrder: string[] = [];
  readonly id: string;
  readonly name: string;

  private readonly accounts: FixtureAccounts;
  private readonly contractIds = new Map<string, string>();
  private readonly transport: FixtureTransport;
  private active = true;

  constructor(
    id: string,
    name: string,
    accounts: FixtureAccounts,
    transport: FixtureTransport,
  ) {
    this.id = id;
    this.name = name;
    this.accounts = accounts;
    this.transport = transport;
  }

  account(name: string): Keypair {
    this.assertActive();
    const account = this.accounts[name];
    if (!account) {
      throw new Error(`Fixture "${this.name}" has no account named "${name}"`);
    }
    return account;
  }

  contract(name: string): string {
    this.assertActive();
    const contractId = this.contractIds.get(name);
    if (!contractId) {
      throw new Error(
        `Fixture "${this.name}" has not deployed contract "${name}"`,
      );
    }
    return contractId;
  }

  hasContract(name: string): boolean {
    return this.active && this.contractIds.has(name);
  }

  async invoke(
    contractName: string,
    method: string,
    args: xdr.ScVal[],
    sourceAccount = "admin",
  ): Promise<xdr.ScVal> {
    this.assertActive();
    return this.transport.invokeContract({
      args,
      contractId: this.contract(contractName),
      label: `${this.name}/${contractName}.${method}`,
      method,
      source: this.account(sourceAccount),
    });
  }

  registerContract(name: string, contractId: string): void {
    this.assertActive();
    if (this.contractIds.has(name)) {
      throw new Error(`Contract "${name}" was registered more than once`);
    }
    this.contractIds.set(name, contractId);
    this.deployedOrder.push(name);
  }

  release(): void {
    if (!this.active) return;
    this.active = false;
    this.contractIds.clear();
    this.deployedOrder.splice(0);
  }

  get isActive(): boolean {
    return this.active;
  }

  private assertActive(): void {
    if (!this.active) {
      throw new Error(`Fixture "${this.name}" has already been torn down`);
    }
  }
}

export interface FixtureRunnerOptions {
  accounts: FixtureAccounts;
  idFactory?: (fixtureName: string, sequence: number) => string;
  logger?: FixtureLogger;
}

export class FixtureRunner {
  private readonly accounts: FixtureAccounts;
  private readonly idFactory: (fixtureName: string, sequence: number) => string;
  private readonly logger: FixtureLogger;
  private readonly transport: FixtureTransport;
  private sequence = 0;

  constructor(transport: FixtureTransport, options: FixtureRunnerOptions) {
    this.transport = transport;
    this.accounts = options.accounts;
    this.logger = options.logger ?? consoleFixtureLogger;
    this.idFactory =
      options.idFactory ??
      ((fixtureName, sequence) =>
        `${fixtureName}-${Date.now().toString(36)}-${sequence.toString(36)}`);
  }

  async setup(plan: FixturePlan): Promise<FixtureContext> {
    this.validatePlan(plan);
    this.sequence += 1;
    const context = new FixtureContext(
      this.idFactory(plan.name, this.sequence),
      plan.name,
      this.accounts,
      this.transport,
    );
    this.logger.info(`[fixture:${context.id}] setting up ${plan.name}`);

    let currentStep: FixtureStep | undefined;
    try {
      for (const step of plan.steps) {
        currentStep = step;
        this.logger.info(
          `[fixture:${context.id}] deploying ${step.name} (${step.wasmPath})`,
        );
        for (const dependency of step.dependsOn ?? []) {
          if (!context.hasContract(dependency)) {
            throw new Error(
              `Dependency "${dependency}" must be deployed before "${step.name}"`,
            );
          }
        }

        const source = context.account(step.sourceAccount ?? "admin");
        const wasmHash = await this.transport.uploadWasm({
          label: `${plan.name}/${step.name}`,
          source,
          wasmPath: step.wasmPath,
        });
        const contractId = await this.transport.deployContract({
          constructorArgs: step.constructorArgs?.(context),
          label: `${plan.name}/${step.name}`,
          salt: this.saltFor(context.id, step.name),
          source,
          wasmHash,
        });
        context.registerContract(step.name, contractId);
        await step.afterDeploy?.(context);
        this.logger.info(
          `[fixture:${context.id}] deployed ${step.name} as ${contractId}`,
        );
      }
      this.logger.info(`[fixture:${context.id}] setup complete`);
      return context;
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      this.logger.error(
        `[fixture:${context.id}] ${currentStep?.name ?? "setup"} failed: ${detail}`,
      );
      await this.teardown(context);
      throw new FixtureSetupError(plan.name, currentStep?.name, cause);
    }
  }

  async teardown(context: FixtureContext | undefined): Promise<void> {
    if (context?.isActive) {
      this.logger.info(`[fixture:${context.id}] releasing fixture state`);
    }
    context?.release();
  }

  async withFixture<T>(
    plan: FixturePlan,
    callback: (context: FixtureContext) => Promise<T>,
  ): Promise<T> {
    const context = await this.setup(plan);
    try {
      return await callback(context);
    } finally {
      await this.teardown(context);
    }
  }

  private saltFor(fixtureId: string, contractName: string): Buffer {
    return createHash("sha256")
      .update(`${fixtureId}:${contractName}`)
      .digest();
  }

  private validatePlan(plan: FixturePlan): void {
    if (!plan.name.trim()) {
      throw new FixtureSetupError(plan.name, undefined, "Plan name is required");
    }
    if (plan.steps.length === 0) {
      throw new FixtureSetupError(
        plan.name,
        undefined,
        "At least one deployment step is required",
      );
    }

    const names = new Set<string>();
    for (const step of plan.steps) {
      if (!step.name.trim()) {
        throw new FixtureSetupError(
          plan.name,
          undefined,
          "Every deployment step needs a name",
        );
      }
      if (names.has(step.name)) {
        throw new FixtureSetupError(
          plan.name,
          step.name,
          `Duplicate deployment step "${step.name}"`,
        );
      }
      for (const dependency of step.dependsOn ?? []) {
        if (!names.has(dependency)) {
          throw new FixtureSetupError(
            plan.name,
            step.name,
            `Dependency "${dependency}" must appear before "${step.name}"`,
          );
        }
      }
      names.add(step.name);
    }
  }
}
