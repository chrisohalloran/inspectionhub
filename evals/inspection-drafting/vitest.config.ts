import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "packages/agent/src/**/*.test.ts",
      "evals/inspection-drafting/**/*.test.ts",
    ],
    passWithNoTests: false,
  },
});
