// ABOUTME: Pure detail-pane builder — turns a selected NodeData into display lines.
// ABOUTME: No Ink/React; unit-testable. Load-timing wording comes from loading-model LOAD_TIMINGS.
import { LOAD_TIMINGS, explainItem, type ExplainInput } from "../loading-model.js";
import { stripControl } from "../util.js";
import type { ContextCost } from "../types.js";
import type { NodeData } from "./tree.js";

export interface DetailLine {
  text: string;
  dim?: boolean;
  bold?: boolean;
  warn?: boolean;
}

interface Timing {
  label: string;
  howItLoads: string;
}

/** Map a node to its load-timing label + explanation. */
function timingFor(data: NodeData): Timing {
  switch (data.type) {
    case "memory":
      return LOAD_TIMINGS.memory;
    case "rule":
      return data.item.pathScoped
        ? LOAD_TIMINGS.rulePathScoped
        : LOAD_TIMINGS.ruleUnconditional;
    case "skill":
      return LOAD_TIMINGS.skill;
    case "command":
      return LOAD_TIMINGS.command;
    case "agent":
      return LOAD_TIMINGS.agent;
    case "hook":
      return LOAD_TIMINGS.hook;
    case "mcp":
      return LOAD_TIMINGS.mcp;
    case "settings":
      return LOAD_TIMINGS.settings;
    case "runtime":
      return LOAD_TIMINGS.runtime;
    case "workflow":
      return {
        label: "on demand",
        howItLoads:
          "Workflow file; loads/runs on demand, not auto-injected at session start.",
      };
    case "other":
      return {
        label: "on demand",
        howItLoads:
          "Unrecognized file; not auto-loaded. Claude may read it on demand.",
      };
  }
}

/** The context cost carried by a node, if any. */
function costFor(data: NodeData): ContextCost | undefined {
  if (data.type === "runtime") return undefined;
  if (data.type === "settings") return undefined;
  return data.item.contextCost;
}

/** Build the explain-input (what/who/when) for a node. */
function explainInputFor(data: NodeData): ExplainInput {
  const cost = costFor(data);
  const costNote = cost?.note;
  switch (data.type) {
    case "memory":
      return { type: "memory", deprecated: data.item.deprecated, costNote };
    case "rule":
      return { type: "rule", pathScoped: data.item.pathScoped, costNote };
    case "skill":
    case "command":
      return {
        type: data.type,
        name: data.item.name,
        disableModelInvocation: data.item.disableModelInvocation,
        paths: data.item.paths,
        costNote,
      };
    case "agent":
      return { type: "agent", name: data.item.name, costNote };
    case "hook":
      return { type: "hook", event: data.item.event, costNote };
    case "mcp":
      return { type: "mcp", name: data.item.name, costNote };
    case "settings":
      return { type: "settings" };
    case "workflow":
      return { type: "workflow" };
    case "other":
      return { type: "other" };
    case "runtime":
      return { type: "runtime" };
  }
}

/** Format the estimated context-cost line(s) for a node. */
export function costLines(data: NodeData): DetailLine[] {
  const cost = costFor(data);
  const lines: DetailLine[] = [];
  if (data.type === "settings") {
    lines.push({ text: "context cost: ~0 tokens (resolved outside the model)" });
    return lines;
  }
  if (data.type === "runtime") {
    lines.push({ text: "context cost: ~0 tokens (never loaded)" });
    return lines;
  }
  if (!cost) return lines;
  lines.push({
    text: `context cost: ~${cost.sessionStartTokens} tokens at session start, ~${cost.deferredTokens} deferred`,
    bold: true,
  });
  if (cost.note) lines.push({ text: cost.note, dim: true });
  return lines;
}

/** The "what / who / when" explanation block for a node. */
export function explainLines(data: NodeData): DetailLine[] {
  const ex = explainItem(explainInputFor(data));
  return [
    { text: `what: ${ex.whatIsThis}` },
    { text: `who triggers it: ${ex.whoTriggers}` },
    { text: `when it costs context: ${ex.whenItCostsContext}`, dim: true },
  ];
}

