// ABOUTME: Tests for the pure scan() discovery against fixture home/project directories.
// ABOUTME: Never touches the real ~/.claude — home is always a fixture path.
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scan } from "../src/scan.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const HOME = path.join(here, "fixtures", "home");
const PROJECT = path.join(here, "fixtures", "project");

function run() {
  return scan({ cwd: PROJECT, home: HOME });
}

describe("scan", () => {
  it("finds the project root by walking up to .claude", () => {
    const r = run();
    expect(r.projectRoot).toBe(PROJECT);
  });

  it("marks present levels and shows managed as absent", () => {
    const r = run();
    expect(r.levels.user.present).toBe(true);
    expect(r.levels.project.present).toBe(true);
    expect(r.levels.local.present).toBe(true);
    expect(r.levels.managed.present).toBe(false);
  });

  it("parses user memory with @imports and first paragraph", () => {
    const r = run();
    const mem = r.levels.user.memory.find((m) => m.kind === "CLAUDE.md");
    expect(mem).toBeDefined();
    expect(mem!.imports).toEqual(["docs/style.md", "~/.claude/extra.md"]);
    expect(mem!.firstParagraph).toContain("helpful engineering assistant");
    expect(mem!.loadTiming).toBe("session-start");
  });

  it("routes CLAUDE.local.md into the local level as deprecated", () => {
    const r = run();
    const local = r.levels.local.memory.find(
      (m) => m.kind === "CLAUDE.local.md",
    );
    expect(local).toBeDefined();
    expect(local!.deprecated).toBe(true);
  });

  it("parses skill frontmatter incl. disable-model-invocation", () => {
    const r = run();
    const projSkill = r.levels.project.skills.find(
      (s) => s.name === "format-code",
    );
    expect(projSkill!.disableModelInvocation).toBe(true);
    expect(projSkill!.loadTiming).toBe("on-invocation");
    const userSkill = r.levels.user.skills.find(
      (s) => s.name === "format-code",
    );
    expect(userSkill!.disableModelInvocation).toBe(false);
  });

  it("marks path-scoped rules with globs and path-triggered timing", () => {
    const r = run();
    const rule = r.levels.project.rules.find((x) => x.name === "frontend-rule");
    expect(rule!.pathScoped).toBe(true);
    expect(rule!.globs).toContain("src/**/*.tsx");
    expect(rule!.loadTiming).toBe("path-triggered");
  });

  it("parses agent model/tools", () => {
    const r = run();
    const proj = r.levels.project.agents.find((a) => a.name === "reviewer");
    expect(proj!.model).toBe("opus");
    expect(proj!.tools).toContain("Edit");
    expect(proj!.loadTiming).toBe("on-spawn");
  });

  it("summarizes settings and parses hooks", () => {
    const r = run();
    const s = r.levels.user.settings[0]!;
    expect(s.allowCount).toBe(2);
    expect(s.denyCount).toBe(1);
    expect(s.envKeys).toEqual(["FOO", "BAZ"]);
    expect(s.hookCount).toBe(2);
    const hookEvents = r.levels.user.hooks.map((h) => h.event).sort();
    expect(hookEvents).toEqual(["PreToolUse", "Stop"]);
    const preTool = r.levels.user.hooks.find((h) => h.event === "PreToolUse")!;
    expect(preTool.matcher).toBe("Bash");
    expect(preTool.commandSummary).toContain("guard.sh");
    expect(preTool.loadTiming).toBe("event-driven");
  });

  it("routes settings.local.json into the local level", () => {
    const r = run();
    const s = r.levels.local.settings[0]!;
    expect(s.askCount).toBe(1);
    expect(s.envKeys).toEqual(["LOCAL_ONLY"]);
  });

  it("parses .mcp.json servers with transport", () => {
    const r = run();
    const names = r.levels.project.mcpServers.map((m) => m.name).sort();
    expect(names).toEqual(["docs", "postgres"]);
    const docs = r.levels.project.mcpServers.find((m) => m.name === "docs")!;
    expect(docs.transport).toBe("http");
    expect(docs.source).toBe(".mcp.json");
  });

  it("collects legacy commands, workflows, and unrecognized files", () => {
    const r = run();
    expect(r.levels.project.commands.map((c) => c.name)).toContain("deploy");
    expect(r.levels.project.workflows.map((w) => w.name)).toContain(
      "nightly.js",
    );
    expect(r.levels.project.other.map((o) => o.name)).toContain("notes.txt");
  });

  it("classifies known runtime data separately from unknown files", () => {
    const r = run();
    const runtimeNames = r.levels.project.runtime.map((x) => x.name);
    expect(runtimeNames).toContain("history.jsonl");
    expect(runtimeNames).toContain("projects");
    expect(runtimeNames).toContain("pkg.lock");
    expect(runtimeNames).toContain(".credentials.json");
    // Genuinely-unknown files stay in "other", not "runtime".
    expect(r.levels.project.other.map((o) => o.name)).not.toContain(
      "history.jsonl",
    );
    // Runtime items carry the not-loaded timing (never "on demand").
    const hist = r.levels.project.runtime.find(
      (x) => x.name === "history.jsonl",
    )!;
    expect(hist.loadTiming).toBe("not-loaded");
  });

  it("tolerates a totally empty environment", () => {
    const r = scan({ cwd: "/nonexistent/dir/xyz", home: "/nonexistent/home" });
    expect(r.projectRoot).toBeNull();
    expect(r.levels.user.present).toBe(false);
  });
});

