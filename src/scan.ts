// ABOUTME: Pure filesystem discovery — walks the Claude Code config visible from a directory.
// ABOUTME: Read-only: never writes to scanned dirs; tolerates every path being missing.
import * as fs from "node:fs";
import * as path from "node:path";
import matter from "gray-matter";
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
} from "./types.js";

export interface ScanOptions {
  cwd: string;
  home: string;
  managedRoot?: string;
}

function safeRead(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function safeReadDir(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function exists(p: string): boolean {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** First non-empty, non-heading line of a markdown body — the description fallback. */
function firstParagraph(body: string): string {
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;
    if (line.startsWith("<!--")) continue;
    return line;
  }
  return "";
}

/** @import targets in a memory file (one level, not followed recursively). */
function findImports(text: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\s)@([^\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === "string") {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function emptyInventory(level: Level): LevelInventory {
  return {
    level,
    present: false,
    roots: [],
    memory: [],
    rules: [],
    skills: [],
    commands: [],
    agents: [],
    hooks: [],
    settings: [],
    mcpServers: [],
    workflows: [],
    other: [],
  };
}

const KNOWN_ENTRIES = new Set([
  "settings.json",
  "settings.local.json",
  "CLAUDE.md",
  "CLAUDE.local.md",
  "rules",
  "skills",
  "agents",
  "commands",
  "hooks",
  "workflows",
]);

/** Find the project root by walking up from cwd for a .claude/ or .git/ dir. */
export function findProjectRoot(cwd: string): string | null {
  let dir = path.resolve(cwd);
  while (true) {
    if (isDir(path.join(dir, ".claude")) || exists(path.join(dir, ".git"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function parseMemory(
  file: string,
  level: Level,
  kind: "CLAUDE.md" | "CLAUDE.local.md",
): MemoryFile | null {
  const text = safeRead(file);
  if (text === null) return null;
  const parsed = matter(text);
  const fm = parsed.data as Record<string, unknown>;
  const first = firstParagraph(parsed.content);
  const desc =
    typeof fm.description === "string" ? fm.description : first || kind;
  return {
    name: kind,
    description: desc,
    path: file,
    level,
    loadTiming: "session-start",
    override: {},
    kind,
    deprecated: kind === "CLAUDE.local.md",
    imports: findImports(text),
    firstParagraph: first,
  };
}

function parseRules(dir: string, level: Level): RuleItem[] {
  const rulesDir = path.join(dir, "rules");
  const out: RuleItem[] = [];
  for (const ent of safeReadDir(rulesDir)) {
    if (!ent.isFile() || !ent.name.endsWith(".md")) continue;
    const file = path.join(rulesDir, ent.name);
    const text = safeRead(file);
    if (text === null) continue;
    const parsed = matter(text);
    const fm = parsed.data as Record<string, unknown>;
    const globs = toStringArray(fm.paths);
    const pathScoped = globs.length > 0;
    const name =
      typeof fm.name === "string" ? fm.name : ent.name.replace(/\.md$/, "");
    const description =
      typeof fm.description === "string"
        ? fm.description
        : firstParagraph(parsed.content) || name;
    out.push({
      name,
      description,
      path: file,
      level,
      loadTiming: pathScoped ? "path-triggered" : "session-start",
      override: {},
      pathScoped,
      globs,
    });
  }
  return out;
}

function parseSkills(dir: string, level: Level): SkillItem[] {
  const skillsDir = path.join(dir, "skills");
  const out: SkillItem[] = [];
  for (const ent of safeReadDir(skillsDir)) {
    if (!ent.isDirectory()) continue;
    const file = path.join(skillsDir, ent.name, "SKILL.md");
    const text = safeRead(file);
    if (text === null) continue;
    const parsed = matter(text);
    const fm = parsed.data as Record<string, unknown>;
    const name = typeof fm.name === "string" ? fm.name : ent.name;
    const description =
      typeof fm.description === "string"
        ? fm.description
        : firstParagraph(parsed.content) || name;
    out.push({
      name,
      description,
      path: file,
      level,
      loadTiming: "on-invocation",
      override: {},
      disableModelInvocation: fm["disable-model-invocation"] === true,
      paths: toStringArray(fm.paths),
      legacyCommand: false,
    });
  }
  return out;
}

function parseCommands(dir: string, level: Level): SkillItem[] {
  const cmdDir = path.join(dir, "commands");
  const out: SkillItem[] = [];
  for (const ent of safeReadDir(cmdDir)) {
    if (!ent.isFile() || !ent.name.endsWith(".md")) continue;
    const file = path.join(cmdDir, ent.name);
    const text = safeRead(file);
    if (text === null) continue;
    const parsed = matter(text);
    const fm = parsed.data as Record<string, unknown>;
    const name =
      typeof fm.name === "string" ? fm.name : ent.name.replace(/\.md$/, "");
    const description =
      typeof fm.description === "string"
        ? fm.description
        : firstParagraph(parsed.content) || name;
    out.push({
      name,
      description,
      path: file,
      level,
      loadTiming: "on-invocation",
      override: {},
      disableModelInvocation: fm["disable-model-invocation"] === true,
      paths: toStringArray(fm.paths),
      legacyCommand: true,
    });
  }
  return out;
}

function parseAgentsRecursive(
  agentsDir: string,
  level: Level,
  out: AgentItem[],
): void {
  for (const ent of safeReadDir(agentsDir)) {
    const full = path.join(agentsDir, ent.name);
    if (ent.isDirectory()) {
      parseAgentsRecursive(full, level, out);
      continue;
    }
    if (!ent.isFile() || !ent.name.endsWith(".md")) continue;
    const text = safeRead(full);
    if (text === null) continue;
    const parsed = matter(text);
    const fm = parsed.data as Record<string, unknown>;
    const name =
      typeof fm.name === "string" ? fm.name : ent.name.replace(/\.md$/, "");
    const description =
      typeof fm.description === "string"
        ? fm.description
        : firstParagraph(parsed.content) || name;
    const agent: AgentItem = {
      name,
      description,
      path: full,
      level,
      loadTiming: "on-spawn",
      override: {},
    };
    if (typeof fm.model === "string") agent.model = fm.model;
    if (typeof fm.tools === "string") agent.tools = fm.tools;
    if (typeof fm.memory === "string") agent.memory = fm.memory;
    out.push(agent);
  }
}

function parseAgents(dir: string, level: Level): AgentItem[] {
  const out: AgentItem[] = [];
  parseAgentsRecursive(path.join(dir, "agents"), level, out);
  return out;
}

function parseGenericDir(
  dir: string,
  sub: string,
  level: Level,
  timing: "on-demand",
): GenericItem[] {
  const target = path.join(dir, sub);
  const out: GenericItem[] = [];
  for (const ent of safeReadDir(target)) {
    if (!ent.isFile()) continue;
    const file = path.join(target, ent.name);
    out.push({
      name: ent.name,
      description: `${sub} file`,
      path: file,
      level,
      loadTiming: timing,
      override: {},
    });
  }
  return out;
}

interface ParsedSettings {
  summary: SettingsSummary;
  hooks: HookEntry[];
}

function parseSettings(
  file: string,
  level: Level,
): ParsedSettings | null {
  const text = safeRead(file);
  if (text === null) return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  const permissions = (data.permissions ?? {}) as Record<string, unknown>;
  const allow = Array.isArray(permissions.allow) ? permissions.allow : [];
  const deny = Array.isArray(permissions.deny) ? permissions.deny : [];
  const ask = Array.isArray(permissions.ask) ? permissions.ask : [];
  const env = (data.env ?? {}) as Record<string, unknown>;
  const hooks = parseHooks(data.hooks, file, level);
  return {
    summary: {
      path: file,
      level,
      allowCount: allow.length,
      denyCount: deny.length,
      askCount: ask.length,
      envKeys: Object.keys(env),
      hookCount: hooks.length,
    },
    hooks,
  };
}

function parseHooks(
  block: unknown,
  file: string,
  level: Level,
): HookEntry[] {
  const out: HookEntry[] = [];
  if (!block || typeof block !== "object") return out;
  for (const [event, entriesRaw] of Object.entries(
    block as Record<string, unknown>,
  )) {
    if (!Array.isArray(entriesRaw)) continue;
    for (const entry of entriesRaw) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const matcher = typeof e.matcher === "string" ? e.matcher : "*";
      const hookList = Array.isArray(e.hooks) ? e.hooks : [];
      const commands = hookList
        .map((h) => {
          const ho = (h ?? {}) as Record<string, unknown>;
          return typeof ho.command === "string" ? ho.command : ho.type;
        })
        .filter(Boolean)
        .map((c) => String(c));
      const commandSummary = commands.join("; ") || "(no command)";
      out.push({
        name: `${event}:${matcher}`,
        description: commandSummary,
        path: file,
        level,
        loadTiming: "event-driven",
        override: {},
        event,
        matcher,
        commandSummary,
      });
    }
  }
  return out;
}

function parseMcpFile(
  file: string,
  level: Level,
  source: string,
): McpServerItem[] {
  const text = safeRead(file);
  if (text === null) return [];
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return [];
  }
  const servers = (data.mcpServers ?? {}) as Record<string, unknown>;
  const out: McpServerItem[] = [];
  for (const [name, cfgRaw] of Object.entries(servers)) {
    const cfg = (cfgRaw ?? {}) as Record<string, unknown>;
    const transport =
      typeof cfg.type === "string"
        ? cfg.type
        : typeof cfg.url === "string"
          ? "http"
          : "stdio";
    const description =
      typeof cfg.command === "string"
        ? String(cfg.command)
        : typeof cfg.url === "string"
          ? String(cfg.url)
          : transport;
    out.push({
      name,
      description,
      path: file,
      level,
      loadTiming: "session-start",
      override: {},
      source,
      transport,
    });
  }
  return out;
}

/** Populate a level inventory from a `.claude`-style directory. */
function scanClaudeDir(
  claudeDir: string,
  level: Level,
  inv: LevelInventory,
  localInv: LevelInventory,
): void {
  if (!isDir(claudeDir)) return;
  inv.present = true;
  if (!inv.roots.includes(claudeDir)) inv.roots.push(claudeDir);

  inv.rules.push(...parseRules(claudeDir, level));
  inv.skills.push(...parseSkills(claudeDir, level));
  inv.commands.push(...parseCommands(claudeDir, level));
  inv.agents.push(...parseAgents(claudeDir, level));
  inv.workflows.push(
    ...parseGenericDir(claudeDir, "workflows", level, "on-demand"),
  );

  const settings = parseSettings(path.join(claudeDir, "settings.json"), level);
  if (settings) {
    inv.settings.push(settings.summary);
    inv.hooks.push(...settings.hooks);
  }
  const localSettings = parseSettings(
    path.join(claudeDir, "settings.local.json"),
    "local",
  );
  if (localSettings) {
    localInv.present = true;
    if (!localInv.roots.includes(claudeDir)) localInv.roots.push(claudeDir);
    localInv.settings.push(localSettings.summary);
    localInv.hooks.push(...localSettings.hooks);
  }

  // Everything else at the top level of the dir → "other, not loaded".
  for (const ent of safeReadDir(claudeDir)) {
    if (KNOWN_ENTRIES.has(ent.name)) continue;
    if (ent.name === ".mcp.json") continue;
    inv.other.push({
      name: ent.name,
      description: ent.isDirectory() ? "directory" : "file",
      path: path.join(claudeDir, ent.name),
      level,
      loadTiming: "on-demand",
      override: {},
    });
  }
}

/** Resolve name-conflict winners; precedence winner-first. */
function resolveConflicts<T extends { name: string; level: Level; override: import("./types.js").OverrideInfo }>(
  itemsByLevel: Partial<Record<Level, T[]>>,
  precedence: Level[],
): void {
  const names = new Set<string>();
  for (const items of Object.values(itemsByLevel)) {
    for (const it of items ?? []) names.add(it.name);
  }
  for (const name of names) {
    const present = precedence.filter((lvl) =>
      (itemsByLevel[lvl] ?? []).some((it) => it.name === name),
    );
    if (present.length < 2) continue;
    const winner = present[0]!;
    const losers = present.slice(1);
    for (const it of itemsByLevel[winner] ?? []) {
      if (it.name === name) it.override.overrides = losers;
    }
    for (const lvl of losers) {
      for (const it of itemsByLevel[lvl] ?? []) {
        if (it.name === name) it.override.overriddenBy = winner;
      }
    }
  }
}

export function scan(opts: ScanOptions): ScanResult {
  const cwd = path.resolve(opts.cwd);
  const home = path.resolve(opts.home);
  const projectRoot = findProjectRoot(cwd);
  const managedRoot = opts.managedRoot ?? null;

  const levels: Record<Level, LevelInventory> = {
    managed: emptyInventory("managed"),
    user: emptyInventory("user"),
    project: emptyInventory("project"),
    local: emptyInventory("local"),
  };

  // Managed level.
  if (managedRoot && isDir(managedRoot)) {
    const inv = levels.managed;
    inv.present = true;
    inv.roots.push(managedRoot);
    inv.agents.push(...parseAgents(managedRoot, "managed"));
    const managedMemory = parseMemory(
      path.join(managedRoot, "CLAUDE.md"),
      "managed",
      "CLAUDE.md",
    );
    if (managedMemory) inv.memory.push(managedMemory);
    const managedSettings = parseSettings(
      path.join(managedRoot, "managed-settings.json"),
      "managed",
    );
    if (managedSettings) {
      inv.settings.push(managedSettings.summary);
      inv.hooks.push(...managedSettings.hooks);
    }
    inv.mcpServers.push(
      ...parseMcpFile(
        path.join(managedRoot, "managed-mcp.json"),
        "managed",
        "managed-mcp.json",
      ),
    );
  }

  // User level (~/.claude).
  const userClaude = path.join(home, ".claude");
  scanClaudeDir(userClaude, "user", levels.user, levels.local);
  const userMemory = parseMemory(
    path.join(userClaude, "CLAUDE.md"),
    "user",
    "CLAUDE.md",
  );
  if (userMemory) {
    levels.user.present = true;
    if (!levels.user.roots.includes(userClaude))
      levels.user.roots.push(userClaude);
    levels.user.memory.push(userMemory);
  }
  const userLocalMemory = parseMemory(
    path.join(userClaude, "CLAUDE.local.md"),
    "local",
    "CLAUDE.local.md",
  );
  if (userLocalMemory) {
    levels.local.present = true;
    if (!levels.local.roots.includes(userClaude))
      levels.local.roots.push(userClaude);
    levels.local.memory.push(userLocalMemory);
  }
  // User MCP from ~/.claude.json.
  levels.user.mcpServers.push(
    ...parseMcpFile(path.join(home, ".claude.json"), "user", "~/.claude.json"),
  );

  // Project level (<root>/.claude + <root>/CLAUDE.md + <root>/.mcp.json).
  if (projectRoot) {
    const projClaude = path.join(projectRoot, ".claude");
    scanClaudeDir(projClaude, "project", levels.project, levels.local);
    const projMemory = parseMemory(
      path.join(projectRoot, "CLAUDE.md"),
      "project",
      "CLAUDE.md",
    );
    if (projMemory) {
      levels.project.present = true;
      if (!levels.project.roots.includes(projectRoot))
        levels.project.roots.push(projectRoot);
      levels.project.memory.push(projMemory);
    }
    const projLocalMemory = parseMemory(
      path.join(projectRoot, "CLAUDE.local.md"),
      "local",
      "CLAUDE.local.md",
    );
    if (projLocalMemory) {
      levels.local.present = true;
      if (!levels.local.roots.includes(projectRoot))
        levels.local.roots.push(projectRoot);
      levels.local.memory.push(projLocalMemory);
    }
    levels.project.mcpServers.push(
      ...parseMcpFile(
        path.join(projectRoot, ".mcp.json"),
        "project",
        ".mcp.json",
      ),
    );
  }

  // Conflict resolution.
  // Skills: enterprise(managed) > user > project.
  resolveConflicts(
    {
      managed: levels.managed.skills,
      user: levels.user.skills,
      project: levels.project.skills,
    },
    ["managed", "user", "project"],
  );
  // Agents: managed > project > user (opposite asymmetry).
  resolveConflicts(
    {
      managed: levels.managed.agents,
      project: levels.project.agents,
      user: levels.user.agents,
    },
    ["managed", "project", "user"],
  );

  return { cwd, home, projectRoot, managedRoot, levels };
}
