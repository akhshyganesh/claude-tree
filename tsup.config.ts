// ABOUTME: tsup build config — bundles the CLI and library entrypoints to dist/ as ESM.
// ABOUTME: Preserves the shebang on cli.ts so the published bin is directly executable.
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts", "src/index.ts"],
  format: ["esm"],
  target: "node18",
  clean: true,
  dts: false,
  shims: false,
  banner: {},
});
