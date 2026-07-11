// ABOUTME: The Ink TUI — left tree pane, right detail pane, load-order and help views.
// ABOUTME: Consumes a ScanResult only; navigation/detail logic lives in tree.ts / detail.ts.
import React, { useMemo, useState } from "react";
import { Box, Text, render, useApp, useInput, useStdout } from "ink";
import type { ScanResult } from "../types.js";
import {
  buildLoadOrder,
  MEMORY_LOAD_ORDER,
  SETTINGS_PRECEDENCE,
  SKILL_PRECEDENCE,
  AGENT_PRECEDENCE,
} from "../loading-model.js";
import { buildRows, levelId, LEVEL_ORDER, type Row } from "./tree.js";
import { buildDetail, type DetailLine } from "./detail.js";

const FOOTER = "↑↓ navigate · ←→ expand · o load order · q quit · ? help";

function initialExpanded(scan: ScanResult): Set<string> {
  const s = new Set<string>();
  for (const level of LEVEL_ORDER) {
    if (scan.levels[level].present) s.add(levelId(level));
  }
  return s;
}

function DetailLines({ lines }: { lines: DetailLine[] }): React.ReactElement {
  return (
    <Box flexDirection="column">
      {lines.map((l, i) => (
        <Text
          key={i}
          bold={l.bold}
          dimColor={l.dim}
          color={l.warn ? "yellow" : undefined}
        >
          {l.text}
        </Text>
      ))}
    </Box>
  );
}

function TreePane({
  rows,
  selected,
  height,
}: {
  rows: Row[];
  selected: number;
  height: number;
}): React.ReactElement {
  // Scroll window centered on the selection.
  const half = Math.floor(height / 2);
  let start = Math.max(0, selected - half);
  let end = start + height;
  if (end > rows.length) {
    end = rows.length;
    start = Math.max(0, end - height);
  }
  const visible = rows.slice(start, end);

  return (
    <Box flexDirection="column">
      {rows.length === 0 ? (
        <Text dimColor>(nothing found)</Text>
      ) : (
        visible.map((row, i) => {
          const idx = start + i;
          const isSel = idx === selected;
          const indent = "  ".repeat(row.depth);
          const marker = row.expandable ? (row.expanded ? "▾ " : "▸ ") : "  ";
          return (
            <Text
              key={row.id}
              inverse={isSel}
              dimColor={row.dimmed && !isSel}
              bold={row.isLevel}
            >
              {`${indent}${marker}${row.label}`}
            </Text>
          );
        })
      )}
    </Box>
  );
}

function LoadOrderView({ scan }: { scan: ScanResult }): React.ReactElement {
  const phases = buildLoadOrder(scan);
  return (
    <Box flexDirection="column">
      <Text bold>What loads when a session starts here</Text>
      <Text> </Text>
      {phases.map((phase) => (
        <Box key={phase.id} flexDirection="column" marginBottom={1}>
          <Text bold color="cyan">
            {`${phase.order}. ${phase.title}`}
          </Text>
          <Text dimColor>{phase.explanation}</Text>
          {phase.items.length === 0 ? (
            <Text dimColor>{"   (nothing)"}</Text>
          ) : (
            phase.items.map((it, i) => (
              <Text key={i}>
                {"   • "}
                <Text color="green">{`[${it.level}] `}</Text>
                {`${it.name} — ${it.detail}`}
              </Text>
            ))
          )}
        </Box>
      ))}
    </Box>
  );
}

function HelpView(): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>Levels (lowest → highest locality)</Text>
      <Text>
        {"  managed (org policy) → user (~/.claude) → project (.claude) → local (gitignored)"}
      </Text>
      <Text> </Text>
      <Text bold>Settings precedence (highest first)</Text>
      {SETTINGS_PRECEDENCE.map((p, i) => (
        <Text key={i}>{`  ${i + 1}. ${p}`}</Text>
      ))}
      <Text> </Text>
      <Text bold>Memory (CLAUDE.md) merge order</Text>
      {MEMORY_LOAD_ORDER.map((p, i) => (
        <Text key={i}>{`  ${i + 1}. ${p}`}</Text>
      ))}
      <Text> </Text>
      <Text bold>Name-conflict precedence (winner first)</Text>
      <Text>{`  skills:  ${SKILL_PRECEDENCE.join(" > ")}`}</Text>
      <Text>{`  agents:  ${AGENT_PRECEDENCE.join(" > ")} (note: opposite of skills)`}</Text>
      <Text> </Text>
      <Text dimColor>Press ? to close help.</Text>
    </Box>
  );
}

export function App({ scan }: { scan: ScanResult }): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    initialExpanded(scan),
  );
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<"tree" | "order">("tree");
  const [help, setHelp] = useState(false);

  const rows = useMemo(() => buildRows(scan, expanded), [scan, expanded]);
  const clamped = rows.length === 0 ? 0 : Math.min(selected, rows.length - 1);
  const current = rows[clamped];

  const cols = stdout?.columns ?? 80;
  const totalRows = stdout?.rows ?? 24;
  const narrow = cols < 100;
  const listHeight = Math.max(3, totalRows - 5);

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
    if (input === "o") {
      setMode((m) => (m === "order" ? "tree" : "order"));
      return;
    }
    if (mode === "order") return;

    if (key.upArrow) {
      setSelected((s) => Math.max(0, Math.min(s, rows.length - 1) - 1));
      return;
    }
    if (key.downArrow) {
      setSelected((s) => Math.min(rows.length - 1, s + 1));
      return;
    }
    const row = rows[Math.min(selected, rows.length - 1)];
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

  const detailLines: DetailLine[] = current?.data
    ? buildDetail(current.data)
    : [
        { text: current?.label ?? "claude-tree", bold: true },
        { text: "Select an item to see how it loads.", dim: true },
      ];

  let body: React.ReactElement;
  if (help) {
    body = <HelpView />;
  } else if (mode === "order") {
    body = <LoadOrderView scan={scan} />;
  } else {
    const treePane = (
      <Box
        flexDirection="column"
        borderStyle="round"
        paddingX={1}
        width={narrow ? undefined : "45%"}
      >
        <Text bold color="cyan">
          Config tree
        </Text>
        <TreePane rows={rows} selected={clamped} height={listHeight} />
      </Box>
    );
    const detailPane = (
      <Box
        flexDirection="column"
        borderStyle="round"
        paddingX={1}
        flexGrow={1}
      >
        <Text bold color="cyan">
          Detail
        </Text>
        <DetailLines lines={detailLines} />
      </Box>
    );
    body = (
      <Box flexDirection={narrow ? "column" : "row"}>
        {treePane}
        {detailPane}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>
        {"claude-tree "}
        <Text dimColor>{`· ${scan.cwd}`}</Text>
      </Text>
      {body}
      <Text dimColor>{FOOTER}</Text>
    </Box>
  );
}

/** Render the TUI and resolve when the user exits. */
export function runTui(scan: ScanResult): Promise<void> {
  const { waitUntilExit } = render(<App scan={scan} />);
  return waitUntilExit();
}
