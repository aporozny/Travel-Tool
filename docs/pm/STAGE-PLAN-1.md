# Stage Plan — Stage 1: Worldwide Discovery + Honest Scoring

**Stage objective:** Drift discovery works for any destination with trustworthy ranking; everything documented and tested.

## Work packages

| WP | Product | Description | Sequence |
|---|---|---|---|
| WP1.1 | P6 | PM documentation set (this directory) | 1 |
| WP1.2 | P1 | `geocoding.ts` — Google Geocoding + Redis cache + fallback | 2 |
| WP1.3 | P2 | De-Bali `googlePlaces.ts`; location-biased queries; dynamic country | 3 |
| WP1.4 | P3 | Coverage-threshold refresh + dual-source catalog reads in `searchCache.ts` | 4 |
| WP1.5 | P4+P5 | Bayesian, category-aware scorer + Jest tests | 5 |
| WP1.6 | — | Typecheck, test run, atomic commits, deploy, live verification | 6 |

## Quality checks (gate to close stage)
- [x] `npm run build` clean
- [x] `npm test` green (scoring suite) — 12/12
- [x] No "Bali Indonesia" literal in source fetch path
- [x] Production `/health` OK after deploy
- [x] Live search for a never-fetched city returns results (Lisbon: 20, country=Portugal)
- [x] Registers updated; end-stage report below

## Tolerances
Scope fixed (WP1.1–1.6). Time: one working session ±1. Any product blocked → escalate, do not silently drop.

---

## End-stage report
**Stage 1 closed 2026-07-10 — all products delivered.**

- P1–P5 implemented, tested (12/12 scoring tests), deployed to production via image rebuild.
- E2E verified: Lisbon (never-fetched) returns 20 restaurants with country=Portugal; Bali regression clean (20 results); drifttravel.app HTTP 200.
- Issues I1–I5 closed. New: I9 (pre-existing test debt), I10 (root-owned file recurrence).
- Deviations: none of scope; one extra fix (plural/singular query matching in catalog reads) found during live verification and included in WP1.4.
- Recommendation: proceed to Stage 2 (social-proof ranking + interaction learning loop) after Executive review of registers.
