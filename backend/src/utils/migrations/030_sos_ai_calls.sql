-- Migration 030: Voice agent for the Drift Safety Line (inbound distress
-- calls). See docs/pm/STAGE-PLAN-7.md for the full workflow/script and the
-- non-negotiable rule this schema exists to support: the AI never marks a
-- case resolved -- only a human (the traveler themselves, or a reviewer)
-- can close an sos_events row. A call can only ever move it toward
-- 'escalated'/monitoring, never toward resolved_at/false_alarm_at.
--
-- Every inbound call to the safety line gets (or creates) an sos_events
-- row -- trigger_type = 'voice_call' -- rather than a parallel tracking
-- system, so the existing SSE stream, location pings, and human-resolve
-- flow all apply uniformly regardless of whether someone pressed the
-- app's SOS button or called in directly.

CREATE TABLE IF NOT EXISTS sos_ai_calls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sos_event_id UUID NOT NULL REFERENCES sos_events(id) ON DELETE CASCADE,

  -- Caller identification -- may not resolve to a registered user (calling
  -- from an unregistered/borrowed phone is a real scenario, not an edge
  -- case, for someone in distress).
  caller_phone TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,

  platform TEXT NOT NULL DEFAULT 'retell',
  platform_call_id TEXT,

  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,

  -- Transcript, not raw audio, by default -- per the regulatory research,
  -- crisis-adjacent recordings should never be retained/reused beyond what
  -- this specific case needs. Raw audio (if ever needed for a genuine
  -- dispute/review) is a deliberate separate decision, not a default.
  transcript TEXT,

  ai_outcome TEXT CHECK (ai_outcome IN (
    'genuine_emergency', 'distressed_relayed', 'false_alarm', 'unclear_escalated'
  )),
  -- The real local number the AI actually gave the caller, so this is
  -- auditable after the fact -- never left to "the AI probably said
  -- something reasonable".
  emergency_number_given TEXT,
  country_code_used TEXT,

  human_notified_at TIMESTAMPTZ,
  contact_bridge_attempted BOOLEAN NOT NULL DEFAULT FALSE,
  contact_bridge_connected BOOLEAN NOT NULL DEFAULT FALSE,

  raw_webhook_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sos_ai_calls_sos_event ON sos_ai_calls (sos_event_id);
CREATE INDEX IF NOT EXISTS idx_sos_ai_calls_user ON sos_ai_calls (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sos_ai_calls_platform_call
  ON sos_ai_calls (platform, platform_call_id) WHERE platform_call_id IS NOT NULL;

SELECT 'Migration 030 complete — sos_ai_calls ready (Safety Line voice agent, inactive until a telephony/voice AI key is configured)' AS status;
