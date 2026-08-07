# Stage Plan — Stage 6: Booking Ecosystem (Phase 1: Activities)

**Approved by Executive:** 2026-08-07 ("proper travel eco system where we get paid for the things our customers book including airfares").

## Why this stage

Drift's original ask was direct GDS integration (Amadeus + two other major
multi-ticketing providers) so travellers could book flights, hotels, and
activities through the platform with Drift earning revenue on real
bookings.

A multi-agent research round (five independent angles: Amadeus technical,
Sabre/Travelport comparative, legal/compliance, cost/economics,
product/architecture fit — with the two most load-bearing claims
independently re-verified against primary sources) converged on: **don't
pursue direct GDS integration now.**

- Amadeus's self-service API portal was decommissioned July 17, 2026
  (confirmed via multiple independent trade-press sources) — the
  low-friction path a small team would use no longer exists. Remaining
  routes (Enterprise API, Amadeus Quick Connect) are sales-gated.
- All three GDSs (Amadeus/Sabre/Travelport) require IATA/ARC accreditation
  or a host-agency arrangement plus a signed commercial contract before
  API access even begins. Certification-to-production realistically runs
  weeks to months.
- Realistic first-year cost ($15K–35K+, ongoing $10K+/year, none of it
  public/authoritative rate-card pricing) has no revenue base to justify
  it at Drift's current near-zero-revenue, single-operator, tiny-user
  scale.
- GDS booking revenue is structurally a commission/fare-markup model —
  the same shape of "algorithmic result with a hidden incentive" as the
  `% match` score already removed from Explore for contradicting Drift's
  own "no algorithm-ranked, no commission" positioning.
- One legal precedent initially cited (Skiplagged v. American Airlines,
  $9.4M) was checked directly and found to rest on copyright/trademark
  infringement, not Seller-of-Travel or GDS compliance failure — a real
  case, but the wrong legal theory for this specific risk. Flagged as a
  correction, not used to justify the overall recommendation on its own.

**Decision:** build the booking ecosystem via a booking-aggregator layer
instead of direct GDS accreditation — a provider that already holds the
airline/hotel/activity relationships and ticketing accreditation, revenue
share flows back per booking, Drift never becomes an accredited travel
seller itself.

## Provider selection

A second research round (flight-aggregator specialist, hotel/activity
specialist, revenue/brand strategist, data architect, sequencing) plus a
one-round disagreement resolution converged on:

- **Flights, if pursued later:** Duffel — the only evaluated provider with
  true self-service signup, no accreditation burden, a native
  TypeScript/Node SDK matching Drift's stack, transparent per-order
  pricing (~$3/order + 1% managed content + markup Drift sets itself),
  and a realistic 1–3 week integration path.
- **Activities (Phase 1, this stage):** Viator — chosen over Bókun/Rezdy
  once discovered that Viator is *already* partially wired into
  `searchCache.ts`'s live-fetch fan-out (`services/viator.ts` — real
  bookable tour products already land in `places_cache` as
  `source='viator'` rows, with the affiliate checkout link already
  captured in `website`). Riding existing infrastructure instead of a
  from-scratch integration.
- **Hotels/flights:** deferred. Gate for Phase 2 is a real metric
  (click-through-to-booking rate from this Phase 1 slice), not a
  calendar date.

## The one hard constraint (and the disagreement it took two rounds to resolve)

Drift's core promise to operators is "zero commission, ever." The first
architecture draft would have shown a claimed operator's listing with a
"book via Drift partner rate" CTA that still routed through Viator's
checkout — Drift's commission still flowing, just with the UI crediting
the operator's identity. Two independently-reasoning reviewers (revenue/
brand strategy and, after review, the architecture author) both called
this a betrayal of the specific promise made to the operator, not a UX
nit — discovering your own listing was used as camouflage for someone
else's commission is worse than the equivalent problem for a traveller,
because the operator is the party the promise was made *to*.

**Resolution, enforced in code, not just policy:** `toOfferView()` in
`backend/src/services/booking.ts` is the single place this is enforced —
an offer with `match_status = 'operator_match'` never carries a
`checkoutUrl`, full stop, regardless of what else is in the row. The
operator's own contact info (phone/website, pulled from `operators`) is
shown instead. No aggregator checkout ever renders attached to a claimed
operator's identity.

`matchOfferToOperator()` reuses `dedup.ts`'s exact name+proximity matching
(same 150m threshold, same `normalizeName`) rather than inventing a
second, slightly different heuristic — "same venue" means the same thing
everywhere in this codebase. Ambiguous matches fail toward showing the
aggregator offer standalone (visible, reviewable) rather than toward a
silent merge into an operator's listing.

Verified against real seeded data (not just unit tests) through the full
live HTTP path: exact name+proximity match → `operator_match`,
`checkoutUrl: null`; different name nearby → `ambiguous`; same name far
away → `no_match`; no coordinates → `no_match` (fails closed); an offer
already linked to a claimed `places_cache` row via `place_id` → highest-
confidence fast path, `operator_match` even with a mismatched name/
location on the raw offer data.

## Data model

- `bookable_offers` — ephemeral, 1-hour TTL, synced lazily from
  Viator-sourced `places_cache` rows on read (same "cache with a TTL,
  refresh when stale" shape as geocoding/search coverage elsewhere in
  this codebase — no new cron job for v1).
- `provider_bookings` — confirmed purchases. **Named `provider_bookings`,
  not `bookings`** — an existing `bookings` table already exists
  (traveler-to-operator booking *requests*, referenced by
  `reviews.booking_id`, a different concept entirely). Caught by checking
  the live schema instead of assuming, per this project's own "never
  guess the schema" rule.

## Known limitation: no booking confirmation signal yet

Viator's Basic Access tier (instant, no-approval self-service) means the
actual booking transaction happens entirely on Viator's own site — Drift
gets no webhook or confirmation data back at this tier. `provider_bookings`
exists for a future Full + Booking Access tier but is not populated by
anything yet. The only real signal available now is click-through, tracked
via the existing `/recommendations/interact` endpoint (`interaction_type:
'book'`) — which also feeds the personalization scoring system for free.
This is the actual metric behind the Phase 2 gate.

## Quality gate

- [x] Backend: `toOfferView` unit tests (6, including fail-closed cases)
- [x] `matchOfferToOperator` verified against real seeded data through
      the live API — all four match/no-match/ambiguous/fast-path cases
- [x] Zero live-site behavior change while `VIATOR_API_KEY` is unset
- [ ] Real Viator API access (blocked — travel-agent/merchant account
      confirmed to lack API access; affiliate account requested)
- [ ] End-to-end verification against real Viator inventory once the key
      arrives
- [ ] Phase 2 go/no-go based on real click-through data
