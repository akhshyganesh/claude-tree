// ABOUTME: The docs-verified Claude Code loading reference, encoded as data + a phase builder.
// ABOUTME: Must match docs/LOADING_ORDER.md; re-verify against the official docs when changing.
import type {
  BaseItem,
  Level,
  LoadTiming,
  ScanResult,
} from "./types.js";

/** Settings precedence, highest → lowest (LOADING_ORDER.md §"Settings precedence"). */
export const SETTINGS_PRECEDENCE: readonly string[] = [
  "Managed (policyHelper > server-managed > OS policy file)",
  "CLI arguments",
  ".claude/settings.local.json (local)",
  ".claude/settings.json (project)",
  "~/.claude/settings.json (user)",
];

/**
 * Memory (CLAUDE.md) merge order, first-loaded → last (last = highest priority).
 * (LOADING_ORDER.md §"Memory".)
 */
export const MEMORY_LOAD_ORDER: readonly string[] = [
  "Managed CLAUDE.md",
  "Ancestor → cwd chain: each dir's CLAUDE.md then CLAUDE.local.md (root → cwd)",
  "User ~/.claude/CLAUDE.md",
];

/** Skill name-conflict precedence (winner-first). */
export const SKILL_PRECEDENCE: readonly Level[] = ["managed", "user", "project"];

/** Subagent name-conflict precedence (winner-first) — the OPPOSITE of skills. */
export const AGENT_PRECEDENCE: readonly Level[] = [
  "managed",
  "project",
  "user",
];

export interface TimingExplanation {
  timing: LoadTiming;
  label: string;
  howItLoads: string;
}

/** Per-category load-timing labels + one-line explanations shown in the UI. */
export const LOAD_TIMINGS = {
  memory: {
    timing: "session-start",
    label: "session start",
    howItLoads:
      "CLAUDE.md (+CLAUDE.local.md, +@imports up to 4 hops) is injected into context when the session starts.",
  },
  memoryNested: {
    timing: "on-demand",
    label: "on demand",
    howItLoads:
      "CLAUDE.md below cwd loads only when Claude reads files in that subtree.",
  },
  ruleUnconditional: {
    timing: "session-start",
    label: "session start",
    howItLoads: "A rule with no paths: frontmatter loads at session start, like CLAUDE.md.",
  },
  rulePathScoped: {
    timing: "path-triggered",
    label: "path-triggered",
    howItLoads: "A rule with paths: globs loads on demand when a matching file is touched.",
  },
  skill: {
    timing: "on-invocation",
    label: "on invocation",
    howItLoads:
      "The skill description preloads at session start; the body loads only on /invoke or a model trigger.",
  },
  command: {
    timing: "on-invocation",
    label: "on invocation",
    howItLoads:
      "Legacy command: description preloads; body loads when invoked. A same-named skill beats it.",
  },
  agent: {
    timing: "on-spawn",
    label: "on spawn",
    howItLoads: "The subagent definition loads only when the agent is spawned.",
  },
  hook: {
    timing: "event-driven",
    label: "event-driven",
    howItLoads:
      "Registered from settings at session start; runs deterministically outside the model on its event. Costs no context.",
  },
  mcp: {
    timing: "session-start",
    label: "session start",
    howItLoads: "MCP servers connect and their tool lists load at session start.",
  },
  settings: {
    timing: "session-start",
    label: "session start",
    howItLoads: "Settings are resolved and merged at session start by precedence.",
  },
  runtime: {
    timing: "not-loaded",
    label: "not loaded",
    howItLoads:
      "Claude Code runtime data (caches, logs, history, credentials). Never loaded into model context.",
  },
} satisfies Record<string, TimingExplanation>;

export interface LoadPhaseItem {
  name: string;
  detail: string;
  level: Level;
  timing: LoadTiming;
}

export interface LoadPhase {
  order: number;
  id: "config-resolution" | "memory-injection" | "dormant-until-triggered";
  title: string;
  explanation: string;
  items: LoadPhaseItem[];
}

