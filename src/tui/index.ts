// ABOUTME: Placeholder for the Ink TUI, added by a later task.
// ABOUTME: Throws so the CLI can detect its absence and fall back to --list mode.
import type { ScanResult } from "../types.js";

export function runTui(_scan: ScanResult): void {
  throw new Error("TUI not built yet");
}
