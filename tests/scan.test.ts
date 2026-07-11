// ABOUTME: Tests for the pure scan() discovery against fixture home/project directories.
// ABOUTME: Never touches the real ~/.claude — home is always a fixture path.
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
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
