# Vendored agent skills

A curated subset of [affaan-m/ECC](https://github.com/affaan-m/ECC) (MIT, © 2026 Affaan Mustafa; see `ECC-LICENSE`), vendored at upstream commit `d3b8a3e908904e242ed2dbe66af62cca71131419` (2026-09-27).

Only the pieces that fit this stack (Express/TS + Postgres/PostGIS + Redis, React DOM web, bare React Native mobile) were copied. No ECC hooks, rules, installer or MCP configs are installed, so nothing runs automatically.

## Installed

| Kind | Name | Use |
|---|---|---|
| Agent | `planner` | Step-by-step implementation plans (read-only tools) |
| Agent | `code-reviewer` | General review, with a strong filter against false positives |
| Agent | `typescript-reviewer` | Type safety, async correctness, Node security |
| Agent | `react-reviewer` | Hooks, rendering, accessibility for `web/` and `mobile/app/` |
| Agent | `security-reviewer` | OWASP, secrets, auth, payments and webhooks |
| Agent | `database-reviewer` | SQL, indexes, schema, migrations |
| Agent | `silent-failure-hunter` | Swallowed errors and bad fallbacks |
| Agent | `pr-test-analyzer` | Whether tests actually cover the changed behavior |
| Agent | `build-error-resolver` | Minimal-diff fixes for type and build errors |
| Skill | `postgres-patterns` | Index and query cheat sheet |
| Skill | `database-migrations` | Safe schema changes (adapted to the hand-applied SQL flow) |
| Skill | `redis-patterns` | Caching, locks, key and TTL design |
| Skill | `error-handling` | Typed errors, retries, user-facing messages |
| Skill | `verification-loop` | Pre-PR check across backend, web and mobile |
| Command | `/build-fix` | Fix build errors incrementally |

## Local modifications

Each file ends with a **Travel-Tool context** section recording this repo's real conventions: UUID PKs, no RLS, the error envelope, the migration flow, the web `localStorage` token. Other changes:
- Removed "MUST BE USED for all code changes" from the reviewer descriptions, so a reviewer isn't auto-spawned on every trivial edit.
- `build-error-resolver`: removed the "nuclear option" that deleted `package-lock.json` (it would break CI's `npm ci`).
- Rewrote `verification-loop`'s commands for this repo's three packages and CI, and removed its references to ECC hooks and `/verify`.
- Rewrote or removed cross-references to ECC agents, skills and commands that weren't vendored.

## Deliberately not taken

`/plan` (Claude Code has plan mode, and the command links to about 8 uninstalled ECC commands), `tdd-guide` (requires a nonexistent `test:coverage` script and an eval addendum), `backend-patterns` (Supabase/Next.js examples, and its sample queue swallows errors), `react-native-patterns` (assumes Expo/TanStack), the ECC `security-review` skill (clashes with the built-in `/security-review`), and all hooks and always-on rules.

## Updating

Clone upstream, diff each file above against `agents/`, `skills/` or `commands/` there, and re-apply the Travel-Tool context sections.

## Also vendored: mattpocock/skills

Process skills from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT, © 2026 Matt Pocock; see `MATTPOCOCK-SKILLS-LICENSE`), at upstream commit `c55ee46073ed923f86ce59a5eb3b6d895095d1b7` (2026-09-18). They cover *how to work*, where ECC covers *what to check*. The Codex-only `agents/openai.yaml` files were dropped.

| Skill | Use |
|---|---|
| `diagnosing-bugs` | Build a red-capable feedback loop, then minimise, hypothesise, instrument, fix and clean up |
| `tdd` | Red to green in vertical slices at agreed seams (with `tests.md` and `mocking.md`) |
| `codebase-design` | Deep-module vocabulary: interface, seam, adapter, depth |
| `grilling` / `/grill-me` | Round-based interview to stress-test a plan before building |
| `/handoff` | Hand off to a fresh session (saved in `docs/handoffs/` when running in the cloud) |
| `resolving-merge-conflicts` | Intent-preserving conflict resolution |

Each has a **Travel-Tool context** section with the repo's real test commands, the lockfile and `schema.sql` merge rules, and warnings about the real database.

**Not taken:** everything that needs `/setup-matt-pocock-skills` (issue-tracker config): `to-spec`, `to-tickets`, `triage`, `wayfinder`, `code-review` (which would also shadow the built-in `/code-review`). Also skipped: hook and pre-commit installers (`git-guardrails-claude-code`, `setup-pre-commit`), the `in-progress/` drafts, and course- or writing-specific skills.

## Also vendored: anthropics/skills

From [anthropics/skills](https://github.com/anthropics/skills) at upstream commit `33375500bcea98d610eb30ce10ac4e59b89c390d` (2026-09-24). Each skill carries its own `LICENSE.txt` (Apache-2.0).

| Skill | Use |
|---|---|
| `webapp-testing` | Drive `web/` with Python Playwright: screenshots, console logs, UI checks |
| `frontend-design` | Design direction and UI copy guidance for new web surfaces |

**Modified (Apache-2.0 §4b notice):** `webapp-testing/scripts/with_server.py` now writes server output to a log file instead of an undrained `PIPE`, starts servers in their own session and stops them with `killpg`, and reports early server exit. Tested with a server that prints 20,000 lines: the original timed out without ever listening, while the patched version ran the command (exit 0) and left no processes behind. Both skills also have a Travel-Tool context section.

**Not taken:** `docx`, `pdf`, `pptx`, `xlsx` (proprietary license, not redistributable in this repo, and already available to your account as `anthropic-skills:*`). Also `skill-creator`, `web-artifacts-builder` and `claude-api` (already available in Claude Code), and the art, branding, Slack GIF, internal-comms, theme and course skills (unrelated to this app).

## Evaluated and declined: Egonex-AI/Understand-Anything

[Egonex-AI/Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) (MIT, commit `6df3065`) was reviewed and **not installed** (owner's decision, 2026-09-28). It's a whole plugin (a tree-sitter core package plus a dashboard app), so it can't be vendored piece by piece. Review notes for anyone reconsidering: it has no telemetry, and its only outbound call is the opt-in Figma API. Its SessionStart and PostToolUse hooks do nothing unless `.ua/config.json` sets `autoUpdate: true`. When enabled, they tell the agent to re-analyze without asking, on every session start and every commit, so leave it off. To try it locally: `/plugin marketplace add Egonex-AI/Understand-Anything`, then `/plugin install understand-anything`.

## Plugins enabled from the official marketplace (anthropics/claude-plugins-official)

Enabled for this project in `.claude/settings.json` (`enabledPlugins`, marketplace `claude-plugins-official`, reviewed at commit `87bc24a`, 2026-10-15). Plugins install on the next session start, and Claude Code may ask you to trust them first.

| Plugin | What it adds | Notes |
|---|---|---|
| `commit-commands` | `/commit`, `/commit-push-pr`, `/clean_gone` | Commands only |
| `feature-dev` | `/feature-dev` workflow with explorer, architect and reviewer agents | Agents are namespaced (`feature-dev:code-reviewer`), so they don't clash with the ECC `code-reviewer` |
| `claude-md-management` | `/revise-claude-md` and a CLAUDE.md auditing skill | The repo has no CLAUDE.md yet |
| `claude-code-setup` | Recommends hooks, skills and MCP servers for the codebase | Read-only advice |
| `security-guidance` | Regex warnings on edits, plus an agentic Opus review on each `git commit` | **`ENABLE_STOP_REVIEW=0`** is set in `settings.json` to turn off its *per-turn* Opus diff review, which costs tokens every turn. Commit review stays on. Project rules: `.claude/claude-security-guidance.md`. It sends diffs to the Anthropic API. |
| `typescript-lsp` | Go-to-definition, references and diagnostics through `typescript-language-server` | Needs the binary. A SessionStart hook in `settings.json` installs `typescript-language-server@6.0.2` and `typescript@5.9.3` (pinned to match the repo), **only in cloud sessions**; on your own machine, run `npm i -g typescript-language-server typescript` once. |
| `context7` | Up-to-date library docs over a remote MCP server (`mcp.context7.com`) | Anonymous. It receives library names and queries, not your code. |

To turn one off for yourself only, set it to `false` under `enabledPlugins` in `.claude/settings.local.json`.

**Not enabled, and why:** `pr-review-toolkit`, `code-review`, `code-simplifier` and `frontend-design` (duplicates of the vendored ECC agents, the built-in `/code-review` and `/simplify`, and the vendored skill); `playwright` (its MCP is unpinned `@playwright/mcp@latest`, and `webapp-testing` covers it); `hookify` (no rules defined yet); `github` (cloud sessions already have GitHub access); `redis-development` (overlaps `redis-patterns` and is mostly vector-search content); the full `stripe` plugin (see `stripe-best-practices`); the 15+ LSPs for other languages; and the roughly 250 third-party product integrations that need accounts the app doesn't use.

### Skills vendored from external plugins

| Skill | From | Notes |
|---|---|---|
| `stripe-best-practices` | [stripe/ai](https://github.com/stripe/ai) @ `97b2164` (MIT) | Plugin not enabled: its hooks ask for feedback in about 1% of all turns, it reports usage through the CLI, and its MCP acts on the live account. Links now point at the bundled references. |
| `twilio-sendgrid-email-send`, `twilio-sendgrid-deliverability-advisor`, `twilio-security-hardening` | [twilio/ai](https://github.com/twilio/ai) @ `8aba46f` (MIT) | 3 of 57 skills, matched to actual use: SendGrid email and the Twilio SIP trunk. SMS uses Mobile Message. |

## Also vendored: JuliusBrussee/caveman

`caveman` skill only, from [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) @ `d262ab3` (Apache-2.0, with `LICENSE` and `NOTICE` alongside). **Changed to opt-in** (`disable-model-invocation: true`): type `/caveman` for terse answers, and "stop caveman" to go back. The plugin itself was not installed. It switches on at every session *and subagent* start, which would override the owner's preference for full answers and make reviewer reports terse. Its own benchmark shows only about 3% saving over a plain "answer concisely". The CLI, proxy, model auto-picker and hooks were left out too.
