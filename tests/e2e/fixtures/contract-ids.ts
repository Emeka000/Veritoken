import * as fs from "node:fs";
import * as path from "node:path";

export interface DeployedContractIds {
  kycRegistry: string;
  complianceEngine: string;
  rwaToken: string;
  invoiceToken: string;
  propertyToken: string;
  carbonToken: string;
}

export const CONTRACT_IDS_PATH = path.resolve(
  import.meta.dirname,
  "contract-ids.json",
);

export function writeContractIds(ids: DeployedContractIds): void {
  fs.writeFileSync(CONTRACT_IDS_PATH, `${JSON.stringify(ids, null, 2)}\n`);
}

export function readContractIds(): DeployedContractIds {
  if (!fs.existsSync(CONTRACT_IDS_PATH)) {
    throw new Error(
      `${CONTRACT_IDS_PATH} does not exist. Run Playwright's globalSetup ` +
        `(tests/e2e/global-setup.ts) first — it deploys the contracts and ` +
        "writes this file before any spec runs.",
    );
  }
  return JSON.parse(fs.readFileSync(CONTRACT_IDS_PATH, "utf-8")) as DeployedContractIds;
}
