import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Type-only modules and the barrel file have no runtime branches.
      exclude: ["src/types.ts", "src/index.ts"],
      reporter: ["text", "lcov", "json-summary"],
      thresholds: { lines: 95, statements: 95, functions: 95, branches: 90 },
    },
  },
});
