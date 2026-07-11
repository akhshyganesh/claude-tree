# Claude Code loading order — docs-verified reference

<!-- ABOUTME: The precedence/loading facts claude-tree encodes, verified against code.claude.com/docs. -->
<!-- ABOUTME: src/loading-model.ts must match this file. Re-verify against the docs when updating. -->

Verified 2026-07-12 against https://code.claude.com/docs (memory.md, skills.md,
sub-agents.md, mcp.md, hooks.md, server-managed-settings.md).

## Levels and paths

| Level | Root | Holds |
|---|---|---|
| Managed (org) | macOS `/Library/Application Support/ClaudeCode/`, Linux `/etc/claude-code/`, Windows `C:\Program Files\ClaudeCode\` | managed-settings.json, CLAUDE.md, agents/, managed-mcp.json |
| User | `~/.claude/` | settings.json, settings.local.json, CLAUDE.md, CLAUDE.local.md, rules/, skills/, agents/, commands/, hooks/, workflows/; `~/.claude.json` (user MCP) |
| Project | `<root>/.claude/` (+ `<root>/CLAUDE.md`, `<root>/.mcp.json`) | settings.json, settings.local.json, CLAUDE.md at repo root, rules/, skills/, agents/, commands/, hooks/, workflows/ |
| Local | `.claude/settings.local.json`, `CLAUDE.local.md` | personal, gitignored overrides |

Nested: subdirectories may carry their own CLAUDE.md / `.claude/skills/` / `.claude/agents/`,
discovered **on demand** when Claude works with files under them.

## Settings precedence (highest → lowest)

1. Managed (policyHelper > server-managed > OS policy file)
2. CLI arguments
3. `.claude/settings.local.json` (local)
4. `.claude/settings.json` (project)
5. `~/.claude/settings.json` (user)

Permission rules **merge** across scopes (deny anywhere wins); other keys override.

## Memory (CLAUDE.md) — all merged, ordered

Session start: managed CLAUDE.md first → then walking **root → cwd**, each directory's
CLAUDE.md then CLAUDE.local.md → user `~/.claude/CLAUDE.md`. Later = closer to the user =
effectively higher priority. `@import`s resolve recursively (max 4 hops) at launch and
cost context. Nested (below-cwd) CLAUDE.md files load on demand when files there are read.

## Rules (`rules/**/*.md`, user then project)

- No `paths:` frontmatter → loads at session start (like CLAUDE.md).
- With `paths:` globs → loads on demand when a matching file is touched.

## Skills (incl. legacy `commands/*.md`)

Name conflicts: **enterprise > personal (user) > project > bundled**. Skill beats a
same-named legacy command. Plugin skills are namespaced (`plugin:skill`) — no conflicts.
Nested skills coexist under directory-qualified names (`apps/web:deploy`).
Load timing: **descriptions** (frontmatter) preload at session start; the **body** loads
only on invocation (`/name` or model-triggered). `paths:` frontmatter restricts
auto-activation to matching files.

## Subagents (`agents/*.md`)

Name conflicts — note this is the **opposite** of skills:
**managed > CLI `--agents` > project > user > plugin**. Scanned recursively; identity
comes from `name:` frontmatter, not path. Definition loads when the agent is spawned.

## MCP servers

Managed allow/deny list is most restrictive; `managed-mcp.json` can take exclusive
control. Otherwise user (`~/.claude.json`) and project (`.mcp.json`) servers merge.
Tool listings connect at session start.

## Hooks

Registered from all settings scopes at session start (managed > project > user for
conflicts); executed event-driven (PreToolUse, PostToolUse, Stop, ...). They cost no
context; they run deterministically outside the model.

## Load-timing summary (the core visualization)

| Loads at session start | Loads on demand |
|---|---|
| Managed + ancestor-chain + user CLAUDE.md (+local, +@imports) | Nested/child-dir CLAUDE.md (on file read) |
| Unconditional rules | Path-scoped rules (on matching file touch) |
| Skill **descriptions** | Skill **bodies** (on invocation) |
| Hook registrations, merged settings | Subagent definitions (on spawn) |
| MCP server connections/tool lists | Memory topic files (via Read) |
| Auto-memory MEMORY.md (first ~200 lines) | |
