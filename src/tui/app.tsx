// ABOUTME: Lazygit-style fullscreen Ink TUI — three stacked left panels + a detail pane.
// ABOUTME: Every pane windows its own content to its height to avoid Ink height-clip garble.
import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, render, useApp, useInput, useStdout } from "ink";
import type { ScanResult } from "../types.js";
import {
  buildLoadOrder,
  SETTINGS_PRECEDENCE,
  SKILL_PRECEDENCE,
  AGENT_PRECEDENCE,
} from "../loading-model.js";
import { summarizeContextCost, costBar } from "../context-cost.js";
import { buildRows, levelId, LEVEL_ORDER, type Row } from "./tree.js";
import { buildDetail } from "./detail.js";

/** Escape sequences to enter/leave the terminal's alternate screen buffer. */
export const ALT_SCREEN_ENTER = "\x1b[?1049h";
export const ALT_SCREEN_LEAVE = "\x1b[?1049l";

type PanelId = 1 | 2 | 3;

interface PanelLine {
  text: string;
  color?: string;
  dim?: boolean;
  bold?: boolean;
}

function initialExpanded(scan: ScanResult): Set<string> {
  const s = new Set<string>();
  for (const level of LEVEL_ORDER) {
    if (scan.levels[level].present) s.add(levelId(level));
  }
  return s;
}

/** Visible [start,end) window of `len` lines centered on `cursor`, `height` tall. */
function windowSlice(
  len: number,
  cursor: number,
  height: number,
): { start: number; end: number } {
  if (height >= len) return { start: 0, end: len };
  const half = Math.floor(height / 2);
  let start = Math.max(0, cursor - half);
  let end = start + height;
  if (end > len) {
    end = len;
    start = Math.max(0, end - height);
  }
  return { start, end };
}

/** A bordered panel that windows its own lines to `innerHeight`. */
function Panel({
  title,
  lines,
  cursor,
  focused,
  width,
  height,
}: {
  title: string;
  lines: PanelLine[];
  cursor: number;
  focused: boolean;
  width: number;
  height: number;
}): React.ReactElement {
  // height = outer box height. Inner content = height - 2 (border) - 1 (title).
  const innerHeight = Math.max(1, height - 3);
  const { start, end } = windowSlice(lines.length, cursor, innerHeight);
  const visible = lines.slice(start, end);
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={focused ? "cyan" : "gray"}
      width={width}
      height={height}
      paddingX={1}
    >
      <Text bold color={focused ? "cyan" : undefined} wrap="truncate-end">
        {title}
      </Text>
      {lines.length === 0 ? (
        <Text dimColor wrap="truncate-end">
          (nothing)
        </Text>
      ) : (
        visible.map((l, i) => {
          const idx = start + i;
          const isCursor = focused && idx === cursor;
          return (
            <Text
              key={idx}
              wrap="truncate-end"
              inverse={isCursor}
              bold={l.bold}
              dimColor={l.dim && !isCursor}
              color={l.color}
            >
              {l.text}
            </Text>
          );
        })
      )}
    </Box>
  );
}

/** Config tree → panel lines. */
function configLines(rows: Row[]): PanelLine[] {
  return rows.map((row) => {
    const indent = "  ".repeat(row.depth);
    const marker = row.expandable ? (row.expanded ? "▾ " : "▸ ") : "  ";
    return {
      text: `${indent}${marker}${row.label}`,
      bold: row.isLevel,
      dim: row.dimmed,
    };
  });
}

/** Session-start pipeline (buildLoadOrder) → panel lines. */
function sessionLines(scan: ScanResult): PanelLine[] {
  const lines: PanelLine[] = [];
  for (const phase of buildLoadOrder(scan)) {
    lines.push({ text: `${phase.order}. ${phase.title}`, bold: true, color: "cyan" });
    lines.push({ text: phase.explanation, dim: true });
    if (phase.items.length === 0) {
      lines.push({ text: "   (nothing)", dim: true });
    } else {
      for (const it of phase.items) {
        lines.push({ text: `   • [${it.level}] ${it.name} — ${it.detail}` });
      }
    }
  }
  return lines;
}

