-- Migration 029: Bookable offers + bookings (Phase 1: activities only, via
-- Viator -- already partially wired into searchCache.ts's live fetch fan-out,
-- so this rides existing infrastructure rather than a from-scratch provider
-- integration; provider is a CHECK-constrained enum so a second provider
-- like Bokun can be added later without a schema change). Deep-link checkout
-- only -- Drift never touches payment, stays out of PCI scope entirely.
--
-- The one hard constraint this schema exists to enforce: when an offer
-- matches a claimed operator with high confidence, Drift must never earn a
-- commission on it -- the operator's own "zero commission, ever" promise is
-- the whole point. match_status drives routing at the API layer; a
-- match_status = 'operator_match' row is never surfaced as a bookable CTA,
-- only the operator's own contact info is (see services/booking.ts).

CREATE TABLE IF NOT EXISTS bookable_offers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider TEXT NOT NULL CHECK (provider IN ('bokun', 'viator')),
  provider_product_id TEXT NOT NULL,
  place_id UUID REFERENCES places_cache(id) ON DELETE SET NULL,

  -- Denormalized for display -- an offer may not always resolve to an
  -- existing places_cache row (e.g. a Bokun product with no Google match).
  name TEXT NOT NULL,
  region TEXT NOT NULL,
  country TEXT,
  category TEXT NOT NULL DEFAULT 'activity',

  price_amount NUMERIC(10,2),
  price_currency TEXT,
  checkout_url TEXT NOT NULL,

  -- Operator-match routing (see booking.ts for the matching logic, reusing
  -- dedup.ts's normalizeName/metersApart primitives against claimed
  -- places_cache rows). 'ambiguous' fails toward showing the aggregator
  -- offer standalone, never toward silently merging into the operator's
  -- listing -- see docs/pm/ for why that direction of failure is the one
  -- that was actually agreed on.
  match_status TEXT NOT NULL DEFAULT 'no_match'
    CHECK (match_status IN ('operator_match', 'no_match', 'ambiguous')),
  matched_operator_id UUID REFERENCES operators(id),

  raw_data JSONB,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 hour'
);

CREATE INDEX IF NOT EXISTS idx_bookable_offers_place ON bookable_offers (place_id);
CREATE INDEX IF NOT EXISTS idx_bookable_offers_region ON bookable_offers (region, category);
CREATE INDEX IF NOT EXISTS idx_bookable_offers_expires ON bookable_offers (expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookable_offers_provider_product
  ON bookable_offers (provider, provider_product_id);

-- Named provider_bookings, not bookings -- an existing `bookings` table
-- already exists (traveler-to-operator booking *requests*, referenced by
-- reviews.booking_id, a different concept: an inquiry/request record, not
-- a paid third-party transaction). Conflating the two would be wrong, not
-- just a naming clash -- caught this by checking the live schema instead
-- of assuming, exactly the "never guess the schema" rule this project
-- already runs on.
CREATE TABLE IF NOT EXISTS provider_bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  offer_id UUID REFERENCES bookable_offers(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('bokun', 'viator')),
  provider_booking_reference TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,

  amount NUMERIC(10,2) NOT NULL,
  currency TEXT NOT NULL,
  -- Drift's earned fee on this booking. Must be NULL/0 for any booking
  -- whose offer had match_status = 'operator_match' -- enforced in
  -- application code (booking.ts), not just this column existing.
  commission_amount NUMERIC(10,2),

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'cancelled', 'refunded')),
  webhook_payload JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_bookings_provider_ref
  ON provider_bookings (provider, provider_booking_reference);
CREATE INDEX IF NOT EXISTS idx_provider_bookings_user ON provider_bookings (user_id);
CREATE INDEX IF NOT EXISTS idx_provider_bookings_status ON provider_bookings (status);

SELECT 'Migration 029 complete — bookable_offers + provider_bookings ready (Phase 1: activities via Viator)' AS status;