/** The complete reference bundle, for UIs that want it all in one object. */
export const loadingModel = {
  settingsPrecedence: SETTINGS_PRECEDENCE,
  memoryLoadOrder: MEMORY_LOAD_ORDER,
  skillPrecedence: SKILL_PRECEDENCE,
  agentPrecedence: AGENT_PRECEDENCE,
  timings: LOAD_TIMINGS,
} as const;

// Levels ordered lowest → highest locality for stable, readable output.
const LEVEL_ORDER: Level[] = ["managed", "user", "project", "local"];

// Memory (CLAUDE.md) injection order, first-loaded → last (LOADING_ORDER.md
// §"Memory"): managed → project ancestor chain (+ its CLAUDE.local.md) → user
// last (closest to the user = effectively highest priority).
const MEMORY_LEVEL_ORDER: Level[] = ["managed", "project", "local", "user"];

function toPhaseItem(item: BaseItem, detail: string): LoadPhaseItem {
  return {
    name: item.name,
    detail,
    level: item.level,
    timing: item.loadTiming,
  };
}

/**
 * Slot the concrete scanned items into the three-phase pipeline:
 * 1 config resolution, 2 memory injection, 3 dormant-until-triggered.
 */
export function buildLoadOrder(scan: ScanResult): LoadPhase[] {
  const config: LoadPhaseItem[] = [];
  const memory: LoadPhaseItem[] = [];
  const dormant: LoadPhaseItem[] = [];

  for (const level of LEVEL_ORDER) {
    const inv = scan.levels[level];
    if (!inv.present) continue;

    for (const s of inv.settings) {
      config.push({
        name: `settings (${s.level})`,
        detail: `allow ${s.allowCount} / deny ${s.denyCount} / ask ${s.askCount}, ${s.hookCount} hook(s)`,
        level: s.level,
        timing: "session-start",
      });
    }
    for (const m of inv.mcpServers) {
      config.push(toPhaseItem(m, `MCP server (${m.transport}) via ${m.source}`));
    }
    for (const h of inv.hooks) {
      config.push(toPhaseItem(h, `hook ${h.event} — ${h.commandSummary}`));
    }

    for (const r of inv.rules) {
      if (r.pathScoped) {
        dormant.push(toPhaseItem(r, `path-scoped rule: ${r.globs.join(", ")}`));
      }
    }
    for (const s of inv.skills) {
      dormant.push(toPhaseItem(s, "skill body (description preloaded)"));
    }
    for (const c of inv.commands) {
      dormant.push(toPhaseItem(c, "legacy command body"));
    }
    for (const a of inv.agents) {
      dormant.push(toPhaseItem(a, "subagent definition"));
    }
  }

  // Memory injection is ordered separately: docs put project memory BEFORE user
  // memory (user is closest to the user, so it loads last / wins).
  for (const level of MEMORY_LEVEL_ORDER) {
    const inv = scan.levels[level];
    if (!inv.present) continue;
    for (const m of inv.memory) {
      const detail =
        m.imports.length > 0
          ? `${m.kind}, ${m.imports.length} @import(s)`
          : m.kind;
      memory.push(toPhaseItem(m, detail));
    }
    for (const r of inv.rules) {
      if (!r.pathScoped) memory.push(toPhaseItem(r, "unconditional rule"));
    }
  }

  return [
    {
      order: 1,
      id: "config-resolution",
      title: "Config resolution",
      explanation:
        "Settings merge by precedence, hooks register, MCP servers connect — at session start.",
      items: config,
    },
    {
      order: 2,
      id: "memory-injection",
      title: "Memory injection",
      explanation:
        "CLAUDE.md chain (managed → root→cwd → user) plus unconditional rules enter context at session start.",
      items: memory,
    },
    {
      order: 3,
      id: "dormant-until-triggered",
      title: "Dormant until triggered",
      explanation:
        "Skill bodies, path-scoped rules, and subagent definitions stay out of context until invoked/touched/spawned.",
      items: dormant,
    },
  ];
}
