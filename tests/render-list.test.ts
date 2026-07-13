// ABOUTME: Tests for the plain-text --list renderer — asserts on specific lines, not snapshots.
// ABOUTME: Confirms absent levels, timing tags, and override notes render as expected.
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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

  it("renders a context-cost summary section with the baseline, range, and a bar chart", () => {
    expect(out).toContain("Context cost (rough estimate: chars ÷4.6");
    expect(out).toContain("Claude Code baseline ~5.2k–5.7k");
    expect(out).toContain("= session start ~");
    expect(out).toContain("your config adds ~");
    expect(out).toContain("deferred pool: ~");
    expect(out).toContain("context window: Opus 4.8");
    expect(out).toContain("most expensive at session start:");
    expect(out).toContain("█");
  });

  it("annotates item lines with an estimated token cost", () => {
    const skillLine = lines.find(
      (l) => l.includes("format-code") && l.includes("t start"),
    );
    expect(skillLine).toBeDefined();
  });
});

describe("renderList baseline with no config", () => {
  it("shows the baseline and 'adds no config context' when nothing loads", () => {
    const out = renderList(
      scan({ cwd: "/nonexistent/xyz", home: "/nonexistent/home" }),
    );
    expect(out).toContain("Claude Code baseline ~5.2k–5.7k");
    expect(out).toContain("this directory adds no config context");
    expect(out).toContain("= session start ~5.2k–5.7k");
  });
});

describe("renderList control-character stripping", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const d of tmpDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("strips escape sequences from hook commands before rendering", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ct-ctl-"));
    tmpDirs.push(home);
    const claude = path.join(home, ".claude");
    fs.mkdirSync(claude, { recursive: true });
    // A hook command carrying a raw ESC + bell — a terminal-injection attempt.
    const evil = "echo \u001b[2J\u0007pwned";
    fs.writeFileSync(
      path.join(claude, "settings.json"),
      JSON.stringify({
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: evil }] }],
        },
      }),
    );

    const out = renderList(scan({ cwd: home, home }));
    expect(out).not.toContain("\u001b");
    expect(out).not.toContain("\u0007");
    // The visible text survives, only the control bytes are removed.
    expect(out).toContain("pwned");
  });
});
