CREATE TABLE IF NOT EXISTS identity_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  traveler_id UUID NOT NULL REFERENCES travelers(id) ON DELETE CASCADE,
  status VARCHAR(50) DEFAULT 'none', -- none|pending|submitted|processing|requires_input|verified|rejected
  provider_session_id VARCHAR(255),
  id_type VARCHAR(50), -- passport|driver_license|id_card
  id_country VARCHAR(2),
  face_match_score NUMERIC(5,2),
  failure_reason TEXT,
  verified_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_identity_verifications_traveler_id ON identity_verifications(traveler_id);
CREATE INDEX idx_identity_verifications_status ON identity_verifications(status);
