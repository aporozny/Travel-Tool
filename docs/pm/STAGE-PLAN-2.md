# Stage Plan — Stage 2: Social Proof + Learning Loop

**Approved by Executive:** 2026-07-13 (decision: behaviour may outweigh stated onboarding preferences).

## Work packages

| WP | Description |
|---|---|
| WP2.1 | Community/social-proof signal in ranking from `member_interactions` + `member_saves` (book > review > save > share > view, 90-day window, log-scaled 0–15 pts). Results expose a `community` field for UI ("N travellers saved this"). |
| WP2.2 | Per-user tag affinities computed from interaction history; blended into personal fit at 60/40 behaviour/preferences once a user has ≥5 interactions; pure onboarding prefs before that (cold start). |
| WP2.3 | Migrate place fetching to Places API v1 `searchText` (one call incl. phone/website/summary/photos). Automatic fallback to legacy textsearch when v1 is unavailable on the key. |

## Quality gate
- [x] Build clean, scoring suite extended — 19/19 green
- [x] `score_breakdown` gains keys only (`social`); new `community` field additive
- [x] Deploy via image rebuild; `/health` OK; Lisbon 20 results (regression); Porto fresh-fetch 20 results
- [x] Registers updated; end-stage report below

## Notes
Friend-weighted social proof deferred until a social graph exists (no friends table today).

---

## End-stage report
**Stage 2 closed 2026-07-13 — all products delivered.**

- WP2.1 community signal live: `social` (0–15, log-scaled, 90-day window) in scoring incl. the anonymous path; `community {saves, books}` exposed for UI.
- WP2.2 learning loop live: per-user tag affinities from interaction history; 40/60 preference/behaviour blend for activities after 5+ interactions; dietary requirements protected from dilution (capped +6 bonus only).
- WP2.3 Places API v1 confirmed working on production key (Porto fetch returned phone+website in one call, no fallback triggered). Legacy fallback retained. Issues I6, I7 closed.
- Refactor: triplicated result-mapping in getRecommendations consolidated to one path.
- Next: Stage 3 (Viator bookable tours + commission revenue, Foursquare second source, cross-source dedup per R5).
