import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    // The race suite runs many iterations against a shared database; running
    // suites in parallel would let them contend for the same rows.
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
