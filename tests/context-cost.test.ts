// ABOUTME: Unit tests for the pure context-cost estimator and scan-level summary.
// ABOUTME: Verifies token math (~chars/4) and the session-start vs deferred semantics.
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { scan } from "../src/scan.js";
import {
  estimateTokens,
  memoryCost,
  ruleCost,
  skillCost,
  agentCost,
  mcpCost,
  costBar,
  summarizeContextCost,
} from "../src/context-cost.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const HOME = path.join(here, "fixtures", "home");
const PROJECT = path.join(here, "fixtures", "project");
const result = scan({ cwd: PROJECT, home: HOME });

describe("estimateTokens", () => {
  it("is ceil(chars/4) and clamps negatives to zero", () => {
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(4)).toBe(1);
    expect(estimateTokens(5)).toBe(2);
    expect(estimateTokens(-3)).toBe(0);
  });
});

describe("per-type cost semantics", () => {
  it("memory counts the full body plus imports at session start", () => {
    const c = memoryCost(400, 40);
    expect(c.sessionStartTokens).toBe(110);
    expect(c.deferredTokens).toBe(0);
  });

  it("path-scoped rules defer their body; unconditional rules pay at start", () => {
    const scoped = ruleCost(true, 400);
    expect(scoped.sessionStartTokens).toBe(0);
    expect(scoped.deferredTokens).toBe(100);
    const uncond = ruleCost(false, 400);
    expect(uncond.sessionStartTokens).toBe(100);
    expect(uncond.deferredTokens).toBe(0);
  });

  it("skills preload only the description; body is deferred", () => {
    const c = skillCost(40, 400);
    expect(c.sessionStartTokens).toBe(10);
    expect(c.deferredTokens).toBe(100);
  });

  it("agents cost nothing at start; whole definition is deferred", () => {
    const c = agentCost(400);
    expect(c.sessionStartTokens).toBe(0);
    expect(c.deferredTokens).toBe(100);
  });

  it("mcp cost is zero but labelled varies", () => {
    const c = mcpCost();
    expect(c.sessionStartTokens).toBe(0);
    expect(c.note).toContain("varies");
  });
});

describe("scan decorates items with contextCost", () => {
  it("gives a skill a session-start (description) and deferred (body) cost", () => {
    const skill = result.levels.user.skills.find((s) => s.name === "format-code")!;
    expect(skill.contextCost).toBeDefined();
    expect(skill.contextCost!.sessionStartTokens).toBeGreaterThan(0);
    expect(skill.contextCost!.deferredTokens).toBeGreaterThan(0);
  });

  it("gives an agent zero session-start cost", () => {
    const agent = result.levels.project.agents.find((a) => a.name === "reviewer")!;
    expect(agent.contextCost!.sessionStartTokens).toBe(0);
    expect(agent.contextCost!.deferredTokens).toBeGreaterThan(0);
  });

  it("gives a path-scoped rule zero session-start cost", () => {
    const rule = result.levels.project.rules.find((r) => r.pathScoped)!;
    expect(rule.contextCost!.sessionStartTokens).toBe(0);
  });
});

describe("summarizeContextCost", () => {
  const summary = summarizeContextCost(result);

  it("totals session-start and deferred pools", () => {
    expect(summary.totalSessionStart).toBeGreaterThan(0);
    expect(summary.totalDeferred).toBeGreaterThan(0);
  });

  it("breaks cost down per level", () => {
    expect(summary.perLevel.length).toBeGreaterThan(0);
    for (const lc of summary.perLevel) {
      expect(lc.sessionStartTokens + lc.deferredTokens).toBeGreaterThan(0);
    }
  });

  it("returns top items sorted by session-start cost, highest first", () => {
    const tokens = summary.topItems.map((i) => i.sessionStartTokens);
    const sorted = [...tokens].sort((a, b) => b - a);
    expect(tokens).toEqual(sorted);
  });
});

describe("costBar", () => {
  it("renders proportional unicode blocks and empty for zero", () => {
    expect(costBar(10, 10, 10)).toBe("█".repeat(10));
    expect(costBar(0, 10, 10)).toBe("");
    expect(costBar(5, 10, 10).length).toBe(5);
  });
});
