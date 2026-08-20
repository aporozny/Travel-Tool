-- Migration 033: Flight booking via Duffel. Deliberately NOT built on
-- places_cache/bookable_offers (the Viator activities pattern) -- a flight
-- route has no PostGIS-locatable "place," and matchOfferToOperator()'s
-- whole reason to exist (protecting the "zero commission, ever" promise to
-- claimed local operators) doesn't apply to airlines, which are never a
-- Drift-claimed listing. What carries over is the architectural shape --
-- ephemeral offer cache + lazy refresh-on-read + a separate confirmed-
-- booking table -- not the tables themselves.
--
-- Ships inactive: nothing here does anything until DUFFEL_API_KEY is set
-- and the service layer built on top of it is wired in. See STAGE-PLAN-7
-- (Duffel research synthesis) for the full multi-agent research this
-- schema is based on, including the Seller-of-Travel finding that gates
-- which US states this can actually launch to.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Search/offer cache. No fixed TTL -- Duffel returns a per-offer
-- expires_at (often under 20 minutes, sometimes under 2), which is
-- authoritative. A blanket 1-hour TTL like bookable_offers' would happily
-- serve a price that's no longer bookable.
CREATE TABLE IF NOT EXISTS flight_offers_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  search_key TEXT NOT NULL, -- hash of origin/dest/dates/pax/cabin, groups a result set
  duffel_offer_id TEXT NOT NULL,
  duffel_offer_request_id TEXT NOT NULL,
  slices JSONB NOT NULL, -- raw Duffel slices/segments -- not normalized, shape varies too much (one-way/round-trip/multi-city) to justify relational segment rows for cache-only data
  passenger_types JSONB NOT NULL, -- [{type:'adult'}, {type:'child', age:8}, ...]
  cabin_class TEXT,
  base_amount NUMERIC(10,2) NOT NULL,
  base_currency TEXT NOT NULL,
  tax_amount NUMERIC(10,2) NOT NULL,
  total_amount NUMERIC(10,2) NOT NULL, -- Duffel's raw sell price, pre-markup
  total_currency TEXT NOT NULL,
  fare_conditions JSONB, -- refundable/changeable flags, bag allowance
  owner_airline_iata TEXT,
  expires_at TIMESTAMPTZ NOT NULL, -- from Duffel, never computed locally
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_response JSONB NOT NULL, -- full Duffel object, re-verified before order creation rather than trusted stale
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_flight_offers_cache_duffel_id ON flight_offers_cache (duffel_offer_id);
CREATE INDEX IF NOT EXISTS idx_flight_offers_cache_search_key ON flight_offers_cache (search_key);
CREATE INDEX IF NOT EXISTS idx_flight_offers_cache_expires ON flight_offers_cache (expires_at);

-- Markup config. Ships with one placeholder rule (8%, $5-150 cap) -- a
-- real pricing decision, not a technical one, still needs to be made
-- before this is used for anything real. See the insert at the bottom.
CREATE TABLE IF NOT EXISTS markup_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scope TEXT NOT NULL DEFAULT 'global' CHECK (scope IN ('global', 'route', 'cabin_class')),
  route_origin TEXT,
  route_destination TEXT,
  markup_type TEXT NOT NULL CHECK (markup_type IN ('percentage', 'fixed')),
  markup_value NUMERIC(10,4) NOT NULL, -- 0.08 = 8%, or a flat amount if markup_type = 'fixed'
  min_fee NUMERIC(10,2),
  max_fee NUMERIC(10,2),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Confirmed purchase. Deliberately not FK'd to flight_offers_cache -- that
-- row will have long since expired/been purged by the time anyone reads a
-- past order, so the itinerary is frozen into this row's own `slices`.
CREATE TABLE IF NOT EXISTS flight_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  duffel_order_id TEXT NOT NULL,
  source_offer_id TEXT NOT NULL, -- last-known duffel_offer_id, informational only
  booking_reference TEXT NOT NULL, -- airline PNR/locator
  status TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment', 'confirmed', 'ticketed', 'cancelled', 'refunded')),
  slices JSONB NOT NULL, -- frozen itinerary at booking time
  duffel_cost_amount NUMERIC(10,2) NOT NULL, -- what Drift paid Duffel
  duffel_cost_currency TEXT NOT NULL,
  price_charged_amount NUMERIC(10,2) NOT NULL, -- what the traveler paid
  price_charged_currency TEXT NOT NULL,
  markup_amount NUMERIC(10,2) NOT NULL, -- snapshotted at booking time -- later changes to markup_rules must never retroactively alter historical order economics
  markup_rule_id UUID REFERENCES markup_rules(id),
  ticketed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_flight_orders_duffel_id ON flight_orders (duffel_order_id);
CREATE INDEX IF NOT EXISTS idx_flight_orders_user ON flight_orders (user_id);

-- Passenger PII, isolated from flight_orders deliberately -- access
-- control, encryption, and retention policy need to be scoped narrowly to
-- this table alone, not entangled with the booking/audit row. Passport
-- number is encrypted at rest via pgcrypto (pgp_sym_encrypt/decrypt in the
-- service layer, with the symmetric key from an env var, never
-- hardcoded) -- it must never appear in logs, error payloads, or
-- analytics events. Collect it only when an itinerary actually requires
-- it (international routes), not as a blanket field.
CREATE TABLE IF NOT EXISTS flight_order_passengers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flight_order_id UUID NOT NULL REFERENCES flight_orders(id) ON DELETE CASCADE,
  traveler_id UUID REFERENCES travelers(id), -- null if booked for a non-account guest
  duffel_passenger_id TEXT NOT NULL,
  title TEXT,
  given_name TEXT NOT NULL,
  family_name TEXT NOT NULL,
  date_of_birth DATE NOT NULL,
  gender TEXT,
  passport_number_enc BYTEA, -- pgp_sym_encrypt, never plaintext
  passport_country TEXT,
  passport_expiry DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flight_order_passengers_order ON flight_order_passengers (flight_order_id);

-- Airline-initiated schedule changes, cancellations, refunds -- a real,
-- recurring operational surface activities booking never needed, since a
-- Viator tour doesn't reschedule itself. duffel_event_id dedupes webhook
-- retries (Duffel guarantees at-least-once delivery, not exactly-once).
CREATE TABLE IF NOT EXISTS flight_order_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flight_order_id UUID NOT NULL REFERENCES flight_orders(id),
  duffel_event_id TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('schedule_change', 'cancellation', 'refund_requested', 'refund_completed')),
  old_slices JSONB,
  new_slices JSONB,
  refund_amount NUMERIC(10,2),
  refund_currency TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'traveler_notified', 'resolved')),
  payload JSONB NOT NULL, -- raw webhook body, for re-processing if needed
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_flight_order_events_duffel_id ON flight_order_events (duffel_event_id) WHERE duffel_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_flight_order_events_order ON flight_order_events (flight_order_id);

INSERT INTO markup_rules (scope, markup_type, markup_value, min_fee, max_fee, active)
SELECT 'global', 'percentage', 0.08, 5.00, 150.00, TRUE
WHERE NOT EXISTS (SELECT 1 FROM markup_rules);

SELECT 'Migration 033 complete — flight booking schema ready (inactive until DUFFEL_API_KEY is configured)' AS status;
