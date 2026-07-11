#!/usr/bin/env node
// ABOUTME: claude-tree CLI entrypoint — routes to the TUI, --list, --json, or --help.
// ABOUTME: Falls back to list mode with a note when the TUI is unavailable.
import * as os from "node:os";
import { scan } from "./scan.js";
import { renderList } from "./render-list.js";
import type { ScanResult } from "./types.js";

const HELP = `claude-tree — see every Claude Code config visible from a directory, and when it loads.

Usage:
  claude-tree            Interactive TUI (falls back to --list if unavailable)
  claude-tree --list     Plain-text tree of levels, categories, and load order
  claude-tree --json     Emit the raw ScanResult as JSON
  claude-tree --help     Show this help

Levels scanned: managed (org) → user (~/.claude) → project (.claude) → local overrides.`;

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

  const result = doScan();

  if (args.includes("--json")) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }

  if (args.includes("--list")) {
    process.stdout.write(renderList(result) + "\n");
    return;
  }

  // Default: try the TUI, fall back to list mode with a note.
  try {
    const { runTui } = await import("./tui/index.js");
    runTui(result);
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
