# Stage Plan — Stage 4: Assembly, Cost Guard & Test Debt

**Approved by Executive:** 2026-07-13 ("keep going while we wait for the API key").

## Work packages

| WP | Description |
|---|---|
| WP4.1 | Diversity assembly (Stage 4 of the Discovery Engine algorithm): recommendations without a category filter interleave stays/eats/activities instead of letting one category flood the top. |
| WP4.2 | Live-fetch budget guard (mitigates R2 cost blowout): Redis daily counter caps external API fan-outs; over budget = catalog-only until midnight, logged loudly. |
| WP4.3 | Retire test debt I9: make `auth.test.ts` / `operators.test.ts` runnable (fixtures/environment), full suite green. |
| WP4.4 | Docs sync: DR-RUNBOOK env-var table gains VIATOR_API_KEY / FOURSQUARE_API_KEY; README pointer to docs/pm/. |

## Quality gate
- [x] Full `npm test` green — 47/47 across 4 suites (first-ever full pass)
- [x] Mixed-category verified live: Canggu limit=9 returned 3 food / 3 accommodation / 3 activity
- [x] Budget guard verified: Faro fan-out incremented fetch-budget counter to 1
- [x] Deployed 2026-07-13; Lisbon 20 results; registers updated

---

## End-stage report
**Stage 4 closed 2026-07-13.**

- WP4.1 diversity assembly live: mixed recommendations round-robin across categories.
- WP4.2 fetch budget guard live (default 200/day, FETCH_DAILY_BUDGET to override; fails open on Redis errors). R2 mitigated.
- WP4.3 test debt retired: root cause was REDIS_URL commented out in .env — host-run tests fell back to the in-container hostname. Fixed with tests/setup-env.ts (test-only defaults); full suite green for the first time. I9 closed.
- WP4.4 DR-RUNBOOK env table updated with VIATOR/FOURSQUARE/FETCH_DAILY_BUDGET.
- Outstanding across project: Viator live verification awaits API key (Stage 3 gate item).
