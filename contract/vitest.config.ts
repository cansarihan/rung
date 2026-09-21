import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/bands.ts", "src/witnesses.ts"],
    },
  },
  resolve: {
    conditions: ["import", "node", "default"],
  },
});
