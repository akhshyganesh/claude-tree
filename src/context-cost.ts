// ABOUTME: Pure context-cost estimation — how many tokens each config item injects.
// ABOUTME: tokens ~= ceil(chars/4); everything here is an estimate, labelled with "~".
import type {
  BaseItem,
  ContextCost,
  Level,
  ScanResult,
} from "./types.js";

/** Estimate tokens from a character count: ~chars/4, always an estimate. */
export function estimateTokens(chars: number): number {
  if (chars <= 0) return 0;
  return Math.ceil(chars / 4);
}

/**
 * CLAUDE.md / CLAUDE.local.md + one level of resolved @imports: the full body
 * plus each import file's body count at session start. `importChars` is the
 * summed size of the resolved import files (0 for imports that don't exist).
 */
export function memoryCost(bodyChars: number, importChars: number): ContextCost {
  return {
    sessionStartTokens: estimateTokens(bodyChars + importChars),
    deferredTokens: 0,
    note:
      importChars > 0
        ? "full body + one level of @imports, injected at session start"
        : "full body injected at session start",
  };
}

/**
 * Rules: unconditional rules load their full body at session start; path-scoped
 * rules cost nothing at start and defer the body until a matching file is touched.
 */
export function ruleCost(pathScoped: boolean, bodyChars: number): ContextCost {
  const body = estimateTokens(bodyChars);
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
    sessionStartTokens: estimateTokens(descChars),
    deferredTokens: estimateTokens(bodyChars),
    note: "description preloads; body deferred until invoked",
  };
}

/** Subagents: nothing at start; the whole definition loads when spawned. */
export function agentCost(bodyChars: number): ContextCost {
  return {
    sessionStartTokens: 0,
    deferredTokens: estimateTokens(bodyChars),
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
}

export interface LevelCost {
  level: Level;
  sessionStartTokens: number;
  deferredTokens: number;
}

export interface ContextCostSummary {
  /** Total ~tokens injected at session start for this cwd. */
  totalSessionStart: number;
  /** Total ~tokens deferred until something triggers them. */
  totalDeferred: number;
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
  const perLevelMap = new Map<Level, LevelCost>();
  for (const level of LEVEL_ORDER) {
    perLevelMap.set(level, {
      level,
      sessionStartTokens: 0,
      deferredTokens: 0,
    });
  }
  for (const row of rows) {
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
    .filter((r) => r.sessionStartTokens > 0)
    .sort((a, b) => b.sessionStartTokens - a.sessionStartTokens)
    .slice(0, topN);
  return { totalSessionStart, totalDeferred, perLevel, topItems };
}

/** A proportional unicode bar for `value` relative to `max`, `width` cells wide. */
export function costBar(value: number, max: number, width = 20): string {
  if (max <= 0 || value <= 0) return "";
  const filled = Math.max(1, Math.round((value / max) * width));
  return "█".repeat(Math.min(width, filled));
}
