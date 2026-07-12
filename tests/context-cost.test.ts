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
  contextCostHeadline,
  autoMemorySliceChars,
  autoMemoryCost,
  formatTokens,
  CLAUDE_CODE_BASELINE,
  AUTO_MEMORY_MAX_LINES,
} from "../src/context-cost.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const HOME = path.join(here, "fixtures", "home");
const PROJECT = path.join(here, "fixtures", "project");
const result = scan({ cwd: PROJECT, home: HOME });

describe("estimateTokens (per-content-type divisors)", () => {
  it("clamps zero and negatives", () => {
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(-3, "markdown")).toBe(0);
  });

  it("uses a distinct divisor per content kind", () => {
    // Chars chosen so each divisor lands on a round 10 tokens.
    expect(estimateTokens(46, "markdown")).toBe(10); // ÷4.6
    expect(estimateTokens(36, "code")).toBe(10); // ÷3.6
    expect(estimateTokens(42, "json")).toBe(10); // ÷4.2
    expect(estimateTokens(44, "text")).toBe(10); // ÷4.4
  });

  it("defaults to the text divisor (4.4) and always rounds up", () => {
    expect(estimateTokens(45)).toBe(11); // 45/4.4 = 10.2 → 11
  });

  it("code is denser than markdown for the same char count", () => {
    expect(estimateTokens(1000, "code")).toBeGreaterThan(
      estimateTokens(1000, "markdown"),
    );
  });
});

describe("per-type cost semantics (markdown divisor 4.6)", () => {
  it("memory counts the full body plus imports at session start", () => {
    const c = memoryCost(400, 40); // 440/4.6 = 95.65 → 96
    expect(c.sessionStartTokens).toBe(96);
    expect(c.deferredTokens).toBe(0);
  });

  it("path-scoped rules defer their body; unconditional rules pay at start", () => {
    const scoped = ruleCost(true, 400); // 400/4.6 = 86.96 → 87
    expect(scoped.sessionStartTokens).toBe(0);
    expect(scoped.deferredTokens).toBe(87);
    const uncond = ruleCost(false, 400);
    expect(uncond.sessionStartTokens).toBe(87);
    expect(uncond.deferredTokens).toBe(0);
  });

  it("skills preload only the description; body is deferred", () => {
    const c = skillCost(40, 400); // 40/4.6 → 9, 400/4.6 → 87
    expect(c.sessionStartTokens).toBe(9);
    expect(c.deferredTokens).toBe(87);
  });

  it("agents cost nothing at start; whole definition is deferred", () => {
    const c = agentCost(400);
    expect(c.sessionStartTokens).toBe(0);
    expect(c.deferredTokens).toBe(87);
  });

  it("mcp cost is zero but labelled varies", () => {
    const c = mcpCost();
    expect(c.sessionStartTokens).toBe(0);
    expect(c.note).toContain("varies");
  });
});

describe("auto-memory slice capping", () => {
  it("caps at the first 200 lines", () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line-${i}`).join("\n");
    const first200 = lines.split("\n").slice(0, AUTO_MEMORY_MAX_LINES).join("\n");
    expect(autoMemorySliceChars(lines)).toBe(first200.length);
    // Fewer chars than the whole thing.
    expect(autoMemorySliceChars(lines)).toBeLessThan(lines.length);
  });

  it("caps at 25KB even within 200 lines", () => {
    // Ten very long lines that together exceed 25KB.
    const huge = Array.from({ length: 10 }, () => "x".repeat(5000)).join("\n");
    expect(autoMemorySliceChars(huge)).toBe(25 * 1024);
  });

  it("returns the full length when under both caps", () => {
    const small = "short memory\ncontent";
    expect(autoMemorySliceChars(small)).toBe(small.length);
  });

  it("autoMemoryCost costs only the slice at session start, notes on-demand topics", () => {
    const huge = Array.from({ length: 10 }, () => "x".repeat(5000)).join("\n");
    const c = autoMemoryCost(huge);
    expect(c.sessionStartTokens).toBe(estimateTokens(25 * 1024, "markdown"));
    expect(c.deferredTokens).toBe(0);
    expect(c.note).toContain("on demand");
  });
});

describe("formatTokens", () => {
  it("compacts thousands and leaves small counts alone", () => {
    expect(formatTokens(5200)).toBe("5.2k");
    expect(formatTokens(5700)).toBe("5.7k");
    expect(formatTokens(900)).toBe("900");
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

  it("carries the Claude Code baseline range", () => {
    expect(summary.baseline).toBe(CLAUDE_CODE_BASELINE);
    expect(summary.baseline.minTokens).toBe(5200);
    expect(summary.baseline.maxTokens).toBe(5700);
  });

  it("estimates a session-start range = baseline + config + auto memory", () => {
    const base = summary.totalSessionStart + summary.autoMemoryTokens;
    expect(summary.estimatedSessionStartMin).toBe(5200 + base);
    expect(summary.estimatedSessionStartMax).toBe(5700 + base);
  });
});

describe("contextCostHeadline", () => {
  it("shows baseline, config, and the session-start range when config exists", () => {
    const headline = contextCostHeadline(summarizeContextCost(result));
    const text = headline.map((h) => h.text).join("\n");
    expect(text).toContain("Claude Code baseline ~5.2k–5.7k");
    expect(text).toContain("your config adds ~");
    expect(text).toMatch(/= session start ~[\d.]+k?–[\d.]+k?/);
  });

  it("still shows the baseline and 'no config context' for an empty scan", () => {
    const empty = scan({ cwd: "/nonexistent/xyz", home: "/nonexistent/home" });
    const summary = summarizeContextCost(empty);
    const text = contextCostHeadline(summary).map((h) => h.text).join("\n");
    expect(summary.totalSessionStart).toBe(0);
    expect(text).toContain("Claude Code baseline ~5.2k–5.7k");
    expect(text).toContain("this directory adds no config context");
    expect(text).toContain("= session start ~5.2k–5.7k");
  });
});

describe("costBar", () => {
  it("renders proportional unicode blocks and empty for zero", () => {
    expect(costBar(10, 10, 10)).toBe("█".repeat(10));
    expect(costBar(0, 10, 10)).toBe("");
    expect(costBar(5, 10, 10).length).toBe(5);
  });
});
