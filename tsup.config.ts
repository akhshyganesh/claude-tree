// ABOUTME: tsup build config — bundles the CLI and library entrypoints to dist/ as ESM.
// ABOUTME: Preserves the shebang on cli.ts so the published bin is directly executable.
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts", "src/index.ts", "src/tui/index.ts"],
  format: ["esm"],
  target: "node18",
  clean: true,
  // Emit .d.ts only for the public library entry — the JSX tui entry is not
  // part of the exported API and its types add nothing for consumers.
  dts: { entry: { index: "src/index.ts" } },
  shims: false,
  banner: {},
});