/** Strip terminal control characters from every line's text before display. */
function sanitize(lines: DetailLine[]): DetailLine[] {
  return lines.map((l) => ({ ...l, text: stripControl(l.text) }));
}

/** Build the ordered detail lines for the right pane. */
export function buildDetail(data: NodeData): DetailLine[] {
  const lines: DetailLine[] = [];
  const t = timingFor(data);

  if (data.type === "runtime") {
    lines.push({ text: `runtime data (${data.count} items)`, bold: true });
    lines.push({ text: `level: ${data.level}` });
    lines.push({ text: `load timing: ${t.label}`, bold: true });
    lines.push({ text: t.howItLoads, dim: true });
    lines.push(...explainLines(data));
    lines.push(...costLines(data));
    return sanitize(lines);
  }

  if (data.type === "settings") {
    const s = data.item;
    lines.push({ text: `settings (${s.level})`, bold: true });
    lines.push({ text: `path: ${s.path}`, dim: true });
    lines.push({ text: `level: ${s.level}` });
    lines.push({
      text: `permissions: allow ${s.allowCount} / deny ${s.denyCount} / ask ${s.askCount}`,
    });
    lines.push({ text: `env: ${s.envKeys.join(", ") || "(none)"}` });
    lines.push({ text: `hooks: ${s.hookCount}` });
    lines.push({ text: `load timing: ${t.label}`, bold: true });
    lines.push({ text: t.howItLoads, dim: true });
    lines.push(...explainLines(data));
    lines.push(...costLines(data));
    return sanitize(lines);
  }

  const item = data.item;
  lines.push({ text: item.name, bold: true });
  if (item.description) lines.push({ text: item.description });
  lines.push({ text: `path: ${item.path}`, dim: true });
  lines.push({ text: `level: ${item.level}` });
  lines.push({ text: `load timing: ${t.label}`, bold: true });
  lines.push({ text: t.howItLoads, dim: true });

  if (item.override.overriddenBy) {
    lines.push({
      text: `overridden by ${item.override.overriddenBy} level`,
      warn: true,
    });
  }
  if (item.override.overrides && item.override.overrides.length > 0) {
    lines.push({ text: `wins over: ${item.override.overrides.join(", ")}` });
  }

  switch (data.type) {
    case "skill":
    case "command": {
      const s = data.item;
      lines.push({
        text: `disable-model-invocation: ${s.disableModelInvocation}`,
      });
      if (s.paths.length > 0) {
        lines.push({ text: `paths: ${s.paths.join(", ")}` });
      }
      if (data.type === "command") {
        lines.push({ text: "legacy command", dim: true });
      }
      break;
    }
    case "agent": {
      const a = data.item;
      if (a.model) lines.push({ text: `model: ${a.model}` });
      if (a.tools) lines.push({ text: `tools: ${a.tools}` });
      if (a.memory) lines.push({ text: `memory: ${a.memory}` });
      break;
    }
    case "rule": {
      const r = data.item;
      if (r.globs.length > 0) {
        lines.push({ text: `paths: ${r.globs.join(", ")}` });
      }
      break;
    }
    case "memory": {
      const m = data.item;
      if (m.imports.length > 0) {
        lines.push({ text: `@imports: ${m.imports.join(", ")}` });
      }
      if (m.deprecated) {
        lines.push({ text: "deprecated (CLAUDE.local.md)", dim: true });
      }
      break;
    }
    case "hook": {
      const h = data.item;
      lines.push({ text: `event: ${h.event}` });
      lines.push({ text: `matcher: ${h.matcher}` });
      lines.push({ text: `command: ${h.commandSummary}` });
      break;
    }
    case "mcp": {
      const m = data.item;
      lines.push({ text: `transport: ${m.transport}` });
      lines.push({ text: `source: ${m.source}` });
      break;
    }
    default:
      break;
  }
  lines.push(...explainLines(data));
  lines.push(...costLines(data));
  return sanitize(lines);
}
