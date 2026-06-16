CREATE TABLE IF NOT EXISTS waitlist (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             TEXT NOT NULL UNIQUE,
  name              TEXT,
  source            TEXT DEFAULT 'direct',
  note              TEXT,
  status            TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','approved','invited','joined')),
  invite_token      TEXT UNIQUE,
  invite_expires_at TIMESTAMPTZ,
  invite_used_at    TIMESTAMPTZ,
  approved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist(email);
CREATE INDEX IF NOT EXISTS idx_waitlist_status ON waitlist(status);
CREATE INDEX IF NOT EXISTS idx_waitlist_token ON waitlist(invite_token);
ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_token_used TEXT;
SELECT 'Migration 022 complete' AS status;
