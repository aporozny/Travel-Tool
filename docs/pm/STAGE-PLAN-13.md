# Stage Plan — Stage 13: Member-Sourced Places — let travelers add real places into search, verified by corroboration

**Status: built, deployed, and live-verified.**

**Approved by Executive:** 2026-08-29 ("the more users we get and the more blog postings they put up of their trip, the more quality control we have over accuracy of recommendations" → "yes" to planning it properly, same process as Stage 12).

## Why this stage

Drift's entire pitch is community-vetted discovery over algorithm/pay-to-rank — but the searchable catalog was, until this stage, 100% external. Direct research on the live repo found: every one of the ~2,570 rows in `places_cache` came from Google; `community_posts` already had a `place_id` column but `POST /community/posts` only ever accepted a reference to an *existing* catalog row; and — the actual blocker — `queryCatalog()`, `discovery.ts` (×2), and `recommendations.ts` all hardcoded `pc.source IN ('google_places_v2', 'google', 'foursquare', 'viator')`, meaning a member-sourced row would have been structurally invisible to every search/Explore/recommendation surface even if one existed.

## What's built (2026-08-29)

- **Schema (WP13.1)** — migration `037_member_places.sql`: `places_cache.submitted_by` (who added it) and `safety_reports.reported_place_cache_id` (lets the existing community-reporting system target a place, the abuse backstop for places being visible immediately rather than gated behind review).
- **Resolve-or-create at write time (WP13.2)** — `backend/src/services/memberPlaces.ts`, new `resolveOrCreatePlace()`. Reuses `dedup.ts`'s existing fuzzy-match logic (`sameVenue`, exported for this purpose, same name+150m-radius matching already proven for cross-source Google/Foursquare dedup) to check candidates in the same region before creating anything new. A match links the post to the existing row (this is the corroboration signal); no match creates a new `source = 'member'` row, gated by a 5-new-places/day rate limit per user (matching never counts against the limit). New rows get `sub_area_id = NULL` and are picked up by the existing nightly `resolve-sub-areas.ts` cron automatically — no changes needed there.
- **`POST /community/posts` extended (WP13.2)** — accepts a `newPlace: {name, lat, lng, category}` alongside the existing `placeId`, resolved via the above before the post itself is inserted, in the same transaction.
- **The four hardcoded source lists unlocked (WP13.3)** — `'member'` added to the `source IN (...)` clause in `searchCache.ts`, `discovery.ts` (×2), `recommendations.ts`. This is the change that actually makes member places searchable/recommendable.
- **Corroboration as a trust signal (WP13.4)** — `scoreOperator()` takes a `postAuthorCount` param and adds a capped bonus (`min(5, (count-1)*2)`) when 2+ distinct travelers have posted about the same place, computed on the fly via `COUNT(DISTINCT community_posts.author_id)` rather than a denormalized counter.
- **Frontend (WP13.5)** — `CommunityScreen.web.tsx`'s `ComposeModal` gained a place-tagging step: search-as-you-type against the existing `GET /api/v1/search` (no new endpoint), plus a "Can't find it? Add the place" fallback (name, category, and an address lookup via a new thin `GET /api/v1/search/geocode` route wrapping the already-built `geocodeDestination()` — no new Google key/quota).

## Decisions made with the Executive

- New member-submitted places are **visible in search immediately**, not gated behind review or a corroboration threshold — matches Drift's no-gatekeeping positioning. Trust is reflected in ranking, not visibility.
- V1 entry point is the **trip/blog post composer only**, not a separate "add a place" flow inside Explore/search itself.

## Explicitly out of scope for v1

- A parallel "add a place" entry point inside Explore/search itself.
- Any corroboration threshold gating visibility.
- Admin moderation tooling beyond the existing report-a-place capability (no new admin dashboard).

## Live verification (2026-08-29)

All run against real production containers on the VPS, using the existing seeded QA accounts (`claude.qa.test@drifttravel.app`, `jake.morrison@drifttest.com`), test rows deleted afterward:

