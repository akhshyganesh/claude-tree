// ABOUTME: Component tests for the lazygit-style Ink App via ink-testing-library.
// ABOUTME: Asserts the panel layout, panel switching, scroll windows, and alt-screen writes.
import React from "react";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
import { scan } from "../src/scan.js";
import {
  App,
  runTui,
  ALT_SCREEN_ENTER,
  ALT_SCREEN_LEAVE,
  type RunTuiDeps,
} from "../src/tui/app.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const HOME = path.join(here, "fixtures", "home");
const PROJECT = path.join(here, "fixtures", "project");
const result = scan({ cwd: PROJECT, home: HOME });

const ESC = "";
const DOWN = `${ESC}[B`;
const RIGHT = `${ESC}[C`;
const TAB = "\t";
const tick = () => new Promise((r) => setTimeout(r, 60));

describe("App layout", () => {
  it("renders all three left panels plus a detail pane and a keybar", () => {
    const { lastFrame, unmount } = render(<App scan={result} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("1 Config");
    expect(frame).toContain("2 Load pipeline");
    expect(frame).toContain("3 Context cost");
    expect(frame).toContain("Detail");
    expect(frame).toContain("q quit");
    expect(frame).toContain("? help");
    unmount();
  });

  it("shows an absent managed level in the config panel", () => {
    const { lastFrame, unmount } = render(<App scan={result} />);
    expect(lastFrame() ?? "").toContain("absent");
    unmount();
  });

  it("expands a category to reveal its items on arrow-right", async () => {
    const { lastFrame, stdin, unmount } = render(<App scan={result} />);
    await tick();
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
});

describe("App panel switching", () => {
  it("switches the focused panel with number keys (keybar reflects it)", async () => {
    const { lastFrame, stdin, unmount } = render(<App scan={result} />);
    await tick();
    expect(lastFrame() ?? "").toContain("[Config]");
    stdin.write("2");
    await tick();
    expect(lastFrame() ?? "").toContain("[Load pipeline]");
    stdin.write("3");
    await tick();
    expect(lastFrame() ?? "").toContain("[Context cost]");
    unmount();
  });

  it("cycles panels with tab", async () => {
    const { lastFrame, stdin, unmount } = render(<App scan={result} />);
    await tick();
    stdin.write(TAB);
    await tick();
    expect(lastFrame() ?? "").toContain("[Load pipeline]");
    unmount();
  });

  it("scrolls the session panel's window to reveal later pipeline content", async () => {
    const { lastFrame, stdin, unmount } = render(<App scan={result} />);
    await tick();
    stdin.write("2"); // focus session panel
    await tick();
    expect(lastFrame() ?? "").toContain("Config resolution");
    for (let i = 0; i < 16; i++) {
      stdin.write(DOWN);
      await tick();
    }
    // The window has scrolled down to the dormant phase.
    expect(lastFrame() ?? "").toContain("Dormant until triggered");
    unmount();
  });
});

describe("App panel content", () => {
  it("renders the session-start pipeline phases", () => {
    const { lastFrame, unmount } = render(<App scan={result} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Config resolution");
    unmount();
  });

  it("renders the context-cost totals with an estimate label", async () => {
    const { lastFrame, stdin, unmount } = render(<App scan={result} />);
    await tick();
    stdin.write("3"); // focus panel 3 so the accordion gives it room
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("session start");
    expect(frame).toContain("deferred");
    unmount();
  });

  it("shows the model gauge table and cycles the model with 'm'", async () => {
    const { lastFrame, stdin, unmount } = render(<App scan={result} />);
    await tick();
    stdin.write("3");
    await tick();
    expect(lastFrame() ?? "").toContain("▶ Opus 4.8");
    stdin.write("m");
    await tick();
    // Auto-scroll keeps the newly selected gauge row visible.
    expect(lastFrame() ?? "").toContain("▶ Opus 4.7");
    unmount();
  });

  it("puts the session-start headline in the title bar", () => {
    const { lastFrame, unmount } = render(<App scan={result} />);
    expect(lastFrame() ?? "").toContain("session start ≈ ~");
    unmount();
  });

  it("shows the help overlay with '?'", async () => {
    const { lastFrame, stdin, unmount } = render(<App scan={result} />);
    await tick();
    stdin.write("?");
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Settings precedence");
    expect(frame).toContain("merge order");
    unmount();
  });

  it("does not crash on an empty scan", () => {
    const empty = scan({ cwd: "/nonexistent/xyz", home: "/nonexistent/home" });
    const { lastFrame, unmount } = render(<App scan={empty} />);
    expect(lastFrame() ?? "").toContain("absent");
    unmount();
  });
});

describe("runTui alt-screen handling", () => {
  it("enters the alt-screen before render and leaves it on exit", async () => {
    const writes: string[] = [];
    const fakeStdout = {
      write: (s: string) => {
        writes.push(s);
        return true;
      },
    } as unknown as NodeJS.WriteStream;
    const fakeRender = vi.fn((_node: React.ReactNode) => ({
      waitUntilExit: () => Promise.resolve(),
    }));

    await runTui(result, {
      render: fakeRender as unknown as RunTuiDeps["render"],
      stdout: fakeStdout,
    });

    expect(writes[0]).toBe(ALT_SCREEN_ENTER);
    expect(writes).toContain(ALT_SCREEN_LEAVE);
    // Enter must come before leave.
    expect(writes.indexOf(ALT_SCREEN_ENTER)).toBeLessThan(
      writes.indexOf(ALT_SCREEN_LEAVE),
    );
    expect(fakeRender).toHaveBeenCalledOnce();
  });
});
