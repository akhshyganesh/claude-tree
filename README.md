# claude-tree

<!-- ABOUTME: Human-facing README for claude-tree, the Claude Code config visualizer TUI. -->
<!-- ABOUTME: Covers what it shows, how to run it, and the loading model it encodes. -->

See everything Claude Code will load from where you're standing.

```bash
npx claude-tree
```

Run it in any directory. It scans every configuration level visible from there —
managed/org policy, your user `~/.claude`, the project's `.claude`, and local overrides —
and shows what exists, what each file is (name + description), and **when it actually
enters Claude's context**: at session start, on demand, on a matching file path, on skill
invocation, or on subagent spawn. It also catches config **above** your project root
(a parent directory's CLAUDE.md/`.claude` loads too, when nested under your home).

## Why

A Claude Code setup accumulates CLAUDE.md files, rules, skills, agents, hooks, settings,
and MCP servers across three or four levels, each with its own loading rules — and some of
those rules are surprising (a user-level *skill* beats a same-named project skill, but a
project-level *agent* beats a user one). `claude-tree` makes the whole picture visible
instead of tribal knowledge.

## What you get

A lazygit-style fullscreen TUI with three stacked panels on the left and an always-visible
detail pane on the right:

- **1 · Config** — levels → categories → items, with name, description, and a load-timing
  tag on every item. Runtime data (caches, session files) is collapsed and marked
  "not loaded into context" so it doesn't masquerade as config.
- **2 · Load pipeline** — the ordered pipeline of what happens when a session starts in
  this directory: config resolution → memory injection → everything that stays dormant
  until triggered (dormant/deferred = loads only if something triggers it). Scrollable.
- **3 · Context cost** — answers "how much context does a session start with here?" It
  leads with Claude Code's fixed **baseline** (~5.2k–5.7k tokens: system prompt, built-in
  tools, env snapshot), then what **your config adds**, any auto-loaded project
  **MEMORY.md**, and the resulting **session-start range** (also shown in the title bar).
  Token counts are rough estimates (chars ÷4.6 markdown, ÷3.6 code, ÷4.2 json), rounded so
  they never look exact. Then the **context gauge**: one bar per Claude model showing that
  load as a share of the model's context window — press `m` to cycle models (Haiku's 200k
  window makes the same setup ~5x fuller than a 1M-window model). Below that: a per-level
  breakdown, the most expensive items as a proportional bar chart, and the **deferred** pool
  that only loads on invocation / spawn / a matching file touch. A directory with no config
  still shows the baseline, never a bare 0.
- **Detail pane** — path, frontmatter summary (model, tools, path globs, invocation
  flags), a plain-English "what is this", "who triggers it" (you vs the model vs the
  harness), "when it costs context", the load explanation, per-item token cost, and
  override notes when the same name exists at another level.
- **Help** (`?`) — the precedence rules (settings, memory merge order, skills-vs-agents
  conflicts), what "managed" means, how the gauge works, and a glossary of the jargon.

Keys: `1`/`2`/`3` or `tab` focus a panel · `↑↓` move/scroll · `←→`/enter expand/collapse
(Config) · `m` switch gauge model · `?` help · `q` quit. The focused panel gets the most
room. The TUI runs in the alternate screen buffer and restores your terminal on exit
(even on SIGINT/SIGTERM).

## Non-interactive

```bash
npx claude-tree --list       # plain-text tree + load order + context cost + gauge (CI, pipes, grep)
npx claude-tree --memories   # every memory file Claude loads here, in merge order
npx claude-tree --json       # scan result + summary block (cost, per-model gauges, load order)
npx claude-tree --version    # print the version
```

The default invocation also falls back to `--list` automatically when stdout isn't a TTY.

## What it encodes

The loading semantics come from the official Claude Code documentation and live in
[`docs/LOADING_ORDER.md`](docs/LOADING_ORDER.md) (settings precedence, memory merge order,
the skills-vs-agents conflict asymmetry, MCP scopes, hook registration); model context
windows live in [`docs/MODEL_CONTEXT_WINDOWS.md`](docs/MODEL_CONTEXT_WINDOWS.md). `claude-tree` is
read-only: it never writes to, executes, or modifies anything it scans.

## Requirements

Node 18+. No configuration; no network access.

## License

MIT
