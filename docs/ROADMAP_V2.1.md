# claude-tree v2.1 — audit findings & implementation plan

<!-- ABOUTME: Handoff document — the fresh-eyes audit results, the agreed fixes, and the -->
<!-- ABOUTME: new context-gauge feature spec. Continue implementation from this file. -->

Status when this was written (2026-07-12): repo at commit `b2270db`, 99 tests green,
v2 TUI shipped (lazygit-style fullscreen, 3 panels + detail, context-cost model with
baseline + auto-memory + Claude-tokenizer divisors), installed globally on this machine.

This file captures (1) a fresh-eyes audit by an independent agent (no build history,
first-timer lens, verified against real runs at 80x24 and 120x30), (2) the new
**context gauge** feature request, and (3) the agreed implementation plan.

**Status 2026-07-13: IMPLEMENTED.** Both passes landed (plus a `--memories` view and a
CI matrix for Linux/macOS). Kept for history; SPEC.md and README.md are the current
source of truth.

---

## Part 1 — Audit findings (verified, prioritized)

### Misleading output

| ID | Finding | Where | Fix |
|---|---|---|---|
| **M1** | **Ancestor config above the project root is invisible — the worst finding.** Running from a nested git repo (e.g. `~/ws/claude-tree` under `~/ws/.claude`), the tool reports "no config context" even though Claude Code's memory walk goes **up from cwd toward `/`** and would load the parent `ws/.claude/CLAUDE.md` (~1.2k tokens), skills, agents, hooks. The core answer can be flat wrong in nested repos. | `src/scan.ts` `findProjectRoot` + project block | Continue the CLAUDE.md/`.claude` discovery walk **above** the project root up to `$HOME` (exclusive — user level covers `~/.claude`), tagging results as ancestor config at project level. At minimum warn when a `.claude` exists in an ancestor. Add fixture: nested repo under a dir that has `.claude/`. |
| **M2** | Detail pane calls auto-memory MEMORY.md "a CLAUDE.md file", and the pane contradicts itself on imports: "up to 4 hops" (LOAD_TIMINGS, matches docs) vs "one level of @imports" (explainItem/memoryCost/SPEC). | `src/tui/detail.ts` `timingFor`, `src/loading-model.ts` | Add an `autoMemory` branch in `timingFor`/`explainItem`. Reconcile wording everywhere to: "loads recursively (≤4 hops); the estimate covers one level". |
| **M3** | `other (not loaded)` header vs `[on demand]` tag on its items — self-contradiction. Worse: `~/.claude/plugins` lands there, but plugin skills/agents DO load. `sessions`, `telemetry`, `remote-settings.json`, `policy-limits.json`, `mcp-needs-auth-cache.json`, `statusline-command.sh` are runtime noise shown as mystery files. | `src/render-list.ts`, `src/scan.ts` `RUNTIME_DIRS`/`RUNTIME_FILES` | Extend the runtime lists with the names above. Give `plugins` its own category with note "contains loadable plugin skills — not yet inspected". Rename header to "other (not auto-loaded)". |
| **M4** | "Claude tokenizer estimate" implies a real tokenizer ran; it's a chars÷divisor heuristic, and exact-looking numbers (~1207t) add false precision. | `src/tui/app.tsx`, `src/render-list.ts`, README | Say "rough estimate (chars ÷ 4.6 markdown, ÷3.6 code, ÷4.2 json)". Round display to 2 significant figures ("~1.2k"). |
| **M5** | Cost headline mixes units/formats ("~5.2k–5.7k" then "adds ~1888") and `--list` duplicates the config line right after. | `src/context-cost.ts` headline, `src/render-list.ts` | One format with units on every line ("your config adds ~1.9k tokens"); drop the duplicate line. |
| **M6** | SPEC/README claim `--list`/`--json` include the explain data and cost summary; `--json` is the bare ScanResult. | SPEC.md, `src/cli.ts` | Preferred: add a `summary` block (cost summary + per-item explain strings) to `--json` — useful for scripting. Otherwise fix the SPEC. |
| **M7** | Panel 2 titled "Session start" but its phase 3 is "Dormant until triggered" — contradiction. | `src/tui/app.tsx` | Retitle panel 2 "Load pipeline" (or "What loads when"). |

