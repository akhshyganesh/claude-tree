// ABOUTME: Component tests for the Ink App via ink-testing-library — frames + key input.
// ABOUTME: Asserts tree rendering, navigation/expand, the load-order toggle, and help overlay.
import React from "react";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { scan } from "../src/scan.js";
import { App } from "../src/tui/app.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const HOME = path.join(here, "fixtures", "home");
const PROJECT = path.join(here, "fixtures", "project");
const result = scan({ cwd: PROJECT, home: HOME });

const ESC = "";
const DOWN = `${ESC}[B`;
const RIGHT = `${ESC}[C`;
const tick = () => new Promise((r) => setTimeout(r, 60));

describe("App", () => {
  it("renders levels, footer, and an absent level", () => {
    const { lastFrame, unmount } = render(<App scan={result} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Project (.claude)");
    expect(frame).toContain("Managed (org policy)");
    expect(frame).toContain("absent");
    expect(frame).toContain("o load order");
    unmount();
  });

  it("expands a category to reveal its items on arrow-right", async () => {
    const { lastFrame, stdin, unmount } = render(<App scan={result} />);
    await tick();
    // Categories start collapsed, so the memory item is not yet a tree row.
    expect(lastFrame() ?? "").not.toContain("CLAUDE.md");
    // row0 managed(absent) → row1 User level → row2 memory category.
    stdin.write(DOWN);
    await tick();
    stdin.write(DOWN);
    await tick();
    stdin.write(RIGHT); // expand memory
    await tick();
    expect(lastFrame() ?? "").toContain("CLAUDE.md");
    unmount();
  });

  it("toggles the load-order view with 'o'", async () => {
    const { lastFrame, stdin, unmount } = render(<App scan={result} />);
    await tick();
    stdin.write("o");
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("What loads when a session starts here");
    expect(frame).toContain("Config resolution");
    expect(frame).toContain("Dormant until triggered");
    unmount();
  });

  it("shows the help overlay with '?'", async () => {
    const { lastFrame, stdin, unmount } = render(<App scan={result} />);
    await tick();
    stdin.write("?");
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Settings precedence");
    expect(frame).toContain("opposite of skills");
    unmount();
  });

  it("does not crash on an empty scan", () => {
    const empty = scan({ cwd: "/nonexistent/xyz", home: "/nonexistent/home" });
    const { lastFrame, unmount } = render(<App scan={empty} />);
    expect(lastFrame() ?? "").toContain("absent");
    unmount();
  });
});
