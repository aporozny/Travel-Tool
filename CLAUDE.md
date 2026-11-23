# Drift: instructions for Claude

Read `docs/STATUS.md` first. It is the single source of truth for what is deployed, what is open and what has been decided. Older status files in the repo root (`DEPLOYMENT_STATUS.md`, `SESSION_FINAL_STATUS.md`, `WEB_APP_STATUS.md`, `PROGRESS.md`) may be out of date; if they disagree with `docs/STATUS.md`, trust `docs/STATUS.md`.

## How to work with the owner

- Keep answers short and plain. One step at a time, one command at a time.
- Verify before saying something is done. Say plainly when something is not verified.
- Own mistakes. Do not guess; check.
- Never send anything to a third party (TripGic, Meta, etc.) or touch the VPS without the owner's go-ahead.

## Keeping the record in one place

- When a decision is made or a piece of work finishes, add it to `docs/STATUS.md` in the same PR (or a small follow-up PR).
- Claude's own memory is not shared between claude.ai and Claude Code. Anything the next session must know goes in this repo.

## Facts that are easy to get wrong

- Repo `aporozny/Travel-Tool`. VPS `PMX-AndreOC01`, project at `/home/andre/projects/drift`. Site `drifttravel.app`.
- The repo uses LF line endings. On Windows, check out with `core.autocrlf=false`.
- Deploy the website on the VPS: `cd ~/projects/drift && bash deploy/deploy-web.sh` (run as the normal user, no sudo in front). `web/dist` must not stay owned by www-data before a build; the script handles it.
- Do not run `npx update-browserslist-db` (it edits `package.json` files).
- The Meta Pixel loads only after a visitor clicks Accept on the consent banner (`drift_consent_v1` in localStorage; Global Privacy Control counts as decline). The Pixel count is therefore lower than real traffic; Drift's own sign-up count is the real number.
- TripGic failures arrive as HTTP 200 with `status: "failed"` and a `reason`. Branch on the body, never the HTTP status. Never retry book, issue or cancel without reading the booking status first.
- Booking through TripGic is admin-only while payments are sandbox-only.

## Brand and ad rules

- Australian spelling ("traveller", "travelling").
- No place names in ad copy. Members start from wherever they are.
- Only advertise features that work today. No "cheaper" or "save X%" claims until member rates exist and are provable (Australian Consumer Law).
- Never say Drift replaces emergency services. Safety pages carry: "Drift is not an emergency service. In danger, call 000 or the local emergency number."
- The only X handle is @drifttravelau.
