-- Create trips table (for accommodation anchoring + check-in scheduling)
CREATE TABLE trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  traveler_id UUID NOT NULL REFERENCES travelers(id) ON DELETE CASCADE,
  destination VARCHAR(255) NOT NULL,
  region VARCHAR(100) NOT NULL,
  accommodation_name VARCHAR(255),
  accommodation_lat NUMERIC(10, 8),
  accommodation_lon NUMERIC(11, 8),
  start_date TIMESTAMP WITH TIME ZONE NOT NULL,
  end_date TIMESTAMP WITH TIME ZONE NOT NULL,
  return_time TIMESTAMP WITH TIME ZONE,
  status VARCHAR(50) DEFAULT 'planned', -- planned, active, completed, cancelled
  is_public BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_trips_traveler_id ON trips(traveler_id);
CREATE INDEX idx_trips_status ON trips(status);
CREATE INDEX idx_trips_start_date ON trips(start_date);

-- Create check-ins table (for return time tracking + escalation)
CREATE TABLE trip_checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  scheduled_return TIMESTAMP WITH TIME ZONE NOT NULL,
  checked_in_at TIMESTAMP WITH TIME ZONE,
  escalated_at TIMESTAMP WITH TIME ZONE,
  escalation_level INT DEFAULT 0, -- 0=none, 1=ping, 2=call, 3=operator
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_trip_checkins_trip_id ON trip_checkins(trip_id);
CREATE INDEX idx_trip_checkins_escalation ON trip_checkins(escalated_at);
