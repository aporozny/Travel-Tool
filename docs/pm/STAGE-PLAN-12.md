# Stage Plan — Stage 12: Trip Mode — opt-in live location, Safety Line auto-context, live proximity matching

**Status: built, deployed, and live-verified. Only the Privacy Policy update remains open.**

**Approved by Executive:** 2026-08-26 ("we can get the user to turn on their geo location on their devices... How do we take advantage of this feature and ensure we track multiple people at the same time" → "yes lets plan this correctly and see where we end up" → plan reviewed and approved before build).

## Why this stage

Aussie-to-Bali targeting work (the "Backup for Bali" landing page and social mockups) put Safety Line front and centre as an acquisition hook. The Executive asked how to take an opt-in, toggleable live-location feature and turn it into a real product advantage, specifically calling out two things: feeding it into Safety Line so the AI doesn't have to ask a caller where they are, and using it to make "travelers going your way" show who's actually nearby, not just who picked the same destination string.

Direct research on the live repo found this was a smaller lift than a from-scratch feature — `POST /api/v1/safety/location` and a single-user Redis cache already existed, but two real gaps (no consent enforcement, no retention) needed fixing regardless of anything else, and the multi-user "who's nearby" query genuinely didn't exist yet.

## What's built (2026-08-26)

- **Consent + retention (WP12.1)**: `consent_records` (existed since the original schema, zero backend references until now) is wired up for real — `backend/src/services/consent.ts` (`getLatestConsent`, `recordConsent`), enforced server-side in `POST /safety/location`. `location_history` gained an `expires_at` column (7-day default, migration `035_location_history_retention.sql`) plus the `user_id`/`expires_at` indexes it never had, and a new standalone `backend/scripts/cleanup-location-history.ts` (same shape as the existing `resolve-sub-areas.ts` cron script) deletes expired rows.
- **Redis GEO presence layer (WP12.2)** — `backend/src/utils/geoPresence.ts`: `upsertPresence`/`findNearby`/`removePresence` built on `ioredis`'s native `GEOADD`/`GEOSEARCH`. This is the actual answer to "track multiple people at once" — every ping is an independent write, a radius query is a single indexed lookup regardless of how many travelers are live. `location:{userId}` (the pre-existing single-key cache) stays the freshness source of truth; the geoset self-heals by dropping any member whose cache already expired.
- **`POST /safety/location/trip-mode`** (new): the actual on/off toggle. On records consent; off records revocation and immediately purges presence (no waiting on the 24h cache TTL).
- **Safety Line auto-location (WP12.3)** — `getCallerLastLocation()` (voiceAgent.ts) and `reverseGeocodeCountry()` (geocoding.ts, same Google Geocoding endpoint `geocodeDestination` already uses) let the agent open a call already knowing the caller's likely country. `agent.ts`'s `createSafetyAgent` takes an optional `knownLocation` param and prepends an explicit "hint to confirm, not a fact" context block — the agent may proactively call `lookup_emergency_number` but must re-confirm if anything the caller says contradicts it. The same location line is appended to the human reviewer's live-transfer page (`pageReviewerForLiveTransfer`).
- **Live proximity matching (WP12.4)** — new `GET /api/v1/members/nearby` in `members.ts`. Deliberately **not** scoped to people with a declared `member_trips` row (an explicit, more-permissive scope decision made with the Executive) — anyone with Trip Mode on is matchable; a declared trip is shown alongside the match when present, not required. Distance is rounded to the nearest whole km before it's ever returned to another member.
- **Frontend Trip Mode toggle (WP12.5)** — `web/src/hooks/useTripMode.web.ts` (watchPosition, throttled client-side to 5 min/250m moved, whichever first) + `web/src/components/TripModeToggle.web.tsx`, rendered in `SafetyScreen.web.tsx`'s Location tab and `WhosGoingPanel.tsx` (which also gained a "Near you now" mode alongside the existing destination search).

## Decisions made with the Executive