/** Context-cost summary → panel lines with a proportional bar chart. */
function costLines(scan: ScanResult): PanelLine[] {
  const summary = summarizeContextCost(scan);
  const lines: PanelLine[] = [];
  lines.push({
    text: `~${summary.totalSessionStart} tokens at session start`,
    bold: true,
    color: "cyan",
  });
  lines.push({ text: `~${summary.totalDeferred} tokens deferred (dormant pool)`, dim: true });
  lines.push({ text: "estimate: ~tokens ≈ chars/4", dim: true });
  lines.push({ text: "" });
  lines.push({ text: "per level (session start):", bold: true });
  if (summary.perLevel.length === 0) {
    lines.push({ text: "   (nothing loads at session start)", dim: true });
  } else {
    for (const lc of summary.perLevel) {
      lines.push({
        text: `   ${lc.level}: ~${lc.sessionStartTokens}t / ~${lc.deferredTokens}t deferred`,
      });
    }
  }
  lines.push({ text: "" });
  lines.push({ text: "most expensive at session start:", bold: true });
  if (summary.topItems.length === 0) {
    lines.push({ text: "   (nothing)", dim: true });
  } else {
    const max = summary.topItems[0]!.sessionStartTokens;
    for (const it of summary.topItems) {
      const bar = costBar(it.sessionStartTokens, max, 12);
      lines.push({
        text: `   ${bar.padEnd(12)} ~${it.sessionStartTokens}t ${it.name} [${it.level}]`,
        color: "green",
      });
    }
  }
  return lines;
}

/** Detail pane lines for the current tree selection. */
function detailLines(current: Row | undefined): PanelLine[] {
  if (!current?.data) {
    return [
      { text: current?.label ?? "claude-tree", bold: true },
      { text: "Select an item in Config to see how it loads.", dim: true },
    ];
  }
  return buildDetail(current.data).map((l) => ({
    text: l.text,
    bold: l.bold,
    dim: l.dim,
    color: l.warn ? "yellow" : undefined,
  }));
}

function HelpView({
  width,
  height,
}: {
  width: number;
  height: number;
}): React.ReactElement {
  const lines: PanelLine[] = [
    { text: "claude-tree — help", bold: true, color: "cyan" },
    { text: "1/2/3 or tab focus panel · ↑↓ move · ←→/enter expand (Config)" },
    { text: "q quit · ? close help" },
    { text: "" },
    { text: "Levels (lowest → highest locality):", bold: true },
    { text: "  managed → user (~/.claude) → project (.claude) → local" },
    { text: "" },
    { text: "Settings precedence (highest first):", bold: true },
    ...SETTINGS_PRECEDENCE.map((p, i) => ({ text: `  ${i + 1}. ${p}`, dim: true })),
    { text: "" },
    { text: "Name-conflict precedence (winner first):", bold: true },
    { text: `  skills:  ${SKILL_PRECEDENCE.join(" > ")}` },
    { text: `  agents:  ${AGENT_PRECEDENCE.join(" > ")} (opposite of skills)` },
  ];
  return (
    <Panel
      title="Help"
      lines={lines}
      cursor={0}
      focused
      width={width}
      height={height}
    />
  );
}

const PANEL_TITLES: Record<PanelId, string> = {
  1: "Config",
  2: "Session start",
  3: "Context cost",
};

function keybar(panel: PanelId, help: boolean): string {
  if (help) return "? close help · q quit";
  const common = "1/2/3·tab switch · ↑↓ move · q quit · ? help";
  if (panel === 1) return `[Config] ←→/enter expand · ${common}`;
  if (panel === 2) return `[Session start] scroll pipeline · ${common}`;
  return `[Context cost] scroll · ${common}`;
}

