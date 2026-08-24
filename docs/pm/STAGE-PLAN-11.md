# Stage Plan — Stage 11: Booking Ecosystem Phase 3 — Stays / Hotels (Duffel)

**Status: search built and verified correct against the real Duffel Stays API shape, but blocked from returning live results -- see "Confirmed blocker" below.**

**Approved by Executive:** 2026-08-20 ("i suggest you review our options and potential benefits we can offer our customers" [Duffel dashboard] → "yes lets get this right from the get go" — same 4-way research rigor as Stage 10).

## Why this stage

Duffel's product catalog extends past flights: Stays (hotels, 1.6M+ properties), Cars (rental, launched April 2026, 40+ brands), ancillaries (bags/seats/CFAR on flights already being built), and loyalty-programme integration. Stays is the standout — same account already working, and a much bigger addressable market than flights alone.

## Key findings (4-way parallel research round)

| Area | Finding |
|---|---|
| **Revenue model** | Genuinely different from flights: Duffel confirmed a real commission-share ("we share that commission with you"), not a Drift-set markup — but the exact rate is sales-gated ("Contact Sales"), and whether Drift can *additionally* layer its own markup on top is unconfirmed. |
| **Compliance — do not assume hotels are lower-risk** | The "commission vs. markup" distinction is a **payment-method choice available identically on both Flights and Stays** (card+commission with Duffel/hotel as merchant-of-record, vs. Balance+markup with Drift as the transacting party) — not an inherent property of the product. All five target states (CA/FL/WA/HI/NV) explicitly name lodging alongside air transportation in their Seller-of-Travel statutes. Even the "never touch the money" path may not avoid "arranging" liability under the broader-definition states. Treat with the **same geographic caution as flights**, not less, until counsel confirms otherwise. |
| **Data architecture** | Opposite of flights' approach: a hotel *is* a real, locatable place, so Stays properties should be matched against `places_cache` using the same `dedup.ts` proximity+name logic Viator activities already use — an independent B&B/guesthouse returned by Duffel could collide with an already-claimed Drift operator listing, and the zero-commission promise needs to extend here too. |
| **Product/UX** | Hotels woven into the existing Explore place-browsing flow (photos/amenities/location visible immediately, dates/guests picked inline on the detail panel) rather than a separate search-first flow — the opposite pattern from flights, justified by hotels actually being a "place" the way a flight route isn't. |
| **Technical** | Real API shape confirmed against the published SDK: `search → fetchAllRates → quotes.create → bookings.create`, full test-mode sandbox with scenario-built test properties (including deliberate failure cases). Cancellation policies are **per-rate, not a standard class** like flight fare rules — the UI has to render each property's actual refund timeline, not assume a shape. |

## What's built (2026-08-24)

Search/browse only, deliberately no booking (quotes/bookings) -- that's still gated on the same two Executive-level inputs as before (commission rate, shared legal review with Flights). Started with a dedicated Stays screen (Andre's call, mirroring how Flights was built) rather than the Explore-integration-with-dedup the original research recommended, so search could be proven live first.

- `backend/utils/duffelClient.ts` (new): the Duffel client singleton, factored out of `flights.ts` so both services share one instance/API key instead of each holding their own.
- `backend/services/stays.ts`: `searchStays()` (geocodes a free-text destination via the *existing* `geocodeDestination()` that already powers Explore, rather than building a second geocoder -- Duffel's search API requires coordinates, not a city string, confirmed against the real `StaysSearchParams` type) and `fetchStaysRates()` (the per-property room/rate detail view). Every field mapped was checked against the installed `@duffel/api` types, not guessed -- caught one real bug this way before it shipped: `fetchAllRates` returns the same `StaysSearchResult` shape as `search()`, so rooms live at `accommodation.rooms`, not a top-level `rooms` (that field is just the requested room *count* echoed back).
- `backend/routes/stays.ts`: `POST /search`, `GET /:searchResultId/rates`, same fail-closed/zod-validated pattern as `flights.ts`.

## Confirmed blocker (2026-08-24)

Tested live against the real Duffel account: `POST https://api.duffel.com/stays/search` returns **403 "This feature is not enabled for your account. Please contact sales to get access."** -- confirmed via two separate raw curl calls, not a transient failure. This moves R12/Stays from "commission rate unconfirmed" to a **hard block**: Stays cannot return any real data until Duffel's sales team turns the feature on for this account, regardless of what code exists. The search/route code above is real and correct (types verified, live-tested against the actual endpoint), it's just pointed at a feature the account doesn't have access to yet.

The 403's response body is plain text, not Duffel's normal `{meta, errors}` JSON envelope -- this also surfaced a real crash bug (I23/L12): the shared `respondToDuffelError()` helper (copied from `flights.ts`) indexed `err.errors[0]` without a null check, and since Duffel's SDK leaves `errors`/`meta` `undefined` for a response it can't parse into its expected shape, this took down the *entire backend process*, not just the one request. Fixed in both `flights.ts` and `stays.ts` with optional chaining plus a fallback message; this exact bug was live (undetected) in the already-shipped Flights checkout too.

## Not yet done

Booking (quotes/bookings) — blocked on the same two Executive-level inputs as before, now compounded by the account-access block above:
1. Duffel needs to enable Stays for this account (contact sales — see the 403 above).
2. Actual commission rate from Duffel sales (changes whether this is worth prioritizing at all).
3. Get Stays and Flights in front of counsel **together, one conversation** — the Seller-of-Travel and payment-architecture questions are shared between the two products, not separate legal reviews.

No frontend UI yet either — held off building the Stays screen itself until account access is confirmed, since there's nothing real to show in it right now.

## Quality gate
- [x] 4-way research complete (technical, data architecture, product/UX, compliance), synthesized and reported
- [x] Search service + route built, types verified against the real installed SDK, tsc clean
- [x] Live-tested against the real Duffel API — confirmed blocked by account-level feature access, not a code bug
- [ ] Duffel Stays enabled for this account (contact sales)
- [ ] Commission rate confirmed with Duffel
- [ ] Legal review (shared with Stage 10)
- [ ] Frontend UI — not started, holding until account access confirmed
