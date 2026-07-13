// ABOUTME: Tests for the v2.1 launch pass — ancestor discovery (M1), plugin/runtime
// ABOUTME: classification (M3), the model gauge, formatTokens rounding, and --memories.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scan, ancestorsAboveRoot } from "../src/scan.js";
import { renderList, renderMemories } from "../src/render-list.js";
import { summarizeContextCost, formatTokens } from "../src/context-cost.js";
import {
  MODELS,
  DEFAULT_MODEL_ID,
  modelById,
  gaugeFor,
  gaugeAllModels,
  formatWindow,
} from "../src/models.js";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmpHome(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ct-v21-"));
  tmpDirs.push(d);
  return d;
}

describe("M1: ancestor config above the project root", () => {
  it("lists the dirs strictly between home and the project root", () => {
    expect(ancestorsAboveRoot("/h/ws/proj", "/h")).toEqual(["/h/ws"]);
    expect(ancestorsAboveRoot("/h/a/b/proj", "/h")).toEqual(["/h/a", "/h/a/b"]);
    expect(ancestorsAboveRoot("/h/proj", "/h")).toEqual([]);
    // Not nested under home → no walk.
    expect(ancestorsAboveRoot("/elsewhere/proj", "/h")).toEqual([]);
  });

  it("discovers a parent dir's CLAUDE.md and .claude for a nested repo", () => {
    const home = tmpHome();
    const ws = path.join(home, "ws");
    const proj = path.join(ws, "proj");
    fs.mkdirSync(path.join(proj, ".git"), { recursive: true });
    fs.mkdirSync(path.join(ws, ".claude", "skills", "ancestor-skill"), {
      recursive: true,
    });
    fs.writeFileSync(path.join(ws, "CLAUDE.md"), "# ws conventions\nAlways x.\n");
    fs.writeFileSync(
      path.join(ws, ".claude", "skills", "ancestor-skill", "SKILL.md"),
      "---\ndescription: from the ancestor\n---\nbody\n",
    );

    const result = scan({ cwd: proj, home });
    expect(result.projectRoot).toBe(proj);
    const memNames = result.levels.project.memory.map((m) => m.path);
    expect(memNames).toContain(path.join(ws, "CLAUDE.md"));
    expect(
      result.levels.project.skills.some((s) => s.name === "ancestor-skill"),
    ).toBe(true);
    // And it counts toward the session-start cost.
    const summary = summarizeContextCost(result);
    expect(summary.totalSessionStart).toBeGreaterThan(0);
  });
});

describe("M3: plugin and runtime classification", () => {
  it("gives plugins their own category and hides new runtime noise", () => {
    const home = tmpHome();
    const claude = path.join(home, ".claude");
    fs.mkdirSync(path.join(claude, "plugins"), { recursive: true });
    fs.mkdirSync(path.join(claude, "sessions"), { recursive: true });
    fs.writeFileSync(path.join(claude, "remote-settings.json"), "{}");
    fs.writeFileSync(path.join(claude, "statusline-command.sh"), "#!/bin/sh\n");
    fs.writeFileSync(path.join(claude, "CLAUDE.md"), "hi\n");

    const result = scan({ cwd: home, home });
    expect(result.levels.user.plugins).toHaveLength(1);
    expect(result.levels.user.plugins[0]!.description).toContain("loadable");
    const otherNames = result.levels.user.other.map((o) => o.name);
    expect(otherNames).not.toContain("sessions");
    expect(otherNames).not.toContain("remote-settings.json");
    expect(otherNames).not.toContain("statusline-command.sh");
    const out = renderList(result);
    expect(out).not.toContain("other (not loaded)");
  });
});

describe("formatTokens (2 significant figures)", () => {
  it("rounds so estimates never look exact", () => {
    expect(formatTokens(1888)).toBe("1.9k");
    expect(formatTokens(12345)).toBe("12k");
    expect(formatTokens(5200)).toBe("5.2k");
    expect(formatTokens(47)).toBe("47");
  });
});

describe("model gauge", () => {
  const empty = scan({ cwd: "/nonexistent/xyz", home: "/nonexistent/home" });
  const summary = summarizeContextCost(empty);

  it("knows the docs-verified windows and default model", () => {
    expect(modelById(DEFAULT_MODEL_ID).label).toBe("Opus 4.8");
    expect(modelById("claude-haiku-4-5").contextWindow).toBe(200_000);
    expect(formatWindow(1_000_000)).toBe("1M");
    expect(formatWindow(200_000)).toBe("200k");
  });

  it("fills proportionally to the window (Haiku 5x fuller than 1M models)", () => {
    const opus = gaugeFor(summary, modelById("claude-opus-4-8"));
    const haiku = gaugeFor(summary, modelById("claude-haiku-4-5"));
    expect(haiku.fillFraction).toBeCloseTo(opus.fillFraction * 5, 5);
    expect(opus.line).toContain("/ 1M");
    expect(haiku.line).toContain("/ 200k");
    expect(opus.bar).toHaveLength(10);
  });

  it("produces one gauge per model", () => {
    expect(gaugeAllModels(summary)).toHaveLength(MODELS.length);
  });
});

describe("--memories view", () => {
  it("lists every memory file in merge order with paths", () => {
    const home = tmpHome();
    const proj = path.join(home, "proj");
    fs.mkdirSync(path.join(proj, ".git"), { recursive: true });
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(home, ".claude", "CLAUDE.md"), "user memory\n");
    fs.writeFileSync(path.join(proj, "CLAUDE.md"), "project memory\n");

    const out = renderMemories(scan({ cwd: proj, home }));
    expect(out).toContain("merge order");
    expect(out).toContain(path.join(proj, "CLAUDE.md"));
    expect(out).toContain(path.join(home, ".claude", "CLAUDE.md"));
    // Project loads before user (user read last, wins).
    expect(out.indexOf(path.join(proj, "CLAUDE.md"))).toBeLessThan(
      out.indexOf(path.join(home, ".claude", "CLAUDE.md")),
    );
  });

  it("shows what is inside each memory file, capped with a truncation marker", () => {
    const home = tmpHome();
    const proj = path.join(home, "proj");
    fs.mkdirSync(path.join(proj, ".git"), { recursive: true });
    const body = ["# my rules", ...Array.from({ length: 60 }, (_, i) => `rule ${i}`)];
    fs.writeFileSync(path.join(proj, "CLAUDE.md"), body.join("\n"));

    const out = renderMemories(scan({ cwd: proj, home }));
    expect(out).toContain("┌─ contents:");
    expect(out).toContain("│ # my rules");
    expect(out).toContain("│ rule 38"); // inside the 40-line cap
    expect(out).not.toContain("rule 45"); // beyond the cap
    expect(out).toMatch(/… \d+ more line\(s\)/);
  });

  it("says so when nothing is found", () => {
    const out = renderMemories(
      scan({ cwd: "/nonexistent/xyz", home: "/nonexistent/home" }),
    );
    expect(out).toContain("no memory files found");
  });
});
