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
4. **TUI** (Ink) — see the v2 section below.
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

## v2 — lazygit-style fullscreen TUI

The TUI is a persistent, fullscreen (alternate-screen) multi-panel app modelled on
lazygit. The root layout fills `stdout.rows`/`columns` exactly; **every pane windows its
own content** (renders only the visible slice) because a fixed-height Ink/yoga root clips
overflowing panes and garbles them otherwise. Terminal resize re-reads dimensions on the
stdout `resize` event.

- **Alt-screen lifecycle**: `runTui` writes `\x1b[?1049h` on start and restores
  `\x1b[?1049l` via a `finally` **and** a process `exit` handler plus `SIGINT`/`SIGTERM`
  handlers (which restore then exit), so the terminal is never left corrupted. `runTui`
  takes injectable `{render, stdout}` deps for testing.
- **Panels** (numbered; `1`/`2`/`3` or `tab` to focus, focused pane gets a cyan border):
  1. **Config** — the level → category → item tree (`buildRows`); `←→`/enter expand/collapse.
  2. **Session start** — the load-order pipeline in docs order; scrollable.
  3. **Context cost** — total ~tokens at session start, a per-level breakdown, the top-N
     most expensive items with a proportional unicode bar chart, and the deferred pool.
  Right side: an always-visible **Detail** pane for the focused Config item.
- **Keys**: `↑↓` move within the focused pane, `1/2/3`/`tab` switch, `←→`/enter expand
  (Config), `?` help overlay, `q` quit. The bottom keybar updates contextually.

### Context cost (`src/context-cost.ts`, headless + unit-tested)

Estimates tokens ≈ `ceil(chars/4)` — always labelled an estimate ("~"). Per docs semantics:

- CLAUDE.md/CLAUDE.local.md + one level of resolved `@imports` (import file read relative
  to the memory file's dir): full body at session start.
- Unconditional rules: full body at session start. Path-scoped rules: 0 at start, body
  deferred ("when a matching file is touched").
- Skills/commands: only the frontmatter **description** counts at session start; the body
  is deferred to invocation. Both numbers shown.
- Agents: 0 at start; the whole definition is deferred to spawn.
- Settings/hooks: 0 tokens (hooks run outside the model). MCP: 0 measured, labelled
  "varies" (tool schemas add tokens but aren't statically measurable).

`ScanResult` items carry `contextCost: {sessionStartTokens, deferredTokens, note?}`, decorated
during the scan. `summarizeContextCost(scan)` aggregates for Panel 3, `--list`, and `--json`.

### Explain everything / "who invokes it"

`loading-model.ts` exposes `explainItem(input)` returning data strings (`whatIsThis`,
`whoTriggers`, `whenItCostsContext`) per item type — reused by the Detail pane, `--list`
and `--json`, and unit-tested independently of the UI.

## Non-goals (v1)

Editing config, plugin marketplace introspection, live reload, Windows managed-path
testing (path constants included but untested), following MCP server liveness.

## Docs-verified loading reference

See `docs/LOADING_ORDER.md` (generated from official Claude Code docs research). The
loading-model module must match it; when docs and this spec disagree, the docs reference
wins.
