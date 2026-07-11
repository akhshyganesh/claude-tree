// ABOUTME: The ScanResult data model — every Claude Code config artifact a scan can find.
// ABOUTME: Pure types only; consumed by scan.ts, loading-model.ts, render-list.ts and the TUI.

/** The four configuration scopes, highest-locality last. */
export type Level = "managed" | "user" | "project" | "local";

/** When a piece of config enters Claude's context. */
export type LoadTiming =
  | "session-start"
  | "on-demand"
  | "path-triggered"
  | "on-invocation"
  | "on-spawn"
  | "event-driven"
  | "not-loaded";

/** Records that this item wins/loses a cross-level name conflict. */
export interface OverrideInfo {
  /** Level whose same-named item this one overrides (it is the winner). */
  overrides?: Level[];
  /** Level whose same-named item overrides this one (it is the loser). */
  overriddenBy?: Level;
}

/** Fields every inventoried item carries. */
export interface BaseItem {
  name: string;
  description: string;
  /** Absolute path to the file (or directory, for skills). */
  path: string;
  level: Level;
  loadTiming: LoadTiming;
  override: OverrideInfo;
}

export interface MemoryFile extends BaseItem {
  kind: "CLAUDE.md" | "CLAUDE.local.md";
  deprecated: boolean;
  /** Raw @import targets found in the file, not recursively followed. */
  imports: string[];
  firstParagraph: string;
}

export interface RuleItem extends BaseItem {
  pathScoped: boolean;
  globs: string[];
}

export interface SkillItem extends BaseItem {
  /** true when frontmatter disable-model-invocation is set. */
  disableModelInvocation: boolean;
  /** paths: frontmatter restricting auto-activation. */
  paths: string[];
  /** true for legacy commands/*.md entries. */
  legacyCommand: boolean;
}

export interface AgentItem extends BaseItem {
  model?: string;
  tools?: string;
  /** memory: frontmatter, if declared. */
  memory?: string;
}

export interface HookEntry extends BaseItem {
  event: string;
  matcher: string;
  /** One-line summary of the command(s) wired to this hook. */
  commandSummary: string;
}

export interface McpServerItem extends BaseItem {
  /** Source config file: ".mcp.json", "~/.claude.json", etc. */
  source: string;
  transport: string;
}

export interface GenericItem extends BaseItem {}

export interface SettingsSummary {
  path: string;
  level: Level;
  allowCount: number;
  denyCount: number;
  askCount: number;
  envKeys: string[];
  hookCount: number;
}

/** Everything discovered at one level. */
export interface LevelInventory {
  level: Level;
  present: boolean;
  /** Absolute root dir(s) for this level (may be several for project chain). */
  roots: string[];
  memory: MemoryFile[];
  rules: RuleItem[];
  skills: SkillItem[];
  commands: SkillItem[];
  agents: AgentItem[];
  hooks: HookEntry[];
  settings: SettingsSummary[];
  mcpServers: McpServerItem[];
  workflows: GenericItem[];
  /** Known Claude Code runtime data (caches, logs, history) — never loaded into context. */
  runtime: GenericItem[];
  other: GenericItem[];
}

export interface ScanResult {
  cwd: string;
  home: string;
  projectRoot: string | null;
  managedRoot: string | null;
  levels: Record<Level, LevelInventory>;
}