describe("conflict resolution (asymmetric)", () => {
  it("skills: user wins over project", () => {
    const r = run();
    const userSkill = r.levels.user.skills.find(
      (s) => s.name === "format-code",
    )!;
    const projSkill = r.levels.project.skills.find(
      (s) => s.name === "format-code",
    )!;
    expect(userSkill.override.overrides).toEqual(["project"]);
    expect(userSkill.override.overriddenBy).toBeUndefined();
    expect(projSkill.override.overriddenBy).toBe("user");
  });

  it("agents: project wins over user (opposite of skills)", () => {
    const r = run();
    const projAgent = r.levels.project.agents.find(
      (a) => a.name === "reviewer",
    )!;
    const userAgent = r.levels.user.agents.find((a) => a.name === "reviewer")!;
    expect(projAgent.override.overrides).toEqual(["user"]);
    expect(userAgent.override.overriddenBy).toBe("project");
  });
});

describe("@import detection", () => {
  it("ignores mid-line @mentions (e.g. scoped package names)", () => {
    const r = run();
    const mem = r.levels.user.memory.find((m) => m.kind === "CLAUDE.md")!;
    // The fixture mentions @anthropic-ai/sdk in prose — not a line-leading import.
    expect(mem.imports).not.toContain("anthropic-ai/sdk");
    expect(mem.imports).toEqual(["docs/style.md", "~/.claude/extra.md"]);
  });
});

describe("home/project overlap (blocker)", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const d of tmpDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  function makeHome(withGit: boolean): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ct-home-"));
    tmpDirs.push(dir);
    const claude = path.join(dir, ".claude", "skills", "shared");
    fs.mkdirSync(claude, { recursive: true });
    fs.writeFileSync(
      path.join(claude, "SKILL.md"),
      "---\nname: shared\ndescription: a user skill\n---\nbody\n",
    );
    fs.writeFileSync(
      path.join(dir, ".claude", "CLAUDE.md"),
      "# user memory\n\nhi\n",
    );
    if (withGit) fs.mkdirSync(path.join(dir, ".git"));
    return dir;
  }

  it("running from $HOME leaves the project level absent, no self-overrides", () => {
    const home = makeHome(false);
    const r = scan({ cwd: home, home });
    expect(r.levels.project.present).toBe(false);
    // The user skill must not be flagged as overriding itself.
    const skill = r.levels.user.skills.find((s) => s.name === "shared")!;
    expect(skill.override.overrides).toBeUndefined();
    expect(skill.override.overriddenBy).toBeUndefined();
  });

  it("treats project absent when project .claude resolves to the user .claude", () => {
    // A home dir that IS a real project (has .git) would otherwise resolve as
    // its own project root; the overlap guard must still suppress it.
    const home = makeHome(true);
    const r = scan({ cwd: home, home });
    expect(r.levels.project.present).toBe(false);
    const skill = r.levels.user.skills.find((s) => s.name === "shared")!;
    expect(skill.override.overriddenBy).toBeUndefined();
  });
});

