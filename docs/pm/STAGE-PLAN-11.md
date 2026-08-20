# Stage Plan — Stage 11: Booking Ecosystem Phase 3 — Stays / Hotels (Duffel)

**Status: research complete, build not started.**

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

## Not yet done

No schema, no service, no UI. Blocked on two Executive-level inputs before implementation makes sense to start:
1. Actual commission rate from Duffel sales (changes whether this is worth prioritizing at all).
2. Get Stays and Flights in front of counsel **together, one conversation** — the Seller-of-Travel and payment-architecture questions are shared between the two products, not separate legal reviews.

## Quality gate
- [x] 4-way research complete (technical, data architecture, product/UX, compliance), synthesized and reported
- [ ] Commission rate confirmed with Duffel
- [ ] Legal review (shared with Stage 10)
- [ ] Schema, service, UI — not started
