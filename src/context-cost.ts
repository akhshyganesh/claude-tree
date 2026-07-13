// ABOUTME: Pure context-cost estimation — how many tokens each config item injects.
// ABOUTME: tokens ~= chars/divisor per content type (Claude's tokenizer is denser than GPT).
import type {
  BaseItem,
  ContextCost,
  Level,
  MemoryFile,
  ScanResult,
} from "./types.js";

/**
 * Content type an estimate is for. Claude's tokenizer packs fewer chars per
 * token than GPT's, and code is denser still, so each kind gets its own divisor.
 * These are research-verified approximations; exact counts need Anthropic's
 * count-tokens API (free but networked) — a future `--count-tokens` flag could
 * call it. See docs/LOADING_ORDER.md.
 */
export type TokenKind = "markdown" | "code" | "json" | "text";

/** chars-per-token divisors by content kind (Claude tokenizer estimate). */
export const TOKEN_DIVISORS: Record<TokenKind, number> = {
  markdown: 4.6,
  code: 3.6,
  json: 4.2,
  text: 4.4,
};

/**
 * Estimate tokens from a character count, per content `kind` (default "text").
 * Always an estimate, labelled with "~" at the call sites.
 */
export function estimateTokens(chars: number, kind: TokenKind = "text"): number {
  if (chars <= 0) return 0;
  return Math.ceil(chars / TOKEN_DIVISORS[kind]);
}

/**
 * Fixed context Claude Code itself occupies before any user config: the system
 * prompt + built-in tool definitions, the environment/git snapshot, and bundled
 * skill descriptions + MCP tool names (which vary). A range, not a point.
 * Source: code.claude.com/docs/en/context-window.
 */
export const CLAUDE_CODE_BASELINE = {
  minTokens: 5200,
  maxTokens: 5700,
  breakdown: [
    { name: "system prompt + built-in tool definitions", tokens: 4200 },
    { name: "environment / git snapshot", tokens: 280 },
    { name: "bundled skill descriptions + MCP tool names", tokens: "varies" },
  ],
  source: "code.claude.com/docs/en/context-window",
  verifiedOn: "2026-07-12",
} as const;

/** Auto-memory (MEMORY.md) loads only its first slice at session start. */
export const AUTO_MEMORY_MAX_LINES = 200;
export const AUTO_MEMORY_MAX_BYTES = 25 * 1024;

/** Char count of the auto-memory slice: first 200 lines OR 25KB, whichever first. */
export function autoMemorySliceChars(text: string): number {
  const firstLines = text
    .split("\n")
    .slice(0, AUTO_MEMORY_MAX_LINES)
    .join("\n");
  return Math.min(firstLines.length, AUTO_MEMORY_MAX_BYTES);
}

/**
 * Auto-memory MEMORY.md: Claude Code injects only the first 200 lines / 25KB at
 * session start (markdown divisor); topic files under memory/ load on demand.
 */
export function autoMemoryCost(text: string): ContextCost {
  return {
    sessionStartTokens: estimateTokens(autoMemorySliceChars(text), "markdown"),
    deferredTokens: 0,
    note: "auto memory: first 200 lines / 25KB injected at session start; topic files load on demand",
  };
}

/**
 * CLAUDE.md / CLAUDE.local.md + one level of resolved @imports: the full body
 * plus each import file's body count at session start. `importChars` is the
 * summed size of the resolved import files (0 for imports that don't exist).
 */
export function memoryCost(bodyChars: number, importChars: number): ContextCost {
  return {
    sessionStartTokens: estimateTokens(bodyChars + importChars, "markdown"),
    deferredTokens: 0,
    note:
      importChars > 0
        ? "full body at session start; @imports load recursively (≤4 hops) — this estimate covers one level"
        : "full body injected at session start",
  };
}

/**
 * Rules: unconditional rules load their full body at session start; path-scoped
 * rules cost nothing at start and defer the body until a matching file is touched.
 */
export function ruleCost(pathScoped: boolean, bodyChars: number): ContextCost {
  const body = estimateTokens(bodyChars, "markdown");
  if (pathScoped) {
    return {
      sessionStartTokens: 0,
      deferredTokens: body,
      note: "deferred: loads when a matching file is touched",
    };
  }
  return {
    sessionStartTokens: body,
    deferredTokens: 0,
    note: "full body injected at session start",
  };
}

