# Safety Check-In Endpoint — Critical Findings

**Date:** June 20, 2026
**Status:** Bugs confirmed via code review. Fix design in progress — pending
confirmation of current `trip_checkins` table schema before any code changes.
**Discovered during:** Admin-system audit (see ADMIN_SYSTEM_AUDIT.md). While
checking whether `safety.ts.backup` was safe to delete, the diff against the
live `safety.ts` revealed the live check-in endpoint had silently lost
functionality the backup version had. Investigating that led to these three
findings.

## Why this matters

Drift's safety check-in system is a core differentiator. These findings mean
the live `POST /api/v1/safety/trips/checkin` endpoint does not do what users
likely believe it does, and has at least one real authorization defect.

## Findings, ranked by severity

### 1. Authorization gap — HIGH
Live code:
```ts
const trip = await pool.query(
  `SELECT next_checkin_due FROM member_trips WHERE id = $1`,
  [body.tripId]
);
```
No check that the trip belongs to the authenticated user. Backup version had:
```sql
WHERE mt.id = $1 AND t.user_id = $2 AND mt.safety_status IN ('active','overdue')
```
**Impact:** any authenticated traveler can submit a check-in against any trip
ID, not just their own. No ownership or status validation at all.

### 2. Silent data loss — MEDIUM-HIGH
`checkinSchema` still validates and accepts `latitude`, `longitude`,
`batteryPct`, and `note`:
```ts
const checkinSchema = z.object({
  tripId: z.string().uuid(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  batteryPct: z.number().int().min(0).max(100).optional(),
  note: z.string().max(200).optional(),
});
```
The handler validates `body` against this schema but never reads
`body.latitude`, `body.longitude`, `body.batteryPct`, or `body.note` anywhere
in the function. They are accepted, validated, then discarded.
**Impact:** since the schema didn't change, the client (web/mobile) likely
still sends this data on every check-in, believing it's recorded. It isn't.

### 3. Broken state machine — HIGH
Trip start sets `safety_status = 'active'` and computes `next_checkin_due`
once, on `'planned' -> 'active'`. Trip complete sets `safety_status =
'completed'`. Nothing in the codebase (confirmed via
`grep -rln "next_checkin_due|overdue" backend/src backend/scripts`, only
`safety.ts` and `safety.ts.backup` match) resets `safety_status` from
`'overdue'` back to `'active'` on check-in, or advances `next_checkin_due`
forward. The check-in just inserts a `trip_checkins` row referencing the
already-existing `next_checkin_due` as `scheduled_return` and stops.
**Impact:** once a trip goes overdue, checking in does not resolve that
status or schedule the next check-in. The periodic safety loop does not
loop.

## Open question before fix design is final

The backup version inserted into `trip_checkins` with columns `(trip_id,
traveler_id, lat, lng, battery_pct, note)`. The live version inserts with
`(trip_id, scheduled_return, checked_in_at, escalation_level)` — a different
column set entirely. This suggests the table itself was migrated (matches
PROGRESS.md: "Checkin Schema - Added scheduled_return"), possibly dropping
the lat/lng/battery_pct/note columns from `trip_checkins` rather than just
removing them from the route code.

**Before writing a fix:** need to confirm via `\d trip_checkins` whether
those columns still exist on the live table. If they don't, the fix needs a
migration in addition to the route change. If they do, it's a route-only fix.

## Status

- [x] Findings confirmed and documented
- [ ] Confirm current `trip_checkins` schema
- [ ] Architect: finalize fix design
- [ ] Planner: scope blast radius (mobile app, any other callers)
- [ ] Builder: implement fix
- [ ] QA: test ownership rejection, status/due-date advancement, data persistence
- [ ] Reviewer: confirm fix doesn't introduce new regressions
- [ ] Shipper: commit + push

## Empirical confirmation (June 20 2026)

Ran a live test against the real API: created a controlled trip in
`overdue` status, logged in as its actual owner, called
`POST /api/v1/safety/trips/checkin`.

**Result:** `500 Internal server error`, every time. `trip_checkins` for
that trip remained empty after the call. `member_trips.safety_status` and
`next_checkin_due` were unchanged.

**Conclusion:** the check-in endpoint does not work at all right now, for
any user. This is not a partial regression (some data silently dropped) —
it is a complete failure. The earlier "silent data loss" framing is revised:
nothing is saved at all, because the endpoint throws before reaching that
code, almost certainly from inserting into `scheduled_return`/
`checked_in_at`/`escalation_level`, none of which exist on the live
`trip_checkins` table.

- [x] Live behavior confirmed via direct test

## Correction to Finding #2 (June 20 2026)

The original "silent data loss" framing assumed the client still sends
latitude/longitude/batteryPct/note since the Zod schema kept accepting
them. This was never directly verified and is now disproven:

grep -rn "trips/checkin|batteryPct" web/src
SafetyScreen.web.tsx:182:      await api.post('/safety/trips/checkin', { tripId });
SafetyScreen.web.tsx.backup:140:      await api.post('/safety/trips/checkin', { tripId });

Web sends only { tripId } - and always has, even in the backup version.
No client has ever sent location/battery/note on check-in.

Revised severity for Finding #2: downgraded from "silent data loss" to
"unused backend capability." The schema accepts fields no client populates.
Not a regression, not currently losing real user data. Low priority.

Findings #1 (authorization gap) and #3 (broken state machine) are
unchanged and remain high severity - and matter more given this
correction, since web genuinely does call this endpoint with real trip IDs
from real users on every check-in attempt, and every one of those attempts
fails right now (confirmed via live test).

Mobile blast radius: none. Confirmed via grep across mobile/app/src -
mobile has no trip check-in call at all. Its shareLocation() function hits
the separate /safety/location endpoint instead. The fix is web-only.

- [x] Finding #2 corrected after direct verification of client code
- [x] Mobile blast radius confirmed: none
