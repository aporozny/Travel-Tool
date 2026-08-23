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
| WP10.3 | `services/flights.ts`: `searchFlights()` (real SDK calls, verified against the real installed types — caught two genuine type errors this way: `Offer` isn't re-exported from the top-level `@duffel/api` module, and `CreateOfferRequestSlice` requires `arrival_time`/`departure_time` alongside the obvious fields), `applyMarkup()`, `reverifyOffer()` (re-fetches directly from Duffel immediately before a future booking step, since a cached offer may have expired). |
| WP10.4 | `FlightsScreen.web.tsx` — search form + results list (airline, per-slice times/duration/stops, marked-up price). |
| WP10.5 | Response shape improved to return flattened, display-ready slice data (`FlightSliceView`) instead of raw nested Duffel objects, plus a previously-missing `taxAmount` field, exposed for transparency. |
| WP10.6 | **Checkout built** (2026-08-22/23): payment-architecture question resolved by reading Duffel's docs directly (see RISK-REGISTER.md R12) rather than waiting on a spec that didn't exist yet — Payment Intent → Balance → Order is the only one of Duffel's three payment models that both lets Drift keep a markup and avoids Drift needing its own separate card processor. `034_flight_checkout.sql` adds `flight_orders.payment_intent_id`; `createCheckoutPaymentIntent`/`confirmCheckoutPaymentIntent`/`createFlightOrder` added to the service; `POST /payment-intents`, `/payment-intents/confirm`, `/orders` added to the route. Frontend checkout modal uses `@duffel/components`' `DuffelPayments` (not `DuffelCardForm` — that one wants a JWT `clientKey`, not a Payment Intent `client_token`; discovered live, not from docs). Duffel API errors (expired fare, an offer already booked from the same search) now surface their real message instead of a generic 500. |
| WP10.7 | Fixed a real performance bug caught live: `searchFlights()` was re-querying the same global markup rule once per offer and writing each offer to cache sequentially — ~20s per search in production (confirmed in logs: two real attempts at 19.9s/20.9s that looked broken but had actually succeeded). Fetches the rule once, writes offers to cache concurrently; same searches now ~1–1.4s. |
| WP10.8 | Fixed three more real gaps Andre hit while testing checkout live: no one-way search (only a small "(optional)" label distinguished Return from Departure — added an explicit Round trip/One way toggle that removes the Return field from the DOM entirely on One way); Duffel API validation errors (an offer already booked from the same search, an expired fare) surfaced as a blank "Internal server error" instead of Duffel's own actionable message; and no way to see a booking again after the confirmation banner closed — added `GET /flights/orders` + a "Your bookings" list on the Flights screen. |

## Deploy issue found and fixed within this stage

The main `backend/Dockerfile` had the same `scripts/`-copy-before-`npm ci` ordering bug already fixed for `Dockerfile.voiceWorker` in Stage 7 — both share one `package.json`/`postinstall` (`patchAnthropicPlugin.js`), so any stage's `npm ci` needs `scripts/` present first. Only surfaced once this stage's own backend rebuild ran; fixed the same way in both places.

## Quality gate
- [x] Real search verified live against Duffel's sandbox with a real key: LHR→JFK returned 100+ genuine offers across a dozen airlines, correct times/durations/stops, markup correctly applied on top of Duffel's raw pre-markup total
- [x] tsc clean on both backend and frontend, 79/79 backend tests passing, production build clean
- [x] **Full checkout verified live end-to-end 2026-08-23**: real test booking completed by Andre on production, confirmation code **M6UT4V**, confirmed present in `flight_orders` with `status = 'confirmed'`. Search → Payment Intent → Stripe test card charge → Duffel Balance debit → order creation, all real, all working.
- [ ] Seller-of-Travel legal review (Executive + counsel) — gates go-live regardless of geography chosen
- [ ] Markup rate is still the placeholder (8%, $5–150 cap) — real pricing decision pending
- [ ] Duffel Balance payout mechanics (minimum payout, timing, any withdrawal fee) unconfirmed — their payout help article 403'd on fetch; needs a direct question to Duffel before this can carry real customer money