/**
 * Skills and legacy commands: ONLY the frontmatter description preloads at
 * session start; the body tokens defer to invocation (`/name` or model trigger).
 */
export function skillCost(descChars: number, bodyChars: number): ContextCost {
  return {
    sessionStartTokens: estimateTokens(descChars, "markdown"),
    deferredTokens: estimateTokens(bodyChars, "markdown"),
    note: "description preloads; body deferred until invoked",
  };
}

/** Subagents: nothing at start; the whole definition loads when spawned. */
export function agentCost(bodyChars: number): ContextCost {
  return {
    sessionStartTokens: 0,
    deferredTokens: estimateTokens(bodyChars, "markdown"),
    note: "deferred: definition loads when the agent is spawned",
  };
}

/** Settings and hooks cost no model context (hooks run outside the model). */
export function noContextCost(note: string): ContextCost {
  return { sessionStartTokens: 0, deferredTokens: 0, note };
}

/**
 * MCP servers: tool schemas do add tokens at session start, but they are not
 * statically measurable from config — labelled "varies".
 */
export function mcpCost(): ContextCost {
  return {
    sessionStartTokens: 0,
    deferredTokens: 0,
    note: "varies: tool schemas add tokens at session start, not statically measurable",
  };
}

/** A flattened, cost-bearing item for the summary and Panel 3. */
export interface CostRow {
  name: string;
  level: Level;
  type: string;
  sessionStartTokens: number;
  deferredTokens: number;
  note?: string;
  /** True for the auto-discovered MEMORY.md item (accounted separately). */
  autoMemory?: boolean;
}

export interface LevelCost {
  level: Level;
  sessionStartTokens: number;
  deferredTokens: number;
}

export interface ContextCostSummary {
  /** Fixed Claude Code overhead paid before any user config (min–max range). */
  baseline: typeof CLAUDE_CODE_BASELINE;
  /** Total ~tokens your config injects at session start (excludes auto memory). */
  totalSessionStart: number;
  /** Total ~tokens deferred until something triggers them. */
  totalDeferred: number;
  /** ~tokens the auto-discovered MEMORY.md injects at session start (0 if none). */
  autoMemoryTokens: number;
  /** baseline.min + config + auto memory — the low end of the session-start range. */
  estimatedSessionStartMin: number;
  /** baseline.max + config + auto memory — the high end of the session-start range. */
  estimatedSessionStartMax: number;
  perLevel: LevelCost[];
  /** Most expensive items by session-start cost, highest first. */
  topItems: CostRow[];
}

const LEVEL_ORDER: Level[] = ["managed", "user", "project", "local"];

function cost(item: BaseItem): ContextCost {
  return item.contextCost ?? { sessionStartTokens: 0, deferredTokens: 0 };
}

function pushRow(rows: CostRow[], type: string, item: BaseItem): void {
  const c = cost(item);
  rows.push({
    name: item.name,
    level: item.level,
    type,
    sessionStartTokens: c.sessionStartTokens,
    deferredTokens: c.deferredTokens,
    note: c.note,
    autoMemory: (item as MemoryFile).autoMemory === true,
  });
}

/** Flatten every cost-bearing item across all present levels. */
export function collectCostRows(scan: ScanResult): CostRow[] {
  const rows: CostRow[] = [];
  for (const level of LEVEL_ORDER) {
    const inv = scan.levels[level];
    if (!inv.present) continue;
    for (const m of inv.memory) pushRow(rows, "memory", m);
    for (const r of inv.rules) pushRow(rows, "rule", r);
    for (const s of inv.skills) pushRow(rows, "skill", s);
    for (const c of inv.commands) pushRow(rows, "command", c);
    for (const a of inv.agents) pushRow(rows, "agent", a);
    for (const h of inv.hooks) pushRow(rows, "hook", h);
    for (const s of inv.mcpServers) pushRow(rows, "mcp", s);
  }
  return rows;
}

