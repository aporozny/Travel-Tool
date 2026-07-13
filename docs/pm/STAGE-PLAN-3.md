# Stage Plan — Stage 3: Bookable Tours + Multi-Source

**Approved by Executive:** 2026-07-13 (Viator partner account created).

## Work packages

| WP | Description |
|---|---|
| WP3.1 | `viator.ts` — Viator Partner API integration: destination resolution (cached), product search per destination, results stored as `source='viator'` places with affiliate `productUrl` as booking link. Env-gated on `VIATOR_API_KEY`; absent key = clean no-op. |
| WP3.2 | `foursquare.ts` — Foursquare Places v3 as second POI source, `source='foursquare'`. Env-gated on `FOURSQUARE_API_KEY`; absent key = clean no-op. |
| WP3.3 | Cross-source dedup (closes R5): normalized-name + geo-proximity (~150m) grouping at serve time; richest source wins per group (claimed > google > foursquare > viator for POIs; viator products are bookable and never collapsed into a POI). |
| WP3.4 | Fan-out wiring in `searchCache.search`: coverage top-up queries Google + Viator + Foursquare in parallel; failures in any one source never break the others. |

## Quality gate
- [x] Build clean; suite extended — 28/28 green
- [x] No-key regression verified: Lisbon/Canggu 20 results, no source errors (2026-07-13)
- [ ] With VIATOR_API_KEY: fresh destination returns bookable tours with affiliate URLs — **awaiting key from Executive**
- [x] Deployed via image rebuild 2026-07-13; health OK

## Dependencies
- `VIATOR_API_KEY` in `backend/.env` (Executive to provide — from viatorpartnerresources.com dashboard)
- `FOURSQUARE_API_KEY` optional; WP3.2 dormant until provided