describe("ancestor-chain memory", () => {
  it("reads CLAUDE.md in directories between projectRoot and cwd", () => {
    const nested = path.join(PROJECT, "packages", "web");
    const r = scan({ cwd: nested, home: HOME });
    const paths = r.levels.project.memory.map((m) => m.path);
    expect(paths).toContain(path.join(PROJECT, "CLAUDE.md"));
    expect(paths).toContain(path.join(nested, "CLAUDE.md"));
  });

  it("reads project memory from .claude/CLAUDE.md as well as root CLAUDE.md", () => {
    const r = run();
    const paths = r.levels.project.memory.map((m) => m.path);
    // Both locations exist in the fixture; both must be included.
    expect(paths).toContain(path.join(PROJECT, "CLAUDE.md"));
    expect(paths).toContain(path.join(PROJECT, ".claude", "CLAUDE.md"));
  });

  it("finds project memory when only .claude/CLAUDE.md exists (no root CLAUDE.md)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ct-dotclaude-"));
    try {
      fs.mkdirSync(path.join(dir, ".claude"));
      fs.mkdirSync(path.join(dir, ".git"));
      fs.writeFileSync(
        path.join(dir, ".claude", "CLAUDE.md"),
        "# dot-claude memory\n\nonly here\n",
      );
      const r = scan({ cwd: dir, home: HOME });
      expect(r.levels.project.memory.map((m) => m.path)).toContain(
        path.join(dir, ".claude", "CLAUDE.md"),
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("symlink handling", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const d of tmpDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("follows symlinked skill dirs, rule files, and agent files", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ct-sym-"));
    tmpDirs.push(home);
    const claude = path.join(home, ".claude");
    // Real skill dir + a symlink to it under a different name.
    const realSkill = path.join(claude, "skills", "real");
    fs.mkdirSync(realSkill, { recursive: true });
    fs.writeFileSync(
      path.join(realSkill, "SKILL.md"),
      "---\nname: real\ndescription: real skill\n---\nbody\n",
    );
    fs.symlinkSync(realSkill, path.join(claude, "skills", "linked"), "dir");
    // Real rule + symlinked rule file.
    const rules = path.join(claude, "rules");
    fs.mkdirSync(rules, { recursive: true });
    const realRule = path.join(rules, "real.md");
    fs.writeFileSync(realRule, "# real rule\n\nalways on\n");
    fs.symlinkSync(realRule, path.join(rules, "linked.md"));
    // Real agent + symlinked agent file.
    const agents = path.join(claude, "agents");
    fs.mkdirSync(agents, { recursive: true });
    const realAgent = path.join(agents, "real.md");
    fs.writeFileSync(
      realAgent,
      "---\nname: realagent\ndescription: an agent\n---\nbody\n",
    );
    fs.symlinkSync(realAgent, path.join(agents, "linked.md"));

    const r = scan({ cwd: home, home });
    expect(r.levels.user.skills.map((s) => s.name).sort()).toEqual([
      "real",
      "real",
    ]);
    expect(r.levels.user.rules.length).toBe(2);
    expect(r.levels.user.agents.length).toBe(2);
  });
});
