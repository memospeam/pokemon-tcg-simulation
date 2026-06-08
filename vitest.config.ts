import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
    exclude: [
      "**/node_modules/**",
      "scripts/prepare-standard-effects.test.ts",
      "scripts/fetchAttackCosts.test.ts",
      "scripts/report-invariants.test.ts",
    ],
    testTimeout: 30000,
  },
});
