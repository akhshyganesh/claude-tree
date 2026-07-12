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
invocation, or on subagent spawn.

## Why

A Claude Code setup accumulates CLAUDE.md files, rules, skills, agents, hooks, settings,
and MCP servers across three or four levels, each with its own loading rules — and some of
those rules are surprising (a user-level *skill* beats a same-named project skill, but a
project-level *agent* beats a user one). `claude-tree` makes the whole picture visible
instead of tribal knowledge.

## What you get

- **Config tree** — levels → categories → items, with name, description, and a load-timing
  tag on every item. Runtime data (caches, session files) is collapsed and marked
  "not loaded into context" so it doesn't masquerade as config.
- **Detail pane** — path, frontmatter summary (model, tools, path globs, invocation
  flags), a one-line "how this loads" explanation, and override notes when the same name
  exists at another level.
- **Load-order view** (`o`) — the ordered pipeline of what happens when a session starts
  in this directory: config resolution → memory injection → everything that stays dormant
  until triggered.
- **Help** (`?`) — the precedence rules themselves, straight from the official docs.

Keys: `↑↓` navigate · `←→` expand/collapse · `o` load order · `?` help · `q` quit.

## Non-interactive

```bash
npx claude-tree --list   # plain-text tree + load order (CI, pipes, grep)
npx claude-tree --json   # the raw scan result
```

The default invocation also falls back to `--list` automatically when stdout isn't a TTY.

## What it encodes

The loading semantics come from the official Claude Code documentation and live in
[`docs/LOADING_ORDER.md`](docs/LOADING_ORDER.md) (settings precedence, memory merge order,
the skills-vs-agents conflict asymmetry, MCP scopes, hook registration). `claude-tree` is
read-only: it never writes to, executes, or modifies anything it scans.

## Requirements

Node 18+. No configuration; no network access.

## License

MIT