- **New place creation**: `resolveOrCreatePlace()` for a genuinely new venue correctly created a `places_cache` row with `source='member'`, `submitted_by` set.
- **Corroboration match**: the same call from a second, different author correctly returned the *same* place id instead of duplicating.
- **Search visibility**: the member-sourced place was confirmed present in real `search()` results with `source: 'member'` — proves the Phase 3 source-list fix actually works, not just that the row exists.
- **Scoring**: `scoreOperator()` confirmed `corroboration: 0` at 0/1 authors, `corroboration: 2` at 2 distinct authors, via the real function.
- **Full query path**: the exact SQL pattern used in `recommendations.ts` (place + `COUNT(DISTINCT author_id)` subquery) run directly against the live DB, correctly ranked the 2-author test place above 0-author real catalog places in the same region.
- **Rate limit**: 4 more genuinely-new submissions from the same user succeeded (bringing the day's total to 5); the 6th was correctly rejected with a clear message.
- **Report-a-place**: `safety_reports` insert against `reported_place_cache_id` confirmed working without touching the existing traveler/operator report paths.
- Both backend and web `tsc --noEmit` clean; web bundle rebuilt via `npm run build` (nginx serves `web/dist` directly, no container); backend container rebuilt and restarted without errors.

## Incidental finding + fix during this stage: R10 (Google API key rotation) resolved

While deploying, discovered the rotation attempted earlier had created the new key in the wrong Google Cloud project ("Drift Travel" — confirmed via its Metrics dashboard showing **zero requests ever**, over 30 days). The actual production traffic has been running through a different project ("Openclaw") the whole time, under an old, unrestricted 33-API key created back in April — the exact R10 exposure this rotation was meant to fix. A new key was created in the correct project, restricted to Geocoding API + Places API + the VPS's IP address, live-tested against both APIs (`STATUS: OK` on Geocoding, real results from Places (New)), and deployed. **Follow-up still open**: delete the old unrestricted "Maps Platform API Key" (33 APIs) in the Openclaw project once the new key's stability is confirmed over a few days.

## Self-review pass, same day (2026-08-29)

Reviewed the just-shipped diff for correctness before calling this done. Found and fixed three real issues:
- `enrichPlace()` was firing on every member-place detail view, calling Google Place Details with the synthetic `member:<uuid>` external_id -- a call that can never succeed, burns real quota, and logged an error every time. Guarded against `source === 'member'` in `search.ts`.
- `POST /community/posts` accepted `newPlace` with no `region`, which would have created a `places_cache` row search/discovery could never meaningfully filter by. Now requires a region when adding a new place.
- The compose modal silently swallowed any non-429 error from the post endpoint -- a user hitting the new region validation (or any other 400) would have seen nothing happen at all. Now surfaces the actual server message.

Verified live: confirmed no enrich/error log line fires for a member place detail view after the fix. Committed separately (`5dbc070`).

## Quality gate
- [x] Direct research against the live repo (schema, routes, the four hardcoded source lists, existing dedup/sub-area/claim infrastructure) before any design
- [x] Plan reviewed and approved by the Executive before implementation, including two explicit scope decisions (visibility, entry point)
- [x] Resolve-or-create logic built and reuses existing fuzzy-match/sub-area/claim infrastructure rather than duplicating it
- [x] All four hardcoded source-list call sites updated consistently
- [x] Corroboration scoring built and verified against the real function
- [x] Frontend place-tagging UI built (search-existing + add-new fallback)
- [x] Live end-to-end verification: new-place creation, corroboration match, search visibility, scoring, rate limit, report-a-place
- [x] `tsc` clean on both backend and web before deploy
- [x] R10 (Google API key rotation) resolved as an incidental fix during this stage
- [ ] Delete the old unrestricted "Maps Platform API Key" in the Openclaw project (follow-up, not blocking)
