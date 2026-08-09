-- Migration 031: allow sos_events.user_id to be NULL.
--
-- Every prior trigger_type ('button') came from an authenticated in-app
-- action, so user_id was always known and NOT NULL was correct at the time.
-- The Safety Line voice agent breaks that assumption: the approved workflow
-- (voice_agent_workflow.md) explicitly treats an unregistered or borrowed
-- phone calling in as a real scenario, not an edge case, for someone in
-- distress -- and the whole point of trigger_type='voice_call' is that an
-- sos_events row (and the SSE stream / human-resolve flow it powers) must
-- exist even when there is no user account to attach it to.
--
-- Existing rows are unaffected -- this only relaxes the constraint for
-- future inserts.

ALTER TABLE sos_events ALTER COLUMN user_id DROP NOT NULL;

SELECT 'Migration 031 complete — sos_events.user_id nullable for unidentified voice-call SOS events' AS status;
