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
| R9 | Seller-of-Travel registration exposure for Duffel flights/hotels bookings (CA/FL/WA/HI/NV register based on customer residence, not company location) | M | H | Legal review required before go-live in those states; no code-level exclusion of any state or region -- explicit Executive instruction | Andre | Open |
| R10 | `GOOGLE_PLACES_API_KEY` exposed in git history (public repo) even after removal from the current `docker-compose.yml` | H | M | Rotate key in Google Cloud Console, add HTTP referrer restrictions | Andre | Open |
| R11 | Voice agent's `offer_contact_bridge` does not perform a live SIP transfer -- caller told a reviewer will follow up, not connected live | L | M | Real transfer is a real LiveKit capability, not yet built; Executive asked to be reminded to revisit | Andre | Open |
| R12 | Duffel Flights/Stays payment architecture -- changes PCI scope and possibly Seller-of-Travel exposure | M | H | Built and live-verified 2026-08-23: Payment Intent -> Balance -> Order, chosen because it's the only Duffel model that lets Drift keep a markup without running its own separate card processor (full reasoning: STAGE-PLAN-10.md WP10.6). Real test booking completed end-to-end on production, confirmation M6UT4V, confirmed in `flight_orders`. Remaining gap: Duffel's Balance payout mechanics (minimum amount, timing, any withdrawal fee) still NOT confirmed -- their payout help article 403'd on every fetch attempt, needs a direct question to Duffel before this carries real (non-test) money, since it determines how/when Drift actually gets its earned margin out | Andre | Open -- payout mechanics unconfirmed |
| R13 | `SAFETY_REVIEWER_EMAIL`/`SAFETY_REVIEWER_PHONE` unset -- voice agent escalations log but page no one | H | H | Set a real reviewer contact | Andre | Open |
| R14 | No Privacy Policy or Terms of Service exist while Drift collects emails, phone numbers, safety-contact info, and voice call transcripts | M | H | Legal review + real ToS/Privacy pages, not a template | Andre | Open |

Review at each stage boundary.
