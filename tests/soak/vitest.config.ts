import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/soak/**/*.test.ts"],
    reporters: ["default"],
  },
});
