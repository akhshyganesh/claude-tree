// ABOUTME: Unit tests for the pure TUI tree model — flattening, absent levels, expand/collapse.
// ABOUTME: No Ink here; asserts on Row output from buildRows against the fixtures.
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { scan } from "../src/scan.js";
import { buildRows, levelId, nodeLabel } from "../src/tui/tree.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const HOME = path.join(here, "fixtures", "home");
const PROJECT = path.join(here, "fixtures", "project");
const result = scan({ cwd: PROJECT, home: HOME });

describe("buildRows", () => {
  it("renders an absent level as a single dimmed, non-expandable row", () => {
    const rows = buildRows(result, new Set());
    const managed = rows.find((r) => r.id === levelId("managed"))!;
    expect(managed.dimmed).toBe(true);
    expect(managed.expandable).toBe(false);
    expect(managed.label).toContain("absent");
  });

  it("shows only level rows when nothing is expanded", () => {
    const rows = buildRows(result, new Set());
    expect(rows.every((r) => r.depth === 0)).toBe(true);
  });

  it("reveals categories when a level is expanded", () => {
    const rows = buildRows(result, new Set([levelId("project")]));
    const cats = rows.filter((r) => r.depth === 1).map((r) => r.label);
    expect(cats.some((c) => c.startsWith("skills"))).toBe(true);
    expect(cats.some((c) => c.startsWith("agents"))).toBe(true);
  });

  it("reveals items when a category is expanded", () => {
    const rows = buildRows(
      result,
      new Set([levelId("project"), "C:project:skills"]),
    );
    const items = rows.filter((r) => r.depth === 2 && r.data);
    expect(items.some((r) => r.data?.type === "skill")).toBe(true);
  });

  it("collapses runtime data to one labeled row", () => {
    const rows = buildRows(
      result,
      new Set([levelId("project"), "C:project:runtime"]),
    );
    const rt = rows.find((r) => r.data?.type === "runtime")!;
    expect(nodeLabel(rt.data!)).toMatch(
      /runtime data \(\d+ items, not loaded into context\)/,
    );
  });
});
