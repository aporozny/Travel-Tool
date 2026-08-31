-- Migration 038: user_blocks. No blocking concept existed anywhere in the
-- schema before this -- only reporting (safety_reports). Trip Mode's
-- peer-visibility feature (GET /members/nearby) surfaces strangers by
-- proximity, not just people you've connected with, which is exactly the
-- gap the privacy/terms review punch list flagged (product/engineering
-- item 04): a block affordance, not just a report one.

CREATE TABLE IF NOT EXISTS user_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (blocker_id != blocked_id),
  UNIQUE (blocker_id, blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker ON user_blocks(blocker_id);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_id);

SELECT 'Migration 038 complete — user_blocks created' AS status;
