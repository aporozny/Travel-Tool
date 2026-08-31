-- Migration 039: bookings has been missing guests/total_amount/currency
-- since it was created -- the code (POST/GET /bookings, all three
-- variants) has always referenced them. Every create or list of an
-- operator booking has been failing with "column does not exist" from
-- day one; nobody had actually exercised this endpoint in production
-- until it was hit live this session. Same pattern as I26
-- (safety_reports.is_anonymous) and I27 (member_messages.connection_id)
-- -- code and schema drifted apart with nothing ever catching it.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS guests INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS total_amount NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'AUD';

SELECT 'Migration 039 complete — bookings has guests/total_amount/currency' AS status;
