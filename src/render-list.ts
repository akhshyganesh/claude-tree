// ABOUTME: Plain-text tree renderer for --list mode and non-interactive shells.
// ABOUTME: Zero-dependency unicode glyphs; consumes a ScanResult and the load-order phases.
import { buildLoadOrder, LOAD_TIMINGS } from "./loading-model.js";
import {
  summarizeContextCost,
  contextCostHeadline,
  costBar,
  formatTokens,
  ESTIMATE_CAPTION,
} from "./context-cost.js";
import { gaugeFor, modelById, DEFAULT_MODEL_ID } from "./models.js";
import { stripControl } from "./util.js";
import { readdirSync as fsReadDir } from "node:fs";
import { dirname as pathDirname } from "node:path";
import type {
  BaseItem,
  Level,
  LevelInventory,
  ScanResult,
} from "./types.js";

const LEVEL_ORDER: Level[] = ["managed", "user", "project", "local"];
const LEVEL_LABEL: Record<Level, string> = {
  managed: "Managed (org policy)",
  user: "User (~/.claude)",
  project: "Project (.claude)",
  local: "Local (gitignored overrides)",
};

function timingTag(item: BaseItem): string {
  return `[${labelForTiming(item.loadTiming)}]`;
}

function labelForTiming(timing: string): string {
  for (const t of Object.values(LOAD_TIMINGS)) {
    if (t.timing === timing) return t.label;
  }
  return timing;
}

function overrideNote(item: BaseItem): string {
  if (item.override.overriddenBy) {
    return `  (overridden by ${item.override.overriddenBy})`;
  }
  if (item.override.overrides && item.override.overrides.length > 0) {
    return `  (overrides ${item.override.overrides.join(", ")})`;
  }
  return "";
}

/** "~111t" under 1000, "~23k" above (the k already implies tokens). */
function tokTag(n: number): string {
  return n >= 1000 ? `~${formatTokens(n)}` : `~${n}t`;
}

function costTag(item: BaseItem): string {
  const c = item.contextCost;
  if (!c) return "";
  return ` ${tokTag(c.sessionStartTokens)} start / ${tokTag(c.deferredTokens)} deferred`;
}

function line(item: BaseItem): string {
  const name = stripControl(item.name);
  const desc = item.description ? ` — ${stripControl(item.description)}` : "";
  return `${name}${desc} ${timingTag(item)}${costTag(item)}${overrideNote(item)}`;
}

function category(title: string, items: BaseItem[], out: string[]): void {
  if (items.length === 0) return;
  out.push(`  ├─ ${title}`);
  items.forEach((it, i) => {
    const last = i === items.length - 1;
    out.push(`  │    ${last ? "└─" : "├─"} ${line(it)}`);
  });
}

function renderLevel(
  inv: LevelInventory,
  out: string[],
  projectRoot: string | null,
): void {
  const header = `▸ ${LEVEL_LABEL[inv.level]}`;
  if (!inv.present) {
    if (inv.level === "project" && projectRoot) {
      out.push(`▸ Project — root found at ${projectRoot}, no .claude config`);
    } else {
      out.push(`${header}: absent`);
    }
    return;
  }
  out.push(`${header}  ${inv.roots.join(", ")}`);
  category("memory", inv.memory, out);
  category("rules", inv.rules, out);
  category("skills", inv.skills, out);
  category("commands (legacy)", inv.commands, out);
  category("agents", inv.agents, out);
  category("hooks", inv.hooks, out);
  category("mcp servers", inv.mcpServers, out);
  category("workflows", inv.workflows, out);
  category("plugins (contain loadable skills/agents)", inv.plugins, out);
  category("other (not auto-loaded)", inv.other, out);
  if (inv.runtime.length > 0) {
    out.push(
      `  ├─ runtime data (${inv.runtime.length} items, not loaded into context)`,
    );
  }
  inv.settings.forEach((s, i) => {
    const last = i === inv.settings.length - 1;
    out.push(
      `  ${last ? "└─" : "├─"} settings: allow ${s.allowCount} / deny ${s.denyCount} / ask ${s.askCount}` +
        ` · env [${s.envKeys.join(", ")}] · ${s.hookCount} hook(s)`,
    );
  });
}

export function renderList(scan: ScanResult): string {
  const out: string[] = [];
  out.push("claude-tree — config visible from:");
  out.push(`  cwd:          ${scan.cwd}`);
  out.push(`  project root: ${scan.projectRoot ?? "(none found)"}`);
  out.push("");

  for (const level of LEVEL_ORDER) {
    renderLevel(scan.levels[level], out, scan.projectRoot);
    out.push("");
  }

  out.push("Load order (what happens when a session starts here):");
  for (const phase of buildLoadOrder(scan)) {
    out.push(`  ${phase.order}. ${phase.title} — ${phase.explanation}`);
    if (phase.items.length === 0) {
      out.push("       (nothing)");
      continue;
    }
    for (const it of phase.items) {
      out.push(
        `       • ${stripControl(it.name)} [${it.level}] — ${stripControl(it.detail)}`,
      );
    }
  }

  out.push("");
  renderContextCost(scan, out);

  return out.join("\n");
}

