-- Migration 036: consent_records has existed since the original schema
-- but had zero backend references (Trip Mode is the first real user).
-- The location endpoint will now query "latest consent row for this
-- user+type" on every ping, so this index isn't optional polish.

CREATE INDEX IF NOT EXISTS idx_consent_records_user_type_created
  ON consent_records(user_id, type, created_at DESC);

SELECT 'Migration 036 complete — consent_records indexed' AS status;
