-- Migration 035: location_history had no expiry and no index despite a
-- comment in the (unused) schema.sql reference file implying 30-day
-- auto-cleanup existed. It didn't -- the table grew unbounded. This adds
-- a real retention window (7 days -- Trip Mode's continuous pings will
-- generate far more rows per user than the old one-shot "share my
-- location" button ever did) and the missing user_id index (GET
-- /location/history has always filtered on it unindexed).

ALTER TABLE location_history
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days');

CREATE INDEX IF NOT EXISTS idx_location_history_expires_at ON location_history(expires_at);
CREATE INDEX IF NOT EXISTS idx_location_history_user_id ON location_history(user_id);

SELECT 'Migration 035 complete — location_history has expires_at + indexes' AS status;
