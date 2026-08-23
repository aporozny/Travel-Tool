# Issue Register — Drift Discovery Engine

| ID | Date | Type | Description | Priority | Status | Resolution |
|---|---|---|---|---|---|---|
| I1 | 2026-07-08 | Off-spec | `googlePlaces.ts` hardcodes "Bali Indonesia" in every query | Critical | **Closed 2026-07-10** | WP1.3 |
| I2 | 2026-07-08 | Off-spec | Stale-cache trap: any catalog rows suppress live fetch | High | **Closed 2026-07-10** | WP1.4 |
| I3 | 2026-07-08 | Off-spec | Raw average rating ignores review volume | High | **Closed 2026-07-10** | WP1.5 |
| I4 | 2026-07-08 | Off-spec | Verified bonus is 20pts while code comment says +5 | High | **Closed 2026-07-10** | WP1.5 |
| I5 | 2026-07-08 | Off-spec | Dietary/accommodation scoring applied across all categories | Medium | **Closed 2026-07-10** | WP1.5 |
| I6 | 2026-07-08 | Concern | `member_interactions` tracked but unused in ranking | Medium | **Closed 2026-07-13** | WP2.2 |
| I7 | 2026-07-08 | Concern | Legacy Places API; v1 gives details in one call | Medium | **Closed 2026-07-13** | WP2.3 |
| I8 | 2026-07-08 | Concern | Single data source (Google); no tours inventory / no revenue hook | Medium | **Code complete 2026-07-13** | WP3.1-3.4; live once VIATOR_API_KEY added |
| I9 | 2026-07-10 | Concern | Pre-existing test failures in auth/operators suites (15/15 fail at HEAD; unrelated to Stage 1) | Medium | **Closed 2026-07-13** | tests/setup-env.ts (WP4.3) |
| I10 | 2026-07-10 | Concern | Root-owned files recur across repo (.env, dist/) — blocked builds twice this stage | Medium | Open | chown applied; watch for recurrence |
| I11 | 2026-08-19 | Security | `JWT_REFRESH_SECRET` hardcoded as the literal placeholder string in `docker-compose.yml`, in this repo's public GitHub -- live signing secret for every refresh token, readable by anyone | Critical | **Closed 2026-08-19** | WP8.1 |
| I12 | 2026-08-19 | Security | CORS silently allowed any origin -- code reads `FRONTEND_URL`, only `APP_URL` was set in production | Critical | **Closed 2026-08-19** | WP8.2 |
| I13 | 2026-08-19 | Security | `GOOGLE_PLACES_API_KEY` hardcoded in the same public `docker-compose.yml` | High | Open -- moved to `${VAR}`, but the exposed value itself still needs rotation in Google Cloud Console | WP8.3 |
| I14 | 2026-08-19 | Concern | `.env.bak.*` file (real secrets) sitting in repo root, untracked but not gitignored -- one `git add -A` from exposure. Origin unknown, not created by this project's own history | High | **Closed 2026-08-19** | WP8.4 |
| I15 | 2026-08-19 | Off-spec | No password reset flow existed at all -- a forgotten password meant permanent lockout | Medium | **Closed 2026-08-19** | WP8.5 |
| I16 | 2026-08-09 | Off-spec | `emergency_numbers` table referenced by an existing route, but its migration (007) had never been applied -- endpoint had been silently 500ing since it was written | Medium | **Closed 2026-08-09** | WP7.2 |
| I17 | 2026-08-19 | Concern | Trips and Flights backends were built and fully API-tested but had zero frontend UI -- invisible in the actual app | Medium | **Closed 2026-08-20** | WP9.3, WP10.4 |
| I18 | 2026-08-16 | Off-spec | `@livekit/agents-plugin-anthropic` silently engages Claude's extended thinking whenever tools are attached, even unrequested -- measured ~63% latency cost, no documented way to disable | High | **Closed 2026-08-20** | WP7.6 |
| I19 | 2026-08-20 | Off-spec | Docker `scripts/` copy-order bug: `postinstall` needs `scripts/` present before `npm ci`, but it was only copied in afterward -- found in `Dockerfile.voiceWorker`, then found again (same shared `package.json`) in the main backend `Dockerfile` | Medium | **Closed 2026-08-20** | WP7.4, WP10 |
| I20 | 2026-08-23 | Off-spec | `searchFlights()` re-fetched the same global markup rule from the DB once per offer and wrote each offer to cache sequentially -- ~20s per search in production, confirmed in logs from two real user attempts (19.9s/20.9s) that had actually succeeded but looked broken from the latency alone | High | **Closed 2026-08-23** | WP10.7 |
| I21 | 2026-08-23 | Off-spec | Duffel API validation errors (expired fare, an offer already booked from the same search) surfaced to the traveler as a blank "Internal server error" instead of Duffel's own clear, actionable message | Medium | **Closed 2026-08-23** | WP10.6 |
