/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: {
    global: "globalThis",
  },
  resolve: {
    alias: {
      "@": "/src",
      "@veritoken/sdk": fileURLToPath(
        new URL("../sdk/src/index.ts", import.meta.url),
      ),
      // E2E only: swap the real Freighter extension bridge for a local mock
      // that signs with a Playwright-injected keypair. See
      // tests/e2e/fixtures/freighter-shim.ts and src/testing/freighterApiMock.ts.
      ...(mode === "e2e"
        ? {
            "@stellar/freighter-api": fileURLToPath(
              new URL("./src/testing/freighterApiMock.ts", import.meta.url),
            ),
          }
        : {}),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
  build: {
    // The Stellar SDK vendor chunk is unavoidably large; raise the budget so it
    // does not emit a noisy warning on every build.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          // The Stellar SDK is large; split it into its own vendor chunk so the
          // app shell loads independently and stays well under the size budget.
          "stellar-sdk": ["@stellar/stellar-sdk"],
          react: ["react", "react-dom", "react-router-dom"],
        },
      },
    },
  },
}));
