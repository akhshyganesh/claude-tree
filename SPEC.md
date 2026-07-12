# claude-tree — spec

<!-- ABOUTME: Product/technical spec for claude-tree, the Claude Code config visualizer TUI. -->
<!-- ABOUTME: Source of truth for implementer agents; update alongside behavior changes. -->

## What it is

`npx claude-tree` — run in any directory. A TUI that shows every piece of Claude Code
configuration visible from that directory, across all levels (managed/enterprise → user
`~/.claude` → project `.claude` → local), what each folder/file is, its name + description,
and **when/how it loads into Claude's context** (session start vs on-demand vs
path-triggered), including the precedence order when levels collide.

Audience: anyone with a Claude Code setup who wants to see "what will Claude actually load
if I work here?"

## Behaviors

1. **Level discovery** (from cwd): walk up to find the project root (dir containing
   `.claude/` or `.git/`); read user level at `~/.claude`; read managed policy settings at
   the OS-specific path if readable; read `.mcp.json` at project root. Missing levels are
   shown as absent, not errors.
2. **Inventory per level**: CLAUDE.md (+`@import`s listed, not followed recursively beyond
   one level), CLAUDE.local.md (flag deprecated), `rules/*.md` (path-scoped vs always-on
   from `paths:` frontmatter), `skills/*/SKILL.md` (+ legacy `commands/*.md`),
   `agents/*.md`, `hooks/` + hook wiring parsed from settings.json, `settings.json` /
   `settings.local.json` (permission counts, env, hooks), `.mcp.json` / MCP config,
   `workflows/*.js|md`, anything else in the dir (shown under "other, not loaded by
   Claude").
3. **Item metadata**: name (frontmatter `name:` or filename), description (frontmatter
   `description:` or first heading/paragraph fallback), plus per-type load semantics label:
   e.g. skill → "description preloaded; body loads on /invoke or model trigger",
   rule with `paths:` → "loads when a matching file is touched", CLAUDE.md → "loads at
   session start". Exact wording comes from `src/loading-model.ts`, which encodes the
   docs-verified reference in `docs/LOADING_ORDER.md`.
4. **TUI** (Ink): three areas —
   - left: tree of levels → categories → items, navigable (↑↓, ←→ collapse/expand, enter);
   - right: detail pane for the selected item (path, name, description, load semantics,
     frontmatter summary, override note if the same name exists at another level);
   - a load-order view (toggle with `o`): the ordered pipeline of what loads when a
     session starts in this cwd, and what stays dormant until triggered.
   - `q` quits, `?` help footer always visible.
5. **`--list` mode**: plain-text (no TTY required) dump of the same tree + load order —
   used by tests/CI and non-interactive shells. `--json` emits the raw scan result.
6. **Conflict/override detection**: same skill/agent/command name at project and user
   level → mark winner per docs precedence.

## Stack & structure

- TypeScript strict, Node >= 18, ESM. Ink 5 + React 18 for the TUI. `gray-matter` for
  frontmatter. `vitest` for tests. `tsup` to build `dist/`. `bin: {"claude-tree": "dist/cli.js"}`.
- Core is pure and headless: `src/scan.ts` (filesystem discovery → `ScanResult`),
  `src/loading-model.ts` (level/precedence/load-semantics reference as data),
  `src/render-list.ts` (plain renderer). TUI (`src/tui/`) consumes `ScanResult` only.
  All scanning is testable against fixture directories in `tests/fixtures/` — never
  against the real `~/.claude`. Scanner takes `{cwd, home}` params for that reason.
- TDD: failing test → code → refactor. Suite green + `tsc --noEmit` clean before done.
- No network access at runtime. Read-only — never writes to scanned directories.

## Non-goals (v1)

Editing config, plugin marketplace introspection, live reload, Windows managed-path
testing (path constants included but untested), following MCP server liveness.

## Docs-verified loading reference

See `docs/LOADING_ORDER.md` (generated from official Claude Code docs research). The
loading-model module must match it; when docs and this spec disagree, the docs reference
wins.
