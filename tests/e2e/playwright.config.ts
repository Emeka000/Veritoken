import { defineConfig, devices } from "@playwright/test";
import * as path from "node:path";

const PORT = Number(process.env.E2E_PORT ?? 5173);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: ".",
  testMatch: /specs\/.*\.spec\.ts/,
  // There is deliberately no `webServer` entry — global-setup.ts starts the
  // Vite dev server itself, as its own last step, after contracts are
  // deployed. Playwright runs a configured `webServer`'s setup *before*
  // `globalSetup`, not after — see the comment at the top of
  // global-setup.ts for why that ordering doesn't work for this suite.
  globalSetup: path.resolve(import.meta.dirname, "global-setup.ts"),
  globalTeardown: path.resolve(import.meta.dirname, "global-teardown.ts"),

  // All specs share one deployed set of contracts on one standalone node
  // (redeploying 6 contracts per test would blow the CI time budget). Each
  // spec still uses fresh, never-reused addresses so outcomes don't depend
  // on execution order — but two admin-scoped actions (compliance rules,
  // the one shared invoice's settlement flag) mutate contract-wide state,
  // so we run fully serially rather than risk cross-test races. See
  // tests/e2e/README.md, "Test independence".
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,

  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }], ["junit", { outputFile: "test-results/e2e.xml" }]]
    : [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",
});