/** One memory file Claude would load here, in merge-order position. */
export interface MemoryEntry {
  order: number;
  level: Level;
  /** "CLAUDE.md" / "CLAUDE.local.md" / "auto memory (MEMORY.md)". */
  kind: string;
  path: string;
  description: string;
  sessionStartTokens: number;
  imports: string[];
  /** Auto-memory topic files that load on demand (empty otherwise). */
  topics: string[];
  auto: boolean;
}

/**
 * All memory Claude would load here, in merge order (first-loaded → last;
 * last read = closest to the user, effectively highest priority), plus the
 * auto-memory topic files that only load on demand. Shared by --memories
 * and the TUI Memories overlay.
 */
export function collectMemories(scan: ScanResult): MemoryEntry[] {
  const order: Level[] = ["managed", "project", "local", "user"];
  const out: MemoryEntry[] = [];
  let n = 0;
  for (const level of order) {
    for (const m of scan.levels[level].memory) {
      n++;
      const auto = (m as { autoMemory?: boolean }).autoMemory === true;
      out.push({
        order: n,
        level,
        kind: auto ? "auto memory (MEMORY.md)" : m.kind,
        path: m.path,
        description: stripControl(m.description ?? ""),
        sessionStartTokens: m.contextCost?.sessionStartTokens ?? 0,
        imports: m.imports,
        topics: auto ? memoryTopicFiles(m.path) : [],
        auto,
      });
    }
  }
  return out;
}

export const MEMORY_MERGE_NOTE =
  "Merge order: managed CLAUDE.md → project chain (root → cwd, each dir's " +
  "CLAUDE.md then CLAUDE.local.md) → user ~/.claude/CLAUDE.md → auto MEMORY.md.";

export function renderMemories(scan: ScanResult): string {
  const out: string[] = [];
  out.push("Memories Claude loads here, in merge order (last read wins):");
  const entries = collectMemories(scan);
  for (const e of entries) {
    const cost = e.sessionStartTokens
      ? ` ~${formatTokens(e.sessionStartTokens)} tokens`
      : "";
    out.push(`  ${e.order}. [${e.level}] ${e.kind}${cost}`);
    out.push(`     ${e.path}`);
    if (e.description) out.push(`     ${e.description}`);
    if (e.imports.length > 0) out.push(`     @imports: ${e.imports.join(", ")}`);
    for (const topic of e.topics) {
      out.push(`       · topic file (loads on demand): ${topic}`);
    }
  }
  if (entries.length === 0)
    out.push("  (no memory files found from this directory)");
  out.push("");
  out.push(MEMORY_MERGE_NOTE);
  return out.join("\n");
}

/** Sibling topic .md files next to an auto-memory MEMORY.md (on-demand loads). */
function memoryTopicFiles(memoryPath: string): string[] {
  const dir = pathDirname(memoryPath);
  try {
    return fsReadDir(dir)
      .filter((f) => f.endsWith(".md") && f !== "MEMORY.md")
      .map((f) => `${dir}/${f}`);
  } catch {
    return [];
  }
}

/** The context-cost summary section (rough chars÷divisor estimates). */
function renderContextCost(scan: ScanResult, out: string[]): void {
  const summary = summarizeContextCost(scan);
  out.push(`Context cost (${ESTIMATE_CAPTION}):`);
  for (const h of contextCostHeadline(summary)) {
    out.push(`  ${h.text}`);
  }
  out.push(
    `  deferred pool: ~${formatTokens(summary.totalDeferred)} tokens (loads only on invocation / spawn / matching file)`,
  );
  const gauge = gaugeFor(summary, modelById(DEFAULT_MODEL_ID));
  out.push(`  context window: ${gauge.line}`);
  out.push(
    "  (share of the hard window; auto-compaction triggers well before the limit)",
  );
  if (summary.perLevel.length > 0) {
    out.push("  per level (session start):");
    for (const lc of summary.perLevel) {
      out.push(
        `    ${LEVEL_LABEL[lc.level]}: ${tokTag(lc.sessionStartTokens)} start / ${tokTag(lc.deferredTokens)} deferred`,
      );
    }
  }
  if (summary.topItems.length > 0) {
    const max = summary.topItems[0]!.sessionStartTokens;
    out.push("  most expensive at session start:");
    for (const it of summary.topItems) {
      const bar = costBar(it.sessionStartTokens, max, 20);
      out.push(
        `    ${bar.padEnd(20)} ${tokTag(it.sessionStartTokens)}  ${stripControl(it.name)} [${it.level}/${it.type}]`,
      );
    }
  }
}
