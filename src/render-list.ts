// ABOUTME: Plain-text tree renderer for --list mode and non-interactive shells.
// ABOUTME: Zero-dependency unicode glyphs; consumes a ScanResult and the load-order phases.
import { buildLoadOrder, LOAD_TIMINGS } from "./loading-model.js";
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

function line(item: BaseItem): string {
  const desc = item.description ? ` — ${item.description}` : "";
  return `${item.name}${desc} ${timingTag(item)}${overrideNote(item)}`;
}

function category(title: string, items: BaseItem[], out: string[]): void {
  if (items.length === 0) return;
  out.push(`  ├─ ${title}`);
  items.forEach((it, i) => {
    const last = i === items.length - 1;
    out.push(`  │    ${last ? "└─" : "├─"} ${line(it)}`);
  });
}

function renderLevel(inv: LevelInventory, out: string[]): void {
  const header = `▸ ${LEVEL_LABEL[inv.level]}`;
  if (!inv.present) {
    out.push(`${header}: absent`);
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
  category("other (not loaded)", inv.other, out);
  for (const s of inv.settings) {
    out.push(
      `  ├─ settings: allow ${s.allowCount} / deny ${s.denyCount} / ask ${s.askCount}` +
        ` · env [${s.envKeys.join(", ")}] · ${s.hookCount} hook(s)`,
    );
  }
}

export function renderList(scan: ScanResult): string {
  const out: string[] = [];
  out.push("claude-tree — config visible from:");
  out.push(`  cwd:          ${scan.cwd}`);
  out.push(`  project root: ${scan.projectRoot ?? "(none found)"}`);
  out.push("");

  for (const level of LEVEL_ORDER) {
    renderLevel(scan.levels[level], out);
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
      out.push(`       • ${it.name} [${it.level}] — ${it.detail}`);
    }
  }

  return out.join("\n");
}
