# Risk Register — Drift Discovery Engine

| ID | Risk | Likelihood | Impact | Response | Owner | Status |
|---|---|---|---|---|---|---|
| R1 | Google Geocoding API not enabled on existing key → geocoding fails | M | M | Code falls back to legacy region-string search; enable API in Google Cloud console if hit | Andre | Open |
| R2 | Google Places cost blowout once app is worldwide (every new city = fresh fetches) | M | H | Coverage threshold + 30-day cache + daily fetch budget (FETCH_DAILY_BUDGET, default 200/day, WP4.2). Billing alert in Google console still recommended | Andre | **Mitigated 2026-07-13** |
| R3 | Changing `score_breakdown` semantics breaks web/mobile UI display | L | M | Keys kept identical; only values reinterpreted; UAT on production after deploy | Claude | Mitigated |
| R4 | Deploy restarts production backend; brief outage for live users | H | L | Deploy in low-traffic window; health check + rollback via git revert + rebuild | Claude | Accepted |
| R5 | places_cache uniqueness is (external_id, source) — multi-source future will create duplicates across sources | H | M | Serve-time fuzzy dedup implemented (dedup.ts: name+150m geo, source-ranked merge) | Claude | **Mitigated 2026-07-13** |
| R6 | Single GOOGLE_PLACES_API_KEY in container env; loss of key = discovery down | L | H | Key documented in DR-RUNBOOK (location, not value); regenerate via Google console | Andre | Open |
| R7 | Postgres data loss (places_cache, member data) | L | H | Nightly `drift-db` dump exists in ~/backups (root cron); verify restore path in DR-RUNBOOK | Andre | Open |
| R8 | Verified-bonus cap reduces operator upsell incentive | M | L | Business decision documented; tier benefits can move to placement (badges, "featured" row) not rank distortion | Andre | Open |

Review at each stage boundary.
