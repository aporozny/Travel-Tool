-- Migration 042: missed check-in detection (see services/safetyMonitor.ts).
-- member_trips already allowed the statuses 'overdue' and 'escalated', but
-- nothing ever set them. These columns make each step happen exactly once.
ALTER TABLE member_trips
  ADD COLUMN IF NOT EXISTS overdue_since TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS overdue_alerted_at TIMESTAMPTZ,     -- reviewer paged about this overdue spell
  ADD COLUMN IF NOT EXISTS escalation_flagged_at TIMESTAMPTZ,  -- reviewer told contacts were NOT auto-messaged
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;           -- emergency contacts were messaged
CREATE INDEX IF NOT EXISTS idx_member_trips_checkin_due ON member_trips (next_checkin_due) WHERE safety_status IN ('active', 'overdue');
SELECT 'Migration 042 complete -- missed check-in tracking ready' AS status;
