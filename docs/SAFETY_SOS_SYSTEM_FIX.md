# Safety Contacts, Location, and SOS System — Audit & Fix

**Date:** June 24, 2026
**Status:** All 5 confirmed-broken routes fixed and verified live. Notification
sending (Twilio/email) and the missed-check-in scheduler are explicitly NOT
done yet — see "What this does not do yet" below before assuming this system
protects anyone.

## Why this happened

Following the check-in bug fix earlier this session, a planning session was
called (per explicit instruction: no more incremental discovery, one complete
plan before building). Phase 0 of that plan required checking every table
referenced in `safety.ts` against the live schema before writing any code,
rather than fixing one bug and discovering the next mid-build.

## Complete schema inventory

Every table referenced in `backend/src/routes/safety.ts` was checked against
its live schema (`\d <table>` on `traveller_dev`). Two were already correct;
four had the same root cause as every other bug fixed this session - the
table evolved (almost certainly toward storing data directly against `users`
instead of through `travelers`, and using plain `lat`/`lng` columns instead
of PostGIS `geography`) and the route code was never updated to match.

| Table | Status | Issue |
|---|---|---|
| `safety_contacts` | Fixed (commit ee5de96) | Code used `traveler_id` (doesn't exist, live has `user_id` directly) and `access_expires_at` (doesn't exist). Live table already had `notify_on_overdue`/`notify_on_sos`/`notified_at` built ahead of any code using them. |
| `location_history` | Fixed (commit 9a0c1b8) | Code used `traveler_id`, a PostGIS `location` column, `accuracy`, `recorded_at`, and `expires_at` - none of which exist. Live has `user_id`, separate `lat`/`lng`, `accuracy_m`, `created_at`. No expiry concept at all. |
| `sos_events` | Fixed (commit 9a0c1b8) | Code used `traveler_id` and a PostGIS `location` column. Live has `user_id` directly and separate `last_known_lat`/`last_known_lng`/`last_location_at`. Live also has `trigger_type` (default `'button'`) which the code never set explicitly. |
| `identity_verifications` | Confirmed correct, no fix needed | Genuinely uses `traveler_id` as a real FK to `travelers`. Different design from the others - verified rather than assumed broken. |
| `sos_location_pings` | Confirmed correct, no fix needed | Already uses plain `lat`/`lng`, matches code exactly. |

## What was fixed (5 routes, 2 commits)

**Commit `ee5de96`** - `safety_contacts` CRUD (`POST`/`GET`/`DELETE /contacts`):
corrected to `user_id`, dropped `access_expires_at`, exposed
`notify_on_overdue`/`notify_on_sos` in the schema and queries.

**Commit `9a0c1b8`** - five more routes, same root cause:
- `POST /safety/location` - now writes `lat`/`lng`/`accuracy_m`/`created_at` directly against `user_id`
- `GET /safety/location/history` - corrected query, response field names
  (`longitude`/`latitude`/`accuracy`/`recorded_at`) preserved via column
  aliases so no client-facing contract changed
- `POST /safety/sos` (manual trigger) - contact lookup and `sos_events`
  insert both corrected; `trigger_type` now explicitly set to `'button'`
- `POST /sos/:id/ping` - ownership check corrected (the location UPDATE in
  this same route was already correct before this fix - inconsistency
  within the same route, now resolved)
- `POST /sos/:id/resolve` - ownership check corrected

## Live verification (June 24, 2026)

Full lifecycle tested against the real deployed container, not assumed from
code review:

```
POST /location        -> 201, correct id/recorded_at
GET /location/history  -> 200, count 1, correct field names preserved
POST /contacts         -> 201, test contact created with receives_sos=true
POST /sos              -> 201, contacts_notified: 1, location correctly
                           pulled from cached Redis location
POST /sos/:id/ping      -> 200, success
POST /sos/:id/resolve   -> 200, success

Final sos_events row:
  trigger_type: "button"
  last_known_lat/lng: updated correctly by the ping call
  contacts_notified: 1
  resolved_at: set correctly
```

All 5 routes confirmed working end to end. Test contact cleaned up after.

## What this does NOT do yet

This is the most important section in this document. All 5 routes now
behave correctly at the database level - no more 500s, correct data
persisted, correct ownership checks. But:

- **`sendSOSAlert()` is still a stub.** It only `console.log`s. SendGrid and
  Twilio code exists in `notifications.ts` but is commented out, never
  activated. `contacts_notified: 1` in the test above means the system
  correctly counted one contact who *should* be notified - it does not mean
  anyone was actually emailed or texted.
- **There is no scheduler.** Nothing watches `next_checkin_due`. A trip can
  only become `overdue` if something explicitly sets it (the check-in fix
  from earlier today correctly clears `overdue` back to `active`, but
  nothing currently transitions a trip *into* `overdue` in the first place).
- **The notification channel (Twilio SMS vs email vs both) is an open
  decision**, deliberately paused. `safety_contacts.notify_on_overdue` and
  `notify_on_sos` are real, working, selectable per-contact - they're just
  not wired to anything that actually sends.
- **`sos_responders` is never populated.** The table exists, designed for
  per-contact delivery tracking and acknowledgment, but nothing writes to it
  yet. Planned for whenever the scheduler is built, since both share the
  same "send to a list of contacts" logic.

## Remaining plan (from the multi-agent planning session)

- [x] Phase 1: Fix `safety_contacts` routes
- [x] Phase 2: Fix `location_history` and `sos_events` routes (expanded from
      original Phase 2/Twilio-wiring scope after the full inventory surfaced
      these additional bugs)
- [ ] Phase 2.5 (on hold): Decide notification channel (Twilio SMS vs email
      vs both), wire real sending into `notifications.ts`
- [ ] Phase 3: Build the scheduler - detect overdue trips, select contacts
      via `notify_on_overdue`, send, log to `sos_responders`, reset on next
      real check-in
- [ ] Phase 4: Confirm manual SOS sends a real notification end to end
      (mechanically ready now - blocked only on Phase 2.5)
- [ ] Phase 5: Final full live run-through, documented
