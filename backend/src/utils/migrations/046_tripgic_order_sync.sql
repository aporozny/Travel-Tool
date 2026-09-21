-- Migration 046: keep TripGic bookings in step with TripGic (found by the test-plan pass).
--
-- The only code that re-read a booking from TripGic ran from one route that no screen calls, so a
-- held booking said "Reserved" for ever: a moved deadline, a ticket issued later, or a cancellation
-- by the supplier were never noticed, and 9 test bookings sat "held" (some long past their
-- deadline). A background job now refreshes them; these columns support it.
ALTER TABLE tripgic_orders
  ADD COLUMN IF NOT EXISTS last_synced_at   TIMESTAMPTZ,  -- last successful read of the booking at TripGic
  ADD COLUMN IF NOT EXISTS supplier_status  TEXT,         -- "booking_status/ticket_status" exactly as TripGic last reported it
  ADD COLUMN IF NOT EXISTS owner_alerted_at TIMESTAMPTZ;  -- the owner has been told this booking needs a person

-- The job looks at open (held) bookings, least recently checked first.
CREATE INDEX IF NOT EXISTS idx_tripgic_orders_held_sync
  ON tripgic_orders (last_synced_at NULLS FIRST) WHERE status = 'held';

SELECT 'Migration 046 complete -- TripGic order sync columns ready' AS status;
