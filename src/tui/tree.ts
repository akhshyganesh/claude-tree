// ABOUTME: Pure tree model for the TUI left pane — flattens a ScanResult into navigable rows.
// ABOUTME: No Ink/React here so the navigation logic is unit-testable with plain vitest.
import type {
  AgentItem,
  GenericItem,
  HookEntry,
  Level,
  LevelInventory,
  McpServerItem,
  MemoryFile,
  RuleItem,
  ScanResult,
  SettingsSummary,
  SkillItem,
} from "../types.js";

export const LEVEL_ORDER: Level[] = ["managed", "user", "project", "local"];

export const LEVEL_LABEL: Record<Level, string> = {
  managed: "Managed (org policy)",
  user: "User (~/.claude)",
  project: "Project (.claude)",
  local: "Local (gitignored overrides)",
};

/** The selectable payload behind an item row — a tagged union for the detail pane. */
export type NodeData =
  | { type: "memory"; item: MemoryFile }
  | { type: "rule"; item: RuleItem }
  | { type: "skill"; item: SkillItem }
  | { type: "command"; item: SkillItem }
  | { type: "agent"; item: AgentItem }
  | { type: "hook"; item: HookEntry }
  | { type: "mcp"; item: McpServerItem }
  | { type: "settings"; item: SettingsSummary }
  | { type: "workflow"; item: GenericItem }
  | { type: "other"; item: GenericItem }
  | { type: "runtime"; count: number; level: Level };

/** One rendered line in the left pane. */
export interface Row {
  id: string;
  depth: number;
  label: string;
  expandable: boolean;
  expanded: boolean;
  dimmed: boolean;
  isLevel: boolean;
  /** Present only on item rows. */
  data?: NodeData;
}

interface Category {
  id: string;
  label: string;
  nodes: NodeData[];
}

/** Categories in the spec-mandated order, empty ones dropped. */
function categoriesFor(inv: LevelInventory): Category[] {
  const cats: Category[] = [
    { id: "memory", label: "memory", nodes: inv.memory.map((item) => ({ type: "memory", item })) },
    { id: "rules", label: "rules", nodes: inv.rules.map((item) => ({ type: "rule", item })) },
    { id: "skills", label: "skills", nodes: inv.skills.map((item) => ({ type: "skill", item })) },
    { id: "commands", label: "commands", nodes: inv.commands.map((item) => ({ type: "command", item })) },
    { id: "agents", label: "agents", nodes: inv.agents.map((item) => ({ type: "agent", item })) },
    { id: "hooks", label: "hooks", nodes: inv.hooks.map((item) => ({ type: "hook", item })) },
    { id: "settings", label: "settings", nodes: inv.settings.map((item) => ({ type: "settings", item })) },
    { id: "mcp", label: "mcp", nodes: inv.mcpServers.map((item) => ({ type: "mcp", item })) },
    { id: "workflows", label: "workflows", nodes: inv.workflows.map((item) => ({ type: "workflow", item })) },
    { id: "other", label: "other", nodes: inv.other.map((item) => ({ type: "other", item })) },
  ];
  if (inv.runtime.length > 0) {
    cats.push({
      id: "runtime",
      label: "runtime",
      nodes: [{ type: "runtime", count: inv.runtime.length, level: inv.level }],
    });
  }
  return cats.filter((c) => c.nodes.length > 0);
}

/** Human label for an item row. */
export function nodeLabel(data: NodeData): string {
  switch (data.type) {
    case "runtime":
      return `runtime data (${data.count} items, not loaded into context)`;
    case "settings":
      return `settings (${data.item.level})`;
    default:
      return data.item.name;
  }
}

/** Row id all levels get, so callers can pre-expand them. */
export function levelId(level: Level): string {
  return `L:${level}`;
}

/**
 * Flatten the scan into the currently-visible rows, honoring the expanded set.
 * Absent levels render as a single dimmed, non-expandable row.
 */
export function buildRows(scan: ScanResult, expanded: ReadonlySet<string>): Row[] {
  const rows: Row[] = [];
  for (const level of LEVEL_ORDER) {
    const inv = scan.levels[level];
    const lid = levelId(level);
    if (!inv.present) {
      rows.push({
        id: lid,
        depth: 0,
        label: `${LEVEL_LABEL[level]} — absent`,
        expandable: false,
        expanded: false,
        dimmed: true,
        isLevel: true,
      });
      continue;
    }
    const lvlExpanded = expanded.has(lid);
    rows.push({
      id: lid,
      depth: 0,
      label: LEVEL_LABEL[level],
      expandable: true,
      expanded: lvlExpanded,
      dimmed: false,
      isLevel: true,
    });
    if (!lvlExpanded) continue;

    for (const cat of categoriesFor(inv)) {
      const cid = `C:${level}:${cat.id}`;
      const catExpanded = expanded.has(cid);
      rows.push({
        id: cid,
        depth: 1,
        label: `${cat.label} (${cat.nodes.length})`,
        expandable: true,
        expanded: catExpanded,
        dimmed: false,
        isLevel: false,
      });
      if (!catExpanded) continue;
      cat.nodes.forEach((node, i) => {
        rows.push({
          id: `I:${level}:${cat.id}:${i}`,
          depth: 2,
          label: nodeLabel(node),
          expandable: false,
          expanded: false,
          dimmed: false,
          isLevel: false,
          data: node,
        });
      });
    }
  }
  return rows;
}
