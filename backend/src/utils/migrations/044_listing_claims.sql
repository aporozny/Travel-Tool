-- Migration 044: make listing claims work (found by the live test-plan check, 21 Sep 2026).
--
-- listing_claims only had (id, place_id, user_id, status, created_at), but every claim
-- route reads and writes operator_id, evidence, contact details and the review columns,
-- so submitting, listing, approving and the admin queue all returned 500. The table is
-- empty (0 rows), so tightening it is safe.
ALTER TABLE listing_claims
  ADD COLUMN IF NOT EXISTS operator_id   UUID REFERENCES operators(id),
  ADD COLUMN IF NOT EXISTS evidence      TEXT,
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by   UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at   TIMESTAMPTZ;

ALTER TABLE listing_claims DROP CONSTRAINT IF EXISTS listing_claims_status_check;
ALTER TABLE listing_claims ADD CONSTRAINT listing_claims_status_check
  CHECK (status IN ('pending', 'approved', 'rejected'));

-- One pending claim per operator per listing, enforced by the database so two
-- simultaneous submissions cannot both get in.
CREATE UNIQUE INDEX IF NOT EXISTS uq_listing_claims_pending
  ON listing_claims (place_id, operator_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_listing_claims_operator ON listing_claims (operator_id);
CREATE INDEX IF NOT EXISTS idx_listing_claims_place    ON listing_claims (place_id);

-- The trust badge endpoint 404s for an operator with no score row. The two operators
-- that are already verified never got one; give them the same starting score an
-- approved claim now creates (identity 100 + safety record 100 = composite 40, "verified").
INSERT INTO operator_trust_scores (operator_id, score_identity, composite_score, trust_tier)
SELECT o.id, 100, 40, 'verified'
FROM operators o
WHERE o.is_verified
  AND NOT EXISTS (SELECT 1 FROM operator_trust_scores s WHERE s.operator_id = o.id);

SELECT 'Migration 044 complete -- listing claims ready' AS status;
