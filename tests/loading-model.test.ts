// ABOUTME: Tests for the loading-model reference data and buildLoadOrder phase slotting.
// ABOUTME: Verifies the docs-verified precedence facts, incl. the skills-vs-agents asymmetry.
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { scan } from "../src/scan.js";
import {
  AGENT_PRECEDENCE,
  SETTINGS_PRECEDENCE,
  SKILL_PRECEDENCE,
  buildLoadOrder,
} from "../src/loading-model.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const HOME = path.join(here, "fixtures", "home");
const PROJECT = path.join(here, "fixtures", "project");

describe("loading-model reference data", () => {
  it("encodes settings precedence highest-first, managed on top", () => {
    expect(SETTINGS_PRECEDENCE[0]).toContain("Managed");
    expect(SETTINGS_PRECEDENCE[SETTINGS_PRECEDENCE.length - 1]).toContain(
      "user",
    );
  });

  it("encodes the skills-vs-agents precedence asymmetry", () => {
    // Skills: managed > user > project.
    expect(SKILL_PRECEDENCE).toEqual(["managed", "user", "project"]);
    // Agents: managed > project > user (the opposite ordering of user/project).
    expect(AGENT_PRECEDENCE).toEqual(["managed", "project", "user"]);
  });
});

describe("buildLoadOrder", () => {
  const phases = buildLoadOrder(
    scan({ cwd: PROJECT, home: HOME }),
  );

  it("produces the three ordered phases", () => {
    expect(phases.map((p) => p.id)).toEqual([
      "config-resolution",
      "memory-injection",
      "dormant-until-triggered",
    ]);
    expect(phases.map((p) => p.order)).toEqual([1, 2, 3]);
  });

  it("puts CLAUDE.md memory in phase 2", () => {
    const memory = phases[1]!;
    const names = memory.items.map((i) => i.name);
    expect(names).toContain("CLAUDE.md");
  });

  it("puts skills, path-scoped rules, and agents in the dormant phase", () => {
    const dormant = phases[2]!;
    const names = dormant.items.map((i) => i.name);
    expect(names).toContain("format-code");
    expect(names).toContain("frontend-rule");
    expect(names).toContain("reviewer");
  });

  it("puts hooks and mcp servers in config resolution", () => {
    const config = phases[0]!;
    const details = config.items.map((i) => i.detail).join(" | ");
    expect(details).toContain("hook");
    expect(details).toContain("MCP server");
  });
});
