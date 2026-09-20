-- Migration 040: bookings made through TripGic (flights and hotels).
-- Separate from flight_orders (033), which is Duffel-shaped: it carries a
-- duffel_order_id and a Duffel Payment Intent, neither of which exists for
-- TripGic. TripGic is a prepaid-wallet model -- ticketing/voucher debits
-- Drift's TripGic wallet the full net price, and the traveller pays Drift
-- separately -- so the economics columns here mirror flight_orders
-- (cost / charged / markup, snapshotted at booking time) but the payment
-- side is tracked by payment_status instead of a processor id.
--
-- Passenger documents (passport number/expiry) are deliberately NOT stored:
-- they are passed straight through to TripGic and TripGic keeps them.
-- Only names and dates of birth are kept, in `details`, enough to show the
-- traveller their own booking.

CREATE TABLE IF NOT EXISTS tripgic_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  product_type TEXT NOT NULL CHECK (product_type IN ('flight', 'hotel')),
  -- TripGic's booking_tracking_id from /validate. Unique: it is the
  -- idempotency key -- a double-submitted checkout must never create two
  -- bookings against one quote.
  quote_id TEXT NOT NULL,
  -- general.tracking_id from create-booking; what every later call
  -- (issue-ticket, issue-voucher, cancel, booking-details) is keyed on.
  tripgic_tracking_id TEXT NOT NULL,
  tripgic_booking_id TEXT,      -- human-facing id, e.g. FL2619SEDEAA7L
  supplier_reference TEXT,      -- airline PNR / hotel confirmation number
  status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'ticketed', 'confirmed', 'cancelled', 'expired', 'failed')),
  title TEXT NOT NULL,          -- "SYD -> DPS, 15 Nov" / "Kusuma Resort, 15-18 Nov"
  details JSONB NOT NULL,       -- frozen itinerary or stay + traveller names
  cost_amount NUMERIC(10,2) NOT NULL,           -- what TripGic debits from Drift's wallet
  cost_currency TEXT NOT NULL,
  price_charged_amount NUMERIC(10,2) NOT NULL,  -- what the traveller is charged
  price_charged_currency TEXT NOT NULL,
  markup_amount NUMERIC(10,2) NOT NULL,
  markup_rule_id UUID REFERENCES markup_rules(id),
  -- 'not_collected_sandbox': test booking, traveller was not charged.
  -- 'collected': a real charge cleared before the supplier was called.
  payment_status TEXT NOT NULL CHECK (payment_status IN ('not_collected_sandbox', 'collected')),
  -- Machine code only, never TripGic's raw text (which can include our
  -- wallet balance): 'supplier_funding' | 'supplier_rejected'.
  fulfilment_error TEXT,
  voucher_url TEXT,
  hold_expires_at TIMESTAMPTZ,  -- flight holds auto-cancel same day (NY time)
  fulfilled_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tripgic_orders_quote ON tripgic_orders (quote_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tripgic_orders_tracking ON tripgic_orders (tripgic_tracking_id);
CREATE INDEX IF NOT EXISTS idx_tripgic_orders_user ON tripgic_orders (user_id, created_at DESC);

SELECT 'Migration 040 complete -- tripgic_orders ready' AS status;
