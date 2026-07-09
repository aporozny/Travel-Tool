# Product Descriptions — Drift Discovery Engine

Format per PRINCE2: purpose / composition / quality criteria / quality method.

## P1 — Geocoding service
- **Purpose:** turn any destination string ("Lisbon", "Nusa Penida", "Tirana") into lat/lng + country + canonical name, so no geography is ever hardcoded.
- **Composition:** `backend/src/services/geocoding.ts`; Google Geocoding API; Redis cache (`geo:<dest>`, 90-day TTL); graceful fallback to raw region string when the API fails.
- **Quality criteria:** returns coordinates for any real-world destination; cache hit avoids the API; API failure never breaks search (falls back to legacy ILIKE behaviour).
- **Quality method:** unit test of cache/fallback paths; live query for a non-Bali city.

## P2 — Destination-agnostic Google Places source
- **Purpose:** fetch places for the *requested* destination, not Bali.
- **Composition:** `backend/src/services/googlePlaces.ts` — query built from destination + geocoded `location`/`radius` bias; `country` from geocode, not hardcoded 'Indonesia'.
- **Quality criteria:** searching "restaurants, Lisbon" stores rows with country=Portugal; no literal "Bali Indonesia" remains in the query builder.
- **Quality method:** grep for hardcode (must be absent); live search against production for a new city.

## P3 — Coverage-threshold catalog refresh
- **Purpose:** stop the stale-cache trap where 3 old rows suppress fresh fetches forever.
- **Composition:** `backend/src/services/searchCache.ts` — per-category fresh-row count within destination bounds; below `MIN_COVERAGE` (12) triggers live fan-out; results merged from both cache sources (`google_places_v2` + `google`).
- **Quality criteria:** destination with sparse coverage triggers a fetch; well-covered destination serves from catalog without an API call; both sources appear in results.
- **Quality method:** unit test of the threshold decision; log inspection on production.

## P4 — Category-aware Bayesian scorer
- **Purpose:** trustworthy ranking.
- **Composition:** `backend/src/services/recommendations.ts` — `bayesianRating(rating, count)` (m=50, prior=3.8); dietary scoring applies to food only; accommodation scoring to stays only; activity tags to activities; verified/claimed bonus capped at 8; popularity term `log10(review_count+1)`.
- **Quality criteria:** a 5.0★×1-review place ranks below 4.7★×2000; a dive shop is not scored on vegan tags; verified bonus ≤ 8 points; `score_breakdown` keys unchanged (frontend compatibility).
- **Quality method:** Jest test suite (P5).

## P5 — Scoring test suite
- **Purpose:** lock the ranking behaviour so regressions are caught.
- **Composition:** `backend/src/services/__tests__/scoring.test.ts` covering Bayesian math, category-awareness, bonus cap, and ordering invariants.
- **Quality criteria:** all tests pass in CI-equivalent local run (`npm test`).
- **Quality method:** test run recorded in stage-end report.

## P6 — PM + DR documentation set
- **Purpose:** "if shit happens we can recreate things."
- **Composition:** `docs/pm/` — PID, this file, STAGE-PLAN-1, RISK-REGISTER, QUALITY-REGISTER, ISSUE-REGISTER, LESSONS-LOG, DR-RUNBOOK.
- **Quality criteria:** a competent engineer (or AI session) with repo access + the runbook can rebuild infra and redeploy without other context.
- **Quality method:** Executive review.