### Broken / unusable UX

| ID | Finding | Fix |
|---|---|---|
| **B1** | **Detail pane truncates nearly every line** (`wrap="truncate-end"`, no scroll, no focus key). At 80x24 more than half of every explanation is invisible — the flagship "plain-English what/who/when" feature is unreadable. Also the wall-of-text complaint: 12+ dense lines, no grouping. | `wrap="wrap"` for detail lines + blank-line separators between identity / timing / explain / cost blocks (see B5 for how). |
| **B3** | 80x24 layout: left panels get 4-5 content lines each; rigid thirds waste space. | Focused panel gets extra height (accordion), or weight Config 50/25/25. |
| **B4** | No scroll indicator anywhere; panels window silently. | Dim `↓ N more` line or `[3/41]` in panel titles. |
| **B5** | Blank spacer lines (`{text: ""}`) are swallowed by Ink — sections jam together in Help and Panel 3. | Use `{text: " "}` (single space). |
| **B6** | ↑↓ in panels 2/3 drags an inverse-video cursor over prose/blank lines that select nothing. | Scroll-offset semantics (no inverse bar) for panels 2/3, or wire their items to the Detail pane. |
| B2 | (Non-finding, recorded to save future effort) The rumored leftover `o` load-order keybinding does not exist anywhere in code/help/README/SPEC — cleanup already complete. | None. |

### First-timer comprehension

- **Jargon with zero explanation**: "managed (org policy)", "locality", "dormant", "deferred", "harness", "frontmatter", "path-scoped", "MCP". Fix: one dim gloss line per panel (e.g. "deferred = only loads if something triggers it").
- **The headline number is buried** — the single thing a first-timer wants ("a session here starts at ~7.1k–7.6k tokens") is line 4 of the third panel. Fix: put it in the top title bar next to the cwd.
- **"Project (.claude): absent"** reads as "you have no project" when a root WAS found. Fix: "Project — root found at …, no .claude config".
- **Help screen** omits the memory merge order (`MEMORY_LOAD_ORDER` exists as data, shown nowhere) and never explains "managed".
- **Hook commands as raw shell** are wall-of-noise in list/panel views. Fix: show the script basename (`redact-env.sh`) in lists; full command in Detail only.

### Dead / vestigial code & doc drift

- `LOAD_TIMINGS.memoryNested` — defined, consumed by nothing. Surface it (nested CLAUDE.md story) or remove.
- `MEMORY_LOAD_ORDER` — exported, no renderer uses it. Show it in Help.
- SPEC drift: SPEC promises `hooks/` dir file listing (scanner only parses settings wiring); SPEC/README `--json` claims (M6); README "precedence rules straight from the official docs" oversells while memory order is missing.
- `@imports` "one level" (SPEC) vs "4 hops" (LOADING_ORDER.md) — same M2 inconsistency at doc level.
- No `--version` flag; `--help` doesn't mention the non-TTY fallback.
- `--list` settings row never uses `└─` when last.

### Auditor's top 5 for a first-time user, in order

1. M1 — ancestor config discovery (correctness).
2. B1 — detail pane wrap + breathing room (readability).
3. M2 — auto-memory text + hops contradiction (trust).
4. Headline number in the title bar with consistent units (M5).
5. M3 — reclassify plugins/runtime noise (inventory honesty).

---

## Part 2 — New feature: context gauge with model switcher

**Request**: a progress bar showing how much of the **selected model's context window**
the session-start load consumes, switchable across models to compare.

Design agreed:

