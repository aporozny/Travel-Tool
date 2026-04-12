-- Migration 004: Member directory and messaging foundation

-- Add visibility controls to travelers table
ALTER TABLE travelers ADD COLUMN IF NOT EXISTS display_name VARCHAR(100);
ALTER TABLE travelers ADD COLUMN IF NOT EXISTS show_in_directory BOOLEAN DEFAULT true;
ALTER TABLE travelers ADD COLUMN IF NOT EXISTS home_city VARCHAR(100);
ALTER TABLE travelers ADD COLUMN IF NOT EXISTS home_country VARCHAR(100);

-- Member connections / follow system
CREATE TABLE IF NOT EXISTS member_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'blocked')),
  message TEXT, -- optional intro message with connection request
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(requester_id, recipient_id),
  CHECK (requester_id != recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_connections_requester ON member_connections(requester_id);
CREATE INDEX IF NOT EXISTS idx_connections_recipient ON member_connections(recipient_id);
CREATE INDEX IF NOT EXISTS idx_connections_status ON member_connections(status);

-- Direct messages (stub for now - build full messaging later)
CREATE TABLE IF NOT EXISTS member_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES member_connections(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (LENGTH(body) <= 2000),
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (sender_id != recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_sender ON member_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON member_messages(recipient_id);
CREATE INDEX IF NOT EXISTS idx_messages_read ON member_messages(recipient_id, is_read);
CREATE INDEX IF NOT EXISTS idx_messages_connection ON member_messages(connection_id);

-- Trip plans - members can signal where they're going and when
CREATE TABLE IF NOT EXISTS member_trips (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  destination VARCHAR(100) NOT NULL,
  region VARCHAR(100),
  country VARCHAR(50) DEFAULT 'Indonesia',
  start_date DATE,
  end_date DATE,
  travel_style TEXT[], -- solo, couple etc for this specific trip
  looking_for TEXT[], -- travel_buddy, operator_recs, local_tips, diving_buddy
  notes TEXT CHECK (LENGTH(notes) <= 500),
  is_public BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trips_user ON member_trips(user_id);
CREATE INDEX IF NOT EXISTS idx_trips_destination ON member_trips(destination);
CREATE INDEX IF NOT EXISTS idx_trips_dates ON member_trips(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_trips_public ON member_trips(is_public) WHERE is_public = true;

COMMENT ON TABLE member_connections IS 'Member connection requests and status. Messaging only allowed between accepted connections.';
COMMENT ON TABLE member_messages IS 'Direct messages between connected members. Max 2000 chars per message.';
COMMENT ON TABLE member_trips IS 'Upcoming trips members have chosen to make public for community matching.';
