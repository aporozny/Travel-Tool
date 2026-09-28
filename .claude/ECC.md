# Vendored from ECC

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
