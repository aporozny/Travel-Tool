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
- [ ] `npm run build` clean
- [ ] `npm test` green (scoring suite)
- [ ] No "Bali Indonesia" literal in source fetch path
- [ ] Production `/health` OK after deploy
- [ ] Live search for a never-fetched city returns results
- [ ] Registers updated; end-stage report below

## Tolerances
Scope fixed (WP1.1–1.6). Time: one working session ±1. Any product blocked → escalate, do not silently drop.

---

## End-stage report
_To be completed at stage close._
