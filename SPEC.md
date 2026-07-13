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
   the OS-specific path if readable; read `.mcp.json` at project root. **Ancestor config
   above the project root** (dirs strictly between `$HOME` and the root, when nested) is
   also scanned — its CLAUDE.md/`.claude` load in a real session, so they count here too,
   tagged at project level. Missing levels are shown as absent, not errors; a found root
   with no `.claude` says "root found, no .claude config".
2. **Inventory per level**: CLAUDE.md (+`@import`s listed, not followed recursively beyond
   one level), CLAUDE.local.md (flag deprecated), `rules/*.md` (path-scoped vs always-on
   from `paths:` frontmatter), `skills/*/SKILL.md` (+ legacy `commands/*.md`),
   `agents/*.md`, `hooks/` + hook wiring parsed from settings.json, `settings.json` /
   `settings.local.json` (permission counts, env, hooks), `.mcp.json` / MCP config,
   `workflows/*.js|md`, `plugins/` (own category — contains loadable plugin skills/agents, not yet inspected),
   known runtime data (collapsed, never loaded), anything else (shown under "other,
   not auto-loaded").
3. **Item metadata**: name (frontmatter `name:` or filename), description (frontmatter
   `description:` or first heading/paragraph fallback), plus per-type load semantics label:
   e.g. skill → "description preloaded; body loads on /invoke or model trigger",
   rule with `paths:` → "loads when a matching file is touched", CLAUDE.md → "loads at
   session start". Exact wording comes from `src/loading-model.ts`, which encodes the
   docs-verified reference in `docs/LOADING_ORDER.md`.
4. **TUI** (Ink) — see the v2 section below.
5. **`--list` mode**: plain-text (no TTY required) dump of the same tree + load order +
   context-cost summary (with the default-model context gauge) — used by tests/CI and
   non-interactive shells. `--json` emits the scan result plus a `summary` block
   (cost summary, per-model gauge percentages, load order) for scripting.
   `--memories` lists every memory file Claude loads here, in merge order, including
   auto-memory topic files. `--version` prints the version. A non-TTY stdout falls back
   to `--list` automatically.
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
  2. **Load pipeline** — the load-order pipeline in docs order; scrolls by offset (no
     selection bar, since its lines are prose).
  3. **Context cost** — the headline block, a **context gauge table** (one bar per Claude
     model showing session-start load as a share of that model's hard window, selected
     model highlighted, `m` cycles), a per-level breakdown, the top-N most expensive
     items with a proportional unicode bar chart, and the deferred pool.
  Right side: an always-visible **Detail** pane for the focused Config item; its lines
  word-wrap to the pane width and are grouped (identity / timing / explain / cost) with
  blank separators.
- **Accordion layout**: the focused panel gets ~half the left column; the other two share
  the rest. Panels show `[n/total]` (cursor mode) or `[↓ N more]` (scroll mode) in their
  title when content overflows.
- **Title bar** leads with the headline: `session start ≈ ~X–Y tokens`, then the cwd
  (home-abbreviated) — the number a first-timer came for is never truncated away.
- **Keys**: `↑↓` move/scroll within the focused pane, `1/2/3`/`tab` switch, `←→`/enter
  expand (Config), `m` cycle the gauge model, `?` help overlay (scrollable; includes the
  memory merge order, a "managed" explanation, the gauge explanation, and a jargon
  glossary), `q` quit. The bottom keybar updates contextually.

### Context cost (`src/context-cost.ts`, headless + unit-tested)

Estimates tokens per content type via `estimateTokens(chars, kind)` — always labelled an
estimate ("~"). Claude's tokenizer is denser than GPT's (denser still for code), so each
kind gets its own divisor: markdown ÷4.6, code ÷3.6, JSON ÷4.2, other text ÷4.4. Call sites
pick the kind by file type (config markdown → `markdown`). Exact counts would need
Anthropic's `count-tokens` API (free but networked) — a future `--count-tokens` flag; no
network today. Per docs semantics:

- CLAUDE.md/CLAUDE.local.md: full body at session start. `@imports` load recursively
  (≤4 hops per docs); the estimate resolves **one level** of imports (read relative to
  the memory file's dir) and says so in its note.
- **Auto-memory** `~/.claude/projects/<slug>/memory/MEMORY.md` (slug = project root path
  with `/`→`-`): only its first 200 lines / 25KB inject at session start; topic files load
  on demand. Surfaced as a user-level `memory` item and accounted separately from config.
- Unconditional rules: full body at session start. Path-scoped rules: 0 at start, body
  deferred ("when a matching file is touched").
- Skills/commands: only the frontmatter **description** counts at session start; the body
  is deferred to invocation. Both numbers shown.
- Agents: 0 at start; the whole definition is deferred to spawn.
- Settings/hooks: 0 tokens (hooks run outside the model). MCP: 0 measured, labelled
  "varies" (tool schemas add tokens but aren't statically measurable).

**Baseline overhead.** `CLAUDE_CODE_BASELINE` (≈ 5,200–5,700 tokens: system prompt +
built-in tools ≈ 4,200t, env/git snapshot ≈ 280t, bundled skill descriptions + MCP tool
names vary; source code.claude.com/docs/en/context-window) is the context Claude Code holds
before any user config. Panel 3 and `--list` render, in order: the baseline range, "your
config adds ~X", "auto memory ~Y" (when present), and "= session start ~(range)" =
`baseline + config + auto-memory` — then the per-level breakdown, bar chart, and deferred
pool. With no config, they still show the baseline plus "this directory adds no config
context".

`ScanResult` items carry `contextCost: {sessionStartTokens, deferredTokens, note?}`, decorated
during the scan. `summarizeContextCost(scan)` aggregates (baseline, config total, auto-memory,
session-start range) for Panel 3, `--list`, and `--json`.

### Context gauge (`src/models.ts`, headless + unit-tested)

Encodes `docs/MODEL_CONTEXT_WINDOWS.md` (docs-verified model context windows; default
model `claude-opus-4-8`). `gaugeFor(summary, model)` returns the fill fraction (range
midpoint over the hard window), a `▓░` bar, percent text, and a formatted line.
Labelled an estimate; auto-compaction triggers before the hard limit.

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