export function App({ scan }: { scan: ScanResult }): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    initialExpanded(scan),
  );
  const [panel, setPanel] = useState<PanelId>(1);
  const [cfgSel, setCfgSel] = useState(0);
  const [sesSel, setSesSel] = useState(0);
  const [costSel, setCostSel] = useState(0);
  const [help, setHelp] = useState(false);
  // Bumped on terminal resize so we re-read stdout dimensions and re-render.
  const [, setResizeTick] = useState(0);

  useEffect(() => {
    if (!stdout) return;
    const onResize = (): void => setResizeTick((t) => t + 1);
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  const rows = useMemo(() => buildRows(scan, expanded), [scan, expanded]);
  const cfgClamped = rows.length === 0 ? 0 : Math.min(cfgSel, rows.length - 1);
  const current = rows[cfgClamped];

  // `|| ` (not `??`) so a 0-sized pty (e.g. a non-interactive capture) still
  // falls back to sane dimensions instead of collapsing the layout.
  const cols = Math.max(50, stdout?.columns || 80);
  const totalRows = Math.max(12, stdout?.rows || 24);

  const cfgL = useMemo(() => configLines(rows), [rows]);
  const sesL = useMemo(() => sessionLines(scan), [scan]);
  const costL = useMemo(() => costLines(scan), [scan]);
  const detL = detailLines(current);

  const activeLen =
    panel === 1 ? cfgL.length : panel === 2 ? sesL.length : costL.length;

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      exit();
      return;
    }
    if (input === "?") {
      setHelp((h) => !h);
      return;
    }
    if (help) return;

    if (input === "1") return setPanel(1);
    if (input === "2") return setPanel(2);
    if (input === "3") return setPanel(3);
    if (key.tab) {
      setPanel((p) => ((p % 3) + 1) as PanelId);
      return;
    }

    if (key.upArrow) {
      if (panel === 1) setCfgSel((s) => Math.max(0, Math.min(s, rows.length - 1) - 1));
      else if (panel === 2) setSesSel((s) => Math.max(0, s - 1));
      else setCostSel((s) => Math.max(0, s - 1));
      return;
    }
    if (key.downArrow) {
      if (panel === 1) setCfgSel((s) => Math.min(rows.length - 1, s + 1));
      else if (panel === 2) setSesSel((s) => Math.min(sesL.length - 1, s + 1));
      else setCostSel((s) => Math.min(costL.length - 1, s + 1));
      return;
    }

    if (panel !== 1) return;
    const row = rows[cfgClamped];
    if (!row) return;
    if (key.rightArrow || key.return) {
      if (row.expandable && !expanded.has(row.id)) {
        setExpanded((e) => new Set(e).add(row.id));
      } else if (key.return && row.expandable && expanded.has(row.id)) {
        setExpanded((e) => {
          const n = new Set(e);
          n.delete(row.id);
          return n;
        });
      }
      return;
    }
    if (key.leftArrow) {
      if (row.expandable && expanded.has(row.id)) {
        setExpanded((e) => {
          const n = new Set(e);
          n.delete(row.id);
          return n;
        });
      }
      return;
    }
  });

  // Layout: title row + body + keybar fill the terminal exactly.
  const bodyH = Math.max(6, totalRows - 2);
  const leftW = Math.min(Math.max(28, Math.floor(cols * 0.42)), cols - 20);
  const rightW = Math.max(20, cols - leftW);
  const p1H = Math.floor(bodyH / 3);
  const p2H = Math.floor(bodyH / 3);
  const p3H = bodyH - p1H - p2H;

  const title = (
    <Text wrap="truncate-end">
      <Text bold>{"claude-tree "}</Text>
      <Text dimColor>{`· ${scan.cwd}`}</Text>
    </Text>
  );

  if (help) {
    return (
      <Box flexDirection="column" width={cols} height={totalRows}>
        {title}
        <HelpView width={cols} height={bodyH} />
        <Text dimColor wrap="truncate-end">
          {keybar(panel, true)}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={cols} height={totalRows}>
      {title}
      <Box flexDirection="row" height={bodyH}>
        <Box flexDirection="column" width={leftW} height={bodyH}>
          <Panel
            title={`1 ${PANEL_TITLES[1]}`}
            lines={cfgL}
            cursor={cfgClamped}
            focused={panel === 1}
            width={leftW}
            height={p1H}
          />
          <Panel
            title={`2 ${PANEL_TITLES[2]}`}
            lines={sesL}
            cursor={sesSel}
            focused={panel === 2}
            width={leftW}
            height={p2H}
          />
          <Panel
            title={`3 ${PANEL_TITLES[3]}`}
            lines={costL}
            cursor={costSel}
            focused={panel === 3}
            width={leftW}
            height={p3H}
          />
        </Box>
        <Panel
          title="Detail"
          lines={detL}
          cursor={-1}
          focused={false}
          width={rightW}
          height={bodyH}
        />
      </Box>
      <Text dimColor wrap="truncate-end">
        {keybar(panel, false)}
      </Text>
    </Box>
  );
}

/** Options for runTui, injectable so tests can spy on alt-screen writes. */
export interface RunTuiDeps {
  render?: typeof render;
  stdout?: NodeJS.WriteStream;
}

/**
 * Render the TUI in the alternate screen buffer and resolve when the user
 * exits. The alt-screen is restored via try/finally AND process exit/signal
 * handlers so the terminal is never left corrupted.
 */
export function runTui(scan: ScanResult, deps: RunTuiDeps = {}): Promise<void> {
  const out = deps.stdout ?? process.stdout;
  const doRender = deps.render ?? render;

  let left = false;
  const leave = (): void => {
    if (left) return;
    left = true;
    out.write(ALT_SCREEN_LEAVE);
  };

  // A signal must still terminate the process. Registering a listener would
  // otherwise suppress Node's default kill, so we restore the alt-screen and
  // then exit explicitly.
  const onSignal = (): void => {
    leave();
    process.exit(0);
  };

  out.write(ALT_SCREEN_ENTER);
  process.on("exit", leave);
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const app = doRender(<App scan={scan} />);
  return app
    .waitUntilExit()
    .finally(() => {
      process.off("exit", leave);
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      leave();
    });
}