- New headless module `src/models.ts` encoding `docs/MODEL_CONTEXT_WINDOWS.md`
  (docs-verified 2026-07-12): Fable 5 / Opus 4.8 / 4.7 / 4.6 / Sonnet 5 / Sonnet 4.6
  → **1,000,000** tokens; Haiku 4.5 → **200,000**. Default model: `claude-opus-4-8`
  (Claude Code's default tier).
- Gauge = estimated session-start total (min–max range from `summarizeContextCost`)
  over the model's window, rendered as a filled unicode bar + percentage, e.g.
  `Opus 4.8  ▓░░░░░░░░░  ~7.4k / 1M  (~0.7%)`. Use the range's midpoint for the fill,
  show the range in text.
- **`m` key cycles the selected model** (Panel 3 focused or globally). Show all models
  as a comparison table in Panel 3: one gauge row per model, selected row highlighted —
  Haiku's 200K window makes the same setup ~5x fuller, which is the insight.
- Label as estimate; note that auto-compaction triggers before the hard limit.
- `--list` gains the gauge line for the default model; `--json` summary includes
  per-model percentages.
- Keybar gains `m model`. Help explains the gauge.

---

## Part 3 — Implementation plan (two sequential passes)

Work TDD; keep the suite green; do NOT commit mid-pass. Repo rules: TypeScript strict,
no `any`, 2-line ABOUTME headers, headless logic stays out of `src/tui/`.

### Pass A — headless correctness + gauge model

1. **M1 ancestor discovery** in `scan.ts` (+ fixtures: nested repo under a `.claude`-bearing dir; assert memory/skills found and cost counted).
2. **M3 classification**: extend RUNTIME lists; `plugins` category; header rename.
3. **M2 wording**: `autoMemory` explain/timing branch; unify "≤4 hops, estimate covers one level" across loading-model, context-cost notes, SPEC, LOADING_ORDER.
4. **M4/M5 copy + formatting**: `formatTokens` to 2 sig figs everywhere; single-format headline; "rough estimate" caption; drop duplicate list line.
5. **M6**: add `summary` (cost + explain) to `--json`.
6. **Quick wins**: hook basename in list rows; `└─` for last settings row; `--version`; dead-code decisions (`memoryNested` → surface in explain for below-cwd note; `MEMORY_LOAD_ORDER` → consumed by Help in Pass B).
7. **`src/models.ts`** + gauge math (`gaugeFor(summary, model)` returning fill fraction, formatted line) + tests. `--list`/`--json` gauge output.

### Pass B — TUI overhaul

1. **B1**: detail pane `wrap="wrap"`, section separators (`{text: " "}` per B5), grouped blocks.
2. **B3**: focused-panel accordion heights (50/25/25 weighting).
3. **B4**: `↓ N more` / `[n/total]` overflow indicators in panel titles.
4. **B6**: scroll-offset (no cursor bar) for panels 2/3.
5. **M7**: retitle Panel 2 "Load pipeline".
6. **Gauge UI in Panel 3**: per-model gauge table, `m` to cycle, selected highlighted; headline total moved into the title bar ("session start ≈ ~7.1k–7.6k tokens").
7. **Comprehension**: per-panel gloss lines; "Project — root found, no .claude config" wording; Help gains memory merge order + "managed" explanation + gauge explanation; hook rows show basename.
8. Update README/SPEC screenshots-in-prose, keys, and the M6/M2 doc drift.

### Verification gates (both passes)

`npx vitest run` green · `npx tsc --noEmit` · `npm run build` · `node dist/cli.js --list`
from `~/ws` (config-rich), `~/ws/claude-tree` (M1 case — must now show ancestor config),
and `$HOME` (baseline-only) · pty smoke at 80x24 AND 120x30 (`script -qec`, scripted keys
`1/2/3, tab, arrows, m, ?, q`) checking wrap, gauges, indicators, alt-screen restore.
Then commit per pass (conventional commits), rebuild, `npm install -g` the dir, and
hand over for a human look.

---

## Context for whoever picks this up

- Loading semantics source of truth: `docs/LOADING_ORDER.md` (docs-verified; note the
  skills-vs-agents precedence asymmetry). Model windows: `docs/MODEL_CONTEXT_WINDOWS.md`.
- The baseline constant (`CLAUDE_CODE_BASELINE`, ~5.2k–5.7k) is docs-sourced with a
  verified-on date — keep the date fresh if re-verified.
- Global install on this machine is a symlink to this directory — `npm run build` is
  enough to update the `claude-tree` command.
- History: v1 core `97a47f8` → TUI `89bf4b9` → review fixes `6a489c8` → v2 fullscreen
  `a3345cb` → context-cost v2.1 `b2270db`. A prior review pass already fixed
  home-as-project double-scan, package exports, memory-order inversion — don't regress
  those (tests cover them).
