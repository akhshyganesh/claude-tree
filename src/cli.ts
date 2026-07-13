#!/usr/bin/env node
// ABOUTME: claude-tree CLI entrypoint — routes to the TUI, --list, --memories, --json, --help.
// ABOUTME: Falls back to list mode with a note when the TUI is unavailable.
import * as fs from "node:fs";
import * as os from "node:os";
import { scan } from "./scan.js";
import { renderList, renderMemories } from "./render-list.js";
import { summarizeContextCost } from "./context-cost.js";
import { gaugeAllModels, DEFAULT_MODEL_ID } from "./models.js";
import { buildLoadOrder } from "./loading-model.js";
import type { ScanResult } from "./types.js";

const HELP = `claude-tree — see every Claude Code config visible from a directory, and when it loads.

Usage:
  claude-tree              Interactive TUI (falls back to --list when stdout is not a TTY)
  claude-tree --list       Plain-text tree of levels, categories, load order, and context cost
  claude-tree --memories   Every memory file Claude loads here, in merge order
  claude-tree --json       ScanResult as JSON, plus a summary block (cost + per-model gauges)
  claude-tree --version    Print the version
  claude-tree --help       Show this help

Levels scanned: managed (org) → user (~/.claude) → project (.claude) → local overrides.`;

function version(): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function managedRoot(): string | undefined {
  switch (process.platform) {
    case "darwin":
      return "/Library/Application Support/ClaudeCode";
    case "win32":
      return "C:\\Program Files\\ClaudeCode";
    default:
      return "/etc/claude-code";
  }
}

function doScan(): ScanResult {
  return scan({
    cwd: process.cwd(),
    home: os.homedir(),
    managedRoot: managedRoot(),
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(HELP + "\n");
    return;
  }
  if (args.includes("--version") || args.includes("-v")) {
    process.stdout.write(version() + "\n");
    return;
  }

  const result = doScan();

  if (args.includes("--json")) {
    const summary = summarizeContextCost(result);
    const payload = {
      ...result,
      summary: {
        contextCost: summary,
        defaultModel: DEFAULT_MODEL_ID,
        gauges: gaugeAllModels(summary).map((g) => ({
          model: g.model.id,
          contextWindow: g.model.contextWindow,
          fillFraction: g.fillFraction,
          percentText: g.percentText,
        })),
        loadOrder: buildLoadOrder(result),
      },
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    return;
  }

  if (args.includes("--memories")) {
    process.stdout.write(renderMemories(result) + "\n");
    return;
  }

  if (args.includes("--list")) {
    process.stdout.write(renderList(result) + "\n");
    return;
  }

  // Default: run the TUI only on a real TTY; otherwise emit the plain list.
  if (!process.stdout.isTTY) {
    process.stdout.write(renderList(result) + "\n");
    return;
  }
  try {
    const { runTui } = await import("./tui/index.js");
    await runTui(result);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    process.stderr.write(`(TUI unavailable: ${reason}; showing --list)\n\n`);
    process.stdout.write(renderList(result) + "\n");
  }
}

main().catch((err: unknown) => {
  const reason = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`claude-tree: ${reason}\n`);
  process.exitCode = 1;
});
