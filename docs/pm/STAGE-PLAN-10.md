# Stage Plan — Stage 10: Booking Ecosystem Phase 2 — Flights (Duffel)

**Approved by Executive:** 2026-08-19/20 ("start doing a multi agent plan to implement duffel booking ability into the product" → "get started" → "yes" to building the search UI).

## Why this stage

STAGE-PLAN-6 (Phase 1, activities via Viator) already selected Duffel as the flight-booking provider for if/when Drift pursued flights. This stage is that pursuit: a 4-way parallel research round (API/technical, data architecture, product/UX, legal/compliance — mirroring the rigor of the original GDS-vs-aggregator decision), then implementation.

## The one finding that gates everything else

Using Duffel's API to actually create/ticket a booking (not a pure affiliate redirect, the Viator model) likely makes Drift a **Seller of Travel** in CA/FL/WA/HI/NV — these register based on customer residence, not company location. **Explicit Executive instruction: do not exclude any state or region in the code — that decision is the Executive's, not something to bake in unilaterally.** Nothing in this stage's code enforces or excludes any geography.

## Work packages

| WP | Description |
|---|---|
| WP10.1 | Research round: Duffel API surface (test-mode sandbox is free/instant, confirmed real SDK method names against the installed `@duffel/api` package rather than docs), data architecture (deliberately NOT built on `places_cache`/`bookable_offers` — a flight route has no locatable "place" and airlines are never a Drift-claimed local operator, unlike activities), product/UX (contextual entry points from destination pages and Trips, not a standalone "Flights" tab — consistent with Drift's no-algorithm-ranking positioning), compliance (Seller-of-Travel finding above; PCI scope stays light via Duffel's hosted card component). |
| WP10.2 | `033_flights.sql`: `flight_offers_cache` (no fixed TTL — trusts Duffel's own per-offer `expires_at`, often under 20 minutes), `markup_rules` (seeded with one placeholder global rule: 8%, $5–150 cap — a real pricing decision still pending), `flight_orders`, `flight_order_passengers` (passport data isolated, `pgcrypto`-encrypted column), `flight_order_events` (schedule changes/cancellations — a real recurring surface activities never needed). |
| WP10.3 | `services/flights.ts`: `searchFlights()` (real SDK calls, verified against the real installed types — caught two genuine type errors this way: `Offer` isn't re-exported from the top-level `@duffel/api` module, and `CreateOfferRequestSlice` requires `arrival_time`/`departure_time` alongside the obvious fields), `applyMarkup()`, `reverifyOffer()` (re-fetches directly from Duffel immediately before a future booking step, since a cached offer may have expired). `createFlightOrder()` intentionally not built — blocked on the Executive's payment-architecture decision (Duffel's hosted card component vs. Drift handling cards directly), not a technical unknown. |
| WP10.4 | `FlightsScreen.web.tsx` — search form + results list (airline, per-slice times/duration/stops, marked-up price). No booking button: the UI says plainly "Booking isn't available yet" rather than showing a button that would fail or imply a capability that doesn't exist. |
| WP10.5 | Response shape improved to return flattened, display-ready slice data (`FlightSliceView`) instead of raw nested Duffel objects, plus a previously-missing `taxAmount` field, exposed for transparency. |

## Deploy issue found and fixed within this stage

The main `backend/Dockerfile` had the same `scripts/`-copy-before-`npm ci` ordering bug already fixed for `Dockerfile.voiceWorker` in Stage 7 — both share one `package.json`/`postinstall` (`patchAnthropicPlugin.js`), so any stage's `npm ci` needs `scripts/` present first. Only surfaced once this stage's own backend rebuild ran; fixed the same way in both places.

## Quality gate
- [x] Real search verified live against Duffel's sandbox with a real key: LHR→JFK returned 100+ genuine offers across a dozen airlines, correct times/durations/stops, markup correctly applied on top of Duffel's raw pre-markup total
- [x] tsc clean on both backend and frontend, 79/79 backend tests passing, production build clean
- [ ] Payment architecture decision (Executive) — gates checkout/order-creation
- [ ] Seller-of-Travel legal review (Executive + counsel) — gates go-live regardless of geography chosen
- [ ] Markup rate is still the placeholder (8%, $5–150 cap) — real pricing decision pending
