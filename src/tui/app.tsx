// ABOUTME: Lazygit-style fullscreen Ink TUI — three stacked left panels + a detail pane.
// ABOUTME: Every pane windows its own content to its height to avoid Ink height-clip garble.
import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, render, useApp, useInput, useStdout } from "ink";
import type { ScanResult } from "../types.js";
import {
  buildLoadOrder,
  MEMORY_LOAD_ORDER,
  SETTINGS_PRECEDENCE,
  SKILL_PRECEDENCE,
  AGENT_PRECEDENCE,
} from "../loading-model.js";
import {
  summarizeContextCost,
  contextCostHeadline,
  costBar,
  formatTokens,
  ESTIMATE_CAPTION,
} from "../context-cost.js";
import { MODELS, DEFAULT_MODEL_ID, gaugeFor } from "../models.js";
import {
  collectMemories,
  MEMORY_MERGE_NOTE,
} from "../render-list.js";
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
  inverse?: boolean;
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

/** Word-wrap one line to `width` columns, preserving a hanging indent. */
export function wrapLine(text: string, width: number): string[] {
  if (width <= 4 || text.length <= width) return [text];
  const indentMatch = /^\s*/.exec(text);
  const indent = (indentMatch?.[0] ?? "") + "  ";
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > width && line) {
      out.push(line);
      line = indent + word;
    } else {
      line = candidate;
    }
  }
  if (line) out.push(line);
  return out;
}

/** Wrap every panel line's text to `width`, keeping styling per fragment. */
function wrapLines(lines: PanelLine[], width: number): PanelLine[] {
  const out: PanelLine[] = [];
  for (const l of lines) {
    for (const text of wrapLine(l.text, width)) out.push({ ...l, text });
  }
  return out;
}

/**
 * A bordered panel that windows its own lines to `innerHeight`.
 * `cursor` >= 0 renders an inverse selection bar (Config); `scrollOffset`
 * mode (cursor = -1, offset given) scrolls prose without a selection bar.
 */
