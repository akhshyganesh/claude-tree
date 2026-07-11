// ABOUTME: Unit tests for the pure detail-pane builder — timing labels, overrides, frontmatter.
// ABOUTME: Drives buildDetail with NodeData drawn from the scanned fixtures.
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { scan } from "../src/scan.js";
import { buildDetail } from "../src/tui/detail.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const HOME = path.join(here, "fixtures", "home");
const PROJECT = path.join(here, "fixtures", "project");
const result = scan({ cwd: PROJECT, home: HOME });

function texts(lines: { text: string }[]): string {
  return lines.map((l) => l.text).join("\n");
}

describe("buildDetail", () => {
  it("shows a skill's timing explanation and frontmatter", () => {
    const skill = result.levels.project.skills.find(
      (s) => s.name === "format-code",
    )!;
    const out = texts(buildDetail({ type: "skill", item: skill }));
    expect(out).toContain("load timing: on invocation");
    expect(out).toContain("description preloads");
    expect(out).toContain("disable-model-invocation: true");
    expect(out).toContain("overridden by user level");
  });

  it("shows an agent's model and tools", () => {
    const agent = result.levels.project.agents.find(
      (a) => a.name === "reviewer",
    )!;
    const out = texts(buildDetail({ type: "agent", item: agent }));
    expect(out).toContain("model: opus");
    expect(out).toContain("tools:");
    expect(out).toContain("load timing: on spawn");
  });

  it("shows hook event, matcher, and command", () => {
    const hook = result.levels.user.hooks.find(
      (h) => h.event === "PreToolUse",
    )!;
    const out = texts(buildDetail({ type: "hook", item: hook }));
    expect(out).toContain("event: PreToolUse");
    expect(out).toContain("matcher: Bash");
    expect(out).toContain("command:");
    expect(out).toContain("guard.sh");
  });

  it("labels runtime data as not loaded, never on demand", () => {
    const out = texts(
      buildDetail({ type: "runtime", count: 3, level: "project" }),
    );
    expect(out).toContain("load timing: not loaded");
    expect(out).not.toContain("on demand");
  });
});
