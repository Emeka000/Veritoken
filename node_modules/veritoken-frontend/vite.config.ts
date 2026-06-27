import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    global: "globalThis",
  },
  resolve: {
    alias: {
      "@": "/src",
    },
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
});
