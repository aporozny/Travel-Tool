# Stage Plan — Stage 9: Owner-Curated Trips (RSVP)

**Approved by Executive:** 2026-08-19 ("the site needs a blog page for all travellers to post about their trips. and a Special blog page for me the owner inviting them to participate in trips" → "both" → real RSVP system, not a simple announcement post).

## Why this stage

The "traveler blog" half of the request was already satisfied by the existing Community feed (`community_posts` — text, photos, region/place tagging, comments, reactions). What didn't exist: a way for the owner to post a *specific* trip with real capacity that travelers can actually sign up to, distinct from a free-form post.

## Work packages

| WP | Description |
|---|---|
| WP9.1 | `032_trips.sql`: `trips` (title/description/destination/dates/capacity, draft\|published\|cancelled) + `trip_rsvps` (confirmed\|waitlisted\|cancelled, unique per trip+user). |
| WP9.2 | `routes/trips.ts`: admin-only create/edit (same inline `req.user!.role !== 'admin'` convention as `operators.ts`/`waitlist.ts`, no new middleware); RSVP confirms if there's room, waitlists if not; cancelling a confirmed spot auto-promotes the longest-waiting waitlisted traveler; admin gets a per-trip RSVP list; trip owner gets an email on each RSVP. |
| WP9.3 | `TripsScreen.web.tsx` + new "Trips" nav tab — trip cards, RSVP/cancel, admin create-trip modal, admin RSVP-list panel. |

## Issue found and fixed within this stage

Frontend nav-wiring patch used a Python multi-line string replace with no `assert` — it silently didn't match (whitespace/encoding mismatch), so the import/type/switch-case landed but the actual nav-array entry didn't. Compiled clean (`tsc` had nothing to catch — the entry just wasn't there), and the tab was invisible in the app. Only caught by testing in a real browser against the live site. Fixed with a byte-level UTF-8-safe insertion; the earlier missing-`assert` pattern flagged as a lesson (see LESSONS-LOG.md).

## Quality gate
- [x] Backend verified via direct API calls: capacity=1 correctly confirms one RSVP and waitlists the next; cancelling promotes the waitlisted traveler; non-admin blocked (403) from creating a trip
- [x] Frontend verified live end-to-end in a real browser: create trip → RSVP (spots counter updates live) → admin views RSVP list → cancel (counter reverts, button reverts) — driven via direct DOM/JS since the Browser pane wasn't visually displayed that session, same effect as real clicks
- [x] tsc clean (backend + frontend), production build clean, 79/79 backend tests passing
- [x] Test trips/accounts cleaned up after each verification pass
