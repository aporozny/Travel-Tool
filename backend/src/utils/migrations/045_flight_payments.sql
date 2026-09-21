-- Migration 045: a ledger of Duffel card payments (found by the test-plan pass, D-E-4).
--
-- Before this, the server never recorded a payment. The browser held the only link
-- between "the traveller paid" and "place the order", and POST /flights/orders never
-- checked the payment at all (it trusted whatever paymentIntentId the caller sent),
-- while the order itself is paid from Drift's own Duffel Balance. So:
--   * a payment whose order step failed left the traveller charged with no booking,
--     no record on our side, and no way to retry;
--   * once the Duffel key is live, anyone could have called /orders with a made-up
--     payment id and been booked at Drift's expense.
-- Every payment intent is now recorded here when it is created, and an order can only
-- be placed for a payment that is recorded, belongs to that user, is for that offer,
-- has been confirmed as paid, and has not already been used.
CREATE TABLE IF NOT EXISTS flight_payments (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  duffel_payment_intent_id TEXT NOT NULL UNIQUE,
  user_id                  UUID NOT NULL REFERENCES users(id),
  duffel_offer_id          TEXT NOT NULL,
  summary                  TEXT,                       -- "SYD to DPS, 15 Nov" for messages
  amount                   NUMERIC(10,2) NOT NULL,     -- what the card is charged (marked-up total)
  currency                 TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'paid', 'ordering', 'ordered', 'order_failed', 'refund_requested', 'refunded')),
  passengers               JSONB,                      -- kept only until the order exists, so a retry needs no re-typing
  flight_order_id          UUID REFERENCES flight_orders(id),
  duffel_order_id          TEXT,
  attempts                 INT NOT NULL DEFAULT 0,
  last_error               TEXT,
  error_code               TEXT,
  retryable                BOOLEAN,
  is_test                  BOOLEAN NOT NULL DEFAULT false,
  alerted_at               TIMESTAMPTZ,                -- the owner has been told about this payment
  reconciled_at            TIMESTAMPTZ,                -- a stale 'created' row has been checked against Duffel once
  paid_at                  TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flight_payments_user ON flight_payments (user_id, created_at DESC);
-- The reconciler only ever looks at payments that are not finished.
CREATE INDEX IF NOT EXISTS idx_flight_payments_open ON flight_payments (updated_at)
  WHERE status IN ('created', 'paid', 'ordering', 'order_failed');

-- One order per payment, enforced by the database (a double click or a retry that races
-- cannot book twice). Existing rows have no duplicates (checked before this migration).
CREATE UNIQUE INDEX IF NOT EXISTS uq_flight_orders_payment_intent
  ON flight_orders (payment_intent_id) WHERE payment_intent_id IS NOT NULL;

SELECT 'Migration 045 complete -- flight payment ledger ready' AS status;