- Update throttle: 5 minutes or 250m moved, whichever first (battery/data-friendly; server and client constants match).
- Raw `location_history` retention: 7 days.
- Proximity-matching scope: anyone with Trip Mode on, not just people with a declared trip — the more permissive, more privacy-sensitive option, taken deliberately with distance-rounding as the mitigating safeguard rather than left as an oversight.

## Explicitly out of scope / deferred

- **Native background tracking.** `mobile/` is an empty stub — there is no built React Native app. Web `watchPosition` only runs while the tab is open and foregrounded; it is not, and cannot be made to be, "always on even with the app closed." Trip Mode's own copy says this plainly rather than implying more. True background tracking needs the native app to exist first (iOS "Always" authorization / Android foreground service), each with its own App Store/Play Store review requirements — not started.
- Trusted-contact live map sharing (`safety_contacts.can_see_location` exists as an unused flag — natural future extension of the presence layer).
- Geofenced safety nudges near known higher-risk areas (would need a new risk-zone reference table + `ST_DWithin` — real net-new PostGIS usage).

## Live verification (2026-08-26)

All run against the real production containers on the VPS, using a real seeded QA traveler account (`claude.qa.test@drifttravel.app`) and a second seeded traveler (`jake.morrison@drifttest.com`), test rows deleted afterward:

- **Consent gate**: `POST /safety/location` before Trip Mode → `403 "Location consent required..."`; `POST /safety/location/trip-mode {enabled:true}` → `200`; retried location POST → `201`.
- **Redis GEO layer**: `GEOSEARCH presence:live` returned the posted point; `GET location:{userId}` held the matching cache entry.
- **Live proximity, broadened scope**: with a second traveler (no declared `member_trips` row) posting a point ~1km away, `GET /members/nearby?radius_km=10` correctly returned them with `distance_km: 1` and `destination: null` — confirms the "anyone with Trip Mode on" decision works as designed, not just the safer declared-trip case.
- **Opt-out purge**: `POST /safety/location/trip-mode {enabled:false}` immediately removed both the geoset entry (`GEOPOS` → nil) and the cache key (`GET` → nil), not waiting on the 24h TTL.
- **Retention cleanup**: a manually backdated `location_history` row was correctly deleted by running `cleanup-location-history.ts` by hand; wired into the VPS crontab at `0 3 * * *` (same host-cron pattern as `resolve-sub-areas.ts`, alongside the project's other existing cron jobs, none of which were touched).
- **Safety Line auto-location**: exercised `getCallerLastLocation()` directly against the running backend's compiled code with a real cached Bali point — correctly returned `{countryCode: "ID", countryName: "Indonesia", ...}` via `reverseGeocodeCountry()`, confirming the real Google Geocoding call works end-to-end. (A live phone call through the full LiveKit pipeline was not placed as part of this verification — the isolated function chain it depends on is confirmed working.)
- **Both services type-check clean** (`tsc --noEmit`, backend and web) and restarted without errors after the Docker image rebuild.

## Quality gate
- [x] Direct research against the live repo (schema, routes, Redis client, frontend callers) before any design — confirmed what already existed vs. what was actually missing
- [x] Plan reviewed and approved by the Executive before implementation, including three explicit scope decisions (throttle, retention, matching scope)
- [x] Consent gate + retention fix built and wired into the pre-existing location endpoint
- [x] Redis GEO presence layer built, self-healing against stale cache entries
- [x] Safety Line wired to use last-known location as a confirmable hint, never a blind assumption
- [x] Live proximity endpoint built, distance rounded before ever leaving the server
- [x] Frontend Trip Mode toggle built, copy honest about the web-only foreground constraint
- [x] Migrations applied on production DB and verified (`\d location_history`, `\d consent_records`)
- [x] `tsc` clean build verified before container restart
- [x] Live end-to-end verification: consent gate (403→201), Redis GEOSEARCH, cleanup script, `GET /members/nearby`, and the Safety Line location-lookup chain in isolation
- [x] Cleanup script wired into VPS crontab
- [ ] Privacy Policy update (pre-existing open item — location is the most sensitive data category collected yet)
- [ ] A real end-to-end Safety Line phone call with a cached location present, to confirm the prompt context actually changes model behavior in the live voice pipeline (not just that the data feeding it is correct)
