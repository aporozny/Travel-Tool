# Stage Plan — Stage 8: Public Launch Readiness

**Approved by Executive:** 2026-08-19 ("i want to release drift by simply letting users sign up. what changes are needed").

## Why this stage

Signup itself was already open (invite gating removed in an earlier stage) — but auditing "what's needed to actually let the public in" surfaced real gaps, two of which were **live security exposures regardless of whether signup opens**, not launch-readiness nice-to-haves.

## Work packages

| WP | Description |
|---|---|
| WP8.1 | **`JWT_REFRESH_SECRET` was the literal placeholder string `dev-refresh-secret-change-in-production`, hardcoded in `docker-compose.yml`, in this repo's public GitHub — the live signing secret for every user's refresh token, readable by anyone.** Rotated to a real random secret in `.env`, verified register/login/refresh all still work against the new secret before committing. |
| WP8.2 | **CORS silently allowed any origin** — `index.ts` reads `FRONTEND_URL`, only `APP_URL` was set in production, so it fell back to the `*` wildcard for every request. Added `FRONTEND_URL`; verified live (a forged cross-origin `Origin` header now correctly gets rejected, not reflected). |
| WP8.3 | `GOOGLE_PLACES_API_KEY` was also hardcoded in the same public file. Moved to `${VAR}` substitution — **the key value itself is still the exposed one**; rotating it requires the Google Cloud console, flagged as open for the Executive. |
| WP8.4 | Found and fixed separately, same audit: a `.env.bak.*` file (real secrets, SendGrid key/Twilio SID visible) was sitting in the repo root, untracked but **not gitignored** — one `git add -A` away from exposure. `.gitignore` widened to cover the whole class (`.env.bak*`, `.env.*.bak`, `*.env.bak.*`); the existing file moved outside the repo entirely, not deleted. Origin unknown — not created by anything in this project's own history. |
| WP8.5 | Password reset flow — didn't exist at all; a forgotten password meant permanent lockout. `POST /auth/forgot-password` (enumeration-safe, identical response whether the email exists or not) + `POST /auth/reset-password` (Redis-backed 1-hour token, single-use, re-runs the same `COMMON_PASSWORDS` check as registration, revokes the existing session on success). Frontend: "Forgot password?" link + two new screens in `LoginScreen.web.tsx`. |

## Still open (Executive action, not code)

- Rotate `GOOGLE_PLACES_API_KEY` in Google Cloud Console (WP8.3) — the exposed value is still live until this happens.
- No Privacy Policy or Terms of Service exist. Given Drift now collects emails, phone numbers, safety-contact info, and voice call transcripts, this needs real legal review, not a template.
- No email verification — any email can be used to register, including someone else's.
- `ENCRYPTION_KEY` is hardcoded to all-zeros in `docker-compose.yml` but nothing in the codebase reads it — dead config; either remove it or specify what it was meant to protect.

## Quality gate
- [x] `JWT_REFRESH_SECRET` rotated, verified live, committed
- [x] CORS fix verified live (cross-origin OPTIONS request test)
- [x] `.env.bak` gitignore gap closed
- [x] Password reset: 5 new tests (integration style, matching `auth.test.ts`'s existing real-app/real-db/real-redis pattern), 79/79 total passing
- [x] Password reset verified end-to-end in a real browser against the live site (not just the API)
- [ ] Google Places key rotation (Executive)
- [ ] Privacy Policy / Terms of Service (Executive + counsel)
- [ ] Email verification
