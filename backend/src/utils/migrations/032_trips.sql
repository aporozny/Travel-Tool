-- Migration 032: Owner-curated trips travelers can RSVP to. Distinct from
-- community_posts (free-form traveler posts about their own trips, already
-- built) -- this is the owner inviting travelers to join a specific trip,
-- with an actual capacity/RSVP model rather than just a post.

CREATE TABLE IF NOT EXISTS trips (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_by UUID NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  destination TEXT,
  region TEXT,
  country TEXT,
  start_date DATE,
  end_date DATE,
  -- NULL = unlimited spots.
  capacity INTEGER,
  cover_image_url TEXT,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trip_rsvps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'waitlisted' when capacity is full at RSVP time -- promoted to
  -- 'confirmed' automatically if a confirmed spot opens up (cancellation).
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'waitlisted', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (trip_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_trips_status ON trips (status);
CREATE INDEX IF NOT EXISTS idx_trip_rsvps_trip ON trip_rsvps (trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_rsvps_user ON trip_rsvps (user_id);

SELECT 'Migration 032 complete — trips + trip_rsvps ready' AS status;