function Panel({
  title,
  lines,
  cursor,
  scrollOffset = 0,
  focused,
  width,
  height,
}: {
  title: string;
  lines: PanelLine[];
  cursor: number;
  scrollOffset?: number;
  focused: boolean;
  width: number;
  height: number;
}): React.ReactElement {
  // height = outer box height. Inner content = height - 2 (border) - 1 (title).
  const innerHeight = Math.max(1, height - 3);
  const { start, end } =
    cursor >= 0
      ? windowSlice(lines.length, cursor, innerHeight)
      : {
          start: Math.max(0, Math.min(scrollOffset, lines.length - innerHeight)),
          end: Math.max(
            0,
            Math.min(scrollOffset, lines.length - innerHeight),
          ) + innerHeight,
        };
  const visible = lines.slice(start, Math.min(end, lines.length));
  const overflow = lines.length > innerHeight;
  const below = lines.length - Math.min(end, lines.length);
  const counter = overflow
    ? cursor >= 0
      ? ` [${cursor + 1}/${lines.length}]`
      : below > 0
        ? ` [↓ ${below} more]`
        : ` [end]`
    : "";
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
        <Text dimColor>{counter}</Text>
      </Text>
      {lines.length === 0 ? (
        <Text dimColor wrap="truncate-end">
          (nothing)
        </Text>
      ) : (
        visible.map((l, i) => {
          const idx = start + i;
          const isCursor = (focused && cursor >= 0 && idx === cursor) || l.inverse;
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

/** Load pipeline (buildLoadOrder) → panel lines. */
function sessionLines(scan: ScanResult): PanelLine[] {
  const lines: PanelLine[] = [
    { text: "what happens, in order, when a session starts here:", dim: true },
  ];
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
    lines.push({ text: " " });
  }
  return lines;
}

/** Context-cost summary → panel lines: headline, gauge table, breakdowns. */
function costLines(scan: ScanResult, selectedModel: string): PanelLine[] {
  const summary = summarizeContextCost(scan);
  const lines: PanelLine[] = [];
  for (const h of contextCostHeadline(summary)) {
    lines.push({
      text: h.text,
      bold: h.emphasis,
      color: h.emphasis ? "cyan" : undefined,
      dim: h.dim,
    });
  }
  lines.push({
    text: `~${formatTokens(summary.totalDeferred)} tokens deferred (deferred = loads only if something triggers it)`,
    dim: true,
  });
  lines.push({ text: ESTIMATE_CAPTION, dim: true });
  lines.push({ text: " " });
  lines.push({ text: "share of context window (m to switch model):", bold: true });
  for (const m of MODELS) {
    const g = gaugeFor(summary, m);
    const selected = m.id === selectedModel;
    lines.push({
      text: `${selected ? "▶ " : "  "}${g.line}`,
      color: selected ? "cyan" : undefined,
      bold: selected,
      dim: !selected,
    });
  }
  lines.push({
    text: "  (hard window; auto-compaction triggers well before the limit)",
    dim: true,
  });
  lines.push({ text: " " });
  lines.push({ text: "per level (session start):", bold: true });
  if (summary.perLevel.length === 0) {
    lines.push({ text: "   (nothing loads at session start)", dim: true });
  } else {
    for (const lc of summary.perLevel) {
      lines.push({
        text: `   ${lc.level}: ~${formatTokens(lc.sessionStartTokens)} start / ~${formatTokens(lc.deferredTokens)} deferred`,
      });
    }
  }
  lines.push({ text: " " });
  lines.push({ text: "most expensive at session start:", bold: true });
  if (summary.topItems.length === 0) {
    lines.push({ text: "   (nothing)", dim: true });
  } else {
    const max = summary.topItems[0]!.sessionStartTokens;
    for (const it of summary.topItems) {
      const bar = costBar(it.sessionStartTokens, max, 12);
      lines.push({
        text: `   ${bar.padEnd(12)} ~${formatTokens(it.sessionStartTokens)} ${it.name} [${it.level}]`,
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

/** The Memories overlay: every memory file in merge order, like --memories. */
function memoriesLines(scan: ScanResult): PanelLine[] {
  const lines: PanelLine[] = [
    { text: "Memories Claude loads here, in merge order (last read wins):", bold: true, color: "cyan" },
    { text: " " },
  ];
  const entries = collectMemories(scan);
  for (const e of entries) {
    const cost = e.sessionStartTokens
      ? ` · ~${formatTokens(e.sessionStartTokens)} tokens at session start`
      : "";
    lines.push({ text: `${e.order}. [${e.level}] ${e.kind}${cost}`, bold: true });
    lines.push({ text: `   ${e.path}`, dim: true });
    if (e.description) lines.push({ text: `   ${e.description}` });
    if (e.imports.length > 0)
      lines.push({ text: `   @imports: ${e.imports.join(", ")}` });
    for (const topic of e.topics) {
      lines.push({ text: `     · topic file (loads on demand): ${topic}`, dim: true });
    }
    lines.push({ text: " " });
  }
  if (entries.length === 0) {
    lines.push({ text: "(no memory files found from this directory)", dim: true });
    lines.push({ text: " " });
    lines.push({
      text: "Claude would look for: a managed CLAUDE.md, CLAUDE.md/.claude/CLAUDE.md",
      dim: true,
    });
    lines.push({
      text: "in each dir from the project root down to here, ~/.claude/CLAUDE.md,",
      dim: true,
    });
    lines.push({
      text: "and auto memory at ~/.claude/projects/<project-slug>/memory/MEMORY.md.",
      dim: true,
    });
    lines.push({ text: " " });
  }
  lines.push({ text: MEMORY_MERGE_NOTE, dim: true });
  return lines;
}

function helpLines(): PanelLine[] {
  return [
    { text: "claude-tree — help", bold: true, color: "cyan" },
    { text: "1/2/3 or tab focus panel · ↑↓ move/scroll · ←→/enter expand (Config)" },
    { text: "m switch gauge model · M memories view · q quit · ? close help" },
    { text: "  M shows every memory file Claude loads here, in merge order (like --memories).", dim: true },
    { text: " " },
    { text: "Levels (lowest → highest locality):", bold: true },
    { text: "  managed → user (~/.claude) → project (.claude) → local" },
    { text: "  managed = org policy your admin installs machine-wide; wins over everything.", dim: true },
    { text: " " },
    { text: "Settings precedence (highest first):", bold: true },
    ...SETTINGS_PRECEDENCE.map((p, i) => ({ text: `  ${i + 1}. ${p}`, dim: true })),
    { text: " " },
    { text: "Memory (CLAUDE.md) merge order (first-loaded → last; last read wins):", bold: true },
    ...MEMORY_LOAD_ORDER.map((p, i) => ({ text: `  ${i + 1}. ${p}`, dim: true })),
    { text: " " },
    { text: "Name-conflict precedence (winner first):", bold: true },
    { text: `  skills:  ${SKILL_PRECEDENCE.join(" > ")}` },
    { text: `  agents:  ${AGENT_PRECEDENCE.join(" > ")} (opposite of skills)` },
    { text: " " },
    { text: "Context gauge (panel 3):", bold: true },
    { text: "  Each bar shows the estimated session-start load as a share of that", dim: true },
    { text: "  model's hard context window. Haiku's 200k window makes the same setup", dim: true },
    { text: "  ~5x fuller than a 1M-window model. Estimates only; auto-compaction", dim: true },
    { text: "  triggers well before the hard limit.", dim: true },
    { text: " " },
    { text: "Glossary:", bold: true },
    { text: "  deferred = loads only if something triggers it (invocation/spawn/file match)", dim: true },
    { text: "  dormant = same idea: present but not in context yet", dim: true },
    { text: "  harness = Claude Code itself (not the model): it injects config deterministically", dim: true },
    { text: "  frontmatter = the YAML block at the top of a skill/agent/rule .md file", dim: true },
    { text: "  MCP = Model Context Protocol: external tool servers Claude can call", dim: true },
  ];
}

const PANEL_TITLES: Record<PanelId, string> = {
  1: "Config",
  2: "Load pipeline",
  3: "Context cost",
};

function keybar(panel: PanelId): string {
  const common =
    "1/2/3·tab switch · ↑↓ move · m model · M memories · q quit · ? help";
  if (panel === 1) return `[Config] ←→/enter expand · ${common}`;
  if (panel === 2) return `[Load pipeline] scroll · ${common}`;
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
  const [sesOff, setSesOff] = useState(0);
  const [costOff, setCostOff] = useState(0);
  const [helpOff, setHelpOff] = useState(0);
  const [overlay, setOverlay] = useState<"none" | "help" | "memories">("none");
  const [model, setModel] = useState(DEFAULT_MODEL_ID);
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
  const summary = useMemo(() => summarizeContextCost(scan), [scan]);

  // `|| ` (not `??`) so a 0-sized pty (e.g. a non-interactive capture) still
  // falls back to sane dimensions instead of collapsing the layout.
  const cols = Math.max(50, stdout?.columns || 80);
  const totalRows = Math.max(12, stdout?.rows || 24);

  // Layout: title row + body + keybar fill the terminal exactly. The focused
  // panel gets ~half the column (accordion); the others share the rest.
  const bodyH = Math.max(6, totalRows - 2);
  const leftW = Math.min(Math.max(28, Math.floor(cols * 0.42)), cols - 20);
  const rightW = Math.max(20, cols - leftW);
  const minor = Math.max(3, Math.floor(bodyH / 4));
  const major = bodyH - 2 * minor;
  const p1H = panel === 1 ? major : minor;
  const p2H = panel === 2 ? major : minor;
  const p3H = bodyH - p1H - p2H;

  const cfgL = useMemo(() => configLines(rows), [rows]);
  const sesL = useMemo(() => sessionLines(scan), [scan]);
  const costL = useMemo(() => costLines(scan, model), [scan, model]);
  const detL = useMemo(
    () => wrapLines(detailLines(current), Math.max(10, rightW - 4)),
    [current, rightW],
  );
  const helpL = useMemo(() => helpLines(), []);
  const memL = useMemo(
    () => wrapLines(memoriesLines(scan), Math.max(10, cols - 4)),
    [scan, cols],
  );

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      exit();
      return;
    }
    if (input === "?") {
      setOverlay((o) => (o === "help" ? "none" : "help"));
      setHelpOff(0);
      return;
    }
    if (input === "M") {
      setOverlay((o) => (o === "memories" ? "none" : "memories"));
      setHelpOff(0);
      return;
    }
    if (input === "m") {
      setModel((cur) => {
        const idx = MODELS.findIndex((mm) => mm.id === cur);
        const next = MODELS[(idx + 1) % MODELS.length]!.id;
        // Keep the newly selected gauge row visible in panel 3.
        const rowIdx = costLines(scan, next).findIndex((l) =>
          l.text.startsWith("▶ "),
        );
        if (rowIdx >= 0) setCostOff(Math.max(0, rowIdx - 4));
        return next;
      });
      return;
    }
    if (overlay !== "none") {
      const len = overlay === "help" ? helpL.length : memL.length;
      if (key.upArrow) setHelpOff((s) => Math.max(0, s - 1));
      if (key.downArrow) setHelpOff((s) => Math.min(len - 1, s + 1));
      return;
    }

    if (input === "1") return setPanel(1);
    if (input === "2") return setPanel(2);
    if (input === "3") return setPanel(3);
    if (key.tab) {
      setPanel((p) => ((p % 3) + 1) as PanelId);
      return;
    }

    if (key.upArrow) {
      if (panel === 1) setCfgSel((s) => Math.max(0, Math.min(s, rows.length - 1) - 1));
      else if (panel === 2) setSesOff((s) => Math.max(0, s - 1));
      else setCostOff((s) => Math.max(0, s - 1));
      return;
    }
    if (key.downArrow) {
      if (panel === 1) setCfgSel((s) => Math.min(rows.length - 1, s + 1));
      else if (panel === 2) setSesOff((s) => Math.min(sesL.length - 1, s + 1));
      else setCostOff((s) => Math.min(costL.length - 1, s + 1));
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

  // Headline first so a long cwd can never truncate the number away.
  const prettyCwd = scan.cwd.startsWith(scan.home)
    ? `~${scan.cwd.slice(scan.home.length)}`
    : scan.cwd;
  const title = (
    <Text wrap="truncate-end">
      <Text bold>{"claude-tree "}</Text>
      <Text bold color="cyan">
        {`· session start ≈ ~${formatTokens(summary.estimatedSessionStartMin)}–${formatTokens(summary.estimatedSessionStartMax)} tokens `}
      </Text>
      <Text dimColor>{`· ${prettyCwd}`}</Text>
    </Text>
  );

  if (overlay !== "none") {
    return (
      <Box flexDirection="column" width={cols} height={totalRows}>
        {title}
        <Panel
          title={overlay === "help" ? "Help" : "Memories"}
          lines={overlay === "help" ? helpL : memL}
          cursor={-1}
          scrollOffset={helpOff}
          focused
          width={cols}
          height={bodyH}
        />
        <Text dimColor wrap="truncate-end">
          {overlay === "help"
            ? "↑↓ scroll · ? close help · q quit"
            : "↑↓ scroll · M close memories · q quit"}
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
            cursor={-1}
            scrollOffset={sesOff}
            focused={panel === 2}
            width={leftW}
            height={p2H}
          />
          <Panel
            title={`3 ${PANEL_TITLES[3]}`}
            lines={costL}
            cursor={-1}
            scrollOffset={costOff}
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
        {keybar(panel)}
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
