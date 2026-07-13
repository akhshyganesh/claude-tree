// ABOUTME: Docs-verified Claude model context windows + the context gauge math.
// ABOUTME: Must match docs/MODEL_CONTEXT_WINDOWS.md; re-verify when Anthropic ships new models.
import type { ContextCostSummary } from "./context-cost.js";
import { formatTokens } from "./context-cost.js";

export interface ModelInfo {
  id: string;
  label: string;
  /** Hard context-window size in tokens (auto-compaction triggers earlier). */
  contextWindow: number;
}

/** Verified 2026-07-12 against the Anthropic model catalog. */
export const MODELS: readonly ModelInfo[] = [
  { id: "claude-fable-5", label: "Fable 5", contextWindow: 1_000_000 },
  { id: "claude-opus-4-8", label: "Opus 4.8", contextWindow: 1_000_000 },
  { id: "claude-opus-4-7", label: "Opus 4.7", contextWindow: 1_000_000 },
  { id: "claude-opus-4-6", label: "Opus 4.6", contextWindow: 1_000_000 },
  { id: "claude-sonnet-5", label: "Sonnet 5", contextWindow: 1_000_000 },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", contextWindow: 1_000_000 },
  { id: "claude-haiku-4-5", label: "Haiku 4.5", contextWindow: 200_000 },
] as const;

/** Claude Code's default tier. */
export const DEFAULT_MODEL_ID = "claude-opus-4-8";

export function modelById(id: string): ModelInfo {
  return MODELS.find((m) => m.id === id) ?? MODELS[1]!;
}

export interface Gauge {
  model: ModelInfo;
  /** Midpoint of the session-start range over the model's window, 0..1. */
  fillFraction: number;
  /** e.g. "~0.7%" (one decimal under 10%, whole numbers above). */
  percentText: string;
  /** e.g. "▓░░░░░░░░░" — width cells, at least one filled when nonzero. */
  bar: string;
  /** Full display line: label, bar, range / window, percent. */
  line: string;
}

/** "1M" / "200k" for a context-window size. */
export function formatWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${tokens / 1_000_000}M`;
  return `${Math.round(tokens / 1000)}k`;
}

/**
 * The context gauge: how much of `model`'s window the estimated session-start
 * load consumes. Uses the range midpoint for the fill; shows the range in text.
 */
export function gaugeFor(
  summary: ContextCostSummary,
  model: ModelInfo,
  width = 10,
): Gauge {
  const mid =
    (summary.estimatedSessionStartMin + summary.estimatedSessionStartMax) / 2;
  const fillFraction = Math.min(1, mid / model.contextWindow);
  const pct = fillFraction * 100;
  const percentText = pct < 10 ? `~${pct.toFixed(1)}%` : `~${Math.round(pct)}%`;
  const filled =
    mid > 0 ? Math.max(1, Math.min(width, Math.round(fillFraction * width))) : 0;
  const bar = "▓".repeat(filled) + "░".repeat(width - filled);
  const range = `~${formatTokens(summary.estimatedSessionStartMin)}–${formatTokens(summary.estimatedSessionStartMax)}`;
  const line = `${model.label.padEnd(11)} ${bar}  ${range} / ${formatWindow(model.contextWindow)}  (${percentText})`;
  return { model, fillFraction, percentText, bar, line };
}

/** One gauge per known model — the comparison table for Panel 3 and --json. */
export function gaugeAllModels(summary: ContextCostSummary): Gauge[] {
  return MODELS.map((m) => gaugeFor(summary, m));
}