/**
 * Summarize context cost across a scan: totals, per-level breakdown, and the
 * top-N most expensive items by session-start cost. Pure over the scan's
 * already-decorated `contextCost` fields.
 */
export function summarizeContextCost(
  scan: ScanResult,
  topN = 8,
): ContextCostSummary {
  const rows = collectCostRows(scan);
  let totalSessionStart = 0;
  let totalDeferred = 0;
  let autoMemoryTokens = 0;
  const perLevelMap = new Map<Level, LevelCost>();
  for (const level of LEVEL_ORDER) {
    perLevelMap.set(level, {
      level,
      sessionStartTokens: 0,
      deferredTokens: 0,
    });
  }
  for (const row of rows) {
    // Auto memory is surfaced on its own line, not folded into config totals.
    if (row.autoMemory) {
      autoMemoryTokens += row.sessionStartTokens;
      continue;
    }
    totalSessionStart += row.sessionStartTokens;
    totalDeferred += row.deferredTokens;
    const lc = perLevelMap.get(row.level)!;
    lc.sessionStartTokens += row.sessionStartTokens;
    lc.deferredTokens += row.deferredTokens;
  }
  const perLevel = LEVEL_ORDER.map((l) => perLevelMap.get(l)!).filter(
    (lc) => lc.sessionStartTokens > 0 || lc.deferredTokens > 0,
  );
  const topItems = [...rows]
    .filter((r) => r.sessionStartTokens > 0 && !r.autoMemory)
    .sort((a, b) => b.sessionStartTokens - a.sessionStartTokens)
    .slice(0, topN);
  const configAndAuto = totalSessionStart + autoMemoryTokens;
  return {
    baseline: CLAUDE_CODE_BASELINE,
    totalSessionStart,
    totalDeferred,
    autoMemoryTokens,
    estimatedSessionStartMin: CLAUDE_CODE_BASELINE.minTokens + configAndAuto,
    estimatedSessionStartMax: CLAUDE_CODE_BASELINE.maxTokens + configAndAuto,
    perLevel,
    topItems,
  };
}

/**
 * Compact token count rounded to ~2 significant figures so estimates don't
 * read as exact: 5200 → "5.2k", 1888 → "1.9k", 12345 → "12k", 900 → "900".
 */
export function formatTokens(n: number): string {
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** The one-line caption every renderer shows under token numbers. */
export const ESTIMATE_CAPTION =
  "rough estimate: chars ÷4.6 (markdown), ÷3.6 (code), ÷4.2 (json)";

/** One line of the context-cost headline block, with light styling hints. */
export interface HeadlineLine {
  text: string;
  emphasis?: boolean;
  dim?: boolean;
}

/**
 * The shared headline block rendered above the per-level breakdown in Panel 3
 * and `--list`: baseline → config → auto memory → session-start range. Always
 * shows the baseline, even when this directory adds no config context.
 */
export function contextCostHeadline(summary: ContextCostSummary): HeadlineLine[] {
  const b = summary.baseline;
  const lines: HeadlineLine[] = [
    {
      text: `Claude Code baseline ~${formatTokens(b.minTokens)}–${formatTokens(b.maxTokens)} tokens`,
      dim: true,
    },
  ];
  if (summary.totalSessionStart > 0) {
    lines.push({
      text: `your config adds ~${formatTokens(summary.totalSessionStart)} tokens`,
    });
  } else {
    lines.push({ text: "this directory adds no config context", dim: true });
  }
  if (summary.autoMemoryTokens > 0) {
    lines.push({
      text: `auto memory adds ~${formatTokens(summary.autoMemoryTokens)} tokens`,
    });
  }
  lines.push({
    text: `= session start ~${formatTokens(summary.estimatedSessionStartMin)}–${formatTokens(summary.estimatedSessionStartMax)} tokens`,
    emphasis: true,
  });
  return lines;
}

/** A proportional unicode bar for `value` relative to `max`, `width` cells wide. */
export function costBar(value: number, max: number, width = 20): string {
  if (max <= 0 || value <= 0) return "";
  const filled = Math.max(1, Math.round((value / max) * width));
  return "█".repeat(Math.min(width, filled));
}
