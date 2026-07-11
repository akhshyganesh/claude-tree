// ABOUTME: Vitest configuration for the claude-tree test suite.
// ABOUTME: Runs the node environment; tests live under tests/.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
