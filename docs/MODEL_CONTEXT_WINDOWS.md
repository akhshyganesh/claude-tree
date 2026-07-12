# Model context windows — reference for the context gauge

<!-- ABOUTME: Docs-verified context-window sizes per Claude model, for the usage gauge. -->
<!-- ABOUTME: src/models.ts must match this file. Re-verify when Anthropic ships new models. -->

Verified 2026-07-12 against the Anthropic model catalog (cached 2026-06-24 upstream).
Live values are queryable from `GET /v1/models/{id}` → `max_input_tokens`; this tool stays
offline and ships this snapshot instead, labeled with the verification date.

| Model | ID | Context window | Notes |
|---|---|---|---|
| Claude Fable 5 | `claude-fable-5` | 1,000,000 | most capable |
| Claude Opus 4.8 | `claude-opus-4-8` | 1,000,000 | Claude Code default tier |
| Claude Opus 4.7 | `claude-opus-4-7` | 1,000,000 | |
| Claude Opus 4.6 | `claude-opus-4-6` | 1,000,000 | |
| Claude Sonnet 5 | `claude-sonnet-5` | 1,000,000 | |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | 1,000,000 | |
| Claude Haiku 4.5 | `claude-haiku-4-5` | 200,000 | smallest window — gauge most relevant |

Default model for the gauge: `claude-opus-4-8` (Claude Code's default tier).
Usable-context note: Claude Code triggers auto-compaction well before the hard limit;
the gauge shows share of the hard window and labels it as such.
