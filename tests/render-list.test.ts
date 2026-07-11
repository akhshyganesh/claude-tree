// ABOUTME: Tests for the plain-text --list renderer — asserts on specific lines, not snapshots.
// ABOUTME: Confirms absent levels, timing tags, and override notes render as expected.
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { scan } from "../src/scan.js";
import { renderList } from "../src/render-list.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const HOME = path.join(here, "fixtures", "home");
const PROJECT = path.join(here, "fixtures", "project");

function render() {
  return renderList(scan({ cwd: PROJECT, home: HOME }));
}

describe("renderList", () => {
  const out = render();
  const lines = out.split("\n");

  it("shows an absent managed level", () => {
    expect(lines).toContain("▸ Managed (org policy): absent");
  });

  it("shows a skill line with its description and load-timing tag", () => {
    const skillLine = lines.find(
      (l) => l.includes("format-code") && l.includes("[on invocation]"),
    );
    expect(skillLine).toBeDefined();
  });

  it("annotates the user skill as overriding project", () => {
    const winner = lines.find(
      (l) => l.includes("format-code") && l.includes("overrides project"),
    );
    expect(winner).toBeDefined();
  });

  it("annotates the losing project skill as overridden by user", () => {
    const loser = lines.find(
      (l) => l.includes("format-code") && l.includes("overridden by user"),
    );
    expect(loser).toBeDefined();
  });

  it("marks a path-scoped rule as path-triggered", () => {
    const ruleLine = lines.find(
      (l) => l.includes("frontend-rule") && l.includes("[path-triggered]"),
    );
    expect(ruleLine).toBeDefined();
  });

  it("collapses runtime data into a single line", () => {
    const rt = lines.find((l) =>
      /runtime data \(\d+ items, not loaded into context\)/.test(l),
    );
    expect(rt).toBeDefined();
  });

  it("never labels runtime data as [on demand]", () => {
    const rt = lines.find((l) => l.includes("runtime data ("));
    expect(rt).not.toContain("[on demand]");
  });

  it("renders the three load-order phases", () => {
    expect(out).toContain("1. Config resolution");
    expect(out).toContain("2. Memory injection");
    expect(out).toContain("3. Dormant until triggered");
  });
});
